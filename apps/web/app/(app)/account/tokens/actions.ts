"use server";

/**
 * Server actions for /account/tokens (DECISIONS #46). Next.js only accepts server actions
 * posted from our own origin, and each one re-checks the signed-in session itself.
 * The database decides the rest: api.issue_token refuses CLI tokens (website only) and
 * api.revoke_token refuses anyone else's token.
 */
import { revalidatePath } from "next/cache";
import { getVerifiedClaims } from "@/lib/auth/session";
import { pgCode, withUser } from "@/lib/db";
import { isUuid } from "@/lib/input";

export type CreateState = { token?: string; error?: string };

export async function createCliToken(_prev: CreateState, formData: FormData): Promise<CreateState> {
  const claims = await getVerifiedClaims();
  if (!claims) return { error: "Your sign-in has expired. Sign in again." };

  const raw = formData.get("name");
  const name = typeof raw === "string" ? raw.trim().slice(0, 100) : "";
  try {
    const [row] = await withUser(claims, (tx) => tx<{ r: { token: string } }[]>`
      select api.issue_token('cli', null, ${name || "CLI token"}) as r`);
    revalidatePath("/account/tokens");
    // Returned once to this browser and never stored in plain text anywhere.
    return { token: row!.r.token };
  } catch (e) {
    console.error("create token failed:", pgCode(e) ?? "unknown");
    return { error: "We couldn't create a token. Please try again." };
  }
}

export async function revokeCliToken(formData: FormData): Promise<void> {
  const claims = await getVerifiedClaims();
  if (!claims) return;
  const id = formData.get("id");
  if (typeof id !== "string" || !isUuid(id)) return;
  try {
    await withUser(claims, (tx) => tx`select api.revoke_token(${id})`);
  } catch (e) {
    console.error("revoke token failed:", pgCode(e) ?? "unknown");
  }
  revalidatePath("/account/tokens");
}
