import { LAYERS, type Layer } from "./layers";
import type { BlockedRule, MergeInput, MergeResult, MergedModule, MergedRule, Rule } from "./rules";

/** Characters you can't see, e.g. zero-width spaces. Someone could hide them in a title to dodge a lock. */
const INVISIBLE = /[­​-‏⁠-⁤﻿]/g;

/**
 * Turns a title into a comparison key, so "  Deploys", "deploys" and "Dep​loys" all count as the same topic.
 */
export function titleKey(title: string): string {
  return title
    .normalize("NFKC") // make look-alike characters identical (e.g. full-width letters)
    .replace(INVISIBLE, "") // drop invisible characters
    .trim() // drop spaces at the start and end
    .replace(/\s+/g, " ") // squash repeated spaces into one
    .toLowerCase();
}

/** Remembers which layer currently owns a topic, and whether a locked rule guards it. */
interface Holder {
  layer: Layer;
  ruleId: string;
  lockedRuleId: string | undefined;
}

/** Combines every layer for one developer in one project. */
export function merge(input: MergeInput): MergeResult {
  let main: MergedRule[] = [];
  const blocked: BlockedRule[] = [];
  const holders = new Map<string, Holder>(); // title key → who owns it

  /** Adds one work rule (company, team or project), replacing or blocking as needed. */
  function addWorkRule(layer: Layer, rule: Rule, locked: boolean) {
    const key = titleKey(rule.title);
    const holder = holders.get(key);

    if (holder && holder.layer !== layer) {
      if (holder.lockedRuleId) {
        blocked.push({ ruleId: rule.id, source: layer, title: rule.title, blockedById: holder.lockedRuleId, reason: "locked" });
        return;
      }
      // A narrower layer replaces the wider one: remove the old rules on this topic.
      main = main.filter((r) => titleKey(r.title) !== key);
      holders.delete(key);
    }

    const current = holders.get(key);
    holders.set(key, {
      layer,
      ruleId: current?.ruleId ?? rule.id,
      lockedRuleId: current?.lockedRuleId ?? (locked ? rule.id : undefined),
    });
    main.push(toMerged(rule, layer, locked));
  }

  for (const rule of input.company) addWorkRule("company", rule, rule.locked);
  for (const rule of input.team) addWorkRule("team", rule, rule.locked);
  for (const rule of input.project) addWorkRule("project", rule, false);

  // Folder (module) rules: each folder gets its own list. Inside its folder, a module rule
  // wins over a project/team/company rule with the same title, which still applies everywhere else.
  const modules: MergedModule[] = [];
  const moduleTitles = new Map<string, string>(); // title key → first module rule id

  for (const mod of input.modules) {
    const rules: MergedRule[] = [];
    for (const rule of mod.rules) {
      const key = titleKey(rule.title);
      const lockedRuleId = holders.get(key)?.lockedRuleId;
      if (lockedRuleId) {
        blocked.push({ ruleId: rule.id, source: "module", title: rule.title, blockedById: lockedRuleId, reason: "locked" });
        continue;
      }
      if (!moduleTitles.has(key)) moduleTitles.set(key, rule.id);
      rules.push(toMerged(rule, "module", false));
    }
    // A folder whose rules were all blocked gets no file.
    if (rules.length > 0) modules.push({ id: mod.id, name: mod.name, path: mod.path, rules });
  }

  // Personal rules only add new topics. They never replace a work rule, including folder rules.
  for (const rule of input.personal) {
    const key = titleKey(rule.title);
    const holder = holders.get(key);
    const clashId = holder ? (holder.lockedRuleId ?? holder.ruleId) : moduleTitles.get(key);
    if (clashId) {
      blocked.push({ ruleId: rule.id, source: "personal", title: rule.title, blockedById: clashId, reason: "personal-adds-only" });
      continue;
    }
    main.push(toMerged(rule, "personal", false));
  }

  // Final order strictly follows the hierarchy: company → team → project → personal.
  // (Folder rules live in their own files.) Inside each layer, locked rules come first.
  const ordered = LAYERS.flatMap((layer) => [
    ...main.filter((r) => r.source === layer && r.mandatory),
    ...main.filter((r) => r.source === layer && !r.mandatory),
  ]);

  return { main: ordered, modules, blocked };
}

/** Copies only the fields we know about, so nothing extra from the database leaks into the output. */
function toMerged(rule: Rule, source: Layer, mandatory: boolean): MergedRule {
  return { id: rule.id, title: rule.title, body: rule.body, source, mandatory };
}
