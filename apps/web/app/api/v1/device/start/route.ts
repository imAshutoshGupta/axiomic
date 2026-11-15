import { apiError, clientIp, ok } from "../../../../../lib/api";
import { withServer } from "../../../../../lib/db";

/**
 * POST /api/v1/device/start   (no token: this is how you get one)
 * 200 { device_code, user_code, verification_uri, expires_at, interval } · 429 too many.
 *
 * Step 1 of `axiomic login` (DECISIONS #55):
 *   device_code  secret, stays in the CLI, sent back only in the POST body of /device/token
 *   user_code    "ABCD-1234", shown in the terminal; you type it on /device
 * There is deliberately no link with the code filled in: you type it yourself, so a link
 * someone sends you can't trick you into approving THEIR terminal (#58).
 *
 * client_info is built HERE from the request (DB-DESIGN 6.15, S14): the device's own
 * User-Agent (labelled "reported by the device" on the approve page) and the country Vercel
 * sees. Nothing the CLI puts in a body is used.
 */
export const dynamic = "force-dynamic";

/** Printable ASCII only, so it can't break the page or a log line. */
function clean(text: string | null, max: number): string {
  return (text ?? "").replace(/[^\x20-\x7e]/g, "").trim().slice(0, max);
}

export async function POST(request: Request): Promise<Response> {
  const agent = clean(request.headers.get("user-agent"), 80) || "unknown device";
  const country = clean(request.headers.get("x-vercel-ip-country"), 2);
  const clientInfo = country ? `${agent} · ${country}` : agent;

  try {
    const r = await withServer(async (tx) => {
      // 10 starts per IP per 10 minutes. Over → AX429 → 429.
      await tx`select api.rate_limit('device_start', ${clientIp(request)})`;
      const [row] = await tx<{ r: { device_code: string; user_code: string; expires_at: string } }[]>`
        select api.start_device_login(${clientInfo}) as r`;
      return row!.r;
    });
    return ok({
      device_code: r.device_code,
      user_code: r.user_code,
      verification_uri: new URL("/device", request.url).toString(),
      expires_at: r.expires_at,
      interval: 5, // seconds between polls of /device/token
    });
  } catch (e) {
    return apiError("device start", e);
  }
}
