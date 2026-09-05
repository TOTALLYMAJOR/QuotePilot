import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { applyEventOperatingActualsCommand, createEventActualsRequestId, getEventOperatingActualsSnapshot, isDefinitiveEventActualsError, readPendingEventActualsCommand, resetDefinitiveEventActualsCommand } from "../lib/eventOperatingActualsClient";

const CATEGORIES = ["labor", "purchasing", "other"];
const LABELS = { labor: "Labor", purchasing: "Purchasing", other: "Other costs" };
const DECLARATIONS = { not_declared: "Not declared", partial: "Partial", complete: "Complete", not_applicable: "Not applicable" };
const BLOCKS = new Set(["submitting", "uncertain", "reconciliation", "error", "recovery"]);
const money = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const costInput = (cents) => Number.isSafeInteger(cents) ? (cents / 100).toFixed(2) : "";
export function parseRecordedCost(value) {
  if (typeof value !== "string" || !/^\d{1,8}(?:\.\d{1,2})?$/u.test(value.trim())) return null;
  const [whole, fraction = ""] = value.trim().split("."); const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents <= 1_000_000_000 ? cents : null;
}
function State({ state, channel, children }) {
  const common = { "data-capability-id": "event-operating-actuals", "data-capability-channel": channel };
  switch (state) {
    case "loading": return <div {...common} data-capability-state="loading">{children}</div>;
    case "empty": return <div {...common} data-capability-state="empty">{children}</div>;
    case "success": return <div {...common} data-capability-state="success">{children}</div>;
    case "stale": return <div {...common} data-capability-state="stale">{children}</div>;
    case "partial": return <div {...common} data-capability-state="partial">{children}</div>;
    case "error": return <div {...common} data-capability-state="error">{children}</div>;
    case "recovery": return <div {...common} data-capability-state="recovery">{children}</div>;
    case "ready": return <div {...common} data-capability-state="ready">{children}</div>;
    case "submitting": return <div {...common} data-capability-state="submitting">{children}</div>;
    case "uncertain": return <div {...common} data-capability-state="uncertain">{children}</div>;
    case "reconciliation": return <div {...common} data-capability-state="reconciliation">{children}</div>;
    case "receipt": return <div {...common} data-capability-state="receipt">{children}</div>;
    default: return null;
  }
}
function pendingSelection(command) { return command ? { ...command, cost: costInput(command.costCents) } : null; }
export default function EventOperatingActualsPanel(props) {
  return <ActualsPanel key={JSON.stringify([props.organizationId, props.quoteId, props.principalId, props.role, props.source, props.enabled, props.sourceVersionId, props.acceptanceReceiptId])} {...props} />;
}
function ActualsPanel({ organizationId, quoteId, principalId, role, source, enabled, phaseSnapshot, phaseReadState, otherMutationBlocked = false, onActualsMutationBlockedChange }) {
  const eligible = enabled === true && source === "firebase" && ["admin", "sales"].includes(role) && Boolean(organizationId && quoteId && principalId);
  const scope = { organizationId, quoteId, principalId };
  const mounted = useRef(true), sequence = useRef(0), inFlight = useRef(false), editorRef = useRef(null), outcomeRef = useRef(null), focusRequested = useRef(false);
  const [pending] = useState(() => eligible ? readPendingEventActualsCommand(scope) : null);
  const [read, setRead] = useState({ state: "loading", snapshot: null, error: "" });
  const [mutation, setMutation] = useState(() => pending ? { state: pending.definitive ? "error" : "uncertain", command: pending.command, receipt: null, error: "The original actuals request still needs review." } : { state: "ready", command: null, receipt: null, error: "" });
  const [selection, setSelection] = useState(() => pendingSelection(pending?.command));
  const previousMutation = useRef(mutation.state);
  const blocked = BLOCKS.has(mutation.state), busy = ["submitting", "reconciliation"].includes(mutation.state);
  useEffect(() => { onActualsMutationBlockedChange?.(blocked); }, [blocked, onActualsMutationBlockedChange]);
  useLayoutEffect(() => { if (focusRequested.current && selection) { focusRequested.current = false; editorRef.current?.focus(); } }, [selection]);
  useLayoutEffect(() => { if (previousMutation.current !== mutation.state && ["receipt", "error", "recovery"].includes(mutation.state)) outcomeRef.current?.focus(); previousMutation.current = mutation.state; }, [mutation.state]);
  const refresh = async () => {
    if (!eligible) return; const token = ++sequence.current; setRead((prior) => ({ ...prior, state: "loading", error: "" }));
    try { const result = await getEventOperatingActualsSnapshot({ organizationId, quoteId }); if (!mounted.current || token !== sequence.current) return; setRead({ state: result.snapshot.availability === "available" ? "success" : "empty", snapshot: result.snapshot, error: "" }); }
    catch (error) { if (!mounted.current || token !== sequence.current) return; setRead((prior) => ({ ...prior, state: prior.snapshot ? "stale" : "error", error: error.message })); }
  };
  useEffect(() => { mounted.current = true; void refresh(); return () => { mounted.current = false; sequence.current += 1; }; }, []);
  const priorPhaseAvailability = useRef(phaseSnapshot?.availability);
  useEffect(() => { if (priorPhaseAvailability.current !== "available" && phaseSnapshot?.availability === "available" && !blocked) void refresh(); priorPhaseAvailability.current = phaseSnapshot?.availability; }, [phaseSnapshot?.availability, blocked]);
  const run = async (command, reconciliation = false) => {
    if (inFlight.current) return; inFlight.current = true; sequence.current += 1;
    setMutation({ state: reconciliation ? "reconciliation" : "submitting", command, receipt: null, error: "" });
    try {
      const result = await applyEventOperatingActualsCommand({ ...scope, ...command }); if (!mounted.current) return; sequence.current += 1;
      setMutation({ state: "receipt", command: null, receipt: result.receipt, error: "" }); setSelection(null);
      if (reconciliation || result.idempotent === true) { setRead({ state: "loading", snapshot: null, error: "" }); await refresh(); }
      else setRead({ state: "success", snapshot: result.snapshot, error: "" });
    } catch (error) { if (!mounted.current) return; setMutation({ state: error.code === "event-mutation-blocked" ? "ready" : isDefinitiveEventActualsError(error) ? "error" : "uncertain", command: error.code === "event-mutation-blocked" ? null : command, receipt: null, error: error.message }); }
    finally { inFlight.current = false; }
  };
  const matches = read.snapshot?.sourceVersionId === phaseSnapshot?.sourceVersionId && read.snapshot?.acceptanceReceiptId === phaseSnapshot?.acceptanceReceiptId;
  const canWrite = role === "admin" && phaseReadState === "success" && phaseSnapshot?.availability === "available" && matches && ["empty", "success"].includes(read.state) && read.snapshot?.reasonCode !== "phase_ledger_missing";
  const disabled = blocked || otherMutationBlocked || !canWrite;
  const choose = (value) => { if (disabled) return; focusRequested.current = true; setSelection({ description: "", cost: "", durationMinutes: "", laborRole: "server", reason: "", note: "", ...value }); };
  const valid = selection && (selection.command === "void" ? Boolean(selection.reason?.trim()) : selection.command === "declare_category" ? Boolean(selection.note?.trim()) : Boolean(selection.description?.trim()) && parseRecordedCost(selection.cost) !== null && (selection.category !== "labor" || /^\d+$/u.test(String(selection.durationMinutes)) && Number(selection.durationMinutes) >= 1 && Number(selection.durationMinutes) <= 10_080) && (selection.command !== "correct" || Boolean(selection.reason?.trim())));
  const submit = (event) => {
    event.preventDefault(); if (disabled || inFlight.current || !valid) return;
    const command = { organizationId, quoteId, sourceVersionId: read.snapshot.sourceVersionId, acceptanceReceiptId: read.snapshot.acceptanceReceiptId, requestId: createEventActualsRequestId(), actualsPolicyVersion: 1, expectedActualsRevision: read.snapshot.revision, command: selection.command };
    if (["record", "correct"].includes(selection.command)) { Object.assign(command, { category: selection.category, description: selection.description, costCents: parseRecordedCost(selection.cost) }); if (selection.category === "labor") Object.assign(command, { laborRole: selection.laborRole, durationMinutes: Number(selection.durationMinutes) }); }
    if (["correct", "void"].includes(selection.command)) Object.assign(command, { entryId: selection.entryId, reason: selection.reason });
    if (selection.command === "declare_category") Object.assign(command, { category: selection.category, state: selection.state, note: selection.note });
    void run(command);
  };
  const review = async () => { if (!resetDefinitiveEventActualsCommand(scope)) return; setMutation({ state: "recovery", command: null, receipt: null, error: "" }); setSelection(null); await refresh(); if (mounted.current) setMutation({ state: "ready", command: null, receipt: null, error: "" }); };
  const update = (field, value) => setSelection((prior) => ({ ...prior, [field]: value }));
  if (!eligible) return <State state="recovery" channel="read"><p>Actuals require an enabled connected workspace and authorized staff access.</p></State>;
  return <section aria-label="Recorded event actuals" data-capability-id="event-operating-actuals" style={{ marginTop: "1.5rem", minWidth: 0, overflowWrap: "anywhere" }} aria-busy={busy}>
    <h3>Recorded labor and costs</h3>
    <p className="source-note">Enter known labor and costs in USD. These records do not establish payroll, payment, inventory consumption, quote pricing, or event readiness.</p>
    <button type="button" className="ghost" disabled={blocked || otherMutationBlocked || read.state === "loading"} onClick={() => void refresh()}>Refresh actuals</button>
    <State state={read.state} channel="read">
      {read.state === "loading" && <p role="status">Loading recorded actuals...</p>}
      {read.state === "empty" && <p role="status">{read.snapshot?.reasonCode === "phase_ledger_missing" ? "Record the event prepared phase before recording actuals." : "No actuals or completeness declarations have been recorded."}</p>}
      {read.error && <p role="alert" className="error-note">{read.error}</p>}
    </State>
    {otherMutationBlocked && <p role="status" className="source-note">Check the existing event request before changing actuals. The original actuals request can still be reconciled below.</p>}
    {read.snapshot && <>
      <h4>{read.snapshot.captureComplete ? "Capture declared complete" : "Captured subtotal (provisional)"}</h4>
      <p><strong>{money(read.snapshot.totals.totalCostCents)}</strong> USD captured · {read.snapshot.totals.durationMinutes} labor minutes recorded</p>
      {!read.snapshot.captureComplete && <p className="source-note">Zero and entered rows do not establish completeness. Review labor, purchasing, and other costs explicitly.</p>}
      <dl className="live-ops-facts">{CATEGORIES.map((category) => <div key={category}><dt>{LABELS[category]}</dt><dd>{money(read.snapshot.totals[`${category}CostCents`])} · {DECLARATIONS[read.snapshot.categories[category].state]}{read.snapshot.categories[category].note && <p className="source-note">{read.snapshot.categories[category].note}</p>}{role === "admin" && <button type="button" className="ghost" disabled={disabled} onClick={() => choose({ command: "declare_category", category, state: "partial" })}>Review {category} completeness</button>}</dd></div>)}</dl>
      {role === "admin" && <div className="right-actions" style={{ marginTop: "1rem" }}>{CATEGORIES.map((category) => <button type="button" className="ghost" key={category} disabled={disabled || read.snapshot.entries.length >= 50} onClick={() => choose({ command: "record", category })}>Record {category === "other" ? "other cost" : category}</button>)}</div>}
      <h4>Retained actuals</h4>
      {read.snapshot.entries.length === 0 && <p className="source-note">No entries recorded. Unknown costs remain unrecorded, not zero.</p>}
      <ul className="command-center-list" aria-label="Recorded labor and purchasing entries">{read.snapshot.entries.map((entry, index) => <li className="command-center-row" key={entry.entryId} style={{ minWidth: 0 }}><div><strong>{entry.description.length > 64 ? `${entry.description.slice(0, 64)}…` : entry.description}</strong><details><summary>Full description for {entry.category} entry {index + 1}</summary><p style={{ whiteSpace: "pre-wrap" }}>{entry.description}</p></details><p className="source-note">{LABELS[entry.category]} · {money(entry.costCents)} USD{entry.category === "labor" ? ` · ${entry.laborRole} · ${entry.durationMinutes} minutes` : ""} · {entry.state === "voided" ? "Voided; excluded from captured subtotal" : "Active"}</p></div>{role === "admin" && entry.state === "active" && <div className="right-actions"><button type="button" className="ghost" aria-label={`Correct ${entry.category} entry ${index + 1}`} disabled={disabled} onClick={() => choose({ command: "correct", ...entry, cost: costInput(entry.costCents), reason: "" })}>Correct</button><button type="button" className="ghost" aria-label={`Void ${entry.category} entry ${index + 1}`} disabled={disabled} onClick={() => choose({ command: "void", entryId: entry.entryId, category: entry.category, description: entry.description })}>Void</button></div>}</li>)}</ul>
      <p className="source-note">{read.snapshot.entries.length} of 50 retained entries, including voided entries.</p>
      <State state="partial" channel="read"><p className="source-note">History coverage: latest actuals receipt only.</p></State>
      <details className="staff-evidence-disclosure"><summary>Actuals source and latest receipt</summary><p>Accepted source: {read.snapshot.sourceVersionId}</p><p>Acceptance receipt: {read.snapshot.acceptanceReceiptId}</p>{read.snapshot.latestReceipt && <p>Latest actuals receipt: {read.snapshot.latestReceipt.receiptId}. Recorded at {read.snapshot.latestReceipt.recordedAtISO}.</p>}<p>Category completeness is declared by an operator. Replay reads earlier operational receipts for this accepted source.</p></details>
    </>}
    {role === "sales" ? <p className="source-note">An administrator records actuals and completeness. Your access is read-only.</p> : <State state={mutation.state} channel="mutation">
      {selection && <form onSubmit={submit} style={{ marginTop: "1rem" }} aria-label="Review actuals change">
        <h4>{selection.command === "declare_category" ? `Review ${LABELS[selection.category]} completeness` : `${selection.command === "correct" ? "Correct" : selection.command === "void" ? "Void" : "Record"} ${LABELS[selection.category]}`}</h4>
        {selection.command === "void" ? <><p>{selection.description}</p><label className="field">Reason for voiding<textarea ref={editorRef} rows={3} maxLength={240} required disabled={disabled} value={selection.reason} onChange={(event) => update("reason", event.target.value)} /></label><p className="source-note">This entry remains in history and stops contributing to captured totals. Its category returns to partial.</p></> : selection.command === "declare_category" ? <>
          <label className="field">Completeness state<select aria-label="Completeness state" value={selection.state} disabled={disabled} onChange={(event) => update("state", event.target.value)}><option value="partial">Partial: known gaps remain</option><option value="complete">Complete: capture reviewed</option><option value="not_applicable" disabled={read.snapshot?.entries.some((entry) => entry.category === selection.category && entry.state === "active")}>Not applicable: no active entries</option></select></label>
          <label className="field">Declaration note<textarea ref={editorRef} rows={3} maxLength={240} required disabled={disabled} value={selection.note} onChange={(event) => update("note", event.target.value)} /></label>
        </> : <>
          <label className="field">Description<textarea ref={editorRef} rows={3} maxLength={240} required disabled={disabled} value={selection.description} onChange={(event) => update("description", event.target.value)} /></label>
          <label className="field">Recorded cost (USD)<input inputMode="decimal" value={selection.cost} required disabled={disabled} onChange={(event) => update("cost", event.target.value)} /></label>
          {selection.category === "labor" && <><label className="field">Labor role<select aria-label="Labor role" value={selection.laborRole} disabled={disabled} onChange={(event) => update("laborRole", event.target.value)}>{["lead", "server", "chef", "bartender", "other"].map((item) => <option value={item} key={item}>{item}</option>)}</select></label><label className="field">Worked minutes<input type="number" min={1} max={10080} step={1} required value={selection.durationMinutes} disabled={disabled} onChange={(event) => update("durationMinutes", event.target.value)} /></label></>}
          {selection.command === "correct" && <label className="field">Reason for correction<textarea rows={3} maxLength={240} required disabled={disabled} value={selection.reason} onChange={(event) => update("reason", event.target.value)} /></label>}
          <p className="source-note">Saving marks this category partial until an operator reviews its completeness again.</p>
        </>}
        <div className="right-actions"><button type="submit" className="cta" disabled={disabled || !valid}>Save actuals change</button><button type="button" className="ghost" disabled={blocked} onClick={() => setSelection(null)}>Keep current actuals</button></div>
      </form>}
      <div ref={outcomeRef} tabIndex={-1} role="group" aria-label="Actuals outcome">
        {busy && <p role="status">{mutation.state === "reconciliation" ? "Checking the original actuals request..." : "Recording actuals..."}</p>}
        {mutation.error && <p role="alert" className="error-note">{mutation.error}</p>}
        {mutation.state === "uncertain" && <><p>No result is confirmed. Keep the original actuals request unchanged.</p><button type="button" className="cta" onClick={() => void run(mutation.command, true)}>Check original actuals request</button></>}
        {mutation.state === "error" && <button type="button" className="ghost" onClick={() => void review()}>Refresh and review actuals</button>}
        {mutation.state === "recovery" && <p role="status">Refreshing actuals evidence before another request.</p>}
        {mutation.receipt && <p role="status">Actuals change recorded. Receipt: {mutation.receipt.receiptId}.</p>}
      </div>
    </State>}
  </section>;
}
