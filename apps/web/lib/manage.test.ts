/**
 * Live tests for space management (lib/manage.ts + the api.* calls the website's actions make)
 * against axiomic-dev, as seed users. Everything made here is undone at the end: the test
 * member is removed, test teams and projects deleted, test folders trashed, and the test
 * company space scheduled for deletion (the purge job removes it after 7 days).
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, withUser, type BrowserClaims, type Tx } from "./db";
import { dbReason, loadProjectSettings, loadSpaceManage, runApi } from "./manage";

const live = !!process.env.AXIOMIC_DATABASE_URL?.includes(".mufkzfmwifxzeizssjdy:");

const ASHA = "00000000-0000-4000-8000-00000000000a"; // Acme admin
const BALA = "00000000-0000-4000-8000-00000000000b"; // Acme editor, Web lead
const RAVI = "00000000-0000-4000-8000-00000000000e"; // Acme reader, Web member
const XENA = "00000000-0000-4000-8000-00000000000f"; // not in Acme
const ACME = "10000000-0000-4000-8000-000000000001";
const WEB = "20000000-0000-4000-8000-000000000001";
const WEB_APP = "30000000-0000-4000-8000-000000000001";

const claims = (sub: string, aal: "aal1" | "aal2" = "aal1", amr: unknown[] = []): BrowserClaims => ({
  sub, role: "authenticated", aal, amr, session_id: randomUUID(), iat: Math.floor(Date.now() / 1000),
});
const as = <T,>(c: BrowserClaims, fn: (tx: Tx) => Promise<T>) => withUser(c, fn);
const api = <T,>(c: BrowserClaims, q: (tx: Tx) => Promise<T>) => as(c, (tx) => runApi(tx, q));
const short = () => randomUUID().slice(0, 8);

const cleanup: (() => Promise<unknown>)[] = [];

describe("dbReason", () => {
  it("explains 'admins only' with the two-factor note, and capitalises our own texts", () => {
    expect(dbReason({ message: "admins only" })).toMatch(/two-factor/);
    expect(dbReason({ message: "not a member" })).toBe("Not a member.");
    expect(dbReason({ message: "x\u0000y" }, "42501")).toBe("You aren't allowed to do that.");
  });
});

describe.skipIf(!live)("space management (live, axiomic-dev)", () => {
  afterAll(async () => {
    for (const c of cleanup.reverse()) await c().catch(() => {});
    await closeDb();
  });

  it("the space view: same null for outsiders; admin powers need aal2; readers can't create projects", async () => {
    expect(await as(claims(XENA), (tx) => loadSpaceManage(tx, "acme"))).toBeNull();
    expect(await as(claims(ASHA), (tx) => loadSpaceManage(tx, "nope-nope"))).toBeNull();

    const asha1 = (await as(claims(ASHA), (tx) => loadSpaceManage(tx, "acme")))!;
    expect(asha1).toMatchObject({ isAdmin: false, adminNeeds2fa: true, canCreateProject: true, invites: [] });
    const asha2 = (await as(claims(ASHA, "aal2"), (tx) => loadSpaceManage(tx, "acme")))!;
    expect(asha2).toMatchObject({ isAdmin: true, adminNeeds2fa: false });

    const ravi = (await as(claims(RAVI), (tx) => loadSpaceManage(tx, "acme")))!;
    expect(ravi).toMatchObject({ isAdmin: false, adminNeeds2fa: false, canCreateProject: false });
    expect(ravi.members.map((m) => m.role).sort()).toEqual(["admin", "editor", "reader"]);
    const web = ravi.teams.find((t) => t.id === WEB)!;
    expect(web).toMatchObject({ canManage: false });
    expect(web.members.find((m) => m.userId === BALA)?.role).toBe("lead");
    expect((await as(claims(BALA), (tx) => loadSpaceManage(tx, "acme")))!.teams.find((t) => t.id === WEB)!.canManage).toBe(true);
  });

  it("an admin without two-factor can't invite (the database refuses)", async () => {
    const r = await api(claims(ASHA), (t) => t`select api.create_invite(${ACME}, 'someone@example.com', 'reader', null)`);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.reason).toMatch(/two-factor/);
  });

  it("invite → wrong account refused → right account joins (with the team) → link dead → removed", async () => {
    const made = await api(claims(ASHA, "aal2"), (t) => t<{ r: { secret: string; invite_id: string } }[]>`
      select api.create_invite(${ACME}, 'xena@example.com', 'reader', ${WEB}) as r`);
    if (!made.ok) throw new Error(made.reason);
    const { secret, invite_id } = made.value[0]!.r;
    cleanup.push(() => api(claims(ASHA, "aal2"), (t) => t`select api.revoke_invite(${invite_id})`));
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const listed = (await as(claims(ASHA, "aal2"), (tx) => loadSpaceManage(tx, "acme")))!.invites.find((i) => i.id === invite_id);
    expect(listed).toMatchObject({ email: "xena@example.com", role: "reader", teamName: "Web", state: "open" });

    const wrong = await api(claims(RAVI), (t) => t`select api.accept_invite(${secret})`);
    expect(wrong).toMatchObject({ ok: false });
    if (!wrong.ok) expect(wrong.reason).toMatch(/x\*\*\*@example\.com/); // masked, never the full address

    const joined = await api(claims(XENA), (t) => t<{ space_id: string }[]>`select api.accept_invite(${secret}) as space_id`);
    expect(joined).toMatchObject({ ok: true });
    cleanup.push(() => api(claims(ASHA, "aal2"), (t) => t`select api.remove_member(${ACME}, ${XENA})`));
    const xena = (await as(claims(XENA), (tx) => loadSpaceManage(tx, "acme")))!;
    expect(xena.space.role).toBe("reader");
    expect(xena.teams.find((t) => t.id === WEB)!.members.some((m) => m.userId === XENA)).toBe(true);

    expect((await api(claims(XENA), (t) => t`select api.accept_invite(${secret})`)).ok).toBe(false);
    const after = (await as(claims(ASHA, "aal2"), (tx) => loadSpaceManage(tx, "acme")))!.invites.find((i) => i.id === invite_id);
    expect(after?.state).toBe("accepted");

    expect(await api(claims(ASHA, "aal2"), (t) => t`select api.remove_member(${ACME}, ${XENA})`)).toMatchObject({ ok: true });
    expect(await as(claims(XENA), (tx) => loadSpaceManage(tx, "acme"))).toBeNull();
  });

  it("a new link replaces the old one; revoke kills it", async () => {
    const made = await api(claims(ASHA, "aal2"), (t) => t<{ r: { secret: string; invite_id: string } }[]>`
      select api.create_invite(${ACME}, ${`vitest-${short()}@example.com`}, 'editor', null) as r`);
    if (!made.ok) throw new Error(made.reason);
    const { invite_id, secret: first } = made.value[0]!.r;
    const again = await api(claims(ASHA, "aal2"), (t) => t<{ r: { secret: string } }[]>`select api.resend_invite(${invite_id}) as r`);
    if (!again.ok) throw new Error(again.reason);
    expect(again.value[0]!.r.secret).not.toBe(first);
    expect(await api(claims(ASHA, "aal2"), (t) => t`select api.revoke_invite(${invite_id})`)).toMatchObject({ ok: true });
    const listed = (await as(claims(ASHA, "aal2"), (tx) => loadSpaceManage(tx, "acme")))!.invites.find((i) => i.id === invite_id);
    expect(listed?.state).toBe("revoked");
  });

  it("roles: making someone a reader lists the layers they still own", async () => {
    const r = await api(claims(ASHA, "aal2"), (t) => t<{ r: { teams_led: string[]; projects_owned: string[] } }[]>`
      select api.set_role(${ACME}, ${BALA}, 'reader') as r`);
    cleanup.push(() => api(claims(ASHA, "aal2"), (t) => t`select api.set_role(${ACME}, ${BALA}, 'editor')`));
    if (!r.ok) throw new Error(r.reason);
    expect(r.value[0]!.r.teams_led).toContain("Web");
    expect(r.value[0]!.r.projects_owned).toContain("Web app");
    expect(await api(claims(ASHA, "aal2"), (t) => t`select api.set_role(${ACME}, ${BALA}, 'editor')`)).toMatchObject({ ok: true });
    // The last admin can't step down.
    expect((await api(claims(ASHA, "aal2"), (t) => t`select api.set_role(${ACME}, ${ASHA}, 'editor')`)).ok).toBe(false);
  });

  it("teams: an admin creates and deletes; a lead manages their own team without two-factor", async () => {
    const slug = `vt-${short()}`;
    const made = await api(claims(ASHA, "aal2"), (t) => t<{ id: string }[]>`select api.create_team(${ACME}, 'Vitest team', ${slug}) as id`);
    if (!made.ok) throw new Error(made.reason);
    const teamId = made.value[0]!.id;
    cleanup.push(() => api(claims(ASHA, "aal2"), (t) => t`select api.delete_team(${teamId})`));
    expect(await api(claims(ASHA, "aal2"), (t) => t`select api.set_team_member(${teamId}, ${RAVI}, 'lead')`)).toMatchObject({ ok: true });

    // Bala leads Web: may promote Ravi there and back, at aal1. Ravi (member) may not.
    expect(await api(claims(BALA), (t) => t`select api.set_team_member(${WEB}, ${RAVI}, 'lead')`)).toMatchObject({ ok: true });
    expect(await api(claims(BALA), (t) => t`select api.set_team_member(${WEB}, ${RAVI}, 'member')`)).toMatchObject({ ok: true });
    expect((await api(claims(RAVI), (t) => t`select api.set_team_member(${WEB}, ${BALA}, 'member')`)).ok).toBe(false);

    expect(await api(claims(ASHA, "aal2"), (t) => t`select api.delete_team(${teamId})`)).toMatchObject({ ok: true });
  });

  it("projects: an editor creates one and owns it; an admin deletes the empty project; readers can't create", async () => {
    const slug = `vt-${short()}`;
    const made = await api(claims(BALA), (t) => t<{ id: string }[]>`select api.create_project(${ACME}, ${WEB}, 'Vitest project', ${slug}) as id`);
    if (!made.ok) throw new Error(made.reason);
    const pid = made.value[0]!.id;
    cleanup.push(() => api(claims(ASHA, "aal2"), (t) => t`select api.delete_project(${pid})`));

    const s = (await as(claims(BALA), (tx) => loadProjectSettings(tx, "acme", slug)))!;
    expect(s).toMatchObject({ canEdit: true, canTransfer: true, canDelete: false, project: { ownerId: BALA, teamName: "Web" } });
    expect(await api(claims(BALA), (t) => t`select api.rename_project(${pid}, 'Vitest renamed')`)).toMatchObject({ ok: true });
    expect((await api(claims(RAVI), (t) => t`select api.create_project(${ACME}, ${WEB}, 'Nope', ${`vt-${short()}`})`)).ok).toBe(false);
    expect((await as(claims(RAVI), (tx) => loadProjectSettings(tx, "acme", slug)))!.canEdit).toBe(false);

    expect(await api(claims(ASHA, "aal2"), (t) => t`select api.delete_project(${pid})`)).toMatchObject({ ok: true });
  });

  it("folders: the project owner adds, edits and trashes one; bad paths are refused", async () => {
    const name = `vt-${short()}`;
    const made = await api(claims(BALA), (t) => t<{ id: string }[]>`select api.create_module(${WEB_APP}, ${name}, ${`src/${name}`}, ${BALA}::uuid) as id`);
    if (!made.ok) throw new Error(made.reason);
    const mid = made.value[0]!.id;
    cleanup.push(() => api(claims(BALA), (t) => t`select api.trash_module(${mid})`));
    const s = (await as(claims(BALA), (tx) => loadProjectSettings(tx, "acme", "web-app")))!;
    expect(s.modules.find((m) => m.id === mid)).toMatchObject({ path: `src/${name}`, ownerName: expect.any(String), canEdit: true });

    expect(await api(claims(BALA), (t) => t`select api.edit_module(${mid}, ${name}, ${`lib/${name}`}, ${BALA}::uuid)`)).toMatchObject({ ok: true });
    expect((await api(claims(BALA), (t) => t`select api.create_module(${WEB_APP}, ${`vt-${short()}`}, '../etc', null::uuid)`)).ok).toBe(false);
    expect(await api(claims(BALA), (t) => t`select api.trash_module(${mid})`)).toMatchObject({ ok: true });
  });

  it("anyone can create a company space and becomes its admin + General lead", async () => {
    const slug = `vt-${short()}`;
    const made = await api(claims(RAVI), (t) => t<{ id: string }[]>`select api.create_space('Vitest Co', ${slug}) as id`);
    if (!made.ok) throw new Error(made.reason);
    const sid = made.value[0]!.id;
    // Clean up: schedule deletion (needs a fresh two-factor entry, faked here as dev checks do).
    const fresh = claims(RAVI, "aal2", [{ method: "totp", timestamp: Math.floor(Date.now() / 1000) }]);
    cleanup.push(() => api(fresh, (t) => t`select api.schedule_space_deletion(${sid}, ${slug})`));

    const v = (await as(claims(RAVI), (tx) => loadSpaceManage(tx, slug)))!;
    expect(v).toMatchObject({ space: { kind: "work", role: "admin" }, adminNeeds2fa: true, canCreateProject: true });
    expect(v.teams).toEqual([expect.objectContaining({ name: "General", canManage: true })]);
    expect(v.teams[0]!.members).toEqual([expect.objectContaining({ userId: RAVI, role: "lead" })]);
    expect((await api(claims(RAVI), (t) => t`select api.create_space('Again', ${slug})`)).ok).toBe(false); // address taken
  });
});
