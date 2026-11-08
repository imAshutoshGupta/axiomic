import type { Layer } from "./layers";

/** One rule, written by a person on the website. */
export interface Rule {
  /** Unique id from the database. */
  id: string;
  /** Short topic, e.g. "Testing". A narrower layer with the same title replaces this rule (personal rules can't). */
  title: string;
  /** The rule text itself, in Markdown. */
  body: string;
}

/** Company and team rules can be locked. A locked rule can't be replaced by any narrower layer. */
export interface LockableRule extends Rule {
  locked: boolean;
}

/** A folder inside a project that has its own rules, e.g. the payments folder. */
export interface ModuleInfo {
  id: string;
  /** Short name used in the file name: "payments" becomes axiomic-payments.md */
  name: string;
  /** Folder path from the repo root, e.g. "src/payments" */
  path: string;
}

export interface Module extends ModuleInfo {
  rules: Rule[];
}

/** Everything that applies to ONE developer in ONE project. */
export interface MergeInput {
  company: LockableRule[];
  team: LockableRule[];
  project: Rule[];
  modules: Module[];
  personal: Rule[];
}

/** A rule in the final output, labelled with the layer it came from. */
export interface MergedRule extends Rule {
  source: Layer;
  /** True for locked company/team rules. These go first and are marked mandatory. */
  mandatory: boolean;
}

/** A rule that was dropped because it tried to replace a rule it isn't allowed to replace. */
export interface BlockedRule {
  ruleId: string;
  source: Layer;
  title: string;
  /** The rule it clashed with. */
  blockedById: string;
  /** "locked": the other rule is locked. "personal-adds-only": personal rules can't replace work rules. */
  reason: "locked" | "personal-adds-only";
}

export interface MergedModule extends ModuleInfo {
  rules: MergedRule[];
}

/** The combined result for one developer. */
export interface MergeResult {
  /** Company + team + project + personal: goes into axiomic.md / axiomic.mdc */
  main: MergedRule[];
  /** One entry per folder: goes into axiomic-<name>.md / .mdc */
  modules: MergedModule[];
  /** Rules dropped because they clashed with another rule. */
  blocked: BlockedRule[];
}
