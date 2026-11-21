import { describe, expect, it } from "vitest";
import { formatPullReport } from "../../src/commands/format";
import type { WriteReport } from "../../src/local-files/writer";

const emptyReport: WriteReport = { written: [], unchanged: [], deleted: [], keptModified: [], keptUnmanaged: [], forced: [], deferred: [] };
const answer = { project: { name: "Web app", space: "acme", slug: "web-app" }, version: 7, blocked: [] };

describe("formatPullReport", () => {
  it("says the project and version, and that nothing changed", () => {
    expect(formatPullReport(emptyReport, answer)).toBe("Rules for acme/web-app (Web app), version 7: already up to date.\n");
  });

  it("lists edited files as kept, and points at axiomic push (which exists) to send them back", () => {
    const text = formatPullReport({ ...emptyReport, keptModified: [".claude/rules/axiomic.md"] }, answer);
    expect(text).toContain("Edited on this computer, so kept as they are (axiomic push sends your edits back):\n  .claude/rules/axiomic.md");
    expect(text).not.toContain("is coming");
  });
});
