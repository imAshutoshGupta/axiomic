/**
 * Safety checks for module names and folder paths.
 * The website runs them when a module is saved, and the CLI runs them again before writing any file.
 */

/**
 * A module name becomes part of a file name: "payments" becomes axiomic-payments.md.
 * Only lowercase letters, digits and single dashes, e.g. "user-auth". Max 64 characters.
 */
export function isSafeModuleName(name: string): boolean {
  return name.length <= 64 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name);
}

/**
 * A module's folder, from the repo root, e.g. "src/payments".
 * It must stay inside the project and must not touch .git.
 */
export function isSafeFolderPath(path: string): boolean {
  if (path.length === 0 || path.length > 255) return false;

  // Only plain characters: letters, digits, dot, dash, underscore and forward slash.
  // This blocks backslashes (Windows paths), colons (C:), quotes, spaces, line breaks and glob symbols like * ? [ ] { }.
  if (!/^[A-Za-z0-9._/-]+$/.test(path)) return false;

  return path.split("/").every(
    (part) =>
      part !== "" && // no leading "/", trailing "/" or "//"
      part !== "." &&
      part !== ".." && // never climb out of the project
      part.toLowerCase() !== ".git" && // never touch Git's own folder (any capitalisation)
      !part.endsWith("."), // Windows silently drops trailing dots, so "x." could turn into "x"
  );
}
