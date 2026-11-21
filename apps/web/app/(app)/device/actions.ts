"use server";

/**
 * Server actions for /device: approving a CLI login (DECISIONS #55, #58).
 * Two steps, so you see WHAT you are approving before you approve it:
 *   1. check:   look the code up (api.peek_device_code) → show device info + time
 *   2. approve: api.approve_device_code, after api.rate_limit('device_approve') (10 per 10 min)
 * Next.js only accepts server actions posted from our own origin; each action re-checks the
 * session. The database refuses CLI tokens here (website session only).
 */
import { getVerifiedClaims } from "@/lib/auth/session";
import { pgCode, withUser } from "@/lib/db";
import { normalizeUserCode } from "@/lib/api/user-code";

export type DeviceState =
  | { step: "enter"; error?: string }
  | { step: "confirm"; code: string; clientInfo: string; createdAt: string }
  | { step: "done" };

const NOT_VALID = "That code is not valid, or it has expired. Run axiomic login again for a new one.";

function friendly(e: unknown): string {
  const code = pgCode(e);
  if (code === "AX429") return "Too many tries. Wait 10 minutes and try again.";
  if (code === "22023") return NOT_VALID;
  console.error("device approve failed:", code ?? "unknown");
  return "Something went wrong. Please try again.";
}

export async function checkCode(_prev: DeviceState, formData: FormData): Promise<DeviceState> {
  const claims = await getVerifiedClaims();
  if (!claims) return { step: "enter", error: "Your sign-in has expired. Sign in again." };
  const code = normalizeUserCode(formData.get("code"));
  if (!code) return { step: "enter", error: "Type the 8 characters shown in your terminal, like ABCD-1234." };
  try {
    // Looking a code up counts too, so nobody can guess codes by checking them one by one.
    // Its own transaction: a wrong code raises an error, which would roll the count back.
    await withUser(claims, (tx) => tx`select api.rate_limit('device_approve', 'web')`);
    const [row] = await withUser(claims, (tx) => tx<{ r: { client_info: string | null; created_at: string } }[]>`
      select api.peek_device_code(${code}) as r`);
    return { step: "confirm", code, clientInfo: row!.r.client_info ?? "unknown device", createdAt: row!.r.created_at };
  } catch (e) {
    return { step: "enter", error: friendly(e) };
  }
}

export async function approveCode(_prev: DeviceState, formData: FormData): Promise<DeviceState> {
  const claims = await getVerifiedClaims();
  if (!claims) return { step: "enter", error: "Your sign-in has expired. Sign in again." };
  const code = normalizeUserCode(formData.get("code"));
  if (!code) return { step: "enter", error: NOT_VALID };
  try {
    await withUser(claims, (tx) => tx`select api.rate_limit('device_approve', 'web')`); // own transaction, see above
    await withUser(claims, (tx) => tx`select api.approve_device_code(${code})`);
    return { step: "done" };
  } catch (e) {
    return { step: "enter", error: friendly(e) };
  }
}

/** The one action the page uses: the hidden "intent" field says which step this is. */
export async function deviceAction(prev: DeviceState, formData: FormData): Promise<DeviceState> {
  return formData.get("intent") === "approve" ? approveCode(prev, formData) : checkCode(prev, formData);
}
