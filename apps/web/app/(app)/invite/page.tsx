/** /invite: join a company space from an invite link. */
import type { Metadata } from "next";
import p from "@/components/app/page.module.css";
import { PageHeader } from "@/components/ui/page-header";
import { getVerifiedClaims } from "@/lib/auth/session";
import { AcceptInvite } from "./accept-invite";

export const metadata: Metadata = {
  title: "Join a space",
  robots: { index: false },
  referrer: "no-referrer",
};

/** /invite#<secret>: join a company space. Open to signed-out visitors (they're asked to sign in). */
export default async function InvitePage() {
  const claims = await getVerifiedClaims();
  return (
    <div className={`container ${p.page}`}>
      <PageHeader eyebrow="Invite" title="Join a company space" />
      <AcceptInvite signedIn={!!claims} />
    </div>
  );
}
