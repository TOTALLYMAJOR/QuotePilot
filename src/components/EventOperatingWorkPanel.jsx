import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  applyEventOperatingWorkCommand,
  createEventWorkRequestId,
  getEventOperatingWorkSnapshot,
  isDefinitiveEventWorkError,
  readPendingEventWorkCommand,
  resetDefinitiveEventWorkCommand
} from "../lib/eventOperatingWorkClient";

const NAMES = { venue_access: "Venue access", team_briefing: "Team briefing", service_handoff: "Service handoff", pack_down: "Pack down" };
const STATE_LABELS = { not_recorded: "Not recorded", recorded: "Recorded", reopened: "Reopened", open: "Open", resolved: "Resolved" };
const MUTATION_BLOCKS = new Set(["submitting", "uncertain", "reconciliation", "error", "recovery"]);
function State({ state, channel, children }) {
  const common = { "data-capability-id": "event-operating-work-journal", "data-capability-channel": channel };
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
function selectionLabel(selection) {
  if (!selection) return "";
  if (selection.command.startsWith("checkpoint_")) return `${selection.command === "checkpoint_record" ? "Record" : "Reopen"} ${NAMES[selection.checkpointCode]}`;
  return selection.command === "issue_open" ? "Open issue" : selection.command === "issue_resolve" ? "Resolve issue" : "Reopen issue";
}
export default function EventOperatingWorkPanel(props) {
  const identity = JSON.stringify([props.organizationId, props.quoteId, props.principalId, props.role, props.source, props.enabled, props.sourceVersionId, props.acceptanceReceiptId]);
  return <WorkPanel key={identity} {...props} />;
}
function WorkPanel({ organizationId, quoteId, principalId, role, source, enabled, phaseSnapshot, phaseReadState, phaseMutationBlocked = false, onWorkMutationBlockedChange }) {
  const eligible = enabled === true && source === "firebase" && ["admin", "sales"].includes(role) && Boolean(organizationId && quoteId && principalId);
  const scope = { organizationId, quoteId, principalId };
  const mounted = useRef(true), sequence = useRef(0), inFlight = useRef(false);
  const [initialPending] = useState(() => eligible ? readPendingEventWorkCommand(scope) : null);
  const [read, setRead] = useState({ state: "loading", snapshot: null, error: "" });
  const [mutation, setMutation] = useState(() => initialPending ? { state: initialPending.definitive ? "error" : "uncertain", command: initialPending.command, receipt: null, error: "The original work request still needs review." } : { state: "ready", command: null, receipt: null, error: "" });
  const [selection, setSelection] = useState(() => initialPending?.command || null);
  const editorRef = useRef(null), outcomeRef = useRef(null), focusEditorRequested = useRef(false);
  const previousMutationState = useRef(mutation.state);
  useLayoutEffect(() => {
    if (focusEditorRequested.current && selection) { focusEditorRequested.current = false; editorRef.current?.focus(); }
  }, [selection]);
  useLayoutEffect(() => {
    if (previousMutationState.current !== mutation.state && ["receipt", "error", "recovery"].includes(mutation.state)) outcomeRef.current?.focus();
    previousMutationState.current = mutation.state;
  }, [mutation.state]);
  const blocked = MUTATION_BLOCKS.has(mutation.state), busy = ["submitting", "reconciliation"].includes(mutation.state);
  useEffect(() => { onWorkMutationBlockedChange?.(blocked); }, [blocked, onWorkMutationBlockedChange]);
  const refresh = async () => {
    if (!eligible) return;
    const token = ++sequence.current;
    setRead((previous) => ({ ...previous, state: "loading", error: "" }));
    try {
      const result = await getEventOperatingWorkSnapshot({ organizationId, quoteId });
      if (!mounted.current || sequence.current !== token) return;
      setRead({ state: result.snapshot.availability === "available" ? "success" : "empty", snapshot: result.snapshot, error: "" });
    } catch (error) {
      if (!mounted.current || sequence.current !== token) return;
      setRead((previous) => ({ ...previous, state: previous.snapshot ? "stale" : "error", error: error.message }));
    }
  };
  useEffect(() => { mounted.current = true; void refresh(); return () => { mounted.current = false; sequence.current += 1; }; }, []);
  // A newly initialized phase permits a fresh journal read without replacing any retained command.
  const previousPhaseAvailability = useRef(phaseSnapshot?.availability);
  useEffect(() => {
    if (previousPhaseAvailability.current !== "available" && phaseSnapshot?.availability === "available" && !blocked) void refresh();
    previousPhaseAvailability.current = phaseSnapshot?.availability;
  }, [phaseSnapshot?.availability, blocked]);
  const run = async (command, reconciliation = false) => {
    if (inFlight.current) return;
    inFlight.current = true; sequence.current += 1;
    setMutation({ state: reconciliation ? "reconciliation" : "submitting", command, receipt: null, error: "" });
    try {
      const result = await applyEventOperatingWorkCommand({ ...scope, ...command });
      if (!mounted.current) return;
      sequence.current += 1;
      setMutation({ state: "receipt", command: null, receipt: result.receipt, error: "" }); setSelection(null);
      if (reconciliation || result.idempotent === true) { setRead({ state: "loading", snapshot: null, error: "" }); await refresh(); }
      else setRead({ state: "success", snapshot: result.snapshot, error: "" });
    } catch (error) {
      if (!mounted.current) return;
      setMutation({ state: error.code === "event-mutation-blocked" ? "ready" : isDefinitiveEventWorkError(error) ? "error" : "uncertain", command: error.code === "event-mutation-blocked" ? null : command, receipt: null, error: error.message });
    } finally { inFlight.current = false; }
  };
  const sourceMatches = phaseSnapshot?.sourceVersionId === read.snapshot?.sourceVersionId && phaseSnapshot?.acceptanceReceiptId === read.snapshot?.acceptanceReceiptId;
  const canWrite = eligible && role === "admin" && phaseReadState === "success" && phaseSnapshot?.availability === "available" && sourceMatches && ["empty", "success"].includes(read.state) && read.snapshot?.reasonCode !== "phase_ledger_missing";
  const disabled = blocked || phaseMutationBlocked || !canWrite;
  const choose = (target) => { if (!disabled) { focusEditorRequested.current = true; setSelection({ ...target, note: "", ...(target.command === "issue_open" ? { severity: "normal" } : {}) }); } };
  const submit = (event) => {
    event.preventDefault();
    if (disabled || inFlight.current || !selection) return;
    const command = { organizationId, quoteId, sourceVersionId: read.snapshot.sourceVersionId, acceptanceReceiptId: read.snapshot.acceptanceReceiptId, requestId: createEventWorkRequestId(), workPolicyVersion: 1, expectedWorkRevision: read.snapshot.revision, command: selection.command, note: selection.note };
    if (selection.checkpointCode) command.checkpointCode = selection.checkpointCode;
    if (selection.issueId) command.issueId = selection.issueId;
    if (selection.command === "issue_open") command.severity = selection.severity;
    void run(command);
  };
  const review = async () => {
    if (!resetDefinitiveEventWorkCommand(scope)) return;
    setMutation({ state: "recovery", command: null, receipt: null, error: "" }); setSelection(null);
    await refresh(); if (mounted.current) setMutation({ state: "ready", command: null, receipt: null, error: "" });
  };
  if (!eligible) return <State state="recovery" channel="read"><p>Event checkpoints and issues require an enabled connected workspace and authorized staff access.</p></State>;
  return <section aria-label="Event checkpoints and issues" data-capability-id="event-operating-work-journal" style={{ marginTop: "1.5rem", minWidth: 0, overflowWrap: "anywhere" }} aria-busy={busy}>
    <h3>Checkpoints and issues</h3>
    <p className="source-note">These are operator records. They do not confirm readiness, attendance, staffing, payment, or completion of the event phase.</p>
    <button type="button" className="ghost" disabled={blocked || phaseMutationBlocked || read.state === "loading"} onClick={() => void refresh()}>Refresh event work</button>
    <State state={read.state} channel="read">
      {read.state === "loading" && <p role="status">Loading checkpoints and issues...</p>}
      {read.state === "empty" && <p role="status">{read.snapshot?.reasonCode === "phase_ledger_missing" ? "Record the event prepared phase before recording checkpoints or issues." : "No checkpoint or issue changes have been recorded."}</p>}
      {read.error && <p role="alert" className="error-note">{read.error}</p>}
    </State>
    {phaseMutationBlocked && <p role="status" className="source-note">Check the existing event request before changing checkpoints or issues. An original work request can still be reconciled below.</p>}
    {read.snapshot && <>
      <h4>Checkpoints</h4>
      <ul className="command-center-list" aria-label="Operational checkpoints">{read.snapshot.checkpoints.map((item) => <li key={item.code} className="command-center-row" style={{ minWidth: 0 }}>
        <div><strong>{NAMES[item.code]}</strong><p className="source-note">{STATE_LABELS[item.state]}{item.note ? ` · ${item.note}` : ""}</p></div>
        {role === "admin" && <button type="button" className="ghost" disabled={disabled} onClick={() => choose({ command: item.state === "recorded" ? "checkpoint_reopen" : "checkpoint_record", checkpointCode: item.code })}>{item.state === "recorded" ? "Reopen" : "Record"} {NAMES[item.code]}</button>}
      </li>)}</ul>
      <h4>Issues</h4>
      {read.snapshot.issues.length === 0 && <p className="source-note">No issues recorded. This is not confirmation that the event has no issues.</p>}
      <ul className="command-center-list" aria-label="Recorded event issues">{read.snapshot.issues.map((issue) => <li key={issue.issueId} className="command-center-row" style={{ minWidth: 0 }}>
        <div><strong>{issue.description}</strong><p className="source-note">{STATE_LABELS[issue.state]} · {issue.severity === "urgent" ? "Urgent" : "Normal"}</p>{issue.latestNote !== issue.description && <p className="source-note">Latest note: {issue.latestNote}</p>}</div>
        {role === "admin" && <button type="button" className="ghost" disabled={disabled} onClick={() => choose({ command: issue.state === "open" ? "issue_resolve" : "issue_reopen", issueId: issue.issueId })}>{issue.state === "open" ? "Resolve" : "Reopen"} issue</button>}
      </li>)}</ul>
      {role === "admin" && <button type="button" className="ghost" disabled={disabled || read.snapshot.issues.length >= 25} onClick={() => choose({ command: "issue_open" })}>Open issue</button>}
      <p className="source-note">{read.snapshot.issues.length} of 25 retained issues. Resolved issues remain in this journal.</p>
      <State state="partial" channel="read"><p className="source-note">History coverage: latest work receipt only.</p></State>
      <details className="staff-evidence-disclosure"><summary>Work source and latest receipt</summary><p>Accepted source: {read.snapshot.sourceVersionId}</p><p>Acceptance receipt: {read.snapshot.acceptanceReceiptId}</p>{read.snapshot.latestReceipt && <p>Latest work receipt: {read.snapshot.latestReceipt.receiptId}. Recorded at {read.snapshot.latestReceipt.recordedAtISO}.</p>}<p>Replay reads earlier operational receipts for this accepted source.</p></details>
    </>}
    {role === "sales" ? <p className="source-note">An administrator records checkpoints and issues. Your access is read-only.</p> : <State state={mutation.state} channel="mutation">
      {selection && <form onSubmit={submit} style={{ marginTop: "1rem" }} aria-label="Review event work change">
        <h4>{selectionLabel(selection)}</h4>
        <label> {selection.command === "issue_open" ? "Issue description" : selection.command === "checkpoint_record" ? "Checkpoint note (optional)" : "Reason for this change"}
          <textarea ref={editorRef} rows={3} value={selection.note} maxLength={240} required={selection.command !== "checkpoint_record"} disabled={disabled} onChange={(event) => setSelection((previous) => ({ ...previous, note: event.target.value }))} />
        </label>
        {selection.command === "issue_open" && <label>Severity<select value={selection.severity} disabled={disabled} onChange={(event) => setSelection((previous) => ({ ...previous, severity: event.target.value }))}><option value="normal">Normal</option><option value="urgent">Urgent</option></select></label>}
        <div className="right-actions" style={{ marginTop: "0.75rem" }}><button type="submit" className="cta" disabled={disabled || (selection.command !== "checkpoint_record" && !selection.note.trim())}>Save work change</button><button type="button" className="ghost" disabled={blocked} onClick={() => setSelection(null)}>Keep current records</button></div>
      </form>}
      <div ref={outcomeRef} tabIndex={-1} role="group" aria-label="Event work outcome">
      {busy && <p role="status">{mutation.state === "reconciliation" ? "Checking the original work request..." : "Recording event work..."}</p>}
      {mutation.error && <p role="alert" className="error-note">{mutation.error}</p>}
      {mutation.state === "uncertain" && <><p>No result is confirmed. The original request remains unchanged.</p><button type="button" className="cta" onClick={() => void run(mutation.command, true)}>Check original work request</button></>}
      {mutation.state === "error" && <button type="button" className="ghost" onClick={() => void review()}>Refresh and review work</button>}
      {mutation.state === "recovery" && <p role="status">Refreshing current work evidence before another action.</p>}
      {mutation.receipt && <p role="status">Work change recorded. Receipt: {mutation.receipt.receiptId}.</p>}
      </div>
    </State>}
  </section>;
}
