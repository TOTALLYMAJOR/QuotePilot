import {
  AmbientContractError,
  createAmbientAction,
  createAmbientActionResult,
  createSurfacePurposeContract
} from "./ambientContracts.js";

export const AMBIENT_ACKNOWLEDGEMENT_DEADLINE_MS = 250;

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key], seen));
  return Object.freeze(value);
}

function finiteTime(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new AmbientContractError("invalid_time", path, "must be a non-negative finite number");
  }
  return value;
}

function sameObjectRef(left, right) {
  return left.id === right.id && left.type === right.type;
}

function resultResolutionIds(result) {
  return new Set(result.nextResolutions.map((resolution) => resolution.actionId));
}

function violationResult({ action, elapsedMs, acknowledgementMs = null, reasonCodes }) {
  return deepFreeze({
    actionId: action.id,
    state: "violation",
    deadClick: true,
    deadlineMs: AMBIENT_ACKNOWLEDGEMENT_DEADLINE_MS,
    elapsedMs,
    acknowledgementMs,
    acknowledgementKind: null,
    reasonCodes
  });
}

/**
 * Evaluate one enabled-action observation without timers or side effects.
 * Callers supply their monotonic timestamps and any acknowledgement/result.
 */
export function assessAmbientActionObservation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AmbientContractError(
      "invalid_record",
      "AmbientActionObservation",
      "must be a plain object"
    );
  }
  const action = createAmbientAction(value.action);
  const activatedAtMs = finiteTime(value.activatedAtMs, "AmbientActionObservation.activatedAtMs");
  const observedAtMs = finiteTime(value.observedAtMs, "AmbientActionObservation.observedAtMs");
  if (observedAtMs < activatedAtMs) {
    throw new AmbientContractError(
      "invalid_time_order",
      "AmbientActionObservation.observedAtMs",
      "must not precede activation"
    );
  }
  const elapsedMs = observedAtMs - activatedAtMs;

  if (!action.enabled) {
    return deepFreeze({
      actionId: action.id,
      state: "not_applicable",
      deadClick: false,
      deadlineMs: AMBIENT_ACKNOWLEDGEMENT_DEADLINE_MS,
      elapsedMs,
      acknowledgementMs: null,
      acknowledgementKind: null,
      reasonCodes: ["action_disabled"]
    });
  }

  if (value.acknowledgement == null) {
    if (elapsedMs <= AMBIENT_ACKNOWLEDGEMENT_DEADLINE_MS) {
      return deepFreeze({
        actionId: action.id,
        state: "awaiting_acknowledgement",
        deadClick: false,
        deadlineMs: AMBIENT_ACKNOWLEDGEMENT_DEADLINE_MS,
        elapsedMs,
        acknowledgementMs: null,
        acknowledgementKind: null,
        reasonCodes: []
      });
    }
    return violationResult({
      action,
      elapsedMs,
      reasonCodes: ["acknowledgement_timeout"]
    });
  }

  const acknowledgement = value.acknowledgement;
  if (!acknowledgement || typeof acknowledgement !== "object" || Array.isArray(acknowledgement)) {
    return violationResult({ action, elapsedMs, reasonCodes: ["invalid_acknowledgement"] });
  }
  let acknowledgedAtMs;
  try {
    acknowledgedAtMs = finiteTime(
      acknowledgement.atMs,
      "AmbientActionObservation.acknowledgement.atMs"
    );
  } catch {
    return violationResult({ action, elapsedMs, reasonCodes: ["invalid_acknowledgement_time"] });
  }
  const acknowledgementMs = acknowledgedAtMs - activatedAtMs;
  if (acknowledgedAtMs < activatedAtMs || acknowledgedAtMs > observedAtMs) {
    return violationResult({
      action,
      elapsedMs,
      acknowledgementMs,
      reasonCodes: ["invalid_acknowledgement_time"]
    });
  }

  let result;
  try {
    result = createAmbientActionResult(acknowledgement.result);
  } catch {
    return violationResult({
      action,
      elapsedMs,
      acknowledgementMs,
      reasonCodes: ["invalid_action_result"]
    });
  }

  const reasonCodes = [];
  if (acknowledgementMs > AMBIENT_ACKNOWLEDGEMENT_DEADLINE_MS) {
    reasonCodes.push("late_acknowledgement");
  }
  if (result.actionId !== action.id) reasonCodes.push("action_result_mismatch");
  if (!sameObjectRef(result.object, action.arrivalContract.object)) {
    reasonCodes.push("arrival_object_mismatch");
  }
  if (result.kind !== "recovery") {
    if (result.reason !== action.arrivalContract.reason) {
      reasonCodes.push("arrival_reason_mismatch");
    }
    if (result.consequence !== action.arrivalContract.consequence) {
      reasonCodes.push("arrival_consequence_mismatch");
    }
    const resolutionIds = resultResolutionIds(result);
    if (!action.arrivalContract.nextResolutionIds.some((actionId) => resolutionIds.has(actionId))) {
      reasonCodes.push("arrival_next_resolution_mismatch");
    }
  }

  const shouldValidateDestination = (
    result.kind === "context"
    || (result.kind === "pending" && action.executionTarget.kind === "route")
  ) && ["context", "route"].includes(action.executionTarget.kind);
  if (shouldValidateDestination) {
    if (!acknowledgement.destination) {
      reasonCodes.push("destination_surface_missing");
    } else {
      let surface;
      try {
        surface = createSurfacePurposeContract(acknowledgement.destination.surface);
      } catch {
        reasonCodes.push("invalid_destination_surface");
      }
      if (surface) {
        if (surface.id !== action.executionTarget.surfaceId) {
          reasonCodes.push("destination_surface_mismatch");
        }
        if (!surface.objectScopes.includes(result.object.type)) {
          reasonCodes.push("destination_object_out_of_scope");
        }
        if (!surface.purposes.includes(action.purpose)) {
          reasonCodes.push("destination_purpose_unsupported");
        }
        if (typeof acknowledgement.destination.isEmpty !== "boolean") {
          reasonCodes.push("destination_empty_state_unknown");
        } else if (acknowledgement.destination.isEmpty === true) {
          if (!surface.allowedEmptyState) {
            reasonCodes.push("empty_destination");
          } else if (
            acknowledgement.destination.emptyStateKind !== surface.allowedEmptyState.kind
          ) {
            reasonCodes.push("invalid_empty_state");
          }
        }
      }
    }
  }

  if (reasonCodes.length > 0) {
    return violationResult({ action, elapsedMs, acknowledgementMs, reasonCodes });
  }

  return deepFreeze({
    actionId: action.id,
    state: "acknowledged",
    deadClick: false,
    deadlineMs: AMBIENT_ACKNOWLEDGEMENT_DEADLINE_MS,
    elapsedMs,
    acknowledgementMs,
    acknowledgementKind: result.kind,
    reasonCodes: []
  });
}

function defaultMonotonicNow() {
  const value = globalThis.performance?.now?.();
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new AmbientContractError(
      "monotonic_clock_unavailable",
      "AmbientActionMonitor.clock.now",
      "must return a non-negative finite monotonic time"
    );
  }
  return value;
}

const DEFAULT_MONITOR_CLOCK = Object.freeze({
  now: defaultMonotonicNow
});

const DEFAULT_MONITOR_SCHEDULER = Object.freeze({
  schedule(callback, delayMs) {
    return globalThis.setTimeout(callback, delayMs);
  },
  cancel(timerId) {
    globalThis.clearTimeout(timerId);
  }
});

function monitorDependency(value, method, path) {
  if (!value || typeof value !== "object" || typeof value[method] !== "function") {
    throw new AmbientContractError("invalid_monitor_dependency", path, `must provide ${method}()`);
  }
  return value;
}

function monitorCallback(value, path) {
  if (typeof value !== "function") {
    throw new AmbientContractError("invalid_monitor_callback", path, "must be a function");
  }
  return value;
}

function monitorStateError(code, path, message) {
  throw new AmbientContractError(code, path, message);
}

function privacySafeViolation(interactionId, assessment) {
  return deepFreeze({
    interactionId,
    actionId: assessment.actionId,
    state: assessment.state,
    deadClick: assessment.deadClick,
    deadlineMs: assessment.deadlineMs,
    elapsedMs: assessment.elapsedMs,
    acknowledgementMs: assessment.acknowledgementMs,
    acknowledgementKind: assessment.acknowledgementKind,
    reasonCodes: [...assessment.reasonCodes]
  });
}

/**
 * Observe enabled presentation actions without adding persistence, analytics,
 * or authority. The injected clock must be monotonic; the scheduler exists so
 * the inclusive deadline can be proved without relying on wall-clock tests.
 */
export function createAmbientActionMonitor({
  clock = DEFAULT_MONITOR_CLOCK,
  scheduler = DEFAULT_MONITOR_SCHEDULER,
  onViolation = () => {}
} = {}) {
  const monitorClock = monitorDependency(clock, "now", "AmbientActionMonitor.clock");
  const monitorScheduler = monitorDependency(
    monitorDependency(scheduler, "schedule", "AmbientActionMonitor.scheduler"),
    "cancel",
    "AmbientActionMonitor.scheduler"
  );
  const reportViolation = monitorCallback(onViolation, "AmbientActionMonitor.onViolation");

  let disposed = false;
  let lastObservedAtMs = null;
  let nextInteractionNumber = 1;
  const active = new Map();
  const primary = {
    activations: 0,
    assessments: 0,
    acknowledgements: 0,
    deadClicks: 0,
    disposed: 0
  };

  function readNow() {
    const value = finiteTime(monitorClock.now(), "AmbientActionMonitor.clock.now");
    if (lastObservedAtMs !== null && value < lastObservedAtMs) {
      monitorStateError(
        "non_monotonic_clock",
        "AmbientActionMonitor.clock.now",
        "must not move backwards"
      );
    }
    lastObservedAtMs = value;
    return value;
  }

  function updatePrimaryAssessment(record, assessment) {
    if (!record.action.primary) return;
    primary.assessments += 1;
    if (assessment.deadClick) primary.deadClicks += 1;
    else if (assessment.state === "acknowledged") primary.acknowledgements += 1;
  }

  function settle(record, assessment) {
    if (record.assessment) return record.assessment;
    if (record.timerId !== null) {
      monitorScheduler.cancel(record.timerId);
      record.timerId = null;
    }
    record.assessment = assessment;
    active.delete(record.interactionId);
    updatePrimaryAssessment(record, assessment);
    if (assessment.deadClick) {
      try {
        reportViolation(privacySafeViolation(record.interactionId, assessment));
      } catch {
        // Monitoring feedback must never change the interaction being observed.
      }
    }
    return assessment;
  }

  function timeoutObservation(record) {
    if (disposed || record.assessment) return;
    record.timerId = null;
    const observedAtMs = readNow();
    const assessment = assessAmbientActionObservation({
      action: record.action,
      activatedAtMs: record.activatedAtMs,
      observedAtMs,
      acknowledgement: null
    });
    if (assessment.state === "awaiting_acknowledgement") {
      // Exactly 250ms is still valid. Wake at least one millisecond later when
      // a scheduler fires precisely on the inclusive boundary.
      const remainingMs = Math.max(
        1,
        AMBIENT_ACKNOWLEDGEMENT_DEADLINE_MS - assessment.elapsedMs
      );
      record.timerId = monitorScheduler.schedule(
        () => timeoutObservation(record),
        remainingMs
      );
      return;
    }
    settle(record, assessment);
  }

  function begin(actionValue) {
    if (disposed) {
      monitorStateError("monitor_disposed", "AmbientActionMonitor.begin", "cannot begin an action");
    }
    const action = createAmbientAction(actionValue);
    if (!action.enabled) {
      monitorStateError(
        "action_disabled",
        "AmbientActionMonitor.begin.action",
        "must be enabled before monitoring begins"
      );
    }

    const interactionId = `ambient-interaction-${nextInteractionNumber}`;
    nextInteractionNumber += 1;
    const record = {
      interactionId,
      action,
      activatedAtMs: readNow(),
      timerId: null,
      assessment: null
    };
    active.set(interactionId, record);
    if (action.primary) primary.activations += 1;

    try {
      record.timerId = monitorScheduler.schedule(
        () => timeoutObservation(record),
        AMBIENT_ACKNOWLEDGEMENT_DEADLINE_MS
      );
    } catch (error) {
      active.delete(interactionId);
      if (action.primary) primary.activations -= 1;
      throw error;
    }

    return Object.freeze({
      interactionId,
      acknowledge({ result, destination } = {}) {
        if (disposed) {
          monitorStateError(
            "monitor_disposed",
            "AmbientActionMonitor.acknowledge",
            "cannot acknowledge an action"
          );
        }
        if (record.assessment) return record.assessment;
        const acknowledgedAtMs = readNow();
        const assessment = assessAmbientActionObservation({
          action: record.action,
          activatedAtMs: record.activatedAtMs,
          observedAtMs: acknowledgedAtMs,
          acknowledgement: {
            atMs: acknowledgedAtMs,
            result,
            destination
          }
        });
        return settle(record, assessment);
      }
    });
  }

  function snapshot() {
    const activePrimaryIds = [...active.values()]
      .filter((record) => record.action.primary)
      .map((record) => record.interactionId);
    const assessed = primary.assessments;
    return deepFreeze({
      primaryActionActivations: primary.activations,
      primaryActionAssessments: assessed,
      primaryActionAcknowledgements: primary.acknowledgements,
      primaryActionDeadClicks: primary.deadClicks,
      primaryActionPending: activePrimaryIds.length,
      primaryActionDisposed: primary.disposed,
      primaryActionDeadClickRate: assessed === 0 ? 0 : primary.deadClicks / assessed,
      activeInteractionIds: activePrimaryIds
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    active.forEach((record) => {
      if (record.timerId !== null) monitorScheduler.cancel(record.timerId);
      record.timerId = null;
      if (record.action.primary) primary.disposed += 1;
    });
    active.clear();
  }

  return Object.freeze({ begin, snapshot, dispose });
}
