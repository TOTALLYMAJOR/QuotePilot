// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  CONTAINED_TRANSIENT_SURFACE_AUDIT_MODEL,
  WORKSPACE_CONTROL_CONTAINMENT_MODEL,
  WORKSPACE_LAYOUT_AUDIT_MODEL,
  auditContainedTransientSurface,
  auditWorkspaceLayout,
  rectanglesIntersect
} from "../workspaceLayoutAudit";

const STAFF_LAYOUT_INVENTORY = [
  ["App.jsx", [
    "workspace-route-main",
    "data-layout-audit-surface=\"workspace-feedback\"",
    "data-layout-audit-overflow=\"workspace-feedback\""
  ]],
  ["components/AdminCatalogModal.jsx", ["workspace-route-main", "modal-overlay", "modal-head", "data-layout-overlap-allowed"]],
  ["components/EventScheduleModal.jsx", ["workspace-route-main", "modal-overlay", "modal-head", "data-layout-overlap-allowed"]],
  ["components/ReportingDashboardModal.jsx", ["workspace-route-main", "modal-overlay", "modal-head", "data-layout-overlap-allowed"]],
  ["components/ImportStudioModal.jsx", ["workspace-route-main", "modal-overlay", "modal-head", "data-layout-overlap-allowed"]],
  ["components/IntegrationOpsModal.jsx", ["workspace-route-main", "modal-overlay", "modal-head", "data-layout-overlap-allowed"]],
  ["components/DiagnosticsModal.jsx", ["workspace-route-main", "modal-overlay", "modal-head", "data-layout-overlap-allowed"]],
  ["components/SalesWorkflowModal.jsx", ["workspace-route-main", "modal-overlay", "modal-head", "data-layout-overlap-allowed"]],
  ["components/QuoteHistoryModal.jsx", ["workspace-route-main", "modal-overlay", "modal-head", "data-layout-overlap-allowed"]],
  ["components/CustomerDirectoryView.jsx", ["workspace-route-main", "workspace-route-head"]],
  ["components/CustomerWorkspaceView.jsx", ["workspace-route-main", "workspace-route-head"]],
  ["components/WorkspaceNotFound.jsx", ["workspace-route-main", "workspace-not-found"]],
  ["components/CommercialSearchPalette.jsx", ["modal-overlay", "commercial-search-head", "data-layout-overlap-allowed"]],
  ["components/QuoteCompareModal.jsx", ["modal-overlay", "modal-head", "data-layout-overlap-allowed"]],
  ["components/KitchenBeoArtifactPanel.jsx", ["modal-overlay", "modal-head", "data-layout-overlap-allowed"]],
  ["components/RecoverableErrorBoundary.jsx", ["ui-recovery-route", "modal-overlay", "ui-recovery-card", "modal-loading-card", "data-layout-overlap-allowed"]],
  ["components/NowView.jsx", ["command-center-head"]],
  ["components/CommandCenterHome.jsx", ["command-center-head"]],
  ["components/EventWorkspaceView.jsx", ["event-identity", "event-section-heading"]],
  ["components/MessagingStation.jsx", ["data-layout-audit-group=\"messaging-route-heading\""]],
  ["components/AmbientDraftIntentReview.jsx", [
    "data-ambient-draft-intent-review",
    "data-layout-audit-group=\"ambient-draft-review-heading\""
  ]],
  ["components/ambient/ContextSurface.jsx", ["data-layout-overlap-allowed=\"true\""]]
];

function sourceFile(fileName) {
  return readFileSync(resolve(process.cwd(), "src", fileName), "utf8");
}

function rect({ left, top, width, height }) {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON() { return this; }
  };
}

function element({ id, group = "heading", box, overflow = false }) {
  const node = document.createElement("div");
  node.id = id;
  if (group) node.dataset.layoutAuditGroup = group;
  if (overflow) node.dataset.layoutAuditOverflow = "true";
  node.getBoundingClientRect = () => rect(box);
  document.body.append(node);
  return node;
}

afterEach(() => {
  document.body.replaceChildren();
  Object.defineProperty(document.documentElement, "clientWidth", {
    configurable: true,
    value: 0
  });
  Object.defineProperty(document.documentElement, "scrollWidth", {
    configurable: true,
    value: 0
  });
  Object.defineProperty(document.documentElement, "clientHeight", {
    configurable: true,
    value: 0
  });
});

describe("workspace layout audit", () => {
  test("keeps the staff route and overlay inventory on reusable containment selectors", () => {
    for (const [fileName, selectors] of STAFF_LAYOUT_INVENTORY) {
      const source = sourceFile(fileName);
      selectors.forEach((selector) => {
        expect(source, `${fileName}:${selector}`).toContain(selector);
      });
    }
  });

  test("treats touching edges as valid but reports actual intersection", () => {
    const first = rect({ left: 0, top: 0, width: 100, height: 20 });
    const adjacent = rect({ left: 0, top: 20, width: 100, height: 20 });
    const colliding = rect({ left: 0, top: 19, width: 100, height: 20 });

    expect(rectanglesIntersect(first, adjacent, 0)).toBe(false);
    expect(rectanglesIntersect(first, colliding, 0)).toBe(true);
  });

  test("reports sibling collisions inside one declared audit group", () => {
    element({ id: "eyebrow", box: { left: 10, top: 10, width: 180, height: 18 } });
    element({ id: "heading", box: { left: 10, top: 24, width: 220, height: 40 } });

    const result = auditWorkspaceLayout(document, { tolerancePx: 0, focusReservePx: 0 });
    expect(result).toMatchObject({
      modelId: WORKSPACE_LAYOUT_AUDIT_MODEL,
      passed: false,
      auditedGroupCount: 1,
      auditedElementCount: 2
    });
    expect(result.collisions[0]).toMatchObject({
      groupId: "heading",
      left: "eyebrow",
      right: "heading"
    });
  });

  test("reserves active-focus paint space so a ring cannot overlay adjacent copy", () => {
    const eyebrow = element({
      id: "eyebrow",
      box: { left: 10, top: 10, width: 180, height: 18 }
    });
    const heading = element({
      id: "heading",
      box: { left: 10, top: 30, width: 220, height: 40 }
    });
    heading.tabIndex = -1;
    heading.focus();

    const withoutFocusReserve = auditWorkspaceLayout(document, {
      tolerancePx: 0,
      focusReservePx: 0
    });
    const withFocusReserve = auditWorkspaceLayout(document, {
      tolerancePx: 0,
      focusReservePx: 3
    });
    expect(withoutFocusReserve.passed).toBe(true);
    expect(withFocusReserve.passed).toBe(false);
    expect(document.activeElement).toBe(heading);
    expect(eyebrow.isConnected).toBe(true);
  });

  test("passes separated content and ignores explicitly permitted overlays", () => {
    element({ id: "eyebrow", box: { left: 10, top: 10, width: 180, height: 18 } });
    element({ id: "heading", box: { left: 10, top: 36, width: 220, height: 40 } });
    const intentional = element({
      id: "intentional",
      box: { left: 10, top: 12, width: 50, height: 12 }
    });
    intentional.dataset.layoutOverlapAllowed = "true";

    expect(auditWorkspaceLayout(document, { tolerancePx: 0, focusReservePx: 2 }))
      .toMatchObject({
        passed: true,
        collisions: [],
        overflow: [],
        documentOverflowPx: 0,
        undeclaredOverlays: []
      });
  });

  test("fails a visible dialog until its deliberate overlap is declared", () => {
    const dialog = element({
      id: "contextless-dialog",
      group: null,
      box: { left: 20, top: 20, width: 200, height: 120 }
    });
    dialog.setAttribute("role", "dialog");

    expect(auditWorkspaceLayout(document, { tolerancePx: 0 })).toMatchObject({
      passed: false,
      undeclaredOverlays: ["contextless-dialog"]
    });

    dialog.dataset.layoutOverlapAllowed = "true";
    expect(auditWorkspaceLayout(document, { tolerancePx: 0 })).toMatchObject({
      passed: true,
      undeclaredOverlays: []
    });
  });

  test("distinguishes a declared modal from control clipping inside that modal", () => {
    Object.defineProperties(document.documentElement, {
      clientWidth: { configurable: true, value: 320 },
      clientHeight: { configurable: true, value: 480 }
    });
    const dialog = element({
      id: "commercial-search-dialog",
      group: null,
      box: { left: 16, top: 20, width: 288, height: 300 }
    });
    dialog.setAttribute("role", "dialog");
    Object.defineProperties(dialog, {
      clientWidth: { configurable: true, value: 288 },
      scrollWidth: { configurable: true, value: 288 },
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 300 }
    });
    const close = document.createElement("button");
    close.textContent = "Close";
    close.getBoundingClientRect = () => rect({ left: 244, top: 36, width: 44, height: 44 });
    dialog.append(close);
    close.focus();

    expect(auditContainedTransientSurface(dialog)).toMatchObject({
      modelId: CONTAINED_TRANSIENT_SURFACE_AUDIT_MODEL,
      passed: false,
      declaration: "",
      clippedControls: []
    });

    dialog.dataset.layoutOverlapAllowed = "true";
    expect(auditContainedTransientSurface(dialog, { tolerancePx: 0, focusReservePx: 2 }))
      .toMatchObject({
        passed: true,
        declaration: "data-layout-overlap-allowed",
        surfaceWithinViewport: true,
        horizontalOverflowPx: 0,
        verticalOverflowContained: true,
        controlCount: 1,
        focusIsInside: true,
        focusContained: true,
        clippedControls: []
      });

    close.getBoundingClientRect = () => rect({ left: 285, top: 36, width: 44, height: 44 });
    expect(auditContainedTransientSurface(dialog, { tolerancePx: 0, focusReservePx: 0 }))
      .toMatchObject({
        passed: false,
        declaration: "data-layout-overlap-allowed",
        clippedControls: [{ id: "Close", horizontallyContained: false }]
      });
  });

  test("accepts an expanded ARIA-controlled sheet without treating it as an undeclared collision", () => {
    Object.defineProperties(document.documentElement, {
      clientWidth: { configurable: true, value: 390 },
      clientHeight: { configurable: true, value: 844 }
    });
    const trigger = document.createElement("button");
    trigger.setAttribute("aria-expanded", "true");
    trigger.setAttribute("aria-controls", "live-breakdown");
    document.body.append(trigger);
    const dialog = element({
      id: "live-breakdown",
      group: null,
      box: { left: 12, top: 12, width: 366, height: 820 }
    });
    dialog.setAttribute("role", "dialog");
    dialog.style.overflowY = "auto";
    Object.defineProperties(dialog, {
      clientWidth: { configurable: true, value: 366 },
      scrollWidth: { configurable: true, value: 366 },
      clientHeight: { configurable: true, value: 820 },
      scrollHeight: { configurable: true, value: 1100 }
    });
    const close = document.createElement("button");
    close.textContent = "Close";
    close.getBoundingClientRect = () => rect({ left: 314, top: 28, width: 44, height: 44 });
    dialog.append(close);
    close.focus();

    expect(auditContainedTransientSurface(dialog, { trigger, focusReservePx: 2 }))
      .toMatchObject({
        passed: true,
        declaration: "aria-controls",
        surfaceWithinViewport: true,
        verticalOverflowPx: 280,
        verticalOverflowContained: true,
        focusContained: true,
        clippedControls: []
      });

    const offscreenAction = document.createElement("button");
    offscreenAction.textContent = "Resolve lower section";
    offscreenAction.getBoundingClientRect = () => rect({ left: 30, top: 980, width: 180, height: 44 });
    dialog.append(offscreenAction);
    offscreenAction.focus();
    expect(auditContainedTransientSurface(dialog, { trigger, focusReservePx: 2 }))
      .toMatchObject({
        passed: true,
        verticalOverflowContained: true,
        focusIsInside: true,
        focusPainted: false,
        focusHorizontallyContained: true,
        focusVerticallyContainedWhenPainted: true,
        focusContained: true,
        focusedControl: "Resolve lower section"
      });
    expect(auditWorkspaceLayout(document, { tolerancePx: 0 })).toMatchObject({
      passed: true,
      undeclaredOverlays: []
    });
  });

  test("fails document and explicitly audited intrinsic horizontal overflow", () => {
    Object.defineProperties(document.documentElement, {
      clientWidth: { configurable: true, value: 320 },
      scrollWidth: { configurable: true, value: 326 }
    });
    const surface = element({
      id: "intrinsic-overflow",
      group: null,
      box: { left: 0, top: 0, width: 320, height: 480 }
    });
    surface.dataset.layoutAuditOverflow = "true";
    Object.defineProperties(surface, {
      clientWidth: { configurable: true, value: 320 },
      scrollWidth: { configurable: true, value: 324 }
    });

    expect(auditWorkspaceLayout(document, { tolerancePx: 1 })).toMatchObject({
      passed: false,
      documentOverflowPx: 6,
      overflow: [{ id: "intrinsic-overflow", overflowPx: 4 }]
    });
  });

  test("audits direct children of a shared heading wrapper and reserves focused descendant paint", () => {
    const heading = element({
      id: "directory-heading-row",
      group: null,
      box: { left: 10, top: 10, width: 300, height: 60 }
    });
    heading.className = "workspace-route-head";
    const copy = element({
      id: "directory-heading-copy",
      group: null,
      box: { left: 10, top: 10, width: 180, height: 40 }
    });
    const actions = element({
      id: "directory-heading-actions",
      group: null,
      box: { left: 191, top: 10, width: 100, height: 40 }
    });
    const button = document.createElement("button");
    actions.append(button);
    heading.append(copy, actions);
    button.focus();

    expect(auditWorkspaceLayout(document, { tolerancePx: 0, focusReservePx: 0 }))
      .toMatchObject({
        passed: true,
        auditedHeadingCount: 1,
        auditedGroupCount: 1,
        auditedElementCount: 2
      });
    const focused = auditWorkspaceLayout(document, { tolerancePx: 0, focusReservePx: 2 });
    expect(focused.passed).toBe(false);
    expect(focused.collisions[0]).toMatchObject({
      groupId: "directory-heading-row:heading:1",
      left: "directory-heading-copy",
      right: "directory-heading-actions"
    });
  });

  test("treats a shared route root as a viewport-containment target", () => {
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: 320
    });
    const surface = element({
      id: "customer-directory-route",
      group: null,
      box: { left: 0, top: 0, width: 321, height: 480 }
    });
    surface.className = "workspace-route-main";
    const clippingAncestor = document.createElement("div");
    clippingAncestor.style.overflowX = "hidden";
    document.body.append(clippingAncestor);
    clippingAncestor.append(surface);

    const result = auditWorkspaceLayout(surface, { tolerancePx: 0, focusReservePx: 0 });
    expect(result).toMatchObject({
      passed: false,
      auditedSurfaceCount: 1,
      overflow: [{ id: "customer-directory-route", viewportWidth: 320 }]
    });
  });

  test("reports a visible enabled button that escapes its registered surface and viewport", () => {
    Object.defineProperties(document.documentElement, {
      clientWidth: { configurable: true, value: 320 },
      clientHeight: { configurable: true, value: 480 }
    });
    const surface = element({
      id: "route-surface",
      group: null,
      box: { left: 10, top: 0, width: 300, height: 700 }
    });
    surface.dataset.layoutAuditSurface = "route-surface";
    const escaped = document.createElement("button");
    escaped.textContent = "Resolve issue";
    escaped.getBoundingClientRect = () => rect({ left: 288, top: 40, width: 44, height: 44 });
    surface.append(escaped);
    const disabled = document.createElement("button");
    disabled.textContent = "Unavailable action";
    disabled.setAttribute("aria-disabled", "true");
    disabled.getBoundingClientRect = () => rect({ left: 288, top: 100, width: 44, height: 44 });
    surface.append(disabled);

    const result = auditWorkspaceLayout(document, { tolerancePx: 0, focusReservePx: 2 });
    expect(result).toMatchObject({
      modelId: WORKSPACE_LAYOUT_AUDIT_MODEL,
      containmentModelId: WORKSPACE_CONTROL_CONTAINMENT_MODEL,
      passed: false,
      auditedControlCount: 1,
      auditedSurfaceControlCount: 1,
      boundedOverflowExemptions: [],
      transientLayerExemptions: [],
      escapedFocusPaint: []
    });
    expect(result.escapedControls).toEqual([
      expect.objectContaining({
        surfaceId: "route-surface",
        id: "Resolve issue",
        withinSurface: false,
        withinViewport: false,
        viewportWidth: 320
      })
    ]);
  });

  test("allows an escaping control only when a bounded horizontal scroller clips it", () => {
    Object.defineProperties(document.documentElement, {
      clientWidth: { configurable: true, value: 320 },
      clientHeight: { configurable: true, value: 480 }
    });
    const surface = element({
      id: "catalog-route",
      group: null,
      box: { left: 10, top: 0, width: 300, height: 700 }
    });
    surface.dataset.layoutAuditSurface = "catalog-route";
    const scroller = document.createElement("div");
    scroller.id = "bounded-table-scroll";
    scroller.style.overflowX = "auto";
    scroller.getBoundingClientRect = () => rect({ left: 20, top: 30, width: 280, height: 120 });
    surface.append(scroller);
    const clipped = document.createElement("button");
    clipped.textContent = "Edit final column";
    clipped.getBoundingClientRect = () => rect({ left: 286, top: 50, width: 64, height: 44 });
    scroller.append(clipped);

    expect(auditWorkspaceLayout(document, { tolerancePx: 0 })).toMatchObject({
      passed: true,
      auditedControlCount: 1,
      auditedSurfaceControlCount: 1,
      escapedControls: [],
      boundedOverflowExemptions: [{
        surfaceId: "catalog-route",
        id: "Edit final column",
        ancestor: "bounded-table-scroll",
        overflowX: "auto"
      }]
    });

    scroller.getBoundingClientRect = () => rect({ left: 20, top: 30, width: 330, height: 120 });
    const unboundedResult = auditWorkspaceLayout(document, { tolerancePx: 0 });
    expect(unboundedResult.passed).toBe(false);
    expect(unboundedResult.boundedOverflowExemptions).toEqual([]);
    expect(unboundedResult.escapedControls).toHaveLength(1);
  });

  test("exempts controls owned by a declared context layer from the background surface contract", () => {
    Object.defineProperties(document.documentElement, {
      clientWidth: { configurable: true, value: 320 },
      clientHeight: { configurable: true, value: 480 }
    });
    const surface = element({
      id: "opportunity-route",
      group: null,
      box: { left: 0, top: 0, width: 320, height: 800 }
    });
    surface.dataset.layoutAuditSurface = "opportunity-route";
    const context = document.createElement("div");
    context.dataset.layoutOverlapAllowed = "true";
    context.dataset.layoutAuditId = "guest-context-layer";
    context.getBoundingClientRect = () => rect({ left: 300, top: 10, width: 180, height: 300 });
    surface.append(context);
    const close = document.createElement("button");
    close.textContent = "Close context";
    close.getBoundingClientRect = () => rect({ left: 430, top: 24, width: 44, height: 44 });
    context.append(close);

    expect(auditWorkspaceLayout(document, { tolerancePx: 0 })).toMatchObject({
      passed: true,
      auditedControlCount: 0,
      auditedSurfaceControlCount: 0,
      escapedControls: [],
      transientLayerExemptions: [{
        surfaceId: "opportunity-route",
        id: "Close context",
        transientLayer: "guest-context-layer"
      }]
    });
  });

  test("audits a control independently against nested registered surfaces", () => {
    Object.defineProperties(document.documentElement, {
      clientWidth: { configurable: true, value: 360 },
      clientHeight: { configurable: true, value: 480 }
    });
    const outer = element({
      id: "outer-route",
      group: null,
      box: { left: 0, top: 0, width: 360, height: 800 }
    });
    outer.dataset.layoutAuditSurface = "outer-route";
    const inner = document.createElement("section");
    inner.dataset.layoutAuditSurface = "inner-object";
    inner.getBoundingClientRect = () => rect({ left: 20, top: 30, width: 280, height: 240 });
    outer.append(inner);
    const action = document.createElement("button");
    action.textContent = "Apply recommendation";
    action.getBoundingClientRect = () => rect({ left: 278, top: 60, width: 44, height: 44 });
    inner.append(action);

    const result = auditWorkspaceLayout(document, { tolerancePx: 0 });
    expect(result).toMatchObject({
      passed: false,
      auditedSurfaceCount: 2,
      auditedControlCount: 1,
      auditedSurfaceControlCount: 2
    });
    expect(result.escapedControls).toEqual([
      expect.objectContaining({
        surfaceId: "inner-object",
        id: "Apply recommendation",
        withinSurface: false,
        withinViewport: true
      })
    ]);
  });

  test("measures focus paint but does not fail a vertically offscreen control", () => {
    Object.defineProperties(document.documentElement, {
      clientWidth: { configurable: true, value: 320 },
      clientHeight: { configurable: true, value: 480 }
    });
    const surface = element({
      id: "scrolling-route",
      group: null,
      box: { left: 0, top: 0, width: 320, height: 1000 }
    });
    surface.dataset.layoutAuditSurface = "scrolling-route";
    const action = document.createElement("button");
    action.textContent = "Resolve later section";
    action.getBoundingClientRect = () => rect({ left: 20, top: 700, width: 180, height: 44 });
    surface.append(action);
    action.focus();

    const result = auditWorkspaceLayout(document, { tolerancePx: 0, focusReservePx: 3 });
    expect(result).toMatchObject({
      passed: true,
      escapedControls: [],
      escapedFocusPaint: [],
      focusPaintChecks: [{
        surfaceId: "scrolling-route",
        id: "Resolve later section",
        painted: false,
        horizontallyContained: true,
        verticallyContainedWhenPainted: true,
        contained: true
      }]
    });
  });

  test("reports focused paint that escapes a painted surface even when the control box fits", () => {
    Object.defineProperties(document.documentElement, {
      clientWidth: { configurable: true, value: 320 },
      clientHeight: { configurable: true, value: 480 }
    });
    const surface = element({
      id: "focus-route",
      group: null,
      box: { left: 10, top: 0, width: 300, height: 480 }
    });
    surface.dataset.layoutAuditSurface = "focus-route";
    const action = document.createElement("button");
    action.textContent = "Edge action";
    action.getBoundingClientRect = () => rect({ left: 10, top: 40, width: 44, height: 44 });
    surface.append(action);
    action.focus();

    const result = auditWorkspaceLayout(document, { tolerancePx: 0, focusReservePx: 2 });
    expect(result.escapedControls).toEqual([]);
    expect(result.passed).toBe(false);
    expect(result.escapedFocusPaint).toEqual([
      expect.objectContaining({
        surfaceId: "focus-route",
        id: "Edge action",
        painted: true,
        horizontallyContained: false,
        verticallyContainedWhenPainted: true,
        contained: false
      })
    ]);
  });
});
