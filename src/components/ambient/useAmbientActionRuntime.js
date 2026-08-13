import { useCallback, useEffect, useMemo, useRef } from "react";

import {
  createAmbientAction,
  createAmbientActionResult
} from "../../lib/ambientContracts";
import { AMBIENT_ACKNOWLEDGEMENT_DEADLINE_MS } from "../../lib/ambientInteractionAudit";

const OBSERVATION_STATES = new Set([
  "acknowledged",
  "awaiting_acknowledgement",
  "not_applicable",
  "violation"
]);
const RESULT_KINDS = new Set([
  "context",
  "preview",
  "pending",
  "receipt",
  "resolved",
  "recovery"
]);
const MACHINE_CODE = /^[a-z][a-z0-9_]{0,79}$/;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireMonitorMethod(monitor, method) {
  if (typeof monitor?.[method] !== "function") {
    throw new TypeError(`Ambient action monitor must implement ${method}().`);
  }
}

/**
 * Keep React integration independent of the monitor implementation. The
 * monitor remains an observation rail; its failure must never strengthen or
 * block the authority of the user-facing action.
 */
export function createAmbientActionMonitorAdapter(monitor) {
  ["begin", "snapshot", "dispose"].forEach((method) => {
    requireMonitorMethod(monitor, method);
  });

  return Object.freeze({
    begin(action, options = {}) {
      return monitor.begin.call(monitor, action, options);
    },
    acknowledge(token, value) {
      if (typeof monitor.acknowledge === "function") {
        return monitor.acknowledge.call(monitor, token, value);
      }
      if (typeof token?.acknowledge === "function") {
        return token.acknowledge(value);
      }
      throw new TypeError(
        "Ambient action monitor must implement acknowledge() or return an acknowledgement handle from begin()."
      );
    },
    snapshot() {
      return monitor.snapshot.call(monitor);
    },
    dispose() {
      return monitor.dispose.call(monitor);
    }
  });
}

function safeMachineCode(value) {
  return typeof value === "string" && MACHINE_CODE.test(value) ? value : null;
}

function collectAssessments(value, assessments, seen, depth = 0) {
  if (!value || typeof value !== "object" || depth > 6 || seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((entry) => collectAssessments(entry, assessments, seen, depth + 1));
    return;
  }

  const state = OBSERVATION_STATES.has(value.state) ? value.state : null;
  if (state || typeof value.deadClick === "boolean") {
    assessments.push({
      state: state || "unknown",
      deadClick: value.deadClick === true,
      acknowledgementKind: RESULT_KINDS.has(value.acknowledgementKind)
        ? value.acknowledgementKind
        : null,
      acknowledgementMs: Number.isFinite(value.acknowledgementMs)
        ? Math.max(0, value.acknowledgementMs)
        : null,
      reasonCodes: Array.isArray(value.reasonCodes)
        ? value.reasonCodes.map(safeMachineCode).filter(Boolean)
        : []
    });
  }

  Object.values(value).forEach((entry) => {
    collectAssessments(entry, assessments, seen, depth + 1);
  });
}

/**
 * Reduce an arbitrary monitor snapshot to aggregate interaction health. Raw
 * actions, object IDs, labels, customer facts, reasons, consequences, tokens,
 * destinations, and result payloads are deliberately excluded.
 */
export function createPrivacySafeAmbientSnapshot(snapshot) {
  const assessments = [];
  collectAssessments(snapshot, assessments, new WeakSet());

  const stateCounts = {};
  const resultKindCounts = {};
  const reasonCodeCounts = {};
  let deadClickCount = 0;
  let maxAcknowledgementMs = null;

  assessments.forEach((assessment) => {
    stateCounts[assessment.state] = (stateCounts[assessment.state] || 0) + 1;
    if (assessment.deadClick) deadClickCount += 1;
    if (assessment.acknowledgementKind) {
      resultKindCounts[assessment.acknowledgementKind] = (
        resultKindCounts[assessment.acknowledgementKind] || 0
      ) + 1;
    }
    assessment.reasonCodes.forEach((reasonCode) => {
      reasonCodeCounts[reasonCode] = (reasonCodeCounts[reasonCode] || 0) + 1;
    });
    if (assessment.acknowledgementMs !== null) {
      maxAcknowledgementMs = maxAcknowledgementMs === null
        ? assessment.acknowledgementMs
        : Math.max(maxAcknowledgementMs, assessment.acknowledgementMs);
    }
  });

  const summary = isRecord(snapshot) ? snapshot : {};
  const primaryAssessments = Number.isFinite(summary.primaryActionAssessments)
    ? Math.max(0, summary.primaryActionAssessments)
    : null;
  const primaryDeadClicks = Number.isFinite(summary.primaryActionDeadClicks)
    ? Math.max(0, summary.primaryActionDeadClicks)
    : null;
  const primaryPending = Number.isFinite(summary.primaryActionPending)
    ? Math.max(0, summary.primaryActionPending)
    : null;
  const primaryAcknowledgements = Number.isFinite(summary.primaryActionAcknowledgements)
    ? Math.max(0, summary.primaryActionAcknowledgements)
    : null;
  if (primaryPending !== null && primaryPending > 0) {
    stateCounts.awaiting_acknowledgement = (
      stateCounts.awaiting_acknowledgement || 0
    ) + primaryPending;
  }
  if (primaryAcknowledgements !== null && primaryAcknowledgements > 0) {
    stateCounts.acknowledged = (stateCounts.acknowledged || 0) + primaryAcknowledgements;
  }
  if (primaryDeadClicks !== null && primaryDeadClicks > 0) {
    stateCounts.violation = (stateCounts.violation || 0) + primaryDeadClicks;
  }

  const observedActionCount = primaryAssessments ?? assessments.length;
  const normalizedDeadClickCount = primaryDeadClicks ?? deadClickCount;
  return Object.freeze({
    observedActionCount,
    deadClickCount: normalizedDeadClickCount,
    deadClickRate: observedActionCount === 0
      ? 0
      : normalizedDeadClickCount / observedActionCount,
    maxAcknowledgementMs,
    stateCounts: Object.freeze(stateCounts),
    resultKindCounts: Object.freeze(resultKindCounts),
    reasonCodeCounts: Object.freeze(reasonCodeCounts)
  });
}

function normalizeObservationKey(value, action) {
  // Caller-owned labels and action IDs may contain object or customer context.
  // Keep observation taxonomy bounded to the contract's closed purpose enum.
  void value;
  return `ambient-${action.purpose.replaceAll("_", "-")}`;
}

function createSafeObservation({
  phase,
  action,
  observationKey,
  resultKind = null,
  timedOut = false,
  monitorAvailable,
  deadlineMs,
  assessment = null,
  snapshot
}) {
  const safeAssessment = isRecord(assessment) ? assessment : {};
  const acknowledgementMs = Number.isFinite(safeAssessment.acknowledgementMs)
    ? Math.max(0, safeAssessment.acknowledgementMs)
    : null;
  const deadClick = timedOut
    ? true
    : typeof safeAssessment.deadClick === "boolean"
      ? safeAssessment.deadClick
      : null;
  return Object.freeze({
    phase,
    actionKey: normalizeObservationKey(observationKey, action),
    purpose: action.purpose,
    authorityLevel: action.authorityLevel,
    targetKind: action.executionTarget.kind,
    primary: action.primary,
    resultKind: RESULT_KINDS.has(resultKind) ? resultKind : null,
    timedOut,
    deadClick,
    acknowledgementMs,
    monitorAvailable,
    deadlineMs,
    monitor: createPrivacySafeAmbientSnapshot(snapshot)
  });
}

export function createAmbientTimeoutRecovery(actionValue, {
  deadlineMs = AMBIENT_ACKNOWLEDGEMENT_DEADLINE_MS
} = {}) {
  const action = createAmbientAction(actionValue);
  const nextActionId = action.arrivalContract.nextResolutionIds[0] || "keep-current-context";
  const result = createAmbientActionResult({
    kind: "recovery",
    actionId: action.id,
    object: action.arrivalContract.object,
    reason: `${action.outcomeLabel} did not produce visible acknowledgement within ${deadlineMs} milliseconds.`,
    consequence: "Completion was not assumed. Your current work remains available while you choose the next safe resolution.",
    nextResolutions: [{
      actionId: nextActionId,
      label: `Try ${action.outcomeLabel.toLowerCase()} again or keep reviewing this object.`
    }],
    payload: {
      recoveryType: "acknowledgement_timeout",
      deadlineMs
    }
  });

  return Object.freeze({
    label: `${action.outcomeLabel} needs attention`,
    result
  });
}

function defaultSchedule(callback, delayMs) {
  return globalThis.setTimeout(callback, delayMs);
}

function defaultCancel(timer) {
  globalThis.clearTimeout(timer);
}

function scheduleCleanup(callback) {
  if (typeof globalThis.queueMicrotask === "function") {
    globalThis.queueMicrotask(callback);
    return;
  }
  Promise.resolve().then(callback);
}

/**
 * Bind visible AmbientAction acknowledgement to an injected dead-click
 * monitor. The hook owns only presentation recovery and observation; it grants
 * no routing, persistence, provider, or mutation authority.
 */
export function useAmbientActionRuntime({
  monitor,
  onRecovery,
  onObservation,
  acknowledgementDeadlineMs = AMBIENT_ACKNOWLEDGEMENT_DEADLINE_MS,
  createTimeoutRecovery = createAmbientTimeoutRecovery,
  schedule = defaultSchedule,
  cancel = defaultCancel
}) {
  if (!Number.isFinite(acknowledgementDeadlineMs) || acknowledgementDeadlineMs < 0) {
    throw new TypeError("Ambient acknowledgement deadline must be a non-negative finite number.");
  }
  if (typeof onRecovery !== "function") {
    throw new TypeError("Ambient action runtime requires an onRecovery callback for visible recovery.");
  }
  if (onObservation != null && typeof onObservation !== "function") {
    throw new TypeError("Ambient action runtime onObservation must be a function when provided.");
  }

  const adapter = useMemo(() => createAmbientActionMonitorAdapter(monitor), [monitor]);
  const pendingRef = useRef(new Map());
  const sequenceRef = useRef(0);
  const disposedRef = useRef(false);
  const lifecycleGenerationRef = useRef(0);
  const onRecoveryRef = useRef(onRecovery);
  const onObservationRef = useRef(onObservation);
  const recoveryFactoryRef = useRef(createTimeoutRecovery);
  const scheduleRef = useRef(schedule);
  const cancelRef = useRef(cancel);

  onRecoveryRef.current = onRecovery;
  onObservationRef.current = onObservation;
  recoveryFactoryRef.current = createTimeoutRecovery;
  scheduleRef.current = schedule;
  cancelRef.current = cancel;

  const readSnapshot = useCallback(() => {
    try {
      return { available: true, value: adapter.snapshot() };
    } catch {
      return { available: false, value: null };
    }
  }, [adapter]);

  const observe = useCallback((phase, record, {
    resultKind = null,
    timedOut = false,
    monitorAvailable = true,
    assessment = null
  } = {}) => {
    if (typeof onObservationRef.current !== "function") return;
    const snapshot = readSnapshot();
    onObservationRef.current(createSafeObservation({
      phase,
      action: record.action,
      observationKey: record.observationKey,
      resultKind,
      timedOut,
      monitorAvailable: monitorAvailable && snapshot.available,
      deadlineMs: acknowledgementDeadlineMs,
      assessment,
      snapshot: snapshot.value
    }));
  }, [acknowledgementDeadlineMs, readSnapshot]);

  const settleTimeout = useCallback((runtimeToken) => {
    const record = pendingRef.current.get(runtimeToken);
    if (!record || disposedRef.current) return;
    pendingRef.current.delete(runtimeToken);

    let recovery;
    try {
      recovery = recoveryFactoryRef.current(record.action, {
        deadlineMs: acknowledgementDeadlineMs
      });
      if (!isRecord(recovery) || typeof recovery.label !== "string") throw new TypeError();
      recovery = Object.freeze({
        label: recovery.label,
        result: createAmbientActionResult(recovery.result)
      });
    } catch {
      recovery = createAmbientTimeoutRecovery(record.action, {
        deadlineMs: acknowledgementDeadlineMs
      });
    }

    let monitorAvailable = record.monitorAvailable;
    let assessment = null;
    if (record.monitorToken != null) {
      try {
        assessment = adapter.acknowledge(record.monitorToken, {
          result: recovery.result,
          ...(record.destination ? { destination: record.destination } : {})
        });
      } catch {
        monitorAvailable = false;
      }
    }

    onRecoveryRef.current(recovery);
    observe("timeout", record, {
      resultKind: "recovery",
      timedOut: true,
      monitorAvailable,
      assessment
    });
  }, [acknowledgementDeadlineMs, adapter, observe]);

  const begin = useCallback((actionValue, {
    destination = null,
    observationKey = null
  } = {}) => {
    if (disposedRef.current) {
      throw new Error("Ambient action runtime has been disposed.");
    }
    const action = createAmbientAction(actionValue);
    const runtimeToken = Object.freeze({ ambientActionRuntimeToken: ++sequenceRef.current });
    let monitorToken = null;
    let monitorAvailable = true;
    try {
      monitorToken = adapter.begin(action, destination ? { destination } : {});
    } catch {
      monitorAvailable = false;
    }

    const record = {
      action,
      destination,
      observationKey,
      monitorToken,
      monitorAvailable,
      timer: null
    };

    if (action.enabled) {
      // The contract treats exactly 250ms as on time, so recovery begins on
      // the first millisecond after the inclusive deadline.
      record.timer = scheduleRef.current(
        () => settleTimeout(runtimeToken),
        acknowledgementDeadlineMs + 1
      );
      pendingRef.current.set(runtimeToken, record);
    }
    observe(action.enabled ? "begin" : "not_applicable", record, { monitorAvailable });
    return runtimeToken;
  }, [acknowledgementDeadlineMs, adapter, observe, settleTimeout]);

  const acknowledge = useCallback((runtimeToken, {
    result: resultValue,
    destination = null
  } = {}) => {
    const record = pendingRef.current.get(runtimeToken);
    if (!record || disposedRef.current) {
      return Object.freeze({ accepted: false, state: "unknown_or_closed" });
    }
    const result = createAmbientActionResult(resultValue);
    cancelRef.current(record.timer);
    pendingRef.current.delete(runtimeToken);

    let monitorAvailable = record.monitorAvailable;
    let assessment = null;
    if (record.monitorToken != null) {
      try {
        assessment = adapter.acknowledge(record.monitorToken, {
          result,
          ...(destination ? { destination } : {})
        });
      } catch {
        monitorAvailable = false;
      }
    }
    observe("acknowledge", record, {
      resultKind: result.kind,
      monitorAvailable,
      assessment
    });

    return Object.freeze({
      accepted: true,
      state: "acknowledged",
      monitorAvailable,
      result
    });
  }, [adapter, observe]);

  const snapshot = useCallback(() => {
    const current = readSnapshot();
    return createPrivacySafeAmbientSnapshot(current.value);
  }, [readSnapshot]);

  const dispose = useCallback(() => {
    if (disposedRef.current) return;
    disposedRef.current = true;
    pendingRef.current.forEach((record) => cancelRef.current(record.timer));
    pendingRef.current.clear();
    try {
      adapter.dispose();
    } catch {
      // Monitoring is advisory and must not break unmount or route recovery.
    }
  }, [adapter]);

  useEffect(() => {
    lifecycleGenerationRef.current += 1;
    disposedRef.current = false;
    return () => {
      // Presentation timers must stop synchronously on any cleanup so a
      // route-unmounted surface can never emit a late visible recovery.
      pendingRef.current.forEach((record) => cancelRef.current(record.timer));
      pendingRef.current.clear();
      lifecycleGenerationRef.current += 1;
      const cleanupGeneration = lifecycleGenerationRef.current;
      scheduleCleanup(() => {
        // React development mode deliberately replays setup and cleanup. Defer
        // disposal through that synchronous replay, but still dispose after a
        // real unmount so monitor timers cannot outlive their surface.
        if (lifecycleGenerationRef.current === cleanupGeneration) dispose();
      });
    };
  }, [dispose]);

  return useMemo(() => Object.freeze({
    begin,
    acknowledge,
    snapshot,
    dispose
  }), [acknowledge, begin, dispose, snapshot]);
}

export default useAmbientActionRuntime;
