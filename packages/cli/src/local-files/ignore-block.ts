import { promises as fs } from "node:fs";
import path from "node:path";
import { readFileNoFollowWithInfo, removeFileIfExists, writeFileAtomic } from "../utils/fs-safe";
import { TEMP_IGNORE_PATTERN } from "./managed-paths";

/**
 * A managed block in .gitignore / .dockerignore, so the rule files never end up in Git or a Docker image:
 *
 *   # >>> axiomic
 *   # Managed by axiomic: keeps rule files out of Git. Don't edit between these lines.
 *   /.claude/rules/axiomic.md
 *   /.claude/rules/axiomic-*.md
 *   /.claude/rules/.axiomic*.tmp
 *   # <<< axiomic
 *
 * Rules for editing someone else's file:
 * - Every line outside our block is kept byte for byte, including its own line ending (\n or \r\n).
 * - New lines we add use the file's main line ending, so a Windows (CRLF) file stays CRLF.
 * - Running it twice gives the same file (idempotent).
 * - A damaged block (a start line with no end, or an end with no start) is repaired WITHOUT deleting
 *   the user's lines: only the stray marker lines are dropped, and a fresh block is written.
 *   We never guess where a broken block "really" ended, because guessing wrong would delete user lines.
 * - Duplicate blocks are merged into one (at the position of the first).
 */
export const BLOCK_START = "# >>> axiomic";
export const BLOCK_END = "# <<< axiomic";
const NOTE = "# Managed by axiomic: keeps rule files out of Git. Don't edit between these lines.";

/** .gitignore: a leading "/" anchors the pattern to the repo root, so only our exact files match. */
export const GITIGNORE_BODY = [NOTE, "/.claude/rules/axiomic.md", "/.claude/rules/axiomic-*.md", `/${TEMP_IGNORE_PATTERN}`];

/** .dockerignore: patterns are always relative to the build context root, written without "/". */
export const DOCKERIGNORE_BODY = [
  "# Managed by axiomic: keeps rule files out of Docker images. Don't edit between these lines.",
  ".claude/rules/axiomic.md",
  ".claude/rules/axiomic-*.md",
  TEMP_IGNORE_PATTERN, // leftover temp files hold rule content too (see managed-paths.ts)
];

/** One line of the file, with its original ending ("\n", "\r\n" or "" for a last line without one). */
interface Segment {
  text: string;
  eol: string;
}

interface Parsed {
  segments: Segment[];
  /** Index ranges [start, end] (inclusive) of well-formed blocks. */
  blocks: [number, number][];
  /** Indexes of marker lines with no partner. */
  strays: number[];
  /** The line ending to use for new lines. */
  eol: string;
}

function parse(text: string): Parsed {
  const segments: Segment[] = [];
  for (const match of text.matchAll(/([^\n]*?)(\r?\n|$)/g)) {
    if (match[0] === "" && match.index === text.length) break; // the empty match at the very end
    segments.push({ text: match[1] ?? "", eol: match[2] ?? "" });
  }

  const crlf = segments.filter((s) => s.eol === "\r\n").length;
  const lf = segments.filter((s) => s.eol === "\n").length;
  const eol = crlf > lf ? "\r\n" : "\n";

  const blocks: [number, number][] = [];
  const strays: number[] = [];
  let open: number | undefined;
  segments.forEach((segment, i) => {
    const line = segment.text.trim(); // trim also drops a stray \r and a byte-order mark
    if (line === BLOCK_START) {
      if (open !== undefined) strays.push(open); // a start followed by another start: the first is stray
      open = i;
    } else if (line === BLOCK_END) {
      if (open === undefined) strays.push(i);
      else blocks.push([open, i]);
      open = undefined;
    }
  });
  if (open !== undefined) strays.push(open);

  return { segments, blocks, strays, eol };
}

/** Indexes of lines that belong to axiomic (inside blocks, or stray markers). */
function ourLines(parsed: Parsed): Set<number> {
  const ours = new Set(parsed.strays);
  for (const [start, end] of parsed.blocks) for (let i = start; i <= end; i++) ours.add(i);
  return ours;
}

function join(segments: Segment[]): string {
  return segments.map((s) => s.text + s.eol).join("");
}

/** Adds the block, or replaces an existing (possibly outdated, duplicated or damaged) one. */
export function upsertBlock(text: string, body: string[]): string {
  const parsed = parse(text);
  const ours = ourLines(parsed);
  const block: Segment[] = [BLOCK_START, ...body, BLOCK_END].map((line) => ({ text: line, eol: parsed.eol }));

  // Put the block where the first old block (or stray marker) was, otherwise at the end.
  const firstOurs = Math.min(...(parsed.blocks.map(([start]) => start)), ...parsed.strays);
  const out: Segment[] = [];
  parsed.segments.forEach((segment, i) => {
    if (i === firstOurs) out.push(...block);
    if (!ours.has(i)) out.push({ ...segment });
  });
  if (!Number.isFinite(firstOurs)) {
    // Appending: make sure the current last line ends with a line break first.
    const last = out[out.length - 1];
    if (last && last.eol === "") last.eol = parsed.eol;
    out.push(...block);
  }
  return join(out);
}

/** Removes every axiomic block and stray marker. Everything else stays exactly as it was. */
export function removeBlock(text: string): string {
  const parsed = parse(text);
  const ours = ourLines(parsed);
  return join(parsed.segments.filter((_, i) => !ours.has(i)));
}

/** "current": exactly one block with the expected lines. "outdated": a block exists but needs fixing. */
export function blockStatus(text: string, body: string[]): "current" | "outdated" | "missing" {
  const parsed = parse(text);
  if (parsed.blocks.length === 0 && parsed.strays.length === 0) return "missing";
  return upsertBlock(text, body) === text ? "current" : "outdated";
}

// ── Files ──────────────────────────────────────────────────────────

export type EnsureResult = "created" | "updated" | "unchanged" | "skipped";

/**
 * Makes sure `file` contains the current block. Keeps the file's permissions.
 * Refuses (throws) if the file is a symlink, so we never write outside the project.
 * With createIfMissing false, a missing file is left missing ("skipped").
 */
export async function ensureBlockInFile(
  file: string,
  body: string[],
  options: { createIfMissing: boolean; dryRun?: boolean },
): Promise<EnsureResult> {
  const existing = await readFileNoFollowWithInfo(file);
  if (existing === undefined) {
    if (!options.createIfMissing) return "skipped";
    if (!options.dryRun) await writeFileAtomic(file, upsertBlock("", body), 0o644);
    return "created";
  }
  const text = existing.data.toString("utf8");
  const updated = upsertBlock(text, body);
  if (updated === text) return "unchanged";
  if (!options.dryRun) await writeFileAtomic(file, updated, existing.mode & 0o777);
  return "updated";
}

export type RemoveResult = "removed" | "deleted-file" | "emptied" | "absent";

/**
 * Removes our block from `file`.
 *
 * If nothing but our block was in it, the file is deleted ONLY when `createdByAxiomic` is true (the manifest
 * recorded that axiomic itself created this file, and the caller checked Git doesn't track it: see remove.ts). Otherwise it is left in place, empty: a .gitignore that
 * existed before axiomic (even an empty or tracked one) may be tracked by Git, and deleting it would show up
 * as a change in the user's repo. If we can't know who created it, we assume it wasn't us ("emptied").
 */
export async function removeBlockFromFile(
  file: string,
  options: { dryRun?: boolean; createdByAxiomic?: boolean } = {},
): Promise<RemoveResult> {
  const existing = await readFileNoFollowWithInfo(file);
  if (existing === undefined) return "absent";
  const text = existing.data.toString("utf8");
  const updated = removeBlock(text);
  if (updated === text) return "absent";
  if (updated === "" && options.createdByAxiomic === true) {
    if (!options.dryRun) await removeFileIfExists(file);
    return "deleted-file";
  }
  if (!options.dryRun) await writeFileAtomic(file, updated, existing.mode & 0o777);
  return updated === "" ? "emptied" : "removed";
}

/** The status of the block in a file, or "no-file". Never throws for a missing file. */
export async function blockStatusInFile(file: string, body: string[]): Promise<"current" | "outdated" | "missing" | "no-file"> {
  const existing = await readFileNoFollowWithInfo(file);
  return existing === undefined ? "no-file" : blockStatus(existing.data.toString("utf8"), body);
}

/**
 * Decision on .dockerignore: update it if it exists; create it only if the project has a Dockerfile
 * or Containerfile at its root. A project with neither doesn't build Docker images from here, and a
 * new, unexplained .dockerignore would just be one more file for the user to wonder about and commit.
 * (A project with a Dockerfile but no .dockerignore sends EVERYTHING, our rule files included, to the
 * Docker build, which is exactly the leak we want to stop.)
 */
export async function shouldManageDockerignore(realRoot: string): Promise<boolean> {
  const names = await fs.readdir(realRoot);
  return names.some((name) => name === ".dockerignore" || /^(dockerfile|containerfile)(\..+)?$/i.test(name) || /\.dockerfile$/i.test(name));
}

export function gitignorePath(realRoot: string): string {
  return path.join(realRoot, ".gitignore");
}

export function dockerignorePath(realRoot: string): string {
  return path.join(realRoot, ".dockerignore");
}

/** Adds/updates the blocks in .gitignore (always) and .dockerignore (see the decision above). */
export async function ensureIgnoreBlocks(
  realRoot: string,
  options: { dryRun?: boolean } = {},
): Promise<{ gitignore: EnsureResult; dockerignore: EnsureResult }> {
  const gitignore = await ensureBlockInFile(gitignorePath(realRoot), GITIGNORE_BODY, { createIfMissing: true, ...options });
  const dockerignore = (await shouldManageDockerignore(realRoot))
    ? await ensureBlockInFile(dockerignorePath(realRoot), DOCKERIGNORE_BODY, { createIfMissing: true, ...options })
    : "skipped";
  return { gitignore, dockerignore };
}
