import { useEffect, useMemo, useRef, useState } from "react";
import { buildPostEventLearningProjection } from "../lib/postEventLearningProjection";
import { getEventOperatingActualsSnapshot } from "../lib/eventOperatingActualsClient";
import { subscribeToEventIngredientProjection, subscribeToEventIngredientExecutionProjection } from "../lib/inventoryAuthorityClient";
import { recordPostEventLearningProposed } from "../lib/productAnalyticsAmbient";
import FieldStateIndicator from "./FieldStateIndicator";
import "./postEventLearning.css";

const LABELS = { recipe: "Review recipe usage", template: "Review template questions", pack_conversion: "Review pack conversion", workflow: "Review closeout workflow" };
export function PostEventLearningView({ projection, loading = false, error = "", onRefresh, onReview, role = "sales" }) {
  const [reviewState, setReviewState] = useState("ready");
  const [reviewError, setReviewError] = useState("");
  const generation = useRef(0);
  useEffect(() => { generation.current += 1; setReviewState("ready"); setReviewError(""); return () => { generation.current += 1; }; }, [projection]);
  const capabilityState = loading ? "loading" : error || reviewState === "error" ? "error" : reviewState === "recovery" ? "recovery" : projection.acceptedState === "stale" ? "stale" : projection.acceptedState !== "available" ? "unavailable" : !projection.proposals.length ? "empty" : projection.rows.some((item) => !["available", "not_applicable"].includes(item.availability)) ? "partial" : "success";
  const review = async (proposal) => {
    const token = ++generation.current;
    setReviewState("loading"); setReviewError("");
    try {
      const result = await onReview({ ...proposal, scope: projection.scope });
      if (token !== generation.current) return;
      if (result?.status !== "review_opened") throw new Error("The existing review surface did not open. Try the review again.");
      setReviewState("success");
    } catch (failure) { if (token === generation.current) { setReviewState("error"); setReviewError(failure?.message || "The review could not open. Try again."); } }
  };
  return <section className="post-event-learning" aria-label="Learn from this event" data-capability-id="post-event-learning" data-capability-state={capabilityState}>
    <h4>Learn from this event</h4>
    <p>Compare the accepted plan with recorded results, then choose what to review for the next event.</p>
    <button type="button" className="ghost" onClick={() => { setReviewState("recovery"); onRefresh?.(); }} disabled={loading}>Refresh learning evidence</button>
    {projection.acceptedState !== "available" && <p>Refresh reloads the owning Client overview, accepted quote, version and closeout before comparing subordinate evidence.</p>}
    {loading ? <p role="status">Loading exact event evidence…</p> : <>
      {error && <p role="alert">{error} Refresh the learning evidence to recover.</p>}
      <dl className="post-event-learning__rows">
        {projection.rows.map((item) => <div key={item.id} data-learning-row={item.id}>
          <dt>{item.label}</dt><dd>
            <strong>{item.availability.replaceAll("_", " ")}</strong>
            {item.planned !== undefined && <span>Planned: {item.planned} {item.unit}</span>}
            {item.actual !== undefined && <span>Recorded: {item.actual} {item.unit}</span>}
            {item.difference !== undefined && <span>Difference: {item.difference > 0 ? "+" : ""}{item.difference} {item.unit}</span>}
            {item.detail && <span>{item.detail}</span>}
            <p>{item.reason}</p>
            {item.sourceReferences.length > 0 && <details><summary>Evidence references</summary><ul>{item.sourceReferences.map((reference, index) => <li key={index}>{reference}</li>)}</ul></details>}
          </dd>
        </div>)}
      </dl>
      {projection.acceptedState === "available" && <div data-field-state-surface="post-event-learning-recommendations">
        <h5>Recommendations for review</h5>
        {!projection.proposals.length && <p>No recommendation is supported by the available evidence. Missing results are not treated as zero.</p>}
        {projection.proposals.map((proposal) => <article key={proposal.proposalId} data-learning-category={proposal.category}>
          <h6>{LABELS[proposal.category]}</h6>
          <FieldStateIndicator state={{ origin: "suggested", editability: "read_only" }} primaryState="suggested" provenance={proposal.sourceReferences.join(" · ")} supportingDetail="Recommendation only. Operator review and an existing authority receipt are required for adoption." />
          <p>{proposal.rationale}</p>
          {role === "admin" && onReview ? <button type="button" className="ghost" disabled={reviewState === "loading"} onClick={() => void review(proposal)}>Open {proposal.destination === "inventory" ? "Inventory" : "Library"} review</button> : <p>An administrator can review changes in the existing Library or Inventory authority.</p>}
        </article>)}
      </div>}
    </>}
    <div data-learning-review-state={reviewState} aria-live="polite">{reviewState === "loading" ? "Opening the existing review…" : reviewState === "success" ? "Review opened. No recommendation has been adopted or published." : reviewError}</div>
    <details><summary>Learning evidence boundary</summary><p>{projection.boundary}</p><p>Accepted version: {projection.scope.sourceVersionId || "unavailable"}. Acceptance receipt: {projection.scope.acceptanceReceiptId || "unavailable"}.</p></details>
  </section>;
}

export default function PostEventLearningPanel(props) {
  const identity = JSON.stringify([props.organizationId, props.quote?.id, props.quote?.activeVersionId, props.quote?.acceptanceReceipt?.receiptId, props.role, props.principalId, props.source, props.enabled]);
  return props.enabled && ["admin", "sales"].includes(props.role) ? <ConnectedLearning key={identity} {...props} /> : null;
}

export function learningActualsRead(value, scope) {
  if (!value || typeof value !== "object" || !value.snapshot || typeof value.snapshot !== "object" || Array.isArray(value.snapshot) || typeof value.snapshot.organizationId !== "string" || !value.snapshot.organizationId || typeof value.snapshot.quoteId !== "string" || !value.snapshot.quoteId) return { state: "schema_drift" };
  if (value.snapshot.organizationId !== scope.organizationId || value.snapshot.quoteId !== scope.quoteId) return { state: "contradictory" };
  const snapshot = value.snapshot;
  if (!snapshot.sourceVersionId || !snapshot.acceptanceReceiptId || !snapshot.ledgerId || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0 || !["available", "not_yet_available"].includes(snapshot.availability) || typeof snapshot.captureComplete !== "boolean" || snapshot.currency !== "USD" || !Number.isSafeInteger(snapshot.totals?.totalCostCents) || snapshot.totals.totalCostCents < 0) return { state: "schema_drift" };
  return { state: "available", snapshot: value.snapshot };
}
export function learningActualsError(error) {
  if (["schema_drift", "contradictory"].includes(error?.evidenceState)) return { state: error.evidenceState };
  const code = String(error?.code || "").replace(/^functions\//u, "");
  return { state: code === "invalid-server-response" ? "schema_drift" : ["failed-precondition", "aborted"].includes(code) ? "stale" : "unavailable" };
}

function ConnectedLearning({ organizationId, quote, acceptedVersion, closeout, source, role, inventoryEnabled = false, onReview, onRefreshSource,
  readActuals = getEventOperatingActualsSnapshot, subscribePlan = subscribeToEventIngredientProjection, subscribeExecution = subscribeToEventIngredientExecutionProjection }) {
  const [refresh, setRefresh] = useState(0);
  const [reads, setReads] = useState({ planRead: { state: "loading" }, executionRead: { state: "loading" }, financialRead: { state: "loading" } });
  const seen = useRef(new Set());
  useEffect(() => {
    let active = true; const unsubscribers = [];
    const put = (name, value) => { if (active) setReads((current) => ({ ...current, [name]: value })); };
    const blocked = { state: "unavailable" };
    setReads({ planRead: inventoryEnabled ? { state: "loading" } : blocked, executionRead: inventoryEnabled ? { state: "loading" } : blocked, financialRead: { state: "loading" } });
    if (!["firebase", "firebase-org"].includes(source)) { setReads({ planRead: blocked, executionRead: blocked, financialRead: blocked }); return () => { active = false; }; }
    if (inventoryEnabled) for (const [name, subscribe] of [["planRead", subscribePlan], ["executionRead", subscribeExecution]]) {
      // Existing clients emit retained/stale evidence through onData before their
      // advisory onError callback. Do not overwrite that evidence with a null read.
      try { unsubscribers.push(subscribe({ organizationId, quoteId: quote.id, role, browserEnabled: true, tenantEnabled: true, onData: (value) => put(name, value) })); } catch { put(name, blocked); }
    }
    Promise.resolve().then(() => readActuals({ organizationId, quoteId: quote.id })).then((value) => put("financialRead", learningActualsRead(value, { organizationId, quoteId: quote.id }))).catch((error) => put("financialRead", learningActualsError(error)));
    return () => { active = false; unsubscribers.forEach((unsubscribe) => unsubscribe?.()); };
  }, [organizationId, quote.id, role, source, inventoryEnabled, refresh, readActuals, subscribePlan, subscribeExecution]);
  const projection = useMemo(() => buildPostEventLearningProjection({ organizationId, quote, acceptedVersion, closeout, source, ...reads }), [organizationId, quote, acceptedVersion, closeout, source, reads]);
  useEffect(() => {
    projection.proposals.forEach((proposal) => {
      if (seen.current.has(proposal.proposalId)) return;
      seen.current.add(proposal.proposalId);
      recordPostEventLearningProposed({ category: proposal.category });
    });
  }, [projection]);
  return <PostEventLearningView projection={projection} loading={Object.values(reads).some((read) => read.state === "loading")} onRefresh={() => {
    if (onRefreshSource) onRefreshSource();
    else if (projection.acceptedState !== "available") { window.location.reload(); return; }
    setRefresh((value) => value + 1);
  }} onReview={onReview} role={role} />;
}
