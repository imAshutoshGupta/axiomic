import type { ReactNode } from "react";
import { SiteFooter } from "../../components/site/site-footer";
import { SiteHeader } from "../../components/site/site-header";
import styles from "../../components/site/site.module.css";

/**
 * Layout for the public pages (no login). The "(site)" folder name is a route group:
 * it doesn't appear in URLs. The logged-in product can get its own group and layout later,
 * without touching this one or the root layout.
 */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <a href="#main" className={styles.skipLink}>
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" tabIndex={-1} className={styles.main}>
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
