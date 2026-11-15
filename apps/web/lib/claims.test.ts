import { describe, expect, it } from "vitest";
import { pickClaims } from "./claims";

// A pass body as Supabase would sign it (values are made up).
const good = {
  sub: "7f3a0000-0000-4000-8000-000000000001",
  role: "authenticated",
  aal: "aal1",
  amr: [{ method: "oauth", timestamp: 1_700_000_000 }],
  session_id: "c21b0000-0000-4000-8000-000000000002",
  iat: 1_700_000_000,
};

describe("pickClaims", () => {
  it("keeps the six allowed fields of a good pass", () => {
    expect(pickClaims(good)).toEqual(good);
  });

  it("drops every other field", () => {
    const result = pickClaims({ ...good, email: "a@example.com", user_metadata: { x: 1 } });
    expect(result).toEqual(good);
    expect(result).not.toHaveProperty("email");
  });

  it("accepts aal2 (passed two-factor)", () => {
    expect(pickClaims({ ...good, aal: "aal2" })?.aal).toBe("aal2");
  });

  it.each([
    ["missing sub", { ...good, sub: undefined }],
    ["empty sub", { ...good, sub: "" }],
    ["anon role", { ...good, role: "anon" }],
    ["service_role", { ...good, role: "service_role" }],
    ["unknown aal", { ...good, aal: "aal3" }],
    ["missing session_id", { ...good, session_id: undefined }],
    ["iat as text", { ...good, iat: "1700000000" }],
  ])("refuses a pass with %s", (_label, claims) => {
    expect(pickClaims(claims)).toBeNull();
  });

  it("turns a missing amr into an empty list", () => {
    expect(pickClaims({ ...good, amr: undefined })?.amr).toEqual([]);
  });
});
