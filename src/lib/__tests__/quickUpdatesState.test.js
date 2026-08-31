import { describe, expect, test } from "vitest";
import {
  QUICK_UPDATES_PHASE,
  buildQuickUpdatesDelta,
  buildQuickUpdatesRequest,
  createQuickUpdatesState,
  normalizeQuickUpdatesPersistedEffects,
  normalizeQuickUpdatesReviewDelta,
  quickUpdatesReducer,
  shouldGuardQuickUpdatesDismissal
} from "../quickUpdatesState";

const QUOTE = Object.freeze({
  id: "quote-alpha",
  organizationId: "org-alpha",
  activeVersionId: "version-alpha",
  event: Object.freeze({ style: "Plated" })
});

function dirtyState() {
  let state = quickUpdatesReducer(createQuickUpdatesState(), {
    type: "OPEN",
    savedStyle: "Plated"
  });
  return quickUpdatesReducer(state, { type: "EDIT_STYLE", value: "Buffet" });
}

function persistedEffects(overrides = {}) {
  return {
    schemaVersion: "commercial-change-persisted-effects-v1",
    authority: "server_authoritative",
    source: "trusted_quote_edit_material_projection",
    identity: {
      organizationId: QUOTE.organizationId,
      quoteId: QUOTE.id,
      baseRevisionId: QUOTE.activeVersionId,
      projectedRevisionId: "version-beta"
    },
    requestedDelta: [{
      nodeId: "fact.event.service_style",
      fieldPath: "event.style",
      before: "Plated",
      after: "Buffet"
    }],
    pricing: {
      currency: "USD",
      authoritativeTotal: { before: 8400, proposedAfter: 8750, changed: true },
      depositRequirement: { before: 2100, proposedAfter: 2187.5, changed: true }
    },
    staffing: {
      before: { servers: 8, chefs: 3, bartenders: 2 },
      after: { servers: 10, chefs: 3, bartenders: 2 },
      changed: true
    },
    status: { before: "draft", after: "draft", changed: false },
    version: {
      beforeRevisionId: QUOTE.activeVersionId,
      afterRevisionId: "version-beta",
      beforeVersionNumber: 1,
      afterVersionNumber: 2,
      createsImmutableVersion: true
    },
    proposal: {
      statusBefore: "draft",
      statusAfter: "draft",
      workflowEvidencePreserved: true,
      customerDeliveryTriggered: false,
      publicationTriggered: false
    },
    portal: {
      activeRevisionIdBefore: QUOTE.activeVersionId,
      activeRevisionIdAfter: "version-beta",
      projectionRefreshed: true,
      accessIdentityRetained: true,
      issuanceRecordedAtSave: true,
      expiryRecalculatedAtSave: true,
      customerDeliveryTriggered: false
    },
    lifecycle: {
      draftAtPreserved: true,
      draftAtAssignedIfMissing: false,
      editedAtRecordedAtSave: true,
      terminalDecisionEvidencePreserved: true
    },
    dependencies: {
      authorizationRequired: true,
      impact: { counts: { total: 3, review: 2, stale: 1 } }
    },
    boundary: "Exact trusted quote edit plan; no write or delivery occurred.",
    ...overrides
  };
}

describe("quickUpdatesState", () => {
  test("builds one allowlisted exact service-style delta and request", () => {
    expect(buildQuickUpdatesDelta({ savedStyle: "Plated", draftStyle: "Buffet" })).toEqual([{
      fieldPath: "event.style",
      label: "Service style",
      before: "Plated",
      after: "Buffet",
      beforeLabel: "Plated dinner",
      afterLabel: "Buffet"
    }]);
    expect(buildQuickUpdatesRequest({ quote: QUOTE, savedStyle: "Plated", draftStyle: "Buffet" }))
      .toEqual(expect.objectContaining({
        modelId: "quick-updates-request-v1",
        source: "quick_updates",
        scope: "event.service_style",
        quoteId: "quote-alpha",
        organizationId: "org-alpha",
        baseRevisionId: "version-alpha",
        patch: { event: { style: "Buffet" } },
        delta: [expect.objectContaining({ fieldPath: "event.style", before: "Plated", after: "Buffet" })]
      }));
  });

  test("fails closed without exact tenant, quote, revision, or a changed style", () => {
    expect(buildQuickUpdatesRequest({ quote: {}, savedStyle: "Plated", draftStyle: "Buffet" })).toBeNull();
    expect(buildQuickUpdatesRequest({ quote: QUOTE, savedStyle: "Plated", draftStyle: "Plated" })).toBeNull();
    expect(buildQuickUpdatesRequest({
      quote: {
        ...QUOTE,
        activeVersionId: "",
        versionMeta: null,
        updatedAtISO: "2026-08-30T20:00:00.000Z"
      },
      savedStyle: "Plated",
      draftStyle: "Buffet"
    })).toBeNull();
  });

  test("accepts only an authoritative review matching the exact requested delta", () => {
    const expected = buildQuickUpdatesDelta({ savedStyle: "Plated", draftStyle: "Buffet" });
    expect(normalizeQuickUpdatesReviewDelta([{
      fieldPath: "event.style",
      before: "Plated",
      after: "Buffet",
      beforeLabel: "Plated dinner",
      afterLabel: "Buffet"
    }], expected)).toEqual(expected);
    expect(normalizeQuickUpdatesReviewDelta([{
      fieldPath: "event.style",
      before: "Plated",
      after: "Stations"
    }], expected)).toBeNull();
    expect(normalizeQuickUpdatesReviewDelta([
      expected[0],
      { fieldPath: "event.servers", before: 8, after: 6 }
    ], expected)).toBeNull();
  });

  test("accepts only trusted persisted effects bound to the exact draft and next version", () => {
    const request = buildQuickUpdatesRequest({
      quote: QUOTE,
      savedStyle: "Plated",
      draftStyle: "Buffet"
    });
    expect(normalizeQuickUpdatesPersistedEffects(persistedEffects(), request)).toEqual(
      expect.objectContaining({
        authority: "server_authoritative",
        version: expect.objectContaining({ afterRevisionId: "version-beta" })
      })
    );
    expect(normalizeQuickUpdatesPersistedEffects(persistedEffects({
      version: {
        ...persistedEffects().version,
        afterVersionNumber: 3
      }
    }), request)).toBeNull();
    expect(normalizeQuickUpdatesPersistedEffects(persistedEffects({
      pricing: {
        ...persistedEffects().pricing,
        authoritativeTotal: {
          ...persistedEffects().pricing.authoritativeTotal,
          proposedAfter: 8750,
          changed: false
        }
      }
    }), request)).toBeNull();
  });

  test("moves closed through clean, dirty, review, saving, refreshing, and saved", () => {
    let state = createQuickUpdatesState();
    state = quickUpdatesReducer(state, { type: "OPEN", savedStyle: "Plated" });
    expect(state.phase).toBe(QUICK_UPDATES_PHASE.CLEAN);
    state = quickUpdatesReducer(state, { type: "EDIT_STYLE", value: "Buffet" });
    expect(state.phase).toBe(QUICK_UPDATES_PHASE.DIRTY);
    state = quickUpdatesReducer(state, { type: "REVIEW_REQUEST" });
    expect(state.previewPending).toBe(true);
    const delta = buildQuickUpdatesDelta(state);
    state = quickUpdatesReducer(state, { type: "REVIEW_READY", delta, preview: { id: "preview-1" } });
    expect(state.phase).toBe(QUICK_UPDATES_PHASE.REVIEW);
    state = quickUpdatesReducer(state, { type: "SAVE_REQUEST" });
    expect(state.phase).toBe(QUICK_UPDATES_PHASE.SAVING);
    state = quickUpdatesReducer(state, { type: "PERSISTED", receipt: { activeVersionId: "version-beta" } });
    expect(state.phase).toBe(QUICK_UPDATES_PHASE.REFRESHING);
    state = quickUpdatesReducer(state, { type: "SAVED", receipt: { activeVersionId: "version-beta" } });
    expect(state.phase).toBe(QUICK_UPDATES_PHASE.SAVED);
    expect(state.savedStyle).toBe("Buffet");
  });

  test.each([
    ["FAILURE", QUICK_UPDATES_PHASE.FAILURE],
    ["CONFLICT", QUICK_UPDATES_PHASE.CONFLICT],
    ["UNCERTAIN", QUICK_UPDATES_PHASE.UNCERTAIN]
  ])("retains the exact draft in %s", (type, phase) => {
    const state = quickUpdatesReducer(dirtyState(), {
      type,
      error: "Keep this draft.",
      recoveryAction: type === "UNCERTAIN" ? "reconcile_only" : "",
      recoveryLabel: type === "UNCERTAIN" ? "Reconcile in quote editor" : "",
      retryable: type !== "UNCERTAIN"
    });
    expect(state.phase).toBe(phase);
    expect(state.draftStyle).toBe("Buffet");
    expect(state.savedStyle).toBe("Plated");
    expect(state.error).toBe("Keep this draft.");
    expect(state.retryable).toBe(type !== "UNCERTAIN");
    expect(state.recoveryAction).toBe(type === "UNCERTAIN" ? "reconcile_only" : "");
  });

  test("guards a dirty dismissal but closes clean work without a guard", () => {
    const dirty = dirtyState();
    expect(shouldGuardQuickUpdatesDismissal(dirty)).toBe(true);
    const guarded = quickUpdatesReducer(dirty, { type: "REQUEST_DISMISS", reason: "library" });
    expect(guarded.phase).toBe(QUICK_UPDATES_PHASE.DIRTY);
    expect(guarded.dismissal).toEqual({ reason: "library" });
    expect(quickUpdatesReducer(guarded, { type: "KEEP_EDITING" }).dismissal).toBeNull();
    expect(quickUpdatesReducer(guarded, { type: "DISCARD" }).phase).toBe(QUICK_UPDATES_PHASE.CLOSED);

    const clean = quickUpdatesReducer(createQuickUpdatesState(), { type: "OPEN", savedStyle: "Plated" });
    expect(quickUpdatesReducer(clean, { type: "REQUEST_DISMISS", reason: "escape" }).phase)
      .toBe(QUICK_UPDATES_PHASE.CLOSED);
  });

  test("blocks every dismissal while saving or refreshing", () => {
    const dirty = dirtyState();
    const delta = buildQuickUpdatesDelta(dirty);
    const reviewPending = quickUpdatesReducer(dirty, { type: "REVIEW_REQUEST" });
    const review = quickUpdatesReducer(reviewPending, { type: "REVIEW_READY", delta });
    const saving = quickUpdatesReducer(review, { type: "SAVE_REQUEST" });
    const refreshing = quickUpdatesReducer(saving, { type: "PERSISTED" });
    expect(quickUpdatesReducer(saving, { type: "REQUEST_DISMISS", reason: "escape" })).toBe(saving);
    expect(quickUpdatesReducer(refreshing, { type: "REQUEST_DISMISS", reason: "backdrop" })).toBe(refreshing);
  });
});
