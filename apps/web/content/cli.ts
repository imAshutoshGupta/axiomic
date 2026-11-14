/**
 * The CLI facts shown on /docs/cli. This is the ONE place to correct when the CLI changes.
 * Source of truth: `axiomic --help` of the built CLI (packages/cli/src/cli.ts) and the modules it calls.
 * "available": works in the current build, with no server. "coming": needs the server, which is not built yet.
 * Exact flags are still subject to change before 1.0.
 */
export type CliFlag = {
  /** The flag as typed, e.g. "--dry-run". */
  flag: string;
  summary: string;
};

export type CliCommand = {
  /** What the user types, without the leading "axiomic". */
  usage: string;
  /** Other spellings that do the same thing, without the leading "axiomic". */
  aliases?: string[];
  status: "available" | "coming";
  summary: string;
  /** Optional bullet list shown under the summary. */
  details?: string[];
  flags?: CliFlag[];
  /** Example commands (no output shown, so nothing is invented). Lines starting with "#" are comments. */
  example?: string[];
};

export const CLI_COMMANDS: CliCommand[] = [
  { usage: "--version", aliases: ["-v"], status: "available", summary: "Print the installed version." },
  { usage: "--help", aliases: ["-h", "help", "(no command)"], status: "available", summary: "List the commands and flags." },
  {
    usage: "status",
    example: ["axiomic status", "# for scripts and CI", "axiomic status --json"],
    status: "available",
    summary:
      "A local health check, no network. Shows the login, the hook and, for this repo, the ignore blocks, the offline cache and each rule file (ok, edited, missing or not axiomic's). Exits 1 if Git tracks a rule file, would not ignore one or cannot confirm, or if any check fails.",
    flags: [{ flag: "--json", summary: "Print the full report as JSON instead of text. The exit code is the same." }],
  },
  {
    usage: "remove",
    example: ["# preview first", "axiomic remove --dry-run", "axiomic remove"],
    status: "available",
    summary:
      "Undo what axiomic did in this repo, and only that.",
    details: [
      "Deletes the rule files axiomic wrote, leftover temporary files, and the .claude/rules folder if it is then empty.",
      "Rule files you edited are kept unless you use --force.",
      "Files that look like axiomic's but that axiomic did not write are never deleted, even with --force.",
      "Removes the axiomic block from .gitignore and .dockerignore, and this repo's offline cache. While any kept file remains, both blocks stay so it cannot be committed by accident.",
      "A .gitignore or .dockerignore that axiomic created is deleted once only its block is left.",
      "axiomic.json is never removed: it is shared through Git, so run git rm axiomic.json yourself.",
      "The hook and the stored login are shared by every project, so they are removed only with their flags.",
    ],
    flags: [
      { flag: "--dry-run", summary: "Show what would happen and change nothing." },
      { flag: "--force", summary: "Also delete rule files that were edited locally." },
      { flag: "--hook", summary: "Also remove the Claude Code hook." },
      { flag: "--credentials", summary: "Also delete the saved login." },
      { flag: "--all", summary: "Same as --hook --credentials." },
    ],
  },
  {
    usage: "hook install",
    example: ["axiomic hook install --dry-run", "axiomic hook install"],
    status: "available",
    summary:
      "Add the session-start hook to your Claude Code user settings (~/.claude/settings.json). One install covers every project. For safety it only installs from a global location (npm, pnpm or yarn global, nvm, Homebrew and similar), never from npx or a project's node_modules, because the hook runs in every session. On an older Claude Code it does nothing and sessions start normally.",
    flags: [{ flag: "--dry-run", summary: "Show what would change and write nothing." }],
  },
  {
    usage: "hook uninstall",
    example: ["axiomic hook uninstall"],
    status: "available",
    summary: "Remove the hook again. Other hooks in your settings are left alone.",
    flags: [{ flag: "--dry-run", summary: "Show what would change and write nothing." }],
  },
  {
    usage: "hook status",
    example: ["axiomic hook status"],
    status: "available",
    summary:
      "Show whether the hook is installed and still works: the node and axiomic paths it runs, and a PROBLEM line if it is installed more than once, if either path no longer exists, or a note if it points at a different axiomic than the one you are running. Fix any of these with hook install.",
  },
  { usage: "login", status: "coming", summary: "Sign in through the browser and store a token in the config folder." },
  { usage: "logout", status: "coming", summary: "Delete the stored token." },
  {
    usage: "init",
    status: "coming",
    summary: "Link this repo to a project (writes axiomic.json: org and project names only, no secrets) and install the hook.",
  },
  {
    usage: "pull",
    status: "coming",
    summary: "Fetch your combined rules, write and gitignore them, cache them for offline use, and report the version.",
  },
  {
    usage: "push",
    status: "coming",
    summary: "Send local edits as a suggested change, or as a direct edit if you own that layer.",
  },
  { usage: "diff", status: "coming", summary: "Show the difference between the local files and the server." },
  { usage: "whoami", status: "coming", summary: "Show the account, the project and the server URL in use." },
  {
    usage: "import",
    status: "coming",
    summary: "Bring an existing CLAUDE.md into axiomic and print the steps to remove it from Git.",
  },
];

/** What the CLI does when a server command is typed in this build. */
export const NOT_AVAILABLE_NOTE =
  "In this build the commands login, logout, pull, push, whoami, init, diff and import print “not available in this build” and exit with code 1. There are no stand-in versions.";

export const EXIT_CODES: { code: number; meaning: string }[] = [
  { code: 0, meaning: "It worked, or you asked for help or the version." },
  {
    code: 1,
    meaning:
      "The command failed or is not available in this build. For status: Git tracks or would not ignore a rule file, or a section reported an error.",
  },
  { code: 2, meaning: "The command line was wrong: an unknown command, an unknown flag or a stray word." },
];

/** Where axiomic keeps its own files on this computer, never inside a project. Taken from packages/cli/src/dirs.ts. */
export const CLI_FOLDERS: { name: string; holds: string; unix: string; windows: string }[] = [
  {
    name: "Config",
    holds: "The saved login (credentials.json). Planned: login is not built yet.",
    unix: "$XDG_CONFIG_HOME/axiomic, or ~/.config/axiomic",
    windows: "%APPDATA%\\axiomic",
  },
  {
    name: "Cache",
    holds: "The last rules fetched, for offline use.",
    unix: "$XDG_CACHE_HOME/axiomic, or ~/.cache/axiomic",
    windows: "%LOCALAPPDATA%\\axiomic\\cache",
  },
  {
    name: "State",
    holds: "A record of the files axiomic wrote, so it can tell which are its own and which you edited.",
    unix: "$XDG_STATE_HOME/axiomic, or ~/.local/state/axiomic",
    windows: "%LOCALAPPDATA%\\axiomic\\state",
  },
];
