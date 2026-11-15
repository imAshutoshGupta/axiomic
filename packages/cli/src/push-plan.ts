import path from "node:path";
import { parseRenderedFile, pullUpHeadings, type RenderedSection } from "@axiomic/shared";
import type { CacheEntry } from "./cache";
import { readFileNoFollow } from "./fs-safe";
import { MAIN_RULES_FILE } from "./managed-paths";
import type { RuleRef } from "./remote";

/**
 * Works out what `axiomic push` would send (DECISIONS #64), by comparing each rule file on disk
 * with the copy from the last pull (the offline cache), "### Title" section by section:
 *
 *   section in both, text changed   → update that rule (its id + the version you pulled)
 *   section only on disk            → create a rule in the layer whose "## …" heading is above it
 *   section only in the last pull   → you deleted it: NOT sent (delete rules on the website), noted
 *   text outside any section        → axiomic's own wording: ignored, noted
 *
 * The cached copy's sections are matched to rules by ORDER, using the pull's index (the server
 * renders and indexes in the same order). Local sections are matched to those by layer + title.
 */
export type PlannedChange =
  | { kind: "update"; ruleId: string; baseVersion: number; title: string; body: string; layer: RuleRef["layer"]; path: string }
  | { kind: "create"; layer: RuleRef["layer"]; module?: string; title: string; body: string; path: string };

export interface PushPlan {
  changes: PlannedChange[];
  notes: string[];
}

const key = (layer: string | null, title: string) => `${layer ?? ""}\u0000${title.replace(/\s+/g, " ").trim().toLowerCase()}`;

/** "…/axiomic-payments.md" → "payments"; the main file → undefined. */
function moduleName(relPath: string): string | undefined {
  const m = /^axiomic-([a-z0-9-]+)\.md$/.exec(path.posix.basename(relPath));
  return m ? m[1] : undefined;
}

export async function planPush(realRoot: string, cache: CacheEntry): Promise<PushPlan> {
  if (!cache.rules) throw new Error('the last pull is from an older axiomic. Run "axiomic pull" first, then redo your edit.');
  const changes: PlannedChange[] = [];
  const notes: string[] = [];

  for (const cached of cache.files) {
    const raw = await readFileNoFollow(path.join(realRoot, ...cached.path.split("/")));
    if (raw === undefined) {
      notes.push(`${cached.path}: missing on disk, nothing to send (axiomic pull restores it)`);
      continue;
    }
    const local = raw.toString("utf8");
    if (local === cached.content) continue;

    const kind = cached.path === MAIN_RULES_FILE ? "main" : "module";
    const mod = kind === "module" ? moduleName(cached.path) : undefined;
    const before = parseRenderedFile(cached.content, kind);
    const after = parseRenderedFile(local, kind);
    const refs = cache.rules.filter((r) => r.path === cached.path);
    if (refs.length !== before.sections.length) {
      throw new Error(`the last pull of ${cached.path} doesn't match its index. Run "axiomic pull --force" and redo your edit.`);
    }

    // The last pull's sections, by layer + title, each with its rule.
    const known = new Map<string, { section: RenderedSection; ref: RuleRef }>();
    before.sections.forEach((section, i) => known.set(key(section.layer, section.title), { section, ref: refs[i]! }));

    const seen = new Set<string>();
    for (const section of after.sections) {
      const k = key(section.layer, section.title);
      const match = known.get(k);
      if (match) {
        seen.add(k);
        if (section.body === match.section.body) continue;
        changes.push({
          kind: "update", ruleId: match.ref.id, baseVersion: match.ref.version, title: match.ref.title,
          body: pullUpHeadings(section.body), layer: match.ref.layer, path: cached.path,
        });
      } else if (section.layer === null) {
        notes.push(`${cached.path}: "${section.title}" is above the first "## … rules" heading, so axiomic can't tell its layer. Move it under one.`);
      } else if (section.title.trim() === "") {
        notes.push(`${cached.path}: a section has no title after "### ", so it was not sent.`);
      } else {
        changes.push({
          kind: "create", layer: section.layer, ...(mod ? { module: mod } : {}), title: section.title.trim(),
          body: pullUpHeadings(section.body), path: cached.path,
        });
      }
    }
    for (const [k, { ref }] of known) {
      if (!seen.has(k)) notes.push(`${cached.path}: "${ref.title}" was deleted or renamed here. Deleting rules is done on the website; a renamed one is sent as a new rule.`);
    }
    if (after.preamble !== before.preamble) notes.push(`${cached.path}: edits outside the "### " sections are axiomic's own text and are ignored.`);
  }
  return { changes, notes };
}
