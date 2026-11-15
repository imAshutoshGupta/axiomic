"use client";

import { useActionState } from "react";
import { Callout } from "../../../components/ui/callout";
import buttonStyles from "../../../components/ui/button.module.css";
import { deviceAction, type DeviceState } from "./actions";
import styles from "./device.module.css";

/**
 * Step 1: type the code. Step 2: see which device asked, then approve. Step 3: done.
 * Each step is a server action; this component only shows what the server answered.
 */
export function ApproveForm() {
  const [state, action, pending] = useActionState<DeviceState, FormData>(deviceAction, { step: "enter" });

  if (state.step === "done") {
    return (
      <Callout tone="note" title="Approved. Go back to your terminal.">
        <p>axiomic finishes signing in there within a few seconds. You can close this page.</p>
      </Callout>
    );
  }

  if (state.step === "confirm") {
    return (
      <div>
        <dl className={styles.facts}>
          <dt>Code</dt>
          <dd>
            <code>{state.code}</code>
          </dd>
          <dt>Device (reported by the device)</dt>
          <dd>{state.clientInfo}</dd>
          <dt>Asked at</dt>
          <dd>{new Date(state.createdAt).toLocaleString()}</dd>
        </dl>
        <Callout
          tone="warning"
          title="Only approve a code you just typed into your own terminal. axiomic staff will never ask you for one."
        />
        <form action={action} className={styles.form}>
          <input type="hidden" name="intent" value="approve" />
          <input type="hidden" name="code" value={state.code} />
          <button type="submit" disabled={pending} className={`${buttonStyles.button} ${buttonStyles.primary}`}>
            {pending ? "Approving…" : "Approve this device"}
          </button>
          <a href="/device" className={`${buttonStyles.button} ${buttonStyles.secondary}`}>
            Cancel
          </a>
        </form>
      </div>
    );
  }

  return (
    <div>
      <form action={action} className={styles.form}>
        <input type="hidden" name="intent" value="check" />
        <label className={styles.label}>
          Code from your terminal
          <input
            name="code"
            required
            maxLength={20}
            placeholder="ABCD-1234"
            className={styles.input}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
          />
        </label>
        <button type="submit" disabled={pending} className={`${buttonStyles.button} ${buttonStyles.primary}`}>
          {pending ? "Checking…" : "Continue"}
        </button>
      </form>
      {state.error ? <Callout tone="warning" title={state.error} /> : null}
    </div>
  );
}
