"use client";

import { useActionState } from "react";
import p from "../../../components/app/page.module.css";
import buttonStyles from "../../../components/ui/button.module.css";
import { Callout } from "../../../components/ui/callout";
import { decide, withdraw, type DecideState } from "./actions";

/** Approve / reject, with an optional note to the author. `canApprove` false: reject only (text can't be opened). */
export function DecideForm({ id, canApprove }: { id: string; canApprove: boolean }) {
  const [state, action, pending] = useActionState<DecideState, FormData>(decide, {});
  return (
    <form action={action} className={p.form} style={{ margin: "12px 0 0" }}>
      <input type="hidden" name="id" value={id} />
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
        Note to the author (optional)
        <input className={p.input} name="note" maxLength={2000} autoComplete="off" />
      </label>
      <div className={p.actions} style={{ margin: 0 }}>
        {canApprove ? (
          <button type="submit" name="intent" value="approve" disabled={pending} className={`${buttonStyles.button} ${buttonStyles.primary} ${buttonStyles.md}`}>
            Approve
          </button>
        ) : null}
        <button type="submit" name="intent" value="reject" disabled={pending} className={`${buttonStyles.button} ${buttonStyles.secondary} ${buttonStyles.md}`}>
          Reject
        </button>
      </div>
    </form>
  );
}

export function WithdrawForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<DecideState, FormData>(withdraw, {});
  return (
    <form action={action} className={p.actions}>
      <input type="hidden" name="id" value={id} />
      {state.error ? <Callout tone="warning" title={state.error} /> : null}
      <button type="submit" disabled={pending} className={`${buttonStyles.button} ${buttonStyles.secondary} ${buttonStyles.md}`}>
        Withdraw
      </button>
    </form>
  );
}
