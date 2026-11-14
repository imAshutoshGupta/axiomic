import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  UnsafePathError,
  fileExists,
  ensurePrivateDir,
  isInside,
  readFileNoFollow,
  removeDirIfEmpty,
  removeFileIfExists,
  sha256,
} from "./fs-safe";
import { POSIX, makeTempDir, modeOf } from "./test-helpers";

describe("test safety net", () => {
  it("points the home folder at a temp folder, never the real one", () => {
    expect(os.homedir().startsWith(os.tmpdir()) || os.homedir().startsWith("/private" + os.tmpdir())).toBe(true);
    expect(process.env.CLAUDE_CONFIG_DIR).toContain("axiomic-test-home-");
  });
});

describe("isInside", () => {
  it("accepts the folder itself and its children, refuses siblings and parents", () => {
    expect(isInside("/a/b", "/a/b")).toBe(true);
    expect(isInside("/a/b", "/a/b/c/d")).toBe(true);
    expect(isInside("/a/b", "/a/bc")).toBe(false);
    expect(isInside("/a/b", "/a")).toBe(false);
    expect(isInside("/a/b", "/a/b/../x")).toBe(false);
  });
});

describe("sha256", () => {
  it("is the standard hex digest", () => {
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("readFileNoFollow", () => {
  it("reads a normal file and returns undefined for a missing one", async () => {
    const dir = await makeTempDir();
    await fs.writeFile(path.join(dir, "a"), "hi");
    expect((await readFileNoFollow(path.join(dir, "a"), 100))?.toString()).toBe("hi");
    expect(await readFileNoFollow(path.join(dir, "missing"), 100)).toBeUndefined();
  });

  it("refuses a symlink, a folder, and a file over the size limit", async () => {
    const dir = await makeTempDir();
    await fs.writeFile(path.join(dir, "real"), "secret");
    await fs.symlink(path.join(dir, "real"), path.join(dir, "link"));
    await fs.mkdir(path.join(dir, "folder"));
    await fs.writeFile(path.join(dir, "big"), "x".repeat(50));
    await expect(readFileNoFollow(path.join(dir, "link"), 100)).rejects.toBeInstanceOf(UnsafePathError);
    await expect(readFileNoFollow(path.join(dir, "folder"), 100)).rejects.toBeInstanceOf(UnsafePathError);
    await expect(readFileNoFollow(path.join(dir, "big"), 10)).rejects.toThrow(/too large/);
  });
});

describe("removing things", () => {
  it("removeFileIfExists reports whether it deleted something, and removes a link, not its target", async () => {
    const dir = await makeTempDir();
    await fs.writeFile(path.join(dir, "real"), "keep me");
    await fs.symlink(path.join(dir, "real"), path.join(dir, "link"));
    expect(await removeFileIfExists(path.join(dir, "link"))).toBe(true);
    expect(await fs.readFile(path.join(dir, "real"), "utf8")).toBe("keep me");
    expect(await removeFileIfExists(path.join(dir, "link"))).toBe(false);
  });

  it("removeDirIfEmpty removes only an empty real folder", async () => {
    const dir = await makeTempDir();
    await fs.mkdir(path.join(dir, "empty"));
    await fs.mkdir(path.join(dir, "full"));
    await fs.writeFile(path.join(dir, "full", "x"), "1");
    await fs.mkdir(path.join(dir, "target"));
    await fs.symlink(path.join(dir, "target"), path.join(dir, "link"));

    expect(await removeDirIfEmpty(path.join(dir, "empty"))).toBe(true);
    expect(await removeDirIfEmpty(path.join(dir, "full"))).toBe(false);
    expect(await removeDirIfEmpty(path.join(dir, "link"))).toBe(false); // a link to an empty folder is left alone
    expect(await removeDirIfEmpty(path.join(dir, "missing"))).toBe(false);
    expect(await fs.readFile(path.join(dir, "full", "x"), "utf8")).toBe("1");
    expect((await fs.lstat(path.join(dir, "link"))).isSymbolicLink()).toBe(true);
  });
});

describe("ensurePrivateDir", () => {
  it("creates nested folders and refuses a file in the way", async () => {
    const dir = await makeTempDir();
    const nested = path.join(dir, "a", "b");
    await ensurePrivateDir(nested);
    if (POSIX) expect(await modeOf(nested)).toBe(0o700);
    await fs.writeFile(path.join(dir, "file"), "x");
    await expect(ensurePrivateDir(path.join(dir, "file"))).rejects.toThrow();
  });
});

describe.skipIf(!POSIX)("M2: non-regular files", () => {
  it("rejects a FIFO immediately instead of blocking forever", async () => {
    const dir = await makeTempDir();
    const fifo = path.join(dir, "pipe");
    execFileSync("mkfifo", [fifo]);
    const start = Date.now();
    await expect(readFileNoFollow(fifo, 1024)).rejects.toBeInstanceOf(UnsafePathError);
    expect(Date.now() - start).toBeLessThan(2000);
    await expect(readFileNoFollow(dir, 1024)).rejects.toBeInstanceOf(UnsafePathError); // a folder
    await fs.symlink(fifo, path.join(dir, "link"));
    await expect(readFileNoFollow(path.join(dir, "link"), 1024)).rejects.toBeInstanceOf(UnsafePathError);
  });

  it("fileExists follows links and reports a missing path as false", async () => {
    const dir = await makeTempDir();
    expect(await fileExists(dir)).toBe(true);
    expect(await fileExists(path.join(dir, "nope"))).toBe(false);
    await fs.symlink(path.join(dir, "nope"), path.join(dir, "dangling"));
    expect(await fileExists(path.join(dir, "dangling"))).toBe(false);
  });
});
