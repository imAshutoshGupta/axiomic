import os from "node:os";
import { fileURLToPath } from "node:url";
import { runCli } from "./cli";

/**
 * The process entry: the only file that touches the real `process`.
 * It hands the real arguments, env vars and folders to runCli() and exits with the code it returns.
 *
 * Why process.exitCode + a forced exit only for the hook?
 * - Normal commands set exitCode and let Node finish on its own, so buffered output is never cut off.
 * - The session hook calls process.exit(): if its time limit ran out, file work may still be pending,
 *   and Claude Code must not be kept waiting for it. The hook prints nothing to stdout, so nothing is lost.
 */
const argv = process.argv.slice(2);
const isHookEntry = argv[0] === "hook" && argv[1] === "session-start";

try {
  const code = await runCli({
    argv,
    env: process.env,
    cwd: process.cwd(),
    homedir: os.homedir(),
    platform: process.platform,
    execPath: process.execPath,
    scriptPath: fileURLToPath(import.meta.url),
    stdout: (text) => void process.stdout.write(text),
    stderr: (text) => void process.stderr.write(text),
    fetch: globalThis.fetch,
  });
  if (isHookEntry) process.exit(0);
  process.exitCode = code;
} catch {
  // runCli catches its own errors; this is only for something truly unexpected (e.g. no home folder).
  if (isHookEntry) process.exit(0); // fail open
  process.stderr.write("axiomic: unexpected error\n");
  process.exitCode = 1;
}
