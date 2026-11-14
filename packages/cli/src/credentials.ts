import { promises as fs } from "node:fs";
import path from "node:path";
import { normalizeApiUrl } from "./api-url";
import {
  IS_WINDOWS,
  UnsafePathError,
  ensurePrivateDir,
  isNotFound,
  readFileNoFollowWithInfo,
  removeFileIfExists,
  writeFileAtomic,
} from "./fs-safe";

/**
 * The login token, stored in <config>/credentials.json. Read, write and delete only:
 * there is no login flow in this build.
 *
 * PROVISIONAL: the exact shape may change when login (step 6b) is designed.
 *
 * Protection:
 * - macOS/Linux: the folder is 0700 and the file 0600 (only your user can read them),
 *   set at creation so there's never a moment the token is readable by others.
 * - Windows: there are no Unix permissions. We rely on %APPDATA% being inside your user profile,
 *   which Windows already restricts to your account (and admins) by default.
 *
 * The token is NEVER printed. Error messages only mention the file path.
 */
export interface Credentials {
  schemaVersion: 1;
  /** The secret token. Sent only in the Authorization: Bearer header (later). */
  token: string;
  /** The server the token was issued by. A token is only ever sent back to this server. */
  apiUrl: string;
}

const FILE_NAME = "credentials.json";
const MAX_BYTES = 64 * 1024;

export function credentialsPath(configDir: string): string {
  return path.join(configDir, FILE_NAME);
}

/** Thrown when the credentials file exists but must not be used. The message never contains the token. */
export class CredentialsError extends Error {
  override name = "CredentialsError";
}

/**
 * Reads the saved credentials, or undefined if there are none.
 *
 * Decision: if the file is readable by other users, we REFUSE to use it (like ssh does with private keys)
 * rather than just warn. A warning in a silent hook would never be seen, and refusing makes the problem
 * impossible to ignore. The error tells the user how to fix it.
 */
export async function readCredentials(configDir: string): Promise<Credentials | undefined> {
  const file = credentialsPath(configDir);

  let read: Awaited<ReturnType<typeof readFileNoFollowWithInfo>>;
  try {
    read = await readFileNoFollowWithInfo(file, MAX_BYTES);
  } catch (error) {
    if (error instanceof UnsafePathError) throw new CredentialsError(`${file} is a symlink or not a normal file. Delete it and log in again.`);
    throw error;
  }
  if (read === undefined) return undefined;

  // The permissions come from the file we actually opened (fstat), so they can't be swapped in between.
  if (!IS_WINDOWS) {
    const info = read;
    if ((info.mode & 0o077) !== 0) {
      throw new CredentialsError(
        `${file} can be read by other users (permissions ${(info.mode & 0o777).toString(8)}). ` +
          `Run: chmod 600 "${file}" — and consider logging in again, since the token may have been exposed.`,
      );
    }
    if (typeof process.getuid === "function" && info.uid !== process.getuid()) {
      throw new CredentialsError(`${file} belongs to another user. Delete it and log in again.`);
    }
  }

  return parseCredentials(read.data.toString("utf8"), file);
}

/** Checks the file's content strictly. Unknown or missing fields → error (without echoing the content). */
export function parseCredentials(text: string, file = FILE_NAME): Credentials {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new CredentialsError(`${file} is not valid JSON. Delete it and log in again.`);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new CredentialsError(`${file} has an unexpected format. Delete it and log in again.`);
  }
  const record = data as Record<string, unknown>;
  const keys = Object.keys(record).sort().join(",");
  if (keys !== "apiUrl,schemaVersion,token" || record.schemaVersion !== 1) {
    throw new CredentialsError(`${file} has an unexpected format. Delete it and log in again.`);
  }
  const { token, apiUrl } = record;
  // A token is printable ASCII with no spaces: anything else could break or inject into an HTTP header.
  if (typeof token !== "string" || !/^[\x21-\x7e]{1,4096}$/.test(token)) {
    throw new CredentialsError(`${file} contains an invalid token. Delete it and log in again.`);
  }
  if (typeof apiUrl !== "string") throw new CredentialsError(`${file} has an unexpected format. Delete it and log in again.`);
  try {
    return { schemaVersion: 1, token, apiUrl: normalizeApiUrl(apiUrl) };
  } catch {
    throw new CredentialsError(`${file} contains an invalid server URL. Delete it and log in again.`);
  }
}

/** Saves credentials with owner-only permissions. Validates first, so we never store something we can't read back. */
export async function writeCredentials(configDir: string, credentials: Credentials): Promise<void> {
  const checked = parseCredentials(JSON.stringify(credentials));
  await ensurePrivateDir(configDir);
  await writeFileAtomic(credentialsPath(configDir), JSON.stringify(checked, null, 2) + "\n", 0o600);
}

/**
 * Deletes the credentials file. Returns true if there was one.
 * (If it's a symlink, unlink removes only the link, never what it points to.)
 */
export async function deleteCredentials(configDir: string): Promise<boolean> {
  return removeFileIfExists(credentialsPath(configDir));
}

/** True if a credentials file exists (without reading or checking it). */
export async function hasCredentialsFile(configDir: string): Promise<boolean> {
  try {
    await fs.lstat(credentialsPath(configDir));
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}
