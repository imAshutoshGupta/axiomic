import { apiError, fail, requireToken } from "@/lib/api/route-helpers";
import { withUser } from "@/lib/db";

/**
 * DELETE /api/v1/token   (Bearer token)
 * Revokes the very token that sent this request: `axiomic logout`, and the old token after a
 * new `axiomic login` (rotation, #55). 204 on success. Agent keys are read-only (D8), so they
 * get 403: they are revoked on the website by a project editor.
 * api.revoke_token checks again that the token belongs to the caller.
 */
export const dynamic = "force-dynamic";

export async function DELETE(request: Request): Promise<Response> {
  try {
    const auth = await requireToken(request);
    if (auth instanceof Response) return auth;
    if (auth.claims.axm_kind !== "cli") return fail(403, "agent keys are revoked on the website");
    await withUser(auth.claims, (tx) => tx`select api.revoke_token(${auth.tokenId})`);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return apiError("revoke token", e);
  }
}
