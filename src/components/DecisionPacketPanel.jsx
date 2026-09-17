import { buildDecisionPacketProjection } from "../lib/quoteConfidenceDecisionPacket";
import "./quoteConfidenceSurfaces.css";

const STATE_LABELS = Object.freeze({
  available: "Current evidence",
  not_applicable: "Not applicable",
  missing: "Missing evidence",
  stale: "Stale evidence",
  contradictory: "Conflicting evidence",
  schema_drift: "Evidence needs update",
  unavailable: "Unavailable evidence",
  blocked_by_integration: "Integration blocked",
  not_yet_available: "Not yet available",
  unknown: "Needs review"
});

function stateLabel(value) {
  return STATE_LABELS[String(value || "").trim().toLowerCase()] || "Needs review";
}

function Stage({ title, evidence, children }) {
  return (
    <li data-capability-state={evidence.evidenceState}>
      <div className="decision-packet__stage-heading">
        <h4>{title}</h4>
        <span>{stateLabel(evidence.evidenceState)}</span>
      </div>
      {children}
      <p>{evidence.reason}</p>
    </li>
  );
}

export default function DecisionPacketPanel({
  enabled = false,
  quote = null,
  source = "",
  onOpenAcceptedRevision
}) {
  if (!enabled || !quote) return null;
  const packet = buildDecisionPacketProjection({ quote, source });
  const handoffAvailable = packet.internalHandoff.action
    && typeof onOpenAcceptedRevision === "function";
  return (
    <section
      className="decision-packet"
      data-capability-id="quote-decision-packet"
      data-capability-state={packet.state === "ready" ? "ready" : "recovery"}
      aria-labelledby="decision-packet-title"
    >
      <header>
        <div>
          <p className="eyebrow">Read-only composition</p>
          <h3 id="decision-packet-title">Decision packet</h3>
        </div>
        <span>{packet.state === "ready" ? "Exact handoff ready" : "Evidence needs review"}</span>
      </header>
      <ol aria-label="Customer decision through internal handoff">
        <Stage title="Customer decision" evidence={packet.portalDecision}>
          <strong>{packet.portalDecision.decision
            ? packet.portalDecision.decision.replaceAll("_", " ")
            : "No decision recorded"}</strong>
        </Stage>
        <Stage title="Acceptance receipt" evidence={packet.acceptance}>
          <strong>{packet.acceptance.receiptId ? "Exact receipt recorded" : "No exact receipt"}</strong>
        </Stage>
        <Stage title="Payment state" evidence={packet.payment}>
          <strong>{packet.payment.depositState
            ? `Deposit: ${packet.payment.depositState.replaceAll("_", " ")}`
            : "Deposit state not available"}</strong>
          {packet.payment.finalBalanceState ? (
            <small>Final balance: {packet.payment.finalBalanceState.replaceAll("_", " ")}</small>
          ) : null}
        </Stage>
        <Stage title="Accepted revision handoff" evidence={packet.internalHandoff}>
          <strong>{packet.internalHandoff.acceptedRevisionId
            ? "Exact accepted revision identified"
            : "Accepted revision unavailable"}</strong>
          {handoffAvailable ? (
            <button
              type="button"
              className="ghost compact"
              onClick={() => onOpenAcceptedRevision({
                quoteId: packet.quoteId,
                acceptedRevisionId: packet.internalHandoff.acceptedRevisionId,
                acceptanceReceiptId: packet.internalHandoff.acceptanceReceiptId
              })}
            >
              Open accepted revision
            </button>
          ) : null}
        </Stage>
      </ol>
      <details>
        <summary>Authority boundary</summary>
        <p>{packet.boundary}</p>
      </details>
    </section>
  );
}
