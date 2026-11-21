import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import p from "../../../components/app/page.module.css";
import { Callout } from "../../../components/ui/callout";
import { PageHeader } from "../../../components/ui/page-header";
import buttonStyles from "../../../components/ui/button.module.css";
import { getVerifiedClaims } from "../../../lib/auth";
import { withUser } from "../../../lib/db";
import { listSpaces, spaceLabel } from "../../../lib/workspace";

export const metadata: Metadata = {
  title: "Projects",
  robots: { index: false },
};

const ROLE: Record<string, string> = { admin: "Admin", editor: "Editor", reader: "Reader" };

/** Every space you belong to, with its projects. Open a space to manage its projects, teams and people. */
export default async function SpacesPage({ searchParams }: { searchParams: Promise<{ left?: string }> }) {
  const claims = await getVerifiedClaims();
  if (!claims) redirect("/sign-in");
  const spaces = await withUser(claims, (tx) => listSpaces(tx));
  const { left } = await searchParams;

  return (
    <div className={`container ${p.page}`}>
      <PageHeader
        eyebrow="Projects"
        title="Your spaces and projects"
        lead="A space is a company (work) or your own private space. Open a project to see the rules it gets, layer by layer."
      />
      {left ? <Callout tone="note" title="You left the space." /> : null}
      <p className={p.actions}>
        <Link href="/spaces/new" className={`${buttonStyles.button} ${buttonStyles.secondary} ${buttonStyles.md}`}>
          New company space
        </Link>
      </p>
      {spaces.length === 0 ? <p>You aren't in any space yet.</p> : null}
      {spaces.map((s) => (
        <section key={s.id} id={s.slug} className={p.card} aria-labelledby={`space-${s.id}`}>
          <div className={p.cardHead}>
            <h2 id={`space-${s.id}`} className={p.cardTitle}>
              <Link href={`/spaces/${s.slug}`}>{spaceLabel(s)}</Link>
            </h2>
            <span className={p.tags}>
              <span className={p.tag}>{s.kind === "work" ? "Work" : "Private"}</span>
              {s.kind === "work" ? <span className={p.tagAccent}>{ROLE[s.role]}</span> : null}
            </span>
          </div>
          {s.projects.length === 0 ? (
            <p className={p.small}>No projects here yet.</p>
          ) : (
            <ul className={p.list} style={{ marginTop: 12 }}>
              {s.projects.map((proj) => (
                <li key={proj.id} className={p.row}>
                  <span>
                    <Link href={`/spaces/${s.slug}/${proj.slug}`}>
                      <strong>{proj.name}</strong>
                    </Link>
                    <br />
                    <span className={p.small}>
                      <code>
                        {s.slug}/{proj.slug}
                      </code>
                      {proj.teamName ? ` · team ${proj.teamName}` : null}
                      {` · ${proj.modules} ${proj.modules === 1 ? "folder" : "folders"}`}
                    </span>
                  </span>
                  {proj.archived ? <span className={p.tagWarn}>Archived</span> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
