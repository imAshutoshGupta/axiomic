/**
 * DEV ONLY. The seed's rule text is placeholder bytes. This saves a new, really encrypted
 * version of each seed rule through api.save_rule (as the rule's author), so pull works.
 * Run after `npx supabase db reset --remote` and after the canary row exists:
 *
 *   cd apps/web
 *   node --conditions=react-server --env-file=.env.local scripts/dev-encrypt-seed.ts
 *
 * Refuses unless the database is axiomic-dev and the key canary opens. Safe to re-run
 * (each run adds one more version per rule).
 */
import { randomUUID } from "node:crypto";
import { CANARY_TEXT, canaryAad, decryptText, encryptText, parseKeyring, ruleVersionAad } from "@axiomic/shared/crypto";
import { closeDb, withServer, withUser } from "../lib/db.ts";

const DEV_REF = "mufkzfmwifxzeizssjdy"; // axiomic-dev
if (!process.env.AXIOMIC_DATABASE_URL?.includes(`.${DEV_REF}:`)) {
  console.error("Refusing: AXIOMIC_DATABASE_URL is not the axiomic-dev project.");
  process.exit(1);
}

const ASHA = "00000000-0000-4000-8000-00000000000a";
const BALA = "00000000-0000-4000-8000-00000000000b";
const XENA = "00000000-0000-4000-8000-00000000000f";

// rule id → [author who saves it, text]
const SEED: Record<string, [string, string]> = {
  "50000000-0000-4000-8000-000000000001": [ASHA, "Never commit secrets. Use the secret manager for API keys.\n\n- No keys in code\n- No keys in logs"],
  "50000000-0000-4000-8000-000000000002": [ASHA, "Use Prettier defaults. Prefer small functions with clear names."],
  "50000000-0000-4000-8000-000000000003": [BALA, "Every feature needs unit tests. Run `npm test` before you push."],
  "50000000-0000-4000-8000-000000000004": [ASHA, "Clear notebook outputs before committing."],
  "50000000-0000-4000-8000-000000000005": [BALA, "Web app: use Vitest and Testing Library. Test behaviour, not implementation."],
  "50000000-0000-4000-8000-000000000006": [BALA, "Amounts are integers in paise. Never use floats for money."],
  "50000000-0000-4000-8000-000000000007": [BALA, "I like short answers with code first."],
  "50000000-0000-4000-8000-000000000009": [XENA, "Hobby project: experiments welcome."],
  "50000000-0000-4000-8000-000000000010": [XENA, "Globex rule: must never appear in an Acme pull."],
};

const ring = parseKeyring(process.env.AXIOMIC_RULE_KEYS, process.env.AXIOMIC_RULE_KEY_CURRENT);

// Same check the server does before any write (rule-keys.ts): the current key must open its canary.
const [canary] = await withServer(
  (tx) => tx<{ nonce: Buffer; ciphertext: Buffer }[]>`select nonce, ciphertext from private.key_canary where key_version = ${ring.current}`,
);
if (!canary || decryptText(ring, { ...canary, keyVersion: ring.current }, canaryAad(ring.current)) !== CANARY_TEXT) {
  console.error("Refusing: no key canary for the current key (run scripts/canary-sql.ts first).");
  process.exit(1);
}

let saved = 0;
for (const [ruleId, [author, body]] of Object.entries(SEED)) {
  // Dev only: aal2 lets the seed's admins edit company rules (is_admin needs aal2 in work spaces).
  const claims = { sub: author, role: "authenticated" as const, aal: "aal2" as const, amr: [], session_id: randomUUID(), iat: Math.floor(Date.now() / 1000) };
  await withUser(claims, async (tx) => {
    const [r] = await tx<{ title: string; layer: string; space_id: string; scope: string | null; locked: boolean; deleted_at: Date | null; newest: number }[]>`
      select r.title, r.layer, r.space_id, coalesce(r.team_id, r.project_id, r.module_id) as scope, r.locked, r.deleted_at,
             (select coalesce(max(version), 0) from public.rule_versions where rule_id = r.id)::int as newest
      from public.rules r where r.id = ${ruleId}`;
    if (!r) throw new Error(`rule ${ruleId} not visible to its author`);
    if (r.deleted_at) return;
    const version = r.newest + 1;
    const s = encryptText(ring, body, (kv) => ruleVersionAad(ruleId, version, kv));
    await tx`select api.save_rule(${ruleId}, ${version}, ${r.space_id}, ${r.layer}, ${r.scope}, ${r.title},
                                  ${s.nonce}, ${s.ciphertext}, ${s.keyVersion}::smallint, ${r.locked}, '{}'::jsonb)`;
    saved++;
  });
}
console.log(`Encrypted ${saved} seed rules.`);
await closeDb();
