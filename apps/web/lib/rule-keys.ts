import "server-only";
import { CANARY_TEXT, canaryAad, decryptText, parseKeyring, type Keyring } from "@axiomic/shared/crypto";
import { withServer } from "./db";

/**
 * The rule-encryption keys, and the start-up "key canary" check (DB-DESIGN 10, T1/U7).
 *
 * Losing or mixing up the key loses every rule. So before this server encrypts anything
 * new, it opens one known row (private.key_canary) with the current key. If that fails
 * (wrong key, missing row, database down), writes are refused: a wrong key must never
 * lock new text that nobody can read later. Reads are unaffected: a wrong key just fails
 * to decrypt.
 */

let ring: Keyring | undefined;

/** Parsed once per process from AXIOMIC_RULE_KEYS + AXIOMIC_RULE_KEY_CURRENT. Throws if misconfigured. */
export function keyring(): Keyring {
  ring ??= parseKeyring(process.env.AXIOMIC_RULE_KEYS, process.env.AXIOMIC_RULE_KEY_CURRENT);
  return ring;
}

let canary: Promise<boolean> | undefined;

/** True if the current key opens its canary row. Checked once per process; a failure is retried next call. */
export async function canaryOk(): Promise<boolean> {
  canary ??= checkCanary().then((ok) => {
    if (!ok) canary = undefined; // try again later (e.g. the database was briefly down)
    return ok;
  });
  return canary;
}

async function checkCanary(): Promise<boolean> {
  try {
    const r = keyring();
    const rows = await withServer(
      (tx) => tx<{ nonce: Buffer; ciphertext: Buffer }[]>`
        select nonce, ciphertext from private.key_canary where key_version = ${r.current}`,
    );
    const row = rows[0];
    if (!row) {
      console.error(`key canary: no row for key version ${r.current}; writes refused`);
      return false;
    }
    const text = decryptText(r, { nonce: row.nonce, ciphertext: row.ciphertext, keyVersion: r.current }, canaryAad(r.current));
    if (text !== CANARY_TEXT) throw new Error("canary text mismatch");
    return true;
  } catch (e) {
    console.error("key canary failed; writes refused:", e instanceof Error ? e.message : "unknown error");
    return false;
  }
}

/** Call before any write that encrypts rule text. */
export async function assertWritesAllowed(): Promise<void> {
  if (!(await canaryOk())) throw new Error("writes are paused: the rule key failed its start-up check");
}
