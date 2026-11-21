import { promises as fs } from "node:fs";
import path from "node:path";
import type { FetchFn } from "../server/api-client";
import { resolveApiUrl } from "../server/api-url";
import { resolveAuth, type Auth } from "../server/auth";
import { readCache } from "../local-files/cache";
import type { AxiomicDirs } from "../local-files/dirs";
import { findProjectRoot, readProjectConfig } from "../project/project-config";
import { projectKey } from "../project/project-key";
import { applyRules, fetchRules, isAccessGone, removeProjectRules, writeProjectFiles } from "../sync/rules-sync";

/**
 * What runs when Claude Code starts a session (`axiomic hook session-start`, called by the hook).
 *
 *   axiomic.json here? ──no──► do nothing
 *        │yes
 *   logged in? ──yes──► GET /api/v1/pull (short timeout) ──ok──► write files + save cache. Done.
 *        │no                     │ 401 / 404 (token revoked, no access any more)
 *        │                       ├──► delete this project's rule files + cache (offboarding). Done.
 *        │                       │ anything else (offline, slow, server error)
 *        ▼                       ▼
 *   cached copy for this project and server? ──yes──► make the files match it (e.g. after `git clean`)
 *
 * Rules for this code path (enforced by the caller, hook/entry.ts):
 * - NEVER print to stdout: Claude Code adds a SessionStart hook's stdout to the AI's context.
 * - Always exit 0, and stop after HOOK_HARD_TIMEOUT_MS, so the session is never blocked (fail open).
 */
export interface SessionStartInput {
  env: NodeJS.ProcessEnv;
  cwd: string;
  dirs: AxiomicDirs;
  /** Debug messages (stderr, only with AXIOMIC_DEBUG=1). */
  debug: (message: string) => void;
  /** Stop starting new file operations after this time (ms since epoch), so we finish cleanly before the hard exit. */
  deadline?: number;
  /** How to reach the server. Without it (tests of the offline path), only the cache is used. */
  fetch?: FetchFn;
  /** Longest wait for the server; the cache is used after that. */
  networkTimeoutMs?: number;
}

export async function runSessionStart({ env, cwd, dirs, debug, deadline, fetch: fetchFn, networkTimeoutMs = 1200 }: SessionStartInput): Promise<void> {
  // Claude Code tells hooks where the project is. Fall back to the current folder.
  const projectDir = env.CLAUDE_PROJECT_DIR && path.isAbsolute(env.CLAUDE_PROJECT_DIR) ? env.CLAUDE_PROJECT_DIR : cwd;

  const root = await findProjectRoot(projectDir);
  if (!root) return debug("not an axiomic project (no axiomic.json found)");

  const config = await readProjectConfig(root);
  if (!config) return debug("axiomic.json disappeared");
  const realRoot = await fs.realpath(root);
  const timing = deadline === undefined ? {} : { deadline };

  let auth: Auth | undefined;
  try {
    auth = await resolveAuth(env, dirs.config);
  } catch (error) {
    debug(`login problem: ${(error as Error).message}`);
  }

  // 1. The server, if logged in.
  if (auth && fetchFn) {
    try {
      const answer = await fetchRules({ auth, fetch: fetchFn, config, timeoutMs: networkTimeoutMs });
      const report = await applyRules({ auth, realRoot, config, dirs, ...timing }, answer);
      return debug(`pulled rules v${answer.version}: ${JSON.stringify(report)}`);
    } catch (error) {
      if (isAccessGone(error)) {
        const report = await removeProjectRules({ realRoot, dirs, ...timing });
        return debug(`access gone (${(error as Error).message}); removed rule files: ${JSON.stringify(report)}`);
      }
      debug(`pull failed, using the cache: ${(error as Error).message}`);
    }
  }

  // 2. The offline cache.
  const cache = await readCache(dirs.cache, await projectKey(realRoot));
  if (!cache) return debug("no cached rules for this project");

  // Only apply a cache that belongs to this exact project on this exact server.
  if (cache.space !== config.space || cache.project !== config.project) return debug("cache is for a different project");
  let apiUrl: string;
  try {
    apiUrl = auth?.apiUrl ?? resolveApiUrl(env);
  } catch (error) {
    return debug(`server URL problem: ${(error as Error).message}`);
  }
  if (cache.apiUrl !== apiUrl) return debug("cache is from a different server");

  const report = await writeProjectFiles({ realRoot, dirs, ...timing }, cache.files);
  debug(`applied cached rules v${cache.version}: ${JSON.stringify(report)}`);
}
