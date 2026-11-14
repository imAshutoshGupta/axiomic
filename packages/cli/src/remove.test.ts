import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { DEFAULT_API_URL } from "./api-url";
import { readCache, writeCache, type CacheEntry } from "./cache";
import { installClaudeHook } from "./claude-hook";
import { runCli, type CliContext } from "./cli";
import { writeCredentials } from "./credentials";
import { BLOCK_START } from "./ignore-block";
import { writeProjectConfig } from "./project-config";
import { projectKey } from "./project-key";
import { runRemove } from "./remove";
import { runSessionStart } from "./session-start";
import { collectStatus } from "./status";
import { exists, listAll, makeSandbox, type Sandbox } from "./test-helpers";

const MAIN = ".claude/rules/axiomic.md";
const PAY = ".claude/rules/axiomic-payments.md";
const SCRIPT = "/opt/lib/node_modules/axiomic/dist/axiomic.js";
const TOKEN = "axm_SECRET-do-not-print";

const cacheEntry: CacheEntry = {
  schemaVersion: 1,
  apiUrl: DEFAULT_API_URL,
  org: "acme",
  project: "web-app",
  version: 3,
  etag: null,
  fetchedAt: "2026-11-14T10:00:00.000Z",
  files: [
    { path: MAIN, content: "# main rules\n" },
    { path: PAY, content: "# payment rules\n" },
  ],
};

/** A linked project with cached rules, as it will look after a future `axiomic pull`. */
async function linkedProject(): Promise<Sandbox> {
  const box = await makeSandbox();
  await writeProjectConfig(box.project, { schemaVersion: 1, org: "acme", project: "web-app" });
  await fs.writeFile(path.join(box.project, ".gitignore"), "node_modules\n");
  await writeCache(box.dirs.cache, await projectKey(box.project), cacheEntry);
  return box;
}

const sessionStart = (box: Sandbox, cwd = box.project, env: NodeJS.ProcessEnv = box.env) =>
  runSessionStart({ env, cwd, dirs: box.dirs, debug: () => undefined });

const remove = (box: Sandbox, flags: Partial<{ dryRun: boolean; force: boolean; hook: boolean; credentials: boolean }> = {}) =>
  runRemove({ cwd: box.project, dirs: box.dirs, env: box.env, homedir: box.home, dryRun: false, force: false, hook: false, credentials: false, ...flags });

/** Runs the command router with everything pointed into the sandbox, capturing what it prints. */
async function cli(box: Sandbox, argv: string[], cwd = box.project) {
  let out = "";
  let err = "";
  const ctx: CliContext = {
    argv,
    env: box.env,
    cwd,
    homedir: box.home,
    platform: process.platform === "win32" ? "linux" : process.platform, // the sandbox uses XDG variables
    execPath: process.execPath,
    scriptPath: SCRIPT,
    stdout: (text) => void (out += text),
    stderr: (text) => void (err += text),
  };
  return { code: await runCli(ctx), out, err };
}

describe("session-start hook entry", () => {
  it("applies the cached rules and the ignore block, from a subfolder too", async () => {
    const box = await linkedProject();
    await fs.mkdir(path.join(box.project, "src"));
    await sessionStart(box, path.join(box.project, "src"));
    expect(await fs.readFile(path.join(box.project, MAIN), "utf8")).toBe("# main rules\n");
    expect(await fs.readFile(path.join(box.project, ".gitignore"), "utf8")).toContain(BLOCK_START);
    expect(await exists(path.join(box.project, ".dockerignore"))).toBe(false);
  });

  it("does nothing outside an axiomic project, or when the cache is for another project or server", async () => {
    const box = await linkedProject();
    await sessionStart(box, box.home);
    expect(await listAll(box.home)).toEqual([]);

    await writeProjectConfig(box.project, { schemaVersion: 1, org: "acme", project: "other" });
    await sessionStart(box);
    await writeProjectConfig(box.project, { schemaVersion: 1, org: "acme", project: "web-app" });
    await sessionStart(box, box.project, { ...box.env, AXIOMIC_API_URL: "https://other.example.com" });
    expect(await exists(path.join(box.project, ".claude"))).toBe(false);
  });

  it("through the CLI: always exits 0 and prints nothing, even with a corrupt cache or a broken axiomic.json", async () => {
    const box = await linkedProject();
    const key = await projectKey(box.project);
    await fs.writeFile(path.join(box.dirs.cache, "projects", key, "rules.json"), "{corrupt");
    expect(await cli(box, ["hook", "session-start"])).toEqual({ code: 0, out: "", err: "" });
    expect(await exists(path.join(box.project, ".claude"))).toBe(false);

    await fs.writeFile(path.join(box.project, "axiomic.json"), "not json");
    expect(await cli(box, ["hook", "session-start"])).toEqual({ code: 0, out: "", err: "" });

    // A symlinked .claude makes the writer throw: the hook still exits 0 and writes nothing outside.
    const hostile = await linkedProject();
    const outside = path.join(hostile.base, "outside");
    await fs.mkdir(outside);
    await fs.symlink(outside, path.join(hostile.project, ".claude"));
    expect(await cli(hostile, ["hook", "session-start"])).toEqual({ code: 0, out: "", err: "" });
    expect(await listAll(outside)).toEqual([]);
  });

  it("through the CLI: applies a good cache silently", async () => {
    const box = await linkedProject();
    expect(await cli(box, ["hook", "session-start"])).toEqual({ code: 0, out: "", err: "" });
    expect(await exists(path.join(box.project, PAY))).toBe(true);
  });
});

describe("axiomic remove", () => {
  it("dry run reports everything and changes nothing", async () => {
    const box = await linkedProject();
    await sessionStart(box);
    await installClaudeHook(box.settingsPath, { nodePath: process.execPath, scriptPath: SCRIPT });
    await writeCredentials(box.dirs.config, { schemaVersion: 1, token: TOKEN, apiUrl: DEFAULT_API_URL });
    const before = await listAll(box.base);
    const settingsBefore = await fs.readFile(box.settingsPath, "utf8");
    const gitignoreBefore = await fs.readFile(path.join(box.project, ".gitignore"), "utf8");

    const report = await remove(box, { dryRun: true, hook: true, credentials: true });
    expect(report).toMatchObject({ gitignore: "removed", cacheRemoved: true, hook: "removed", credentialsRemoved: true, rulesDirRemoved: false });
    expect([...report.files.deleted].sort()).toEqual([PAY, MAIN]);

    expect(await listAll(box.base)).toEqual(before);
    expect(await fs.readFile(box.settingsPath, "utf8")).toBe(settingsBefore);
    expect(await fs.readFile(path.join(box.project, ".gitignore"), "utf8")).toBe(gitignoreBefore);
  });

  it("removes its files, block, cache and manifest; keeps axiomic.json, the hook, the login and the user's files", async () => {
    const box = await linkedProject();
    await sessionStart(box);
    await fs.writeFile(path.join(box.project, ".claude/settings.local.json"), "{}");
    await installClaudeHook(box.settingsPath, { nodePath: process.execPath, scriptPath: SCRIPT });
    await writeCredentials(box.dirs.config, { schemaVersion: 1, token: TOKEN, apiUrl: DEFAULT_API_URL });

    const report = await remove(box);
    expect(report).toMatchObject({ gitignore: "removed", dockerignore: "absent", cacheRemoved: true, manifestKept: false, rulesDirRemoved: true, unknownFiles: [] });
    expect(report.hook).toBeUndefined();
    expect(await listAll(box.project)).toEqual([".claude/settings.local.json", ".gitignore", "axiomic.json"]);
    expect(await fs.readFile(path.join(box.project, ".gitignore"), "utf8")).toBe("node_modules\n");
    expect(await listAll(box.dirs.cache)).toEqual([]);
    expect(await listAll(box.dirs.state)).toEqual([]);
    expect(await fs.readFile(box.settingsPath, "utf8")).toContain("session-start");
    expect(await listAll(box.dirs.config)).toEqual(["credentials.json"]);

    // Running it again is harmless.
    expect((await remove(box)).files.deleted).toEqual([]);
  });

  it("keeps a locally edited file (and the ignore block that protects it) unless --force", async () => {
    const box = await linkedProject();
    await sessionStart(box);
    await fs.writeFile(path.join(box.project, PAY), "edited by the AI\n");
    await fs.writeFile(path.join(box.project, ".claude/rules/mine.md"), "mine\n");
    await fs.writeFile(path.join(box.project, ".claude/rules/axiomic-handmade.md"), "not written by axiomic\n");

    const report = await remove(box);
    expect(report.files.deleted).toEqual([MAIN]);
    expect(report.files.keptModified).toEqual([PAY]);
    expect(report.unknownFiles).toEqual([".claude/rules/axiomic-handmade.md"]);
    expect(report).toMatchObject({ gitignore: "kept", manifestKept: true, rulesDirRemoved: false });
    expect(await fs.readFile(path.join(box.project, PAY), "utf8")).toBe("edited by the AI\n");
    expect(await fs.readFile(path.join(box.project, ".gitignore"), "utf8")).toContain(BLOCK_START);

    const forced = await remove(box, { force: true });
    expect(forced.files.deleted).toEqual([PAY]);
    expect(forced.files.forced).toEqual([PAY]);
    // Even --force never deletes files axiomic has no record of writing.
    expect(forced.unknownFiles).toEqual([".claude/rules/axiomic-handmade.md"]);
    expect(await listAll(path.join(box.project, ".claude"))).toEqual(["rules/axiomic-handmade.md", "rules/mine.md"]);
  });

  it("--hook and --credentials remove the machine-wide parts, leaving other hooks alone", async () => {
    const box = await linkedProject();
    await fs.mkdir(path.dirname(box.settingsPath));
    const mine = { hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo axiomic" }] }] } };
    await fs.writeFile(box.settingsPath, JSON.stringify(mine));
    await installClaudeHook(box.settingsPath, { nodePath: process.execPath, scriptPath: SCRIPT });
    await writeCredentials(box.dirs.config, { schemaVersion: 1, token: TOKEN, apiUrl: DEFAULT_API_URL });

    const result = await cli(box, ["remove", "--all"]);
    expect(result.code).toBe(0);
    expect(result.out).not.toContain(TOKEN);
    expect(JSON.parse(await fs.readFile(box.settingsPath, "utf8"))).toEqual(mine);
    expect(await listAll(box.dirs.config)).toEqual([]);
    expect(await exists(path.join(box.project, "axiomic.json"))).toBe(true);
  });

  it("refuses to delete through a symlinked rules folder", async () => {
    const box = await linkedProject();
    await sessionStart(box);
    const outside = path.join(box.base, "outside");
    await fs.rename(path.join(box.project, ".claude/rules"), outside);
    await fs.symlink(outside, path.join(box.project, ".claude/rules"));
    await expect(remove(box)).rejects.toThrow(/symlink/);
    expect(await listAll(outside)).toEqual(["axiomic-payments.md", "axiomic.md"]);
  });
});

describe("command line", () => {
  it("prints the version and help", async () => {
    const box = await makeSandbox();
    expect(await cli(box, ["--version"])).toMatchObject({ code: 0, out: "0.0.0-source\n" });
    const help = await cli(box, ["--help"]);
    expect(help.code).toBe(0);
    expect(help.out).toContain("hook install");
    expect((await cli(box, [])).out).toBe(help.out);
  });

  it.each(["login", "logout", "pull", "push", "whoami", "init", "diff", "import"])("%s says it is not available and fails", async (command) => {
    const box = await makeSandbox();
    const result = await cli(box, [command, "--quiet"]);
    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).toContain("not available in this build");
    expect(await listAll(box.base)).toEqual([]);
  });

  it("rejects unknown commands and flags with exit code 2", async () => {
    const box = await makeSandbox();
    expect((await cli(box, ["frobnicate"])).code).toBe(2);
    expect((await cli(box, ["remove", "--everything"])).code).toBe(2);
    expect((await cli(box, ["remove", "extra"])).code).toBe(2);
    expect((await cli(box, ["hook"])).code).toBe(2);
    expect((await cli(box, ["hook", "explode"])).code).toBe(2);
    expect(await listAll(box.base)).toEqual([]);
  });

  it("hook install / status / uninstall work end to end against the sandboxed settings file", async () => {
    const box = await makeSandbox();
    expect((await cli(box, ["hook", "status"])).out).toContain("not installed");
    expect((await cli(box, ["hook", "install", "--dry-run"])).code).toBe(0);
    expect(await exists(box.settingsPath)).toBe(false);
    expect((await cli(box, ["hook", "install"])).out).toContain("installed");
    expect((await cli(box, ["hook", "install"])).out).toContain("unchanged");
    const status = await cli(box, ["hook", "status"]);
    expect(status.out).toContain(SCRIPT);
    expect(status.out).toContain("that axiomic no longer exists"); // SCRIPT is a made-up path
    expect((await cli(box, ["hook", "uninstall"])).out).toContain("removed");
    expect(JSON.parse(await fs.readFile(box.settingsPath, "utf8"))).toEqual({});
  });

  it("reports an invalid settings.json as an error and leaves it untouched", async () => {
    const box = await makeSandbox();
    await fs.mkdir(path.dirname(box.settingsPath));
    await fs.writeFile(box.settingsPath, "{oops");
    const result = await cli(box, ["hook", "install"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("not valid JSON");
    expect(await fs.readFile(box.settingsPath, "utf8")).toBe("{oops");
  });
});

describe("axiomic status", () => {
  it("reports files, edits, the ignore block, the cache and the hook, and never the token", async () => {
    const box = await linkedProject();
    await sessionStart(box);
    await fs.writeFile(path.join(box.project, PAY), "edited\n");
    await writeCredentials(box.dirs.config, { schemaVersion: 1, token: TOKEN, apiUrl: DEFAULT_API_URL });

    const report = await collectStatus({ cwd: box.project, dirs: box.dirs, env: box.env, homedir: box.home, hookTarget: undefined });
    expect(report.credentials).toBe("ok");
    expect(report.hook).toMatchObject({ count: 0 });
    expect(report.project).toMatchObject({
      config: { org: "acme", project: "web-app" },
      files: [
        { path: PAY, state: "modified" },
        { path: MAIN, state: "ok" },
      ],
      gitignore: "current",
      dockerignore: "no-file",
      cache: { version: 3 },
    });

    const text = await cli(box, ["status"]);
    expect(text.out).toContain("MODIFIED locally");
    const json = await cli(box, ["status", "--json"]);
    expect(JSON.parse(json.out)).toMatchObject({ credentials: "ok" });
    expect(text.out + text.err + json.out + json.err).not.toContain(TOKEN);
  });

  it("works outside a project", async () => {
    const box = await makeSandbox();
    const result = await cli(box, ["status"], box.home);
    expect(result.code).toBe(0);
    expect(result.out).toContain("no axiomic.json");
  });

  it("flags a rule file that Git tracks, and exits 1", async () => {
    const box = await linkedProject();
    await sessionStart(box);
    const git = (...args: string[]) => promisify(execFile)("git", args, { cwd: box.project });
    try {
      await git("init", "--quiet");
    } catch {
      return; // Git isn't installed on this machine: nothing to check
    }
    const clean = await collectStatus({ cwd: box.project, dirs: box.dirs, env: box.env, homedir: box.home, hookTarget: undefined });
    expect(clean.project?.tracked).toEqual([]);

    await git("add", "--force", MAIN);
    const result = await cli(box, ["status"]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("tracked by Git");
    expect(JSON.parse((await cli(box, ["status", "--json"])).out)).toMatchObject({ project: { tracked: [MAIN] } });
  });

  it("the cache survives status, and the cache storage is untouched by read-only commands", async () => {
    const box = await linkedProject();
    await cli(box, ["status"]);
    expect(await readCache(box.dirs.cache, await projectKey(box.project))).toEqual(cacheEntry);
  });
});
