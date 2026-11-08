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
  const title = rule.title.replace(/\s+/g, " ").trim(); // always one line
  const heading = `### ${rule.mandatory ? "MANDATORY: " : ""}${title}`;
  const body = pushDownHeadings(rule.body).trim();
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
