"use server";

import { redirect } from "next/navigation";
import { isValidSlug, LAYERS, type Layer } from "@axiomic/shared";
import { getVerifiedClaims } from "../../../../../../../lib/auth";
import { pgCode, withUser } from "../../../../../../../lib/db";
import { saveFromEditor, trashFromEditor } from "../../../../../../../lib/editor";
import { assertWritesAllowed, keyring } from "../../../../../../../lib/rule-keys";

/**
 * Server actions for the rule editor. Next.js only accepts them from our own origin; each one
 * re-checks the session. The hidden form fields only say WHICH rule or layer: who may change
 * it is decided by the database (can_edit_layer) inside api.save_rule / api.trash_rule.
 */

export type EditorState = {
  error?: string;
  findings?: string[];
  /** Warnings from the safety check: shown once, then the author can save anyway. */
  warnings?: string[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v : "";
};

export async function saveRule(_prev: EditorState, form: FormData): Promise<EditorState> {
  const claims = await getVerifiedClaims();
  if (!claims) return { error: "Your sign-in has expired. Sign in again (copy your text first)." };

  const space = str(form, "space");
  const project = str(form, "project");
  if (!isValidSlug(space) || !isValidSlug(project)) return { error: "Reload the page and try again." };
  const ruleId = str(form, "ruleId");
  const baseVersion = Number(str(form, "baseVersion"));
  const layer = str(form, "layer");
  const moduleId = str(form, "moduleId");
  if (ruleId && (!UUID.test(ruleId) || !Number.isSafeInteger(baseVersion) || baseVersion < 1)) return { error: "Reload the page and try again." };
  if (!ruleId && !(LAYERS as readonly string[]).includes(layer)) return { error: "Choose a layer." };
  if (layer === "module" && !UUID.test(moduleId)) return { error: "Choose a folder." };
  const body = str(form, "body").replace(/\r\n?/g, "\n");
  if (body.length > 70_000) return { error: "That text is too long (a rule can be at most 64 KiB)." };

  try {
    await assertWritesAllowed();
  } catch {
    return { error: "Saving is paused on the server right now. Try again later." };
  }

  let outcome: "rule" | "suggestion";
  try {
    const res = await withUser(claims, (tx) =>
      saveFromEditor(tx, keyring(), {
        ref: { space, project },
        ...(ruleId ? { ruleId, baseVersion } : { layer: layer as Layer, ...(layer === "module" ? { moduleId } : {}) }),
        title: str(form, "title").slice(0, 500),
        body,
        ...(form.has("lockedField") ? { locked: form.get("locked") === "on" } : {}),
        ackWarnings: form.get("ack") === "1",
      }),
    );
    if (res.status === "warnings") return { warnings: res.warnings };
    if (res.status === "refused") return { error: res.reason, findings: res.findings };
    if (res.status === "conflict") return { error: res.reason };
    outcome = res.status === "saved" ? "rule" : "suggestion";
  } catch (e) {
    console.error("rule save failed:", pgCode(e) ?? (e instanceof Error ? e.name : "unknown"));
    return { error: "Something went wrong. Nothing was saved. Please try again." };
  }
  // Outside the try: redirect() works by throwing.
  redirect(`/spaces/${space}/${project}?saved=${outcome}`);
}

export async function deleteRule(_prev: EditorState, form: FormData): Promise<EditorState> {
  const claims = await getVerifiedClaims();
  if (!claims) return { error: "Your sign-in has expired. Sign in again." };
  const space = str(form, "space");
  const project = str(form, "project");
  const ruleId = str(form, "ruleId");
  if (!isValidSlug(space) || !isValidSlug(project) || !UUID.test(ruleId)) return { error: "Reload the page and try again." };
  if (form.get("confirm") !== "on") return { error: "Tick the box to confirm." };

  try {
    const res = await withUser(claims, (tx) => trashFromEditor(tx, ruleId));
    if (!res.ok) return { error: res.reason };
  } catch (e) {
    console.error("rule delete failed:", pgCode(e) ?? "unknown");
    return { error: "Something went wrong. Nothing was deleted. Please try again." };
  }
  redirect(`/spaces/${space}/${project}?saved=deleted`);
}
