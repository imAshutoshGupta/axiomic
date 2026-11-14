/**
 * Check: invisible and hidden characters.
 *
 * Why it matters: the AI reads every character, the human reviewer only sees the visible ones.
 * Invisible characters let someone hide instructions ("Unicode tag" smuggling), reorder what the
 * reviewer sees (bidi overrides, the "Trojan Source" trick) or dodge our other checks
 * (a zero-width space inside "ghp_…" or "MANDATORY").
 *
 * Policy:
 * - block: control characters, bidi overrides/isolates, tag characters, runs of variation selectors,
 *   and every other zero-width / "default ignorable" character, wherever it appears (code blocks too).
 * - warn: left-to-right / right-to-left marks (real Arabic/Hebrew text uses them), the Unicode
 *   line/paragraph separators (U+2028/U+2029, odd but harmless), ONE byte order mark at the very start of a
 *   field (editors and Windows tools add it silently when saving "UTF-8 with BOM"), and the soft hyphen
 *   (U+00AD, pasted in from Word/PDFs; it hides nothing dangerous on its own, and the secret, label and
 *   injection checks all strip it before matching, so it can't be used to split a word past them).
 * - allowed, because real text needs them:
 *   - ZWJ (U+200D) inside an emoji sequence, e.g. 👩‍💻 is 👩 + ZWJ + 💻.
 *   - ZWJ / ZWNJ between two non-English letters, e.g. in Hindi or Persian words.
 *   - a single variation selector right after a visible character, e.g. ❤️ is ❤ + VS16 (U+FE0F).
 *     A run of them is blocked: that's how data gets smuggled inside an emoji.
 */
import { formatCodePoint, makeLocator, type Finding, type FindingCode, type Severity } from "./safety-core";

/**
 * Every character that might be hidden: control characters (except tab, line feed and carriage return),
 * "format" characters (zero-width, bidi, tags, soft hyphen…), everything Unicode calls "default ignorable"
 * (variation selectors, Hangul fillers…), plus the two Unicode line/paragraph separators.
 * The \p{…} names are Unicode properties built into JavaScript, so we don't have to hand-maintain a list.
 */
const HIDDEN = /(?![\t\n\r])[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\u2028\u2029]/gu;

/** Removes every possibly-hidden character. Used by the other checks so hidden characters can't split a word. */
export function removeHidden(text: string): string {
  return text.replace(HIDDEN, "");
}

/**
 * Like removeHidden, but also remembers where each remaining character came from,
 * so a secret found in the cleaned text can be reported at its real position.
 * `origin[i]` is the position in the original text of character i of the cleaned text.
 */
export function removeHiddenWithMap(text: string): { text: string; origin: number[] } {
  let cleaned = "";
  const origin: number[] = [];
  let kept = 0; // start of the stretch of normal characters we haven't copied yet

  const keep = (end: number) => {
    cleaned += text.slice(kept, end);
    for (let i = kept; i < end; i++) origin.push(i);
  };

  for (const match of text.matchAll(HIDDEN)) {
    keep(match.index);
    kept = match.index + match[0].length;
  }
  keep(text.length);
  return { text: cleaned, origin };
}

/** Finds hidden characters in one field. Neighbouring characters of the same kind are reported as one finding. */
export function checkHidden(field: "title" | "body", text: string): Finding[] {
  const findings: Finding[] = [];
  const locate = makeLocator(text);
  let last: Finding | undefined; // the run we're currently growing

  for (const match of text.matchAll(HIDDEN)) {
    const codePoint = match[0].codePointAt(0)!;
    const kind = classify(text, match.index, codePoint);
    if (!kind) continue; // allowed here, e.g. the ZWJ inside an emoji

    // Same kind, right after the previous one: grow that run instead of adding a new finding.
    if (last && last.code === kind.code && last.offset! + last.length! === match.index) {
      last.length! += match[0].length;
      last.count! += 1;
      last.message = messageFor(kind.code, last.count!);
      continue;
    }

    last = {
      code: kind.code,
      severity: kind.severity,
      message: messageFor(kind.code, 1),
      field,
      offset: match.index,
      length: match[0].length,
      ...locate(match.index),
      codePoint: formatCodePoint(codePoint),
      count: 1,
    };
    findings.push(last);
  }
  return findings;
}

/** Decides what one hidden character is, or returns undefined if it's fine where it is. */
function classify(text: string, index: number, cp: number): { code: FindingCode; severity: Severity } | undefined {
  if (cp === 0x2028 || cp === 0x2029) return { code: "hidden.line-separator", severity: "warn" };
  // A BOM is only innocent as the very first character. Anywhere else it is just an invisible character.
  if (cp === 0xfeff && index === 0) return { code: "hidden.bom", severity: "warn" };
  if (cp === 0x00ad) return { code: "hidden.soft-hyphen", severity: "warn" };
  if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) return { code: "hidden.control", severity: "block" };
  // Bidi embeddings/overrides (U+202A–U+202E) and isolates (U+2066–U+2069): can make text display in a different order than the AI reads it.
  if ((cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069)) return { code: "hidden.bidi-control", severity: "block" };
  // Left-to-right mark, right-to-left mark, Arabic letter mark: used by real right-to-left text.
  if (cp === 0x200e || cp === 0x200f || cp === 0x061c) return { code: "hidden.direction-mark", severity: "warn" };
  // Tag characters: invisible copies of ASCII. The classic way to hide a whole sentence from humans.
  if (cp >= 0xe0000 && cp <= 0xe007f) return { code: "hidden.tag", severity: "block" };

  // Arabic and Syriac number/verse signs are "format" characters in Unicode, but they are drawn on screen, so nothing is hidden.
  if ((cp >= 0x0600 && cp <= 0x0605) || cp === 0x06dd || cp === 0x070f || cp === 0x08e2) return undefined;

  const before = codePointBefore(text, index);
  const after = text.codePointAt(index + (cp > 0xffff ? 2 : 1));

  if (isVariationSelector(cp)) {
    const afterVisible = before !== undefined && !isHiddenOrSpace(before);
    const alone = after === undefined || !isVariationSelector(after);
    return afterVisible && alone ? undefined : { code: "hidden.variation-selector", severity: "block" };
  }

  // Zero-width joiner inside an emoji sequence, e.g. 👩 + ZWJ + 💻. The emoji before it may end in VS16 or a skin tone.
  if (cp === 0x200d && before !== undefined && after !== undefined && EMOJI_PART.test(String.fromCodePoint(before)) && PICTOGRAPH.test(String.fromCodePoint(after))) {
    return undefined;
  }

  // ZWJ / ZWNJ between two non-English letters (or their accent marks): needed to spell words in e.g. Hindi and Persian.
  if ((cp === 0x200c || cp === 0x200d) && isNonAsciiLetter(before) && isNonAsciiLetter(after)) return undefined;

  return { code: "hidden.invisible", severity: "block" };
}

const EMOJI_PART = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F]/u;
const PICTOGRAPH = /\p{Extended_Pictographic}/u;
const LETTER_OR_MARK = /[\p{L}\p{M}]/u;

function isVariationSelector(cp: number): boolean {
  return (
    (cp >= 0xfe00 && cp <= 0xfe0f) || // VS1–VS16
    (cp >= 0xe0100 && cp <= 0xe01ef) || // VS17–VS256
    (cp >= 0x180b && cp <= 0x180d) || // Mongolian free variation selectors
    cp === 0x180f
  );
}

function isHiddenOrSpace(cp: number): boolean {
  const char = String.fromCodePoint(cp);
  return /\s/.test(char) || removeHidden(char) === "";
}

function isNonAsciiLetter(cp: number | undefined): boolean {
  return cp !== undefined && cp > 0x7f && LETTER_OR_MARK.test(String.fromCodePoint(cp));
}

/** The whole code point just before `index`, handling emoji and other characters that take two UTF-16 units. */
function codePointBefore(text: string, index: number): number | undefined {
  if (index === 0) return undefined;
  const low = text.charCodeAt(index - 1);
  if (low >= 0xdc00 && low <= 0xdfff && index >= 2) {
    const high = text.charCodeAt(index - 2);
    if (high >= 0xd800 && high <= 0xdbff) return text.codePointAt(index - 2);
  }
  return low;
}

function messageFor(code: FindingCode, count: number): string {
  const what = count === 1 ? "an invisible character" : `${count} invisible characters in a row`;
  switch (code) {
    case "hidden.control":
      return `Contains ${what}: a control character. Remove it.`;
    case "hidden.bidi-control":
      return `Contains ${what} that changes text direction. It can make the text look different from what the AI reads. Remove it.`;
    case "hidden.direction-mark":
      return `Contains ${what}: a text-direction mark. Fine in Arabic or Hebrew text; otherwise remove it.`;
    case "hidden.tag":
      return `Contains ${what}: Unicode "tag" characters. They can hide a message that only the AI sees. Remove them.`;
    case "hidden.variation-selector":
      return `Contains ${what}: stray or repeated variation selectors. They can hide data inside an emoji. Remove them.`;
    case "hidden.bom":
      return "Starts with a byte order mark (an invisible character some editors add when saving). Remove it.";
    case "hidden.soft-hyphen":
      return `Contains ${what}: a soft hyphen (often pasted in from Word or a PDF). Harmless, but remove it.`;
    case "hidden.line-separator":
      return `Contains ${what}: a Unicode line or paragraph separator. Use a normal line break instead.`;
    default:
      return `Contains ${what} (e.g. a zero-width space). People can't see it but the AI can. Remove it.`;
  }
}
