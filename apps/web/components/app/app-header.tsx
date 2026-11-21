import Link from "next/link";
import type { Me } from "@/lib/auth/profile";
import { BrandLink } from "@/components/site/brand-link";
import { ThemeToggle } from "@/components/site/theme-toggle";
import { AccountMenu } from "./account-menu";
import { AppNav } from "./app-nav";
import styles from "./app.module.css";

/**
 * Header for signed-in pages (the (app) route group). Signed out (e.g. someone opens /device
 * first): no app links, just a "Sign in" link; the page itself explains what to do.
 */
export function AppHeader({ me }: { me: Me | null }) {
  return (
    <header className={`container ${styles.header}`}>
      <div className={styles.headerInner}>
        <BrandLink hideWordmarkOnSmall />
        {me ? <AppNav /> : null}
        <div className={styles.headerEnd}>
          <ThemeToggle />
          {me ? (
            <AccountMenu displayName={me.displayName} email={me.email} />
          ) : (
            <Link href="/sign-in" className={styles.signInLink}>
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
