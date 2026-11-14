"use client";

import { useEffect, useState } from "react";
import styles from "./hero.module.css";
import { MotionToggle, useMotion, useReducedMotion } from "./motion";

/*
 * The mockup's "Magnetic" loop. Six scattered copies of a rule file ("Today") are pulled into
 * one tidy stack ("With axiomic"), held, then released again:
 *   mess 1.2 s → tidy 3.2 s → mess 1.2 s → …
 * It runs on a timer, not on the pointer. With reduced motion it shows the tidy state only.
 */

const MESS_MS = 1200;
const HOLD_MS = 3200;

/** name, problem, and where the card sits while scattered (x, y in px from the centre, rotation). */
const FILES = [
  { name: "payments/CLAUDE.md", tag: "out of date", x: -150, y: -100, rot: -9 },
  { name: "web-app/CLAUDE.md", tag: "different from payments", x: 120, y: -110, rot: 7 },
  { name: "mobile/.cursor/rules", tag: "in a public fork", x: -170, y: 10, rot: 5 },
  { name: "CLAUDE copy (2).md", tag: "which one is right?", x: 140, y: 0, rot: -6 },
  { name: "infra/CLAUDE.md", tag: "seen by contractors", x: -110, y: 105, rot: 4 },
  { name: "rules-final-v3.md", tag: "nobody owns it", x: 120, y: 100, rot: -4 },
];
const LAST = FILES.length - 1;

const CAPTION_MESS = "Rules copied everywhere, drifting apart, visible to anyone.";
const CAPTION_TIDY = "One copy, always current. Only your team’s AI reads it.";

export function GatherCard({ className = "" }: { className?: string }) {
  const { paused } = useMotion();
  const reduced = useReducedMotion();
  const [gathered, setGathered] = useState(false);
  const tidy = reduced || gathered;

  useEffect(() => {
    if (reduced || paused) return;
    const timer = setTimeout(() => setGathered((value) => !value), gathered ? HOLD_MS : MESS_MS);
    return () => clearTimeout(timer);
  }, [gathered, paused, reduced]);

  return (
    <section className={`${styles.card} ${tidy ? styles.tidy : ""} ${className}`} aria-label="Before and after axiomic">
      {/* Screen readers get both states once, as text. The moving picture is hidden from them. */}
      <p className="visually-hidden">
        Today: {CAPTION_MESS} With axiomic: {CAPTION_TIDY}
      </p>
      <div className={styles.cardTop}>
        <span className={`${styles.fade} ${styles.label}`} aria-hidden="true">
          {tidy ? "With axiomic" : "Today"}
        </span>
        <MotionToggle />
      </div>
      {reduced ? (
        <p className={styles.before}>
          <strong>Before axiomic:</strong> rule files copied into every project, out of date, in public forks, owned by
          nobody.
        </p>
      ) : null}
      <div className={`${styles.fade} ${styles.stage}`} aria-hidden="true">
        {FILES.map((file, i) => {
          const front = i === LAST;
          const transform = tidy
            ? `translate(0px, ${-34 + i * 6}px) rotate(0deg) scale(${1 - (LAST - i) * 0.02})`
            : `translate(calc(var(--fx) * ${file.x}px), ${file.y}px) rotate(${file.rot}deg)`;
          return (
            <span
              key={file.name}
              className={styles.file}
              style={{
                transform,
                opacity: tidy && !front ? 0.55 : 1,
                zIndex: i + 1,
                transitionDelay: `${(tidy ? i : LAST - i) * 0.06}s`,
              }}
            >
              <span
                className={`${styles.fileInner} ${tidy ? "" : styles.float} ${tidy && front ? styles.front : ""}`}
                style={{ animationDelay: `${-i * 0.4}s` }}
              >
                <span className={styles.fileHead}>
                  <span className={styles.fileName}>{tidy && front ? "CLAUDE.md · one copy" : file.name}</span>
                  {tidy && front && !reduced ? (
                    <span className={styles.check}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12l5 5 9-10" />
                      </svg>
                    </span>
                  ) : null}
                </span>
                <span className={`${styles.fade} ${styles.fileTag}`}>
                  {tidy && front ? "up to date for everyone" : file.tag}
                </span>
              </span>
            </span>
          );
        })}
        <span className={`${styles.fade} ${styles.hub}`}>
          <img className="only-light" src="/brand/icon/svg/axiomic-icon-light.svg" alt="" width={34} height={34} />
          <img className="only-dark" src="/brand/icon/svg/axiomic-icon-dark.svg" alt="" width={34} height={34} />
          <span>Kept in axiomic · everyone on v43</span>
        </span>
      </div>
      <p className={`${styles.fade} ${styles.caption}`} aria-hidden="true">
        {tidy ? CAPTION_TIDY : CAPTION_MESS}
      </p>
    </section>
  );
}
