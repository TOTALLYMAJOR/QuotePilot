import PropTypes from "prop-types";
import "./stewardWorkbench.css";

const STATE_CONTENT = Object.freeze({
  preparing: {
    eyebrow: "Private shadow check",
    headline: "Building the decision packet",
    body: "Steward is checking named sources, current policy, and packet integrity. No message is being written back or sent.",
    nextStep: "You can keep working in QuotePilot while the private check finishes."
  },
  needs_input: {
    eyebrow: "More evidence required",
    headline: "A safe answer needs more information",
    body: "The available facts do not support a review-ready response. Steward will not fill the gaps with guesses.",
    nextStep: "Use the ordinary quote or message workflow to confirm the missing details."
  },
  ready_for_review: {
    eyebrow: "Private evaluation only",
    headline: "Prepared for your review",
    body: "A private evaluation packet exists, but its model output remains hidden in this build and cannot enter the composer.",
    nextStep: "A reviewed runtime and pilot evidence are still required before drafts can be shown."
  },
  partially_verified: {
    eyebrow: "Evidence gap",
    headline: "Some consequences are still unknown",
    body: "Known and unknown consequences remain separate. Steward cannot turn an estimate or suggestion into a verified fact.",
    nextStep: "Confirm the missing pricing, policy, or event evidence in its authoritative QuotePilot surface."
  },
  refused: {
    eyebrow: "Boundary held",
    headline: "This request crosses a QuotePilot boundary",
    body: "Steward will not prepare deceptive, discriminatory, unsupported, secret-bearing, or autonomous instructions.",
    nextStep: "Continue manually with an accurate alternative or ask an administrator to review the governing policy."
  },
  stale: {
    eyebrow: "Revision changed",
    headline: "The event changed after this packet was prepared",
    body: "The packet cannot be used because its quote, catalog, or policy revision is no longer current.",
    nextStep: "Refresh the quote first. Regeneration remains unavailable until the private runtime is reviewed."
  },
  expired: {
    eyebrow: "Packet expired",
    headline: "This packet has expired",
    body: "Steward packets are intentionally short-lived and cannot be reloaded as hidden authority.",
    nextStep: "Continue manually. A future reviewed runtime must prepare a new packet from current sources."
  },
  provider_unavailable: {
    eyebrow: "Read-only shadow",
    headline: "Steward is unavailable; quoting is not",
    body: "The Difficult Question Desk is not connected to a reviewed private runtime or provider in this build.",
    nextStep: "Use QuotePilot's ordinary message workflow. Your quote remains fully available."
  }
});

const CAPABILITY_STATE_BY_STEWARD_STATE = Object.freeze({
  preparing: "loading",
  provider_unavailable: "empty",
  ready_for_review: "success",
  stale: "stale",
  needs_input: "partial",
  partially_verified: "partial",
  refused: "error",
  expired: "recovery"
});

function BoundaryIcon({ state }) {
  const isBlocked = ["refused", "stale", "expired"].includes(state);
  return (
    <svg
      aria-hidden="true"
      className="steward-workbench-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {isBlocked ? (
        <>
          <path d="M12 3 2.8 20h18.4L12 3Z" />
          <path d="M12 9v4m0 3h.01" />
        </>
      ) : (
        <>
          <path d="M5 4h14v16H5z" />
          <path d="M8 8h8M8 12h8M8 16h5" />
        </>
      )}
    </svg>
  );
}

BoundaryIcon.propTypes = {
  state: PropTypes.oneOf(Object.keys(STATE_CONTENT)).isRequired
};

export default function StewardWorkbench({
  state = "provider_unavailable",
  quoteNumber = "Current quote",
  onOpenManualComposer
}) {
  const content = STATE_CONTENT[state] || STATE_CONTENT.provider_unavailable;
  const preparing = state === "preparing";

  return (
    <section
      className={`steward-workbench steward-workbench-${state}`}
      aria-labelledby="steward-workbench-title"
      data-capability-id="steward-difficult-question-workbench"
      data-capability-state={CAPABILITY_STATE_BY_STEWARD_STATE[state] || "empty"}
      data-steward-state={state}
    >
      <div className="steward-workbench-heading">
        <BoundaryIcon state={state} />
        <div>
          <p>{content.eyebrow}</p>
          <h2 id="steward-workbench-title">Difficult Question Desk</h2>
        </div>
        <span>No changes made</span>
      </div>

      <div className="steward-workbench-status" role="status" aria-live="polite">
        <strong>{content.headline}</strong>
        <p>{content.body}</p>
      </div>

      {preparing ? (
        <ol className="steward-workbench-stages" aria-label="Steward preparation stages">
          <li>Source check</li>
          <li>Policy check</li>
          <li>Packet validation</li>
        </ol>
      ) : null}

      <div className="steward-workbench-context">
        <span>Scope</span>
        <strong>{quoteNumber}</strong>
        <p>{content.nextStep}</p>
      </div>

      <div className="steward-workbench-actions">
        <button type="button" onClick={onOpenManualComposer}>
          Open manual message
        </button>
        <button type="button" disabled aria-disabled="true">
          Steward handoff unavailable
        </button>
      </div>

      <details>
        <summary>Why Steward is limited</summary>
        <p>
          Steward cannot save, send, approve, discount, charge, configure, or
          replace QuotePilot's pricing and policy authorities. Model output is
          not visible on this source-only checkpoint.
        </p>
      </details>
    </section>
  );
}

StewardWorkbench.propTypes = {
  state: PropTypes.oneOf(Object.keys(STATE_CONTENT)),
  quoteNumber: PropTypes.string,
  onOpenManualComposer: PropTypes.func.isRequired
};

export { STATE_CONTENT as STEWARD_WORKBENCH_STATES };
