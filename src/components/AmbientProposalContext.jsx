import "./ambientProposalContext.css";

const STATE_LABELS = Object.freeze({
  current: "Current details",
  needs_resolution: "Needs attention",
  stale: "Needs refresh",
  unavailable: "Not available",
  local_preview: "Unsaved preview",
  available: "Complete customer view",
  partial: "Customer view needs details",
  malformed: "Needs refresh",
  local_unverified: "Recorded in QuotePilot; not independently confirmed",
  exact_current: "Exact saved revision",
  current_authoritative: "Current saved pricing",
  requires_authoritative_reprice: "Repricing required",
  expired: "Portal expired",
  absent: "Portal not issued",
  stale_revision: "Different quote version",
  requires_rotation: "New customer link required",
  provider_accepted: "Provider accepted",
  provider_accepted_portal_inactive: "Provider accepted, portal inactive",
  not_recorded: "No attempt recorded",
  outcome_ambiguous: "Delivery status unclear",
  outcome_unknown: "Delivery status unavailable",
  failed: "Provider attempt failed",
  sending: "Provider attempt pending",
  reconciled_not_sent: "Checked - not sent",
  governed_resolution: "Open trusted controls",
  blocked: "Blocked",
  not_needed: "Not needed"
});

function stateLabel(state) {
  return STATE_LABELS[state] || String(state || "unavailable").replaceAll("_", " ");
}

function proposalCopy(value) {
  return String(value || "")
    .replace(/\bcustomer-portal projection\b/giu, "customer portal view")
    .replace(/\bread-only staff projection\b/giu, "read-only customer view")
    .replace(/\bstaff proposal projection\b/giu, "customer view")
    .replace(/\bcustomer projection\b/giu, "customer view")
    .replace(/\bprojection\b/giu, "customer view")
    .replace(/\bgoverned prepare flow\b/giu, "trusted prepare controls")
    .replace(/\bgoverned send workflow\b/giu, "trusted send controls")
    .replace(/\bgoverned rotation workflow\b/giu, "trusted link-update controls")
    .replace(/\bgoverned recovery or rotation\b/giu, "trusted recovery or link update")
    .replace(/\bgoverned rotation\b/giu, "trusted link update")
    .replace(/\bgoverned actions\b/giu, "protected actions")
    .replace(/\bgoverned resolution\b/giu, "trusted next step");
}

function money(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Unavailable";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(value);
}

function safeFields(model) {
  const fields = model?.customerProjection?.fields;
  return fields && typeof fields === "object" ? fields : {};
}

export default function AmbientProposalContext({ model }) {
  if (!model?.descriptor || !model?.readiness || !Array.isArray(model?.actions)) {
    return (
      <section
        className="ambient-proposal-context ambient-proposal-context--unavailable"
        role="alert"
        data-surface-purpose="clarify reveal_context"
      >
        <strong>Proposal details are unavailable</strong>
        <p>Refresh this opportunity before relying on proposal completeness, what the customer sees, or delivery status.</p>
      </section>
    );
  }

  const fields = safeFields(model);
  const gaps = Array.isArray(model.readiness.gaps) ? model.readiness.gaps : [];
  const recommendedGaps = Array.isArray(model.readiness.recommendedGaps)
    ? model.readiness.recommendedGaps
    : [];
  const dependencies = Array.isArray(model.descriptor.dependencies)
    ? model.descriptor.dependencies
    : [];

  return (
    <section
      className="ambient-proposal-context"
      data-ambient-intelligent-object="proposal"
      data-proposal-state={model.state}
      data-proposal-source={model.sourceMode}
      data-surface-purpose="clarify advance reveal_context"
    >
      <header className="ambient-proposal-context__intro">
        <div>
          <span className={`ambient-proposal-context__state is-${model.state}`}>
            {stateLabel(model.state)}
          </span>
          <h3>{fields.eventName || "Proposal details"}</h3>
          <p>
            {fields.quoteNumber || "Quote number unavailable"}
            {fields.customerName ? ` for ${fields.customerName}` : ""}
          </p>
        </div>
        <div className="ambient-proposal-context__total">
          <span>Customer total</span>
          <strong>{money(fields.total)}</strong>
        </div>
      </header>

      <section className="ambient-proposal-context__projection" aria-labelledby="ambient-proposal-projection-title">
        <div className="ambient-proposal-context__section-heading">
          <div>
            <h4 id="ambient-proposal-projection-title">What the customer sees</h4>
            <p>{proposalCopy(model.customerProjection.reason)}</p>
          </div>
          <span className={`ambient-proposal-context__state is-${model.customerProjection.state}`}>
            {stateLabel(model.customerProjection.state)}
          </span>
        </div>
        <dl className="ambient-proposal-context__facts">
          <div><dt>Date</dt><dd>{fields.eventDate || "Unavailable"}</dd></div>
          <div><dt>Time</dt><dd>{fields.eventTime || "Unavailable"}</dd></div>
          <div><dt>Venue</dt><dd>{fields.venue || "Unavailable"}</dd></div>
          <div><dt>Guests</dt><dd>{fields.guests ?? "Unavailable"}</dd></div>
          <div><dt>Deposit</dt><dd>{money(fields.deposit)}</dd></div>
        </dl>
        <p className="ambient-proposal-context__boundary">{proposalCopy(model.customerProjection.boundary)}</p>
      </section>

      <section className="ambient-proposal-context__readiness" aria-labelledby="ambient-proposal-readiness-title">
        <div className="ambient-proposal-context__section-heading">
          <div>
            <h4 id="ambient-proposal-readiness-title">Proposal completeness</h4>
            <p>{model.readiness.score}% of the required proposal details are complete.</p>
          </div>
          <strong>{gaps.length === 0 ? "Required details ready" : `${gaps.length} ${gaps.length === 1 ? "gap" : "gaps"}`}</strong>
        </div>
        {gaps.length > 0 ? (
          <ul className="ambient-proposal-context__gaps" aria-label="Proposal completeness gaps">
            {gaps.map((gap) => (
              <li key={gap.id} data-proposal-gap={gap.id}>
                <span>{gap.label}</span>
                <small>Review this in the opportunity before preparing or sending the proposal.</small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ambient-proposal-context__caught-up">All required proposal details are present. This does not show delivery or acceptance.</p>
        )}
        {recommendedGaps.length > 0 && (
          <div className="ambient-proposal-context__recommendations">
            <strong>Recommended contact detail</strong>
            <ul aria-label="Recommended proposal details">
              {recommendedGaps.map((gap) => (
                <li key={gap.id} data-proposal-recommendation={gap.id}>
                  <span>{gap.label}</span>
                  <small>Helpful for follow-up and event-day contact, but not required to prepare or send this proposal.</small>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="ambient-proposal-context__evidence" aria-labelledby="ambient-proposal-evidence-title">
        <h4 id="ambient-proposal-evidence-title">What each status is based on</h4>
        <div className="ambient-proposal-context__evidence-grid">
          {[
            ["Saved quote", model.savedEvidence],
            ["Pricing", model.pricingEvidence],
            ["Customer link", model.portalEvidence],
            ["Email delivery", model.deliveryEvidence]
          ].map(([label, evidence]) => (
            <article key={label} data-proposal-evidence={label.toLowerCase().replaceAll(" ", "-")}>
              <span>{label}</span>
              <strong>{stateLabel(evidence.state)}</strong>
              <p>{proposalCopy(evidence.reason)}</p>
            </article>
          ))}
        </div>
        <p className="ambient-proposal-context__boundary">{proposalCopy(model.deliveryEvidence.boundary)}</p>
      </section>

      <section className="ambient-proposal-context__actions" aria-labelledby="ambient-proposal-actions-title">
        <div className="ambient-proposal-context__section-heading">
          <div>
            <h4 id="ambient-proposal-actions-title">What you can do next</h4>
            <p>Each option opens the right place to continue. Nothing changes from this view.</p>
          </div>
        </div>
        <ol>
          {model.actions.map((action) => (
            <li
              key={action.id}
              data-proposal-action={action.id}
              data-action-availability={action.availability}
            >
              <div>
                <strong>{action.label}</strong>
                <span className={`ambient-proposal-context__state is-${action.availability}`}>
                  {stateLabel(action.availability)}
                </span>
              </div>
              <p>{proposalCopy(action.reason)}</p>
              <small>{proposalCopy(action.nextResolution)}</small>
            </li>
          ))}
        </ol>
      </section>

      <dl className="ambient-proposal-context__judgment">
        <div data-context-arrival-duplicate="reason">
          <dt>Why this is shown</dt>
          <dd>{proposalCopy(model.descriptor.why)}</dd>
        </div>
        <div data-context-arrival-duplicate="consequence">
          <dt>What it affects</dt>
          <dd>{proposalCopy(model.descriptor.consequence)}</dd>
        </div>
        <div>
          <dt>If you do nothing</dt>
          <dd>{proposalCopy(model.descriptor.doNothing)}</dd>
        </div>
        <div>
          <dt>Confidence and source</dt>
          <dd>
            <strong>{model.descriptor.confidence.level}</strong>
            <span>{proposalCopy(model.descriptor.confidence.basis)}</span>
            <small>{model.descriptor.provenance[0]?.label}</small>
          </dd>
        </div>
      </dl>

      <section className="ambient-proposal-context__dependencies" aria-labelledby="ambient-proposal-dependencies-title">
        <h4 id="ambient-proposal-dependencies-title">What this connects to</h4>
        <ul>
          {dependencies.map((dependency) => (
            <li key={`${dependency.object.type}:${dependency.object.id}`}>
              <strong>{dependency.object.label}</strong>
              <span>{proposalCopy(dependency.consequence)}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="ambient-proposal-context__boundary">{proposalCopy(model.boundary)}</p>
    </section>
  );
}
