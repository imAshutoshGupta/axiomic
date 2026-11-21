import { apiError, ok, requireToken } from "@/lib/api/route-helpers";
import { withUser } from "@/lib/db";

/**
 * GET /api/v1/projects   (Bearer token)
 * 200 { spaces: [{ slug, name, kind, projects: [{ slug, name }] }] }
 *
 * What `axiomic init` offers to link this repo to. Row-level security decides what is listed:
 * your spaces and the projects you can read (an agent key: only its own project). Archived
 * projects are left out: they can't be pulled (409). Spaces you belong to but with no
 * readable projects are still listed (empty), so init can say "this space has no projects yet".
 */
export const dynamic = "force-dynamic";

type Row = { space_slug: string; space_name: string; kind: "work" | "personal"; project_slug: string | null; project_name: string | null };

export async function GET(request: Request): Promise<Response> {
  try {
    const auth = await requireToken(request);
    if (auth instanceof Response) return auth;
    const rows = await withUser(auth.claims, (tx) => tx<Row[]>`
      select s.slug as space_slug, s.name as space_name, s.kind,
             p.slug as project_slug, p.name as project_name
      from public.spaces s
      left join public.projects p on p.space_id = s.id and p.archived_at is null
      where s.delete_after is null
        and (${auth.claims.axm_kind} <> 'agent' or p.id is not null)
      order by s.kind desc, s.name, s.slug, p.name, p.slug`);

    const spaces = new Map<string, { slug: string; name: string; kind: Row["kind"]; projects: { slug: string; name: string }[] }>();
    for (const r of rows) {
      let space = spaces.get(r.space_slug);
      if (!space) spaces.set(r.space_slug, (space = { slug: r.space_slug, name: r.space_name, kind: r.kind, projects: [] }));
      if (r.project_slug && r.project_name) space.projects.push({ slug: r.project_slug, name: r.project_name });
    }
    return ok({ spaces: [...spaces.values()] });
  } catch (e) {
    return apiError("projects", e);
  }
}
