import { createHash } from "node:crypto";

/**
 * Pure helpers for CLI/agent Bearer tokens (no database, so they can be unit-tested).
 * A token is "axm_" + 32 random bytes in URL-safe base64 without padding (43 characters),
 * made by private.new_secret('axm_') in the database. Only its SHA-256 is stored.
 */
const TOKEN = /^axm_[A-Za-z0-9_-]{43}$/;

/** The token from an "Authorization: Bearer axm_…" header, or null if missing or malformed. */
export function parseBearer(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer[ ]+(\S+)$/i.exec(header.trim());
  if (!m) return null;
  const token = m[1]!;
  return TOKEN.test(token) ? token : null;
}

/** Same as private.hash_secret(): sha256 of the UTF-8 text. */
export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}
