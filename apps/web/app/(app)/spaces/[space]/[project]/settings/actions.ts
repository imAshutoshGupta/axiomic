"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isSafeFolderPath, isSafeModuleName, isValidSlug } from "@axiomic/shared";
import type { ActionState } from "../../../../../../components/app/action-form";
import { getVerifiedClaims } from "../../../../../../lib/auth";
import { pgCode, withUser } from "../../../../../../lib/db";
import { runApi, type ApiResult } from "../../../../../../lib/manage";

/**
 * Project settings: rename, archive, owner, delete, and folders (modules). One api.* call per
 * intent; the database decides who may (can_edit / owns_project_layer / is_admin). Folder names
 * and paths are checked with the same guards the CLI uses (isSafeModuleName, isSafeFolderPath),
 * and again by the database's own checks.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v.trim() : "";
};
const optId = (f: FormData, k: string): string | null | undefined => {
  const v = str(f, k);
  if (v === "") return null;
  return UUID.test(v) ? v : undefined; // undefined = bad input
};
const CONFIRM = new Set(["delete", "trash-module"]);

export async function manageProject(_prev: ActionState, form: FormData): Promise<ActionState> {
  const claims = await getVerifiedClaims();
  if (!claims) return { error: "Your sign-in has expired. Sign in again." };
  const space = str(form, "space");
  const project = str(form, "project");
  if (!isValidSlug(space) || !isValidSlug(project)) return { error: "Reload the page and try again." };
  const intent = str(form, "intent");
  if (CONFIRM.has(intent) && form.get("confirm") !== "on") return { error: "Tick the box to confirm." };

  let after: string | null = null;
  let result: ApiResult<string>;
  try {
    result = await withUser(claims, async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        select p.id from public.projects p join public.spaces s on s.id = p.space_id
        where s.slug = ${space} and p.slug = ${project}`;
      if (!row) return { ok: false, reason: "This project isn't there any more." };
      const pid = row.id;
      switch (intent) {
        case "rename": {
          const name = str(form, "name").replace(/\s+/g, " ").slice(0, 100);
          if (!name) return { ok: false, reason: "Type a name." };
          const r = await runApi(tx, (t) => t`select api.rename_project(${pid}, ${name})`);
          return r.ok ? { ok: true, value: "Renamed." } : r;
        }
        case "archive":
        case "unarchive": {
          const r = await runApi(tx, (t) => t`select api.set_project_archived(${pid}, ${intent === "archive"})`);
          return r.ok
            ? { ok: true, value: intent === "archive" ? "Archived: laptops stop getting updates for this project." : "Back in use." }
            : r;
        }
        case "transfer": {
          const user = optId(form, "user");
          if (!user) return { ok: false, reason: "Choose the new owner." };
          const r = await runApi(tx, (t) => t`select api.transfer_project_owner(${pid}, ${user})`);
          return r.ok ? { ok: true, value: "Owner changed." } : r;
        }
        case "delete": {
          const r = await runApi(tx, (t) => t`select api.delete_project(${pid})`);
          if (r.ok) after = `/spaces/${space}`;
          return r.ok ? { ok: true, value: "" } : r;
        }
        case "create-module":
        case "edit-module": {
          const name = str(form, "name");
          const path = str(form, "path").replace(/^\.\//, "").replace(/\/+$/, "");
          const owner = optId(form, "owner");
          if (!isSafeModuleName(name)) return { ok: false, reason: "Folder name: lowercase letters, digits and single dashes, like payments or user-api (at most 64)." };
          if (!isSafeFolderPath(path)) return { ok: false, reason: "Folder path: a path inside the repo like src/payments (no leading /, no .., not .git)." };
          if (owner === undefined) return { ok: false, reason: "Choose an owner." };
          if (intent === "create-module") {
            const r = await runApi(tx, (t) => t`select api.create_module(${pid}, ${name}, ${path}, ${owner}::uuid)`);
            return r.ok ? { ok: true, value: `Folder ${path}/ added. Its rules go into their own file, loaded only while working there.` } : r;
          }
          const mid = optId(form, "module");
          if (!mid) return { ok: false, reason: "Reload the page and try again." };
          const r = await runApi(tx, (t) => t`select api.edit_module(${mid}, ${name}, ${path}, ${owner}::uuid)`);
          return r.ok ? { ok: true, value: "Folder saved. Laptops move its rule file at their next AI session." } : r;
        }
        case "trash-module": {
          const mid = optId(form, "module");
          if (!mid) return { ok: false, reason: "Reload the page and try again." };
          const r = await runApi(tx, (t) => t`select api.trash_module(${mid})`);
          return r.ok ? { ok: true, value: "Folder and its rules moved to the trash (kept 30 days)." } : r;
        }
        default:
          return { ok: false, reason: "Reload the page and try again." };
      }
    });
  } catch (e) {
    console.error(`project action ${intent} failed:`, pgCode(e) ?? (e instanceof Error ? e.name : "unknown"));
    return { error: "Something went wrong. Nothing was changed. Please try again." };
  }
  if (after) redirect(after);
  revalidatePath(`/spaces/${space}/${project}`, "layout");
  return result.ok ? { message: result.value } : { error: result.reason };
}
