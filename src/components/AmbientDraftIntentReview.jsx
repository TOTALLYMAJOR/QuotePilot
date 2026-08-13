import { useEffect, useId, useRef, useState } from "react";
import "./ambientDraftIntentReview.css";

const KIND_PRESENTATION = /* @__PURE__ */ Object.freeze({
  replace_package: /* @__PURE__ */ Object.freeze({
    eyebrow: "Package change awaiting review",
    title: "Review package replacement",
    keepLabel: "Keep saved package",
    keepNoun: "package"
  }),
  replace_menu_item: /* @__PURE__ */ Object.freeze({
    eyebrow: "Menu change awaiting review",
    title: "Review menu replacement",
    keepLabel: "Keep saved menu",
    keepNoun: "menu"
  }),
  reorder_menu: /* @__PURE__ */ Object.freeze({
    eyebrow: "Menu order awaiting review",
    title: "Review menu order",
    keepLabel: "Keep saved order",
    keepNoun: "order"
  })
});

const PENDING_STATUS = /* @__PURE__ */ Object.freeze({
  phase: "pending",
  outcome: "",
  message: "Review the saved value and proposed change. Nothing has changed yet."
});

const STATUS_LABELS = /* @__PURE__ */ Object.freeze({
  pending: "Ready to review",
  applying: "Applying",
  resolved: "Done",
  recovery: "Needs attention"
});

const FRESHNESS_LABELS = /* @__PURE__ */ Object.freeze({
  fresh: "Current",
  current: "Current",
  stale: "Needs refresh",
  unknown: "Not confirmed",
  unavailable: "Unavailable"
});

const RECONCILIATION_LABELS = /* @__PURE__ */ Object.freeze({
  "selection.packageInclusions": "Package inclusions",
  "selection.menuItemsSnapshot": "Saved menu details",
  "selection.menuItemNames": "Menu item names"
});

function text(value) {
  return String(value ?? "").trim();
}

function record(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function reviewContract(intent) {
  const change = record(intent?.draftChange) ? intent.draftChange : null;
  const kind = text(intent?.kind);
  const presentation = KIND_PRESENTATION[kind];
  const valid = Boolean(
    intent?.family === "package_menu"
    && presentation
    && change?.state === "pending_review"
    && change?.authority === "draft_only"
    && change?.commit === false
    && record(change.before)
    && record(change.proposed)
    && record(change.catalogScope)
    && record(change.target)
    && Array.isArray(change.target.trustedReconciliationRequired)
  );
  if (!valid) {
    return {
      valid: false,
      kind,
      change,
      presentation: presentation || {
        eyebrow: "Draft change unavailable",
        title: "Review unavailable",
        keepLabel: "Keep saved value",
        keepNoun: "value"
      },
      applyLabel: "Apply change to draft"
    };
  }
  const proposedName = kind === "replace_package"
    ? text(change.proposed.packageName || change.candidate?.name || change.proposed.packageId)
    : kind === "replace_menu_item"
      ? text(change.candidate?.name || change.proposed.itemId)
      : "proposed order";
  return {
    valid: true,
    kind,
    change,
    presentation,
    applyLabel: `Apply ${proposedName || "change"} to draft`
  };
}

function intentIdentity(intent, contract) {
  if (!contract.valid) return `invalid:${text(intent?.kind)}`;
  const change = contract.change;
  return [
    contract.kind,
    text(change.actionId),
    text(change.catalogScope.organizationId),
    String(change.catalogScope.catalogRevision ?? ""),
    text(change.catalogScope.observedAt),
    JSON.stringify(change.before),
    JSON.stringify(change.proposed)
  ].join("\u0000");
}

function ValueFacts({ value, kind, side, candidate, catalogContext }) {
  if (kind === "replace_package") {
    return (
      <dl className="ambient-draft-review__facts">
        {side === "proposed" && text(value.packageName || candidate?.name) && (
          <div>
            <dt>Name</dt>
            <dd>{text(value.packageName || candidate?.name)}</dd>
          </div>
        )}
        <div>
          <dt>Package ID</dt>
          <dd><code>{text(value.packageId) || "Unavailable"}</code></dd>
        </div>
      </dl>
    );
  }

  if (kind === "replace_menu_item") {
    return (
      <dl className="ambient-draft-review__facts">
        {side === "proposed" && text(candidate?.name) && (
          <div>
            <dt>Name</dt>
            <dd>{text(candidate.name)}</dd>
          </div>
        )}
        <div>
          <dt>Menu item ID</dt>
          <dd><code>{text(value.itemId) || "Unavailable"}</code></dd>
        </div>
        <div>
          <dt>Position</dt>
          <dd>{Number.isSafeInteger(value.orderIndex) ? value.orderIndex + 1 : "Unavailable"}</dd>
        </div>
        <div>
          <dt>Quantity</dt>
          <dd>{Number.isSafeInteger(value.quantity) ? value.quantity : "Unavailable"}</dd>
        </div>
        {side === "proposed" && text(value.quantityPolicy) && (
          <div>
            <dt>Quantity handling</dt>
            <dd><code>{text(value.quantityPolicy)}</code></dd>
          </div>
        )}
      </dl>
    );
  }

  const order = Array.isArray(value.order) ? value.order : [];
  const menuLabels = new Map(
    (Array.isArray(catalogContext?.menuItems) ? catalogContext.menuItems : [])
      .map((item) => [text(item?.id), text(item?.name)])
      .filter(([id, name]) => id && name)
  );
  return order.length ? (
    <ol className="ambient-draft-review__order" aria-label={`${side} menu order`}>
      {order.map((itemId, index) => (
        <li key={`${text(itemId)}-${index}`}>
          <span>{index + 1}</span>
          <div>
            {menuLabels.has(text(itemId)) && <strong>{menuLabels.get(text(itemId))}</strong>}
            <code>{text(itemId)}</code>
          </div>
        </li>
      ))}
    </ol>
  ) : <p className="ambient-draft-review__unavailable">Exact order unavailable.</p>;
}

function rejectionMessage(result) {
  if (result === false) return "This change could not be added to the draft.";
  if (record(result) && result.ok === false) {
    return text(result.reason || result.message) || "This change could not be added to the draft.";
  }
  return "";
}

function freshnessLabel(value) {
  const state = text(value).toLowerCase();
  return FRESHNESS_LABELS[state] || "Not confirmed";
}

function reconciliationLabel(fieldPath) {
  const exact = text(fieldPath);
  if (RECONCILIATION_LABELS[exact]) return RECONCILIATION_LABELS[exact];
  const leaf = exact.split(".").filter(Boolean).at(-1);
  if (!leaf) return "Connected quote details";
  return leaf
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/[_-]+/gu, " ")
    .replace(/^./u, (character) => character.toUpperCase());
}

export default function AmbientDraftIntentReview({
  intent = null,
  catalogContext = null,
  onApply,
  onKeep
}) {
  const titleId = useId();
  const statusId = useId();
  const contract = reviewContract(intent);
  const identity = intentIdentity(intent, contract);
  const [status, setStatus] = useState(() => (
    contract.valid
      ? PENDING_STATUS
      : {
          phase: "recovery",
          outcome: "",
          message: "No current package or menu change is available. Return to the Living Opportunity and choose one again."
        }
  ));
  const inFlightRef = useRef(false);
  const generationRef = useRef(0);

  useEffect(() => {
    generationRef.current += 1;
    inFlightRef.current = false;
    setStatus(contract.valid
      ? PENDING_STATUS
      : {
          phase: "recovery",
          outcome: "",
          message: "No current package or menu change is available. Return to the Living Opportunity and choose one again."
        });
  }, [identity, contract.valid]);

  useEffect(() => () => {
    generationRef.current += 1;
    inFlightRef.current = false;
  }, []);

  const runOutcome = async (outcome) => {
    const handler = outcome === "apply" ? onApply : onKeep;
    if (
      !contract.valid
      || inFlightRef.current
      || status.phase === "applying"
      || status.phase === "resolved"
      || typeof handler !== "function"
    ) return;

    inFlightRef.current = true;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const applyingMessage = outcome === "apply"
      ? `${contract.applyLabel.replace(/ to draft$/u, "")} is being added to the editor draft. The saved quote remains unchanged until you save.`
      : "Keeping the saved value. No proposed change is being applied.";
    setStatus({ phase: "applying", outcome, message: applyingMessage });

    try {
      const result = await handler(intent);
      if (generationRef.current !== generation) return;
      const rejected = rejectionMessage(result);
      if (rejected) {
        setStatus({
          phase: "recovery",
          outcome,
          message: `${rejected} The saved quote was not changed by this review surface. Review the editor draft before retrying.`
        });
        return;
      }
      setStatus({
        phase: "resolved",
        outcome,
        message: outcome === "apply"
          ? "Draft updated. Review the live price and connected effects, then use the named save action. The saved quote has not changed yet."
          : `${contract.presentation.keepLabel.replace(/^Keep /u, "")} kept. No proposed change was applied.`
      });
    } catch (error) {
      if (generationRef.current !== generation) return;
      const detail = text(error?.userMessage || error?.message);
      setStatus({
        phase: "recovery",
        outcome,
        message: `${detail || "QuotePilot could not confirm this change."} The saved quote was not changed by this review surface. Review the editor draft before retrying.`
      });
    } finally {
      if (generationRef.current === generation) inFlightRef.current = false;
    }
  };

  const busy = status.phase === "applying";
  const resolved = status.phase === "resolved";
  const change = contract.change;

  return (
    <section
      className="ambient-draft-review"
      data-ambient-draft-intent-review={contract.valid ? "package_menu" : "unavailable"}
      data-ambient-draft-intent-kind={contract.kind || "unavailable"}
      data-ambient-draft-review-state={status.phase === "pending" ? "pending_review" : status.phase}
      data-review-state={status.phase}
      data-surface-purpose="clarify advance resolve"
      aria-labelledby={titleId}
      aria-describedby={statusId}
      aria-busy={busy ? "true" : "false"}
    >
      <header className="ambient-draft-review__header" data-layout-audit-group="ambient-draft-review-heading">
        <div>
          <p className="ambient-draft-review__eyebrow">{contract.presentation.eyebrow}</p>
          <h2 id={titleId}>{contract.presentation.title}</h2>
        </div>
        <span className="ambient-draft-review__authority">Draft only</span>
      </header>

      {contract.valid ? (
        <>
          <div className="ambient-draft-review__comparison" aria-label="Saved and proposed values">
            <section aria-labelledby={`${titleId}-before`}>
              <p className="ambient-draft-review__section-label" id={`${titleId}-before`}>Saved selection</p>
              <ValueFacts
                value={change.before}
                kind={contract.kind}
                side="before"
                candidate={change.candidate}
                catalogContext={catalogContext}
              />
            </section>
            <section aria-labelledby={`${titleId}-proposed`}>
              <p className="ambient-draft-review__section-label" id={`${titleId}-proposed`}>Proposed change</p>
              <ValueFacts
                value={change.proposed}
                kind={contract.kind}
                side="proposed"
                candidate={change.candidate}
                catalogContext={catalogContext}
              />
            </section>
          </div>

          <div className="ambient-draft-review__evidence">
            <section aria-labelledby={`${titleId}-catalog`}>
              <p className="ambient-draft-review__section-label" id={`${titleId}-catalog`}>Catalog source</p>
              <dl className="ambient-draft-review__facts">
                <div>
                  <dt>Catalog version</dt>
                  <dd>{String(change.catalogScope.catalogRevision)}</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>{text(change.catalogScope.sourceLabel) || "Unavailable"}</dd>
                </div>
                <div>
                  <dt>How current</dt>
                  <dd>{freshnessLabel(change.catalogScope.freshness)}</dd>
                </div>
                <div>
                  <dt>Last checked</dt>
                  <dd><time dateTime={text(change.catalogScope.observedAt)}>{text(change.catalogScope.observedAt) || "Unavailable"}</time></dd>
                </div>
              </dl>
            </section>

            <section aria-labelledby={`${titleId}-reconciliation`}>
              <p className="ambient-draft-review__section-label" id={`${titleId}-reconciliation`}>What QuotePilot will recheck</p>
              <ul className="ambient-draft-review__reconciliation">
                {change.target.trustedReconciliationRequired.map((fieldPath) => (
                  <li key={fieldPath} data-reconciliation-field={fieldPath}>{reconciliationLabel(fieldPath)}</li>
                ))}
              </ul>
            </section>
          </div>

          <div className="ambient-draft-review__boundary">
            <strong>Draft only. Nothing changes until you save.</strong>
            <p>
              Applying stages the editor draft only. It does not save, reprice, update the proposal, or prove operational availability.
            </p>
            {change.consequencePreviewRequired === true && (
              <p>Review the current pricing and staffing effects before saving.</p>
            )}
            {change.requiresOutcomeNamedSave === true && (
              <p>Use the named save action so QuotePilot can recalculate pricing and update connected details.</p>
            )}
          </div>
        </>
      ) : (
        <p className="ambient-draft-review__unavailable">
          Return to the opportunity and choose a package or menu change again.
        </p>
      )}

      <div
        className={`ambient-draft-review__status ambient-draft-review__status--${status.phase}`}
        id={statusId}
        role={status.phase === "recovery" ? "alert" : "status"}
        aria-live={status.phase === "recovery" ? "assertive" : "polite"}
        aria-atomic="true"
      >
        <span>{STATUS_LABELS[status.phase] || "Update"}</span>
        <p>{status.message}</p>
      </div>

      {contract.valid && (
        <div className="ambient-draft-review__actions">
          <button
            type="button"
            className="ambient-draft-review__apply"
            data-draft-review-outcome="apply"
            disabled={busy || resolved || typeof onApply !== "function"}
            onClick={() => runOutcome("apply")}
          >
            {busy && status.outcome === "apply" ? "Applying to draft…" : contract.applyLabel}
          </button>
          <button
            type="button"
            className="ambient-draft-review__keep"
            data-draft-review-outcome="keep"
            disabled={busy || resolved || typeof onKeep !== "function"}
            onClick={() => runOutcome("keep")}
          >
            {busy && status.outcome === "keep" ? "Keeping saved value…" : contract.presentation.keepLabel}
          </button>
        </div>
      )}
    </section>
  );
}
