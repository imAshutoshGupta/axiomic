/**
 * Live tests for POST /api/v1/push (DECISIONS #64) against axiomic-dev. Skipped without
 * AXIOMIC_DATABASE_URL. Leaves the seed's text as it was: a "saved" test re-saves the same
 * text as a new version; suggestions are withdrawn and new personal rules trashed at the end.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as pull } from "../app/api/v1/pull/route";
import { POST as push } from "../app/api/v1/push/route";
import { closeDb, withUser, type BrowserClaims } from "./db";
import { parsePushBody } from "./push";

const live = !!process.env.AXIOMIC_DATABASE_URL?.includes(".mufkzfmwifxzeizssjdy:");

const BALA = "00000000-0000-4000-8000-00000000000b";
const RAVI = "00000000-0000-4000-8000-00000000000e";
const WEB_APP = "30000000-0000-4000-8000-000000000001";
const SECURITY = "50000000-0000-4000-8000-000000000001"; // company, locked
const PROJECT_TESTING = "50000000-0000-4000-8000-000000000005"; // web-app project rule, owner Bala
const VITEST = "Web app: use Vitest and Testing Library. Test behaviour, not implementation.";

const browser = (sub: string): BrowserClaims => ({
  sub, role: "authenticated", aal: "aal1", amr: [], session_id: randomUUID(), iat: Math.floor(Date.now() / 1000),
});

const cleanup: (() => Promise<unknown>)[] = [];
async function token(owner: string, kind: "cli" | "agent" = "cli"): Promise<string> {
  const [row] = await withUser(browser(owner), (tx) => tx<{ r: { token: string; token_id: string } }[]>`
    select api.issue_token(${kind}, ${kind === "agent" ? WEB_APP : null}, 'vitest push') as r`);
  cleanup.push(() => withUser(browser(owner), (tx) => tx`select api.revoke_token(${row!.r.token_id})`));
  return row!.r.token;
}

type Index = { id: string; version: number; layer: string; title: string }[];
async function index(t: string): Promise<Index> {
  const res = await pull(new Request("http://localhost/api/v1/pull?space=acme&project=web-app", { headers: { authorization: `Bearer ${t}` } }));
  return ((await res.json()) as { rules: Index }).rules;
}
type Result = { status: string; reason?: string; suggestionId?: string; ruleId?: string; version?: number };
async function send(t: string, changes: unknown[], ref = { space: "acme", project: "web-app" }) {
  const res = await push(new Request("http://localhost/api/v1/push", {
    method: "POST", headers: { authorization: `Bearer ${t}` }, body: JSON.stringify({ ...ref, changes }),
  }));
  return { status: res.status, body: (await res.json()) as { results: Result[]; error?: string } };
}

describe("parsePushBody", () => {
  it("accepts updates and creates, and cleans up titles", () => {
    const r = parsePushBody({ space: "acme", project: "web-app", changes: [
      { kind: "update", ruleId: PROJECT_TESTING, baseVersion: 2, title: "  Testing\n", body: "x" },
      { kind: "create", layer: "module", module: "payments", title: "New", body: "y" },
    ] });
    expect(r).toMatchObject({ changes: [{ kind: "update", title: "Testing" }, { kind: "create", layer: "module", module: "payments" }] });
  });
  it.each([
    ["no changes", { space: "acme", project: "web-app", changes: [] }],
    ["too many", { space: "acme", project: "web-app", changes: Array(21).fill({ kind: "create", layer: "personal", title: "a", body: "b" }) }],
    ["a bad slug", { space: "Acme", project: "web-app", changes: [{ kind: "create", layer: "personal", title: "a", body: "b" }] }],
    ["an unknown layer", { space: "acme", project: "web-app", changes: [{ kind: "create", layer: "galaxy", title: "a", body: "b" }] }],
    ["an empty title", { space: "acme", project: "web-app", changes: [{ kind: "create", layer: "personal", title: "  ", body: "b" }] }],
    ["a bad rule id", { space: "acme", project: "web-app", changes: [{ kind: "update", ruleId: "x", baseVersion: 1, title: "a", body: "b" }] }],
  ])("refuses %s", (_label, body) => {
    expect(typeof parsePushBody(body)).toBe("string");
  });
});

describe.skipIf(!live)("POST /api/v1/push (live, axiomic-dev)", () => {
  let bala = "";
  let ravi = "";

  beforeAll(async () => {
    bala = await token(BALA);
    ravi = await token(RAVI);
  });

  afterAll(async () => {
    for (const c of cleanup.reverse()) await c().catch(() => {});
    await closeDb();
  });

  it("the pull answer now has an index of rules (id, layer, version) in file order", async () => {
    const rules = await index(ravi);
    expect(rules[0]).toMatchObject({ id: SECURITY, layer: "company" });
    expect(rules.find((r) => r.id === PROJECT_TESTING)).toMatchObject({ layer: "project", title: "Testing" });
  });

  it("the layer owner's edit is saved as a new version", async () => {
    const base = (await index(bala)).find((r) => r.id === PROJECT_TESTING)!.version;
    const { status, body } = await send(bala, [{ kind: "update", ruleId: PROJECT_TESTING, baseVersion: base, title: "Testing", body: VITEST }]);
    expect(status).toBe(200);
    expect(body.results).toEqual([{ status: "saved", ruleId: PROJECT_TESTING, version: base + 1 }]);
    expect((await index(bala)).find((r) => r.id === PROJECT_TESTING)!.version).toBe(base + 1);
  });

  it("a reader's edit becomes a suggestion", async () => {
    const base = (await index(ravi)).find((r) => r.id === PROJECT_TESTING)!.version;
    const { body } = await send(ravi, [{ kind: "update", ruleId: PROJECT_TESTING, baseVersion: base, title: "Testing", body: VITEST + " Ravi's idea." }]);
    expect(body.results[0]!.status).toBe("suggested");
    const id = body.results[0]!.suggestionId!;
    cleanup.push(() => withUser(browser(RAVI), (tx) => tx`select api.withdraw_suggestion(${id})`));
    // The same suggestion twice: the database refuses the duplicate.
    const again = await send(ravi, [{ kind: "update", ruleId: PROJECT_TESTING, baseVersion: base, title: "Testing", body: VITEST + " Again." }]);
    expect(again.body.results[0]).toMatchObject({ status: "refused", reason: expect.stringContaining("already have a pending suggestion") });
  });

  it("a stale base version is a conflict, nothing saved", async () => {
    const base = (await index(bala)).find((r) => r.id === PROJECT_TESTING)!.version;
    const { body } = await send(bala, [{ kind: "update", ruleId: PROJECT_TESTING, baseVersion: base - 1, title: "Testing", body: VITEST }]);
    expect(body.results[0]!.status).toBe("conflict");
    expect((await index(bala)).find((r) => r.id === PROJECT_TESTING)!.version).toBe(base);
  });

  it("a locked rule is refused", async () => {
    const base = (await index(ravi)).find((r) => r.id === SECURITY)!.version;
    const { body } = await send(ravi, [{ kind: "update", ruleId: SECURITY, baseVersion: base, title: "Security", body: "Commit anything." }]);
    expect(body.results[0]).toMatchObject({ status: "refused", reason: expect.stringContaining("locked") });
  });

  it("a secret is refused by the safety check before anything is stored", async () => {
    const { body } = await send(ravi, [{ kind: "create", layer: "personal", title: "Keys", body: "token ghp_" + "a1B2c3D4e5".repeat(4) }]);
    expect(body.results[0]).toMatchObject({ status: "refused", reason: expect.stringContaining("safety check") });
  });

  it("a new personal rule is saved directly (it's yours), and each change is independent", async () => {
    const title = `Vitest personal ${randomUUID().slice(0, 8)}`;
    const { body } = await send(ravi, [
      { kind: "create", layer: "personal", title, body: "Explain in short steps." },
      { kind: "update", ruleId: SECURITY, baseVersion: 1, title: "Security", body: "x" }, // refused or conflict: must not undo the first
    ]);
    expect(body.results[0]!.status).toBe("saved");
    expect(body.results[1]!.status).not.toBe("saved");
    const id = body.results[0]!.ruleId!;
    cleanup.push(() => withUser(browser(RAVI), (tx) => tx`select api.trash_rule(${id})`));
    expect((await index(ravi)).find((r) => r.id === id)).toMatchObject({ layer: "personal", title });
  });

  it("agent keys are read-only (403); no token is 401; bad body is 400", async () => {
    const agent = await token(BALA, "agent");
    expect((await send(agent, [{ kind: "create", layer: "personal", title: "a", body: "b" }])).status).toBe(403);
    const noToken = await push(new Request("http://localhost/api/v1/push", { method: "POST", body: "{}" }));
    expect(noToken.status).toBe(401);
    expect((await send(ravi, [])).status).toBe(400);
  });
});
