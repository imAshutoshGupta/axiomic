import type { Metadata } from "next";
import { Callout } from "../../../components/ui/callout";
import { PageHeader } from "../../../components/ui/page-header";
import buttonStyles from "../../../components/ui/button.module.css";
import { getVerifiedClaims } from "../../../lib/auth";
import { signIn } from "./actions";
import styles from "./sign-in.module.css";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to axiomic with GitHub or Google.",
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

  if (claims) {
    return (
      <div className={`container ${styles.page}`}>
        <PageHeader eyebrow="Sign in" title="You're already signed in" />
        <form method="post" action="/auth/sign-out" className={styles.buttons}>
          <a href="/device" className={`${buttonStyles.button} ${buttonStyles.primary} ${buttonStyles.lg}`}>
            Approve a CLI login
          </a>
          <a href="/account/tokens" className={`${buttonStyles.button} ${buttonStyles.secondary} ${buttonStyles.lg}`}>
            CLI tokens
          </a>
          <button
            type="submit"
            className={`${buttonStyles.button} ${buttonStyles.secondary} ${buttonStyles.lg}`}
          >
            Sign out
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className={`container ${styles.page}`}>
      <PageHeader
        eyebrow="Sign in"
        title="Sign in to axiomic"
        lead="Use your GitHub or Google account. axiomic never sees your password."
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
    </div>
  );
}
