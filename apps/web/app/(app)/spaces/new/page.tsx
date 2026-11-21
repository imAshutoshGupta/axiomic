/** /spaces/new: create a company (work) space. */
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm } from "@/components/app/action-form";
import p from "@/components/app/page.module.css";
import { PageHeader } from "@/components/ui/page-header";
import { getVerifiedClaims } from "@/lib/auth/session";
import { createSpace } from "@/app/(app)/spaces/[space]/actions";

export const metadata: Metadata = {
  title: "New company space",
  robots: { index: false },
};

/** A company (work) space: you become its admin, with one "General" team that you lead. ("new" is a reserved space slug.) */
export default async function NewSpacePage() {
  const claims = await getVerifiedClaims();
  if (!claims) redirect("/sign-in");
  return (
    <div className={`container ${p.page}`}>
      <ol className={p.crumbs}>
        <li>
          <Link href="/spaces">Projects</Link>
        </li>
      </ol>
      <PageHeader
        eyebrow="New company space"
        title="Create a company space"
        lead="A shared space for your team: company rules, teams, projects and people. You become its admin."
      />
      <ActionForm action={createSpace} hidden={{}} submit="Create space" variant="primary">
        <label className={p.label}>
          Company name
          <input className={p.input} name="name" required maxLength={100} placeholder="Acme" />
        </label>
        <label className={p.label}>
          Short name
          <input className={p.input} name="slug" required pattern="[a-z0-9][a-z0-9\-]{1,30}" maxLength={31} placeholder="acme" />
          <span className={p.small} style={{ fontWeight: 400 }}>
            Lowercase letters, digits and dashes. Developers type it in <code>axiomic init acme/web-app</code>. It can&rsquo;t be changed later.
          </span>
        </label>
      </ActionForm>
    </div>
  );
}
