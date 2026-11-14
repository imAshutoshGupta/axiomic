import { parseArgs } from "node:util";
import { claudeSettingsPath, claudeHookStatus, installClaudeHook, resolveHookTarget, uninstallClaudeHook, type HookTarget } from "./claude-hook";
import { resolveDirs } from "./dirs";
import { formatHookStatus, formatRemoveReport, formatStatus } from "./format";
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
}

/** Commands that need the server. They exist in the plan, but NOT in this build: no fake versions. */
export const NOT_AVAILABLE = ["login", "logout", "pull", "push", "whoami", "init", "diff", "import"] as const;

/**
 * The session hook must never hold up Claude Code. If the work isn't done by then, we stop waiting
 * and exit 0 anyway. (The hook's own `timeout: 5` in settings.json is a second safety net.)
 */
export const HOOK_HARD_TIMEOUT_MS = 1500;

/** The writer stops starting new file operations after this, leaving time to save its manifest before the hard limit. */
export const HOOK_SOFT_DEADLINE_MS = 1000;

export const HELP = `axiomic ${VERSION}
Private, team-controlled AI rule files.

Usage: axiomic <command> [options]

Commands in this build (all local, no network):
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

Not available in this build (they need the axiomic server):
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
      ctx.stderr(`axiomic ${command}: not available in this build (it needs the axiomic server, which isn't live yet).\n`);
      return 1;
    }
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
function flags<const T extends Record<string, { type: "boolean" }>>(args: string[], options: T, positionals = 0) {
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
    const work = runSessionStart({ env: ctx.env, cwd: ctx.cwd, dirs: dirsOf(ctx), debug, deadline });
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
