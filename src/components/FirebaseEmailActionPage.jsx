import { useEffect, useRef, useState } from "react";
import {
  completeFirebaseEmailVerification,
  FIREBASE_EMAIL_ACTION_PATH,
  parseFirebaseEmailVerificationAction
} from "../lib/firebaseEmailAction";
import ProductBrandLockup from "./ProductBrandLockup";

const COPY = {
  ready: "Verify your email",
  submitting: "Verifying your email",
  uncertain: "Verification is uncertain",
  reconciliation: "Completing verification",
  receipt: "Your email is verified",
  error: "This link cannot be used",
  recovery: "This link is incomplete"
};
const BUTTON = {
  ready: ["Verify email"],
  submitting: ["Verifying…", true],
  reconciliation: ["Checking…", true]
};

export function FirebaseEmailActionPresentation({ state, continueUrl = "/app", onSubmit }) {
  const title = COPY[state] || COPY.recovery;
  const button = BUTTON[state];
  const receipt = state === "receipt";
  return (
    <main className="auth-shell container">
      <section className="panel auth-card" data-capability-id="firebase-email-verification-handler" data-capability-state={state} aria-busy={button?.[1] || undefined}>
        <ProductBrandLockup className="auth-product-brand" />
        <h1>{title}</h1>
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
      return { state: "recovery" };
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
      setView({ state: error.kind === "uncertain" ? "uncertain" : "error" });
    }
  }

  return <FirebaseEmailActionPresentation {...view} continueUrl={view.continueUrl || actionRef.current?.continueUrl} onSubmit={submit} />;
}
