import { describe, expect, it } from "vitest";
import { resolveDirs } from "./dirs";

describe("resolveDirs", () => {
  it("uses ~/.config, ~/.cache and ~/.local/state on macOS/Linux", () => {
    expect(resolveDirs({ platform: "darwin", env: {}, homedir: "/Users/dev" })).toEqual({
      config: "/Users/dev/.config/axiomic",
      cache: "/Users/dev/.cache/axiomic",
      state: "/Users/dev/.local/state/axiomic",
    });
  });

  it("honours absolute XDG variables and ignores relative ones", () => {
    const dirs = resolveDirs({
      platform: "linux",
      env: { XDG_CONFIG_HOME: "/x/config", XDG_CACHE_HOME: "relative/cache", XDG_STATE_HOME: "" },
      homedir: "/home/dev",
    });
    expect(dirs).toEqual({ config: "/x/config/axiomic", cache: "/home/dev/.cache/axiomic", state: "/home/dev/.local/state/axiomic" });
  });

  it("uses %APPDATA% and %LOCALAPPDATA% on Windows", () => {
    const dirs = resolveDirs({
      platform: "win32",
      env: { APPDATA: "C:\\Users\\dev\\AppData\\Roaming", LOCALAPPDATA: "D:\\Local" },
      homedir: "C:\\Users\\dev",
    });
    expect(dirs).toEqual({ config: "C:\\Users\\dev\\AppData\\Roaming\\axiomic", cache: "D:\\Local\\axiomic\\cache", state: "D:\\Local\\axiomic\\state" });
  });

  it("falls back to the home folder on Windows when the variables are missing or relative", () => {
    const dirs = resolveDirs({ platform: "win32", env: { APPDATA: "Roaming" }, homedir: "C:\\Users\\dev" });
    expect(dirs.config).toBe("C:\\Users\\dev\\AppData\\Roaming\\axiomic");
    expect(dirs.cache).toBe("C:\\Users\\dev\\AppData\\Local\\axiomic\\cache");
  });
});
