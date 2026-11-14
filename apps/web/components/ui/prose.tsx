import type { ReactNode } from "react";
import styles from "./prose.module.css";

/** Long-form text column (security, docs, legal). */
/** spaced: this block follows a table, code block or list outside the column, so its first heading needs space above. */
export function Prose({ children, spaced = false }: { children: ReactNode; spaced?: boolean }) {
  return <div className={spaced ? `${styles.prose} ${styles.spaced}` : styles.prose}>{children}</div>;
}

/** A table that scrolls sideways on small screens instead of widening the page. */
export function TableWrap({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className={styles.tableWrap} role="region" aria-label={label} tabIndex={0}>
      <table>{children}</table>
    </div>
  );
}

/** A value that is not decided yet, e.g. [legal entity — to be confirmed]. */
export function Placeholder({ children }: { children: ReactNode }) {
  return <span className={styles.placeholder}>[{children}]</span>;
}
