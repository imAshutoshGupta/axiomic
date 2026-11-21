/**
 * Every product capability, for /product and /roadmap. The ONE place to change a status.
 * Status rules (DECISIONS #25, updated #81 once the hosted service went live):
 *  - "local" (shown "Available"): built, tested and usable today, on the laptop or on the live site.
 *  - "in-progress": built or being built, but not usable for real yet (e.g. waits for two-factor sign-in).
 *  - "soon": decided and waiting on a small check (Cursor: the gitignore test in docs/TOOLS.md).
 *  - "planned": decided in docs/PLAN.md, not written yet.
 * Never mark something "local" without code and tests behind it. `short` is one line, no more.
 */
import type { Status } from "../components/ui/status-badge";

export type Feature = {
  /** Anchor id on /product. */
  id: string;
  name: string;
  /** One short line: what it does for you. */
  short: string;
  status: Status;
};

export type FeatureCategory = {
  id: string;
  title: string;
  /** One emoji, shown beside the title. */
  emoji: string;
  features: Feature[];
};

export const FEATURE_CATEGORIES: FeatureCategory[] = [
  {
    id: "layers",
    title: "Layers",
    emoji: "🧱",
    features: [
      { id: "five-layers", name: "Five layers, one file", short: "Company, team, project, folder and personal rules, combined per person.", status: "local" },
      { id: "locked-rules", name: "Locked rules", short: "Rules no narrower layer can replace, placed first as MANDATORY.", status: "local" },
      { id: "personal-rules", name: "Personal rules", short: "Your own preferences, which never override a work rule.", status: "local" },
      { id: "folder-rules", name: "Folder rules", short: "Rules for one folder, loaded only while working there.", status: "local" },
      { id: "tamper-proof-format", name: "A format rules can't fake", short: "No rule can pose as a company rule or hide the ones after it.", status: "local" },
    ],
  },
  {
    id: "safety",
    title: "Safety check",
    emoji: "🛡️",
    features: [
      { id: "secret-scan", name: "Secret scanning", short: "Keys, tokens, passwords and database URLs are blocked.", status: "local" },
      { id: "hidden-characters", name: "Hidden characters", short: "Invisible-text tricks are blocked; emoji and Indian scripts work.", status: "local" },
      { id: "injection-hints", name: "Prompt-injection warnings", short: "“Ignore previous instructions” and similar get flagged.", status: "local" },
      { id: "label-imitation", name: "No fake labels", short: "Rules can't imitate axiomic's MANDATORY labels or headings.", status: "local" },
      { id: "size-limits", name: "Size limits", short: "A warning before rules crowd the AI's context.", status: "local" },
      { id: "publish-gate", name: "Checked on every save", short: "On the website and on axiomic push, including clashes with locked rules.", status: "local" },
    ],
  },
  {
    id: "delivery",
    title: "On the laptop",
    emoji: "💻",
    features: [
      { id: "session-hook", name: "Claude Code session hook", short: "Fresh rules at every session start. Nothing to run.", status: "local" },
      { id: "server-sync", name: "Sync from the server", short: "The latest combined rules, with the last copy kept for offline use.", status: "local" },
      { id: "fail-open", name: "Never blocks a session", short: "A slow network or server never delays Claude Code.", status: "local" },
      { id: "gitignore", name: "Verified gitignore", short: "Git itself confirms the files are ignored, or nothing is written.", status: "local" },
      { id: "never-claude-md", name: "Your CLAUDE.md stays yours", short: "axiomic writes only its own files in .claude/rules/.", status: "local" },
      { id: "edit-detection", name: "Edit locally, push back", short: "axiomic push sends your edits; axiomic diff shows them.", status: "local" },
      { id: "clean-undo", name: "Clean undo", short: "axiomic remove takes away exactly what axiomic added.", status: "local" },
    ],
  },
  {
    id: "control",
    title: "Team control",
    emoji: "👥",
    features: [
      { id: "editor", name: "Rule editor", short: "See each layer and the combined file; edit the layers you own.", status: "local" },
      { id: "suggestions", name: "Suggestions and approvals", short: "Changes to someone else's layer wait for the owner's OK.", status: "local" },
      { id: "storage", name: "Encrypted, versioned storage", short: "Every version kept, encrypted, in Mumbai, India.", status: "local" },
      { id: "sign-in", name: "GitHub or Google sign-in", short: "No new passwords.", status: "local" },
      { id: "roles", name: "Roles, teams and owners", short: "Admin, editor, reader; team leads; project and folder owners.", status: "in-progress" },
      { id: "invites", name: "Invites", short: "A link that works once, for one email, for 7 days.", status: "in-progress" },
      { id: "revoke", name: "Offboarding", short: "Remove a person and their laptop drops the rules at the next session.", status: "in-progress" },
      { id: "two-factor", name: "Two-factor sign-in for admins", short: "Unlocks inviting and admin tools in company spaces.", status: "planned" },
      { id: "history", name: "History and rollback", short: "Who changed what, and one-click return to an older version.", status: "planned" },
      { id: "alerts", name: "Publish alerts", short: "An email on every publish.", status: "planned" },
      { id: "import", name: "Import CLAUDE.md files", short: "Move existing rules into axiomic, then out of Git.", status: "planned" },
    ],
  },
  {
    id: "tools",
    title: "AI tools",
    emoji: "🤖",
    features: [
      { id: "claude-code", name: "Claude Code", short: "Loaded from .claude/rules/ like CLAUDE.md. Tested end to end.", status: "local" },
      { id: "cursor", name: "Cursor", short: "The same rules as Cursor project rules.", status: "soon" },
    ],
  },
];

/** Every feature, flattened. */
export const ALL_FEATURES: Feature[] = FEATURE_CATEGORIES.flatMap((c) => c.features);

/** Roadmap columns, in order. Each lists the features with its status, plus a few milestones. */
export const ROADMAP: { status: Status; title: string; extra?: string[] }[] = [
  { status: "local", title: "Available now" },
  { status: "in-progress", title: "In development" },
  { status: "soon", title: "Coming soon" },
  { status: "planned", title: "Planned for 1.0", extra: ["axiomic 1.0 on npm, free"] },
];
