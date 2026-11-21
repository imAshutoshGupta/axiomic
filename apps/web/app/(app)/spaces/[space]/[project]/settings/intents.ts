/**
 * What each button on the project settings page does: rename, archive, owner, delete, folders.
 *
 * One small function per intent; each makes ONE api.* call and the database decides who may
 * (can_edit / owns_project_layer / is_admin). Folder names and paths are checked with the same
 * guards the CLI uses (isSafeModuleName, isSafeFolderPath), and again by the database.
 * A plain module, NOT a "use server" file: actions.ts checks the session before calling in.
 */
import { isSafeFolderPath, isSafeModuleName } from "@axiomic/shared";
import type { Tx } from "@/lib/db";
import { readName, readOptionalUuid, readText } from "@/lib/input";
import { runApi, type ApiResult } from "@/lib/spaces/manage";

/** What a finished intent answers: a message to show, or a page to go to. */
export type ProjectIntentDone = { message: string; redirect?: string };
type IntentResult = ApiResult<ProjectIntentDone>;
type IntentHandler = (tx: Tx, projectId: string, form: FormData, place: ProjectPlace) => Promise<IntentResult>;

/** Which project, by the slugs in its URL. */
export type ProjectPlace = { space: string; project: string };

const RELOAD = "Reload the page and try again.";

const HANDLERS: Record<string, IntentHandler> = {
  rename: renameProject,
  archive: (tx, projectId) => setArchived(tx, projectId, true),
  unarchive: (tx, projectId) => setArchived(tx, projectId, false),
  transfer: transferOwner,
  delete: deleteProject,
  "create-module": createFolder,
  "edit-module": editFolder,
  "trash-module": trashFolder,
};

/** Finds the project by its slugs and runs one intent on it. */
export async function runProjectIntent(tx: Tx, place: ProjectPlace, intent: string, form: FormData): Promise<IntentResult> {
  const [project] = await tx<{ id: string }[]>`
    select p.id from public.projects p join public.spaces s on s.id = p.space_id
    where s.slug = ${place.space} and p.slug = ${place.project}`;
  if (!project) return refuse("This project isn't there any more.");
  const handler = Object.hasOwn(HANDLERS, intent) ? HANDLERS[intent] : undefined;
  if (!handler) return refuse(RELOAD);
  return handler(tx, project.id, form, place);
}

function done(message: string): IntentResult {
  return { ok: true, value: { message } };
}

function refuse(reason: string): IntentResult {
  return { ok: false, reason };
}

// ----- the project -----

async function renameProject(tx: Tx, projectId: string, form: FormData): Promise<IntentResult> {
  const name = readName(form);
  if (!name) return refuse("Type a name.");
  const result = await runApi(tx, (t) => t`select api.rename_project(${projectId}, ${name})`);
  return result.ok ? done("Renamed.") : result;
}

async function setArchived(tx: Tx, projectId: string, archived: boolean): Promise<IntentResult> {
  const result = await runApi(tx, (t) => t`select api.set_project_archived(${projectId}, ${archived})`);
  if (!result.ok) return result;
  return done(archived ? "Archived: laptops stop getting updates for this project." : "Back in use.");
}

async function transferOwner(tx: Tx, projectId: string, form: FormData): Promise<IntentResult> {
  const newOwnerId = readOptionalUuid(form, "user");
  if (!newOwnerId) return refuse("Choose the new owner.");
  const result = await runApi(tx, (t) => t`select api.transfer_project_owner(${projectId}, ${newOwnerId})`);
  return result.ok ? done("Owner changed.") : result;
}

async function deleteProject(tx: Tx, projectId: string, _form: FormData, place: ProjectPlace): Promise<IntentResult> {
  const result = await runApi(tx, (t) => t`select api.delete_project(${projectId})`);
  if (!result.ok) return result;
  return { ok: true, value: { message: "", redirect: `/spaces/${place.space}` } };
}

// ----- folders (modules) -----

/** The fields shared by the "add folder" and "edit folder" forms. */
type FolderFields = { name: string; path: string; ownerId: string | null };

/** Reads and checks the folder form; returns the reason when something is wrong. */
function readFolderFields(form: FormData): FolderFields | { reason: string } {
  const name = readText(form, "name");
  // "./src/payments/" and "src/payments" mean the same folder.
  const path = readText(form, "path").replace(/^\.\//, "").replace(/\/+$/, "");
  const ownerId = readOptionalUuid(form, "owner");
  if (!isSafeModuleName(name)) {
    return { reason: "Folder name: lowercase letters, digits and single dashes, like payments or user-api (at most 64)." };
  }
  if (!isSafeFolderPath(path)) {
    return { reason: "Folder path: a path inside the repo like src/payments (no leading /, no .., not .git)." };
  }
  if (ownerId === undefined) return { reason: "Choose an owner." };
  return { name, path, ownerId };
}

async function createFolder(tx: Tx, projectId: string, form: FormData): Promise<IntentResult> {
  const fields = readFolderFields(form);
  if ("reason" in fields) return refuse(fields.reason);
  const { name, path, ownerId } = fields;
  const result = await runApi(tx, (t) => t`select api.create_module(${projectId}, ${name}, ${path}, ${ownerId}::uuid)`);
  if (!result.ok) return result;
  return done(`Folder ${path}/ added. Its rules go into their own file, loaded only while working there.`);
}

async function editFolder(tx: Tx, _projectId: string, form: FormData): Promise<IntentResult> {
  const fields = readFolderFields(form);
  if ("reason" in fields) return refuse(fields.reason);
  const folderId = readOptionalUuid(form, "module");
  if (!folderId) return refuse(RELOAD);
  const { name, path, ownerId } = fields;
  const result = await runApi(tx, (t) => t`select api.edit_module(${folderId}, ${name}, ${path}, ${ownerId}::uuid)`);
  return result.ok ? done("Folder saved. Laptops move its rule file at their next AI session.") : result;
}

async function trashFolder(tx: Tx, _projectId: string, form: FormData): Promise<IntentResult> {
  const folderId = readOptionalUuid(form, "module");
  if (!folderId) return refuse(RELOAD);
  const result = await runApi(tx, (t) => t`select api.trash_module(${folderId})`);
  return result.ok ? done("Folder and its rules moved to the trash (kept 30 days).") : result;
}
