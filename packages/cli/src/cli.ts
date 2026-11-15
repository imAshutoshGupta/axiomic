import { parseArgs } from "node:util";
import { login, logout, whoami, type AccountDeps } from "./account";
import type { FetchFn } from "./api-client";
import { normalizeApiUrl, resolveApiUrl } from "./api-url";
import { claudeSettingsPath, claudeHookStatus, installClaudeHook, resolveHookTarget, uninstallClaudeHook, type HookTarget } from "./claude-hook";
import { resolveDirs } from "./dirs";
import { formatDiffReport, formatHookStatus, formatPullReport, formatPushReport, formatRemoveReport, formatStatus } from "./format";
import { openUrl } from "./open-url";
import { AccessGoneError, diffCommand, formatProjectRows, initCommand, parseProjectRef, pullCommand, pushCommand, type ProjectDeps } from "./project-commands";
import { runRemove } from "./remove";
import { runSessionStart } from "./session-start";
import { collectStatus, statusHasProblems } from "./status";
import { VERSION } from "./version";

/**
 * The command router: turns `axiomic <command> [flags]` into a call to the right module and an exit code.
 *
 * Everything the outside world provides (arguments, env vars, folders, where to print) comes in through
 * `CliContext`, so tests can run any command against temp folders without touching the real machine.
 * main.ts is the only place that reads the real `process`.
 *
 * Exit codes: 0 = fine, 1 = the command failed or isn't available, 2 = the command line was wrong.
 */
export interface CliContext {
  /** Arguments after `node axiomic.js`. */
  argv: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  homedir: string;
  platform: NodeJS.Platform;
  /** Absolute path of the running node binary and of this script: what the hook will be told to run. */
  execPath: string;
  scriptPath: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** How to reach the server. main.ts passes the real fetch; tests pass a fake server. */
  fetch?: FetchFn;
  /** For login's polling: tests replace them so nothing really waits. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  openUrl?: (url: string) => Promise<boolean>;
}

/** Commands that exist in the plan but are NOT in this build yet: no fake versions. */
export const NOT_AVAILABLE = ["import"] as const;

/**
 * The session hook must never hold up Claude Code. If the work isn't done by then, we stop waiting
 * and exit 0 anyway. (The hook's own `timeout: 5` in settings.json is a second safety net.)
 * Raised from 1.5 s / 1 s when the hook started pulling from the server (DECISIONS #60):
 * the server gets HOOK_NETWORK_TIMEOUT_MS, then the files get the rest of the soft deadline.
 */
export const HOOK_HARD_TIMEOUT_MS = 2500;

/** The writer stops starting new file operations after this, leaving time to save its manifest before the hard limit. */
export const HOOK_SOFT_DEADLINE_MS = 2000;

/** Longest wait for the server in the hook. After that, the offline cache is used. */
export const HOOK_NETWORK_TIMEOUT_MS = 1200;

export const HELP = `axiomic ${VERSION}
Private, team-controlled AI rule files.

Usage: axiomic <command> [options]

Getting started:
  login                     Log in through your browser (you approve a code on the website)
      --api-url <url>       Use another axiomic server (default: AXIOMIC_API_URL, or the built-in one)
      --no-browser          Don't open the browser; just print the address
  init [<space>/<project>]  Link this repo to a project and write its rules (run at the top of the repo).
                            Without a project: list the ones you can link.
  pull                      Fetch your combined rules and write them (as gitignored files)
      --quiet               Print only problems
      --force               Also overwrite rule files that were edited locally
  push                      Show which of your edits to the rule files would be sent
      --yes                 Send them: saved if you own that layer, otherwise a suggestion
  diff                      Show how your rule files differ from the server (exit 1 if they do)
  whoami                    Show who you are logged in as, and on which server
  logout                    Revoke this computer's login token and delete it

Local commands (no network):
  status                    Show what axiomic manages in this project and on this computer
      --json                Print the raw report as JSON
  remove                    Undo what axiomic did in this project
      --dry-run             Show what would happen, change nothing
      --force               Also delete rule files that were edited locally
      --hook                Also remove the Claude Code hook (shared by all projects)
      --credentials         Also delete the saved login (shared by all projects)
      --all                 Same as --hook --credentials
  hook install              Add the SessionStart hook to Claude Code's user settings
  hook uninstall            Remove it (your other hooks are untouched)
  hook status               Show whether it is installed and still works
      --dry-run             (install/uninstall) Show what would happen, change nothing

Not available in this build yet:
  ${NOT_AVAILABLE.join(", ")}

Options:
  -v, --version             Print the version
  -h, --help                Print this help
`;

/** A wrong command line: print the message plus a hint, exit 2. */
class UsageError extends Error {}

export async function runCli(ctx: CliContext): Promise<number> {
  const [command, ...rest] = ctx.argv;

  // The hook path comes first and is handled separately: it must never print to stdout or fail.
  if (command === "hook" && rest[0] === "session-start") return runHookEntry(ctx);

  try {
    if (command === undefined || command === "--help" || command === "-h" || command === "help") {
      ctx.stdout(HELP);
      return 0;
    }
    if (command === "--version" || command === "-v") {
      ctx.stdout(VERSION + "\n");
      return 0;
    }
    if ((NOT_AVAILABLE as readonly string[]).includes(command)) {
      ctx.stderr(`axiomic ${command}: not available in this build yet.\n`);
      return 1;
    }
    if (command === "login") return await loginCommand(ctx, rest);
    if (command === "logout") return await logoutCommand(ctx, rest);
    if (command === "whoami") return await whoamiCommand(ctx, rest);
    if (command === "init") return await initCmd(ctx, rest);
    if (command === "pull") return await pullCmd(ctx, rest);
    if (command === "push") return await pushCmd(ctx, rest);
    if (command === "diff") return await diffCmd(ctx, rest);
    if (command === "status") return await statusCommand(ctx, rest);
    if (command === "remove") return await removeCommand(ctx, rest);
    if (command === "hook") return await hookCommand(ctx, rest);
    throw new UsageError(`Unknown command: ${command}`);
  } catch (error) {
    if (error instanceof UsageError) {
      ctx.stderr(`axiomic: ${error.message}\nRun "axiomic --help" to see the commands.\n`);
      return 2;
    }
    // Our own errors are written to be read by people, and never contain a token. No stack trace.
    ctx.stderr(`axiomic: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

/** Parses flags strictly: an unknown flag or a stray word is a usage error, not silently ignored. */
function flags<const T extends Record<string, { type: "boolean" | "string" }>>(args: string[], options: T, positionals = 0) {
  try {
    const parsed = parseArgs({ args, options, allowPositionals: positionals > 0, strict: true });
    if (parsed.positionals.length > positionals) throw new Error(`Unexpected argument: ${parsed.positionals[positionals]}`);
    return parsed;
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
}

function dirsOf(ctx: CliContext) {
  return resolveDirs({ platform: ctx.platform, env: ctx.env, homedir: ctx.homedir });
}

/** Where the hook would point if installed from this axiomic. Undefined when running from source or npx. */
async function hookTargetOrUndefined(ctx: CliContext): Promise<HookTarget | undefined> {
  try {
    return await resolveHookTarget(ctx.execPath, ctx.scriptPath);
  } catch {
    return undefined;
  }
}

async function statusCommand(ctx: CliContext, args: string[]): Promise<number> {
  const { values } = flags(args, { json: { type: "boolean" } });
  const report = await collectStatus({
    cwd: ctx.cwd,
    dirs: dirsOf(ctx),
    env: ctx.env,
    homedir: ctx.homedir,
    hookTarget: await hookTargetOrUndefined(ctx),
  });
  ctx.stdout(values.json ? JSON.stringify(report, null, 2) + "\n" : formatStatus(report));
  // A rule file tracked by Git or not ignored by it is a leak in the making, and an error in any section is
  // a problem: make both visible to scripts through the exit code.
  return statusHasProblems(report) ? 1 : 0;
}

async function removeCommand(ctx: CliContext, args: string[]): Promise<number> {
  const { values } = flags(args, {
    "dry-run": { type: "boolean" },
    force: { type: "boolean" },
    hook: { type: "boolean" },
    credentials: { type: "boolean" },
    all: { type: "boolean" },
  });
  const dryRun = values["dry-run"] ?? false;
  const report = await runRemove({
    cwd: ctx.cwd,
    dirs: dirsOf(ctx),
    env: ctx.env,
    homedir: ctx.homedir,
    dryRun,
    force: values.force ?? false,
    hook: (values.hook ?? false) || (values.all ?? false),
    credentials: (values.credentials ?? false) || (values.all ?? false),
  });
  ctx.stdout(formatRemoveReport(report, dryRun));
  return 0;
}

async function hookCommand(ctx: CliContext, args: string[]): Promise<number> {
  const { values, positionals } = flags(args, { "dry-run": { type: "boolean" } }, 1);
  const action = positionals[0];
  const settingsPath = claudeSettingsPath(ctx.env, ctx.homedir);
  const dryRun = values["dry-run"] ?? false;
  const prefix = dryRun ? "[dry run] " : "";

  if (action === "install") {
    // Throws a clear error when run from source, from a runner's temp folder, or from a project-local install.
    const target = await resolveHookTarget(ctx.execPath, ctx.scriptPath);
    const change = await installClaudeHook(settingsPath, target, { dryRun });
    ctx.stdout(`${prefix}Claude Code hook ${change} in ${settingsPath}\n  runs: ${target.nodePath} ${target.scriptPath} hook session-start\n`);
    ctx.stdout("Note: this hook form needs a recent Claude Code; on an older one it does nothing (sessions still start normally).\n");
    return 0;
  }
  if (action === "uninstall") {
    const change = await uninstallClaudeHook(settingsPath, { dryRun });
    ctx.stdout(`${prefix}Claude Code hook ${change === "removed" ? "removed from" : "was not installed in"} ${settingsPath}\n`);
    return 0;
  }
  if (action === "status") {
    const status = await claudeHookStatus(settingsPath, await hookTargetOrUndefined(ctx));
    ctx.stdout(formatHookStatus(status));
    return 0;
  }
  throw new UsageError(action === undefined ? "hook needs one of: install, uninstall, status" : `Unknown hook command: ${action}`);
}

/**
 * `axiomic hook session-start`: what Claude Code runs at the start of every session.
 *
 * Fail open, always:
 * - any error is swallowed (shown on stderr only with AXIOMIC_DEBUG=1);
 * - the writer checks a soft deadline between files and stops cleanly; after HOOK_HARD_TIMEOUT_MS we stop
 *   waiting anyway. main.ts then exits the process, which ends any work still in flight. Writes are atomic
 *   and the manifest records every file BEFORE it is written (writer.ts), so even that last resort leaves
 *   nothing axiomic can't update or remove later (a leftover hidden .tmp file is swept by the next run);
 * - the exit code is always 0, and nothing is ever printed to stdout (Claude Code would feed
 *   a SessionStart hook's stdout to the AI as context).
 */
async function runHookEntry(ctx: CliContext): Promise<number> {
  const debug = (message: string) => {
    if (ctx.env.AXIOMIC_DEBUG === "1") ctx.stderr(`axiomic hook: ${message}\n`);
  };
  let timer: NodeJS.Timeout | undefined;
  try {
    // Soft deadline first: the writer stops cleanly between files (and its manifest is crash-safe). The hard
    // timeout below, and main.ts's process.exit(0), are only the LAST resort.
    const deadline = Date.now() + HOOK_SOFT_DEADLINE_MS;
    const work = runSessionStart({
      env: ctx.env,
      cwd: ctx.cwd,
      dirs: dirsOf(ctx),
      debug,
      deadline,
      ...(ctx.fetch ? { fetch: ctx.fetch } : {}),
      networkTimeoutMs: HOOK_NETWORK_TIMEOUT_MS,
    });
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), HOOK_HARD_TIMEOUT_MS);
    });
    // If the timeout wins, `work` may still fail later: make sure that can't become an unhandled rejection.
    work.catch(() => undefined);
    if ((await Promise.race([work, timeout])) === "timeout") debug(`gave up after ${HOOK_HARD_TIMEOUT_MS} ms`);
  } catch (error) {
    debug(`failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
  }
  return 0;
}

// ----- server commands (DECISIONS #59) -----

function requireFetch(ctx: CliContext): FetchFn {
  if (!ctx.fetch) throw new Error("this command needs the network, which isn't available here");
  return ctx.fetch;
}

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

function projectDeps(ctx: CliContext): ProjectDeps {
  return { fetch: requireFetch(ctx), env: ctx.env, cwd: ctx.cwd, dirs: dirsOf(ctx) };
}

async function loginCommand(ctx: CliContext, args: string[]): Promise<number> {
  const { values } = flags(args, { "api-url": { type: "string" }, "no-browser": { type: "boolean" } });
  if (ctx.env.AXIOMIC_TOKEN) ctx.stderr("Note: AXIOMIC_TOKEN is set, so other commands will keep using it instead of this login.\n");
  const apiUrl = values["api-url"] !== undefined ? normalizeApiUrl(values["api-url"]) : resolveApiUrl(ctx.env);
  const me = await login(accountDeps(ctx), apiUrl, { browser: !values["no-browser"] });
  ctx.stdout(`\nLogged in as ${me.user.name}${me.user.email ? ` (${me.user.email})` : ""} on ${apiUrl}.\n`);
  return 0;
}

async function logoutCommand(ctx: CliContext, args: string[]): Promise<number> {
  flags(args, {});
  const result = await logout(accountDeps(ctx));
  if (!result.had) ctx.stdout("You were not logged in on this computer.\n");
  else if (result.revoked) ctx.stdout("Logged out: the token was revoked on the server and deleted from this computer.\n");
  else ctx.stdout(`Logged out on this computer. The token could not be revoked on the server (${result.message}); revoke it on the website under CLI tokens.\n`);
  if (ctx.env.AXIOMIC_TOKEN) ctx.stdout("Note: AXIOMIC_TOKEN is still set in your environment.\n");
  return 0;
}

async function whoamiCommand(ctx: CliContext, args: string[]): Promise<number> {
  flags(args, {});
  const result = await whoami(accountDeps(ctx));
  if (!result) {
    ctx.stderr('axiomic: not logged in. Run "axiomic login".\n');
    return 1;
  }
  const { me, apiUrl, source } = result;
  const lines = [
    `Logged in as ${me.user.name}${me.user.email ? ` (${me.user.email})` : ""}`,
    `Server:  ${apiUrl}`,
    `Token:   ${me.token.prefix}… (${me.token.kind === "agent" ? "project agent key, read-only" : "CLI login"}${source === "env" ? ", from AXIOMIC_TOKEN" : ""})`,
  ];
  if (me.token.project) lines.push(`Project: ${me.token.project.space}/${me.token.project.slug} (${me.token.project.name})`);
  if (me.token.expiresAt) lines.push(`Expires: ${me.token.expiresAt.slice(0, 10)}`);
  ctx.stdout(lines.join("\n") + "\n");
  return 0;
}

async function pullCmd(ctx: CliContext, args: string[]): Promise<number> {
  const { values } = flags(args, { quiet: { type: "boolean" }, force: { type: "boolean" } });
  try {
    const { answer, report } = await pullCommand(projectDeps(ctx), { force: values.force ?? false });
    if (!values.quiet) ctx.stdout(formatPullReport(report, answer));
    return 0;
  } catch (error) {
    if (error instanceof AccessGoneError && error.report.keptModified.length > 0) {
      ctx.stderr(`axiomic: kept because you edited them (delete them yourself): ${error.report.keptModified.join(", ")}\n`);
    }
    throw error;
  }
}

async function initCmd(ctx: CliContext, args: string[]): Promise<number> {
  const { positionals } = flags(args, {}, 1);
  let ref: { space: string; project: string } | undefined;
  if (positionals[0] !== undefined) {
    ref = parseProjectRef(positionals[0]);
    if (!ref) throw new UsageError(`"${positionals[0]}" is not <space>/<project>, e.g. acme/web-app`);
  }
  const outcome = await initCommand(projectDeps(ctx), ref);

  if (outcome.kind === "choose") {
    const rows = formatProjectRows(outcome.spaces);
    if (rows.length === 0) {
      ctx.stderr("axiomic: you have no projects yet. Create one on the website, or ask your admin for access.\n");
      return 1;
    }
    ctx.stdout(`Projects you can link:\n${rows.join("\n")}\n\nRun: axiomic init <space>/<project>   (at the top of your repo)\n`);
    return 1; // nothing was linked yet
  }

  const { answer, report } = outcome.outcome;
  ctx.stdout(formatPullReport(report, answer));
  if (outcome.created) ctx.stdout(`\nCreated ${outcome.root}/axiomic.json. Commit it, so teammates only need "axiomic init".\n`);

  // The Claude Code hook keeps the rules fresh at every session start. It's user-level: one install for all repos.
  const settingsPath = claudeSettingsPath(ctx.env, ctx.homedir);
  try {
    const status = await claudeHookStatus(settingsPath, await hookTargetOrUndefined(ctx));
    if (status.count === 0) {
      const target = await resolveHookTarget(ctx.execPath, ctx.scriptPath);
      await installClaudeHook(settingsPath, target);
      ctx.stdout(`Installed the Claude Code hook in ${settingsPath}: rules are pulled at every session start.\n`);
    }
  } catch (error) {
    ctx.stdout(`Note: the Claude Code hook was not installed (${(error as Error).message}). Install axiomic globally, then run "axiomic hook install".\n`);
  }
  return 0;
}

async function pushCmd(ctx: CliContext, args: string[]): Promise<number> {
  const { values } = flags(args, { yes: { type: "boolean" } });
  const outcome = await pushCommand(projectDeps(ctx), { send: values.yes ?? false });
  ctx.stdout(formatPushReport(outcome, values.yes ?? false));
  // Exit 1 when something sent was not accepted, so scripts notice.
  return outcome.results?.some((r) => r.status === "conflict" || r.status === "refused") ? 1 : 0;
}

async function diffCmd(ctx: CliContext, args: string[]): Promise<number> {
  flags(args, {});
  const outcome = await diffCommand(projectDeps(ctx));
  ctx.stdout(formatDiffReport(outcome));
  return outcome.files.length > 0 ? 1 : 0;
}
