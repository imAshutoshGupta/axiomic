import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { PageHeader } from "../../../components/ui/page-header";
import { Prose } from "../../../components/ui/prose";
import { Mark } from "../../../components/ui/type";

export const metadata: Metadata = {
  title: "FAQ",
  description: "Common questions about axiomic: CLAUDE.md, privacy, offline use, locked rules, Cursor and pricing.",
};

const FAQS: { id: string; q: string; a: ReactNode }[] = [
  {
    id: "claude-md",
    q: "We already have CLAUDE.md. Why add axiomic?",
    a: (
      <>
        <p>
          A <code>CLAUDE.md</code> in each repo works until the same rules are needed in many repos, need an owner, or
          should not be visible to everyone with access. axiomic keeps one copy per layer, combines them per developer
          and keeps them out of Git.
        </p>
        <p>
          You can keep a public <code>CLAUDE.md</code> for harmless things. Just do not put the same topic in both, or
          the AI may follow either one.
        </p>
      </>
    ),
  },
  {
    id: "overwrite",
    q: "Will axiomic overwrite my CLAUDE.md or AGENTS.md?",
    a: (
      <p>
        Never. It writes only <code>.claude/rules/axiomic.md</code> and <code>.claude/rules/axiomic-&lt;module&gt;.md</code>,
        which Claude Code loads alongside your own files.
      </p>
    ),
  },
  {
    id: "private",
    q: "Does this keep our rules private from the AI provider?",
    a: (
      <p>
        No. axiomic keeps rules out of Git. Your AI tool still sends them to its model, as it does with any project
        instructions. See <Link href="/security#limits">the four limits</Link>.
      </p>
    ),
  },
  {
    id: "offline",
    q: "What happens if the server is down or I am offline?",
    a: (
      <p>
        The session starts anyway. The hook has a strict time limit and falls back to the last copy kept on your
        laptop. It never blocks Claude Code.
      </p>
    ),
  },
  {
    id: "committed",
    q: "Could a rule file get committed by accident?",
    a: (
      <p>
        axiomic adds its files to <code>.gitignore</code> and then asks Git itself to confirm they are ignored. If Git
        cannot confirm it, axiomic writes nothing. <code>axiomic status</code> reports any rule file Git tracks.
      </p>
    ),
  },
  {
    id: "edit",
    q: "What if I edit a rule file on my laptop?",
    a: (
      <p>
        axiomic notices and keeps your edit instead of overwriting it. <code>axiomic push</code> sends it back: saved
        directly if you own that layer, otherwise as a suggestion that the owner approves or rejects on the website (in
        development).
      </p>
    ),
  },
  {
    id: "locked",
    q: "Can a locked rule be enforced?",
    a: (
      <p>
        Locked rules cannot be replaced by any narrower layer, and they are placed first and marked MANDATORY. That is
        the strongest instruction an AI can get, but no tool can truly force an AI to obey. Keep reviews and CI in
        place.
      </p>
    ),
  },
  {
    id: "leave",
    q: "What happens when someone leaves the team?",
    a: (
      <p>
        Their access stops, and the CLI deletes the rule files it wrote the next time it runs (built; removing a person
        on the website is in development). A laptop that stays offline keeps its last files until then, and copies they
        already made cannot be recalled, which is true of any tool.
      </p>
    ),
  },
  {
    id: "cursor",
    q: "Which AI tools are supported?",
    a: (
      <p>
        Claude Code first. Cursor is coming soon. See the <Link href="/roadmap">roadmap</Link>.
      </p>
    ),
  },
  {
    id: "try",
    q: "Can I use it today?",
    a: (
      <p>
        axiomic is in a pilot with one team. The local CLI pieces are built and documented in the{" "}
        <Link href="/docs/cli">CLI docs</Link>. Please do not install the old 0.x versions from npm. 1.0 will be free.
      </p>
    ),
  },
];

export default function FaqPage() {
  return (
    <div className="container">
      <PageHeader
        eyebrow="FAQ"
        title={
          <>
            Questions, <Mark padded>answered plainly.</Mark>
          </>
        }
      />
      <Prose>
        {FAQS.map((f) => (
          <section key={f.id} aria-labelledby={f.id}>
            <h2 id={f.id}>{f.q}</h2>
            {f.a}
          </section>
        ))}
      </Prose>
    </div>
  );
}
