import path from "node:path";

/**
 * Where axiomic keeps its own files on this computer (never inside a project):
 *
 * | Folder | What's in it                              | macOS / Linux                         | Windows                        |
 * |--------|-------------------------------------------|---------------------------------------|--------------------------------|
 * | config | credentials.json (the login token)        | $XDG_CONFIG_HOME/axiomic or ~/.config/axiomic | %APPDATA%\axiomic         |
 * | cache  | last rules fetched, for offline use       | $XDG_CACHE_HOME/axiomic or ~/.cache/axiomic   | %LOCALAPPDATA%\axiomic\cache |
 * | state  | hashes of the files we wrote (manifest)   | $XDG_STATE_HOME/axiomic or ~/.local/state/axiomic | %LOCALAPPDATA%\axiomic\state |
 *
 * Why a separate "state" folder for the manifest? Cache folders may be wiped at any time by cleanup tools.
 * If the manifest disappeared, axiomic would no longer know which rule files it owns and would refuse to
 * update them. The XDG "state" folder is meant for exactly this kind of data that should survive.
 *
 * Everything (platform, env vars, home folder) is passed in, so tests can check the Windows branch on a Mac.
 */
export interface DirsInput {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  homedir: string;
}

export interface AxiomicDirs {
  config: string;
  cache: string;
  state: string;
}

export function resolveDirs({ platform, env, homedir }: DirsInput): AxiomicDirs {
  if (platform === "win32") {
    // Use Windows path rules even when the tests run on macOS.
    const p = path.win32;
    const roaming = absoluteOr(env.APPDATA, p) ?? p.join(homedir, "AppData", "Roaming");
    const local = absoluteOr(env.LOCALAPPDATA, p) ?? p.join(homedir, "AppData", "Local");
    return {
      config: p.join(roaming, "axiomic"),
      cache: p.join(local, "axiomic", "cache"),
      state: p.join(local, "axiomic", "state"),
    };
  }

  const p = path.posix;
  // The XDG spec says relative paths in these variables are invalid and must be ignored.
  return {
    config: p.join(absoluteOr(env.XDG_CONFIG_HOME, p) ?? p.join(homedir, ".config"), "axiomic"),
    cache: p.join(absoluteOr(env.XDG_CACHE_HOME, p) ?? p.join(homedir, ".cache"), "axiomic"),
    state: p.join(absoluteOr(env.XDG_STATE_HOME, p) ?? p.join(homedir, ".local", "state"), "axiomic"),
  };
}

/** Returns the value only if it's a non-empty absolute path. */
function absoluteOr(value: string | undefined, p: path.PlatformPath): string | undefined {
  return value && p.isAbsolute(value) ? value : undefined;
}
