import { promises as fs } from "node:fs";
import path from "node:path";
import { merge, renderClaude, type RenderedFile } from "@axiomic/shared";
import { describe, expect, it } from "vitest";
import { UnsafePathError, writeFileAtomic } from "./fs-safe";
import { isManagedRulePath } from "./managed-paths";
import { readManifest } from "./manifest";
import { projectKey } from "./project-key";
import { POSIX, exists, listAll, makeSandbox, modeOf, type Sandbox } from "./test-helpers";
import { validateRenderedFiles, writeRuleFiles } from "./writer";

const MAIN = ".claude/rules/axiomic.md";
const PAY = ".claude/rules/axiomic-payments.md";

/** Real output from the shared package, so the writer is tested against the true shape. */
function render(text: string, withModule = true): RenderedFile[] {
  const result = merge({
    company: [{ id: "c1", title: "Testing", body: text, locked: false }],
    team: [],
    project: [],
    modules: withModule ? [{ id: "m1", name: "payments", path: "src/payments", rules: [{ id: "r1", title: "Money", body: text }] }] : [],
    personal: [],
  });
  return renderClaude(result, 1);
}

function write(box: Sandbox, files: RenderedFile[], extra: { force?: boolean; dryRun?: boolean } = {}) {
  return writeRuleFiles({ projectRoot: box.project, stateDir: box.dirs.state, files, ...extra });
}

const read = (box: Sandbox, rel: string) => fs.readFile(path.join(box.project, rel), "utf8");

describe("allowed paths", () => {
  it("allows only axiomic.md and axiomic-<safe-name>.md in .claude/rules", () => {
    expect(isManagedRulePath(MAIN)).toBe(true);
    expect(isManagedRulePath(PAY)).toBe(true);
    for (const bad of [
      "CLAUDE.md",
      "AGENTS.md",
      ".claude/CLAUDE.md",
      ".claude/rules/other.md",
      ".claude/rules/axiomic.mdc",
      ".claude/rules/axiomic-.md",
      ".claude/rules/axiomic-Pay.md",
      ".claude/rules/axiomic-a/../../x.md",
      ".claude/rules/axiomic-a/b.md",
      ".claude/rules/../../axiomic.md",
      "../.claude/rules/axiomic.md",
      "/.claude/rules/axiomic.md",
      "/etc/passwd",
      ".git/hooks/pre-commit",
      ".claude\\rules\\axiomic.md",
      ".claude/rules/axiomic-a\u0000.md",
      "./.claude/rules/axiomic.md",
      "",
    ]) {
      expect(isManagedRulePath(bad), bad).toBe(false);
    }
  });

  it("writes nothing at all if any one path is bad", async () => {
    const box = await makeSandbox();
    const files = [...render("a"), { path: "../escaped.md", content: "x" }];
    await expect(write(box, files)).rejects.toBeInstanceOf(UnsafePathError);
    await expect(write(box, [{ path: "CLAUDE.md", content: "x" }])).rejects.toBeInstanceOf(UnsafePathError);
    expect(await listAll(box.base)).toEqual([]);
  });

  it("rejects duplicates and non-string content", () => {
    expect(() => validateRenderedFiles([{ path: MAIN, content: "a" }, { path: MAIN, content: "b" }])).toThrow(/twice/);
    expect(() => validateRenderedFiles([{ path: MAIN, content: 5 as unknown as string }])).toThrow();
  });
});

describe("writeRuleFiles", () => {
  it("writes the files owner-only, records their hashes outside the repo, and leaves no temp files", async () => {
    const box = await makeSandbox();
    const files = render("first");
    const report = await write(box, files);
    expect(report.written).toEqual([MAIN, PAY]);
    expect(await read(box, MAIN)).toBe(files[0]!.content);
    expect(await listAll(box.project)).toEqual([PAY, MAIN]); // sorted by code point: "-" comes before "."
    if (POSIX) expect(await modeOf(path.join(box.project, MAIN))).toBe(0o600);

    const manifest = await readManifest(box.dirs.state, await projectKey(box.project));
    expect([...manifest.files.keys()].sort()).toEqual([PAY, MAIN]);
    expect((await listAll(box.dirs.state)).every((f) => f.endsWith("manifest.json"))).toBe(true);
  });

  it("is a no-op the second time", async () => {
    const box = await makeSandbox();
    await write(box, render("same"));
    const report = await write(box, render("same"));
    expect(report).toMatchObject({ written: [], unchanged: [MAIN, PAY], deleted: [] });
  });

  it("updates unmodified files, keeps locally modified ones, and removes stale ones", async () => {
    const box = await makeSandbox();
    await write(box, render("v1"));
    await fs.appendFile(path.join(box.project, PAY), "\nmy local note\n");

    const v2 = render("v2");
    const report = await write(box, v2);
    expect(report.written).toEqual([MAIN]);
    expect(report.keptModified).toEqual([PAY]);
    expect(await read(box, MAIN)).toBe(v2[0]!.content);
    expect(await read(box, PAY)).toContain("my local note");

    // The module is gone from the rules: its edited file is still kept, and stays flagged.
    const again = await write(box, render("v2", false));
    expect(again.keptModified).toEqual([PAY]);
    expect(await exists(path.join(box.project, PAY))).toBe(true);
  });

  it("removes a stale file that nobody edited", async () => {
    const box = await makeSandbox();
    await write(box, render("v1"));
    const report = await write(box, render("v1", false));
    expect(report.deleted).toEqual([PAY]);
    expect(await listAll(box.project)).toEqual([MAIN]);
  });

  it("never clobbers a file it didn't write", async () => {
    const box = await makeSandbox();
    await fs.mkdir(path.join(box.project, ".claude/rules"), { recursive: true });
    await fs.writeFile(path.join(box.project, MAIN), "written by a human");
    const report = await write(box, render("v1", false));
    expect(report.keptUnmanaged).toEqual([MAIN]);
    expect(report.written).toEqual([]);
    expect(await read(box, MAIN)).toBe("written by a human");
  });

  it("overwrites edits only with force, and says so", async () => {
    const box = await makeSandbox();
    await write(box, render("v1", false));
    await fs.writeFile(path.join(box.project, MAIN), "edited");
    const v2 = render("v2", false);
    const report = await write(box, v2, { force: true });
    expect(report.forced).toEqual([MAIN]);
    expect(report.written).toEqual([MAIN]);
    expect(await read(box, MAIN)).toBe(v2[0]!.content);
  });

  it("changes nothing in a dry run", async () => {
    const box = await makeSandbox();
    const report = await write(box, render("v1"), { dryRun: true });
    expect(report.written).toEqual([MAIN, PAY]);
    expect(await listAll(box.base)).toEqual([]);
  });

  it("leaves the user's other files in .claude alone", async () => {
    const box = await makeSandbox();
    await fs.mkdir(path.join(box.project, ".claude/rules"), { recursive: true });
    await fs.writeFile(path.join(box.project, ".claude/rules/mine.md"), "mine");
    await fs.writeFile(path.join(box.project, "CLAUDE.md"), "repo's own");
    await write(box, render("v1"));
    await write(box, []);
    expect(await listAll(box.project)).toEqual([".claude/rules/mine.md", "CLAUDE.md"]);
    expect(await read(box, "CLAUDE.md")).toBe("repo's own");
  });
});

describe("symlinks", () => {
  it.each([".claude", ".claude/rules"])("refuses to write when %s is a symlink out of the project", async (linkAt) => {
    const box = await makeSandbox();
    const outside = path.join(box.base, "outside");
    await fs.mkdir(outside);
    await fs.mkdir(path.dirname(path.join(box.project, linkAt)), { recursive: true });
    await fs.symlink(outside, path.join(box.project, linkAt));
    await expect(write(box, render("v1"))).rejects.toBeInstanceOf(UnsafePathError);
    expect(await listAll(outside)).toEqual([]);
  });

  it("refuses when the rule file itself is a symlink, and leaves its target untouched", async () => {
    const box = await makeSandbox();
    const victim = path.join(box.base, "victim.txt");
    await fs.writeFile(victim, "precious");
    await fs.mkdir(path.join(box.project, ".claude/rules"), { recursive: true });
    await fs.symlink(victim, path.join(box.project, MAIN));
    await expect(write(box, render("v1"))).rejects.toBeInstanceOf(UnsafePathError);
    await expect(write(box, render("v1"), { force: true })).rejects.toBeInstanceOf(UnsafePathError);
    expect(await fs.readFile(victim, "utf8")).toBe("precious");
  });

  it("refuses a symlink even inside the project (.claude/rules → src)", async () => {
    const box = await makeSandbox();
    await fs.mkdir(path.join(box.project, "src"));
    await fs.mkdir(path.join(box.project, ".claude"));
    await fs.symlink(path.join(box.project, "src"), path.join(box.project, ".claude/rules"));
    await expect(write(box, render("v1"))).rejects.toBeInstanceOf(UnsafePathError);
    expect(await fs.readdir(path.join(box.project, "src"))).toEqual([]);
  });
});

describe("writeFileAtomic", () => {
  it("replaces the content in one step and sets the mode", async () => {
    const box = await makeSandbox();
    const target = path.join(box.project, "file.txt");
    await fs.writeFile(target, "old", { mode: 0o644 });
    await writeFileAtomic(target, "new", 0o600);
    expect(await fs.readFile(target, "utf8")).toBe("new");
    if (POSIX) expect(await modeOf(target)).toBe(0o600);
    expect(await fs.readdir(box.project)).toEqual(["file.txt"]);
  });

  it("cleans up its temp file and keeps the target when the final rename fails", async () => {
    const box = await makeSandbox();
    const target = path.join(box.project, "taken");
    await fs.mkdir(target); // a folder sits where the file should go: rename must fail
    await fs.writeFile(path.join(target, "keep.txt"), "keep");
    await expect(writeFileAtomic(target, "new", 0o600)).rejects.toThrow();
    expect(await listAll(box.project)).toEqual(["taken/keep.txt"]);
  });

  it("replaces a symlink at the target instead of writing through it", async () => {
    const box = await makeSandbox();
    const victim = path.join(box.base, "victim.txt");
    await fs.writeFile(victim, "precious");
    const target = path.join(box.project, "link");
    await fs.symlink(victim, target);
    await writeFileAtomic(target, "new", 0o600);
    expect(await fs.readFile(victim, "utf8")).toBe("precious");
    expect((await fs.lstat(target)).isSymbolicLink()).toBe(false);
  });
});

describe("manifest", () => {
  it("treats a damaged manifest as an error, and rejects paths it could never have written", async () => {
    const box = await makeSandbox();
    await write(box, render("v1"));
    const key = await projectKey(box.project);
    const file = path.join(box.dirs.state, "projects", key, "manifest.json");
    if (POSIX) expect(await modeOf(file)).toBe(0o600);

    await fs.writeFile(file, JSON.stringify({ schemaVersion: 1, files: { "../../etc/passwd": { sha256: "a".repeat(64) } } }));
    await expect(readManifest(box.dirs.state, key)).rejects.toThrow(/damaged/);
    await expect(write(box, [])).rejects.toThrow(/damaged/);
    await fs.writeFile(file, "{nope");
    await expect(readManifest(box.dirs.state, key)).rejects.toThrow(/damaged/);
    expect(await listAll(box.project)).toEqual([PAY, MAIN]); // sorted by code point: "-" comes before "."
  });
});
