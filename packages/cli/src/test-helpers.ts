import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AxiomicDirs } from "./dirs";

/**
 * Helpers for tests. Every test works in its own fresh folder under the system temp folder,
 * so nothing ever reads or writes the real ~/.claude, ~/.config or a real repo.
 */
export const POSIX = process.platform !== "win32";

/** A fresh, empty temp folder (real path, so macOS's /var → /private/var link doesn't confuse comparisons). */
export async function makeTempDir(): Promise<string> {
  return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "axiomic-test-")));
}

export interface Sandbox {
  /** The temp folder everything lives in. */
  base: string;
  /** A fake home folder. */
  home: string;
  /** A fake project folder. */
  project: string;
  dirs: AxiomicDirs;
  /** Env vars that point every axiomic and Claude Code folder into the sandbox. */
  env: NodeJS.ProcessEnv;
  settingsPath: string;
}

export async function makeSandbox(): Promise<Sandbox> {
  const base = await makeTempDir();
  const home = path.join(base, "home");
  const project = path.join(base, "project");
  await fs.mkdir(home);
  await fs.mkdir(project);
  const dirs = { config: path.join(base, "config", "axiomic"), cache: path.join(base, "cache", "axiomic"), state: path.join(base, "state", "axiomic") };
  const env = {
    XDG_CONFIG_HOME: path.join(base, "config"),
    XDG_CACHE_HOME: path.join(base, "cache"),
    XDG_STATE_HOME: path.join(base, "state"),
    CLAUDE_CONFIG_DIR: path.join(home, ".claude"),
  };
  return { base, home, project, dirs, env, settingsPath: path.join(home, ".claude", "settings.json") };
}

export async function exists(p: string): Promise<boolean> {
  return fs.lstat(p).then(
    () => true,
    () => false,
  );
}

/** The permission bits of a file or folder, e.g. 0o600. */
export async function modeOf(p: string): Promise<number> {
  return (await fs.stat(p)).mode & 0o777;
}

/** Every file under a folder, as relative paths (to spot leftover temp files). */
export async function listAll(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((e) => !e.isDirectory()).map((e) => path.relative(dir, path.join(e.parentPath, e.name))).sort();
}
