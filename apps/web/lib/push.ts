import "server-only";
import { randomUUID } from "node:crypto";
import { checkRule, isValidSlug, merge, renderClaude, type MergeInput } from "@axiomic/shared";
import { encryptText, ruleVersionAad, suggestionAad, type Keyring } from "@axiomic/shared/crypto";
import { pgCode, type Tx } from "./db";
import type { LoadedProject, ProjectRef } from "./pull";

/**
 * `axiomic push` on the server (DECISIONS #64): local edits come back as changes, one per
 * "### Title" section. For each change:
 *
 *   safety check (secrets, hidden characters, …) ── blocking finding ──► refused
 *        │ ok
 *   still the version you pulled? ── no ──► conflict ("pull first")
 *        │ yes
 *   api.save_rule (you own the layer) ── 42501 "not yours" ──► api.create_suggestion (the owner decides)
 *        │                                  22023 "bad input" ──► refused, with the database's own reason
 *        ▼
 *     saved
 *
 * The database decides who owns what (can_edit_layer): we just try to save, and fall back to a
 * suggestion inside a SAVEPOINT, so a refused save doesn't spoil the transaction.
 * Text is encrypted here, with the AAD of what it becomes (a rule version, or a suggestion).
 */

export type PushChange =
  | { kind: "update"; ruleId: string; baseVersion: number; title: string; body: string }
  | { kind: "create"; layer: "company" | "team" | "project" | "module" | "personal"; module?: string; title: string; body: string };

export type ChangeResult =
  | { status: "saved"; ruleId: string; version: number }
  | { status: "suggested"; suggestionId: string }
  | { status: "conflict"; reason: string }
  | { status: "refused"; reason: string };

export const MAX_CHANGES = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LAYERS = new Set(["company", "team", "project", "module", "personal"]);

/** Checks the request body strictly. Returns the changes, or an error text for a 400. */
export function parsePushBody(body: unknown): { ref: ProjectRef; changes: PushChange[] } | string {
  if (typeof body !== "object" || body === null) return "body must be a JSON object";
  const b = body as Record<string, unknown>;
  if (!isValidSlug(b.space) || !isValidSlug(b.project)) return "space and project must be slugs";
  if (!Array.isArray(b.changes) || b.changes.length === 0) return "changes must be a non-empty list";
  if (b.changes.length > MAX_CHANGES) return `at most ${MAX_CHANGES} changes per push`;
  const changes: PushChange[] = [];
  for (const raw of b.changes as unknown[]) {
    const c = raw as Record<string, unknown> | null;
    if (!c || typeof c.title !== "string" || typeof c.body !== "string") return "each change needs a title and a body";
    const title = c.title.replace(/\s+/g, " ").trim();
    if (title === "") return "a rule title can't be empty";
    if (c.kind === "update") {
      if (typeof c.ruleId !== "string" || !UUID.test(c.ruleId)) return "ruleId must be a rule id";
      if (typeof c.baseVersion !== "number" || !Number.isSafeInteger(c.baseVersion) || c.baseVersion < 1) return "baseVersion must be a version number";
      changes.push({ kind: "update", ruleId: c.ruleId, baseVersion: c.baseVersion, title, body: c.body });
    } else if (c.kind === "create") {
      if (typeof c.layer !== "string" || !LAYERS.has(c.layer)) return "layer must be company, team, project, module or personal";
      if (c.layer === "module" && (typeof c.module !== "string" || c.module.length > 64)) return "a folder rule needs its folder's name";
      const layer = c.layer as Extract<PushChange, { kind: "create" }>["layer"];
      changes.push({ kind: "create", layer, ...(layer === "module" ? { module: c.module as string } : {}), title, body: c.body });
    } else {
      return "kind must be update or create";
    }
  }
  return { ref: { space: b.space, project: b.project }, changes };
}

/** This project's merge input with one change applied (for the size check and the website's lock-clash check). */
export function inputAfter(loaded: LoadedProject, change: PushChange, newRuleId: string | undefined): MergeInput {
  const input: MergeInput = structuredClone(loaded.input);
  const rule = { id: newRuleId ?? (change as { ruleId: string }).ruleId, title: change.title, body: change.body };
  const replace = <T extends { id: string }>(list: T[], extra: Partial<T>) => {
    const i = list.findIndex((r) => r.id === rule.id);
    if (i >= 0) list[i] = { ...list[i]!, ...rule, ...extra };
    else list.push({ ...rule, ...extra } as unknown as T);
  };
  const layer = change.kind === "update" ? loaded.rules.get(change.ruleId)!.layer : change.layer;
  if (layer === "company" || layer === "team") replace(input[layer], { locked: change.kind === "update" ? loaded.rules.get(change.ruleId)!.locked : false });
  else if (layer === "project" || layer === "personal") replace(input[layer], {});
  else {
    const moduleId = change.kind === "update" ? loaded.rules.get(change.ruleId)!.moduleId : loaded.modules.find((m) => m.name === change.module)?.id;
    let mod = input.modules.find((m) => m.id === moduleId);
    if (!mod) {
      const info = loaded.modules.find((m) => m.id === moduleId)!;
      mod = { ...info, rules: [] };
      input.modules.push(mod);
    }
    replace(mod.rules, {});
  }
  return input;
}

/** The combined size of this project's files after one change, for the database's 256 KiB check. */
export function sizeAfter(loaded: LoadedProject, change: PushChange, newRuleId: string | undefined): number {
  return renderClaude(merge(inputAfter(loaded, change, newRuleId)), 0).reduce((n, f) => n + Buffer.byteLength(f.content, "utf8"), 0);
}

/** Our own database refusal texts (private.deny / bad_input) are fixed sentences: safe to pass on, when printable. */
function dbReason(e: unknown): string {
  const m = (e as { message?: unknown } | null)?.message;
  return typeof m === "string" && /^[\x20-\x7e]{1,200}$/.test(m) ? m : "the database refused this change";
}

/**
 * Applies ONE change in the caller's transaction. Never throws for an expected refusal: it
 * answers with a status. Unexpected errors (connection, bugs) do throw.
 */
export interface ApplyOptions {
  /** Merged sizes of the OTHER projects this change reaches (website editor). Push sends none (known limit, #64). */
  otherSizes?: Record<string, number>;
  /** Company/team only: set or clear the lock. Default: create unlocked, update keeps it. */
  locked?: boolean;
  /** The id a new rule gets (the website picks it first, to check lock clashes). Default: a fresh one. */
  newRuleId?: string;
}

export async function applyChange(tx: Tx, ring: Keyring, loaded: LoadedProject, change: PushChange, opts: ApplyOptions = {}): Promise<ChangeResult> {
  // 1. Safety check first: a secret never even gets encrypted and stored.
  const safety = checkRule({ title: change.title, body: change.body });
  if (!safety.ok) {
    const blocking = safety.findings.filter((f) => f.severity === "block").map((f) => f.message);
    return { status: "refused", reason: `safety check: ${blocking.slice(0, 3).join(" ")}` };
  }

  // 2. Where it goes.
  const { project } = loaded;
  let ruleId: string;
  let version: number;
  let layer: string;
  let scopeId: string | null;
  let baseVersion: number | null = null;
  if (change.kind === "update") {
    const rule = loaded.rules.get(change.ruleId);
    if (!rule) return { status: "refused", reason: "this rule is no longer in your rules: run axiomic pull" };
    if (rule.version !== change.baseVersion) {
      return { status: "conflict", reason: `changed on the server since your last pull (now version ${rule.version}): run axiomic pull, then redo your edit` };
    }
    ruleId = rule.id;
    version = rule.version + 1;
    layer = rule.layer;
    scopeId = rule.teamId ?? rule.projectId ?? rule.moduleId;
    baseVersion = rule.version;
  } else {
    ruleId = opts.newRuleId ?? randomUUID();
    version = 1;
    layer = change.layer;
    if (change.layer === "module") {
      const mod = loaded.modules.find((m) => m.name === change.module);
      if (!mod) return { status: "refused", reason: `there is no folder "${change.module}" in this project any more` };
      scopeId = mod.id;
    } else {
      scopeId = change.layer === "team" ? project.team_id : change.layer === "project" ? project.id : null;
    }
  }
  const sizes = { ...opts.otherSizes, [project.id]: sizeAfter(loaded, change, change.kind === "create" ? ruleId : undefined) };

  // 3. Try a direct save; if the layer isn't yours, make it a suggestion instead.
  try {
    const sealed = encryptText(ring, change.body, (kv) => ruleVersionAad(ruleId, version, kv));
    await tx.savepoint((sp) => sp`
      select api.save_rule(${ruleId}::uuid, ${version}::integer, ${project.space_id}::uuid, ${layer}::text, ${scopeId}::uuid,
                           ${change.title}::text, ${sealed.nonce}::bytea, ${sealed.ciphertext}::bytea, ${sealed.keyVersion}::smallint,
                           ${opts.locked ?? (change.kind === "create" ? false : null)}::boolean, ${JSON.stringify(sizes)}::text::jsonb)`);
    return { status: "saved", ruleId, version };
  } catch (e) {
    const code = pgCode(e);
    if (code === "22023") {
      return /meanwhile/.test(dbReason(e)) ? { status: "conflict", reason: `${dbReason(e)}: run axiomic pull, then redo your edit` } : { status: "refused", reason: dbReason(e) };
    }
    if (code !== "42501") throw e;
  }

  const suggestionId = randomUUID();
  try {
    const sealed = encryptText(ring, change.body, (kv) => suggestionAad(suggestionId, kv));
    await tx.savepoint((sp) => sp`
      select api.create_suggestion(${suggestionId}::uuid, ${project.space_id}::uuid, ${change.kind}::text, ${layer}::text,
                                   ${change.kind === "update" ? null : scopeId}::uuid, ${change.kind === "update" ? ruleId : null}::uuid,
                                   ${null}::uuid, ${change.title}::text, ${sealed.nonce}::bytea, ${sealed.ciphertext}::bytea,
                                   ${sealed.keyVersion}::smallint, ${baseVersion}::integer)`);
    return { status: "suggested", suggestionId };
  } catch (e) {
    const code = pgCode(e);
    if (code === "22023" || code === "42501") return { status: "refused", reason: dbReason(e) };
    throw e;
  }
}
