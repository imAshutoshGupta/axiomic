/**
 * Live tests for the website's read model (lib/spaces/workspace.ts) against axiomic-dev, as the
 * seed users. Read-only. Skipped without AXIOMIC_DATABASE_URL pointing at axiomic-dev.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, withUser, type BrowserClaims } from "@/lib/db";
import { readPull } from "@/lib/rules/pull";
import { keyring } from "@/lib/rules/rule-keys";
import { listSpaces, loadProjectView, spaceLabel } from "@/lib/spaces/workspace";

const live = !!process.env.AXIOMIC_DATABASE_URL?.includes(".mufkzfmwifxzeizssjdy:");

const ASHA = "00000000-0000-4000-8000-00000000000a"; // Acme admin
const BALA = "00000000-0000-4000-8000-00000000000b"; // Acme editor, Web lead, owns web-app + payments
const RAVI = "00000000-0000-4000-8000-00000000000e"; // Acme reader
const XENA = "00000000-0000-4000-8000-00000000000f"; // Globex admin, not in Acme
const PAYMENTS = "40000000-0000-4000-8000-000000000001";

const browser = (sub: string, aal: "aal1" | "aal2" = "aal1"): BrowserClaims => ({
  sub, role: "authenticated", aal, amr: [], session_id: randomUUID(), iat: Math.floor(Date.now() / 1000),
});
const WEB_APP = { space: "acme", project: "web-app" };

describe("spaceLabel", () => {
  it("shows personal spaces as Personal, work spaces by name", () => {
    expect(spaceLabel({ kind: "personal", name: "u-1234" })).toBe("Personal");
    expect(spaceLabel({ kind: "work", name: "Acme" })).toBe("Acme");
  });
});

describe.skipIf(!live)("website read model (live, axiomic-dev)", () => {
  afterAll(() => closeDb());

  it("lists your spaces, work first, with only the projects you can read", async () => {
    const spaces = await withUser(browser(RAVI), (tx) => listSpaces(tx));
    // Other tests may leave Ravi a test company space (scheduled for deletion), so check what matters:
    // Acme as reader, work spaces before the personal one, which comes last.
    expect(spaces.find((s) => s.slug === "acme")?.role).toBe("reader");
    expect(spaces.at(-1)!.kind).toBe("personal");
    expect(spaces.filter((s) => s.kind === "personal")).toHaveLength(1);
    const acme = spaces.find((s) => s.slug === "acme")!;
    expect(acme.projects.map((p) => p.slug).sort()).toEqual(["api", "pipeline", "web-app"]);
    expect(acme.projects.find((p) => p.slug === "web-app")).toMatchObject({ teamName: "Web", modules: 1 });
  });

  it("someone outside the space can't see it: same 404 as a project that doesn't exist", async () => {
    const spaces = await withUser(browser(XENA), (tx) => listSpaces(tx));
    expect(spaces.some((s) => s.slug === "acme")).toBe(false);
    const r = await withUser(browser(XENA), (tx) => loadProjectView(tx, keyring(), WEB_APP), { snapshot: true });
    expect(r).toMatchObject({ ok: false, status: 404 });
    const none = await withUser(browser(RAVI), (tx) => loadProjectView(tx, keyring(), { space: "acme", project: "nope" }));
    expect(none).toMatchObject({ ok: false, status: 404 });
  });

  it("edit rights come from the database: Bala owns team, project and folder; not company", async () => {
    const r = await withUser(browser(BALA), (tx) => loadProjectView(tx, keyring(), WEB_APP), { snapshot: true });
    if (!r.ok) throw new Error(r.error);
    expect(r.view.rights).toEqual({ company: false, team: true, project: true, personal: true, modules: { [PAYMENTS]: true } });
  });

  it("a reader can only change their own personal rules", async () => {
    const r = await withUser(browser(RAVI), (tx) => loadProjectView(tx, keyring(), WEB_APP), { snapshot: true });
    if (!r.ok) throw new Error(r.error);
    expect(r.view.rights).toEqual({ company: false, team: false, project: false, personal: true, modules: { [PAYMENTS]: false } });
    expect(r.view.space.role).toBe("reader");
  });

  it("a work-space admin needs aal2 (two-factor) for admin rights", async () => {
    const without = await withUser(browser(ASHA), (tx) => loadProjectView(tx, keyring(), WEB_APP), { snapshot: true });
    const withIt = await withUser(browser(ASHA, "aal2"), (tx) => loadProjectView(tx, keyring(), WEB_APP), { snapshot: true });
    if (!without.ok || !withIt.ok) throw new Error("not loaded");
    expect(without.view.rights.company).toBe(false);
    expect(withIt.view.rights.company).toBe(true);
  });

  it("the combined file is exactly what pull delivers to the same person", async () => {
    const view = await withUser(browser(RAVI), (tx) => loadProjectView(tx, keyring(), WEB_APP), { snapshot: true });
    const pulled = await withUser(browser(RAVI), (tx) => readPull(tx, keyring(), WEB_APP, null, false), { snapshot: true });
    if (!view.ok || !pulled.ok) throw new Error("not loaded");
    expect(view.view.files).toEqual(pulled.body.files);
    expect(view.view.modules.map((m) => m.name)).toEqual(["payments"]);
  });
});
