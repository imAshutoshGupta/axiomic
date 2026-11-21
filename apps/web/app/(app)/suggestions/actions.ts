"use server";

import { redirect } from "next/navigation";
import { getVerifiedClaims } from "../../../lib/auth";
import { pgCode, withUser } from "../../../lib/db";
import { assertWritesAllowed, keyring } from "../../../lib/rule-keys";
import { decideSuggestion, withdrawSuggestion } from "../../../lib/suggestions";

/**
 * Server actions for /suggestions. Each re-checks the session; the database decides who may
 * approve (can_edit_layer) or withdraw (the author). A refusal comes back to the form as state
 * (never through the URL: the page only shows fixed sentences for ?done= codes).
 */

export type DecideState = { error?: string; findings?: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function decide(_prev: DecideState, form: FormData): Promise<DecideState> {
  const claims = await getVerifiedClaims();
  if (!claims) return { error: "Your sign-in has expired. Sign in again." };
  const id = form.get("id");
  const intent = form.get("intent");
  const note = form.get("note");
  if (typeof id !== "string" || !UUID.test(id) || (intent !== "approve" && intent !== "reject")) {
    return { error: "Reload the page and try again." };
  }

  try {
    if (intent === "approve") await assertWritesAllowed();
  } catch {
    return { error: "Saving is paused on the server right now. Try again later." };
  }
  try {
    const res = await withUser(claims, (tx) => decideSuggestion(tx, keyring(), id, intent, typeof note === "string" ? note : ""));
    if (!res.ok) return { error: res.reason, findings: res.findings };
  } catch (e) {
    console.error("suggestion decide failed:", pgCode(e) ?? (e instanceof Error ? e.name : "unknown"));
    return { error: "Something went wrong. Nothing was changed. Please try again." };
  }
  redirect(`/suggestions?done=${intent === "approve" ? "approved" : "rejected"}`);
}

export async function withdraw(_prev: DecideState, form: FormData): Promise<DecideState> {
  const claims = await getVerifiedClaims();
  if (!claims) return { error: "Your sign-in has expired. Sign in again." };
  const id = form.get("id");
  if (typeof id !== "string" || !UUID.test(id)) return { error: "Reload the page and try again." };

  try {
    const res = await withUser(claims, (tx) => withdrawSuggestion(tx, id));
    if (!res.ok) return { error: res.reason };
  } catch (e) {
    console.error("suggestion withdraw failed:", pgCode(e) ?? "unknown");
    return { error: "Something went wrong. Please try again." };
  }
  redirect("/suggestions?done=withdrawn");
}
