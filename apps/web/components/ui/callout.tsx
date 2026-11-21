/** Callout: a highlighted box for a note, a warning or a draft notice. */
import type { ReactNode } from "react";
import styles from "./callout.module.css";

type CalloutProps = {
  /** note: neutral. warning: something to know before acting. draft: legal text not yet reviewed. */
  tone?: "note" | "warning" | "draft";
  title: ReactNode;
  children?: ReactNode;
};

/** A boxed message inside the page flow. */
export function Callout({ tone = "note", title, children }: CalloutProps) {
  return (
    <div className={`${styles.callout} ${styles[tone]}`} role="note">
      <span className={styles.icon} aria-hidden="true">
        {tone === "note" ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5M12 8h.01" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l9.5 17h-19z" />
            <path d="M12 10v4M12 17h.01" />
          </svg>
        )}
      </span>
      <div className={styles.body}>
        <p className={styles.title}>{title}</p>
        {children ? <div className={styles.text}>{children}</div> : null}
      </div>
    </div>
  );
}
