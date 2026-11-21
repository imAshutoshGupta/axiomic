import { apiError, ok, requireToken, unauthorized } from "@/lib/api/route-helpers";
import { withUser } from "@/lib/db";

/**
 * GET /api/v1/whoami   (Bearer token)
 * 200 { user: { id, name, email }, token: { kind, prefix, created_at, expires_at, project } }
 * Everything is read under row-level security as the token's owner: your own profile and
 * your own token row (never its hash). project is set only for agent keys.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const auth = await requireToken(request);
    if (auth instanceof Response) return auth;
    const body = await withUser(auth.claims, async (tx) => {
      const [user] = await tx<{ id: string; display_name: string; email: string | null }[]>`
        select id, display_name, email from public.profiles where id = auth.uid()`;
      const [token] = await tx<{ kind: string; prefix: string; created_at: Date; expires_at: Date | null; project_id: string | null }[]>`
        select kind, prefix, created_at, expires_at, project_id from public.api_tokens where id = ${auth.tokenId}`;
      if (!user || !token) return null;
      let project: { space: string; slug: string; name: string } | null = null;
      if (token.project_id) {
        const [p] = await tx<{ space: string; slug: string; name: string }[]>`
          select s.slug as space, p.slug, p.name from public.projects p join public.spaces s on s.id = p.space_id
          where p.id = ${token.project_id}`;
        project = p ?? null;
      }
      return {
        user: { id: user.id, name: user.display_name, email: user.email },
        token: { kind: token.kind, prefix: token.prefix, created_at: token.created_at, expires_at: token.expires_at, project },
      };
    });
    return body ? ok(body) : unauthorized(); // account gone between the two reads
  } catch (e) {
    return apiError("whoami", e);
  }
}
