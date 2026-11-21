import { promises as fs } from "node:fs";
import path from "node:path";
import { isValidSlug } from "@axiomic/shared";
import { isNotFound, readFileNoFollow, writeFileAtomic } from "../utils/fs-safe";

/**
 * axiomic.json: a small file in the project root, committed to Git, that links the repo to an axiomic project.
 * It holds slugs only (no secrets), so a teammate's `axiomic init` needs no questions.
 *
 * Slugs, not ids: they are readable in Git and can never change (database trigger), so they never go stale.
 * (DECISIONS #56.)
 *
 * Example:
 *   { "schemaVersion": 1, "space": "acme", "project": "web-app" }
 */
export interface ProjectConfig {
  schemaVersion: 1;
  /** The space slug (a company's work space, or your personal space). Never changes (the database forbids it). */
  space: string;
  /** The project slug inside that space. */
  project: string;
}

export const PROJECT_CONFIG_FILE = "axiomic.json";
const MAX_BYTES = 16 * 1024;

/** A slug, e.g. "web-app". The ONE definition lives in @axiomic/shared and matches the database check. */
export { isValidSlug };

/**
 * Checks axiomic.json's content strictly: exactly the known fields, valid slugs, known schemaVersion.
 * Unknown fields are an error rather than ignored, so a typo ("projcet") is caught, and nothing we
 * don't understand gets passed along. (A "__proto__" key from JSON.parse is just an unknown field here.)
 */
export function parseProjectConfig(text: string): ProjectConfig {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`${PROJECT_CONFIG_FILE} is not valid JSON: ${(error as Error).message}`);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error(`${PROJECT_CONFIG_FILE} must contain a JSON object`);
  }
  const record = data as Record<string, unknown>;

  const unknown = Object.keys(record).filter((key) => !["schemaVersion", "space", "project"].includes(key));
  if (unknown.length > 0) throw new Error(`${PROJECT_CONFIG_FILE} has unknown fields: ${unknown.map((k) => JSON.stringify(k)).join(", ")}`);

  if (record.schemaVersion !== 1) {
    throw new Error(`${PROJECT_CONFIG_FILE} has schemaVersion ${JSON.stringify(record.schemaVersion)}; this axiomic understands 1. Try updating axiomic.`);
  }
  if (!isValidSlug(record.space)) throw new Error(`${PROJECT_CONFIG_FILE}: "space" must be a slug like "acme"`);
  if (!isValidSlug(record.project)) throw new Error(`${PROJECT_CONFIG_FILE}: "project" must be a slug like "web-app"`);

  return { schemaVersion: 1, space: record.space, project: record.project };
}

/** Reads <projectRoot>/axiomic.json. Returns undefined if it doesn't exist; throws if it's invalid or a symlink. */
export async function readProjectConfig(projectRoot: string): Promise<ProjectConfig | undefined> {
  const raw = await readFileNoFollow(path.join(projectRoot, PROJECT_CONFIG_FILE), MAX_BYTES);
  return raw === undefined ? undefined : parseProjectConfig(raw.toString("utf8"));
}

/** Writes axiomic.json (validated first). 0644: it's committed and contains nothing secret. */
export async function writeProjectConfig(projectRoot: string, config: ProjectConfig): Promise<void> {
  const checked = parseProjectConfig(JSON.stringify(config));
  await writeFileAtomic(path.join(projectRoot, PROJECT_CONFIG_FILE), JSON.stringify(checked, null, 2) + "\n", 0o644);
}

/**
 * Finds the project root: the nearest folder, starting at `start` and walking up, that contains axiomic.json.
 * Returns undefined if there is none all the way up to the top of the disk.
 * Only a real file counts (not a folder named axiomic.json).
 */
export async function findProjectRoot(start: string): Promise<string | undefined> {
  let dir = path.resolve(start);
  for (;;) {
    try {
      const info = await fs.lstat(path.join(dir, PROJECT_CONFIG_FILE));
      if (info.isFile()) return dir;
    } catch (error) {
      if (!isNotFound(error) && (error as NodeJS.ErrnoException).code !== "ENOTDIR") throw error;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined; // reached the top (/ or C:\)
    dir = parent;
  }
}
