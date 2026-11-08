import { describe, expect, it } from "vitest";
import { isSafeFolderPath, isSafeModuleName } from "./paths";

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
