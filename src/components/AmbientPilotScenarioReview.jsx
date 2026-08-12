import { useEffect, useId, useRef, useState } from "react";
import { PILOT_SCENARIO_DRAFT_REVIEW_MODEL } from "../lib/pilotScenarioDraftReview";
import "./ambientPilotScenarioReview.css";

const FIELD_LABELS = /* @__PURE__ */ Object.freeze({
  pkg: "Package",
  eventTemplateId: "Template ownership",
  addons: "Add-ons",
  addonQuantities: "Add-on quantities",
  rentals: "Rentals",
  rentalQuantities: "Rental quantities",
  menuItems: "Menu items",
  menuItemQuantities: "Menu item quantities",
  servers: "Servers",
  chefs: "Chefs",
  bartenders: "Bartenders"
});

const PENDING = /* @__PURE__ */ Object.freeze({
  phase: "pending",
  outcome: "",
  message: "Review the proposed draft changes. Nothing has changed yet."
});

const STATUS_LABELS = /* @__PURE__ */ Object.freeze({
  pending: "Ready to review",
  applying: "Applying",
  resolved: "Done",
  recovery: "Needs attention"
});

function text(value) {
  return String(value ?? "").trim();
}

function record(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function reviewContract(review) {
  const valid = Boolean(
    record(review)
    && review.modelId === PILOT_SCENARIO_DRAFT_REVIEW_MODEL
    && review.kind === "pilot_scenario_draft_review"
    && review.state === "pending_review"
    && review.commandClass === "simulation"
    && review.authorityLevel === "draft"
    && record(review.organizationScope)
    && record(review.catalogScope)
    && record(review.proposalIdentity)
    && record(review.sourceSnapshot)
    && Array.isArray(review.changedFields)
    && review.changedFields.length > 0
    && Array.isArray(review.changes)
    && review.changes.length === review.changedFields.length
    && Array.isArray(review.compromises)
    && review.compromises.length > 0
    && record(review.judgment)
    && record(review.judgment.confidence)
    && Array.isArray(review.judgment.provenance)
    && record(review.adoption)
    && review.adoption.required === true
    && review.adoption.allowedAfterExplicitConfirmation === true
    && review.adoption.applyLabel === "Apply scenario to draft"
    && review.adoption.keepLabel === "Keep current draft"
  );
  return {
    valid,
    identity: valid
      ? [
          text(review.reviewId),
          text(review.catalogScope.fingerprint),
          text(review.proposalIdentity.fingerprint),
          text(review.sourceSnapshot.fingerprint)
        ].join("\u0000")
      : "invalid-review"
  };
}

function formatMoney(value, currency = "USD") {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "Unavailable";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: text(currency) || "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${text(currency) || "USD"}`;
  }
}

function formatPercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${(number * 100).toFixed(1)}%` : "Unavailable";
}

function Value({ value }) {
  if (Array.isArray(value)) {
    return value.length ? (
      <ol className="ambient-pilot-scenario-review__value-list">
        {value.map((entry, index) => (
          <li key={`${text(entry)}-${index}`}><code>{text(entry)}</code></li>
        ))}
      </ol>
    ) : <span className="ambient-pilot-scenario-review__empty-value">None</span>;
  }
  if (record(value)) {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return entries.length ? (
      <dl className="ambient-pilot-scenario-review__value-map">
        {entries.map(([key, entry]) => (
          <div key={key}>
            <dt><code>{key}</code></dt>
            <dd><code>{text(entry)}</code></dd>
          </div>
        ))}
      </dl>
    ) : <span className="ambient-pilot-scenario-review__empty-value">None</span>;
  }
  if (value === null) return <code>null</code>;
  if (typeof value === "boolean") return <code>{value ? "true" : "false"}</code>;
  return <code>{text(value)}</code>;
}

function BeforeValue({ snapshot }) {
  if (!snapshot?.present || snapshot?.encoding === "missing") {
    return <span className="ambient-pilot-scenario-review__empty-value">Not present</span>;
  }
  if (snapshot.encoding === "undefined") {
    return <span className="ambient-pilot-scenario-review__empty-value">Unset</span>;
  }
  return <Value value={snapshot.value} />;
}

function ChangeComparison({ change, titleId }) {
  const field = text(change?.field);
  const label = FIELD_LABELS[field] || field || "Draft field";
  return (
    <article
      className="ambient-pilot-scenario-review__change"
      data-pilot-scenario-change-field={field || "unavailable"}
      aria-labelledby={`${titleId}-${field}`}
    >
      <header>
        <h3 id={`${titleId}-${field}`}>{label}</h3>
        <code>{field}</code>
      </header>
      <div className="ambient-pilot-scenario-review__change-grid">
        <section aria-label={`Current ${label}`}>
          <span>Current draft</span>
          <BeforeValue snapshot={change.before} />
        </section>
        <section aria-label={`Proposed ${label}`}>
          <span>Proposed draft</span>
          <Value value={change.after} />
        </section>
      </div>
    </article>
  );
}

function Provenance({ entries }) {
  return (
    <ul className="ambient-pilot-scenario-review__provenance">
      {entries.map((entry, index) => (
        <li key={`${text(entry?.source) || "source"}-${index}`}>
          <strong>{text(entry?.source) || "Unnamed source"}</strong>
          <dl>
            {Object.entries(entry || {})
              .filter(([key]) => key !== "source")
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{key === "observedAtISO" ? (
                    <time dateTime={text(value)}>{text(value)}</time>
                  ) : text(value)}</dd>
                </div>
              ))}
          </dl>
        </li>
      ))}
    </ul>
  );
}

function resultRejection(result) {
  if (result === false) return "The editor declined this scenario.";
  if (!record(result) || result.ok !== false) return "";
  return text(
    result.acknowledgement?.reason
    || result.reason
    || result.message
  ) || "The editor declined this scenario.";
}

export default function AmbientPilotScenarioReview({
  review = null,
  onApply,
  onKeep
}) {
  const titleId = useId();
  const statusId = useId();
  const applyRef = useRef(null);
  const statusRef = useRef(null);
  const statusPhaseRef = useRef("");
  const inFlightRef = useRef(false);
  const generationRef = useRef(0);
  const contract = reviewContract(review);
  const [status, setStatus] = useState(() => contract.valid ? PENDING : ({
    phase: "recovery",
    outcome: "",
    message: "This option is no longer current. Run it again from the latest opportunity details."
  }));
  statusPhaseRef.current = status.phase;

  useEffect(() => {
    generationRef.current += 1;
    inFlightRef.current = false;
    setStatus(contract.valid ? PENDING : ({
      phase: "recovery",
      outcome: "",
      message: "This option is no longer current. Run it again from the latest opportunity details."
    }));
  }, [contract.identity, contract.valid]);

  useEffect(() => () => {
    generationRef.current += 1;
    inFlightRef.current = false;
  }, []);

  useEffect(() => {
    if (!contract.valid || status.phase !== "pending") return undefined;

    const focusPrimaryResolution = () => {
      if (statusPhaseRef.current !== "pending") return;
      const action = applyRef.current;
      if (!action) return;
      action.scrollIntoView?.({ behavior: "smooth", block: "center", inline: "nearest" });
      action.focus({ preventScroll: true });
    };

    if (typeof window?.requestAnimationFrame === "function") {
      const frame = window.requestAnimationFrame(focusPrimaryResolution);
      return () => window.cancelAnimationFrame?.(frame);
    }

    const timer = window.setTimeout(focusPrimaryResolution, 0);
    return () => window.clearTimeout(timer);
  }, [contract.identity, contract.valid, status.phase]);

  useEffect(() => {
    if (["resolved", "recovery"].includes(status.phase)) statusRef.current?.focus();
  }, [status.phase]);

  const runOutcome = async (outcome) => {
    if (
      !contract.valid
      || inFlightRef.current
      || status.phase === "applying"
      || status.phase === "resolved"
      || (outcome === "apply" && typeof onApply !== "function")
    ) return;

    inFlightRef.current = true;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setStatus({
      phase: "applying",
      outcome,
      message: outcome === "apply"
        ? "Adding this reviewed option to your draft. The saved quote remains unchanged."
        : "Keeping your current draft. Nothing from this option is being added."
    });

    try {
      const handler = outcome === "apply" ? onApply : onKeep;
      const result = typeof handler === "function" ? await handler(review) : { ok: true };
      if (generationRef.current !== generation) return;
      const rejection = resultRejection(result);
      if (rejection) {
        setStatus({
          phase: "recovery",
          outcome,
          message: `${rejection} The current draft and saved quote were not changed by this review surface.`
        });
        return;
      }
      const consequence = text(result?.acknowledgement?.consequence);
      setStatus({
        phase: "resolved",
        outcome,
        message: outcome === "apply"
          ? [
              "The reviewed option is now in your draft.",
              consequence || "Review the recalculated price and effects before you save."
            ].join(" ")
          : "Current draft kept. No scenario field was applied, saved, sent, or published."
      });
    } catch (error) {
      if (generationRef.current !== generation) return;
      setStatus({
        phase: "recovery",
        outcome,
        message: `${text(error?.userMessage || error?.message) || "QuotePilot could not confirm this option."} The current draft and saved quote were not changed by this review surface.`
      });
    } finally {
      if (generationRef.current === generation) inFlightRef.current = false;
    }
  };

  const busy = status.phase === "applying";
  const resolved = status.phase === "resolved";
  const previewCurrency = text(review?.clientPreview?.before?.currency) || "USD";
  const marginBefore = review?.marginEvidence?.before;
  const marginAfter = review?.marginEvidence?.after;

  return (
    <section
      className="ambient-pilot-scenario-review"
      data-ambient-pilot-scenario-review={contract.valid ? "available" : "unavailable"}
      data-review-state={status.phase}
      data-surface-purpose="clarify simulate resolve"
      aria-labelledby={titleId}
      aria-describedby={statusId}
      aria-busy={busy ? "true" : "false"}
    >
      <header className="ambient-pilot-scenario-review__header">
        <div>
          <p>Pilot option review</p>
          <h2 id={titleId}>{contract.valid ? review.title : "Option review unavailable"}</h2>
          {contract.valid && <span>{review.summary}</span>}
        </div>
        <strong>Draft only</strong>
      </header>

      {contract.valid ? (
        <>
          <section className="ambient-pilot-scenario-review__changes" aria-labelledby={`${titleId}-changes`}>
            <h3 id={`${titleId}-changes`}>Proposed changes</h3>
            {review.changes.map((change) => (
              <ChangeComparison key={change.field} change={change} titleId={titleId} />
            ))}
          </section>

          <section className="ambient-pilot-scenario-review__commercial" aria-labelledby={`${titleId}-preview`}>
            <h3 id={`${titleId}-preview`}>Price preview</h3>
            <dl>
              <div>
                <dt>Total before</dt>
                <dd>{formatMoney(review.clientPreview?.before?.total, previewCurrency)}</dd>
              </div>
              <div>
                <dt>Total after</dt>
                <dd>{formatMoney(review.clientPreview?.after?.total, previewCurrency)}</dd>
              </div>
              <div>
                <dt>Total change</dt>
                <dd>{formatMoney(review.clientPreview?.delta?.total, previewCurrency)}</dd>
              </div>
              <div>
                <dt>Deposit change</dt>
                <dd>{formatMoney(review.clientPreview?.delta?.deposit, previewCurrency)}</dd>
              </div>
              {marginBefore?.available === true && marginAfter?.available === true && (
                <>
                  <div>
                    <dt>Margin before</dt>
                    <dd>{formatPercent(marginBefore.marginPct)}</dd>
                  </div>
                  <div>
                    <dt>Margin after</dt>
                    <dd>{formatPercent(marginAfter.marginPct)}</dd>
                  </div>
                </>
              )}
            </dl>
            <p>This is a preview. QuotePilot recalculates the final price when you save.</p>
          </section>

          <section className="ambient-pilot-scenario-review__compromises" aria-labelledby={`${titleId}-compromises`}>
            <h3 id={`${titleId}-compromises`}>What this option changes</h3>
            <ol>
              {review.compromises.map((compromise, index) => (
                <li key={`${compromise.dimension}-${index}`}>
                  <div>
                    <strong>{compromise.label}</strong>
                    <span>{compromise.before} to {compromise.after}</span>
                  </div>
                  <p>{compromise.why}</p>
                </li>
              ))}
            </ol>
          </section>

          <section className="ambient-pilot-scenario-review__judgment" aria-labelledby={`${titleId}-judgment`}>
            <h3 id={`${titleId}-judgment`}>Why this is recommended</h3>
            <dl>
              <div>
                <dt>Why this scenario</dt>
                <dd>{review.judgment.why}</dd>
              </div>
              <div>
                <dt>What this affects</dt>
                <dd>{review.judgment.consequence}</dd>
              </div>
              <div>
                <dt>If you do nothing</dt>
                <dd>{review.judgment.doNothing}</dd>
              </div>
              <div>
                <dt>Confidence: {review.judgment.confidence.level}</dt>
                <dd>{review.judgment.confidence.basis}</dd>
              </div>
            </dl>
          </section>

          <section className="ambient-pilot-scenario-review__sources" aria-labelledby={`${titleId}-sources`}>
            <h3 id={`${titleId}-sources`}>Confidence and sources</h3>
            <Provenance entries={review.judgment.provenance} />
            <details>
              <summary>Technical details</summary>
              <dl>
                <div>
                  <dt>Organization</dt>
                  <dd><code>{review.organizationScope.organizationId}</code></dd>
                </div>
                <div>
                  <dt>Catalog source</dt>
                  <dd><code>{review.catalogScope.sourceLabel}</code></dd>
                </div>
                <div>
                  <dt>Catalog revision</dt>
                  <dd>{review.catalogScope.catalogRevision}</dd>
                </div>
                <div>
                  <dt>Observed</dt>
                  <dd><time dateTime={review.catalogScope.observedAt}>{review.catalogScope.observedAt}</time></dd>
                </div>
                <div>
                  <dt>Catalog fingerprint</dt>
                  <dd><code>{review.catalogScope.fingerprint}</code></dd>
                </div>
                <div>
                  <dt>Proposal fingerprint</dt>
                  <dd><code>{review.proposalIdentity.fingerprint}</code></dd>
                </div>
                <div>
                  <dt>Draft snapshot fingerprint</dt>
                  <dd><code>{review.sourceSnapshot.fingerprint}</code></dd>
                </div>
              </dl>
            </details>
          </section>

          <div className="ambient-pilot-scenario-review__boundary">
            <strong>Draft only. Nothing is saved yet.</strong>
            <p>{review.boundary}</p>
          </div>
        </>
      ) : (
        <p className="ambient-pilot-scenario-review__unavailable">
          This option cannot be reviewed. Return to Pilot and create a new one.
        </p>
      )}

      <div
        ref={statusRef}
        className={`ambient-pilot-scenario-review__status ambient-pilot-scenario-review__status--${status.phase}`}
        id={statusId}
        role={status.phase === "recovery" ? "alert" : "status"}
        aria-live={status.phase === "recovery" ? "assertive" : "polite"}
        aria-atomic="true"
        tabIndex="-1"
      >
        <strong>{STATUS_LABELS[status.phase] || "Update"}</strong>
        <p>{status.message}</p>
      </div>

      {contract.valid && (
        <div className="ambient-pilot-scenario-review__actions" aria-label="Option review choices">
          <button
            ref={applyRef}
            type="button"
            className="ambient-pilot-scenario-review__apply"
            data-pilot-scenario-review-action="apply"
            disabled={busy || resolved || typeof onApply !== "function"}
            onClick={() => runOutcome("apply")}
          >
            {busy && status.outcome === "apply" ? "Applying scenario…" : review.adoption.applyLabel}
          </button>
          <button
            type="button"
            className="ambient-pilot-scenario-review__keep"
            data-pilot-scenario-review-action="keep"
            disabled={busy || resolved}
            onClick={() => runOutcome("keep")}
          >
            {busy && status.outcome === "keep" ? "Keeping current draft…" : review.adoption.keepLabel}
          </button>
        </div>
      )}
    </section>
  );
}
