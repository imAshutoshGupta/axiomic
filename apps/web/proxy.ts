import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { supabasePublishableKey, supabaseUrl } from "@/lib/supabase/env";

/**
 * Runs before each matching request. Its ONLY job: if the 15-minute pass has expired, swap the
 * refresh token for a new one and pass the new cookies on (to the page and to the browser).
 *
 * It does not block or redirect anyone. Every page and route checks for itself with
 * getVerifiedClaims(), so a mistake here can never let someone in.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  // No Supabase configured (e.g. a deployment before production is set up): there is no pass to
  // refresh, so step aside. Public pages keep working; pages that need sign-in still fail on their
  // own, loudly, through lib/supabase/env.ts. This grants nothing: it only skips a refresh (#63).
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) return response;

  const supabase = createServerClient(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        // 1. Update the request, so the page rendered after us sees the fresh pass.
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        // 2. Rebuild the response from that updated request…
        response = NextResponse.next({ request });
        // 3. …and tell the browser to store the new cookies.
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        // 4. Headers from the library that stop caches keeping someone's session (no-store).
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  // Checks the pass and refreshes it if expired. Nothing else may run between creating the
  // client and this call, or a refresh could be lost.
  await supabase.auth.getClaims();

  return response;
}

export const config = {
  matcher: [
    // Everything except static files, images and the CLI API (which uses Bearer tokens, not cookies).
    "/((?!_next/static|_next/image|api/v1/|favicon.ico|icon.svg|apple-icon.png|manifest.webmanifest|brand/|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt|woff2?)$).*)",
  ],
};
