/**
 * Check: size limits, for one rule and for the combined file.
 *
 * Why it matters: every rule costs context in every AI session, and Claude Code itself has limits.
 * Known Claude Code facts (see docs/TOOLS.md):
 * - it aims for rule files under about 200 lines;
 * - it truncates path-scoped (folder) rule files over 40,000 characters, so rules at the end would silently vanish;
 * - it skips files over 4 MiB entirely. Our 40,000-character block is far below that, so we never get close.
 *
 * Token counting: we estimate 1 token ≈ 4 characters (characters ÷ 4, rounded up).
 * That's the usual rule of thumb for English text and Markdown. A real tokenizer would need a big dependency
 * and differs between AI tools anyway; for "is this file getting too big?" an estimate is enough.
 */
import { invalidInputFinding, isRuleInput, LINE_BREAK, type Finding, type RuleInput } from "./core";

/** A title is a short topic name, like "Testing". Over this: warn. */
export const TITLE_WARN_CHARS = 80;
/** Over this: block. Long titles make poor headings and are usually a body pasted in the wrong box. */
export const TITLE_MAX_CHARS = 120;

/** One rule over about 1,000 tokens: warn. Short, focused rules work best. */
export const BODY_WARN_CHARS = 4_000;
/** Half of Claude Code's 40,000-character truncation limit: one rule must never be able to fill a file by itself. */
export const BODY_MAX_CHARS = 20_000;

/** Claude Code's guidance: keep a rule file under about 200 lines. Over this: warn. */
export const FILE_WARN_LINES = 200;
/** About 20,000 characters. Over this: warn, because every session pays for these tokens. */
export const FILE_WARN_TOKENS = 5_000;
/** Claude Code truncates folder rule files over 40,000 characters. Over this: block. */
export const FILE_MAX_CHARS = 40_000;

/** Our token estimate: 1 token ≈ this many characters. */
export const CHARS_PER_TOKEN = 4;

/**
 * Approximate size of what render-claude.ts adds around the rules: the hidden marker, the "# Rules from axiomic" title,
 * the hierarchy note and up to four "## … rules" section headings (about 630 characters), rounded up to leave room for
 * a few "MANDATORY: " labels. Better to estimate slightly high than low. Checked against the real output in tests/safety/size.test.ts.
 */
const RENDER_OVERHEAD_CHARS = 660;
const RENDER_OVERHEAD_LINES = 17;

/** The estimated token count of a piece of text: characters ÷ 4, rounded up. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** The measured (or, for a list of rules, estimated) size of a combined rule file, plus any findings. */
export interface CombinedSize {
  chars: number;
  lines: number;
  tokens: number;
  findings: Finding[];
}

/**
 * Checks the size of one combined file.
 * Pass the rendered file text when you have it (exact), or the list of rules that will go into it (a close estimate
 * that doesn't need merge or render: each rule adds a "### title" heading, blank lines and its text).
 */
export function checkCombinedSize(input: string | readonly RuleInput[]): CombinedSize {
  let chars: number;
  let lines: number;

  // Runtime guard (see isRuleInput): input read from JSON may not be what the types promise.
  if (typeof input !== "string" && !(Array.isArray(input) && input.every(isRuleInput))) {
    return { chars: 0, lines: 0, tokens: 0, findings: [invalidInputFinding("The combined size needs a list of rules, each with a text title and body.")] };
  }

  if (typeof input === "string") {
    chars = input.length;
    lines = countLines(input);
  } else {
    chars = RENDER_OVERHEAD_CHARS;
    lines = RENDER_OVERHEAD_LINES;
    for (const rule of input) {
      const body = rule.body.trim();
      // "\n### title\n\nbody" plus the line break at the end, as renderRule writes it.
      chars += 6 + rule.title.trim().length + (body ? 2 + body.length : 0);
      lines += body ? 3 + countLines(body) : 2;
    }
  }

  const tokens = Math.ceil(chars / CHARS_PER_TOKEN);
  const findings: Finding[] = [];
  const field = "file";

  if (chars > FILE_MAX_CHARS) {
    findings.push({
      code: "size.file-too-large",
      severity: "block",
      field,
      message: `The combined rules are about ${chars.toLocaleString("en")} characters. Claude Code cuts files off after ${FILE_MAX_CHARS.toLocaleString("en")}, so some rules would be lost. Shorten or remove rules.`,
    });
  } else if (tokens > FILE_WARN_TOKENS) {
    findings.push({
      code: "size.file-tokens",
      severity: "warn",
      field,
      message: `The combined rules are about ${tokens.toLocaleString("en")} tokens. Every AI session pays for these; consider trimming them.`,
    });
  }
  if (lines > FILE_WARN_LINES) {
    findings.push({
      code: "size.file-lines",
      severity: "warn",
      field,
      message: `The combined rules are about ${lines} lines. Claude Code works best with rule files under ${FILE_WARN_LINES} lines.`,
    });
  }

  return { chars, lines, tokens, findings };
}

/** Size checks for one rule: its title and its text. */
export function checkRuleSize(rule: RuleInput): Finding[] {
  const findings: Finding[] = [];
  const title = rule.title.trim();

  // A title that is nothing but a huge run of spaces/line breaks trims down to "" but still costs the scans time, so the
  // raw length counts as well. 10x the limit leaves plenty of room for honest padding.
  const rawTooLong = rule.title.length > TITLE_MAX_CHARS * 10;

  if (rawTooLong || title.length > TITLE_MAX_CHARS) {
    const length = rawTooLong ? rule.title.length : title.length;
    findings.push({
      code: "size.title-too-long",
      severity: "block",
      field: "title",
      message: `The title is ${length} characters; the limit is ${TITLE_MAX_CHARS}. Keep it a short topic and put details in the text.`,
    });
  } else if (title.length === 0) {
    findings.push({ code: "size.title-empty", severity: "block", field: "title", message: "The title is empty. Give the rule a short topic, like \"Testing\"." });
  } else if (title.length > TITLE_WARN_CHARS) {
    findings.push({
      code: "size.title-long",
      severity: "warn",
      field: "title",
      message: `The title is ${title.length} characters. Short topics (under ${TITLE_WARN_CHARS}) work best.`,
    });
  }

  if (rule.body.length > BODY_MAX_CHARS) {
    findings.push({
      code: "size.body-too-long",
      severity: "block",
      field: "body",
      message: `The text is ${rule.body.length.toLocaleString("en")} characters; the limit is ${BODY_MAX_CHARS.toLocaleString("en")}. Split it into smaller rules.`,
    });
  } else if (rule.body.length > BODY_WARN_CHARS) {
    findings.push({
      code: "size.body-long",
      severity: "warn",
      field: "body",
      message: `The text is ${rule.body.length.toLocaleString("en")} characters (about ${estimateTokens(rule.body).toLocaleString("en")} tokens). Short, focused rules work best.`,
    });
  }

  return findings;
}

/** Number of lines (\n, \r\n or a lone \r each end one), not counting an empty last line after a final line break. */
function countLines(text: string): number {
  if (text === "") return 0;
  const parts = text.split(LINE_BREAK);
  return parts[parts.length - 1] === "" ? parts.length - 1 : parts.length;
}
