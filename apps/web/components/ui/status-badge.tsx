import styles from "./status-badge.module.css";

/** Every status a feature or command can have on this site. */
export type Status = "built" | "local" | "in-progress" | "soon" | "planned" | "available" | "coming";

const LABELS: Record<Status, string> = {
  built: "Built",
  local: "Available",
  "in-progress": "In development",
  soon: "Coming soon",
  planned: "Planned",
  available: "Available",
  coming: "Coming: needs the server",
};

/** A small label that says honestly whether something exists yet. */
export function StatusBadge({ status }: { status: Status }) {
  return <span className={`${styles.badge} ${styles[status]}`}>{LABELS[status]}</span>;
}
