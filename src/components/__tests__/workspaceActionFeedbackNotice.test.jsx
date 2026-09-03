// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import WorkspaceActionFeedbackNotice, {
  buildWorkspaceActionFeedbackFollowUpIdentity,
  buildWorkspaceActionFeedbackPresentation,
  resolveWorkspaceActionFeedbackFollowUpAction,
  WorkspaceActionFeedbackAnnouncer,
  workspaceActionFeedbackMatchesTaskJourney
} from "../WorkspaceActionFeedbackNotice";
import {
  beginWorkspaceActionFeedback,
  createWorkspaceActionFeedbackRegistry,
  transitionWorkspaceActionFeedback
} from "../../lib/workspaceActionFeedback";

const BASE_FEEDBACK = Object.freeze({
  phase: "pending",
  actionId: "save-follow-up",
  actionLabel: "Save follow-up",
  attemptId: "attempt-7",
  object: Object.freeze({
    kind: "quote",
    id: "quote-42",
    label: "First Continental Dinner"
  }),
  message: "Saving the follow-up date.",
  changed: Object.freeze(["Follow-up date requested: September 8"]),
  unchanged: Object.freeze(["Quote status remains Sent"])
});

const FOLLOW_UP_FEEDBACK = Object.freeze({
  ...BASE_FEEDBACK,
  phase: "uncertain",
  actionId: "complete-follow-up",
  actionLabel: "Complete follow-up",
  attemptId: "attempt-follow-up-7",
  generation: "review-now-priority:follow-up:quote-42:2026-09-03T05:40:00.000Z",
  object: Object.freeze({
    kind: "workflow-item",
    id: "follow-up:quote-42",
    label: "QP-42 follow-up"
  }),
  nextAction: Object.freeze({ id: "reconcile", label: "Review exact follow-up" })
});

const FOLLOW_UP_TASK = Object.freeze({
  taskId: "review-now-priority:follow-up:quote-42",
  startedAtISO: "2026-09-03T05:40:00.000Z",
  destination: "workflow",
  object: Object.freeze({ type: "workflow-item", id: "follow-up:quote-42" }),
  focus: Object.freeze({
    quoteId: "quote-42",
    attentionType: "follow_up",
    requestId: "follow-up:quote-42"
  }),
  intentId: "review_follow_up"
});

let container;
let root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

describe("buildWorkspaceActionFeedbackPresentation", () => {
  test("requires exact action, attempt, and affected-object identity", () => {
    expect(buildWorkspaceActionFeedbackPresentation(null)).toBeNull();
    expect(buildWorkspaceActionFeedbackPresentation({ ...BASE_FEEDBACK, attemptId: "" })).toBeNull();
    expect(buildWorkspaceActionFeedbackPresentation({ ...BASE_FEEDBACK, object: { kind: "quote" } })).toBeNull();
    expect(buildWorkspaceActionFeedbackPresentation({ ...BASE_FEEDBACK, phase: "complete" })).toBeNull();
  });

  test("normalizes visible facts and exposes one declarative resolution", () => {
    const nextAction = Object.freeze({ label: "Review quote", destination: "administration" });
    const presentation = buildWorkspaceActionFeedbackPresentation({
      ...BASE_FEEDBACK,
      phase: "recovery",
      changed: [{ label: "Draft", value: "Preserved" }],
      unchanged: undefined,
      unchangedFacts: [{ label: "Quote status", detail: "Sent" }],
      nextAction
    });

    expect(presentation).toMatchObject({
      phase: "recovery",
      phaseLabel: "Needs attention",
      actionId: "save-follow-up",
      attemptId: "attempt-7",
      objectKind: "quote",
      objectId: "quote-42",
      accessibleName: "Save follow-up feedback for First Continental Dinner: Needs attention",
      changedFacts: ["Draft: Preserved"],
      unchangedFacts: ["Quote status: Sent"],
      action: {
        kind: "next",
        label: "Review quote",
        value: nextAction
      }
    });
    expect(Object.isFrozen(presentation)).toBe(true);
  });

  test("allows bounded evidence copy only for confirmed success", () => {
    const evidence = { kind: "authoritative_readback", id: "readback-7", source: "quote-store" };
    expect(buildWorkspaceActionFeedbackPresentation({
      ...BASE_FEEDBACK,
      phase: "succeeded",
      evidence
    }).evidenceText).toBe("Confirmed by an authoritative readback.");
    expect(buildWorkspaceActionFeedbackPresentation({
      ...BASE_FEEDBACK,
      phase: "uncertain",
      evidence
    }).evidenceText).toBe("");
    expect(buildWorkspaceActionFeedbackPresentation({
      ...BASE_FEEDBACK,
      phase: "succeeded",
      evidence: { kind: "unverified_claim", id: "claim-7", source: "unknown" }
    }).evidenceText).toBe("");
  });
});

describe("follow-up feedback destination identity", () => {
  test("builds one bounded destination from the feedback record without task state", () => {
    expect(buildWorkspaceActionFeedbackFollowUpIdentity(FOLLOW_UP_FEEDBACK)).toEqual({
      actionId: "complete-follow-up",
      generation: FOLLOW_UP_FEEDBACK.generation,
      taskId: FOLLOW_UP_TASK.taskId,
      startedAtISO: FOLLOW_UP_TASK.startedAtISO,
      destination: "workflow",
      object: { id: "follow-up:quote-42", type: "workflow-item" },
      focus: {
        quoteId: "quote-42",
        attentionType: "follow_up",
        requestId: "follow-up:quote-42"
      },
      intentId: "review_follow_up"
    });
  });

  test.each([
    { feedback: { ...FOLLOW_UP_FEEDBACK, actionId: "save-quote" }, label: "action id" },
    {
      feedback: { ...FOLLOW_UP_FEEDBACK, object: { ...FOLLOW_UP_FEEDBACK.object, kind: "quote" } },
      label: "object kind"
    },
    {
      feedback: { ...FOLLOW_UP_FEEDBACK, object: { ...FOLLOW_UP_FEEDBACK.object, id: "quote-42" } },
      label: "object id"
    },
    {
      feedback: { ...FOLLOW_UP_FEEDBACK, generation: "another-task:2026-09-03T05:40:00.000Z" },
      label: "task generation"
    },
    {
      feedback: { ...FOLLOW_UP_FEEDBACK, generation: `${FOLLOW_UP_TASK.taskId}:not-an-instant` },
      label: "timestamp"
    }
  ])("rejects a feedback-owned destination with a mismatched $label", ({ feedback }) => {
    expect(buildWorkspaceActionFeedbackFollowUpIdentity(feedback)).toBeNull();
  });

  test("fences an attached task by action, object, task id, and exact start generation", () => {
    expect(workspaceActionFeedbackMatchesTaskJourney(
      FOLLOW_UP_FEEDBACK,
      FOLLOW_UP_TASK
    )).toBe(true);
    expect(workspaceActionFeedbackMatchesTaskJourney(
      FOLLOW_UP_FEEDBACK,
      { ...FOLLOW_UP_TASK, startedAtISO: "2026-09-03T05:41:00.000Z" }
    )).toBe(false);
    expect(workspaceActionFeedbackMatchesTaskJourney(
      { ...FOLLOW_UP_FEEDBACK, object: { ...FOLLOW_UP_FEEDBACK.object, id: "follow-up:quote-99" } },
      FOLLOW_UP_TASK
    )).toBe(false);
  });

  test("returns independently for an older feedback attempt without changing a newer task", () => {
    const newerTask = Object.freeze({
      ...FOLLOW_UP_TASK,
      taskId: "review-now-priority:follow-up:quote-99",
      startedAtISO: "2026-09-03T05:45:00.000Z",
      object: Object.freeze({ type: "workflow-item", id: "follow-up:quote-99" }),
      focus: Object.freeze({
        quoteId: "quote-99",
        attentionType: "follow_up",
        requestId: "follow-up:quote-99"
      })
    });
    const before = JSON.stringify(newerTask);

    const resolution = resolveWorkspaceActionFeedbackFollowUpAction({
      feedback: FOLLOW_UP_FEEDBACK,
      nextActionId: "reconcile",
      activeTaskJourney: newerTask
    });

    expect(resolution).toMatchObject({
      ok: true,
      strategy: "navigate",
      identity: {
        taskId: FOLLOW_UP_TASK.taskId,
        startedAtISO: FOLLOW_UP_TASK.startedAtISO,
        object: FOLLOW_UP_TASK.object,
        focus: FOLLOW_UP_TASK.focus
      },
      navigation: { primaryActionReady: true }
    });
    expect(resolution.navigation.path).toBe(
      "/app/workflow?quoteId=quote-42&attentionType=follow_up&requestId=follow-up%3Aquote-42"
    );
    expect(JSON.stringify(newerTask)).toBe(before);
  });
});

describe("WorkspaceActionFeedbackNotice", () => {
  test("exposes canonical ready state before an action begins", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceActionFeedbackAnnouncer announcement={null} feedback={null} />
    );

    expect(markup).toContain('data-capability-state="ready"');
  });

  test("exposes canonical submitting state for an unresolved write", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceActionFeedbackNotice feedback={BASE_FEEDBACK} />
    );

    expect(markup).toContain('data-capability-state="submitting"');
  });

  test("exposes canonical uncertain state without claiming failure or success", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceActionFeedbackNotice feedback={{ ...FOLLOW_UP_FEEDBACK, nextAction: null }} />
    );

    expect(markup).toContain('data-capability-state="uncertain"');
  });

  test("exposes canonical reconciliation state only while exact readback is in flight", () => {
    const created = createWorkspaceActionFeedbackRegistry({
      organizationId: "org-one",
      principalId: "sales-one",
      role: "sales"
    });
    const started = beginWorkspaceActionFeedback(created.registry, {
      ...BASE_FEEDBACK,
      scope: created.registry.scope,
      generation: "task-generation-7"
    }, {
      clock: () => "2026-09-03T05:40:00.000Z",
      idFactory: () => "attempt-reconcile-7"
    });
    const uncertain = transitionWorkspaceActionFeedback(started.registry, {
      ...started.selector,
      phase: "uncertain",
      message: "The write outcome needs exact readback before another save.",
      dispatchState: "dispatched",
      nextAction: { id: "reconcile", label: "Review exact follow-up" }
    }, { clock: () => "2026-09-03T05:41:00.000Z" });
    const reconciling = transitionWorkspaceActionFeedback(uncertain.registry, {
      ...uncertain.selector,
      phase: "pending",
      mode: "reconcile",
      message: "Checking the exact record without repeating the write."
    }, { clock: () => "2026-09-03T05:42:00.000Z" });
    const markup = renderToStaticMarkup(
      <WorkspaceActionFeedbackNotice feedback={reconciling.record} />
    );

    expect(markup).toContain('data-capability-state="reconciliation"');
  });

  test("exposes canonical receipt state for confirmed evidence", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceActionFeedbackNotice
        feedback={{
          ...BASE_FEEDBACK,
          phase: "succeeded",
          evidence: { kind: "authoritative_readback", id: "readback-7", source: "quote-store" }
        }}
      />
    );

    expect(markup).toContain('data-capability-state="receipt"');
  });

  test("exposes canonical error state for a definitive recovery outcome", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceActionFeedbackNotice feedback={{ ...BASE_FEEDBACK, phase: "recovery" }} />
    );

    expect(markup).toContain('data-capability-state="error"');
  });

  test("exposes canonical recovery state on the single safe next action", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceActionFeedbackNotice
        feedback={FOLLOW_UP_FEEDBACK}
        onNextAction={vi.fn()}
      />
    );

    expect(markup).toContain('data-capability-state="recovery"');
  });

  test("renders exact pending markers and busy state without creating a live region", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceActionFeedbackNotice feedback={BASE_FEEDBACK} />
    );

    expect(markup).toContain('data-testid="workspace-action-feedback"');
    expect(markup).toContain('role="region"');
    expect(markup).toContain('aria-label="Save follow-up feedback for First Continental Dinner: In progress"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('data-action-feedback-phase="pending"');
    expect(markup).toContain('data-action-feedback-action-id="save-follow-up"');
    expect(markup).toContain('data-action-feedback-attempt-id="attempt-7"');
    expect(markup).toContain('data-action-feedback-object-kind="quote"');
    expect(markup).toContain('data-action-feedback-object-id="quote-42"');
    expect(markup).toContain("Saving the follow-up date.");
    expect(markup).toContain("Changed");
    expect(markup).toContain("Follow-up date requested: September 8");
    expect(markup).toContain("Unchanged");
    expect(markup).toContain("Quote status remains Sent");
    expect(markup).not.toContain("aria-live");
    expect(markup).not.toContain('role="status"');
    expect(markup).not.toContain('role="alert"');
    expect(markup).not.toContain("<button");
  });

  test.each(["recovery", "uncertain"])(
    "keeps %s visually and semantically distinct from success",
    (phase) => {
      const markup = renderToStaticMarkup(
        <WorkspaceActionFeedbackNotice
          feedback={{
            ...BASE_FEEDBACK,
            phase,
            message: phase === "uncertain"
              ? "The save outcome is unknown. Reconcile before retrying."
              : "The save was rejected before dispatch.",
            evidence: { kind: "authoritative_readback", id: "readback-7", source: "quote-store" },
            nextAction: { label: "Reconcile quote", destination: "administration" }
          }}
          onNextAction={vi.fn()}
          onAcknowledge={vi.fn()}
        />
      );

      expect(markup).toContain(`data-action-feedback-phase="${phase}"`);
      expect(markup).not.toContain('aria-busy="true"');
      expect(markup).not.toContain("Confirmed by an authoritative readback");
      expect(markup).not.toContain('data-action-feedback-phase="succeeded"');
      expect((markup.match(/<button/g) || [])).toHaveLength(1);
      expect(markup).toContain(">Reconcile quote</button>");
      expect(markup).not.toContain(">Dismiss</button>");
    }
  );

  test("shows bounded success evidence and only the fallback dismissal", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceActionFeedbackNotice
        feedback={{
          ...BASE_FEEDBACK,
          phase: "succeeded",
          message: "The follow-up date is confirmed.",
          evidence: {
            kind: "authoritative_receipt",
            id: "receipt-secret-not-rendered",
            source: "quote-store"
          }
        }}
        onNextAction={vi.fn()}
        onAcknowledge={vi.fn()}
      />
    );

    expect(markup).toContain("Confirmed by an authoritative receipt.");
    expect(markup).not.toContain("receipt-secret-not-rendered");
    expect(markup).not.toContain('aria-busy="true"');
    expect((markup.match(/<button/g) || [])).toHaveLength(1);
    expect(markup).toContain(">Dismiss</button>");
  });

  test("dispatches only the visible next action", () => {
    const onNextAction = vi.fn();
    const onAcknowledge = vi.fn();
    const feedback = {
      ...BASE_FEEDBACK,
      phase: "uncertain",
      nextAction: { label: "Reconcile quote", destination: "administration" }
    };

    act(() => {
      root.render(
        <WorkspaceActionFeedbackNotice
          feedback={feedback}
          onNextAction={onNextAction}
          onAcknowledge={onAcknowledge}
        />
      );
    });
    const buttons = container.querySelectorAll("button");
    expect(buttons).toHaveLength(1);

    act(() => buttons[0].click());

    expect(onNextAction).toHaveBeenCalledOnce();
    expect(onNextAction).toHaveBeenCalledWith(feedback.nextAction, feedback);
    expect(onAcknowledge).not.toHaveBeenCalled();
  });

  test("defers uncertain reconciliation to the exact destination after it resolves", () => {
    const onNextAction = vi.fn();
    const onAcknowledge = vi.fn();
    act(() => {
      root.render(
        <WorkspaceActionFeedbackNotice
          feedback={FOLLOW_UP_FEEDBACK}
          onNextAction={onNextAction}
          onAcknowledge={onAcknowledge}
          nextActionResolved
        />
      );
    });

    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(onNextAction).not.toHaveBeenCalled();
    expect(onAcknowledge).not.toHaveBeenCalled();
  });

  test("allows terminal recovery dismissal only after its exact destination resolves", () => {
    const onAcknowledge = vi.fn();
    const feedback = { ...FOLLOW_UP_FEEDBACK, phase: "recovery" };
    act(() => {
      root.render(
        <WorkspaceActionFeedbackNotice
          feedback={feedback}
          onNextAction={vi.fn()}
          onAcknowledge={onAcknowledge}
          nextActionResolved
        />
      );
    });

    const button = container.querySelector("button");
    expect(button?.textContent).toBe("Dismiss");
    act(() => button.click());
    expect(onAcknowledge).toHaveBeenCalledWith(feedback);
  });

  test.each(["succeeded", "cancelled"])(
    "provides one dismiss action for intrinsically dismissible %s feedback without a next action",
    (phase) => {
      const onAcknowledge = vi.fn();
      const feedback = { ...BASE_FEEDBACK, phase, nextAction: null };
      act(() => {
        root.render(
          <WorkspaceActionFeedbackNotice
            feedback={feedback}
            onAcknowledge={onAcknowledge}
          />
        );
      });

      const buttons = container.querySelectorAll("button");
      expect(buttons).toHaveLength(1);
      expect(buttons[0].textContent).toBe("Dismiss");

      act(() => buttons[0].click());
      expect(onAcknowledge).toHaveBeenCalledOnce();
      expect(onAcknowledge).toHaveBeenCalledWith(feedback);
    }
  );

  test.each(["recovery", "uncertain"])(
    "fails closed without an action for malformed %s feedback missing its safe next action",
    (phase) => {
      const onAcknowledge = vi.fn();
      const feedback = { ...BASE_FEEDBACK, phase, nextAction: null };
      act(() => {
        root.render(
          <WorkspaceActionFeedbackNotice
            feedback={feedback}
            onAcknowledge={onAcknowledge}
          />
        );
      });

      expect(container.querySelectorAll("button")).toHaveLength(0);
      expect(onAcknowledge).not.toHaveBeenCalled();
    }
  );

  test("returns focus to the prior connected control after terminal dismissal removes feedback", async () => {
    const feedback = {
      ...BASE_FEEDBACK,
      phase: "succeeded",
      evidence: {
        kind: "authoritative_readback",
        id: "readback-focus-return",
        source: "quote-store"
      }
    };
    function DismissHarness() {
      const [visible, setVisible] = useState(true);
      return (
        <>
          <button type="button" data-testid="focus-return-origin">Continue workspace</button>
          {visible ? (
            <WorkspaceActionFeedbackNotice
              feedback={feedback}
              onAcknowledge={() => {
                setVisible(false);
                return { ok: true, status: "acknowledged" };
              }}
            />
          ) : null}
        </>
      );
    }

    act(() => root.render(<DismissHarness />));
    const origin = container.querySelector('[data-testid="focus-return-origin"]');
    const dismiss = container.querySelector('[data-testid="workspace-action-feedback"] button');
    act(() => origin.focus());
    act(() => {
      dismiss.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      dismiss.focus();
    });
    await act(async () => {
      dismiss.click();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="workspace-action-feedback"]')).toBeNull();
    expect(document.activeElement).toBe(origin);
  });
});
