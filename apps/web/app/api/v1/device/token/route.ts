import { apiError, fail, ok } from "@/lib/api/route-helpers";
import { withServer } from "@/lib/db";

/**
 * POST /api/v1/device/token   body: { "device_code": "…" }   (no token yet)
 * The CLI asks every `interval` seconds: "has my code been approved?"
 *
 * 200 { status: "pending" }               not approved yet: ask again later
 * 200 { status: "approved", token }       here is your CLI token (handed out ONCE, then the code is used up)
 * 200 { status: "expired" }               10 minutes passed, or too many polls: start again
 * 200 { status: "invalid" }               unknown or already used code
 * 400 malformed body · 500/503 server trouble.
 *
 * The device code is a secret, so it travels in the POST body, never the URL (URLs end up in
 * logs). api.collect_device_token counts polls per code and refuses after 300 (#55).
 * The token is made at this moment, not at approve, so it is never stored in plain text.
 */
export const dynamic = "force-dynamic";

const DEVICE_CODE = /^[A-Za-z0-9_-]{43}$/; // private.new_secret(): 32 random bytes, URL-safe base64
const STATUSES = new Set(["pending", "approved", "expired", "invalid"]);

export async function POST(request: Request): Promise<Response> {
  let deviceCode: unknown;
  try {
    const text = await request.text();
    if (text.length > 1024) return fail(400, "body too large");
    deviceCode = (JSON.parse(text) as { device_code?: unknown } | null)?.device_code;
  } catch {
    return fail(400, "body must be JSON: { \"device_code\": \"…\" }");
  }
  if (typeof deviceCode !== "string" || !DEVICE_CODE.test(deviceCode)) return fail(400, "device_code is missing or malformed");

  try {
    const [row] = await withServer((tx) => tx<{ r: { status: string; token?: string } }[]>`
      select api.collect_device_token(${deviceCode}) as r`);
    const r = row!.r;
    if (!STATUSES.has(r.status)) throw new Error("unexpected device status");
    return ok(r.status === "approved" ? { status: "approved", token: r.token } : { status: r.status });
  } catch (e) {
    return apiError("device token", e);
  }
}
