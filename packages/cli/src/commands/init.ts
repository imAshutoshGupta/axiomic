/**
 * `axiomic init [<space>/<project>]`: link this repo to a project, write its rules, and install
 * the Claude Code hook if it isn't there yet.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { isValidSlug } from "@axiomic/shared";
import { claudeHookStatus, claudeSettingsPath, installClaudeHook, resolveHookTarget } from "../hook/claude-settings";
import { hasGitRepoAtOrAbove } from "../project/git";
import { findProjectRoot, PROJECT_CONFIG_FILE, readProjectConfig, writeProjectConfig, type ProjectConfig } from "../project/project-config";
import { listProjects, type SpaceList } from "../server/endpoints";
import { applyRules, fetchRules } from "../sync/rules-sync";
import { hookTargetOrUndefined, parseFlags, UsageError, type CliContext } from "./context";
import { formatPullReport } from "./format";
import { projectDeps, requireAuth, SERVER_TIMEOUT_MS, type ProjectDeps } from "./linked-project";
import { pullProject, type PullOutcome } from "./pull";

/** The shortest column for "space/project" in the list `init` prints, so names line up. */
const MIN_REF_COLUMN = 40;

export type ProjectRef = { space: string; project: string };

export type InitOutcome =
  | { kind: "choose"; spaces: SpaceList["spaces"] }
  | { kind: "linked"; root: string; created: boolean; outcome: PullOutcome };

export async function initCommand(ctx: CliContext, args: string[]): Promise<number> {
  const { positionals } = parseFlags(args, {}, 1);
  const ref = refFromArgument(positionals[0]); // a bad <space>/<project> is a usage error before anything else
  const outcome = await initProject(projectDeps(ctx), ref);
  if (outcome.kind === "choose") return printProjectChoices(ctx, outcome.spaces);

  const { answer, report } = outcome.outcome;
  ctx.stdout(formatPullReport(report, answer));
  if (outcome.created) ctx.stdout(`\nCreated ${outcome.root}/axiomic.json. Commit it, so teammates only need "axiomic init".\n`);
  await installHookIfMissing(ctx);
  return 0;
}

function refFromArgument(argument: string | undefined): ProjectRef | undefined {
  if (argument === undefined) return undefined;
  const ref = parseProjectRef(argument);
  if (!ref) throw new UsageError(`"${argument}" is not <space>/<project>, e.g. acme/web-app`);
  return ref;
}

/** No project given and none linked: list the ones you can link. Exit 1, because nothing was linked yet. */
function printProjectChoices(ctx: CliContext, spaces: SpaceList["spaces"]): number {
  const rows = formatProjectRows(spaces);
  if (rows.length === 0) {
    ctx.stderr("axiomic: you have no projects yet. Create one on the website, or ask your admin for access.\n");
    return 1;
  }
  ctx.stdout(`Projects you can link:\n${rows.join("\n")}\n\nRun: axiomic init <space>/<project>   (at the top of your repo)\n`);
  return 1;
}

/** The Claude Code hook keeps the rules fresh at every session start. It's user-level: one install for all repos. */
async function installHookIfMissing(ctx: CliContext): Promise<void> {
  const settingsPath = claudeSettingsPath(ctx.env, ctx.homedir);
  try {
    const status = await claudeHookStatus(settingsPath, await hookTargetOrUndefined(ctx));
    if (status.count !== 0) return;
    const target = await resolveHookTarget(ctx.execPath, ctx.scriptPath);
    await installClaudeHook(settingsPath, target);
    ctx.stdout(`Installed the Claude Code hook in ${settingsPath}: rules are pulled at every session start.\n`);
  } catch (error) {
    ctx.stdout(`Note: the Claude Code hook was not installed (${(error as Error).message}). Install axiomic globally, then run "axiomic hook install".\n`);
  }
}

/** "acme/web-app" → { space, project }; anything else → undefined. */
export function parseProjectRef(text: string): ProjectRef | undefined {
  const parts = text.split("/");
  if (parts.length !== 2 || !isValidSlug(parts[0]) || !isValidSlug(parts[1])) return undefined;
  return { space: parts[0], project: parts[1] };
}

/** "  space/project   Name (Space)" rows for `init` with no project. Long slugs (personal spaces) still get a gap. */
export function formatProjectRows(spaces: SpaceList["spaces"]): string[] {
  const items = spaces.flatMap((space) => space.projects.map((project) => [`  ${space.slug}/${project.slug}`, `${project.name} (${space.name})`] as const));
  const width = Math.max(MIN_REF_COLUMN, ...items.map(([ref]) => ref.length + 2));
  return items.map(([ref, label]) => ref.padEnd(width) + label);
}

/**
 * Links this repo to a project:
 *   - axiomic.json already here (a teammate committed it): just pull. No questions.
 *   - no axiomic.json and no project given: list what you can link (kind "choose"), change nothing.
 *   - project given: check you can pull it, THEN write axiomic.json, then the rule files.
 * It must run at the top of the repo, where Claude Code looks for .claude/rules.
 */
export async function initProject(deps: ProjectDeps, ref: ProjectRef | undefined): Promise<InitOutcome> {
  const auth = await requireAuth(deps);
  const existingRoot = await findProjectRoot(deps.cwd);
  if (existingRoot) return pullAlreadyLinked(deps, existingRoot, ref);

  if (!ref) {
    const list = await listProjects({ apiUrl: auth.apiUrl, token: auth.token, fetch: deps.fetch, timeoutMs: SERVER_TIMEOUT_MS });
    return { kind: "choose", spaces: list.spaces };
  }

  // Claude Code reads .claude/rules at the project root, so axiomic.json belongs at the top of the repo.
  const root = path.resolve(deps.cwd);
  const atTop = await fs.lstat(path.join(root, ".git")).then(() => true, () => false);
  if (!atTop && (await hasGitRepoAtOrAbove(root))) {
    throw new Error("run axiomic init at the top of your Git repository (the folder that contains .git).");
  }

  const config: ProjectConfig = { schemaVersion: 1, space: ref.space, project: ref.project };
  const realRoot = await fs.realpath(root);
  // Fetch first: a project that doesn't exist or that you can't read leaves the repo untouched.
  const answer = await fetchRules({ auth, fetch: deps.fetch, config, timeoutMs: SERVER_TIMEOUT_MS });
  await writeProjectConfig(root, config);
  const report = await applyRules({ auth, realRoot, config, dirs: deps.dirs }, answer);
  return { kind: "linked", root, created: true, outcome: { root, answer, report } };
}

/** axiomic.json is already here: pull, unless the command asked for a different project. */
async function pullAlreadyLinked(deps: ProjectDeps, root: string, ref: ProjectRef | undefined): Promise<InitOutcome> {
  const config = (await readProjectConfig(root))!;
  if (ref && (ref.space !== config.space || ref.project !== config.project)) {
    throw new Error(
      `this repo is already linked to ${config.space}/${config.project} (${path.join(root, PROJECT_CONFIG_FILE)}). ` +
        "To link it to another project, edit or delete that file first.",
    );
  }
  return { kind: "linked", root, created: false, outcome: await pullProject({ ...deps, cwd: root }) };
}
