import { notFound } from "next/navigation";

/**
 * Catches every address that no other page matches and shows app/(site)/not-found.tsx,
 * so the 404 page gets the site header and footer without putting them in the root layout.
 */
export default function Missing() {
  notFound();
}
