import { createHash, randomBytes } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";

/**
 * Small, careful file helpers used everywhere in the CLI.
 *
 * Two ideas show up again and again:
 * - Atomic write: write to a temp file next to the target, then rename it over the target.
 *   A rename is all-or-nothing, so a crash or full disk never leaves a half-written file behind.
 * - No-follow: a symlink is a file that points somewhere else. If an attacker plants one where we
 *   expect a normal file, writing "through" it could overwrite something outside the project.
 *   So we look at the link itself (lstat / O_NOFOLLOW) and refuse instead of following it.
 *
 * Known limit (documented, not fixed): we check a path and then use it (check-then-write by path, a "TOCTOU"
 * race). Someone who could swap files in the gap must already be able to write inside the project, so they
 * gain little. We narrow the window (re-checks right before each change, O_NOFOLLOW, fstat on the open file).
 */

export const IS_WINDOWS = process.platform === "win32";

/** Thrown when a path is a symlink or not a normal file/folder where we need one. */
export class UnsafePathError extends Error {
  override name = "UnsafePathError";
}

/** The sha256 fingerprint of some text, as hex. Same content → same hash. */
export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** True if `child` is `parent` itself or somewhere inside it. Both must be absolute. */
export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** True if the error is "file not found". */
export function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

/**
 * The one size limit for reading any file into memory (rule files, manifest, cache, settings, ignore
 * files). A bigger file is refused instead of read, so a huge or endless file can't eat our memory.
 * Callers may pass a smaller limit for files that should be tiny (credentials, axiomic.json).
 */
export const MAX_READ_BYTES = 8 * 1024 * 1024;

/**
 * Reads a file WITHOUT following a symlink. Returns undefined if nothing is there.
 * Throws UnsafePathError for a symlink, a folder, a FIFO/socket/device, or anything that isn't a
 * normal file, and a plain Error if the file is bigger than `maxBytes`.
 */
export async function readFileNoFollow(file: string, maxBytes: number = MAX_READ_BYTES): Promise<Buffer | undefined> {
  return (await readFileNoFollowWithInfo(file, maxBytes))?.data;
}

/** Like readFileNoFollow, but also returns the permissions and owner of the file that was read. */
export async function readFileNoFollowWithInfo(
  file: string,
  maxBytes: number = MAX_READ_BYTES,
): Promise<{ data: Buffer; mode: number; uid: number } | undefined> {
  let handle: FileHandle;
  try {
    // Step 1, a cheap look at the path itself (lstat does not follow links). We do this BEFORE open() because
    // opening a FIFO (a "named pipe") for reading blocks forever until someone writes to it: a repo that
    // contains `mkfifo .claude/rules/axiomic.md` could freeze `status`, `remove` and even the session hook.
    const before = await fs.lstat(file);
    if (before.isSymbolicLink()) throw new UnsafePathError(`Refusing to read through a symlink: ${file}`);
    if (!before.isFile()) throw new UnsafePathError(`Not a normal file: ${file}`);
    // Step 2, open without waiting (O_NONBLOCK: a FIFO swapped in after the lstat opens instantly instead of
    // hanging) and without following a link (O_NOFOLLOW; Windows has neither flag, so there we rely on lstat).
    handle = await fs.open(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0));
  } catch (error) {
    if (isNotFound(error)) return undefined;
    if ((error as NodeJS.ErrnoException).code === "ELOOP") throw new UnsafePathError(`Refusing to read through a symlink: ${file}`);
    throw error;
  }
  try {
    // Step 3, fstat looks at the file we actually opened, so nothing can be swapped in between lstat and open.
    const info = await handle.stat();
    if (!info.isFile()) throw new UnsafePathError(`Not a normal file: ${file}`);
    if (info.size > maxBytes) throw new Error(`File is too large (${info.size} bytes, limit ${maxBytes}): ${file}`);
    return { data: await handle.readFile(), mode: info.mode, uid: info.uid };
  } finally {
    await handle.close();
  }
}

/**
 * True if something exists at `p` (following links, so a dangling symlink counts as missing).
 * The one "does it exist" helper; other errors (e.g. no permission) are not hidden.
 */
export async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw error;
  }
}

/**
 * Writes `data` to `target` atomically:
 * 1. create a temp file in the SAME folder (a rename only stays atomic within one disk/folder),
 *    with exclusive create (fails if anything, even a symlink, already sits at that name)
 *    and the final permissions set from the start, so there's never a moment it's readable by others;
 * 2. write, then fsync (force the bytes to disk);
 * 3. rename over the target. If anything fails, the temp file is deleted and the target is untouched.
 */
export async function writeFileAtomic(target: string, data: string | Buffer, mode: number): Promise<void> {
  const dir = path.dirname(target);
  const temp = path.join(dir, `.${path.basename(target)}.${randomBytes(8).toString("hex")}.tmp`);
  let handle: FileHandle | undefined;
  try {
    handle = await fs.open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, mode);
    // The umask can only REMOVE permission bits at create time; chmod sets exactly what we asked for
    // (e.g. keeps a .gitignore at 0644 when we rewrite it). Windows has no Unix modes.
    if (!IS_WINDOWS) await handle.chmod(mode);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await renameWithRetry(temp, target);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await fs.rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
  await syncDir(dir);
}

/**
 * On Windows a rename can fail for a moment if another program (often antivirus) has the file open.
 * We retry a few times there. On macOS/Linux a rename over a file always works if allowed at all.
 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!IS_WINDOWS || attempt >= 4 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
}

/** Makes the rename itself durable (POSIX). Windows can't open folders this way, so errors are ignored. */
async function syncDir(dir: string): Promise<void> {
  if (IS_WINDOWS) return;
  try {
    const handle = await fs.open(dir, constants.O_RDONLY);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Some file systems don't support it. The data itself was already synced.
  }
}

/**
 * Creates one of axiomic's own folders (config/cache/state) with owner-only permissions (0700),
 * and tightens it if it already exists with looser ones. Only used for folders axiomic owns.
 * (The folder may itself be a symlink, e.g. from a dotfiles manager; that's the user's choice in their home.)
 */
export async function ensurePrivateDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const info = await fs.stat(dir);
  if (!info.isDirectory()) throw new UnsafePathError(`Not a folder: ${dir}`);
  if (!IS_WINDOWS && (info.mode & 0o077) !== 0) await fs.chmod(dir, 0o700);
}

/** Deletes a file if it exists. Returns true if something was deleted. */
export async function removeFileIfExists(file: string): Promise<boolean> {
  try {
    await fs.unlink(file);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

/** Removes a folder only if it is empty. Never deletes contents. Returns true if it was removed. */
export async function removeDirIfEmpty(dir: string): Promise<boolean> {
  try {
    await fs.rmdir(dir); // rmdir fails on a non-empty folder, which is exactly what we want
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // ENOTDIR: it's a file or a symlink, not a real folder. Leave it alone.
    if (code === "ENOENT" || code === "ENOTEMPTY" || code === "EEXIST" || code === "ENOTDIR") return false;
    throw error;
  }
}
