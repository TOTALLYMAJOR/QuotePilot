import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const authority = require("../../../functions/eventOperationalNotes.js");

const source = {
  organizationId: "org-one",
  quoteId: "quote-one",
  sourceVersionId: "quote-revision-one"
};
const actor = {
  organizationId: "org-one",
  principalOrganizationId: "org-one",
  uid: "admin-one",
  role: "admin"
};
const nowISO = "2026-09-13T08:00:00.000Z";
const addRequest = (overrides = {}) => ({
  ...source,
  requestId: "event-note-add-request-0001",
  notesPolicyVersion: 1,
  expectedJournalRevision: 0,
  command: "add",
  type: "kitchen",
  visibility: "beo_visible",
  text: "  Hold two portions for the venue team.  ",
  ...overrides
});
const apply = (overrides = {}) => authority.planCommand({
  request: addRequest(overrides.request),
  actor: overrides.actor || actor,
  source: overrides.source || source,
  journal: overrides.journal || null,
  currentReceipt: overrides.currentReceipt || null,
  existingReceipt: overrides.existingReceipt || null,
  nowISO: overrides.nowISO || nowISO
});

describe("event operational notes authority", () => {
  test("publishes a frozen bounded policy and an explicit empty read state", () => {
    expect(authority.NOTES_POLICY).toMatchObject({
      schemaVersion: "event-operational-notes-v1",
      notesPolicyVersion: 1,
      noteTypes: ["kitchen", "venue", "service", "staffing"],
      visibilities: ["internal", "beo_visible"],
      maximumRetainedNotes: 12,
      maximumTextCharacters: 800
    });
    expect(Object.isFrozen(authority.NOTES_POLICY)).toBe(true);
    expect(Object.isFrozen(authority.NOTES_POLICY.noteTypes)).toBe(true);
    const snapshot = authority.projectReadSnapshot({ source });
    expect(snapshot).toMatchObject({
      ...source,
      availability: "not_yet_available",
      reasonCode: "journal_empty",
      journalRevision: 0,
      notes: [],
      latestReceipt: null
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.notes)).toBe(true);
  });

  test("adds a typed note with trusted actor/time evidence and immutable projections", () => {
    const result = apply();
    expect(result.idempotent).toBe(false);
    expect(result.nextJournal).toMatchObject({ ...source, journalRevision: 1 });
    expect(result.nextJournal.notes[0]).toMatchObject({
      noteId: expect.stringMatching(/^event_note_[a-f0-9]{32}$/),
      type: "kitchen",
      visibility: "beo_visible",
      text: "Hold two portions for the venue team.",
      noteRevision: 1,
      createdBy: { organizationId: "org-one", uid: "admin-one", role: "admin" },
      createdAtISO: nowISO,
      reviewedSourceVersionId: "",
      reviewedNoteRevision: null
    });
    expect(result.receipt).toMatchObject({
      receiptId: expect.stringMatching(/^event_notes_command_[a-f0-9]{48}$/),
      priorJournalRevision: 0,
      resultJournalRevision: 1,
      priorNoteRevision: null,
      resultNoteRevision: 1,
      recordedAtISO: nowISO
    });
    expect(result.receipt.priorJournalSnapshot.notes).toEqual([]);
    expect(result.receipt.resultJournalSnapshot.notes).toHaveLength(1);
    expect(result.snapshot).toMatchObject({
      availability: "available",
      reasonCode: "",
      journalRevision: 1
    });
    expect(result.snapshot.notes[0]).not.toHaveProperty("createdBy");
    expect(result.snapshot.latestReceipt).not.toHaveProperty("recordedBy");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.receipt.priorJournalSnapshot)).toBe(true);
    expect(Object.isFrozen(result.snapshot.notes[0])).toBe(true);
  });

  test("allows same-tenant sales staff to author notes without exposing actor identity", () => {
    const result = apply({ actor: { ...actor, uid: "sales-one", role: "sales" } });
    expect(result.nextJournal.notes[0].createdBy).toMatchObject({ uid: "sales-one", role: "sales" });
    expect(JSON.stringify(result.snapshot)).not.toContain("sales-one");
  });

  test("strictly rejects unsupported fields, enums, controls, oversized text, and weak request identities", () => {
    expect(() => apply({ request: { extra: true } })).toThrow(/unsupported fields/);
    expect(() => apply({ request: { type: "general" } })).toThrow(/type is unsupported/);
    expect(() => apply({ request: { visibility: "customer" } })).toThrow(/visibility is unsupported/);
    expect(() => apply({ request: { text: "unsafe\ntext" } })).toThrow(/control characters/);
    expect(() => apply({ request: { text: "x".repeat(801) } })).toThrow(/800 characters/);
    expect(() => apply({ request: { requestId: "short" } })).toThrow(/request identity/);
    expect(() => apply({ request: { expectedJournalRevision: -1 } })).toThrow(/bounded integer revision/);
    expect(() => apply({ actor: { ...actor, organizationId: "org-two" } })).toThrow(/staff authority/);
    expect(() => apply({ source: { ...source, sourceVersionId: "revision-two" } })).toThrow(/quote revision changed/);
  });

  test("corrects through a new note revision, preserves the prior snapshot, and clears review", () => {
    const added = apply();
    const noteId = added.nextJournal.notes[0].noteId;
    const revisedSource = { ...source, sourceVersionId: "quote-revision-two" };
    const reviewed = authority.planCommand({
      request: {
        ...revisedSource,
        requestId: "event-note-review-request-0001",
        notesPolicyVersion: 1,
        expectedJournalRevision: 1,
        command: "review_for_revision",
        priorSourceVersionId: source.sourceVersionId
      },
      actor,
      source: revisedSource,
      journal: added.nextJournal,
      currentReceipt: added.receipt,
      nowISO: "2026-09-13T08:01:00.000Z"
    });
    expect(reviewed.nextJournal.notes[0]).toMatchObject({
      noteRevision: 1,
      reviewedSourceVersionId: revisedSource.sourceVersionId,
      reviewedNoteRevision: 1,
      reviewedAtISO: "2026-09-13T08:01:00.000Z"
    });
    expect(reviewed.nextJournal.sourceVersionId).toBe(revisedSource.sourceVersionId);
    const corrected = authority.planCommand({
      request: {
        ...revisedSource,
        requestId: "event-note-correct-request-01",
        notesPolicyVersion: 1,
        expectedJournalRevision: 2,
        command: "correct",
        noteId,
        expectedNoteRevision: 1,
        type: "service",
        visibility: "internal",
        text: "Hold three portions for the venue team.",
        reason: "Venue count increased."
      },
      actor,
      source: revisedSource,
      journal: reviewed.nextJournal,
      currentReceipt: reviewed.receipt,
      nowISO: "2026-09-13T08:02:00.000Z"
    });
    expect(corrected.nextJournal).toMatchObject({ journalRevision: 3 });
    expect(corrected.nextJournal.notes[0]).toMatchObject({
      type: "service",
      visibility: "internal",
      text: "Hold three portions for the venue team.",
      noteRevision: 2,
      reviewedSourceVersionId: "",
      reviewedNoteRevision: null,
      reviewedBy: null
    });
    expect(corrected.receipt.priorJournalSnapshot.notes[0]).toMatchObject({
      text: "Hold two portions for the venue team.",
      noteRevision: 1,
      reviewedNoteRevision: 1
    });
    expect(corrected.receipt.request.reason).toBe("Venue count increased.");
    expect(added.nextJournal.notes[0].text).toBe("Hold two portions for the venue team.");
  });

  test("fences optimistic revisions and exact note review", () => {
    const added = apply();
    const revisedSource = { ...source, sourceVersionId: "quote-revision-two" };
    const stale = authority.projectReadSnapshot({
      source: revisedSource,
      journal: added.nextJournal,
      latestReceipt: added.receipt
    });
    expect(stale).toMatchObject({
      availability: "available",
      reasonCode: "source_revision_review_required",
      sourceVersionId: source.sourceVersionId,
      activeSourceVersionId: revisedSource.sourceVersionId,
      journalRevision: 1
    });
    const reviewRequest = {
      ...revisedSource,
      requestId: "event-note-review-request-0002",
      notesPolicyVersion: 1,
      expectedJournalRevision: 1,
      command: "review_for_revision",
      priorSourceVersionId: source.sourceVersionId
    };
    expect(() => authority.planCommand({
      request: { ...reviewRequest, expectedJournalRevision: 0 },
      actor,
      source: revisedSource,
      journal: added.nextJournal,
      currentReceipt: added.receipt,
      nowISO
    })).toThrow(/notes changed/);
    expect(() => authority.planCommand({
      request: { ...reviewRequest, priorSourceVersionId: "unexpected-revision" },
      actor,
      source: revisedSource,
      journal: added.nextJournal,
      currentReceipt: added.receipt,
      nowISO
    })).toThrow(/source revision changed/);
    const reviewed = authority.planCommand({
      request: reviewRequest,
      actor,
      source: revisedSource,
      journal: added.nextJournal,
      currentReceipt: added.receipt,
      nowISO: "2026-09-13T08:01:00.000Z"
    });
    expect(() => authority.planCommand({
      request: { ...reviewRequest, requestId: "event-note-review-request-0003", expectedJournalRevision: 2 },
      actor,
      source: revisedSource,
      journal: reviewed.nextJournal,
      currentReceipt: reviewed.receipt,
      nowISO: "2026-09-13T08:02:00.000Z"
    })).toThrow(/source revision changed|already bound/);
  });

  test("replays an exact request and rejects a request-id collision", () => {
    const added = apply();
    const replay = apply({ existingReceipt: added.receipt });
    expect(replay).toMatchObject({ idempotent: true, nextJournal: null });
    expect(replay.receipt).toEqual(added.receipt);
    expect(Object.isFrozen(replay.receipt.resultJournalSnapshot)).toBe(true);
    expect(replay.snapshot.journalRevision).toBe(1);
    expect(() => apply({
      request: { text: "Different immutable command" },
      existingReceipt: added.receipt
    })).toThrow(/different immutable command/);
  });

  test("enforces the twelve-note bound", () => {
    let journal = null;
    let receipt = null;
    for (let index = 0; index < 12; index += 1) {
      const result = authority.planCommand({
        request: addRequest({
          requestId: `event-note-bound-request-${String(index).padStart(4, "0")}`,
          expectedJournalRevision: index,
          text: `Operational note ${index + 1}`
        }),
        actor,
        source,
        journal,
        currentReceipt: receipt,
        nowISO: new Date(Date.parse(nowISO) + index * 1_000).toISOString()
      });
      journal = result.nextJournal;
      receipt = result.receipt;
    }
    expect(journal.notes).toHaveLength(12);
    expect(() => authority.planCommand({
      request: addRequest({
        requestId: "event-note-bound-request-0012",
        expectedJournalRevision: 12,
        text: "Thirteenth note"
      }),
      actor,
      source,
      journal,
      currentReceipt: receipt,
      nowISO: "2026-09-13T08:12:00.000Z"
    })).toThrow(/limit of 12/);
  });

  test("projects privacy-safe staff data and BEO-visible content only", () => {
    const visible = apply();
    const internal = authority.planCommand({
      request: addRequest({
        requestId: "event-note-add-request-0002",
        expectedJournalRevision: 1,
        type: "staffing",
        visibility: "internal",
        text: "Manager call required."
      }),
      actor,
      source,
      journal: visible.nextJournal,
      currentReceipt: visible.receipt,
      nowISO: "2026-09-13T08:01:00.000Z"
    });
    const staff = authority.projectStaffSnapshot({
      source,
      journal: internal.nextJournal,
      latestReceipt: internal.receipt
    });
    expect(staff.notes).toHaveLength(2);
    expect(JSON.stringify(staff)).not.toContain("admin-one");
    const beo = authority.projectBeoProjection(internal.nextJournal, {
      organizationId: source.organizationId,
      quoteId: source.quoteId,
      activeRevisionId: source.sourceVersionId
    });
    expect(beo).toEqual({
      schemaVersion: "event-operational-notes-beo-v1",
      sourceRevisionId: source.sourceVersionId,
      journalRevision: 2,
      notes: [{
        noteId: visible.nextJournal.notes[0].noteId,
        type: "kitchen",
        text: "Hold two portions for the venue team."
      }]
    });
    expect(Object.isFrozen(beo.notes[0])).toBe(true);
    const internalOnly = structuredClone(internal.nextJournal);
    internalOnly.notes[0].visibility = "internal";
    expect(authority.projectBeoProjection(internalOnly, {
      organizationId: source.organizationId,
      quoteId: source.quoteId,
      activeRevisionId: source.sourceVersionId
    })).toBeNull();
    expect(() => authority.projectBeoProjection(internal.nextJournal, {
      organizationId: source.organizationId,
      quoteId: source.quoteId,
      activeRevisionId: "new-active-revision"
    })).toThrow();
  });

  test("detects tampered journal and receipt evidence", () => {
    const added = apply();
    const tamperedJournal = structuredClone(added.nextJournal);
    tamperedJournal.notes[0].text = "Tampered";
    expect(() => authority.projectReadSnapshot({
      source,
      journal: tamperedJournal,
      latestReceipt: added.receipt
    })).toThrow(/latest immutable receipt/);
    const tamperedReceipt = structuredClone(added.receipt);
    tamperedReceipt.resultNoteRevision = 2;
    expect(() => authority.verifyReceipt(tamperedReceipt)).toThrow(/receipt/);
  });
});
