/**
 * What every command receives (CliContext), plus the small helpers they share:
 * strict flag parsing, axiomic's folders, the network, and where the hook would point.
 *
 * Everything the outside world provides (arguments, env vars, folders, where to print) comes in through
 * `CliContext`, so tests can run any command against temp folders without touching the real machine.
 * main.ts is the only place that reads the real `process`.
 */
import { parseArgs } from "node:util";
import { resolveHookTarget, type HookTarget } from "../hook/claude-settings";
import { resolveDirs, type AxiomicDirs } from "../local-files/dirs";
import type { FetchFn } from "../server/api-client";

export interface CliContext {
  /** Arguments after `node axiomic.js`. */
  argv: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  homedir: string;
  platform: NodeJS.Platform;
  /** Absolute path of the running node binary and of this script: what the hook will be told to run. */
  execPath: string;
  scriptPath: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** How to reach the server. main.ts passes the real fetch; tests pass a fake server. */
  fetch?: FetchFn;
  /** For login's polling: tests replace them so nothing really waits. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  openUrl?: (url: string) => Promise<boolean>;
}

/** A command as the router calls it: the context, the words after the command name, and back an exit code. */
export type Command = (ctx: CliContext, args: string[]) => Promise<number>;

/** A wrong command line: the router prints the message plus a hint, and exits 2. */
export class UsageError extends Error {}

/** Parses flags strictly: an unknown flag or a stray word is a usage error, not silently ignored. */
export function parseFlags<const T extends Record<string, { type: "boolean" | "string" }>>(args: string[], options: T, positionals = 0) {
  try {
    const parsed = parseArgs({ args, options, allowPositionals: positionals > 0, strict: true });
    if (parsed.positionals.length > positionals) throw new Error(`Unexpected argument: ${parsed.positionals[positionals]}`);
    return parsed;
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
}

export function dirsOf(ctx: CliContext): AxiomicDirs {
  return resolveDirs({ platform: ctx.platform, env: ctx.env, homedir: ctx.homedir });
}

export function requireFetch(ctx: CliContext): FetchFn {
  if (!ctx.fetch) throw new Error("this command needs the network, which isn't available here");
  return ctx.fetch;
}

/** Where the hook would point if installed from this axiomic. Undefined when running from source or npx. */
export async function hookTargetOrUndefined(ctx: CliContext): Promise<HookTarget | undefined> {
  try {
    return await resolveHookTarget(ctx.execPath, ctx.scriptPath);
  } catch {
    return undefined;
  }
}
