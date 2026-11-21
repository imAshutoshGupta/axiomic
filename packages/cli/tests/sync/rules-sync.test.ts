import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readCache } from "../../src/local-files/cache";
import { writeCredentials } from "../../src/server/credentials";
import { formatProjectRows, initProject, parseProjectRef } from "../../src/commands/init";
import { NotLoggedInError, type ProjectDeps } from "../../src/commands/linked-project";
import { AccessGoneError, pullProject } from "../../src/commands/pull";
import { readProjectConfig, writeProjectConfig } from "../../src/project/project-config";
import { projectKey } from "../../src/project/project-key";
import { runSessionStart } from "../../src/hook/session-start";
import { exists, fakeServer, fakeToken, makeSandbox, type Sandbox } from "../helpers/test-helpers";

const API = "https://axiomic.example";
const TOKEN = fakeToken("t");
const MAIN = ".claude/rules/axiomic.md";

const answer = (content = "# rules v1\n") => ({
  project: { id: "p", name: "Web app", slug: "web-app", space: "acme" },
  versions: { space: 1, team: 1, personal: 0 },
  files: [{ path: MAIN, content }],
  rules: [],
  blocked: [],
});

async function setup(routes: Parameters<typeof fakeServer>[0], options: { login?: boolean; down?: boolean } = {}) {
  const box = await makeSandbox();
  if (options.login !== false) await writeCredentials(box.dirs.config, { schemaVersion: 1, token: TOKEN, apiUrl: API });
  const server = fakeServer(routes, options.down ? { down: true } : {});
  const deps: ProjectDeps = { fetch: server.fetch, env: box.env, cwd: box.project, dirs: box.dirs };
  return { box, server, deps };
}

const read = (box: Sandbox, rel: string) => fs.readFile(path.join(box.project, rel), "utf8");
const pullRoute = (body: unknown, status = 200) => ({ "GET /api/v1/pull": () => ({ status, body }) });

describe("init", () => {
  it("parses <space>/<project> strictly", () => {
    expect(parseProjectRef("acme/web-app")).toEqual({ space: "acme", project: "web-app" });
    for (const bad of ["acme", "acme/web/app", "../x/y", "Acme/web", "acme/"]) expect(parseProjectRef(bad)).toBeUndefined();
  });

  it("without a project: lists what you can link and changes nothing", async () => {
    const spaces = [{ slug: "acme", name: "Acme", kind: "work", projects: [{ slug: "web-app", name: "Web app" }] }];
    const { deps, box } = await setup({ "GET /api/v1/projects": () => ({ status: 200, body: { spaces } }) });
    expect(await initProject(deps, undefined)).toEqual({ kind: "choose", spaces });
    expect(await fs.readdir(box.project)).toEqual([]);
  });

  it("lists projects with a gap even after a long personal-space slug", () => {
    const rows = formatProjectRows([
      { slug: "acme", name: "Acme", kind: "work", projects: [{ slug: "web-app", name: "Web app" }] },
      { slug: "u-f24615d18a6f9ed3bbf68fe448c0", name: "Personal", kind: "personal", projects: [{ slug: "sandbox", name: "Sandbox" }] },
    ] as Parameters<typeof formatProjectRows>[0]);
    expect(rows[0]).toMatch(/^  acme\/web-app {2,}Web app \(Acme\)$/);
    expect(rows[1]).toMatch(/^  u-f24615d18a6f9ed3bbf68fe448c0\/sandbox {2,}Sandbox \(Personal\)$/);
    expect(rows[0]?.indexOf("Web app")).toBe(rows[1]?.indexOf("Sandbox")); // columns line up
  });

  it("links: writes axiomic.json, the ignore block, the rule file and the cache", async () => {
    const { deps, box } = await setup(pullRoute(answer()));
    const out = await initProject(deps, { space: "acme", project: "web-app" });
    expect(out).toMatchObject({ kind: "linked", created: true });
    expect(await readProjectConfig(box.project)).toEqual({ schemaVersion: 1, space: "acme", project: "web-app" });
    expect(await read(box, MAIN)).toBe("# rules v1\n");
    expect(await read(box, ".gitignore")).toContain("/.claude/rules/axiomic.md");
    const cache = await readCache(box.dirs.cache, await projectKey(box.project));
    expect(cache).toMatchObject({ apiUrl: API, space: "acme", project: "web-app", version: 2 });
  });

  it("a project you can't read (404): nothing is written, not even axiomic.json", async () => {
    const { deps, box } = await setup(pullRoute({ error: "project not found" }, 404));
    await expect(initProject(deps, { space: "acme", project: "secret" })).rejects.toThrow(/project not found/);
    expect(await fs.readdir(box.project)).toEqual([]);
  });

  it("an already linked repo: a teammate's init just pulls; another project is refused", async () => {
    const { deps, box } = await setup(pullRoute(answer()));
    await writeProjectConfig(box.project, { schemaVersion: 1, space: "acme", project: "web-app" });
    expect(await initProject(deps, undefined)).toMatchObject({ kind: "linked", created: false });
    expect(await read(box, MAIN)).toBe("# rules v1\n");
    await expect(initProject(deps, { space: "acme", project: "api" })).rejects.toThrow(/already linked to acme\/web-app/);
  });

  it("must run at the top of the Git repo", async () => {
    const { deps, box } = await setup(pullRoute(answer()));
    await fs.mkdir(path.join(box.project, ".git"));
    await fs.mkdir(path.join(box.project, "src"));
    await expect(initProject({ ...deps, cwd: path.join(box.project, "src") }, { space: "acme", project: "web-app" })).rejects.toThrow(/top of your Git/);
  });

  it("not logged in: a clear error", async () => {
    const { deps } = await setup({}, { login: false });
    await expect(initProject(deps, { space: "acme", project: "web-app" })).rejects.toBeInstanceOf(NotLoggedInError);
  });
});

describe("pull", () => {
  it("updates the files and keeps a local edit", async () => {
    let content = "# rules v1\n";
    const { deps, box } = await setup({ "GET /api/v1/pull": () => ({ status: 200, body: answer(content) }) });
    await writeProjectConfig(box.project, { schemaVersion: 1, space: "acme", project: "web-app" });
    await pullProject(deps);
    content = "# rules v2\n";
    expect((await pullProject(deps)).report.written).toEqual([MAIN]);
    expect(await read(box, MAIN)).toBe("# rules v2\n");

    await fs.writeFile(path.join(box.project, MAIN), "my edit\n");
    content = "# rules v3\n";
    expect((await pullProject(deps)).report.keptModified).toEqual([MAIN]);
    expect(await read(box, MAIN)).toBe("my edit\n");
  });

  it("access gone (401/404): removes the rule files and the cache (offboarding)", async () => {
    let status = 200;
    const { deps, box } = await setup({ "GET /api/v1/pull": () => (status === 200 ? { status, body: answer() } : { status, body: { error: "x" } }) });
    await writeProjectConfig(box.project, { schemaVersion: 1, space: "acme", project: "web-app" });
    await pullProject(deps);
    status = 401;
    const e = await pullProject(deps).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AccessGoneError);
    expect((e as Error).message).not.toContain("..");
    expect(await exists(path.join(box.project, MAIN))).toBe(false);
    expect(await readCache(box.dirs.cache, await projectKey(box.project))).toBeUndefined();
  });

  it("server down: an error, and the files stay as they were", async () => {
    const { deps, box } = await setup(pullRoute(answer()));
    await writeProjectConfig(box.project, { schemaVersion: 1, space: "acme", project: "web-app" });
    await pullProject(deps);
    await expect(pullProject({ ...deps, fetch: fakeServer({}, { down: true }).fetch })).rejects.toThrow(/could not reach/);
    expect(await read(box, MAIN)).toBe("# rules v1\n");
  });
});

describe("session hook", () => {
  const hook = (box: Sandbox, fetch: typeof globalThis.fetch, debug: string[] = []) =>
    runSessionStart({ env: box.env, cwd: box.project, dirs: box.dirs, fetch, debug: (m) => void debug.push(m), networkTimeoutMs: 1000 });

  it("online: pulls fresh rules", async () => {
    const { box, server } = await setup(pullRoute(answer("# fresh\n")));
    await writeProjectConfig(box.project, { schemaVersion: 1, space: "acme", project: "web-app" });
    await hook(box, server.fetch);
    expect(await read(box, MAIN)).toBe("# fresh\n");
  });

  it("offline: restores the last pulled rules from the cache", async () => {
    const { box, deps } = await setup(pullRoute(answer("# cached\n")));
    await writeProjectConfig(box.project, { schemaVersion: 1, space: "acme", project: "web-app" });
    await pullProject(deps);
    await fs.rm(path.join(box.project, ".claude"), { recursive: true }); // e.g. git clean -fdx
    const debug: string[] = [];
    await hook(box, fakeServer({}, { down: true }).fetch, debug);
    expect(await read(box, MAIN)).toBe("# cached\n");
    expect(debug.join("\n")).toContain("using the cache");
  });

  it("no access any more (404): removes the files, even though a cache exists", async () => {
    const { box, deps } = await setup(pullRoute(answer()));
    await writeProjectConfig(box.project, { schemaVersion: 1, space: "acme", project: "web-app" });
    await pullProject(deps);
    await hook(box, fakeServer(pullRoute({ error: "project not found" }, 404)).fetch);
    expect(await exists(path.join(box.project, MAIN))).toBe(false);
  });

  it("not logged in: never calls the server, still uses a cache", async () => {
    const { box, server } = await setup({}, { login: false });
    await writeProjectConfig(box.project, { schemaVersion: 1, space: "acme", project: "web-app" });
    await hook(box, server.fetch);
    expect(server.seen).toEqual([]);
  });
});
