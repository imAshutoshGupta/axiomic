import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveApiUrl } from "./api-url";
import { readCache } from "./cache";
import { claudeHookStatus, claudeSettingsPath, type HookStatus, type HookTarget } from "./claude-hook";
import { hasCredentialsFile, readCredentials } from "./credentials";
import type { AxiomicDirs } from "./dirs";
import { readFileNoFollow, sha256 } from "./fs-safe";
import { gitCheckIgnored, gitTrackedFiles } from "./git";
import { DOCKERIGNORE_BODY, GITIGNORE_BODY, blockStatusInFile, dockerignorePath, gitignorePath } from "./ignore-block";
import { RULES_DIR, TEMP_SAMPLE_PATH, isManagedRulePath } from "./managed-paths";
import { readManifest } from "./manifest";
import { findProjectRoot, readProjectConfig, type ProjectConfig } from "./project-config";
import { projectKey } from "./project-key";
import { checkRuleDirs } from "./writer";

/**
 * `axiomic status`: a purely local health check. No network.
 * Fault-isolated: every section runs inside its own try/catch (`section()`), so one problem (a bad
 * axiomic.json, an unreadable folder, a broken Git) is reported in ITS section and never hides the others.
 */
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

export async function collectStatus(input: {
  cwd: string;
  dirs: AxiomicDirs;
  env: NodeJS.ProcessEnv;
  homedir: string;
  hookTarget: HookTarget | undefined;
}): Promise<StatusReport> {
  const { dirs, env } = input;

  const apiUrl = await section<string, { error: string }>(async () => resolveApiUrl(env), (error) => ({ error }));

  const credentials = await section<StatusReport["credentials"], { error: string }>(
    async () => ((await hasCredentialsFile(dirs.config)) ? ((await readCredentials(dirs.config)) ? "ok" : "none") : "none"),
    (error) => ({ error }), // the message never contains the token
  );

  const hook = await section<HookStatus, { error: string }>(
    () => claudeHookStatus(claudeSettingsPath(env, input.homedir), input.hookTarget),
    (error) => ({ error }),
  );

  const report: StatusReport = { apiUrl, credentials, hook };

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

  const config = await section<ProjectConfig | { error: string }, { error: string }>(
    async () => (await readProjectConfig(realRoot)) ?? { error: "axiomic.json disappeared" },
    (error) => ({ error }),
  );

  const files = await section<FileState[], FileState[]>(
    async () => {
      const out: FileState[] = [];
      const manifest = await readManifest(dirs.state, key);
      const onDisk = new Set<string>();
      if (await checkRuleDirs(realRoot, RULES_DIR.split("/"), false)) {
        for (const name of await fs.readdir(path.join(realRoot, ...RULES_DIR.split("/")))) {
          const rel = `${RULES_DIR}/${name}`;
          if (isManagedRulePath(rel)) onDisk.add(rel);
        }
      }
      for (const rel of [...new Set([...manifest.files.keys(), ...manifest.pending.keys(), ...onDisk])].sort()) {
        try {
          const data = await readFileNoFollow(path.join(realRoot, ...rel.split("/")));
          // "Ours" = matches a confirmed OR a pending hash (a write that was cut off before the manifest was updated).
          const known = manifest.files.has(rel) || manifest.pending.has(rel);
          const hash = data === undefined ? undefined : sha256(data);
          const state: FileState["state"] =
            data === undefined ? "missing" : !known ? "not-managed" : hash === manifest.files.get(rel) || hash === manifest.pending.get(rel) ? "ok" : "modified";
          out.push({ path: rel, state });
        } catch {
          out.push({ path: rel, state: "error" });
        }
      }
      return out;
    },
    (message) => [{ path: `(${message})`, state: "error" as const }],
  );

  const cache = await section<{ version: number; fetchedAt: string } | undefined, { error: string }>(
    async () => {
      const entry = await readCache(dirs.cache, key);
      return entry ? { version: entry.version, fetchedAt: entry.fetchedAt } : undefined;
    },
    (error) => ({ error }),
  );

  // Git questions: what is tracked, and what Git would NOT ignore. Only real rule files are asked about
  // (the temp-file sample only matters if there are rule files to protect).
  const realFiles = files.filter((f) => f.state !== "error").map((f) => f.path);
  let tracked: string[] | undefined;
  let notIgnored: string[] | undefined;
  let gitError: string | undefined;
  try {
    tracked = await gitTrackedFiles(realRoot, realFiles);
    if (realFiles.length > 0) {
      const answer = await gitCheckIgnored(realRoot, [...realFiles, TEMP_SAMPLE_PATH]);
      if (answer.kind === "known") notIgnored = answer.notIgnored;
      // Inside a repo that Git can't answer for, axiomic writes nothing: say so instead of staying silent.
      else if (answer.kind === "unknown") gitError = `couldn't confirm that rule files are ignored (${answer.reason})`;
    }
  } catch (error) {
    gitError = errorOf(error).error;
  }

  const safeStatus = (p: Promise<string>) => p.catch((error: unknown) => `error: ${errorOf(error).error}`);
  report.project = {
    root: realRoot,
    config,
    files,
    tracked,
    notIgnored,
    ...(gitError === undefined ? {} : { gitError }),
    gitignore: await safeStatus(blockStatusInFile(gitignorePath(realRoot), GITIGNORE_BODY)),
    dockerignore: await safeStatus(blockStatusInFile(dockerignorePath(realRoot), DOCKERIGNORE_BODY)),
    ...(cache === undefined ? {} : { cache }),
  };
  return report;
}
