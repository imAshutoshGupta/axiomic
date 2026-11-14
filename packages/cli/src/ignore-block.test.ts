import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BLOCK_END,
  BLOCK_START,
  DOCKERIGNORE_BODY,
  GITIGNORE_BODY,
  blockStatus,
  ensureBlockInFile,
  ensureIgnoreBlocks,
  removeBlock,
  removeBlockFromFile,
  upsertBlock,
} from "./ignore-block";
import { UnsafePathError } from "./fs-safe";
import { POSIX, makeTempDir, modeOf } from "./test-helpers";

const BLOCK = [BLOCK_START, ...GITIGNORE_BODY, BLOCK_END].join("\n") + "\n";

describe("managed block (text)", () => {
  it("creates the block in an empty file", () => {
    expect(upsertBlock("", GITIGNORE_BODY)).toBe(BLOCK);
  });

  it("appends to existing content and is idempotent", () => {
    const once = upsertBlock("node_modules\ndist\n", GITIGNORE_BODY);
    expect(once).toBe("node_modules\ndist\n" + BLOCK);
    expect(upsertBlock(once, GITIGNORE_BODY)).toBe(once);
    expect(blockStatus(once, GITIGNORE_BODY)).toBe("current");
    expect(removeBlock(once)).toBe("node_modules\ndist\n");
  });

  it("adds a missing final line break before the block, and removal keeps the user's lines", () => {
    const once = upsertBlock("node_modules", GITIGNORE_BODY);
    expect(once).toBe("node_modules\n" + BLOCK);
    expect(removeBlock(once)).toBe("node_modules\n");
  });

  it("keeps CRLF files CRLF", () => {
    const once = upsertBlock("node_modules\r\ndist\r\n", GITIGNORE_BODY);
    expect(once).toBe("node_modules\r\ndist\r\n" + BLOCK.replace(/\n/g, "\r\n"));
    expect(once.replace(/\r\n/g, "")).not.toContain("\n");
    expect(upsertBlock(once, GITIGNORE_BODY)).toBe(once);
    expect(removeBlock(once)).toBe("node_modules\r\ndist\r\n");
  });

  it("updates an outdated block in place, keeping what is around it", () => {
    const old = `a\n${BLOCK_START}\nold-line\n${BLOCK_END}\nz\n`;
    expect(blockStatus(old, GITIGNORE_BODY)).toBe("outdated");
    expect(upsertBlock(old, GITIGNORE_BODY)).toBe("a\n" + BLOCK + "z\n");
  });

  it("merges duplicate blocks into one", () => {
    const twice = `a\n${BLOCK}b\n${BLOCK}c\n`;
    expect(upsertBlock(twice, GITIGNORE_BODY)).toBe("a\n" + BLOCK + "b\nc\n");
    expect(removeBlock(twice)).toBe("a\nb\nc\n");
  });

  it("repairs a block with no end marker without deleting the user's lines", () => {
    const damaged = `a\n${BLOCK_START}\n/.claude/rules/axiomic.md\nuser-line\n`;
    const fixed = upsertBlock(damaged, GITIGNORE_BODY);
    expect(fixed).toBe("a\n" + BLOCK + "/.claude/rules/axiomic.md\nuser-line\n");
    expect(upsertBlock(fixed, GITIGNORE_BODY)).toBe(fixed);
    expect(removeBlock(damaged)).toBe("a\n/.claude/rules/axiomic.md\nuser-line\n");
  });

  it("drops a stray end marker", () => {
    const damaged = `a\n${BLOCK_END}\nb\n`;
    expect(blockStatus(damaged, GITIGNORE_BODY)).toBe("outdated");
    expect(upsertBlock(damaged, GITIGNORE_BODY)).toBe("a\n" + BLOCK + "b\n");
    expect(removeBlock(damaged)).toBe("a\nb\n");
  });

  it("reports missing when there is no block", () => {
    expect(blockStatus("node_modules\n# axiomic is great\n", GITIGNORE_BODY)).toBe("missing");
    expect(removeBlock("x\n# axiomic is great\n")).toBe("x\n# axiomic is great\n");
  });
});

describe("managed block (files)", () => {
  it("creates .gitignore, keeps an existing file's mode, and reports unchanged the second time", async () => {
    const root = await makeTempDir();
    const file = path.join(root, ".gitignore");
    expect(await ensureBlockInFile(file, GITIGNORE_BODY, { createIfMissing: true })).toBe("created");
    expect(await ensureBlockInFile(file, GITIGNORE_BODY, { createIfMissing: true })).toBe("unchanged");

    const other = path.join(root, "other");
    await fs.writeFile(other, "x\n", { mode: 0o640 });
    if (POSIX) await fs.chmod(other, 0o640);
    expect(await ensureBlockInFile(other, GITIGNORE_BODY, { createIfMissing: true })).toBe("updated");
    if (POSIX) expect(await modeOf(other)).toBe(0o640);
    expect((await fs.readdir(root)).sort()).toEqual([".gitignore", "other"]);
  });

  it("does not create or change anything in a dry run", async () => {
    const root = await makeTempDir();
    expect(await ensureBlockInFile(path.join(root, ".gitignore"), GITIGNORE_BODY, { createIfMissing: true, dryRun: true })).toBe("created");
    expect(await fs.readdir(root)).toEqual([]);
  });

  it("refuses a symlinked .gitignore", async () => {
    const root = await makeTempDir();
    const outside = path.join(await makeTempDir(), "target");
    await fs.writeFile(outside, "keep\n");
    await fs.symlink(outside, path.join(root, ".gitignore"));
    await expect(ensureBlockInFile(path.join(root, ".gitignore"), GITIGNORE_BODY, { createIfMissing: true })).rejects.toBeInstanceOf(UnsafePathError);
    expect(await fs.readFile(outside, "utf8")).toBe("keep\n");
  });

  it("only creates .dockerignore when the project builds Docker images", async () => {
    const plain = await makeTempDir();
    expect(await ensureIgnoreBlocks(plain)).toEqual({ gitignore: "created", dockerignore: "skipped" });
    expect(await fs.readdir(plain)).toEqual([".gitignore"]);

    const docker = await makeTempDir();
    await fs.writeFile(path.join(docker, "Dockerfile"), "FROM scratch\n");
    expect(await ensureIgnoreBlocks(docker)).toEqual({ gitignore: "created", dockerignore: "created" });
    expect(await fs.readFile(path.join(docker, ".dockerignore"), "utf8")).toBe([BLOCK_START, ...DOCKERIGNORE_BODY, BLOCK_END].join("\n") + "\n");

    const existing = await makeTempDir();
    await fs.writeFile(path.join(existing, ".dockerignore"), "node_modules\n");
    expect((await ensureIgnoreBlocks(existing)).dockerignore).toBe("updated");
  });

  it("removes the block; deletes the file only if nothing else was in it", async () => {
    const root = await makeTempDir();
    const file = path.join(root, ".gitignore");
    await fs.writeFile(file, "dist\n" + BLOCK);
    expect(await removeBlockFromFile(file)).toBe("removed");
    expect(await fs.readFile(file, "utf8")).toBe("dist\n");
    expect(await removeBlockFromFile(file)).toBe("absent");

    // Only a file axiomic created (createdByAxiomic) may be deleted once nothing else is in it.
    await fs.writeFile(file, BLOCK);
    expect(await removeBlockFromFile(file, { dryRun: true, createdByAxiomic: true })).toBe("deleted-file");
    expect(await fs.readFile(file, "utf8")).toBe(BLOCK);
    expect(await removeBlockFromFile(file, { createdByAxiomic: true })).toBe("deleted-file");
    expect(await fs.readdir(root)).toEqual([]);

    // L2: a file that existed before axiomic (or whose origin is unknown) is emptied, never deleted.
    await fs.writeFile(file, BLOCK);
    expect(await removeBlockFromFile(file)).toBe("emptied");
    expect(await fs.readFile(file, "utf8")).toBe("");
  });
});
