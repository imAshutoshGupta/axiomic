/**
 * What each button on the space page does (members, invites, teams, new projects).
 *
 * One small function per intent; each makes ONE api.* call and the database decides who may.
 * This is a plain module, NOT a "use server" file: only actions.ts is callable from the browser,
 * and it checks the session before it calls runSpaceIntent().
 */
import { isValidSlug } from "@axiomic/shared";
import type { ActionState } from "@/components/app/action-form";
import type { Tx } from "@/lib/db";
import { readName, readOptionalUuid, readText, readUuid, SLUG_HINT } from "@/lib/input";
import { siteUrl } from "@/lib/site-url";
import { runApi, type ApiResult } from "@/lib/spaces/manage";

/** What a finished intent answers: a message to show, or a page to go to. */
export type IntentDone = { state: ActionState; redirect?: string };
type IntentResult = ApiResult<IntentDone>;
type IntentHandler = (tx: Tx, spaceId: string, form: FormData) => Promise<IntentResult>;

const SPACE_ROLES = new Set(["admin", "editor", "reader"]);
const TEAM_ROLES = new Set(["lead", "member"]);
const MAX_EMAIL_CHARS = 320;
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const RELOAD = "Reload the page and try again.";

const HANDLERS: Record<string, IntentHandler> = {
  "rename-space": renameSpace,
  "create-invite": createInvite,
  "resend-invite": resendInvite,
  "revoke-invite": revokeInvite,
  "set-role": setRole,
  "remove-member": removeMember,
  leave: leaveSpace,
  "create-team": createTeam,
  "rename-team": renameTeam,
  "delete-team": deleteTeam,
  "set-team-member": setTeamMember,
  "remove-team-member": removeTeamMember,
  "create-project": createProject,
};

/** Finds the space by its slug and runs one intent in it. */
export async function runSpaceIntent(tx: Tx, spaceSlug: string, intent: string, form: FormData): Promise<IntentResult> {
  const [space] = await tx<{ id: string }[]>`select id from public.spaces where slug = ${spaceSlug}`;
  if (!space) return refuse("This space isn't there any more.");
  const handler = Object.hasOwn(HANDLERS, intent) ? HANDLERS[intent] : undefined;
  if (!handler) return refuse(RELOAD);
  return handler(tx, space.id, form);
}

function done(message: string, extra: Partial<ActionState> = {}): IntentResult {
  return { ok: true, value: { state: { message, ...extra } } };
}

function goTo(path: string): IntentResult {
  return { ok: true, value: { state: {}, redirect: path } };
}

function refuse(reason: string): IntentResult {
  return { ok: false, reason };
}

/** The invite link. The secret goes after "#": browsers never send that part to a server, so it stays out of logs. */
function inviteLink(secret: string): string {
  return `${siteUrl().origin}/invite#${secret}`;
}

// ----- the space -----

async function renameSpace(tx: Tx, spaceId: string, form: FormData): Promise<IntentResult> {
  const name = readName(form);
  if (!name) return refuse("Type a name.");
  const result = await runApi(tx, (t) => t`select api.rename_space(${spaceId}, ${name})`);
  return result.ok ? done("Renamed.") : result;
}

// ----- invites -----

async function createInvite(tx: Tx, spaceId: string, form: FormData): Promise<IntentResult> {
  const email = readText(form, "email").toLowerCase().slice(0, MAX_EMAIL_CHARS);
  const role = readText(form, "role");
  const teamId = readOptionalUuid(form, "team"); // null = no team; undefined = not a team id (a stale or edited form)
  if (!EMAIL_SHAPE.test(email)) return refuse("That doesn't look like an email address.");
  if (!SPACE_ROLES.has(role)) return refuse("Choose a role.");
  if (teamId === undefined) return refuse(RELOAD);
  const result = await runApi(tx, (t) => t<{ r: { secret: string } }[]>`
    select api.create_invite(${spaceId}, ${email}, ${role}, ${teamId}::uuid) as r`);
  if (!result.ok) return result;
  return done(`Invite made for ${email}.`, { link: inviteLink(result.value[0]!.r.secret) });
}

async function resendInvite(tx: Tx, _spaceId: string, form: FormData): Promise<IntentResult> {
  const inviteId = readUuid(form, "invite");
  if (!inviteId) return refuse(RELOAD);
  const result = await runApi(tx, (t) => t<{ r: { secret: string } }[]>`select api.resend_invite(${inviteId}) as r`);
  if (!result.ok) return result;
  return done("New link made; the old one no longer works. It's valid for 7 more days.", {
    link: inviteLink(result.value[0]!.r.secret),
  });
}

async function revokeInvite(tx: Tx, _spaceId: string, form: FormData): Promise<IntentResult> {
  const inviteId = readUuid(form, "invite");
  if (!inviteId) return refuse(RELOAD);
  const result = await runApi(tx, (t) => t`select api.revoke_invite(${inviteId})`);
  return result.ok ? done("Invite revoked: the link no longer works.") : result;
}

// ----- members -----

/** The layers a person still owns after a role change (from api.set_role). */
type StillOwned = { teams_led?: string[]; projects_owned?: string[]; modules_owned?: string[] };

async function setRole(tx: Tx, spaceId: string, form: FormData): Promise<IntentResult> {
  const userId = readUuid(form, "user");
  const role = readText(form, "role");
  if (!userId || !SPACE_ROLES.has(role)) return refuse("Choose a role.");
  const result = await runApi(tx, (t) => t<{ r: StillOwned }[]>`
    select api.set_role(${spaceId}, ${userId}, ${role}) as r`);
  if (!result.ok) return result;
  const notes = stillOwnedNotes(result.value[0]!.r);
  return done(`Role changed to ${role}.`, notes.length ? { notes } : {});
}

/** A reader can't edit any layer, even ones they still own: say which. */
function stillOwnedNotes(owned: StillOwned): string[] {
  return [
    ...(owned.teams_led ?? []).map((team) => `Still lead of team ${team}, but can't edit its rules as a reader.`),
    ...(owned.projects_owned ?? []).map((project) => `Still owner of project ${project}: give it to an editor.`),
    ...(owned.modules_owned ?? []).map((folder) => `Still owner of folder ${folder}: give it to an editor.`),
  ];
}

async function removeMember(tx: Tx, spaceId: string, form: FormData): Promise<IntentResult> {
  const userId = readUuid(form, "user");
  if (!userId) return refuse(RELOAD);
  const result = await runApi(tx, (t) => t`select api.remove_member(${spaceId}, ${userId})`);
  if (!result.ok) return result;
  return done("Removed. Their CLI loses access to this space's projects at its next pull, and their personal rules here are deleted.");
}

async function leaveSpace(tx: Tx, spaceId: string): Promise<IntentResult> {
  const result = await runApi(tx, (t) => t`select api.leave_space(${spaceId})`);
  return result.ok ? goTo("/spaces?left=1") : result;
}

// ----- teams -----

async function createTeam(tx: Tx, spaceId: string, form: FormData): Promise<IntentResult> {
  const name = readName(form);
  const slug = readText(form, "slug");
  if (!name) return refuse("Type a team name.");
  if (!isValidSlug(slug)) return refuse(SLUG_HINT);
  const result = await runApi(tx, (t) => t`select api.create_team(${spaceId}, ${name}, ${slug})`);
  return result.ok ? done(`Team ${name} created.`) : result;
}

async function renameTeam(tx: Tx, _spaceId: string, form: FormData): Promise<IntentResult> {
  const teamId = readUuid(form, "team");
  const name = readName(form);
  if (!teamId || !name) return refuse("Type a team name.");
  const result = await runApi(tx, (t) => t`select api.rename_team(${teamId}, ${name})`);
  return result.ok ? done("Renamed.") : result;
}

async function deleteTeam(tx: Tx, _spaceId: string, form: FormData): Promise<IntentResult> {
  const teamId = readUuid(form, "team");
  if (!teamId) return refuse(RELOAD);
  const result = await runApi(tx, (t) => t`select api.delete_team(${teamId})`);
  return result.ok ? done("Team deleted.") : result;
}

async function setTeamMember(tx: Tx, _spaceId: string, form: FormData): Promise<IntentResult> {
  const teamId = readUuid(form, "team");
  const userId = readUuid(form, "user");
  const teamRole = readText(form, "role") || "member";
  if (!teamId || !userId) return refuse("Choose a person.");
  if (!TEAM_ROLES.has(teamRole)) return refuse("Choose lead or member.");
  const result = await runApi(tx, (t) => t`select api.set_team_member(${teamId}, ${userId}, ${teamRole})`);
  if (!result.ok) return result;
  return done(teamRole === "lead" ? "Now a lead of this team." : "Now a member of this team.");
}

async function removeTeamMember(tx: Tx, _spaceId: string, form: FormData): Promise<IntentResult> {
  const teamId = readUuid(form, "team");
  const userId = readUuid(form, "user");
  if (!teamId || !userId) return refuse(RELOAD);
  const result = await runApi(tx, (t) => t`select api.remove_team_member(${teamId}, ${userId})`);
  return result.ok ? done("Removed from the team.") : result;
}

// ----- projects -----

async function createProject(tx: Tx, spaceId: string, form: FormData): Promise<IntentResult> {
  const name = readName(form);
  const slug = readText(form, "slug");
  const teamId = readOptionalUuid(form, "team"); // null = no team; undefined = not a team id (a stale or edited form)
  if (!name) return refuse("Type a project name.");
  if (!isValidSlug(slug)) return refuse(SLUG_HINT);
  if (teamId === undefined) return refuse(RELOAD);
  const result = await runApi(tx, (t) => t`select api.create_project(${spaceId}, ${teamId}::uuid, ${name}, ${slug})`);
  if (!result.ok) return result;
  const [space] = await tx<{ slug: string }[]>`select slug from public.spaces where id = ${spaceId}`;
  return goTo(`/spaces/${space!.slug}/${slug}?saved=project`);
}
