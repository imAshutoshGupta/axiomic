/**
 * Live tests for the CLI's /api/v1 endpoints (Phase 2, DECISIONS #55–#58) against axiomic-dev.
 * Skipped when AXIOMIC_DATABASE_URL is not set. Creates tokens and device codes, revokes the
 * tokens at the end; device codes expire by themselves (cleanup job, 0020b).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as deviceStart } from "@/app/api/v1/device/start/route";
import { POST as deviceToken } from "@/app/api/v1/device/token/route";
import { GET as projects } from "@/app/api/v1/projects/route";
import { DELETE as revoke } from "@/app/api/v1/token/route";
import { GET as whoami } from "@/app/api/v1/whoami/route";
import { closeDb, pgCode, withServer, withUser, type BrowserClaims } from "@/lib/db";

const live = !!process.env.AXIOMIC_DATABASE_URL?.includes(".mufkzfmwifxzeizssjdy:");

const BALA = "00000000-0000-4000-8000-00000000000b";
const RAVI = "00000000-0000-4000-8000-00000000000e";
const WEB_APP = "30000000-0000-4000-8000-000000000001";

const browser = (sub: string): BrowserClaims => ({
  sub, role: "authenticated", aal: "aal1", amr: [], session_id: randomUUID(), iat: Math.floor(Date.now() / 1000),
});

const issued: { owner: string; id: string }[] = [];
async function issue(owner: string, kind: "cli" | "agent", project: string | null): Promise<string> {
  const [row] = await withUser(browser(owner), (tx) => tx<{ r: { token: string; token_id: string } }[]>`
    select api.issue_token(${kind}, ${project}, ${"vitest " + kind}) as r`);
  issued.push({ owner, id: row!.r.token_id });
  return row!.r.token;
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const req = (path: string, init: RequestInit = {}) => new Request(`http://localhost${path}`, init);
// A random test IP per run, so the device_start limit (10 per 10 minutes per IP) never trips across runs.
const ip = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;

type Spaces = { spaces: { slug: string; kind: string; projects: { slug: string }[] }[] };

describe.skipIf(!live)("CLI API (live, axiomic-dev)", () => {
  let raviCli = "";
  let balaAgent = "";

  beforeAll(async () => {
    raviCli = await issue(RAVI, "cli", null);
    balaAgent = await issue(BALA, "agent", WEB_APP);
  });

  afterAll(async () => {
    for (const t of issued) {
      await withUser(browser(t.owner), (tx) => tx`select api.revoke_token(${t.id})`).catch(() => {});
    }
    await closeDb();
  });

  describe("GET /api/v1/whoami", () => {
    it("401 without a token", async () => {
      expect((await whoami(req("/api/v1/whoami"))).status).toBe(401);
    });
    it("a CLI token: its owner, kind cli, no project", async () => {
      const res = await whoami(req("/api/v1/whoami", { headers: bearer(raviCli) }));
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const body = (await res.json()) as { user: { id: string }; token: { kind: string; prefix: string; project: unknown } };
      expect(body.user.id).toBe(RAVI);
      expect(body.token.kind).toBe("cli");
      expect(body.token.prefix).toBe(raviCli.slice(0, 8));
      expect(body.token.project).toBeNull();
    });
    it("an agent key: names its project", async () => {
      const body = (await (await whoami(req("/api/v1/whoami", { headers: bearer(balaAgent) }))).json()) as { token: { project: unknown } };
      expect(body.token.project).toEqual({ space: "acme", slug: "web-app", name: "Web app" });
    });
  });

  describe("GET /api/v1/projects", () => {
    it("a member sees their company's projects, never another company's", async () => {
      const body = (await (await projects(req("/api/v1/projects", { headers: bearer(raviCli) }))).json()) as Spaces;
      const acme = body.spaces.find((s) => s.slug === "acme")!;
      expect(acme.kind).toBe("work");
      expect(acme.projects.map((p) => p.slug)).toContain("web-app");
      expect(body.spaces.find((s) => s.slug === "globex")).toBeUndefined();
    });
    it("an agent key sees only its own project", async () => {
      const body = (await (await projects(req("/api/v1/projects", { headers: bearer(balaAgent) }))).json()) as Spaces;
      expect(body.spaces).toEqual([{ slug: "acme", name: "Acme", kind: "work", projects: [{ slug: "web-app", name: "Web app" }] }]);
    });
  });

  describe("DELETE /api/v1/token (logout)", () => {
    it("revokes the token that sent it, and only that one", async () => {
      const t = await issue(RAVI, "cli", null);
      expect((await revoke(req("/api/v1/token", { method: "DELETE", headers: bearer(t) }))).status).toBe(204);
      expect((await whoami(req("/api/v1/whoami", { headers: bearer(t) }))).status).toBe(401);
      expect((await whoami(req("/api/v1/whoami", { headers: bearer(raviCli) }))).status).toBe(200);
    });
    it("agent keys get 403 (revoked on the website)", async () => {
      expect((await revoke(req("/api/v1/token", { method: "DELETE", headers: bearer(balaAgent) }))).status).toBe(403);
    });
  });

  describe("device login", () => {
    const start = () =>
      deviceStart(req("/api/v1/device/start", { method: "POST", headers: { "user-agent": "axiomic/test (vitest)\u0007", "x-real-ip": ip } }));
    const poll = (code: string) =>
      deviceToken(req("/api/v1/device/token", { method: "POST", body: JSON.stringify({ device_code: code }) }));

    it("start → pending → approve on the website → token (once) → the token works", async () => {
      const res = await start();
      expect(res.status).toBe(200);
      const s = (await res.json()) as { device_code: string; user_code: string; verification_uri: string; interval: number };
      expect(s.user_code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      expect(s.verification_uri).toBe("http://localhost/device");
      expect(s.interval).toBe(5);

      expect(await (await poll(s.device_code)).json()).toEqual({ status: "pending" });

      // What the /device page does: peek shows the server-built device info (control characters removed).
      const [peek] = await withUser(browser(RAVI), (tx) => tx<{ r: { client_info: string } }[]>`select api.peek_device_code(${s.user_code}) as r`);
      expect(peek!.r.client_info).toBe("axiomic/test (vitest)");
      await withUser(browser(RAVI), (tx) => tx`select api.approve_device_code(${s.user_code})`);

      const got = (await (await poll(s.device_code)).json()) as { status: string; token: string };
      expect(got.status).toBe("approved");
      expect(got.token).toMatch(/^axm_[A-Za-z0-9_-]{43}$/);

      // Single use: the same device code never hands out a second token.
      expect(await (await poll(s.device_code)).json()).toEqual({ status: "invalid" });

      const me = (await (await whoami(req("/api/v1/whoami", { headers: bearer(got.token) }))).json()) as { user: { id: string } };
      expect(me.user.id).toBe(RAVI);
      await revoke(req("/api/v1/token", { method: "DELETE", headers: bearer(got.token) }));
    });

    it("an unknown device code is invalid; a malformed one is 400", async () => {
      expect(await (await poll("A".repeat(43))).json()).toEqual({ status: "invalid" });
      expect((await poll("short")).status).toBe(400);
      expect((await deviceToken(req("/api/v1/device/token", { method: "POST", body: "not json" }))).status).toBe(400);
    });

    it("a CLI token cannot approve a device code (website only)", async () => {
      const s = (await (await start()).json()) as { user_code: string };
      const claims = { sub: RAVI, role: "authenticated" as const, axm_kind: "cli" as const };
      const e = await withUser(claims, (tx) => tx`select api.approve_device_code(${s.user_code})`).catch((x) => x);
      expect(pgCode(e)).toBe("42501");
    });
  });

  describe("rate limits", () => {
    it("api_token: the 121st request in a minute is refused (AX429)", async () => {
      const key = randomUUID();
      const e = await withServer((tx) => tx`select api.rate_limit('api_token', ${key}) from generate_series(1, 121)`).catch((x) => x);
      expect(pgCode(e)).toBe("AX429");
    });
  });
});
