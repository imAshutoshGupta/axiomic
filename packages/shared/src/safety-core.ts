/**
 * Shared pieces of the publish-time safety check: the "finding" type every check returns,
 * and small helpers they all use. The big picture lives in safety.ts.
 */

/** "block": the rule can't be published until it's fixed. "warn": shown to the author, but publishing is allowed. */
export type Severity = "block" | "warn";

/** Which part of a rule a finding is about. "file" is the combined file built from many rules. */
export type FindingField = "title" | "body" | "file";

/**
 * Stable, machine-readable names for every kind of finding.
 * The website and CLI can rely on these (e.g. to show help text), so never rename one; add new ones instead.
 */
export type FindingCode =
  // Secrets (safety-secrets.ts)
  | "secret.private-key"
  | "secret.private-key-header"
  | "secret.aws-access-key"
  | "secret.aws-secret-key"
  | "secret.github-token"
  | "secret.gitlab-token"
  | "secret.anthropic-key"
  | "secret.openai-key"
  | "secret.stripe-key"
  | "secret.stripe-test-key"
  | "secret.slack-token"
  | "secret.slack-webhook"
  | "secret.google-api-key"
  | "secret.npm-token"
  | "secret.sendgrid-key"
  | "secret.jwt"
  | "secret.bearer-token"
  | "secret.connection-string"
  | "secret.connection-string-local"
  | "secret.assignment"
  | "secret.huggingface-token"
  | "secret.digitalocean-token"
  | "secret.twilio-key"
  | "secret.twilio-account-sid"
  | "secret.azure-storage-key"
  | "secret.basic-auth"
  // Size (safety-size.ts)
  | "size.title-empty"
  | "size.title-long"
  | "size.title-too-long"
  | "size.body-long"
  | "size.body-too-long"
  | "size.file-lines"
  | "size.file-tokens"
  | "size.file-too-large"
  // Hidden characters (safety-hidden.ts)
  | "hidden.control"
  | "hidden.bidi-control"
  | "hidden.direction-mark"
  | "hidden.tag"
  | "hidden.variation-selector"
  | "hidden.invisible"
  | "hidden.line-separator"
  | "hidden.bom"
  | "hidden.soft-hyphen"
  // Imitating axiomic's own labels (safety-labels.ts)
  | "label.mandatory"
  | "label.mandatory-text"
  | "label.managed-marker"
  | "label.axiomic-heading"
  | "label.hierarchy-note"
  // Prompt-injection heuristics (safety-injection.ts)
  | "injection.ignore-instructions"
  | "injection.role-change"
  | "injection.fake-role-tag"
  | "injection.hide-from-user"
  | "injection.exfiltration"
  | "injection.covert-exfiltration"
  // Broken Markdown/HTML structure that would swallow the rules after it (safety-structure.ts)
  | "structure.unclosed-block"
  // The rule isn't a { title: string, body: string } at all, e.g. JSON with a missing field (safety.ts)
  | "input.invalid";

/** One problem found in a rule. */
export interface Finding {
  code: FindingCode;
  severity: Severity;
  /** Plain-English explanation for the author. Never contains a secret. */
  message: string;
  field: FindingField;
  /** Where it starts, counted in JavaScript string positions (UTF-16 units) from the start of the field. */
  offset?: number;
  /** How many UTF-16 units it covers. */
  length?: number;
  /** 1-based line and column of `offset`, for showing in an editor. */
  line?: number;
  column?: number;
  /** For secrets: a shortened, harmless preview such as "ghp_…". Never the whole secret. */
  preview?: string;
  /** For hidden characters: the first one's code point, e.g. "U+200B". */
  codePoint?: string;
  /** For hidden characters: how many in a row. */
  count?: number;
  /** Set by checkRules: which rule in the list this finding belongs to (0-based). */
  ruleIndex?: number;
}

/**
 * What the checks need from a rule: just its title and text.
 * Rule, LockableRule and MergedRule from rules.ts all fit, but so does an unsaved draft with no id yet.
 */
export interface RuleInput {
  title: string;
  body: string;
}

/** The three kinds of line break. Every check splits lines with this, so "\r"-only text can't hide a line from one of them. */
export const LINE_BREAK = /\r\n|\r|\n/;

/**
 * Runtime guard for rules that came from JSON (an API request, a file) where TypeScript can't help:
 * a real object whose title and body are both strings. The checks assume this, so they test it first.
 */
export function isRuleInput(value: unknown): value is RuleInput {
  if (typeof value !== "object" || value === null) return false;
  const rule = value as Record<string, unknown>;
  return typeof rule.title === "string" && typeof rule.body === "string";
}

/** The single "block" finding returned instead of throwing when the input isn't a usable rule. */
export function invalidInputFinding(what: string): Finding {
  return {
    code: "input.invalid",
    severity: "block",
    field: "file",
    message: `${what} Nothing was checked; fix the input and try again.`,
  };
}

/**
 * Turns a string position into a line and column, e.g. for "line 3, column 7" in the editor.
 * Built once per text, so looking up many positions stays fast.
 */
export function makeLocator(text: string): (offset: number) => { line: number; column: number } {
  // Where each line starts. Line 1 starts at 0; "\n", "\r\n" and a lone "\r" (old Mac files) each start a new one.
  // This must agree with how the checks split lines, so a finding's line number matches what an editor shows.
  const starts = [0];
  for (const m of text.matchAll(/\r\n|\r|\n/g)) starts.push(m.index + m[0].length);

  return (offset) => {
    // Binary search: find the last line that starts at or before `offset`.
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid]! <= offset) low = mid;
      else high = mid - 1;
    }
    return { line: low + 1, column: offset - starts[low]! + 1 };
  };
}

/**
 * A safe preview of a secret: at most its first 4 characters, and never more than a quarter of it.
 * "ghp_aB3d…" style previews help the author find the secret without the finding becoming a leak itself.
 */
export function redact(secret: string): string {
  const shown = Math.min(4, Math.floor(secret.length / 4));
  return secret.slice(0, shown) + "…";
}

/** "U+200B" style name for a code point. */
export function formatCodePoint(codePoint: number): string {
  return "U+" + codePoint.toString(16).toUpperCase().padStart(4, "0");
}
