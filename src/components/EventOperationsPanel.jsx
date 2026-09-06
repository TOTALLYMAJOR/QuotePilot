import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  applyEventOperatingCommand,
  createEventOperatingRequestId,
  getEventOperatingSnapshot,
  isDefinitiveEventOperatingError,
  readPendingEventOperatingCommand,
  resetDefinitiveEventOperatingCommand
} from "../lib/eventOperationsClient";

import EventWorkflowPolicyPanel from "./EventWorkflowPolicyPanel";
import EventOperatingActualsPanel from "./EventOperatingActualsPanel";
import EventOperatingWorkPanel from "./EventOperatingWorkPanel";
import { readEventOperatingMutationGuard, subscribeEventOperatingMutations } from "../lib/eventOperatingMutationGuard";

const LABELS = { prepared: "Prepared", in_progress: "In progress", completed: "Completed" };
const NEXT = { prepared: "in_progress", in_progress: "completed" };
const ACTION = { prepared: "Record event prepared", in_progress: "Start event", completed: "Complete event" };

export function EventOperationsState({ state, channel, children }) {
  const common = { "data-capability-id": "event-operating-spine", "data-capability-channel": channel };
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

export default function EventOperationsPanel(props) {
  return <EventOperationsPanelContent key={JSON.stringify([props.organizationId, props.quoteId, props.principalId, props.role, props.source, props.enabled, props.quoteStatus, props.sourceVersionId, props.acceptanceReceiptId])} {...props} />;
}

function EventOperationsPanelContent({ organizationId, quoteId, principalId, role, source, enabled, quoteStatus, sourceVersionId = "", acceptanceReceiptId = "" }) {
  const eligible = enabled === true && source === "firebase" && ["admin", "sales"].includes(role) && quoteStatus === "booked" && Boolean(organizationId && quoteId && principalId);
  const identity = JSON.stringify([organizationId, quoteId, principalId, role, source, enabled, quoteStatus, sourceVersionId, acceptanceReceiptId]);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const requestSequence = useRef(0);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [read, setRead] = useState({ state: "loading", snapshot: null, error: "" });
  const [mutation, setMutation] = useState({ state: "ready", command: null, error: "", receipt: null });
  const scope = { organizationId, quoteId, principalId };
  const [workPanelBlocked, setWorkPanelBlocked] = useState(false);
  const [actualsPanelBlocked, setActualsPanelBlocked] = useState(false);
  const [workflowPanelBlocked, setWorkflowPanelBlocked] = useState(false);
  const [initializationEligible, setInitializationEligible] = useState(false);
  const subscribe = useCallback((listener) => subscribeEventOperatingMutations({ organizationId, quoteId, principalId }, listener), [organizationId, quoteId, principalId]);
  const getGuard = useCallback(() => readEventOperatingMutationGuard({ organizationId, quoteId, principalId }), [organizationId, quoteId, principalId]);
  const guard = useSyncExternalStore(subscribe, getGuard, getGuard);
  const workBlocked = workPanelBlocked || guard?.owner === "work";
  const actualsBlocked = actualsPanelBlocked || guard?.owner === "actuals";
  const workflowBlocked = workflowPanelBlocked || guard?.owner === "workflow";
  const initializationBlocked = read.snapshot?.availability === "not_yet_available" && !initializationEligible;
  const refresh = async () => {
    if (!eligible) return;
    const sequence = ++requestSequence.current;
    setRead((previous) => ({ ...previous, state: "loading", error: "" }));
    try {
      const result = await getEventOperatingSnapshot({ organizationId, quoteId });
      if (!mounted.current || currentIdentity.current !== identity || requestSequence.current !== sequence) return;
      setRead({ state: result.snapshot.availability === "not_yet_available" ? "empty" : "success", snapshot: result.snapshot, error: "" });
    } catch (error) {
      if (!mounted.current || currentIdentity.current !== identity || requestSequence.current !== sequence) return;
      setRead((previous) => ({ ...previous, state: previous.snapshot ? "stale" : "error", error: error.message }));
    }
  };
  useEffect(() => {
    setRead({ state: "loading", snapshot: null, error: "" });
    const retained = eligible ? readPendingEventOperatingCommand(scope) : null;
    setMutation(retained ? { state: retained.definitive ? "error" : "uncertain", command: retained.command, error: "An earlier request still needs review.", receipt: null } : { state: "ready", command: null, error: "", receipt: null });
    void refresh();
    return () => { requestSequence.current += 1; };
  }, [identity]); // Each read is bound to this exact route, principal, role, and source.

  const run = async (command, reconciliation = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    requestSequence.current += 1;
    const commandIdentity = identity;
    setMutation({ state: reconciliation ? "reconciliation" : "submitting", command, receipt: null, error: "" });
    try {
      const result = await applyEventOperatingCommand({ ...scope, ...command });
      if (!mounted.current || currentIdentity.current !== commandIdentity) return;
      requestSequence.current += 1;
      setMutation({ state: "receipt", command: null, receipt: result.receipt, error: "" });
      if (reconciliation || result.idempotent === true) {
        setRead({ state: "loading", snapshot: null, error: "" });
        await refresh();
      } else {
        setRead({ state: "success", snapshot: result.snapshot, error: "" });
      }
    } catch (error) {
      if (!mounted.current || currentIdentity.current !== commandIdentity) return;
      setMutation({ state: error.code === "event-mutation-blocked" ? "ready" : isDefinitiveEventOperatingError(error) ? "error" : "uncertain", command: error.code === "event-mutation-blocked" ? null : command, receipt: null, error: error.message });
    } finally { inFlight.current = false; }
  };
  const busy = ["submitting", "reconciliation"].includes(mutation.state);
  const blocked = busy || ["uncertain", "error", "recovery"].includes(mutation.state);
  const targetPhase = read.snapshot?.availability === "not_yet_available" ? "prepared" : NEXT[read.snapshot?.phase];
  const submit = () => {
    if (role !== "admin" || inFlight.current || blocked || workBlocked || actualsBlocked || workflowBlocked || initializationBlocked || !["empty", "success"].includes(read.state) || !targetPhase) return;
    const record = read.snapshot;
    void run({ organizationId, quoteId, sourceVersionId: record.sourceVersionId, acceptanceReceiptId: record.acceptanceReceiptId, requestId: createEventOperatingRequestId(), command: record.revision === 0 ? "initialize" : "transition", expectedLedgerRevision: record.revision, targetPhase });
  };
  const review = async () => {
    if (!resetDefinitiveEventOperatingCommand(scope)) return;
    setMutation({ state: "recovery", command: null, receipt: null, error: "" });
    await refresh();
    if (currentIdentity.current === identity) setMutation({ state: "ready", command: null, receipt: null, error: "" });
  };

  if (!eligible) return <EventOperationsState state="recovery" channel="read"><p className="source-note">Event operations are unavailable for this record. A connected, enabled workspace, authorized staff role, and exact booked source are required.</p></EventOperationsState>;
  return (
    <section className="live-ops-focus-card" style={{ minWidth: 0, overflowWrap: "anywhere" }} aria-label="Recorded event operations" data-capability-id="event-operating-spine" aria-busy={busy}>
      <h3>Recorded event operations</h3>
      <EventWorkflowPolicyPanel organizationId={organizationId} quoteId={quoteId} principalId={principalId} role={role} source={source} enabled={eligible} sourceVersionId={sourceVersionId} acceptanceReceiptId={acceptanceReceiptId} phaseSnapshot={read.snapshot} phaseReadState={read.state} otherMutationBlocked={blocked || workBlocked || actualsBlocked || guard?.owner === "phase"} onWorkflowMutationBlockedChange={setWorkflowPanelBlocked} onInitializationEligibilityChange={setInitializationEligible} />
      <button type="button" className="ghost" disabled={blocked || workBlocked || actualsBlocked || workflowBlocked || read.state === "loading"} onClick={() => void refresh()}>Refresh phase</button>
      <p className="source-note">Record the event phase against its accepted source. This does not change the quote, payment, staffing, or event readiness.</p>
      <EventOperationsState state={read.state} channel="read">
        {read.state === "loading" && <p role="status">Loading this event’s recorded phase...</p>}
        {read.state === "empty" && <p role="status">No event phase has been recorded.</p>}
        {read.snapshot?.phase && <p>Recorded phase: <strong>{LABELS[read.snapshot.phase]}</strong></p>}
        {read.error && <p className="error-note" role="alert">{read.error}</p>}
        {["error", "stale"].includes(read.state) && <button type="button" className="ghost" disabled={blocked} onClick={() => void refresh()}>Refresh event evidence</button>}
      </EventOperationsState>
      {read.snapshot && <details className="staff-evidence-disclosure"><summary>Accepted source and history coverage</summary><p>Source revision: {read.snapshot.sourceVersionId}</p><p>Acceptance receipt: {read.snapshot.acceptanceReceiptId}</p>{read.snapshot.latestReceipt && <p>Latest receipt: {read.snapshot.latestReceipt.receiptId}. {LABELS[read.snapshot.latestReceipt.resultPhase]} recorded at {read.snapshot.latestReceipt.recordedAtISO}.</p>}<p>Only the latest event receipt is available here. Replay reads earlier operational receipts for this accepted source.</p></details>}
      {read.snapshot && <EventOperationsState state="partial" channel="read"><p className="source-note">History coverage: latest receipt only.</p></EventOperationsState>}
      {(workBlocked || actualsBlocked || workflowBlocked) && <p role="status" className="source-note">Check the existing checkpoint, issue, actuals, or coordination request before changing the event phase.</p>}
      {role === "sales" ? <p className="source-note">An administrator records phase changes. Your access is read-only.</p> : <EventOperationsState state={mutation.state} channel="mutation">
        {busy && <p role="status">{mutation.state === "reconciliation" ? "Checking the original event request..." : "Recording event phase..."}</p>}
        {mutation.error && <p className="error-note" role="alert">{mutation.error}</p>}
        {mutation.state === "uncertain" && <><p>No result is confirmed. Keep this request unchanged while its status is checked.</p><button type="button" className="cta" onClick={() => void run(mutation.command, true)}>Check original request</button></>}
        {mutation.state === "error" && <button type="button" className="ghost" onClick={() => void review()}>Refresh and review</button>}
        {mutation.state === "recovery" && <p role="status">Refreshing evidence before another action.</p>}
        {mutation.receipt && <p role="status">{LABELS[mutation.receipt.resultPhase]} recorded. Receipt: {mutation.receipt.receiptId}</p>}
        {targetPhase && <button type="button" className="cta" disabled={blocked || workBlocked || actualsBlocked || workflowBlocked || initializationBlocked || !["empty", "success"].includes(read.state)} onClick={submit}>{ACTION[targetPhase]}</button>}
      </EventOperationsState>}
      <EventOperatingWorkPanel organizationId={organizationId} quoteId={quoteId} principalId={principalId} role={role} source={source} enabled={eligible} sourceVersionId={sourceVersionId} acceptanceReceiptId={acceptanceReceiptId} phaseSnapshot={read.snapshot} phaseReadState={read.state} phaseMutationBlocked={blocked || guard?.owner === "phase" || actualsBlocked || workflowBlocked} onWorkMutationBlockedChange={setWorkPanelBlocked} />
      <EventOperatingActualsPanel organizationId={organizationId} quoteId={quoteId} principalId={principalId} role={role} source={source} enabled={eligible} sourceVersionId={sourceVersionId} acceptanceReceiptId={acceptanceReceiptId} phaseSnapshot={read.snapshot} phaseReadState={read.state} otherMutationBlocked={blocked || guard?.owner === "phase" || workBlocked || workflowBlocked} onActualsMutationBlockedChange={setActualsPanelBlocked} />
    </section>
  );
}
