/** /spaces/<space>/<project>: one project's rules, layer by layer, and the combined result. */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { estimateTokens, isValidSlug, type Layer } from "@axiomic/shared";
import p from "@/components/app/page.module.css";
import buttonStyles from "@/components/ui/button.module.css";
import { Callout } from "@/components/ui/callout";
import { PageHeader } from "@/components/ui/page-header";
import { getVerifiedClaims } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { keyring } from "@/lib/rules/rule-keys";
import { loadProjectView, spaceLabel, type ProjectView } from "@/lib/spaces/workspace";

export const metadata: Metadata = {
  title: "Project rules",
  robots: { index: false },
};

type Props = {
  params: Promise<{ space: string; project: string }>;
  searchParams: Promise<{ view?: string; saved?: string }>;
};

type ShownRule = { id: string; title: string; body: string; locked?: boolean };

/** Fixed sentences for ?saved=, never text from the URL. */
const SAVED: Record<string, string> = {
  rule: "Saved. Laptops get it at their next AI session.",
  suggestion: "Suggestion sent. The layer's owner can approve it under Suggestions.",
  deleted: "Rule deleted. Laptops drop it at their next AI session.",
  project: "Project created, and you're its owner. Add folders and change settings under Settings.",
};

/**
 * One project's rules: each layer on its own (what was written where), and the combined file
 * (what `axiomic pull` writes on YOUR laptop: merge() + renderClaude(), the same code the CLI's
 * server path uses). Personal rules: only yours, as in a pull.
 */
export default async function ProjectPage({ params, searchParams }: Props) {
  const claims = await getVerifiedClaims();
  if (!claims) redirect("/sign-in");
  const { space, project } = await params;
  if (!isValidSlug(space) || !isValidSlug(project)) notFound();
  const { view: tab, saved } = await searchParams;

  const r = await withUser(claims, (tx) => loadProjectView(tx, keyring(), { space, project }), { snapshot: true });
  if (!r.ok && r.status === 404) notFound();
  if (!r.ok) {
    return (
      <div className={`container ${p.page}`}>
        <Crumbs space={space} />
        <PageHeader eyebrow="Project" title={project} />
        <Callout tone="warning" title="This project is archived">
          <p>
            Archived projects keep their rules but can't be pulled or changed.{" "}
            <Link href={`/spaces/${space}/${project}/settings`}>Settings</Link>
          </p>
        </Callout>
      </div>
    );
  }
  const v = r.view;
  const base = `/spaces/${space}/${project}`;
  const combined = tab === "combined";
  const adminWithout2fa = v.space.kind === "work" && v.space.role === "admin" && claims.aal !== "aal2";

  return (
    <div className={`container ${p.page}`}>
      <Crumbs space={space} spaceName={spaceLabel(v.space)} />
      <PageHeader
        eyebrow={v.team.hidden ? spaceLabel(v.space) : `${spaceLabel(v.space)} · team ${v.team.name}`}
        title={v.loaded.project.name}
        lead={
          <>
            In the repo: <code>axiomic init {space}/{project}</code>
          </>
        }
      />
      {saved && SAVED[saved] ? <Callout tone="note" title={SAVED[saved]} /> : null}
      {adminWithout2fa ? (
        <Callout tone="warning" title="Admin changes need two-factor sign-in">
          <p>
            In a company space, admin powers only work after a two-factor sign-in, which isn't built yet. Until then your
            changes to layers you don't own go in as suggestions.
          </p>
        </Callout>
      ) : null}
      {v.pendingSuggestions > 0 ? (
        <p className={p.small}>
          {v.pendingSuggestions} pending {v.pendingSuggestions === 1 ? "suggestion" : "suggestions"} you can see for this
          project. <Link href="/suggestions">Open Suggestions</Link>
        </p>
      ) : null}

      <nav className={p.tabs} aria-label="View">
        <Link href={base} className={p.tab} aria-current={combined ? undefined : "page"}>
          By layer
        </Link>
        <Link href={`${base}?view=combined`} className={p.tab} aria-current={combined ? "page" : undefined}>
          Combined file
        </Link>
        <Link href={`${base}/settings`} className={p.tab}>
          Settings and folders
        </Link>
      </nav>

      {combined ? <Combined v={v} /> : <ByLayer v={v} base={base} />}
    </div>
  );
}

function Crumbs({ space, spaceName }: { space: string; spaceName?: string }) {
  return (
    <ol className={p.crumbs}>
      <li>
        <Link href="/spaces">Projects</Link>
      </li>
      <li>
        <Link href={`/spaces/${space}`}>{spaceName ?? space}</Link>
      </li>
    </ol>
  );
}

/** Each layer, widest first, as written. Tags say what the merge did with each rule. */
function ByLayer({ v, base }: { v: ProjectView; base: string }) {
  const shown = new Set([...v.result.main, ...v.result.modules.flatMap((m) => m.rules)].map((x) => x.id));
  const blocked = new Map(v.result.blocked.map((b) => [b.ruleId, b.reason]));
  const status = (id: string) => (shown.has(id) ? null : blocked.has(id) ? "blocked" : "replaced");
  const moduleRules = new Map(v.loaded.input.modules.map((m) => [m.id, m.rules as ShownRule[]]));

  return (
    <>
      <LayerCard
        title="Company rules"
        note={`Every project in ${spaceLabel(v.space)}.`}
        layer="company"
        rules={v.loaded.input.company}
        canEdit={v.rights.company}
        base={base}
        status={status}
        version={(id) => v.loaded.rules.get(id)?.version}
        hidden={v.space.kind === "personal" && v.loaded.input.company.length === 0}
      />
      <LayerCard
        title={v.team.hidden ? "Team rules" : `Team rules: ${v.team.name}`}
        note="Every project of this team."
        layer="team"
        rules={v.loaded.input.team}
        canEdit={v.rights.team}
        base={base}
        status={status}
        version={(id) => v.loaded.rules.get(id)?.version}
        hidden={v.team.hidden && v.loaded.input.team.length === 0}
      />
      <LayerCard
        title="Project rules"
        note="This project only."
        layer="project"
        rules={v.loaded.input.project}
        canEdit={v.rights.project}
        base={base}
        status={status}
        version={(id) => v.loaded.rules.get(id)?.version}
      />
      {v.modules.map((m) => (
        <LayerCard
          key={m.id}
          title={`Folder rules: ${m.name}`}
          note={`Loaded only while working in ${m.path}/.${m.ownerName ? ` Owner: ${m.ownerName}.` : ""}`}
          layer="module"
          moduleId={m.id}
          rules={moduleRules.get(m.id) ?? []}
          canEdit={v.rights.modules[m.id] ?? false}
          base={base}
          status={status}
          version={(id) => v.loaded.rules.get(id)?.version}
        />
      ))}
      <LayerCard
        title="Your personal rules"
        note={v.space.kind === "work" ? "Only for you. They add to the work rules and never replace one. Space admins can read them." : "Only for you."}
        layer="personal"
        rules={v.loaded.input.personal}
        canEdit={v.rights.personal}
        base={base}
        status={status}
        version={(id) => v.loaded.rules.get(id)?.version}
      />
    </>
  );
}

const STATUS_TEXT = {
  replaced: "Replaced by a narrower rule with the same title",
  blocked: "Not delivered: clashes with a locked rule, or a personal rule can't replace a work rule",
} as const;

function LayerCard(props: {
  title: string;
  note: string;
  layer: Layer;
  moduleId?: string;
  rules: ShownRule[];
  canEdit: boolean;
  base: string;
  status: (id: string) => "replaced" | "blocked" | null;
  version: (id: string) => number | undefined;
  hidden?: boolean;
}) {
  if (props.hidden) return null;
  const { layer, rules, canEdit, base } = props;
  const newHref = `${base}/rules/new?layer=${layer}${props.moduleId ? `&module=${props.moduleId}` : ""}`;
  return (
    <section className={p.card} aria-label={props.title}>
      <div className={p.cardHead}>
        <h2 className={p.cardTitle}>{props.title}</h2>
        <Link href={newHref} className={`${buttonStyles.button} ${buttonStyles.secondary} ${buttonStyles.md}`}>
          {canEdit ? "Add a rule" : "Suggest a rule"}
        </Link>
      </div>
      <p className={p.small}>
        {props.note} {canEdit ? "You can change this layer." : "You can suggest changes; the owner decides."}
      </p>
      {rules.length === 0 ? <p className={p.small}>No rules in this layer.</p> : null}
      {rules.map((rule) => {
        const s = props.status(rule.id);
        const version = props.version(rule.id);
        return (
          <article key={rule.id} className={p.row} style={{ display: "block" }}>
            <div className={p.cardHead}>
              <h3 className={p.h3} style={{ margin: 0 }}>
                {rule.title}
              </h3>
              <span className={p.tags}>
                {rule.locked ? <span className={p.tagAccent}>Locked · MANDATORY</span> : null}
                {version ? <span className={p.tag}>v{version}</span> : null}
                {s ? <span className={p.tagWarn}>{s === "replaced" ? "Replaced" : "Not delivered"}</span> : null}
              </span>
            </div>
            {s ? <p className={p.small}>{STATUS_TEXT[s]}.</p> : null}
            {rule.body ? <pre className={p.ruleBody}>{rule.body}</pre> : null}
            {canEdit || (!rule.locked && layer !== "personal") ? (
              <div className={p.actions}>
                <Link href={`${base}/rules/${rule.id}`} className={`${buttonStyles.button} ${buttonStyles.text}`}>
                  {canEdit ? "Edit" : "Suggest a change"} →
                </Link>
              </div>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}

/** What lands on your laptop: the rendered files, byte for byte, plus what the merge dropped. */
function Combined({ v }: { v: ProjectView }) {
  return (
    <>
      <p className={p.small}>
        These are the files <code>axiomic pull</code> writes for you (with your personal rules). Other people see their own
        personal rules instead of yours.
      </p>
      {v.files.map((f) => (
        <section key={f.path} className={p.card} aria-label={f.path}>
          <div className={p.cardHead}>
            <h2 className={p.cardTitle}>
              <code>{f.path}</code>
            </h2>
            <span className={p.small}>
              {Buffer.byteLength(f.content, "utf8").toLocaleString("en-IN")} bytes · about{" "}
              {estimateTokens(f.content).toLocaleString("en-IN")} tokens
            </span>
          </div>
          <pre className={p.pre}>{f.content}</pre>
        </section>
      ))}
      {v.result.blocked.length > 0 ? (
        <section className={p.card} aria-label="Not delivered">
          <h2 className={p.cardTitle}>Not delivered</h2>
          <ul>
            {v.result.blocked.map((b) => (
              <li key={b.ruleId}>
                <strong>{b.title}</strong> ({b.source}):{" "}
                {b.reason === "locked" ? "a locked rule has this title" : "personal rules can only add, not replace"}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
