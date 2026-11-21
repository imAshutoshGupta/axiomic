import path from "node:path";
import type { RenderedFile } from "@axiomic/shared";
import { normalizeApiUrl } from "../server/api-url";
import { ensurePrivateDir, readFileNoFollow, removeDirIfEmpty, removeFileIfExists, writeFileAtomic } from "../utils/fs-safe";
import { isManagedRulePath, MAX_MANAGED_FILES } from "./managed-paths";
import { isValidSlug } from "../project/project-config";
import { parseRuleRefs, type RuleRef } from "../server/endpoints";
import { projectDataDir } from "../project/project-key";

/**
 * The offline cache: the last rules fetched for one project, so a session can still get its rules
 * when the server is down (fail open). Stored in <cache>/projects/<key>/rules.json, owner-only
 * (0700 folder, 0600 file) because rules are confidential.
 *
 * Storage only: nothing here talks to the network. The future `pull` fills it; the session hook reads it.
 *
 * Decision: we store the RENDERED files (what goes on disk), not the raw merge result. It's what the
 * hook needs to restore files, and it's simple to validate. When Cursor support arrives (it needs the
 * merge result to render .mdc files) we bump schemaVersion; an old cache is then just ignored.
 *
 * A damaged cache is never an error: it's treated as "no cache". The hook must never fail because of it.
 */
export interface CacheEntry {
  schemaVersion: 1;
  /** Which server and project this came from. Checked before use, so a cache can't be applied to the wrong project. */
  apiUrl: string;
  space: string;
  project: string;
  /** The rules version number from the server. */
  version: number;
  /** The server's ETag, sent back as If-None-Match so an unchanged pull costs almost nothing. */
  etag: string | null;
  /** When it was fetched (ISO date). */
  fetchedAt: string;
  files: RenderedFile[];
  /**
   * Which section is which rule (from the pull's index), so `axiomic push` can map edits back.
   * Optional: caches written before push existed don't have it; push then asks for a pull first.
   */
  rules?: RuleRef[];
}

const FILE_NAME = "rules.json";

export function cacheFilePath(cacheDir: string, key: string): string {
  return path.join(projectDataDir(cacheDir, key), FILE_NAME);
}

/** Checks a cache entry's shape. Returns undefined if anything is off. */
export function parseCacheEntry(text: string): CacheEntry | undefined {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return undefined;
  const r = data as Record<string, unknown>;

  if (r.schemaVersion !== 1) return undefined;
  if (typeof r.apiUrl !== "string" || !isValidSlug(r.space) || !isValidSlug(r.project)) return undefined;
  if (typeof r.version !== "number" || !Number.isSafeInteger(r.version) || r.version < 0) return undefined;
  if (r.etag !== null && (typeof r.etag !== "string" || r.etag.length > 512)) return undefined;
  if (typeof r.fetchedAt !== "string" || Number.isNaN(Date.parse(r.fetchedAt))) return undefined;
  if (!Array.isArray(r.files) || r.files.length > MAX_MANAGED_FILES) return undefined;

  let apiUrl: string;
  try {
    apiUrl = normalizeApiUrl(r.apiUrl);
  } catch {
    return undefined;
  }

  const files: RenderedFile[] = [];
  for (const file of r.files as unknown[]) {
    const f = file as { path?: unknown; content?: unknown } | null;
    if (typeof f?.path !== "string" || typeof f.content !== "string" || !isManagedRulePath(f.path)) return undefined;
    files.push({ path: f.path, content: f.content }); // copy only the known fields
  }

  let rules: RuleRef[] | undefined;
  if (r.rules !== undefined) {
    rules = parseRuleRefs(r.rules);
    if (!rules) return undefined;
  }
  const entry: CacheEntry = { schemaVersion: 1, apiUrl, space: r.space, project: r.project, version: r.version, etag: r.etag, fetchedAt: r.fetchedAt, files };
  if (rules) entry.rules = rules;
  return entry;
}

/** Reads the cache for a project. Any problem (missing, damaged, symlink, too big) → undefined. Never throws. */
export async function readCache(cacheDir: string, key: string): Promise<CacheEntry | undefined> {
  try {
    const raw = await readFileNoFollow(cacheFilePath(cacheDir, key));
    return raw === undefined ? undefined : parseCacheEntry(raw.toString("utf8"));
  } catch {
    return undefined;
  }
}

/** Saves the cache atomically, owner-only. Validates first, so we never save something we'd later reject. */
export async function writeCache(cacheDir: string, key: string, entry: CacheEntry): Promise<void> {
  const text = JSON.stringify(entry);
  if (parseCacheEntry(text) === undefined) throw new Error("Refusing to save an invalid cache entry");
  const dir = projectDataDir(cacheDir, key);
  await ensurePrivateDir(dir);
  await writeFileAtomic(cacheFilePath(cacheDir, key), text, 0o600);
}

/** Deletes the project's cache file (and its folder if then empty). Returns true if there was one. */
export async function deleteCache(cacheDir: string, key: string): Promise<boolean> {
  const removed = await removeFileIfExists(cacheFilePath(cacheDir, key));
  await removeDirIfEmpty(projectDataDir(cacheDir, key));
  return removed;
}
