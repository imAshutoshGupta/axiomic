import "server-only";
import { randomUUID } from "node:crypto";
import { checkRule, merge, type Layer } from "@axiomic/shared";
import { decryptText, encryptText, ruleVersionAad, suggestionAad, type Keyring } from "@axiomic/shared/crypto";
import { pgCode, type Tx } from "./db";
import { projectsReached, sizesAfter } from "./editor";
import { loadProject } from "./pull";
import { inputAfter, type PushChange } from "./push";

/**
 * The suggestions inbox (Phase 3, step 5). Reads run under RLS (can_read_suggestion: the
 * author, whoever may approve, or a space admin). Deciding goes through api.decide_suggestion,
 * which checks can_edit_layer again and turns an approval into a normal api.save_rule (all its
 * checks: version, size, archived, title clash). Before that the server re-runs the safety
 * check, re-encrypts the text for the rule version it becomes, and measures every project
 * the change reaches.
 */

export type SuggestionLayer = Exclude<Layer, "personal">;

export interface SuggestionItem {
  id: string;
  kind: "create" | "update" | "promote";
  status: "pending" | "approved" | "rejected" | "withdrawn";
  layer: SuggestionLayer;
  space: { id: string; slug: string; name: string; kind: "work" | "personal" };
  /** Where it lands, in words: "Acme", "team Web", "project Web app", "folder src/payments". */
  target: string;
  /** A project page to look at the context (the project, or the folder's project), if any. */
  projectSlug: string | null;
  title: string;
  /** null: the stored text could not be opened (wrong key, or dev seed placeholder). */
  body: string | null;
  author: string | null;
  mine: boolean;
  canDecide: boolean;
  createdAt: Date;
  decidedAt: Date | null;
  decidedBy: string | null;
  note: string | null;
  /** Update: the rule as it is now, and whether it changed since the suggestion was written. */
  current: { title: string; body: string | null; version: number } | null;
  baseVersion: number | null;
}

type Row = {
  id: string; kind: SuggestionItem["kind"]; status: SuggestionItem["status"]; layer: SuggestionLayer;
  space_id: string; space_slug: string; space_name: string; space_kind: "work" | "personal";
  team_id: string | null; team_name: string | null; project_id: string | null; project_name: string | null; project_slug: string | null;
  module_id: string | null; module_path: string | null; module_project_slug: string | null;
  rule_id: string | null; proposed_title: string; nonce: Buffer; body_ciphertext: Buffer; key_version: number;
  base_version: number | null; author: string | null; created_at: Date;
  decided_at: Date | null; decider: string | null; decision_note: string | null; can_decide: boolean; mine: boolean;
  cur_title: string | null; cur_version: number | null; cur_nonce: Buffer | null; cur_body: Buffer | null; cur_key: number | null;
};

function open(ring: Keyring, nonce: Buffer, ciphertext: Buffer, keyVersion: number, aad: string): string | null {
  try {
    return decryptText(ring, { nonce, ciphertext, keyVersion }, aad);
  } catch {
    return null; // shown as "can't be opened"; never fatal for the whole inbox
  }
}

/** Pending suggestions you can see, plus your own decided ones (newest 50). */
export async function listSuggestions(tx: Tx, ring: Keyring): Promise<SuggestionItem[]> {
  const rows = await tx<Row[]>`
    select s.id, s.kind, s.status, s.layer,
           sp.id as space_id, sp.slug as space_slug, sp.name as space_name, sp.kind as space_kind,
           s.team_id, t.name as team_name, s.project_id, p.name as project_name, p.slug as project_slug,
           s.module_id, m.path as module_path, mp.slug as module_project_slug,
           s.rule_id, s.proposed_title, s.nonce, s.body_ciphertext, s.key_version, s.base_version,
           au.display_name as author, s.created_at, s.decided_at, de.display_name as decider,
           s.decision_note, (s.created_by = auth.uid()) as mine,
           (s.status = 'pending'
            and private.can_edit_layer(s.layer, s.space_id, s.team_id, s.project_id, s.module_id, null)) as can_decide,
           cur.title as cur_title, cur.version as cur_version, cur.nonce as cur_nonce,
           cur.body_ciphertext as cur_body, cur.key_version as cur_key
    from public.suggestions s
    join public.spaces sp on sp.id = s.space_id
    left join public.teams t on t.id = s.team_id
    left join public.projects p on p.id = s.project_id
    left join public.modules m on m.id = s.module_id
    left join public.projects mp on mp.id = m.project_id
    left join public.profiles au on au.id = s.created_by
    left join public.profiles de on de.id = s.decided_by
    left join lateral (
      select v.title, v.version, v.nonce, v.body_ciphertext, v.key_version
      from public.rule_versions v where v.rule_id = s.rule_id order by v.version desc limit 1
    ) cur on s.rule_id is not null
    where s.status = 'pending' or s.created_by = auth.uid()
    order by s.status <> 'pending', s.created_at desc
    limit 200`;

  return rows.map((r) => ({
    id: r.id, kind: r.kind, status: r.status, layer: r.layer,
    space: { id: r.space_id, slug: r.space_slug, name: r.space_name, kind: r.space_kind },
    target:
      r.layer === "company" ? `all of ${r.space_name}`
      : r.layer === "team" ? `team ${r.team_name ?? "?"}`
      : r.layer === "project" ? `project ${r.project_name ?? "?"}`
      : `folder ${r.module_path ?? "?"}/`,
    projectSlug: r.project_slug ?? r.module_project_slug,
    title: r.proposed_title,
    body: open(ring, r.nonce, r.body_ciphertext, r.key_version, suggestionAad(r.id, r.key_version)),
    author: r.author,
    mine: r.mine === true,
    canDecide: r.can_decide,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
    decidedBy: r.decider,
    note: r.decision_note,
    current: r.rule_id && r.cur_version !== null
      ? {
          title: r.cur_title!, version: r.cur_version,
          body: open(ring, r.cur_nonce!, r.cur_body!, r.cur_key!, ruleVersionAad(r.rule_id, r.cur_version, r.cur_key!)),
        }
      : null,
    baseVersion: r.base_version,
  }));
}

export type DecideResult = { ok: true } | { ok: false; reason: string; findings?: string[] };

/** Approve or reject one suggestion, as the signed-in person. */
export async function decideSuggestion(
  tx: Tx, ring: Keyring, id: string, decision: "approve" | "reject", note: string,
): Promise<DecideResult> {
  const [s] = await tx<{
    id: string; kind: SuggestionItem["kind"]; status: string; layer: SuggestionLayer; space_id: string; space_slug: string;
    team_id: string | null; project_id: string | null; module_id: string | null; module_project_id: string | null;
    module_name: string | null; rule_id: string | null; proposed_title: string; nonce: Buffer; body_ciphertext: Buffer; key_version: number;
  }[]>`
    select s.id, s.kind, s.status, s.layer, s.space_id, sp.slug as space_slug, s.team_id, s.project_id, s.module_id,
           m.project_id as module_project_id, m.name as module_name,
           s.rule_id, s.proposed_title, s.nonce, s.body_ciphertext, s.key_version
    from public.suggestions s join public.spaces sp on sp.id = s.space_id
    left join public.modules m on m.id = s.module_id
    where s.id = ${id}`;
  if (!s) return { ok: false, reason: "That suggestion isn't there any more." };
  if (s.status !== "pending") return { ok: false, reason: "That suggestion was already decided." };
  const cleanNote = note.trim().slice(0, 2000);

  if (decision === "reject") {
    return call(tx, () => tx.savepoint((sp) => sp`
      select api.decide_suggestion(${id}::uuid, 'reject', ${cleanNote || null}::text,
                                   null::uuid, null::integer, null::bytea, null::bytea, null::smallint, null::jsonb)`));
  }

  // Approve. 1. The text, opened and checked again (the rules may have changed since it was sent).
  const body = open(ring, s.nonce, s.body_ciphertext, s.key_version, suggestionAad(s.id, s.key_version));
  if (body === null) return { ok: false, reason: "This suggestion's text can't be opened, so it can't be approved. Reject it instead." };
  const safety = checkRule({ title: s.proposed_title, body });
  if (!safety.ok) {
    return {
      ok: false,
      reason: "The safety check found a problem in this suggestion. Reject it, or ask the author to fix it.",
      findings: safety.findings.filter((f) => f.severity === "block").map((f) => f.message),
    };
  }

  // 2. Which rule and version it becomes.
  let ruleId: string;
  let version: number;
  let change: PushChange;
  if (s.kind === "update") {
    const [v] = await tx<{ n: number | null }[]>`select max(version) as n from public.rule_versions where rule_id = ${s.rule_id}`;
    ruleId = s.rule_id!;
    version = (v?.n ?? 0) + 1;
    change = { kind: "update", ruleId, baseVersion: version - 1, title: s.proposed_title, body };
  } else {
    ruleId = randomUUID();
    version = 1;
    change = {
      kind: "create", layer: s.layer, ...(s.layer === "module" ? { module: s.module_name ?? "" } : {}),
      title: s.proposed_title, body,
    };
  }
  const newRuleId = s.kind === "update" ? undefined : ruleId;

  // 3. Every project it reaches: sizes for the 256 KiB check, and "would the merge drop it?".
  const projectId = s.project_id ?? s.module_project_id;
  const slugs = await projectsReached(tx, { spaceId: s.space_id, layer: s.layer, teamId: s.team_id, projectId });
  const first = slugs[0] ? await loadProject(tx, ring, { space: s.space_slug, project: slugs[0] }) : null;
  if (first?.ok && (change.kind === "create" || first.loaded.rules.has(ruleId))) {
    const dropped = merge(inputAfter(first.loaded, change, newRuleId)).blocked.find((b) => b.ruleId === ruleId);
    if (dropped) return { ok: false, reason: `A locked rule already has the title "${s.proposed_title}", so this would never be delivered. Reject it, or rename it first.` };
  }
  const sizes = await sizesAfter(tx, ring, s.space_slug, slugs, change, newRuleId);

  // 4. Re-encrypted for the rule version it becomes (the version number is part of the AAD).
  const sealed = encryptText(ring, body, (kv) => ruleVersionAad(ruleId, version, kv));
  return call(tx, () => tx.savepoint((sp) => sp`
    select api.decide_suggestion(${id}::uuid, 'approve', ${cleanNote || null}::text,
                                 ${ruleId}::uuid, ${version}::integer, ${sealed.nonce}::bytea, ${sealed.ciphertext}::bytea,
                                 ${sealed.keyVersion}::smallint, ${JSON.stringify(sizes)}::text::jsonb)`));
}

/** Withdraw your own pending suggestion. */
export async function withdrawSuggestion(tx: Tx, id: string): Promise<DecideResult> {
  return call(tx, () => tx.savepoint((sp) => sp`select api.withdraw_suggestion(${id}::uuid)`));
}

/** Run one api.* call; turn the database's expected refusals into fixed sentences. */
async function call(_tx: Tx, fn: () => Promise<unknown>): Promise<DecideResult> {
  try {
    await fn();
    return { ok: true };
  } catch (e) {
    const code = pgCode(e);
    if (code === "42501") return { ok: false, reason: "Only the layer's owner can decide this suggestion." };
    if (code === "22023") return { ok: false, reason: dbReason(e) };
    throw e;
  }
}

/** Our own refusal texts (private.deny / bad_input) are fixed sentences: safe to show when printable. */
function dbReason(e: unknown): string {
  const m = (e as { message?: unknown } | null)?.message;
  if (typeof m !== "string" || !/^[\x20-\x7e]{1,200}$/.test(m)) return "The database refused this.";
  return m.charAt(0).toUpperCase() + m.slice(1) + ".";
}
