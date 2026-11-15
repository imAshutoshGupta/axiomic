/**
 * Rule-text encryption (DB-DESIGN section 10). Server only: the CLI never sees ciphertext.
 * Imported as "@axiomic/shared/crypto" (not from the main index) so browser code never
 * pulls in node:crypto by accident.
 *
 * AES-256-GCM, a fresh random 12-byte nonce per encryption. The stored ciphertext is
 * encrypted bytes followed by the 16-byte GCM tag. AAD ("additional authenticated data")
 * names the row the text belongs to, so a ciphertext copied into another row fails to open.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/** All key versions we can decrypt with, and the one new text is encrypted with. */
export interface Keyring {
  current: number;
  keys: ReadonlyMap<number, Buffer>;
}

export interface Sealed {
  nonce: Buffer;
  ciphertext: Buffer;
  keyVersion: number;
}

/**
 * Reads AXIOMIC_RULE_KEYS ('{"1":"<base64 of 32 bytes>", ...}') and AXIOMIC_RULE_KEY_CURRENT.
 * Throws with a message that never contains key material.
 */
export function parseKeyring(keysJson: string | undefined, current: string | undefined): Keyring {
  if (!keysJson) throw new Error("AXIOMIC_RULE_KEYS is not set");
  let raw: unknown;
  try {
    raw = JSON.parse(keysJson);
  } catch {
    throw new Error("AXIOMIC_RULE_KEYS is not valid JSON");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error('AXIOMIC_RULE_KEYS must be an object like {"1": "<base64>"}');
  }
  const keys = new Map<number, Buffer>();
  for (const [name, value] of Object.entries(raw)) {
    const version = Number(name);
    if (!isKeyVersion(version) || String(version) !== name) throw new Error(`bad key version "${name}"`);
    if (typeof value !== "string") throw new Error(`key ${version} must be a base64 string`);
    const key = Buffer.from(value, "base64");
    if (key.length !== KEY_BYTES || key.toString("base64") !== value) {
      throw new Error(`key ${version} must be exactly 32 bytes, base64`);
    }
    keys.set(version, key);
  }
  const cur = Number(current);
  if (!isKeyVersion(cur) || String(cur) !== current) throw new Error("AXIOMIC_RULE_KEY_CURRENT is not set or not a number");
  if (!keys.has(cur)) throw new Error(`AXIOMIC_RULE_KEY_CURRENT=${cur} has no key in AXIOMIC_RULE_KEYS`);
  return { current: cur, keys };
}

/** key_version is a smallint > 0 in the database. */
function isKeyVersion(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 32767;
}

/** AAD for one version of a rule: rule_versions:<rule_id>:<version>:<key_version>. */
export function ruleVersionAad(ruleId: string, version: number, keyVersion: number): string {
  return `rule_versions:${ruleId}:${version}:${keyVersion}`;
}

/** AAD for a suggestion's text: suggestions:<suggestion_id>:<key_version>. */
export function suggestionAad(suggestionId: string, keyVersion: number): string {
  return `suggestions:${suggestionId}:${keyVersion}`;
}

/** AAD and known text for the key canary row (DB-DESIGN U7). */
export function canaryAad(keyVersion: number): string {
  return `key_canary:${keyVersion}`;
}
export const CANARY_TEXT = "axiomic key canary";

/** Encrypts with the current key. `aadFor` gets the key version, because it is part of the AAD. */
export function encryptText(ring: Keyring, plaintext: string, aadFor: (keyVersion: number) => string): Sealed {
  const keyVersion = ring.current;
  const key = ring.keys.get(keyVersion)!;
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(aadFor(keyVersion), "utf8"));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { nonce, ciphertext: Buffer.concat([body, cipher.getAuthTag()]), keyVersion };
}

/** Opens one ciphertext. Throws if the key, nonce, AAD or bytes don't match (never returns garbage). */
export function decryptText(ring: Keyring, sealed: Sealed, aad: string): string {
  const key = ring.keys.get(sealed.keyVersion);
  if (!key) throw new Error(`no key for key version ${sealed.keyVersion}`);
  if (sealed.nonce.length !== NONCE_BYTES) throw new Error("bad nonce length");
  if (sealed.ciphertext.length < TAG_BYTES) throw new Error("ciphertext too short");
  const body = sealed.ciphertext.subarray(0, sealed.ciphertext.length - TAG_BYTES);
  const tag = sealed.ciphertext.subarray(sealed.ciphertext.length - TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, sealed.nonce, { authTagLength: TAG_BYTES });
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("decryption failed (wrong key, or the text was changed or moved)");
  }
}
