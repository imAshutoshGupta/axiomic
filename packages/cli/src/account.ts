import { ApiError, type FetchFn } from "./api-client";
import { resolveAuth } from "./auth";
import { deleteCredentials, readCredentials, writeCredentials, type Credentials } from "./credentials";
import { pollDeviceLogin, revokeThisToken, startDeviceLogin, whoAmI, type WhoAmI } from "./remote";

/**
 * `axiomic login`, `logout` and `whoami` (DECISIONS #55, #59).
 * Everything from outside (network, clock, browser, printing) comes in through `AccountDeps`,
 * so tests can run the whole login against a fake server.
 */
export interface AccountDeps {
  fetch: FetchFn;
  configDir: string;
  env: NodeJS.ProcessEnv;
  print: (text: string) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  openUrl: (url: string) => Promise<boolean>;
}

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
