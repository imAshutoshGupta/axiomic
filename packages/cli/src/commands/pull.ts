/**
 * `axiomic pull`: fetch the combined rules for the linked project and write them as gitignored files.
 * It fetches first and writes second, so a project you can't reach changes nothing on disk.
 */
import type { WriteReport } from "../local-files/writer";
import type { PullAnswer } from "../server/endpoints";
import { applyRules, fetchRules, isAccessGone, removeProjectRules } from "../sync/rules-sync";
import { parseFlags, type CliContext } from "./context";
import { formatPullReport } from "./format";
import { openLinkedProject, projectDeps, SERVER_TIMEOUT_MS, type ProjectDeps } from "./linked-project";

/** Thrown when the server says no (401/404) and the project's rule files were removed because of it. */
export class AccessGoneError extends Error {
  constructor(
    message: string,
    readonly report: WriteReport,
  ) {
    super(message);
  }
}

export interface PullOutcome {
  root: string;
  answer: PullAnswer;
  report: WriteReport;
}

export async function pullCommand(ctx: CliContext, args: string[]): Promise<number> {
  const { values } = parseFlags(args, { quiet: { type: "boolean" }, force: { type: "boolean" } });
  try {
    const { answer, report } = await pullProject(projectDeps(ctx), { force: values.force ?? false });
    if (!values.quiet) ctx.stdout(formatPullReport(report, answer));
    return 0;
  } catch (error) {
    if (error instanceof AccessGoneError && error.report.keptModified.length > 0) {
      ctx.stderr(`axiomic: kept because you edited them (delete them yourself): ${error.report.keptModified.join(", ")}\n`);
    }
    throw error;
  }
}

export async function pullProject(deps: ProjectDeps, options: { force?: boolean } = {}): Promise<PullOutcome> {
  const { root, realRoot, config, auth } = await openLinkedProject(deps);
  try {
    const answer = await fetchRules({ auth, fetch: deps.fetch, config, timeoutMs: SERVER_TIMEOUT_MS });
    const report = await applyRules({ auth, realRoot, config, dirs: deps.dirs, ...(options.force ? { force: true } : {}) }, answer);
    return { root, answer, report };
  } catch (error) {
    if (!isAccessGone(error)) throw error;
    // Offboarding: no valid login, or no access to this project any more → its rule files go.
    const report = await removeProjectRules({ realRoot, dirs: deps.dirs });
    const reason = (error as Error).message.replace(/\.$/, "");
    throw new AccessGoneError(`${reason}. axiomic removed this project's rule files from this computer.`, report);
  }
}
