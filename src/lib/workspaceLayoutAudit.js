export const WORKSPACE_LAYOUT_AUDIT_MODEL = "workspace-layout-audit-v1";
export const CONTAINED_TRANSIENT_SURFACE_AUDIT_MODEL = "contained-transient-surface-audit-v1";
export const WORKSPACE_CONTROL_CONTAINMENT_MODEL = "workspace-control-containment-v1";

export const WORKSPACE_LAYOUT_AUDIT_DEFAULTS = Object.freeze({
  tolerancePx: 1,
  focusReservePx: 2,
  maxReportedPairs: 24
});

const IGNORE_OVERLAP_SELECTOR = [
  "[data-layout-overlap-allowed='true']",
  "[aria-hidden='true']",
  ".visually-hidden",
  ".sr-only"
].join(",");
const OVERLAY_SELECTOR = "[role='dialog'], .modal-overlay";
const INTENTIONAL_TRANSIENT_LAYER_SELECTOR = [
  "[data-layout-overlap-allowed='true']",
  "[role='dialog']",
  "[role='menu']",
  "[role='listbox']",
  "[popover]",
  ".modal-overlay"
].join(",");
const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='button']",
  "[role='link']",
  "[role='menuitem']",
  "[role='option']",
  "[role='tab']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='switch']",
  "[role='slider']",
  "[role='spinbutton']",
  "[role='combobox']",
  "[tabindex]:not([tabindex='-1'])"
].join(",");
const HEADING_SELECTOR = [
  "[data-layout-audit-heading]",
  ".modal-head",
  ".workspace-route-head",
  ".commercial-search-head",
  ".ui-recovery-card",
  ".modal-loading-card",
  ".workspace-not-found",
  ".command-center-head",
  ".event-identity",
  ".event-section-heading"
].join(",");
const SURFACE_SELECTOR = [
  "[data-layout-audit-surface]",
  ".workspace-route-main",
  ".modal-overlay",
  ".ui-recovery-route"
].join(",");

function finite(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizedRect(rect, focusReservePx = 0) {
  return {
    left: finite(rect?.left, 0) - focusReservePx,
    top: finite(rect?.top, 0) - focusReservePx,
    right: finite(rect?.right, 0) + focusReservePx,
    bottom: finite(rect?.bottom, 0) + focusReservePx,
    width: Math.max(0, finite(rect?.width, 0) + focusReservePx * 2),
    height: Math.max(0, finite(rect?.height, 0) + focusReservePx * 2)
  };
}

export function rectanglesIntersect(first, second, tolerancePx = 1) {
  const tolerance = Math.max(0, finite(tolerancePx, 1));
  return first.left < second.right - tolerance
    && first.right > second.left + tolerance
    && first.top < second.bottom - tolerance
    && first.bottom > second.top + tolerance;
}

function visible(element) {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== "none"
    && style.visibility !== "hidden"
    && Number(style.opacity || 1) > 0
    && rect.width > 0
    && rect.height > 0;
}

function labelFor(element) {
  return String(
    element.getAttribute("data-layout-audit-id")
    || element.getAttribute("data-layout-audit-surface")
    || element.getAttribute("data-layout-audit-heading")
    || element.id
    || element.getAttribute("aria-label")
    || element.getAttribute("aria-labelledby")
    || element.textContent
    || element.tagName
  ).replace(/\s+/gu, " ").trim().slice(0, 120);
}

function surfaceLabelFor(element, index) {
  const explicit = String(
    element.getAttribute("data-layout-audit-surface")
    || element.getAttribute("data-layout-audit-id")
    || element.id
    || element.getAttribute("aria-label")
    || element.getAttribute("aria-labelledby")
    || ""
  ).replace(/\s+/gu, " ").trim();
  if (explicit) return explicit.slice(0, 120);
  const structuralClass = [...element.classList]
    .find((className) => /(?:surface|route|modal|recovery)/u.test(className));
  return `${structuralClass || element.tagName.toLowerCase()}:surface:${index + 1}`;
}

function selectAll(scope, selector) {
  const matches = [...scope.querySelectorAll(selector)];
  if (scope.nodeType === 1 && scope.matches(selector)) matches.unshift(scope);
  return matches;
}

function appendGroup(groups, groupId, elements) {
  if (!groupId || elements.length === 0) return;
  if (!groups.has(groupId)) groups.set(groupId, []);
  const group = groups.get(groupId);
  elements.forEach((element) => {
    if (!group.includes(element)) group.push(element);
  });
}

function containedHorizontalOverflow(element) {
  const body = element.ownerDocument?.body;
  for (let ancestor = element.parentElement; ancestor && ancestor !== body; ancestor = ancestor.parentElement) {
    const overflowX = getComputedStyle(ancestor).overflowX;
    if (["auto", "scroll", "hidden", "clip"].includes(overflowX)) return true;
  }
  return false;
}

function horizontallyWithin(outer, inner, tolerancePx = 1) {
  const tolerance = Math.max(0, finite(tolerancePx, 1));
  return inner.left >= outer.left - tolerance
    && inner.right <= outer.right + tolerance;
}

function verticallyWithin(outer, inner, tolerancePx = 1) {
  const tolerance = Math.max(0, finite(tolerancePx, 1));
  return inner.top >= outer.top - tolerance
    && inner.bottom <= outer.bottom + tolerance;
}

function enabledInteractive(element) {
  return !element.matches(":disabled, [aria-disabled='true']")
    && !element.closest("[inert]");
}

function overflowAmount(element) {
  return Math.max(0, finite(element?.scrollWidth, 0) - finite(element?.clientWidth, 0));
}

function isDeclaredOverlay(element) {
  const explicitDeclaration = Boolean(
    element.matches("[data-layout-overlap-allowed='true']")
    || element.closest("[data-layout-overlap-allowed='true']")
  );
  if (explicitDeclaration) return true;
  const ownerDocument = element.ownerDocument;
  const expandedTriggers = ownerDocument
    ? [...ownerDocument.querySelectorAll("[aria-expanded='true']")]
    : [];
  return expandedTriggers.some((trigger) => {
    const controlledId = String(trigger.getAttribute("aria-controls") || "").trim();
    if (controlledId && element.id === controlledId) return true;
    const popupRole = String(trigger.getAttribute("aria-haspopup") || "").trim();
    const elementRole = String(element.getAttribute("role") || "").trim();
    return Boolean(
      popupRole
      && popupRole !== "false"
      && (popupRole === elementRole || popupRole === "true")
      && trigger.parentElement?.contains(element)
    );
  });
}

function declaredTransientAncestor(element, surface) {
  for (let ancestor = element; ancestor && ancestor !== surface; ancestor = ancestor.parentElement) {
    if (!ancestor.matches?.(INTENTIONAL_TRANSIENT_LAYER_SELECTOR)) continue;
    if (isDeclaredOverlay(ancestor)) return ancestor;
  }
  return null;
}

function boundedHorizontalOverflowAncestor(element, surface, elementRect, surfaceRect, viewport, tolerancePx) {
  for (
    let ancestor = element.parentElement;
    ancestor && surface.contains(ancestor);
    ancestor = ancestor.parentElement
  ) {
    const style = getComputedStyle(ancestor);
    const overflowX = String(style.overflowX || style.overflow || "visible");
    const ancestorRect = normalizedRect(ancestor.getBoundingClientRect());
    const clipsElement = elementRect.left < ancestorRect.left - tolerancePx
      || elementRect.right > ancestorRect.right + tolerancePx;
    const explicitlyClips = ["auto", "scroll", "hidden", "clip"].includes(overflowX);
    const bounded = horizontallyWithin(surfaceRect, ancestorRect, tolerancePx)
      && horizontallyWithin(viewport, ancestorRect, tolerancePx);
    if (explicitlyClips && clipsElement && bounded) {
      return {
        id: labelFor(ancestor),
        overflowX,
        rect: ancestorRect
      };
    }
    if (ancestor === surface) break;
  }
  return null;
}

function rectWithin(outer, inner, tolerancePx = 1) {
  const tolerance = Math.max(0, finite(tolerancePx, 1));
  return inner.left >= outer.left - tolerance
    && inner.top >= outer.top - tolerance
    && inner.right <= outer.right + tolerance
    && inner.bottom <= outer.bottom + tolerance;
}

function verticallyPainted(rect, surfaceRect, viewport) {
  const paintedTop = Math.max(surfaceRect.top, viewport.top);
  const paintedBottom = Math.min(surfaceRect.bottom, viewport.bottom);
  return paintedBottom > paintedTop
    && rect.bottom > paintedTop
    && rect.top < paintedBottom;
}

function rectHasAreaIntersection(first, second) {
  return first.left < second.right
    && first.right > second.left
    && first.top < second.bottom
    && first.bottom > second.top;
}

function declaredTransientSurface(surface, trigger) {
  if (
    surface.matches("[data-layout-overlap-allowed='true']")
    || surface.closest("[data-layout-overlap-allowed='true']")
  ) return "data-layout-overlap-allowed";
  if (!trigger) return "";
  const expanded = trigger.getAttribute("aria-expanded") === "true";
  if (!expanded) return "";
  const controlledId = String(trigger.getAttribute("aria-controls") || "").trim();
  if (controlledId && surface.id === controlledId) return "aria-controls";
  const popupRole = String(trigger.getAttribute("aria-haspopup") || "").trim();
  const surfaceRole = String(surface.getAttribute("role") || "").trim();
  if (popupRole && popupRole !== "false" && (popupRole === surfaceRole || popupRole === "true")) {
    const sharedContainer = trigger.parentElement;
    if (sharedContainer?.contains(surface)) return "aria-haspopup";
  }
  return "";
}

function intersectRect(first, second) {
  return {
    left: Math.max(first.left, second.left),
    top: Math.max(first.top, second.top),
    right: Math.min(first.right, second.right),
    bottom: Math.min(first.bottom, second.bottom)
  };
}

function transientSurfacePaintBounds(surface, viewport) {
  if (getComputedStyle(surface).position === "fixed") return viewport;
  let bounds = { ...viewport };
  const body = surface.ownerDocument?.body;
  for (let ancestor = surface.parentElement; ancestor && ancestor !== body; ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor);
    const ancestorRect = normalizedRect(ancestor.getBoundingClientRect());
    const clipsX = ["auto", "scroll", "hidden", "clip"].includes(style.overflowX);
    const clipsY = ["auto", "scroll", "hidden", "clip"].includes(style.overflowY);
    if (clipsX) bounds = intersectRect(bounds, {
      left: ancestorRect.left,
      right: ancestorRect.right,
      top: bounds.top,
      bottom: bounds.bottom
    });
    if (clipsY) bounds = intersectRect(bounds, {
      left: bounds.left,
      right: bounds.right,
      top: ancestorRect.top,
      bottom: ancestorRect.bottom
    });
  }
  return bounds;
}

/**
 * Audits the inside of a deliberate modal, drawer, sheet, or popover. The
 * workspace collision audit permits a declared overlay to cover background
 * content; this companion audit proves the transient surface itself remains
 * bounded, scroll-contained, focus-contained, and free of clipped controls.
 */
export function auditContainedTransientSurface(surface, options = {}) {
  if (!surface?.getBoundingClientRect || !surface?.ownerDocument) {
    return Object.freeze({
      modelId: CONTAINED_TRANSIENT_SURFACE_AUDIT_MODEL,
      passed: false,
      setupError: "A rendered transient surface is required."
    });
  }
  const tolerancePx = Math.max(0, finite(
    options.tolerancePx,
    WORKSPACE_LAYOUT_AUDIT_DEFAULTS.tolerancePx
  ));
  const focusReservePx = Math.max(0, finite(
    options.focusReservePx,
    WORKSPACE_LAYOUT_AUDIT_DEFAULTS.focusReservePx
  ));
  const requireFocusWithin = options.requireFocusWithin !== false;
  const ownerDocument = surface.ownerDocument;
  const documentElement = ownerDocument.documentElement;
  const viewport = {
    left: 0,
    top: 0,
    right: finite(documentElement.clientWidth, finite(ownerDocument.defaultView?.innerWidth, 0)),
    bottom: finite(documentElement.clientHeight, finite(ownerDocument.defaultView?.innerHeight, 0))
  };
  const surfaceRect = normalizedRect(surface.getBoundingClientRect());
  const paintBounds = transientSurfacePaintBounds(surface, viewport);
  const surfaceStyle = getComputedStyle(surface);
  const horizontalOverflowPx = overflowAmount(surface);
  const verticalOverflowPx = Math.max(
    0,
    finite(surface.scrollHeight, 0) - finite(surface.clientHeight, 0)
  );
  const overflowY = String(surfaceStyle.overflowY || surfaceStyle.overflow || "visible");
  const verticalOverflowContained = verticalOverflowPx <= tolerancePx
    || ["auto", "scroll", "hidden", "clip"].includes(overflowY);
  const declaration = declaredTransientSurface(surface, options.trigger || null);
  const controls = selectAll(surface, INTERACTIVE_SELECTOR).filter(visible);
  const clippedControls = [];
  let viewportControlCount = 0;
  controls.forEach((control) => {
    const rect = normalizedRect(control.getBoundingClientRect());
    const intersectsPaintedSurface = rectHasAreaIntersection(rect, surfaceRect)
      && rectHasAreaIntersection(rect, viewport);
    if (intersectsPaintedSurface) viewportControlCount += 1;
    const horizontallyContained = rect.left >= surfaceRect.left - tolerancePx
      && rect.right <= surfaceRect.right + tolerancePx
      && rect.left >= viewport.left - tolerancePx
      && rect.right <= viewport.right + tolerancePx;
    const verticallyContainedWhenPainted = !intersectsPaintedSurface || (
      rect.top >= surfaceRect.top - tolerancePx
      && rect.bottom <= surfaceRect.bottom + tolerancePx
      && rect.top >= viewport.top - tolerancePx
      && rect.bottom <= viewport.bottom + tolerancePx
    );
    if (horizontallyContained && verticallyContainedWhenPainted) return;
    clippedControls.push({
      id: labelFor(control),
      rect,
      horizontallyContained,
      verticallyContainedWhenPainted
    });
  });
  const activeElement = ownerDocument.activeElement;
  const focusIsInside = Boolean(activeElement && (surface === activeElement || surface.contains(activeElement)));
  const focusElementRect = focusIsInside
    ? normalizedRect(activeElement.getBoundingClientRect())
    : null;
  const focusRect = focusIsInside
    ? normalizedRect(activeElement.getBoundingClientRect(), focusReservePx)
    : null;
  const focusPainted = Boolean(
    focusElementRect
    && verticallyPainted(focusElementRect, surfaceRect, viewport)
  );
  const focusHorizontallyContained = Boolean(
    focusRect
    && horizontallyWithin(surfaceRect, focusRect, tolerancePx)
    && horizontallyWithin(viewport, focusRect, tolerancePx)
  );
  const focusVerticallyContainedWhenPainted = !focusPainted || Boolean(
    focusRect
    && verticallyWithin(surfaceRect, focusRect, tolerancePx)
    && verticallyWithin(viewport, focusRect, tolerancePx)
  );
  const focusContained = !requireFocusWithin || Boolean(
    focusIsInside
    && (!focusPainted || (focusHorizontallyContained && focusVerticallyContainedWhenPainted))
  );
  const surfaceWithinViewport = rectWithin(viewport, surfaceRect, tolerancePx);
  const surfaceWithinClippingAncestors = rectWithin(paintBounds, surfaceRect, tolerancePx);
  return Object.freeze({
    modelId: CONTAINED_TRANSIENT_SURFACE_AUDIT_MODEL,
    passed: Boolean(declaration)
      && surfaceWithinViewport
      && surfaceWithinClippingAncestors
      && horizontalOverflowPx <= tolerancePx
      && verticalOverflowContained
      && clippedControls.length === 0
      && focusContained,
    setupError: "",
    declaration,
    surfaceWithinViewport,
    surfaceWithinClippingAncestors,
    surfaceRect,
    viewport,
    paintBounds,
    horizontalOverflowPx,
    verticalOverflowPx,
    verticalOverflowContained,
    controlCount: controls.length,
    viewportControlCount,
    clippedControls: Object.freeze(clippedControls),
    focusIsInside,
    focusPainted,
    focusHorizontallyContained,
    focusVerticallyContainedWhenPainted,
    focusContained,
    focusedControl: focusIsInside ? labelFor(activeElement) : ""
  });
}

export function auditWorkspaceLayout(root = document, options = {}) {
  const tolerancePx = Math.max(0, finite(
    options.tolerancePx,
    WORKSPACE_LAYOUT_AUDIT_DEFAULTS.tolerancePx
  ));
  const focusReservePx = Math.max(0, finite(
    options.focusReservePx,
    WORKSPACE_LAYOUT_AUDIT_DEFAULTS.focusReservePx
  ));
  const maxReportedPairs = Math.max(1, Math.round(finite(
    options.maxReportedPairs,
    WORKSPACE_LAYOUT_AUDIT_DEFAULTS.maxReportedPairs
  )));
  const scope = root?.querySelectorAll ? root : document;
  const documentElement = scope.ownerDocument?.documentElement || document.documentElement;
  const ownerDocument = documentElement.ownerDocument || document;
  const viewportWidth = documentElement.clientWidth;
  const viewport = {
    left: 0,
    top: 0,
    right: viewportWidth,
    bottom: finite(documentElement.clientHeight, finite(ownerDocument.defaultView?.innerHeight, 0))
  };
  const documentOverflowPx = overflowAmount(documentElement);
  const audited = selectAll(scope, "[data-layout-audit-group]")
    .filter((element) => !element.matches(IGNORE_OVERLAP_SELECTOR) && visible(element));
  const groups = new Map();
  audited.forEach((element) => {
    const groupId = element.getAttribute("data-layout-audit-group");
    appendGroup(groups, groupId, [element]);
  });
  const headings = selectAll(scope, HEADING_SELECTOR)
    .filter((element) => !element.matches(IGNORE_OVERLAP_SELECTOR) && visible(element));
  headings.forEach((heading, headingIndex) => {
    const groupId = heading.getAttribute("data-layout-audit-heading")
      || `${labelFor(heading) || "staff-surface"}:heading:${headingIndex + 1}`;
    const items = [...heading.children]
      .filter((element) => !element.matches(IGNORE_OVERLAP_SELECTOR) && visible(element));
    appendGroup(groups, groupId, items);
  });
  const collisions = [];
  groups.forEach((elements, groupId) => {
    for (let leftIndex = 0; leftIndex < elements.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < elements.length; rightIndex += 1) {
        const left = elements[leftIndex];
        const right = elements[rightIndex];
        if (left.contains(right) || right.contains(left)) continue;
        const activeElement = left.ownerDocument.activeElement;
        const leftReserve = left === activeElement || left.contains(activeElement) ? focusReservePx : 0;
        const rightReserve = right === activeElement || right.contains(activeElement) ? focusReservePx : 0;
        const leftRect = normalizedRect(left.getBoundingClientRect(), leftReserve);
        const rightRect = normalizedRect(right.getBoundingClientRect(), rightReserve);
        if (!rectanglesIntersect(leftRect, rightRect, tolerancePx)) continue;
        collisions.push({
          groupId,
          left: labelFor(left),
          right: labelFor(right),
          leftRect,
          rightRect
        });
        if (collisions.length >= maxReportedPairs) break;
      }
      if (collisions.length >= maxReportedPairs) break;
    }
  });
  const surfaces = selectAll(scope, SURFACE_SELECTOR)
    .filter((element) => !element.matches(IGNORE_OVERLAP_SELECTOR) && visible(element));
  const surfaceIds = new Map(
    surfaces.map((surface, surfaceIndex) => [surface, surfaceLabelFor(surface, surfaceIndex)])
  );
  const auditedControls = new Set();
  let auditedSurfaceControlCount = 0;
  const boundedOverflowExemptions = [];
  const transientLayerExemptions = [];
  const escapedControls = [];
  surfaces.forEach((surface) => {
    const surfaceId = surfaceIds.get(surface);
    const surfaceRect = normalizedRect(surface.getBoundingClientRect());
    const controls = selectAll(surface, INTERACTIVE_SELECTOR)
      .filter((element) => visible(element) && enabledInteractive(element));
    controls.forEach((control) => {
      const transientLayer = declaredTransientAncestor(control, surface);
      if (transientLayer) {
        transientLayerExemptions.push({
          surfaceId,
          id: labelFor(control),
          transientLayer: labelFor(transientLayer)
        });
        return;
      }
      auditedControls.add(control);
      auditedSurfaceControlCount += 1;
      const rect = normalizedRect(control.getBoundingClientRect());
      const withinSurface = horizontallyWithin(surfaceRect, rect, tolerancePx);
      const withinViewport = horizontallyWithin(viewport, rect, tolerancePx);
      if (withinSurface && withinViewport) return;
      const boundedOverflowAncestor = boundedHorizontalOverflowAncestor(
        control,
        surface,
        rect,
        surfaceRect,
        viewport,
        tolerancePx
      );
      if (boundedOverflowAncestor) {
        boundedOverflowExemptions.push({
          surfaceId,
          id: labelFor(control),
          ancestor: boundedOverflowAncestor.id,
          overflowX: boundedOverflowAncestor.overflowX
        });
        return;
      }
      escapedControls.push({
        surfaceId,
        id: labelFor(control),
        rect,
        surfaceRect,
        viewportWidth,
        withinSurface,
        withinViewport
      });
    });
  });
  const activeElement = ownerDocument.activeElement;
  const focusPaintChecks = [];
  if (
    activeElement
    && activeElement !== ownerDocument.body
    && activeElement !== documentElement
    && activeElement.getBoundingClientRect
    && visible(activeElement)
  ) {
    const controlRect = normalizedRect(activeElement.getBoundingClientRect());
    const focusRect = normalizedRect(activeElement.getBoundingClientRect(), focusReservePx);
    surfaces
      .filter((surface) => surface === activeElement || surface.contains(activeElement))
      .forEach((surface) => {
        if (declaredTransientAncestor(activeElement, surface)) return;
        const surfaceId = surfaceIds.get(surface);
        const surfaceRect = normalizedRect(surface.getBoundingClientRect());
        const painted = verticallyPainted(controlRect, surfaceRect, viewport);
        const horizontallyContained = horizontallyWithin(surfaceRect, focusRect, tolerancePx)
          && horizontallyWithin(viewport, focusRect, tolerancePx);
        const verticallyContainedWhenPainted = !painted || (
          verticallyWithin(surfaceRect, focusRect, tolerancePx)
          && verticallyWithin(viewport, focusRect, tolerancePx)
        );
        const boundedOverflowAncestor = !horizontallyContained
          ? boundedHorizontalOverflowAncestor(
              activeElement,
              surface,
              focusRect,
              surfaceRect,
              viewport,
              tolerancePx
            )
          : null;
        focusPaintChecks.push({
          surfaceId,
          id: labelFor(activeElement),
          rect: focusRect,
          painted,
          horizontallyContained,
          verticallyContainedWhenPainted,
          boundedOverflowAncestor: boundedOverflowAncestor?.id || "",
          contained: !painted || (
            (horizontallyContained || Boolean(boundedOverflowAncestor))
            && verticallyContainedWhenPainted
          )
        });
      });
  }
  const escapedFocusPaint = focusPaintChecks.filter((check) => !check.contained);
  const overflowCandidates = new Set([
    ...selectAll(scope, "[data-layout-audit-overflow]"),
    ...surfaces
  ]);
  const overflow = [...overflowCandidates]
    .filter(visible)
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      const escapesViewport = (
        rect.left < -tolerancePx
        || rect.right > viewportWidth + tolerancePx
      ) && (element.matches(SURFACE_SELECTOR) || !containedHorizontalOverflow(element));
      const intrinsicOverflow = element.hasAttribute("data-layout-audit-overflow")
        && overflowAmount(element) > tolerancePx;
      return escapesViewport || intrinsicOverflow;
    })
    .map((element) => ({
      id: labelFor(element),
      rect: normalizedRect(element.getBoundingClientRect()),
      viewportWidth,
      overflowPx: overflowAmount(element)
    }));
  const undeclaredOverlays = selectAll(scope, OVERLAY_SELECTOR)
    .filter(visible)
    .filter((element) => !isDeclaredOverlay(element))
    .map((element) => labelFor(element));
  return Object.freeze({
    modelId: WORKSPACE_LAYOUT_AUDIT_MODEL,
    passed: collisions.length === 0
      && overflow.length === 0
      && documentOverflowPx <= tolerancePx
      && undeclaredOverlays.length === 0
      && escapedControls.length === 0
      && escapedFocusPaint.length === 0,
    containmentModelId: WORKSPACE_CONTROL_CONTAINMENT_MODEL,
    auditedSurfaceCount: surfaces.length,
    auditedControlCount: auditedControls.size,
    auditedSurfaceControlCount,
    boundedOverflowExemptions: Object.freeze(boundedOverflowExemptions),
    transientLayerExemptions: Object.freeze(transientLayerExemptions),
    escapedControls: Object.freeze(escapedControls),
    focusPaintChecks: Object.freeze(focusPaintChecks),
    escapedFocusPaint: Object.freeze(escapedFocusPaint),
    auditedHeadingCount: headings.length,
    auditedGroupCount: groups.size,
    auditedElementCount: new Set([...groups.values()].flat()).size,
    documentOverflowPx,
    collisions: Object.freeze(collisions),
    overflow: Object.freeze(overflow),
    undeclaredOverlays: Object.freeze(undeclaredOverlays)
  });
}
