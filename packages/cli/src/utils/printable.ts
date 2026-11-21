/**
 * Text from outside (the server, a file) that gets PRINTED: control characters and bidi overrides
 * removed, so it can't send escape codes to your terminal or hide or reverse text.
 */
export function printable(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, "");
}
