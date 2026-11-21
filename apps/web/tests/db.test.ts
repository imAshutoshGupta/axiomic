/**
 * Live tests against the axiomic-dev database (skipped when AXIOMIC_DATABASE_URL is not set).
 * Needs: seed loaded, canary row, scripts/dev-encrypt-seed.ts run once (see DECISIONS #49).
 * Creates a few tokens and revokes them at the end; nothing else is changed.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as pull } from "@/app/api/v1/pull/route";
import { closeDb, pgCode, withServer, withUser, type BrowserClaims, type DbClaims } from "@/lib/db";
import { canaryOk } from "@/lib/rules/rule-keys";
import { authenticateBearer } from "@/lib/api/bearer-auth";

const claimsFromBearer = async (h: string | null) => (await authenticateBearer(h))?.claims ?? null;

const live = !!process.env.AXIOMIC_DATABASE_URL?.includes(".mufkzfmwifxzeizssjdy:");

const ASHA = "00000000-0000-4000-8000-00000000000a";
const BALA = "00000000-0000-4000-8000-00000000000b";
const RAVI = "00000000-0000-4000-8000-00000000000e";
const XENA = "00000000-0000-4000-8000-00000000000f";
const ACME = "10000000-0000-4000-8000-000000000001";
const WEB_APP = "30000000-0000-4000-8000-000000000001";
const API = "30000000-0000-4000-8000-000000000002";

const browser = (sub: string, aal: "aal1" | "aal2" = "aal1"): BrowserClaims => ({
  sub, role: "authenticated", aal, amr: [], session_id: randomUUID(), iat: Math.floor(Date.now() / 1000),
});

const issued: { owner: string; id: string }[] = [];
async function issue(owner: string, kind: "cli" | "agent", project: string | null): Promise<string> {
  const [row] = await withUser(browser(owner), (tx) => tx<{ r: { token: string; token_id: string } }[]>`
    select api.issue_token(${kind}, ${project}, ${"vitest " + kind}) as r`);
  issued.push({ owner, id: row!.r.token_id });
  return row!.r.token;
}

/** Pull by slugs: "acme/web-app". */
function get(ref: string, token?: string): Promise<Response> {
  const [space, project] = ref.split("/");
  const headers: Record<string, string> = { "x-axiomic-cli-version": "0.0.0-test" };
  if (token) headers.authorization = `Bearer ${token}`;
  const query = project === undefined ? `space=${space}` : `space=${space}&project=${project}`;
  return pull(new Request(`http://localhost/api/v1/pull?${query}`, { headers }));
}

const WEB = "acme/web-app";

type Body = { files: { path: string; content: string }[]; versions: Record<string, number>; blocked: unknown[] };

describe.skipIf(!live)("database (live, axiomic-dev)", () => {
  let raviCli = "";
  let balaCli = "";
  let balaAgent = "";

  beforeAll(async () => {
    raviCli = await issue(RAVI, "cli", null);
    balaCli = await issue(BALA, "cli", null);
    balaAgent = await issue(BALA, "agent", WEB_APP);
  });

  afterAll(async () => {
    for (const t of issued) {
      await withUser(browser(t.owner), (tx) => tx`select api.revoke_token(${t.id})`).catch(() => {});
    }
    await closeDb();
  });

  describe("withUser / withServer", () => {
    it("refuses without a valid user", async () => {
      await expect(withUser(null as unknown as DbClaims, async () => 1)).rejects.toThrow(/refused/);
      await expect(withUser({ ...browser(BALA), sub: "not-a-uuid" }, async () => 1)).rejects.toThrow(/refused/);
    });
    it("the bare server login can read no tables (S1)", async () => {
      const e = await withServer((tx) => tx`select 1 from public.rules limit 1`).catch((x) => x);
      expect(pgCode(e)).toBe("42501");
    });
    it("role and claims don't leak to the next transaction", async () => {
      await withUser(browser(BALA), (tx) => tx`select 1 from public.rules limit 1`);
      const e = await withServer((tx) => tx`select 1 from public.rules limit 1`).catch((x) => x);
      expect(pgCode(e)).toBe("42501");
      const [c] = await withServer((tx) => tx<{ c: string | null }[]>`select current_setting('request.jwt.claims', true) as c`);
      expect(c!.c || null).toBeNull();
    });
    it("RLS: a member sees their company's rules, an outsider none", async () => {
      const count = (sub: string) =>
        withUser(browser(sub), (tx) => tx<{ n: number }[]>`select count(*)::int as n from public.rules where space_id = ${ACME}`);
      expect((await count(BALA))[0]!.n).toBeGreaterThan(0);
      expect((await count(XENA))[0]!.n).toBe(0);
    });
    it("a database error rolls the transaction back", async () => {
      const e = await withUser(browser(BALA), async (tx) => {
        await tx`select 1/0`;
      }).catch((x) => x);
      expect(pgCode(e)).toBe("22012");
    });
  });

  describe("key canary", () => {
    it("the current key opens its canary row", async () => {
      expect(await canaryOk()).toBe(true);
    });
  });

  describe("Bearer tokens", () => {
    it("a CLI token resolves to its owner", async () => {
      expect(await claimsFromBearer(`Bearer ${raviCli}`)).toEqual({ sub: RAVI, role: "authenticated", axm_kind: "cli" });
    });
    it("an agent key carries its project", async () => {
      expect(await claimsFromBearer(`Bearer ${balaAgent}`)).toMatchObject({ sub: BALA, axm_kind: "agent", axm_project_id: WEB_APP });
    });
    it("unknown, malformed and missing tokens resolve to nothing", async () => {
      expect(await claimsFromBearer(`Bearer axm_${"A".repeat(43)}`)).toBeNull();
      expect(await claimsFromBearer("Bearer nope")).toBeNull();
      expect(await claimsFromBearer(null)).toBeNull();
    });
    it("a CLI token cannot mint tokens (website only)", async () => {
      const claims = (await claimsFromBearer(`Bearer ${raviCli}`))!;
      const e = await withUser(claims, (tx) => tx`select api.issue_token('cli', null, 'x')`).catch((x) => x);
      expect(pgCode(e)).toBe("42501");
    });
  });

  describe("GET /api/v1/pull", () => {
    it("401 without a token, 400 with bad slugs", async () => {
      expect((await get(WEB)).status).toBe(401);
      expect((await get("acme/Bad..Slug", raviCli)).status).toBe(400);
      expect((await get("acme", raviCli)).status).toBe(400); // no project
    });
    it("a reader gets the combined rules for web-app", async () => {
      const res = await get(WEB, raviCli);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const body = (await res.json()) as Body;
      const main = body.files.find((f) => f.path === ".claude/rules/axiomic.md")!.content;
      expect(main).toContain("### MANDATORY: Security");
      expect(main).toContain("Never commit secrets");
      expect(main).toContain("Web app: use Vitest"); // project "Testing" replaces team "Testing"
      expect(main).not.toContain("Every feature needs unit tests");
      expect(main).not.toContain("Notebooks"); // other team
      expect(main).not.toContain("I like short answers"); // Bala's personal rule
      expect(main).not.toContain("Globex");
      const mod = body.files.find((f) => f.path === ".claude/rules/axiomic-payments.md")!.content;
      expect(mod).toContain("paise");
    });
    it("the author gets their own personal rule; an admin never gets others'", async () => {
      const bala = (await (await get(WEB, balaCli)).json()) as Body;
      expect(bala.files[0]!.content).toContain("I like short answers");
      const asha = await issue(ASHA, "cli", null);
      const ashaBody = (await (await get(WEB, asha)).json()) as Body;
      expect(ashaBody.files[0]!.content).not.toContain("I like short answers");
    });
    it("an outsider gets 404 (same as a project that doesn't exist)", async () => {
      const xena = await issue(XENA, "cli", null);
      expect((await get(WEB, xena)).status).toBe(404);
      expect((await get("acme/no-such-project", xena)).status).toBe(404);
      expect((await get("globex/web-app", raviCli)).status).toBe(404); // right slug, wrong space
    });
    it("an agent key reads only its project, with no personal rules", async () => {
      const res = await get(WEB, balaAgent);
      expect(res.status).toBe(200);
      expect(((await res.json()) as Body).files[0]!.content).not.toContain("I like short answers");
      expect((await get("acme/api", balaAgent)).status).toBe(404);
    });
    it("records the pull for a CLI token, not for an agent key (S5)", async () => {
      const read = () =>
        withUser(browser(BALA), (tx) => tx<{ last_pull_at: Date; cli_version: string }[]>`
          select last_pull_at, cli_version from public.client_status where project_id = ${WEB_APP} and user_id = ${BALA}`);
      await get(WEB, balaCli);
      const [before] = await read();
      expect(before!.cli_version).toBe("0.0.0-test");
      await get(WEB, balaAgent);
      const [after] = await read();
      expect(after!.last_pull_at.getTime()).toBe(before!.last_pull_at.getTime());
    });
    it("a revoked token gets 401", async () => {
      const t = await issue(RAVI, "cli", null);
      const id = issued.at(-1)!.id;
      await withUser(browser(RAVI), (tx) => tx`select api.revoke_token(${id})`);
      expect((await get(WEB, t)).status).toBe(401);
    });
  });
});
