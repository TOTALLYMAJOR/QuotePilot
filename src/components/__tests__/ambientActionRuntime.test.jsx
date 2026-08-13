// @vitest-environment jsdom

import { StrictMode, act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { createAmbientAction, createAmbientActionResult } from "../../lib/ambientContracts";
import { createAmbientActionMonitor } from "../../lib/ambientInteractionAudit";
import {
  createAmbientActionMonitorAdapter,
  createAmbientTimeoutRecovery,
  createPrivacySafeAmbientSnapshot,
  useAmbientActionRuntime
} from "../ambient/useAmbientActionRuntime";

const OBJECT = Object.freeze({
  id: "quote-private-42",
  type: "opportunity",
  label: "Maya Bennett wedding"
});

function action(overrides = {}) {
  return createAmbientAction({
    id: "inspect-guest-count",
    outcomeLabel: "Inspect guest impact",
    purpose: "clarify",
    roles: ["sales"],
    authorityLevel: "presentation",
    previewPolicy: "none",
    executionTarget: {
      kind: "context",
      targetId: "guest-count",
      surfaceId: "guest-count-context"
    },
    receiptType: "context",
    reversibility: { kind: "none" },
    arrivalContract: {
      object: OBJECT,
      reason: "Maya asked whether 120 guests changes staffing.",
      consequence: "The staffing preview may change.",
      nextResolutionIds: ["simulate-guest-count"]
    },
    primary: true,
    enabled: true,
    ...overrides
  });
}

function result(actionValue = action(), overrides = {}) {
  return createAmbientActionResult({
    kind: "context",
    actionId: actionValue.id,
    object: actionValue.arrivalContract.object,
    reason: actionValue.arrivalContract.reason,
    consequence: actionValue.arrivalContract.consequence,
    nextResolutions: [{
      actionId: actionValue.arrivalContract.nextResolutionIds[0],
      label: "Simulate a guest count"
    }],
    payload: {
      customerEmail: "maya@example.test"
    },
    ...overrides
  });
}

function fakeMonitor() {
  const active = new Map();
  const assessments = [];
  let sequence = 0;
  const monitor = {
    begin: vi.fn((actionValue, options) => {
      const token = `monitor-${++sequence}`;
      active.set(token, { action: actionValue, options });
      return token;
    }),
    acknowledge: vi.fn((token, acknowledgement) => {
      const record = active.get(token);
      active.delete(token);
      const assessment = {
        actionId: record?.action?.id,
        state: "acknowledged",
        deadClick: false,
        acknowledgementKind: acknowledgement.result.kind,
        acknowledgementMs: 18,
        reasonCodes: [],
        rawResult: acknowledgement.result,
        rawAction: record?.action
      };
      assessments.push(assessment);
      return assessment;
    }),
    snapshot: vi.fn(() => ({
      assessments,
      active: [...active.values()],
      customerEmail: "maya@example.test"
    })),
    dispose: vi.fn(() => active.clear())
  };
  return monitor;
}

function controlledTime() {
  let now = 0;
  let sequence = 0;
  const tasks = new Map();
  const scheduler = {
    schedule: vi.fn((callback, delayMs) => {
      const id = ++sequence;
      tasks.set(id, { callback, at: now + delayMs, sequence: id });
      return id;
    }),
    cancel: vi.fn((id) => tasks.delete(id))
  };
  return {
    clock: { now: () => now },
    scheduler,
    advance(milliseconds) {
      const target = now + milliseconds;
      while (true) {
        const next = [...tasks.entries()]
          .filter(([, task]) => task.at <= target)
          .sort((left, right) => (
            left[1].at - right[1].at || left[1].sequence - right[1].sequence
          ))[0];
        if (!next) break;
        tasks.delete(next[0]);
        now = next[1].at;
        next[1].callback();
      }
      now = target;
    }
  };
}

function RuntimeHarness({ onReady, ...options }) {
  const runtime = useAmbientActionRuntime(options);
  useEffect(() => {
    onReady(runtime);
  }, [onReady, runtime]);
  return null;
}

describe("Ambient action React runtime", () => {
  let container;
  let root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => root.unmount());
    }
    document.body.innerHTML = "";
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });

  function renderRuntime(options) {
    let runtime;
    act(() => {
      root.render(
        <RuntimeHarness
          {...options}
          onReady={(value) => {
            runtime = value;
          }}
        />
      );
    });
    return () => runtime;
  }

  test("begins and acknowledges through an injected monitor inside the inclusive deadline", () => {
    const monitor = fakeMonitor();
    const onRecovery = vi.fn();
    const onObservation = vi.fn();
    const getRuntime = renderRuntime({ monitor, onRecovery, onObservation });
    const actionValue = action();
    const destination = {
      surface: { id: "guest-count-context" },
      isEmpty: false
    };

    let token;
    act(() => {
      token = getRuntime().begin(actionValue, { destination });
      vi.advanceTimersByTime(250);
      const acknowledgement = getRuntime().acknowledge(token, {
        result: result(actionValue),
        destination
      });
      expect(acknowledgement).toMatchObject({
        accepted: true,
        state: "acknowledged",
        monitorAvailable: true,
        result: { kind: "context" }
      });
      vi.advanceTimersByTime(1);
    });

    expect(onRecovery).not.toHaveBeenCalled();
    expect(monitor.begin).toHaveBeenCalledWith(actionValue, { destination });
    expect(monitor.acknowledge).toHaveBeenCalledTimes(1);
    expect(onObservation.mock.calls.map(([value]) => value.phase)).toEqual([
      "begin",
      "acknowledge"
    ]);
    expect(onObservation.mock.calls.at(-1)[0]).toMatchObject({
      actionKey: "ambient-clarify",
      purpose: "clarify",
      primary: true,
      resultKind: "context",
      timedOut: false,
      deadClick: false,
      acknowledgementMs: 18,
      monitor: {
        observedActionCount: 1,
        deadClickCount: 0,
        deadClickRate: 0,
        maxAcknowledgementMs: 18
      }
    });

    const serialized = JSON.stringify(onObservation.mock.calls);
    expect(serialized).not.toContain("quote-private-42");
    expect(serialized).not.toContain("Maya");
    expect(serialized).not.toContain("maya@example.test");
    expect(serialized).not.toContain("staffing preview");
  });

  test("turns silence after 250ms into visible contextual recovery", () => {
    const monitor = fakeMonitor();
    const onRecovery = vi.fn();
    const onObservation = vi.fn();
    const getRuntime = renderRuntime({ monitor, onRecovery, onObservation });
    const actionValue = action();

    let token;
    act(() => {
      token = getRuntime().begin(actionValue, {
        // Even caller-provided labels are never copied to observations.
        observationKey: "maya-bennett-wedding"
      });
      vi.advanceTimersByTime(250);
    });
    expect(onRecovery).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(onRecovery).toHaveBeenCalledTimes(1);
    const recovery = onRecovery.mock.calls[0][0];
    expect(recovery).toMatchObject({
      label: "Inspect guest impact needs attention",
      result: {
        kind: "recovery",
        actionId: actionValue.id,
        object: OBJECT,
        consequence: expect.stringContaining("Completion was not assumed"),
        nextResolutions: [{
          actionId: "simulate-guest-count",
          label: expect.stringContaining("Try inspect guest impact again")
        }],
        payload: {
          recoveryType: "acknowledgement_timeout",
          deadlineMs: 250
        }
      }
    });
    expect(monitor.acknowledge).toHaveBeenCalledWith(
      "monitor-1",
      expect.objectContaining({ result: recovery.result })
    );
    expect(onObservation.mock.calls.at(-1)[0]).toMatchObject({
      phase: "timeout",
      actionKey: "ambient-clarify",
      resultKind: "recovery",
      timedOut: true,
      deadClick: true,
      deadlineMs: 250
    });
    expect(JSON.stringify(onObservation.mock.calls)).not.toContain("maya-bennett-wedding");

    expect(getRuntime().acknowledge(token, { result: result(actionValue) })).toEqual({
      accepted: false,
      state: "unknown_or_closed"
    });
  });

  test("clears pending recovery and disposes the monitor on unmount", async () => {
    const monitor = fakeMonitor();
    const onRecovery = vi.fn();
    const getRuntime = renderRuntime({ monitor, onRecovery });

    act(() => {
      getRuntime().begin(action());
      root.unmount();
      root = null;
      vi.advanceTimersByTime(1_000);
    });
    await act(async () => Promise.resolve());

    expect(monitor.dispose).toHaveBeenCalledTimes(1);
    expect(onRecovery).not.toHaveBeenCalled();
  });

  test("survives React development effect replay without disposing the live monitor", async () => {
    const monitor = fakeMonitor();
    const onRecovery = vi.fn();
    let runtime;
    await act(async () => {
      root.render(
        <StrictMode>
          <RuntimeHarness
            monitor={monitor}
            onRecovery={onRecovery}
            onReady={(value) => {
              runtime = value;
            }}
          />
        </StrictMode>
      );
      await Promise.resolve();
    });

    expect(monitor.dispose).not.toHaveBeenCalled();
    act(() => {
      const actionValue = action();
      const token = runtime.begin(actionValue);
      expect(runtime.acknowledge(token, { result: result(actionValue) })).toMatchObject({
        accepted: true,
        monitorAvailable: true
      });
    });
    expect(monitor.begin).toHaveBeenCalledOnce();
    expect(monitor.acknowledge).toHaveBeenCalledOnce();
  });

  test("integrates with the production monitor handle and preserves its dead-click rate", () => {
    const time = controlledTime();
    const onViolation = vi.fn();
    const monitor = createAmbientActionMonitor({
      clock: time.clock,
      scheduler: time.scheduler,
      onViolation
    });
    const onRecovery = vi.fn();
    const onObservation = vi.fn();
    const getRuntime = renderRuntime({
      monitor,
      onRecovery,
      onObservation,
      schedule: time.scheduler.schedule,
      cancel: time.scheduler.cancel
    });

    act(() => {
      getRuntime().begin(action());
      time.advance(250);
    });
    expect(onRecovery).not.toHaveBeenCalled();
    expect(onViolation).not.toHaveBeenCalled();

    act(() => {
      time.advance(1);
    });

    expect(onRecovery).toHaveBeenCalledTimes(1);
    expect(onViolation).toHaveBeenCalledTimes(1);
    expect(onObservation.mock.calls.at(-1)[0]).toMatchObject({
      phase: "timeout",
      timedOut: true,
      monitor: {
        observedActionCount: 1,
        deadClickCount: 1,
        deadClickRate: 1,
        stateCounts: { violation: 1 }
      }
    });
    expect(JSON.stringify(onViolation.mock.calls)).not.toContain("Maya");
    expect(JSON.stringify(onViolation.mock.calls)).not.toContain("maya@example.test");
  });

  test("keeps the visible action usable when the advisory monitor fails", () => {
    const monitor = {
      begin: vi.fn(() => {
        throw new Error("monitor unavailable with maya@example.test");
      }),
      snapshot: vi.fn(() => {
        throw new Error("snapshot unavailable");
      }),
      dispose: vi.fn(() => {
        throw new Error("dispose unavailable");
      })
    };
    const onRecovery = vi.fn();
    const onObservation = vi.fn();
    const getRuntime = renderRuntime({ monitor, onRecovery, onObservation });
    const actionValue = action();

    let acknowledgement;
    act(() => {
      const token = getRuntime().begin(actionValue);
      acknowledgement = getRuntime().acknowledge(token, { result: result(actionValue) });
      vi.advanceTimersByTime(1_000);
    });

    expect(acknowledgement).toMatchObject({
      accepted: true,
      state: "acknowledged",
      monitorAvailable: false,
      result: { kind: "context" }
    });
    expect(onRecovery).not.toHaveBeenCalled();
    expect(onObservation.mock.calls.at(-1)[0]).toMatchObject({
      phase: "acknowledge",
      monitorAvailable: false,
      monitor: {
        observedActionCount: 0,
        deadClickCount: 0,
        deadClickRate: 0
      }
    });
    expect(JSON.stringify(onObservation.mock.calls)).not.toContain("maya@example.test");
  });
});

describe("Ambient action runtime adapters", () => {
  test("supports a monitor whose begin call returns the acknowledgement handle", () => {
    const acknowledge = vi.fn(() => ({ state: "acknowledged" }));
    const monitor = {
      begin: vi.fn(() => ({ acknowledge })),
      snapshot: vi.fn(() => ({})),
      dispose: vi.fn()
    };
    const adapter = createAmbientActionMonitorAdapter(monitor);
    const token = adapter.begin(action());
    const resultValue = result();

    expect(adapter.acknowledge(token, { result: resultValue })).toEqual({
      state: "acknowledged"
    });
    expect(acknowledge).toHaveBeenCalledWith({ result: resultValue });
  });

  test("builds a valid recovery and strips raw context from monitor snapshots", () => {
    const actionValue = action();
    const recovery = createAmbientTimeoutRecovery(actionValue);
    expect(recovery.result).toMatchObject({
      kind: "recovery",
      actionId: actionValue.id,
      object: OBJECT,
      payload: { recoveryType: "acknowledgement_timeout", deadlineMs: 250 }
    });

    const raw = {
      primaryActionAssessments: 4,
      primaryActionAcknowledgements: 3,
      primaryActionDeadClicks: 1,
      primaryActionPending: 2,
      primaryActionDeadClickRate: 0.25,
      activeInteractionIds: ["quote-private-42"],
      raw: {
        action: actionValue,
        result: result(actionValue),
        customerEmail: "maya@example.test"
      }
    };
    raw.circular = raw;
    const safe = createPrivacySafeAmbientSnapshot(raw);

    expect(safe).toEqual({
      observedActionCount: 4,
      deadClickCount: 1,
      deadClickRate: 0.25,
      maxAcknowledgementMs: null,
      stateCounts: {
        awaiting_acknowledgement: 2,
        acknowledged: 3,
        violation: 1
      },
      resultKindCounts: {},
      reasonCodeCounts: {}
    });
    const serialized = JSON.stringify(safe);
    expect(serialized).not.toContain("quote-private-42");
    expect(serialized).not.toContain("Maya");
    expect(serialized).not.toContain("maya@example.test");
  });
});
