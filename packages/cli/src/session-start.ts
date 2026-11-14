import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveApiUrl } from "./api-url";
import { readCache } from "./cache";
import { readCredentials } from "./credentials";
import type { AxiomicDirs } from "./dirs";
import { ensureIgnoreBlocks } from "./ignore-block";
import { findProjectRoot, readProjectConfig } from "./project-config";
import { projectKey } from "./project-key";
import { writeRuleFiles } from "./writer";

/**
 * What runs when Claude Code starts a session (`axiomic hook session-start`, called by the hook).
 *
 * TODAY (no server yet): if this folder is an axiomic project and there's a cached copy of its rules,
 * make sure the files on disk match it (e.g. restore them after `git clean`). Otherwise do nothing.
 *
 * LATER: this is where the network pull gets wired in:
 *   fetch with If-None-Match (ETag) and a ~1 s timeout → on success write files + update cache
 *   → on any failure fall back to the cache below.
 *
 * Why a separate hidden command instead of the hook calling `axiomic pull --quiet`?
 * `pull` isn't implemented, and a fake `pull` that pretends to work would be misleading. This command
 * is honest about what it does, and the hook entry won't need to change when pull arrives.
 *
 * Rules for this code path (enforced by the caller in cli.ts):
 * - NEVER print to stdout: Claude Code adds a SessionStart hook's stdout to the AI's context.
 * - Always exit 0, and stop after 1.5 s, so the session is never blocked or broken (fail open).
 */
export interface SessionStartInput {
  env: NodeJS.ProcessEnv;
  cwd: string;
  dirs: AxiomicDirs;
  /** Debug messages (stderr, only with AXIOMIC_DEBUG=1). */
  debug: (message: string) => void;
  /** Stop starting new file operations after this time (ms since epoch), so we finish cleanly before the hard exit. */
  deadline?: number;
}

export async function runSessionStart({ env, cwd, dirs, debug, deadline }: SessionStartInput): Promise<void> {
  // Claude Code tells hooks where the project is. Fall back to the current folder.
  const projectDir = env.CLAUDE_PROJECT_DIR && path.isAbsolute(env.CLAUDE_PROJECT_DIR) ? env.CLAUDE_PROJECT_DIR : cwd;

  const root = await findProjectRoot(projectDir);
  if (!root) return debug("not an axiomic project (no axiomic.json found)");

  const config = await readProjectConfig(root);
  if (!config) return debug("axiomic.json disappeared");

  const realRoot = await fs.realpath(root);
  const cache = await readCache(dirs.cache, await projectKey(realRoot));
  if (!cache) return debug("no cached rules for this project");

  // Only apply a cache that belongs to this exact project on this exact server.
  if (cache.org !== config.org || cache.project !== config.project) return debug("cache is for a different project");
  let apiUrl: string;
  try {
    apiUrl = (await readCredentials(dirs.config))?.apiUrl ?? resolveApiUrl(env);
  } catch (error) {
    return debug(`credentials problem: ${(error as Error).message}`);
  }
  if (cache.apiUrl !== apiUrl) return debug("cache is from a different server");

  // Order matters, and the writer enforces it: (1) plan, which refuses anything knowable up front (a symlinked
  // .claude, a FIFO where a rule file should be, a bad path), BEFORE we touch .gitignore; (2) `prepare` writes the
  // ignore blocks, so the rule files never exist without being ignored; (3) ask Git whether they really are
  // ignored (a `!` line could undo our block) and write nothing if not; (4) write the files.
  const report = await writeRuleFiles({
    projectRoot: realRoot,
    stateDir: dirs.state,
    files: cache.files,
    ...(deadline === undefined ? {} : { deadline }),
    prepare: async () => {
      const result = await ensureIgnoreBlocks(realRoot);
      // Remember which ignore files WE created, so `remove` may delete exactly those and never a pre-existing one.
      const created: string[] = [];
      if (result.gitignore === "created") created.push(".gitignore");
      if (result.dockerignore === "created") created.push(".dockerignore");
      return { ignoreFilesCreated: created };
    },
  });
  debug(`applied cached rules v${cache.version}: ${JSON.stringify(report)}`);
}
