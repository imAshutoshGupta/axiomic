import { promises as fs } from "node:fs";
import path from "node:path";
import { isSafeModuleName } from "@axiomic/shared";

/**
 * The ONLY files axiomic ever writes or deletes inside a project (for Claude Code):
 *
 *   .claude/rules/axiomic.md              the main rules
 *   .claude/rules/axiomic-<module>.md     one per folder, <module> passes isSafeModuleName
 *
 * This is a second, independent check on top of renderClaude()'s own checks. If the server were
 * ever compromised and sent a path like "../../.ssh/config" or ".git/hooks/pre-commit", or a
 * module name like "x/../../evil", it fails here and nothing is written.
 * It also guarantees we never touch the repo's own CLAUDE.md or AGENTS.md.
 */
export const RULES_DIR = ".claude/rules";
export const MAIN_RULES_FILE = `${RULES_DIR}/axiomic.md`;

/** Max number of managed files we'll accept in one go: a sanity limit, far above any real project. */
export const MAX_MANAGED_FILES = 500;

/** True only for an exact, allowed, relative path with forward slashes. */
export function isManagedRulePath(relPath: string): boolean {
  if (relPath === MAIN_RULES_FILE) return true;
  const prefix = `${RULES_DIR}/axiomic-`;
  if (!relPath.startsWith(prefix) || !relPath.endsWith(".md")) return false;
  const name = relPath.slice(prefix.length, -".md".length);
  // isSafeModuleName allows only [a-z0-9-], so the name can't contain "/", "..", "\" or ":".
  return isSafeModuleName(name);
}

/** The path split into its folder parts and file name, e.g. [".claude", "rules"] and "axiomic.md". */
export function splitManagedPath(relPath: string): { dirs: string[]; file: string } {
  const parts = relPath.split("/");
  const file = parts.pop();
  if (file === undefined) throw new Error("empty path");
  return { dirs: parts, file };
}

/**
 * Leftover temp files. writeFileAtomic() writes to `.<name>.<16 hex>.tmp` next to the target and renames it.
 * If the process is killed in between (the hook's hard time limit), that temp file stays behind and holds
 * rule content. For our rule files it looks like `.axiomic.md.<hex>.tmp` / `.axiomic-<module>.md.<hex>.tmp`.
 * Two defences: the ignore block lists TEMP_IGNORE_PATTERN, and we delete leftovers (sweepRuleTempFiles).
 */
const TEMP_NAME = /^\.axiomic(?:-[a-z0-9-]+)?\.md\.[0-9a-f]{16}\.tmp$/;

/** Git/Docker ignore pattern (relative to the .claude/rules folder's parent root, without a leading "/"). */
export const TEMP_IGNORE_PATTERN = `${RULES_DIR}/.axiomic*.tmp`;

/** A made-up temp path, used to ask Git "are our temp files ignored too?". */
export const TEMP_SAMPLE_PATH = `${RULES_DIR}/.axiomic.md.0000000000000000.tmp`;

/** True only for a file name that is exactly our temp-file pattern. */
export function isRuleTempName(name: string): boolean {
  return TEMP_NAME.test(name);
}

/**
 * Deletes leftover axiomic temp files in `<realRoot>/.claude/rules`. Only names matching our exact pattern, and
 * only regular files (never a folder or a symlink). With `minAgeMs`, newer files are kept: a second Claude Code
 * session may be writing one right now (a live write takes milliseconds, so 10 s is plenty). The caller must have
 * checked that the folders are real (checkRuleDirs). Returns the names removed.
 */
export async function sweepRuleTempFiles(realRoot: string, minAgeMs: number, dryRun = false): Promise<string[]> {
  const dir = path.join(realRoot, ...RULES_DIR.split("/"));
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return []; // no folder, nothing to sweep
  }
  const removed: string[] = [];
  for (const name of names.filter(isRuleTempName)) {
    const file = path.join(dir, name);
    try {
      const info = await fs.lstat(file);
      if (!info.isFile() || Date.now() - info.mtimeMs < minAgeMs) continue;
      if (!dryRun) await fs.unlink(file);
      removed.push(name);
    } catch {
      // vanished or not ours to delete: ignore
    }
  }
  return removed.sort();
}
