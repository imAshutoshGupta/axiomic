import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { emptyManifest, deleteManifest, manifestPath, readManifest, writeManifest } from "../../src/local-files/manifest";
import { sha256 } from "../../src/utils/fs-safe";
import { POSIX, listAll, makeSandbox, modeOf } from "../helpers/test-helpers";

const KEY = "0123456789abcdef0123456789abcdef";
const MAIN = ".claude/rules/axiomic.md";
const PAY = ".claude/rules/axiomic-payments.md";

describe("manifest", () => {
  it("reads as empty when there is none", async () => {
    const box = await makeSandbox();
    expect((await readManifest(box.dirs.state, KEY)).files.size).toBe(0);
  });

  it("round-trips, owner-only, with sorted stable output and no temp files", async () => {
    const box = await makeSandbox();
    const manifest = emptyManifest();
    manifest.files.set(PAY, sha256("b"));
    manifest.files.set(MAIN, sha256("a"));
    await writeManifest(box.dirs.state, KEY, manifest);

    expect([...(await readManifest(box.dirs.state, KEY)).files]).toEqual([...manifest.files].sort(([a], [b]) => a.localeCompare(b)));
    expect(await listAll(box.dirs.state)).toEqual([path.join("projects", KEY, "manifest.json")]);
    if (POSIX) expect(await modeOf(manifestPath(box.dirs.state, KEY))).toBe(0o600);
  });

  it("refuses a made-up key, so a key can never contain a path", async () => {
    const box = await makeSandbox();
    expect(() => manifestPath(box.dirs.state, "../../etc")).toThrow(/Invalid project key/);
  });

  it.each([
    ["a path that is not a managed rule file", { [".git/hooks/pre-commit"]: { sha256: sha256("x") } }],
    ["a traversal path", { [".claude/rules/axiomic-../../x.md"]: { sha256: sha256("x") } }],
    ["CLAUDE.md", { "CLAUDE.md": { sha256: sha256("x") } }],
    ["a bad hash", { [MAIN]: { sha256: "nothex" } }],
    ["an entry that is not an object", { [MAIN]: null }],
  ])("rejects %s, so a tampered manifest can never make axiomic delete another file", async (_name, files) => {
    const box = await makeSandbox();
    await writeManifest(box.dirs.state, KEY, emptyManifest());
    await fs.writeFile(manifestPath(box.dirs.state, KEY), JSON.stringify({ schemaVersion: 1, files }));
    await expect(readManifest(box.dirs.state, KEY)).rejects.toThrow(/damaged/);
  });

  it("rejects an unknown schemaVersion and a symlinked manifest", async () => {
    const box = await makeSandbox();
    await writeManifest(box.dirs.state, KEY, emptyManifest());
    const file = manifestPath(box.dirs.state, KEY);
    await fs.writeFile(file, JSON.stringify({ schemaVersion: 2, files: {} }));
    await expect(readManifest(box.dirs.state, KEY)).rejects.toThrow(/damaged/);

    await fs.rm(file);
    const elsewhere = path.join(box.base, "elsewhere.json");
    await fs.writeFile(elsewhere, JSON.stringify({ schemaVersion: 1, files: {} }));
    await fs.symlink(elsewhere, file);
    await expect(readManifest(box.dirs.state, KEY)).rejects.toThrow();
  });

  it("deleteManifest removes the file and its empty folder, and says whether one existed", async () => {
    const box = await makeSandbox();
    await writeManifest(box.dirs.state, KEY, emptyManifest());
    expect(await deleteManifest(box.dirs.state, KEY)).toBe(true);
    expect(await listAll(box.dirs.state)).toEqual([]);
    expect(await deleteManifest(box.dirs.state, KEY)).toBe(false);
  });
});
