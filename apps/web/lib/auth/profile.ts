import "server-only";
import type { VerifiedClaims } from "./claims";
import { pgCode, withUser } from "@/lib/db";

/** The signed-in person's name card, for the account menu. */
export type Me = { displayName: string; email: string | null };

/**
 * Read from public.profiles under RLS (profiles_read lets you read your own row).
 * Not from the sign-in pass: pickClaims keeps only 6 fields on purpose (DB-DESIGN S2),
 * and a name in the pass would be out of date until the next sign-in.
 * Returns a neutral fallback if the row is missing or the database is down: the menu
 * (and its sign-out button) must still render.
 */
export async function getMe(claims: VerifiedClaims): Promise<Me> {
  try {
    const [row] = await withUser(claims, (tx) => tx<{ display_name: string; email: string | null }[]>`
      select display_name, email from public.profiles where id = auth.uid()`);
    if (row) return { displayName: row.display_name, email: row.email };
  } catch (e) {
    console.error("profile read failed:", pgCode(e) ?? "unknown");
  }
  return { displayName: "Your account", email: null };
}
