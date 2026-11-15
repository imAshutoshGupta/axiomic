import { withUser } from "../../../../lib/db";
import { readPull } from "../../../../lib/pull";
import { keyring } from "../../../../lib/rule-keys";
import { claimsFromBearer } from "../../../../lib/tokens";

/**
 * GET /api/v1/pull?project=<uuid>
 * Header: Authorization: Bearer axm_…   (never in the URL)
 * Optional header: X-Axiomic-CLI-Version: 1.0.0
 *
 * 200 { project, versions, files, blocked } · 400 bad project id · 401 no/invalid token
 * 404 project not found or no access · 409 archived · 500/503 server trouble.
 * Error bodies are fixed short texts: no stack traces, no database messages.
 */
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLI_VERSION = /^[0-9A-Za-z.+-]{1,40}$/;
const NO_STORE = { "Cache-Control": "no-store" };

function fail(status: number, error: string, extra: Record<string, string> = {}) {
  return Response.json({ error }, { status, headers: { ...NO_STORE, ...extra } });
}

export async function GET(request: Request): Promise<Response> {
  const projectId = new URL(request.url).searchParams.get("project");
  if (!projectId || !UUID.test(projectId)) return fail(400, "project must be a project id");

  const v = request.headers.get("x-axiomic-cli-version");
  const cliVersion = v && CLI_VERSION.test(v) ? v : null;

  try {
    const claims = await claimsFromBearer(request.headers.get("authorization"));
    if (!claims) return fail(401, "sign in again: missing or invalid token", { "WWW-Authenticate": "Bearer" });

    const result = await withUser(claims, (tx) => readPull(tx, keyring(), projectId, cliVersion), { snapshot: true });
    if (!result.ok) return fail(result.status, result.error);
    return Response.json(result.body, { headers: NO_STORE });
  } catch (e) {
    // Log only a short reason: never the token, the claims or rule text.
    const code = (e as { code?: string } | null)?.code;
    console.error("pull failed:", code ?? (e instanceof Error ? e.message.slice(0, 200) : "unknown"));
    if (code === "ECONNREFUSED" || code === "CONNECT_TIMEOUT" || code === "40001") return fail(503, "try again shortly");
    return fail(500, "server error");
  }
}
