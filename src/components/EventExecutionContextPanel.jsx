import { useEffect, useRef, useState } from "react";
import { getOperationalStaffingSnapshot } from "../lib/operationalStaffingClient";
import { getKitchenBeoArtifactStatus } from "../lib/kitchenBeoClient";
import { getCommercialDependencyState } from "../lib/commercialChangeAuthorityClient";
import { getEventOperatingActualsSnapshot } from "../lib/eventOperatingActualsClient";
import { buildEventRunOfShowReadModel } from "../lib/eventRunOfShow";
import EventRunOfShowPanel from "./EventRunOfShowPanel";

const words = (value) => String(value || "Not available").replaceAll("_", " ");
const money = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
export default function EventExecutionContextPanel(props) {
  return <Context key={JSON.stringify([props.organizationId, props.quote?.id, props.principalId, props.role, props.source, props.enabled, props.quote?.activeVersionId || props.quote?.versionMeta?.versionId, props.quote?.acceptanceReceipt?.receiptId])} {...props} />;
}
function Context({ organizationId, quote, principalId, role, source, enabled, onOpenQuote, onOpenCustomer }) {
  const eligible = enabled === true && source === "firebase" && ["admin", "sales"].includes(role) && Boolean(organizationId && quote?.id && principalId);
  const [read, setRead] = useState({ loading: true, values: {}, errors: {} }); const generation = useRef(0);
  const load = async () => {
    if (!eligible) return; const token = ++generation.current; setRead((current) => ({ ...current, loading: true }));
    const scope = { organizationId, quoteId: quote.id };
    const keys = ["staffing", "beo", "dependencies", "actuals"];
    const results = await Promise.allSettled([getOperationalStaffingSnapshot(scope), getKitchenBeoArtifactStatus(scope), getCommercialDependencyState(scope), getEventOperatingActualsSnapshot(scope)]);
    if (token !== generation.current) return;
    const values = {}, errors = {}; results.forEach((result, index) => { if (result.status === "fulfilled") values[keys[index]] = result.value; else errors[keys[index]] = "This current domain read is unavailable. Refresh or open its source record."; }); setRead({ loading: false, values, errors });
  };
  useEffect(() => { void load(); return () => { generation.current += 1; }; }, []);
  if (!eligible) return null;
  const { staffing, beo, dependencies, actuals: actualsEnvelope } = read.values; const actuals = actualsEnvelope?.snapshot;
  const acceptedVersion = quote.activeVersionId || quote.versionMeta?.versionId || ""; const acceptedReceipt = quote.acceptanceReceipt?.receiptId || "";
  const actualsMatch = Boolean(acceptedVersion && acceptedReceipt && actuals?.sourceVersionId === acceptedVersion && actuals?.acceptanceReceiptId === acceptedReceipt);
  const error = (name) => read.errors[name] && <p role="status">{read.errors[name]}</p>;
  return <section aria-label="Current execution context" style={{ minWidth: 0, overflowWrap: "anywhere", marginTop: "1.5rem" }}>
    <h3>Current execution context</h3><p className="source-note">Current source records are shown by reference. They are separate from operational Replay and do not prove attendance, payment, consumption, or event readiness.</p>
    <button className="ghost" type="button" disabled={read.loading} onClick={() => void load()}>Refresh context</button>{read.loading && <p role="status">Loading current source records...</p>}
    {!read.loading && <>
      <details><summary>Staffing assignments</summary>{error("staffing")}{staffing && <><p>Current staffing read: {words(staffing.state)}. {staffing.snapshot ? `Coverage: ${words(staffing.snapshot.coverage.state)}. ${staffing.snapshot.coverage.totalOperatorConfirmedCount} operator-confirmed assignments; ${staffing.snapshot.coverage.totalGap} quoted positions unfilled.` : "No assignment plan recorded."}</p><p>Observed: {staffing.observedAtISO}</p><p>Current commercial revision: {staffing.activeQuoteRevisionId}</p>{staffing.snapshot && <p>Plan source revision: {staffing.snapshot.quoteRevisionId}</p>}<p className="source-note">Operator-confirmed assignments do not confirm attendance. Review staffing in the quote record.</p></>}</details>
      <details><summary>Kitchen BEO and commercial dependencies</summary>{error("beo")}{beo && <><p>Current Kitchen BEO freshness: {words(beo.state)}.</p><p>Observed: {beo.observedAtISO}</p><p>Artifact source revision: {beo.commercialSourceRevisionId || "No retained artifact source"}</p><p>Latest BEO receipt: {beo.receiptId || "No retained receipt"}</p></>}{error("dependencies")}{dependencies && <><p>Current commercial dependencies: {words(dependencies.state)}. {dependencies.openInvalidationCount} open invalidations.</p><p>Observed: {dependencies.observedAtISO}</p><p>Current commercial revision: {dependencies.activeRevisionId}</p>{!dependencies.bounds.invalidationSetComplete && <p>This dependency read is incomplete.</p>}</>}<p className="source-note">These reads keep their commercial source and freshness semantics. They are not historical evidence for the accepted operational source.</p></details>
      <details><summary>Actuals for closeout review</summary>{error("actuals")}{actuals && (!actualsMatch ? <p>Actuals belong to a different accepted source. Refresh the event; no closeout totals are shown.</p> : actuals.availability !== "available" ? <p>No actuals have been recorded for this exact accepted source. Zero is not established.</p> : <><p>{actuals.captureComplete ? "Capture declared complete" : "Captured subtotal (provisional)"}: {money(actuals.totals.totalCostCents)} USD · {actuals.totals.durationMinutes} recorded labor minutes.</p><ul>{["labor", "purchasing", "other"].map((category) => <li key={category}>{words(category)}: {money(actuals.totals[`${category}CostCents`])} · {words(actuals.categories[category].state)}</li>)}</ul><p>Actuals revision {actuals.revision} · observed journal update {actuals.updatedAtISO}</p><p>Accepted version: {actuals.sourceVersionId}</p><p>Acceptance receipt: {actuals.acceptanceReceiptId}</p></>)}<p className="source-note">Actuals completeness does not complete the separate internal closeout review.</p>{quote.customerId && onOpenCustomer && <button type="button" className="ghost" onClick={() => onOpenCustomer(quote.customerId)}>Open customer closeout review</button>}</details>
    </>}
    <details><summary>Planned run of show</summary><EventRunOfShowPanel model={buildEventRunOfShowReadModel({ quotes: [quote], source, limit: 1 })} selectedDateLabel="This event" /><p className="source-note">Planned timeline and checklist entries are derived from the current saved quote; they are not execution receipts.</p></details>
    {onOpenQuote && <button type="button" className="ghost" onClick={() => onOpenQuote(quote.id)}>Open staffing, BEO, and dependencies in quote record</button>}
  </section>;
}
