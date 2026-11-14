import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "../../../components/ui/code-block";
import { PageHeader } from "../../../components/ui/page-header";
import { Prose } from "../../../components/ui/prose";
import { StatusBadge } from "../../../components/ui/status-badge";
import { Mark } from "../../../components/ui/type";

export const metadata: Metadata = {
  title: "Product overview",
  description:
    "Why AI rule files do not belong in Git, and how axiomic stores, checks, combines and delivers them to every developer instead.",
};

const FLOW = `Website       a lead writes a rule
   │ publish
   ▼
Safety check  secrets, hidden text
   ▼
Server        versions, per person
   │ HTTPS
   ▼
Laptop        hook writes gitignored
              .claude/rules files
   ▼
Git           code only`;

export default function ProductPage() {
  return (
    <div className="container">
      <PageHeader
        eyebrow="Product overview"
        title={
          <>
            AI rules belong to your team, <Mark padded>not to Git.</Mark>
          </>
        }
        lead="axiomic gives AI coding rules a proper home: owned, checked, combined per person and delivered to every laptop, without ever entering a repository."
      />
      <Prose>
        <h2 id="problem">The problem with rule files in Git</h2>
        <p>
          Teams now commit instructions for their AI tools, such as <code>CLAUDE.md</code>, next to their code. It works
          for one repo. Across a team it starts to hurt:
        </p>
        <ul>
          <li>
            <strong>They leak.</strong> Architecture notes, server names and internal commands are visible to anyone
            with repo access, including forks.
          </li>
          <li>
            <strong>They drift.</strong> The same team rules get copied into dozens of repos and slowly stop matching.
          </li>
          <li>
            <strong>Nobody owns them.</strong> Anyone can change a company-wide rule in a pull request.
          </li>
          <li>
            <strong>They cannot be taken back.</strong> Someone who leaves keeps every rule in their clone.
          </li>
        </ul>

        <h2 id="idea">The idea</h2>
        <p>
          Rules live in axiomic, organised in layers with clear owners. When a developer opens Claude Code, axiomic
          writes that person&apos;s combined rules into the repo as gitignored files. The AI reads them like any other
          project instructions. Git keeps code only.
        </p>
      </Prose>
      <CodeBlock variant="file" title="How the pieces fit" code={FLOW} />
      <Prose spaced>
        <h2 id="pieces">Three parts, one shared brain</h2>
        <ul>
          <li>
            <strong>The website</strong> is where leads write, review and approve rules. <StatusBadge status="planned" />
          </li>
          <li>
            <strong>The server</strong> stores every version and decides who gets which rules. <StatusBadge status="in-progress" />
          </li>
          <li>
            <strong>The CLI</strong> writes the rules safely onto each laptop and keeps them out of Git.{" "}
            <StatusBadge status="local" />
          </li>
        </ul>
        <p>
          The layer merge and the safety check are one shared library used by both the server and the CLI, so they can
          never disagree about what a developer should see.
        </p>

        <h2 id="who">Who it is for</h2>
        <ul>
          <li>Teams with many repositories that share the same AI rules.</li>
          <li>Rules that change often and should change everywhere at once.</li>
          <li>Rules that mention things that should not sit in a public or shared repo.</li>
          <li>Teams where people and contractors come and go.</li>
        </ul>

        <h2 id="limits">What it does not do</h2>
        <p>
          axiomic keeps rules out of Git, not out of the AI. Claude Code still sends them to its model, and they sit as
          plain files on the developer&apos;s laptop. The <Link href="/security">security page</Link> explains exactly
          where the limits are.
        </p>

        <h2 id="explore">Explore</h2>
        <ul>
          <li>
            <Link href="/features">Features</Link>: every capability and its status
          </li>
          <li>
            <Link href="/roadmap">Roadmap</Link>: what is built and what comes next
          </li>
          <li>
            <Link href="/docs/cli">CLI docs</Link>: the commands
          </li>
          <li>
            <Link href="/faq">FAQ</Link>: common questions, including “we already have CLAUDE.md”
          </li>
        </ul>
      </Prose>
    </div>
  );
}
