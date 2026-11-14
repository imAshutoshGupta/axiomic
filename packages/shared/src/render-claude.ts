import type { Layer } from "./layers";
import { isSafeFolderPath, isSafeModuleName } from "./paths";
import type { MergeResult, MergedModule, MergedRule } from "./rules";

/** One file to write on the developer's laptop. */
export interface RenderedFile {
  /** Where to write it, from the repo root. */
  path: string;
  content: string;
}

const RULES_DIR = ".claude/rules";

/** The sections of the main file, in hierarchy order. Folder rules get their own files. */
const MAIN_SECTIONS: [Layer, string][] = [
  ["company", "Company rules"],
  ["team", "Team rules"],
  ["project", "Project rules"],
  ["personal", "Your personal rules"],
];

/**
 * Turns the combined rules into Claude Code rule files.
 * Throws if a module name or folder is unsafe. The CLI then keeps the old files rather than write a dangerous one.
 */
export function renderClaude(result: MergeResult, version: number): RenderedFile[] {
  const files: RenderedFile[] = [];

  if (result.main.length > 0) {
    files.push({ path: `${RULES_DIR}/axiomic.md`, content: renderMain(result.main, version) });
  }

  const seen = new Set<string>();
  for (const mod of result.modules) {
    if (!isSafeModuleName(mod.name)) throw new Error(`Unsafe module name: ${JSON.stringify(mod.name)}`);
    if (!isSafeFolderPath(mod.path)) throw new Error(`Unsafe folder path: ${JSON.stringify(mod.path)}`);
    if (seen.has(mod.name)) throw new Error(`Two modules share the name ${JSON.stringify(mod.name)}`);
    seen.add(mod.name);
    files.push({ path: `${RULES_DIR}/axiomic-${mod.name}.md`, content: renderModule(mod, version) });
  }

  return files;
}

/** The main file: loads in every session. */
function renderMain(rules: MergedRule[], version: number): string {
  const lines = [
    marker(version),
    "# Rules from axiomic",
    "",
    "These rules are listed from widest to narrowest: company, team, project, then personal.",
    "",
    "- Rules marked MANDATORY must always be followed.",
    "- If two rules disagree, follow the narrower one: project over team, team over company.",
    "- Personal rules only add preferences. They never override company, team or project rules.",
    "- Extra rules may load when you work in certain folders. Inside those folders they win over these, except MANDATORY ones.",
  ];

  for (const [layer, heading] of MAIN_SECTIONS) {
    const inLayer = rules.filter((r) => r.source === layer);
    if (inLayer.length === 0) continue; // skip empty sections
    lines.push("", `## ${heading}`);
    for (const rule of inLayer) lines.push(...renderRule(rule));
  }

  return lines.join("\n") + "\n";
}

/** A folder file: Claude Code loads it only when it works on a file inside that folder. */
function renderModule(mod: MergedModule, version: number): string {
  const lines = [
    "---",
    "paths:",
    `  - "${mod.path}/**"`, // safe to put in quotes: isSafeFolderPath allows no quotes or line breaks
    "---",
    marker(version),
    `# Rules for ${mod.path}/`,
    "",
    `These rules apply when you work on files in \`${mod.path}/\`. Here they win over the general axiomic rules, except MANDATORY ones. If folders are nested, the deeper folder's rules win.`,
  ];
  for (const rule of mod.rules) lines.push(...renderRule(rule));
  return lines.join("\n") + "\n";
}

/** One rule: a ### title, then its text. */
function renderRule(rule: MergedRule): string[] {
  // Every rule must leave the file in the same state it found it: no code block and no HTML comment still open.
  // Otherwise one sloppy rule ("```" or "<!--" never closed) would swallow every rule rendered after it.
  const title = closeOpenBlocks(rule.title.replace(/\s+/g, " ").trim()); // always one line
  const heading = `### ${rule.mandatory ? "MANDATORY: " : ""}${title}`;
  const body = closeOpenBlocks(pushDownHeadings(rule.body).trim());
  return body ? ["", heading, "", body] : ["", heading];
}

/** Hidden from the AI (Claude Code strips HTML comments), so it costs no tokens. */
function marker(version: number): string {
  return `<!-- Managed by axiomic (version ${version}). Change these rules on the axiomic website, not here. -->`;
}

/**
 * Pushes Markdown headings inside a rule's text down to level 4 or deeper, so they can never
 * look like axiomic's own titles (#, ## and ###). Code blocks are left exactly as they are.
 */
export function pushDownHeadings(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n"); // treat Windows line endings like normal ones
  let fence: string | undefined; // the ``` or ~~~ that opened the code block we're inside, if any

  return lines
    .map((line, i) => {
      if (fence) {
        // Inside a code block: only look for the line that closes it.
        const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
        if (close && close[1]![0] === fence[0] && close[1]!.length >= fence.length) fence = undefined;
        return line;
      }

      const open = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (open) {
        fence = open[1];
        return line;
      }

      // "# Title" style: add three more #, up to the maximum of six.
      const hashes = /^ {0,3}(#{1,6})(?=\s|$)/.exec(line);
      if (hashes) {
        const level = Math.min(6, hashes[1]!.length + 3);
        return "#".repeat(level) + line.slice(hashes[0].length);
      }

      // A line underlined with === or --- also becomes a heading. Turn the underline into a plain divider.
      const previous = lines[i - 1];
      if (/^ {0,3}(=+|-+) *$/.test(line) && previous !== undefined && previous.trim() !== "") return "***";

      return line;
    })
    .join("\n");
}

/** The ``` or ~~~ line that opens a code block, and the line that closes it. Same rules as pushDownHeadings above. */
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;

/** What a piece of Markdown leaves open at its end. */
export interface OpenBlocks {
  /** A code block that was never closed: its opening marker (e.g. "```" or "~~~~") and its 1-based line. */
  fence?: { marker: string; line: number };
  /** An HTML comment that was never closed: where its "<!--" starts (index into the line-ending-normalised text) and its line. */
  comment?: { index: number; line: number };
}

/**
 * Walks the text line by line the way a Markdown reader would and reports what is still open at the end.
 * Three states, and only one can be active:
 * - inside a code block: only the matching closing line ends it (a "<!--" in code is just text);
 * - inside an HTML comment: only "-->" ends it (a "```" line in a comment is just text);
 * - otherwise: a fence line opens a code block, and "<!--" opens a comment.
 * A "<!--" inside an inline code span (`<!--`) is plain text, so it neither opens a comment nor gets escaped.
 * "<!-->" and "<!--->" close themselves at once (that's how HTML defines them), which is why "-->" is searched
 * from two characters into the opener. Only indexOf is used, so hostile text can't make it slow.
 */
export function findOpenBlocks(text: string): OpenBlocks {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let fence: OpenBlocks["fence"];
  let comment: OpenBlocks["comment"];
  let offset = 0; // where the current line starts in the normalised text

  lines.forEach((line, i) => {
    if (fence) {
      const close = FENCE_CLOSE.exec(line);
      if (close && close[1]![0] === fence.marker[0] && close[1]!.length >= fence.marker.length) fence = undefined;
    } else {
      const open = comment ? null : FENCE_OPEN.exec(line);
      if (open) {
        fence = { marker: open[1]!, line: i + 1 };
      } else {
        // Backtick runs on this line, and for each the next run of exactly the same length (its closing partner).
        // Built right to left in one pass so the whole line stays linear.
        const runs = [...line.matchAll(/`+/g)].map((m) => ({ start: m.index, length: m[0].length }));
        const partner: (number | undefined)[] = new Array(runs.length);
        const lastSeen = new Map<number, number>();
        for (let r = runs.length - 1; r >= 0; r--) {
          partner[r] = lastSeen.get(runs[r]!.length);
          lastSeen.set(runs[r]!.length, r);
        }

        let pos = 0;
        let r = 0; // first backtick run at or after pos
        let nextOpen = -2; // cached position of the next "<!--" (-2: not looked up yet)
        for (;;) {
          if (comment) {
            const end = line.indexOf("-->", pos);
            if (end === -1) break;
            comment = undefined;
            pos = end + 3;
            continue;
          }
          while (r < runs.length && runs[r]!.start < pos) r++;
          if (nextOpen !== -1 && nextOpen < pos) nextOpen = line.indexOf("<!--", pos);
          if (nextOpen === -1 && r >= runs.length) break;
          if (nextOpen !== -1 && (r >= runs.length || nextOpen < runs[r]!.start)) {
            const end = line.indexOf("-->", nextOpen + 2);
            if (end === -1) {
              comment = { index: offset + nextOpen, line: i + 1 };
              break;
            }
            pos = end + 3;
          } else {
            // A backtick run: if a run of the same length follows on this line it's an inline code span, and a "<!--"
            // inside is plain text. With no partner ("`<!-- hide" with the backtick never closed) it isn't code at all,
            // so the comment is real: that is how an unbalanced backtick could otherwise be used to dodge the check.
            const close = partner[r];
            pos = close !== undefined ? runs[close]!.start + runs[close]!.length : runs[r]!.start + runs[r]!.length;
          }
        }
      }
    }
    offset += line.length + 1;
  });

  return { ...(fence ? { fence } : {}), ...(comment ? { comment } : {}) };
}

/**
 * Makes sure a piece of text leaves nothing open, by changing as little as possible:
 * - A code block still open at the end gets a closing line: the same character, and the same length as the opener
 *   (a closing line must be at least as long as the opening one).
 * - An unclosed "<!--" is ESCAPED to "&lt;!--", so it shows as plain text. We chose this over appending " -->" because
 *   closing the comment would keep the text after the opener invisible to a reader (Markdown viewers hide comments), so a
 *   rule could still smuggle hidden words; escaping hides nothing, and no later text can pair with it to form a comment.
 *   No "-->" exists after an unclosed opener (that is what "unclosed" means), so every "<!--" from there on is unclosed
 *   too and is escaped in one go, which also keeps this linear.
 * axiomic's own "<!-- Managed by axiomic -->" marker is always written before any rule, and each rule leaves
 * no comment open, so a rule can never close, reopen or hide axiomic's marker.
 */
export function closeOpenBlocks(text: string): string {
  let result = text;
  const open = findOpenBlocks(result);
  if (open.comment) {
    const normalised = result.replace(/\r\n?/g, "\n");
    result = normalised.slice(0, open.comment.index) + normalised.slice(open.comment.index).replaceAll("<!--", "&lt;!--");
  }
  // Escaping a comment can turn a "```" line that used to sit inside it into a real code block, so look again.
  const after = open.comment ? findOpenBlocks(result) : open;
  return after.fence ? `${result}\n${after.fence.marker}` : result;
}
