import "server-only";
import { withServer, type TokenClaims } from "@/lib/db";
import { hashToken, parseBearer } from "./token-format";

/** A resolved Bearer token: the claims withUser() needs, plus the token's own id (for logout). */
export interface TokenAuth {
  claims: TokenClaims;
  tokenId: string;
}

/**
 * Who is calling with this Authorization header? Returns null (→ the route answers 401) if
 * nobody. The token itself never goes to the database or a log: only its hash.
 * private.resolve_token refuses revoked, expired and long-unused tokens.
 *
 * In the same short transaction, the request is counted against the token's rate limit
 * (120 a minute, migration 0022). Over the limit → throws a database error with code AX429,
 * which apiError() turns into 429. Counted here, not inside pull's snapshot transaction,
 * so two sessions starting at once never collide on the counter row (DECISIONS #57).
 */
export async function authenticateBearer(header: string | null): Promise<TokenAuth | null> {
  const token = parseBearer(header);
  if (!token) return null;
  const row = await withServer(async (tx) => {
    const [r] = await tx<{ token_id: string; user_id: string; kind: "cli" | "agent"; project_id: string | null }[]>`
      select token_id, user_id, kind, project_id from private.resolve_token(${hashToken(token)})`;
    if (r) await tx`select api.rate_limit('api_token', ${r.token_id})`;
    return r;
  });
  if (!row) return null;
  const claims: TokenClaims = { sub: row.user_id, role: "authenticated", axm_kind: row.kind };
  if (row.kind === "agent") {
    if (!row.project_id) return null; // agent keys always have a project; refuse if not
    claims.axm_project_id = row.project_id;
  }
  return { claims, tokenId: row.token_id };
}
