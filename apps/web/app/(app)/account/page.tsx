import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import p from "../../../components/app/page.module.css";
import { PageHeader } from "../../../components/ui/page-header";
import buttonStyles from "../../../components/ui/button.module.css";
import { getVerifiedClaims } from "../../../lib/auth";
import { getMe } from "../../../lib/me";
import { PendingInviteNotice } from "../invite/accept-invite";

export const metadata: Metadata = {
  title: "Account",
  robots: { index: false },
};

/** Where sign-in lands. Your name card, the places you can go, and sign out. */
export default async function AccountPage() {
  const claims = await getVerifiedClaims();
  if (!claims) redirect("/sign-in");
  const me = await getMe(claims);

  return (
    <div className={`container ${p.page}`}>
      <PageHeader eyebrow="Account" title={me.displayName} lead={me.email ?? undefined} />
      <PendingInviteNotice />
      <ul className={p.list}>
        <li className={p.row}>
          <span>
            <strong>Projects and rules</strong>
            <br />
            <span className={p.small}>Your spaces, their projects, and the rules each project gets.</span>
          </span>
          <Link href="/spaces" className={`${buttonStyles.button} ${buttonStyles.secondary} ${buttonStyles.md}`}>
            Open
          </Link>
        </li>
        <li className={p.row}>
          <span>
            <strong>Suggestions</strong>
            <br />
            <span className={p.small}>Changes waiting for your approval, and the ones you sent.</span>
          </span>
          <Link href="/suggestions" className={`${buttonStyles.button} ${buttonStyles.secondary} ${buttonStyles.md}`}>
            Open
          </Link>
        </li>
        <li className={p.row}>
          <span>
            <strong>CLI tokens</strong>
            <br />
            <span className={p.small}>The logins your laptops use. Revoke one to cut a laptop off.</span>
          </span>
          <Link href="/account/tokens" className={`${buttonStyles.button} ${buttonStyles.secondary} ${buttonStyles.md}`}>
            Open
          </Link>
        </li>
        <li className={p.row}>
          <span>
            <strong>Approve a CLI login</strong>
            <br />
            <span className={p.small}>Type the code that axiomic login shows in your terminal.</span>
          </span>
          <Link href="/device" className={`${buttonStyles.button} ${buttonStyles.secondary} ${buttonStyles.md}`}>
            Open
          </Link>
        </li>
      </ul>
      <form method="post" action="/auth/sign-out" className={p.actions}>
        <button type="submit" className={`${buttonStyles.button} ${buttonStyles.secondary} ${buttonStyles.md}`}>
          Sign out of this browser
        </button>
      </form>
    </div>
  );
}
