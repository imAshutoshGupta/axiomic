/**
 * Check: text that imitates axiomic's own labels.
 *
 * render-claude.ts writes a few things that give a rule authority: the "MANDATORY:" prefix on locked rules,
 * the hidden "<!-- Managed by axiomic … -->" marker, the "## Company rules"-style section headings and the
 * hierarchy note at the top. If an ordinary rule could write those itself, it could pretend to be locked
 * or pretend to come from a wider layer. (Real lock clashes are already handled by merge.ts, not here.)
 *
 * Policy:
 * - block: a title starting with MANDATORY, a heading line starting with MANDATORY, and any "Managed by axiomic"
 *   text or HTML comment mentioning axiomic. No honest rule needs these.
 * - warn: a heading that copies one of our section headings, a line starting with "MANDATORY:", or a sentence from
 *   our hierarchy note. These turn up when someone pastes in an old CLAUDE.md, so they shouldn't stop publishing.
 * - Lines are checked everywhere, including inside ``` code blocks: pushDownHeadings leaves code blocks alone,
 *   so a "### MANDATORY:" line inside one would reach the file unchanged.
 * - Before comparing, text goes through `skeleton`: hidden characters removed, full-width and other look-alike
 *   letters turned into plain ones (NFKC, plus a small Cyrillic/Greek table), so "ＭＡＮＤＡＴＯＲＹ" or
 *   "МANDATORY" with a Cyrillic М can't dodge the check. Then titleKey from merge.ts, the same comparison the merge uses.
 */
import { titleKey } from "../merge";
import { LINE_BREAK, type Finding, type RuleInput } from "./core";
import { removeHidden } from "./hidden";

/**
 * Cyrillic and Greek letters that look exactly like Latin ones. NFKC doesn't change these, so we map them ourselves.
 * Written as \u escapes on purpose: as plain characters they'd be indistinguishable from the Latin letters.
 */
const LOOK_ALIKES: Record<string, string> = {
  // Cyrillic capitals
  "\u0410": "A", "\u0412": "B", "\u0415": "E", "\u041A": "K", "\u041C": "M", "\u041D": "H", "\u041E": "O",
  "\u0420": "P", "\u0421": "C", "\u0422": "T", "\u0423": "Y", "\u0425": "X", "\u0406": "I", "\u0405": "S",
  // Cyrillic small letters
  "\u0430": "a", "\u0435": "e", "\u043E": "o", "\u0440": "p", "\u0441": "c", "\u0443": "y", "\u0445": "x",
  "\u0456": "i", "\u0458": "j", "\u0455": "s", "\u0501": "d", "\u051B": "q", "\u051D": "w", "\u04BB": "h",
  // Greek capitals
  "\u0391": "A", "\u0392": "B", "\u0395": "E", "\u0396": "Z", "\u0397": "H", "\u0399": "I", "\u039A": "K",
  "\u039C": "M", "\u039D": "N", "\u039F": "O", "\u03A1": "P", "\u03A4": "T", "\u03A5": "Y", "\u03A7": "X",
  // Greek small letters
  "\u03B1": "a", "\u03B9": "i", "\u03BD": "v", "\u03BF": "o", "\u03C1": "p",
  // Latin variants
  "\u0131": "i", "\u0251": "a", "\u0261": "g",
};
const LOOK_ALIKE = new RegExp(`[${Object.keys(LOOK_ALIKES).join("")}]`, "g");

/** HTML character references: &#77; (decimal), &#x4D; (hex) and the few named ones that matter for plain text. */
const CHAR_REF = /&(?:#x([0-9a-f]{1,6})|#([0-9]{1,7})|(amp|lt|gt|quot|apos|nbsp));/gi;
const NAMED_REFS: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/**
 * Turns "&#77;ANDATORY" into "MANDATORY". A Markdown viewer shows the decoded letter, so a label written with
 * character references reads exactly like the real one to a human, but wouldn't match a plain-text comparison.
 * Anything that isn't a real code point (zero, too big, or a surrogate half) is left as it was.
 */
function decodeCharRefs(text: string): string {
  return text.replace(CHAR_REF, (whole, hex: string | undefined, dec: string | undefined, name: string | undefined) => {
    if (name) return NAMED_REFS[name.toLowerCase()]!;
    const cp = hex !== undefined ? parseInt(hex, 16) : parseInt(dec!, 10);
    return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : whole;
  });
}

/**
 * The "what does this really say" form of a text, so disguises don't help:
 * - character references decoded (&#77; -> M), so they can't spell a label;
 * - hidden characters removed;
 * - NFKC applied (full-width "ＡＢＣ" -> "ABC", "：" -> ":");
 * - combining marks stripped ("M" + accent -> "M"): NFD splits a letter from its accent, we drop the accents,
 *   NFC puts everything else (e.g. Korean) back together;
 * - Cyrillic/Greek look-alikes turned into Latin letters.
 * Keeps case and line breaks. Shared with injection.ts. It's for comparing only, never for showing back as text.
 */
export function skeleton(text: string): string {
  return removeHidden(decodeCharRefs(text))
    .normalize("NFKC")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .normalize("NFC")
    .replace(LOOK_ALIKE, (char) => LOOK_ALIKES[char]!);
}

/** Markdown emphasis characters. "**Company rules**" or "__MANDATORY__:" look the same as the plain words to a reader. */
const EMPHASIS = /[*_`~]/g;

/**
 * The headings render-claude.ts writes, compared with titleKey. If render-claude.ts changes them, update this list;
 * the test "flags everything in a real rendered file" in tests/safety/labels.test.ts will fail until you do.
 */
const AXIOMIC_HEADINGS = ["rules from axiomic", "company rules", "team rules", "project rules", "your personal rules"];
/** Folder files start with "# Rules for src/payments/". */
const FOLDER_HEADING = /^rules for \S+\/$/;

/** Distinctive sentences from the hierarchy notes in render-claude.ts, lowercased. */
const HIERARCHY_NOTE = [
  "these rules are listed from widest to narrowest",
  "rules marked mandatory must always be followed",
  "if two rules disagree, follow the narrower one",
  "personal rules only add preferences",
  "extra rules may load when you work in certain folders",
  "here they win over the general axiomic rules",
  "change these rules on the axiomic website",
];

/** Starts with the word "mandatory" followed by : - – — | ] ) or nothing at all. Run on a titleKey (lowercase). */
const MANDATORY_KEY = /^[^a-z0-9]*mandatory[^a-z0-9]*(?:[:\-–—|\])]|$)/;
/** Starts with MANDATORY in capitals, as render-claude.ts writes it, even without a colon. */
const MANDATORY_CAPS = /^[^\p{L}\p{N}]*MANDATORY\b/u;

/** True if this title or heading text pretends to carry axiomic's MANDATORY label. */
function claimsMandatory(text: string): boolean {
  const plain = skeleton(text).replace(EMPHASIS, "");
  return MANDATORY_KEY.test(titleKey(plain)) || MANDATORY_CAPS.test(plain.trim());
}

/** Checks a rule's title and text for imitations of axiomic's own labels. */
export function checkLabels(rule: RuleInput): Finding[] {
  const findings: Finding[] = [];

  // The title becomes a "### title" heading, so it's checked like one.
  if (claimsMandatory(rule.title)) {
    findings.push({
      code: "label.mandatory",
      severity: "block",
      field: "title",
      message: 'The title starts with "MANDATORY". Only locked company and team rules get that label, and axiomic adds it itself. Remove it from the title.',
    });
  } else if (isAxiomicHeading(rule.title)) {
    findings.push({ code: "label.axiomic-heading", severity: "warn", field: "title", message: headingMessage(rule.title) });
  }
  findings.push(...checkManaged("title", rule.title));

  // \r\n, \n and a lone \r all end a line: a Markdown viewer treats them alike, so we must too.
  const lines = rule.body.split(LINE_BREAK);
  lines.forEach((raw, i) => {
    const line = skeleton(raw);
    const at = { field: "body" as const, line: i + 1 };

    const heading = headingText(line);
    if (heading !== undefined) {
      if (claimsMandatory(heading)) {
        findings.push({
          ...at,
          code: "label.mandatory",
          severity: "block",
          message: 'A heading starts with "MANDATORY". Only locked company and team rules get that label, and axiomic adds it itself.',
        });
      } else if (isAxiomicHeading(heading)) {
        findings.push({ ...at, code: "label.axiomic-heading", severity: "warn", message: headingMessage(heading) });
      }
    } else if (/^MANDATORY\s*:/.test(line.replace(/^[\s>*+_-]*(?:\d+[.)]\s*)?/, "").replace(EMPHASIS, ""))) {
      // (emphasis removed so "**MANDATORY**:", "__MANDATORY__:" and "*MANDATORY:*" count too)
      findings.push({
        ...at,
        code: "label.mandatory-text",
        severity: "warn",
        message: 'A line starts with "MANDATORY:". That looks like axiomic\'s label for locked rules. Ask an admin to lock the rule instead.',
      });
    }

    const lower = line.toLowerCase().replace(/\s+/g, " ");
    if (HIERARCHY_NOTE.some((sentence) => lower.includes(sentence))) {
      findings.push({
        ...at,
        code: "label.hierarchy-note",
        severity: "warn",
        message: "This line copies axiomic's own explanation of how rules are ordered. Remove it; axiomic adds the real one.",
      });
    }
  });

  findings.push(...checkManaged("body", rule.body));
  return findings;
}

/**
 * Fake versions of the hidden marker: "Managed by axiomic" anywhere (also split across lines),
 * or any HTML comment that mentions axiomic. The CLI may use the marker to recognise its own files.
 */
function checkManaged(field: "title" | "body", text: string): Finding[] {
  const plain = skeleton(text).toLowerCase();
  const message =
    field === "title"
      ? 'The title imitates axiomic\'s "Managed by axiomic" marker. Remove it.'
      : 'The text imitates axiomic\'s "Managed by axiomic" marker or hides an axiomic comment. Remove it.';

  // Squash all spaces and line breaks so "Managed   by\naxiomic" still counts.
  const squashed = plain.replace(/\s+/g, " ");
  if (squashed.includes("managed by axiomic")) {
    const index = plain.search(/managed\s+by\s+axiomic/);
    return [{ code: "label.managed-marker", severity: "block", field, message, ...(index >= 0 ? { line: lineAt(plain, index) } : {}) }];
  }

  // HTML comments: find each "<!--" and its "-->" with indexOf (a regex here could get slow on hostile input).
  for (let start = plain.indexOf("<!--"); start !== -1; ) {
    const close = plain.indexOf("-->", start + 4);
    const end = close === -1 ? plain.length : close; // an unclosed comment runs to the end of the text
    if (plain.slice(start, end).includes("axiomic")) {
      return [{ code: "label.managed-marker", severity: "block", field, message, line: lineAt(plain, start) }];
    }
    if (close === -1) break;
    start = plain.indexOf("<!--", close + 3);
  }
  return [];
}

/**
 * If the line is a Markdown "#" heading, returns its text (without the #s); otherwise undefined.
 * Done without a regex for the text part, so very long lines stay fast.
 */
function headingText(line: string): string | undefined {
  const hashes = /^ {0,3}#{1,6}(?=[ \t]|$)/.exec(line);
  if (!hashes) return undefined;
  let text = line.slice(hashes[0].length).trim();
  // "## Title ##" style closing hashes are not part of the text.
  while (text.endsWith("#")) text = text.slice(0, -1);
  return text.trim();
}

/** True if a heading or title copies one of the headings render-claude.ts writes. */
function isAxiomicHeading(text: string): boolean {
  // Emphasis removed: "## **Company rules**" shows as the real heading.
  const key = titleKey(skeleton(text).replace(EMPHASIS, ""));
  return AXIOMIC_HEADINGS.includes(key) || FOLDER_HEADING.test(key);
}

function headingMessage(text: string): string {
  return `"${skeleton(text).trim()}" copies one of axiomic's own section headings, which could make this rule look like it comes from another layer. Use a different heading.`;
}

function lineAt(text: string, index: number): number {
  let line = 1;
  for (const m of text.matchAll(/\r\n|\r|\n/g)) {
    if (m.index >= index) break;
    line++;
  }
  return line;
}
