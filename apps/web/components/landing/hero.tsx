import { PRIMARY_CTA } from "@/content/site";
import { ButtonLink } from "@/components/ui/button";
import { Mark } from "@/components/ui/type";
import { GatherCard } from "./gather-card";
import styles from "./hero.module.css";

/** Left column: title, one sentence, two links. Right column: the animated card. */
export function Hero() {
  return (
    <div className={`container ${styles.grid}`}>
      <div>
        <h1 className={`rise ${styles.d1} ${styles.title}`}>
          The one-stop destination for your <Mark padded>.md files.</Mark>
        </h1>
        <p className={`rise ${styles.d2} ${styles.lead}`}>
          Your team&apos;s CLAUDE.md rules in one private place: layered, versioned, and delivered to every
          developer&apos;s AI session. Kept out of Git.
        </p>
        <div className={`rise ${styles.d3} ${styles.actions}`}>
          <ButtonLink href={PRIMARY_CTA.href} size="lg">
            {PRIMARY_CTA.label}
          </ButtonLink>
          <ButtonLink href="/#how" variant="text">
            See how it works →
          </ButtonLink>
        </div>
        <p className={`rise ${styles.d4} ${styles.note}`}>Free during 1.0 · Claude Code first, Cursor planned</p>
      </div>
      <GatherCard className={`rise ${styles.d5}`} />
    </div>
  );
}
