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
import { dirsOf, type CliContext } from "../commands/context";
import { runSessionStart } from "./session-start";

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

export async function runHookEntry(ctx: CliContext): Promise<number> {
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
