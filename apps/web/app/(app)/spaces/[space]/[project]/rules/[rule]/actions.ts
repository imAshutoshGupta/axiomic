"use server";

/**
 * Server actions for the rule editor. Next.js only accepts them from our own origin; each one
 * re-checks the session. The hidden form fields only say WHICH rule or layer: who may change
 * it is decided by the database (can_edit_layer) inside api.save_rule / api.trash_rule.
 */
import { redirect } from "next/navigation";
import { isValidSlug, LAYERS, type Layer } from "@axiomic/shared";
import { getVerifiedClaims } from "@/lib/auth/session";
import { pgCode, withUser } from "@/lib/db";
import { saveFromEditor, trashFromEditor } from "@/lib/rules/editor";
import { isUuid, readRawText } from "@/lib/input";
import { assertWritesAllowed, keyring } from "@/lib/rules/rule-keys";

export type EditorState = {
  error?: string;
  findings?: string[];
  /** Warnings from the safety check: shown once, then the author can save anyway. */
  warnings?: string[];
};

/** A first, cheap size cut before the safety check (which allows 64 KiB of rule text). */
const MAX_FORM_BODY_CHARS = 70_000;
const MAX_FORM_TITLE_CHARS = 500;

export async function saveRule(_prev: EditorState, form: FormData): Promise<EditorState> {
  const claims = await getVerifiedClaims();
  if (!claims) return { error: "Your sign-in has expired. Sign in again (copy your text first)." };

  const space = readRawText(form, "space");
  const project = readRawText(form, "project");
  if (!isValidSlug(space) || !isValidSlug(project)) return { error: "Reload the page and try again." };
  const ruleId = readRawText(form, "ruleId");
  const baseVersion = Number(readRawText(form, "baseVersion"));
  const layer = readRawText(form, "layer");
  const moduleId = readRawText(form, "moduleId");
  if (ruleId && (!isUuid(ruleId) || !Number.isSafeInteger(baseVersion) || baseVersion < 1)) return { error: "Reload the page and try again." };
  if (!ruleId && !(LAYERS as readonly string[]).includes(layer)) return { error: "Choose a layer." };
  if (layer === "module" && !isUuid(moduleId)) return { error: "Choose a folder." };
  const body = readRawText(form, "body").replace(/\r\n?/g, "\n");
  if (body.length > MAX_FORM_BODY_CHARS) return { error: "That text is too long (a rule can be at most 64 KiB)." };

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
        title: readRawText(form, "title").slice(0, MAX_FORM_TITLE_CHARS),
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
  const space = readRawText(form, "space");
  const project = readRawText(form, "project");
  const ruleId = readRawText(form, "ruleId");
  if (!isValidSlug(space) || !isValidSlug(project) || !isUuid(ruleId)) return { error: "Reload the page and try again." };
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
