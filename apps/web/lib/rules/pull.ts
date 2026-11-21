/**
 * Everything one person needs for one project, read in ONE repeatable-read transaction
 * (DB-DESIGN 6.13, R15): the three counters, then the rules, then report_pull with the
 * counters actually read. Row-level security decides what is visible; this code only picks
 * which visible rows belong to this project. No formatting here: merge() + renderClaude().
 *
 * loadProject() is the shared part: push (lib/rules/push.ts) uses it too, to know each rule's
 * scope and newest version, and to measure the combined size after a change.
 */
import "server-only";
import { merge, renderClaude, renderIndex, type LockableRule, type MergeInput, type Module, type RenderedFile, type Rule } from "@axiomic/shared";
import { decryptText, ruleVersionAad, type Keyring } from "@axiomic/shared/crypto";
import type { Tx } from "@/lib/db";

export type PullResult =
  | { ok: true; body: PullBody }
  | { ok: false; status: 404 | 409; error: string };

/** One rule's place in the files, so the CLI can map "### Title" sections back to rules (#64). */
export interface IndexEntry {
  path: string;
  id: string;
  layer: string;
  version: number;
  title: string;
}

export interface PullBody {
  project: { id: string; name: string; slug: string; space: string };
  /** The three counters this answer was built from (D3). The CLI compares them to know if it's up to date. */
  versions: { space: number; team: number; personal: number };
  files: RenderedFile[];
  /** Which section of which file is which rule, in file order. */
  rules: IndexEntry[];
  /** Rules dropped by the merge (e.g. tried to replace a locked rule), for the CLI to explain. */
  blocked: { title: string; layer: string; reason: string }[];
}

type RuleRow = {
  id: string;
  layer: "company" | "team" | "project" | "module" | "personal";
  team_id: string | null;
  project_id: string | null;
  module_id: string | null;
  locked: boolean;
  version: number;
  title: string;
  nonce: Buffer;
  body_ciphertext: Buffer;
  key_version: number;
};

/** Which project: the two slugs from axiomic.json (DECISIONS #56). Checked with isValidSlug by the route. */
export interface ProjectRef {
  space: string;
  project: string;
}

export interface LoadedRule {
  id: string;
  layer: RuleRow["layer"];
  teamId: string | null;
  projectId: string | null;
  moduleId: string | null;
  locked: boolean;
  version: number;
}

export interface LoadedProject {
  project: { id: string; space_id: string; team_id: string; name: string; slug: string };
  versions: { space: number; team: number; personal: number };
  modules: { id: string; name: string; path: string }[];
  /** The merge input (decrypted): what this person sees in this project. */
  input: MergeInput;
  /** Every rule in `input`, by id: its scope and newest version. */
  rules: Map<string, LoadedRule>;
}

export type LoadResult = { ok: true; loaded: LoadedProject } | { ok: false; status: 404 | 409; error: string };

export async function loadProject(tx: Tx, ring: Keyring, ref: ProjectRef): Promise<LoadResult> {
  // 1. The project, found by its space's slug + its own slug (both unique together, both unchangeable).
  //    RLS hides spaces and projects you can't read. Not visible or doesn't exist → the same 404,
  //    so nobody can probe which slugs exist.
  const [project] = await tx<{ id: string; space_id: string; team_id: string; name: string; slug: string; archived_at: Date | null }[]>`
    select p.id, p.space_id, p.team_id, p.name, p.slug, p.archived_at
    from public.projects p join public.spaces s on s.id = p.space_id
    where s.slug = ${ref.space} and p.slug = ${ref.project}`;
  if (!project) return { ok: false, status: 404, error: "project not found" };
  if (project.archived_at) return { ok: false, status: 409, error: "this project is archived" };

  // 2. The three counters (D3). Personal counter: this person's, in this space (0 if none).
  const [c] = await tx<{ space: string; team: string; personal: string }[]>`
    select
      (select rules_version from public.spaces where id = ${project.space_id}) as space,
      (select rules_version from public.teams  where id = ${project.team_id})  as team,
      coalesce((select personal_version from public.memberships
                where space_id = ${project.space_id} and user_id = auth.uid()), 0) as personal`;
  const versions = { space: Number(c!.space), team: Number(c!.team), personal: Number(c!.personal) };

  // 3. Folders (modules) of this project, not in the trash.
  const modules = await tx<{ id: string; name: string; path: string }[]>`
    select id, name, path from public.active_modules
    where project_id = ${project.id} order by created_at, id`;

  // 4. The rules that apply here, each with its newest version, in created_at, id order.
  //    Personal: ONLY the caller's own. (An admin may see others' personal rules under RLS,
  //    but must never receive them in a pull.)
  const rows = await tx<RuleRow[]>`
    select r.id, r.layer, r.team_id, r.project_id, r.module_id, r.locked,
           v.version, v.title, v.nonce, v.body_ciphertext, v.key_version
    from public.active_rules r
    join lateral (
      select version, title, nonce, body_ciphertext, key_version
      from public.rule_versions where rule_id = r.id order by version desc limit 1
    ) v on true
    where r.space_id = ${project.space_id}
      and (   r.layer = 'company'
           or (r.layer = 'team'     and r.team_id = ${project.team_id})
           or (r.layer = 'project'  and r.project_id = ${project.id})
           or (r.layer = 'module'   and r.module_id in (select id from public.active_modules where project_id = ${project.id}))
           or (r.layer = 'personal' and r.user_id = auth.uid()))
    order by r.created_at, r.id`;

  // 5. Decrypt and sort into the merge's input. A rule that won't decrypt is a server fault: throw.
  const input = { company: [] as LockableRule[], team: [] as LockableRule[], project: [] as Rule[], modules: [] as Module[], personal: [] as Rule[] };
  const byModule = new Map<string, Module>();
  for (const m of modules) {
    const mod: Module = { id: m.id, name: m.name, path: m.path, rules: [] };
    byModule.set(m.id, mod);
    input.modules.push(mod);
  }
  const rules = new Map<string, LoadedRule>();
  for (const row of rows) {
    let body: string;
    try {
      body = decryptText(
        ring,
        { nonce: row.nonce, ciphertext: row.body_ciphertext, keyVersion: row.key_version },
        ruleVersionAad(row.id, row.version, row.key_version),
      );
    } catch (e) {
      // Ids and versions are not secret; they tell the operator which row is broken. Fail closed.
      throw new Error(`rule ${row.id} v${row.version} (key ${row.key_version}): ${(e as Error).message}`);
    }
    const rule = { id: row.id, title: row.title, body };
    if (row.layer === "company" || row.layer === "team") input[row.layer].push({ ...rule, locked: row.locked });
    else if (row.layer === "module") byModule.get(row.module_id!)?.rules.push(rule);
    else input[row.layer].push(rule);
    rules.set(row.id, {
      id: row.id, layer: row.layer, teamId: row.team_id, projectId: row.project_id, moduleId: row.module_id,
      locked: row.locked, version: row.version,
    });
  }
  input.modules = input.modules.filter((m) => m.rules.length > 0); // no empty folder files

  return { ok: true, loaded: { project, versions, modules, input, rules } };
}

/** report: false = only looking (axiomic diff): don't record it as a pull this person received. */
export async function readPull(tx: Tx, ring: Keyring, ref: ProjectRef, cliVersion: string | null, report = true): Promise<PullResult> {
  const r = await loadProject(tx, ring, ref);
  if (!r.ok) return r;
  const { project, versions, input, rules } = r.loaded;

  // 6. Combine and render. The marker's single number: the three counters only ever grow, so their sum does too.
  const result = merge(input);
  const files = renderClaude(result, versions.space + versions.team + versions.personal);

  // 7. Record "this person pulled these counters" (agent keys: the function skips it, S5).
  if (report) await tx`select api.report_pull(${project.id}, ${versions.space}, ${versions.team}, ${versions.personal}, ${cliVersion})`;

  return {
    ok: true,
    body: {
      project: { id: project.id, name: project.name, slug: project.slug, space: ref.space },
      versions,
      files,
      rules: renderIndex(result).map((x) => ({ path: x.path, id: x.ruleId, layer: x.layer, version: rules.get(x.ruleId)!.version, title: x.title })),
      blocked: result.blocked.map((b) => ({ title: b.title, layer: b.source, reason: b.reason })),
    },
  };
}
