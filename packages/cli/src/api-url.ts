/**
 * Where the axiomic server lives.
 *
 * PLACEHOLDER: there is no domain yet, and the server isn't deployed. Replace this with the real
 * Vercel URL once it exists. Never use axiomic.dev unless the owner confirms they own that domain.
 * This is the ONE place the default server address is written (see "URL handling" in docs/PLAN.md).
 *
 * Nothing in this build talks to the network; this value is only resolved and shown.
 */
export const DEFAULT_API_URL = "https://axiomic.vercel.app";

/**
 * Hosts where plain http is allowed, so a developer can run the server on their own machine.
 * Known limit (documented, not fixed): "localhost" is trusted BY NAME. A hosts-file entry or a resolver that
 * points it elsewhere would send the token in clear text to that place. Using only 127.0.0.1 / [::1] would
 * remove that, at the cost of developers having to type the IP; revisit when `login` exists.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Checks a server URL and returns it in a standard form (no trailing slash).
 * Throws a readable error if it's unsafe or malformed.
 */
export function normalizeApiUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(`Not a valid URL: ${JSON.stringify(raw)}`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`The server URL must start with https:// (got ${url.protocol}//)`);
  }
  // Plain http would send the login token unencrypted. Only allow it for this computer itself.
  if (url.protocol === "http:" && !LOCAL_HOSTS.has(url.hostname)) {
    throw new Error("The server URL must use https:// (http:// is only allowed for localhost)");
  }
  // A user:password@ part could leak into logs, and the token goes in a header anyway.
  if (url.username || url.password) throw new Error("The server URL must not contain a user name or password");
  // Query strings and #fragments have no meaning for a base URL and could hide tricks.
  if (url.search || url.hash) throw new Error("The server URL must not contain ? or #");

  return url.origin + url.pathname.replace(/\/+$/, "");
}

/**
 * The server URL to use: the AXIOMIC_API_URL env var if set, otherwise the default.
 * An invalid override is an error, not silently ignored, so a typo can't send you to the wrong server.
 */
export function resolveApiUrl(env: NodeJS.ProcessEnv): string {
  const override = env.AXIOMIC_API_URL;
  if (override === undefined || override.trim() === "") return DEFAULT_API_URL;
  try {
    return normalizeApiUrl(override);
  } catch (error) {
    throw new Error(`AXIOMIC_API_URL is invalid: ${(error as Error).message}`);
  }
}
