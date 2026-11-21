import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/site-url";

/**
 * Sign out of THIS browser. POST only: a GET could be fired by any link or image.
 * Supabase deletes this session (so its refresh token stops working) and the library clears
 * our cookies. Other devices stay signed in ("sign out everywhere" can come later).
 */
export async function POST(request: NextRequest) {
  // Second lock after SameSite cookies: refuse a sign-out posted from another website.
  if (request.headers.get("origin") !== siteUrl().origin) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) console.error("sign-out failed:", error.code ?? error.name);
  // Even if Supabase was unreachable, the library has cleared our cookies, so this browser is out.

  return NextResponse.redirect(new URL("/", siteUrl()), { status: 303 });
}
