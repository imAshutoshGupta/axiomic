import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isValidSlug } from "@axiomic/shared";
import { ActionForm } from "../../../../components/app/action-form";
import p from "../../../../components/app/page.module.css";
import { Callout } from "../../../../components/ui/callout";
import { PageHeader } from "../../../../components/ui/page-header";
import { getVerifiedClaims } from "../../../../lib/auth";
import { withUser } from "../../../../lib/db";
import { loadSpaceManage, type SpaceManageView } from "../../../../lib/manage";
import { listSpaces, spaceLabel, type SpaceSummary } from "../../../../lib/workspace";
import { manageSpace } from "./actions";

export const metadata: Metadata = {
  title: "Space",
  robots: { index: false },
};

type Props = {
  params: Promise<{ space: string }>;
  searchParams: Promise<{ tab?: string; created?: string; joined?: string }>;
};

const ROLE_TEXT = {
  admin: "Everything: people, roles, teams, company rules",
  editor: "Creates projects; edits the layers they own",
  reader: "Reads rules; changes go in as suggestions",
} as const;
const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * One space: its projects, its teams and its people. Buttons only appear for what you may do,
 * but every one is decided again by the database (lib/manage.ts, ./actions.ts).
 */
export default async function SpacePage({ params, searchParams }: Props) {
  const claims = await getVerifiedClaims();
  if (!claims) redirect("/sign-in");
  const { space } = await params;
  const { tab, created, joined } = await searchParams;
  if (!isValidSlug(space)) notFound();

  const data = await withUser(claims, async (tx) => {
    const view = await loadSpaceManage(tx, space);
    const summary = view ? (await listSpaces(tx)).find((s) => s.id === view.space.id) : undefined;
    return view && summary ? { view, summary } : null;
  });
  if (!data) notFound();
  const { view: v, summary } = data;
  const work = v.space.kind === "work";
  const current = work && (tab === "teams" || tab === "people") ? tab : "projects";
  const base = `/spaces/${space}`;

  return (
    <div className={`container ${p.page}`}>
      <ol className={p.crumbs}>
        <li>
          <Link href="/spaces">Projects</Link>
        </li>
      </ol>
      <PageHeader
        eyebrow={work ? `Company space · you are ${v.space.role}` : "Your private space"}
        title={spaceLabel(v.space)}
        lead={work ? undefined : "Only you can see it. Good for hobby projects and trying axiomic out."}
      />
      {joined ? <Callout tone="note" title="Welcome! You've joined this space. Open a project to see its rules, or run axiomic init in its repo." /> : null}
      {created ? <Callout tone="note" title="Company space created. You're its admin and the lead of its General team." /> : null}
      {v.adminNeeds2fa ? (
        <Callout tone="warning" title="Admin tools need two-factor sign-in">
          <p>
            You're an admin here, but in a company space admin actions (inviting, roles, teams, company rules) only work after a
            two-factor sign-in, which isn't built yet. You can already create projects, add folders, and manage the teams you lead.
          </p>
        </Callout>
      ) : null}

      {work ? (
        <nav className={p.tabs} aria-label="Space sections">
          {(["projects", "teams", "people"] as const).map((t) => (
            <Link key={t} href={t === "projects" ? base : `${base}?tab=${t}`} className={p.tab} aria-current={current === t ? "page" : undefined}>
              {t === "projects" ? "Projects" : t === "teams" ? `Teams (${v.teams.length})` : `People (${v.members.length})`}
            </Link>
          ))}
        </nav>
      ) : null}

      {current === "projects" ? <Projects v={v} summary={summary} /> : null}
      {current === "teams" ? <Teams v={v} /> : null}
      {current === "people" ? <People v={v} /> : null}
    </div>
  );
}

function Projects({ v, summary }: { v: SpaceManageView; summary: SpaceSummary }) {
  const slug = v.space.slug;
  return (
    <>
      <ul className={p.list} style={{ marginTop: 16 }}>
        {summary.projects.length === 0 ? <li className={p.row}>No projects yet.</li> : null}
        {summary.projects.map((proj) => (
          <li key={proj.id} className={p.row}>
            <span>
              <Link href={`/spaces/${slug}/${proj.slug}`}>
                <strong>{proj.name}</strong>
              </Link>
              <br />
              <span className={p.small}>
                <code>
                  axiomic init {slug}/{proj.slug}
                </code>
                {proj.teamName ? ` · team ${proj.teamName}` : null}
              </span>
            </span>
            {proj.archived ? <span className={p.tagWarn}>Archived</span> : null}
          </li>
        ))}
      </ul>
      {v.canCreateProject ? (
        <section className={p.card} aria-label="New project">
          <h2 className={p.cardTitle}>New project</h2>
          <p className={p.small}>One project per repository. You become its owner. The short name is what developers type in <code>axiomic init</code>, and it can't be changed later.</p>
          <ActionForm action={manageSpace} hidden={{ space: slug, intent: "create-project" }} submit="Create project" variant="primary">
            <label className={p.label}>
              Name
              <input className={p.input} name="name" required maxLength={100} placeholder="Web app" />
            </label>
            <label className={p.label}>
              Short name
              <input className={p.input} name="slug" required pattern="[a-z0-9][a-z0-9\-]{1,30}" maxLength={31} placeholder="web-app" />
            </label>
            {v.space.kind === "work" ? (
              <label className={p.label}>
                Team
                <select className={p.select} name="team" required defaultValue={v.teams[0]?.id}>
                  {v.teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </ActionForm>
        </section>
      ) : (
        <p className={p.small}>Readers can't create projects; ask an editor or admin.</p>
      )}
    </>
  );
}

function Teams({ v }: { v: SpaceManageView }) {
  const slug = v.space.slug;
  return (
    <>
      <p className={p.small}>
        Each project belongs to one team. A team&rsquo;s <strong>leads</strong> own its team rules and manage its members.
      </p>
      <div className={p.grid2}>
        {v.teams.map((t) => {
          const outside = v.members.filter((m) => !t.members.some((x) => x.userId === m.userId));
          return (
            <section key={t.id} className={p.card} aria-label={`Team ${t.name}`}>
              <div className={p.cardHead}>
                <h2 className={p.cardTitle}>{t.name}</h2>
                <span className={p.tag}>{t.slug}</span>
              </div>
              <ul className={p.list} style={{ marginTop: 8 }}>
                {t.members.length === 0 ? <li className={p.row}>No one yet.</li> : null}
                {t.members.map((m) => (
                  <li key={m.userId} className={p.row}>
                    <span>
                      {m.name} {m.role === "lead" ? <span className={p.tagAccent}>Lead</span> : null}
                    </span>
                    {t.canManage ? (
                      <span className={p.inlineForm}>
                        <ActionForm
                          inline
                          action={manageSpace}
                          hidden={{ space: slug, intent: "set-team-member", team: t.id, user: m.userId, role: m.role === "lead" ? "member" : "lead" }}
                          submit={m.role === "lead" ? "Make member" : "Make lead"}
                          variant="text"
                        />
                        <ActionForm
                          inline
                          action={manageSpace}
                          hidden={{ space: slug, intent: "remove-team-member", team: t.id, user: m.userId }}
                          submit="Remove"
                          variant="text"
                        />
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
              {t.canManage && outside.length > 0 ? (
                <ActionForm action={manageSpace} hidden={{ space: slug, intent: "set-team-member", team: t.id }} submit="Add">
                  <label className={p.label}>
                    Add a person
                    <select className={p.select} name="user" required>
                      {outside.map((m) => (
                        <option key={m.userId} value={m.userId}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={p.label}>
                    As
                    <select className={p.select} name="role" defaultValue="member">
                      <option value="member">Member</option>
                      <option value="lead">Lead</option>
                    </select>
                  </label>
                </ActionForm>
              ) : null}
              {t.canManage ? (
                <details>
                  <summary className={p.small}>Rename or delete</summary>
                  <ActionForm action={manageSpace} hidden={{ space: slug, intent: "rename-team", team: t.id }} submit="Rename">
                    <input className={p.input} name="name" defaultValue={t.name} required maxLength={100} aria-label="Team name" />
                  </ActionForm>
                  {v.isAdmin ? (
                    <ActionForm
                      action={manageSpace}
                      hidden={{ space: slug, intent: "delete-team", team: t.id }}
                      submit="Delete team"
                      confirm={`Delete team ${t.name} (only works when it has no projects or rules)`}
                    />
                  ) : null}
                </details>
              ) : null}
            </section>
          );
        })}
      </div>
      {v.isAdmin ? (
        <section className={p.card} aria-label="New team">
          <h2 className={p.cardTitle}>New team</h2>
          <ActionForm action={manageSpace} hidden={{ space: slug, intent: "create-team" }} submit="Create team" variant="primary">
            <label className={p.label}>
              Name
              <input className={p.input} name="name" required maxLength={100} placeholder="Payments" />
            </label>
            <label className={p.label}>
              Short name
              <input className={p.input} name="slug" required pattern="[a-z0-9][a-z0-9\-]{1,30}" maxLength={31} placeholder="payments" />
            </label>
          </ActionForm>
        </section>
      ) : null}
    </>
  );
}

function People({ v }: { v: SpaceManageView }) {
  const slug = v.space.slug;
  return (
    <>
      <table className={p.table}>
        <caption className="visually-hidden">Members</caption>
        <thead>
          <tr>
            <th scope="col">Person</th>
            <th scope="col">Role</th>
            <th scope="col">Teams</th>
            {v.isAdmin ? <th scope="col">Change</th> : null}
          </tr>
        </thead>
        <tbody>
          {v.members.map((m) => (
            <tr key={m.userId}>
              <td>
                <strong>{m.name}</strong>
                {m.isMe ? " (you)" : null}
                {m.email ? <div className={p.small}>{m.email}</div> : null}
              </td>
              <td>
                <span className={m.role === "admin" ? p.tagAccent : p.tag}>{m.role}</span>
              </td>
              <td className={p.small}>{m.teams.map((t) => `${t.name}${t.role === "lead" ? " (lead)" : ""}`).join(", ") || "none"}</td>
              {v.isAdmin ? (
                <td>
                  <ActionForm action={manageSpace} hidden={{ space: slug, intent: "set-role", user: m.userId }} submit="Set role" inline>
                    <select className={p.select} name="role" defaultValue={m.role} aria-label={`Role for ${m.name}`}>
                      <option value="admin">Admin</option>
                      <option value="editor">Editor</option>
                      <option value="reader">Reader</option>
                    </select>
                  </ActionForm>
                  {!m.isMe ? (
                    <details>
                      <summary className={p.small}>Remove</summary>
                      <ActionForm
                        action={manageSpace}
                        hidden={{ space: slug, intent: "remove-member", user: m.userId }}
                        submit="Remove from space"
                        confirm={`Remove ${m.name}: their access stops and their personal rules here are deleted`}
                      />
                    </details>
                  ) : null}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className={p.h2}>What each role can do</h2>
      <ul className={p.list}>
        {(Object.keys(ROLE_TEXT) as (keyof typeof ROLE_TEXT)[]).map((r) => (
          <li key={r} className={p.row}>
            <strong>{r}</strong>
            <span className={p.small}>{ROLE_TEXT[r]}</span>
          </li>
        ))}
      </ul>

      {v.isAdmin ? (
        <>
          <section className={p.card} aria-label="Invite someone">
            <h2 className={p.cardTitle}>Invite someone</h2>
            <p className={p.small}>
              You get a link to send them yourself (axiomic doesn&rsquo;t send email yet). It only works for someone who signs in with
              GitHub or Google using that email address.
            </p>
            <ActionForm action={manageSpace} hidden={{ space: slug, intent: "create-invite" }} submit="Make invite link" variant="primary">
              <label className={p.label}>
                Email
                <input className={p.input} type="email" name="email" required maxLength={320} placeholder="priya@company.com" />
              </label>
              <label className={p.label}>
                Role
                <select className={p.select} name="role" defaultValue="editor">
                  <option value="editor">Editor</option>
                  <option value="reader">Reader</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              <label className={p.label}>
                Team (optional)
                <select className={p.select} name="team" defaultValue="">
                  <option value="">None</option>
                  {v.teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            </ActionForm>
          </section>

          <h2 className={p.h2}>Invites</h2>
          {v.invites.length === 0 ? <p className={p.small}>No invites yet.</p> : null}
          <ul className={p.list}>
            {v.invites.map((i) => (
              <li key={i.id} className={p.row}>
                <span>
                  <strong>{i.email}</strong> · {i.role}
                  {i.teamName ? ` · team ${i.teamName}` : ""}
                  <div className={p.small}>
                    Made {day(i.createdAt)} · {i.state === "open" ? `expires ${day(i.expiresAt)}` : i.state}
                  </div>
                </span>
                {i.state === "open" || i.state === "expired" ? (
                  <span className={p.inlineForm}>
                    <ActionForm inline action={manageSpace} hidden={{ space: slug, intent: "resend-invite", invite: i.id }} submit="New link" variant="text" />
                    <ActionForm inline action={manageSpace} hidden={{ space: slug, intent: "revoke-invite", invite: i.id }} submit="Revoke" variant="text" />
                  </span>
                ) : null}
              </li>
            ))}
          </ul>

          <details className={p.card}>
            <summary>
              <strong>Rename this space</strong>
            </summary>
            <ActionForm action={manageSpace} hidden={{ space: slug, intent: "rename-space" }} submit="Rename">
              <input className={p.input} name="name" defaultValue={v.space.name} required maxLength={100} aria-label="Space name" />
            </ActionForm>
            <p className={p.small}>The short name ({slug}) can&rsquo;t change: it&rsquo;s in every repo&rsquo;s axiomic.json.</p>
          </details>
        </>
      ) : null}

      <details className={p.card}>
        <summary>
          <strong>Leave this space</strong>
        </summary>
        <p className={p.small}>Your access stops and your personal rules in this space are deleted. The last admin can&rsquo;t leave.</p>
        <ActionForm action={manageSpace} hidden={{ space: slug, intent: "leave" }} submit="Leave space" confirm="Yes, I want to leave" />
      </details>
    </>
  );
}
