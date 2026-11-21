import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import p from "../../../components/app/page.module.css";
import { Callout } from "../../../components/ui/callout";
import { PageHeader } from "../../../components/ui/page-header";
import { getVerifiedClaims } from "../../../lib/auth";
import { withUser } from "../../../lib/db";
import { keyring } from "../../../lib/rule-keys";
import { listSuggestions, type SuggestionItem } from "../../../lib/suggestions";
import { spaceLabel } from "../../../lib/workspace";
import { DecideForm, WithdrawForm } from "./decide-form";

export const metadata: Metadata = {
  title: "Suggestions",
  robots: { index: false },
};

type Props = { searchParams: Promise<{ done?: string }> };

/** Fixed sentences for ?done=, never text from the URL. */
const DONE: Record<string, string> = {
  approved: "Approved. It's now a rule; laptops get it at their next AI session.",
  rejected: "Rejected. The author can see your note.",
  withdrawn: "Withdrawn.",
};
const KIND = { create: "New rule", update: "Change", promote: "Promote a personal rule" } as const;
const STATUS = { pending: "Pending", approved: "Approved", rejected: "Rejected", withdrawn: "Withdrawn" } as const;
const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Suggested changes: the ones you can decide, the ones you sent, and other pending ones you can
 * see (space admins see all). Text is shown as written (Markdown source), never as HTML.
 */
export default async function SuggestionsPage({ searchParams }: Props) {
  const claims = await getVerifiedClaims();
  if (!claims) redirect("/sign-in");
  const { done } = await searchParams;
  const items = await withUser(claims, (tx) => listSuggestions(tx, keyring()));

  const toDecide = items.filter((s) => s.canDecide);
  const mine = items.filter((s) => s.mine && !s.canDecide);
  const others = items.filter((s) => !s.mine && !s.canDecide && s.status === "pending");

  return (
    <div className={`container ${p.page}`}>
      <PageHeader
        eyebrow="Suggestions"
        title="Suggested changes"
        lead="When someone changes a layer they don't own (on the website or with axiomic push), it comes here. The layer's owner approves or rejects it."
      />
      {done && DONE[done] ? <Callout tone="note" title={DONE[done]} /> : null}

      <h2 className={p.h2}>Waiting for you ({toDecide.length})</h2>
      {toDecide.length === 0 ? <p className={p.small}>Nothing to decide.</p> : null}
      {toDecide.map((s) => (
        <Card key={s.id} s={s}>
          <DecideForm id={s.id} canApprove={s.body !== null} />
        </Card>
      ))}

      <h2 className={p.h2}>Sent by you ({mine.length})</h2>
      {mine.length === 0 ? <p className={p.small}>You haven't suggested anything.</p> : null}
      {mine.map((s) => (
        <Card key={s.id} s={s}>{s.status === "pending" ? <WithdrawForm id={s.id} /> : null}</Card>
      ))}

      {others.length > 0 ? (
        <>
          <h2 className={p.h2}>Other pending suggestions ({others.length})</h2>
          <p className={p.small}>You can see these but not decide them: the layer's owner does.</p>
          {others.map((s) => (
            <Card key={s.id} s={s} />
          ))}
        </>
      ) : null}
    </div>
  );
}

function Card({ s, children }: { s: SuggestionItem; children?: React.ReactNode }) {
  const changedSince = s.kind === "update" && s.current && s.baseVersion !== null && s.current.version !== s.baseVersion;
  return (
    <article className={p.card}>
      <div className={p.cardHead}>
        <h3 className={p.cardTitle}>{s.title}</h3>
        <span className={p.tags}>
          <span className={p.tag}>{KIND[s.kind]}</span>
          <span className={s.status === "pending" ? p.tagAccent : p.tag}>{STATUS[s.status]}</span>
        </span>
      </div>
      <p className={p.small}>
        {spaceLabel(s.space)} · {s.target}
        {s.projectSlug ? (
          <>
            {" "}
            · <Link href={`/spaces/${s.space.slug}/${s.projectSlug}`}>open project</Link>
          </>
        ) : null}
        <br />
        From {s.author ?? "a former member"} on {day(s.createdAt)}
        {s.decidedAt ? ` · ${STATUS[s.status].toLowerCase()} ${s.decidedBy ? `by ${s.decidedBy} ` : ""}on ${day(s.decidedAt)}` : null}
      </p>
      {s.note ? (
        <p className={p.small}>
          <strong>Note:</strong> {s.note}
        </p>
      ) : null}
      {changedSince ? (
        <Callout tone="warning" title={`The rule changed since this was written (was version ${s.baseVersion}, now ${s.current!.version})`}>
          <p>Approving replaces the current text with this suggestion. Compare them below.</p>
        </Callout>
      ) : null}
      {s.kind === "update" && s.current ? (
        <>
          <p className={p.small} style={{ marginBottom: 0 }}>
            <strong>Now</strong> (version {s.current.version}
            {s.current.title !== s.title ? `, titled "${s.current.title}"` : ""})
          </p>
          {s.current.body === null ? <p className={p.small}>The current text can't be opened.</p> : <pre className={p.ruleBody}>{s.current.body}</pre>}
          <p className={p.small} style={{ marginBottom: 0 }}>
            <strong>Suggested</strong>
          </p>
        </>
      ) : null}
      {s.body === null ? (
        <p className={p.small}>This suggestion's text can't be opened (it was stored with a key this server doesn't have). It can only be rejected.</p>
      ) : (
        <pre className={p.ruleBody}>{s.body}</pre>
      )}
      {children}
    </article>
  );
}
