// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  useWorkspaceActionFeedback,
  WorkspaceActionFeedbackProvider
} from "../WorkspaceActionFeedbackContext";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SCOPE = Object.freeze({
  organizationId: "organization-42",
  principalId: "staff-42",
  role: "sales"
});

let container;
let root;

function Probe({ onValue }) {
  const value = useWorkspaceActionFeedback();
  onValue(value);
  return (
    <output
      data-available={String(value.available)}
      data-count={String(value.feedbackRecords.length)}
      data-phase={value.currentFeedback?.phase || ""}
      data-attempt={value.currentFeedback?.attemptId || ""}
      data-announcement={value.announcement?.id || ""}
    >
      {value.announcement?.text || "No announcement"}
    </output>
  );
}

function beginInput(overrides = {}) {
  return {
    actionId: "complete_follow_up",
    actionLabel: "Complete follow-up",
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
  };
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("WorkspaceActionFeedbackProvider", () => {
  test("returns a safe frozen unavailable contract outside a provider", () => {
    let feedback;
    act(() => {
      root.render(<Probe onValue={(value) => { feedback = value; }} />);
    });

    expect(feedback.available).toBe(false);
    expect(feedback.feedbackRecords).toEqual([]);
    expect(feedback.currentFeedback).toBeNull();
    expect(feedback.announcement).toBeNull();
    expect(feedback.beginActionFeedback(beginInput())).toMatchObject({
      ok: false,
      reason: "feedback_provider_unavailable"
    });
    expect(feedback.transitionActionFeedback({})).toMatchObject({
      ok: false,
      reason: "feedback_provider_unavailable"
    });
    expect(feedback.acknowledgeActionFeedback({})).toMatchObject({
      ok: false,
      reason: "feedback_provider_unavailable"
    });
    expect(Object.isFrozen(feedback)).toBe(true);
    expect(Object.isFrozen(feedback.feedbackRecords)).toBe(true);
    expect(container.querySelector("output").dataset.available).toBe("false");
  });

  test("injects scope, clock, and attempt id and returns the pending record synchronously", () => {
    let feedback;
    const idFactory = vi.fn(() => "attempt-generated-42");
    const testClock = vi.fn(() => "2026-09-03T05:40:00.000Z");
    act(() => {
      root.render(
        <WorkspaceActionFeedbackProvider
          scope={SCOPE}
          clock={testClock}
          idFactory={idFactory}
        >
          <Probe onValue={(value) => { feedback = value; }} />
        </WorkspaceActionFeedbackProvider>
      );
    });

    let result;
    act(() => {
      result = feedback.beginActionFeedback(beginInput());
      expect(result).toMatchObject({
        ok: true,
        status: "begun",
        record: {
          phase: "pending",
          attemptId: "attempt-generated-42",
          generation: "task-generation-42",
          startedAtISO: "2026-09-03T05:40:00.000Z"
        },
        selector: { scope: SCOPE }
      });
    });

    expect(idFactory).toHaveBeenCalledWith({
      actionId: "complete_follow_up",
      object: {
        kind: "workflow-item",
        id: "follow-up-42",
        label: "Follow-up task"
      },
      generation: "task-generation-42",
      nowISO: "2026-09-03T05:40:00.000Z"
    });
    expect(feedback.available).toBe(true);
    expect(feedback.feedbackRecords).toHaveLength(1);
    expect(feedback.currentFeedback).toBe(result.record);
    expect(feedback.announcement).toEqual(result.announcement);
    expect(container.querySelector("output").dataset.phase).toBe("pending");
    expect(Object.isFrozen(feedback.currentFeedback)).toBe(true);
  });

  test("transitions with the retained attempt and generation while deriving its fenced identity", () => {
    let feedback;
    const times = [
      "2026-09-03T05:40:00.000Z",
      "2026-09-03T05:41:00.000Z"
    ];
    const testClock = vi.fn(() => times.shift());
    act(() => {
      root.render(
        <WorkspaceActionFeedbackProvider
          scope={SCOPE}
          clock={testClock}
          idFactory={() => "attempt-generated-42"}
        >
          <Probe onValue={(value) => { feedback = value; }} />
        </WorkspaceActionFeedbackProvider>
      );
    });
    let started;
    act(() => {
      started = feedback.beginActionFeedback(beginInput());
    });
    const pendingAnnouncement = feedback.announcement;

    let succeeded;
    act(() => {
      succeeded = feedback.transitionActionFeedback({
        attemptId: started.record.attemptId,
        generation: started.record.generation,
        phase: "succeeded",
        message: "The authoritative record confirms completion.",
        changed: ["Follow-up marked complete"],
        unchanged: ["The note is unchanged"],
        evidence: {
          kind: "authoritative_readback",
          id: "receipt-42",
          source: "follow-up-server-readback"
        }
      });
    });

    expect(succeeded).toMatchObject({
      ok: true,
      record: {
        phase: "succeeded",
        actionId: "complete_follow_up",
        object: { id: "follow-up-42" },
        revision: 1
      }
    });
    expect(feedback.currentFeedback).toBe(succeeded.record);
    expect(feedback.announcement.id).not.toBe(pendingAnnouncement.id);
    expect(container.querySelector("output").textContent).toContain("succeeded");
  });

  test("rejects a mismatched supplied identity and leaves the current feedback unchanged", () => {
    let feedback;
    act(() => {
      root.render(
        <WorkspaceActionFeedbackProvider
          scope={SCOPE}
          clock={() => "2026-09-03T05:40:00.000Z"}
          idFactory={() => "attempt-generated-42"}
        >
          <Probe onValue={(value) => { feedback = value; }} />
        </WorkspaceActionFeedbackProvider>
      );
    });
    let started;
    act(() => {
      started = feedback.beginActionFeedback(beginInput());
    });
    const announcement = feedback.announcement;

    let rejected;
    act(() => {
      rejected = feedback.transitionActionFeedback({
        attemptId: started.record.attemptId,
        generation: started.record.generation,
        actionId: "complete_nearby_follow_up",
        phase: "recovery",
        message: "This must be rejected.",
        nextAction: { id: "inspect", label: "Inspect" }
      });
    });

    expect(rejected).toMatchObject({ ok: false, reason: "identity_mismatch" });
    expect(feedback.currentFeedback).toBe(started.record);
    expect(feedback.announcement).toBe(announcement);
  });

  test("deduplicates an identical stage update into one atomic announcement value", () => {
    let feedback;
    act(() => {
      root.render(
        <WorkspaceActionFeedbackProvider
          scope={SCOPE}
          clock={() => "2026-09-03T05:40:00.000Z"}
          idFactory={() => "attempt-generated-42"}
        >
          <Probe onValue={(value) => { feedback = value; }} />
        </WorkspaceActionFeedbackProvider>
      );
    });
    let started;
    act(() => {
      started = feedback.beginActionFeedback(beginInput());
    });
    const firstAnnouncement = feedback.announcement;

    let duplicate;
    act(() => {
      duplicate = feedback.transitionActionFeedback({
        attemptId: started.record.attemptId,
        generation: started.record.generation,
        phase: "pending",
        message: started.record.message
      });
    });

    expect(duplicate).toMatchObject({ ok: true, status: "unchanged", announcement: null });
    expect(feedback.announcement).toBe(firstAnnouncement);
    expect(feedback.currentFeedback.revision).toBe(0);
  });

  test("does not collapse distinct delimiter-bearing attempt identities into one announcement", () => {
    let feedback;
    const ids = ["attempt:left", "attempt"];
    act(() => {
      root.render(
        <WorkspaceActionFeedbackProvider
          scope={SCOPE}
          clock={() => "2026-09-03T05:40:00.000Z"}
          idFactory={() => ids.shift()}
        >
          <Probe onValue={(value) => { feedback = value; }} />
        </WorkspaceActionFeedbackProvider>
      );
    });

    let first;
    act(() => {
      first = feedback.beginActionFeedback(beginInput({
        generation: "generation",
        object: { kind: "workflow-item", id: "follow-up-first", label: "First follow-up" }
      }));
    });
    let second;
    act(() => {
      second = feedback.beginActionFeedback(beginInput({
        generation: "left:generation",
        object: { kind: "workflow-item", id: "follow-up-second", label: "Second follow-up" }
      }));
    });

    expect(first.announcement.id).not.toBe(second.announcement.id);
    expect(feedback.currentFeedback).toBe(second.record);
    expect(feedback.announcement).toBe(second.announcement);
    expect(container.querySelector("output").textContent).toContain("Second follow-up");
  });

  test("rejects pending acknowledgement and clears an acknowledged recovery record", () => {
    let feedback;
    const times = [
      "2026-09-03T05:40:00.000Z",
      "2026-09-03T05:41:00.000Z"
    ];
    act(() => {
      root.render(
        <WorkspaceActionFeedbackProvider
          scope={SCOPE}
          clock={() => times.shift() || "2026-09-03T05:41:00.000Z"}
          idFactory={() => "attempt-generated-42"}
        >
          <Probe onValue={(value) => { feedback = value; }} />
        </WorkspaceActionFeedbackProvider>
      );
    });
    let started;
    act(() => {
      started = feedback.beginActionFeedback(beginInput());
    });

    expect(feedback.acknowledgeActionFeedback(started.record)).toMatchObject({
      ok: false,
      reason: "feedback_not_dismissible"
    });
    let recovered;
    act(() => {
      recovered = feedback.transitionActionFeedback({
        attemptId: started.record.attemptId,
        generation: started.record.generation,
        phase: "recovery",
        message: "Nothing changed; the form is still available.",
        nextAction: { id: "return", label: "Return to the form" }
      });
    });
    let acknowledged;
    act(() => {
      acknowledged = feedback.acknowledgeActionFeedback(recovered.record);
    });
    expect(acknowledged).toMatchObject({ ok: true, status: "acknowledged" });
    expect(feedback.feedbackRecords).toEqual([]);
    expect(feedback.currentFeedback).toBeNull();
    expect(feedback.announcement).toBeNull();
  });

  test("clears only the acknowledged current announcement and exposes queued feedback without re-announcing it", () => {
    let feedback;
    const ids = ["attempt-first", "attempt-second"];
    const times = [
      "2026-09-03T05:40:00.000Z",
      "2026-09-03T05:41:00.000Z",
      "2026-09-03T05:42:00.000Z",
      "2026-09-03T05:43:00.000Z"
    ];
    act(() => {
      root.render(
        <WorkspaceActionFeedbackProvider
          scope={SCOPE}
          clock={() => times.shift() || "2026-09-03T05:43:00.000Z"}
          idFactory={() => ids.shift()}
        >
          <Probe onValue={(value) => { feedback = value; }} />
        </WorkspaceActionFeedbackProvider>
      );
    });

    let first;
    act(() => {
      first = feedback.beginActionFeedback(beginInput({
        generation: "generation-first",
        object: { kind: "workflow-item", id: "follow-up-first", label: "First follow-up" }
      }));
    });
    let firstRecovery;
    act(() => {
      firstRecovery = feedback.transitionActionFeedback({
        attemptId: first.record.attemptId,
        generation: first.record.generation,
        phase: "recovery",
        message: "Nothing changed; return to the first follow-up.",
        nextAction: { id: "return", label: "Return to first follow-up" }
      });
    });
    let second;
    act(() => {
      second = feedback.beginActionFeedback(beginInput({
        generation: "generation-second",
        object: { kind: "workflow-item", id: "follow-up-second", label: "Second follow-up" }
      }));
    });
    let secondSuccess;
    act(() => {
      secondSuccess = feedback.transitionActionFeedback({
        attemptId: second.record.attemptId,
        generation: second.record.generation,
        phase: "succeeded",
        message: "The second follow-up has an authoritative confirmation.",
        changed: ["Second follow-up marked complete"],
        evidence: {
          kind: "authoritative_readback",
          id: "receipt-second",
          source: "follow-up-server-readback"
        }
      });
    });
    expect(feedback.currentFeedback).toBe(secondSuccess.record);
    expect(feedback.announcement).toBe(secondSuccess.announcement);

    act(() => {
      feedback.acknowledgeActionFeedback(secondSuccess.record);
    });

    expect(feedback.feedbackRecords).toHaveLength(1);
    expect(feedback.currentFeedback).toBe(firstRecovery.record);
    expect(feedback.announcement).toBeNull();
    expect(container.querySelector("output").dataset.attempt).toBe("attempt-first");
    expect(container.querySelector("output").textContent).toBe("No announcement");
  });

  test("preserves a newer live announcement when a queued terminal record is acknowledged", () => {
    let feedback;
    const ids = ["attempt-first", "attempt-second"];
    act(() => {
      root.render(
        <WorkspaceActionFeedbackProvider
          scope={SCOPE}
          clock={() => "2026-09-03T05:40:00.000Z"}
          idFactory={() => ids.shift()}
        >
          <Probe onValue={(value) => { feedback = value; }} />
        </WorkspaceActionFeedbackProvider>
      );
    });

    let first;
    act(() => {
      first = feedback.beginActionFeedback(beginInput({
        generation: "generation-first",
        object: { kind: "workflow-item", id: "follow-up-first", label: "First follow-up" }
      }));
    });
    let firstRecovery;
    act(() => {
      firstRecovery = feedback.transitionActionFeedback({
        attemptId: first.record.attemptId,
        generation: first.record.generation,
        phase: "recovery",
        message: "Nothing changed; return to the first follow-up.",
        nextAction: { id: "return", label: "Return to first follow-up" }
      });
    });
    let second;
    act(() => {
      second = feedback.beginActionFeedback(beginInput({
        generation: "generation-second",
        object: { kind: "workflow-item", id: "follow-up-second", label: "Second follow-up" }
      }));
    });
    const secondAnnouncement = feedback.announcement;

    act(() => {
      feedback.acknowledgeActionFeedback(firstRecovery.record);
    });

    expect(feedback.feedbackRecords).toEqual([second.record]);
    expect(feedback.currentFeedback).toBe(second.record);
    expect(feedback.announcement).toBe(secondAnnouncement);
    expect(container.querySelector("output").dataset.announcement).toBe(secondAnnouncement.id);
  });

  test("rejects a stale acknowledgement without removing newer reconciled feedback", () => {
    let feedback;
    const times = [
      "2026-09-03T05:40:00.000Z",
      "2026-09-03T05:41:00.000Z",
      "2026-09-03T05:42:00.000Z",
      "2026-09-03T05:43:00.000Z"
    ];
    act(() => {
      root.render(
        <WorkspaceActionFeedbackProvider
          scope={SCOPE}
          clock={() => times.shift() || "2026-09-03T05:43:00.000Z"}
          idFactory={() => "attempt-generated-42"}
        >
          <Probe onValue={(value) => { feedback = value; }} />
        </WorkspaceActionFeedbackProvider>
      );
    });

    let started;
    act(() => {
      started = feedback.beginActionFeedback(beginInput());
    });
    let uncertain;
    act(() => {
      uncertain = feedback.transitionActionFeedback({
        attemptId: started.record.attemptId,
        generation: started.record.generation,
        phase: "uncertain",
        message: "The write may have completed; inspect before another write.",
        nextAction: { id: "reconcile", label: "Check again" }
      });
    });
    let reconciling;
    act(() => {
      reconciling = feedback.transitionActionFeedback({
        attemptId: uncertain.record.attemptId,
        generation: uncertain.record.generation,
        phase: "pending",
        mode: "reconcile",
        message: "Checking the authoritative record before another write."
      });
    });
    let succeeded;
    act(() => {
      succeeded = feedback.transitionActionFeedback({
        attemptId: reconciling.record.attemptId,
        generation: reconciling.record.generation,
        phase: "succeeded",
        message: "The authoritative record confirms completion.",
        evidence: {
          kind: "authoritative_readback",
          id: "receipt-after-reconciliation",
          source: "follow-up-server-readback"
        }
      });
    });
    const succeededAnnouncement = feedback.announcement;

    let stale;
    act(() => {
      stale = feedback.acknowledgeActionFeedback(uncertain.record);
    });
    expect(stale).toMatchObject({ ok: false, reason: "stale_revision" });
    expect(feedback.currentFeedback).toBe(succeeded.record);
    expect(feedback.announcement).toBe(succeededAnnouncement);

    expect(feedback.acknowledgeActionFeedback({
      attemptId: succeeded.record.attemptId,
      generation: succeeded.record.generation
    })).toMatchObject({ ok: false, reason: "missing_record_revision" });
    expect(feedback.currentFeedback).toBe(succeeded.record);
  });

  test("clears the registry and announcement immediately when exact scope changes", () => {
    let feedback;
    const render = (scope) => {
      root.render(
        <WorkspaceActionFeedbackProvider
          scope={scope}
          clock={() => "2026-09-03T05:40:00.000Z"}
          idFactory={() => "attempt-generated-42"}
        >
          <Probe onValue={(value) => { feedback = value; }} />
        </WorkspaceActionFeedbackProvider>
      );
    };
    act(() => render(SCOPE));
    let started;
    act(() => {
      started = feedback.beginActionFeedback(beginInput());
    });
    expect(feedback.feedbackRecords).toHaveLength(1);

    act(() => render({ ...SCOPE, principalId: "staff-other" }));
    expect(feedback.available).toBe(true);
    expect(feedback.feedbackRecords).toEqual([]);
    expect(feedback.currentFeedback).toBeNull();
    expect(feedback.announcement).toBeNull();

    const stale = feedback.transitionActionFeedback({
      ...started.selector,
      phase: "recovery",
      message: "A stale handler must not cross principals.",
      nextAction: { id: "inspect", label: "Inspect" }
    });
    expect(stale).toMatchObject({ ok: false, reason: "scope_mismatch" });
  });

  test("uses the unavailable no-op value for an invalid scope", () => {
    let feedback;
    act(() => {
      root.render(
        <WorkspaceActionFeedbackProvider scope={{ ...SCOPE, role: "Sales" }}>
          <Probe onValue={(value) => { feedback = value; }} />
        </WorkspaceActionFeedbackProvider>
      );
    });

    expect(feedback.available).toBe(false);
    expect(feedback.feedbackRecords).toEqual([]);
    expect(feedback.beginActionFeedback(beginInput())).toMatchObject({
      ok: false,
      reason: "feedback_provider_unavailable"
    });
  });
});
