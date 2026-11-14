import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "../../../components/ui/page-header";
import { Prose } from "../../../components/ui/prose";
import { StatusBadge } from "../../../components/ui/status-badge";
import { Mark } from "../../../components/ui/type";
import { FEATURE_CATEGORIES, ROADMAP } from "../../../content/features";

export const metadata: Metadata = {
  title: "Roadmap",
  description: "What axiomic can do today, what is being built now, and what is planned for 1.0.",
};

/** Every feature, flattened, so a stage can list the ones with its status. */
const ALL = FEATURE_CATEGORIES.flatMap((c) => c.features);

export default function RoadmapPage() {
  return (
    <div className="container">
      <PageHeader
        eyebrow="Roadmap"
        title={
          <>
            Built in the open, <Mark padded>step by step.</Mark>
          </>
        }
        lead="Where every part stands, from what works today to what arrives with 1.0."
      />
      <Prose>
        {ROADMAP.map((stage) => {
          const items = ALL.filter((f) => f.status === stage.status);
          return (
            <section key={stage.status} aria-labelledby={`stage-${stage.status}`}>
              <h2 id={`stage-${stage.status}`}>{stage.title}</h2>
              <p>
                <StatusBadge status={stage.status} />
              </p>
              <p>{stage.text}</p>
              <p>
                {items.map((f, i) => (
                  <span key={f.id}>
                    {i > 0 ? " · " : null}
                    <Link href={`/features#${f.id}`}>{f.name}</Link>
                  </span>
                ))}
              </p>
              {stage.extra ? (
                <ul>
                  {stage.extra.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          );
        })}

        <h2 id="after">Later</h2>
        <p>
          Also planned, after the core is in place: a guard that stops rule files being committed by mistake, keys for
          cloud agents that run without a person signed in, and reporting which rule version each laptop has. More AI
          tools will follow Claude Code and Cursor.
        </p>

        <h2 id="pilot">The pilot</h2>
        <p>
          axiomic is being shaped with one development team first. There is no public sign-up yet, and 1.0 will be
          free. The <Link href="/docs/cli">CLI docs</Link> show what you can try locally today.
        </p>
      </Prose>
    </div>
  );
}
