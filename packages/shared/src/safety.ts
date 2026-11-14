/**
 * The publish-time safety check: rule(s) in, list of findings out.
 *
 * The server runs it when someone publishes a rule, and the CLI runs it before pushing one, so a bad rule
 * is caught before it reaches anyone's laptop. It's pure logic: no network, no files, no database.
 *
 *   rule ──┬─ checkRuleSize     too long?                       (safety-size.ts)
 *          ├─ findSecrets       API keys, passwords, keys?       (safety-secrets.ts)
 *          ├─ checkHidden       invisible characters?            (safety-hidden.ts)
 *          ├─ checkStructure    unclosed ``` or <!-- ?           (safety-structure.ts)
 *          ├─ checkLabels       pretends to be MANDATORY etc.?   (safety-labels.ts)
 *          └─ checkInjection    "ignore previous instructions"?  (safety-injection.ts)
 *                 │
 *                 ▼
 *          { ok, findings }     ok = no "block" findings
 *
 * Not checked here: a rule that clashes with a locked rule. merge.ts already drops those (see BlockedRule).
 */
import { checkHidden } from "./safety-hidden";
import { checkInjection } from "./safety-injection";
import { checkLabels } from "./safety-labels";
import { findSecrets } from "./safety-secrets";
import { invalidInputFinding, isRuleInput, type Finding, type RuleInput } from "./safety-core";
import { checkCombinedSize, checkRuleSize, type CombinedSize } from "./safety-size";
import { checkStructure } from "./safety-structure";

export type { Finding, FindingCode, FindingField, RuleInput, Severity } from "./safety-core";
export {
  BODY_MAX_CHARS,
  BODY_WARN_CHARS,
  CHARS_PER_TOKEN,
  FILE_MAX_CHARS,
  FILE_WARN_LINES,
  FILE_WARN_TOKENS,
  TITLE_MAX_CHARS,
  TITLE_WARN_CHARS,
  checkCombinedSize,
  estimateTokens,
  type CombinedSize,
} from "./safety-size";

/** The answer for one rule. */
export interface SafetyResult {
  /** True when nothing blocks publishing. There may still be warnings to show. */
  ok: boolean;
  /** Blocking findings first, then warnings; title before text; in reading order. */
  findings: Finding[];
}

/** The answer for a list of rules that will be combined into one file. */
export interface RulesSafetyResult extends SafetyResult {
  /** Estimated size of the combined file. Its findings are also in `findings`. */
  size: CombinedSize;
}

/**
 * At most this many findings of one kind per field. A pasted wall of 5,000 hidden characters
 * should produce a readable list, not 5,000 entries; the last one says how many more there were.
 */
export const MAX_FINDINGS_PER_KIND = 20;

/** Appended to a size finding when the other checks were not run because the text is far too big. */
const SKIPPED_NOTE = " The other checks were skipped for now; fix this first and they will run.";

/**
 * Runs every check on one rule.
 *
 * Two safety nets come first:
 * - the input guard: a rule read from JSON might have a missing or non-string field, and the checks below would
 *   throw on it. TypeScript can't catch that at runtime, so we answer with a blocking finding instead;
 * - the size gate: the scans cost time in proportion to the text length, so we don't run them on a title or body
 *   that is already over the hard limit. The size finding alone blocks, and the author has to shorten it anyway.
 */
export function checkRule(rule: RuleInput): SafetyResult {
  if (!isRuleInput(rule)) {
    return result([invalidInputFinding("A rule must be an object with a text title and a text body.")]);
  }

  const sizeFindings = checkRuleSize(rule);
  if (sizeFindings.some((f) => f.code === "size.title-too-long" || f.code === "size.body-too-long")) {
    return result(
      sizeFindings.map((f) =>
        f.code === "size.title-too-long" || f.code === "size.body-too-long" ? { ...f, message: f.message + SKIPPED_NOTE } : f,
      ),
    );
  }

  const findings = [
    ...sizeFindings,
    ...findSecrets("title", rule.title),
    ...findSecrets("body", rule.body),
    ...checkHidden("title", rule.title),
    ...checkHidden("body", rule.body),
    ...checkLabels(rule),
    ...checkInjection(rule),
    ...checkStructure("title", rule.title),
    ...checkStructure("body", rule.body),
  ];
  return result(findings);
}

/**
 * Runs every check on each rule, plus the size check on the file they'll be combined into.
 * Each finding from a single rule gets `ruleIndex`, its position in the list you passed in.
 * A bad entry (not a { title, body } of strings) gets its own "input.invalid" finding and is left out of the size.
 */
export function checkRules(rules: readonly RuleInput[]): RulesSafetyResult {
  if (!Array.isArray(rules)) {
    return { ...result([invalidInputFinding("The rules must be a list.")]), size: { chars: 0, lines: 0, tokens: 0, findings: [] } };
  }
  const findings = rules.flatMap((rule, ruleIndex) => checkRule(rule).findings.map((f) => ({ ...f, ruleIndex })));
  const size = checkCombinedSize(rules.filter(isRuleInput));
  return { ...result([...findings, ...size.findings]), size };
}

/** Caps, sorts and wraps a list of findings. */
function result(all: Finding[]): SafetyResult {
  const findings = sortFindings(capFindings(all));
  return { ok: !findings.some((f) => f.severity === "block"), findings };
}

/** Keeps at most MAX_FINDINGS_PER_KIND findings per kind, rule and field, and notes how many were left out. */
function capFindings(findings: Finding[]): Finding[] {
  const seen = new Map<string, Finding[]>();
  const kept: Finding[] = [];
  for (const finding of findings) {
    const key = `${finding.ruleIndex ?? ""}|${finding.field}|${finding.code}`;
    const group = seen.get(key) ?? [];
    seen.set(key, group);
    group.push(finding);
    if (group.length <= MAX_FINDINGS_PER_KIND) kept.push(finding);
  }
  for (const group of seen.values()) {
    const extra = group.length - MAX_FINDINGS_PER_KIND;
    if (extra > 0) {
      const last = group[MAX_FINDINGS_PER_KIND - 1]!;
      last.message += ` (…and ${extra} more like this)`;
    }
  }
  return kept;
}

const FIELD_ORDER = { title: 0, body: 1, file: 2 } as const;

/** Blocking first, then by rule, field and position, so the most important problem is always at the top. */
function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      (a.severity === b.severity ? 0 : a.severity === "block" ? -1 : 1) ||
      (a.ruleIndex ?? -1) - (b.ruleIndex ?? -1) ||
      FIELD_ORDER[a.field] - FIELD_ORDER[b.field] ||
      (a.line ?? 0) - (b.line ?? 0) ||
      (a.offset ?? 0) - (b.offset ?? 0),
  );
}
