/**
 * The two public Supabase values (see .env.example). Shared by server.ts and proxy.ts.
 * Both are safe in the browser: they name the project, they grant nothing.
 */
export function supabaseUrl(): string {
  return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
}

export function supabasePublishableKey(): string {
  return required(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

// Fail loudly at start-up rather than sending requests to "undefined".
function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing ${name}. Copy apps/web/.env.example to .env.local.`);
  return value;
}
