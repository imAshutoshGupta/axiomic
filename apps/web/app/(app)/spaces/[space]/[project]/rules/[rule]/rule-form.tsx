"use client";

import { useActionState, useState } from "react";
import p from "../../../../../../../components/app/page.module.css";
import buttonStyles from "../../../../../../../components/ui/button.module.css";
import { Callout } from "../../../../../../../components/ui/callout";
import { deleteRule, saveRule, type EditorState } from "./actions";

export type RuleFormProps = {
  space: string;
  project: string;
  /** Existing rule, or a new one in `layer` (and `moduleId` for a folder). */
  rule?: { id: string; version: number; title: string; body: string; locked: boolean };
  layer: string;
  moduleId?: string;
  /** You own this layer: saves go straight in. Otherwise the save becomes a suggestion. */
  canEdit: boolean;
  lockable: boolean;
};

/**
 * The editor. Title + text are controlled state, so a refused save (safety finding, conflict,
 * expired sign-in) never loses what you typed. The text is plain Markdown, shown as typed.
 */
export function RuleForm(props: RuleFormProps) {
  const [title, setTitle] = useState(props.rule?.title ?? "");
  const [body, setBody] = useState(props.rule?.body ?? "");
  const [state, action, pending] = useActionState<EditorState, FormData>(saveRule, {});
  const [delState, delAction, deleting] = useActionState<EditorState, FormData>(deleteRule, {});
  const verb = props.canEdit ? "Save" : "Send suggestion";

  return (
    <>
      <form action={action} className={p.form}>
        <input type="hidden" name="space" value={props.space} />
        <input type="hidden" name="project" value={props.project} />
        {props.rule ? (
          <>
            <input type="hidden" name="ruleId" value={props.rule.id} />
            <input type="hidden" name="baseVersion" value={props.rule.version} />
          </>
        ) : (
          <>
            <input type="hidden" name="layer" value={props.layer} />
            {props.moduleId ? <input type="hidden" name="moduleId" value={props.moduleId} /> : null}
          </>
        )}

        {state.error ? (
          <Callout tone="warning" title={state.error}>
            {state.findings?.length ? (
              <ul className={p.findings}>
                {state.findings.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            ) : null}
          </Callout>
        ) : null}

        <label className={p.label}>
          Title
          <input
            className={p.input}
            name="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={120}
            autoComplete="off"
            placeholder="e.g. Testing"
          />
          <span className={p.small} style={{ fontWeight: 400 }}>
            A narrower layer with the same title replaces this rule (unless it's locked).
          </span>
        </label>

        <label className={p.label}>
          Rule text (Markdown)
          <textarea className={p.textarea} name="body" value={body} onChange={(e) => setBody(e.target.value)} spellCheck />
        </label>

        {props.lockable && props.canEdit ? (
          <>
            <input type="hidden" name="lockedField" value="1" />
            <label className={p.check}>
              <input type="checkbox" name="locked" defaultChecked={props.rule?.locked ?? false} />
              Locked: no narrower layer can replace it; it goes first, marked MANDATORY
            </label>
          </>
        ) : null}

        {state.warnings?.length ? (
          <Callout tone="warning" title="The safety check has warnings">
            <ul className={p.findings}>
              {state.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
            <p>Fix them, or save anyway.</p>
          </Callout>
        ) : null}

        <div className={p.actions}>
          <button type="submit" disabled={pending} className={`${buttonStyles.button} ${buttonStyles.primary} ${buttonStyles.md}`}>
            {pending ? "Checking…" : verb}
          </button>
          {state.warnings?.length ? (
            <button
              type="submit"
              name="ack"
              value="1"
              disabled={pending}
              className={`${buttonStyles.button} ${buttonStyles.secondary} ${buttonStyles.md}`}
            >
              {verb} anyway
            </button>
          ) : null}
        </div>
        <p className={p.small}>
          Every save runs the safety check (secrets, hidden characters, injection phrasing, size).
          {props.canEdit ? " Laptops get the change at their next AI session." : " The layer's owner approves or rejects it."}
        </p>
      </form>

      {props.rule && props.canEdit ? (
        <form action={delAction} className={p.card}>
          <input type="hidden" name="space" value={props.space} />
          <input type="hidden" name="project" value={props.project} />
          <input type="hidden" name="ruleId" value={props.rule.id} />
          <h2 className={p.cardTitle}>Delete this rule</h2>
          <p className={p.small}>It goes to the trash, and every laptop drops it at its next AI session.</p>
          {delState.error ? <Callout tone="warning" title={delState.error} /> : null}
          <label className={p.check}>
            <input type="checkbox" name="confirm" /> Yes, delete &ldquo;{props.rule.title}&rdquo;
          </label>
          <div className={p.actions}>
            <button type="submit" disabled={deleting} className={`${buttonStyles.button} ${buttonStyles.secondary} ${buttonStyles.md}`}>
              {deleting ? "Deleting…" : "Delete rule"}
            </button>
          </div>
        </form>
      ) : null}
    </>
  );
}
