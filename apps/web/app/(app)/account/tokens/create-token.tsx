"use client";

import { useActionState } from "react";
import { Callout } from "@/components/ui/callout";
import buttonStyles from "@/components/ui/button.module.css";
import { createCliToken, type CreateState } from "./actions";
import styles from "./tokens.module.css";

/** The "create a token" form. The new token is shown once, here, and never again. */
export function CreateToken() {
  const [state, action, pending] = useActionState<CreateState, FormData>(createCliToken, {});

  return (
    <div>
      <form action={action} className={styles.form}>
        <label className={styles.label}>
          Name (optional)
          <input name="name" maxLength={100} placeholder="e.g. Work laptop" className={styles.input} autoComplete="off" />
        </label>
        <button type="submit" disabled={pending} className={`${buttonStyles.button} ${buttonStyles.primary}`}>
          {pending ? "Creating…" : "Create token"}
        </button>
      </form>
      {state.error ? <Callout tone="warning" title={state.error} /> : null}
      {state.token ? (
        <Callout tone="warning" title="Copy this token now. It won't be shown again.">
          <code className={styles.token}>{state.token}</code>
          <p>Keep it secret, like a password. Send it only in the Authorization header.</p>
        </Callout>
      ) : null}
    </div>
  );
}
