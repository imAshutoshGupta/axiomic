import { describe, expect, it } from "vitest";
import { merge } from "./merge";
import { parseRenderedFile, pullUpHeadings, pushDownHeadings, renderClaude, renderIndex } from "./render-claude";

const result = merge({
  company: [{ id: "c1", title: "Security", body: "Never commit secrets.", locked: true }],
  team: [{ id: "t1", title: "Testing", body: "Unit tests for every feature.", locked: false }],
  project: [{ id: "p1", title: "Style", body: "# Naming\nUse camelCase.\n\n```md\n### not a section\n```" }],
  modules: [{ id: "m1", name: "payments", path: "src/payments", rules: [{ id: "mr1", title: "Money", body: "Amounts in paise." }] }],
  personal: [{ id: "u1", title: "Tone", body: "Short answers." }],
});
const files = renderClaude(result, 7);
const main = files.find((f) => f.path.endsWith("/axiomic.md"))!;
const mod = files.find((f) => f.path.endsWith("/axiomic-payments.md"))!;

describe("renderIndex + parseRenderedFile (the round trip push relies on)", () => {
  it("the index lists every rule in file order", () => {
    expect(renderIndex(result).map((r) => [r.path.split("/").pop(), r.ruleId, r.layer])).toEqual([
      ["axiomic.md", "c1", "company"],
      ["axiomic.md", "t1", "team"],
      ["axiomic.md", "p1", "project"],
      ["axiomic.md", "u1", "personal"],
      ["axiomic-payments.md", "mr1", "module"],
    ]);
  });

  it("parsing a rendered main file gives the same rules, layers and titles, in the same order", () => {
    const parsed = parseRenderedFile(main.content, "main");
    expect(parsed.sections.map((s) => [s.layer, s.title, s.mandatory])).toEqual([
      ["company", "Security", true],
      ["team", "Testing", false],
      ["project", "Style", false],
      ["personal", "Tone", false],
    ]);
    expect(parsed.preamble).toContain("# Rules from axiomic");
  });

  it("a ### line inside a code block stays text", () => {
    const style = parseRenderedFile(main.content, "main").sections[2]!;
    expect(style.body).toContain("### not a section");
  });

  it("a folder file: every section is a module rule", () => {
    expect(parseRenderedFile(mod.content, "module").sections).toEqual([{ layer: "module", title: "Money", mandatory: false, body: "Amounts in paise." }]);
  });

  it("an added section is found under the layer heading above it", () => {
    const edited = main.content.replace("## Your personal rules", "### New project rule\n\nDo X.\n\n## Your personal rules");
    const s = parseRenderedFile(edited, "main").sections;
    expect(s.map((x) => [x.layer, x.title])).toContainEqual(["project", "New project rule"]);
  });
});

describe("pullUpHeadings", () => {
  it("undoes pushDownHeadings for normal headings, and leaves code alone", () => {
    const body = "# Naming\n## Detail\nText\n```\n#### code\n```";
    expect(pullUpHeadings(pushDownHeadings(body))).toBe(body);
  });
  it("leaves level 1–3 alone (a user may type them in a local edit)", () => {
    expect(pullUpHeadings("# a\n### b")).toBe("# a\n### b");
  });
});
