/**
 * `axiomic remove`: undoes what axiomic did in this project, and only that.
 *
 * | What                                   | Default | Notes                                              |
 * |----------------------------------------|---------|----------------------------------------------------|
 * | managed rule files we wrote, unedited  | removed | edited ones are kept and listed (unless --force)   |
 * | rule files we didn't write             | kept    | listed, never deleted (not even with --force)      |
 * | leftover .axiomic*.tmp files           | removed | killed-write leftovers in .claude/rules (our exact name pattern, regular files only) |
 * | .claude/rules folder                   | removed | only if empty afterwards; .claude is never touched |
 * | .gitignore / .dockerignore block       | removed | the rest of each file is untouched. The FILE is deleted only if axiomic created it and nothing else is in it; otherwise it stays (empty if need be) |
 * | this project's cache and manifest      | removed | the manifest is kept while edited files remain     |
 * | the Claude Code hook                   | --hook  | it's shared by ALL projects, so never by default   |
 * | saved login (credentials.json)         | --credentials | also shared by all projects                  |
 * | axiomic.json                           | never   | it's committed and shared with your team: `git rm axiomic.json` yourself |
 *
 * --all = --hook --credentials.  --dry-run shows what would happen and changes nothing.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { cacheFilePath, deleteCache } from "../local-files/cache";
import { claudeSettingsPath, uninstallClaudeHook, type HookChange } from "../hook/claude-settings";
import { deleteCredentials, hasCredentialsFile } from "../server/credentials";
import type { AxiomicDirs } from "../local-files/dirs";
import { fileExists, removeDirIfEmpty } from "../utils/fs-safe";
import { gitTrackedFiles, hasGitRepoAtOrAbove } from "../project/git";
import { dockerignorePath, gitignorePath, removeBlockFromFile, type RemoveResult } from "../local-files/ignore-block";
import { RULES_DIR, isManagedRulePath, sweepRuleTempFiles } from "../local-files/managed-paths";
import { deleteManifest, knownPaths, readManifest } from "../local-files/manifest";
import { findProjectRoot } from "../project/project-config";
import { projectKey } from "../project/project-key";
import { checkRuleDirs, writeRuleFiles, type WriteReport } from "../local-files/writer";
import { dirsOf, parseFlags, type CliContext } from "./context";
import { formatRemoveReport } from "./format";

export interface RemoveOptions {
  cwd: string;
  dirs: AxiomicDirs;
  env: NodeJS.ProcessEnv;
  homedir: string;
  dryRun: boolean;
  force: boolean;
  hook: boolean;
  credentials: boolean;
}

export interface RemoveReport {
  projectRoot: string;
  files: WriteReport;
  /** axiomic-looking files in .claude/rules that the manifest doesn't know about. Never deleted. */
  unknownFiles: string[];
  rulesDirRemoved: boolean;
  /** Leftover axiomic temp files (from a killed write) that were removed. */
  tempFilesRemoved: string[];
  /** "kept": left in place because edited or unknown rule files remain and must stay out of Git. */
  gitignore: RemoveResult | "kept";
  dockerignore: RemoveResult | "kept";
  cacheRemoved: boolean;
  /** True if the manifest was kept because edited files remain. */
  manifestKept: boolean;
  hook?: HookChange;
  credentialsRemoved?: boolean;
}

export async function runRemove(options: RemoveOptions): Promise<RemoveReport> {
  const { dirs, dryRun, force } = options;
  // The project root, or the current folder if axiomic.json is already gone: everything below only
  // ever removes things axiomic itself wrote, so it's safe either way.
  const root = (await findProjectRoot(options.cwd)) ?? options.cwd;
  const realRoot = await fs.realpath(root);
  const key = await projectKey(realRoot);

  // Read the manifest FIRST: writing "no rule files" below deletes it, and it also says which ignore files
  // axiomic itself created (those may be deleted once only our block is left in them).
  const manifest = await readManifest(dirs.state, key);

  // 1. Rule files: "write an empty set", which deletes every unedited file we wrote.
  const files = await writeRuleFiles({ projectRoot: realRoot, stateDir: dirs.state, files: [], force, dryRun });

  // 2. Files that look like ours but that we have no record of writing: report, never delete.
  const known = new Set(knownPaths(manifest));
  const unknownFiles = (await listRuleFiles(realRoot)).filter(
    (p) => !known.has(p) && !files.deleted.includes(p) && !files.keptModified.includes(p),
  );

  // 3. Leftover temp files (rule content from a killed write), then the .claude/rules folder, only if now empty
  //    and a real folder (never .claude itself).
  let rulesDirRemoved = false;
  let tempFilesRemoved: string[] = [];
  if (await checkRuleDirs(realRoot, RULES_DIR.split("/"), false)) {
    tempFilesRemoved = await sweepRuleTempFiles(realRoot, 0, dryRun);
    if (!dryRun) rulesDirRemoved = await removeDirIfEmpty(path.join(realRoot, ...RULES_DIR.split("/")));
  }

  // 4. The ignore blocks. Kept while edited rule files remain, so those can't be committed by accident.
  const keepIgnore = files.keptModified.length > 0 || unknownFiles.length > 0;
  const gitignore = keepIgnore
    ? "kept"
    : await removeBlockFromFile(gitignorePath(realRoot), { dryRun, createdByAxiomic: await mayDeleteIgnoreFile(realRoot, ".gitignore", manifest.ignoreFilesCreated.has(".gitignore")) });
  const dockerignore = keepIgnore
    ? "kept"
    : await removeBlockFromFile(dockerignorePath(realRoot), { dryRun, createdByAxiomic: await mayDeleteIgnoreFile(realRoot, ".dockerignore", manifest.ignoreFilesCreated.has(".dockerignore")) });

  // 5. Cache and manifest. The writer keeps the manifest while it still holds something useful (the "we created
  //    .gitignore" note); now that the ignore step is done we delete it, unless edited files remain, or we kept
  //    the blocks and still need that note for a later `remove`.
  const cacheRemoved = dryRun ? await fileExists(cacheFilePath(dirs.cache, key)) : await deleteCache(dirs.cache, key);
  const manifestKept = files.keptModified.length > 0;
  if (!dryRun && !manifestKept && !(keepIgnore && manifest.ignoreFilesCreated.size > 0)) await deleteManifest(dirs.state, key);

  const report: RemoveReport = { projectRoot: realRoot, files, unknownFiles, rulesDirRemoved, tempFilesRemoved, gitignore, dockerignore, cacheRemoved, manifestKept };

  // 6. Machine-wide things, only when asked.
  if (options.hook) report.hook = await uninstallClaudeHook(claudeSettingsPath(options.env, options.homedir), { dryRun });
  if (options.credentials) {
    report.credentialsRemoved = dryRun ? await hasCredentialsFile(dirs.config) : await deleteCredentials(dirs.config);
  }
  return report;
}

/**
 * An ignore file may be deleted only if axiomic created it AND Git doesn't track it. Tracked means the user (or
 * a teammate) committed it, e.g. they deleted ours and committed their own empty one: it is theirs now. If Git
 * can't answer inside a repo, we can't know, so we keep it. (No repo at all: nothing can be tracked.)
 */
async function mayDeleteIgnoreFile(realRoot: string, name: string, createdByAxiomic: boolean): Promise<boolean> {
  if (!createdByAxiomic) return false;
  const tracked = await gitTrackedFiles(realRoot, [name]);
  if (tracked !== undefined) return !tracked.includes(name);
  return !(await hasGitRepoAtOrAbove(realRoot));
}

/** Managed-looking files currently in .claude/rules (empty if the folder is missing). */
async function listRuleFiles(realRoot: string): Promise<string[]> {
  if (!(await checkRuleDirs(realRoot, RULES_DIR.split("/"), false))) return [];
  const names = await fs.readdir(path.join(realRoot, ...RULES_DIR.split("/")));
  return names.map((name) => `${RULES_DIR}/${name}`).filter(isManagedRulePath).sort();
}

export async function removeCommand(ctx: CliContext, args: string[]): Promise<number> {
  const { values } = parseFlags(args, {
    "dry-run": { type: "boolean" },
    force: { type: "boolean" },
    hook: { type: "boolean" },
    credentials: { type: "boolean" },
    all: { type: "boolean" },
  });
  const dryRun = values["dry-run"] ?? false;
  const all = values.all ?? false;
  const report = await runRemove({
    cwd: ctx.cwd,
    dirs: dirsOf(ctx),
    env: ctx.env,
    homedir: ctx.homedir,
    dryRun,
    force: values.force ?? false,
    hook: (values.hook ?? false) || all,
    credentials: (values.credentials ?? false) || all,
  });
  ctx.stdout(formatRemoveReport(report, dryRun));
  return 0;
}
