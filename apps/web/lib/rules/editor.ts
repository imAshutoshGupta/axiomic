/**
 * The website rule editor's save (Phase 3, step 4). The same path as `axiomic push`
 * (applyChange: safety check → version check → api.save_rule, or api.create_suggestion when
 * the layer isn't yours), plus three things only the website does:
 *
 *   1. warnings are shown first and need a second "save anyway" (push only refuses blockers);
 *   2. a rule that would be dropped by the merge is refused up front: a title that clashes with
 *      a locked rule, or a personal rule trying to replace a work rule (PLAN Open item 12);
 *   3. the 256 KiB size check covers EVERY project the change reaches (a company rule reaches
 *      the whole space), not only the one on screen (the push known limit, #64).
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { checkRule, merge, type Layer } from "@axiomic/shared";
import type { Keyring } from "@axiomic/shared/crypto";
import { pgCode, type Tx } from "@/lib/db";
import { loadProject, type LoadedProject, type ProjectRef } from "./pull";
import { applyChange, inputAfter, sizeAfter, type PushChange } from "./push";

export interface EditorInput {
  ref: ProjectRef;
  /** Editing an existing rule: its id and the version the editor was opened on. */
  ruleId?: string;
  baseVersion?: number;
  /** A new rule: where it goes. moduleId for the module layer. */
  layer?: Layer;
  moduleId?: string;
  title: string;
  body: string;
  /** Company/team rules only; ignored for suggestions. */
  locked?: boolean;
  /** The author has seen the warnings and wants to save anyway. */
  ackWarnings: boolean;
}

export type EditorResult =
  | { status: "saved"; ruleId: string; version: number }
  | { status: "suggested"; suggestionId: string }
  | { status: "warnings"; warnings: string[] }
  | { status: "refused"; reason: string; findings?: string[] }
  | { status: "conflict"; reason: string };

const LOCKABLE = new Set<Layer>(["company", "team"]);

export async function saveFromEditor(tx: Tx, ring: Keyring, input: EditorInput): Promise<EditorResult> {
  const title = input.title.replace(/\s+/g, " ").trim();
  if (title === "") return { status: "refused", reason: "A rule needs a title." };

  // 1. Safety check. Blockers: refused. Warnings: shown once, then "save anyway".
  const safety = checkRule({ title, body: input.body });
  if (!safety.ok) {
    return {
      status: "refused",
      reason: "The safety check found a problem. Nothing was saved.",
      findings: safety.findings.filter((f) => f.severity === "block").map(findingText),
    };
  }
  const warnings = safety.findings.filter((f) => f.severity === "warn").map(findingText);
  if (warnings.length > 0 && !input.ackWarnings) return { status: "warnings", warnings };

  // 2. The project as you see it (RLS), decrypted, with each rule's scope and newest version.
  const r = await loadProject(tx, ring, input.ref);
  if (!r.ok) return { status: "refused", reason: r.status === 409 ? "This project is archived." : "Project not found." };
  const loaded = r.loaded;

  // 3. What kind of change. The database checks the rest (who owns the layer, same space, …).
  let change: PushChange;
  let layer: Layer;
  if (input.ruleId) {
    const rule = loaded.rules.get(input.ruleId);
    if (!rule) return { status: "refused", reason: "This rule isn't in this project any more. Reload the page." };
    if (input.baseVersion === undefined) return { status: "refused", reason: "Reload the page and try again." };
    change = { kind: "update", ruleId: rule.id, baseVersion: input.baseVersion, title, body: input.body };
    layer = rule.layer;
  } else {
    if (!input.layer) return { status: "refused", reason: "Choose a layer." };
    layer = input.layer;
    let moduleName: string | undefined;
    if (layer === "module") {
      moduleName = loaded.modules.find((m) => m.id === input.moduleId)?.name;
      if (!moduleName) return { status: "refused", reason: "That folder isn't in this project any more." };
    }
    change = { kind: "create", layer, ...(moduleName ? { module: moduleName } : {}), title, body: input.body };
  }
  const newRuleId = change.kind === "create" ? randomUUID() : undefined;
  const targetId = newRuleId ?? (change as { ruleId: string }).ruleId;

  // 4. Would the merge drop it? Then saving it would be pointless (and confusing): refuse.
  const dropped = merge(inputAfter(loaded, change, newRuleId)).blocked.find((b) => b.ruleId === targetId);
  if (dropped) {
    return {
      status: "refused",
      reason: dropped.reason === "locked"
        ? `A locked rule already has the title "${title}", so this rule would never be delivered. Pick another title.`
        : `A work rule already has the title "${title}". Personal rules only add, so this one would never be delivered. Pick another title.`,
    };
  }

  // 5. Sizes of the other projects this change reaches.
  const otherSizes = await otherProjectSizes(tx, ring, loaded, input.ref.space, layer, change, newRuleId);

  // 6. Save (or suggest), exactly as push does.
  const locked = LOCKABLE.has(layer) && input.locked !== undefined ? input.locked : undefined;
  const res = await applyChange(tx, ring, loaded, change, { otherSizes, locked, newRuleId });
  switch (res.status) {
    case "saved":
    case "suggested":
      return res;
    case "conflict":
      return { status: "conflict", reason: "Someone saved this rule after you opened it. Copy your text, reload the page, and redo your edit." };
    case "refused":
      return { status: "refused", reason: websiteReason(res.reason) };
  }
}

/** Move a rule to the trash (api.trash_rule; owners only). Laptops drop it at their next pull. */
export async function trashFromEditor(tx: Tx, ruleId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    await tx.savepoint((sp) => sp`select api.trash_rule(${ruleId}::uuid)`);
    return { ok: true };
  } catch (e) {
    const code = pgCode(e);
    if (code === "42501") return { ok: false, reason: "Only the layer's owner can delete this rule." };
    if (code === "22023") return { ok: false, reason: "This rule is already deleted." };
    throw e;
  }
}

/**
 * Which projects a rule in this layer reaches: company and personal rules → every project of
 * the space; team rules → every project of the team; project and folder rules → their project.
 * Archived projects can't be pulled, so they don't count. Read under RLS (only what you can see).
 */
export async function projectsReached(
  tx: Tx, scope: { spaceId: string; layer: Layer; teamId: string | null; projectId: string | null },
): Promise<string[]> {
  const rows = await tx<{ slug: string }[]>`
    select slug from public.projects
    where space_id = ${scope.spaceId} and archived_at is null
      and case ${scope.layer}::text
            when 'team'    then team_id = ${scope.teamId}::uuid
            when 'project' then id = ${scope.projectId}::uuid
            when 'module'  then id = ${scope.projectId}::uuid
            else true
          end
    order by slug limit 500`;
  return rows.map((r) => r.slug);
}

/**
 * The merged size of each given project after this change, each loaded as YOU see it (your
 * personal rules, not other people's), the way push measures. Skips projects the rule isn't in.
 */
export async function sizesAfter(
  tx: Tx, ring: Keyring, spaceSlug: string, projectSlugs: string[], change: PushChange, newRuleId: string | undefined,
): Promise<Record<string, number>> {
  const sizes: Record<string, number> = {};
  for (const slug of projectSlugs) {
    const r = await loadProject(tx, ring, { space: spaceSlug, project: slug });
    if (!r.ok) continue;
    if (change.kind === "update" && !r.loaded.rules.has(change.ruleId)) continue;
    sizes[r.loaded.project.id] = sizeAfter(r.loaded, change, newRuleId);
  }
  return sizes;
}

async function otherProjectSizes(
  tx: Tx, ring: Keyring, here: LoadedProject, spaceSlug: string, layer: Layer, change: PushChange, newRuleId: string | undefined,
): Promise<Record<string, number>> {
  if (layer === "project" || layer === "module") return {};
  const { project } = here;
  const slugs = await projectsReached(tx, { spaceId: project.space_id, layer, teamId: project.team_id, projectId: project.id });
  return sizesAfter(tx, ring, spaceSlug, slugs.filter((s) => s !== project.slug), change, newRuleId);
}

function findingText(f: { message: string; line?: number; field: string }): string {
  return f.line ? `${f.field === "title" ? "Title" : `Line ${f.line}`}: ${f.message}` : f.message;
}

/** applyChange's reasons are written for the CLI ("run axiomic pull"); say it the website's way. */
function websiteReason(reason: string): string {
  return reason
    .replace(/:? ?run axiomic pull(, then redo your edit)?/g, "")
    .replace(/^safety check: /, "The safety check found a problem: ")
    .replace(/^./, (c) => c.toUpperCase());
}
