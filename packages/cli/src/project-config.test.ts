import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findProjectRoot, parseProjectConfig, readProjectConfig, writeProjectConfig } from "./project-config";
import { makeTempDir } from "./test-helpers";

describe("axiomic.json", () => {
  it("round-trips slugs only", async () => {
    const root = await makeTempDir();
    expect(await readProjectConfig(root)).toBeUndefined();
    await writeProjectConfig(root, { schemaVersion: 1, space: "acme", project: "web-app" });
    expect(await readProjectConfig(root)).toEqual({ schemaVersion: 1, space: "acme", project: "web-app" });
    expect(JSON.parse(await fs.readFile(path.join(root, "axiomic.json"), "utf8"))).toEqual({ schemaVersion: 1, space: "acme", project: "web-app" });
  });

  it.each([
    ["broken JSON", "{"],
    ["null", "null"],
    ["a list", "[]"],
    ["an unknown field", '{"schemaVersion":1,"space":"acme","project":"web","token":"x"}'],
    ["a __proto__ field", '{"schemaVersion":1,"space":"acme","project":"web","__proto__":{"x":1}}'],
    ["a future schemaVersion", '{"schemaVersion":2,"space":"acme","project":"web"}'],
    ["a missing schemaVersion", '{"space":"acme","project":"web"}'],
    ["a path as space", '{"schemaVersion":1,"space":"../acme","project":"web"}'],
    ["an upper-case slug", '{"schemaVersion":1,"space":"Acme","project":"web"}'],
    ["a number as project", '{"schemaVersion":1,"space":"acme","project":5}'],
  ])("rejects %s", (_name, text) => {
    expect(() => parseProjectConfig(text)).toThrow(/axiomic\.json/);
  });

  it("refuses to write an invalid config", async () => {
    const root = await makeTempDir();
    await expect(writeProjectConfig(root, { schemaVersion: 1, space: "a b", project: "web" })).rejects.toThrow();
    expect(await fs.readdir(root)).toEqual([]);
  });

  it("finds the nearest project root by walking up", async () => {
    const base = await makeTempDir();
    const outer = path.join(base, "outer");
    const inner = path.join(outer, "packages", "inner");
    const deep = path.join(inner, "src", "a");
    await fs.mkdir(deep, { recursive: true });
    await writeProjectConfig(outer, { schemaVersion: 1, space: "acme", project: "outer" });
    expect(await findProjectRoot(deep)).toBe(outer);
    await writeProjectConfig(inner, { schemaVersion: 1, space: "acme", project: "inner" });
    expect(await findProjectRoot(deep)).toBe(inner);
    expect(await findProjectRoot(path.join(outer, "packages"))).toBe(outer);
  });

  it("returns undefined when there is no axiomic.json (a folder with that name doesn't count)", async () => {
    const base = await makeTempDir();
    await fs.mkdir(path.join(base, "axiomic.json"));
    // Only meaningful if no real axiomic.json sits above the temp folder, which is true for os.tmpdir().
    expect(await findProjectRoot(base)).toBeUndefined();
  });
});
