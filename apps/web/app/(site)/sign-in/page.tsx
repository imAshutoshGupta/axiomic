/** /sign-in: the GitHub and Google sign-in buttons. */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Callout } from "@/components/ui/callout";
import { PageHeader } from "@/components/ui/page-header";
import buttonStyles from "@/components/ui/button.module.css";
import { getVerifiedClaims } from "@/lib/auth/session";
import { signIn } from "./actions";
import styles from "./sign-in.module.css";

export const metadata: Metadata = {
  title: "Get started",
  description: "Sign in or create a free axiomic account with GitHub or Google.",
  robots: { index: false },
};

// Fixed sentences for each error code. We never show text taken from the URL.
const ERRORS: Record<string, string> = {
  provider: "That sign-in option isn't available. Use GitHub or Google.",
  start: "We couldn't start the sign-in. Please try again.",
  callback: "The sign-in didn't finish. Please try again.",
};

type Props = { searchParams: Promise<{ error?: string }> };

export default async function SignInPage({ searchParams }: Props) {
  const claims = await getVerifiedClaims();
  const { error } = await searchParams;
  const message = error ? (ERRORS[error] ?? ERRORS.callback) : null;

  // Already signed in: the account page has everything this page used to offer (and sign-out).
  if (claims) redirect("/account");

  return (
    <div className={`container ${styles.page}`}>
      <PageHeader
        eyebrow="Get started"
        title="Sign in or create your account"
        lead="Free during 1.0. New accounts get a private space to try it. axiomic never sees your password."
      />
      {message ? <Callout tone="warning" title={message} /> : null}
      <form action={signIn} className={styles.buttons}>
        <button
          type="submit"
          name="provider"
          value="github"
          className={`${buttonStyles.button} ${buttonStyles.primary} ${buttonStyles.lg}`}
        >
          Continue with GitHub
        </button>
        <button
          type="submit"
          name="provider"
          value="google"
          className={`${buttonStyles.button} ${buttonStyles.secondary} ${buttonStyles.lg}`}
        >
          Continue with Google
        </button>
      </form>
      <p className={styles.note}>Google sign-in is open to pilot users only for now. Everyone else: use GitHub.</p>
    </div>
  );
}
