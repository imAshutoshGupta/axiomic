"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Eyebrow, Mark, SectionTitle } from "../ui/type";
import styles from "./how.module.css";
import { useMotion, useReducedMotion } from "./motion";

const STEP_MS = 1200;

const STEPS = [
  { num: "one", title: "Your team writes", body: "Company, team and project rules, written once.", icon: "write" },
  { num: "two", title: "axiomic keeps them", body: "Private, versioned and checked for secrets.", icon: "hub" },
  { num: "three", title: "Everyone’s AI uses them", body: "Claude Code gets the latest, every session.", icon: "ai" },
] as const;

/** The mockup's second section: the three steps light up in turn while a version label travels the line. */
export function HowItWorks() {
  const { paused } = useMotion();
  const reduced = useReducedMotion();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (reduced || paused) return;
    const timer = setInterval(() => setStep((value) => (value + 1) % STEPS.length), STEP_MS);
    return () => clearInterval(timer);
  }, [paused, reduced]);

  return (
    <section id="how" aria-labelledby="how-title" className={`container ${styles.how}`}>
      <Eyebrow>How it works</Eyebrow>
      <SectionTitle id="how-title">
        Three steps. <Mark>No files to copy.</Mark>
      </SectionTitle>
      <div className={styles.panel}>
        <div className={styles.flow}>
          <div className={styles.track} aria-hidden="true">
            <span className={styles.packet}>v43</span>
          </div>
          <ol className={styles.steps}>
            {STEPS.map((item, i) => (
              <li key={item.num} className={styles.step}>
                <span
                  className={[styles.tile, item.icon === "hub" ? styles.hubTile : "", !reduced && i === step ? styles.active : ""].join(" ")}
                  aria-hidden="true"
                >
                  <StepIcon icon={item.icon} />
                </span>
                <span className={styles.num}>{item.num}</span>
                <h3 className={styles.stepTitle}>{item.title}</h3>
                <p className={styles.stepBody}>{item.body}</p>
              </li>
            ))}
          </ol>
        </div>
        <p className={styles.git}>
          <span className={styles.gitIcon} aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="6" cy="5" r="2" />
              <circle cx="6" cy="19" r="2" />
              <circle cx="18" cy="8" r="2" />
              <path d="M6 7v10M18 10c0 4-6 3-12 7" />
            </svg>
          </span>
          <span>
            <strong>Your Git repo never gets them.</strong> Code goes to Git. Rules stay with your team.
          </span>
        </p>
      </div>
      <p className={styles.planned}>
        The laptop side is built today; the server is in development. See the{" "}
        <Link href="/roadmap">roadmap</Link>.
      </p>
    </section>
  );
}

function StepIcon({ icon }: { icon: "write" | "hub" | "ai" }) {
  if (icon === "hub") {
    return (
      <>
        <img className="only-light" src="/brand/icon/svg/axiomic-icon-light.svg" alt="" width={64} height={64} />
        <img className="only-dark" src="/brand/icon/svg/axiomic-icon-dark.svg" alt="" width={64} height={64} />
      </>
    );
  }
  if (icon === "write") {
    return (
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 3h7l5 5v13H7z" />
        <path d="M14 3v5h5M10 13h6M10 17h4" />
      </svg>
    );
  }
  return (
    <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="11" rx="1.5" />
      <path d="M1.5 19h21" />
      <path d="M12 7.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" />
    </svg>
  );
}
