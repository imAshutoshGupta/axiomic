"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./app.module.css";

/** The app's main sections. A link is "current" on its own page and every page below it. */
export const APP_NAV = [
  { href: "/spaces", label: "Projects" },
  { href: "/suggestions", label: "Suggestions" },
] as const;

export function AppNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="App" className={styles.appNav}>
      {APP_NAV.map((link) => {
        const current = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link key={link.href} href={link.href} className={styles.navLink} aria-current={current ? "page" : undefined}>
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
