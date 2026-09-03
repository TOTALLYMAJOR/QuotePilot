import { describe, expect, test } from "vitest";

import {
  clearWorkspaceTaskJourney,
  createWorkspaceTaskJourney,
  readWorkspaceTaskJourney,
  transitionWorkspaceTaskContext,
  transitionWorkspaceTaskOutcome,
  WORKSPACE_TASK_CONTEXT_STATES,
  WORKSPACE_TASK_JOURNEY_AUTHORITY,
  WORKSPACE_FOLLOW_UP_TASK_PROOF_TYPE,
  WORKSPACE_FOLLOW_UP_TASK_VERIFIER_ID,
  WORKSPACE_TASK_JOURNEY_MAX_SERIALIZED_LENGTH,
  WORKSPACE_TASK_JOURNEY_MODEL,
  WORKSPACE_TASK_JOURNEY_PERSISTENCE,
  WORKSPACE_TASK_JOURNEY_PHASES,
  workspaceTaskJourneyBelongsToPrincipal,
  workspaceTaskJourneyMatchesArrival,
  writeWorkspaceTaskJourney
} from "../workspaceTaskJourney";

function validInput(overrides = {}) {
  return {
    organizationId: "organization-42",
    principal: {
      id: "staff-42",
      role: "sales"
    },
    taskId: "task-quote-42-review",
    startedAtISO: "2026-09-03T03:10:00.000Z",
    origin: {
      routeId: "home",
      pathname: "/app"
    },
    destination: "opportunity",
    object: {
      id: "quote-42",
      type: "opportunity"
    },
    focus: {
      quoteId: "quote-42"
    },
    intentId: "review_opportunity",
    ...overrides
  };
}

function createJourney(overrides = {}) {
  const result = createWorkspaceTaskJourney(validInput(overrides));
  expect(result.ok).toBe(true);
  return result.journey;
}

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

function mutable(value) {
  return JSON.parse(JSON.stringify(value));
}

function resolutionProof(overrides = {}) {
  return {
    verifierId: "authoritative-readback",
    proofId: "receipt-42",
    proofType: "workflow-outcome-receipt",
    ...overrides
  };
}

describe("workspace task journey presentation contract", () => {
  test("starts one bounded, immutable, presentation-only journey in progress", () => {
    const result = createWorkspaceTaskJourney(validInput());

    expect(result).toEqual({
      ok: true,
      journey: {
        modelId: WORKSPACE_TASK_JOURNEY_MODEL,
        authority: WORKSPACE_TASK_JOURNEY_AUTHORITY,
        persistence: WORKSPACE_TASK_JOURNEY_PERSISTENCE,
        organizationId: "organization-42",
        principal: {
          id: "staff-42",
          role: "sales"
        },
        taskId: "task-quote-42-review",
        startedAtISO: "2026-09-03T03:10:00.000Z",
        phase: "in_progress",
        contextState: "locating",
        origin: {
          routeId: "home",
          pathname: "/app"
        },
        destination: "opportunity",
        object: {
          id: "quote-42",
          type: "opportunity"
        },
        focus: {
          quoteId: "quote-42"
        },
        intentId: "review_opportunity",
        proof: null
      }
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.journey)).toBe(true);
    expect(Object.isFrozen(result.journey.origin)).toBe(true);
    expect(Object.isFrozen(result.journey.principal)).toBe(true);
    expect(Object.isFrozen(result.journey.object)).toBe(true);
    expect(Object.isFrozen(result.journey.focus)).toBe(true);
    expect(JSON.stringify(result.journey).length).toBeLessThanOrEqual(
      WORKSPACE_TASK_JOURNEY_MAX_SERIALIZED_LENGTH
    );
    expect(WORKSPACE_TASK_JOURNEY_PHASES).toEqual([
      "in_progress",
      "resolved",
      "uncertain",
      "cancelled",
      "superseded"
    ]);
    expect(WORKSPACE_TASK_CONTEXT_STATES).toEqual(["locating", "ready", "recovery"]);
  });

  test("canonicalizes a supported destination without carrying arrival prose", () => {
    const result = createWorkspaceTaskJourney(validInput({
      taskId: "task-request-7",
      destination: "workflow",
      object: { id: "request-7", type: "workflow-item" },
      focus: {
        quoteId: "quote-42",
        attentionType: "change_request",
        requestId: "request-7"
      },
      intentId: "review_customer_request"
    }));

    expect(result).toMatchObject({
      ok: true,
      journey: {
        destination: "workflow",
        object: { id: "request-7", type: "workflow-item" },
        focus: {
          quoteId: "quote-42",
          attentionType: "change_request",
          requestId: "request-7"
        },
        intentId: "review_customer_request"
      }
    });
    expect(result.journey).not.toHaveProperty("reason");
    expect(result.journey).not.toHaveProperty("consequence");
    expect(result.journey.object).not.toHaveProperty("label");
  });

  test("binds restoration to the exact signed-in principal and role", () => {
    const journey = createJourney();

    expect(workspaceTaskJourneyBelongsToPrincipal(journey, {
      id: "staff-42",
      role: "sales"
    })).toBe(true);
    expect(workspaceTaskJourneyBelongsToPrincipal(journey, {
      id: "staff-other",
      role: "sales"
    })).toBe(false);
    expect(workspaceTaskJourneyBelongsToPrincipal(journey, {
      id: "staff-42",
      role: "admin"
    })).toBe(false);
    expect(workspaceTaskJourneyBelongsToPrincipal(journey, {
      id: "operator@example.test",
      role: "sales"
    })).toBe(false);
  });

  test("binds otherwise identical tasks to one exact start generation", () => {
    const first = createJourney();
    const restarted = createJourney({ startedAtISO: "2026-09-03T03:11:00.000Z" });

    expect(first.taskId).toBe(restarted.taskId);
    expect(first.focus).toEqual(restarted.focus);
    expect(first.startedAtISO).not.toBe(restarted.startedAtISO);
    expect(transitionWorkspaceTaskContext(first, "ready").journey.startedAtISO)
      .toBe(first.startedAtISO);
    expect(createWorkspaceTaskJourney(validInput({
      startedAtISO: "2026-09-03T03:11:00Z"
    }))).toMatchObject({
      ok: false,
      recovery: { code: "invalid_input" }
    });
  });

  test("matches the complete canonical arrival focus rather than a nearby item", () => {
    const journey = createJourney({
      taskId: "task-request-7",
      destination: "workflow",
      object: { id: "request-7", type: "workflow-item" },
      focus: {
        quoteId: "quote-42",
        attentionType: "follow_up",
        requestId: "request-7"
      },
      intentId: "review_follow_up"
    });
    const arrival = {
      destination: "workflow",
      object: { id: "request-7", type: "workflow-item", label: "Workflow item" },
      focus: {
        quoteId: "quote-42",
        attentionType: "follow_up",
        requestId: "request-7"
      },
      intentId: "review_follow_up"
    };

    expect(workspaceTaskJourneyMatchesArrival(journey, arrival)).toBe(true);
    expect(workspaceTaskJourneyMatchesArrival(journey, {
      ...arrival,
      focus: { ...arrival.focus, quoteId: "quote-nearby" }
    })).toBe(false);
    expect(workspaceTaskJourneyMatchesArrival(journey, {
      ...arrival,
      focus: { ...arrival.focus, attentionType: "post_event_closeout" }
    })).toBe(false);
    expect(workspaceTaskJourneyMatchesArrival(journey, {
      ...arrival,
      object: { ...arrival.object, id: "request-nearby" }
    })).toBe(false);
  });

  test("requires exact allowlisted creation fields and never accepts caller prose", () => {
    const extraTopLevel = createWorkspaceTaskJourney({
      ...validInput(),
      customerName: "First Continental"
    });
    const extraObject = createWorkspaceTaskJourney(validInput({
      object: {
        id: "quote-42",
        type: "opportunity",
        label: "First Continental Dinner"
      }
    }));
    const extraFocus = createWorkspaceTaskJourney(validInput({
      focus: {
        quoteId: "quote-42",
        notes: "Call the customer before sending"
      }
    }));
    const callerPhase = createWorkspaceTaskJourney({
      ...validInput(),
      phase: "resolved"
    });

    for (const result of [extraTopLevel, extraObject, extraFocus, callerPhase]) {
      expect(result).toMatchObject({ ok: false, journey: null });
    }
    expect(extraTopLevel.recovery.code).toBe("invalid_input");
    expect(extraObject.recovery.code).toBe("unsupported_destination");
    expect(extraFocus.recovery.code).toBe("unsupported_destination");
  });

  test.each([
    ["organization email", { organizationId: "operator@example.test" }],
    ["principal email", { principal: { id: "operator@example.test", role: "sales" } }],
    ["mixed-case role", { principal: { id: "staff-42", role: "Sales" } }],
    ["task email", { taskId: "operator@example.test" }],
    ["object email", {
      object: { id: "operator@example.test", type: "opportunity" },
      focus: { quoteId: "operator@example.test" }
    }],
    ["secret-like task", { taskId: "sk_live_1234567890abcdef" }],
    ["JWT-like task", {
      taskId: "eyJabcdefghijkl.eyJabcdefghijkl.abcdefghijklmnop"
    }],
    ["free prose task", { taskId: "Call First Continental" }]
  ])("rejects unsafe or sensitive opaque identifiers: %s", (_label, overrides) => {
    expect(createWorkspaceTaskJourney(validInput(overrides))).toMatchObject({
      ok: false,
      journey: null
    });
  });

  test("requires a canonical authenticated workspace origin", () => {
    const cases = [
      { routeId: "home", pathname: "/app/" },
      { routeId: "customer-list", pathname: "/app/clients" },
      { routeId: "quote-list", pathname: "/app/customers" },
      { routeId: "outside", pathname: "/" },
      { routeId: "quote-detail", pathname: "/app/quotes/operator%40example.test" },
      { routeId: "quote-list", pathname: "/app/quotes?customer=42" }
    ];

    for (const origin of cases) {
      expect(createWorkspaceTaskJourney(validInput({ origin }))).toMatchObject({
        ok: false,
        recovery: { code: expect.stringMatching(/noncanonical_origin|sensitive_value/) }
      });
    }
  });

  test("moves context independently while preserving the in-progress phase", () => {
    const initial = createJourney();
    const ready = transitionWorkspaceTaskContext(initial, "ready");
    const recovery = transitionWorkspaceTaskContext(ready.journey, "recovery");
    const locating = transitionWorkspaceTaskContext(recovery.journey, "locating");

    expect(ready).toMatchObject({
      ok: true,
      journey: { phase: "in_progress", contextState: "ready", proof: null }
    });
    expect(recovery).toMatchObject({
      ok: true,
      journey: { phase: "in_progress", contextState: "recovery", proof: null }
    });
    expect(locating).toMatchObject({
      ok: true,
      journey: { phase: "in_progress", contextState: "locating", proof: null }
    });
    expect(initial.contextState).toBe("locating");
    expect(transitionWorkspaceTaskContext(initial, "focused")).toMatchObject({
      ok: false,
      recovery: { code: "invalid_transition" }
    });
  });

  test("does not treat destination readiness as task resolution", () => {
    const ready = transitionWorkspaceTaskContext(createJourney(), "ready");

    expect(ready.journey).toMatchObject({
      phase: "in_progress",
      contextState: "ready",
      proof: null
    });
  });

  test("requires bounded verifier proof references before showing resolved", () => {
    const initial = createJourney();

    expect(transitionWorkspaceTaskOutcome(initial, { phase: "resolved" })).toMatchObject({
      ok: false,
      recovery: { code: "missing_resolution_proof" }
    });
    expect(transitionWorkspaceTaskOutcome(initial, {
      phase: "resolved",
      proof: resolutionProof()
    })).toMatchObject({
      ok: true,
      journey: {
        phase: "resolved",
        contextState: "locating",
        proof: resolutionProof()
      }
    });

    for (const proof of [
      { ...resolutionProof(), providerResponse: "accepted" },
      resolutionProof({ verifierId: "operator@example.test" }),
      resolutionProof({ proofId: "sk_live_1234567890abcdef" }),
      resolutionProof({ proofType: "workflow receipt with notes" })
    ]) {
      expect(transitionWorkspaceTaskOutcome(initial, { phase: "resolved", proof })).toMatchObject({
        ok: false,
        journey: null
      });
    }
  });

  test("retains only the bounded confirmation reference for an exact follow-up outcome", () => {
    const journey = createJourney({
      taskId: "review-now-priority:follow-up:quote-42",
      destination: "workflow",
      object: { id: "follow-up:quote-42", type: "workflow-item" },
      focus: {
        quoteId: "quote-42",
        attentionType: "follow_up",
        requestId: "follow-up:quote-42"
      },
      intentId: "review_follow_up"
    });
    const proof = {
      verifierId: WORKSPACE_FOLLOW_UP_TASK_VERIFIER_ID,
      proofId: "follow-up-completed:2026-09-03T02:40:00.000Z",
      proofType: WORKSPACE_FOLLOW_UP_TASK_PROOF_TYPE
    };

    const resolved = transitionWorkspaceTaskOutcome(journey, { phase: "resolved", proof });
    const uncertain = transitionWorkspaceTaskOutcome(journey, { phase: "uncertain" });

    expect(resolved).toMatchObject({
      ok: true,
      journey: {
        phase: "resolved",
        focus: journey.focus,
        proof
      }
    });
    expect(uncertain).toMatchObject({
      ok: true,
      journey: { phase: "uncertain", focus: journey.focus, proof: null }
    });
    const serialized = JSON.stringify(resolved.journey);
    expect(serialized).not.toContain("Confirm the final guest count");
    expect(serialized).not.toContain("sales@example.test");
  });

  test("supports uncertainty recovery and terminal presentation outcomes", () => {
    const initial = createJourney();
    const uncertain = transitionWorkspaceTaskOutcome(initial, { phase: "uncertain" });
    const resumed = transitionWorkspaceTaskOutcome(uncertain.journey, { phase: "in_progress" });

    expect(uncertain).toMatchObject({
      ok: true,
      journey: { phase: "uncertain", proof: null }
    });
    expect(resumed).toMatchObject({
      ok: true,
      journey: { phase: "in_progress", proof: null }
    });

    for (const phase of ["cancelled", "superseded"]) {
      const terminal = transitionWorkspaceTaskOutcome(initial, { phase });
      expect(terminal).toMatchObject({ ok: true, journey: { phase, proof: null } });
      expect(transitionWorkspaceTaskOutcome(terminal.journey, { phase: "in_progress" })).toMatchObject({
        ok: false,
        recovery: { code: "invalid_transition" }
      });
    }
  });

  test("rejects unsupported, repeated, malformed, and proof-bearing non-resolution transitions", () => {
    const initial = createJourney();

    for (const transition of [
      { phase: "in_progress" },
      { phase: "complete" },
      { phase: "cancelled", proof: resolutionProof() },
      { phase: "uncertain", reason: "network error" },
      null
    ]) {
      expect(transitionWorkspaceTaskOutcome(initial, transition)).toMatchObject({
        ok: false,
        recovery: { code: "invalid_transition" }
      });
    }
  });

  test("writes, reads, and clears only the expected organization session key", () => {
    const storage = memoryStorage();
    const journey = createJourney();

    expect(writeWorkspaceTaskJourney("organization-42", journey, storage)).toEqual({
      ok: true,
      journey
    });
    expect(storage.values.size).toBe(1);
    expect(Array.from(storage.values.keys())[0]).toContain("organization-42");
    expect(readWorkspaceTaskJourney("organization-42", storage)).toEqual({
      ok: true,
      journey
    });

    expect(readWorkspaceTaskJourney("organization-other", storage)).toEqual({
      ok: true,
      journey: null
    });
    expect(clearWorkspaceTaskJourney("organization-other", storage)).toEqual({
      ok: true,
      journey: null
    });
    expect(storage.values.size).toBe(1);
    expect(clearWorkspaceTaskJourney("organization-42", storage)).toEqual({
      ok: true,
      journey: null
    });
    expect(storage.values.size).toBe(0);
  });

  test("fails closed when a caller tries to write a foreign-organization journey", () => {
    const storage = memoryStorage();
    const journey = createJourney();

    expect(writeWorkspaceTaskJourney("organization-other", journey, storage)).toMatchObject({
      ok: false,
      recovery: { code: "organization_mismatch" }
    });
    expect(storage.values.size).toBe(0);
  });

  test("fails closed for foreign, malformed, extra-key, sensitive, and oversized stored state", () => {
    const storage = memoryStorage();
    const journey = createJourney();
    writeWorkspaceTaskJourney("organization-42", journey, storage);
    const key = Array.from(storage.values.keys())[0];

    const cases = [
      ["foreign", { ...mutable(journey), organizationId: "organization-other" }, "organization_mismatch"],
      ["extra", { ...mutable(journey), customerName: "First Continental" }, "invalid_journey"],
      ["email", { ...mutable(journey), taskId: "operator@example.test" }, "unsafe_identifier"],
      ["secret", { ...mutable(journey), taskId: "sk_live_1234567890abcdef" }, "unsafe_identifier"],
      ["phase without proof", { ...mutable(journey), phase: "resolved" }, "missing_resolution_proof"]
    ];

    for (const [_label, stored, code] of cases) {
      storage.values.set(key, JSON.stringify(stored));
      expect(readWorkspaceTaskJourney("organization-42", storage)).toMatchObject({
        ok: false,
        recovery: { code }
      });
    }

    storage.values.set(key, "{not-json");
    expect(readWorkspaceTaskJourney("organization-42", storage)).toMatchObject({
      ok: false,
      recovery: { code: "invalid_journey" }
    });

    storage.values.set(key, "x".repeat(WORKSPACE_TASK_JOURNEY_MAX_SERIALIZED_LENGTH + 1));
    expect(readWorkspaceTaskJourney("organization-42", storage)).toMatchObject({
      ok: false,
      recovery: { code: "oversized_journey" }
    });
  });

  test("storage helpers never throw when session storage is missing or hostile", () => {
    const journey = createJourney();
    const hostile = {
      getItem() {
        throw new Error("denied");
      },
      setItem() {
        throw new Error("denied");
      },
      removeItem() {
        throw new Error("denied");
      }
    };

    expect(readWorkspaceTaskJourney("organization-42", null)).toMatchObject({
      ok: false,
      recovery: { code: "storage_unavailable" }
    });
    expect(writeWorkspaceTaskJourney("organization-42", journey, null)).toMatchObject({
      ok: false,
      recovery: { code: "storage_unavailable" }
    });
    expect(clearWorkspaceTaskJourney("organization-42", null)).toMatchObject({
      ok: false,
      recovery: { code: "storage_unavailable" }
    });
    expect(readWorkspaceTaskJourney("organization-42", hostile)).toMatchObject({
      ok: false,
      recovery: { code: "storage_failure" }
    });
    expect(writeWorkspaceTaskJourney("organization-42", journey, hostile)).toMatchObject({
      ok: false,
      recovery: { code: "storage_failure" }
    });
    expect(clearWorkspaceTaskJourney("organization-42", hostile)).toMatchObject({
      ok: false,
      recovery: { code: "storage_failure" }
    });
  });
});
