import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Signed-in pages live in app/(app). Its layout reads the session for the header, but a layout
// is NOT a lock: Next.js keeps it between page changes without re-running it. So every page,
// and every server action (callable by a POST from anywhere on our origin), must check the
// session itself. The database's row-level security is the second lock behind both.
const APP = join(import.meta.dirname, "..", "..", "app", "(app)");

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else yield p;
  }
}

const all = [...files(APP)];
const pages = all.filter((f) => /[/\\]page\.tsx$/.test(f));
const actionFiles = all.filter((f) => /\.tsx?$/.test(f) && /^\s*["']use server["']/.test(readFileSync(f, "utf8")));

describe("signed-in pages check the session themselves", () => {
  it("finds the pages and the action files (the test isn't looking at nothing)", () => {
    expect(pages.length).toBeGreaterThanOrEqual(3);
    expect(actionFiles.length).toBeGreaterThanOrEqual(2);
  });

  it("every page under (app) calls getVerifiedClaims()", () => {
    const missing = pages.filter((f) => !readFileSync(f, "utf8").includes("getVerifiedClaims()"));
    expect(missing.map((f) => relative(APP, f))).toEqual([]);
  });

  it("every exported server action calls getVerifiedClaims() in its own body", () => {
    const missing: string[] = [];
    for (const f of actionFiles) {
      // Split the file at each exported function; each piece must check the session.
      const parts = readFileSync(f, "utf8")
        .split(/^export async function /m)
        .slice(1)
        .map((body) => ({ name: body.slice(0, body.indexOf("(")), body }));
      const checked = new Set(parts.filter((x) => x.body.includes("getVerifiedClaims()")).map((x) => x.name));
      for (const { name, body } of parts) {
        if (checked.has(name)) continue;
        // Allowed: a pure dispatcher (e.g. /device's deviceAction) that never touches the
        // database and only hands the request to actions that do check.
        const callsChecked = [...checked].some((n) => body.includes(`${n}(`));
        const touchesDb = /withUser|withServer|\btx`/.test(body);
        if (!callsChecked || touchesDb) missing.push(`${relative(APP, f)}: ${name}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
