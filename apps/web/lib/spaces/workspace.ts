/**
 * What the signed-in website shows: your spaces and projects (step 2), and one project's rules
 * per layer plus the combined result (step 3). Read-only; every query runs inside withUser(), so
 * row-level security decides what is visible. The project view reuses loadProject() from
 * pull.ts, so the website shows exactly what `axiomic pull` would deliver to you.
 */
import "server-only";
import { merge, renderClaude, type MergeResult, type RenderedFile } from "@axiomic/shared";
import type { Keyring } from "@axiomic/shared/crypto";
import type { Tx } from "@/lib/db";
import { loadProject, type LoadedProject, type ProjectRef } from "@/lib/rules/pull";

export type Role = "admin" | "editor" | "reader";

export interface SpaceSummary {
  id: string;
  kind: "work" | "personal";
  name: string;
  slug: string;
  role: Role;
  projects: ProjectSummary[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  slug: string;
  teamName: string | null; // null: the personal space's hidden team (not shown)
  archived: boolean;
  modules: number;
}

/** Your spaces (work first, then personal), each with the projects you can read. */
export async function listSpaces(tx: Tx): Promise<SpaceSummary[]> {
  const spaces = await tx<{ id: string; kind: "work" | "personal"; name: string; slug: string; role: Role }[]>`
    select s.id, s.kind, s.name, s.slug, m.role
    from public.memberships m join public.spaces s on s.id = m.space_id
    where m.user_id = auth.uid()
    order by s.kind = 'personal', lower(s.name), s.id`;
  if (spaces.length === 0) return [];

  const projects = await tx<{ id: string; space_id: string; name: string; slug: string; archived_at: Date | null; team_name: string; hidden: boolean; modules: string }[]>`
    select p.id, p.space_id, p.name, p.slug, p.archived_at, t.name as team_name, t.hidden,
           (select count(*) from public.active_modules am where am.project_id = p.id) as modules
    from public.projects p join public.teams t on t.id = p.team_id
    where p.space_id = any(${spaces.map((s) => s.id)}::uuid[])
    order by p.archived_at nulls first, lower(t.name), lower(p.name), p.id`;

  return spaces.map((s) => ({
    ...s,
    projects: projects
      .filter((p) => p.space_id === s.id)
      .map((p) => ({
        id: p.id, name: p.name, slug: p.slug, teamName: p.hidden ? null : p.team_name,
        archived: p.archived_at !== null, modules: Number(p.modules),
      })),
  }));
}

/** A personal space's slug is "u-<long id>"; show it as "Personal" (office-test finding). */
export function spaceLabel(s: { kind: "work" | "personal"; name: string }): string {
  return s.kind === "personal" ? "Personal" : s.name;
}

/** Which layers you may change directly. Anything else becomes a suggestion. */
export interface EditRights {
  company: boolean;
  team: boolean;
  project: boolean;
  personal: boolean;
  /** module id → may edit */
  modules: Record<string, boolean>;
}

export interface ProjectView {
  space: { id: string; kind: "work" | "personal"; name: string; slug: string; role: Role };
  team: { id: string; name: string; hidden: boolean };
  loaded: LoadedProject;
  /** Every folder of the project (also those with no rules yet), with its owner's name. */
  modules: { id: string; name: string; path: string; ownerName: string | null }[];
  result: MergeResult;
  files: RenderedFile[];
  rights: EditRights;
  pendingSuggestions: number;
}

export type ProjectViewResult =
  | { ok: true; view: ProjectView }
  | { ok: false; status: 404 | 409; error: string };

export async function loadProjectView(tx: Tx, ring: Keyring, ref: ProjectRef): Promise<ProjectViewResult> {
  const r = await loadProject(tx, ring, ref);
  if (!r.ok) return r;
  const { loaded } = r;
  const { project } = loaded;

  const [space] = await tx<ProjectView["space"][]>`
    select s.id, s.kind, s.name, s.slug, m.role
    from public.spaces s join public.memberships m on m.space_id = s.id and m.user_id = auth.uid()
    where s.id = ${project.space_id}`;
  // Visible project but no membership row: can't happen today (can_read_project needs one); fail closed.
  if (!space) return { ok: false, status: 404, error: "project not found" };

  const [team] = await tx<ProjectView["team"][]>`
    select id, name, hidden from public.teams where id = ${project.team_id}`;

  const modules = await tx<{ id: string; name: string; path: string; owner_name: string | null }[]>`
    select m.id, m.name, m.path, pr.display_name as owner_name
    from public.active_modules m left join public.profiles pr on pr.id = m.owner_id
    where m.project_id = ${project.id} order by m.created_at, m.id`;

  // The database's own write decision (private.can_edit_layer), asked once per layer, so the
  // page offers "Edit" or "Suggest" exactly as api.save_rule will decide. Display only:
  // the save itself checks again.
  const [rights] = await tx<{ company: boolean; team: boolean; project: boolean; personal: boolean }[]>`
    select private.can_edit_layer('company',  ${space.id}, null, null, null, null)                 as company,
           private.can_edit_layer('team',     ${space.id}, ${project.team_id}, null, null, null)   as team,
           private.can_edit_layer('project',  ${space.id}, null, ${project.id}, null, null)        as project,
           private.can_edit_layer('personal', ${space.id}, null, null, null, auth.uid())           as personal`;
  const moduleRights = await tx<{ id: string; ok: boolean }[]>`
    select m.id, private.can_edit_layer('module', ${space.id}, null, null, m.id, null) as ok
    from public.active_modules m where m.project_id = ${project.id}`;

  const [pending] = await tx<{ n: string }[]>`
    select count(*) as n from public.suggestions s
    where s.status = 'pending' and s.space_id = ${space.id}
      and (s.project_id = ${project.id}
           or s.module_id in (select id from public.active_modules where project_id = ${project.id})
           or s.team_id = ${project.team_id}
           or s.layer = 'company')`;

  const result = merge(loaded.input);
  const v = loaded.versions;
  return {
    ok: true,
    view: {
      space,
      team: team!,
      loaded,
      modules: modules.map((m) => ({ id: m.id, name: m.name, path: m.path, ownerName: m.owner_name })),
      result,
      files: renderClaude(result, v.space + v.team + v.personal),
      rights: { ...rights!, modules: Object.fromEntries(moduleRights.map((m) => [m.id, m.ok])) },
      pendingSuggestions: Number(pending!.n),
    },
  };
}
