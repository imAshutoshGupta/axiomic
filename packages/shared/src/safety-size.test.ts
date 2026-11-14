import { describe, expect, it } from "vitest";
import { merge } from "./merge";
import { renderClaude } from "./render-claude";
import {
  BODY_MAX_CHARS,
  BODY_WARN_CHARS,
  CHARS_PER_TOKEN,
  FILE_MAX_CHARS,
  FILE_WARN_LINES,
  FILE_WARN_TOKENS,
  TITLE_MAX_CHARS,
  TITLE_WARN_CHARS,
  checkCombinedSize,
  checkRuleSize,
  estimateTokens,
} from "./safety-size";

const codes = (findings: { code: string }[]) => findings.map((f) => f.code);

describe("estimateTokens", () => {
  it("is characters ÷ 4, rounded up", () => {
    expect(CHARS_PER_TOKEN).toBe(4);
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("a".repeat(4000))).toBe(1000);
  });
});

describe("checkRuleSize: title", () => {
  it("allows a normal title", () => {
    expect(checkRuleSize({ title: "Testing", body: "Run the tests." })).toEqual([]);
  });

  it("blocks an empty or spaces-only title", () => {
    for (const title of ["", "   ", "\n\t"]) {
      expect(checkRuleSize({ title, body: "x" })[0]).toMatchObject({ code: "size.title-empty", severity: "block", field: "title" });
    }
  });

  it("allows a title exactly at the warn threshold, warns one over", () => {
    expect(checkRuleSize({ title: "a".repeat(TITLE_WARN_CHARS), body: "" })).toEqual([]);
    expect(checkRuleSize({ title: "a".repeat(TITLE_WARN_CHARS + 1), body: "" })[0]).toMatchObject({ code: "size.title-long", severity: "warn" });
  });

  it("warns exactly at the block threshold, blocks one over", () => {
    expect(codes(checkRuleSize({ title: "a".repeat(TITLE_MAX_CHARS), body: "" }))).toEqual(["size.title-long"]);
    expect(checkRuleSize({ title: "a".repeat(TITLE_MAX_CHARS + 1), body: "" })[0]).toMatchObject({ code: "size.title-too-long", severity: "block" });
  });

  it("doesn't count spaces around the title", () => {
    expect(checkRuleSize({ title: "  " + "a".repeat(TITLE_WARN_CHARS) + "  ", body: "" })).toEqual([]);
  });
});

describe("checkRuleSize: text", () => {
  it("allows an empty text (a title-only rule is valid)", () => {
    expect(checkRuleSize({ title: "Testing", body: "" })).toEqual([]);
  });

  it("allows text exactly at the warn threshold, warns one over", () => {
    expect(checkRuleSize({ title: "T", body: "a".repeat(BODY_WARN_CHARS) })).toEqual([]);
    expect(checkRuleSize({ title: "T", body: "a".repeat(BODY_WARN_CHARS + 1) })[0]).toMatchObject({ code: "size.body-long", severity: "warn", field: "body" });
  });

  it("warns exactly at the block threshold, blocks one over", () => {
    expect(codes(checkRuleSize({ title: "T", body: "a".repeat(BODY_MAX_CHARS) }))).toEqual(["size.body-long"]);
    expect(checkRuleSize({ title: "T", body: "a".repeat(BODY_MAX_CHARS + 1) })[0]).toMatchObject({ code: "size.body-too-long", severity: "block" });
  });

  it("reports title and text problems together", () => {
    expect(codes(checkRuleSize({ title: "", body: "a".repeat(BODY_MAX_CHARS + 1) }))).toEqual(["size.title-empty", "size.body-too-long"]);
  });
});

describe("checkCombinedSize: rendered text", () => {
  it("measures characters, lines and tokens exactly", () => {
    const size = checkCombinedSize("one\ntwo\nthree\n");
    expect(size).toMatchObject({ chars: 14, lines: 3, tokens: 4, findings: [] });
  });

  it("counts a last line without a line break, and an empty text as zero lines", () => {
    expect(checkCombinedSize("one\ntwo").lines).toBe(2);
    expect(checkCombinedSize("").lines).toBe(0);
  });

  it("warns over 200 lines, not at exactly 200", () => {
    expect(checkCombinedSize("x\n".repeat(FILE_WARN_LINES)).findings).toEqual([]);
    expect(codes(checkCombinedSize("x\n".repeat(FILE_WARN_LINES + 1)).findings)).toEqual(["size.file-lines"]);
  });

  it("warns over the token threshold, not at exactly the threshold", () => {
    const atLimit = "a".repeat(FILE_WARN_TOKENS * CHARS_PER_TOKEN);
    expect(checkCombinedSize(atLimit).findings).toEqual([]);
    const [finding] = checkCombinedSize(atLimit + "a").findings;
    expect(finding).toMatchObject({ code: "size.file-tokens", severity: "warn", field: "file" });
  });

  it("blocks over 40,000 characters (where Claude Code cuts the file off), not at exactly 40,000", () => {
    expect(codes(checkCombinedSize("a".repeat(FILE_MAX_CHARS)).findings)).toEqual(["size.file-tokens"]);
    const [finding] = checkCombinedSize("a".repeat(FILE_MAX_CHARS + 1)).findings;
    expect(finding).toMatchObject({ code: "size.file-too-large", severity: "block", field: "file" });
  });

  it("can report too many lines and too many characters at once", () => {
    expect(codes(checkCombinedSize("a".repeat(250) + "\n").findings)).toEqual([]);
    expect(codes(checkCombinedSize(("a".repeat(250) + "\n").repeat(201)).findings)).toEqual(["size.file-too-large", "size.file-lines"]);
  });
});

describe("checkCombinedSize: a list of rules", () => {
  it("accepts an empty list", () => {
    expect(checkCombinedSize([]).findings).toEqual([]);
  });

  it("stays close to the real rendered file", () => {
    // One rule in every layer, so the real file has all four section headings.
    const input = {
      company: [{ id: "c1", title: "Deploys", body: "Never deploy on Friday.\nAsk in #releases first.", locked: true }],
      team: [{ id: "t1", title: "Reviews", body: "One approval.", locked: false }],
      project: [{ id: "p1", title: "Testing", body: "Run the tests.\n\n- unit\n- e2e" }],
      modules: [],
      personal: [{ id: "me", title: "Style", body: "" }],
    };
    const [main] = renderClaude(merge(input), 1);
    const real = checkCombinedSize(main!.content);
    const estimate = checkCombinedSize([...input.company, ...input.team, ...input.project, ...input.personal]);

    // The estimate may be a little high (it's better to warn early than late), but never far off.
    expect(estimate.chars).toBeGreaterThanOrEqual(real.chars - 20);
    expect(estimate.chars).toBeLessThanOrEqual(real.chars + 80);
    expect(Math.abs(estimate.lines - real.lines)).toBeLessThanOrEqual(3);
  });

  it("grows by the size of each rule added", () => {
    const one = checkCombinedSize([{ title: "Testing", body: "Run the tests." }]);
    const two = checkCombinedSize([
      { title: "Testing", body: "Run the tests." },
      { title: "Deploys", body: "a".repeat(1000) },
    ]);
    // "\n### Deploys\n\n" + 1000 characters + line break
    expect(two.chars - one.chars).toBe(6 + "Deploys".length + 2 + 1000);
    expect(two.lines - one.lines).toBe(4);
  });

  it("blocks when many acceptable rules add up to more than the file limit", () => {
    const rule = { title: "Topic", body: "a".repeat(BODY_WARN_CHARS) }; // each one is fine on its own
    expect(checkRuleSize(rule)).toEqual([]);
    const size = checkCombinedSize(Array.from({ length: 11 }, () => rule));
    expect(codes(size.findings)).toContain("size.file-too-large");
  });

  it("warns when many short rules add up to more than 200 lines", () => {
    const rules = Array.from({ length: 60 }, (_, i) => ({ title: `Topic ${i}`, body: "Short." }));
    expect(codes(checkCombinedSize(rules).findings)).toEqual(["size.file-lines"]);
  });
});
