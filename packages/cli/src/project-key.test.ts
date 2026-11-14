import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sha256 } from "./fs-safe";
import { projectDataDir, projectKey } from "./project-key";
import { makeTempDir } from "./test-helpers";

describe("projectKey", () => {
  it("is 32 hex characters, stable, and different for different folders", async () => {
    const a = await makeTempDir();
    const b = await makeTempDir();
    expect(await projectKey(a)).toMatch(/^[0-9a-f]{32}$/);
    expect(await projectKey(a)).toBe(await projectKey(a));
    expect(await projectKey(a)).not.toBe(await projectKey(b));
  });

  it("is the same through a symlink, because it hashes the real path", async () => {
    const a = await makeTempDir();
    const link = path.join(await makeTempDir(), "link");
    await fs.symlink(a, link);
    expect(await projectKey(link)).toBe(await projectKey(a));
  });

  it("ignores letter case on Windows only", async () => {
    const dir = await makeTempDir();
    expect(await projectKey(dir, "win32")).toBe(sha256(dir.toLowerCase()).slice(0, 32));
    expect(await projectKey(dir, "linux")).toBe(sha256(dir).slice(0, 32));
  });

  it("projectDataDir refuses anything that is not a key", () => {
    expect(projectDataDir("/base", "0123456789abcdef0123456789abcdef")).toBe(path.join("/base", "projects", "0123456789abcdef0123456789abcdef"));
    for (const bad of ["", "../x", "0123456789ABCDEF0123456789ABCDEF", "short"]) expect(() => projectDataDir("/base", bad)).toThrow();
  });
});
