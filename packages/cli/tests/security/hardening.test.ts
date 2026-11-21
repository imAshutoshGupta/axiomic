import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { DEFAULT_API_URL } from "../../src/server/api-url";
import { writeCache, type CacheEntry } from "../../src/local-files/cache";
import { runCli, type CliContext } from "../../src/cli";
import { GITIGNORE_BODY, BLOCK_START, ensureIgnoreBlocks } from "../../src/local-files/ignore-block";
import { gitNotIgnored } from "../../src/project/git";
import { writeProjectConfig } from "../../src/project/project-config";
import { projectKey } from "../../src/project/project-key";
import { runRemove } from "../../src/commands/remove";
import { runSessionStart } from "../../src/hook/session-start";
import { collectStatus, statusHasProblems } from "../../src/commands/status";
import { POSIX, exists, listAll, makeSandbox, type Sandbox } from "../helpers/test-helpers";
import { NotIgnoredError, writeRuleFiles } from "../../src/local-files/writer";
import { emptyManifest, readManifest, writeManifest } from "../../src/local-files/manifest";
import { sha256 } from "../../src/utils/fs-safe";

/**
 * Regression tests for the security-audit findings (H1, M1, M2, M3, L2, L3, L5). Each test says which one.
 * Everything runs in temp folders; Git tests use a real `git init` and skip quietly if Git is missing.
 */
const run = promisify(execFile);
const MAIN = ".claude/rules/axiomic.md";
const PAY = ".claude/rules/axiomic-payments.md";
const SCRIPT = "/opt/lib/node_modules/axiomic/dist/axiomic.js";

const cacheEntry = (files: { path: string; content: string }[]): CacheEntry => ({
  schemaVersion: 1,
  apiUrl: DEFAULT_API_URL,
  space: "acme",
  project: "web-app",
  version: 3,
  etag: null,
  fetchedAt: "2026-11-14T10:00:00.000Z",
  files,
});
const TWO = [
  { path: MAIN, content: "# main rules\n" },
  { path: PAY, content: "# payment rules\n" },
];

async function linkedProject(files = TWO): Promise<Sandbox> {
  const box = await makeSandbox();
  await writeProjectConfig(box.project, { schemaVersion: 1, space: "acme", project: "web-app" });
  await writeCache(box.dirs.cache, await projectKey(box.project), cacheEntry(files));
  return box;
}

/** `git init` in the project. Returns false if Git isn't installed (the test then returns early). */
async function gitInit(dir: string): Promise<boolean> {
  try {
    await run("git", ["init", "--quiet"], { cwd: dir });
    return true;
  } catch {
    return false;
  }
}

const sessionStart = (box: Sandbox, extra: { deadline?: number } = {}) =>
  runSessionStart({ env: box.env, cwd: box.project, dirs: box.dirs, debug: () => undefined, ...extra });

const remove = (box: Sandbox, force = false) =>
  runRemove({ cwd: box.project, dirs: box.dirs, env: box.env, homedir: box.home, dryRun: false, force, hook: false, credentials: false });

async function cli(box: Sandbox, argv: string[], cwd = box.project) {
  let out = "";
  let err = "";
  const ctx: CliContext = {
    argv,
    env: box.env,
    cwd,
    homedir: box.home,
    platform: process.platform === "win32" ? "linux" : process.platform,
    execPath: process.execPath,
    scriptPath: SCRIPT,
    stdout: (t) => void (out += t),
    stderr: (t) => void (err += t),
  };
  return { code: await runCli(ctx), out, err };
}

/** Runs `fn` and fails if it takes longer than 2 s (a hang). Returns the result or the thrown error. */
async function within2s<T>(fn: () => Promise<T>): Promise<{ value?: T; error?: unknown; ms: number }> {
  const start = Date.now();
  let value: T | undefined;
  let error: unknown;
  try {
    value = await fn();
  } catch (e) {
    error = e;
  }
  const ms = Date.now() - start;
  expect(ms).toBeLessThan(2000);
  return { value, error, ms };
}

describe("H1: Git must really ignore the rule files", () => {
  it("writes nothing when a `!` line after the block un-ignores a rule file", async () => {
    const box = await linkedProject();
    if (!(await gitInit(box.project))) return;
    // axiomic's block is there, and a later line un-ignores one rule file (the block must come first to be undone).
    await ensureIgnoreBlocks(box.project);
    await fs.appendFile(path.join(box.project, ".gitignore"), "!/.claude/rules/axiomic.md\n");

    await sessionStart(box).catch(() => undefined); // (the real hook swallows this error: it fails open)
    expect(await exists(path.join(box.project, ".claude"))).toBe(false); // NOTHING written
    expect((await readManifest(box.dirs.state, await projectKey(box.project))).files.size).toBe(0);

    // ...and the underlying writer says exactly why.
    await expect(
      writeRuleFiles({
        projectRoot: box.project,
        stateDir: box.dirs.state,
        files: TWO,
        prepare: async () => {
          await ensureIgnoreBlocks(box.project);
          return undefined;
        },
      }),
    ).rejects.toBeInstanceOf(NotIgnoredError);
    expect(await exists(path.join(box.project, ".claude"))).toBe(false);
  });

  it("writes nothing when a nested .claude/rules/.gitignore un-ignores the files", async () => {
    const box = await linkedProject();
    if (!(await gitInit(box.project))) return;
    await fs.mkdir(path.join(box.project, ".claude", "rules"), { recursive: true });
    await fs.writeFile(path.join(box.project, ".claude", "rules", ".gitignore"), "!axiomic-*.md\n!axiomic.md\n");
    await sessionStart(box).catch(() => undefined);
    expect(await listAll(path.join(box.project, ".claude"))).toEqual(["rules/.gitignore"]);
  });

  it("writes normally in a Git repo when the block is the only rule, and outside a Git repo", async () => {
    const withGit = await linkedProject();
    if (!(await gitInit(withGit.project))) return;
    await sessionStart(withGit);
    expect(await exists(path.join(withGit.project, MAIN))).toBe(true);
    expect(await gitNotIgnored(withGit.project, [MAIN, PAY, ".claude/rules/.axiomic.md.0123456789abcdef.tmp"])).toEqual([]);

    const plain = await linkedProject();
    await sessionStart(plain);
    expect(await exists(path.join(plain.project, MAIN))).toBe(true);
  });

  it("status shows the problem and exits 1 when files became un-ignored", async () => {
    const box = await linkedProject();
    if (!(await gitInit(box.project))) return;
    await sessionStart(box);
    expect((await cli(box, ["status"])).code).toBe(0);

    await fs.appendFile(path.join(box.project, ".gitignore"), "!/.claude/rules/axiomic.md\n");
    const result = await cli(box, ["status"]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("Git would NOT ignore");
    expect(result.out).toContain(MAIN);
    const report = await collectStatus({ cwd: box.project, dirs: box.dirs, env: box.env, homedir: box.home, hookTarget: undefined });
    expect(report.project?.notIgnored).toEqual([MAIN]);
    expect(statusHasProblems(report)).toBe(true);
  });
});

describe("M1: a cut-off write never leaves files axiomic can't update or remove", () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ path: `.claude/rules/axiomic-m${i}.md`, content: `# module ${i}\n` }));

  /** Checks, at every step, that each rule file on disk is known to the manifest (confirmed or pending). */
  function invariantClock(box: Sandbox, stopAfter: number) {
    let calls = 0;
    return () => {
      calls++;
      const dir = path.join(box.project, ".claude", "rules");
      let names: string[] = [];
      try {
        names = readdirSync(dir).filter((n) => n.endsWith(".md"));
      } catch {
        /* folder not created yet */
      }
      if (names.length > 0) {
        const manifestDir = path.join(box.dirs.state, "projects");
        const [key] = readdirSync(manifestDir);
        const m = JSON.parse(readFileSync(path.join(manifestDir, key!, "manifest.json"), "utf8")) as {
          files: Record<string, unknown>;
          pending?: Record<string, unknown>;
        };
        for (const n of names) {
          const rel = `.claude/rules/${n}`;
          expect(rel in m.files || rel in (m.pending ?? {}), `${rel} on disk but unknown to the manifest`).toBe(true);
        }
      }
      return calls <= stopAfter ? 0 : 1_000_000; // "time" jumps past the deadline after `stopAfter` checks
    };
  }

  it("stops at the deadline, a second run finishes the job, and remove cleans everything", async () => {
    const box = await makeSandbox();
    const base = { projectRoot: box.project, stateDir: box.dirs.state, files: many, deadline: 500_000 };
    const first = await writeRuleFiles({ ...base, now: invariantClock(box, 12) });
    expect(first.deferred.length).toBeGreaterThan(0);
    expect(first.written.length).toBeGreaterThan(0);
    expect(first.written.length + first.deferred.length).toBe(40);

    // An edit made after the cut-off must still be recognised as an edit, not overwritten.
    const edited = first.written[0]!;
    await fs.writeFile(path.join(box.project, edited), "my own edit\n");

    const second = await writeRuleFiles({ projectRoot: box.project, stateDir: box.dirs.state, files: many });
    expect(second.deferred).toEqual([]);
    expect(second.keptModified).toEqual([edited]);
    expect(await fs.readFile(path.join(box.project, edited), "utf8")).toBe("my own edit\n");
    expect((await fs.readdir(path.join(box.project, ".claude", "rules"))).length).toBe(40);

    const report = await remove(box);
    expect(report.files.keptModified).toEqual([edited]);
    const forced = await remove(box, true);
    expect(forced.files.deleted).toEqual([edited]);
    expect(await exists(path.join(box.project, ".claude", "rules"))).toBe(false);
    expect(await listAll(box.dirs.state)).toEqual([]);
  });

  it("a file written but not yet confirmed (killed in between) is still recognised, updated and removed", async () => {
    const box = await makeSandbox();
    const key = await projectKey(box.project);
    const file = { path: MAIN, content: "# killed mid-way\n" };
    // This is the state on disk after a kill: the file exists, the manifest has it only as "pending".
    await fs.mkdir(path.join(box.project, ".claude", "rules"), { recursive: true });
    await fs.writeFile(path.join(box.project, MAIN), file.content, { mode: 0o600 });
    const manifest = emptyManifest();
    manifest.pending.set(MAIN, sha256(file.content));
    await writeManifest(box.dirs.state, key, manifest);

    const updated = await writeRuleFiles({ projectRoot: box.project, stateDir: box.dirs.state, files: [{ path: MAIN, content: "# v2\n" }] });
    expect(updated.written).toEqual([MAIN]);
    expect(updated.keptUnmanaged).toEqual([]);

    await writeManifest(box.dirs.state, key, Object.assign(emptyManifest(), { pending: new Map([[MAIN, sha256("# v2\n")]]) }));
    const gone = await remove(box);
    expect(gone.files.deleted).toEqual([MAIN]);
  });

  it("the hook entry itself finishes a big job over several runs", async () => {
    const box = await linkedProject(many);
    await sessionStart(box, { deadline: Date.now() - 1 }); // already over: stops cleanly before the first file
    expect((await fs.readdir(path.join(box.project, ".claude", "rules"))).length).toBeLessThan(40);
    await sessionStart(box);
    expect((await fs.readdir(path.join(box.project, ".claude", "rules"))).length).toBe(40);
  });
});

describe.skipIf(!POSIX)("M2: a FIFO where a file is expected never hangs", () => {
  const fifo = (p: string) => execFileSync("mkfifo", [p]);

  it("status reports the FIFO rule file as a problem, quickly", async () => {
    const box = await linkedProject();
    await sessionStart(box);
    await fs.rm(path.join(box.project, MAIN));
    fifo(path.join(box.project, MAIN));
    const { value } = await within2s(() => cli(box, ["status"]));
    expect(value?.code).toBe(1);
    expect(value?.out).toContain("can't be read safely");
  });

  it("status and remove survive a FIFO .gitignore", async () => {
    const box = await linkedProject();
    await sessionStart(box);
    await fs.rm(path.join(box.project, ".gitignore"));
    fifo(path.join(box.project, ".gitignore"));
    const status = await within2s(() => cli(box, ["status"]));
    expect(status.value?.code).toBe(1);
    expect(status.value?.out).toContain(".gitignore block:    error");
    const removed = await within2s(() => remove(box));
    expect(removed.error).toBeInstanceOf(Error); // a clear refusal, not a hang
  });

  it("remove refuses (fast) when a rule file is a FIFO", async () => {
    const box = await linkedProject();
    await sessionStart(box);
    await fs.rm(path.join(box.project, PAY));
    fifo(path.join(box.project, PAY));
    const removed = await within2s(() => remove(box));
    expect(removed.error).toBeInstanceOf(Error);
  });

  it("the hook exits 0 with no output, quickly, with a FIFO as a rule file, .gitignore, manifest or cache", async () => {
    const box = await linkedProject();
    await fs.mkdir(path.join(box.project, ".claude", "rules"), { recursive: true });
    fifo(path.join(box.project, MAIN));
    const a = await within2s(() => cli(box, ["hook", "session-start"]));
    expect(a.value).toEqual({ code: 0, out: "", err: "" });

    const box2 = await linkedProject();
    fifo(path.join(box2.project, ".gitignore"));
    const b = await within2s(() => cli(box2, ["hook", "session-start"]));
    expect(b.value).toEqual({ code: 0, out: "", err: "" });

    const box3 = await linkedProject();
    const cachePath = path.join(box3.dirs.cache, "projects", await projectKey(box3.project), "rules.json");
    await fs.rm(cachePath);
    fifo(cachePath);
    const c = await within2s(() => cli(box3, ["hook", "session-start"]));
    expect(c.value).toEqual({ code: 0, out: "", err: "" });
    expect(await exists(path.join(box3.project, ".claude"))).toBe(false);
  });
});

describe("M3: leftover temp files", () => {
  const OLD = ".axiomic.md.0123456789abcdef.tmp";
  const FRESH = ".axiomic-payments.md.fedcba9876543210.tmp";

  it("the ignore block covers them", async () => {
    expect(GITIGNORE_BODY).toContain("/.claude/rules/.axiomic*.tmp");
    const box = await linkedProject();
    if (!(await gitInit(box.project))) return;
    await sessionStart(box);
    expect(await gitNotIgnored(box.project, [`.claude/rules/${OLD}`])).toEqual([]);
  });

  it("a write sweeps stale temp files (our exact pattern, regular files only); remove sweeps all", async () => {
    const box = await linkedProject();
    const dir = path.join(box.project, ".claude", "rules");
    await fs.mkdir(dir, { recursive: true });
    const old = new Date(Date.now() - 60_000);
    await fs.writeFile(path.join(dir, OLD), "stale secret rules");
    await fs.utimes(path.join(dir, OLD), old, old);
    await fs.writeFile(path.join(dir, FRESH), "maybe someone else is writing this");
    await fs.writeFile(path.join(dir, ".axiomic.md.tmp"), "not our pattern");
    await fs.mkdir(path.join(dir, ".axiomic-dir.md.0123456789abcdef.tmp"));
    await fs.writeFile(path.join(dir, "mine.tmp"), "user file");

    await sessionStart(box);
    const names = await fs.readdir(dir);
    expect(names).not.toContain(OLD);
    expect(names).toEqual(expect.arrayContaining([FRESH, ".axiomic.md.tmp", ".axiomic-dir.md.0123456789abcdef.tmp", "mine.tmp"]));

    const report = await remove(box);
    expect(report.tempFilesRemoved).toEqual([FRESH]);
    expect((await fs.readdir(dir)).sort()).toEqual([".axiomic-dir.md.0123456789abcdef.tmp", ".axiomic.md.tmp", "mine.tmp"]);
  });
});

describe("L2: remove never deletes an ignore file that existed before axiomic", () => {
  it("leaves a pre-existing empty .gitignore in place", async () => {
    const box = await linkedProject();
    await fs.writeFile(path.join(box.project, ".gitignore"), "");
    await sessionStart(box);
    expect(await fs.readFile(path.join(box.project, ".gitignore"), "utf8")).toContain(BLOCK_START);
    const report = await remove(box);
    expect(report.gitignore).toBe("emptied");
    expect(await fs.readFile(path.join(box.project, ".gitignore"), "utf8")).toBe("");
  });

  it("deletes a .gitignore axiomic created itself, but only while nothing else is in it", async () => {
    const box = await linkedProject();
    await sessionStart(box);
    expect((await remove(box)).gitignore).toBe("deleted-file");
    expect(await exists(path.join(box.project, ".gitignore"))).toBe(false);

    const box2 = await linkedProject();
    await sessionStart(box2);
    await fs.appendFile(path.join(box2.project, ".gitignore"), "build/\n");
    expect((await remove(box2)).gitignore).toBe("removed");
    expect(await fs.readFile(path.join(box2.project, ".gitignore"), "utf8")).toBe("build/\n");
  });

  it("remembers the 'created' note across runs, and leaves a file of unknown origin alone", async () => {
    const box = await linkedProject();
    await sessionStart(box);
    await sessionStart(box); // second run must not forget it
    expect((await readManifest(box.dirs.state, await projectKey(box.project))).ignoreFilesCreated.has(".gitignore")).toBe(true);

    const orphan = await linkedProject();
    await sessionStart(orphan);
    await fs.rm(path.join(orphan.dirs.state), { recursive: true }); // the record is gone: origin unknown
    await fs.rm(path.join(orphan.project, ".claude"), { recursive: true });
    expect((await remove(orphan)).gitignore).toBe("emptied");
    expect(await exists(path.join(orphan.project, ".gitignore"))).toBe(true);
  });
});

describe.skipIf(!POSIX)("L3: .gitignore is not edited for a write that will be refused", () => {
  it("a symlinked .claude leaves .gitignore untouched", async () => {
    const box = await linkedProject();
    const outside = path.join(box.base, "outside");
    mkdirSync(outside);
    await fs.symlink(outside, path.join(box.project, ".claude"));
    await expect(sessionStart(box)).rejects.toThrow(/symlink/); // (the real hook swallows it)
    expect(await exists(path.join(box.project, ".gitignore"))).toBe(false);
    expect(await listAll(outside)).toEqual([]);
  });
});

describe("L5: status is fault-isolated", () => {
  it("a corrupt manifest is reported in the files section; everything else still prints; exit 1", async () => {
    const box = await linkedProject();
    await sessionStart(box);
    const key = await projectKey(box.project);
    await fs.writeFile(path.join(box.dirs.state, "projects", key, "manifest.json"), "{broken");
    const result = await cli(box, ["status"]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("damaged");
    expect(result.out).toContain("offline cache: version 3"); // a later section still ran
    expect(result.out).toContain(".gitignore block:    current");
  });

  it("a broken settings.json breaks only the hook section", async () => {
    const box = await linkedProject();
    await fs.mkdir(path.dirname(box.settingsPath), { recursive: true });
    await fs.writeFile(box.settingsPath, "{nope");
    const result = await cli(box, ["status"]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("Claude Code hook: PROBLEM");
    expect(result.out).toContain("Project:     ");
    expect(result.out).toContain("acme/web-app");
  });

  it.skipIf(!POSIX || process.getuid?.() === 0)("an unreadable folder while looking for the project is a project error, not a crash", async () => {
    const box = await makeSandbox();
    const locked = path.join(box.base, "locked");
    await fs.mkdir(path.join(locked, "inner"), { recursive: true });
    await fs.chmod(locked, 0o000);
    try {
      const result = await cli(box, ["status"], path.join(locked, "inner"));
      expect(result.code).toBe(1);
      expect(result.out).toContain("Server:");
      expect(result.out).toContain("couldn't look for the project");
    } finally {
      await fs.chmod(locked, 0o700);
    }
  });
});


describe("N1: the innermost repository answers; unknown inside a repo fails closed", () => {
  it("a nested repo in .claude/rules that does not ignore the files stops the write", async () => {
    const box = await linkedProject();
    if (!(await gitInit(box.project))) return;
    await fs.mkdir(path.join(box.project, ".claude", "rules"), { recursive: true });
    await gitInit(path.join(box.project, ".claude", "rules")); // outer .gitignore would ignore them, the inner repo doesn't
    await sessionStart(box).catch(() => undefined);
    expect(await listAll(path.join(box.project, ".claude"))).not.toContain("rules/axiomic.md");
    expect(await exists(path.join(box.project, MAIN))).toBe(false);
  });

  it("a broken submodule-style .claude (Git exits 128) writes nothing, and the hook still exits 0 silently", async () => {
    const box = await linkedProject();
    if (!(await gitInit(box.project))) return;
    await fs.mkdir(path.join(box.project, ".claude"));
    await fs.writeFile(path.join(box.project, ".claude", ".git"), "gitdir: /nonexistent/modules/claude\n");
    await expect(sessionStart(box)).rejects.toThrow(/could not confirm/);
    expect(await exists(path.join(box.project, MAIN))).toBe(false);
    expect(await cli(box, ["hook", "session-start"])).toEqual({ code: 0, out: "", err: "" });
  });
});

describe("N3: the check runs on every run, not only when writing", () => {
  const unignore = (box: Sandbox) => fs.appendFile(path.join(box.project, ".gitignore"), "!/.claude/rules/axiomic.md\n!/.claude/rules/axiomic-*.md\n");

  it("removes unmodified, untracked, now-exposed files; keeps edited and tracked ones", async () => {
    const box = await linkedProject([...TWO, { path: ".claude/rules/axiomic-ops.md", content: "# ops\n" }]);
    if (!(await gitInit(box.project))) return;
    await sessionStart(box);
    const OPS = ".claude/rules/axiomic-ops.md";
    await fs.writeFile(path.join(box.project, PAY), "my edit\n"); // edited
    await run("git", ["add", "-f", OPS], { cwd: box.project }); // tracked
    await unignore(box);

    await expect(sessionStart(box)).rejects.toThrow(/would not ignore/);
    expect(await exists(path.join(box.project, MAIN))).toBe(false); // unmodified + untracked: removed
    expect(await fs.readFile(path.join(box.project, PAY), "utf8")).toBe("my edit\n"); // local edit never lost
    expect(await exists(path.join(box.project, OPS))).toBe(true); // tracked: left, status reports it
    const manifest = await readManifest(box.dirs.state, await projectKey(box.project));
    expect(manifest.files.has(MAIN)).toBe(false);
    expect(manifest.files.has(PAY)).toBe(true);
  });
});

describe("N2: cut-off runs in a row never make an untouched file look edited", () => {
  const rule = (n: number) => Array.from({ length: 6 }, (_, i) => ({ path: `.claude/rules/axiomic-m${i}.md`, content: `# module ${i} v${n}\n` }));

  it("interrupts at every step of every round (simulating a kill) and still converges", async () => {
    const box = await makeSandbox();
    const key = await projectKey(box.project);
    const manifestFile = path.join(box.dirs.state, "projects", key, "manifest.json");
    let version = 0; // the rules change on EVERY run, so a cut-off run leaves old content behind
    /** One run of the writer that is cut off after `stopAfter` clock checks; with `kill`, the manifest is rewound to how a real kill leaves it. */
    const cutOff = async (stopAfter: number, kill: boolean) => {
      version++;
      let calls = 0;
      let snapshot: string | undefined;
      const before = await fs.readFile(manifestFile, "utf8").catch(() => "");
      const now = () => {
        calls++;
        let text = "";
        try {
          text = readFileSync(manifestFile, "utf8");
        } catch {
          /* no manifest yet */
        }
        // The first reading that differs from the previous run's manifest is the one right after the "pending" save.
        if (snapshot === undefined && text !== before) snapshot = text;
        return calls <= stopAfter ? 0 : 1_000_000;
      };
      const report = await writeRuleFiles({ projectRoot: box.project, stateDir: box.dirs.state, files: rule(version), deadline: 500_000, now });
      expect(report.keptModified, `version ${version} stop ${stopAfter} kill ${kill}`).toEqual([]);
      // A real kill leaves the manifest as it was right after the pending save, while the files written so far stay.
      if (kill && snapshot !== undefined) await fs.writeFile(manifestFile, snapshot);
    };
    // Every combination: a run cut off at step a (killed or stopped cleanly), then a run cut off at step b.
    for (const kill of [true, false]) {
      for (let a = 0; a <= 7; a++) {
        for (let b = 0; b <= 7; b++) {
          await cutOff(a, kill);
          await cutOff(b, false);
        }
      }
    }
    const done = await writeRuleFiles({ projectRoot: box.project, stateDir: box.dirs.state, files: rule(version + 1) });
    expect(done.keptModified).toEqual([]);
    expect(done.deferred).toEqual([]);
    for (let i = 0; i < 6; i++) expect(await fs.readFile(path.join(box.project, `.claude/rules/axiomic-m${i}.md`), "utf8")).toBe(`# module ${i} v${version + 1}\n`);
  }, 60_000);
});

describe("N4: case-changed folders", () => {
  it("refuses .Claude/Rules on a case-insensitive disk", async () => {
    const box = await linkedProject();
    await fs.mkdir(path.join(box.project, ".Claude", "Rules"), { recursive: true });
    if (!(await exists(path.join(box.project, ".claude")))) return; // case-sensitive disk: the problem can't occur
    await expect(sessionStart(box)).rejects.toThrow(/spelled/);
    expect(await listAll(path.join(box.project, ".Claude"))).toEqual([]);
  });
});

describe("L2 (second round): a tracked ignore file is never deleted", () => {
  it("axiomic creates .gitignore, the user replaces it with their own committed empty one, remove keeps it", async () => {
    const box = await linkedProject();
    if (!(await gitInit(box.project))) return;
    await sessionStart(box); // creates .gitignore
    await fs.rm(path.join(box.project, ".gitignore"));
    await fs.writeFile(path.join(box.project, ".gitignore"), "");
    await run("git", ["add", ".gitignore"], { cwd: box.project });
    await sessionStart(box); // re-adds the block to their file
    expect((await remove(box)).gitignore).toBe("emptied");
    expect(await fs.readFile(path.join(box.project, ".gitignore"), "utf8")).toBe("");
  });
});
