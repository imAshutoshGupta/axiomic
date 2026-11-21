import { VERSION } from "../version";

/**
 * The ONE place the CLI talks to the axiomic server (DECISIONS #59).
 *
 * - The token goes only in the `Authorization: Bearer` header, never in a URL, and only to the
 *   server it was issued by (the caller passes that server's URL).
 * - Redirects are refused: a redirect could carry the request (and its header) somewhere else.
 * - Every call has a timeout, and answers bigger than MAX_RESPONSE_BYTES are refused.
 * - Errors are short, readable, and never contain the token. Server error texts are shown only
 *   if they are short printable text.
 */
export type FetchFn = typeof fetch;

export interface ApiCallOptions {
  apiUrl: string;
  fetch: FetchFn;
  token?: string;
  timeoutMs: number;
}

/** Big enough for 500 rule files; anything more is a broken or hostile server. */
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export class ApiError extends Error {
  override name = "ApiError";
  /** HTTP status, or 0 when the server could not be reached (network, timeout, bad answer). */
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function userAgent(): string {
  return `axiomic/${VERSION} (${process.platform} ${process.arch}; node ${process.versions.node})`;
}

/**
 * Sends one request and returns the status and the parsed JSON body (or null for an empty body).
 * Throws ApiError for: network trouble or timeout (status 0), and any status >= 400.
 * 2xx and the caller's own expected statuses come back as { status, body }.
 */
export async function apiCall(
  opts: ApiCallOptions,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": userAgent(),
    "x-axiomic-cli-version": VERSION,
  };
  if (opts.token !== undefined) headers.authorization = `Bearer ${opts.token}`;
  if (body !== undefined) headers["content-type"] = "application/json";

  let response: Response;
  try {
    response = await opts.fetch(opts.apiUrl + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (error) {
    const timedOut = (error as Error)?.name === "TimeoutError" || (error as Error)?.name === "AbortError";
    throw new ApiError(0, timedOut ? `the server at ${opts.apiUrl} did not answer in time` : `could not reach the server at ${opts.apiUrl}`);
  }

  let parsed: unknown = null;
  try {
    const text = await readLimited(response, MAX_RESPONSE_BYTES);
    parsed = text === "" ? null : JSON.parse(text);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (response.ok) throw new ApiError(0, `the server at ${opts.apiUrl} sent an answer axiomic can't read`);
  }

  if (response.status >= 400) throw new ApiError(response.status, messageFor(response.status, parsed, opts.apiUrl));
  return { status: response.status, body: parsed };
}

async function readLimited(response: Response, max: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new ApiError(0, "the server's answer was too big");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** A readable sentence for an error status. The server's own short text is added when it's safe to show. */
function messageFor(status: number, body: unknown, apiUrl: string): string {
  const said = (body as { error?: unknown } | null)?.error;
  const detail = typeof said === "string" && /^[\x20-\x7e]{1,200}$/.test(said) ? said : undefined;
  if (status === 401) return 'not logged in, or your login has expired or was revoked. Run "axiomic login".';
  if (status === 403) return `not allowed${detail ? `: ${detail}` : ""}`;
  if (status === 404) return detail ?? "not found";
  if (status === 429) return "too many requests: wait a minute and try again";
  if (status >= 500) return `the server at ${apiUrl} had a problem (${status}). Try again shortly.`;
  return detail ?? `the server answered ${status}`;
}
