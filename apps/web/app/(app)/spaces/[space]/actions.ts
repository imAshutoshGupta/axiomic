"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isValidSlug } from "@axiomic/shared";
import type { ActionState } from "../../../../components/app/action-form";
import { getVerifiedClaims } from "../../../../lib/auth";
import { pgCode, withUser, type Tx } from "../../../../lib/db";
import { runApi, type ApiResult } from "../../../../lib/manage";
import { siteUrl } from "../../../../lib/site-url";

/**
 * Space management (members, invites, teams, new projects). One action, many intents; each
 * intent is ONE api.* call and the database decides who may do it. Input is checked strictly
 * here only so a typo gets a clear message; the database checks it again.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES = new Set(["admin", "editor", "reader"]);
const TEAM_ROLES = new Set(["lead", "member"]);

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v.trim() : "";
};
const id = (f: FormData, k: string) => {
  const v = str(f, k);
  return UUID.test(v) ? v : null;
};
const name = (f: FormData, k = "name") => str(f, k).replace(/\s+/g, " ").slice(0, 100);

/** The invite link. The secret goes after "#": browsers never send that part to a server, so it stays out of logs. */
const inviteLink = (secret: string) => `${siteUrl().origin}/invite#${secret}`;

export async function manageSpace(_prev: ActionState, form: FormData): Promise<ActionState> {
  const claims = await getVerifiedClaims();
  if (!claims) return { error: "Your sign-in has expired. Sign in again." };
  const slug = str(form, "space");
  if (!isValidSlug(slug)) return { error: "Reload the page and try again." };
  const intent = str(form, "intent");
  if (form.has("confirm") || CONFIRM.has(intent)) {
    if (form.get("confirm") !== "on") return { error: "Tick the box to confirm." };
  }

  let after: string | null = null; // where to go when done (else: stay and refresh)
  let state: ActionState;
  try {
    state = await withUser(claims, async (tx) => {
      const [space] = await tx<{ id: string }[]>`select id from public.spaces where slug = ${slug}`;
      if (!space) return { error: "This space isn't there any more." };
      const r = await run(tx, space.id, intent, form);
      if (!r.ok) return { error: r.reason };
      if (r.value.redirect) after = r.value.redirect;
      return r.value.state;
    });
  } catch (e) {
    console.error(`space action ${intent} failed:`, pgCode(e) ?? (e instanceof Error ? e.name : "unknown"));
    return { error: "Something went wrong. Nothing was changed. Please try again." };
  }
  if (after) redirect(after);
  revalidatePath(`/spaces/${slug}`);
  return state;
}

/** Intents that remove or delete something: they need the confirm tickbox. */
const CONFIRM = new Set(["remove-member", "leave", "delete-team"]);

type Done = { state: ActionState; redirect?: string };

async function run(tx: Tx, spaceId: string, intent: string, f: FormData): Promise<ApiResult<Done>> {
  const ok = (message: string, extra: Partial<ActionState> = {}): ApiResult<Done> => ({ ok: true, value: { state: { message, ...extra } } });
  const bad = (reason: string): ApiResult<Done> => ({ ok: false, reason });

  switch (intent) {
    case "rename-space": {
      const n = name(f);
      if (!n) return bad("Type a name.");
      const r = await runApi(tx, (t) => t`select api.rename_space(${spaceId}, ${n})`);
      return r.ok ? ok("Renamed.") : r;
    }

    // ----- invites -----
    case "create-invite": {
      const email = str(f, "email").toLowerCase().slice(0, 320);
      const role = str(f, "role");
      const team = str(f, "team") ? id(f, "team") : null;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad("That doesn't look like an email address.");
      if (!ROLES.has(role)) return bad("Choose a role.");
      const r = await runApi(tx, (t) => t<{ r: { secret: string } }[]>`
        select api.create_invite(${spaceId}, ${email}, ${role}, ${team}::uuid) as r`);
      return r.ok ? ok(`Invite made for ${email}.`, { link: inviteLink(r.value[0]!.r.secret) }) : r;
    }
    case "resend-invite": {
      const i = id(f, "invite");
      if (!i) return bad("Reload the page and try again.");
      const r = await runApi(tx, (t) => t<{ r: { secret: string } }[]>`select api.resend_invite(${i}) as r`);
      return r.ok ? ok("New link made; the old one no longer works. It's valid for 7 more days.", { link: inviteLink(r.value[0]!.r.secret) }) : r;
    }
    case "revoke-invite": {
      const i = id(f, "invite");
      if (!i) return bad("Reload the page and try again.");
      const r = await runApi(tx, (t) => t`select api.revoke_invite(${i})`);
      return r.ok ? ok("Invite revoked: the link no longer works.") : r;
    }

    // ----- members -----
    case "set-role": {
      const u = id(f, "user");
      const role = str(f, "role");
      if (!u || !ROLES.has(role)) return bad("Choose a role.");
      const r = await runApi(tx, (t) => t<{ r: { teams_led?: string[]; projects_owned?: string[]; modules_owned?: string[] } }[]>`
        select api.set_role(${spaceId}, ${u}, ${role}) as r`);
      if (!r.ok) return r;
      // A reader can't edit any layer, even ones they still own: say which.
      const lost = r.value[0]!.r;
      const notes = [
        ...(lost.teams_led ?? []).map((x) => `Still lead of team ${x}, but can't edit its rules as a reader.`),
        ...(lost.projects_owned ?? []).map((x) => `Still owner of project ${x}: give it to an editor.`),
        ...(lost.modules_owned ?? []).map((x) => `Still owner of folder ${x}: give it to an editor.`),
      ];
      return ok(`Role changed to ${role}.`, notes.length ? { notes } : {});
    }
    case "remove-member": {
      const u = id(f, "user");
      if (!u) return bad("Reload the page and try again.");
      const r = await runApi(tx, (t) => t`select api.remove_member(${spaceId}, ${u})`);
      return r.ok ? ok("Removed. Their CLI loses access to this space's projects at its next pull, and their personal rules here are deleted.") : r;
    }
    case "leave": {
      const r = await runApi(tx, (t) => t`select api.leave_space(${spaceId})`);
      return r.ok ? { ok: true, value: { state: {}, redirect: "/spaces?left=1" } } : r;
    }

    // ----- teams -----
    case "create-team": {
      const n = name(f);
      const s = str(f, "slug");
      if (!n) return bad("Type a team name.");
      if (!isValidSlug(s)) return bad("The short name must be 2–31 lowercase letters, digits or dashes, starting with a letter or digit.");
      const r = await runApi(tx, (t) => t`select api.create_team(${spaceId}, ${n}, ${s})`);
      return r.ok ? ok(`Team ${n} created.`) : r;
    }
    case "rename-team": {
      const team = id(f, "team");
      const n = name(f);
      if (!team || !n) return bad("Type a team name.");
      const r = await runApi(tx, (t) => t`select api.rename_team(${team}, ${n})`);
      return r.ok ? ok("Renamed.") : r;
    }
    case "delete-team": {
      const team = id(f, "team");
      if (!team) return bad("Reload the page and try again.");
      const r = await runApi(tx, (t) => t`select api.delete_team(${team})`);
      return r.ok ? ok("Team deleted.") : r;
    }
    case "set-team-member": {
      const team = id(f, "team");
      const u = id(f, "user");
      const role = str(f, "role") || "member";
      if (!team || !u) return bad("Choose a person.");
      if (!TEAM_ROLES.has(role)) return bad("Choose lead or member.");
      const r = await runApi(tx, (t) => t`select api.set_team_member(${team}, ${u}, ${role})`);
      return r.ok ? ok(role === "lead" ? "Now a lead of this team." : "Now a member of this team.") : r;
    }
    case "remove-team-member": {
      const team = id(f, "team");
      const u = id(f, "user");
      if (!team || !u) return bad("Reload the page and try again.");
      const r = await runApi(tx, (t) => t`select api.remove_team_member(${team}, ${u})`);
      return r.ok ? ok("Removed from the team.") : r;
    }

    // ----- projects -----
    case "create-project": {
      const n = name(f);
      const s = str(f, "slug");
      const team = str(f, "team") ? id(f, "team") : null;
      if (!n) return bad("Type a project name.");
      if (!isValidSlug(s)) return bad("The short name must be 2–31 lowercase letters, digits or dashes, starting with a letter or digit.");
      const r = await runApi(tx, (t) => t`select api.create_project(${spaceId}, ${team}::uuid, ${n}, ${s})`);
      if (!r.ok) return r;
      const [sp] = await tx<{ slug: string }[]>`select slug from public.spaces where id = ${spaceId}`;
      return { ok: true, value: { state: {}, redirect: `/spaces/${sp!.slug}/${s}?saved=project` } };
    }

    default:
      return bad("Reload the page and try again.");
  }
}

/** /spaces/new: a new company space. You become its admin and the lead of its "General" team. */
export async function createSpace(_prev: ActionState, form: FormData): Promise<ActionState> {
  const claims = await getVerifiedClaims();
  if (!claims) return { error: "Your sign-in has expired. Sign in again." };
  const n = name(form);
  const s = str(form, "slug");
  if (!n) return { error: "Type a name for the company space." };
  if (!isValidSlug(s)) return { error: "The short name must be 2–31 lowercase letters, digits or dashes, starting with a letter or digit." };
  try {
    const r = await withUser(claims, (tx) => runApi(tx, (t) => t`select api.create_space(${n}, ${s})`));
    if (!r.ok) return { error: r.reason };
  } catch (e) {
    console.error("create space failed:", pgCode(e) ?? "unknown");
    return { error: "Something went wrong. Please try again." };
  }
  redirect(`/spaces/${s}?created=1`);
}
