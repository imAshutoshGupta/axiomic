import { describe, expect, it } from "vitest";
import { login, logout, whoami, type AccountDeps } from "./account";
import { credentialsPath, readCredentials, writeCredentials } from "./credentials";
import { exists, fakeServer, fakeToken, makeSandbox, modeOf, POSIX, type FakeRoute } from "./test-helpers";

const API = "https://axiomic.example";
const OLD_API = "https://old.example";
const NEW = fakeToken("n");
const OLD = fakeToken("o");
const DEVICE = "d".repeat(43);

const me = { user: { id: "u1", name: "Ravi", email: "ravi@example.com" }, token: { kind: "cli", prefix: "axm_nnnn", expires_at: null, project: null } };

/** A fake server whose /device/token answers from `polls` in order. */
function server(polls: unknown[], extra: Record<string, FakeRoute> = {}) {
  let i = 0;
  return fakeServer({
    "POST /api/v1/device/start": () => ({
      status: 200,
      body: { device_code: DEVICE, user_code: "ABCD-2345", verification_uri: "https://evil.example/device", expires_at: new Date(Date.now() + 600_000).toISOString(), interval: 5 },
    }),
    "POST /api/v1/device/token": () => ({ status: 200, body: polls[Math.min(i++, polls.length - 1)] }),
    "GET /api/v1/whoami": () => ({ status: 200, body: me }),
    ...extra,
  });
}

async function deps(fetch: typeof globalThis.fetch) {
  const box = await makeSandbox();
  const out: string[] = [];
  const slept: number[] = [];
  const opened: string[] = [];
  const d: AccountDeps = {
    fetch,
    configDir: box.dirs.config,
    env: {},
    print: (t) => void out.push(t),
    sleep: async (ms) => void slept.push(ms),
    now: Date.now,
    openUrl: async (url) => (opened.push(url), true),
  };
  return { box, d, out, slept, opened };
}

describe("login (device flow)", () => {
  it("shows the code, opens OUR /device page, polls at the server's pace, saves the token owner-only", async () => {
    const s = server([{ status: "pending" }, { status: "pending" }, { status: "approved", token: NEW }]);
    const { d, out, slept, opened, box } = await deps(s.fetch);
    const who = await login(d, API, { browser: true });

    expect(who.user.name).toBe("Ravi");
    expect(out.join("")).toContain("ABCD-2345");
    expect(opened).toEqual([`${API}/device`]); // built from the server we log in to, not the answer's URL
    expect(slept).toEqual([5000, 5000, 5000]);
    expect(await readCredentials(box.dirs.config)).toEqual({ schemaVersion: 1, token: NEW, apiUrl: API });
    if (POSIX) expect(await modeOf(credentialsPath(box.dirs.config))).toBe(0o600);
    // The device code went in the body, never the URL.
    const polls = s.seen.filter((r) => r.url.endsWith("/device/token"));
    expect(polls[0]!.body).toEqual({ device_code: DEVICE });
    expect(polls.every((r) => !r.url.includes(DEVICE))).toBe(true);
  });

  it("--no-browser doesn't open anything", async () => {
    const { d, opened } = await deps(server([{ status: "approved", token: NEW }]).fetch);
    await login(d, API, { browser: false });
    expect(opened).toEqual([]);
  });

  it("revokes the token it replaces, on the server that issued it", async () => {
    const revoked: string[] = [];
    const s = server([{ status: "approved", token: NEW }], {
      "DELETE /api/v1/token": (r) => (revoked.push(`${new URL(r.url).origin} ${r.headers.authorization}`), { status: 204 }),
    });
    const { d } = await deps(s.fetch);
    await writeCredentials(d.configDir, { schemaVersion: 1, token: OLD, apiUrl: OLD_API });
    await login(d, API, { browser: false });
    expect(revoked).toEqual([`${OLD_API} Bearer ${OLD}`]);
  });

  it("an expired code: error, nothing saved", async () => {
    const { d, box } = await deps(server([{ status: "pending" }, { status: "expired" }]).fetch);
    await expect(login(d, API, { browser: false })).rejects.toThrow(/expired/);
    expect(await exists(credentialsPath(box.dirs.config))).toBe(false);
  });

  it("slows down on 429 and rides out a short network blip", async () => {
    let n = 0;
    const s = fakeServer({
      "POST /api/v1/device/start": () => ({ status: 200, body: { device_code: DEVICE, user_code: "ABCD-2345", expires_at: new Date(Date.now() + 600_000).toISOString(), interval: 5 } }),
      "POST /api/v1/device/token": () => (++n === 1 ? { status: 429, body: { error: "too many" } } : { status: 200, body: { status: "approved", token: NEW } }),
      "GET /api/v1/whoami": () => ({ status: 200, body: me }),
    });
    const { d, slept } = await deps(s.fetch);
    await login(d, API, { browser: false });
    expect(slept).toEqual([5000, 10000]);
  });

  it("refuses a malformed token from the server", async () => {
    const { d, box } = await deps(server([{ status: "approved", token: "not-a-token" }]).fetch);
    await expect(login(d, API, { browser: false })).rejects.toThrow(/unexpected token/);
    expect(await exists(credentialsPath(box.dirs.config))).toBe(false);
  });
});

describe("logout and whoami", () => {
  it("logout revokes on the server, then deletes the file", async () => {
    const s = fakeServer({ "DELETE /api/v1/token": () => ({ status: 204 }) });
    const { d, box } = await deps(s.fetch);
    await writeCredentials(d.configDir, { schemaVersion: 1, token: OLD, apiUrl: API });
    expect(await logout(d)).toEqual({ had: true, revoked: true });
    expect(await exists(credentialsPath(box.dirs.config))).toBe(false);
  });

  it("logout with the server down still deletes the file, and says it couldn't revoke", async () => {
    const { d, box } = await deps(fakeServer({}, { down: true }).fetch);
    await writeCredentials(d.configDir, { schemaVersion: 1, token: OLD, apiUrl: API });
    const r = await logout(d);
    expect(r).toMatchObject({ had: true, revoked: false });
    expect(await exists(credentialsPath(box.dirs.config))).toBe(false);
  });

  it("logout when not logged in", async () => {
    const { d } = await deps(fakeServer({}).fetch);
    expect(await logout(d)).toEqual({ had: false });
  });

  it("whoami: undefined when not logged in; AXIOMIC_TOKEN wins over the saved login", async () => {
    const s = fakeServer({ "GET /api/v1/whoami": () => ({ status: 200, body: me }) });
    const { d } = await deps(s.fetch);
    expect(await whoami(d)).toBeUndefined();
    await writeCredentials(d.configDir, { schemaVersion: 1, token: OLD, apiUrl: OLD_API });
    d.env = { AXIOMIC_TOKEN: NEW, AXIOMIC_API_URL: API };
    expect(await whoami(d)).toMatchObject({ apiUrl: API, source: "env" });
    expect(s.seen.at(-1)!.headers.authorization).toBe(`Bearer ${NEW}`);
  });

  it("a saved token goes only to its own server, even if AXIOMIC_API_URL says otherwise", async () => {
    const s = fakeServer({ "GET /api/v1/whoami": () => ({ status: 200, body: me }) });
    const { d } = await deps(s.fetch);
    await writeCredentials(d.configDir, { schemaVersion: 1, token: OLD, apiUrl: OLD_API });
    d.env = { AXIOMIC_API_URL: API };
    await whoami(d);
    expect(new URL(s.seen[0]!.url).origin).toBe(OLD_API);
  });
});
