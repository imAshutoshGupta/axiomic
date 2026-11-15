import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import { cacheFilePath } from "./cache";
import { writeProjectConfig } from "./project-config";
import { projectKey } from "./project-key";
import { makeSandbox, type Sandbox } from "./test-helpers";

/**
 * End-to-end: build the real bundle (into a temp folder, so the test never depends on or changes dist/)
 * and run it as a separate process, the way a user's terminal or Claude Code's hook would.
 */
const run = promisify(execFile);
const packageDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

let box: Sandbox;
let bundle: string;

/** Runs the built CLI with HOME and every config folder pointed into the sandbox. */
async function axiomic(args: string[], cwd = box.project) {
  const env = { PATH: process.env.PATH, HOME: box.home, USERPROFILE: box.home, ...box.env };
  try {
    const { stdout, stderr } = await run(process.execPath, [bundle, ...args], { cwd, env });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

beforeAll(async () => {
  box = await makeSandbox();
  bundle = path.join(box.base, "build", "axiomic.js");
  await run(process.execPath, [path.join(packageDir, "scripts", "build.mjs"), "--outfile", bundle], { cwd: packageDir });
}, 60_000);

describe("the built bundle", () => {
  it("prints the version from package.json and the help", async () => {
    const pkg = JSON.parse(await fs.readFile(path.join(packageDir, "package.json"), "utf8")) as { version: string };
    expect(await axiomic(["--version"])).toEqual({ code: 0, stdout: pkg.version + "\n", stderr: "" });
    const help = await axiomic(["--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("Usage: axiomic <command>");
  });

  it("is one self-contained file: @axiomic/shared is bundled in and only node: built-ins are imported", async () => {
    const code = await fs.readFile(bundle, "utf8");
    expect(code.startsWith("#!/usr/bin/env node\n")).toBe(true);
    expect(code).not.toContain("@axiomic/shared");
    expect(code).toContain("function isSafeModuleName"); // the shared code itself is inside
    expect(code).not.toContain("injection.ignore-instructions"); // L6: unused content-safety checks stay out of the bundle
    const imported = [...code.matchAll(/^import\s[^"']*["']([^"']+)["'];?$/gm)].map((m) => m[1]!);
    expect(imported.length).toBeGreaterThan(0);
    expect(imported.filter((name) => !name.startsWith("node:"))).toEqual([]);
    expect(code).not.toMatch(/\brequire\(|\bimport\(/);
    // The network is reached ONLY through api-client.ts's injected fetch (opts.fetch), never raw sockets.
    expect(code).not.toMatch(/node:https?|node:net|node:tls|node:dgram|XMLHttpRequest|WebSocket/);
    expect([...code.matchAll(/[\w.]*fetch\(/g)].map((m) => m[0])).toEqual(["opts.fetch("]);
  });

  it("has no runtime dependencies and can't be published by accident", async () => {
    const pkg = JSON.parse(await fs.readFile(path.join(packageDir, "package.json"), "utf8")) as Record<string, unknown>;
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(pkg.name).toBe("axiomic");
    expect(pkg.bin).toEqual({ axiomic: "dist/axiomic.js" });
    expect(pkg.private).toBe(true);
  });

  it("commands not built yet fail honestly", async () => {
    const result = await axiomic(["push"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("not available in this build yet");
  });

  it("server commands without a login say so, and touch nothing", async () => {
    const result = await axiomic(["whoami"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("not logged in");
  });

  it("installs a hook that points at this node and this file, and that hook command really runs", async () => {
    expect((await axiomic(["hook", "install"])).code).toBe(0);
    const settings = JSON.parse(await fs.readFile(box.settingsPath, "utf8")) as {
      hooks: { SessionStart: { hooks: { command: string; args: string[]; timeout: number }[] }[] };
    };
    const handler = settings.hooks.SessionStart[0]!.hooks[0]!;
    expect(handler.command).toBe(process.execPath);
    expect(await fs.realpath(handler.args[0]!)).toBe(await fs.realpath(bundle));
    expect(handler.timeout).toBe(5);

    // Run exactly what Claude Code would run (exec form: command + args, no shell).
    const started = Date.now();
    const { stdout } = await run(handler.command, handler.args, { cwd: box.project, env: { PATH: process.env.PATH, HOME: box.home, ...box.env } });
    expect(stdout).toBe("");
    expect(Date.now() - started).toBeLessThan(5000);

    expect((await axiomic(["hook", "status"])).stdout).toContain("installed in");
    expect((await axiomic(["hook", "uninstall"])).code).toBe(0);
  });

  // A named pipe (FIFO) where the cache file should be makes reading it block forever: the worst case for a hook.
  it.skipIf(process.platform === "win32")("the session hook gives up after its time limit, prints nothing and still exits 0", async () => {
    const hung = await makeSandbox();
    await writeProjectConfig(hung.project, { schemaVersion: 1, space: "acme", project: "web-app" });
    const file = cacheFilePath(hung.dirs.cache, await projectKey(hung.project));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await run("mkfifo", [file]);

    const started = Date.now();
    const result = await axiomic(["hook", "session-start"], hung.project);
    expect(result).toEqual({ code: 0, stdout: "", stderr: "" });
    expect(Date.now() - started).toBeLessThan(4000);
  }, 10_000);
});
