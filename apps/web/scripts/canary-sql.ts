/**
 * Prints the SQL that adds the key canary row for the CURRENT rule key (DB-DESIGN U7).
 * The app can't write private.key_canary, so a person runs the printed SQL as the owner:
 *
 *   cd apps/web
 *   node --env-file=.env.local scripts/canary-sql.ts > /tmp/canary.sql
 *   npx supabase db query --remote -f /tmp/canary.sql      (from the repo root)
 *
 * The output holds only a nonce and ciphertext, never the key. Run it once per new key version.
 */
import { CANARY_TEXT, canaryAad, encryptText, parseKeyring } from "@axiomic/shared/crypto";

const ring = parseKeyring(process.env.AXIOMIC_RULE_KEYS, process.env.AXIOMIC_RULE_KEY_CURRENT);
const s = encryptText(ring, CANARY_TEXT, canaryAad);
console.log(
  `insert into private.key_canary (key_version, nonce, ciphertext) values ` +
    `(${s.keyVersion}, '\\x${s.nonce.toString("hex")}', '\\x${s.ciphertext.toString("hex")}') ` +
    `on conflict (key_version) do nothing;`,
);
