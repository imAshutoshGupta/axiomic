/**
 * Every product capability shown on /features and /roadmap. The ONE place to change a status.
 * Status rules (DECISIONS.md #25):
 *  - "local": built and tested in packages/shared or packages/cli, works without a server.
 *  - "in-progress": the server side (database, API, fetch) that is the current build step.
 *  - "soon": decided and waiting on a small check (Cursor: the gitignore test in docs/TOOLS.md).
 *  - "planned": decided in docs/PLAN.md, not written yet.
 * Never mark something "local" without code and tests behind it.
 */
import type { Status } from "../components/ui/status-badge";

export type Feature = {
  /** Anchor id on /features. */
  id: string;
  name: string;
  /** What it does for the team, in one or two sentences. */
  benefit: string;
  status: Status;
};

export type FeatureCategory = {
  id: string;
  /** Small label above the title. */
  eyebrow: string;
  title: string;
  /** One-line promise of the category. */
  summary: string;
  features: Feature[];
};

export const FEATURE_CATEGORIES: FeatureCategory[] = [
  {
    id: "layers",
    eyebrow: "Organise",
    title: "Rule layers and merging",
    summary: "Write a rule once, where it belongs. Every developer gets one combined, conflict-free set.",
    features: [
      {
        id: "five-layers",
        name: "Five layers, combined per person",
        benefit:
          "Company, team, project, folder and personal rules become one file per developer. A narrower rule with the same title replaces the wider one, so a project can refine a team default.",
        status: "local",
      },
      {
        id: "locked-rules",
        name: "Locked company and team rules",
        benefit: "Rules that must hold everywhere can be locked. Narrower layers cannot replace them, and they are placed first, marked MANDATORY.",
        status: "local",
      },
      {
        id: "personal-rules",
        name: "Personal rules that only add",
        benefit: "Developers keep their own preferences, like explanation style, without being able to override a work rule.",
        status: "local",
      },
      {
        id: "folder-rules",
        name: "Folder rules",
        benefit:
          "Rules for one module (say, checkout/) go in their own file that Claude Code loads only while working in that folder. Less noise in every other session.",
        status: "local",
      },
      {
        id: "tamper-proof-format",
        name: "A file format rules cannot fake",
        benefit:
          "Headings inside a rule are pushed down a level, and unclosed code blocks or comments are repaired, so one rule cannot pose as a company rule or hide the rules after it.",
        status: "local",
      },
    ],
  },
  {
    id: "safety",
    eyebrow: "Protect",
    title: "Publish safety check",
    summary: "Every rule is checked before anyone's AI reads it.",
    features: [
      {
        id: "secret-scan",
        name: "Secret scanning",
        benefit:
          "Catches private keys, cloud and API tokens (GitHub, AWS, Stripe, OpenAI, Anthropic, Slack and more), database connection strings and passwords. Placeholders such as YOUR_KEY_HERE are not flagged.",
        status: "local",
      },
      {
        id: "hidden-characters",
        name: "Hidden character detection",
        benefit:
          "Blocks invisible text tricks, such as direction overrides and invisible copies of letters, that hide instructions from a human reviewer. Normal emoji and Indian scripts keep working.",
        status: "local",
      },
      {
        id: "injection-hints",
        name: "Prompt-injection warnings",
        benefit:
          "Flags phrasing that tries to make an AI ignore instructions, change role, hide things from the user or send data elsewhere.",
        status: "local",
      },
      {
        id: "label-imitation",
        name: "Authority imitation checks",
        benefit: "Stops a rule from faking axiomic's own MANDATORY labels or headings, including with look-alike letters.",
        status: "local",
      },
      {
        id: "size-limits",
        name: "Size limits",
        benefit: "Warns before rules get long enough to crowd the AI's context, and blocks files Claude Code would cut off.",
        status: "local",
      },
      {
        id: "publish-gate",
        name: "Checks run on every publish",
        benefit: "The website runs the check when a rule is saved and refuses blocking problems, including clashes with a locked rule.",
        status: "planned",
      },
    ],
  },
  {
    id: "delivery",
    eyebrow: "Deliver",
    title: "Delivery to the laptop",
    summary: "Rules appear when an AI session starts, and Git never sees them.",
    features: [
      {
        id: "session-hook",
        name: "Claude Code session hook",
        benefit:
          "One install covers every project. Rule files are refreshed each time Claude Code starts, resumes or compacts, with no step for the developer.",
        status: "local",
      },
      {
        id: "fail-open",
        name: "Never blocks a session",
        benefit: "Strict time limits and a local copy mean a slow network or server never delays the AI session.",
        status: "local",
      },
      {
        id: "offline-cache",
        name: "Offline copy",
        benefit: "The last rules received are kept privately on the laptop and restored if files are deleted, for example by git clean.",
        status: "local",
      },
      {
        id: "gitignore",
        name: "Verified gitignore",
        benefit:
          "Rule paths are added to an axiomic block in .gitignore (and .dockerignore), then Git itself is asked to confirm. If Git cannot confirm, nothing is written.",
        status: "local",
      },
      {
        id: "never-claude-md",
        name: "Your CLAUDE.md stays yours",
        benefit: "axiomic writes only its own files in .claude/rules/. It never writes CLAUDE.md or AGENTS.md.",
        status: "local",
      },
      {
        id: "edit-detection",
        name: "Local edits are respected",
        benefit: "Files a developer changed are detected and kept, not overwritten. Files axiomic did not write are never touched.",
        status: "local",
      },
      {
        id: "clean-undo",
        name: "Clean undo",
        benefit: "axiomic remove takes away exactly what axiomic added: its files, ignore blocks and cache. Nothing else.",
        status: "local",
      },
      {
        id: "health-check",
        name: "Health check",
        benefit: "axiomic status shows whether the hook works and whether any rule file is tracked by Git or at risk of being committed.",
        status: "local",
      },
      {
        id: "server-sync",
        name: "Sync from the server",
        benefit: "The hook fetches the latest combined rules, only downloading when something changed, and falls back to the offline copy.",
        status: "in-progress",
      },
    ],
  },
  {
    id: "control",
    eyebrow: "Govern",
    title: "Team control",
    summary: "Clear owners for every rule, and access that ends when someone leaves.",
    features: [
      {
        id: "storage",
        name: "Encrypted, versioned storage",
        benefit: "Every published version is kept, hosted in Mumbai, India.",
        status: "in-progress",
      },
      {
        id: "sign-in",
        name: "Sign-in with GitHub or Google",
        benefit: "No new passwords. Two-factor sign-in for admins is planned.",
        status: "local",
      },
      {
        id: "roles",
        name: "Roles and owners",
        benefit: "Admin, editor and reader roles. Each layer has an owner who decides what goes in it.",
        status: "planned",
      },
      {
        id: "suggestions",
        name: "Suggestions and approvals",
        benefit: "Anyone can propose a change, including from their laptop with axiomic push. The layer owner approves it.",
        status: "planned",
      },
      {
        id: "editor",
        name: "Rule editor on the website",
        benefit: "Write and preview rules, see who changed what, and roll back to an earlier version.",
        status: "planned",
      },
      {
        id: "revoke",
        name: "Offboarding",
        benefit: "Removing a person stops their updates, and the CLI deletes the managed files on its next run.",
        status: "planned",
      },
      {
        id: "alerts",
        name: "Publish alerts",
        benefit: "An email on every publish, so no change goes unnoticed.",
        status: "planned",
      },
      {
        id: "import",
        name: "Import existing CLAUDE.md files",
        benefit: "Move the rules already scattered across your repos into axiomic, then take them out of Git.",
        status: "planned",
      },
    ],
  },
  {
    id: "tools",
    eyebrow: "Integrate",
    title: "AI tools",
    summary: "One set of rules, written in each tool's own format.",
    features: [
      {
        id: "claude-code",
        name: "Claude Code",
        benefit: "Rules are written to .claude/rules/, which Claude Code loads like CLAUDE.md. Tested end to end.",
        status: "local",
      },
      {
        id: "cursor",
        name: "Cursor",
        benefit: "The same rules as Cursor project rules, from the same merge.",
        status: "soon",
      },
    ],
  },
];

/** Roadmap stages, in order. Each groups features by status, plus milestones not tied to one feature. */
export const ROADMAP: { status: Status; title: string; text: string; extra?: string[] }[] = [
  {
    status: "local",
    title: "Available today",
    text: "The core: layer merging, the safety check, the file format and the laptop side of the CLI. Built and tested, ready for the server to feed it.",
  },
  {
    status: "in-progress",
    title: "In development",
    text: "The server: storage, the API and the sync that connects the CLI to it.",
    extra: ["CLI commands: login, logout, init, pull, whoami"],
  },
  {
    status: "soon",
    title: "Coming soon",
    text: "Cursor support, once its gitignore behaviour is confirmed.",
  },
  {
    status: "planned",
    title: "Planned for 1.0",
    text: "The website side and team controls, then a pilot with one team before release.",
    extra: ["CLI commands: push, diff, import", "axiomic 1.0 on npm, free"],
  },
];
