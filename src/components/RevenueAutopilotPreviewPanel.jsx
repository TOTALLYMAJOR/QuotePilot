import StatusChip from "./StatusChip";

const STATE_PRESENTATION = Object.freeze({
  loading: { family: "pending", label: "Loading preview" },
  empty: { family: "info", label: "No quote selected" },
  success: { family: "confirmed", label: "Preview current" },
  partial: { family: "action", label: "Partial preview" },
  error: { family: "failed", label: "Preview unavailable" },
  stale: { family: "action", label: "Retained preview" }
});

const EVALUATION_PRESENTATION = Object.freeze({
  eligible: { family: "action", label: "Review eligible" },
  stopped: { family: "confirmed", label: "Stopped" },
  blocked: { family: "blocked", label: "Blocked" },
  not_due: { family: "info", label: "Not due" }
});

export const REVENUE_AUTOPILOT_SAFETY_GATES = Object.freeze([
  Object.freeze({
    id: "tenant_quote_scope",
    label: "Tenant and quote scope",
    detail: "Evidence must resolve to the same organization and authoritative quote."
  }),
  Object.freeze({
    id: "tenant_calendar_date",
    label: "Current tenant-calendar evidence",
    detail: "Date-bound observations must match the explicit tenant date and IANA time zone."
  }),
  Object.freeze({
    id: "portal_revision",
    label: "Portal revision and lifecycle",
    detail: "View, acceptance, decline, and booking stops require the exact active portal revision."
  }),
  Object.freeze({
    id: "acceptance_receipt",
    label: "Acceptance receipt",
    detail: "Deposit and final-balance eligibility require matching accepted-revision evidence."
  }),
  Object.freeze({
    id: "verified_deposit_webhook",
    label: "Verified deposit webhook",
    detail: "A browser return never establishes paid or refunded state."
  }),
  Object.freeze({
    id: "canonical_payment_rail",
    label: "Canonical final-balance rail",
    detail: "Settlement must match one unambiguous stored payment rail."
  }),
  Object.freeze({
    id: "conversation_read_state",
    label: "Quote conversation read state",
    detail: "Escalation requires the exact latest customer message and staff read evidence."
  }),
  Object.freeze({
    id: "email_consent",
    label: "Email consent",
    detail: "Recorded, channel-specific consent must be current and granted."
  }),
  Object.freeze({
    id: "unsubscribe",
    label: "Unsubscribe status",
    detail: "A current unsubscribe check must show the recipient is subscribed."
  }),
  Object.freeze({
    id: "suppression",
    label: "Suppression status",
    detail: "A current suppression check must show the recipient is clear."
  }),
  Object.freeze({
    id: "quiet_hours",
    label: "Quiet hours",
    detail: "The current tenant-time-zone policy must permit outbound contact."
  }),
  Object.freeze({
    id: "tenant_template",
    label: "Tenant-branded template",
    detail: "The applicable email template identity and version must be active."
  }),
  Object.freeze({
    id: "provider_configuration",
    label: "Provider configuration",
    detail: "A current tenant-scoped email provider configuration must be present."
  }),
  Object.freeze({
    id: "job_identity",
    label: "Stable preview job identity",
    detail: "Each result carries a deterministic descriptor without claiming or persisting it."
  }),
  Object.freeze({
    id: "non_sending_mode",
    label: "Non-sending execution boundary",
    detail: "This surface cannot send, write, schedule, or claim idempotency."
  })
]);

function text(value) {
  return String(value ?? "").trim();
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function previewIsSafe(preview) {
  return (
    isRecord(preview)
    && text(preview.mode).toLowerCase() === "read_only_preview"
    && Array.isArray(preview.evaluations)
    && Array.isArray(preview.proofBoundaries)
    && preview?.sideEffects?.sends === false
    && preview?.sideEffects?.writes === false
    && preview?.sideEffects?.schedules === false
    && preview?.sideEffects?.idempotencyClaims === false
  );
}

function isBoundedPartial(preview) {
  const evaluations = Array.isArray(preview?.evaluations) ? preview.evaluations : [];
  const expected = Number(preview?.bounds?.evaluationCount);
  const maximum = Number(preview?.bounds?.maximumEvaluationCount);
  return (
    !Number.isSafeInteger(expected)
    || !Number.isSafeInteger(maximum)
    || expected < 0
    || maximum < expected
    || evaluations.length !== expected
  );
}

export function buildRevenueAutopilotPanelState({
  preview = null,
  loading = false,
  error = "",
  stale = false,
  partial = false
} = {}) {
  const suppliedSnapshot = isRecord(preview);
  const safeSnapshot = previewIsSafe(preview);
  let state = "success";
  let readState = "success";

  if (loading && !suppliedSnapshot) state = "loading";
  else if ((text(error) || suppliedSnapshot) && !safeSnapshot) state = "error";
  else if (!suppliedSnapshot) state = "empty";
  else if (stale || text(error)) state = "stale";
  else if (partial || isBoundedPartial(preview)) state = "partial";
  else if (loading) readState = "refreshing";

  if (readState !== "refreshing") readState = state;
  const detail = {
    loading: "Reading current tenant-scoped evidence. No messages are scheduled or sent while this preview loads.",
    empty: "Open an authoritative quote to evaluate follow-ups, payment reminders, and unread-reply escalation. No messages are scheduled or sent.",
    success: "The deterministic preview completed. Eligibility means ready for staff review, not scheduled or sent.",
    partial: "The preview is bounded or incomplete. Missing evaluations must be treated as blocked; no messages are scheduled or sent.",
    error: "A safe read-only preview is unavailable. No messages were scheduled or sent.",
    stale: "The latest read did not complete. The retained preview may be stale and no messages are scheduled or sent."
  }[state];

  return {
    state,
    readState,
    detail,
    snapshotAvailable: safeSnapshot,
    presentation: STATE_PRESENTATION[state]
  };
}

function evaluationPresentation(state) {
  return EVALUATION_PRESENTATION[text(state).toLowerCase()]
    || { family: "failed", label: "Unverified" };
}

function countLabel(counts = {}) {
  const entries = ["eligible", "blocked", "stopped", "not_due"]
    .map((state) => [state, Number(counts?.[state] || 0)])
    .filter(([, count]) => Number.isSafeInteger(count) && count > 0);
  if (!entries.length) return "No classified results";
  return entries
    .map(([state, count]) => `${count} ${state.replace("_", " ")}`)
    .join(" · ");
}

function boundsLabel(bounds = {}) {
  const quoteCount = Number(bounds.quoteCount);
  const evaluationCount = Number(bounds.evaluationCount);
  const maximum = Number(bounds.maximumEvaluationCount);
  const safeQuoteCount = Number.isSafeInteger(quoteCount) ? quoteCount : 0;
  const safeEvaluationCount = Number.isSafeInteger(evaluationCount) ? evaluationCount : 0;
  const safeMaximum = Number.isSafeInteger(maximum) ? maximum : 0;
  return `${safeQuoteCount} quote · ${safeEvaluationCount} evaluations · hard maximum ${safeMaximum}`;
}

function EvaluationCard({ evaluation }) {
  const reasons = Array.isArray(evaluation?.reasons) ? evaluation.reasons : [];
  const presentation = evaluationPresentation(evaluation?.state);
  const identity = text(evaluation?.job?.identity);
  const claimState = text(evaluation?.job?.idempotency?.claimState) || "unavailable";
  const persisted = evaluation?.job?.idempotency?.persisted === true ? "persisted" : "not persisted";

  return (
    <article
      className="customer-revenue-opportunity"
      data-automation-kind={text(evaluation?.kind) || "unidentified"}
      data-automation-state={text(evaluation?.state) || "unverified"}
    >
      <div>
        <span className="customer-revenue-opportunity-type">Deterministic check</span>
        <h3>{text(evaluation?.label) || "Unnamed eligibility check"}</h3>
        <p>{text(evaluation?.summary) || "Eligibility was not established."}</p>
        {Number.isFinite(evaluation?.daysUntilEvent) && (
          <p className="source-note">
            Window: {text(evaluation?.window) || "outside configured windows"} · {evaluation.daysUntilEvent} tenant-calendar days until event.
          </p>
        )}
        <ul aria-label={`${text(evaluation?.label) || "Eligibility"} reasons`}>
          {reasons.length > 0 ? reasons.map((item, index) => (
            <li key={`${text(item?.code) || "reason"}-${index}`} data-reason-code={text(item?.code) || "unidentified"}>
              <strong>{text(item?.code) || "Reason unavailable"}:</strong> {text(item?.message) || "No explanation was supplied; treat this result as blocked."}
            </li>
          )) : (
            <li data-reason-code="reason_missing">No reason was supplied; treat this result as blocked.</li>
          )}
        </ul>
        <p className="source-note" data-job-claim-state={claimState}>
          Preview job identity: <code>{identity || "Unavailable"}</code>. Idempotency claim: {claimState}; {persisted}.
        </p>
      </div>
      <StatusChip {...presentation} />
    </article>
  );
}

function SafetyGateList() {
  return (
    <section className="workflow-form-section" aria-labelledby="revenue-autopilot-safety-title">
      <h3 id="revenue-autopilot-safety-title">Safety gates</h3>
      <p className="source-note">Every applicable gate is required. Individual outcomes are explained on each evaluation below.</p>
      <ul className="command-center-list">
        {REVENUE_AUTOPILOT_SAFETY_GATES.map((gate) => (
          <li className="command-center-row" key={gate.id} data-safety-gate={gate.id}>
            <div className="command-center-row-main">
              <strong>{gate.label}</strong>
              <p className="command-center-row-detail">{gate.detail}</p>
            </div>
            <span className="customer-revenue-opportunity-type">Required</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function RevenueAutopilotPreviewPanel({
  preview = null,
  loading = false,
  error = "",
  stale = false,
  partial = false,
  onOpenQuote
}) {
  const view = buildRevenueAutopilotPanelState({ preview, loading, error, stale, partial });
  const evaluations = view.snapshotAvailable ? preview.evaluations : [];
  const stateRole = ["error", "stale"].includes(view.state) ? "alert" : "status";

  return (
    <section
      className={`customer-relationship-briefing customer-revenue-opportunities staff-evidence-${view.state}`}
      aria-labelledby="revenue-autopilot-preview-title"
      aria-busy={loading}
      data-capability-id="cwf-12-revenue-autopilot-preview"
      data-capability-state={view.state}
      data-read-state={view.readState}
      data-automation-mode="read-only-preview"
    >
      <div className="workspace-route-head">
        <div>
          <p className="eyebrow">Commercial recovery · preview only</p>
          <h2 id="revenue-autopilot-preview-title">Revenue autopilot</h2>
          <p className="muted">Deterministic follow-up and payment-reminder eligibility for one authoritative quote.</p>
        </div>
        <div className="right-actions">
          <StatusChip {...view.presentation} />
          {view.snapshotAvailable && typeof onOpenQuote === "function" && text(preview.quoteId) && (
            <button
              type="button"
              className="ghost compact"
              data-capability-action="open-authoritative-quote"
              onClick={() => onOpenQuote(preview.quoteId)}
            >
              Open quote
            </button>
          )}
        </div>
      </div>

      <div className="staff-evidence-rail staff-evidence-current" data-automation-side-effects="disabled">
        <div className="staff-evidence-head">
          <div>
            <p className="eyebrow">Execution boundary</p>
            <h3>0 messages scheduled · 0 messages sent</h3>
          </div>
          <StatusChip family="confirmed" label="Non-sending" />
        </div>
        <p className="staff-evidence-caveat">
          This panel is read-only. It cannot write records, claim idempotency, schedule work, or contact a customer.
        </p>
      </div>

      <p className={view.state === "success" ? "source-note" : "warning-note"} role={stateRole} aria-live="polite" aria-atomic="true">
        {view.detail}
      </p>

      {view.snapshotAvailable && (
        <>
          <dl className="staff-evidence-details">
            <div>
              <dt>Tenant date</dt>
              <dd>{text(preview.calendarContext?.date) || "Unavailable"}</dd>
            </div>
            <div>
              <dt>Time zone</dt>
              <dd>{text(preview.calendarContext?.timeZone) || "Unavailable"}<small>{text(preview.calendarContext?.label) || "Tenant calendar context"}</small></dd>
            </div>
            <div>
              <dt>Quote scope</dt>
              <dd>{text(preview.quoteId) || "Unavailable"}<small>One authoritative quote</small></dd>
            </div>
            <div>
              <dt>Evaluation bounds</dt>
              <dd>{boundsLabel(preview.bounds)}</dd>
            </div>
            <div>
              <dt>Result mix</dt>
              <dd>{countLabel(preview.counts)}</dd>
            </div>
          </dl>

          {view.state === "partial" && (
            <p className="staff-evidence-bounds-note" data-preview-boundary="partial">
              This is not a complete eligibility set. Omitted or malformed evaluations remain blocked.
            </p>
          )}

          <div className="workflow-form-grid">
            <SafetyGateList />
            <section className="workflow-form-section" aria-labelledby="revenue-autopilot-proof-title">
              <h3 id="revenue-autopilot-proof-title">Proof boundaries</h3>
              <ul className="command-center-list">
                {preview.proofBoundaries.map((boundary, index) => (
                  <li className="command-center-row" key={`${text(boundary) || "boundary"}-${index}`} data-proof-boundary={index + 1}>
                    <p className="command-center-row-detail">{text(boundary) || "Boundary unavailable."}</p>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <section aria-labelledby="revenue-autopilot-evaluations-title">
            <div className="workspace-route-head">
              <div>
                <h3 id="revenue-autopilot-evaluations-title">Eligibility evaluations</h3>
                <p className="muted">Every reason is shown; no eligible result is an instruction to send.</p>
              </div>
            </div>
            {evaluations.length > 0 ? (
              <div className="customer-card-list">
                {evaluations.map((evaluation, index) => (
                  <EvaluationCard key={`${text(evaluation?.kind) || "evaluation"}-${index}`} evaluation={evaluation} />
                ))}
              </div>
            ) : (
              <p className="warning-note">No bounded evaluations were supplied. Treat all automation as blocked.</p>
            )}
          </section>
        </>
      )}
    </section>
  );
}
