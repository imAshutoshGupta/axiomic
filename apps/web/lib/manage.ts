import "server-only";
import { pgCode, type Tx } from "./db";
import type { Role } from "./workspace";

/**
 * Managing a space from the website (Phase 3, invites + roles): members, invites, teams,
 * projects and folders. Every change is ONE api.* call; the database decides who may do it
 * (is_admin needs two-factor in work spaces, #43; leads manage their team; editors create
 * projects). This file only reads what the page shows and turns refusals into sentences.
 */

export type ApiResult<T = void> = { ok: true; value: T } | { ok: false; reason: string };

/** Run one api.* call. 42501 (not allowed) and 22023 (bad input) become a fixed, printable reason. */
export async function runApi<T>(tx: Tx, fn: (tx: Tx) => Promise<T>): Promise<ApiResult<T>> {
  try {
    const value = await tx.savepoint((sp) => fn(sp as unknown as Tx));
    return { ok: true, value: value as T };
  } catch (e) {
    const code = pgCode(e);
    if (code === "42501" || code === "22023" || code === "23514") return { ok: false, reason: dbReason(e, code) };
    throw e;
  }
}

/** Our own refusal texts (private.deny / bad_input) are fixed sentences: safe to show when printable. */
export function dbReason(e: unknown, code?: string): string {
  const m = (e as { message?: unknown } | null)?.message;
  if (typeof m !== "string" || !/^[\x20-\x7e—]{1,200}$/.test(m)) {
    return code === "42501" ? "You aren't allowed to do that." : "The database refused this.";
  }
  if (m === "admins only") return "Only space admins can do this (and in a company space, admins need two-factor sign-in, which isn't built yet).";
  return m.charAt(0).toUpperCase() + m.slice(1) + (/[.!?]$/.test(m) ? "" : ".");
}

export interface Member {
  userId: string;
  name: string;
  email: string | null;
  role: Role;
  teams: { id: string; name: string; role: "lead" | "member" }[];
  isMe: boolean;
}

export interface TeamInfo {
  id: string;
  name: string;
  slug: string;
  members: { userId: string; name: string; role: "lead" | "member" }[];
  /** You may add/remove people and rename it (admin, or its lead). */
  canManage: boolean;
}

export interface InviteInfo {
  id: string;
  email: string;
  role: Role;
  teamName: string | null;
  createdAt: Date;
  expiresAt: Date;
  state: "open" | "expired" | "accepted" | "revoked";
}

export interface SpaceManageView {
  space: { id: string; slug: string; name: string; kind: "work" | "personal"; role: Role; deleteAfter: Date | null };
  /** Effective admin (in a work space: admin role AND two-factor). */
  isAdmin: boolean;
  /** Admin by role, but missing two-factor: show why the buttons won't work yet. */
  adminNeeds2fa: boolean;
  /** Editor or admin role: may create projects. */
  canCreateProject: boolean;
  members: Member[];
  teams: TeamInfo[];
  /** Admins only (RLS); empty for everyone else. */
  invites: InviteInfo[];
}

export async function loadSpaceManage(tx: Tx, slug: string): Promise<SpaceManageView | null> {
  const [s] = await tx<{ id: string; slug: string; name: string; kind: "work" | "personal"; role: Role; delete_after: Date | null; is_admin: boolean; can_edit: boolean }[]>`
    select s.id, s.slug, s.name, s.kind, m.role, s.delete_after,
           private.is_admin(s.id) as is_admin, private.can_edit(s.id) as can_edit
    from public.spaces s join public.memberships m on m.space_id = s.id and m.user_id = auth.uid()
    where s.slug = ${slug}`;
  if (!s) return null; // not a member, or no such space: the same answer

  const members = await tx<{ user_id: string; name: string; email: string | null; role: Role; is_me: boolean }[]>`
    select m.user_id, p.display_name as name, p.email, m.role, m.user_id = auth.uid() as is_me
    from public.memberships m join public.profiles p on p.id = m.user_id
    where m.space_id = ${s.id}
    order by m.role = 'admin' desc, m.role = 'editor' desc, lower(p.display_name), m.user_id`;

  const teams = await tx<{ id: string; name: string; slug: string; can_manage: boolean }[]>`
    select t.id, t.name, t.slug,
           (private.is_admin(t.space_id) or private.owns_team_layer(t.id)) as can_manage
    from public.teams t where t.space_id = ${s.id} and not t.hidden
    order by lower(t.name), t.id`;

  const tm = await tx<{ team_id: string; user_id: string; role: "lead" | "member"; name: string }[]>`
    select tm.team_id, tm.user_id, tm.role, p.display_name as name
    from public.team_memberships tm join public.profiles p on p.id = tm.user_id
    where tm.space_id = ${s.id}
    order by tm.role = 'lead' desc, lower(p.display_name)`;

  const invites = await tx<{ id: string; email: string; role: Role; team_name: string | null; created_at: Date; expires_at: Date; accepted_at: Date | null; revoked_at: Date | null }[]>`
    select i.id, i.email, i.role, t.name as team_name, i.created_at, i.expires_at, i.accepted_at, i.revoked_at
    from public.invites i left join public.teams t on t.id = i.team_id
    where i.space_id = ${s.id}
    order by (i.accepted_at is null and i.revoked_at is null and i.expires_at > now()) desc, i.created_at desc
    limit 100`;

  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  return {
    space: { id: s.id, slug: s.slug, name: s.name, kind: s.kind, role: s.role, deleteAfter: s.delete_after },
    isAdmin: s.is_admin,
    adminNeeds2fa: s.kind === "work" && s.role === "admin" && !s.is_admin,
    canCreateProject: s.can_edit,
    members: members.map((m) => ({
      userId: m.user_id, name: m.name, email: m.email, role: m.role, isMe: m.is_me,
      teams: tm.filter((x) => x.user_id === m.user_id).map((x) => ({ id: x.team_id, name: teamName.get(x.team_id) ?? "?", role: x.role })),
    })),
    teams: teams.map((t) => ({
      id: t.id, name: t.name, slug: t.slug, canManage: t.can_manage,
      members: tm.filter((x) => x.team_id === t.id).map((x) => ({ userId: x.user_id, name: x.name, role: x.role })),
    })),
    invites: invites.map((i) => ({
      id: i.id, email: i.email, role: i.role, teamName: i.team_name, createdAt: i.created_at, expiresAt: i.expires_at,
      state: i.accepted_at ? "accepted" : i.revoked_at ? "revoked" : i.expires_at < new Date() ? "expired" : "open",
    })),
  };
}

export interface ProjectSettingsView {
  project: { id: string; name: string; slug: string; archived: boolean; teamName: string; teamHidden: boolean; ownerId: string | null; ownerName: string | null };
  space: { id: string; slug: string; kind: "work" | "personal" };
  /** Rename, archive, folders: editors/admins of the space or the project owner. */
  canEdit: boolean;
  /** Change owner: admin or the current owner. */
  canTransfer: boolean;
  /** Delete (only an empty project): admins. */
  canDelete: boolean;
  modules: { id: string; name: string; path: string; ownerId: string | null; ownerName: string | null; canEdit: boolean }[];
  /** Who can own a project or folder: editors and admins of the space. */
  owners: { userId: string; name: string }[];
}

export async function loadProjectSettings(tx: Tx, spaceSlug: string, projectSlug: string): Promise<ProjectSettingsView | null> {
  const [p] = await tx<{ id: string; name: string; slug: string; archived_at: Date | null; team_name: string; hidden: boolean; owner_id: string | null; owner_name: string | null; space_id: string; space_slug: string; kind: "work" | "personal"; can_edit: boolean; can_transfer: boolean; can_delete: boolean }[]>`
    select p.id, p.name, p.slug, p.archived_at, t.name as team_name, t.hidden, p.owner_id, pr.display_name as owner_name,
           s.id as space_id, s.slug as space_slug, s.kind,
           (private.can_edit(p.space_id) or private.owns_project_layer(p.id)) as can_edit,
           (private.is_admin(p.space_id) or private.owns_project_layer(p.id)) as can_transfer,
           private.is_admin(p.space_id) as can_delete
    from public.projects p
    join public.spaces s on s.id = p.space_id
    join public.teams t on t.id = p.team_id
    left join public.profiles pr on pr.id = p.owner_id
    where s.slug = ${spaceSlug} and p.slug = ${projectSlug}`;
  if (!p) return null;

  const modules = await tx<{ id: string; name: string; path: string; owner_id: string | null; owner_name: string | null; can_edit: boolean }[]>`
    select m.id, m.name, m.path, m.owner_id, pr.display_name as owner_name,
           (private.can_edit_project(m.project_id) or private.owns_module_layer(m.id)) as can_edit
    from public.active_modules m left join public.profiles pr on pr.id = m.owner_id
    where m.project_id = ${p.id} order by m.created_at, m.id`;

  const owners = await tx<{ user_id: string; name: string }[]>`
    select m.user_id, pr.display_name as name
    from public.memberships m join public.profiles pr on pr.id = m.user_id
    where m.space_id = ${p.space_id} and m.role in ('admin', 'editor')
    order by lower(pr.display_name)`;

  return {
    project: { id: p.id, name: p.name, slug: p.slug, archived: p.archived_at !== null, teamName: p.team_name, teamHidden: p.hidden, ownerId: p.owner_id, ownerName: p.owner_name },
    space: { id: p.space_id, slug: p.space_slug, kind: p.kind },
    canEdit: p.can_edit,
    canTransfer: p.can_transfer,
    canDelete: p.can_delete,
    modules: modules.map((m) => ({ id: m.id, name: m.name, path: m.path, ownerId: m.owner_id, ownerName: m.owner_name, canEdit: m.can_edit })),
    owners: owners.map((o) => ({ userId: o.user_id, name: o.name })),
  };
}
