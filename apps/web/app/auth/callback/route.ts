import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { siteUrl } from "../../../lib/site-url";

/**
 * Swap 2 of the sign-in flow. Supabase sends the browser here with ?code=<ticket B>.
 * exchangeCodeForSession() sends that code plus the PKCE "secret note" (a cookie set when the
 * sign-in started) to Supabase. If they match, we get the session, saved as cookies.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return back("/sign-in?error=callback");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    // Log only the short code, never tokens or the URL.
    console.error("auth callback failed:", error.code ?? error.name);
    return back("/sign-in?error=callback");
  }

  // No account page yet: /sign-in shows "You're already signed in". Step 9 changes this to /account.
  return back("/sign-in");
}

// Redirect within our own site only (built from our constant, never the request's Host header).
function back(path: string) {
  return NextResponse.redirect(new URL(path, siteUrl()), { status: 303 });
}
