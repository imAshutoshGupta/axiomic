import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cacheFilePath, deleteCache, parseCacheEntry, readCache, writeCache, type CacheEntry } from "./cache";
import { projectDataDir, projectKey } from "./project-key";
import { POSIX, listAll, makeSandbox, modeOf } from "./test-helpers";

const entry: CacheEntry = {
  schemaVersion: 1,
  apiUrl: "https://axiomic.vercel.app",
  space: "acme",
  project: "web-app",
  version: 7,
  etag: '"abc"',
  fetchedAt: "2026-11-14T10:00:00.000Z",
  files: [{ path: ".claude/rules/axiomic.md", content: "# rules\n" }],
};

describe("offline cache", () => {
  it("round-trips, owner-only, in a folder named by a hash of the project path", async () => {
    const box = await makeSandbox();
    const key = await projectKey(box.project);
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(await readCache(box.dirs.cache, key)).toBeUndefined();

    await writeCache(box.dirs.cache, key, entry);
    expect(await readCache(box.dirs.cache, key)).toEqual(entry);
    expect(await listAll(box.dirs.cache)).toEqual([path.join("projects", key, "rules.json")]);
    if (POSIX) {
      expect(await modeOf(projectDataDir(box.dirs.cache, key))).toBe(0o700);
      expect(await modeOf(cacheFilePath(box.dirs.cache, key))).toBe(0o600);
    }

    expect(await deleteCache(box.dirs.cache, key)).toBe(true);
    expect(await deleteCache(box.dirs.cache, key)).toBe(false);
    expect(await listAll(box.dirs.cache)).toEqual([]);
  });

  it("gives two different folders two different keys, and refuses a made-up key", async () => {
    const box = await makeSandbox();
    expect(await projectKey(box.project)).not.toBe(await projectKey(box.home));
    expect(() => projectDataDir(box.dirs.cache, "../../etc")).toThrow();
  });

  it.each([
    ["garbage", "\u0000\u0001 not json"],
    ["an empty file", ""],
    ["half a file", JSON.stringify(entry).slice(0, 40)],
    ["a list", "[]"],
    ["an unknown schemaVersion", JSON.stringify({ ...entry, schemaVersion: 99 })],
    ["a path outside the allow-list", JSON.stringify({ ...entry, files: [{ path: "../../.ssh/authorized_keys", content: "x" }] })],
    ["CLAUDE.md", JSON.stringify({ ...entry, files: [{ path: "CLAUDE.md", content: "x" }] })],
    ["an http server", JSON.stringify({ ...entry, apiUrl: "http://evil.example.com" })],
    ["a bad slug", JSON.stringify({ ...entry, space: "../x" })],
    ["a negative version", JSON.stringify({ ...entry, version: -1 })],
  ])("treats %s as no cache, without throwing", async (_name, text) => {
    const box = await makeSandbox();
    const key = await projectKey(box.project);
    await fs.mkdir(projectDataDir(box.dirs.cache, key), { recursive: true });
    await fs.writeFile(cacheFilePath(box.dirs.cache, key), text);
    expect(await readCache(box.dirs.cache, key)).toBeUndefined();
  });

  it("treats a symlinked or folder-shaped cache file as no cache", async () => {
    const box = await makeSandbox();
    const key = await projectKey(box.project);
    await fs.mkdir(projectDataDir(box.dirs.cache, key), { recursive: true });
    const real = path.join(box.base, "real.json");
    await fs.writeFile(real, JSON.stringify(entry));
    await fs.symlink(real, cacheFilePath(box.dirs.cache, key));
    expect(await readCache(box.dirs.cache, key)).toBeUndefined();
    await fs.unlink(cacheFilePath(box.dirs.cache, key));
    await fs.mkdir(cacheFilePath(box.dirs.cache, key));
    expect(await readCache(box.dirs.cache, key)).toBeUndefined();
  });

  it("drops unknown fields and refuses to save an invalid entry", async () => {
    const box = await makeSandbox();
    const key = await projectKey(box.project);
    expect(parseCacheEntry(JSON.stringify({ ...entry, extra: "x", files: [{ ...entry.files[0], evil: true }] }))).toEqual(entry);
    await expect(writeCache(box.dirs.cache, key, { ...entry, files: [{ path: "AGENTS.md", content: "x" }] })).rejects.toThrow();
    expect(await listAll(box.base)).toEqual([]);
  });
});
