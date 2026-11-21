import { describe, expect, it } from "vitest";
import { checkRule } from "../../src/safety/check";
import { checkStructure } from "../../src/safety/structure";

const body = (text: string) => checkStructure("body", text);

describe("checkStructure: unclosed code blocks and comments", () => {
  it("warns about a ``` or ~~~ fence that is never closed, on the line it opened", () => {
    expect(body("intro\n```js\nconst x = 1;")).toEqual([expect.objectContaining({ code: "structure.unclosed-block", severity: "warn", field: "body", line: 2 })]);
    expect(body("~~~\ntext")[0]).toMatchObject({ code: "structure.unclosed-block", severity: "warn", line: 1 });
  });

  it("warns about an HTML comment that is never closed", () => {
    expect(body("a\nb <!-- hidden")).toEqual([expect.objectContaining({ code: "structure.unclosed-block", severity: "warn", line: 2 })]);
  });

  it("is quiet for balanced fences and comments, and for markers inside code", () => {
    expect(body("```\ncode\n```")).toEqual([]);
    expect(body("````\n```\n````")).toEqual([]); // a longer fence can hold a shorter one
    expect(body("<!-- ok -->\ntext <!-- also ok --> more")).toEqual([]);
    expect(body("```html\n<!-- not a comment here\n```")).toEqual([]);
    expect(body("<!-->")).toEqual([]); // HTML closes this one at once
  });

  it("a shorter closing fence doesn't close a longer one", () => {
    expect(body("````\ncode\n```")).toHaveLength(1);
  });

  it("is a warning only: the rule can still be published", () => {
    const result = checkRule({ title: "Testing", body: "```js\nrun it" });
    expect(result.ok).toBe(true);
    expect(result.findings.map((f) => f.code)).toEqual(["structure.unclosed-block"]);
  });

  it("works with \\r\\n and lone \\r line endings", () => {
    expect(body("a\r\n```\r\ncode")[0]).toMatchObject({ line: 2 });
    expect(body("a\r```\rcode")[0]).toMatchObject({ line: 2 });
  });
});
