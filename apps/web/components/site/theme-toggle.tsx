"use client";

/** The light / dark theme switch. */
import styles from "./site.module.css";

const STORAGE_KEY = "axiomic-theme"; // also read by the inline script in app/layout.tsx

/**
 * Switches between light and dark and remembers the choice in this browser (localStorage, no cookie).
 * Both icons and both labels are rendered; CSS shows the pair for the current theme, so the server
 * HTML is correct before any JavaScript runs.
 */
export function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const current =
      root.getAttribute("data-theme") ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage can be blocked (private mode, strict settings). The switch still works for this page.
    }
  }

  return (
    <button type="button" className={styles.iconButton} onClick={toggle}>
      <span className="only-light">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
        </svg>
        <span className="visually-hidden">Switch to dark mode</span>
      </span>
      <span className="only-dark">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
        <span className="visually-hidden">Switch to light mode</span>
      </span>
    </button>
  );
}
