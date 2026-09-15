import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  applyEventOperationalNoteCommand,
  createEventOperationalNoteRequestId,
  getEventOperationalNotesSnapshot,
  isDefinitiveEventOperationalNotesError,
  readPendingEventOperationalNoteCommand,
  resetDefinitiveEventOperationalNoteCommand
} from "../lib/eventOperationalNotesClient";

const TYPES = Object.freeze([
  ["kitchen", "Kitchen"],
  ["venue", "Venue"],
  ["service", "Service"],
  ["staffing", "Staffing"]
]);
const VISIBILITIES = Object.freeze([
  ["internal", "Internal team only"],
  ["beo_visible", "Include in the BEO"]
]);
const TYPE_LABELS = Object.fromEntries(TYPES);
const VISIBILITY_LABELS = Object.fromEntries(VISIBILITIES);
const BLOCKING_STATES = new Set([
  "submitting",
  "reconciliation",
  "uncertain",
  "error",
  "recovery"
]);

function CapabilityState({ state, channel, children }) {
  return <div
    data-capability-id="event-operational-notes"
    data-capability-channel={channel}
    data-capability-state={state}
  >{children}</div>;
}

function formatRecordedAt(value) {
  if (!value) return "Time unavailable";
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  } catch {
    return "Time unavailable";
  }
}

function blankEditor() {
  return { mode: "add", noteId: "", expectedNoteRevision: 0, type: "kitchen", visibility: "internal", text: "", reason: "" };
}

export default function EventOperationalNotesPanel(props) {
  const identity = JSON.stringify([
    props.organizationId,
    props.quoteId,
    props.principalId,
    props.role,
    props.source,
    props.enabled,
    props.sourceVersionId
  ]);
  return <NotesPanel key={identity} {...props} />;
}

function NotesPanel({
  organizationId,
  quoteId,
  principalId,
  role,
  source,
  enabled,
  sourceVersionId,
  onNotesMutationBlockedChange,
  onOpenProductionChecklist,
  onChanged
}) {
  const eligible = enabled === true
    && source === "firebase"
    && ["admin", "sales"].includes(role)
    && Boolean(organizationId && quoteId && principalId && sourceVersionId);
  const scope = { organizationId, quoteId, principalId };
  const mounted = useRef(true);
  const sequence = useRef(0);
  const inFlight = useRef(false);
  const editorRef = useRef(null);
  const focusEditorRequested = useRef(false);
  const outcomeRef = useRef(null);
  const previousMutationState = useRef("ready");
  const [initialPending] = useState(() => eligible ? readPendingEventOperationalNoteCommand(scope) : null);
  const [read, setRead] = useState({ state: "loading", snapshot: null, consequences: [], error: "" });
  const [editor, setEditor] = useState(() => initialPending?.command
    ? {
        mode: initialPending.command.command,
        noteId: initialPending.command.noteId || "",
        expectedNoteRevision: initialPending.command.expectedNoteRevision || 0,
        type: initialPending.command.type || "kitchen",
        visibility: initialPending.command.visibility || "internal",
        text: initialPending.command.text || "",
        reason: initialPending.command.reason || ""
      }
    : blankEditor());
  const [mutation, setMutation] = useState(() => initialPending
    ? {
        state: initialPending.definitive ? "error" : "uncertain",
        command: initialPending.command,
        receipt: null,
        error: "The original note request still needs review."
      }
    : { state: "ready", command: null, receipt: null, error: "" });

  const blocked = BLOCKING_STATES.has(mutation.state);
  const busy = ["submitting", "reconciliation"].includes(mutation.state);
  const sourceStale = read.snapshot?.reasonCode === "source_revision_review_required";
  const canUseCurrentRead = ["empty", "success"].includes(read.state);
  const canWrite = eligible && canUseCurrentRead && !blocked;

  useEffect(() => {
    onNotesMutationBlockedChange?.(blocked);
  }, [blocked, onNotesMutationBlockedChange]);

  useLayoutEffect(() => {
    if (previousMutationState.current !== mutation.state
      && ["receipt", "error", "recovery", "uncertain"].includes(mutation.state)) {
      outcomeRef.current?.focus();
    }
    previousMutationState.current = mutation.state;
  }, [mutation.state]);

  useLayoutEffect(() => {
    if (focusEditorRequested.current) {
      focusEditorRequested.current = false;
      editorRef.current?.focus();
    }
  }, [editor.mode, editor.noteId]);

  async function refresh() {
    if (!eligible) return;
    const token = ++sequence.current;
    setRead((current) => ({ ...current, state: "loading", error: "" }));
    try {
      const result = await getEventOperationalNotesSnapshot({ organizationId, quoteId, sourceVersionId });
      if (!mounted.current || sequence.current !== token) return;
      const snapshot = result.snapshot;
      setRead({
        state: snapshot.reasonCode === "source_revision_review_required"
          ? "stale"
          : snapshot.notes.length === 0 ? "empty" : "success",
        snapshot,
        consequences: result.consequences,
        error: ""
      });
    } catch (error) {
      if (!mounted.current || sequence.current !== token) return;
      setRead((current) => ({
        ...current,
        state: current.snapshot ? "stale" : "error",
        error: error.message
      }));
    }
  }

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      sequence.current += 1;
    };
  }, []);

  async function run(command, { reconcile = false } = {}) {
    if (inFlight.current) return;
    inFlight.current = true;
    sequence.current += 1;
    setMutation({
      state: reconcile ? "reconciliation" : "submitting",
      command,
      receipt: null,
      error: ""
    });
    try {
      const result = await applyEventOperationalNoteCommand({ ...scope, ...command });
      if (!mounted.current) return;
      sequence.current += 1;
      setRead({
        state: result.snapshot.reasonCode === "source_revision_review_required"
          ? "stale"
          : result.snapshot.notes.length === 0 ? "empty" : "success",
        snapshot: result.snapshot,
        consequences: result.consequences,
        error: ""
      });
      setMutation({ state: "receipt", command: null, receipt: result.receipt, error: "" });
      setEditor(blankEditor());
      try {
        onChanged?.(result);
      } catch {
        // Presentation callbacks cannot invalidate an authoritative receipt.
      }
    } catch (error) {
      if (!mounted.current) return;
      setMutation({
        state: isDefinitiveEventOperationalNotesError(error) ? "error" : "uncertain",
        command,
        receipt: null,
        error: error.message
      });
    } finally {
      inFlight.current = false;
    }
  }

  function submit(event) {
    event.preventDefault();
    if (!canWrite || inFlight.current || !editor.text.trim()) return;
    const command = {
      requestId: createEventOperationalNoteRequestId(),
      notesPolicyVersion: 1,
      expectedJournalRevision: read.snapshot.journalRevision,
      sourceVersionId,
      command: editor.mode,
      type: editor.type,
      visibility: editor.visibility,
      text: editor.text
    };
    if (editor.mode === "correct") {
      command.noteId = editor.noteId;
      command.expectedNoteRevision = editor.expectedNoteRevision;
      command.reason = editor.reason;
    }
    void run(command);
  }

  function beginCorrection(note) {
    if (!canWrite) return;
    focusEditorRequested.current = true;
    setEditor({
      mode: "correct",
      noteId: note.noteId,
      expectedNoteRevision: note.noteRevision,
      type: note.type,
      visibility: note.visibility,
      text: note.text,
      reason: ""
    });
  }

  function cancelCorrection() {
    if (blocked) return;
    focusEditorRequested.current = true;
    setEditor(blankEditor());
  }

  function reviewForCurrentRevision() {
    if (!eligible || !sourceStale || blocked || inFlight.current) return;
    void run({
      requestId: createEventOperationalNoteRequestId(),
      notesPolicyVersion: 1,
      expectedJournalRevision: read.snapshot.journalRevision,
      sourceVersionId,
      command: "review_for_revision",
      priorSourceVersionId: read.snapshot.sourceVersionId
    });
  }

  async function recover() {
    if (!resetDefinitiveEventOperationalNoteCommand(scope)) return;
    setMutation({ state: "recovery", command: null, receipt: null, error: "" });
    await refresh();
    if (mounted.current) setMutation({ state: "ready", command: null, receipt: null, error: "" });
  }

  if (!eligible) {
    return <CapabilityState state="recovery" channel="read">
      <p>Operational notes require an enabled connected workspace, a current quote revision, and authorized staff access.</p>
    </CapabilityState>;
  }

  const notes = read.snapshot?.notes || [];
  const eventBriefReview = read.consequences.find((item) => item.code === "event_brief_review_required") || null;
  const readSurfaceState = eventBriefReview
    && !onOpenProductionChecklist
    && ["empty", "success"].includes(read.state)
    ? "partial"
    : read.state;
  const atLimit = notes.length >= 12;
  const textRemaining = 800 - editor.text.length;

  return <section
    aria-label="Event operational notes"
    data-capability-id="event-operational-notes"
    data-event-operational-notes-panel="true"
    aria-busy={busy}
    style={{ marginTop: "1.5rem", minWidth: 0, overflowWrap: "anywhere" }}
  >
    <div className="command-center-row" style={{ alignItems: "start", minWidth: 0 }}>
      <div>
        <h3>Event notes</h3>
        <p className="source-note">Keep kitchen, venue, service, and staffing instructions together. Only notes marked for the BEO can change that document.</p>
      </div>
      <button
        type="button"
        className="ghost"
        style={{ minHeight: 44 }}
        disabled={blocked || read.state === "loading"}
        onClick={() => void refresh()}
      >Refresh notes</button>
    </div>

    <CapabilityState state={readSurfaceState} channel="read">
      {read.state === "loading" && <p role="status">Loading event notes...</p>}
      {read.state === "empty" && <p role="status">No event notes yet. Add only the instruction the team needs next.</p>}
      {readSurfaceState === "partial" && <p role="status">Event notes are current, but this view cannot open the required event-brief review. Open Event schedule to continue.</p>}
      {read.error && <p role="alert" className="error-note">{read.error}</p>}
    </CapabilityState>

    {sourceStale && <CapabilityState state="stale" channel="source">
      <div className="notice warning-note">
        <strong>Review notes for this quote revision</strong>
        <p>These notes are bound to an earlier quote revision. Confirm them together before they are used for the current BEO or changed.</p>
        <button
          type="button"
          className="cta"
          style={{ minHeight: 44 }}
          disabled={blocked}
          onClick={reviewForCurrentRevision}
        >Review notes for this quote revision</button>
      </div>
    </CapabilityState>}

    {eventBriefReview && <CapabilityState state="stale" channel="checklist">
      <div className="notice warning-note">
        <strong>Event brief needs another review</strong>
        <p>These notes changed after the event-brief checklist was recorded. The earlier completion remains in history.</p>
        {onOpenProductionChecklist && <button
          type="button"
          className="cta"
          style={{ minHeight: 44 }}
          disabled={blocked}
          onClick={() => onOpenProductionChecklist(eventBriefReview)}
        >Review event brief again</button>}
      </div>
    </CapabilityState>}

    {read.snapshot && <>
      {notes.length > 0 && <ul className="command-center-list" aria-label="Current event notes">
        {notes.map((note, index) => <li key={note.noteId} className="command-center-row" style={{ alignItems: "start", minWidth: 0 }}>
          <div style={{ minWidth: 0 }}>
            <p><strong>{TYPE_LABELS[note.type]}</strong> · {VISIBILITY_LABELS[note.visibility]}</p>
            <p style={{ whiteSpace: "pre-wrap" }}>{note.text}</p>
            <details className="staff-evidence-disclosure">
              <summary>Note history and source</summary>
              <p>Note revision {note.noteRevision}. Created {formatRecordedAt(note.createdAtISO)}. Last changed {formatRecordedAt(note.updatedAtISO)}.</p>
              <p>{note.reviewState === "reviewed_for_revision" ? `Explicitly reviewed for quote revision ${note.reviewedSourceVersionId} at ${formatRecordedAt(note.reviewedAtISO)}.` : `Authored for quote revision ${read.snapshot.sourceVersionId}; no later review receipt is recorded.`}</p>
              <p>The authoritative journal retains the recording staff and immutable correction receipts. Private actor details are not repeated in this read projection.</p>
              <p>Notes are not deleted from this journal.</p>
            </details>
          </div>
          <button
            type="button"
            className="ghost"
            style={{ minHeight: 44 }}
            disabled={!canWrite}
            aria-label={`Correct ${TYPE_LABELS[note.type].toLowerCase()} note ${index + 1}`}
            onClick={() => beginCorrection(note)}
          >Correct</button>
        </li>)}
      </ul>}
      <p className="source-note">{notes.length} of 12 retained notes. Corrections keep their receipt history; deletion is not available.</p>
    </>}

    {read.snapshot && <CapabilityState state={mutation.state} channel="mutation">
      <form aria-label={editor.mode === "correct" ? "Correct event note" : "Add event note"} onSubmit={submit}>
        <h4>{editor.mode === "correct" ? "Correct note" : "Add a note"}</h4>
        <div className="form-grid">
          <label>Note type
            <select
              aria-label="Note type"
              value={editor.type}
              disabled={blocked}
              style={{ minHeight: 44 }}
              onChange={(event) => setEditor((current) => ({ ...current, type: event.target.value }))}
            >{TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          </label>
          <label>Who can use it
            <select
              aria-label="Note visibility"
              value={editor.visibility}
              disabled={blocked}
              style={{ minHeight: 44 }}
              onChange={(event) => setEditor((current) => ({ ...current, visibility: event.target.value }))}
            >{VISIBILITIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          </label>
        </div>
        <label>Instruction
          <textarea
            ref={editorRef}
            aria-describedby="event-note-count"
            rows={4}
            maxLength={800}
            value={editor.text}
            disabled={blocked}
            placeholder="Example: Use the east loading entrance; venue contact will meet the captain at 3:00 PM."
            onChange={(event) => setEditor((current) => ({ ...current, text: event.target.value }))}
          />
        </label>
        <p id="event-note-count" className="source-note" aria-live="polite">{textRemaining} characters remaining</p>
        {editor.mode === "correct" && <label>Why this note changed
          <textarea
            aria-label="Correction reason"
            rows={2}
            maxLength={800}
            value={editor.reason}
            disabled={blocked}
            onChange={(event) => setEditor((current) => ({ ...current, reason: event.target.value }))}
          />
        </label>}
        <div className="right-actions">
          <button
            type="submit"
            className="cta"
            style={{ minHeight: 44 }}
            disabled={!canWrite || !editor.text.trim() || (editor.mode === "correct" && !editor.reason.trim()) || (editor.mode === "add" && atLimit)}
          >{editor.mode === "correct" ? "Save correction" : "Add note"}</button>
          {editor.mode === "correct" && <button
            type="button"
            className="ghost"
            style={{ minHeight: 44 }}
            disabled={blocked}
            onClick={cancelCorrection}
          >Keep current note</button>}
        </div>
      </form>
      <div ref={outcomeRef} tabIndex={-1} role="group" aria-label="Event note outcome">
        {mutation.state === "submitting" && <p role="status">Recording the note...</p>}
        {mutation.state === "reconciliation" && (
          <p role="status">Checking the original notes request without creating another logical change.</p>
        )}
        {mutation.error && <p role="alert" className="error-note">{mutation.error}</p>}
        {mutation.state === "uncertain" && <>
          <p>No result is confirmed. Your note is still here. Check the original request before submitting another change.</p>
          <button type="button" className="cta" style={{ minHeight: 44 }} onClick={() => void run(mutation.command, { reconcile: true })}>Check original notes request</button>
        </>}
        {mutation.state === "error" && <button type="button" className="ghost" style={{ minHeight: 44 }} onClick={() => void recover()}>Refresh and review notes</button>}
        {mutation.state === "recovery" && <p role="status">Refreshing current notes before another change.</p>}
        {mutation.receipt && <p role="status">Note change recorded. Receipt: {mutation.receipt.receiptId}.</p>}
      </div>
    </CapabilityState>}
  </section>;
}
