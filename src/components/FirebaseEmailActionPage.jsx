import { useEffect, useRef, useState } from "react";
import {
  completeFirebaseEmailVerification,
  FIREBASE_EMAIL_ACTION_PATH,
  parseFirebaseEmailVerificationAction
} from "../lib/firebaseEmailAction";
import ProductBrandLockup from "./ProductBrandLockup";

const COPY = {
  ready: ["Verify your email", "Confirm."],
  submitting: ["Verifying your email", "Applying code."],
  uncertain: ["Verification is uncertain", "No result."],
  reconciliation: ["Completing verification", "Awaiting receipt."],
  receipt: ["Your email is verified", "Return."],
  error: ["This link cannot be used", "Request a new one."],
  recovery: ["This link is incomplete", "Sign in again."]
};
const BUTTON = {
  ready: ["Verify email"],
  submitting: ["Verifying…", true],
  reconciliation: ["Checking…", true]
};

export function FirebaseEmailActionPresentation({ state, detail = "", continueUrl = "/app", onSubmit }) {
  const [title, body] = COPY[state] || COPY.recovery;
  const button = BUTTON[state];
  const receipt = state === "receipt";
  return (
    <main className="auth-shell container">
      <section className="panel auth-card" data-capability-id="firebase-email-verification-handler" data-capability-state={state} aria-busy={button?.[1] || undefined}>
        <ProductBrandLockup className="auth-product-brand" />
        <h1>{title}</h1>
        <p className="muted">{body}</p>
        {detail && <p className="warning-note">{detail}</p>}
        <div className="auth-actions">
          {button && <button type="button" className="cta" disabled={button[1]} onClick={onSubmit}>{button[0]}</button>}
          <a className={`${receipt ? "cta" : "ghost"} button-link`} href={receipt ? continueUrl : "/app"}>{receipt ? "Return to QuotePilot" : "Return to sign in"}</a>
        </div>
      </section>
    </main>
  );
}

export default function FirebaseEmailActionPage() {
  const actionRef = useRef(null);
  const [view, setView] = useState(() => {
    try {
      actionRef.current = parseFirebaseEmailVerificationAction(window.location.href);
      return { state: "ready" };
    } catch (error) {
      return { state: "recovery", detail: error.message };
    }
  });

  useEffect(() => {
    if (actionRef.current) window.history.replaceState(window.history.state, "", FIREBASE_EMAIL_ACTION_PATH);
  }, []);

  async function submit() {
    setView({ state: "submitting" });
    try {
      const result = await completeFirebaseEmailVerification(
        actionRef.current,
        () => setView({ state: "reconciliation" })
      );
      setView({ state: "receipt", continueUrl: result.continueUrl });
    } catch (error) {
      setView({ state: error.kind === "uncertain" ? "uncertain" : "error", detail: error.message });
    }
  }

  return <FirebaseEmailActionPresentation {...view} continueUrl={view.continueUrl || actionRef.current?.continueUrl} onSubmit={submit} />;
}
