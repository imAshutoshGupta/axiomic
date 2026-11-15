import { apiError, fail, ok, requireToken } from "../../../../lib/api";
import { withUser } from "../../../../lib/db";
import { loadProject } from "../../../../lib/pull";
import { applyChange, parsePushBody, type ChangeResult } from "../../../../lib/push";
import { assertWritesAllowed, keyring } from "../../../../lib/rule-keys";

/**
 * POST /api/v1/push   (Bearer token, CLI logins only)
 * body: { space, project, changes: [{ kind: "update", ruleId, baseVersion, title, body }
 *                                   | { kind: "create", layer, module?, title, body }] }   (at most 20)
 *
 * 200 { results: [{ status: "saved" | "suggested" | "conflict" | "refused", … }] }, one per change, same order.
 * 400 bad body · 401 no/invalid token · 403 agent key · 404 project · 409 archived · 413 too big
 * 429 too many · 503 writes paused (key check failed) or server trouble.
 *
 * Each change gets its own transaction, so one refusal never undoes another change (#64).
 */
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2 * 1024 * 1024; // 20 changes × 64 KiB of text, with room for JSON escaping

export async function POST(request: Request): Promise<Response> {
  try {
    const auth = await requireToken(request);
    if (auth instanceof Response) return auth;
    if (auth.claims.axm_kind !== "cli") return fail(403, "agent keys are read-only");

    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return fail(413, "push too large");
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return fail(400, "body must be JSON");
    }
    const parsed = parsePushBody(json);
    if (typeof parsed === "string") return fail(400, parsed);

    try {
      await assertWritesAllowed();
    } catch {
      return fail(503, "saving is paused on the server; try again later");
    }

    const ring = keyring();
    const load = await withUser(auth.claims, (tx) => loadProject(tx, ring, parsed.ref), { snapshot: true });
    if (!load.ok) return fail(load.status, load.error);

    const results: ChangeResult[] = [];
    for (const change of parsed.changes) {
      results.push(await withUser(auth.claims, (tx) => applyChange(tx, ring, load.loaded, change)));
    }
    return ok({ results });
  } catch (e) {
    return apiError("push", e);
  }
}
