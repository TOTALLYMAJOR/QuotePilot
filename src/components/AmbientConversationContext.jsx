import "./ambientConversationContext.css";

const STATE_LABELS = Object.freeze({
  recorded: "Recorded",
  provider_accepted_only: "Email service accepted, not delivered",
  verified_delivered: "Delivery reported by email service",
  provider_non_delivery: "Provider non-delivery",
  recorded_view: "Portal visit recorded",
  latest_customer_reply: "Latest from customer",
  latest_staff_message: "Latest from staff",
  no_messages_recorded: "No messages recorded",
  advisory: "Engagement estimate",
  unsupported: "No supported inference",
  not_recorded: "Not recorded",
  local_unverified: "Recorded in QuotePilot; not independently confirmed",
  stale: "Older information",
  unavailable: "Needs review",
  open: "Open",
  acknowledged_internal: "Acknowledged internally",
  handled_internal: "Handled internally",
  not_scheduled: "Not scheduled",
  scheduled: "Scheduled",
  due_today: "Due today",
  overdue: "Overdue",
  completed_internal: "Completed internally",
  available: "Available",
  blocked: "Blocked",
  not_needed: "Not needed",
  read_only: "Read only",
  unknown: "Unknown",
  current: "Current",
  attention: "Needs attention",
  needs_reconciliation: "Needs a source check",
  local_preview: "Unsaved preview",
  exact_current: "Exact current"
});

function stateLabel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return STATE_LABELS[normalized]
    || normalized.replaceAll("_", " ").replace(/\b\w/gu, (letter) => letter.toUpperCase())
    || "Unavailable";
}

function dateTime(value) {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) return "No exact time recorded";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function evidenceDetail(evidence) {
  if (evidence.id === "replied" && Number.isSafeInteger(evidence.messageCount)) {
    return `${evidence.messageCount} ${evidence.messageCount === 1 ? "message" : "messages"} recorded`;
  }
  if (evidence.id === "inferred-engagement" && evidence.claim) return evidence.claim;
  return evidence.evidenceAtISO ? dateTime(evidence.evidenceAtISO) : "No exact event recorded";
}

function availabilityLabel(value) {
  return stateLabel(value);
}

export default function AmbientConversationContext({ model }) {
  const evidence = Array.isArray(model?.evidence) ? model.evidence : [];
  const resolutions = Array.isArray(model?.resolutions) ? model.resolutions : [];
  const dependencies = Array.isArray(model?.dependencies) ? model.dependencies : [];
  const scope = model?.scope;
  const descriptor = model?.descriptor;

  if (!descriptor || !scope || evidence.length !== 5 || resolutions.length === 0) {
    return (
      <section
        className="ambient-conversation-context ambient-conversation-context--unavailable"
        role="alert"
        data-surface-purpose="clarify reveal_context"
      >
        <strong>Conversation details are unavailable</strong>
        <p>Refresh this opportunity before relying on sent, delivered, viewed, replied, or follow-up status.</p>
      </section>
    );
  }

  return (
    <section
      className="ambient-conversation-context"
      aria-label={`${scope.eventName} communication context`}
      data-ambient-intelligent-object="conversation"
      data-conversation-state={model.state}
      data-conversation-source={model.sourceMode}
      data-surface-purpose="clarify advance reveal_context"
    >
      <header className="ambient-conversation-context__intro">
        <div>
          <span className={`ambient-conversation-context__state is-${model.state}`}>
            {stateLabel(model.state)}
          </span>
          <h3>{scope.eventName}</h3>
          <p>{scope.customerName}, {scope.quoteNumber}</p>
        </div>
        <dl className="ambient-conversation-context__scope">
          <div><dt>Quote version</dt><dd>{scope.versionId || "Unavailable"}</dd></div>
          <div><dt>Quote stage</dt><dd>{stateLabel(scope.status)}</dd></div>
        </dl>
      </header>

      <section className="ambient-conversation-context__next" aria-label="What you can do next">
        <span>What you can do next</span>
        <strong>{model.nextResolution.label}</strong>
        <p>{model.nextResolution.reason}</p>
        <small>{model.nextResolution.consequence}</small>
      </section>

      <section className="ambient-conversation-context__evidence" aria-label="Conversation stages">
        <div className="ambient-conversation-context__section-heading">
          <h4>Recorded conversation activity</h4>
          <p>Sent, delivered, viewed, replied, and inferred activity stay separate.</p>
        </div>
        <ol>
          {evidence.map((entry) => (
            <li
              key={entry.id}
              className={`ambient-conversation-context__evidence-row is-${entry.state}`}
              data-conversation-evidence={entry.id}
              data-conversation-evidence-state={entry.state}
            >
              <div className="ambient-conversation-context__evidence-heading">
                <h5>{entry.label}</h5>
                <span className={`ambient-conversation-context__state is-${entry.state}`}>
                  {stateLabel(entry.state)}
                </span>
              </div>
              <strong>{evidenceDetail(entry)}</strong>
              <p>{entry.reason}</p>
              <small>{entry.consequence}</small>
            </li>
          ))}
        </ol>
      </section>

      <section className="ambient-conversation-context__customer-work" aria-label="Customer and follow-up work">
        <article
          className={`ambient-conversation-context__work-item is-${model.changeRequest.state}`}
          data-conversation-work="change-request"
          data-conversation-work-state={model.changeRequest.state}
        >
          <div className="ambient-conversation-context__work-heading">
            <h4>Customer change request</h4>
            <span className={`ambient-conversation-context__state is-${model.changeRequest.state}`}>
              {stateLabel(model.changeRequest.state)}
            </span>
          </div>
          {model.changeRequest.message && (
            <blockquote>
              <p>{model.changeRequest.message}</p>
              {model.changeRequest.messageTruncated && <small>Excerpt shortened for this context.</small>}
            </blockquote>
          )}
          <p>{model.changeRequest.reason}</p>
          <small>{model.changeRequest.consequence}</small>
        </article>

        <article
          className={`ambient-conversation-context__work-item is-${model.followUp.state}`}
          data-conversation-work="follow-up"
          data-conversation-work-state={model.followUp.state}
        >
          <div className="ambient-conversation-context__work-heading">
            <h4>Internal follow-up</h4>
            <span className={`ambient-conversation-context__state is-${model.followUp.state}`}>
              {stateLabel(model.followUp.state)}
            </span>
          </div>
          <dl className="ambient-conversation-context__work-facts">
            <div><dt>Stage</dt><dd>{model.followUp.stage ? stateLabel(model.followUp.stage) : "Not recorded"}</dd></div>
            <div><dt>Due</dt><dd>{model.followUp.dueDate || "Not recorded"}</dd></div>
          </dl>
          <p>{model.followUp.reason}</p>
          <small>{model.followUp.consequence}</small>
        </article>
      </section>

      <section className="ambient-conversation-context__resolutions" aria-label="Available next steps">
        <div className="ambient-conversation-context__section-heading">
          <h4>Where each action leads</h4>
          <p>Opening these details does not send a message or mark anything read.</p>
        </div>
        <ol>
          {resolutions.map((resolution) => (
            <li
              key={resolution.id}
              data-conversation-resolution={resolution.id}
              data-resolution-availability={resolution.availability}
            >
              <div>
                <strong>{resolution.label}</strong>
                <span className={`ambient-conversation-context__state is-${resolution.availability}`}>
                  {availabilityLabel(resolution.availability)}
                </span>
              </div>
              <p>{resolution.reason}</p>
              <small>{resolution.consequence}</small>
            </li>
          ))}
        </ol>
      </section>

      <dl className="ambient-conversation-context__judgment">
        <div>
          <dt>Why this is shown</dt>
          <dd>{descriptor.why}</dd>
        </div>
        <div>
          <dt>What it affects</dt>
          <dd>{descriptor.consequence}</dd>
        </div>
        <div>
          <dt>If you do nothing</dt>
          <dd>{descriptor.doNothing}</dd>
        </div>
        <div>
          <dt>Confidence and source</dt>
          <dd>
            <strong>{stateLabel(descriptor.confidence.level)}</strong>
            <span>{descriptor.confidence.basis}</span>
            <small>{descriptor.provenance[0]?.label}</small>
          </dd>
        </div>
        <div>
          <dt>How current this is</dt>
          <dd>
            <strong>{stateLabel(model.freshness.state)}</strong>
            <span>{model.freshness.reason}</span>
            {model.freshness.observedAt && <small>Observed {dateTime(model.freshness.observedAt)}</small>}
          </dd>
        </div>
      </dl>

      <section className="ambient-conversation-context__dependencies" aria-label="Conversation dependencies">
        <h4>What this connects to</h4>
        <ul>
          {dependencies.map((dependency) => (
            <li key={`${dependency.object.type}:${dependency.object.id}`}>
              <strong>{dependency.object.label}</strong>
              <span>{dependency.consequence}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="ambient-conversation-context__boundary">{model.boundary}</p>
    </section>
  );
}
