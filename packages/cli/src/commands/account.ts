/**
 * `axiomic login`, `logout` and `whoami` (DECISIONS #55, #59).
 * Everything from outside (network, clock, browser, printing) comes in through `AccountDeps`,
 * so tests can run the whole login against a fake server.
 */
import { ApiError, type FetchFn } from "../server/api-client";
import { resolveAuth } from "../server/auth";
import { deleteCredentials, readCredentials, writeCredentials, type Credentials } from "../server/credentials";
import { pollDeviceLogin, revokeThisToken, startDeviceLogin, whoAmI, type WhoAmI } from "../server/endpoints";
import { normalizeApiUrl, resolveApiUrl } from "../server/api-url";
import { openUrl } from "../utils/open-url";
import { dirsOf, parseFlags, requireFetch, type CliContext } from "./context";

export interface AccountDeps {
  fetch: FetchFn;
  configDir: string;
  env: NodeJS.ProcessEnv;
  print: (text: string) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  openUrl: (url: string) => Promise<boolean>;
}

/** Longest wait for one call to the server during login, logout or whoami. */
const TIMEOUT_MS = 15_000;

/**
 * Device login:
 *   1. POST /device/start → a code like ABCD-1234 (shown here) + a secret device code (kept here)
 *   2. you open <server>/device, sign in, type the code, approve
 *   3. we ask POST /device/token every few seconds until it says approved → token
 *   4. save the token with this server (0600 file); revoke the token it replaces (rotation)
 *
 * The approve URL is built HERE from the server URL you log in to, never taken from the server's
 * answer, so a bad answer can't send your browser somewhere else.
 */
export async function login(deps: AccountDeps, apiUrl: string, options: { browser: boolean }): Promise<WhoAmI> {
  const call = { apiUrl, fetch: deps.fetch, timeoutMs: TIMEOUT_MS };

  // A broken old credentials file must not stop a fresh login: we'll overwrite it.
  let previous: Credentials | undefined;
  try {
    previous = await readCredentials(deps.configDir);
  } catch {
    previous = undefined;
  }

  const start = await startDeviceLogin(call);
  const url = `${apiUrl}/device`;
  deps.print(`To log in, open this page and type the code below:\n\n  ${url}\n\n  Code: ${start.userCode}\n\n`);
  if (options.browser && (await deps.openUrl(url))) deps.print("(Your browser should open now.)\n");
  deps.print("Waiting for you to approve it...\n");

  let wait = start.intervalMs;
  let networkErrors = 0;
  let token: string | undefined;
  while (!token) {
    if (deps.now() > start.expiresAt) throw new Error('the code expired before it was approved. Run "axiomic login" again.');
    await deps.sleep(wait);
    try {
      const result = await pollDeviceLogin(call, start.deviceCode);
      networkErrors = 0;
      if (result.status === "approved") token = result.token;
      else if (result.status === "expired") throw new Error('the code expired before it was approved. Run "axiomic login" again.');
      else if (result.status === "invalid") throw new Error('the server no longer knows this code. Run "axiomic login" again.');
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      // Slow down on "too many requests"; ride out a few network blips; give up on anything else.
      if (error.status === 429) wait = Math.min(wait + 5000, 30_000);
      else if (error.status === 0 && ++networkErrors < 5) continue;
      else throw error;
    }
  }

  await writeCredentials(deps.configDir, { schemaVersion: 1, token, apiUrl });

  // Rotation: the old token is revoked on the server it came from (and only that server).
  if (previous && previous.token !== token) {
    try {
      await revokeThisToken({ apiUrl: previous.apiUrl, token: previous.token, fetch: deps.fetch, timeoutMs: TIMEOUT_MS });
    } catch (error) {
      // 401 = it was already invalid: nothing to do. Anything else: tell the user where to clean up.
      if (!(error instanceof ApiError && error.status === 401)) {
        deps.print(`Note: couldn't revoke your previous login token (${(error as Error).message}). You can revoke it on ${previous.apiUrl}/account/tokens.\n`);
      }
    }
  }

  return whoAmI({ ...call, token });
}

export type LogoutResult = { had: false } | { had: true; revoked: boolean; message?: string };

/** Revokes the saved token on its server (best effort), then deletes it from this computer either way. */
export async function logout(deps: AccountDeps): Promise<LogoutResult> {
  let saved: Credentials | undefined;
  try {
    saved = await readCredentials(deps.configDir);
  } catch {
    // Unreadable or unsafe file (it exists, or reading wouldn't throw): we can't use the token, but we can delete the file.
    await deleteCredentials(deps.configDir);
    return { had: true, revoked: false, message: "the saved login file was damaged, so the token couldn't be revoked" };
  }
  if (!saved) return { had: false };
  let revoked = false;
  let message: string | undefined;
  try {
    await revokeThisToken({ apiUrl: saved.apiUrl, token: saved.token, fetch: deps.fetch, timeoutMs: TIMEOUT_MS });
    revoked = true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) revoked = true; // already invalid
    else message = (error as Error).message;
  }
  await deleteCredentials(deps.configDir);
  return message === undefined ? { had: true, revoked } : { had: true, revoked, message };
}

export async function whoami(deps: AccountDeps): Promise<{ me: WhoAmI; apiUrl: string; source: "env" | "login" } | undefined> {
  const auth = await resolveAuth(deps.env, deps.configDir);
  if (!auth) return undefined;
  const me = await whoAmI({ apiUrl: auth.apiUrl, token: auth.token, fetch: deps.fetch, timeoutMs: TIMEOUT_MS });
  return { me, apiUrl: auth.apiUrl, source: auth.source };
}

// ----- the commands as typed -----

function accountDeps(ctx: CliContext): AccountDeps {
  return {
    fetch: requireFetch(ctx),
    configDir: dirsOf(ctx).config,
    env: ctx.env,
    print: ctx.stdout,
    sleep: ctx.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    now: ctx.now ?? Date.now,
    openUrl: ctx.openUrl ?? ((url) => openUrl(url, ctx.platform)),
  };
}

/** "Ravi Kumar (ravi@acme.in)", or just the name when there is no email. */
function personLabel(user: WhoAmI["user"]): string {
  return `${user.name}${user.email ? ` (${user.email})` : ""}`;
}

export async function loginCommand(ctx: CliContext, args: string[]): Promise<number> {
  const { values } = parseFlags(args, { "api-url": { type: "string" }, "no-browser": { type: "boolean" } });
  if (ctx.env.AXIOMIC_TOKEN) ctx.stderr("Note: AXIOMIC_TOKEN is set, so other commands will keep using it instead of this login.\n");
  const apiUrl = values["api-url"] !== undefined ? normalizeApiUrl(values["api-url"]) : resolveApiUrl(ctx.env);
  const me = await login(accountDeps(ctx), apiUrl, { browser: !values["no-browser"] });
  ctx.stdout(`\nLogged in as ${personLabel(me.user)} on ${apiUrl}.\n`);
  return 0;
}

export async function logoutCommand(ctx: CliContext, args: string[]): Promise<number> {
  parseFlags(args, {});
  const result = await logout(accountDeps(ctx));
  if (!result.had) ctx.stdout("You were not logged in on this computer.\n");
  else if (result.revoked) ctx.stdout("Logged out: the token was revoked on the server and deleted from this computer.\n");
  else ctx.stdout(`Logged out on this computer. The token could not be revoked on the server (${result.message}); revoke it on the website under CLI tokens.\n`);
  if (ctx.env.AXIOMIC_TOKEN) ctx.stdout("Note: AXIOMIC_TOKEN is still set in your environment.\n");
  return 0;
}

export async function whoamiCommand(ctx: CliContext, args: string[]): Promise<number> {
  parseFlags(args, {});
  const result = await whoami(accountDeps(ctx));
  if (!result) {
    ctx.stderr('axiomic: not logged in. Run "axiomic login".\n');
    return 1;
  }
  const { me, apiUrl, source } = result;
  const tokenKind = me.token.kind === "agent" ? "project agent key, read-only" : "CLI login";
  const tokenSource = source === "env" ? ", from AXIOMIC_TOKEN" : "";
  const lines = [`Logged in as ${personLabel(me.user)}`, `Server:  ${apiUrl}`, `Token:   ${me.token.prefix}… (${tokenKind}${tokenSource})`];
  if (me.token.project) lines.push(`Project: ${me.token.project.space}/${me.token.project.slug} (${me.token.project.name})`);
  if (me.token.expiresAt) lines.push(`Expires: ${me.token.expiresAt.slice(0, 10)}`);
  ctx.stdout(lines.join("\n") + "\n");
  return 0;
}
