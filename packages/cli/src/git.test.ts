import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { envForGit, forgetResolvedGit, gitNotIgnored, gitTrackedFiles, resolveGitPath } from "./git";
import { exists, makeTempDir } from "./test-helpers";

const run = promisify(execFile);

describe("gitTrackedFiles", () => {
  it("answers [] without running Git when there is nothing to ask", async () => {
    expect(await gitTrackedFiles("/definitely/not/here", [])).toEqual([]);
  });

  it("returns undefined outside a Git repository", async () => {
    expect(await gitTrackedFiles(await makeTempDir(), ["a"])).toBeUndefined();
  });

  it("lists only tracked files, and never lets a file name run as a command", async () => {
    const dir = await makeTempDir();
    try {
      await run("git", ["init", "--quiet"], { cwd: dir });
    } catch {
      return; // Git isn't installed on this machine: nothing to check
    }
    const evil = "x; touch pwned #.md";
    await fs.writeFile(path.join(dir, "tracked.md"), "1");
    await fs.writeFile(path.join(dir, "untracked.md"), "2");
    await fs.writeFile(path.join(dir, evil), "3");
    await run("git", ["add", "tracked.md"], { cwd: dir });

    expect(await gitTrackedFiles(dir, ["tracked.md", "untracked.md", evil, "-c", "--help"])).toEqual(["tracked.md"]);
    expect(await exists(path.join(dir, "pwned"))).toBe(false);
  });
});

describe("resolveGitPath (H2: never run a git planted in the repo)", () => {
  /** A fake disk: only the listed files are runnable; every folder "exists". */
  const disk = (files: string[]) => ({ isRunnable: async (f: string) => files.includes(f), realpath: async (d: string) => d });

  it("skips empty, relative and in-project PATH entries, and takes the first real git", async () => {
    const found = await resolveGitPath({
      platform: "linux",
      env: { PATH: ":bin:./node_modules/.bin:/repo/tools:/repo:/usr/bin:/opt/git/bin" },
      projectRoot: "/repo",
      ...disk(["/repo/tools/git", "/repo/git", "/usr/bin/git", "/opt/git/bin/git"]),
    });
    expect(found).toBe("/usr/bin/git");
  });

  it("returns undefined (git unavailable) when only unsafe entries have a git", async () => {
    const found = await resolveGitPath({ platform: "linux", env: { PATH: "/repo/bin::rel" }, projectRoot: "/repo", ...disk(["/repo/bin/git", "/repo/git"]) });
    expect(found).toBeUndefined();
    expect(await resolveGitPath({ platform: "linux", env: {}, projectRoot: "/repo", ...disk([]) })).toBeUndefined();
  });

  it("skips a PATH entry that is a symlink into the project", async () => {
    const found = await resolveGitPath({
      platform: "linux",
      env: { PATH: "/safe-looking:/usr/bin" },
      projectRoot: "/repo",
      isRunnable: async (f) => f === "/safe-looking/git" || f === "/usr/bin/git",
      realpath: async (d) => (d === "/safe-looking" ? "/repo/evil" : d),
    });
    expect(found).toBe("/usr/bin/git");
  });

  it("on Windows: honours PATHEXT (only .exe/.com can run), is case-insensitive about the project, skips relative and quoted-relative entries", async () => {
    const found = await resolveGitPath({
      platform: "win32",
      env: { Path: 'C:\\Repo\\bin;.;"tools";C:\\Program Files\\Git\\cmd', PATHEXT: ".COM;.EXE;.BAT;.CMD" },
      projectRoot: "c:\\repo",
      ...disk(["C:\\Repo\\bin\\git.exe", "C:\\Program Files\\Git\\cmd\\git.cmd", "C:\\Program Files\\Git\\cmd\\git.exe"]),
    });
    expect(found).toBe("C:\\Program Files\\Git\\cmd\\git.exe");
    // a .cmd or .bat can't be started without a shell, so it is never chosen
    expect(
      await resolveGitPath({ platform: "win32", env: { PATH: "C:\\tools", PATHEXT: ".CMD;.BAT" }, projectRoot: "C:\\repo", ...disk(["C:\\tools\\git.cmd"]) }),
    ).toBeUndefined();
  });

  it("gives git a minimal environment: no GIT_* variables, nothing from the repo", () => {
    const env = envForGit({ PATH: "/usr/bin", HOME: "/h", GIT_DIR: "/evil", GIT_EXTERNAL_DIFF: "x", GIT_SSH_COMMAND: "x", SECRET: "s", XDG_CONFIG_HOME: "/c" });
    expect(env).toMatchObject({ PATH: "/usr/bin", HOME: "/h", XDG_CONFIG_HOME: "/c", GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" });
    expect(Object.keys(env).filter((k) => ["GIT_DIR", "GIT_EXTERNAL_DIFF", "GIT_SSH_COMMAND", "SECRET"].includes(k))).toEqual([]);
  });
});

describe("gitNotIgnored", () => {
  it("is unknown (undefined) outside a repo and when git is not installed", async () => {
    const dir = await makeTempDir();
    expect(await gitNotIgnored(dir, ["a"])).toBeUndefined();
    expect(await gitNotIgnored(dir, [])).toEqual([]);
    const savedPath = process.env.PATH;
    process.env.PATH = ""; // no git anywhere
    forgetResolvedGit();
    try {
      expect(await gitNotIgnored(dir, ["a"])).toBeUndefined();
      expect(await gitTrackedFiles(dir, ["a"])).toBeUndefined();
    } finally {
      process.env.PATH = savedPath;
      forgetResolvedGit();
    }
  });

  it("lists exactly the paths Git would not ignore, and never runs git found inside the project", async () => {
    const dir = await makeTempDir();
    try {
      await run("git", ["init", "--quiet"], { cwd: dir });
    } catch {
      return;
    }
    await fs.writeFile(path.join(dir, ".gitignore"), "/a.md\n/b.md\n!/b.md\n");
    expect(await gitNotIgnored(dir, ["a.md", "b.md", "c.md"])).toEqual(["b.md", "c.md"]);
  });
});
