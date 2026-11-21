"use server";

/**
 * The server action for the project settings page. It checks the session first; the work for
 * each button lives in ./intents.ts, and the database decides who may do what.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isValidSlug } from "@axiomic/shared";
import type { ActionState } from "@/components/app/action-form";
import { getVerifiedClaims } from "@/lib/auth/session";
import { pgCode, withUser } from "@/lib/db";
import { readText } from "@/lib/input";
import type { ApiResult } from "@/lib/spaces/manage";
import { runProjectIntent, type ProjectIntentDone } from "./intents";

/** Intents that delete something: they need the confirm tickbox. */
const CONFIRM_INTENTS = new Set(["delete", "trash-module"]);

export async function manageProject(_prev: ActionState, form: FormData): Promise<ActionState> {
  const claims = await getVerifiedClaims();
  if (!claims) return { error: "Your sign-in has expired. Sign in again." };
  const space = readText(form, "space");
  const project = readText(form, "project");
  if (!isValidSlug(space) || !isValidSlug(project)) return { error: "Reload the page and try again." };
  const intent = readText(form, "intent");
  if (CONFIRM_INTENTS.has(intent) && form.get("confirm") !== "on") return { error: "Tick the box to confirm." };

  let result: ApiResult<ProjectIntentDone>;
  try {
    result = await withUser(claims, (tx) => runProjectIntent(tx, { space, project }, intent, form));
  } catch (error) {
    console.error(`project action ${intent} failed:`, pgCode(error) ?? (error instanceof Error ? error.name : "unknown"));
    return { error: "Something went wrong. Nothing was changed. Please try again." };
  }
  // Outside the try: redirect() works by throwing.
  if (result.ok && result.value.redirect) redirect(result.value.redirect);
  revalidatePath(`/spaces/${space}/${project}`, "layout");
  return result.ok ? { message: result.value.message } : { error: result.reason };
}
