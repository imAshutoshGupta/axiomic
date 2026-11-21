/**
 * What the server commands (init, pull, push, diff) share: their dependencies, the login check,
 * and opening the project this folder is linked to (DECISIONS #59).
 */
import { promises as fs } from "node:fs";
import type { AxiomicDirs } from "../local-files/dirs";
import { findProjectRoot, PROJECT_CONFIG_FILE, readProjectConfig, type ProjectConfig } from "../project/project-config";
import type { FetchFn } from "../server/api-client";
import { resolveAuth, type Auth } from "../server/auth";
import { dirsOf, requireFetch, type CliContext } from "./context";

/** Longest wait for the server in a command a person typed (the session hook uses a much shorter one). */
export const SERVER_TIMEOUT_MS = 20_000;

export interface ProjectDeps {
  fetch: FetchFn;
  env: NodeJS.ProcessEnv;
  cwd: string;
  dirs: AxiomicDirs;
}

export function projectDeps(ctx: CliContext): ProjectDeps {
  return { fetch: requireFetch(ctx), env: ctx.env, cwd: ctx.cwd, dirs: dirsOf(ctx) };
}

/** Readable error for "not logged in". */
export class NotLoggedInError extends Error {
  constructor() {
    super('not logged in. Run "axiomic login" first.');
  }
}

export async function requireAuth(deps: ProjectDeps): Promise<Auth> {
  const auth = await resolveAuth(deps.env, deps.dirs.config);
  if (!auth) throw new NotLoggedInError();
  return auth;
}

/** The project this folder belongs to, and who is asking. */
export interface LinkedProject {
  /** The folder that holds axiomic.json, as found. */
  root: string;
  /** The same folder with symlinks resolved: what file operations use. */
  realRoot: string;
  config: ProjectConfig;
  auth: Auth;
}

/** Finds axiomic.json here or above, then checks the login. Throws a readable error for either. */
export async function openLinkedProject(deps: ProjectDeps): Promise<LinkedProject> {
  const root = await findProjectRoot(deps.cwd);
  if (!root) throw new Error(`no ${PROJECT_CONFIG_FILE} in this folder or above it. Run "axiomic init" in your repo first.`);
  const config = (await readProjectConfig(root))!;
  const auth = await requireAuth(deps);
  const realRoot = await fs.realpath(root);
  return { root, realRoot, config, auth };
}
