import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { PageHeader } from "../../../components/ui/page-header";
import { Mark } from "../../../components/ui/type";
import s from "./faq.module.css";

export const metadata: Metadata = {
  title: "FAQ",
  description: "Common questions about axiomic: CLAUDE.md, privacy, offline use, leaving the team, Cursor and pricing.",
};

/** Short answers only: one or two sentences each. */
const FAQS: { id: string; q: string; a: ReactNode }[] = [
  {
    id: "claude-md",
    q: "We already have CLAUDE.md. Why axiomic?",
    a: <>One copy per layer instead of one per repo, with an owner, combined per person, and kept out of Git. Your own <code>CLAUDE.md</code> keeps working beside it.</>,
  },
  {
    id: "overwrite",
    q: "Will it touch my CLAUDE.md?",
    a: <>Never. It writes only <code>.claude/rules/axiomic*.md</code>, which Claude Code loads alongside your files.</>,
  },
  {
    id: "private",
    q: "Is it private from the AI provider?",
    a: <>No: it keeps rules out of Git, not out of the AI. Claude Code still sends them to its model. <Link href="/security">The limits</Link>.</>,
  },
  {
    id: "offline",
    q: "What if the server is down?",
    a: <>The session starts anyway, with the last copy on your laptop. axiomic never blocks Claude Code.</>,
  },
  {
    id: "edit",
    q: "Can I edit a rule on my laptop?",
    a: <>Yes. <code>axiomic push</code> sends it back: saved if you own the layer, otherwise a suggestion the owner approves on the website.</>,
  },
  {
    id: "leave",
    q: "What happens when someone leaves?",
    a: <>An admin removes them, and their laptop deletes the rule files at its next session. Copies they made can&rsquo;t be recalled, with any tool.</>,
  },
  {
    id: "cursor",
    q: "Which AI tools work?",
    a: <>Claude Code today. Cursor is next. <Link href="/roadmap">Roadmap</Link>.</>,
  },
  {
    id: "price",
    q: "What does it cost?",
    a: <>Nothing during 1.0. If paid plans come later, you&rsquo;ll be told well in advance.</>,
  },
];

export default function FaqPage() {
  return (
    <div className="container">
      <PageHeader
        eyebrow="FAQ"
        title={
          <>
            Questions, <Mark padded>answered short.</Mark>
          </>
        }
      />
      <ul className={s.list}>
        {FAQS.map((f) => (
          <li key={f.id} id={f.id}>
            <details className={s.item}>
              <summary>{f.q}</summary>
              <p className={s.answer}>{f.a}</p>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
