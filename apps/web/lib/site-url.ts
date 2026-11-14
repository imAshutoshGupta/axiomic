/**
 * The public address of this site, used by Next.js to turn relative link-preview image URLs
 * (og:image) into full ones.
 *
 * There is no domain yet, so nothing is hard-coded. On Vercel, the platform sets these variables for
 * every build by itself: they are not secrets and need no configuration from us.
 *   VERCEL_PROJECT_PRODUCTION_URL  the production address, e.g. "my-project.vercel.app" (no https://)
 *   VERCEL_URL                     the address of this particular deployment (no https://)
 * Locally neither exists, so we fall back to http://localhost:3000.
 * When a real domain is bought, replace this with that domain.
 */
export function siteUrl(): URL {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  return new URL(host ? `https://${host}` : "http://localhost:3000");
}
