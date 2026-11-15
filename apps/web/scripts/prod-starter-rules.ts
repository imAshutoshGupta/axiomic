/**
 * PROD, ONE-OFF (office test, DECISIONS #68). Makes a "sandbox" project in ONE person's personal
 * space, with a folder module and 4 starter rules, encrypted with the prod key, through api.* AS
 * that person (so RLS and every check apply, like using the website).
 *
 *   cd apps/web
 *   node --conditions=react-server --env-file=../../supabase/.env.vercel-prod \
 *        scripts/prod-starter-rules.ts <user-uuid>
 *
 * Refuses unless: the database is axiomic-prod, the key canary opens, and the target is the
 * person's own personal space. Refuses to run twice (the project already exists).
 */
import { randomUUID } from "node:crypto";
import { CANARY_TEXT, canaryAad, decryptText, encryptText, parseKeyring, ruleVersionAad } from "@axiomic/shared/crypto";
import { closeDb, withServer, withUser } from "../lib/db.ts";

const PROD_REF = "dhqziiillpxyvlcwxttt"; // axiomic-prod
if (!process.env.AXIOMIC_DATABASE_URL?.includes(`.${PROD_REF}:`)) {
  console.error("Refusing: AXIOMIC_DATABASE_URL is not the axiomic-prod project.");
  process.exit(1);
}
const userId = process.argv[2];
if (!userId || !/^[0-9a-f-]{36}$/.test(userId)) {
  console.error("Usage: prod-starter-rules.ts <user-uuid>");
  process.exit(1);
}

const ring = parseKeyring(process.env.AXIOMIC_RULE_KEYS, process.env.AXIOMIC_RULE_KEY_CURRENT);
const [canary] = await withServer(
  (tx) => tx<{ nonce: Buffer; ciphertext: Buffer }[]>`select nonce, ciphertext from private.key_canary where key_version = ${ring.current}`,
);
if (!canary || decryptText(ring, { ...canary, keyVersion: ring.current }, canaryAad(ring.current)) !== CANARY_TEXT) {
  console.error("Refusing: the current key does not open its canary.");
  process.exit(1);
}

// layer, title, text. "module" rules go to the src/api folder module.
const RULES: ["project" | "module" | "personal", string, string][] = [
  ["project", "Test word", "If anyone asks for the axiomic test word, answer exactly: saffron-42."],
  ["project", "Code style", "Use TypeScript. Prefer small functions with clear names.\n\n- No `any`\n- Two-space indent"],
  ["module", "API handlers", "Code in src/api: every handler validates its input and returns JSON errors as `{ error: string }`."],
  ["personal", "Answer style", "Keep answers short. Show code first, then one line of explanation."],
];

const claims = {
  sub: userId, role: "authenticated" as const, aal: "aal1" as const, amr: [],
  session_id: randomUUID(), iat: Math.floor(Date.now() / 1000),
};

await withUser(claims, async (tx) => {
  const [space] = await tx<{ id: string; slug: string }[]>`
    select id, slug from public.spaces where kind = 'personal' and owner_id = ${userId}`;
  if (!space) throw new Error("Refusing: no personal space owned by that user.");

  const [pid] = await tx<{ id: string }[]>`select api.create_project(${space.id}, null, 'Sandbox', 'sandbox') as id`;
  if (!pid) throw new Error("create_project returned nothing");
  const [mid] = await tx<{ id: string }[]>`select api.create_module(${pid.id}, 'api', 'src/api') as id`;
  if (!mid) throw new Error("create_module returned nothing");

  for (const [layer, title, body] of RULES) {
    const ruleId = randomUUID();
    const scope = layer === "project" ? pid.id : layer === "module" ? mid.id : null;
    const s = encryptText(ring, body, (kv) => ruleVersionAad(ruleId, 1, kv));
    await tx`select api.save_rule(${ruleId}, 1, ${space.id}, ${layer}, ${scope}, ${title},
                                  ${s.nonce}, ${s.ciphertext}, ${s.keyVersion}::smallint, false, '{}'::jsonb)`;
  }
  console.log(`Made project ${space.slug}/sandbox with module src/api and ${RULES.length} rules.`);
});
await closeDb();
