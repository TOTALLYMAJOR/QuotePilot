import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test, vi } from "vitest";

const { recordDiagnosticEvent } = vi.hoisted(() => ({
  recordDiagnosticEvent: vi.fn()
}));

vi.mock("../../lib/sessionDiagnostics", () => ({
  recordDiagnosticEvent
}));

import {
  classifyRecoverableUiFailure,
  confirmRecoveryReload,
  RecoverableErrorBoundary,
  resolveRecoverableImportUrl,
  UNSAVED_QUOTE_RELOAD_PROMPT
} from "../RecoverableErrorBoundary";
import {
  acquireModalBodyScrollLock,
  resolveModalFocusWrap
} from "../../hooks/useModalDialog";

function readSource(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("recoverable lazy surfaces", () => {
  test("classifies chunk failures without returning internal error text", () => {
    const internalMessage = "Failed to fetch dynamically imported module: /src/components/SecretTool.jsx";
    expect(classifyRecoverableUiFailure(new Error(internalMessage))).toBe("chunk_load");
    expect(classifyRecoverableUiFailure(new Error("private render detail"))).toBe("render");
    expect(classifyRecoverableUiFailure(new Error(internalMessage))).not.toContain("SecretTool");
  });

  test("cache-busts only same-origin failed import URLs for an in-place retry", () => {
    const retryUrl = resolveRecoverableImportUrl(
      new Error("Failed to fetch dynamically imported module: https://quotepilot.test/assets/Tool.js"),
      2,
      "https://quotepilot.test/app"
    );
    expect(retryUrl).toBe("https://quotepilot.test/assets/Tool.js?qp-recovery-attempt=2");
    expect(resolveRecoverableImportUrl(
      new Error("Failed to fetch dynamically imported module: https://evil.test/private.js"),
      1,
      "https://quotepilot.test/app"
    )).toBe("");
  });

  test("records only the safe recovery contract for caught failures", () => {
    recordDiagnosticEvent.mockClear();
    const boundary = new RecoverableErrorBoundary({
      surfaceName: "Session Diagnostics / internal-file.jsx",
      surfaceKind: "tool"
    });

    boundary.componentDidCatch(new Error(
      "Failed to fetch dynamically imported module: /src/components/internal-file.jsx?token=private"
    ));

    expect(recordDiagnosticEvent).toHaveBeenCalledOnce();
    const event = recordDiagnosticEvent.mock.calls[0][0];
    expect(event).toMatchObject({
      level: "error",
      type: "ui.recovery",
      message: "A recoverable user interface surface required recovery.",
      context: {
        action: "failure",
        surfaceKind: "tool",
        failureKind: "chunk_load"
      }
    });
    expect(JSON.stringify(event)).not.toContain("token=private");
    expect(event).not.toHaveProperty("error");
  });

  test("wires every public route and workspace tool through an independent boundary", () => {
    const mainSource = readSource("../../main.jsx");
    const appSource = readSource("../../App.jsx");
    const workspaceBoundarySource = readSource("../WorkspaceSurfaceBoundary.jsx");

    expect(mainSource.match(/<LazyPublicRoute/g)).toHaveLength(4);
    expect(mainSource).toContain("const RevenueAutopilotUnsubscribePage = createRecoverableLazy(");
    expect(mainSource).toContain('surfaceName="Email preferences"');
    expect(appSource).toContain("const QuoteCompareModal = createRecoverableLazy(");
    expect(appSource).toContain("component={QuoteCompareModal}");
    for (const name of [
      "CommandCenterHome",
      "CustomerDirectoryView",
      "CustomerWorkspaceView",
      "WorkspaceNotFound",
      "QuoteHistoryView",
      "SalesWorkflowView"
    ]) {
      expect(appSource).toContain(`const ${name} = createRecoverableLazy(`);
      expect(appSource).toContain(`component={${name}}`);
    }
    for (const name of [
      "AdminCatalogView",
      "EventScheduleView",
      "ReportingDashboardView",
      "ImportStudioView",
      "IntegrationOpsView",
      "DiagnosticsView"
    ]) {
      expect(appSource).toContain(`const ${name} = createRecoverableLazy(`);
      expect(appSource).toContain(`component: ${name},`);
    }
    expect(appSource).not.toContain("const AdminCatalogModal = createRecoverableLazy(");
    expect(appSource).not.toContain("WorkspaceModalFallback");
    expect(appSource).toContain('from "./components/WorkspaceSurfaceBoundary"');
    expect(appSource).not.toContain("function WorkspaceLazyTool(");
    expect(workspaceBoundarySource).toContain("export function WorkspaceLazyTool(");
    expect(workspaceBoundarySource).toContain("export function WorkspaceLazyRoute(");
    expect(workspaceBoundarySource).toContain("export function WorkspaceToolSurface(");
    expect(workspaceBoundarySource).toContain('presentation="modal"');
    expect(workspaceBoundarySource).toContain("export function useStickyMount(");
    expect(appSource).not.toMatch(/setScheduleOpen\(resolvedWorkspaceRouteId/);
    expect(appSource).not.toMatch(/setAdminOpen\(resolvedWorkspaceRouteId/);

    const recoverySource = readSource("../RecoverableErrorBoundary.jsx");
    expect(recoverySource).toContain("Try again");
    expect(recoverySource).toContain("Reload workspace");
    expect(recoverySource).toContain("Close tool");
    expect(recoverySource).not.toMatch(/\{\s*(?:error|this\.state\.error)\.(?:message|stack)/);
  });

  test("requires explicit discard confirmation before a tool recovery reload loses quote work", () => {
    const confirmDiscard = vi.fn().mockReturnValue(false);
    expect(confirmRecoveryReload({
      surfaceKind: "tool",
      hasUnsavedWorkspaceChanges: true,
      confirmDiscard
    })).toBe(false);
    expect(confirmDiscard).toHaveBeenCalledWith(UNSAVED_QUOTE_RELOAD_PROMPT);

    expect(confirmRecoveryReload({
      surfaceKind: "tool",
      hasUnsavedWorkspaceChanges: false,
      confirmDiscard
    })).toBe(true);
    expect(confirmRecoveryReload({
      surfaceKind: "route",
      hasUnsavedWorkspaceChanges: true,
      confirmDiscard
    })).toBe(true);
    expect(confirmDiscard).toHaveBeenCalledOnce();
  });

  test("uses non-blocking catalog refresh for Import Studio receipts and conflicts", () => {
    const appSource = readSource("../../App.jsx");
    expect(appSource.match(/catalog\.reload\(\{ background: true \}\)/g)?.length || 0).toBeGreaterThanOrEqual(2);
    expect(appSource).toContain("onReload: () => catalog.reload({ background: true })");
  });
});

describe("shared modal dialog contract", () => {
  test("keeps body scrolling locked until the last stacked dialog releases it", () => {
    vi.stubGlobal("document", {
      body: { style: { overflow: "auto" } }
    });

    const releaseFirst = acquireModalBodyScrollLock();
    const releaseSecond = acquireModalBodyScrollLock();
    expect(document.body.style.overflow).toBe("hidden");

    releaseFirst();
    expect(document.body.style.overflow).toBe("hidden");
    releaseSecond();
    expect(document.body.style.overflow).toBe("auto");

    releaseSecond();
    expect(document.body.style.overflow).toBe("auto");
    vi.unstubAllGlobals();
  });

  test("wraps focus in both directions and recovers focus that starts outside", () => {
    expect(resolveModalFocusWrap({ focusableCount: 0 })).toBe("container");
    expect(resolveModalFocusWrap({ focusableCount: 3, activeIndex: 2 })).toBe("first");
    expect(resolveModalFocusWrap({ focusableCount: 3, activeIndex: 0, shiftKey: true })).toBe("last");
    expect(resolveModalFocusWrap({ focusableCount: 3, activeInside: false })).toBe("first");
    expect(resolveModalFocusWrap({ focusableCount: 3, activeInside: false, shiftKey: true })).toBe("last");
    expect(resolveModalFocusWrap({ focusableCount: 3, activeIndex: 1 })).toBe("");
  });

  test("keeps the seven workspace modals on one accessible dialog contract", () => {
    for (const fileName of [
      "AdminCatalogModal.jsx",
      "EventScheduleModal.jsx",
      "IntegrationOpsModal.jsx",
      "ImportStudioModal.jsx",
      "DiagnosticsModal.jsx",
      "QuoteCompareModal.jsx",
      "ReportingDashboardModal.jsx"
    ]) {
      const source = readSource(`../${fileName}`);
      expect(source, fileName).toContain("useModalDialog({");
      expect(source, fileName).toContain("returnFocusRef");
      expect(source, fileName).toContain("aria-labelledby=");
      expect(source, fileName).toContain("data-modal-initial-focus");
      expect(source, fileName).toContain("tabIndex={-1}");
    }

    expect(readSource("../AdminCatalogModal.jsx"))
      .toContain("Discard unsaved catalog, menu, and branding changes?");
  });
});
