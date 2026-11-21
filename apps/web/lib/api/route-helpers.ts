import "server-only";
import { pgCode } from "@/lib/db";
import { authenticateBearer, type TokenAuth } from "./bearer-auth";

/**
 * Shared bits for every /api/v1 route (DECISIONS #55):
 * - answers are never cached (Cache-Control: no-store): they are per person;
 * - errors are fixed short texts: no stack traces, no database messages, never the token;
 * - a Bearer-token route calls requireToken() first.
 */
export const NO_STORE = { "Cache-Control": "no-store" } as const;

export function ok(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

export function fail(status: number, error: string, extra: Record<string, string> = {}): Response {
  return Response.json({ error }, { status, headers: { ...NO_STORE, ...extra } });
}

export const unauthorized = () => fail(401, "sign in again: missing or invalid token", { "WWW-Authenticate": "Bearer" });
export const tooMany = () => fail(429, "too many requests: wait a minute and try again", { "Retry-After": "60" });

/**
 * Turns an unexpected error into a safe answer. Logs only a short reason (an error code or
 * the first 200 characters of our own message): never the token, the claims or rule text.
 */
export function apiError(label: string, e: unknown): Response {
  const code = pgCode(e) ?? (e as { code?: string } | null)?.code;
  if (code === "AX429") return tooMany();
  console.error(`${label} failed:`, code ?? (e instanceof Error ? e.message.slice(0, 200) : "unknown"));
  if (code === "ECONNREFUSED" || code === "CONNECT_TIMEOUT" || code === "40001") return fail(503, "try again shortly");
  return fail(500, "server error");
}

/**
 * The Bearer token on this request, resolved and rate limited, or a ready 401/429 answer.
 * Use: const auth = await requireToken(request); if (auth instanceof Response) return auth;
 */
export async function requireToken(request: Request): Promise<TokenAuth | Response> {
  const auth = await authenticateBearer(request.headers.get("authorization"));
  return auth ?? unauthorized();
}

const CLI_VERSION = /^[0-9A-Za-z.+-]{1,40}$/;

/** The optional X-Axiomic-CLI-Version header, if it looks like a version; else null. */
export function cliVersionOf(request: Request): string | null {
  const v = request.headers.get("x-axiomic-cli-version");
  return v && CLI_VERSION.test(v) ? v : null;
}

/**
 * The caller's IP for rate limits only (kept ≤ 24 h, DB-DESIGN 6.16). On Vercel, x-real-ip
 * is set by Vercel itself; on localhost there is none, so everyone shares "local".
 */
export function clientIp(request: Request): string {
  return clientIpFromHeaders(request.headers);
}

/** The same, from bare headers (server actions get headers(), not a Request). */
export function clientIpFromHeaders(headers: Headers): string {
  const ip = headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",")[0];
  const clean = ip?.trim() ?? "";
  return /^[0-9a-fA-F:.]{2,45}$/.test(clean) ? clean : "local";
}
