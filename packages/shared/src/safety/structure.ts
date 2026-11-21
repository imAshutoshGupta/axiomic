/**
 * Check: Markdown/HTML structure that would swallow the rules after it.
 *
 * A code fence (``` or ~~~) or an HTML comment (<!-- ... -->) that is never closed would, in the combined file,
 * keep going through every rule rendered after it: the AI would read those rules as code, or never see them at all
 * (Markdown viewers hide comments). render-claude.ts repairs this when it writes the file (see closeOpenBlocks),
 * so nothing is lost; this check only tells the author at publish time, as a "warn", so they can fix the source.
 */
import type { Finding } from "./core";
import { findOpenBlocks } from "../render-claude";

export function checkStructure(field: "title" | "body", text: string): Finding[] {
  const open = findOpenBlocks(text);
  const findings: Finding[] = [];
  if (open.fence) {
    findings.push({
      code: "structure.unclosed-block",
      severity: "warn",
      field,
      line: open.fence.line,
      message: `A code block opened with ${open.fence.marker} is never closed. axiomic will close it in the file, but add the closing ${open.fence.marker[0]!.repeat(3)} yourself.`,
    });
  }
  if (open.comment) {
    findings.push({
      code: "structure.unclosed-block",
      severity: "warn",
      field,
      line: open.comment.line,
      message: 'An HTML comment opened with "<!--" is never closed with "-->". axiomic will show it as plain text in the file, but fix it in the source.',
    });
  }
  return findings;
}
