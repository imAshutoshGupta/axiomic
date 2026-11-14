import { PRIMARY_CTA, MAIN_NAV } from "../../content/site";
import { ButtonLink } from "../ui/button";
import { BrandLink } from "./brand-link";
import { DesktopNav, MobileNav } from "./site-nav";
import { ThemeToggle } from "./theme-toggle";
import styles from "./site.module.css";

/** The header from the mockup: logo left; links, filled button and theme switch right. */
export function SiteHeader() {
  return (
    <header className={`container rise ${styles.header}`}>
      <div className={styles.headerInner}>
        <BrandLink hideWordmarkOnSmall />
        <div className={styles.actions}>
          <DesktopNav links={MAIN_NAV} />
          <ButtonLink href={PRIMARY_CTA.href} className={styles.headerCta}>
            {PRIMARY_CTA.label}
          </ButtonLink>
          <ThemeToggle />
          <MobileNav links={MAIN_NAV} />
        </div>
      </div>
    </header>
  );
}
