import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashToken, parseBearer } from "@/lib/api/token-format";

const good = "axm_" + "A".repeat(42) + "-";

describe("parseBearer", () => {
  it("accepts a well-formed token", () => {
    expect(parseBearer(`Bearer ${good}`)).toBe(good);
    expect(parseBearer(`bearer ${good}`)).toBe(good);
  });
  it.each([
    null,
    "",
    good, // no "Bearer"
    `Basic ${good}`,
    `Bearer ${good} extra`,
    `Bearer ${good.slice(0, -1)}`, // too short
    `Bearer ${good}A`, // too long
    `Bearer xyz_${"A".repeat(43)}`, // wrong prefix
    `Bearer axm_${"A".repeat(42)}=`, // padding / bad char
    `Bearer axm_${"A".repeat(42)}+`,
  ])("refuses %s", (h) => {
    expect(parseBearer(h)).toBeNull();
  });
});

describe("hashToken", () => {
  it("is sha256 of the UTF-8 text, like private.hash_secret", () => {
    expect(hashToken(good).equals(createHash("sha256").update(good).digest())).toBe(true);
    expect(hashToken(good).length).toBe(32);
  });
});
