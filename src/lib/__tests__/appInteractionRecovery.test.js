import fs from "node:fs";
import { describe, expect, test } from "vitest";

const appSource = fs.readFileSync(new URL("../../App.jsx", import.meta.url), "utf8");
const legacyAppSource = fs.readFileSync(new URL("../../LegacyApp.jsx", import.meta.url), "utf8");
const wizardSource = fs.readFileSync(new URL("../../components/WizardSteps.jsx", import.meta.url), "utf8");

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
    expect(appSource).toContain("setForm(draftRuntime.form)");
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
    expect(appSource).toContain("clearWorkspaceTaskJourney(authSession.organizationId)");
    expect(appSource).not.toContain("exactResolution?.status === \"resolved\"\n        ? \"resolved\"");
  });
});
