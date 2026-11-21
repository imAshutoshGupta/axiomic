/**
 * The only facts about a signed-in person the rest of the app may use.
 * These are copied into the database later by withUser() (step 6c); nothing else is (DB-DESIGN S2).
 *
 * Pure code (no cookies, no network), so it can be unit-tested. The server-only part is lib/auth/session.ts.
 */
export type VerifiedClaims = {
  sub: string; // user id (auth.users.id = profiles.id)
  role: "authenticated";
  aal: "aal1" | "aal2"; // aal2 = passed two-factor; is_admin() needs it in work spaces
  amr: unknown[]; // how they signed in (e.g. oauth, totp), passed through as-is
  session_id: string; // checked against auth.sessions for risky actions (T5)
  iat: number; // when this pass was issued (seconds)
};

/** Keep the six allowed fields, and refuse anything that doesn't look right. */
export function pickClaims(c: Record<string, unknown>): VerifiedClaims | null {
  const { sub, role, aal, amr, session_id, iat } = c;
  if (typeof sub !== "string" || sub === "") return null;
  if (role !== "authenticated") return null;
  if (aal !== "aal1" && aal !== "aal2") return null;
  if (typeof session_id !== "string" || session_id === "") return null;
  if (typeof iat !== "number") return null;
  return { sub, role, aal, amr: Array.isArray(amr) ? amr : [], session_id, iat };
}
