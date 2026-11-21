import { describe, expect, it } from "vitest";
import { DEFAULT_API_URL, normalizeApiUrl, resolveApiUrl } from "../../src/server/api-url";

describe("server URL", () => {
  it("has a default that is https and not axiomic.dev", () => {
    expect(DEFAULT_API_URL.startsWith("https://")).toBe(true);
    expect(DEFAULT_API_URL).not.toContain("axiomic.dev");
    expect(resolveApiUrl({})).toBe(DEFAULT_API_URL);
    expect(resolveApiUrl({ AXIOMIC_API_URL: "  " })).toBe(DEFAULT_API_URL);
  });

  it("accepts https anywhere and http only for this computer", () => {
    expect(resolveApiUrl({ AXIOMIC_API_URL: "https://rules.example.com/" })).toBe("https://rules.example.com");
    expect(resolveApiUrl({ AXIOMIC_API_URL: "http://localhost:3000" })).toBe("http://localhost:3000");
    expect(normalizeApiUrl("http://127.0.0.1:54321/base/")).toBe("http://127.0.0.1:54321/base");
  });

  it.each([
    "http://example.com",
    "http://localhost.evil.com",
    "ftp://example.com",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "not a url",
    "https://user:pw@example.com",
    "https://example.com/?token=abc",
    "https://example.com/#x",
  ])("rejects %s", (bad) => {
    expect(() => normalizeApiUrl(bad)).toThrow();
    expect(() => resolveApiUrl({ AXIOMIC_API_URL: bad })).toThrow(/AXIOMIC_API_URL is invalid/);
  });
});
