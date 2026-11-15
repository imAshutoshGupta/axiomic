import "server-only";
import { createSupabaseServerClient } from "./supabase/server";
import { pickClaims, type VerifiedClaims } from "./claims";

export type { VerifiedClaims };

/**
 * Who is making this request, or null if nobody (or we're not sure).
 *
 * getClaims() checks Supabase's signature on the pass (ES256, verified locally with the public
 * key) and its expiry. Never use getSession() for this: it reads the cookie without checking it.
 */
export async function getVerifiedClaims(): Promise<VerifiedClaims | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) return null;
  return pickClaims(data.claims);
}
