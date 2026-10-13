import { beforeEach, expect, test, vi } from "vitest";

const transport = vi.hoisted(() => ({ callable: vi.fn(), call: vi.fn() }));
const firebaseState = vi.hoisted(() => ({ ready: true, functions: {} }));
vi.mock("firebase/functions", () => ({ httpsCallable: transport.callable }));
vi.mock("../firebase", () => ({
  get cloudFunctions() { return firebaseState.functions; },
  get firebaseReady() { return firebaseState.ready; }
}));

import * as client from "../eventOperationalNotesClient";

const scope = { organizationId: "org-a", quoteId: "quote-a", sourceVersionId: "quote-version-a" };
const principal = { ...scope, principalId: "staff-a" };
const receiptId = `event_notes_command_${"a".repeat(48)}`;
const noteId = `event_note_${"b".repeat(32)}`;
const journalId = `event_notes_${"c".repeat(48)}`;
const requestId = "event_note_request_00000000-0000-4000-8000-000000000001";
const policyDigest = "d".repeat(64);

function receipt(overrides = {}) {
  return {
    receiptId,
    requestId,
    command: "add",
    noteId,
    priorJournalRevision: 0,
    resultJournalRevision: 1,
    priorNoteRevision: null,
    resultNoteRevision: 1,
    recordedAtISO: "2026-09-13T07:00:00.000Z",
    ...overrides
  };
}

function note(overrides = {}) {
  return {
    noteId,
    type: "kitchen",
    visibility: "internal",
    text: "Hold sauce warm until service.",
    noteRevision: 1,
    createdAtISO: "2026-09-13T07:00:00.000Z",
    updatedAtISO: "2026-09-13T07:00:00.000Z",
    reviewState: "pending",
    reviewedSourceVersionId: "",
    reviewedNoteRevision: null,
    reviewedAtISO: "",
    ...overrides
  };
}

function snapshot(overrides = {}) {
  return {
    ...scope,
    activeSourceVersionId: scope.sourceVersionId,
    schemaVersion: "event-operational-notes-v1",
    notesPolicyVersion: 1,
    notesPolicyDigest: policyDigest,
    journalId,
    evidenceBoundary: "Operator-authored notes are not proof of readiness or publication.",
    availability: "available",
    reasonCode: "",
    journalRevision: 1,
    notes: [note()],
    lastReceiptId: receiptId,
    updatedAtISO: "2026-09-13T07:00:00.000Z",
    latestReceipt: receipt(),
    ...overrides
  };
}

function empty(overrides = {}) {
  return snapshot({
    availability: "not_yet_available",
    reasonCode: "journal_empty",
    journalRevision: 0,
    notes: [],
    lastReceiptId: "",
    updatedAtISO: "",
    latestReceipt: null,
    ...overrides
  });
}

const envelope = (value = snapshot(), consequences = []) => ({ ok: true, storage: "firebase", organizationId: scope.organizationId, quoteId: scope.quoteId, snapshot: value, consequences });
const mutationEnvelope = (value = snapshot(), latest = value.latestReceipt, consequences = []) => ({ ...envelope(value, consequences), idempotent: false, receipt: latest });

beforeEach(() => {
  vi.clearAllMocks();
  firebaseState.ready = true;
  firebaseState.functions = {};
  transport.callable.mockReturnValue(transport.call);
});

test("notes read uses the exact callable, quote revision, and immutable empty state", async () => {
  transport.call.mockResolvedValueOnce({ data: envelope(empty()) });
  const result = await client.getEventOperationalNotesSnapshot(scope);
  expect(transport.callable).toHaveBeenCalledWith(firebaseState.functions, "getEventOperationalNotesSnapshot");
  expect(transport.call).toHaveBeenCalledWith(scope);
  expect(result.snapshot).toMatchObject({ availability: "not_yet_available", reasonCode: "journal_empty", notes: [] });
  expect(Object.isFrozen(result.snapshot.notes)).toBe(true);
});

test("notes read fails closed on foreign, unknown, and contradictory evidence", async () => {
  const malformed = [
    { ...snapshot(), organizationId: "foreign" },
    { ...snapshot(), privateActor: { uid: "private" } },
    { ...snapshot(), availability: "not_yet_available" },
    { ...snapshot(), notes: [note({ reviewState: "reviewed_for_revision" })] },
    { ...snapshot(), notes: [note(), note()] },
    { ...snapshot(), latestReceipt: receipt({ resultJournalRevision: 2 }) }
  ];
  for (const value of malformed) {
    transport.call.mockResolvedValueOnce({ data: envelope(value) });
    await expect(client.getEventOperationalNotesSnapshot(scope)).rejects.toMatchObject({ code: "invalid-server-response" });
  }
});

test("add dispatches normalized text without principal identity and validates its exact receipt", async () => {
  const input = {
    ...principal,
    requestId,
    notesPolicyVersion: 1,
    expectedJournalRevision: 0,
    command: "add",
    type: "kitchen",
    visibility: "internal",
    text: "  Hold sauce warm until service.  "
  };
  transport.call.mockResolvedValueOnce({ data: mutationEnvelope() });
  const result = await client.applyEventOperationalNoteCommand(input);
  expect(transport.callable).toHaveBeenCalledWith(firebaseState.functions, "applyEventOperationalNoteCommand");
  expect(transport.call).toHaveBeenCalledWith({
    ...scope,
    requestId,
    notesPolicyVersion: 1,
    expectedJournalRevision: 0,
    command: "add",
    type: "kitchen",
    visibility: "internal",
    text: "Hold sauce warm until service."
  });
  expect(result.receipt.receiptId).toBe(receiptId);
  expect(client.readPendingEventOperationalNoteCommand(principal)).toBeNull();
});

test("correction requires a reason and review binds the exact unchanged note revision", async () => {
  const base = {
    ...principal,
    requestId,
    notesPolicyVersion: 1,
    expectedJournalRevision: 1,
    command: "correct",
    noteId,
    expectedNoteRevision: 1,
    type: "service",
    visibility: "beo_visible",
    text: "Serve from the east station.",
    reason: "Venue confirmed the service location."
  };
  await expect(client.applyEventOperationalNoteCommand({ ...base, reason: "" })).rejects.toMatchObject({ code: "invalid-argument" });
  expect(transport.call).not.toHaveBeenCalled();

  const reviewedReceipt = receipt({ command: "review_for_revision", noteId: "", priorJournalRevision: 1, resultJournalRevision: 2, priorNoteRevision: null, resultNoteRevision: null });
  const reviewed = snapshot({
    journalRevision: 2,
    notes: [note({ reviewState: "reviewed_for_revision", reviewedSourceVersionId: scope.sourceVersionId, reviewedNoteRevision: 1, reviewedAtISO: reviewedReceipt.recordedAtISO })],
    latestReceipt: reviewedReceipt,
    lastReceiptId: reviewedReceipt.receiptId
  });
  transport.call.mockResolvedValueOnce({ data: mutationEnvelope(reviewed, reviewedReceipt) });
  const reviewInput = { ...principal, requestId, notesPolicyVersion: 1, expectedJournalRevision: 1, command: "review_for_revision", priorSourceVersionId: "quote-version-prior" };
  expect((await client.applyEventOperationalNoteCommand(reviewInput)).snapshot.notes[0].reviewState).toBe("reviewed_for_revision");
});

test("stale journal source and one checklist consequence remain explicit", async () => {
  const stale = snapshot({
    sourceVersionId: "quote-version-prior",
    activeSourceVersionId: scope.sourceVersionId,
    reasonCode: "source_revision_review_required",
    notes: [note({ reviewState: "reviewed_for_revision", reviewedSourceVersionId: "quote-version-prior", reviewedNoteRevision: 1, reviewedAtISO: "2026-09-13T07:00:00.000Z" })]
  });
  const consequence = { code: "event_brief_review_required", sourceUpdatedAtISO: stale.updatedAtISO, checklistCompletedAtISO: "2026-09-13T06:00:00.000Z" };
  transport.call.mockResolvedValueOnce({ data: envelope(stale, [consequence]) });
  const result = await client.getEventOperationalNotesSnapshot(scope);
  expect(result.snapshot).toMatchObject({ sourceVersionId: "quote-version-prior", activeSourceVersionId: scope.sourceVersionId, reasonCode: "source_revision_review_required" });
  expect(result.consequences).toEqual([consequence]);
});

test("an uncertain note result retains and replays only the original command", async () => {
  const input = { ...principal, quoteId: "quote-uncertain", requestId, notesPolicyVersion: 1, expectedJournalRevision: 0, command: "add", type: "venue", visibility: "internal", text: "Use east entrance." };
  transport.call.mockRejectedValueOnce(Object.assign(new Error("timeout"), { code: "functions/unavailable" }));
  await expect(client.applyEventOperationalNoteCommand(input)).rejects.toMatchObject({ uncertain: true });
  expect(client.readPendingEventOperationalNoteCommand(input)).toMatchObject({ definitive: false, command: { text: "Use east entrance." } });
  await expect(client.applyEventOperationalNoteCommand({ ...input, text: "Changed text" })).rejects.toMatchObject({ code: "event-mutation-blocked" });
  expect(transport.call).toHaveBeenCalledTimes(1);
});

test("definitive errors are explicit and must be reviewed before a new command", async () => {
  const input = { ...principal, quoteId: "quote-denied", requestId, notesPolicyVersion: 1, expectedJournalRevision: 0, command: "add", type: "venue", visibility: "internal", text: "Use east entrance." };
  transport.call.mockRejectedValueOnce({ code: "functions/permission-denied" });
  const rejection = await client.applyEventOperationalNoteCommand(input).catch((error) => error);
  expect(client.isDefinitiveEventOperationalNotesError(rejection)).toBe(true);
  expect(rejection.message).toContain("current role");
  expect(client.resetDefinitiveEventOperationalNoteCommand(input)).toBe(true);
  expect(client.readPendingEventOperationalNoteCommand(input)).toBeNull();
});

test("missing Firebase connectivity never becomes local note authority", async () => {
  firebaseState.ready = false;
  await expect(client.getEventOperationalNotesSnapshot(scope)).rejects.toMatchObject({ code: "unavailable" });
  await expect(client.applyEventOperationalNoteCommand({})).rejects.toMatchObject({ code: "unavailable" });
  expect(transport.callable).not.toHaveBeenCalled();
});
