import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "../../../components/ui/button";
import { PageHeader } from "../../../components/ui/page-header";
import { StatusBadge } from "../../../components/ui/status-badge";
import { Mark } from "../../../components/ui/type";
import { FEATURE_CATEGORIES } from "../../../content/features";
import { PRIMARY_CTA } from "../../../content/site";
import s from "./product.module.css";

export const metadata: Metadata = {
  title: "Product",
  description: "Why AI rule files don't belong in Git, and everything axiomic does instead: layers, a safety check, delivery to every laptop and team control.",
};

const PROBLEMS = [
  { emoji: "🔓", title: "They leak", text: "Server names and internal commands, visible to every fork." },
  { emoji: "🔀", title: "They drift", text: "Copied into 30 repos, slowly stop matching." },
  { emoji: "🤷", title: "Nobody owns them", text: "Anyone can change a company rule in a PR." },
  { emoji: "📦", title: "They can't be taken back", text: "Someone who leaves keeps every copy." },
];

const PARTS = [
  { emoji: "🖥️", title: "Website", text: "Leads write, review and approve rules." },
  { emoji: "🗄️", title: "Server", text: "Encrypted versions; decides who gets what." },
  { emoji: "⌨️", title: "CLI", text: "Writes the rules on each laptop, out of Git." },
];

/** Product overview + every feature (this page replaced /features). One line per item. */
export default function ProductPage() {
  return (
    <div className="container">
      <PageHeader
        eyebrow="Product"
        title={
          <>
            AI rules belong to your team, <Mark padded>not to Git.</Mark>
          </>
        }
        lead="One private home for your team's AI rules: owned, checked, combined per person, on every laptop."
      />

      <section className={s.block} aria-labelledby="problem">
        <h2 id="problem" className={s.h2}>Rule files in Git</h2>
        <ul className={s.grid4}>
          {PROBLEMS.map((p) => (
            <li key={p.title} className={s.tile}>
              <span className={s.emoji} aria-hidden="true">{p.emoji}</span>
              <b>{p.title}</b>
              {p.text}
            </li>
          ))}
        </ul>
      </section>

      <section className={s.block} aria-labelledby="parts">
        <h2 id="parts" className={s.h2}>Three parts, one brain</h2>
        <ul className={s.grid3}>
          {PARTS.map((p) => (
            <li key={p.title} className={s.part}>
              <span className={s.emoji} aria-hidden="true">{p.emoji}</span>
              <b>{p.title}</b>
              {p.text}
            </li>
          ))}
        </ul>
      </section>

      <section className={s.block} aria-labelledby="features">
        <h2 id="features" className={s.h2}>Everything it does</h2>
        <div className={s.cats}>
          {FEATURE_CATEGORIES.map((cat) => (
            <section key={cat.id} id={cat.id} className={s.cat} aria-label={cat.title}>
              <h3 className={s.catTitle}>
                <span aria-hidden="true">{cat.emoji}</span> {cat.title}
              </h3>
              <ul className={s.items}>
                {cat.features.map((f) => {
                  const ready = f.status === "local";
                  return (
                    <li key={f.id} id={f.id} className={ready ? undefined : s.later}>
                      <span className={s.tick} aria-hidden="true">{ready ? "✓" : "○"}</span>
                      <span>
                        <b>{f.name}</b> {f.short} {ready ? null : <StatusBadge status={f.status} />}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
        <p style={{ marginTop: 16 }}>
          <Link href="/roadmap">See the roadmap →</Link> · axiomic keeps rules out of Git, not out of the AI:{" "}
          <Link href="/security">the limits</Link>.
        </p>
      </section>

      <div className={s.cta}>
        <p>Free during 1.0. Set up in minutes.</p>
        <ButtonLink href={PRIMARY_CTA.href} size="lg">
          {PRIMARY_CTA.label}
        </ButtonLink>
      </div>
      <div style={{ height: 96 }} />
    </div>
  );
}
