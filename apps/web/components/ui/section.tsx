import type { ReactNode } from "react";
import styles from "./section.module.css";
import { Eyebrow, Lead, SectionTitle } from "./type";

type SectionProps = {
  /** Used for in-page links ("/#layers") and to label the section for screen readers. */
  id: string;
  eyebrow: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  children: ReactNode;
};

/** A page section: small label, serif title, optional lead, then content. */
export function Section({ id, eyebrow, title, lead, children }: SectionProps) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={`container ${styles.section}`}>
      <div className={styles.head}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <SectionTitle id={`${id}-title`}>{title}</SectionTitle>
        {lead ? <Lead>{lead}</Lead> : null}
      </div>
      <div className={styles.body}>{children}</div>
    </section>
  );
}

/** Two columns that become one on narrow screens. */
export function Split({ children }: { children: ReactNode }) {
  return <div className={styles.split}>{children}</div>;
}
