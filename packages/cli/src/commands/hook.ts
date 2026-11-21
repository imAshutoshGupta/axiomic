/**
 * `axiomic hook install | uninstall | status`: manage the SessionStart hook in Claude Code's user settings.
 * (`axiomic hook session-start`, what the hook itself runs, is handled separately: see hook/entry.ts.)
 */
import { claudeHookStatus, claudeSettingsPath, installClaudeHook, resolveHookTarget, uninstallClaudeHook } from "../hook/claude-settings";
import { hookTargetOrUndefined, parseFlags, UsageError, type CliContext } from "./context";
import { formatHookStatus } from "./format";

export async function hookCommand(ctx: CliContext, args: string[]): Promise<number> {
  const { values, positionals } = parseFlags(args, { "dry-run": { type: "boolean" } }, 1);
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
