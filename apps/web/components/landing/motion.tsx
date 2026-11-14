"use client";

import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";
import styles from "./motion.module.css";

/*
 * The home page has looping animations (the hero card and the "how it works" panel).
 * WCAG 2.2.2 asks for a way to pause anything that moves for more than 5 seconds, so one shared
 * pause state covers all of them. CSS reads data-motion="paused"; the hero card's timer reads the context.
 */

type Motion = { paused: boolean; toggle: () => void };

const MotionContext = createContext<Motion>({ paused: false, toggle: () => {} });

export function MotionProvider({ children, className }: { children: ReactNode; className?: string }) {
  const [paused, setPaused] = useState(false);
  return (
    <MotionContext value={{ paused, toggle: () => setPaused((value) => !value) }}>
      <div className={className} data-motion={paused ? "paused" : "running"}>
        {children}
      </div>
    </MotionContext>
  );
}

export function useMotion() {
  return useContext(MotionContext);
}

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** True when the visitor asked their system for less motion. Always false on the server. */
export function useReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCE_QUERY).matches,
    () => false,
  );
}

/** Small pause/play button. Hidden when reduced motion is on, because nothing moves then. */
export function MotionToggle({ className }: { className?: string }) {
  const { paused, toggle } = useMotion();
  const reduced = useReducedMotion();
  if (reduced) return null;
  return (
    <button
      type="button"
      className={className ? `${styles.toggle} ${className}` : styles.toggle}
      onClick={toggle}
      aria-label={paused ? "Play animations" : "Pause animations"}
      title={paused ? "Play animations" : "Pause animations"}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        {paused ? <path d="M7 4.5v15l13-7.5z" /> : <path d="M6 4h4v16H6zM14 4h4v16h-4z" />}
      </svg>
    </button>
  );
}
