/** /docs/cli: the CLI guide, built from content/cli.ts. */
import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/ui/code-block";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { Mark } from "@/components/ui/type";
import { CLI_COMMANDS, CLI_FOLDERS, EXIT_CODES, NOT_AVAILABLE_NOTE, type CliCommand } from "@/content/cli";
import styles from "@/app/(site)/docs/docs.module.css";

export const metadata: Metadata = {
  title: "CLI docs",
  description:
    "The axiomic command-line tool: quick start, every command with examples, exit codes and where it keeps its files.",
};

/** "hook install" → "hook-install", for anchors. */
const slug = (usage: string) => `cmd-${usage.replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "")}`;

const AVAILABLE = CLI_COMMANDS.filter((c) => c.status === "available" && !c.usage.startsWith("-"));
const COMING = CLI_COMMANDS.filter((c) => c.status === "coming");

/** The preview build until 1.0 is on npm (README has the same line). Needs Node 22 or newer. */
const INSTALL = "npm i -g https://github.com/imAshutoshGupta/axiomic/raw/main/office-test/axiomic-1.0.0-dev.0.tgz";

const QUICK_START = [
  { title: "Install", code: ["# preview build, Node 22+", INSTALL], text: "Once per laptop. Version 1.0 will be on npm." },
  { title: "Sign in and link the repo", code: ["axiomic login", "axiomic init acme/web-app"], text: "Type the code in your browser, then link the repo from its top folder. Your project's exact command is on its page on the website." },
  { title: "Open Claude Code", code: ["claude"], text: "The hook writes your rules. Nothing to run, nothing to commit." },
  { title: "Check anytime", code: ["axiomic status"], text: "Confirms the hook works and Git ignores every rule file." },
];

const TREE = `your-repo/
├─ .claude/rules/
│  ├─ axiomic.md            loaded every session
│  └─ axiomic-checkout.md   only inside checkout/
├─ .gitignore               + axiomic block
├─ axiomic.json             project link (no secrets)
└─ CLAUDE.md                yours, never touched`;

/** A dark snippet: "#" lines are dimmed comments, others get a "$" prompt. */
function Snip({ lines }: { lines: string[] }) {
  return (
    <pre className={styles.snip}>
      {lines.map((l, i) => (
        <span key={i}>
          {l.startsWith("#") ? <i>{l}</i> : <><i>$ </i>{l}</>}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

function Command({ cmd }: { cmd: CliCommand }) {
  return (
    <article id={slug(cmd.usage)} className={styles.cmd}>
      <header className={styles.cmdHead}>
        <h3 className={styles.cmdName}>axiomic {cmd.usage}</h3>
        <StatusBadge status={cmd.status} />
      </header>
      <div className={styles.cmdBody}>
        <div>
          <p className={styles.cmdText}>{cmd.summary}</p>
          {cmd.details ? (
            <ul className={styles.ticks}>
              {cmd.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          ) : null}
        </div>
        <div>
          {cmd.example ? (
            <>
              <p className={styles.label}>Example</p>
              <Snip lines={cmd.example} />
            </>
          ) : null}
          {cmd.flags ? (
            <>
              <p className={styles.label} style={{ marginTop: 16 }}>
                Flags
              </p>
              <ul className={styles.flags}>
                {cmd.flags.map((f) => (
                  <li key={f.flag}>
                    <code>{f.flag}</code>
                    <span>{f.summary}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </div>
    </article>
  );
}

const CODE_STYLE = [styles.ok, styles.fail, styles.usage];

export default function CliDocsPage() {
  return (
    <div className="container">
      <div className={styles.layout}>
        <nav className={styles.side} aria-label="Docs">
          <h2>Get started</h2>
          <ul>
            <li><a href="#quick-start">Quick start</a></li>
            <li><a href="#on-disk">What lands in your repo</a></li>
          </ul>
          <h2>Commands</h2>
          <ul>
            {AVAILABLE.map((c) => (
              <li key={c.usage}>
                <a href={`#${slug(c.usage)}`}><code>{c.usage}</code></a>
              </li>
            ))}
            <li><a href="#coming">Coming next</a></li>
          </ul>
          <h2>Reference</h2>
          <ul>
            <li><a href="#exit-codes">Exit codes</a></li>
            <li><a href="#folders">Folders</a></li>
            <li><Link href="/security">Security</Link></li>
            <li><Link href="/faq">FAQ</Link></li>
          </ul>
        </nav>

        <div className={styles.main}>
          <PageHeader
            eyebrow="Docs · CLI"
            title={
              <>
                The axiomic <Mark padded>command line.</Mark>
              </>
            }
            lead="Puts your team's rules on the laptop as gitignored files, refreshes them every Claude Code session, and undoes everything on request."
          />

          <h2 id="quick-start" className={styles.h2}>Quick start</h2>
          <p className={styles.sub}>
            Four steps. First <Link href="/sign-in">sign up free</Link> and add a project on the website.
          </p>
          <ol className={styles.steps}>
            {QUICK_START.map((s) => (
              <li key={s.title} className={styles.step}>
                <div className={styles.stepHead}>
                  <h3>{s.title}</h3>
                </div>
                <Snip lines={s.code} />
                <p className={styles.stepText}>{s.text}</p>
              </li>
            ))}
          </ol>

          <h2 id="on-disk" className={styles.h2}>What lands in your repo</h2>
          <p className={styles.sub}>Two kinds of rule file, all gitignored. Nothing else changes.</p>
          <CodeBlock variant="file" title="After the first session" code={TREE} />

          <h2 id="commands" className={styles.h2}>Commands</h2>
          <p className={styles.sub}>
            Also: <code>--help</code>, <code>--version</code>.
          </p>
          {AVAILABLE.map((cmd) => (
            <Command key={cmd.usage} cmd={cmd} />
          ))}

          <h2 id="coming" className={styles.h2}>Coming next</h2>
          <p className={styles.sub}>{NOT_AVAILABLE_NOTE}</p>
          <ul className={styles.grid}>
            {COMING.map((c) => (
              <li key={c.usage} id={slug(c.usage)} className={styles.mini}>
                <h3>axiomic {c.usage}</h3>
                <p>{c.summary}</p>
              </li>
            ))}
          </ul>

          <h2 id="exit-codes" className={styles.h2}>Exit codes</h2>
          <p className={styles.sub}>Handy in scripts and CI.</p>
          <ul className={styles.codes}>
            {EXIT_CODES.map((row, i) => (
              <li key={row.code} className={styles.codeCard}>
                <span className={`${styles.codeNum} ${CODE_STYLE[i] ?? ""}`}>{row.code}</span>
                {row.meaning}
              </li>
            ))}
          </ul>

          <h2 id="folders" className={styles.h2}>Where axiomic keeps its files</h2>
          <p className={styles.sub}>Never inside your project. Private to your user account.</p>
          <ul className={styles.codes}>
            {CLI_FOLDERS.map((f) => (
              <li key={f.name} className={styles.folder}>
                <h3>{f.name}</h3>
                <p>{f.holds}</p>
                <div className={styles.path}>
                  <span>macOS/Linux</span>
                  <code>{f.unix}</code>
                  <span>Windows</span>
                  <code>{f.windows}</code>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
