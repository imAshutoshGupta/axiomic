/**
 * `axiomic status`: a purely local health check. No network.
 * Fault-isolated: every section runs inside its own try/catch (`section()`), so one problem (a bad
 * axiomic.json, an unreadable folder, a broken Git) is reported in ITS section and never hides the others.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveApiUrl } from "../server/api-url";
import { readCache } from "../local-files/cache";
import { claudeHookStatus, claudeSettingsPath, type HookStatus, type HookTarget } from "../hook/claude-settings";
import { hasCredentialsFile, readCredentials } from "../server/credentials";
import type { AxiomicDirs } from "../local-files/dirs";
import { readFileNoFollow, sha256 } from "../utils/fs-safe";
import { gitCheckIgnored, gitTrackedFiles } from "../project/git";
import { DOCKERIGNORE_BODY, GITIGNORE_BODY, blockStatusInFile, dockerignorePath, gitignorePath } from "../local-files/ignore-block";
import { RULES_DIR, TEMP_SAMPLE_PATH, isManagedRulePath } from "../local-files/managed-paths";
import { readManifest, type Manifest } from "../local-files/manifest";
import { findProjectRoot, readProjectConfig, type ProjectConfig } from "../project/project-config";
import { projectKey } from "../project/project-key";
import { checkRuleDirs } from "../local-files/writer";
import { dirsOf, hookTargetOrUndefined, parseFlags, type CliContext } from "./context";
import { formatStatus } from "./format";

export interface FileState {
  path: string;
  state: "ok" | "modified" | "missing" | "not-managed" | "error";
}

export interface StatusReport {
  apiUrl: string | { error: string };
  credentials: "none" | "ok" | { error: string };
  hook: HookStatus | { error: string };
  /** Set when looking for / opening the project failed (the project sections are then skipped). */
  projectError?: string;
  project?: {
    root: string;
    config: ProjectConfig | { error: string };
    files: FileState[];
    /** Managed files that Git tracks: they'd be pushed with the code. undefined = couldn't ask Git. */
    tracked: string[] | undefined;
    /**
     * Managed paths Git would NOT ignore (e.g. a `!` line after our block un-ignores them): `git add -A` would
     * pick them up. [] = all ignored; undefined = unknown (no Git, not a repo) or nothing to check.
     */
    notIgnored: string[] | undefined;
    /** Set if asking Git failed in an unexpected way. */
    gitError?: string;
    gitignore: string;
    dockerignore: string;
    cache?: { version: number; fetchedAt: string } | { error: string };
  };
}

function errorOf(error: unknown): { error: string } {
  return { error: error instanceof Error ? error.message : String(error) };
}

/** Runs one section. Any error becomes the section's own error value instead of aborting `status`. */
async function section<T, E>(run: () => Promise<T>, onError: (message: string) => E): Promise<T | E> {
  try {
    return await run();
  } catch (error) {
    return onError(errorOf(error).error);
  }
}

/** True if the report shows something wrong: an error in any section, a tracked or un-ignored rule file. */
export function statusHasProblems(report: StatusReport): boolean {
  const isError = (value: unknown) => typeof value === "object" && value !== null && "error" in value;
  const project = report.project;
  return (
    isError(report.apiUrl) ||
    isError(report.credentials) ||
    isError(report.hook) ||
    report.projectError !== undefined ||
    (project !== undefined &&
      (isError(project.config) ||
        isError(project.cache) ||
        project.gitError !== undefined ||
        project.files.some((f) => f.state === "error") ||
        (project.tracked?.length ?? 0) > 0 ||
        (project.notIgnored?.length ?? 0) > 0 ||
        project.gitignore.startsWith("error") ||
        project.dockerignore.startsWith("error")))
  );
}

export interface StatusInput {
  cwd: string;
  dirs: AxiomicDirs;
  env: NodeJS.ProcessEnv;
  homedir: string;
  hookTarget: HookTarget | undefined;
}

type ProjectReport = NonNullable<StatusReport["project"]>;
type GitAnswers = Pick<ProjectReport, "tracked" | "notIgnored" | "gitError">;

export async function statusCommand(ctx: CliContext, args: string[]): Promise<number> {
  const { values } = parseFlags(args, { json: { type: "boolean" } });
  const report = await collectStatus({
    cwd: ctx.cwd,
    dirs: dirsOf(ctx),
    env: ctx.env,
    homedir: ctx.homedir,
    hookTarget: await hookTargetOrUndefined(ctx),
  });
  ctx.stdout(values.json ? JSON.stringify(report, null, 2) + "\n" : formatStatus(report));
  // A rule file tracked by Git or not ignored by it is a leak in the making, and an error in any section is
  // a problem: make both visible to scripts through the exit code.
  return statusHasProblems(report) ? 1 : 0;
}

export async function collectStatus(input: StatusInput): Promise<StatusReport> {
  const report = await collectComputerSections(input);

  // Project lookup (walks up from the current folder; an unreadable folder on the way is an error here).
  let realRoot: string;
  let key: string;
  try {
    const root = await findProjectRoot(input.cwd);
    if (!root) return report;
    realRoot = await fs.realpath(root);
    key = await projectKey(realRoot);
  } catch (error) {
    report.projectError = `couldn't look for the project: ${errorOf(error).error}`;
    return report;
  }
  report.project = await collectProjectSections(input.dirs, realRoot, key);
  return report;
}

/** The sections about this computer: which server, the saved login, the Claude Code hook. */
async function collectComputerSections(input: StatusInput): Promise<StatusReport> {
  const { dirs, env } = input;
  const apiUrl = await section<string, { error: string }>(async () => resolveApiUrl(env), (error) => ({ error }));
  const credentials = await section<StatusReport["credentials"], { error: string }>(
    () => credentialsState(dirs.config),
    (error) => ({ error }), // the message never contains the token
  );
  const hook = await section<HookStatus, { error: string }>(
    () => claudeHookStatus(claudeSettingsPath(env, input.homedir), input.hookTarget),
    (error) => ({ error }),
  );
  return { apiUrl, credentials, hook };
}

async function credentialsState(configDir: string): Promise<"ok" | "none"> {
  if (!(await hasCredentialsFile(configDir))) return "none";
  return (await readCredentials(configDir)) ? "ok" : "none";
}

/** The sections about the project in the current folder. */
async function collectProjectSections(dirs: AxiomicDirs, realRoot: string, key: string): Promise<ProjectReport> {
  const config = await section<ProjectConfig | { error: string }, { error: string }>(
    async () => (await readProjectConfig(realRoot)) ?? { error: "axiomic.json disappeared" },
    (error) => ({ error }),
  );
  const files = await section<FileState[], FileState[]>(
    () => ruleFileStates(dirs.state, realRoot, key),
    (message) => [{ path: `(${message})`, state: "error" as const }],
  );
  const cache = await section<{ version: number; fetchedAt: string } | undefined, { error: string }>(
    () => cacheSummary(dirs.cache, key),
    (error) => ({ error }),
  );
  const git = await askGit(realRoot, files);
  return {
    root: realRoot,
    config,
    files,
    tracked: git.tracked,
    notIgnored: git.notIgnored,
    ...(git.gitError === undefined ? {} : { gitError: git.gitError }),
    gitignore: await ignoreBlockStatus(blockStatusInFile(gitignorePath(realRoot), GITIGNORE_BODY)),
    dockerignore: await ignoreBlockStatus(blockStatusInFile(dockerignorePath(realRoot), DOCKERIGNORE_BODY)),
    ...(cache === undefined ? {} : { cache }),
  };
}

/** Every rule file axiomic knows about (in the manifest) or finds on disk, with its state. */
async function ruleFileStates(stateDir: string, realRoot: string, key: string): Promise<FileState[]> {
  const manifest = await readManifest(stateDir, key);
  const onDisk = await managedFilesOnDisk(realRoot);
  const allPaths = [...new Set([...manifest.files.keys(), ...manifest.pending.keys(), ...onDisk])].sort();
  const states: FileState[] = [];
  for (const relPath of allPaths) {
    try {
      const data = await readFileNoFollow(path.join(realRoot, ...relPath.split("/")));
      states.push({ path: relPath, state: fileState(manifest, relPath, data) });
    } catch {
      states.push({ path: relPath, state: "error" });
    }
  }
  return states;
}

/** The managed rule files in .claude/rules right now (none if the folder doesn't exist). */
async function managedFilesOnDisk(realRoot: string): Promise<Set<string>> {
  const found = new Set<string>();
  if (!(await checkRuleDirs(realRoot, RULES_DIR.split("/"), false))) return found;
  for (const name of await fs.readdir(path.join(realRoot, ...RULES_DIR.split("/")))) {
    const relPath = `${RULES_DIR}/${name}`;
    if (isManagedRulePath(relPath)) found.add(relPath);
  }
  return found;
}

function fileState(manifest: Manifest, relPath: string, data: Buffer | undefined): FileState["state"] {
  if (data === undefined) return "missing";
  const known = manifest.files.has(relPath) || manifest.pending.has(relPath);
  if (!known) return "not-managed";
  // "Ours" = matches a confirmed OR a pending hash (a write that was cut off before the manifest was updated).
  const hash = sha256(data);
  return hash === manifest.files.get(relPath) || hash === manifest.pending.get(relPath) ? "ok" : "modified";
}

async function cacheSummary(cacheDir: string, key: string): Promise<{ version: number; fetchedAt: string } | undefined> {
  const entry = await readCache(cacheDir, key);
  return entry ? { version: entry.version, fetchedAt: entry.fetchedAt } : undefined;
}

/**
 * Git questions: what is tracked, and what Git would NOT ignore. Only real rule files are asked about
 * (the temp-file sample only matters if there are rule files to protect).
 */
async function askGit(realRoot: string, files: FileState[]): Promise<GitAnswers> {
  const realFiles = files.filter((file) => file.state !== "error").map((file) => file.path);
  const answers: GitAnswers = { tracked: undefined, notIgnored: undefined };
  try {
    answers.tracked = await gitTrackedFiles(realRoot, realFiles);
    if (realFiles.length === 0) return answers;
    const answer = await gitCheckIgnored(realRoot, [...realFiles, TEMP_SAMPLE_PATH]);
    if (answer.kind === "known") answers.notIgnored = answer.notIgnored;
    // Inside a repo that Git can't answer for, axiomic writes nothing: say so instead of staying silent.
    else if (answer.kind === "unknown") answers.gitError = `couldn't confirm that rule files are ignored (${answer.reason})`;
  } catch (error) {
    answers.gitError = errorOf(error).error;
  }
  return answers;
}

/** An ignore block's status line, or "error: …" if reading the file failed. */
function ignoreBlockStatus(status: Promise<string>): Promise<string> {
  return status.catch((error: unknown) => `error: ${errorOf(error).error}`);
}
