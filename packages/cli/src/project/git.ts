/**
 * Asking Git questions about a project, safely.
 *
 * The project folder is UNTRUSTED: it comes from a repo someone else may control. So we never let the
 * repo decide which program runs or what configuration Git uses to run code:
 *
 *   1. We find the git program ourselves (resolveGitPath), by scanning PATH and skipping every entry
 *      that is empty, relative, or inside the project. On Windows, a bare "git" passed to execFile is
 *      looked up in the current folder FIRST, so a repo containing a git.exe would be run. We pass an
 *      absolute path, so no lookup happens at all.
 *   2. We start git from a neutral folder (where node itself lives), never from the project, and point
 *      it at the project with `-C <realRoot>`. A second layer of the same defence.
 *   3. Hardening flags (`-c ...`), for the commands we use (ls-files, check-ignore):
 *        core.fsmonitor=false   a repo's own config could name a program that git starts to watch files;
 *        core.hooksPath=<null>  repo hooks live in .git/hooks; no hook should run for us, whatever the repo sets.
 *      We deliberately do NOT set safe.directory: if Git refuses a repo owned by someone else
 *      ("dubious ownership"), we get "unknown" and treat it like "no Git", which is the safe outcome.
 *   4. A minimal environment (envForGit): GIT_DIR, GIT_EXTERNAL_DIFF, GIT_PAGER, GIT_SSH_COMMAND and the
 *      like can make git run programs or look at another repo, so none of them are passed on.
 *
 * execFile (not exec) runs the program directly with an argument list: no shell, so nothing in a path
 * can be read as a command, and `--` marks everything after it as a path, never an option.
 */
import { execFile } from "node:child_process";
import { constants, promises as fs } from "node:fs";
import path from "node:path";

const NULL_DEVICE = process.platform === "win32" ? "NUL" : "/dev/null";

/** Config we force on every call. See the list above for why. */
const HARDENING = ["-c", "core.fsmonitor=false", "-c", `core.hooksPath=${NULL_DEVICE}`];

export interface ResolveGitOptions {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  /** The (real) project folder. PATH entries inside it are never used. */
  projectRoot: string;
  /** True if `file` is a regular, runnable file. Injected so tests don't need a real disk. */
  isRunnable: (file: string) => Promise<boolean>;
  /** Resolves symlinks in a PATH entry (so a link into the project is caught). Defaults to fs.realpath. */
  realpath?: (dir: string) => Promise<string>;
}

/**
 * Finds the absolute path of the git program by walking PATH ourselves. Returns undefined if there is none
 * (treated as "git unavailable"). Skips: empty entries (they mean "the current folder"), relative entries,
 * and any entry inside the project. On Windows it tries each extension from PATHEXT, but only the ones that
 * can run without a shell (.exe/.com); .bat/.cmd can't be started safely by execFile.
 */
export async function resolveGitPath(options: ResolveGitOptions): Promise<string | undefined> {
  const { platform, env, projectRoot } = options;
  const win = platform === "win32";
  const pathModule = win ? path.win32 : path.posix;
  const realpath = options.realpath ?? fs.realpath;
  const raw = (win ? (env.Path ?? env.PATH ?? env.path) : env.PATH) ?? "";

  const exts = win
    ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
        .split(";")
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e === ".exe" || e === ".com")
    : [""];
  if (win && exts.length === 0) exts.push(".exe");

  // Folder comparisons are case-insensitive on Windows.
  const norm = (p: string) => (win ? pathModule.resolve(p).toLowerCase() : pathModule.resolve(p));
  const root = norm(projectRoot);
  const insideProject = (dir: string) => {
    const rel = pathModule.relative(root, norm(dir));
    return rel === "" || (!rel.startsWith("..") && !pathModule.isAbsolute(rel));
  };

  for (const entryRaw of raw.split(win ? ";" : ":")) {
    const entry = win ? entryRaw.trim().replace(/^"(.*)"$/, "$1") : entryRaw;
    if (entry === "" || !pathModule.isAbsolute(entry)) continue;
    if (insideProject(entry)) continue;
    try {
      if (insideProject(await realpath(entry))) continue;
    } catch {
      continue; // the folder doesn't exist or can't be read
    }
    for (const ext of exts) {
      const candidate = pathModule.join(entry, `git${ext}`);
      if (await options.isRunnable(candidate).catch(() => false)) return candidate;
    }
  }
  return undefined;
}

/** Real disk check: a regular file (links followed), and executable on POSIX. */
async function isRunnableOnDisk(file: string): Promise<boolean> {
  const info = await fs.stat(file);
  if (!info.isFile()) return false;
  if (process.platform !== "win32") await fs.access(file, constants.X_OK);
  return true;
}

/** The environment git gets: just what it needs to find its config and temp files. No GIT_* variables. */
export function envForGit(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const keep = [
    // PATH: git starts its own helpers. HOME/USERPROFILE/XDG_CONFIG_HOME: the user's own gitconfig and global ignore file.
    "PATH", "Path", "HOME", "USERPROFILE", "XDG_CONFIG_HOME",
    // Windows needs these to start at all.
    "SystemRoot", "windir", "ComSpec", "TEMP", "TMP", "TMPDIR", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA",
  ];
  const out: NodeJS.ProcessEnv = { GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };
  for (const name of keep) if (env[name] !== undefined) out[name] = env[name];
  return out;
}

const resolved = new Map<string, Promise<string | undefined>>();

/** Looks git up once per project folder per process (the answer doesn't change while we run). */
function gitPathFor(realRoot: string): Promise<string | undefined> {
  let found = resolved.get(realRoot);
  if (!found) {
    found = resolveGitPath({ platform: process.platform, env: process.env, projectRoot: realRoot, isRunnable: isRunnableOnDisk });
    resolved.set(realRoot, found);
  }
  return found;
}

type GitResult = { kind: "ok"; stdout: string } | { kind: "exit"; code: number } | { kind: "no-git" } | { kind: "failed"; reason: string };

async function runGit(dir: string, args: string[], timeoutMs: number, projectRoot = dir): Promise<GitResult> {
  const git = await gitPathFor(projectRoot);
  if (git === undefined) return { kind: "no-git" };
  return new Promise((resolve) => {
    execFile(
      git,
      [...HARDENING, "-C", dir, ...args],
      {
        cwd: path.dirname(process.execPath), // neutral folder: never the project
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        env: envForGit(process.env),
      },
      (error, stdout) => {
        if (!error) return resolve({ kind: "ok", stdout });
        const code = (error as { code?: unknown }).code;
        resolve(typeof code === "number" ? { kind: "exit", code } : { kind: "failed", reason: (error as Error).message.split("\n")[0] ?? "git failed" });
      },
    );
  });
}

/**
 * Asks Git which of `paths` (relative to `realRoot`) are tracked (committed or staged), i.e. would be
 * pushed with the code. A tracked rule file is a leak: the .gitignore block can't help once a file is tracked.
 *
 * Returns undefined if Git isn't installed, this isn't a Git repo, or Git is too slow.
 */
export async function gitTrackedFiles(realRoot: string, paths: string[], timeoutMs = 3000): Promise<string[] | undefined> {
  if (paths.length === 0) return [];
  const result = await runGit(realRoot, ["ls-files", "-z", "--", ...paths], timeoutMs);
  return result.kind === "ok" ? result.stdout.split("\0").filter((p) => p !== "") : undefined;
}

/** True if a `.git` (folder, or the file a submodule/worktree uses) exists at `dir` or any folder above it. */
export async function hasGitRepoAtOrAbove(dir: string): Promise<boolean> {
  for (let current = path.resolve(dir); ; ) {
    try {
      await fs.lstat(path.join(current, ".git"));
      return true;
    } catch {
      /* not here */
    }
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

/**
 * The answer to "does Git ignore these paths?":
 *   known   Git answered; `notIgnored` lists the paths it would NOT ignore (a tracked file counts as not ignored on purpose)
 *   open    there is nothing to leak into: git isn't installed, or no repository exists at or above the rules folder
 *   unknown there IS a repository but Git couldn't answer (exit 128, e.g. a broken submodule or "dubious ownership",
 *           a timeout, a crash). Callers must treat this as "do not write": fail CLOSED.
 */
export type IgnoreResult = { kind: "known"; notIgnored: string[] } | { kind: "open"; reason: string } | { kind: "unknown"; reason: string };

/**
 * Asks Git itself whether each of `relPaths` (relative to `realRoot`) would be ignored, using ALL of Git's rules:
 * every .gitignore (nested ones and `!` lines after our block too), .git/info/exclude and the global ignore file.
 *
 * It asks from the point of view of the rules folder (the nearest folder that exists on the way to the files), so
 * the INNERMOST repository answers: if `.claude` is a submodule or `.claude/rules` holds its own repo, those rules
 * decide, not the outer project's. (Asking from the project root would just fail with exit 128 there.)
 */
export async function gitCheckIgnored(realRoot: string, relPaths: string[], timeoutMs = 3000): Promise<IgnoreResult> {
  if (relPaths.length === 0) return { kind: "known", notIgnored: [] };
  // The nearest existing folder above the files (the rules folder may not have been created yet).
  let base = path.join(realRoot, path.dirname(relPaths[0]!));
  for (;;) {
    try {
      if ((await fs.lstat(base)).isDirectory()) break;
    } catch {
      /* missing: go up */
    }
    if (base === realRoot) break;
    base = path.dirname(base);
  }
  const asked = relPaths.map((p) => path.relative(base, path.join(realRoot, p)).split(path.sep).join("/"));

  if (!(await gitPathFor(realRoot))) return { kind: "open", reason: "git is not installed" };
  if (!(await hasGitRepoAtOrAbove(base))) return { kind: "open", reason: "no Git repository at or above the rules folder" };

  const result = await runGit(base, ["check-ignore", "--", ...asked], timeoutMs, realRoot);
  if (result.kind === "no-git") return { kind: "open", reason: "git is not installed" };
  if (result.kind === "failed") return { kind: "unknown", reason: result.reason };
  // check-ignore exit codes: 0 = at least one path is ignored (stdout lists them), 1 = none is, 128 = fatal.
  if (result.kind === "exit") {
    return result.code === 1 ? { kind: "known", notIgnored: [...relPaths] } : { kind: "unknown", reason: `git exited with code ${result.code}` };
  }
  // One path per line. Our paths are plain managed names, so Git never quotes them (-z needs --stdin, so we skip it).
  const ignored = new Set(result.stdout.split("\n").filter((p) => p !== ""));
  return { kind: "known", notIgnored: relPaths.filter((_, i) => !ignored.has(asked[i]!)) };
}

/** Convenience for callers that only want the not-ignored list: undefined unless Git actually answered. */
export async function gitNotIgnored(realRoot: string, paths: string[], timeoutMs = 3000): Promise<string[] | undefined> {
  const result = await gitCheckIgnored(realRoot, paths, timeoutMs);
  return result.kind === "known" ? result.notIgnored : undefined;
}

/** Only for tests that change PATH and need a fresh lookup. */
export function forgetResolvedGit(): void {
  resolved.clear();
}
