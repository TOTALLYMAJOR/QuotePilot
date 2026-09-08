import fs from "node:fs";
import { describe, expect, test, vi } from "vitest";
import { applyWorkspaceTaskOutcome } from "../../App";
import {
  createWorkspaceTaskJourney,
  transitionWorkspaceTaskOutcome,
  WORKSPACE_APPROVAL_TASK_PROOF_TYPE,
  WORKSPACE_APPROVAL_TASK_VERIFIER_ID,
  WORKSPACE_FOLLOW_UP_TASK_PROOF_TYPE,
  WORKSPACE_FOLLOW_UP_TASK_VERIFIER_ID
} from "../workspaceTaskJourney";

const appSource = fs.readFileSync(new URL("../../App.jsx", import.meta.url), "utf8");
const legacyAppSource = fs.readFileSync(new URL("../../LegacyApp.jsx", import.meta.url), "utf8");
const wizardSource = fs.readFileSync(new URL("../../components/WizardSteps.jsx", import.meta.url), "utf8");

function followUpJourney({
  taskId = "review-now-priority:follow-up:quote-42",
  startedAtISO = "2026-09-03T03:10:00.000Z"
} = {}) {
  const created = createWorkspaceTaskJourney({
    organizationId: "organization-42",
    principal: { id: "staff-42", role: "sales" },
    taskId,
    startedAtISO,
    origin: { routeId: "home", pathname: "/app" },
    destination: "workflow",
    object: { id: "follow-up:quote-42", type: "workflow-item" },
    focus: {
      quoteId: "quote-42",
      attentionType: "follow_up",
      requestId: "follow-up:quote-42"
    },
    intentId: "review_follow_up"
  });
  expect(created.ok).toBe(true);
  return created.journey;
}

function approvalJourney() {
  return createWorkspaceTaskJourney({
    organizationId: "organization-42",
    principal: { id: "staff-42", role: "admin" },
    taskId: "review-workflow:approval-42",
    startedAtISO: "2026-09-03T03:15:00.000Z",
    origin: { routeId: "clear-deck", pathname: "/app/clear-the-deck" },
    destination: "approval",
    object: { id: "approval-42", type: "approval" },
    focus: { quoteId: "quote-42", requestId: "approval-42" },
    intentId: "review_approval"
  }).journey;
}

function followUpFeedbackIdentity(journey) {
  return {
    taskId: journey.taskId,
    startedAtISO: journey.startedAtISO,
    destination: journey.destination,
    object: journey.object,
    focus: journey.focus,
    intentId: journey.intentId
  };
}

function resolvedFollowUpOutcome(journey) {
  return {
    organizationId: journey.organizationId,
    startedAtISO: journey.startedAtISO,
    taskId: journey.taskId,
    focus: journey.focus,
    phase: "resolved",
    proof: {
      verifierId: WORKSPACE_FOLLOW_UP_TASK_VERIFIER_ID,
      proofId: "follow-up-completed:2026-09-03T03:15:00.000Z",
      proofType: WORKSPACE_FOLLOW_UP_TASK_PROOF_TYPE
    }
  };
}

describe("workspace interaction recovery wiring", () => {
  test("blocked workspace and catalog states expose executing recovery actions", () => {
    expect(appSource).toContain('onClick={handleRetryTenantResolution}');
    expect(appSource).toContain('href="https://mbmapps.com/contact"');
    expect(appSource).toContain('onClick={handleRefreshAccess}');
    expect(appSource).toContain("await authSession.refreshAccess()");
    expect(appSource).toContain('import CatalogReadNotice from "./components/CatalogReadNotice"');
    expect(appSource.match(/onRetry=\{catalog\.reload\}/g)).toHaveLength(2);
    expect(legacyAppSource).toContain('import CatalogReadNotice from "./components/CatalogReadNotice"');
    expect(legacyAppSource.match(/onRetry=\{catalog\.reload\}/g)).toHaveLength(2);
    expect(appSource).toContain("Check for catalog updates");
  });

  test("availability blocks expose schedule context and a correction path", () => {
    expect(appSource).toContain('className="warning-note availability-recovery"');
    expect(appSource).toContain('onClick={handleCorrectAvailability}');
    expect(appSource).toContain('onClick={() => navigateWorkspace(WORKSPACE_PATHS.schedule)}');
    expect(appSource).toContain("Edit Date, Time, or Venue");
  });

  test("both event-hour controls store the same bounded value they display", () => {
    expect(wizardSource.match(/value=\{normalizeEventHours\(form\.hours\)\}/g)).toHaveLength(2);
    expect(wizardSource.match(/updateField\("hours", normalizeEventHours\(e\.target\.value\)\)/g)).toHaveLength(2);
  });

  test("menu selection is a focused prerequisite for advancing and saving", () => {
    expect(appSource).toContain("if (step === 2 && selectedMenuItemCount < 1)");
    expect(appSource).toContain("showMissingMenuSelection({ moveToMenuStep: true })");
    expect(appSource).toContain("Choose at least one menu item before continuing.");
    expect(appSource).toContain('ref={menuSelectionValidationRef}');
  });

  test("delegates saved-quote hydration and exact Ambient handoffs to the draft runtime", () => {
    expect(appSource).toContain("hydrateSavedQuoteDraftBase");
    expect(appSource).toContain("const loadAmbientQuoteDraftRuntime = AMBIENT_UI_ENABLED");
    expect(appSource).toContain('? () => import("./lib/quoteDraftRuntime")');
    expect(appSource).not.toMatch(/from\s+["']\.\/lib\/quoteDraftRuntime["']/);
    expect(appSource).toContain("if (AMBIENT_UI_ENABLED) {");
    expect(appSource).toContain('typeof loadAmbientQuoteDraftRuntime !== "function"');
    expect(appSource).toContain("const runtimeModule = await loadAmbientQuoteDraftRuntime()");
    expect(appSource).toContain("draftRuntime = runtimeModule.hydrateSavedQuoteDraft({");
    expect(appSource).toContain("draftPatch,");
    expect(appSource).toContain("draftIntent,");
    expect(appSource).toContain("ambientCatalogContext,");
    expect(appSource).toContain("ambientEnabled: true");
    expect(appSource).toContain("draftRuntime = hydrateSavedQuoteDraftBase(draftInput)");
    expect(appSource).toContain('consequence: "No editor route opened and the current work remains unchanged."');
    expect(appSource).toContain("setForm(attendanceSubmission ? { ...draftRuntime.form, guests: attendanceSubmission.count } : draftRuntime.form)");
    expect(appSource).toContain("attendanceSubmission.organizationId !== authSession.organizationId || attendanceSubmission.quoteId !== quote.id");
    expect(appSource).toContain("attendanceSubmission.sourceVersionId !== (quote.activeVersionId || quote.versionMeta?.versionId)");
    expect(appSource).toContain("attendanceSubmission.acceptanceReceiptId !== quote.acceptanceReceipt?.receiptId");
    expect(appSource).toContain('const stagedDraftFields = attendanceSubmission ? [...new Set([...draftRuntime.stagedFields, "guests"])] : draftRuntime.stagedFields');
    expect(appSource).toContain("setAttendanceChange(attendanceSubmission)");
    expect(appSource).toContain("draftRuntime.ambientDraftIntent?.focusField");
    expect(appSource).toContain("draftIntentFamily: draftRuntime.ambientDraftIntent?.family");
    expect(appSource).toContain("querySelector(`[data-ambient-field=");
    expect(appSource).not.toContain('const allowedSources = ["ambient-guest-scenario-v1"');
  });

  test("keeps Package and Menu handoffs in pending review until an exact draft outcome is chosen", () => {
    expect(appSource).toContain("adoptAmbientPackageMenuDraftChange({");
    expect(appSource).toContain("ambientDraftReviewResolution === \"pending_review\"");
    expect(appSource).toContain("Resolve the pending Package or Menu review before saving");
    expect(appSource).toContain("setForm(result.form)");
    expect(appSource).toContain("markFieldsTouched(result.dirtyFields)");
    expect(appSource).toContain("setAmbientDraftReviewResolution(\"applied\")");
    expect(appSource).toContain("Save package change");
    expect(appSource).toContain("Save menu replacement");
    expect(appSource).toContain("Save menu order");
    expect(appSource).toContain("onApply={handleApplyAmbientDraftIntent}");
    expect(appSource).toContain("onKeep={handleKeepAmbientDraftIntent}");
  });

  test("routes Ambient Workflow and Conversation actions through validated arrival handoffs", () => {
    const callbackStart = appSource.indexOf("{historyMounted && (");
    const callbackEnd = appSource.indexOf("{salesWorkflowMounted && (", callbackStart);
    const callbackSource = appSource.slice(callbackStart, callbackEnd);

    expect(callbackStart).toBeGreaterThan(-1);
    expect(callbackEnd).toBeGreaterThan(callbackStart);
    expect(appSource).toContain(
      "createWorkspaceArrivalHandoff(ambientWorkflowArrivalInput(target, options))"
    );
    expect(appSource).toContain(
      "createWorkspaceArrivalHandoff(\n      ambientConversationArrivalInput(quoteId, options)\n    )"
    );
    expect(appSource).toContain("const openAmbientWorkflow = useCallback((target = {}, options = {}) => {");
    expect(appSource).toContain("const result = navigateAmbientWorkflow(target, options);");
    expect(appSource).toContain("const openAmbientConversation = useCallback((quoteId, options = {}) => {");
    expect(appSource).toContain("const result = navigateAmbientConversation(quoteId, options);");
    expect(callbackSource).toContain("? openAmbientWorkflow");
    expect(callbackSource).toContain(
      ": (target = {}) => navigateWorkspace(buildWorkflowPath(target))"
    );
    expect(callbackSource).toContain("? openAmbientConversation");
    expect(callbackSource).toContain(
      ": (quoteId) => navigateWorkspace(buildMessagingPath({ quoteId }))"
    );
    expect(callbackSource).not.toContain("ambientArrival");
  });

  test("routes Opportunities into the exact Living Opportunity arrival consumer", () => {
    const callbackStart = appSource.indexOf("{historyMounted && (");
    const callbackEnd = appSource.indexOf("{salesWorkflowMounted && (", callbackStart);
    const callbackSource = appSource.slice(callbackStart, callbackEnd);

    expect(appSource).toContain(
      "createWorkspaceArrivalHandoff(ambientOpportunityArrivalInput(target))"
    );
    expect(appSource).toContain('destination: "opportunity"');
    expect(appSource).toContain('? "review_proposal_gap"');
    expect(callbackSource).toContain("const result = navigateAmbientOpportunity(target);");
    expect(callbackSource).toContain('workspaceArrivalContext?.surfaceId === "living-opportunity"');
    expect(callbackSource).toContain('fallbackSurfaceId="living-opportunity"');
    expect(callbackSource).toContain("onArrivalResolution={handleWorkspaceArrivalResolution}");
    expect(callbackSource).not.toContain('reason: "opportunity_stream"');
  });

  test("wires exact Schedule arrival context and resets notices across object and intent changes", () => {
    expect(appSource).toContain("workspaceArrivalContext.object?.type");
    expect(appSource).toContain("workspaceArrivalContext.object?.id");
    expect(appSource).toContain("workspaceArrivalContext.intentId");
    expect(appSource).toContain("workspaceArrivalContext.focus?.reportSignal");
    expect(appSource).toContain('arrivalContext: workspaceArrivalContext?.surfaceId === "schedule"');
    expect(appSource).toContain("onArrivalResolution: handleWorkspaceArrivalResolution");
    expect(appSource).toContain('fallbackSurfaceId="schedule"');
  });

  test("keeps one presentation-only task attached across exact Ambient route handoffs", () => {
    expect(appSource).toContain('import WorkspaceTaskJourneyNotice from "./components/WorkspaceTaskJourneyNotice"');
    expect(appSource).toContain('} from "./lib/workspaceTaskJourney"');
    expect(appSource).toContain("const beginWorkspaceTaskJourney = useCallback((handoff, actionId) => {");
    expect(appSource).toContain("principal: activeWorkspaceTaskPrincipal");
    expect(appSource).toContain("startedAtISO: new Date().toISOString(),");
    expect(appSource).toContain("workspaceTaskJourneyBelongsToPrincipal(stored.journey, activeWorkspaceTaskPrincipal)");
    expect(appSource).toContain("clearWorkspaceTaskJourney(authSession.organizationId)");
    expect(appSource).toContain("const stored = writeWorkspaceTaskJourney(authSession.organizationId, journey)");
    expect(appSource).toContain("if (stored.ok) setWorkspaceTaskJourney(stored.journey)");
    expect(appSource).toContain("return persistWorkspaceTaskJourney(started.journey)");
    expect(appSource).toContain("beforeCommit: () => {");
    expect(appSource).toContain("startedTask = beginWorkspaceTaskJourney(handoff, actionId)");
    expect(appSource).toContain("task tracking is unavailable in this session");
    expect(appSource).not.toContain('return { status: "recovery", ...startedTask.recovery }');
    expect(appSource).toContain("if ([\"blocked\", \"guarded\"].includes(navigationResult?.status))");
    expect(appSource).toContain("transitionWorkspaceTaskContext(");
    expect(appSource).toContain("workspaceTaskJourneyMatchesArrival(activeWorkspaceTaskJourney, workspaceArrivalContext)");
    expect(appSource).toContain('workspaceArrivalContext ? JSON.stringify([\n        "arrival"');
    expect(appSource).not.toContain('].filter(Boolean).join(":")');
    expect(appSource).toContain("setWorkspaceArrivalResolution({ ...resolution, arrivalKey: workspaceArrivalKey })");
    expect(appSource).toContain("workspaceArrivalResolution?.arrivalKey === workspaceArrivalKey");
    expect(appSource).toContain('exactResolution?.status === "resolved"');
    expect(appSource).toContain('? "ready"');
    expect(appSource).toContain("activeWorkspaceTaskJourney,");
    expect(appSource).toContain("<WorkspaceTaskJourneyNotice");
    expect(appSource).toContain("onContinue={continueWorkspaceTaskJourney}");
    expect(appSource).toContain("onStopTracking={stopTrackingWorkspaceTask}");
    expect(appSource).toContain("const handleWorkspaceTaskOutcome = useCallback((outcome) => {");
    expect(appSource).toContain("outcome.taskId === currentWorkspaceTaskJourney.taskId");
    expect(appSource).toContain("outcome.startedAtISO === currentWorkspaceTaskJourney.startedAtISO");
    expect(appSource).toContain("outcome.organizationId === currentWorkspaceTaskJourney.organizationId");
    expect(appSource).toContain("proof.verifierId === WORKSPACE_FOLLOW_UP_TASK_VERIFIER_ID");
    expect(appSource).toContain("proof.proofType === WORKSPACE_FOLLOW_UP_TASK_PROOF_TYPE");
    expect(appSource).toContain("workspaceTaskJourneyMatchesArrival(");
    expect(appSource).toContain("persistTaskJourney(transitioned.journey)");
    expect(appSource).toContain("requestAttentionRefresh({ force: true })");
    expect(appSource).toContain(
      "activeTaskJourney={feedbackOwnedFollowUpTaskContext || activeWorkspaceTaskJourney}"
    );
    expect(appSource).toContain("resolveWorkspaceActionFeedbackFollowUpAction({");
    expect(appSource).toContain('resolution.strategy === "continue"');
    expect(appSource).toContain("onTaskOutcome={handleWorkspaceTaskOutcome}");
    expect(appSource).toContain("clearWorkspaceTaskJourney(authSession.organizationId)");
    expect(appSource).not.toContain("exactResolution?.status === \"resolved\"\n        ? \"resolved\"");
  });

  test("revalidates delayed Workflow outcomes against the current principal-bound session task", () => {
    const callbackStart = appSource.indexOf(
      "const handleWorkspaceTaskOutcome = useCallback((outcome) => {"
    );
    const callbackEnd = appSource.indexOf("const adminMounted =", callbackStart);
    const callbackSource = appSource.slice(callbackStart, callbackEnd);
    const transitionIndex = callbackSource.indexOf(
      "transitionWorkspaceTaskOutcome(\n      currentWorkspaceTaskJourney,"
    );

    expect(callbackStart).toBeGreaterThan(-1);
    expect(callbackEnd).toBeGreaterThan(callbackStart);
    expect(appSource).toContain("const currentWorkspaceTaskSessionRef = useRef(null);");
    expect(appSource).toContain("currentWorkspaceTaskSessionRef.current = {");
    expect(callbackSource).toContain(
      "const currentTaskSession = currentWorkspaceTaskSessionRef.current;"
    );
    expect(callbackSource).toContain("return applyWorkspaceTaskOutcome({");
    expect(callbackSource).toContain("currentTaskSession,");
    expect(callbackSource).toContain("feedbackIdentity,");
    expect(callbackSource).toContain("persistTaskJourney: persistWorkspaceTaskJourney");
    expect(callbackSource).toContain("requestAttentionRefresh: requestWorkflowAttentionRefresh");
    expect(callbackSource).toContain("setWorkspaceActionFeedbackReconciliationContext(null)");
    expect(callbackSource).not.toContain("activeWorkspaceTaskJourney");
    expect(callbackSource).not.toContain("readWorkspaceTaskJourney(");
    expect(transitionIndex).toBe(-1);
  });

  test("persists a reconciled exact task before App reports its feedback confirmed", () => {
    const initial = followUpJourney();
    const uncertain = transitionWorkspaceTaskOutcome(initial, { phase: "uncertain" });
    expect(uncertain.ok).toBe(true);
    const persistTaskJourney = vi.fn((journey) => ({ ok: true, journey }));
    const requestAttentionRefresh = vi.fn();
    const clearFeedbackReconciliation = vi.fn();

    const result = applyWorkspaceTaskOutcome({
      outcome: resolvedFollowUpOutcome(uncertain.journey),
      currentTaskSession: {
        organizationId: uncertain.journey.organizationId,
        principal: uncertain.journey.principal
      },
      feedbackIdentity: followUpFeedbackIdentity(uncertain.journey),
      readTaskJourney: () => ({ ok: true, journey: uncertain.journey }),
      persistTaskJourney,
      requestAttentionRefresh,
      clearFeedbackReconciliation
    });

    expect(result).toEqual({ status: "resolved", taskState: "persisted" });
    expect(persistTaskJourney).toHaveBeenCalledTimes(1);
    expect(persistTaskJourney.mock.calls[0][0]).toMatchObject({
      taskId: uncertain.journey.taskId,
      startedAtISO: uncertain.journey.startedAtISO,
      phase: "resolved",
      proof: resolvedFollowUpOutcome(uncertain.journey).proof
    });
    expect(requestAttentionRefresh).toHaveBeenCalledWith({ force: true });
    expect(clearFeedbackReconciliation).toHaveBeenCalledTimes(1);
  });

  test("reconciles older feedback without changing a newer active task", () => {
    const older = followUpJourney();
    const newer = followUpJourney({
      taskId: "review-now-priority:follow-up:quote-99",
      startedAtISO: "2026-09-03T03:20:00.000Z"
    });
    const persistTaskJourney = vi.fn();
    const requestAttentionRefresh = vi.fn();
    const clearFeedbackReconciliation = vi.fn();

    const result = applyWorkspaceTaskOutcome({
      outcome: resolvedFollowUpOutcome(older),
      currentTaskSession: {
        organizationId: newer.organizationId,
        principal: newer.principal
      },
      feedbackIdentity: followUpFeedbackIdentity(older),
      readTaskJourney: () => ({ ok: true, journey: newer }),
      persistTaskJourney,
      requestAttentionRefresh,
      clearFeedbackReconciliation
    });

    expect(result).toEqual({ status: "resolved", taskState: "independent" });
    expect(persistTaskJourney).not.toHaveBeenCalled();
    expect(requestAttentionRefresh).toHaveBeenCalledWith({ force: true });
    expect(clearFeedbackReconciliation).toHaveBeenCalledTimes(1);
  });

  test("persists an exact approval outcome only with authoritative approval proof", () => {
    const current = approvalJourney();
    const persistTaskJourney = vi.fn((journey) => ({ ok: true, journey }));
    const requestAttentionRefresh = vi.fn();
    const outcome = {
      organizationId: current.organizationId,
      startedAtISO: current.startedAtISO,
      taskId: current.taskId,
      focus: {
        quoteId: "quote-42",
        attentionType: "approval",
        requestId: "approval-42"
      },
      phase: "resolved",
      proof: {
        verifierId: WORKSPACE_APPROVAL_TASK_VERIFIER_ID,
        proofId: "approval-resolved:approval-42:2026-09-03T03:16:00.000Z",
        proofType: WORKSPACE_APPROVAL_TASK_PROOF_TYPE
      }
    };

    expect(applyWorkspaceTaskOutcome({
      outcome,
      currentTaskSession: {
        organizationId: current.organizationId,
        principal: current.principal
      },
      readTaskJourney: () => ({ ok: true, journey: current }),
      persistTaskJourney,
      requestAttentionRefresh,
      clearFeedbackReconciliation: vi.fn()
    })).toEqual({ status: "resolved", taskState: "persisted" });
    expect(persistTaskJourney).toHaveBeenCalledWith(expect.objectContaining({
      phase: "resolved",
      proof: outcome.proof
    }));
    expect(requestAttentionRefresh).toHaveBeenCalledWith({ force: true });

    expect(applyWorkspaceTaskOutcome({
      outcome: {
        ...outcome,
        proof: { ...outcome.proof, verifierId: WORKSPACE_FOLLOW_UP_TASK_VERIFIER_ID }
      },
      currentTaskSession: {
        organizationId: current.organizationId,
        principal: current.principal
      },
      readTaskJourney: () => ({ ok: true, journey: current }),
      persistTaskJourney,
      requestAttentionRefresh,
      clearFeedbackReconciliation: vi.fn()
    })).toMatchObject({ status: "recovery" });

    expect(applyWorkspaceTaskOutcome({
      outcome: {
        ...outcome,
        proof: {
          ...outcome.proof,
          proofId: "approval-resolved:approval-nearby:2026-09-03T03:16:00.000Z"
        }
      },
      currentTaskSession: {
        organizationId: current.organizationId,
        principal: current.principal
      },
      readTaskJourney: () => ({ ok: true, journey: current }),
      persistTaskJourney,
      requestAttentionRefresh,
      clearFeedbackReconciliation: vi.fn()
    })).toMatchObject({ status: "recovery" });

    expect(applyWorkspaceTaskOutcome({
      outcome: {
        ...outcome,
        proof: {
          ...outcome.proof,
          proofId: "approval-resolved:approval-42:nearby:2026-09-03T03:16:00.000Z"
        }
      },
      currentTaskSession: {
        organizationId: current.organizationId,
        principal: current.principal
      },
      readTaskJourney: () => ({ ok: true, journey: current }),
      persistTaskJourney,
      requestAttentionRefresh,
      clearFeedbackReconciliation: vi.fn()
    })).toMatchObject({ status: "recovery" });
  });
});
