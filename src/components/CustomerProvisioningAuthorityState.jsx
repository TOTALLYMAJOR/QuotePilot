const COPY = Object.freeze({
  ready: "Ready to create an exact owner invitation. Ownership binds only after that email is verified.",
  submitting: "Checking the organization and preparing the exact owner handoff.",
  uncertain: "The request ended without a receipt. Keep this order unchanged while QuotePilot checks its exact outcome.",
  reconciliation: "Checking the exact order for a committed provisioning receipt.",
  receipt: "Provisioning is recorded. Owner access still requires exact-email verification and activation.",
  error: "Provisioning did not advance. Review the reason before trying again."
});

export default function CustomerProvisioningAuthorityState({
  state = "ready",
  message = "",
  onReconcile = null,
  onReset = null
}) {
  const normalizedState = Object.hasOwn(COPY, state) ? state : "ready";
  return (
    <div
      className={`status-strip provisioning-authority-state is-${normalizedState}`}
      data-capability-id="organization-owner-provisioning"
      data-capability-state={normalizedState}
      role={normalizedState === "error" ? "alert" : "status"}
      aria-live={normalizedState === "submitting" || normalizedState === "reconciliation" ? "polite" : undefined}
    >
      <span>{message || COPY[normalizedState]}</span>
      {normalizedState === "uncertain" && typeof onReconcile === "function" && (
        <button type="button" className="ghost" onClick={onReconcile}>
          Check exact order
        </button>
      )}
      {normalizedState === "error" && typeof onReset === "function" && (
        <button
          type="button"
          className="ghost"
          data-capability-state="recovery"
          onClick={onReset}
        >
          Review and try again
        </button>
      )}
    </div>
  );
}
