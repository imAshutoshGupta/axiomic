import { ApiError, type FetchFn } from "../server/api-client";
import type { Auth } from "../server/auth";
import { deleteCache, writeCache } from "../local-files/cache";
import type { AxiomicDirs } from "../local-files/dirs";
import { ensureIgnoreBlocks } from "../local-files/ignore-block";
import type { ProjectConfig } from "../project/project-config";
import { projectKey } from "../project/project-key";
import { pullRules, type PullAnswer } from "../server/endpoints";
import { writeRuleFiles, type WriteReport } from "../local-files/writer";

/**
 * Pull = fetch from the server, then apply (DECISIONS #59):
 *
 *   GET /api/v1/pull ──► writeRuleFiles (ignore blocks first, then Git check, then files) ──► save the offline cache
 *
 * The cache is saved only AFTER the files were written, so it always holds what a working pull delivered.
 * Used by `axiomic pull`, `axiomic init` and the session hook.
 */
export interface SyncInput {
  auth: Auth;
  fetch: FetchFn;
  /** The project's real path (symlinks resolved). */
  realRoot: string;
  config: Pick<ProjectConfig, "space" | "project">;
  dirs: AxiomicDirs;
  timeoutMs: number;
  /** Writer's soft deadline (ms since epoch), for the hook. */
  deadline?: number;
  force?: boolean;
  now?: () => Date;
}

export async function fetchRules(input: Pick<SyncInput, "auth" | "fetch" | "config" | "timeoutMs">): Promise<PullAnswer> {
  return pullRules({ apiUrl: input.auth.apiUrl, token: input.auth.token, fetch: input.fetch, timeoutMs: input.timeoutMs }, input.config.space, input.config.project);
}

/**
 * Writes rule files into the project: ignore blocks first (via `prepare`), then the Git check,
 * then the files (the writer enforces that order). No cache change: the hook's offline path uses this.
 */
export async function writeProjectFiles(
  input: Pick<SyncInput, "realRoot" | "dirs" | "deadline" | "force">,
  files: PullAnswer["files"],
): Promise<WriteReport> {
  return writeRuleFiles({
    projectRoot: input.realRoot,
    stateDir: input.dirs.state,
    files,
    ...(input.force ? { force: true } : {}),
    ...(input.deadline === undefined ? {} : { deadline: input.deadline }),
    prepare: async () => {
      const result = await ensureIgnoreBlocks(input.realRoot);
      // Remember which ignore files WE created, so `remove` may delete exactly those and never a pre-existing one.
      const created: string[] = [];
      if (result.gitignore === "created") created.push(".gitignore");
      if (result.dockerignore === "created") created.push(".dockerignore");
      return { ignoreFilesCreated: created };
    },
  });
}

/** Writes a freshly fetched answer into the project, then saves it as the offline cache. */
export async function applyRules(input: Omit<SyncInput, "fetch" | "timeoutMs">, answer: PullAnswer): Promise<WriteReport> {
  const report = await writeProjectFiles(input, answer.files);
  // Only a complete write becomes the cache: a half-done hook run must not look "current".
  if (report.deferred.length === 0) {
    await writeCache(input.dirs.cache, await projectKey(input.realRoot), {
      schemaVersion: 1,
      apiUrl: input.auth.apiUrl,
      space: input.config.space,
      project: input.config.project,
      version: answer.version,
      etag: null,
      fetchedAt: (input.now?.() ?? new Date()).toISOString(),
      files: answer.files,
      rules: answer.rules,
    });
  }
  return report;
}

/**
 * Offboarding (DB-DESIGN 2): the server says this token is no longer valid (401), or this
 * person no longer has access to the project (404). Then the rule files must not stay on the
 * laptop: delete the ones axiomic wrote, and the offline cache. Files edited locally are kept
 * and reported (the writer never silently deletes someone's edit), like any other pull.
 */
export function isAccessGone(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 404);
}

export async function removeProjectRules(input: Pick<SyncInput, "realRoot" | "dirs" | "deadline">): Promise<WriteReport> {
  const report = await writeRuleFiles({
    projectRoot: input.realRoot,
    stateDir: input.dirs.state,
    files: [],
    ...(input.deadline === undefined ? {} : { deadline: input.deadline }),
  });
  await deleteCache(input.dirs.cache, await projectKey(input.realRoot));
  return report;
}
