"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import styles from "./app.module.css";

/**
 * The account button in the app header: your name; opens a small panel with your email,
 * links and "Sign out". Same keyboard behaviour as the site's MobileNav: Escape closes it and
 * returns focus to the button, a click outside closes it.
 *
 * Sign out is a plain form POST to /auth/sign-out (POST only, Origin-checked), so it works
 * even before this script has loaded.
 */
export function AccountMenu({ displayName, email }: { displayName: string; email: string | null }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div className={styles.account} ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.accountButton}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.avatar} aria-hidden="true">
          {initial(displayName)}
        </span>
        <span className={styles.accountName}>{displayName}</span>
        <span className="visually-hidden">: account menu</span>
      </button>
      <div id={panelId} className={styles.accountPanel} hidden={!open}>
        <div className={styles.accountWho}>
          <strong>{displayName}</strong>
          {email ? <span className={styles.accountEmail}>{email}</span> : null}
        </div>
        <nav aria-label="Account">
          <Link href="/account" className={styles.menuItem} onClick={close}>
            Account
          </Link>
          <Link href="/account/tokens" className={styles.menuItem} onClick={close}>
            CLI tokens
          </Link>
          <Link href="/device" className={styles.menuItem} onClick={close}>
            Approve a CLI login
          </Link>
        </nav>
        <form method="post" action="/auth/sign-out">
          <button type="submit" className={styles.menuItem}>
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}

/** First letter for the round badge; works for any script (Devanagari, emoji…) via the code point. */
function initial(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toLocaleUpperCase() : "?";
}
