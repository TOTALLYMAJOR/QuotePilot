import { describe, expect, test, vi } from "vitest";

import {
  acknowledgeWorkspaceActionFeedback,
  beginWorkspaceActionFeedback,
  createWorkspaceActionFeedbackRegistry,
  setWorkspaceActionFeedbackScope,
  transitionWorkspaceActionFeedback,
  WORKSPACE_ACTION_FEEDBACK_AUTHORITY,
  WORKSPACE_ACTION_FEEDBACK_MAX_RECORDS,
  WORKSPACE_ACTION_FEEDBACK_MODEL,
  WORKSPACE_ACTION_FEEDBACK_PERSISTENCE,
  WORKSPACE_ACTION_FEEDBACK_PHASES,
  workspaceActionFeedbackIsTerminal
} from "../workspaceActionFeedback";

const SCOPE = Object.freeze({
  organizationId: "organization-42",
  principalId: "staff-42",
  role: "sales"
});

function clock(...values) {
  const instants = values.length
    ? values
    : ["2026-09-03T05:40:00.000Z"];
  let index = 0;
  return () => instants[Math.min(index++, instants.length - 1)];
}

function createRegistry(scope = SCOPE) {
  const result = createWorkspaceActionFeedbackRegistry(scope);
  expect(result.ok).toBe(true);
  return result.registry;
}

function pending(registry = createRegistry(), overrides = {}) {
  return beginWorkspaceActionFeedback(registry, {
    scope: SCOPE,
    actionId: "complete_follow_up",
    actionLabel: "Complete follow-up",
    attemptId: "attempt-42",
    generation: "task-generation-42",
    object: {
      kind: "workflow-item",
      id: "follow-up-42",
      label: "Follow-up task"
    },
    message: "Saving the follow-up outcome.",
    changed: ["Completion requested"],
    unchanged: ["The note remains available"],
    ...overrides
  }, { clock: clock() });
}

function transition(start, phase, overrides = {}) {
  return transitionWorkspaceActionFeedback(start.registry, {
    ...start.selector,
    phase,
    message: `${phase} message.`,
    ...overrides
  }, { clock: clock("2026-09-03T05:41:00.000Z") });
}

describe("workspace action feedback presentation contract", () => {
  test("creates one empty immutable same-runtime presentation registry", () => {
    const result = createWorkspaceActionFeedbackRegistry(SCOPE);

    expect(result).toMatchObject({
      ok: true,
      status: "created",
      registry: {
        modelId: WORKSPACE_ACTION_FEEDBACK_MODEL,
        authority: WORKSPACE_ACTION_FEEDBACK_AUTHORITY,
        persistence: WORKSPACE_ACTION_FEEDBACK_PERSISTENCE,
        scope: SCOPE,
        records: [],
        revision: 0
      }
    });
    expect(WORKSPACE_ACTION_FEEDBACK_PHASES).toEqual([
      "pending",
      "succeeded",
      "recovery",
      "uncertain",
      "cancelled"
    ]);
    expect(WORKSPACE_ACTION_FEEDBACK_MAX_RECORDS).toBe(4);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.registry)).toBe(true);
    expect(Object.isFrozen(result.registry.scope)).toBe(true);
    expect(Object.isFrozen(result.registry.records)).toBe(true);
  });

  test("starts a bounded pending record and detaches it from mutable caller input", () => {
    const inputObject = {
      kind: "workflow-item",
      id: "follow-up-42",
      label: "Follow-up task"
    };
    const changed = ["Completion requested"];
    const result = pending(createRegistry(), { object: inputObject, changed });

    expect(result).toMatchObject({
      ok: true,
      status: "begun",
      record: {
        phase: "pending",
        actionId: "complete_follow_up",
        actionLabel: "Complete follow-up",
        attemptId: "attempt-42",
        generation: "task-generation-42",
        object: inputObject,
        message: "Saving the follow-up outcome.",
        changed,
        unchanged: ["The note remains available"],
        dispatchState: "not_dispatched",
        mode: "dispatch",
        evidence: null,
        cancellation: null,
        nextAction: null,
        startedAtISO: "2026-09-03T05:40:00.000Z",
        updatedAtISO: "2026-09-03T05:40:00.000Z",
        revision: 0
      },
      announcement: {
        id: '["attempt-42","task-generation-42",0,"pending"]'
      },
      selector: {
        recordRevision: 0
      }
    });
    expect(result.announcement.text).toContain("Complete follow-up started for Follow-up task.");
    inputObject.label = "Changed after begin";
    changed[0] = "Changed after begin";
    expect(result.record.object.label).toBe("Follow-up task");
    expect(result.record.changed).toEqual(["Completion requested"]);
    expect(Object.isFrozen(result.record)).toBe(true);
    expect(Object.isFrozen(result.record.object)).toBe(true);
    expect(Object.isFrozen(result.record.changed)).toBe(true);
    expect(Object.isFrozen(result.selector)).toBe(true);
  });

  test("uses collision-safe announcement identity for delimiter-bearing attempt generations", () => {
    const first = pending(createRegistry(), {
      attemptId: "attempt:left",
      generation: "generation",
      object: {
        kind: "workflow-item",
        id: "follow-up-first",
        label: "First follow-up task"
      }
    });
    const second = pending(first.registry, {
      attemptId: "attempt",
      generation: "left:generation",
      object: {
        kind: "workflow-item",
        id: "follow-up-second",
        label: "Second follow-up task"
      }
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(first.announcement.id).not.toBe(second.announcement.id);
    expect(JSON.parse(first.announcement.id)).toEqual([
      "attempt:left",
      "generation",
      0,
      "pending"
    ]);
    expect(JSON.parse(second.announcement.id)).toEqual([
      "attempt",
      "left:generation",
      0,
      "pending"
    ]);
  });

  test("rejects malformed scope, caller phases, extra data, unsafe text, and duplicate attempts", () => {
    expect(createWorkspaceActionFeedbackRegistry({
      ...SCOPE,
      role: "Sales"
    })).toMatchObject({ ok: false, reason: "invalid_scope" });
    expect(createWorkspaceActionFeedbackRegistry({
      ...SCOPE,
      email: "operator@example.test"
    })).toMatchObject({ ok: false, reason: "invalid_scope" });

    const registry = createRegistry();
    expect(pending(registry, { phase: "succeeded" })).toMatchObject({
      ok: false,
      reason: "unsupported_phase"
    });
    expect(pending(registry, { customerNote: "Call after the tasting" })).toMatchObject({
      ok: false,
      reason: "invalid_input"
    });
    expect(pending(registry, { message: " Not canonical" })).toMatchObject({
      ok: false,
      reason: "invalid_input"
    });
    expect(pending(registry, { message: "short" })).toMatchObject({
      ok: false,
      reason: "invalid_input"
    });
    expect(pending(registry, { actionLabel: "A" })).toMatchObject({
      ok: false,
      reason: "invalid_input"
    });
    expect(pending(registry, {
      object: { kind: "workflow-item", id: "follow-up-42", label: "A" }
    })).toMatchObject({ ok: false, reason: "invalid_input" });

    const first = pending(registry);
    expect(pending(first.registry, { generation: "another-generation" })).toMatchObject({
      ok: false,
      reason: "duplicate_attempt"
    });
    expect(pending(first.registry, {
      attemptId: "attempt-new",
      generation: "another-generation"
    })).toMatchObject({
      ok: false,
      reason: "unresolved_feedback_exists"
    });
  });

  test.each([
    ["email", "Send the result to operator@example.test.", "unsafe_presentation_text"],
    ["bearer credential", "Authorization: Bearer abcdefghijklmnop.", "unsafe_presentation_text"],
    ["token", "The access token remains in the response.", "unsafe_presentation_text"],
    ["secret", "The client secret was returned by the service.", "unsafe_presentation_text"],
    ["API key", "The API-key value was returned by the service.", "unsafe_presentation_text"],
    ["provider error", "FirebaseError: permission-denied from the provider.", "unsafe_presentation_text"],
    ["labelled customer note", "Customer note: Call after the tasting.", "unsafe_presentation_text"],
    ["bidirectional override", "The result is safe \u202Eetirw ot\u202C.", "unsafe_presentation_text"],
    ["control character", "The result contains\u0007a control byte.", "invalid_input"],
    ["C1 control character", "The result contains\u009Ba control byte.", "invalid_input"],
    ["opaque credential-like blob", "The result was abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN.", "unsafe_presentation_text"]
  ])("rejects %s presentation prose before it can enter a record", (_name, message, reason) => {
    expect(pending(createRegistry(), { message })).toMatchObject({
      ok: false,
      reason
    });
  });

  test("applies the sensitive-presentation boundary to labels and outcome summaries", () => {
    expect(pending(createRegistry(), {
      actionLabel: "Email operator@example.test"
    })).toMatchObject({ ok: false, reason: "unsafe_presentation_text" });
    expect(pending(createRegistry(), {
      object: {
        kind: "workflow-item",
        id: "follow-up-42",
        label: "Customer note: Call after the tasting"
      }
    })).toMatchObject({ ok: false, reason: "unsafe_presentation_text" });
    expect(pending(createRegistry(), {
      changed: ["Bearer token was copied"]
    })).toMatchObject({ ok: false, reason: "unsafe_presentation_text" });

    const start = pending();
    expect(transition(start, "uncertain", {
      message: "The outcome requires a safe next step.",
      nextAction: { id: "inspect", label: "Use API key secret" }
    })).toMatchObject({ ok: false, reason: "unsafe_presentation_text" });
  });

  test("permits a same-attempt pending stage update and deduplicates an identical update", () => {
    const start = pending();
    const staged = transition(start, "pending", {
      message: "The write returned; checking the authoritative record."
    });

    expect(staged).toMatchObject({
      ok: true,
      status: "transitioned",
      record: {
        phase: "pending",
        attemptId: start.record.attemptId,
        generation: start.record.generation,
        revision: 1,
        message: "The write returned; checking the authoritative record."
      }
    });
    expect(staged.announcement.id).not.toBe(start.announcement.id);

    const duplicate = transitionWorkspaceActionFeedback(staged.registry, {
      ...staged.selector,
      phase: "pending",
      message: staged.record.message
    }, { clock: vi.fn(() => "2026-09-03T05:42:00.000Z") });
    expect(duplicate).toMatchObject({
      ok: true,
      status: "unchanged",
      announcement: null,
      record: { revision: 1 }
    });
    expect(duplicate.registry).toBe(staged.registry);
  });

  test("cannot report success without bounded definitive evidence", () => {
    const start = pending();
    const missing = transition(start, "succeeded", {
      message: "The follow-up is complete."
    });

    expect(missing).toMatchObject({
      ok: false,
      reason: "missing_evidence",
      registry: start.registry
    });
    expect(missing.registry.records[0].phase).toBe("pending");

    const succeeded = transition(start, "succeeded", {
      message: "The authoritative record confirms completion.",
      changed: ["Follow-up marked complete"],
      unchanged: ["The saved note is unchanged"],
      evidence: {
        kind: "authoritative_readback",
        id: "receipt-42",
        source: "follow-up-server-readback"
      }
    });
    expect(succeeded).toMatchObject({
      ok: true,
      record: {
        phase: "succeeded",
        evidence: {
          kind: "authoritative_readback",
          id: "receipt-42",
          source: "follow-up-server-readback"
        },
        nextAction: null
      }
    });
    expect(workspaceActionFeedbackIsTerminal(succeeded.record)).toBe(true);
  });

  test("enforces the minimum changed and unchanged outcome facts", () => {
    const noRequestedChange = pending(createRegistry(), { changed: [] });
    expect(transition(noRequestedChange, "succeeded", {
      message: "A receipt exists but no completed change was named.",
      evidence: {
        kind: "authoritative_receipt",
        id: "receipt-42",
        source: "workflow-service"
      }
    })).toMatchObject({ ok: false, reason: "missing_changed_summary" });

    const noKnownUnchangedFact = pending(createRegistry(), { unchanged: [] });
    for (const phase of ["recovery", "uncertain"] ) {
      expect(transition(noKnownUnchangedFact, phase, {
        message: "The outcome did not name anything that stayed unchanged.",
        nextAction: { id: "inspect", label: "Inspect the record" }
      })).toMatchObject({ ok: false, reason: "missing_unchanged_summary" });
    }
    expect(transition(noKnownUnchangedFact, "cancelled", {
      message: "The action was stopped before it was dispatched.",
      dispatchState: "not_dispatched",
      cancellation: {
        kind: "pre_dispatch",
        id: "cancel-before-write",
        source: "staff-action-handler"
      }
    })).toMatchObject({ ok: false, reason: "missing_unchanged_summary" });
  });

  test.each(["recovery", "uncertain"])(
    "%s preserves outcome summaries and requires exactly one allowlisted next action",
    (phase) => {
      const start = pending();
      const missing = transition(start, phase, {
        message: "The outcome needs a safe next step."
      });
      expect(missing).toMatchObject({ ok: false, reason: "unsafe_next_action" });

      const unsafe = transition(start, phase, {
        message: "The outcome needs a safe next step.",
        nextAction: { id: "resubmit", label: "Submit again" }
      });
      expect(unsafe).toMatchObject({ ok: false, reason: "unsafe_next_action" });

      const accepted = transition(start, phase, {
        message: "The outcome needs a safe next step.",
        nextAction: { id: "reconcile", label: "Check the saved record" }
      });
      expect(accepted).toMatchObject({
        ok: true,
        record: {
          phase,
          changed: start.record.changed,
          unchanged: start.record.unchanged,
          evidence: null,
          nextAction: { id: "reconcile", label: "Check the saved record" }
        }
      });
    }
  );

  test("rejects acknowledgement while an outcome remains uncertain", () => {
    const result = transition(pending(), "uncertain", {
      message: "The outcome needs authoritative confirmation.",
      nextAction: { id: "acknowledge", label: "Acknowledge this outcome" }
    });

    expect(result).toMatchObject({ ok: false, reason: "unsafe_next_action" });
  });

  test("rejects return while an outcome remains uncertain", () => {
    const result = transition(pending(), "uncertain", {
      message: "The outcome needs authoritative confirmation.",
      nextAction: { id: "return", label: "Leave this outcome" }
    });

    expect(result).toMatchObject({ ok: false, reason: "unsafe_next_action" });
  });

  test("uses a strict transition matrix and only reopens uncertainty for reconciliation", () => {
    const start = pending();
    const uncertain = transition(start, "uncertain", {
      message: "The write may have completed; inspect before another write.",
      nextAction: { id: "reconcile", label: "Check again" }
    });

    expect(transition(uncertain, "pending", {
      message: "Checking the authoritative record."
    })).toMatchObject({ ok: false, reason: "unsafe_retry" });

    const reconciling = transition(uncertain, "pending", {
      mode: "reconcile",
      message: "Checking the authoritative record."
    });
    expect(reconciling).toMatchObject({
      ok: true,
      record: { phase: "pending", mode: "reconcile", nextAction: null }
    });

    const success = transition(start, "succeeded", {
      message: "The readback confirmed completion.",
      evidence: {
        kind: "authoritative_confirmation",
        id: "proof-42",
        source: "workflow-verifier"
      }
    });
    expect(transition(success, "pending", {
      message: "Trying to reopen a terminal record."
    })).toMatchObject({ ok: false, reason: "invalid_transition" });
  });

  test("requires a fenced cancellation basis and rejects pre-dispatch claims after dispatch", () => {
    const start = pending();
    expect(transition(start, "cancelled", {
      message: "The action was cancelled before completion.",
      dispatchState: "not_dispatched"
    })).toMatchObject({ ok: false, reason: "missing_cancellation_basis" });

    expect(transition(start, "cancelled", {
      message: "The action was cancelled before completion.",
      cancellation: {
        kind: "pre_dispatch",
        id: "cancel-before-write",
        source: "staff-action-handler"
      }
    })).toMatchObject({ ok: false, reason: "missing_dispatch_state" });

    const dispatched = transition(start, "pending", {
      message: "The request was dispatched and is awaiting readback.",
      dispatchState: "dispatched"
    });
    expect(dispatched.ok).toBe(true);
    expect(transition(dispatched, "cancelled", {
      message: "This pre-dispatch basis is no longer truthful.",
      dispatchState: "dispatched",
      cancellation: {
        kind: "pre_dispatch",
        id: "cancel-before-write",
        source: "staff-action-handler"
      }
    })).toMatchObject({ ok: false, reason: "invalid_cancellation_basis" });

    const authoritative = transition(dispatched, "cancelled", {
      message: "The owning service confirmed cancellation.",
      dispatchState: "dispatched",
      cancellation: {
        kind: "authoritative_cancellation",
        id: "cancellation-receipt-42",
        source: "workflow-service"
      }
    });
    expect(authoritative).toMatchObject({
      ok: true,
      record: {
        phase: "cancelled",
        dispatchState: "dispatched",
        cancellation: {
          kind: "authoritative_cancellation",
          id: "cancellation-receipt-42",
          source: "workflow-service"
        }
      }
    });

    const preDispatch = transition(start, "cancelled", {
      message: "The action stopped before any write was dispatched.",
      dispatchState: "not_dispatched",
      cancellation: {
        kind: "pre_dispatch",
        id: "cancel-before-write",
        source: "staff-action-handler"
      }
    });
    expect(preDispatch).toMatchObject({
      ok: true,
      record: {
        phase: "cancelled",
        dispatchState: "not_dispatched",
        cancellation: { kind: "pre_dispatch" }
      }
    });
  });

  test("fences transitions to the exact scope, attempt, generation, action, and object", () => {
    const start = pending();
    const cases = [
      [{ ...start.selector, scope: { ...SCOPE, organizationId: "organization-other" } }, "scope_mismatch"],
      [{ ...start.selector, attemptId: "attempt-missing" }, "record_not_found"],
      [{ ...start.selector, generation: "task-generation-old" }, "stale_generation"],
      [{ ...start.selector, actionId: "complete_nearby_follow_up" }, "identity_mismatch"],
      [{ ...start.selector, object: { ...start.selector.object, id: "follow-up-nearby" } }, "identity_mismatch"]
    ];

    for (const [selector, reason] of cases) {
      expect(transitionWorkspaceActionFeedback(start.registry, {
        ...selector,
        phase: "recovery",
        message: "This must not update the record.",
        nextAction: { id: "inspect", label: "Inspect the current item" }
      }, { clock: clock("2026-09-03T05:41:00.000Z") })).toMatchObject({
        ok: false,
        reason
      });
    }
    expect(start.registry.records[0].phase).toBe("pending");
  });

  test("acknowledges only the exact dismissible record and leaves nearby records intact", () => {
    const first = pending();
    const second = pending(first.registry, {
      attemptId: "attempt-43",
      generation: "task-generation-43",
      object: {
        kind: "workflow-item",
        id: "follow-up-43",
        label: "Second follow-up task"
      }
    });

    expect(acknowledgeWorkspaceActionFeedback(second.registry, second.selector)).toMatchObject({
      ok: false,
      reason: "feedback_not_dismissible"
    });

    const recovered = transition(first, "recovery", {
      message: "Nothing changed; the form remains available.",
      nextAction: { id: "return", label: "Return to the form" }
    });
    // Reapply the second record after the first transition, which intentionally
    // started from the first record's own registry snapshot.
    const recoveredWithSecond = pending(recovered.registry, {
      attemptId: "attempt-43",
      generation: "task-generation-43",
      object: {
        kind: "workflow-item",
        id: "follow-up-43",
        label: "Second follow-up task"
      }
    });
    const acknowledged = acknowledgeWorkspaceActionFeedback(
      recoveredWithSecond.registry,
      recovered.selector
    );

    expect(acknowledged).toMatchObject({ ok: true, status: "acknowledged" });
    expect(acknowledged.registry.records).toHaveLength(1);
    expect(acknowledged.registry.records[0].attemptId).toBe("attempt-43");
  });

  test("retains uncertainty until authoritative reconciliation and forbids evidence-free recovery", () => {
    const start = pending();
    const uncertain = transition(start, "uncertain", {
      message: "The write may have completed; inspect before another write.",
      nextAction: { id: "reconcile", label: "Check again" }
    });

    expect(workspaceActionFeedbackIsTerminal(uncertain.record)).toBe(false);
    const retained = acknowledgeWorkspaceActionFeedback(
      uncertain.registry,
      uncertain.selector
    );
    expect(retained).toMatchObject({
      ok: false,
      reason: "feedback_not_dismissible",
      registry: uncertain.registry
    });
    expect(transitionWorkspaceActionFeedback(uncertain.registry, {
      ...uncertain.selector,
      phase: "recovery",
      message: "Ambiguity cannot become recovery without authoritative resolution.",
      nextAction: { id: "inspect", label: "Inspect the current item" }
    })).toMatchObject({ ok: false, reason: "invalid_transition" });

    const reconciling = transition(uncertain, "pending", {
      mode: "reconcile",
      message: "Checking the authoritative record before another write."
    });
    const succeeded = transition(reconciling, "succeeded", {
      message: "The authoritative record confirms completion.",
      evidence: {
        kind: "authoritative_readback",
        id: "receipt-after-uncertainty",
        source: "follow-up-server-readback"
      }
    });
    expect(succeeded.ok).toBe(true);
    expect(acknowledgeWorkspaceActionFeedback(succeeded.registry, succeeded.selector))
      .toMatchObject({ ok: true, status: "acknowledged", registry: { records: [] } });
  });

  test("revision-fences acknowledgement so stale or unversioned selectors cannot remove newer truth", () => {
    const start = pending();
    const uncertain = transition(start, "uncertain", {
      message: "The write may have completed; inspect before another write.",
      nextAction: { id: "reconcile", label: "Check again" }
    });
    const reconciling = transition(uncertain, "pending", {
      mode: "reconcile",
      message: "Checking the authoritative record."
    });
    const succeeded = transition(reconciling, "succeeded", {
      message: "The authoritative record confirms completion.",
      evidence: {
        kind: "authoritative_readback",
        id: "receipt-after-reconciliation",
        source: "follow-up-server-readback"
      }
    });

    const stale = acknowledgeWorkspaceActionFeedback(succeeded.registry, uncertain.selector);
    expect(stale).toMatchObject({
      ok: false,
      reason: "stale_revision",
      registry: succeeded.registry
    });
    expect(stale.registry.records[0]).toBe(succeeded.record);

    const { recordRevision: _recordRevision, ...unversionedSelector } = succeeded.selector;
    expect(acknowledgeWorkspaceActionFeedback(succeeded.registry, unversionedSelector))
      .toMatchObject({ ok: false, reason: "missing_record_revision" });
    expect(acknowledgeWorkspaceActionFeedback(succeeded.registry, succeeded.selector))
      .toMatchObject({ ok: true, status: "acknowledged" });
  });

  test("bounds the registry, evicts the oldest terminal record, and never evicts active ambiguity", () => {
    let registry = createRegistry();
    const records = [];
    for (let index = 0; index < WORKSPACE_ACTION_FEEDBACK_MAX_RECORDS; index += 1) {
      const result = pending(registry, {
        attemptId: `attempt-${index}`,
        generation: `generation-${index}`,
        object: {
          kind: "workflow-item",
          id: `follow-up-${index}`,
          label: `Follow-up task ${index}`
        }
      });
      expect(result.ok).toBe(true);
      records.push(result);
      registry = result.registry;
    }
    expect(pending(registry, {
      attemptId: "attempt-overflow",
      generation: "generation-overflow",
      object: {
        kind: "workflow-item",
        id: "follow-up-overflow",
        label: "Overflow follow-up"
      }
    })).toMatchObject({ ok: false, reason: "pending_feedback_capacity" });

    const oldest = records[0];
    const oldestSucceeded = transitionWorkspaceActionFeedback(registry, {
      ...oldest.selector,
      phase: "succeeded",
      message: "The oldest item is complete.",
      evidence: {
        kind: "authoritative_receipt",
        id: "receipt-oldest",
        source: "workflow-service"
      }
    }, { clock: clock("2026-09-03T05:42:00.000Z") });
    expect(oldestSucceeded.ok).toBe(true);

    const replacement = pending(oldestSucceeded.registry, {
      attemptId: "attempt-replacement",
      generation: "generation-replacement",
      object: {
        kind: "workflow-item",
        id: "follow-up-replacement",
        label: "Replacement follow-up"
      }
    });
    expect(replacement.ok).toBe(true);
    expect(replacement.registry.records).toHaveLength(WORKSPACE_ACTION_FEEDBACK_MAX_RECORDS);
    expect(replacement.registry.records.some((record) => record.attemptId === oldest.record.attemptId))
      .toBe(false);
    expect(replacement.registry.records.filter((record) => record.phase === "pending"))
      .toHaveLength(WORKSPACE_ACTION_FEEDBACK_MAX_RECORDS);
  });

  test("preserves four uncertain records and releases capacity only after authoritative resolution", () => {
    let registry = createRegistry();
    const attempts = [];
    const uncertainAttempts = [];
    for (let index = 0; index < WORKSPACE_ACTION_FEEDBACK_MAX_RECORDS; index += 1) {
      const started = pending(registry, {
        attemptId: `uncertain-attempt-${index}`,
        generation: `uncertain-generation-${index}`,
        object: {
          kind: "workflow-item",
          id: `uncertain-follow-up-${index}`,
          label: `Uncertain follow-up ${index}`
        }
      });
      expect(started.ok).toBe(true);
      attempts.push(started);
      registry = started.registry;
    }
    for (const started of attempts) {
      const uncertain = transitionWorkspaceActionFeedback(registry, {
        ...started.selector,
        phase: "uncertain",
        message: "The write may have completed; inspect before another write.",
        nextAction: { id: "reconcile", label: "Check again" }
      }, { clock: clock("2026-09-03T05:42:00.000Z") });
      expect(uncertain.ok).toBe(true);
      uncertainAttempts.push(uncertain);
      registry = uncertain.registry;
    }

    const blocked = pending(registry, {
      attemptId: "attempt-after-capacity",
      generation: "generation-after-capacity",
      object: {
        kind: "workflow-item",
        id: "follow-up-after-capacity",
        label: "Follow-up after capacity"
      }
    });
    expect(blocked).toMatchObject({
      ok: false,
      reason: "unresolved_feedback_capacity",
      announcement: null
    });
    expect(blocked.registry).toBe(registry);
    expect(blocked.registry.records).toHaveLength(WORKSPACE_ACTION_FEEDBACK_MAX_RECORDS);
    expect(blocked.registry.records.every((record) => record.phase === "uncertain")).toBe(true);

    const retained = acknowledgeWorkspaceActionFeedback(registry, uncertainAttempts[0].selector);
    expect(retained).toMatchObject({
      ok: false,
      reason: "feedback_not_dismissible",
      registry
    });

    const cancelled = transitionWorkspaceActionFeedback(registry, {
      ...uncertainAttempts[0].selector,
      phase: "cancelled",
      message: "The owning service confirmed authoritative cancellation.",
      dispatchState: "dispatched",
      cancellation: {
        kind: "authoritative_cancellation",
        id: "cancellation-after-capacity",
        source: "workflow-service"
      }
    }, { clock: clock("2026-09-03T05:43:00.000Z") });
    expect(cancelled.ok).toBe(true);
    const dismissed = acknowledgeWorkspaceActionFeedback(cancelled.registry, cancelled.selector);
    expect(dismissed).toMatchObject({ ok: true, record: { phase: "cancelled" } });
    expect(dismissed.registry.records).toHaveLength(WORKSPACE_ACTION_FEEDBACK_MAX_RECORDS - 1);

    const admitted = pending(dismissed.registry, {
      attemptId: "attempt-after-dismissal",
      generation: "generation-after-dismissal",
      object: {
        kind: "workflow-item",
        id: "follow-up-after-dismissal",
        label: "Follow-up after dismissal"
      }
    });
    expect(admitted.ok).toBe(true);
    expect(admitted.registry.records).toHaveLength(WORKSPACE_ACTION_FEEDBACK_MAX_RECORDS);
    expect(admitted.registry.records.filter((record) => record.phase === "uncertain"))
      .toHaveLength(WORKSPACE_ACTION_FEEDBACK_MAX_RECORDS - 1);
  });

  test("clears all records when tenant, principal, or role scope changes", () => {
    const start = pending();

    for (const scope of [
      { ...SCOPE, organizationId: "organization-other" },
      { ...SCOPE, principalId: "staff-other" },
      { ...SCOPE, role: "admin" }
    ]) {
      const result = setWorkspaceActionFeedbackScope(start.registry, scope);
      expect(result).toMatchObject({
        ok: true,
        status: "scope_reset",
        registry: { scope, records: [] }
      });
      expect(transitionWorkspaceActionFeedback(result.registry, {
        ...start.selector,
        phase: "recovery",
        message: "A stale handler must not update the new scope.",
        nextAction: { id: "inspect", label: "Inspect" }
      }, { clock: clock() })).toMatchObject({
        ok: false,
        reason: "scope_mismatch"
      });
    }
  });

  test("never reads or writes browser storage", () => {
    const priorLocal = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    const priorSession = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
    const localGetter = vi.fn(() => { throw new Error("localStorage accessed"); });
    const sessionGetter = vi.fn(() => { throw new Error("sessionStorage accessed"); });
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get: localGetter });
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get: sessionGetter });

    try {
      const start = pending();
      const result = transition(start, "uncertain", {
        message: "The outcome requires a read-only check.",
        nextAction: { id: "reconcile", label: "Check again" }
      });
      expect(result.ok).toBe(true);
      expect(localGetter).not.toHaveBeenCalled();
      expect(sessionGetter).not.toHaveBeenCalled();
    } finally {
      if (priorLocal) Object.defineProperty(globalThis, "localStorage", priorLocal);
      else delete globalThis.localStorage;
      if (priorSession) Object.defineProperty(globalThis, "sessionStorage", priorSession);
      else delete globalThis.sessionStorage;
    }
  });
});
