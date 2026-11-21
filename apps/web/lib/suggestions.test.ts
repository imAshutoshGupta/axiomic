/**
 * Live tests for the suggestions inbox (lib/suggestions.ts) against axiomic-dev, as seed users.
 * Ravi (reader) suggests through the editor; Bala (owner of web-app) decides. Rules made by
 * approvals are trashed at the end; open suggestions are withdrawn.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, withUser, type BrowserClaims } from "./db";
import { saveFromEditor, trashFromEditor } from "./editor";
import { loadProject } from "./pull";
import { assertWritesAllowed, keyring } from "./rule-keys";
import { decideSuggestion, listSuggestions, withdrawSuggestion } from "./suggestions";

const live = !!process.env.AXIOMIC_DATABASE_URL?.includes(".mufkzfmwifxzeizssjdy:");

const BALA = "00000000-0000-4000-8000-00000000000b";
const RAVI = "00000000-0000-4000-8000-00000000000e";
const XENA = "00000000-0000-4000-8000-00000000000f";
const PROJECT_TESTING = "50000000-0000-4000-8000-000000000005";
const ref = { space: "acme", project: "web-app" };

const browser = (sub: string): BrowserClaims => ({
  sub, role: "authenticated", aal: "aal1", amr: [], session_id: randomUUID(), iat: Math.floor(Date.now() / 1000),
});
const as = <T,>(sub: string, fn: Parameters<typeof withUser<T>>[1]) => withUser(browser(sub), fn);

async function suggestNew(title: string, body: string): Promise<string> {
  const r = await as(RAVI, (tx) => saveFromEditor(tx, keyring(), { ref, layer: "project", title, body, ackWarnings: false }));
  if (r.status !== "suggested") throw new Error(`expected a suggestion, got ${r.status}`);
  cleanup.push(() => as(RAVI, (tx) => withdrawSuggestion(tx, r.suggestionId)));
  return r.suggestionId;
}

const cleanup: (() => Promise<unknown>)[] = [];

describe.skipIf(!live)("suggestions inbox (live, axiomic-dev)", () => {
  beforeAll(() => assertWritesAllowed());
  afterAll(async () => {
    for (const c of cleanup.reverse()) await c().catch(() => {});
    await closeDb();
  });

  it("the owner sees it to decide, the author sees it as sent, an outsider not at all", async () => {
    const id = await suggestNew(`Vitest list ${randomUUID().slice(0, 8)}`, "Prefer small PRs.");
    const forBala = (await as(BALA, (tx) => listSuggestions(tx, keyring()))).find((s) => s.id === id);
    const forRavi = (await as(RAVI, (tx) => listSuggestions(tx, keyring()))).find((s) => s.id === id);
    const forXena = (await as(XENA, (tx) => listSuggestions(tx, keyring()))).find((s) => s.id === id);
    expect(forBala).toMatchObject({ canDecide: true, mine: false, body: "Prefer small PRs.", target: "project Web app", projectSlug: "web-app" });
    expect(forRavi).toMatchObject({ canDecide: false, mine: true });
    expect(forXena).toBeUndefined();
  });

  it("the seed's placeholder suggestion lists without breaking the inbox (text can't be opened)", async () => {
    const items = await as(BALA, (tx) => listSuggestions(tx, keyring()));
    const seed = items.find((s) => s.title === "Accessibility" && s.status === "pending");
    if (seed) expect(seed.body).toBeNull();
  });

  it("the author can't decide their own; approve by the owner makes a rule that pull delivers", async () => {
    const title = `Vitest approve ${randomUUID().slice(0, 8)}`;
    const id = await suggestNew(title, "Use feature flags.");
    expect(await as(RAVI, (tx) => decideSuggestion(tx, keyring(), id, "approve", ""))).toMatchObject({ ok: false });
    expect(await as(BALA, (tx) => decideSuggestion(tx, keyring(), id, "approve", "thanks"))).toEqual({ ok: true });

    const rule = await as(BALA, async (tx) => {
      const r = await loadProject(tx, keyring(), ref);
      if (!r.ok) throw new Error(r.error);
      return r.loaded.input.project.find((x) => x.title === title);
    });
    expect(rule?.body).toBe("Use feature flags.");
    cleanup.push(() => as(BALA, (tx) => trashFromEditor(tx, rule!.id)));

    const again = await as(BALA, (tx) => decideSuggestion(tx, keyring(), id, "reject", ""));
    expect(again).toEqual({ ok: false, reason: "That suggestion was already decided." });
    const sent = (await as(RAVI, (tx) => listSuggestions(tx, keyring()))).find((s) => s.id === id);
    expect(sent).toMatchObject({ status: "approved", note: "thanks" });
  });

  it("an approved change becomes the next version of the existing rule", async () => {
    const before = await as(BALA, async (tx) => {
      const r = await loadProject(tx, keyring(), ref);
      if (!r.ok) throw new Error(r.error);
      return { version: r.loaded.rules.get(PROJECT_TESTING)!.version, rule: r.loaded.input.project.find((x) => x.id === PROJECT_TESTING)! };
    });
    const s = await as(RAVI, (tx) => saveFromEditor(tx, keyring(), {
      ref, ruleId: PROJECT_TESTING, baseVersion: before.version, title: before.rule.title, body: before.rule.body, ackWarnings: false,
    }));
    if (s.status !== "suggested") throw new Error(s.status);
    cleanup.push(() => as(RAVI, (tx) => withdrawSuggestion(tx, s.suggestionId)));
    expect(await as(BALA, (tx) => decideSuggestion(tx, keyring(), s.suggestionId, "approve", ""))).toEqual({ ok: true });
    const after = await as(BALA, async (tx) => {
      const r = await loadProject(tx, keyring(), ref);
      if (!r.ok) throw new Error(r.error);
      return r.loaded.rules.get(PROJECT_TESTING)!.version;
    });
    expect(after).toBe(before.version + 1);
  });

  it("reject keeps the note; withdraw works only for the author and only once", async () => {
    const a = await suggestNew(`Vitest reject ${randomUUID().slice(0, 8)}`, "x");
    expect(await as(BALA, (tx) => decideSuggestion(tx, keyring(), a, "reject", "not now"))).toEqual({ ok: true });
    const b = await suggestNew(`Vitest withdraw ${randomUUID().slice(0, 8)}`, "y");
    expect((await as(BALA, (tx) => withdrawSuggestion(tx, b))).ok).toBe(false);
    expect(await as(RAVI, (tx) => withdrawSuggestion(tx, b))).toEqual({ ok: true });
    expect((await as(RAVI, (tx) => withdrawSuggestion(tx, b))).ok).toBe(false);
  });
});
