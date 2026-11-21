/**
 * The command router: turns `axiomic <command> [flags]` into a call to the right command and an exit code.
 * Each command lives in its own file under commands/; the session hook's entry is hook/entry.ts.
 *
 * Exit codes: 0 = fine, 1 = the command failed or isn't available, 2 = the command line was wrong.
 */
import { loginCommand, logoutCommand, whoamiCommand } from "./commands/account";
import { UsageError, type CliContext, type Command } from "./commands/context";
import { diffCommand } from "./commands/diff";
import { hookCommand } from "./commands/hook";
import { initCommand } from "./commands/init";
import { pullCommand } from "./commands/pull";
import { pushCommand } from "./commands/push";
import { removeCommand } from "./commands/remove";
import { statusCommand } from "./commands/status";
import { runHookEntry } from "./hook/entry";
import { VERSION } from "./version";

export type { CliContext } from "./commands/context";

/** Commands that exist in the plan but are NOT in this build yet: no fake versions. */
export const NOT_AVAILABLE = ["import"] as const;

export const HELP = `axiomic ${VERSION}
Private, team-controlled AI rule files.

Usage: axiomic <command> [options]

Getting started:
  login                     Log in through your browser (you approve a code on the website)
      --api-url <url>       Use another axiomic server (default: AXIOMIC_API_URL, or the built-in one)
      --no-browser          Don't open the browser; just print the address
  init [<space>/<project>]  Link this repo to a project and write its rules (run at the top of the repo).
                            Without a project: list the ones you can link.
  pull                      Fetch your combined rules and write them (as gitignored files)
      --quiet               Print only problems
      --force               Also overwrite rule files that were edited locally
  push                      Show which of your edits to the rule files would be sent
      --yes                 Send them: saved if you own that layer, otherwise a suggestion
  diff                      Show how your rule files differ from the server (exit 1 if they do)
  whoami                    Show who you are logged in as, and on which server
  logout                    Revoke this computer's login token and delete it

Local commands (no network):
  status                    Show what axiomic manages in this project and on this computer
      --json                Print the raw report as JSON
  remove                    Undo what axiomic did in this project
      --dry-run             Show what would happen, change nothing
      --force               Also delete rule files that were edited locally
      --hook                Also remove the Claude Code hook (shared by all projects)
      --credentials         Also delete the saved login (shared by all projects)
      --all                 Same as --hook --credentials
  hook install              Add the SessionStart hook to Claude Code's user settings
  hook uninstall            Remove it (your other hooks are untouched)
  hook status               Show whether it is installed and still works
      --dry-run             (install/uninstall) Show what would happen, change nothing

Not available in this build yet:
  ${NOT_AVAILABLE.join(", ")}

Options:
  -v, --version             Print the version
  -h, --help                Print this help
`;

const COMMANDS: Record<string, Command> = {
  login: loginCommand,
  logout: logoutCommand,
  whoami: whoamiCommand,
  init: initCommand,
  pull: pullCommand,
  push: pushCommand,
  diff: diffCommand,
  status: statusCommand,
  remove: removeCommand,
  hook: hookCommand,
};

const HELP_WORDS = new Set(["--help", "-h", "help"]);
const VERSION_WORDS = new Set(["--version", "-v"]);

export async function runCli(ctx: CliContext): Promise<number> {
  const [command, ...rest] = ctx.argv;

  // The hook path comes first and is handled separately: it must never print to stdout or fail.
  if (command === "hook" && rest[0] === "session-start") return runHookEntry(ctx);

  try {
    if (command === undefined || HELP_WORDS.has(command)) {
      ctx.stdout(HELP);
      return 0;
    }
    if (VERSION_WORDS.has(command)) {
      ctx.stdout(VERSION + "\n");
      return 0;
    }
    if ((NOT_AVAILABLE as readonly string[]).includes(command)) {
      ctx.stderr(`axiomic ${command}: not available in this build yet.\n`);
      return 1;
    }
    const run = Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : undefined;
    if (!run) throw new UsageError(`Unknown command: ${command}`);
    return await run(ctx, rest);
  } catch (error) {
    if (error instanceof UsageError) {
      ctx.stderr(`axiomic: ${error.message}\nRun "axiomic --help" to see the commands.\n`);
      return 2;
    }
    // Our own errors are written to be read by people, and never contain a token. No stack trace.
    ctx.stderr(`axiomic: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
