/** /account/tokens: list, create and revoke your CLI tokens. */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import buttonStyles from "@/components/ui/button.module.css";
import { getVerifiedClaims } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { revokeCliToken } from "./actions";
import { CreateToken } from "./create-token";
import styles from "./tokens.module.css";

export const metadata: Metadata = {
  title: "CLI tokens",
  robots: { index: false },
};

type TokenRow = {
  id: string;
  kind: "cli" | "agent";
  name: string;
  prefix: string;
  created_at: Date;
  last_used_at: Date | null;
  expires_at: Date | null;
  revoked_at: Date | null;
};

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "never");

/** Your own tokens (RLS: api_tokens_read_own; the hash column isn't even granted). */
export default async function TokensPage() {
  const claims = await getVerifiedClaims();
  if (!claims) redirect("/sign-in");

  const tokens = await withUser(claims, (tx) => tx<TokenRow[]>`
    select id, kind, name, prefix, created_at, last_used_at, expires_at, revoked_at
    from public.api_tokens where user_id = auth.uid()
    order by revoked_at nulls first, created_at desc limit 50`);

  return (
    <div className={`container ${styles.page}`}>
      <PageHeader
        eyebrow="Account"
        title="CLI tokens"
        lead="A token lets the axiomic CLI pull your rules. It's shown once when you create it. CLI tokens stop working after 90 days without use."
      />
      <CreateToken />
      <h2 className={styles.h2}>Your tokens</h2>
      {tokens.length === 0 ? (
        <p>No tokens yet.</p>
      ) : (
        <ul className={styles.list}>
          {tokens.map((t) => (
            <li key={t.id} className={styles.item}>
              <div>
                <strong>{t.name}</strong> <code>{t.prefix}…</code> {t.kind === "agent" ? "(agent key)" : null}
                <div className={styles.meta}>
                  Created {day(t.created_at)} · Last used {day(t.last_used_at)}
                  {t.expires_at ? ` · Expires ${day(t.expires_at)}` : null}
                  {t.revoked_at ? ` · Revoked ${day(t.revoked_at)}` : null}
                </div>
              </div>
              {t.revoked_at ? null : (
                <form action={revokeCliToken}>
                  <input type="hidden" name="id" value={t.id} />
                  <button type="submit" className={`${buttonStyles.button} ${buttonStyles.secondary}`}>
                    Revoke
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
