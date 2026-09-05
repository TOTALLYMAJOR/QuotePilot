import { useEffect, useRef, useState } from "react";
import { getEventOperatingActualsSnapshot } from "../lib/eventOperatingActualsClient";
const money = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
export default function EventActualsCloseoutSummary(props) {
  return <Summary key={JSON.stringify([props.organizationId, props.quoteId, props.sourceVersionId, props.acceptanceReceiptId, props.available])} {...props} />;
}
function Summary({ organizationId, quoteId, sourceVersionId, acceptanceReceiptId, available = true }) {
  const eligible = available && Boolean(organizationId && quoteId && sourceVersionId && acceptanceReceiptId);
  const [read, setRead] = useState({ state: "loading", snapshot: null }); const generation = useRef(0), outcome = useRef(null), focusRequested = useRef(false);
  const refresh = async () => {
    if (!eligible) return; const token = ++generation.current; setRead({ state: "loading", snapshot: null });
    try { const response = await getEventOperatingActualsSnapshot({ organizationId, quoteId }); if (token !== generation.current) return; const snapshot = response.snapshot;
      if (snapshot.sourceVersionId !== sourceVersionId || snapshot.acceptanceReceiptId !== acceptanceReceiptId) { setRead({ state: "source_mismatch", snapshot: null }); return; }
      setRead({ state: snapshot.availability === "available" ? "available" : "not_yet_available", snapshot });
    } catch { if (token === generation.current) setRead({ state: "unavailable", snapshot: null }); }
  };
  useEffect(() => { void refresh(); return () => { generation.current += 1; }; }, []);
  useEffect(() => { if (focusRequested.current && read.state !== "loading") { focusRequested.current = false; outcome.current?.focus(); } }, [read]);
  if (!eligible) return <p className="source-note">Exact accepted-source references are unavailable for this closeout. Actuals cannot be compared.</p>;
  return <section aria-label="Actuals beside closeout review" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
    <h4>Actuals for this closeout source</h4><button type="button" className="ghost" disabled={read.state === "loading"} onClick={() => { focusRequested.current = true; void refresh(); }}>Refresh closeout actuals</button>
    <div ref={outcome} tabIndex={-1} role="group" aria-label="Closeout actuals read outcome">
      {read.state === "loading" && <p role="status">Loading exact-source actuals...</p>}
      {read.state === "source_mismatch" && <p>Current actuals belong to another accepted source. No costs from that source are shown for this closeout.</p>}
      {read.state === "unavailable" && <p role="status">Actuals could not be read. Refresh when connected and authorized; no zero or completeness is assumed.</p>}
      {read.state === "not_yet_available" && <p>No actuals are recorded for this closeout source. Zero and completeness are not established.</p>}
      {read.state === "available" && <><p><strong>{read.snapshot.captureComplete ? "Capture declared complete" : "Captured subtotal (provisional)"}: {money(read.snapshot.totals.totalCostCents)} USD</strong> · {read.snapshot.totals.durationMinutes} recorded labor minutes.</p><ul>{["labor", "purchasing", "other"].map((category) => <li key={category}>{category}: {money(read.snapshot.totals[`${category}CostCents`])} · {read.snapshot.categories[category].state.replaceAll("_", " ")}</li>)}</ul><p className="source-note">Actuals revision {read.snapshot.revision} · journal updated {read.snapshot.updatedAtISO}</p></>}
    </div>
    <p className="source-note">Recorded actuals support review. Their completeness does not complete a closeout item, confirm payment, or establish event readiness.</p>
    <details><summary>Closeout actuals source</summary><p>Accepted version: {sourceVersionId}</p><p>Acceptance receipt: {acceptanceReceiptId}</p></details>
  </section>;
}
