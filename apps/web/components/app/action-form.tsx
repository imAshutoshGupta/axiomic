"use client";

import { useActionState, useState, type ReactNode } from "react";
import buttonStyles from "@/components/ui/button.module.css";
import { Callout } from "@/components/ui/callout";
import p from "./page.module.css";

/** What a management server action answers. `link`: an invite link, shown once (never stored). */
export type ActionState = { error?: string; message?: string; link?: string; notes?: string[] };
export type ManageAction = (prev: ActionState, form: FormData) => Promise<ActionState>;

/**
 * One small form for one database action (invite, change role, add a folder…). Hidden fields
 * say what to act on; the database decides whether you may. The answer shows right under it.
 * `confirm`: a tickbox that must be ticked first (for removing people, deleting things).
 */
export function ActionForm(props: {
  action: ManageAction;
  hidden: Record<string, string>;
  submit: string;
  variant?: "primary" | "secondary" | "text";
  confirm?: string;
  inline?: boolean;
  children?: ReactNode;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(props.action, {});
  const [ticked, setTicked] = useState(false);
  const variant = props.variant ?? "secondary";

  return (
    <form action={action} className={props.inline ? p.inlineForm : p.formTight}>
      {Object.entries(props.hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {props.children}
      {props.confirm ? (
        <label className={p.check}>
          <input type="checkbox" name="confirm" checked={ticked} onChange={(e) => setTicked(e.target.checked)} /> {props.confirm}
        </label>
      ) : null}
      <button
        type="submit"
        disabled={pending || (!!props.confirm && !ticked)}
        className={`${buttonStyles.button} ${buttonStyles[variant]} ${variant === "text" ? "" : buttonStyles.md}`}
      >
        {pending ? "Working…" : props.submit}
      </button>
      {state.error ? <Callout tone="warning" title={state.error} /> : null}
      {state.message ? (
        <Callout tone="note" title={state.message}>
          {state.notes?.length ? (
            <ul className={p.findings}>
              {state.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          ) : null}
        </Callout>
      ) : null}
      {state.link ? <InviteLink link={state.link} /> : null}
    </form>
  );
}

function InviteLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={p.card} style={{ width: "100%" }}>
      <strong>Invite link: shown only now</strong>
      <code className={p.secret}>{link}</code>
      <p className={p.small}>
        Send it to them yourself (Slack, WhatsApp, email). It works once, for that email address only, for 7 days. Lost it? Use
        &ldquo;New link&rdquo;.
      </p>
      <button
        type="button"
        className={`${buttonStyles.button} ${buttonStyles.secondary} ${buttonStyles.md}`}
        onClick={() => navigator.clipboard?.writeText(link).then(() => setCopied(true), () => {})}
      >
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}
