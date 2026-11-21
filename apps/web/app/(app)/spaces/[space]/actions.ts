"use server";

/**
 * Server actions for the space page and /spaces/new. Each one checks the session first;
 * the work for each button lives in ./intents.ts. The database decides who may do what.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isValidSlug } from "@axiomic/shared";
import type { ActionState } from "@/components/app/action-form";
import { getVerifiedClaims } from "@/lib/auth/session";
import { pgCode, withUser } from "@/lib/db";
import { readName, readText, SLUG_HINT } from "@/lib/input";
import { runApi, type ApiResult } from "@/lib/spaces/manage";
import { runSpaceIntent, type IntentDone } from "./intents";

/** Intents that remove or delete something: they need the confirm tickbox. */
const CONFIRM_INTENTS = new Set(["remove-member", "leave", "delete-team"]);

export async function manageSpace(_prev: ActionState, form: FormData): Promise<ActionState> {
  const claims = await getVerifiedClaims();
  if (!claims) return { error: "Your sign-in has expired. Sign in again." };
  const slug = readText(form, "space");
  if (!isValidSlug(slug)) return { error: "Reload the page and try again." };
  const intent = readText(form, "intent");
  const needsConfirm = form.has("confirm") || CONFIRM_INTENTS.has(intent);
  if (needsConfirm && form.get("confirm") !== "on") return { error: "Tick the box to confirm." };

  let result: ApiResult<IntentDone>;
  try {
    result = await withUser(claims, (tx) => runSpaceIntent(tx, slug, intent, form));
  } catch (error) {
    console.error(`space action ${intent} failed:`, pgCode(error) ?? (error instanceof Error ? error.name : "unknown"));
    return { error: "Something went wrong. Nothing was changed. Please try again." };
  }
  // Outside the try: redirect() works by throwing.
  if (result.ok && result.value.redirect) redirect(result.value.redirect);
  revalidatePath(`/spaces/${slug}`);
  return result.ok ? result.value.state : { error: result.reason };
}

/** /spaces/new: a new company space. You become its admin and the lead of its "General" team. */
export async function createSpace(_prev: ActionState, form: FormData): Promise<ActionState> {
  const claims = await getVerifiedClaims();
  if (!claims) return { error: "Your sign-in has expired. Sign in again." };
  const name = readName(form);
  const slug = readText(form, "slug");
  if (!name) return { error: "Type a name for the company space." };
  if (!isValidSlug(slug)) return { error: SLUG_HINT };
  try {
    const result = await withUser(claims, (tx) => runApi(tx, (t) => t`select api.create_space(${name}, ${slug})`));
    if (!result.ok) return { error: result.reason };
  } catch (error) {
    console.error("create space failed:", pgCode(error) ?? "unknown");
    return { error: "Something went wrong. Please try again." };
  }
  redirect(`/spaces/${slug}?created=1`);
}
