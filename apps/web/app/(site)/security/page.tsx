import type { Metadata } from "next";
import Link from "next/link";
import { Callout } from "../../../components/ui/callout";
import { PageHeader } from "../../../components/ui/page-header";
import { Prose, TableWrap } from "../../../components/ui/prose";
import { StatusBadge, type Status } from "../../../components/ui/status-badge";
import { Mark } from "../../../components/ui/type";
import styles from "./security.module.css";

export const metadata: Metadata = {
  title: "Security",
  description:
    "What axiomic protects and what it does not: rules stay out of Git, but they are on the developer's disk and your AI tool still sends them to its model provider.",
};

const CONTROLS: { control: string; detail: string; status: Status }[] = [
  {
    control: "Layer merge",
    detail: "Combines company, team, project, module and personal rules. Locked rules cannot be replaced; a clash that gets through is dropped and reported.",
    status: "local",
  },
  {
    control: "Path guards",
    detail: "Module names and folder paths go through strict allow-lists: no absolute paths, no “..”, nothing under .git/.",
    status: "local",
  },
  {
    control: "Publish safety check",
    detail: "Looks for secret patterns, oversized text, invisible characters, text that imitates axiomic's own labels and known prompt-injection phrases. The server runs it on every change sent with axiomic push, before anything is encrypted or stored; the website editor will run it too.",
    status: "local",
  },
  {
    control: "Safe rendering",
    detail: "The Claude Code file renderer refuses unsafe module names and folder paths, and keeps each rule inside its own section.",
    status: "local",
  },
  {
    control: "Safe file writer",
    detail: "Writes only axiomic's own rule files, refuses symlinks and paths outside the repo, and detects local edits so they are not overwritten.",
    status: "local",
  },
  {
    control: "Git and Docker ignore",
    detail: "Owns a block in .gitignore and .dockerignore, and checks that Git really ignores the files and tracks none of them.",
    status: "local",
  },
  {
    control: "Offline cache and remove",
    detail: "The last rules are stored locally for offline use, and axiomic remove undoes what axiomic wrote. Hook install and uninstall also work locally.",
    status: "local",
  },
  {
    control: "Hook that fails open (local part)",
    detail: "The installed hook runs the installed CLI with a short timeout, always exits 0 and prints nothing, so your AI session always starts.",
    status: "local",
  },
  {
    control: "Hook fetches rules from the server",
    detail: "At session start, fetch the latest rules from the server (waiting at most 1.2 seconds), and fall back to the last copy if it is slow or down.",
    status: "local",
  },
  {
    control: "Customer isolation",
    detail: "Row-level security on every table, so one company can never read another's rules.",
    status: "local",
  },
  {
    control: "Encryption of rule text",
    detail: "AES-256-GCM on the server before text reaches the database, with the key held outside the database. Each text is tied to its own row, so it can't be copied to another.",
    status: "local",
  },
  {
    control: "Key check at start-up",
    detail: "Before saving anything, the server checks that its key opens a known test row. If not, it refuses to save, so a wrong key never locks away new rules.",
    status: "local",
  },
  {
    control: "Server database access",
    detail: "The server's database login has no rights of its own. Every request runs as the person asking, under the same row-level security.",
    status: "local",
  },
  {
    control: "Tokens",
    detail: "Stored hashed, revocable, sent only in the Authorization header and never in a URL, and only to the server that issued them. Unused CLI tokens stop working after 90 days. The CLI keeps its token in its config folder, readable only by you, never in the project; logging in again revokes the old one.",
    status: "local",
  },
  {
    control: "CLI login by code",
    detail: "axiomic login shows a short code that you type on the website after signing in. The page shows which device asked; there is no ready-made approve link, so a link someone sends you can't log their terminal in as you. Codes expire after 10 minutes, work once, and tries are rate limited.",
    status: "local",
  },
  {
    control: "Rate limits on the CLI's API",
    detail: "Each token is limited to 120 requests a minute; starting a login is limited per network address (addresses are kept 24 hours at most).",
    status: "local",
  },
  {
    control: "Sign-in",
    detail: "GitHub or Google only, no passwords. 15-minute sessions; every page checks the session's signature on the server.",
    status: "local",
  },
  {
    control: "Website editor: the database decides",
    detail: "The website offers Edit or Suggest exactly as the database would decide, and every save, delete and approval is decided again by the database: only a layer's owner changes it directly. Every save runs the same safety check as axiomic push. Rule text is shown as plain text, never run as HTML.",
    status: "in-progress",
  },
  { control: "Two-factor sign-in for admins", detail: "Required for admin tools in company spaces.", status: "planned" },
  { control: "Publish alerts", detail: "An email on every publish, so a silent change is noticed.", status: "planned" },
  { control: "Rollback", detail: "Return to an earlier version in one step.", status: "planned" },
  {
    control: "Data region",
    detail: "Database and server both run in Mumbai, India (Supabase ap-south-1, Vercel bom1).",
    status: "built",
  },
  {
    control: "Open, small CLI",
    detail: "Public source and minimal dependencies, so a security team can audit what runs on laptops.",
    status: "planned",
  },
];

export default function SecurityPage() {
  return (
    <div className="container">
      <PageHeader
        eyebrow="Security"
        title={
          <>
            What axiomic protects, and <Mark padded>what it does not.</Mark>
          </>
        }
        lead="axiomic keeps AI rule files out of Git and under your team's control. It is not a vault, and it cannot control an AI. This page says exactly where the limits are."
      />
      <Prose>
        <h2 id="limits">Four things to know first</h2>
        <ol>
          <li>
            <strong>axiomic keeps rules out of Git.</strong> Rules live on axiomic&apos;s server and are written to each
            laptop as gitignored files. Your repository, its forks and its history carry code only.
          </li>
          <li>
            <strong>Your AI tool still sends the rules to its model provider.</strong> Claude Code reads the files and
            includes them in what it sends to its model. axiomic does not change that, and cannot.
          </li>
          <li>
            <strong>The rules are on the developer&apos;s disk.</strong> They are plain Markdown files in{" "}
            <code>.claude/rules/</code>, gitignored but readable by anyone and anything with access to that laptop. Do
            not put secrets in rules.
          </li>
          <li>
            <strong>An AI cannot be truly forced to obey a rule.</strong> Locked rules are placed first and marked
            MANDATORY. That is a strong instruction, not an enforcement mechanism. Keep real controls (reviews, CI,
            permissions) in place.
          </li>
        </ol>

        <Callout tone="warning" title="Pilot stage: private testing">
          <p>
            The axiomic server now runs in Mumbai, India, but only for our own testing: there is no public sign-up
            and no customer data on it yet. The controls marked “Planned” below are design decisions, not running
            systems.
          </p>
        </Callout>

        <h2 id="controls">Controls and their status</h2>
        <p>“Available (local)” means the code exists, is tested and runs on the laptop today. “Planned” means it is decided but not written yet.</p>
      </Prose>
      <div className={styles.controls}>
        <TableWrap label="Security controls">
          <thead>
            <tr>
              <th scope="col">Control</th>
              <th scope="col">What it does</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {CONTROLS.map((row) => (
              <tr key={row.control}>
                <td>{row.control}</td>
                <td>{row.detail}</td>
                <td>
                  <StatusBadge status={row.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </div>
      <Prose spaced>
        <h2 id="why">Why this matters</h2>
        <p>
          A tool that writes instructions for every AI agent on a team is a sensitive place. Whoever can publish a rule
          can influence what those agents do. That is why the planned controls focus on who can publish (roles,
          two-factor sign-in, approvals), on noticing changes (alerts, versions, rollback), and on checking rule text
          for hidden instructions before it is published.
        </p>

        <h2 id="laptop">On the laptop</h2>
        <ul>
          <li>
            axiomic writes only <code>.claude/rules/axiomic.md</code> and <code>.claude/rules/axiomic-&lt;module&gt;.md</code>.
            It never writes or overwrites <code>CLAUDE.md</code> or <code>AGENTS.md</code>.
          </li>
          <li>
            Every written path is added to an axiomic-owned block in <code>.gitignore</code> (and <code>.dockerignore</code>), and the CLI checks that Git really ignores the files.
          </li>
          <li>
            <code>axiomic remove</code> deletes the files axiomic wrote, its ignore-file blocks and the local cache. It keeps files you edited unless you add <code>--force</code>, and never deletes files axiomic did not write; the blocks stay while such files remain.
          </li>
          <li>
            When a login is revoked, or a person no longer has access to a project, the CLI deletes the rule files it
            wrote there the next time it runs (at session start or on <code>axiomic pull</code>). Files they edited are kept
            and reported. A laptop that stays offline keeps its last files until then, and copies already made cannot be
            recalled. Removing a person on the website is planned.
          </li>
        </ul>

        <h2 id="report">Reporting a problem</h2>
        <p>
          There is no public contact address yet. During the pilot, report problems to the person who gave you access.
          A security contact will be published here before any public launch.
        </p>
        <p>
          See also the <Link href="/docs/cli">CLI docs</Link>, and the draft <Link href="/privacy">privacy</Link> and{" "}
          <Link href="/terms">terms</Link> pages.
        </p>
      </Prose>
    </div>
  );
}
