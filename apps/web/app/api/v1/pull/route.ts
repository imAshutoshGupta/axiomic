import { isValidSlug } from "@axiomic/shared";
import { apiError, cliVersionOf, fail, ok, requireToken } from "../../../../lib/api";
import { withUser } from "../../../../lib/db";
import { readPull } from "../../../../lib/pull";
import { keyring } from "../../../../lib/rule-keys";

/**
 * GET /api/v1/pull?space=<slug>&project=<slug>[&dry=1]   (the two slugs from axiomic.json, #56)
 * dry=1: only looking (axiomic diff): the same answer, but not recorded as a pull you received.
 * Header: Authorization: Bearer axm_…   (never in the URL)
 * Optional header: X-Axiomic-CLI-Version: 1.0.0
 *
 * 200 { project, versions, files, blocked } · 400 bad slugs · 401 no/invalid token
 * 404 project not found or no access · 409 archived · 429 too many · 500/503 server trouble.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const space = params.get("space");
  const project = params.get("project");
  if (!isValidSlug(space) || !isValidSlug(project)) return fail(400, "space and project must be slugs like acme and web-app");

  try {
    const auth = await requireToken(request);
    if (auth instanceof Response) return auth;
    const result = await withUser(auth.claims, (tx) => readPull(tx, keyring(), { space, project }, cliVersionOf(request), params.get("dry") !== "1"), { snapshot: true });
    if (!result.ok) return fail(result.status, result.error);
    return ok(result.body);
  } catch (e) {
    return apiError("pull", e);
  }
}
