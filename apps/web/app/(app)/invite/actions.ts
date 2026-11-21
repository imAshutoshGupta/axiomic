"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientIpFromHeaders } from "../../../lib/api";
import { getVerifiedClaims } from "../../../lib/auth";
import { pgCode, withUser } from "../../../lib/db";
import { runApi } from "../../../lib/manage";

export type AcceptState = { error?: string };

/** The invite secret: 32 random bytes, URL-safe base64 without padding (private.new_secret). */
const SECRET = /^[A-Za-z0-9_-]{43}$/;

/**
 * Join a space with an invite link (api.accept_invite). The database checks that the invite is
 * open and that its email is one of YOUR verified sign-in emails. Tries are rate limited per
 * network address, in their own transaction first, so failed guesses still count (#37).
 */
export async function acceptInvite(_prev: AcceptState, form: FormData): Promise<AcceptState> {
  const claims = await getVerifiedClaims();
  if (!claims) return { error: "Sign in first, then open the invite link again." };
  const secret = form.get("secret");
  if (typeof secret !== "string" || !SECRET.test(secret)) return { error: "This invite link is incomplete. Copy the whole link and try again." };

  let slug: string;
  try {
    const ip = clientIpFromHeaders(await headers());
    await withUser(claims, (tx) => tx`select api.rate_limit('invite_accept', ${ip})`);
    const r = await withUser(claims, async (tx) => {
      const a = await runApi(tx, (t) => t<{ space_id: string }[]>`select api.accept_invite(${secret}) as space_id`);
      if (!a.ok) return a;
      const [s] = await tx<{ slug: string }[]>`select slug from public.spaces where id = ${a.value[0]!.space_id}`;
      return { ok: true as const, value: s!.slug };
    });
    if (!r.ok) return { error: r.reason };
    slug = r.value;
  } catch (e) {
    if (pgCode(e) === "AX429") return { error: "Too many tries from this network. Wait 10 minutes and try again." };
    console.error("accept invite failed:", pgCode(e) ?? "unknown");
    return { error: "Something went wrong. Please try again." };
  }
  redirect(`/spaces/${slug}?joined=1`);
}
