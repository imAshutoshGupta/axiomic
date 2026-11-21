/**
 * Reading untrusted input: ids from URLs and request bodies, and fields from a submitted <form>.
 *
 * Every reader returns a safe empty value instead of throwing, so an action can answer
 * "Reload the page and try again." These checks only give a clear message for a typo;
 * the database checks everything again.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Longest name (space, team, project, token) we keep from a form; the rest is cut off. */
export const MAX_NAME_CHARS = 100;

/** The message for a short name ("slug") that fails isValidSlug(). */
export const SLUG_HINT = "The short name must be 2–31 lowercase letters, digits or dashes, starting with a letter or digit.";

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** A form field exactly as typed, or "" when it is missing or a file. */
export function readRawText(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

/** A form field without spaces at either end, or "". */
export function readText(form: FormData, key: string): string {
  return readRawText(form, key).trim();
}

/** A name: runs of whitespace become one space, at most MAX_NAME_CHARS long. */
export function readName(form: FormData, key = "name"): string {
  return readText(form, key).replace(/\s+/g, " ").slice(0, MAX_NAME_CHARS);
}

/** A required id: the uuid, or null when it is missing or malformed. */
export function readUuid(form: FormData, key: string): string | null {
  const value = readText(form, key);
  return isUuid(value) ? value : null;
}

/**
 * An optional id, with three answers:
 * - null: the field was left empty (e.g. "no team");
 * - undefined: something was typed but it is not an id (bad input);
 * - the uuid.
 */
export function readOptionalUuid(form: FormData, key: string): string | null | undefined {
  const value = readText(form, key);
  if (value === "") return null;
  return isUuid(value) ? value : undefined;
}
