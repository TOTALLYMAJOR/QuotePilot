import StatusChip from "./StatusChip";

function text(value) {
  return String(value ?? "").trim();
}

function formatCurrency(value, currency = "USD") {
  if (!Number.isFinite(value)) return "Unavailable";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: /^[A-Z]{3}$/.test(currency) ? currency : "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function statusPresentation(status) {
  if (status === "draft") return { family: "info", label: "Draft commitment" };
  if (["sent", "viewed"].includes(status)) return { family: "action", label: "Customer revision exists" };
  return { family: "blocked", label: "Committed record locked" };
}

export default function CommercialAmendmentWorkspace({
  commitment = null,
  dirty = false,
  previewAvailable = false,
  previewRequested = false,
  previewLoading = false,
  previewRecovering = false,
  previewError = "",
  onPreview,
  children
}) {
  const status = text(commitment?.status).toLowerCase() || "draft";
  const currency = text(commitment?.commercial?.currency) || "USD";
  const previewLabel = previewRecovering
    ? "Retrying preview…"
    : previewLoading
      ? "Building preview…"
      : previewRequested
        ? "Refresh consequence preview"
        : "Preview consequences";

  return (
    <section
      className="commercial-amendment-workspace"
      data-capability-id="qp-uxr-001-governed-commercial-amendment"
      data-capability-state={previewRequested ? "preview_requested" : dirty ? "proposal_changed" : "ready"}
      aria-labelledby="commercial-amendment-workspace-title"
    >
      <header className="commercial-amendment-workspace-head">
        <div>
          <p className="eyebrow">Governed commercial amendment</p>
          <h3 id="commercial-amendment-workspace-title">Understand the change before it becomes the next truth</h3>
          <p className="source-note">
            QuotePilot compares this proposal with the exact saved revision, explains supported consequences, and carries the same evidence through authorization, application, and recovery.
          </p>
        </div>
        <StatusChip {...statusPresentation(status)} />
      </header>

      <div className="commercial-amendment-commitment" aria-label="Current commercial commitment">
        <div className="commercial-amendment-commitment-intro">
          <p className="eyebrow">Current commitment</p>
          <strong>{commitment?.quoteNumber || "Saved quote"} · {commitment?.versionLabel || "Current revision"}</strong>
          <span>{commitment?.event?.name || "Event name unavailable"}</span>
        </div>
        <dl>
          <div>
            <dt>Current total</dt>
            <dd>{formatCurrency(commitment?.commercial?.total, currency)}</dd>
          </div>
          <div>
            <dt>Deposit requirement</dt>
            <dd>{formatCurrency(commitment?.commercial?.deposit, currency)}</dd>
          </div>
          <div>
            <dt>Proposal</dt>
            <dd>{dirty ? "Unsaved change ready for preview" : "Matches the loaded revision"}</dd>
          </div>
        </dl>
      </div>

      <div className="commercial-amendment-protocol">
        <div>
          <p className="eyebrow">What the lifecycle requires</p>
          <strong>{commitment?.protocol?.label || "Revision review"}</strong>
          <p>{commitment?.protocol?.explanation || "Review the saved source before applying a change."}</p>
          <p className="source-note">Next: {commitment?.protocol?.nextAction || "Review the revised quote."}</p>
        </div>
        <ol aria-label="Governed amendment progression">
          <li data-step-state="current"><span>1</span>Propose</li>
          <li data-step-state={previewRequested ? "current" : "next"}><span>2</span>Understand</li>
          <li data-step-state="next"><span>3</span>Authorize</li>
          <li data-step-state="next"><span>4</span>Apply</li>
          <li data-step-state="next"><span>5</span>Continue</li>
        </ol>
      </div>

      <div className="commercial-amendment-preview-action">
        <div>
          <strong>What will this proposal change elsewhere?</strong>
          <p>Previewing is read-only. No quote, artifact, payment, delivery, acceptance, or booking evidence changes here.</p>
        </div>
        <button
          type="button"
          className="cta compact"
          onClick={onPreview}
          disabled={!previewAvailable || previewLoading}
          title={previewAvailable
            ? "Compare the current form with the exact saved revision using server-authoritative pricing and dependency evidence."
            : "Consequence preview requires a Firebase-backed canonical quote and trusted pricing."}
        >
          {previewLabel}
        </button>
      </div>

      {!previewAvailable && (
        <p className="warning-note" role="note">
          Authoritative consequence preview is unavailable in browser-local mode. No client-calculated substitute is shown.
        </p>
      )}
      {previewError && !previewRequested && <p className="warning-note">{previewError}</p>}
      {children}
    </section>
  );
}
