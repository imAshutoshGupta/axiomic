/**
 * `axiomic push [--yes]`: local edits to the rule files go back as rule changes (DECISIONS #64).
 * Without --yes it only shows the plan. With --yes it sends it, then pulls, so what was saved is
 * written back in the server's own form.
 */
import path from "node:path";
import { readCache, type CacheEntry } from "../local-files/cache";
import { isManagedRulePath, splitManagedPath } from "../local-files/managed-paths";
import { checkRuleDirs, RULE_FILE_MODE } from "../local-files/writer";
import { projectKey } from "../project/project-key";
import { pushChanges, type PushChangeBody, type PushResult } from "../server/endpoints";
import { planPush, type PlannedChange, type PushPlan } from "../sync/push-plan";
import { writeFileAtomic } from "../utils/fs-safe";
import { parseFlags, type CliContext } from "./context";
import { formatPushReport } from "./format";
import { openLinkedProject, projectDeps, SERVER_TIMEOUT_MS, type ProjectDeps } from "./linked-project";
import { pullProject, type PullOutcome } from "./pull";

/** The server takes at most this many changes in one push (MAX_CHANGES in the web app's lib/rules/push.ts). */
const MAX_CHANGES_PER_PUSH = 20;

export interface PushOutcome {
  plan: PushPlan;
  /** Undefined when not sent (preview, or nothing to send). */
  results?: PushResult[];
  /** The pull made right after sending, so saved edits come back as the server's text. */
  after?: PullOutcome;
}

export async function pushCommand(ctx: CliContext, args: string[]): Promise<number> {
  const { values } = parseFlags(args, { yes: { type: "boolean" } });
  const send = values.yes ?? false;
  const outcome = await pushEdits(projectDeps(ctx), { send });
  ctx.stdout(formatPushReport(outcome, send));
  // Exit 1 when something sent was not accepted, so scripts notice.
  return outcome.results?.some((result) => result.status === "conflict" || result.status === "refused") ? 1 : 0;
}

/**
 * Without `send`: only works out and returns the plan (the preview). With `send`: posts it,
 * then pulls, so what was saved is written back in the server's own form.
 */
export async function pushEdits(deps: ProjectDeps, options: { send: boolean }): Promise<PushOutcome> {
  const { realRoot, config, auth } = await openLinkedProject(deps);

  const cache = await readCache(deps.dirs.cache, await projectKey(realRoot));
  if (!cache || cache.space !== config.space || cache.project !== config.project) {
    throw new Error('nothing to compare with: run "axiomic pull" first, then make your edits.');
  }
  if (cache.apiUrl !== auth.apiUrl) throw new Error(`your last pull came from ${cache.apiUrl}, but you are logged in to ${auth.apiUrl}. Run "axiomic pull" first.`);

  const plan = await planPush(realRoot, cache);
  if (!options.send || plan.changes.length === 0) return { plan };
  if (plan.changes.length > MAX_CHANGES_PER_PUSH) {
    throw new Error(`${plan.changes.length} changes: at most ${MAX_CHANGES_PER_PUSH} per push. Send some, pull, then push the rest.`);
  }

  const results = await pushChanges(
    { apiUrl: auth.apiUrl, token: auth.token, fetch: deps.fetch, timeoutMs: SERVER_TIMEOUT_MS },
    config.space,
    config.project,
    plan.changes.map(toRequestBody),
  );
  await restoreFullySavedFiles(realRoot, cache, plan, results);
  const after = await pullProject(deps);
  return { plan, results, after };
}

function toRequestBody(change: PlannedChange): PushChangeBody {
  if (change.kind === "update") {
    return { kind: "update", ruleId: change.ruleId, baseVersion: change.baseVersion, title: change.title, body: change.body };
  }
  return { kind: "create", layer: change.layer, ...(change.module ? { module: change.module } : {}), title: change.title, body: change.body };
}

/**
 * A file whose every sent change was SAVED, and that had no other edits, now matches the server
 * except for the version line at the top. Put back the last pulled copy (ours, by its hash), so
 * the pull that follows updates it normally instead of keeping it as "edited". Files with suggestions,
 * refusals or unsent edits keep your text.
 */
async function restoreFullySavedFiles(realRoot: string, cache: CacheEntry, plan: PushPlan, results: PushResult[]): Promise<void> {
  for (const cached of cache.files) {
    const sent = plan.changes.map((change, index) => ({ change, result: results[index]! })).filter(({ change }) => change.path === cached.path);
    const allSaved = sent.length > 0 && sent.every(({ result }) => result.status === "saved");
    const hasOtherEdits = plan.notes.some((note) => note.startsWith(`${cached.path}:`));
    if (!allSaved || hasOtherEdits || !isManagedRulePath(cached.path)) continue;
    const { dirs } = splitManagedPath(cached.path);
    if (await checkRuleDirs(realRoot, dirs, false)) {
      await writeFileAtomic(path.join(realRoot, ...cached.path.split("/")), cached.content, RULE_FILE_MODE);
    }
  }
}
