import { promises as fs } from "node:fs";
import path from "node:path";
import type { RenderedFile } from "@axiomic/shared";
import { UnsafePathError, isInside, isNotFound, readFileNoFollow, sha256, writeFileAtomic } from "./fs-safe";
import { gitCheckIgnored, gitTrackedFiles, type IgnoreResult } from "./git";
import { MAX_MANAGED_FILES, TEMP_SAMPLE_PATH, isManagedRulePath, splitManagedPath, sweepRuleTempFiles } from "./managed-paths";
import { deleteManifest, isManifestEmpty, isOurHash, knownPaths, readManifest, writeManifest, type Manifest } from "./manifest";
import { projectKey } from "./project-key";

/**
 * Writes the rule files from renderClaude() into a project, safely.
 *
 *   renderClaude() output ──► check every path ──► look at what's on disk ──► plan ──► write / delete ──► save manifest
 *
 * Safety rules:
 * - Only the allow-listed paths (.claude/rules/axiomic.md, .claude/rules/axiomic-<name>.md). Anything else: nothing is written.
 * - Never through a symlink: .claude, .claude/rules and the file itself must be real folders/files.
 * - Never silently overwrite a local edit: if a file differs from what we last wrote, it's kept and reported.
 * - Never touch a file we didn't write (not in the manifest), unless `force` is set.
 * - The whole plan is made BEFORE any RULE FILE is written, so a problem found halfway changes no rule file.
 *   Exactly what a refused write can leave behind: the caller's `prepare` step has already run by the time Git is
 *   asked, so the .gitignore/.dockerignore blocks (and the manifest's "we created it" note) MAY have been added,
 *   plus empty temp-file cleanup. Problems knowable up front (symlinks, bad paths, FIFOs) are found BEFORE `prepare`.
 * - On EVERY run where managed files exist or are about to be written, we ask Git (`git check-ignore`, from the
 *   rules folder's point of view, after `prepare` wrote the ignore blocks) whether they are ignored. A repo can
 *   un-ignore them with a `!` line or a nested .gitignore; then writing would put confidential rules where
 *   `git add -A` picks them up. Not ignored: write nothing. Git unable to answer inside a repo: write nothing too.
 * - Crash-safe and deadline-aware: see "Execute" below.
 */

/** Claude Code skips rule files over 4 MiB anyway. We stop well below that. */
const MAX_FILE_BYTES = 1024 * 1024;

/** A temp file younger than this might belong to a write in another process that is still running. */
const STALE_TEMP_MS = 10_000;

/** Thrown, with no rule file written, when Git would NOT ignore a managed path (or couldn't say, inside a repo). */
export class NotIgnoredError extends Error {
  override name = "NotIgnoredError";
  constructor(
    readonly paths: string[],
    unknownReason?: string,
  ) {
    super(
      unknownReason !== undefined
        ? `axiomic could not confirm with Git that the rule files are ignored (${unknownReason}), so it wrote nothing.`
        : `Git would not ignore these rule files, so axiomic did not write them (they could be committed by accident): ${paths.join(", ")}. ` +
            "Something after axiomic's block in .gitignore (or a .gitignore inside .claude/rules) un-ignores them. Remove that line.",
    );
  }
}

/** Rule files are confidential: owner-only. */
const RULE_FILE_MODE = 0o600;

export interface WriteRulesOptions {
  projectRoot: string;
  stateDir: string;
  files: RenderedFile[];
  /** Overwrite/delete locally modified files and files axiomic didn't write. Always reported. */
  force?: boolean;
  /** Work out and report what would happen, but change nothing. */
  dryRun?: boolean;
  /**
   * Called after the plan succeeded (so every refusal that can be known up front has already happened) and
   * before any rule file is written. The hook uses it to write the .gitignore/.dockerignore blocks, so those
   * files are never edited for a write that was going to be refused. Returns the ignore files it CREATED.
   */
  prepare?: () => Promise<{ ignoreFilesCreated: string[] } | undefined>;
  /** Stop cleanly before starting a file operation after this time (ms since epoch). Unfinished work goes in `deferred`. */
  deadline?: number;
  /** The clock (tests replace it). */
  now?: () => number;
  /** Asks Git whether the paths are ignored (see IgnoreResult). Tests replace it. */
  checkIgnored?: (realRoot: string, paths: string[], timeoutMs: number) => Promise<IgnoreResult>;
}

export interface WriteReport {
  /** Created or updated. */
  written: string[];
  /** Already had the right content. */
  unchanged: string[];
  /** Old managed files no longer in the rules, removed. */
  deleted: string[];
  /** Edited locally since axiomic wrote them: kept as they are. */
  keptModified: string[];
  /** Existed, but axiomic didn't write them: kept as they are. */
  keptUnmanaged: string[];
  /** Files changed only because `force` was set (also listed in written/deleted). */
  forced: string[];
  /** Not processed because the deadline passed. A later run finishes the job. */
  deferred: string[];
}

type Action =
  | { kind: "write"; relPath: string; content: Buffer; hash: string }
  | { kind: "delete"; relPath: string };

/** Throws if any rendered file has a disallowed path, a duplicate path, or is too big. */
export function validateRenderedFiles(files: RenderedFile[]): void {
  if (files.length > MAX_MANAGED_FILES) throw new Error(`Too many rule files (${files.length})`);
  const seen = new Set<string>();
  for (const file of files) {
    if (typeof file.path !== "string" || !isManagedRulePath(file.path)) {
      throw new UnsafePathError(`Refusing to write an unexpected path: ${JSON.stringify(file.path)}`);
    }
    if (seen.has(file.path)) throw new Error(`The same file appears twice: ${file.path}`);
    seen.add(file.path);
    if (typeof file.content !== "string") throw new Error(`No content for ${file.path}`);
    if (Buffer.byteLength(file.content, "utf8") > MAX_FILE_BYTES) throw new Error(`Rule file is too large: ${file.path}`);
  }
}

/**
 * Checks the folders between the project root and the rule file (.claude, then .claude/rules):
 * each must be a real folder, not a symlink, and the result must still be inside the project.
 * With `create`, missing folders are made one level at a time (never recursively through a link).
 * Returns false if a folder is missing (and `create` is off).
 */
export async function checkRuleDirs(realRoot: string, dirs: string[], create: boolean): Promise<boolean> {
  let current = realRoot;
  for (const part of dirs) {
    current = path.join(current, part);
    try {
      const info = await fs.lstat(current);
      if (info.isSymbolicLink()) throw new UnsafePathError(`Refusing to write through a symlink: ${current}`);
      if (!info.isDirectory()) throw new UnsafePathError(`Expected a folder but found a file: ${current}`);
      // On a case-insensitive disk (macOS, Windows) `.Claude/Rules` opens as `.claude/rules`, but Git patterns are
      // case-sensitive: our lower-case ignore lines would NOT match files in a folder spelled differently.
      // So the real on-disk name must be exactly what we expect.
      const names = await fs.readdir(path.dirname(current));
      if (!names.includes(part)) {
        const real = names.find((n) => n.toLowerCase() === part.toLowerCase());
        throw new UnsafePathError(`The folder is spelled "${real ?? "?"}" on disk but axiomic needs exactly "${part}" (Git ignores are case-sensitive): ${current}`);
      }
    } catch (error) {
      if (!isNotFound(error)) throw error;
      if (!create) return false;
      await fs.mkdir(current); // not recursive: we checked every parent ourselves
    }
  }
  // Belt and braces: the real (symlink-resolved) folder must be exactly where we expect, inside the project.
  const real = await fs.realpath(current);
  if (!isInside(realRoot, real)) throw new UnsafePathError(`Rule folder resolves outside the project: ${current}`);
  return true;
}

/** Hash of the file on disk, or undefined if it doesn't exist. Throws on a symlink. */
async function currentHash(absPath: string): Promise<string | undefined> {
  const data = await readFileNoFollow(absPath, MAX_FILE_BYTES * 4);
  return data === undefined ? undefined : sha256(data);
}

function toAbs(realRoot: string, relPath: string): string {
  return path.join(realRoot, ...relPath.split("/"));
}

export async function writeRuleFiles(options: WriteRulesOptions): Promise<WriteReport> {
  const { files, force = false, dryRun = false } = options;
  validateRenderedFiles(files);

  const realRoot = await fs.realpath(options.projectRoot);
  const key = await projectKey(realRoot);
  const manifest = await readManifest(options.stateDir, key);
  const next: Manifest = {
    schemaVersion: 1,
    files: new Map(manifest.files),
    pending: new Map(manifest.pending),
    ignoreFilesCreated: new Set(manifest.ignoreFilesCreated),
  };

  const report: WriteReport = { written: [], unchanged: [], deleted: [], keptModified: [], keptUnmanaged: [], forced: [], deferred: [] };
  const actions: Action[] = [];

  // Every managed path lives in the same folder; check it once (without creating anything yet).
  const ruleDirs = splitManagedPath(files[0]?.path ?? ".claude/rules/axiomic.md").dirs;
  const dirsExist = await checkRuleDirs(realRoot, ruleDirs, false);

  // ── Plan: promote finished writes ───────────────────────────────
  // A pending hash that matches the file on disk was written completely before an earlier run was cut off.
  // Make it the confirmed hash BEFORE this run replaces `pending` with new hashes; otherwise two cut-off runs in
  // a row would leave a file matching neither list, and it would be mistaken for a local edit.
  for (const [relPath, pendingHash] of manifest.pending) {
    if (dirsExist && (await currentHash(toAbs(realRoot, relPath))) === pendingHash) {
      next.files.set(relPath, pendingHash);
      next.pending.delete(relPath);
    }
  }
  manifest.files = new Map(next.files); // the plan below compares against the promoted state
  manifest.pending = new Map(next.pending);

  // ── Plan: new files ──────────────────────────────────────────────
  const presentHash = new Map<string, string>(); // managed files that exist on disk now
  const newPaths = new Set<string>();
  for (const file of files) {
    newPaths.add(file.path);
    const content = Buffer.from(file.content, "utf8");
    const hash = sha256(content);
    const onDisk = dirsExist ? await currentHash(toAbs(realRoot, file.path)) : undefined;
    if (onDisk !== undefined) presentHash.set(file.path, onDisk);

    if (onDisk === undefined) {
      actions.push({ kind: "write", relPath: file.path, content, hash });
    } else if (onDisk === hash) {
      report.unchanged.push(file.path);
      next.files.set(file.path, hash); // identical content: safe to treat as ours
      next.pending.delete(file.path);
    } else if (isOurHash(manifest, file.path, onDisk)) {
      actions.push({ kind: "write", relPath: file.path, content, hash }); // untouched since we wrote it
    } else if (force) {
      report.forced.push(file.path);
      actions.push({ kind: "write", relPath: file.path, content, hash });
    } else if (knownPaths(manifest).includes(file.path)) {
      report.keptModified.push(file.path); // keep the old hash so it stays flagged as modified
    } else {
      report.keptUnmanaged.push(file.path);
    }
  }

  // ── Plan: files we wrote before that are no longer in the rules ──
  for (const relPath of knownPaths(manifest)) {
    if (newPaths.has(relPath)) continue;
    const onDisk = dirsExist ? await currentHash(toAbs(realRoot, relPath)) : undefined;
    if (onDisk === undefined) {
      next.files.delete(relPath); // already gone
      next.pending.delete(relPath);
    } else if (isOurHash(manifest, relPath, onDisk)) {
      actions.push({ kind: "delete", relPath });
    } else if (force) {
      report.forced.push(relPath);
      actions.push({ kind: "delete", relPath });
    } else {
      report.keptModified.push(relPath);
    }
  }

  if (dryRun) {
    for (const action of actions) (action.kind === "write" ? report.written : report.deleted).push(action.relPath);
    return report;
  }

  // ── Execute ─────────────────────────────────────────────────────
  // Crash safety. The hook can be cut off at any moment (its hard time limit calls process.exit). The rule:
  //   a rule file must never be on disk while the manifest doesn't know it, and an edited file must never
  //   look like an unedited one. So BEFORE the first file is touched, one atomic manifest save records the hash
  //   of every file we are about to write as "pending" (Manifest.pending). A pending hash is only ever the
  //   hash of content we are writing ourselves. If we die at any later point, each file is either not yet
  //   written (old or no content: still recognised) or fully written (matches its pending hash). Writes are
  //   atomic renames, so there is no half-written state. When a file is done it moves from pending to files.
  // Alternative rejected: save the manifest after each file. A kill between the rename and the save leaves a
  //   file the manifest doesn't know, which is exactly the problem; a pending record can't have that gap.
  const now = options.now ?? Date.now;
  const overDeadline = () => options.deadline !== undefined && now() >= options.deadline;
  const gitTimeout = () => (options.deadline === undefined ? 3000 : Math.max(200, Math.min(3000, options.deadline - now())));
  const writes = actions.filter((a) => a.kind === "write");

  try {
    // Leftover temp files from an earlier killed run hold rule content: remove them (only our exact pattern).
    if (dirsExist) await sweepRuleTempFiles(realRoot, STALE_TEMP_MS);

    // The caller's own setup (the ignore blocks). Everything refusable up front has been checked by now.
    const prepared = await options.prepare?.();
    for (const name of prepared?.ignoreFilesCreated ?? []) next.ignoreFilesCreated.add(name);

    // Ask Git, not just the .gitignore text: a `!` line or a nested .gitignore can un-ignore our files.
    // Done on EVERY run that has managed files (on disk, or about to be written), so a `!` line added later is
    // noticed even when every file is unchanged.
    //   open (no git / no repo anywhere above): nothing to leak into, carry on.
    //   unknown (a repo exists but Git can't answer): fail CLOSED, write nothing.
    //   known and not ignored: write nothing, and deal with files already on disk (below).
    if (writes.length > 0 || presentHash.size > 0) {
      const asked = [...files.map((f) => f.path), TEMP_SAMPLE_PATH];
      const answer = await (options.checkIgnored ?? gitCheckIgnored)(realRoot, asked, gitTimeout());
      if (answer.kind === "unknown") throw new NotIgnoredError([], answer.reason);
      if (answer.kind === "known" && answer.notIgnored.length > 0) {
        // Files already on disk that Git would pick up. Decision: remove a file ONLY IF all three hold:
        //   (1) it's unmodified (its hash is one we recorded), so no local edit is lost and the content is
        //       reproducible from the cache;
        //   (2) Git does not track it, so we aren't deleting something from the user's committed history;
        //   (3) Git definitely answered. Edited, tracked or unmanaged files are left alone and `status` reports them.
        const candidates = answer.notIgnored.filter((p) => presentHash.has(p) && isOurHash(manifest, p, presentHash.get(p)));
        const tracked = candidates.length > 0 ? await gitTrackedFiles(realRoot, candidates, gitTimeout()) : undefined;
        for (const relPath of tracked === undefined ? [] : candidates.filter((p) => !tracked.includes(p))) {
          await checkRuleDirs(realRoot, ruleDirs, false);
          await fs.unlink(toAbs(realRoot, relPath)).catch((error: unknown) => {
            if (!isNotFound(error)) throw error;
          });
          next.files.delete(relPath);
          next.pending.delete(relPath);
          report.deleted.push(relPath);
        }
        throw new NotIgnoredError(answer.notIgnored);
      }
    }

    if (writes.length > 0) {
      await checkRuleDirs(realRoot, ruleDirs, true);
      for (const action of writes) if (action.kind === "write") next.pending.set(action.relPath, action.hash);
      await writeManifest(options.stateDir, key, next);
    }

    for (const [index, action] of actions.entries()) {
      // Stop cleanly instead of being killed mid-file. Nothing is lost: pending entries stay in the manifest.
      if (overDeadline()) {
        report.deferred = actions.slice(index).map((a) => a.relPath);
        break;
      }
      // Check the folders again right before each change, to narrow the window for a swapped-in symlink.
      await checkRuleDirs(realRoot, ruleDirs, false);
      const abs = toAbs(realRoot, action.relPath);
      if (action.kind === "write") {
        await writeFileAtomic(abs, action.content, RULE_FILE_MODE);
        next.files.set(action.relPath, action.hash);
        next.pending.delete(action.relPath);
        report.written.push(action.relPath);
      } else {
        // unlink never follows a symlink: at worst it removes a link, never what it points to.
        await fs.unlink(abs).catch((error: unknown) => {
          if (!isNotFound(error)) throw error;
        });
        next.files.delete(action.relPath);
        next.pending.delete(action.relPath);
        report.deleted.push(action.relPath);
      }
    }
  } finally {
    // Save what actually happened, even if we stopped halfway, so the next run knows which files are ours.
    if (isManifestEmpty(next)) await deleteManifest(options.stateDir, key);
    else await writeManifest(options.stateDir, key, next);
  }

  return report;
}
