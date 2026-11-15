import type { HookStatus } from "./claude-hook";
import type { RemoveReport } from "./remove";
import type { StatusReport } from "./status";
import type { WriteReport } from "./writer";

/**
 * Turns the reports from `status`, `remove` and `hook status` into plain text for the terminal.
 * Kept apart from the logic so the commands return data (easy to test) and only this file decides wording.
 * Nothing here ever receives a token: reports carry paths and states only.
 */

function list(title: string, items: string[]): string[] {
  return items.length === 0 ? [] : [title, ...items.map((item) => `  ${item}`)];
}

function errorText(value: unknown): string | undefined {
  return typeof value === "object" && value !== null && "error" in value ? String((value as { error: unknown }).error) : undefined;
}

export function formatHookStatus(status: HookStatus): string {
  const lines: string[] = [];
  if (status.count === 0) {
    lines.push(`Claude Code hook: not installed (${status.settingsPath})`, '  Run "axiomic hook install" to add it.');
  } else {
    lines.push(`Claude Code hook: installed in ${status.settingsPath}`, `  runs: ${status.nodePath ?? "?"} ${status.scriptPath ?? "?"} hook session-start`);
    if (status.count > 1) lines.push(`  PROBLEM: installed ${status.count} times. Run "axiomic hook install" to fix.`);
    if (status.nodeExists === false) lines.push('  PROBLEM: that node no longer exists. Run "axiomic hook install" to fix.');
    if (status.scriptExists === false) lines.push('  PROBLEM: that axiomic no longer exists. Run "axiomic hook install" to fix.');
    if (!status.current && status.count === 1 && status.nodeExists && status.scriptExists) {
      lines.push('  Note: it points at a different axiomic or node than this one. Run "axiomic hook install" to update.');
    }
  }
  return lines.join("\n") + "\n";
}

export function formatStatus(report: StatusReport): string {
  const lines: string[] = [];
  lines.push(`Server:      ${errorText(report.apiUrl) ? `PROBLEM: ${errorText(report.apiUrl)}` : String(report.apiUrl)} (status works offline: it does not contact the server)`);
  lines.push(
    `Login:       ${report.credentials === "none" ? "none saved" : report.credentials === "ok" ? "saved" : `PROBLEM: ${errorText(report.credentials)}`}`,
  );
  const hookError = errorText(report.hook);
  if (hookError) lines.push(`Claude Code hook: PROBLEM: ${hookError}`);
  else lines.push(formatHookStatus(report.hook as HookStatus).trimEnd());

  const project = report.project;
  if (report.projectError) lines.push("", `Project:     PROBLEM: ${report.projectError}`);
  if (!project) {
    if (report.projectError) return lines.join("\n") + "\n";
    lines.push("", "Project:     none (no axiomic.json in this folder or above it)");
    return lines.join("\n") + "\n";
  }

  const configError = errorText(project.config);
  lines.push("", `Project:     ${project.root}`);
  lines.push(
    `  axiomic.json: ${configError ? `PROBLEM: ${configError}` : `${(project.config as { space: string }).space}/${(project.config as { project: string }).project}`}`,
  );
  lines.push(`  .gitignore block:    ${project.gitignore}`);
  lines.push(`  .dockerignore block: ${project.dockerignore}`);
  const cacheError = errorText(project.cache);
  lines.push(
    `  offline cache: ${cacheError ? `PROBLEM: ${cacheError}` : project.cache ? `version ${(project.cache as { version: number }).version}, fetched ${(project.cache as { fetchedAt: string }).fetchedAt}` : "none"}`,
  );

  if (project.files.length === 0) lines.push("  rule files: none");
  else {
    lines.push("  rule files:");
    const label = { ok: "ok", modified: "MODIFIED locally (kept)", missing: "missing", "not-managed": "not written by axiomic (left alone)", error: "PROBLEM: can't be read safely" };
    for (const file of project.files) lines.push(`    ${file.path}: ${label[file.state]}`);
  }

  if (project.tracked === undefined) lines.push("  Git: couldn't ask Git whether rule files are tracked (not a Git repo, or Git not installed)");
  else if (project.tracked.length === 0) lines.push("  Git: no rule file is tracked");
  else {
    lines.push("  PROBLEM: these rule files are tracked by Git and would be pushed with your code:");
    for (const file of project.tracked) lines.push(`    ${file}`);
    lines.push("  Fix: git rm --cached <file>, then commit.");
  }
  if (project.gitError) lines.push(`  PROBLEM: asking Git failed: ${project.gitError}`);
  if (project.notIgnored && project.notIgnored.length > 0) {
    lines.push("  PROBLEM: Git would NOT ignore these rule files, so `git add -A` would commit them:");
    for (const file of project.notIgnored) lines.push(`    ${file}`);
    lines.push("  Something after axiomic's block un-ignores them (a `!` line in .gitignore, or a .gitignore inside .claude/rules). Remove it.");
    lines.push("  (axiomic will not write rule files while this is the case.)");
  }
  return lines.join("\n") + "\n";
}

export function formatRemoveReport(report: RemoveReport, dryRun: boolean): string {
  const did = dryRun ? "Would remove" : "Removed";
  const lines: string[] = [`${dryRun ? "[dry run] " : ""}Project: ${report.projectRoot}`];

  lines.push(...list(`${did} rule files:`, report.files.deleted));
  lines.push(...list("  of those, edited locally and removed only because of --force:", report.files.forced));
  lines.push(...list("KEPT, edited locally since axiomic wrote them (use --force to delete):", report.files.keptModified));
  lines.push(...list("KEPT, not written by axiomic (delete by hand if you want):", report.unknownFiles));
  if (report.files.deleted.length + report.files.keptModified.length + report.unknownFiles.length === 0) lines.push("No rule files to remove.");
  lines.push(...list(`${did} leftover temp files in .claude/rules:`, report.tempFilesRemoved));
  if (report.rulesDirRemoved) lines.push(`${did} the empty .claude/rules folder`);

  const ignore = (name: string, result: RemoveReport["gitignore"]) => {
    if (result === "removed") lines.push(`${did} the axiomic block from ${name}`);
    else if (result === "deleted-file") lines.push(`${did} ${name} (it contained only the axiomic block)`);
    else if (result === "emptied") lines.push(`${did} the axiomic block from ${name}; the file was there before axiomic, so it is left in place (now empty)`);
    else if (result === "kept") lines.push(`KEPT the axiomic block in ${name}, so the kept rule files stay out of Git`);
  };
  ignore(".gitignore", report.gitignore);
  ignore(".dockerignore", report.dockerignore);

  if (report.cacheRemoved) lines.push(`${did} this project's offline cache`);
  if (report.manifestKept) lines.push("KEPT axiomic's record of written files, because edited files remain");
  if (report.hook !== undefined) lines.push(report.hook === "removed" ? `${did} the Claude Code hook` : "Claude Code hook: was not installed");
  if (report.credentialsRemoved !== undefined) lines.push(report.credentialsRemoved ? `${did} the saved login` : "Saved login: none");
  lines.push("axiomic.json was left in place (it's shared with your team through Git).");
  return lines.join("\n") + "\n";
}

/** The merge's reason codes (packages/shared merge.ts) in plain words. */
const BLOCKED_REASONS: Record<string, string> = {
  locked: "a locked company or team rule has the same title",
  "personal-adds-only": "personal rules can only add, not replace a work rule",
};

/** What a pull changed on disk, plus the rules the merge dropped. Empty lists are left out. */
export function formatPullReport(
  report: WriteReport,
  answer: { project: { name: string; space: string; slug: string }; version: number; blocked: { title: string; layer: string; reason: string }[] },
): string {
  const changed = report.written.length + report.deleted.length;
  const lines = [
    `Rules for ${answer.project.space}/${answer.project.slug} (${answer.project.name}), version ${answer.version}: ` +
      (changed === 0 ? "already up to date." : `${changed} file${changed === 1 ? "" : "s"} changed.`),
    ...list("Written:", report.written),
    ...list("Removed (no longer in your rules):", report.deleted),
    ...list("Edited on this computer, so kept as they are (axiomic push, to send edits back, is coming):", report.keptModified),
    ...list("Not written by axiomic, so left alone:", report.keptUnmanaged),
    ...list("Not finished (run axiomic pull again):", report.deferred),
    ...list(
      "Left out by the combine step:",
      answer.blocked.map((b) => `${b.title} (${b.layer} rule): ${BLOCKED_REASONS[b.reason] ?? b.reason}`),
    ),
  ];
  return lines.join("\n") + "\n";
}
