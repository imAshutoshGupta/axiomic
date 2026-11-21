/**
 * `axiomic diff`: how your local rule files differ from what the server would send now (DECISIONS #65).
 * Writes nothing, and is not recorded as a pull. Exit 1 when anything differs.
 */
import path from "node:path";
import { knownPaths, readManifest } from "../local-files/manifest";
import { projectKey } from "../project/project-key";
import { pullRules, type PullAnswer } from "../server/endpoints";
import { readFileNoFollow } from "../utils/fs-safe";
import { diffLines, formatDiff } from "../utils/line-diff";
import { parseFlags, type CliContext } from "./context";
import { formatDiffReport } from "./format";
import { openLinkedProject, projectDeps, SERVER_TIMEOUT_MS, type ProjectDeps } from "./linked-project";

type DiffFile = { path: string; state: "changed" | "only-local" | "only-server"; text?: string };

export interface DiffOutcome {
  space: string;
  project: string;
  version: number;
  /** One entry per file that differs. text undefined = too big to show line by line. */
  files: DiffFile[];
}

export async function diffCommand(ctx: CliContext, args: string[]): Promise<number> {
  parseFlags(args, {});
  const outcome = await diffProject(projectDeps(ctx));
  ctx.stdout(formatDiffReport(outcome));
  return outcome.files.length > 0 ? 1 : 0;
}

/** Local rule files vs what the server would send now. */
export async function diffProject(deps: ProjectDeps): Promise<DiffOutcome> {
  const { realRoot, config, auth } = await openLinkedProject(deps);
  const server = { apiUrl: auth.apiUrl, token: auth.token, fetch: deps.fetch, timeoutMs: SERVER_TIMEOUT_MS };
  const answer = await pullRules(server, config.space, config.project, { dryRun: true });
  const files = [...(await filesThatDiffer(realRoot, answer)), ...(await filesOnlyHere(deps, realRoot, answer))];
  return { space: config.space, project: config.project, version: answer.version, files };
}

/** Each file the server sends that is missing here or has different text. */
async function filesThatDiffer(realRoot: string, answer: PullAnswer): Promise<DiffFile[]> {
  const files: DiffFile[] = [];
  for (const serverFile of answer.files) {
    const raw = await readFileNoFollow(path.join(realRoot, ...serverFile.path.split("/")));
    if (raw === undefined) {
      files.push({ path: serverFile.path, state: "only-server" });
      continue;
    }
    const local = raw.toString("utf8");
    if (local === serverFile.content) continue;
    const ops = diffLines(serverFile.content, local);
    files.push({ path: serverFile.path, state: "changed", ...(ops ? { text: formatDiff(ops) } : {}) });
  }
  return files;
}

/** Managed files on disk that the server no longer sends (axiomic pull would remove them). */
async function filesOnlyHere(deps: ProjectDeps, realRoot: string, answer: PullAnswer): Promise<DiffFile[]> {
  const serverPaths = new Set(answer.files.map((file) => file.path));
  const manifest = await readManifest(deps.dirs.state, await projectKey(realRoot));
  const files: DiffFile[] = [];
  for (const relPath of knownPaths(manifest)) {
    if (serverPaths.has(relPath)) continue;
    if ((await readFileNoFollow(path.join(realRoot, ...relPath.split("/")))) !== undefined) files.push({ path: relPath, state: "only-local" });
  }
  return files;
}
