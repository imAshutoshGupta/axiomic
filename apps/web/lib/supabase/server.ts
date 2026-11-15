import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { supabasePublishableKey, supabaseUrl } from "./env";

/**
 * A Supabase client for ONE server request, wired to that request's cookies.
 * Make a new one per request: never share it, or one person's session could reach another's.
 *
 * It only talks to Supabase Auth (sign-in, getClaims, 2FA). Database queries go through
 * withUser() (step 6c), not through this client.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      // Give the library every cookie this request came with (the session lives in them).
      getAll() {
        return cookieStore.getAll();
      },
      // Called when the library has new cookies to save, e.g. a refreshed 15-minute pass.
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Pages may not write cookies while rendering; Next.js throws here.
          // Safe to ignore: proxy.ts refreshes the session before any page renders.
        }
      },
    },
  });
}
