import Link from "next/link";
import { MAIN_NAV, PRIMARY_CTA, SIGN_IN } from "../../content/site";
import { ButtonLink } from "../ui/button";
import { BrandLink } from "./brand-link";
import { DesktopNav, MobileNav } from "./site-nav";
import { ThemeToggle } from "./theme-toggle";
import styles from "./site.module.css";

/** Logo left; links, "Sign in", the filled "Get started free" button and the theme switch right. */
export function SiteHeader() {
  return (
    <header className={`container rise ${styles.header}`}>
      <div className={styles.headerInner}>
        <BrandLink hideWordmarkOnSmall />
        <div className={styles.actions}>
          <DesktopNav links={MAIN_NAV} />
          <Link href={SIGN_IN.href} className={`${styles.navLink} ${styles.signIn}`}>
            {SIGN_IN.label}
          </Link>
          <ButtonLink href={PRIMARY_CTA.href} className={styles.headerCta}>
            {PRIMARY_CTA.label}
          </ButtonLink>
          <ThemeToggle />
          <MobileNav links={[...MAIN_NAV, SIGN_IN]} />
        </div>
      </div>
    </header>
  );
}
