import { useEffect, useRef, useState } from "react";
import { getEventOperatingHistory, mergeEventHistoryPages } from "../lib/eventOperatingHistoryClient";

function ReadState({ state, children }) {
  const props = { "data-capability-id": "event-operating-history" };
  switch (state) {
    case "loading": return <div {...props} data-capability-state="loading">{children}</div>;
    case "empty": return <div {...props} data-capability-state="empty">{children}</div>;
    case "success": return <div {...props} data-capability-state="success">{children}</div>;
    case "partial": return <div {...props} data-capability-state="partial">{children}</div>;
    case "stale": return <div {...props} data-capability-state="stale">{children}</div>;
    case "error": return <div {...props} data-capability-state="error">{children}</div>;
    default: return <div {...props} data-capability-state="recovery">{children}</div>;
  }
}
const words = (value) => String(value || "").replaceAll("_", " ");
function Value({ value }) { return value === null ? <p>No earlier record.</p> : <dl className="live-ops-facts">{Object.entries(value).map(([key, item]) => <div key={key}><dt>{{ costCents: "Recorded cost (USD)", durationMinutes: "Worked minutes", laborRole: "Labor role" }[key] || words(key)}</dt><dd>{["durationMinutes", "laborRole"].includes(key) && value.category && value.category !== "labor" ? "Not applicable" : item === null ? "Not recorded" : key === "costCents" ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(item / 100) : String(item === undefined || item === "" ? "Not recorded" : item)}</dd></div>)}</dl>; }
export default function EventOperatingHistoryPanel(props) {
  return <History key={JSON.stringify([props.organizationId, props.quoteId, props.principalId, props.role, props.sourceVersionId, props.acceptanceReceiptId, props.enabled, props.source])} {...props} />;
}
function History({ organizationId, quoteId, principalId, role, enabled, source, sourceVersionId, acceptanceReceiptId }) {
  const eligible = enabled === true && source === "firebase" && ["admin", "sales"].includes(role) && Boolean(organizationId && quoteId && principalId && sourceVersionId && acceptanceReceiptId);
  const [read, setRead] = useState({ state: "loading", snapshot: null, error: "" }); const sequence = useRef(0), mounted = useRef(true), outcome = useRef(null), focusRequested = useRef(false);
  const load = async (more = false) => {
    if (!eligible) return; const token = ++sequence.current; const previous = more ? read.snapshot : null;
    setRead((current) => ({ ...current, state: "loading", error: "" }));
    try {
      const result = await getEventOperatingHistory({ organizationId, quoteId, ...(more ? { cursor: previous.nextCursor } : {}) });
      if (!mounted.current || token !== sequence.current) return;
      if (result.snapshot.sourceVersionId !== sourceVersionId || result.snapshot.acceptanceReceiptId !== acceptanceReceiptId) throw Object.assign(new Error("The accepted source changed. Return to Event Focus and refresh the event before reading Replay."), { code: "aborted" });
      const snapshot = mergeEventHistoryPages(previous, result.snapshot);
      setRead({ state: snapshot.availability === "not_yet_available" ? "empty" : snapshot.hasMore || snapshot.newerAvailable ? "partial" : "success", snapshot, error: "" });
    } catch (error) { if (mounted.current && token === sequence.current) setRead((current) => ({ ...current, state: current.snapshot ? "stale" : "error", error: error.message })); }
  };
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; sequence.current += 1; }; }, []);
  useEffect(() => { if (read.state !== "loading" && focusRequested.current) { focusRequested.current = false; outcome.current?.focus(); } }, [read.state, read.snapshot, read.error]);
  if (!eligible) return <ReadState state="recovery"><p>Replay requires an enabled connected workspace, an exact accepted source, and authorized staff access.</p></ReadState>;
  return <section aria-label="Operational Replay" data-capability-id="event-operating-history" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
    <h3>Operational Replay</h3><p className="source-note">Recorded phase, checkpoint, issue, and actuals changes for this accepted source. This read does not settle an uncertain command or establish staffing, payment, readiness, or full event history.</p>
    <button className="ghost" type="button" disabled={read.state === "loading"} onClick={() => { focusRequested.current = true; void load(); }}>Refresh Replay</button>
    <ReadState state={read.state}><div ref={outcome} tabIndex={-1} role="group" aria-label="Replay read outcome">
      {read.state === "loading" && <p role="status">Loading operational receipts...</p>}
      {read.error && <p role="alert">{read.error} {read.snapshot && "Existing rows are retained as stale evidence."}</p>}
      {read.state === "empty" && <p>No phase ledger has been initialized for this accepted source. No operational history is available.</p>}
      {read.snapshot?.availability === "available" && <p>{read.snapshot.rows.length} receipts loaded. {read.snapshot.completeForAnchors ? "All operational receipts through these anchors are loaded." : "More receipts remain at these anchors."} {read.snapshot.newerAvailable && "Newer changes are available. Refresh Replay to include them."}</p>}
    </div></ReadState>
    {read.snapshot && <><details className="staff-evidence-disclosure"><summary>Replay source and receipt anchors</summary><p>Accepted version: {read.snapshot.sourceVersionId}</p><p>Acceptance receipt: {read.snapshot.acceptanceReceiptId}</p>{Object.entries(read.snapshot.anchors).map(([channel, anchor]) => <p key={channel}>{words(channel)} revision {anchor.revision}: {anchor.receiptId || "No receipts"}</p>)}<p>{read.snapshot.evidenceBoundary}</p></details>
      <ol className="command-center-list" aria-label="Operational receipts">{read.snapshot.rows.map((row) => <li key={row.receiptId} className="command-center-row" style={{ minWidth: 0 }}><div style={{ minWidth: 0, width: "100%" }}><strong>{words(row.command)}</strong><p className="source-note">{words(row.channel)} · revision {row.resultRevision} · {row.recordedAtISO}</p><details><summary>Receipt details: {words(row.targetType)}</summary><p>Target: {row.targetId}</p><h4>Before</h4><Value value={row.before} /><h4>After</h4><Value value={row.after} />{row.note && <p>Recorded note: {row.note}</p>}<p>Recorded by {row.actor.role}: {row.actor.uid}</p><p>Receipt: {row.receiptId}</p><p>Request: {row.requestId}</p></details></div></li>)}</ol>
      {read.snapshot.hasMore && <button type="button" className="ghost" disabled={!["partial", "success"].includes(read.state)} onClick={() => { focusRequested.current = true; void load(true); }}>Load earlier receipts</button>}
    </>}
  </section>;
}
