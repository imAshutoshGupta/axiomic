import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  HOOK_MATCHER,
  SettingsError,
  claudeHookStatus,
  claudeSettingsPath,
  installClaudeHook,
  isOurHandler,
  findUnsafeNumber,
  resolveHookTarget,
  uninstallClaudeHook,
  type HookTarget,
} from "../../src/hook/claude-settings";
import { POSIX, exists, makeSandbox, modeOf } from "../helpers/test-helpers";

const target: HookTarget = { nodePath: "/opt/node/bin/node", scriptPath: "/opt/lib/node_modules/axiomic/dist/axiomic.js" };
const OURS = { type: "command", command: target.nodePath, args: [target.scriptPath, "hook", "session-start"], timeout: 5 };

/** A realistic settings file: other settings, other events, and user hooks that merely mention axiomic. */
const USER_SETTINGS = {
  model: "opus",
  permissions: { allow: ["Bash(npm test)"] },
  hooks: {
    PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo axiomic" }] }],
    SessionStart: [
      { matcher: "startup", hooks: [{ type: "command", command: "echo 'axiomic hook session-start is cool'" }] },
      { hooks: [{ type: "command", command: "/usr/local/bin/axiomic-wrapper.sh", args: ["hook", "session-start"] }] },
    ],
  },
};

const readJson = async (file: string) => JSON.parse(await fs.readFile(file, "utf8")) as typeof USER_SETTINGS & Record<string, unknown>;

describe("settings path", () => {
  it("is ~/.claude/settings.json unless CLAUDE_CONFIG_DIR is set", () => {
    expect(claudeSettingsPath({}, "/home/dev")).toBe(path.join("/home/dev", ".claude", "settings.json"));
    expect(claudeSettingsPath({ CLAUDE_CONFIG_DIR: "/custom" }, "/home/dev")).toBe(path.join("/custom", "settings.json"));
  });
});

describe("hook install", () => {
  it("creates settings.json with one SessionStart entry: exec form, absolute paths, timeout in seconds", async () => {
    const box = await makeSandbox();
    expect(await installClaudeHook(box.settingsPath, target)).toBe("installed");
    expect(await readJson(box.settingsPath)).toEqual({ hooks: { SessionStart: [{ matcher: HOOK_MATCHER, hooks: [OURS] }] } });
    expect(JSON.stringify(OURS)).not.toMatch(/npx|@latest/);
  });

  it("installing twice leaves exactly one entry and doesn't rewrite the file", async () => {
    const box = await makeSandbox();
    await installClaudeHook(box.settingsPath, target);
    const before = await fs.readFile(box.settingsPath, "utf8");
    expect(await installClaudeHook(box.settingsPath, target)).toBe("unchanged");
    expect(await fs.readFile(box.settingsPath, "utf8")).toBe(before);
    expect((await claudeHookStatus(box.settingsPath, target)).count).toBe(1);
  });

  it("preserves every other setting and hook, the indentation and the file mode", async () => {
    const box = await makeSandbox();
    await fs.mkdir(path.dirname(box.settingsPath));
    await fs.writeFile(box.settingsPath, JSON.stringify(USER_SETTINGS, null, 4) + "\n", { mode: 0o640 });
    if (POSIX) await fs.chmod(box.settingsPath, 0o640);

    expect(await installClaudeHook(box.settingsPath, target)).toBe("installed");
    const text = await fs.readFile(box.settingsPath, "utf8");
    const after = JSON.parse(text) as typeof USER_SETTINGS;
    expect(after.hooks.SessionStart).toEqual([...USER_SETTINGS.hooks.SessionStart, { matcher: HOOK_MATCHER, hooks: [OURS] }]);
    expect({ ...after, hooks: { ...after.hooks, SessionStart: USER_SETTINGS.hooks.SessionStart } }).toEqual(USER_SETTINGS);
    expect(text).toMatch(/^ {4}"model"/m);
    expect(text.endsWith("}\n")).toBe(true);
    if (POSIX) expect(await modeOf(box.settingsPath)).toBe(0o640);
    expect(await fs.readdir(path.dirname(box.settingsPath))).toEqual(["settings.json"]);
  });

  it("replaces an entry that points at an older install instead of adding a second one", async () => {
    const box = await makeSandbox();
    await installClaudeHook(box.settingsPath, { nodePath: "/old/node", scriptPath: "/old/axiomic/dist/axiomic.js" });
    expect(await installClaudeHook(box.settingsPath, target)).toBe("updated");
    expect((await readJson(box.settingsPath)).hooks.SessionStart).toEqual([{ matcher: HOOK_MATCHER, hooks: [OURS] }]);
  });

  it.each([
    ["invalid JSON", '{ "model": "opus", '],
    ["JSON with comments", '{ // my settings\n "model": "opus" }'],
    ["a list", "[]"],
    ["hooks as a list", '{"hooks": []}'],
    ["SessionStart as an object", '{"hooks": {"SessionStart": {}}}'],
    ["a group without a hooks list", '{"hooks": {"SessionStart": [{"matcher": "startup"}]}}'],
    ["a group that is a string", '{"hooks": {"SessionStart": ["axiomic"]}}'],
  ])("refuses %s and leaves the file untouched", async (_name, text) => {
    const box = await makeSandbox();
    await fs.mkdir(path.dirname(box.settingsPath));
    await fs.writeFile(box.settingsPath, text);
    await expect(installClaudeHook(box.settingsPath, target)).rejects.toBeInstanceOf(SettingsError);
    await expect(uninstallClaudeHook(box.settingsPath)).rejects.toBeInstanceOf(SettingsError);
    expect(await fs.readFile(box.settingsPath, "utf8")).toBe(text);
    expect(await fs.readdir(path.dirname(box.settingsPath))).toEqual(["settings.json"]);
  });

  it("is safe with __proto__ and constructor keys: no prototype pollution, keys kept as data", async () => {
    const box = await makeSandbox();
    await fs.mkdir(path.dirname(box.settingsPath));
    const text = '{"__proto__": {"polluted": true}, "constructor": {"prototype": {"polluted": true}}, "hooks": {"__proto__": {"SessionStart": "x"}}}';
    await fs.writeFile(box.settingsPath, text);
    await installClaudeHook(box.settingsPath, target);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const after = await fs.readFile(box.settingsPath, "utf8");
    expect(after).toContain('"__proto__": {\n    "polluted": true');
    expect((await claudeHookStatus(box.settingsPath, target)).count).toBe(1);
  });

  it("does nothing in a dry run", async () => {
    const box = await makeSandbox();
    expect(await installClaudeHook(box.settingsPath, target, { dryRun: true })).toBe("installed");
    expect(await exists(box.settingsPath)).toBe(false);
  });

  it("writes through a symlinked settings.json (dotfiles) without replacing the link", async () => {
    const box = await makeSandbox();
    const real = path.join(box.base, "dotfiles-settings.json");
    await fs.writeFile(real, "{}\n");
    await fs.mkdir(path.dirname(box.settingsPath));
    await fs.symlink(real, box.settingsPath);
    await installClaudeHook(box.settingsPath, target);
    expect((await fs.lstat(box.settingsPath)).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(real, "utf8")).toContain("session-start");
  });
});

describe("hook uninstall", () => {
  it("removes only our entry and leaves user hooks that mention axiomic", async () => {
    const box = await makeSandbox();
    await fs.mkdir(path.dirname(box.settingsPath));
    await fs.writeFile(box.settingsPath, JSON.stringify(USER_SETTINGS, null, 2) + "\n");
    await installClaudeHook(box.settingsPath, target);
    expect(await uninstallClaudeHook(box.settingsPath)).toBe("removed");
    expect(await readJson(box.settingsPath)).toEqual(USER_SETTINGS);
    expect(await uninstallClaudeHook(box.settingsPath)).toBe("absent");
  });

  it("removes our handler from a group the user shares, keeping theirs", async () => {
    const box = await makeSandbox();
    await fs.mkdir(path.dirname(box.settingsPath));
    const mine = { type: "command", command: "echo hi" };
    await fs.writeFile(box.settingsPath, JSON.stringify({ hooks: { SessionStart: [{ matcher: "startup", hooks: [mine, OURS] }] } }));
    expect(await uninstallClaudeHook(box.settingsPath)).toBe("removed");
    expect(await readJson(box.settingsPath)).toEqual({ hooks: { SessionStart: [{ matcher: "startup", hooks: [mine] }] } });
  });

  it("cleans up the empty hooks object it created, and never creates a missing file", async () => {
    const box = await makeSandbox();
    expect(await uninstallClaudeHook(box.settingsPath)).toBe("absent");
    expect(await exists(box.settingsPath)).toBe(false);
    await installClaudeHook(box.settingsPath, target);
    await uninstallClaudeHook(box.settingsPath);
    expect(await readJson(box.settingsPath)).toEqual({});
  });
});

describe("settings with an unexpected shape", () => {
  it.each([
    ["a top-level array", "[]"],
    ["a top-level string", '"hi"'],
    ["hooks that is not an object", '{"hooks": []}'],
    ["SessionStart that is not a list", '{"hooks": {"SessionStart": {}}}'],
    ["a SessionStart entry with no hooks list", '{"hooks": {"SessionStart": [{"matcher": "x"}]}}'],
    ["a SessionStart entry that is a string", '{"hooks": {"SessionStart": ["x"]}}'],
    ["invalid JSON", "{nope"],
  ])("install and uninstall refuse %s and leave the file byte for byte untouched", async (_name, text) => {
    const box = await makeSandbox();
    await fs.mkdir(path.dirname(box.settingsPath));
    await fs.writeFile(box.settingsPath, text);
    await expect(installClaudeHook(box.settingsPath, target)).rejects.toBeInstanceOf(SettingsError);
    await expect(uninstallClaudeHook(box.settingsPath)).rejects.toBeInstanceOf(SettingsError);
    expect(await fs.readFile(box.settingsPath, "utf8")).toBe(text);
    expect((await fs.readdir(path.dirname(box.settingsPath))).sort()).toEqual(["settings.json"]); // no temp file left
  });
});

describe("recognising our hook", () => {
  it("matches only the exact shape", () => {
    expect(isOurHandler(OURS)).toBe(true);
    expect(isOurHandler({ type: "command", command: "node.exe", args: ["C:\\npm\\axiomic\\dist\\axiomic.js", "hook", "session-start"] })).toBe(true);
    expect(isOurHandler({ type: "command", command: "axiomic hook session-start" })).toBe(false);
    expect(isOurHandler({ type: "command", command: "node", args: ["/x/axiomic.js", "hook", "session-start", "--extra"] })).toBe(false);
    expect(isOurHandler({ type: "command", command: "node", args: ["/x/not-axiomic.js", "hook", "session-start"] })).toBe(false);
    expect(isOurHandler({ type: "http", args: ["/x/axiomic.js", "hook", "session-start"] })).toBe(false);
    expect(isOurHandler(null)).toBe(false);
  });

  it("reports a hook whose node or script no longer exists", async () => {
    const box = await makeSandbox();
    await installClaudeHook(box.settingsPath, target);
    const status = await claudeHookStatus(box.settingsPath, target);
    expect(status).toMatchObject({ count: 1, current: true, nodeExists: false, scriptExists: false, scriptPath: target.scriptPath });
    expect((await claudeHookStatus(box.settingsPath, { ...target, nodePath: "/other/node" })).current).toBe(false);
  });

  it("refuses to install from source or from an npx temp folder", async () => {
    expect(await resolveHookTarget("/bin/node", "/lib/axiomic/dist/axiomic.js")).toEqual({ nodePath: "/bin/node", scriptPath: "/lib/axiomic/dist/axiomic.js" });
    await expect(resolveHookTarget("/bin/node", "/repo/packages/cli/src/main.ts")).rejects.toThrow(/not from source/);
    await expect(resolveHookTarget("/bin/node", "/home/dev/.npm/_npx/abc/node_modules/axiomic/dist/axiomic.js")).rejects.toThrow(/npx/);
    await expect(resolveHookTarget("node", "axiomic.js")).rejects.toThrow();
  });
});

describe("M4: where the hook may point", () => {
  const NODE = "/bin/node";
  /** A fake disk where exactly these paths exist. */
  const disk = (...present: string[]) => async (p: string) => present.includes(p);

  it("accepts global-style installs (npm prefix, nvm, fnm, volta, Homebrew, pnpm/yarn global, Windows %APPDATA%\\npm)", async () => {
    for (const script of [
      "/usr/local/lib/node_modules/axiomic/dist/axiomic.js",
      "/home/dev/.nvm/versions/node/v22.1.0/lib/node_modules/axiomic/dist/axiomic.js",
      "/home/dev/.local/share/fnm/node-versions/v22.1.0/installation/lib/node_modules/axiomic/dist/axiomic.js",
      "/home/dev/.volta/tools/image/packages/axiomic/lib/node_modules/axiomic/dist/axiomic.js",
      "/opt/homebrew/lib/node_modules/axiomic/dist/axiomic.js",
      "/home/dev/.local/share/pnpm/global/5/node_modules/.pnpm/axiomic@1.0.0/node_modules/axiomic/dist/axiomic.js",
      "C:\\Users\\dev\\AppData\\Roaming\\npm\\node_modules\\axiomic\\dist\\axiomic.js",
    ]) {
      // nvm and Homebrew ARE git clones one level up; that must not count. package.json next to a global node_modules is fine too.
      const exists = disk("/home/dev/.nvm/.git", "/opt/homebrew/.git", "/home/dev/.local/share/pnpm/global/5/package.json");
      expect(await resolveHookTarget(NODE, script, exists), script).toEqual({ nodePath: NODE, scriptPath: script });
    }
  });

  it("refuses a project-local install (a .git or axiomic.json beside or above node_modules) and says to install globally", async () => {
    const script = "/work/app/node_modules/axiomic/dist/axiomic.js";
    await expect(resolveHookTarget(NODE, script, disk("/work/app/.git"))).rejects.toThrow(/inside a project[\s\S]*install -g axiomic/);
    await expect(resolveHookTarget(NODE, script, disk("/work/app/axiomic.json"))).rejects.toThrow(/inside a project/);
    await expect(resolveHookTarget(NODE, "/work/app/packages/web/node_modules/axiomic/dist/axiomic.js", disk("/work/app/axiomic.json"))).rejects.toThrow(/inside a project/);
    await expect(
      resolveHookTarget(NODE, "C:\\work\\app\\node_modules\\axiomic\\dist\\axiomic.js", disk("C:\\work\\app\\.git")),
    ).rejects.toThrow(/inside a project/);
    // the wording must not claim a release exists
    await expect(resolveHookTarget(NODE, script, disk("/work/app/.git"))).rejects.toThrow(/once a release is published/);
  });

  it("refuses installs that are not a known global layout, even beside a package.json", async () => {
    // repo/.git is one level up from frontend/node_modules: the old rule missed this
    await expect(resolveHookTarget(NODE, "/work/repo/frontend/node_modules/axiomic/dist/axiomic.js", disk("/work/repo/.git", "/work/repo/frontend/package.json"))).rejects.toThrow(/not a recognised global/);
    // a plain folder with a node_modules and nothing else
    await expect(resolveHookTarget(NODE, "/work/plain/node_modules/axiomic/dist/axiomic.js", disk())).rejects.toThrow(/not a recognised global/);
    await expect(resolveHookTarget(NODE, "/work/app/node_modules/axiomic/dist/axiomic.js", disk("/work/app/package.json"))).rejects.toThrow(/install -g axiomic/);
  });

  it("accepts the other global layouts: ~/.npm-global, asdf, yarn global, Windows nvm/volta/nodejs", async () => {
    for (const script of [
      "/home/dev/.npm-global/lib/node_modules/axiomic/dist/axiomic.js",
      "/home/dev/.asdf/installs/nodejs/22.1.0/lib/node_modules/axiomic/dist/axiomic.js",
      "/home/dev/.config/yarn/global/node_modules/axiomic/dist/axiomic.js",
      "C:\\Users\\dev\\AppData\\Local\\Yarn\\Data\\global\\node_modules\\axiomic\\dist\\axiomic.js",
      "C:\\Users\\dev\\AppData\\Roaming\\nvm\\v22.1.0\\node_modules\\axiomic\\dist\\axiomic.js",
      "C:\\Users\\dev\\AppData\\Local\\Volta\\tools\\image\\packages\\axiomic\\node_modules\\axiomic\\dist\\axiomic.js",
      "C:\\Program Files\\nodejs\\node_modules\\axiomic\\dist\\axiomic.js",
    ]) {
      expect(await resolveHookTarget(NODE, script, disk("/home/dev/.config/yarn/global/package.json")), script).toEqual({ nodePath: NODE, scriptPath: script });
    }
  });

  it("refuses ephemeral runners: npx, pnpm dlx, yarn dlx, bunx and bun's install cache", async () => {
    for (const script of [
      "/home/dev/.npm/_npx/abc/node_modules/axiomic/dist/axiomic.js",
      "/home/dev/.cache/pnpm/dlx/abc123/node_modules/axiomic/dist/axiomic.js",
      "/tmp/xfs-1a2b/dlx-4242/node_modules/axiomic/dist/axiomic.js",
      "/tmp/bunx-501-axiomic@latest/node_modules/axiomic/dist/axiomic.js",
      "/home/dev/.bun/install/cache/axiomic@1.0.0/dist/axiomic.js",
      "C:\\Users\\dev\\AppData\\Local\\npm-cache\\_npx\\abc\\node_modules\\axiomic\\dist\\axiomic.js",
    ]) {
      await expect(resolveHookTarget(NODE, script, disk()), script).rejects.toThrow(/temporary runner/);
    }
  });
});

describe("L1: install/uninstall refuse to lose precision", () => {
  it("finds integer literals beyond 2^53, ignoring strings and safe numbers", () => {
    expect(findUnsafeNumber('{"id": 12345678901234567890}')).toBe("12345678901234567890");
    expect(findUnsafeNumber('{"a": 9007199254740993}')).toBe("9007199254740993");
    expect(findUnsafeNumber('{"a": "12345678901234567890", "b": 9007199254740991, "c": 1.5, "d": -3}')).toBeUndefined();
    // any numeric literal whose VALUE would change
    expect(findUnsafeNumber('{"a": 1e400}')).toBe("1e400");
    expect(findUnsafeNumber('{"a": 9007199254740993.0}')).toBe("9007199254740993.0");
    expect(findUnsafeNumber('{"a": 0.12345678901234567890123}')).toBe("0.12345678901234567890123");
    // same value, different spelling: fine
    expect(findUnsafeNumber('{"a": 1.0, "b": 1e2, "c": 0.1, "d": -0, "e": 1.5e-7, "f": 100000000000000000000}')).toBeUndefined();
  });

  it("leaves such a settings.json untouched and says why", async () => {
    const box = await makeSandbox();
    await fs.mkdir(path.dirname(box.settingsPath), { recursive: true });
    const text = '{\n  "bigId": 12345678901234567890\n}\n';
    await fs.writeFile(box.settingsPath, text);
    await expect(installClaudeHook(box.settingsPath, target)).rejects.toThrow(/can't be stored exactly/);
    await expect(installClaudeHook(box.settingsPath, target, { dryRun: true })).rejects.toThrow(/can't be stored exactly/);
    expect(await fs.readFile(box.settingsPath, "utf8")).toBe(text);
  });
});

