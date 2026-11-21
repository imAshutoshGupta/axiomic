/**
 * `axiomic diff`: how your local rule files differ from what the server would send now (DECISIONS #65).
 * Writes nothing, and is not recorded as a pull. Exit 1 when anything differs.
 */
import path from "node:path";
import { isManagedRulePath, RULES_DIR } from "../local-files/managed-paths";
import { knownPaths, readManifest } from "../local-files/manifest";
import { projectKey } from "../project/project-key";
import { pullRules, type PullAnswer } from "../server/endpoints";
import { checkRuleDirs } from "../local-files/writer";
import { readFileNoFollow, UnsafePathError } from "../utils/fs-safe";
import { diffLines, formatDiff } from "../utils/line-diff";
import { printable } from "../utils/printable";
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
  refuseUnexpectedPaths(answer);
  // Like pull: .claude and .claude/rules must be real folders inside the project (a symlink is refused).
  // If they don't exist yet, no rule file is on this computer.
  const rulesFolderExists = await checkRuleDirs(realRoot, RULES_DIR.split("/"), false);
  const files = [
    ...(await filesThatDiffer(realRoot, answer, rulesFolderExists)),
    ...(rulesFolderExists ? await filesOnlyHere(deps, realRoot, answer) : []),
  ];
  return { space: config.space, project: config.project, version: answer.version, files };
}

/**
 * Only the allow-listed rule files (.claude/rules/axiomic*.md) may be read, as in `pull`. A bad or
 * compromised server could otherwise name any file (e.g. "../../.ssh/id_rsa") and `diff` would print it.
 * Checked for every file before anything is read.
 */
function refuseUnexpectedPaths(answer: PullAnswer): void {
  for (const serverFile of answer.files) {
    if (typeof serverFile.path !== "string" || !isManagedRulePath(serverFile.path)) {
      throw new UnsafePathError(`Refusing to read an unexpected path from the server: ${JSON.stringify(typeof serverFile.path === "string" ? printable(serverFile.path) : serverFile.path)}`);
    }
  }
}

/** Each file the server sends that is missing here or has different text. */
async function filesThatDiffer(realRoot: string, answer: PullAnswer, rulesFolderExists: boolean): Promise<DiffFile[]> {
  const files: DiffFile[] = [];
  for (const serverFile of answer.files) {
    const raw = rulesFolderExists ? await readFileNoFollow(path.join(realRoot, ...serverFile.path.split("/"))) : undefined;
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
