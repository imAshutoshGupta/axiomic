import type { ReactNode } from "react";
import styles from "./page-header.module.css";

type PageHeaderProps = {
  eyebrow: ReactNode;
  /** The page's only h1. */
  title: ReactNode;
  lead?: ReactNode;
  /** Extra content under the lead, e.g. a draft banner. */
  children?: ReactNode;
};

/** Top of an inner page (security, docs, legal): same type as the hero, one step smaller. */
export function PageHeader({ eyebrow, title, lead, children }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      <p className={styles.eyebrow}>{eyebrow}</p>
      <h1 className={styles.title}>{title}</h1>
      {lead ? <p className={styles.lead}>{lead}</p> : null}
      {children ? <div className={styles.extra}>{children}</div> : null}
    </header>
  );
}
