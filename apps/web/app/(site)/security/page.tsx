/** /security: how axiomic protects rules, and its known limits. */
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import v from "@/components/landing/visuals.module.css";
import { Callout } from "@/components/ui/callout";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, type Status } from "@/components/ui/status-badge";
import { Mark } from "@/components/ui/type";
import s from "./security.module.css";

export const metadata: Metadata = {
  title: "Security",
  description: "What axiomic protects, what it does not, and every security control with its real status.",
};

/** Two things it protects, two it does not. */
const TILES: { yes: boolean; icon: ReactNode; title: string; text: string }[] = [
  { yes: true, icon: <><circle cx="6" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="9" r="2" /><path d="M6 8v8M18 11c0 4-6 3-12 6" /></>, title: "Out of Git", text: "Repos, forks and PRs carry code only." },
  { yes: true, icon: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />, title: "Checked first", text: "Secrets and tricks are stopped on every save." },
  { yes: false, icon: <path d="M7 18a4 4 0 0 1 0-8 6 6 0 0 1 11.5 1.5A3.5 3.5 0 0 1 18 18z" />, title: "Still sent to the AI", text: "Your AI tool reads them, like any instructions." },
  { yes: false, icon: <><rect x="4" y="5" width="16" height="11" rx="1.5" /><path d="M2 19h20" /></>, title: "Plain files on the laptop", text: "Gitignored, but readable there. No secrets in rules." },
];

/** One line per control. "local" = Available (built, tested, live). Keep in step with what's built. */
const CONTROLS: { name: string; text: string; status: Status }[] = [
  { name: "Verified gitignore", text: "Git itself confirms rule files are ignored, or nothing is written.", status: "local" },
  { name: "Safety check", text: "Secrets blocked, hidden text and injection phrasing flagged, on every save.", status: "local" },
  { name: "Lock clashes refused", text: "A rule that would be dropped by a locked one is refused when saved.", status: "local" },
  { name: "Tamper-proof files", text: "A rule can't pose as a company rule or hide the rules after it.", status: "local" },
  { name: "Server can't pick paths", text: "Every file path from the server is checked: only .claude/rules/axiomic*.md rule files are read or written.", status: "local" },
  { name: "Customer isolation", text: "Row-level security in the database: each space sees only its own rows.", status: "local" },
  { name: "The database decides", text: "Every save, approval and removal is checked by the database itself.", status: "local" },
  { name: "Encrypted rule text", text: "AES-256-GCM, key held outside the database, checked at start-up.", status: "local" },
  { name: "Tokens", text: "Hashed, header-only, revocable; unused ones expire after 90 days.", status: "local" },
  { name: "CLI login by code", text: "You type the code yourself; no approve link anyone could send you.", status: "local" },
  { name: "Rate limits", text: "On logins, invites and the CLI's API.", status: "local" },
  { name: "Sign-in", text: "GitHub or Google only, no passwords; 15-minute sessions.", status: "local" },
  { name: "Data in India", text: "Database and server in Mumbai (Supabase ap-south-1, Vercel bom1).", status: "local" },
  { name: "Offboarding", text: "A revoked login or removed person: the laptop deletes the files next session.", status: "local" },
  { name: "Open, small CLI", text: "Public source and no dependencies, so it can be audited.", status: "local" },
  { name: "Invites", text: "One use, one email, 7 days; the secret never reaches a server log.", status: "in-progress" },
  { name: "Two-factor sign-in for admins", text: "Required for admin tools in company spaces.", status: "planned" },
  { name: "Publish alerts", text: "An email on every publish.", status: "planned" },
  { name: "Rollback", text: "Return to an earlier version in one step.", status: "planned" },
];

export default function SecurityPage() {
  return (
    <div className="container">
      <PageHeader
        eyebrow="Security"
        title={
          <>
            What it protects, <Mark padded>and what it does not.</Mark>
          </>
        }
        lead="Out of Git and under your team's control. Not a vault, and no tool can force an AI to obey."
      />

      <ul className={v.tiles} id="limits">
        {TILES.map((t) => (
          <li key={t.title} className={`${v.tile} ${t.yes ? v.tileYes : v.tileNo}`}>
            <span className={v.icon}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {t.icon}
              </svg>
            </span>
            <h3>{t.title}</h3>
            <p>{t.text}</p>
          </li>
        ))}
      </ul>

      <h2 id="controls" className={s.h2}>Controls</h2>
      <ul className={s.controls}>
        {CONTROLS.map((c) => {
          const ready = c.status === "local";
          return (
            <li key={c.name} className={`${s.control} ${ready ? "" : s.later}`}>
              <span className={s.tick} aria-hidden="true">{ready ? "✓" : "○"}</span>
              <span>
                <b>{c.name}</b> {c.text} {ready ? null : <StatusBadge status={c.status} />}
              </span>
            </li>
          );
        })}
      </ul>

      <div className={s.note}>
        <Callout tone="note" title="Early access">
          <p>
            Anyone can sign up and try axiomic in a private space. In company spaces, inviting people and admin tools
            wait for two-factor sign-in. Found a problem? Tell the person who gave you access; a public security contact
            comes before 1.0. See also <Link href="/privacy">privacy</Link> and <Link href="/terms">terms</Link> (drafts).
          </p>
        </Callout>
      </div>
    </div>
  );
}
