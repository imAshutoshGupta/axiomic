"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { siteUrl } from "../../../lib/site-url";

const PROVIDERS = ["github", "google"] as const;
type Provider = (typeof PROVIDERS)[number];

/**
 * Runs on our server when a sign-in button is pressed (Part A of the sign-in flow).
 * Supabase makes the PKCE "secret note" (saved as a cookie) and gives back the URL that starts
 * the GitHub/Google sign-in. We send the browser there.
 */
export async function signIn(formData: FormData) {
  const provider = formData.get("provider");
  // The value comes from the browser: accept only the two we support.
  if (!isProvider(provider)) redirect("/sign-in?error=provider");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      // Where Supabase sends "ticket B". Built from our own constant, never the request's Host
      // header. Supabase also checks it against the dashboard's redirect allow-list.
      redirectTo: new URL("/auth/callback", siteUrl()).toString(),
      // Google: let people with work and personal accounts pick the right one.
      queryParams: provider === "google" ? { prompt: "select_account" } : undefined,
    },
  });

  if (error || !data.url) redirect("/sign-in?error=start");
  redirect(data.url);
}

function isProvider(value: FormDataEntryValue | null): value is Provider {
  return typeof value === "string" && (PROVIDERS as readonly string[]).includes(value);
}
