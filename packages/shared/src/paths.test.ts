import { describe, expect, it } from "vitest";
import { isSafeFolderPath, isSafeModuleName, isValidSlug } from "./paths";

describe("isSafeModuleName", () => {
  it.each(["payments", "user-auth", "v2", "a", "x".repeat(64)])("allows %s", (name) => {
    expect(isSafeModuleName(name)).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["climbing out", "../x"],
    ["a slash", "a/b"],
    ["capital letters", "Payments"],
    ["a space", "my payments"],
    ["a dot", "pay.ments"],
    ["a leading dash", "-pay"],
    ["a trailing dash", "pay-"],
    ["a double dash", "pay--ments"],
    ["too long", "x".repeat(65)],
  ])("blocks %s", (_label, name) => {
    expect(isSafeModuleName(name)).toBe(false);
  });
});

describe("isSafeFolderPath", () => {
  it.each(["src/payments", "apps/web/src", "src", ".github", "lib/my_module", "packages/ui-kit", "src/.hidden"])(
    "allows %s",
    (path) => {
      expect(isSafeFolderPath(path)).toBe(true);
    },
  );

  it.each([
    ["empty", ""],
    ["an absolute path", "/etc"],
    ["a trailing slash", "src/"],
    ["a double slash", "src//payments"],
    ["climbing out", "../secrets"],
    ["climbing out in the middle", "src/../../x"],
    ["the current folder", "./src"],
    ["the git folder", ".git/hooks"],
    ["the git folder in capitals", "src/.GIT"],
    ["a Windows drive", "C:/Users"],
    ["a backslash", "src\\payments"],
    ["a glob symbol", "src/*"],
    ["braces", "src/{a,b}"],
    ["a quote", 'src/"x'],
    ["a line break", "src\npaths: evil"],
    ["a space", "my folder"],
    ["a trailing dot", "src/payments."],
    ["too long", "a/".repeat(128) + "a"],
  ])("blocks %s", (_label, path) => {
    expect(isSafeFolderPath(path)).toBe(false);
  });
});

describe("isValidSlug (same as the database check)", () => {
  it.each(["acme", "web-app", "a1", "x".repeat(31), "p-0123456789abcdef"])("allows %s", (slug) => {
    expect(isValidSlug(slug)).toBe(true);
  });

  it.each([
    ["one character", "a"],
    ["too long", "x".repeat(32)],
    ["a leading dash", "-acme"],
    ["capital letters", "Acme"],
    ["climbing out", "../x"],
    ["a dot", "a.b"],
    ["a space", "a b"],
    ["a line break", "acme\n"],
    ["not a string", 5],
  ])("blocks %s", (_label, slug) => {
    expect(isValidSlug(slug)).toBe(false);
  });
});
