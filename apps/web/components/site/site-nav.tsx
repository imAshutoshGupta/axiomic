"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import type { NavLink } from "../../content/site";
import styles from "./site.module.css";

/** Links that point at a section of the home page ("/#how") are never marked as the current page. */
function isCurrent(pathname: string, href: string) {
  return !href.includes("#") && pathname === href;
}

/** Wide screens: the links sit in the header (hidden below 760px, like the mockup). */
export function DesktopNav({ links }: { links: NavLink[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className={styles.desktopNav}>
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={styles.navLink}
          aria-current={isCurrent(pathname, link.href) ? "page" : undefined}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Narrow screens: a menu button that opens the same links in a panel.
 * Keyboard: Enter/Space opens it, Tab moves through the links, Escape closes it and returns focus to the button.
 */
export function MobileNav({ links }: { links: NavLink[] }) {
  const pathname = usePathname();
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

  return (
    <div className={styles.mobileNav} ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.iconButton}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
        <span className="visually-hidden">Menu</span>
      </button>
      <nav id={panelId} aria-label="Main" className={styles.menuPanel} hidden={!open}>
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={styles.menuLink}
            aria-current={isCurrent(pathname, link.href) ? "page" : undefined}
            onClick={() => setOpen(false)}
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
