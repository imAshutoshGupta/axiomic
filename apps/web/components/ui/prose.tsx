/** Prose and Placeholder: long-form text on the security, docs and legal pages. */
import type { ReactNode } from "react";
import styles from "./prose.module.css";

/**
 * A long-form text column.
 * spaced: this block follows a table, code block or list outside the column, so its first heading needs space above.
 */
export function Prose({ children, spaced = false }: { children: ReactNode; spaced?: boolean }) {
  return <div className={spaced ? `${styles.prose} ${styles.spaced}` : styles.prose}>{children}</div>;
}

/** A value that is not decided yet, e.g. [legal entity — to be confirmed]. */
export function Placeholder({ children }: { children: ReactNode }) {
  return <span className={styles.placeholder}>[{children}]</span>;
}
