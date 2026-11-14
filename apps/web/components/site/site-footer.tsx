import Link from "next/link";
import { FOOTER_NAV } from "../../content/site";
import { BrandLink } from "./brand-link";
import styles from "./site.module.css";

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.footerInner}`}>
        <div className={styles.footerBrand}>
          <BrandLink />
          <p>A private, team-controlled home for AI rule files. Git keeps code only.</p>
        </div>
        <nav aria-label="Footer" className={styles.footerNav}>
          {FOOTER_NAV.map((group) => (
            <div key={group.title}>
              <h2 className={styles.footerHeading}>{group.title}</h2>
              <ul>
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href}>{link.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <div className={`container ${styles.footerBottom}`}>
        <p>Pilot build. axiomic 1.0 is not published yet.</p>
        <p>No cookies, analytics or third-party scripts on this site.</p>
      </div>
    </footer>
  );
}
