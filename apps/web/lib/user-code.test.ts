import { describe, expect, it } from "vitest";
import { normalizeUserCode } from "./user-code";

describe("normalizeUserCode", () => {
  it.each([
    ["ABCD-2345", "ABCD-2345"],
    ["abcd2345", "ABCD-2345"],
    ["  abcd-2345 ", "ABCD-2345"],
    ["ab cd 23 45", "ABCD-2345"],
  ])("accepts %j", (input, out) => {
    expect(normalizeUserCode(input)).toBe(out);
  });

  it.each([
    ["too short", "ABC-2345"],
    ["too long", "ABCDE-2345"],
    ["a letter O (not in the alphabet)", "ABCO-2345"],
    ["a digit 1 (not in the alphabet)", "ABCD-2341"],
    ["other characters", "ABCD_2345"],
    ["not a string", 12345678],
    ["very long input", "A".repeat(50)],
  ])("refuses %s", (_label, input) => {
    expect(normalizeUserCode(input)).toBeNull();
  });
});
