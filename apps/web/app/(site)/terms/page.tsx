import type { Metadata } from "next";
import Link from "next/link";
import { Callout } from "../../../components/ui/callout";
import { PageHeader } from "../../../components/ui/page-header";
import { Placeholder, Prose } from "../../../components/ui/prose";

export const metadata: Metadata = {
  title: "Terms (draft)",
  description: "Draft terms of use for axiomic. Not yet reviewed by a lawyer and not in force.",
};

export default function TermsPage() {
  return (
    <div className="container">
      <PageHeader
        eyebrow="Legal · draft"
        title="Terms of use"
        lead="The intended rules for using axiomic. Short, and written to be read."
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
        <h2 id="who">Who provides the service</h2>
        <p>
          axiomic is provided by <Placeholder>legal entity — to be confirmed</Placeholder>,{" "}
          <Placeholder>registered address — to be confirmed</Placeholder>.
        </p>

        <h2 id="stage">Pilot stage</h2>
        <p>
          axiomic is in a private pilot. The service is not generally available. Features can change or be removed, and
          there is no uptime commitment during the pilot.
        </p>

        <h2 id="price">Price</h2>
        <p>
          axiomic is free during 1.0. If paid plans are introduced later, you will be told in advance:{" "}
          <Placeholder>notice period — to be confirmed</Placeholder>.
        </p>

        <h2 id="content">Your content</h2>
        <ul>
          <li>Your rules stay yours. We use them only to provide the service to you and your team.</li>
          <li>You are responsible for what you put in rules. Do not put passwords, keys or other secrets in them.</li>
          <li>In a work space, the company that owns the space controls its content and its members.</li>
        </ul>

        <h2 id="limits">What axiomic does not do</h2>
        <ul>
          <li>It keeps rules out of Git. It does not keep them off developers&apos; laptops.</li>
          <li>It does not control what your AI tool sends to its model provider.</li>
          <li>It cannot guarantee that an AI follows a rule, including rules marked mandatory.</li>
        </ul>
        <p>
          The <Link href="/security">security page</Link> explains these limits.
        </p>

        <h2 id="use">Acceptable use</h2>
        <ul>
          <li>Do not use axiomic to distribute instructions meant to harm a team, its code or its systems.</li>
          <li>Do not try to access another customer&apos;s data or to disrupt the service.</li>
          <li>Keep your sign-in and tokens to yourself. Tell your admin if a token may have leaked.</li>
        </ul>

        <h2 id="cli">The CLI</h2>
        <p>
          The command-line tool runs on your computer and writes files in your repositories. Its licence:{" "}
          <Placeholder>open-source licence — to be confirmed</Placeholder>.
        </p>

        <h2 id="end">Ending use</h2>
        <p>
          You can stop at any time. <code>axiomic remove</code> undoes what axiomic did in a repo: it deletes the rule files axiomic wrote (keeping any you edited unless you force it), its ignore-file blocks and its local cache. How account
          and workspace data is deleted: <Placeholder>deletion process and timing — to be confirmed</Placeholder>.
        </p>

        <h2 id="liability">Warranty and liability</h2>
        <p>
          <Placeholder>warranty disclaimer and limitation of liability — to be written by a lawyer</Placeholder>
        </p>

        <h2 id="law">Governing law</h2>
        <p>
          <Placeholder>governing law and courts — to be confirmed</Placeholder>
        </p>

        <h2 id="changes">Changes and contact</h2>
        <p>
          This draft will change. Effective date: <Placeholder>to be confirmed</Placeholder>. Contact:{" "}
          <Placeholder>contact — to be confirmed</Placeholder>. See also the draft <Link href="/privacy">privacy notice</Link>.
        </p>
      </Prose>
    </div>
  );
}
