/** /spaces/<space>/<project>/settings: rename, archive, owner, delete, and folders. */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isValidSlug } from "@axiomic/shared";
import { ActionForm } from "@/components/app/action-form";
import p from "@/components/app/page.module.css";
import { PageHeader } from "@/components/ui/page-header";
import { getVerifiedClaims } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { loadProjectSettings, type ProjectSettingsView } from "@/lib/spaces/manage";
import { manageProject } from "./actions";

export const metadata: Metadata = {
  title: "Project settings",
  robots: { index: false },
};

type Props = { params: Promise<{ space: string; project: string }> };

/** Name, archive, owner, delete, and the project's folders (modules), each with an owner. */
export default async function ProjectSettingsPage({ params }: Props) {
  const claims = await getVerifiedClaims();
  if (!claims) redirect("/sign-in");
  const { space, project } = await params;
  if (!isValidSlug(space) || !isValidSlug(project)) notFound();
  const v = await withUser(claims, (tx) => loadProjectSettings(tx, space, project));
  if (!v) notFound();
  const hidden = { space, project };

  return (
    <div className={`container ${p.page}`}>
      <ol className={p.crumbs}>
        <li>
          <Link href="/spaces">Projects</Link>
        </li>
        <li>
          <Link href={`/spaces/${space}`}>{v.space.kind === "personal" ? "Personal" : space}</Link>
        </li>
        <li>
          <Link href={`/spaces/${space}/${project}`}>{v.project.name}</Link>
        </li>
      </ol>
      <PageHeader
        eyebrow="Project settings"
        title={v.project.name}
        lead={
          <>
            <code>
              axiomic init {space}/{project}
            </code>
            {v.project.teamHidden ? "" : ` · team ${v.project.teamName}`} · owner {v.project.ownerName ?? "nobody"}
          </>
        }
      />
      {!v.canEdit ? <p className={p.small}>You can look, but only editors, admins and the project owner can change these.</p> : null}

      <Folders v={v} hidden={hidden} />

      {v.canEdit ? (
        <section className={p.card} aria-label="Name">
          <h2 className={p.cardTitle}>Name</h2>
          <p className={p.small}>The short name ({project}) can&rsquo;t change: it&rsquo;s in every clone&rsquo;s axiomic.json.</p>
          <ActionForm action={manageProject} hidden={{ ...hidden, intent: "rename" }} submit="Rename">
            <input className={p.input} name="name" defaultValue={v.project.name} required maxLength={100} aria-label="Project name" />
          </ActionForm>
        </section>
      ) : null}

      {v.canTransfer && v.space.kind === "work" ? (
        <section className={p.card} aria-label="Owner">
          <h2 className={p.cardTitle}>Owner</h2>
          <p className={p.small}>The owner decides the project rules and approves suggestions for them. Must be an editor or admin.</p>
          <ActionForm action={manageProject} hidden={{ ...hidden, intent: "transfer" }} submit="Change owner">
            <select className={p.select} name="user" defaultValue={v.project.ownerId ?? ""} aria-label="New owner" required>
              <option value="" disabled>
                Choose…
              </option>
              {v.owners.map((o) => (
                <option key={o.userId} value={o.userId}>
                  {o.name}
                </option>
              ))}
            </select>
          </ActionForm>
        </section>
      ) : null}

      {v.canEdit ? (
        <section className={p.card} aria-label="Archive">
          <h2 className={p.cardTitle}>{v.project.archived ? "Archived" : "Archive"}</h2>
          <p className={p.small}>
            {v.project.archived
              ? "Its rules are kept but can't be pulled or changed."
              : "For a retired repo: rules are kept, laptops stop getting them, nothing can be changed."}
          </p>
          <ActionForm
            action={manageProject}
            hidden={{ ...hidden, intent: v.project.archived ? "unarchive" : "archive" }}
            submit={v.project.archived ? "Bring back" : "Archive project"}
          />
        </section>
      ) : null}

      {v.canDelete ? (
        <details className={p.card}>
          <summary>
            <strong>Delete project</strong>
          </summary>
          <p className={p.small}>Only an empty project (no rules or folders, also none in the trash) can be deleted. Otherwise archive it.</p>
          <ActionForm action={manageProject} hidden={{ ...hidden, intent: "delete" }} submit="Delete project" confirm={`Delete ${v.project.name}`} />
        </details>
      ) : null}
    </div>
  );
}

function OwnerSelect({ v, value }: { v: ProjectSettingsView; value: string | null }) {
  return (
    <select className={p.select} name="owner" defaultValue={value ?? ""} aria-label="Folder owner">
      <option value="">No owner (project owner decides)</option>
      {v.owners.map((o) => (
        <option key={o.userId} value={o.userId}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

function Folders({ v, hidden }: { v: ProjectSettingsView; hidden: Record<string, string> }) {
  return (
    <section className={p.card} aria-label="Folders">
      <h2 className={p.cardTitle}>Folders</h2>
      <p className={p.small}>
        A folder (like <code>src/payments</code>) can have its own rules. They go into a separate file that Claude Code loads only
        while working in that folder. A folder&rsquo;s owner decides its rules.
      </p>
      {v.modules.length === 0 ? <p className={p.small}>No folders yet.</p> : null}
      <ul className={p.list}>
        {v.modules.map((m) => (
          <li key={m.id} className={p.row} style={{ display: "block" }}>
            <strong>{m.path}/</strong> <span className={p.tag}>{m.name}</span>{" "}
            <span className={p.small}>owner {m.ownerName ?? "none"}</span>
            {m.canEdit && !v.project.archived ? (
              <details>
                <summary className={p.small}>Change or remove</summary>
                <ActionForm action={manageProject} hidden={{ ...hidden, intent: "edit-module", module: m.id }} submit="Save folder">
                  <label className={p.label}>
                    Name
                    <input className={p.input} name="name" defaultValue={m.name} required maxLength={64} />
                  </label>
                  <label className={p.label}>
                    Path
                    <input className={p.input} name="path" defaultValue={m.path} required maxLength={255} />
                  </label>
                  <label className={p.label}>
                    Owner
                    <OwnerSelect v={v} value={m.ownerId} />
                  </label>
                </ActionForm>
                {v.canEdit ? (
                  <ActionForm
                    action={manageProject}
                    hidden={{ ...hidden, intent: "trash-module", module: m.id }}
                    submit="Remove folder"
                    confirm={`Remove ${m.path}/ and its rules (kept in the trash for 30 days)`}
                  />
                ) : null}
              </details>
            ) : null}
          </li>
        ))}
      </ul>
      {v.canEdit && !v.project.archived ? (
        <ActionForm action={manageProject} hidden={{ ...hidden, intent: "create-module" }} submit="Add folder" variant="primary">
          <label className={p.label}>
            Path in the repo
            <input className={p.input} name="path" required maxLength={255} placeholder="src/payments" />
          </label>
          <label className={p.label}>
            Name
            <input className={p.input} name="name" required maxLength={64} placeholder="payments" />
          </label>
          {v.space.kind === "work" ? (
            <label className={p.label}>
              Owner
              <OwnerSelect v={v} value={null} />
            </label>
          ) : null}
        </ActionForm>
      ) : null}
    </section>
  );
}
