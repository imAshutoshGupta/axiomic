import { promises as fs } from "node:fs";
import path from "node:path";
import { sha256 } from "./fs-safe";

/**
 * A short, safe folder name for one project inside axiomic's cache and state folders.
 *
 * Decision: we hash the project's REAL path on disk (symlinks resolved), not its org/project slugs.
 * - Two clones of the same project are two different folders with possibly different local edits,
 *   so they must not share a manifest. Slugs would mix them up.
 * - A hash is always a plain [0-9a-f] name: no "/", "..", or odd characters can reach the file system,
 *   and the path itself isn't readable from the folder name.
 * Downside: moving or renaming the project folder gives a new key. The old cache is then just unused,
 *   and the files axiomic wrote are treated as "not ours" (kept, never overwritten) until the next
 *   pull with --force. That errs on the safe side.
 *
 * On Windows, paths are not case-sensitive, so we lowercase them there to get one key per folder.
 */
export async function projectKey(projectRoot: string, platform: NodeJS.Platform = process.platform): Promise<string> {
  let real = await fs.realpath(projectRoot);
  if (platform === "win32") real = real.toLowerCase();
  return sha256(real).slice(0, 32);
}

/** <base>/projects/<key>: where one project's cache or state lives. */
export function projectDataDir(baseDir: string, key: string): string {
  if (!/^[0-9a-f]{32}$/.test(key)) throw new Error("Invalid project key");
  return path.join(baseDir, "projects", key);
}
