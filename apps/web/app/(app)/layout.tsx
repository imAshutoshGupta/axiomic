import type { ReactNode } from "react";
import { AppHeader } from "../../components/app/app-header";
import styles from "../../components/site/site.module.css";
import { getVerifiedClaims } from "../../lib/auth";
import { getMe } from "../../lib/me";

/**
 * Layout for signed-in pages. "(app)" is a route group: it picks this layout but doesn't appear
 * in URLs, so /device and /account/tokens keep their addresses (the CLI prints <server>/device).
 *
 * This layout is NOT the lock. Next.js keeps a layout between page changes without re-running
 * it, so every page checks the session itself (lib/app-pages.test.ts enforces that), and the
 * database's row-level security is the real lock behind both.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const claims = await getVerifiedClaims();
  const me = claims ? await getMe(claims) : null;
  return (
    <>
      <a href="#main" className={styles.skipLink}>
        Skip to content
      </a>
      <AppHeader me={me} />
      <main id="main" tabIndex={-1} className={styles.main}>
        {children}
      </main>
    </>
  );
}
