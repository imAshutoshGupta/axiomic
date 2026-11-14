import path from "node:path";
import { ensurePrivateDir, readFileNoFollow, removeFileIfExists, removeDirIfEmpty, writeFileAtomic } from "./fs-safe";
import { MAX_MANAGED_FILES, isManagedRulePath } from "./managed-paths";
import { projectDataDir } from "./project-key";

/**
 * The manifest: for one project, the list of rule files axiomic wrote and the sha256 hash of each.
 *
 * It's how we tell "a file we wrote and nobody touched" (safe to update or delete) from
 * "a file someone edited" (keep it, report it) and "a file we never wrote" (never touch it).
 *
 * Decision: the manifest lives OUTSIDE the repo, in <state>/projects/<key>/manifest.json, because:
 * - nothing extra appears in the repo (no extra file to gitignore or accidentally commit);
 * - the AI tool works inside the repo. If the manifest were there, an AI that edited a rule file could
 *   also "fix" the manifest, hiding the edit. Outside the repo that's much less likely;
 * - `git clean -fdx` or a fresh checkout can't silently reset it.
 * Alternative rejected: .claude/rules/.axiomic-manifest.json inside the repo.
 *
 * Example:
 *   { "schemaVersion": 1, "files": { ".claude/rules/axiomic.md": { "sha256": "ab12…" } } }
 */
export interface Manifest {
  schemaVersion: 1;
  /** Relative path (always one of the allowed managed paths) → hash of the content we wrote. */
  files: Map<string, string>;
  /**
   * Crash safety. Before the writer touches any file it saves the hash of what it is ABOUT to write here.
   * If the process is killed halfway (the hook's hard time limit), a file may be on disk that `files` doesn't
   * list yet; `pending` knows it, so it's still recognised as ours and unedited. Once a write is done, the
   * entry moves from `pending` to `files`. A file counts as "ours, unedited" if its hash equals EITHER.
   * Proof that an edit is never mistaken for ours: a hash only gets into `pending` for content we are about
   * to write ourselves, so a user's different content matches neither list.
   */
  pending: Map<string, string>;
  /**
   * Which ignore files axiomic itself CREATED (".gitignore" / ".dockerignore"), so `remove` may delete them
   * if only our block is left. Pre-existing ones are never deleted (see removeBlockFromFile).
   */
  ignoreFilesCreated: Set<string>;
}

export const IGNORE_FILE_NAMES = [".gitignore", ".dockerignore"] as const;

/** True if `hash` is one we recorded for this path (confirmed or pending): the file is ours and unedited. */
export function isOurHash(manifest: Manifest, relPath: string, hash: string | undefined): boolean {
  return hash !== undefined && (manifest.files.get(relPath) === hash || manifest.pending.get(relPath) === hash);
}

/** Every path the manifest knows about, confirmed or pending. */
export function knownPaths(manifest: Manifest): string[] {
  return [...new Set([...manifest.files.keys(), ...manifest.pending.keys()])];
}

export function isManifestEmpty(manifest: Manifest): boolean {
  return manifest.files.size === 0 && manifest.pending.size === 0 && manifest.ignoreFilesCreated.size === 0;
}

const FILE_NAME = "manifest.json";

export function emptyManifest(): Manifest {
  return { schemaVersion: 1, files: new Map(), pending: new Map(), ignoreFilesCreated: new Set() };
}

export function manifestPath(stateDir: string, key: string): string {
  return path.join(projectDataDir(stateDir, key), FILE_NAME);
}

/**
 * Reads the manifest. A missing manifest is empty.
 * A corrupt one is an ERROR (unlike the cache): treating it as empty would be safe (we'd just refuse to
 * touch the files), but the user should know why axiomic stopped updating their rule files.
 * Entries whose path isn't an allowed managed path are rejected, so a tampered manifest can never
 * make axiomic delete some other file.
 */
export async function readManifest(stateDir: string, key: string): Promise<Manifest> {
  const file = manifestPath(stateDir, key);
  const raw = await readFileNoFollow(file);
  if (raw === undefined) return emptyManifest();

  const fail = (why: string): never => {
    throw new Error(`axiomic's record of written files is damaged (${why}): ${file}`);
  };

  let data: unknown;
  try {
    data = JSON.parse(raw.toString("utf8"));
  } catch {
    return fail("not valid JSON");
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return fail("not an object");
  const record = data as Record<string, unknown>;
  if (record.schemaVersion !== 1) return fail("unknown schemaVersion");
  const files = record.files;
  if (typeof files !== "object" || files === null || Array.isArray(files)) return fail("no file list");

  const readHashes = (value: unknown, what: string): Map<string, string> => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return fail(`no ${what} list`);
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > MAX_MANAGED_FILES) return fail("too many files");
    const out = new Map<string, string>();
    for (const [relPath, entry] of entries) {
      if (!isManagedRulePath(relPath)) return fail(`unexpected path ${JSON.stringify(relPath)}`);
      const hash = (entry as { sha256?: unknown } | null)?.sha256;
      if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) return fail(`bad hash for ${relPath}`);
      out.set(relPath, hash);
    }
    return out;
  };

  const manifest = emptyManifest();
  manifest.files = readHashes(files, "file");
  // "pending" and "ignoreFilesCreated" are newer fields: a manifest written by an earlier build simply lacks them.
  if (record.pending !== undefined) manifest.pending = readHashes(record.pending, "pending");
  if (record.ignoreFilesCreated !== undefined) {
    const created = record.ignoreFilesCreated;
    if (!Array.isArray(created) || !created.every((n) => (IGNORE_FILE_NAMES as readonly unknown[]).includes(n))) {
      return fail("bad ignoreFilesCreated");
    }
    manifest.ignoreFilesCreated = new Set(created as string[]);
  }
  return manifest;
}

/** Saves the manifest atomically, owner-only (it reveals which rule files exist). */
export async function writeManifest(stateDir: string, key: string, manifest: Manifest): Promise<void> {
  const dir = projectDataDir(stateDir, key);
  await ensurePrivateDir(dir);
  // Object.fromEntries on a sorted list: stable output, and our keys are all safe managed paths.
  const hashes = (map: Map<string, string>) =>
    Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([p, sha256]) => [p, { sha256 }]));
  const out: Record<string, unknown> = { schemaVersion: 1, files: hashes(manifest.files) };
  if (manifest.pending.size > 0) out.pending = hashes(manifest.pending);
  if (manifest.ignoreFilesCreated.size > 0) out.ignoreFilesCreated = [...manifest.ignoreFilesCreated].sort();
  await writeFileAtomic(manifestPath(stateDir, key), JSON.stringify(out, null, 2) + "\n", 0o600);
}

/** Deletes this project's manifest (and its folder if it's then empty). Returns true if a manifest existed. */
export async function deleteManifest(stateDir: string, key: string): Promise<boolean> {
  const removed = await removeFileIfExists(manifestPath(stateDir, key));
  await removeDirIfEmpty(projectDataDir(stateDir, key));
  return removed;
}
