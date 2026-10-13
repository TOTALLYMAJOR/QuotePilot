import { useLayoutEffect, useRef } from "react";

export default function CommercialApplyRecoveryNotice({ pending, busy = false, error = "", outcome, onReconcile, onRecover, onOpenQuote, recoveryLabel = "" }) {
  const receipt = outcome?.outcomeReceipt;
  const sectionRef = useRef(null);
  const focusedRef = useRef(false);
  useLayoutEffect(() => {
    const active = document.activeElement;
    const focusLost = !active || active === document.body || sectionRef.current?.contains(active);
    const modal = document.querySelector('[aria-modal="true"]');
    if (!busy && focusLost && (!modal || modal.contains(sectionRef.current))
      && (focusedRef.current || receipt || error)) {
      (sectionRef.current?.querySelector("button:not(:disabled)") || sectionRef.current)?.focus();
    }
  }, [receipt?.state, error, busy]);
  if (!pending && !error && !receipt) return null;
  return <section
    ref={sectionRef}
    tabIndex={-1}
    onFocusCapture={() => { focusedRef.current = true; }}
    onBlurCapture={event => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) focusedRef.current = false;
    }}
    className="staff-evidence-rail"
    role={error ? "alert" : "status"}
    aria-live="polite"
    aria-busy={busy}
    aria-label="Commercial change recovery"
    data-capability-id="qp-uxr-001-apply-recovery"
    data-capability-state={error ? "uncertain" : receipt?.state || "reconciliation"}
  >
    <h3>Previous change outcome</h3>
    <p>{receipt?.state === "committed"
      ? receipt.appliedRevisionIsActive === false
        ? "The previous change committed, but a later revision is now active. Open the saved quote and history before further work."
        : "The exact server receipt proves the previous change committed. Open the saved quote and its history before further work."
      : receipt?.state === "not_committed"
        ? "The server proved the previous change did not commit and fenced its request. A fresh simulation is now permitted."
        : "A prior apply request is unresolved. Check its exact server outcome before starting another change. The edit will not be submitted again."}</p>
    {error && <p>{error}</p>}
    <div className="staff-evidence-actions">
      {pending && <button type="button" className="secondary" disabled={busy} onClick={onReconcile}>
        {busy ? "Checking previous outcome…" : "Check previous apply outcome"}
      </button>}
      {receipt?.state === "committed" && <button type="button" className="secondary" onClick={onOpenQuote}>Open saved quote and history</button>}
      {receipt?.state === "not_committed" && <button type="button" className="secondary" onClick={onRecover}>
        {recoveryLabel || (receipt.sourceChanged ? "Reload saved quote" : "Start fresh simulation")}
      </button>}
    </div>
  </section>;
}
