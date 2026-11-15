import type { Metadata } from "next";
import { PageHeader } from "../../../components/ui/page-header";
import buttonStyles from "../../../components/ui/button.module.css";
import { getVerifiedClaims } from "../../../lib/auth";
import { ApproveForm } from "./approve-form";
import styles from "./device.module.css";

export const metadata: Metadata = {
  title: "Approve a CLI login",
  robots: { index: false },
};

/**
 * /device: where `axiomic login` sends you (DECISIONS #55). Signed out → a sign-in button,
 * then come back here (the sign-in page links back). The code is always typed, never taken
 * from the URL (#58).
 */
export default async function DevicePage() {
  const claims = await getVerifiedClaims();

  return (
    <div className={`container ${styles.page}`}>
      <PageHeader
        eyebrow="CLI login"
        title="Approve a CLI login"
        lead="Type the code that axiomic login shows in your terminal. That terminal then gets its own token, which you can revoke any time under CLI tokens."
      />
      {claims ? (
        <ApproveForm />
      ) : (
        <div className={styles.form}>
          <p>Sign in first, then come back to this page.</p>
          <a href="/sign-in" className={`${buttonStyles.button} ${buttonStyles.primary}`}>
            Sign in
          </a>
        </div>
      )}
    </div>
  );
}
