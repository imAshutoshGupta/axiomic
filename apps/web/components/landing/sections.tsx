import Link from "next/link";
import { ButtonLink } from "../ui/button";
import { CodeBlock } from "../ui/code-block";
import { Section, Split } from "../ui/section";
import { StatusBadge, type Status } from "../ui/status-badge";
import { Mark } from "../ui/type";
import styles from "./sections.module.css";

const TERMINAL = `$ axiomic init   # once per repo
$ claude         # the hook fetches the rules
$ git status
On branch main
nothing to commit, working tree clean`;

const TREE = `your-repo/
├─ .claude/rules/
│  ├─ axiomic.md            every session
│  └─ axiomic-checkout.md   only for checkout/
├─ .gitignore               has the axiomic block
├─ axiomic.json             project link, committed
└─ src/`;

/** What a developer does and sees. */
export function DeveloperSection() {
  return (
    <Section
      id="developer"
      eyebrow="On the laptop"
      title={
        <>
          One command. Then <Mark>nothing to do.</Mark>
        </>
      }
      lead="Developers do not write, copy or open rule files. The files appear when an AI session starts, and Git never sees them."
    >
      <p className={styles.planned}>
        Planned flow: <code>init</code> and the server fetch are not built yet. The file writing, gitignore block and
        hook below already work locally.
      </p>
      <Split>
        <ol className={styles.points}>
          <li>
            <div>
              <h3>Link the repo once</h3>
              <p>
                An admin gives you access to the project. You run <code>axiomic init</code> in the repo. It links the
                repo and installs a session-start hook.
              </p>
            </div>
          </li>
          <li>
            <div>
              <h3>Open Claude Code</h3>
              <p>
                The hook fetches your combined rules and writes them to <code>.claude/rules/axiomic*.md</code>. If the
                server is slow or down, it uses the last copy and the session starts anyway.
              </p>
            </div>
          </li>
          <li>
            <div>
              <h3>Git stays clean</h3>
              <p>
                Every written path is listed in an axiomic block in <code>.gitignore</code>. Your own{" "}
                <code>CLAUDE.md</code> and <code>AGENTS.md</code> are never touched.
              </p>
            </div>
          </li>
        </ol>
        <div className={styles.stack}>
          <CodeBlock
            variant="terminal"
            title="Terminal"
            code={TERMINAL}
            note={
              <>
                Planned flow. <code>init</code> and the server fetch are not built yet. See the{" "}
                <Link href="/docs/cli">CLI docs</Link> for what works today.
              </>
            }
          />
          <CodeBlock variant="file" title="What ends up on disk" code={TREE} />
        </div>
      </Split>
    </Section>
  );
}

const LAYERS = [
  { name: "Company", text: "Owned by the company admin. Applies to every team.", lock: true },
  { name: "Team", text: "Owned by the team lead. Applies to that team's projects.", lock: true },
  { name: "Project", text: "Owned by the project owner. One repo." },
  { name: "Module", text: "Owned by a module owner. One folder, loaded only when the AI works in it." },
  { name: "Personal", text: "Owned by one developer. Adds preferences, never replaces a work rule." },
];

const RULE_FILE = `<!-- Managed by axiomic (version 43). Change these rules on the axiomic website, not here. -->
# Rules from axiomic

These rules are listed from widest to narrowest: company, team, project, then personal.

## Company rules

### MANDATORY: Secrets

Never print, log or commit API keys or tokens.

## Team rules

### Testing

Run \`npm test\` before you say a task is done.

## Project rules

### Code style

Use the project's ESLint config. No default exports.

## Your personal rules

### Explanations

Explain each change in short steps.`;

/** The five layers and how they combine. */
export function LayersSection() {
  return (
    <Section
      id="layers"
      eyebrow="Rule layers"
      title={
        <>
          Five layers, <Mark>one file per developer.</Mark>
        </>
      }
      lead="Rules are written where they belong and combined per person, from widest to narrowest."
    >
      <Split>
        <div>
          <ol className={styles.layers}>
            {LAYERS.map((layer, i) => (
              <li key={layer.name}>
                <span className={styles.layerNum} aria-hidden="true">
                  {i + 1}
                </span>
                <span className={styles.layerName}>{layer.name}</span>
                <span>
                  {layer.text}
                  {layer.lock ? <span className={styles.lock}>can be locked</span> : null}
                </span>
              </li>
            ))}
          </ol>
          <ul className={styles.plain}>
            <li>
              <strong>Same title, narrower wins.</strong> A project rule titled “Code style” replaces the team rule with
              that title.
            </li>
            <li>
              <strong>Locked rules cannot be replaced.</strong> They come first in the file, marked MANDATORY.
            </li>
            <li>
              <strong>Anyone can suggest a change.</strong> The owner of that layer approves it.
            </li>
          </ul>
        </div>
        <CodeBlock
          variant="file"
          title=".claude/rules/axiomic.md (example, shortened)"
          code={RULE_FILE}
          wrap
        />
      </Split>
    </Section>
  );
}

/** Four plain statements, then the link to the full page. */
export function SecuritySection() {
  return (
    <Section
      id="security"
      eyebrow="Security, honestly"
      title={
        <>
          What it protects, and <Mark>what it does not.</Mark>
        </>
      }
    >
      <ul className={styles.facts}>
        <li>
          <h3>Rules stay out of Git</h3>
          <p>They are written as gitignored files. Repos, forks and pull requests carry code only.</p>
        </li>
        <li>
          <h3>Your AI tool still sends them to its model provider</h3>
          <p>That is how the tool reads them. axiomic does not change where your AI tool sends its context.</p>
        </li>
        <li>
          <h3>Rules are on the developer&apos;s disk</h3>
          <p>Anyone with access to the laptop can read them. Removing a person stops future updates.</p>
        </li>
        <li>
          <h3>“Mandatory” is a strong instruction, not a guarantee</h3>
          <p>An AI cannot be truly forced to obey a rule. Locked rules are placed first and marked MANDATORY.</p>
        </li>
      </ul>
      <p className={styles.more}>
        <ButtonLink href="/security" variant="secondary">
          Read the security page
        </ButtonLink>
      </p>
    </Section>
  );
}

const STATUS: { label: string; status: Status }[] = [
  { label: "Layer merge logic, name and path guards, Claude Code file format", status: "built" },
  { label: "Publish safety-check logic (secrets, hidden characters, label imitation)", status: "built" },
  { label: "Local CLI pieces: hook install, status, remove", status: "built" },
  { label: "Server, database and sign-in", status: "planned" },
  { label: "Website editor, suggestions and approvals", status: "planned" },
  { label: "CLI login, init, pull and push", status: "planned" },
  { label: "axiomic 1.0 on npm", status: "planned" },
];

/** Honest about the stage: no sign-up form, because there is nothing to sign in to yet. */
export function StatusSection() {
  return (
    <Section
      id="status"
      eyebrow="Status"
      title={
        <>
          Pilot stage. <Mark>Not launched.</Mark>
        </>
      }
      lead="axiomic is being built and tested with one team first. There is no sign-up yet. It will be free during 1.0."
    >
      <ul className={styles.status}>
        {STATUS.map((item) => (
          <li key={item.label}>
            <span>{item.label}</span>
            <StatusBadge status={item.status} />
          </li>
        ))}
      </ul>
      <p className={styles.statusNote}>
        Claude Code is the first supported tool. Cursor is planned and still being tested. The 0.x versions of{" "}
        <code>axiomic</code> on npm are broken. Please do not install them.
      </p>
      <p className={styles.more}>
        <ButtonLink href="/docs/cli">Read the CLI docs</ButtonLink>
        <ButtonLink href="/security" variant="text">
          Security →
        </ButtonLink>
      </p>
    </Section>
  );
}
