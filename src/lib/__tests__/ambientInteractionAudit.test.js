import { describe, expect, test } from "vitest";

import {
  createAmbientAction,
  createAmbientActionResult,
  createSecurityDenialResult,
  createSurfacePurposeContract
} from "../ambientContracts.js";
import {
  AMBIENT_ACKNOWLEDGEMENT_DEADLINE_MS,
  assessAmbientActionObservation,
  createAmbientActionMonitor
} from "../ambientInteractionAudit.js";

const opportunityObject = Object.freeze({
  id: "quote-42",
  type: "opportunity",
  label: "Nguyen wedding"
});

function action(overrides = {}) {
  return createAmbientAction({
    id: "open-staffing",
    outcomeLabel: "Resolve staffing",
    purpose: "resolve",
    roles: ["admin"],
    authorityLevel: "presentation",
    previewPolicy: "none",
    executionTarget: {
      kind: "context",
      targetId: "staffing",
      surfaceId: "living-opportunity"
    },
    receiptType: "context",
    reversibility: { kind: "none" },
    arrivalContract: {
      object: opportunityObject,
      reason: "Staffing is incomplete.",
      consequence: "The proposal cannot be prepared.",
      nextResolutionIds: ["use-recommendation", "keep-current"]
    },
    primary: true,
    enabled: true,
    ...overrides
  });
}

function result(overrides = {}) {
  return createAmbientActionResult({
    kind: "context",
    actionId: "open-staffing",
    object: opportunityObject,
    reason: "Staffing is incomplete.",
    consequence: "The proposal cannot be prepared.",
    nextResolutions: [
      { actionId: "use-recommendation", label: "Use recommendation" },
      { actionId: "keep-current", label: "Keep current" }
    ],
    ...overrides
  });
}

function surface(overrides = {}) {
  return createSurfacePurposeContract({
    id: "living-opportunity",
    objectScopes: ["opportunity", "staffing"],
    purposes: ["clarify", "resolve", "simulate", "reveal_context"],
    entryReason: "The selected opportunity needs a staffing decision.",
    allowedEmptyState: null,
    recoveryBehavior: {
      message: "Return to the opportunity with its current state preserved.",
      nextActionIds: ["return-to-opportunity"]
    },
    ...overrides
  });
}

function observation(overrides = {}) {
  return {
    action: action(),
    activatedAtMs: 1_000,
    observedAtMs: 1_100,
    acknowledgement: {
      atMs: 1_100,
      result: result(),
      destination: {
        surface: surface(),
        isEmpty: false
      }
    },
    ...overrides
  };
}

function deterministicRuntime(startAtMs = 1_000) {
  let currentTimeMs = startAtMs;
  let nextTimerId = 1;
  const timers = new Map();

  const clock = {
    now: () => currentTimeMs
  };
  const scheduler = {
    schedule(callback, delayMs) {
      const timerId = nextTimerId;
      nextTimerId += 1;
      timers.set(timerId, {
        callback,
        dueAtMs: currentTimeMs + delayMs
      });
      return timerId;
    },
    cancel(timerId) {
      timers.delete(timerId);
    }
  };

  function advanceBy(deltaMs) {
    const targetTimeMs = currentTimeMs + deltaMs;
    while (true) {
      const nextTimer = [...timers.entries()]
        .filter(([, timer]) => timer.dueAtMs <= targetTimeMs)
        .sort((left, right) => left[1].dueAtMs - right[1].dueAtMs)[0];
      if (!nextTimer) break;
      const [timerId, timer] = nextTimer;
      timers.delete(timerId);
      currentTimeMs = timer.dueAtMs;
      timer.callback();
    }
    currentTimeMs = targetTimeMs;
  }

  return {
    clock,
    scheduler,
    advanceBy,
    pendingTimerCount: () => timers.size
  };
}

describe("ambient interaction audit", () => {
  test("uses an inclusive 250ms acknowledgement deadline", () => {
    expect(AMBIENT_ACKNOWLEDGEMENT_DEADLINE_MS).toBe(250);

    const atDeadline = assessAmbientActionObservation({
      action: action(),
      activatedAtMs: 1_000,
      observedAtMs: 1_250,
      acknowledgement: null
    });
    expect(atDeadline).toMatchObject({
      state: "awaiting_acknowledgement",
      deadClick: false,
      elapsedMs: 250
    });

    const afterDeadline = assessAmbientActionObservation({
      action: action(),
      activatedAtMs: 1_000,
      observedAtMs: 1_251,
      acknowledgement: null
    });
    expect(afterDeadline).toMatchObject({
      state: "violation",
      deadClick: true,
      reasonCodes: ["acknowledgement_timeout"]
    });
  });

  test("accepts exact contextual acknowledgement at 250ms", () => {
    const assessment = assessAmbientActionObservation(observation({
      observedAtMs: 1_500,
      acknowledgement: {
        atMs: 1_250,
        result: result(),
        destination: { surface: surface(), isEmpty: false }
      }
    }));

    expect(assessment).toEqual({
      actionId: "open-staffing",
      state: "acknowledged",
      deadClick: false,
      deadlineMs: 250,
      elapsedMs: 500,
      acknowledgementMs: 250,
      acknowledgementKind: "context",
      reasonCodes: []
    });
    expect(Object.isFrozen(assessment)).toBe(true);
  });

  test("flags late, invalid, mismatched, and contextless acknowledgements", () => {
    expect(assessAmbientActionObservation(observation({
      observedAtMs: 1_300,
      acknowledgement: {
        atMs: 1_251,
        result: result(),
        destination: { surface: surface(), isEmpty: false }
      }
    }))).toMatchObject({
      deadClick: true,
      reasonCodes: ["late_acknowledgement"]
    });

    expect(assessAmbientActionObservation(observation({
      acknowledgement: {
        atMs: 1_050,
        result: {
          kind: "context",
          actionId: "open-staffing",
          object: opportunityObject,
          reason: "Opened.",
          consequence: "Review it.",
          nextResolutions: []
        }
      }
    }))).toMatchObject({
      deadClick: true,
      reasonCodes: ["invalid_action_result"]
    });

    expect(assessAmbientActionObservation(observation({
      acknowledgement: {
        atMs: 1_050,
        result: result({ actionId: "some-other-action" }),
        destination: { surface: surface(), isEmpty: false }
      }
    }))).toMatchObject({
      deadClick: true,
      reasonCodes: ["action_result_mismatch"]
    });

    expect(assessAmbientActionObservation(observation({
      acknowledgement: {
        atMs: 1_050,
        result: result()
      }
    }))).toMatchObject({
      deadClick: true,
      reasonCodes: ["destination_surface_missing"]
    });

    expect(assessAmbientActionObservation(observation({
      acknowledgement: {
        atMs: 1_050,
        result: result(),
        destination: { surface: surface() }
      }
    }))).toMatchObject({
      deadClick: true,
      reasonCodes: ["destination_empty_state_unknown"]
    });
  });

  test("rejects empty and generic destinations", () => {
    const empty = assessAmbientActionObservation(observation({
      acknowledgement: {
        atMs: 1_050,
        result: result(),
        destination: { surface: surface(), isEmpty: true }
      }
    }));
    expect(empty.reasonCodes).toContain("empty_destination");

    const generic = assessAmbientActionObservation(observation({
      acknowledgement: {
        atMs: 1_050,
        result: result(),
        destination: {
          surface: surface({ id: "generic-settings" }),
          isEmpty: false
        }
      }
    }));
    expect(generic.reasonCodes).toContain("destination_surface_mismatch");
  });

  test("requires an exact destination contract for route pending acknowledgements", () => {
    const routeAction = action({
      executionTarget: {
        kind: "route",
        targetId: "quote-42",
        surfaceId: "living-opportunity"
      }
    });
    const pendingResult = result({ kind: "pending" });

    const missingDestination = assessAmbientActionObservation(observation({
      action: routeAction,
      acknowledgement: {
        atMs: 1_040,
        result: pendingResult
      }
    }));
    expect(missingDestination).toMatchObject({
      deadClick: true,
      reasonCodes: ["destination_surface_missing"]
    });

    const exactDestination = assessAmbientActionObservation(observation({
      action: routeAction,
      acknowledgement: {
        atMs: 1_040,
        result: pendingResult,
        destination: { surface: surface(), isEmpty: false }
      }
    }));
    expect(exactDestination).toMatchObject({
      state: "acknowledged",
      deadClick: false,
      acknowledgementKind: "pending"
    });
  });

  test("rejects acknowledgements that are not anchored to the declared arrival contract", () => {
    const unrelated = assessAmbientActionObservation(observation({
      acknowledgement: {
        atMs: 1_050,
        result: result({
          reason: "An unrelated surface opened.",
          consequence: "An unrelated consequence occurred.",
          nextResolutions: [{ actionId: "generic-settings", label: "Open settings" }]
        }),
        destination: { surface: surface(), isEmpty: false }
      }
    }));

    expect(unrelated.reasonCodes).toEqual(expect.arrayContaining([
      "arrival_reason_mismatch",
      "arrival_consequence_mismatch",
      "arrival_next_resolution_mismatch"
    ]));
    expect(unrelated.deadClick).toBe(true);
  });

  test("treats a contextual security denial as recovery rather than a dead click", () => {
    const denial = createSecurityDenialResult({
      actionId: "open-staffing",
      object: opportunityObject,
      reason: "This role cannot change staffing.",
      consequence: "The recorded staffing remains unchanged.",
      nextResolutions: [
        { actionId: "review-read-only", label: "Review current staffing" },
        { actionId: "request-admin", label: "Request admin review" }
      ],
      requiredAuthority: "organization admin"
    });
    const assessment = assessAmbientActionObservation(observation({
      acknowledgement: {
        atMs: 1_020,
        result: denial
      }
    }));

    expect(assessment).toMatchObject({
      state: "acknowledged",
      deadClick: false,
      acknowledgementKind: "recovery",
      reasonCodes: []
    });
  });

  test("does not count disabled actions as dead clicks", () => {
    const assessment = assessAmbientActionObservation({
      action: action({ enabled: false, disabledReason: "This role cannot open the inspector." }),
      activatedAtMs: 1_000,
      observedAtMs: 2_000,
      acknowledgement: null
    });

    expect(assessment).toMatchObject({
      state: "not_applicable",
      deadClick: false,
      reasonCodes: ["action_disabled"]
    });
  });

  test("monitors an enabled action and accepts acknowledgement on the inclusive boundary", () => {
    const runtime = deterministicRuntime();
    const violations = [];
    const monitor = createAmbientActionMonitor({
      clock: runtime.clock,
      scheduler: runtime.scheduler,
      onViolation: (violation) => violations.push(violation)
    });
    const attempt = monitor.begin(action());

    runtime.advanceBy(250);
    expect(runtime.pendingTimerCount()).toBe(1);
    expect(monitor.snapshot()).toMatchObject({
      primaryActionActivations: 1,
      primaryActionAssessments: 0,
      primaryActionPending: 1,
      primaryActionDeadClickRate: 0,
      activeInteractionIds: [attempt.interactionId]
    });

    const assessment = attempt.acknowledge({
      result: result(),
      destination: { surface: surface(), isEmpty: false }
    });
    expect(assessment).toMatchObject({
      state: "acknowledged",
      deadClick: false,
      acknowledgementMs: 250
    });
    expect(runtime.pendingTimerCount()).toBe(0);
    runtime.advanceBy(1);
    expect(violations).toEqual([]);
    expect(monitor.snapshot()).toEqual({
      primaryActionActivations: 1,
      primaryActionAssessments: 1,
      primaryActionAcknowledgements: 1,
      primaryActionDeadClicks: 0,
      primaryActionPending: 0,
      primaryActionDisposed: 0,
      primaryActionDeadClickRate: 0,
      activeInteractionIds: []
    });
  });

  test("synthesizes one privacy-safe timeout violation immediately after 250ms", () => {
    const runtime = deterministicRuntime();
    const violations = [];
    const monitor = createAmbientActionMonitor({
      clock: runtime.clock,
      scheduler: runtime.scheduler,
      onViolation: (violation) => violations.push(violation)
    });
    const attempt = monitor.begin(action());

    runtime.advanceBy(250);
    expect(violations).toEqual([]);
    runtime.advanceBy(1);

    expect(violations).toEqual([{
      interactionId: attempt.interactionId,
      actionId: "open-staffing",
      state: "violation",
      deadClick: true,
      deadlineMs: 250,
      elapsedMs: 251,
      acknowledgementMs: null,
      acknowledgementKind: null,
      reasonCodes: ["acknowledgement_timeout"]
    }]);
    expect(Object.isFrozen(violations[0])).toBe(true);
    expect(monitor.snapshot()).toEqual({
      primaryActionActivations: 1,
      primaryActionAssessments: 1,
      primaryActionAcknowledgements: 0,
      primaryActionDeadClicks: 1,
      primaryActionPending: 0,
      primaryActionDisposed: 0,
      primaryActionDeadClickRate: 1,
      activeInteractionIds: []
    });
  });

  test("assesses the exact action result and destination and aggregates primary actions only", () => {
    const runtime = deterministicRuntime();
    const violations = [];
    const monitor = createAmbientActionMonitor({
      clock: runtime.clock,
      scheduler: runtime.scheduler,
      onViolation: (violation) => violations.push(violation)
    });

    monitor.begin(action()).acknowledge({
      result: result(),
      destination: { surface: surface(), isEmpty: false }
    });
    const invalidPrimary = monitor.begin(action({ id: "open-staffing-invalid" }));
    const invalidAssessment = invalidPrimary.acknowledge({
      result: result(),
      destination: {
        surface: surface({ id: "generic-settings" }),
        isEmpty: false
      }
    });
    const nonPrimary = monitor.begin(action({ id: "secondary-staffing", primary: false }));
    nonPrimary.acknowledge({ result: result() });

    expect(invalidAssessment.reasonCodes).toEqual(expect.arrayContaining([
      "action_result_mismatch",
      "destination_surface_mismatch"
    ]));
    expect(violations).toHaveLength(2);
    expect(monitor.snapshot()).toMatchObject({
      primaryActionActivations: 2,
      primaryActionAssessments: 2,
      primaryActionAcknowledgements: 1,
      primaryActionDeadClicks: 1,
      primaryActionDeadClickRate: 0.5
    });
  });

  test("keeps aggregate snapshots free of object, customer, and action content", () => {
    const runtime = deterministicRuntime();
    const monitor = createAmbientActionMonitor({
      clock: runtime.clock,
      scheduler: runtime.scheduler
    });
    const attempt = monitor.begin(action());
    const snapshot = monitor.snapshot();
    const serialized = JSON.stringify(snapshot);

    expect(snapshot.activeInteractionIds).toEqual([attempt.interactionId]);
    expect(serialized).not.toContain(opportunityObject.id);
    expect(serialized).not.toContain(opportunityObject.label);
    expect(serialized).not.toContain("open-staffing");
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.activeInteractionIds)).toBe(true);
  });

  test("rejects disabled actions and disposes every outstanding timer", () => {
    const runtime = deterministicRuntime();
    const violations = [];
    const monitor = createAmbientActionMonitor({
      clock: runtime.clock,
      scheduler: runtime.scheduler,
      onViolation: (violation) => violations.push(violation)
    });

    expect(() => monitor.begin(action({
      enabled: false,
      disabledReason: "This role cannot resolve staffing."
    }))).toThrow(/must be enabled/);

    const primaryAttempt = monitor.begin(action());
    monitor.begin(action({ id: "secondary-staffing", primary: false }));
    expect(runtime.pendingTimerCount()).toBe(2);
    monitor.dispose();
    monitor.dispose();

    expect(runtime.pendingTimerCount()).toBe(0);
    runtime.advanceBy(1_000);
    expect(violations).toEqual([]);
    expect(monitor.snapshot()).toEqual({
      primaryActionActivations: 1,
      primaryActionAssessments: 0,
      primaryActionAcknowledgements: 0,
      primaryActionDeadClicks: 0,
      primaryActionPending: 0,
      primaryActionDisposed: 1,
      primaryActionDeadClickRate: 0,
      activeInteractionIds: []
    });
    expect(() => primaryAttempt.acknowledge({
      result: result(),
      destination: { surface: surface(), isEmpty: false }
    })).toThrow(/cannot acknowledge/);
    expect(() => monitor.begin(action())).toThrow(/cannot begin/);
  });
});
