import type { ReactNode } from "react";
import styles from "./type.module.css";

/**
 * The highlighted italic phrase from the mockup (".md files.", "No files to copy.").
 * A mint band sits behind the lower part of the letters, like a highlighter pen.
 */
export function Mark({ children, padded = false }: { children: ReactNode; padded?: boolean }) {
  return <span className={padded ? `${styles.mark} ${styles.padded}` : styles.mark}>{children}</span>;
}

/** Small uppercase label above a section title, e.g. "HOW IT WORKS". */
export function Eyebrow({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <p className={styles.eyebrow} id={id}>
      {children}
    </p>
  );
}

/** Section title: serif, the mockup's h2 size. */
export function SectionTitle({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 className={styles.sectionTitle} id={id}>
      {children}
    </h2>
  );
}

/** The paragraph under a section title. */
export function Lead({ children }: { children: ReactNode }) {
  return <p className={styles.lead}>{children}</p>;
}
