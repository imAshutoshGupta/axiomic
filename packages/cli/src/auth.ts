import { resolveApiUrl } from "./api-url";
import { readCredentials } from "./credentials";

/**
 * Which token to use, and which server it belongs to (DECISIONS #59):
 *   1. AXIOMIC_TOKEN env var (cloud agents: a project agent key) → sent to AXIOMIC_API_URL or the default.
 *   2. The saved login (~/.config/axiomic/credentials.json) → sent ONLY to the server saved with it.
 * A saved token is never sent to a different server, even if AXIOMIC_API_URL now says otherwise.
 */
export interface Auth {
  token: string;
  apiUrl: string;
  source: "env" | "login";
}

const TOKEN = /^axm_[A-Za-z0-9_-]{43}$/;

export function isTokenShape(value: string): boolean {
  return TOKEN.test(value);
}

/** The token to use, or undefined if not logged in. Throws (without the token) for a malformed env token or broken credentials file. */
export async function resolveAuth(env: NodeJS.ProcessEnv, configDir: string): Promise<Auth | undefined> {
  const fromEnv = env.AXIOMIC_TOKEN?.trim();
  if (fromEnv) {
    if (!isTokenShape(fromEnv)) throw new Error("AXIOMIC_TOKEN is set but doesn't look like an axiomic token (axm_…)");
    return { token: fromEnv, apiUrl: resolveApiUrl(env), source: "env" };
  }
  const saved = await readCredentials(configDir);
  return saved ? { token: saved.token, apiUrl: saved.apiUrl, source: "login" } : undefined;
}
