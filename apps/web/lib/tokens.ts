import "server-only";
import { withServer, type TokenClaims } from "./db";
import { hashToken, parseBearer } from "./token-format";

/**
 * Who is calling with this Authorization header? Returns the claims withUser() needs, or
 * null (→ the route answers 401). The token itself never goes to the database or a log:
 * only its hash. private.resolve_token refuses revoked, expired and long-unused tokens.
 */
export async function claimsFromBearer(header: string | null): Promise<TokenClaims | null> {
  const token = parseBearer(header);
  if (!token) return null;
  const rows = await withServer(
    (tx) => tx<{ user_id: string; kind: "cli" | "agent"; project_id: string | null }[]>`
      select user_id, kind, project_id from private.resolve_token(${hashToken(token)})`,
  );
  const row = rows[0];
  if (!row) return null;
  const claims: TokenClaims = { sub: row.user_id, role: "authenticated", axm_kind: row.kind };
  if (row.kind === "agent") {
    if (!row.project_id) return null; // agent keys always have a project; refuse if not
    claims.axm_project_id = row.project_id;
  }
  return claims;
}
