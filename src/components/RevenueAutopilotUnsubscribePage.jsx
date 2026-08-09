import { useEffect, useRef, useState } from "react";
import {
  getRevenueAutopilotUnsubscribeContext,
  isDefinitiveRevenueAutopilotError,
  readPendingRevenueAutopilotUnsubscribeAttempt,
  resetDefinitiveRevenueAutopilotUnsubscribeAttempt,
  unsubscribeRevenueAutopilotEmail
} from "../lib/revenueAutopilotClient";
import StatusChip from "./StatusChip";

function tokenFromLocation() {
  if (typeof window === "undefined") return "";
  return String(new URLSearchParams(window.location.search).get("unsubscribe") || "").trim();
}

function mutationStateFor(token) {
  const pending = readPendingRevenueAutopilotUnsubscribeAttempt({ token });
  if (!pending) return { state: "ready", pending: null };
  if (pending.definitive) return { state: "error", pending };
  return { state: "uncertain", pending };
}

export default function RevenueAutopilotUnsubscribePage() {
  const token = tokenFromLocation();
  const [read, setRead] = useState({ loading: true, error: "", context: null });
  const [mutation, setMutation] = useState(() => mutationStateFor(token));
  const [receipt, setReceipt] = useState(null);
  const generationRef = useRef(0);

  const load = () => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setRead((current) => ({ ...current, loading: true, error: "" }));
    getRevenueAutopilotUnsubscribeContext({ token })
      .then((result) => {
        if (generation !== generationRef.current) return;
        setRead({ loading: false, error: "", context: result.context });
      })
      .catch((error) => {
        if (generation !== generationRef.current) return;
        setRead({
          loading: false,
          error: error?.message || "This email-preference link could not be loaded.",
          context: null
        });
      });
  };

  useEffect(() => {
    load();
    return () => { generationRef.current += 1; };
  }, [token]);

  const unsubscribe = async () => {
    const prior = readPendingRevenueAutopilotUnsubscribeAttempt({ token });
    setMutation({ state: prior ? "reconciliation" : "submitting", pending: prior });
    try {
      const result = await unsubscribeRevenueAutopilotEmail({
        token,
        ...(prior?.requestId ? { requestId: prior.requestId } : {})
      });
      setReceipt(result.receipt);
      setMutation({ state: "receipt", pending: null });
      setRead((current) => ({
        ...current,
        context: current.context ? { ...current.context, subscriptionState: "unsubscribed" } : current.context
      }));
    } catch (error) {
      const pending = readPendingRevenueAutopilotUnsubscribeAttempt({ token });
      setMutation({
        state: isDefinitiveRevenueAutopilotError(error) ? "error" : "uncertain",
        pending,
        error: error?.message || "The unsubscribe request did not return a definitive receipt."
      });
    }
  };

  const alreadyUnsubscribed = read.context?.subscriptionState === "unsubscribed";
  const mutationBusy = new Set(["submitting", "reconciliation"]).has(mutation.state);

  return (
    <main
      className="auth-shell container"
      data-unsubscribe-read-state={read.loading ? "loading" : read.error ? "error" : "success"}
    >
      <section className="panel customer-workspace">
        <p className="eyebrow">Email preferences</p>
        <h1>{read.context?.organizationName || "QuotePilot reminders"}</h1>
        <p className="muted">Control automated quote follow-ups and payment reminders for this customer relationship.</p>

        {read.loading && <p role="status">Loading email preferences…</p>}
        {read.error && (
          <div className="warning-note" role="alert">
            <p>{read.error}</p>
            <button
              type="button"
              className="ghost compact"
              data-capability-action="retry-unsubscribe-context"
              onClick={load}
            >Retry link</button>
          </div>
        )}

        {read.context && (
          <>
            <dl className="staff-evidence-details">
              <div><dt>Recipient</dt><dd>{read.context.recipientLabel || "Customer email on the current relationship"}</dd></div>
              <div><dt>Current state</dt><dd>{alreadyUnsubscribed ? "Unsubscribed" : "Subscribed"}</dd></div>
              <div><dt>Scope</dt><dd>Automated reminder email only<small>Proposal access and quote conversations remain available.</small></dd></div>
            </dl>
            <div
              className="staff-evidence-rail staff-evidence-current"
              aria-live="polite"
              data-capability-id="cwf-12-revenue-autopilot-unsubscribe"
              data-capability-state={mutation.state}
            >
              <div className="staff-evidence-head">
                <div>
                  <p className="eyebrow">Request outcome</p>
                  <h2>{alreadyUnsubscribed ? "Automated reminders are off" : "Stop automated reminders"}</h2>
                </div>
                <StatusChip
                  family={alreadyUnsubscribed || mutation.state === "receipt" ? "confirmed" : mutation.state === "uncertain" ? "blocked" : "info"}
                  label={alreadyUnsubscribed || mutation.state === "receipt" ? "Unsubscribed" : mutation.state === "uncertain" ? "Reconcile request" : "Ready"}
                />
              </div>
              {mutation.state === "uncertain" && (
                <p className="warning-note" role="alert">No definitive receipt returned. Reconcile the exact request; do not start a second one.</p>
              )}
              {mutation.state === "error" && (
                <div className="warning-note" role="alert">
                  <p>{mutation.error || "The request was rejected."}</p>
                  <button
                    type="button"
                    className="ghost compact"
                    data-capability-action="reset-revenue-autopilot-unsubscribe"
                    onClick={() => {
                      if (resetDefinitiveRevenueAutopilotUnsubscribeAttempt({ token })) {
                        setMutation({ state: "recovery", pending: null });
                      }
                    }}
                  >Reset rejected request</button>
                </div>
              )}
              {receipt && <p className="source-note">Server receipt recorded {receipt.recordedAtISO}. This records the preference change only; it is not provider-delivery or payment evidence.</p>}
              {!alreadyUnsubscribed && (
                <button
                  type="button"
                  className="cta"
                  data-capability-action="submit-revenue-autopilot-unsubscribe"
                  disabled={mutationBusy}
                  onClick={unsubscribe}
                >
                  {mutation.state === "reconciliation"
                    ? "Reconciling exact request…"
                    : mutation.state === "submitting"
                      ? "Recording preference…"
                      : mutation.state === "uncertain"
                        ? "Reconcile exact request"
                        : "Unsubscribe from automated reminders"}
                </button>
              )}
            </div>
          </>
        )}

        <p className="source-note">This page does not create a customer account, change proposal scope, record a portal view, or alter payment and booking evidence.</p>
      </section>
    </main>
  );
}
