import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Safety net, run before every test file: point every "where is the user's home / config / cache"
 * variable at a throwaway folder. Tests already pass their own sandbox folders into the code, so
 * this should never matter. It exists so that a future mistake (code that falls back to os.homedir()
 * or reads process.env directly) lands in a temp folder instead of the real ~/.claude, ~/.config or ~/.cache.
 */
const fakeHome = mkdtempSync(path.join(os.tmpdir(), "axiomic-test-home-"));

process.env.HOME = fakeHome; // os.homedir() reads this on macOS/Linux
process.env.USERPROFILE = fakeHome; // ... and this on Windows
process.env.APPDATA = path.join(fakeHome, "AppData", "Roaming");
process.env.LOCALAPPDATA = path.join(fakeHome, "AppData", "Local");
process.env.XDG_CONFIG_HOME = path.join(fakeHome, ".config");
process.env.XDG_CACHE_HOME = path.join(fakeHome, ".cache");
process.env.XDG_STATE_HOME = path.join(fakeHome, ".local", "state");
process.env.CLAUDE_CONFIG_DIR = path.join(fakeHome, ".claude");
delete process.env.AXIOMIC_API_URL;
