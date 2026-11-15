import { promises as fs } from "node:fs";
import path from "node:path";
import type { FetchFn } from "./api-client";
import { resolveAuth, type Auth } from "./auth";
import type { AxiomicDirs } from "./dirs";
import { hasGitRepoAtOrAbove } from "./git";
import { findProjectRoot, isValidSlug, PROJECT_CONFIG_FILE, readProjectConfig, writeProjectConfig, type ProjectConfig } from "./project-config";
import { listProjects, type PullAnswer, type SpaceList } from "./remote";
import { applyRules, fetchRules, isAccessGone, removeProjectRules } from "./sync";
import type { WriteReport } from "./writer";

/**
 * `axiomic pull` and `axiomic init` (DECISIONS #59). Both fetch first and write second, so a
 * project you can't reach changes nothing on disk.
 */
export interface ProjectDeps {
  fetch: FetchFn;
  env: NodeJS.ProcessEnv;
  cwd: string;
  dirs: AxiomicDirs;
}

const TIMEOUT_MS = 20_000;

/** Readable error for "not logged in". */
export class NotLoggedInError extends Error {
  constructor() {
    super('not logged in. Run "axiomic login" first.');
  }
}

async function requireAuth(deps: ProjectDeps): Promise<Auth> {
  const auth = await resolveAuth(deps.env, deps.dirs.config);
  if (!auth) throw new NotLoggedInError();
  return auth;
}

/** Thrown when the server says no (401/404) and the project's rule files were removed because of it. */
export class AccessGoneError extends Error {
  constructor(
    message: string,
    readonly report: WriteReport,
  ) {
    super(message);
  }
}

export interface PullOutcome {
  root: string;
  answer: PullAnswer;
  report: WriteReport;
}

export async function pullCommand(deps: ProjectDeps, options: { force?: boolean } = {}): Promise<PullOutcome> {
  const root = await findProjectRoot(deps.cwd);
  if (!root) throw new Error(`no ${PROJECT_CONFIG_FILE} in this folder or above it. Run "axiomic init" in your repo first.`);
  const config = (await readProjectConfig(root))!;
  const auth = await requireAuth(deps);
  const realRoot = await fs.realpath(root);
  try {
    const answer = await fetchRules({ auth, fetch: deps.fetch, config, timeoutMs: TIMEOUT_MS });
    const report = await applyRules({ auth, realRoot, config, dirs: deps.dirs, ...(options.force ? { force: true } : {}) }, answer);
    return { root, answer, report };
  } catch (error) {
    if (!isAccessGone(error)) throw error;
    // Offboarding: no valid login, or no access to this project any more → its rule files go.
    const report = await removeProjectRules({ realRoot, dirs: deps.dirs });
    const reason = (error as Error).message.replace(/\.$/, "");
    throw new AccessGoneError(`${reason}. axiomic removed this project's rule files from this computer.`, report);
  }
}

// ----- init -----

/** "acme/web-app" → { space, project }; anything else → undefined. */
export function parseProjectRef(text: string): { space: string; project: string } | undefined {
  const parts = text.split("/");
  if (parts.length !== 2 || !isValidSlug(parts[0]) || !isValidSlug(parts[1])) return undefined;
  return { space: parts[0], project: parts[1] };
}

export type InitOutcome =
  | { kind: "choose"; spaces: SpaceList["spaces"] }
  | { kind: "linked"; root: string; created: boolean; outcome: PullOutcome };

/**
 * Links this repo to a project:
 *   - axiomic.json already here (a teammate committed it): just pull. No questions.
 *   - no axiomic.json and no project given: list what you can link (kind "choose"), change nothing.
 *   - project given: check you can pull it, THEN write axiomic.json, then the rule files.
 * It must run at the top of the repo, where Claude Code looks for .claude/rules.
 */
export async function initCommand(deps: ProjectDeps, ref: { space: string; project: string } | undefined): Promise<InitOutcome> {
  const auth = await requireAuth(deps);
  const existingRoot = await findProjectRoot(deps.cwd);

  if (existingRoot) {
    const config = (await readProjectConfig(existingRoot))!;
    if (ref && (ref.space !== config.space || ref.project !== config.project)) {
      throw new Error(
        `this repo is already linked to ${config.space}/${config.project} (${path.join(existingRoot, PROJECT_CONFIG_FILE)}). ` +
          "To link it to another project, edit or delete that file first.",
      );
    }
    return { kind: "linked", root: existingRoot, created: false, outcome: await pullCommand({ ...deps, cwd: existingRoot }) };
  }

  if (!ref) return { kind: "choose", spaces: (await listProjects({ apiUrl: auth.apiUrl, token: auth.token, fetch: deps.fetch, timeoutMs: TIMEOUT_MS })).spaces };

  // Claude Code reads .claude/rules at the project root, so axiomic.json belongs at the top of the repo.
  const root = path.resolve(deps.cwd);
  const atTop = await fs.lstat(path.join(root, ".git")).then(() => true, () => false);
  if (!atTop && (await hasGitRepoAtOrAbove(root))) {
    throw new Error("run axiomic init at the top of your Git repository (the folder that contains .git).");
  }

  const config: ProjectConfig = { schemaVersion: 1, space: ref.space, project: ref.project };
  const realRoot = await fs.realpath(root);
  // Fetch first: a project that doesn't exist or that you can't read leaves the repo untouched.
  const answer = await fetchRules({ auth, fetch: deps.fetch, config, timeoutMs: TIMEOUT_MS });
  await writeProjectConfig(root, config);
  const report = await applyRules({ auth, realRoot, config, dirs: deps.dirs }, answer);
  return { kind: "linked", root, created: true, outcome: { root, answer, report } };
}
