/** /roadmap: what is built, in progress and planned (from content/features.ts). */
import type { Metadata } from "next";
import Link from "next/link";
import v from "@/components/landing/visuals.module.css";
import { PageHeader } from "@/components/ui/page-header";
import { Mark } from "@/components/ui/type";
import { ALL_FEATURES, ROADMAP } from "@/content/features";

export const metadata: Metadata = {
  title: "Roadmap",
  description: "What axiomic does today, what is being built, and what comes with 1.0.",
};

const CLS: Record<string, string | undefined> = { local: "", "in-progress": v.stageNow, soon: v.stageNext, planned: v.stageNext };

/** Four columns from content/features.ts, so a status changes in one place. */
export default function RoadmapPage() {
  return (
    <div className="container">
      <PageHeader
        eyebrow="Roadmap"
        title={
          <>
            Where it stands, <Mark padded>at a glance.</Mark>
          </>
        }
        lead="Built with one team first. Free during 1.0."
      />
      <ol className={v.track} style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        {ROADMAP.map((stage) => (
          <li key={stage.status} className={`${v.stage} ${CLS[stage.status] ?? ""}`}>
            <div className={v.stageHead}>
              <h2 className={v.stageTitle}>{stage.title}</h2>
            </div>
            <ul className={v.items}>
              {ALL_FEATURES.filter((f) => f.status === stage.status).map((f) => (
                <li key={f.id}>
                  <Link href={`/product#${f.id}`}>{f.name}</Link>
                </li>
              ))}
              {stage.extra?.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      <p className={v.foot} style={{ marginBottom: 96 }}>
        Later: more AI tools (GitHub Copilot, then Windsurf), Slack notifications, starter templates.
      </p>
    </div>
  );
}
