import { useEffect, useMemo, useState } from "react";
import StatusChip from "./StatusChip";
import {
  getPostEventProfitReview,
  isDefinitiveEventProfitReviewError,
  readPendingEventProfitReviewAttempt,
  recordPostEventProfitReview,
  resetDefinitiveEventProfitReviewAttempt
} from "../lib/postEventProfitReviewClient";
import { formatWorkspaceDateTime, formatWorkspaceMoney } from "../lib/workspacePresentation";

const REVENUE_FIELDS = [
  ["grossRevenueCents", "Gross event revenue"],
  ["discountsCents", "Discounts"],
  ["refundsCreditsCents", "Refunds and credits"]
];
const COST_FIELDS = [
  ["foodCents", "Food"],
  ["laborCents", "Labor"],
  ["deliverySetupCents", "Delivery and setup"],
  ["rentalsVendorsCents", "Rentals and vendors"],
  ["packagingSuppliesCents", "Packaging and supplies"],
  ["paymentFeesCents", "Payment fees"],
  ["otherDirectCents", "Other direct costs"],
  ["allocatedOverheadCents", "Allocated overhead (optional)"]
];
const LOSS_FIELDS = [
  ["foodWasteCents", "Food waste (subset)"],
  ["overtimePremiumCents", "Overtime premium (subset)"],
  ["serviceRecoveryCents", "Service recovery (subset)"]
];
const REQUIRED_FIELDS = new Set([...REVENUE_FIELDS, ...COST_FIELDS.slice(0, -1)].map(([field]) => field));
const EMPTY_FORM = Object.freeze({ actuals: {}, lossSignals: {}, confirmedZeroFields: [], comparisonBasisConfirmed: false, targetMargin: "", notes: "" });

const text = (value) => String(value ?? "").trim();
const centsToInput = (value) => Number.isInteger(value) ? (value / 100).toFixed(2) : "";

function inputToCents(value) {
  if (text(value) === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) : NaN;
}

function formFromReview(review = {}) {
  return {
    actuals: Object.fromEntries([...REVENUE_FIELDS, ...COST_FIELDS].map(([field]) => [
      field, centsToInput(review.actuals?.[field])
    ])),
    lossSignals: Object.fromEntries(LOSS_FIELDS.map(([field]) => [
      field, centsToInput(review.lossSignals?.[field])
    ])),
    confirmedZeroFields: Array.isArray(review.confirmedZeroFields) ? review.confirmedZeroFields : [],
    comparisonBasisConfirmed: review.comparisonBasisConfirmed === true,
    targetMargin: Number.isInteger(review.targetMarginBps) ? String(review.targetMarginBps / 100) : "",
    notes: text(review.notes)
  };
}

function money(cents) {
  return Number.isInteger(cents) ? formatWorkspaceMoney(cents / 100) : "Unavailable";
}

function ProfitSummary({ review }) {
  const summary = review?.summary;
  if (review?.state !== "final" || !summary) return null;
  const comparison = summary.comparison || {};
  return (
    <div className="event-profit-review-summary" data-profit-review-state="final">
      <div className="event-profit-review-primary">
        <span>Event contribution</span>
        <strong>{money(summary.contributionCents)}</strong>
        <small>{Number.isInteger(summary.contributionMarginBps) ? `${(summary.contributionMarginBps / 100).toFixed(1)}% contribution margin` : "Margin unavailable because net revenue is zero."}</small>
      </div>
      <dl className="event-profit-review-facts">
        <div><dt>Quote comparison</dt><dd>{comparison.available ? `${money(comparison.contributionVarianceCents)} vs estimate` : "Unavailable — bases are incomplete or not comparable"}</dd></div>
        <div><dt>Largest variance driver</dt><dd>{comparison.available ? `${comparison.largestVarianceDriver?.label}: ${money(comparison.largestVarianceDriver?.impactCents)}` : "Unavailable without a comparable estimate"}</dd></div>
        <div><dt>Advisory next-event price</dt><dd>{money(summary.advisoryNextEventPriceCents)}</dd></div>
      </dl>
      <p className="source-note">Next action: review the advisory price through QuotePilot’s existing governed quote review and save path. No catalog or quote was repriced automatically.</p>
      <details>
        <summary>Revenue and cost detail</summary>
        <dl className="event-profit-review-facts">
          <div><dt>Net event revenue</dt><dd>{money(summary.netEventRevenueCents)}</dd></div>
          <div><dt>Direct costs</dt><dd>{money(summary.directCostCents)}</dd></div>
          {summary.overheadRecorded && <div><dt>Profit after allocated overhead</dt><dd>{money(summary.profitAfterAllocatedOverheadCents)}</dd></div>}
        </dl>
      </details>
    </div>
  );
}

function MoneyField({ field, label, group, value, confirmed, disabled, onChange, onConfirm }) {
  const isZero = text(value) !== "" && Number(value) === 0;
  return (
    <div className="event-profit-review-field">
      <label htmlFor={`profit-${field}`}>{label}</label>
      <div className="money-input"><span aria-hidden="true">$</span><input id={`profit-${field}`} inputMode="decimal" min="0" step="0.01" value={value ?? ""} disabled={disabled} onChange={(event) => onChange(group, field, event.target.value)} /></div>
      {isZero && group === "actuals" && (
        <label className="event-profit-zero-confirm"><input type="checkbox" checked={confirmed} disabled={disabled} onChange={(event) => onConfirm(field, event.target.checked)} /> Confirm that $0 is recorded evidence, not missing data</label>
      )}
    </div>
  );
}

export default function PostEventProfitReview({
  opportunity,
  enabled = false,
  isAdmin = false,
  onReceipt
}) {
  const projection = opportunity?.profitReview || {};
  const ids = useMemo(() => ({
    organizationId: opportunity?.organizationId,
    quoteId: opportunity?.quoteId,
    closeoutId: opportunity?.reviewedAction?.closeoutId
  }), [opportunity]);
  const [review, setReview] = useState(projection);
  const [form, setForm] = useState(EMPTY_FORM);
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState({ state: "ready", message: "", action: "" });
  const busy = ["loading", "submitting", "reconciling"].includes(status.state);

  useEffect(() => {
    setReview(projection);
    if (!enabled || !isAdmin || !text(ids.closeoutId)) return undefined;
    let current = true;
    setStatus({ state: "loading", message: "Loading the callable-owned profit review.", action: "" });
    getPostEventProfitReview(ids).then((result) => {
      if (!current) return;
      setReview(result.profitReview);
      setForm(formFromReview(result.profitReview));
      setStatus({ state: "ready", message: "", action: "" });
    }).catch((error) => {
      if (current) setStatus({ state: "error", message: error?.message || "Profit review detail could not be loaded.", action: "" });
    });
    return () => { current = false; };
  }, [enabled, ids, isAdmin, projection]);

  if (!enabled || !text(ids.closeoutId)) return null;

  const updateValue = (group, field, value) => setForm((current) => ({
    ...current,
    [group]: { ...current[group], [field]: value },
    confirmedZeroFields: Number(value) === 0
      ? current.confirmedZeroFields
      : current.confirmedZeroFields.filter((item) => item !== field)
  }));
  const confirmZero = (field, checked) => setForm((current) => ({
    ...current,
    confirmedZeroFields: checked
      ? [...new Set([...current.confirmedZeroFields, field])]
      : current.confirmedZeroFields.filter((item) => item !== field)
  }));

  const payload = (action) => ({
    ...ids,
    action,
    expectedReviewRevision: Number(review.reviewRevision || 0),
    actuals: Object.fromEntries([...REVENUE_FIELDS, ...COST_FIELDS].map(([field]) => [field, inputToCents(form.actuals[field])])),
    lossSignals: Object.fromEntries(LOSS_FIELDS.map(([field]) => [field, inputToCents(form.lossSignals[field])])),
    confirmedZeroFields: form.confirmedZeroFields,
    comparisonBasisConfirmed: form.comparisonBasisConfirmed,
    targetMarginBps: text(form.targetMargin) === "" ? null : Math.round(Number(form.targetMargin) * 100),
    notes: form.notes
  });

  const run = async (action, reconcile = false) => {
    const base = payload(action);
    const pending = readPendingEventProfitReviewAttempt(base);
    const input = pending || base;
    setStatus({ state: reconcile || pending ? "reconciling" : "submitting", message: "Waiting for the exact server receipt.", action });
    try {
      const result = await recordPostEventProfitReview(input);
      setReview(result.profitReview);
      setForm(formFromReview(result.profitReview));
      setStatus({ state: "success", message: action === "finalize" ? "Profit review finalized." : action === "reopen" ? "Profit review reopened as a draft." : "Draft saved.", action: "" });
      onReceipt?.(result);
    } catch (error) {
      setStatus({ state: isDefinitiveEventProfitReviewError(error) ? "error" : "uncertain", message: error?.message || "No server receipt returned.", action });
    }
  };

  const reset = () => {
    if (resetDefinitiveEventProfitReviewAttempt(ids)) setStatus({ state: "ready", message: "Rejected request reset. Review the entries before retrying.", action: "" });
  };

  if (!isAdmin) {
    return (
      <section className="event-profit-review" data-capability-id="cwf-11-event-profit-review" data-capability-state={review.state || "not_started"}>
        <div className="workflow-attention-head"><div><h4>Event Profit Review</h4><p className="source-note">Finalized staff-safe results only. Detailed inputs and notes remain admin-only.</p></div><StatusChip family={review.state === "final" ? "confirmed" : "info"} label={review.state === "final" ? "Final" : "Admin review pending"} /></div>
        <ProfitSummary review={review} />
      </section>
    );
  }

  const groups = [
    { title: "Revenue", fields: REVENUE_FIELDS, group: "actuals", note: "Record gross event revenue, discounts, and refunds or credits." },
    { title: "Costs", fields: COST_FIELDS, group: "actuals", note: "Record direct costs. Allocated overhead is optional and reported separately." },
    { title: "Loss signals", fields: LOSS_FIELDS, group: "lossSignals", note: "Optional explanatory subsets only. These values are never added to costs again." },
    { title: "Review", fields: [], group: "review", note: "Confirm completeness, comparison availability, and the next governed action." }
  ];
  const currentGroup = groups[step];
  const invalidMoney = [...REVENUE_FIELDS, ...COST_FIELDS].some(([field]) => {
    const value = inputToCents(form.actuals[field]);
    return Number.isNaN(value) || (REQUIRED_FIELDS.has(field) && value === null);
  });
  const targetValue = text(form.targetMargin) === "" ? null : Number(form.targetMargin);
  const invalidTarget = targetValue !== null && (!Number.isFinite(targetValue) || targetValue < 0 || targetValue >= 100);

  return (
    <section className="event-profit-review" aria-labelledby={`event-profit-${ids.quoteId}`} data-capability-id="cwf-11-event-profit-review" data-capability-state={status.state} data-profit-review-state={review.state || "not_started"}>
      <div className="workflow-attention-head"><div><h4 id={`event-profit-${ids.quoteId}`}>Event Profit Review</h4><p className="source-note">Operator-recorded event actuals bound to the accepted proposal. This is contribution analysis, not accounting or cash settlement. Loss signals are explanatory subsets and are never added to costs again.</p></div><StatusChip family={review.state === "final" ? "confirmed" : review.state === "draft" ? "action" : "info"} label={review.state === "final" ? "Final" : review.state === "draft" ? "Draft" : "Not started"} /></div>
      <ProfitSummary review={review} />
      {review.state !== "final" && (
        <div className="event-profit-review-flow">
          <ol className="event-profit-review-steps" aria-label="Profit review steps">{groups.map((group, index) => <li key={group.title} aria-current={step === index ? "step" : undefined}><button type="button" disabled={busy} onClick={() => setStep(index)}>{group.title}</button></li>)}</ol>
          <fieldset disabled={busy}><legend>{currentGroup.title}</legend><p className="source-note">{currentGroup.note}</p>
            {currentGroup.fields.map(([field, label]) => <MoneyField key={field} field={field} label={label} group={currentGroup.group} value={form[currentGroup.group][field]} confirmed={form.confirmedZeroFields.includes(field)} disabled={busy} onChange={updateValue} onConfirm={confirmZero} />)}
            {step === 3 && <><label className="field"><span>Target contribution margin (%)</span><input inputMode="decimal" min="0" max="99.99" step="0.01" value={form.targetMargin} onChange={(event) => setForm((current) => ({ ...current, targetMargin: event.target.value }))} /></label><label className="event-profit-zero-confirm"><input type="checkbox" checked={form.comparisonBasisConfirmed} onChange={(event) => setForm((current) => ({ ...current, comparisonBasisConfirmed: event.target.checked }))} /> Confirm that actual revenue and cost categories use the same scope as the accepted quote estimate. Without this evidence, quote variance stays unavailable.</label><label className="field"><span>Internal notes (optional)</span><textarea maxLength={1600} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></label><p className="source-note">Finalizing requires every revenue and direct-cost field. Every recorded $0 must be explicitly confirmed.</p></>}
          </fieldset>
          <div className="event-profit-review-actions">{step > 0 && <button type="button" className="ghost compact" disabled={busy} onClick={() => setStep((value) => value - 1)}>Back</button>}{step < 3 ? <button type="button" className="cta compact" disabled={busy} onClick={() => setStep((value) => value + 1)}>Continue</button> : <><button type="button" className="ghost compact" disabled={busy || invalidTarget} onClick={() => void run("save_draft")}>Save draft</button><button type="button" className="cta compact" disabled={busy || invalidMoney || invalidTarget} onClick={() => void run("finalize")}>Finalize review</button></>}</div>
        </div>
      )}
      {review.state === "final" && <button type="button" className="ghost compact" disabled={busy} onClick={() => void run("reopen")}>Reopen for correction</button>}
      {status.message && <p className={status.state === "error" || status.state === "uncertain" ? "warning-note" : "source-note"} role={status.state === "error" || status.state === "uncertain" ? "alert" : "status"}>{status.message}</p>}
      {status.state === "uncertain" && status.action && <button type="button" className="cta compact" onClick={() => void run(status.action, true)}>Reconcile exact request</button>}
      {status.state === "error" && <button type="button" className="ghost compact" onClick={reset}>Reset rejected request</button>}
      {review.finalizedAtISO && <p className="source-note">Finalized {formatWorkspaceDateTime(review.finalizedAtISO)}.</p>}
    </section>
  );
}
