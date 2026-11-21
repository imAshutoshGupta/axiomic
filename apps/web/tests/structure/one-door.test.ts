import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// DB-DESIGN 10 (S1): lib/db.ts is the only file that may import the database driver.
// Any other import could run queries without withUser() setting the role and claims.
const ROOT = join(import.meta.dirname, "..", "..", "..", ".."); // repo root
const SKIP = new Set(["node_modules", ".next", "dist", ".git", "coverage"]);
const DRIVER = /(?:from\s+|import\s+|import\s*\(\s*|require\s*\(\s*)["'](?:postgres|pg|pg-promise|@neondatabase\/[^"']+|@vercel\/postgres)["']/;

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(c|m)?(t|j)sx?$/.test(name)) yield p;
  }
}

describe("one door to the database", () => {
  it("only apps/web/lib/db.ts imports a Postgres driver", () => {
    const offenders: string[] = [];
    for (const dir of ["apps", "packages"]) {
      for (const f of files(join(ROOT, dir))) {
        const rel = relative(ROOT, f);
        if (rel === join("apps", "web", "lib", "db.ts")) continue;
        if (DRIVER.test(readFileSync(f, "utf8"))) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
  it("db.ts really does import it (the test isn't looking at nothing)", () => {
    expect(DRIVER.test(readFileSync(join(ROOT, "apps/web/lib/db.ts"), "utf8"))).toBe(true);
  });
});
