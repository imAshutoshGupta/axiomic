import { spawn } from "node:child_process";

/**
 * Opens a URL in the default browser, for `axiomic login`. Best effort: if it fails, the URL is
 * printed anyway and you open it yourself.
 *
 * Safety: only http(s) URLs, and the URL is passed as ONE argument with no shell in between,
 * so nothing in it can run as a command. (On Windows we avoid `cmd /c start`, which would
 * re-read the URL as shell text, and use rundll32 instead.)
 */
export function openUrl(url: string, platform: NodeJS.Platform = process.platform): Promise<boolean> {
  if (!/^https?:\/\/[^\s"'`]+$/.test(url)) return Promise.resolve(false);
  const [command, args] =
    platform === "darwin"
      ? ["open", [url]]
      : platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]];
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args as string[], { stdio: "ignore", detached: true, shell: false });
      child.once("error", () => resolve(false));
      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}
