import type { Metadata } from "next";
import Link from "next/link";
import sectionStyles from "../../../components/landing/sections.module.css";
import { ButtonLink } from "../../../components/ui/button";
import { PageHeader } from "../../../components/ui/page-header";
import { Prose } from "../../../components/ui/prose";
import { Section } from "../../../components/ui/section";
import { StatusBadge } from "../../../components/ui/status-badge";
import { Mark } from "../../../components/ui/type";
import { FEATURE_CATEGORIES } from "../../../content/features";

export const metadata: Metadata = {
  title: "Features",
  description:
    "Everything axiomic does: rule layers and merging, a publish safety check, delivery to the laptop, team control and AI tool support, each with its current status.",
};

/**
 * Each category reuses the landing page's Section and two-column "facts" grid, so this page
 * looks like the landing page continued, and collapses to one column on phones.
 */
export default function FeaturesPage() {
  return (
    <>
      <div className="container">
        <PageHeader
          eyebrow="Features"
          title={
            <>
              Everything axiomic does, <Mark padded>and where it stands.</Mark>
            </>
          }
          lead="Each capability carries its real status, so you always know what you can rely on today."
        />
        <Prose>
          <p>
            <StatusBadge status="local" /> built and tested, runs on the laptop &nbsp;
            <StatusBadge status="in-progress" /> being built now &nbsp;
            <StatusBadge status="soon" /> next in line &nbsp;
            <StatusBadge status="planned" /> on the <Link href="/roadmap">roadmap</Link>
          </p>
          <p>
            Jump to:{" "}
            {FEATURE_CATEGORIES.map((cat, i) => (
              <span key={cat.id}>
                {i > 0 ? " · " : null}
                <a href={`#${cat.id}`}>{cat.title}</a>
              </span>
            ))}
          </p>
        </Prose>
      </div>

      {FEATURE_CATEGORIES.map((cat) => (
        <Section key={cat.id} id={cat.id} eyebrow={cat.eyebrow} title={cat.title} lead={cat.summary}>
          <ul className={sectionStyles.facts}>
            {cat.features.map((f) => (
              <li key={f.id} id={f.id}>
                <h3>{f.name}</h3>
                <p>{f.benefit}</p>
                <p>
                  <StatusBadge status={f.status} />
                </p>
              </li>
            ))}
          </ul>
        </Section>
      ))}

      <div className="container">
        <p className={sectionStyles.more}>
          <ButtonLink href="/roadmap">See the roadmap</ButtonLink>
          <ButtonLink href="/docs/cli" variant="text">
            Read the CLI docs →
          </ButtonLink>
        </p>
      </div>
    </>
  );
}
