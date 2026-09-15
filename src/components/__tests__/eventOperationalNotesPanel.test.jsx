// @vitest-environment jsdom
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import EventOperationalNotesPanel from "../EventOperationalNotesPanel";

const api = vi.hoisted(() => ({
  applyEventOperationalNoteCommand: vi.fn(),
  createEventOperationalNoteRequestId: vi.fn(),
  getEventOperationalNotesSnapshot: vi.fn(),
  isDefinitiveEventOperationalNotesError: vi.fn(),
  readPendingEventOperationalNoteCommand: vi.fn(),
  resetDefinitiveEventOperationalNoteCommand: vi.fn()
}));
vi.mock("../../lib/eventOperationalNotesClient", () => api);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const sourceVersionId = "quote-version-a";
const noteId = `event_note_${"a".repeat(32)}`;
const props = {
  organizationId: "org-a",
  quoteId: "quote-a",
  principalId: "staff-a",
  role: "admin",
  source: "firebase",
  enabled: true,
  sourceVersionId,
  onNotesMutationBlockedChange: vi.fn()
};

function note(overrides = {}) {
  return {
    noteId,
    type: "venue",
    visibility: "internal",
    text: "Use the east loading entrance.",
    noteRevision: 1,
    createdAtISO: "2026-09-13T07:00:00.000Z",
    updatedAtISO: "2026-09-13T07:00:00.000Z",
    reviewState: "reviewed_for_revision",
    reviewedSourceVersionId: sourceVersionId,
    reviewedNoteRevision: 1,
    reviewedAtISO: "2026-09-13T07:05:00.000Z",
    ...overrides
  };
}

function snapshot(notes = [], overrides = {}) {
  return {
    organizationId: "org-a",
    quoteId: "quote-a",
    sourceVersionId,
    activeSourceVersionId: sourceVersionId,
    availability: notes.length ? "available" : "not_yet_available",
    reasonCode: notes.length ? "" : "journal_empty",
    journalRevision: notes.length ? 1 : 0,
    notes,
    latestReceipt: notes.length ? { receiptId: `event_notes_command_${"b".repeat(48)}` } : null,
    ...overrides
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

let host;
let root;

async function render(overrides = {}) {
  await act(async () => root.render(<EventOperationalNotesPanel {...props} {...overrides} />));
}

function button(label) {
  return [...host.querySelectorAll("button")].find((candidate) => candidate.textContent === label || candidate.getAttribute("aria-label") === label);
}

async function click(label) {
  const target = button(label);
  expect(target).toBeTruthy();
  await act(async () => target.click());
}

async function fill(target, value) {
  const node = typeof target === "string" ? host.querySelector(target) : target;
  expect(node).toBeTruthy();
  await act(async () => {
    const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(node, value);
    node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  api.getEventOperationalNotesSnapshot.mockResolvedValue({ snapshot: snapshot(), consequences: [] });
  api.createEventOperationalNoteRequestId.mockReturnValue("event_note_request_00000000-0000-4000-8000-000000000001");
  api.readPendingEventOperationalNoteCommand.mockReturnValue(null);
  api.isDefinitiveEventOperationalNotesError.mockReturnValue(false);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

test("notes journal distinguishes loading, empty, success, and stale read states", async () => {
  const pending = deferred();
  api.getEventOperationalNotesSnapshot.mockReturnValueOnce(pending.promise);
  await render();
  expect(host.innerHTML).toContain('data-capability-state="loading"');
  await act(async () => pending.resolve({ snapshot: snapshot(), consequences: [] }));
  expect(host.innerHTML).toContain('data-capability-state="empty"');
  expect(host.innerHTML).toContain('data-capability-state="ready"');
  expect(host.textContent).toContain("No event notes yet");

  api.getEventOperationalNotesSnapshot.mockResolvedValueOnce({ snapshot: snapshot([note()]), consequences: [] });
  await click("Refresh notes");
  expect(host.innerHTML).toContain('data-capability-state="success"');
  expect(host.textContent).toContain("Use the east loading entrance");

  api.getEventOperationalNotesSnapshot.mockRejectedValueOnce(new Error("Read failed"));
  await click("Refresh notes");
  expect(host.querySelector('[data-capability-channel="read"][data-capability-state="stale"]')).not.toBeNull();
  expect(host.textContent).toContain("Read failed");
});

test("stale note journal is one visible revision action with no hidden BEO claim", async () => {
  const priorSourceVersionId = "quote-version-prior";
  const retainedNote = note({ reviewedSourceVersionId: priorSourceVersionId });
  api.getEventOperationalNotesSnapshot.mockResolvedValueOnce({ snapshot: snapshot([retainedNote], { sourceVersionId: priorSourceVersionId, reasonCode: "source_revision_review_required" }), consequences: [] });
  await render();
  expect(host.innerHTML).toContain('data-capability-state="stale"');
  expect(host.textContent).toContain("before they are used for the current BEO");
  expect(button("Correct venue note 1").disabled).toBe(true);

  api.applyEventOperationalNoteCommand.mockResolvedValueOnce({ snapshot: snapshot([note()]), receipt: { receiptId: "review-receipt" }, consequences: [] });
  await click("Review notes for this quote revision");
  expect(api.applyEventOperationalNoteCommand).toHaveBeenCalledWith(expect.objectContaining({
    command: "review_for_revision",
    sourceVersionId,
    expectedJournalRevision: 1,
    priorSourceVersionId
  }));
});

test("adding a note uses familiar type and audience controls with an 800-character boundary", async () => {
  await render();
  await fill('select[aria-label="Note type"]', "staffing");
  await fill('select[aria-label="Note visibility"]', "beo_visible");
  const textarea = host.querySelector('textarea[aria-describedby="event-note-count"]');
  await fill(textarea, "Captain parks at the east dock.");
  expect(host.textContent).toContain("769 characters remaining");
  const pending = deferred();
  api.applyEventOperationalNoteCommand.mockReturnValueOnce(pending.promise);
  await click("Add note");
  expect(host.innerHTML).toContain('data-capability-state="submitting"');
  expect(api.applyEventOperationalNoteCommand).toHaveBeenCalledWith(expect.objectContaining({
    command: "add",
    type: "staffing",
    visibility: "beo_visible",
    text: "Captain parks at the east dock.",
    notesPolicyVersion: 1
  }));
  await act(async () => pending.resolve({ snapshot: snapshot([note({ type: "staffing", visibility: "beo_visible", text: "Captain parks at the east dock.", reviewState: "pending", reviewedSourceVersionId: "", reviewedNoteRevision: null, reviewedAtISO: "" })]), receipt: { receiptId: "add-receipt" }, consequences: [] }));
  expect(host.innerHTML).toContain('data-capability-state="receipt"');
  expect(host.textContent).toContain("add-receipt");
  expect(document.activeElement).toBe(host.querySelector('[aria-label="Event note outcome"]'));
});

test("uncertain and deterministic failures preserve the editor and offer explicit recovery", async () => {
  await render();
  await fill('textarea[aria-describedby="event-note-count"]', "Keep this exact draft.");
  api.applyEventOperationalNoteCommand.mockRejectedValueOnce(new Error("No result"));
  await click("Add note");
  expect(host.innerHTML).toContain('data-capability-state="uncertain"');
  expect(host.querySelector('textarea[aria-describedby="event-note-count"]').value).toBe("Keep this exact draft.");
  expect(props.onNotesMutationBlockedChange).toHaveBeenLastCalledWith(true);

  const original = api.applyEventOperationalNoteCommand.mock.calls[0][0];
  const checking = deferred();
  api.applyEventOperationalNoteCommand.mockReturnValueOnce(checking.promise);
  await click("Check original notes request");
  expect(host.innerHTML).toContain('data-capability-state="reconciliation"');
  expect(api.applyEventOperationalNoteCommand.mock.calls[1][0]).toEqual(original);
  await act(async () => checking.reject(new Error("Still unknown")));

  await render({ quoteId: "quote-b" });
  await fill('textarea[aria-describedby="event-note-count"]', "Keep this after rejection.");
  api.isDefinitiveEventOperationalNotesError.mockReturnValueOnce(true);
  api.applyEventOperationalNoteCommand.mockRejectedValueOnce(new Error("Changed"));
  await click("Add note");
  expect(host.innerHTML).toContain('data-capability-state="error"');
  expect(host.querySelector('textarea[aria-describedby="event-note-count"]').value).toBe("Keep this after rejection.");
  api.resetDefinitiveEventOperationalNoteCommand.mockReturnValueOnce(true);
  const refreshed = deferred();
  api.getEventOperationalNotesSnapshot.mockReturnValueOnce(refreshed.promise);
  await click("Refresh and review notes");
  expect(host.innerHTML).toContain('data-capability-state="recovery"');
  await act(async () => refreshed.resolve({ snapshot: snapshot(), consequences: [] }));
});

test("correction keeps history, requires a reason, and never offers deletion", async () => {
  api.getEventOperationalNotesSnapshot.mockResolvedValueOnce({ snapshot: snapshot([note()]), consequences: [] });
  await render();
  const details = host.querySelector("details");
  expect(details.open).toBe(false);
  expect(details.textContent).toContain("authoritative journal retains the recording staff");
  await click("Correct venue note 1");
  expect(document.activeElement).toBe(host.querySelector('textarea[aria-describedby="event-note-count"]'));
  await fill('textarea[aria-describedby="event-note-count"]', "Use the west loading entrance.");
  expect(button("Save correction").disabled).toBe(true);
  await fill('textarea[aria-label="Correction reason"]', "Venue changed the access plan.");
  api.applyEventOperationalNoteCommand.mockResolvedValueOnce({ snapshot: snapshot([note({ text: "Use the west loading entrance.", noteRevision: 2 })]), receipt: { receiptId: "correction-receipt" }, consequences: [] });
  await click("Save correction");
  expect(api.applyEventOperationalNoteCommand).toHaveBeenCalledWith(expect.objectContaining({
    command: "correct",
    noteId,
    expectedNoteRevision: 1,
    reason: "Venue changed the access plan."
  }));
  expect(host.textContent).not.toContain("Delete");
});

test("one note consequence routes to checklist review without changing completion", async () => {
  const onOpenProductionChecklist = vi.fn();
  const consequence = {
    code: "event_brief_review_required",
    sourceUpdatedAtISO: "2026-09-13T07:00:00.000Z",
    checklistCompletedAtISO: "2026-09-13T06:00:00.000Z"
  };
  api.getEventOperationalNotesSnapshot.mockResolvedValueOnce({ snapshot: snapshot([note()]), consequences: [consequence] });
  await render({ onOpenProductionChecklist });
  expect(host.querySelector('[data-capability-channel="checklist"][data-capability-state="stale"]')).not.toBeNull();
  expect(host.textContent).toContain("earlier completion remains in history");
  await click("Review event brief again");
  expect(onOpenProductionChecklist).toHaveBeenCalledWith(consequence);
  expect(api.applyEventOperationalNoteCommand).not.toHaveBeenCalled();
});

test("a loaded journal is partial when its required checklist handoff is unavailable", async () => {
  api.getEventOperationalNotesSnapshot.mockResolvedValueOnce({
    snapshot: snapshot([note()]),
    consequences: [{
      code: "event_brief_review_required",
      sourceUpdatedAtISO: "2026-09-13T07:00:00.000Z",
      checklistCompletedAtISO: "2026-09-13T06:00:00.000Z"
    }]
  });
  await render();
  expect(host.innerHTML).toContain('data-capability-state="partial"');
  expect(host.textContent).toContain("Open Event schedule to continue");
});

test("a confirmed note change notifies its host after the exact receipt is visible", async () => {
  const onChanged = vi.fn();
  await render({ onChanged });
  await fill('textarea[aria-describedby="event-note-count"]', "New service instruction.");
  const result = { snapshot: snapshot([note({ text: "New service instruction." })]), receipt: { receiptId: "confirmed-receipt" }, consequences: [] };
  api.applyEventOperationalNoteCommand.mockResolvedValueOnce(result);
  await click("Add note");
  expect(onChanged).toHaveBeenCalledWith(result);
  expect(host.textContent).toContain("confirmed-receipt");
});

test("access recovery and touch targets remain explicit at compact widths", async () => {
  await render({ role: "customer" });
  expect(host.querySelector('[data-capability-state="recovery"]')).not.toBeNull();
  expect(api.getEventOperationalNotesSnapshot).not.toHaveBeenCalled();

  await render({ quoteId: "quote-compact", role: "admin" });
  for (const control of host.querySelectorAll("button, select")) {
    expect(Number.parseInt(control.style.minHeight || "0", 10)).toBeGreaterThanOrEqual(44);
  }
});
