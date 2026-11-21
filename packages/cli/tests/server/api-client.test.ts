import { describe, expect, it } from "vitest";
import { apiCall, ApiError } from "../../src/server/api-client";
import { pullRules } from "../../src/server/endpoints";
import { printable } from "../../src/utils/printable";
import { fakeServer, fakeToken } from "../helpers/test-helpers";

const API = "https://axiomic.example";
const TOKEN = fakeToken("t");

describe("apiCall", () => {
  it("sends the token only in the Authorization header, refuses redirects, says who it is", async () => {
    const server = fakeServer({ "GET /api/v1/whoami": () => ({ status: 200, body: { ok: true } }) });
    await apiCall({ apiUrl: API, fetch: server.fetch, token: TOKEN, timeoutMs: 1000 }, "GET", "/api/v1/whoami");
    const req = server.seen[0]!;
    expect(req.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(req.url).not.toContain(TOKEN);
    expect(req.redirect).toBe("error");
    expect(req.headers["user-agent"]).toMatch(/^axiomic\/\S+ \(/);
    expect(req.headers["x-axiomic-cli-version"]).toBeTruthy();
  });

  it("401 → a login hint; the error never contains the token", async () => {
    const server = fakeServer({ "GET /x": () => ({ status: 401, body: { error: `bad ${TOKEN}` } }) });
    const e = (await apiCall({ apiUrl: API, fetch: server.fetch, token: TOKEN, timeoutMs: 1000 }, "GET", "/x").catch((x) => x)) as ApiError;
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(401);
    expect(e.message).toContain("axiomic login");
    expect(e.message).not.toContain(TOKEN);
  });

  it("network trouble → status 0 with the server named", async () => {
    const server = fakeServer({}, { down: true });
    const e = (await apiCall({ apiUrl: API, fetch: server.fetch, timeoutMs: 1000 }, "GET", "/x").catch((x) => x)) as ApiError;
    expect(e.status).toBe(0);
    expect(e.message).toContain(API);
  });

  it("server error texts are shown only when short and printable", async () => {
    const server = fakeServer({
      "GET /a": () => ({ status: 404, body: { error: "project not found" } }),
      "GET /b": () => ({ status: 404, body: { error: "\u001b[31mred" } }),
    });
    const call = (p: string) => apiCall({ apiUrl: API, fetch: server.fetch, timeoutMs: 1000 }, "GET", p).catch((x: Error) => x.message);
    expect(await call("/a")).toBe("project not found");
    expect(await call("/b")).toBe("not found");
  });

  it("refuses an answer that is too big", async () => {
    const huge = (async () => new Response("x".repeat(9 * 1024 * 1024))) as unknown as typeof fetch;
    const e = (await apiCall({ apiUrl: API, fetch: huge, timeoutMs: 5000 }, "GET", "/x").catch((x) => x)) as ApiError;
    expect(e.message).toContain("too big");
  });
});

describe("answers from the server are checked", () => {
  const good = {
    project: { id: "x", name: "Web app", slug: "web-app", space: "acme" },
    versions: { space: 3, team: 2, personal: 1 },
    files: [{ path: ".claude/rules/axiomic.md", content: "# rules\n" }],
    rules: [{ path: ".claude/rules/axiomic.md", id: "50000000-0000-4000-8000-000000000001", layer: "company", version: 2, title: "rules" }],
    blocked: [{ title: "Tabs", layer: "personal", reason: "personal-adds-only" }],
  };
  const pull = (body: unknown) =>
    pullRules({ apiUrl: API, token: TOKEN, fetch: fakeServer({ "GET /api/v1/pull": () => ({ status: 200, body }) }).fetch, timeoutMs: 1000 }, "acme", "web-app");

  it("a good answer: version = sum of the three counters", async () => {
    const a = await pull(good);
    expect(a.version).toBe(6);
    expect(a.files).toEqual(good.files);
  });

  it("asks with slugs in the query, encoded", async () => {
    const server = fakeServer({ "GET /api/v1/pull": () => ({ status: 200, body: good }) });
    await pullRules({ apiUrl: API, token: TOKEN, fetch: server.fetch, timeoutMs: 1000 }, "acme", "web-app");
    expect(new URL(server.seen[0]!.url).search).toBe("?space=acme&project=web-app");
  });

  it.each([
    ["another project", { ...good, project: { ...good.project, slug: "api" } }],
    ["a negative version", { ...good, versions: { ...good.versions, team: -1 } }],
    ["a file without content", { ...good, files: [{ path: "x" }] }],
    ["not an object", [1, 2]],
    ["a bad rules index", { ...good, rules: [{ path: "x", id: "not-a-uuid", layer: "company", version: 1, title: "t" }] }],
  ])("refuses %s", async (_label, body) => {
    await expect(pull(body)).rejects.toThrow(/unexpected/);
  });

  it("printable() removes terminal escape codes and hidden direction marks", () => {
    expect(printable("Web\u001b[2J app‮")).toBe("Web[2J app");
  });
});
