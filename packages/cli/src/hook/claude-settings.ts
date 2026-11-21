import { promises as fs } from "node:fs";
import path from "node:path";
import { fileExists, isNotFound, readFileNoFollowWithInfo, writeFileAtomic } from "../utils/fs-safe";

/**
 * Installs axiomic's SessionStart hook in Claude Code's user settings (~/.claude/settings.json),
 * so every Claude Code session, in every project, starts by refreshing that project's rules.
 *
 * What we add (format checked against https://code.claude.com/docs/en/hooks on 2026-11-14):
 *
 *   "hooks": {
 *     "SessionStart": [
 *       { "matcher": "startup|resume|clear|compact",
 *         "hooks": [ { "type": "command",
 *                      "command": "/abs/path/to/node",
 *                      "args": ["/abs/path/to/axiomic/dist/axiomic.js", "hook", "session-start"],
 *                      "timeout": 5 } ] }
 *     ]
 *   }
 *
 * Decisions:
 * - "Exec form" (command + args, no shell) with ABSOLUTE paths to node and to the installed axiomic.js:
 *   · no PATH lookup: Claude Code started from a Dock/IDE often has a different PATH than your terminal
 *     (nvm, volta, fnm put node on PATH only in shells), so a bare `axiomic` may not be found;
 *   · Windows: npm's `axiomic.cmd` shim is not a real executable and can't be run in exec form;
 *     node.exe + the script path works the same on every OS, with no Git Bash/PowerShell quoting issues;
 *   · it runs the INSTALLED axiomic, never `npx axiomic@latest` (supply-chain rule in PLAN.md).
 *   COMPATIBILITY: the `args` (exec) form needs a recent Claude Code. On an older one the entry is not
 *   understood and the hook is a harmless no-op: your session starts normally, it just doesn't refresh rules.
 *   `axiomic hook install` says so when it finishes.
 *   Downside: if that Node version or axiomic install is removed (e.g. `nvm uninstall`), the hook breaks.
 *   It fails open (the session still starts), `axiomic hook status` reports it, and
 *   `axiomic hook install` fixes it. Alternative rejected: `axiomic hook session-start` in shell form.
 * - timeout 5 (seconds): Claude Code's default is 600 and the first reply waits for the hook.
 *   The CLI also stops itself after 1.5 s, so 5 s is just a safety net.
 * - matcher "startup|resume|clear|compact": every way a session (re)loads its memory. Not "fork",
 *   which copies a session that already ran the hook. PROVISIONAL until the Phase 2 load-timing tests.
 * - We recognise OUR entry by its exact shape (args = [<…>/axiomic.js, "hook", "session-start"]), not by
 *   the word "axiomic" anywhere, so a user's own hook that merely mentions axiomic is never touched.
 *   We don't add a custom marker field: Claude Code validates settings, and unknown fields could be rejected.
 */
export const HOOK_TIMEOUT_SECONDS = 5;
export const HOOK_MATCHER = "startup|resume|clear|compact";
export const HOOK_SUBCOMMAND = ["hook", "session-start"] as const;
export const SCRIPT_FILE_NAME = "axiomic.js";

/** Where node and the installed axiomic script live, both absolute. */
export interface HookTarget {
  nodePath: string;
  scriptPath: string;
}

/** Thrown when settings.json can't be changed safely. The file is always left untouched. */
export class SettingsError extends Error {
  override name = "SettingsError";
}

type JsonObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The last part of a path, whichever slash it uses (settings may come from Windows). */
function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? "";
}

/** The handler we add. */
export function buildHookHandler(target: HookTarget): JsonObject {
  return {
    type: "command",
    command: target.nodePath,
    args: [target.scriptPath, ...HOOK_SUBCOMMAND],
    timeout: HOOK_TIMEOUT_SECONDS,
  };
}

/** True only for a handler with exactly our shape. */
export function isOurHandler(handler: unknown): boolean {
  if (!isPlainObject(handler) || handler.type !== "command" || !Array.isArray(handler.args)) return false;
  const [script, ...rest] = handler.args as unknown[];
  return (
    typeof script === "string" &&
    baseName(script) === SCRIPT_FILE_NAME &&
    rest.length === HOOK_SUBCOMMAND.length &&
    rest.every((arg, i) => arg === HOOK_SUBCOMMAND[i])
  );
}

/**
 * Checks the parts of the settings we will read or change. Anything unexpected → SettingsError,
 * so we never "fix" a file we don't understand. Other settings are not inspected at all.
 */
function sessionStartGroups(settings: unknown): JsonObject[] | undefined {
  if (!isPlainObject(settings)) throw new SettingsError("settings.json must contain a JSON object");
  if (!Object.hasOwn(settings, "hooks")) return undefined;
  const hooks = settings.hooks;
  if (!isPlainObject(hooks)) throw new SettingsError('"hooks" in settings.json is not an object');
  if (!Object.hasOwn(hooks, "SessionStart")) return undefined;
  const groups = hooks.SessionStart;
  if (!Array.isArray(groups)) throw new SettingsError('"hooks.SessionStart" in settings.json is not a list');
  for (const group of groups) {
    if (!isPlainObject(group) || !Array.isArray(group.hooks)) {
      throw new SettingsError('An entry in "hooks.SessionStart" has an unexpected shape');
    }
  }
  return groups as JsonObject[];
}

/** Finds our handler(s) and the group each one is in. */
export function findOurHandlers(settings: unknown): { group: JsonObject; handler: JsonObject }[] {
  const found: { group: JsonObject; handler: JsonObject }[] = [];
  for (const group of sessionStartGroups(settings) ?? []) {
    for (const handler of group.hooks as unknown[]) if (isOurHandler(handler)) found.push({ group, handler: handler as JsonObject });
  }
  return found;
}

/**
 * Removes our handler(s), changing `settings` in place. A group is dropped only if it's empty BECAUSE
 * we removed ours; the same for the SessionStart list and the hooks object. Returns true if anything changed.
 */
export function removeHookFromSettings(settings: unknown): boolean {
  const groups = sessionStartGroups(settings);
  if (!groups) return false;
  const root = settings as JsonObject;
  const hooks = root.hooks as JsonObject;

  let changed = false;
  const keptGroups: JsonObject[] = [];
  for (const group of groups) {
    const handlers = group.hooks as unknown[];
    const kept = handlers.filter((h) => !isOurHandler(h));
    if (kept.length === handlers.length) {
      keptGroups.push(group);
      continue;
    }
    changed = true;
    if (kept.length > 0) {
      group.hooks = kept;
      keptGroups.push(group);
    }
  }
  if (!changed) return false;

  if (keptGroups.length > 0) hooks.SessionStart = keptGroups;
  else {
    delete hooks.SessionStart;
    if (Object.keys(hooks).length === 0) delete root.hooks;
  }
  return true;
}

/** True if exactly one handler of ours exists and it's exactly what we would install now. */
function isCurrent(settings: unknown, target: HookTarget): boolean {
  const found = findOurHandlers(settings);
  if (found.length !== 1) return false;
  const [only] = found;
  return (
    only !== undefined &&
    only.group.matcher === HOOK_MATCHER &&
    JSON.stringify(only.handler) === JSON.stringify(buildHookHandler(target))
  );
}

/**
 * Adds our hook, changing `settings` in place. Idempotent: if it's already exactly right, nothing changes.
 * Otherwise any old copy (e.g. pointing at an older install) is removed and one fresh entry is added.
 */
export function addHookToSettings(settings: unknown, target: HookTarget): boolean {
  sessionStartGroups(settings); // validate the shape before changing anything
  if (isCurrent(settings, target)) return false;
  removeHookFromSettings(settings);

  const root = settings as JsonObject;
  if (!Object.hasOwn(root, "hooks")) root.hooks = {};
  const hooks = root.hooks as JsonObject;
  if (!Object.hasOwn(hooks, "SessionStart")) hooks.SessionStart = [];
  (hooks.SessionStart as unknown[]).push({ matcher: HOOK_MATCHER, hooks: [buildHookHandler(target)] });
  return true;
}

// ── settings.json on disk ─────────────────────────────────────────

/**
 * Claude Code's user settings file: $CLAUDE_CONFIG_DIR/settings.json if that env var is set
 * (Claude Code's own override), otherwise ~/.claude/settings.json.
 */
export function claudeSettingsPath(env: NodeJS.ProcessEnv, homedir: string): string {
  const custom = env.CLAUDE_CONFIG_DIR;
  const dir = custom && path.isAbsolute(custom) ? custom : path.join(homedir, ".claude");
  return path.join(dir, "settings.json");
}

interface LoadedSettings {
  /** The real file to write (a symlinked settings.json, e.g. from a dotfiles repo, is written through to its target). */
  realPath: string;
  /** The exact text read, or undefined if the file didn't exist. */
  originalText: string | undefined;
  settings: unknown;
  mode: number;
}

async function loadSettings(settingsPath: string): Promise<LoadedSettings> {
  // settings.json lives in the user's own home folder, not in an untrusted repo, so following a symlink here
  // is the user's choice (dotfiles managers do this). Replacing the link with a plain file would break their setup.
  let realPath = settingsPath;
  try {
    realPath = await fs.realpath(settingsPath);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }

  const existing = await readFileNoFollowWithInfo(realPath);
  if (existing === undefined) return { realPath, originalText: undefined, settings: {}, mode: 0o600 };

  const text = existing.data.toString("utf8");
  let settings: unknown;
  if (text.trim() === "") settings = {};
  else {
    try {
      settings = JSON.parse(text); // JSON.parse never calls setters, so a "__proto__" key is just data
    } catch {
      throw new SettingsError(`${realPath} is not valid JSON. Fix it by hand first; nothing was changed.`);
    }
  }
  return { realPath, originalText: text, settings, mode: existing.mode & 0o777 };
}

/** Keeps the file's indentation style (tabs or N spaces). Defaults to 2 spaces. */
function detectIndent(text: string | undefined): string | number {
  const match = text ? /^([ \t]+)"/m.exec(text) : null;
  if (!match?.[1]) return 2;
  return match[1].startsWith("\t") ? "\t" : match[1].length;
}

async function saveSettings(loaded: LoadedSettings): Promise<void> {
  const eol = loaded.originalText?.includes("\r\n") ? "\r\n" : "\n";
  let out = JSON.stringify(loaded.settings, null, detectIndent(loaded.originalText));
  if (eol === "\r\n") out = out.replace(/\n/g, "\r\n");
  if (loaded.originalText === undefined || /\r?\n$/.test(loaded.originalText)) out += eol;

  // Claude Code may write this file too. If it changed while we worked, stop rather than lose its change.
  const now = await readFileNoFollowWithInfo(loaded.realPath);
  if ((now?.data.toString("utf8") ?? undefined) !== loaded.originalText) {
    throw new SettingsError(`${loaded.realPath} changed while axiomic was editing it. Nothing was changed; try again.`);
  }

  if (loaded.originalText === undefined) await fs.mkdir(path.dirname(loaded.realPath), { recursive: true, mode: 0o700 });
  await writeFileAtomic(loaded.realPath, out, loaded.mode);
}

/**
 * Known limit (documented, not fixed): install/uninstall PARSE settings.json and write it back, so the
 * formatting is kept only approximately (indent style and line endings are kept; other spacing is not), duplicate
 * keys collapse to the last one, and so on. The one thing we refuse to do is lose DATA: JavaScript numbers are
 * doubles, so a numeric literal whose value would change on the way through (an integer beyond 2^53, 1e400, or
 * 9007199254740993.0) is refused. A literal that merely prints differently (1.0 -> 1, 1e2 -> 100) is the same
 * value, so it is fine. We compare the literal's significant digits and exponent with those of the number JavaScript
 * would write back. Scans the raw text, skipping strings.
 */
export function findUnsafeNumber(text: string): string | undefined {
  for (const match of text.matchAll(/"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g)) {
    const token = match[0];
    if (token.startsWith('"')) continue;
    const value = Number(token);
    if (!Number.isFinite(value) || decimalParts(token) !== decimalParts(JSON.stringify(value))) return token;
  }
  return undefined;
}

/** "digits e exponent" of a decimal literal with zeros trimmed, so 1.0, 1 and 1e0 all give "1e0". Sign of zero ignored. */
function decimalParts(literal: string): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(literal);
  if (!m) return literal;
  const frac = m[3] ?? "";
  let digits = (m[2]! + frac).replace(/^0+/, "");
  let exp = Number(m[4] ?? 0) - frac.length;
  if (digits === "") return "0";
  const trimmed = digits.replace(/0+$/, "");
  exp += digits.length - trimmed.length;
  digits = trimmed;
  return `${m[1]}${digits}e${exp}`;
}

function assertRewriteSafe(loaded: LoadedSettings): void {
  const unsafe = loaded.originalText === undefined ? undefined : findUnsafeNumber(loaded.originalText);
  if (unsafe !== undefined) {
    throw new SettingsError(
      `${loaded.realPath} contains the number ${unsafe}, which can't be stored exactly when axiomic rewrites the file. Nothing was changed; edit that file by hand instead.`,
    );
  }
}

export type HookChange = "installed" | "updated" | "unchanged" | "removed" | "absent";

export async function installClaudeHook(settingsPath: string, target: HookTarget, options: { dryRun?: boolean } = {}): Promise<HookChange> {
  const loaded = await loadSettings(settingsPath);
  const hadOne = findOurHandlers(loaded.settings).length > 0;
  if (!addHookToSettings(loaded.settings, target)) return "unchanged";
  assertRewriteSafe(loaded);
  if (!options.dryRun) await saveSettings(loaded);
  return hadOne ? "updated" : "installed";
}

export async function uninstallClaudeHook(settingsPath: string, options: { dryRun?: boolean } = {}): Promise<HookChange> {
  const loaded = await loadSettings(settingsPath);
  if (loaded.originalText === undefined) return "absent";
  if (!removeHookFromSettings(loaded.settings)) return "absent";
  assertRewriteSafe(loaded);
  // Deliberate: if removing our hook leaves the settings empty, we write `{}` rather than deleting the file.
  // Even if axiomic created this file, the user (or Claude Code) may have it open or rely on it existing, and an
  // empty object is a valid settings file that does nothing. Removing a file we can't prove is only ours is riskier.
  if (!options.dryRun) await saveSettings(loaded);
  return "removed";
}

export interface HookStatus {
  settingsPath: string;
  /** How many of our handlers are installed (should be 0 or 1). */
  count: number;
  /** The installed command and script, if any. */
  nodePath?: string;
  scriptPath?: string;
  /** Whether those files still exist (a removed Node version breaks the hook). */
  nodeExists?: boolean;
  scriptExists?: boolean;
  /** True if it's exactly what `hook install` would write for this axiomic. */
  current: boolean;
}

export async function claudeHookStatus(settingsPath: string, target: HookTarget | undefined): Promise<HookStatus> {
  const loaded = await loadSettings(settingsPath);
  const found = findOurHandlers(loaded.settings);
  const status: HookStatus = {
    settingsPath: loaded.realPath,
    count: found.length,
    current: target !== undefined && isCurrent(loaded.settings, target),
  };
  const first = found[0]?.handler;
  if (first) {
    const nodePath = typeof first.command === "string" ? first.command : undefined;
    const scriptPath = (first.args as unknown[])[0] as string;
    status.nodePath = nodePath;
    status.scriptPath = scriptPath;
    status.nodeExists = nodePath !== undefined && (await fileExists(nodePath));
    status.scriptExists = await fileExists(scriptPath);
  }
  return status;
}

/**
 * Works out the absolute paths the hook should run, and refuses setups that would make a fragile or
 * unsafe hook:
 *  - running from source (not the built axiomic.js);
 *  - a temporary runner folder (npx `_npx`, pnpm/yarn `dlx`, bun `bunx`/its install cache): gone soon, and
 *    its contents came from "latest" at that moment;
 *  - a PROJECT-LOCAL install (…/node_modules inside a project). The hook runs in EVERY Claude Code session of
 *    every project, so the code it runs must not be controlled by one repo's package.json/lockfile.
 *
 * How an install is judged, for each `node_modules` in the path (H = the folder that holds it):
 *   1. an axiomic.json in H or any folder above, or a .git in H          -> a project: refuse;
 *   2. H is a KNOWN GLOBAL layout (isKnownGlobalHolder)                  -> accept;
 *   3. anything else (a package.json beside it, or just some folder)    -> refuse.
 * So the rule is an allow-list of global layouts, not a guess about projects. A custom npm prefix that doesn't
 * end in `lib` (or `npm` on Windows) is refused with a message saying so; installing under a standard prefix fixes it.
 * Why .git is checked only in H and not above: nvm (~/.nvm) and Homebrew (/opt/homebrew) are git clones, and
 * their global `lib/node_modules` lives below them. Known global layouts are listed below, in one place.
 * `exists` is injected so the rule is unit-testable without a real disk.
 */
export async function resolveHookTarget(
  execPath: string,
  scriptPath: string,
  exists: (p: string) => Promise<boolean> = fileExists,
): Promise<HookTarget> {
  const isAbs = (p: string) => path.posix.isAbsolute(p) || path.win32.isAbsolute(p);
  if (!isAbs(execPath) || !isAbs(scriptPath)) throw new Error("Could not work out where node and axiomic are installed");
  if (baseName(scriptPath) !== SCRIPT_FILE_NAME) {
    throw new Error("The hook can only be installed from an installed axiomic (dist/axiomic.js), not from source");
  }

  const INSTALL_HINT = "Install axiomic globally (for example `npm install -g axiomic`, once a release is published), then run `axiomic hook install` from that copy.";
  const parts = scriptPath.split(/[\\/]/);
  if (parts.some((p) => p === "_npx" || p === "dlx" || /^dlx-/.test(p) || /^bunx-/.test(p)) || /[\\/]\.bun[\\/]install[\\/]cache[\\/]/.test(scriptPath)) {
    throw new Error(`axiomic is running from a temporary runner folder (npx, dlx or bunx), which is deleted later. ${INSTALL_HINT}`);
  }

  const win = /^[A-Za-z]:[\\/]/.test(scriptPath) || scriptPath.startsWith("\\\\");
  const mod = win ? path.win32 : path.posix;
  for (let i = parts.length - 1; i > 0; i--) {
    if (parts[i] !== "node_modules") continue;
    const holder = parts.slice(0, i).join(win ? "\\" : "/") || "/";
    if (await projectMarkerAt(holder, mod, exists)) {
      throw new Error(
        `axiomic is installed inside a project (${holder}). The hook runs in every Claude Code session, so it must not run code that one project's lockfile controls. ${INSTALL_HINT}`,
      );
    }
    if (!isKnownGlobalHolder(holder)) {
      throw new Error(
        `axiomic is installed in ${holder}/node_modules, which is not a recognised global install location, so it could be controlled by a project's package.json. ${INSTALL_HINT}`,
      );
    }
  }
  return { nodePath: execPath, scriptPath };
}

/**
 * The folders that hold a GLOBAL node_modules. `holder` is the folder directly above node_modules.
 *   <prefix>/lib                 npm prefix (/usr/local, Homebrew, ~/.npm-global, ~/.local, nvm, fnm, volta, asdf all end in lib)
 *   %APPDATA%\npm                npm on Windows
 *   .../pnpm/global/<n>          pnpm global store dir (it has its own package.json: still global)
 *   .../yarn/global, Yarn\Data\global, ~/.yarn/global    yarn global dir
 *   .../nvm/..., fnm, volta, asdf, nvm4w                    version managers on Windows (no lib folder there)
 *   .../nodejs                   Windows installer: C:\Program Files\nodejs
 */
export function isKnownGlobalHolder(holder: string): boolean {
  const p = holder.replace(/\\/g, "/").toLowerCase();
  return (
    /\/lib$/.test(p) ||
    /\/npm$/.test(p) ||
    /\/pnpm\/global(\/|$)/.test(p) ||
    /\/(yarn\/(data\/)?global|\.yarn\/global)$/.test(p) ||
    /\/(\.?nvm|nvm4w|fnm|\.?volta|\.?asdf)(\/|$)/.test(p) ||
    /\/nodejs$/.test(p) ||
    /\/\.npm-global$/.test(p)
  );
}

/** True if `holder` is a project: it has a .git or axiomic.json, or an axiomic.json exists in a folder above it. */
async function projectMarkerAt(holder: string, mod: typeof path.posix, exists: (p: string) => Promise<boolean>): Promise<boolean> {
  if (await exists(mod.join(holder, ".git"))) return true;
  for (let dir = holder; ; ) {
    if (await exists(mod.join(dir, "axiomic.json"))) return true;
    const parent = mod.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}
