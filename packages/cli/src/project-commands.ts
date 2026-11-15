import { promises as fs } from "node:fs";
import path from "node:path";
import type { FetchFn } from "./api-client";
import { resolveAuth, type Auth } from "./auth";
import type { AxiomicDirs } from "./dirs";
import { hasGitRepoAtOrAbove } from "./git";
import { findProjectRoot, isValidSlug, PROJECT_CONFIG_FILE, readProjectConfig, writeProjectConfig, type ProjectConfig } from "./project-config";
import { readCache } from "./cache";
import { projectKey } from "./project-key";
import { readFileNoFollow, writeFileAtomic } from "./fs-safe";
import { isManagedRulePath, splitManagedPath } from "./managed-paths";
import { checkRuleDirs } from "./writer";
import { diffLines, formatDiff } from "./line-diff";
import { knownPaths, readManifest } from "./manifest";
import { planPush, type PushPlan } from "./push-plan";
import { listProjects, pullRules, pushChanges, type PullAnswer, type PushResult, type SpaceList } from "./remote";
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

// ----- push (DECISIONS #64) -----

export interface PushOutcome {
  plan: PushPlan;
  /** Undefined when not sent (preview, or nothing to send). */
  results?: PushResult[];
  /** The pull made right after sending, so saved edits come back as the server's text. */
  after?: PullOutcome;
}

/**
 * Without `send`: only works out and returns the plan (the preview). With `send`: posts it,
 * then pulls, so what was saved is written back in the server's own form.
 */
export async function pushCommand(deps: ProjectDeps, options: { send: boolean }): Promise<PushOutcome> {
  const root = await findProjectRoot(deps.cwd);
  if (!root) throw new Error(`no ${PROJECT_CONFIG_FILE} in this folder or above it. Run "axiomic init" in your repo first.`);
  const config = (await readProjectConfig(root))!;
  const auth = await requireAuth(deps);
  const realRoot = await fs.realpath(root);

  const cache = await readCache(deps.dirs.cache, await projectKey(realRoot));
  if (!cache || cache.space !== config.space || cache.project !== config.project) {
    throw new Error('nothing to compare with: run "axiomic pull" first, then make your edits.');
  }
  if (cache.apiUrl !== auth.apiUrl) throw new Error(`your last pull came from ${cache.apiUrl}, but you are logged in to ${auth.apiUrl}. Run "axiomic pull" first.`);

  const plan = await planPush(realRoot, cache);
  if (!options.send || plan.changes.length === 0) return { plan };
  if (plan.changes.length > 20) throw new Error(`${plan.changes.length} changes: at most 20 per push. Send some, pull, then push the rest.`);

  const results = await pushChanges(
    { apiUrl: auth.apiUrl, token: auth.token, fetch: deps.fetch, timeoutMs: TIMEOUT_MS },
    config.space,
    config.project,
    plan.changes.map((c) =>
      c.kind === "update"
        ? { kind: "update", ruleId: c.ruleId, baseVersion: c.baseVersion, title: c.title, body: c.body }
        : { kind: "create", layer: c.layer, ...(c.module ? { module: c.module } : {}), title: c.title, body: c.body },
    ),
  );
  // A file whose every sent change was SAVED, and that had no other edits, now matches the server
  // except for the version line at the top. Put back the last pulled copy (ours, by its hash), so
  // the pull below updates it normally instead of keeping it as "edited". Files with suggestions,
  // refusals or unsent edits keep your text.
  for (const cached of cache.files) {
    const sent = plan.changes.map((c, i) => ({ c, r: results[i]! })).filter(({ c }) => c.path === cached.path);
    const clean = sent.length > 0 && sent.every(({ r }) => r.status === "saved") && !plan.notes.some((n) => n.startsWith(`${cached.path}:`));
    if (!clean || !isManagedRulePath(cached.path)) continue;
    const { dirs } = splitManagedPath(cached.path);
    if (await checkRuleDirs(realRoot, dirs, false)) await writeFileAtomic(path.join(realRoot, ...cached.path.split("/")), cached.content, 0o600);
  }
  const after = await pullCommand(deps);
  return { plan, results, after };
}

// ----- diff (DECISIONS #65) -----

export interface DiffOutcome {
  space: string;
  project: string;
  version: number;
  /** One entry per file that differs. text undefined = too big to show line by line. */
  files: { path: string; state: "changed" | "only-local" | "only-server"; text?: string }[];
}

/** Local rule files vs what the server would send now. Writes nothing; not recorded as a pull. */
export async function diffCommand(deps: ProjectDeps): Promise<DiffOutcome> {
  const root = await findProjectRoot(deps.cwd);
  if (!root) throw new Error(`no ${PROJECT_CONFIG_FILE} in this folder or above it. Run "axiomic init" in your repo first.`);
  const config = (await readProjectConfig(root))!;
  const auth = await requireAuth(deps);
  const realRoot = await fs.realpath(root);
  const answer = await pullRules({ apiUrl: auth.apiUrl, token: auth.token, fetch: deps.fetch, timeoutMs: TIMEOUT_MS }, config.space, config.project, { dryRun: true });

  const files: DiffOutcome["files"] = [];
  const serverPaths = new Set(answer.files.map((f) => f.path));
  for (const f of answer.files) {
    const raw = await readFileNoFollow(path.join(realRoot, ...f.path.split("/")));
    if (raw === undefined) {
      files.push({ path: f.path, state: "only-server" });
      continue;
    }
    const local = raw.toString("utf8");
    if (local === f.content) continue;
    const ops = diffLines(f.content, local);
    files.push({ path: f.path, state: "changed", ...(ops ? { text: formatDiff(ops) } : {}) });
  }
  // Managed files on disk that the server no longer sends (axiomic pull would remove them).
  const manifest = await readManifest(deps.dirs.state, await projectKey(realRoot));
  for (const p of knownPaths(manifest)) {
    if (!serverPaths.has(p) && (await readFileNoFollow(path.join(realRoot, ...p.split("/")))) !== undefined) files.push({ path: p, state: "only-local" });
  }
  return { space: config.space, project: config.project, version: answer.version, files };
}
