/**
 * The CLI facts shown on /docs/cli. This is the ONE place to correct when the CLI changes.
 * Source of truth: `axiomic --help` of the built CLI (packages/cli/src/cli.ts) and the modules it calls.
 * "available": works in the current build, with no server.
 * "in-progress": built and tested, also against the hosted server in private testing (#68); no public install yet.
 * "coming": not built yet.
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
  status: "available" | "in-progress" | "coming";
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
  {
    usage: "login",
    example: ["axiomic login", "# on a computer without a browser", "axiomic login --no-browser"],
    status: "in-progress",
    summary:
      "Sign in through the browser. The terminal shows a short code; you open the axiomic website, sign in, type the code and approve. The terminal then gets its own token, saved in the config folder (readable only by you), never in the project.",
    details: [
      "You always type the code yourself, and the page shows which device asked, so a link someone sends you cannot log in their terminal as you.",
      "Logging in again revokes the token it replaces.",
      "The token is sent only to the server it came from, in the Authorization header.",
    ],
    flags: [
      { flag: "--api-url <url>", summary: "Log in to another axiomic server (https only, http only for localhost)." },
      { flag: "--no-browser", summary: "Don't open the browser; just print the address." },
    ],
  },
  {
    usage: "init",
    example: ["# list the projects you can link", "axiomic init", "# link this repo (run at the top of the repo)", "axiomic init acme/web-app"],
    status: "in-progress",
    summary:
      "Link this repo to a project: writes axiomic.json (the space and project names only, no secrets), writes your rules and installs the session hook. Commit axiomic.json: in a repo that already has it, a teammate's axiomic init needs no project name.",
    details: [
      "Checks that you can read the project before writing anything, so a wrong name changes nothing.",
      "Without a project name, it lists the projects you can link and changes nothing.",
    ],
  },
  {
    usage: "pull",
    example: ["axiomic pull", "axiomic pull --quiet"],
    status: "in-progress",
    summary:
      "Fetch your combined rules, write them as gitignored files and keep a private offline copy. The session hook does the same at every Claude Code start, falling back to the offline copy if the server is slow or unreachable.",
    details: [
      "Rule files you edited are kept and reported, not overwritten.",
      "If your login was revoked or you lost access to the project, the rule files axiomic wrote are deleted from this computer.",
    ],
    flags: [
      { flag: "--quiet", summary: "Print only problems." },
      { flag: "--force", summary: "Also overwrite rule files that were edited locally." },
    ],
  },
  {
    usage: "whoami",
    example: ["axiomic whoami"],
    status: "in-progress",
    summary: "Show who you are logged in as, the server, and the token in use (its first characters only).",
  },
  {
    usage: "logout",
    example: ["axiomic logout"],
    status: "in-progress",
    summary: "Revoke this computer's token on the server and delete it. If the server can't be reached, the token is still deleted and you are told to revoke it on the website.",
  },
  {
    usage: "push",
    example: ["# see what would be sent", "axiomic push", "# send it", "axiomic push --yes"],
    status: "in-progress",
    summary:
      "Send your edits to the rule files back to axiomic. Each edited or added \"### Title\" section is one change: saved directly if you own that layer (your personal rules, or a project you own), otherwise sent to the owner as a suggestion. Without --yes it only shows what it would send.",
    details: [
      "Every change goes through the safety check first; a secret or hidden text is refused before anything is stored.",
      "If someone changed that rule since your last pull, it is not sent: pull first, then redo your edit.",
      "Deleting a section doesn't delete the rule: do that on the website. Locked rules can't be changed this way.",
      "Company rules edited by an admin become suggestions too: admin changes happen on the website.",
      "At most 20 changes per push. Afterwards it pulls, so saved rules come back in the server's own form.",
    ],
    flags: [{ flag: "--yes", summary: "Send the changes (without it, only show them)." }],
  },
  {
    usage: "diff",
    example: ["axiomic diff", "# in a script: exit 1 means different", "axiomic diff > /dev/null || echo changed"],
    status: "in-progress",
    summary:
      "Show how your rule files differ from what the server would send now: lines starting with - are the server's, + are yours. Writes nothing. Exits 0 when they match, 1 when they don't.",
  },
  {
    usage: "import",
    status: "coming",
    summary: "Bring an existing CLAUDE.md into axiomic and print the steps to remove it from Git.",
  },
];

/** What the CLI does when a command that isn't built yet is typed. */
export const NOT_AVAILABLE_NOTE =
  "In this build the import command prints “not available in this build yet” and exits with code 1. There is no stand-in version.";

export const EXIT_CODES: { code: number; meaning: string }[] = [
  { code: 0, meaning: "It worked, or you asked for help or the version." },
  {
    code: 1,
    meaning:
      "The command failed or is not available in this build. For status: Git tracks or would not ignore a rule file, or a section reported an error. For init without a project: nothing was linked yet. For diff: the files differ. For push --yes: a change was refused or conflicted.",
  },
  { code: 2, meaning: "The command line was wrong: an unknown command, an unknown flag or a stray word." },
];

/** Where axiomic keeps its own files on this computer, never inside a project. Taken from packages/cli/src/dirs.ts. */
export const CLI_FOLDERS: { name: string; holds: string; unix: string; windows: string }[] = [
  {
    name: "Config",
    holds: "The saved login (credentials.json), readable only by you.",
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
