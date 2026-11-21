"use client";

import { useActionState, useEffect, useState } from "react";
import p from "../../../components/app/page.module.css";
import buttonStyles from "../../../components/ui/button.module.css";
import { Callout } from "../../../components/ui/callout";
import { acceptInvite, type AcceptState } from "./actions";

/** Where a not-yet-signed-in visitor's invite waits during sign-in (this tab only, cleared on use). */
export const PENDING_KEY = "axiomic-invite";
const SECRET = /^[A-Za-z0-9_-]{43}$/;

/**
 * Reads the secret from the link's "#…" part (never sent to any server, so never in logs),
 * then removes it from the address bar. Signed out: it waits in sessionStorage while you sign in
 * (sign-in lands on /account, which points back here).
 */
export function AcceptInvite({ signedIn }: { signedIn: boolean }) {
  const [secret, setSecret] = useState<string | null | undefined>(undefined); // undefined = still reading
  const [state, action, pending] = useActionState<AcceptState, FormData>(acceptInvite, {});

  useEffect(() => {
    const fromHash = window.location.hash.slice(1);
    let found: string | null = null;
    if (SECRET.test(fromHash)) {
      found = fromHash;
      history.replaceState(null, "", window.location.pathname); // out of the address bar and history
    } else {
      try {
        const saved = sessionStorage.getItem(PENDING_KEY);
        if (saved && SECRET.test(saved)) found = saved;
      } catch {}
    }
    if (found && !signedIn) {
      try {
        sessionStorage.setItem(PENDING_KEY, found);
      } catch {}
    }
    setSecret(found);
  }, [signedIn]);

  if (secret === undefined) return <p className={p.small}>Reading the invite…</p>;
  if (secret === null) {
    return (
      <Callout tone="warning" title="No invite found">
        <p>Open the full invite link you were sent. If it doesn&rsquo;t work, ask the space admin for a new one.</p>
      </Callout>
    );
  }
  if (!signedIn) {
    return (
      <div className={p.form}>
        <p>Sign in with the GitHub or Google account that uses the invited email address. You&rsquo;ll come back to this invite after.</p>
        <a href="/sign-in" className={`${buttonStyles.button} ${buttonStyles.primary} ${buttonStyles.md}`}>
          Sign in
        </a>
      </div>
    );
  }
  return (
    <form
      action={action}
      className={p.form}
      onSubmit={() => {
        try {
          sessionStorage.removeItem(PENDING_KEY);
        } catch {}
      }}
    >
      <input type="hidden" name="secret" value={secret} />
      {state.error ? <Callout tone="warning" title={state.error} /> : null}
      <p>Joining adds you to the space with the role the admin chose. You can leave it any time.</p>
      <div className={p.actions}>
        <button type="submit" disabled={pending} className={`${buttonStyles.button} ${buttonStyles.primary} ${buttonStyles.md}`}>
          {pending ? "Joining…" : "Join the space"}
        </button>
      </div>
    </form>
  );
}

/** On /account: "you have an invite waiting" after signing in from an invite link. */
export function PendingInviteNotice() {
  const [has, setHas] = useState(false);
  useEffect(() => {
    try {
      setHas(SECRET.test(sessionStorage.getItem(PENDING_KEY) ?? ""));
    } catch {}
  }, []);
  if (!has) return null;
  return (
    <Callout tone="note" title="You have an invite waiting">
      <p>
        <a href="/invite">Open the invite</a> to join the space.
      </p>
    </Callout>
  );
}
