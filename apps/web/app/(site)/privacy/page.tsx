import type { Metadata } from "next";
import Link from "next/link";
import { Callout } from "../../../components/ui/callout";
import { PageHeader } from "../../../components/ui/page-header";
import { Placeholder, Prose } from "../../../components/ui/prose";

export const metadata: Metadata = {
  title: "Privacy (draft)",
  description: "Draft privacy notice for axiomic. Not yet reviewed by a lawyer and not in force.",
};

export default function PrivacyPage() {
  return (
    <div className="container">
      <PageHeader
        eyebrow="Legal · draft"
        title="Privacy notice"
        lead="What personal data axiomic expects to handle, why, and what you can ask us to do with it."
      >
        <Callout
          tone="draft"
          title="Draft — not yet reviewed by a lawyer. Requires legal review under India's Digital Personal Data Protection Act, 2023 (DPDP Act) before it applies."
        >
          <p>
            This text shows what we intend. It is not in force, and it creates no rights or duties. Items in{" "}
            <Placeholder>square brackets</Placeholder> are not decided yet.
          </p>
        </Callout>
      </PageHeader>
      <Prose>
        <h2 id="who">Who is responsible</h2>
        <p>
          axiomic is operated by <Placeholder>legal entity — to be confirmed</Placeholder>, registered at{" "}
          <Placeholder>registered address — to be confirmed</Placeholder>. Under the DPDP Act this entity would be the
          Data Fiduciary for account data. Contact: <Placeholder>privacy contact — to be confirmed</Placeholder>.
        </p>

        <h2 id="this-site">This website today</h2>
        <p>
          This site has no analytics and no third-party scripts. If you sign in, Supabase (our sign-in and database
          provider) sets session cookies that keep you signed in; nothing else uses cookies. If you switch between light and dark, that choice is saved in your browser&apos;s <code>localStorage</code> and is never sent anywhere. Fonts are served
          from this site. The hosting provider keeps standard server logs (such as IP address and time of request).
        </p>

        <h2 id="data">Data the service is expected to handle</h2>
        <p>The service is not running yet. When it is, we expect to handle:</p>
        <ul>
          <li>
            <strong>Account data:</strong> your name, email address and profile picture from GitHub or Google sign-in.
          </li>
          <li>
            <strong>Workspace data:</strong> the companies, teams and projects you belong to, and your role in each. When an
            admin invites someone, the invited email address is stored with the invite.
          </li>
          <li>
            <strong>Rule content:</strong> the rule text your team writes, its versions, and suggested changes. In a
            work space, admins can read your work personal rules, and you are told so. Rules in a personal space are
            readable only by you.
          </li>
          <li>
            <strong>Usage records:</strong> which version of the rules your CLI last fetched and when, token last-used
            times, and an activity log of changes.
          </li>
        </ul>
        <p>We do not intend to collect your source code. The CLI does not upload it.</p>

        <h2 id="why">Why we use it</h2>
        <ul>
          <li>To deliver the right rules to the right people, and to stop delivery when access is removed.</li>
          <li>To show admins who is on which version.</li>
          <li>To keep the service secure and to investigate misuse.</li>
        </ul>
        <p>We do not sell personal data and do not use it for advertising.</p>

        <h2 id="where">Where it is stored and who processes it</h2>
        <p>
          The database and the server are hosted in Mumbai, India. We expect to use these processors:{" "}
          <Placeholder>list of processors, such as hosting, database and email providers — to be confirmed</Placeholder>.
        </p>

        <h2 id="keep">How long we keep it</h2>
        <p>
          <Placeholder>retention periods for accounts, rule versions, logs and backups — to be confirmed</Placeholder>.
          The intent is to keep data only as long as the account or workspace exists, plus a short backup period.
        </p>

        <h2 id="rights">Your rights</h2>
        <p>
          Under the DPDP Act you may have the right to access, correct and erase your personal data, to withdraw
          consent, to nominate another person, and to raise a grievance. How to use these rights:{" "}
          <Placeholder>process and grievance officer — to be confirmed</Placeholder>. A “delete my data” option is
          planned.
        </p>

        <h2 id="work">If your employer set up the workspace</h2>
        <p>
          Your company controls its work space. It decides who has access and can remove you. Requests about work-space
          content may need to go to your company first.
        </p>

        <h2 id="changes">Changes</h2>
        <p>
          This draft will change. The reviewed version will carry an effective date:{" "}
          <Placeholder>effective date — to be confirmed</Placeholder>. See also the draft{" "}
          <Link href="/terms">terms</Link> and the <Link href="/security">security page</Link>.
        </p>
      </Prose>
    </div>
  );
}
