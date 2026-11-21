import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isValidSlug, LAYERS, type Layer } from "@axiomic/shared";
import p from "../../../../../../../components/app/page.module.css";
import { Callout } from "../../../../../../../components/ui/callout";
import { PageHeader } from "../../../../../../../components/ui/page-header";
import { getVerifiedClaims } from "../../../../../../../lib/auth";
import { withUser } from "../../../../../../../lib/db";
import { keyring } from "../../../../../../../lib/rule-keys";
import { loadProjectView, spaceLabel } from "../../../../../../../lib/workspace";
import { RuleForm } from "./rule-form";

export const metadata: Metadata = {
  title: "Edit rule",
  robots: { index: false },
};

type Props = {
  params: Promise<{ space: string; project: string; rule: string }>;
  searchParams: Promise<{ layer?: string; module?: string }>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LAYER_NAME: Record<Layer, string> = {
  company: "Company rule", team: "Team rule", project: "Project rule", module: "Folder rule", personal: "Personal rule",
};

/**
 * Edit one rule, or write a new one (rule = "new", with ?layer= and ?module=). The rule is read
 * through the same project view as the rules page, so you can only open rules this project
 * delivers to you. Saving is decided again by the database.
 */
export default async function RulePage({ params, searchParams }: Props) {
  const claims = await getVerifiedClaims();
  if (!claims) redirect("/sign-in");
  const { space, project, rule: ruleParam } = await params;
  const q = await searchParams;
  if (!isValidSlug(space) || !isValidSlug(project)) notFound();
  if (ruleParam !== "new" && !UUID.test(ruleParam)) notFound();

  const r = await withUser(claims, (tx) => loadProjectView(tx, keyring(), { space, project }), { snapshot: true });
  if (!r.ok) notFound();
  const v = r.view;
  const base = `/spaces/${space}/${project}`;

  // Which rule, which layer, and may you edit it directly?
  let layer: Layer;
  let moduleId: string | undefined;
  let rule: { id: string; version: number; title: string; body: string; locked: boolean } | undefined;
  if (ruleParam === "new") {
    if (!q.layer || !(LAYERS as readonly string[]).includes(q.layer)) notFound();
    layer = q.layer as Layer;
    if (layer === "module") {
      if (!q.module || !v.modules.some((m) => m.id === q.module)) notFound();
      moduleId = q.module;
    }
    if (layer === "company" && v.space.kind === "personal") notFound();
  } else {
    const info = v.loaded.rules.get(ruleParam);
    if (!info) notFound();
    layer = info.layer;
    moduleId = info.moduleId ?? undefined;
    const i = v.loaded.input;
    const found =
      [...i.company, ...i.team].find((x) => x.id === info.id) ??
      [...i.project, ...i.personal, ...i.modules.flatMap((m) => m.rules)].find((x) => x.id === info.id);
    rule = { id: info.id, version: info.version, title: found!.title, body: found!.body, locked: info.locked };
  }
  const canEdit = layer === "module" ? (v.rights.modules[moduleId!] ?? false) : v.rights[layer as Exclude<Layer, "module">];
  const where =
    layer === "module" ? `folder ${v.modules.find((m) => m.id === moduleId)?.path ?? ""}/`
    : layer === "team" ? `team ${v.team.name}`
    : layer === "company" ? spaceLabel(v.space)
    : layer === "project" ? v.loaded.project.name
    : "you only";

  // A locked rule can't take suggestions (api.create_suggestion refuses); say so instead of a form.
  const lockedForYou = !!rule?.locked && !canEdit;

  return (
    <div className={`container ${p.page}`}>
      <ol className={p.crumbs}>
        <li>
          <Link href="/spaces">Projects</Link>
        </li>
        <li>
          <Link href={base}>{v.loaded.project.name}</Link>
        </li>
      </ol>
      <PageHeader
        eyebrow={`${LAYER_NAME[layer]} · ${where}`}
        title={rule ? (canEdit ? `Edit: ${rule.title}` : `Suggest a change: ${rule.title}`) : canEdit ? "New rule" : "Suggest a new rule"}
        lead={
          canEdit
            ? "You own this layer, so your save goes straight in."
            : "You don't own this layer, so this becomes a suggestion. The owner approves or rejects it."
        }
      />
      {rule ? <p className={p.small}>Version {rule.version}. A save makes version {rule.version + 1}.</p> : null}
      {layer === "personal" && v.space.kind === "work" ? (
        <p className={p.small}>Personal rules in a work space are visible to the space's admins.</p>
      ) : null}
      {lockedForYou ? (
        <Callout tone="warning" title="This rule is locked">
          <p>Locked rules can't take suggestions. Ask the layer's owner to change it.</p>
        </Callout>
      ) : (
        <RuleForm
          space={space}
          project={project}
          rule={rule}
          layer={layer}
          moduleId={moduleId}
          canEdit={canEdit}
          lockable={layer === "company" || layer === "team"}
        />
      )}
    </div>
  );
}
