function text(value) {
  return String(value ?? "").trim();
}

export function isCommercialSearchShortcut(event = {}, { allowEditable = false } = {}) {
  const targetTag = String(event.target?.tagName || "").toLowerCase();
  const editableTarget = Boolean(event.target?.isContentEditable)
    || ["input", "select", "textarea"].includes(targetTag);
  return !event.defaultPrevented
    && !event.isComposing
    && !event.repeat
    && (allowEditable || !editableTarget)
    && !event.altKey
    && !event.shiftKey
    && Boolean(event.metaKey || event.ctrlKey)
    && String(event.key || "").toLowerCase() === "k";
}

export function resolveCommercialSearchShortcutAction({
  event = {},
  paletteOpen = false,
  anotherModalOpen = false
} = {}) {
  if (anotherModalOpen) return "";
  if (paletteOpen && isCommercialSearchShortcut(event, { allowEditable: true })) {
    return "refocus";
  }
  if (!isCommercialSearchShortcut(event)) return "";
  return "open";
}

export function isCommercialSearchAvailable({
  enabled = false,
  isStaff = false,
  organizationId = "",
  portalMode = false,
  workspaceReady = false,
  isUnscopedPlatformOperator = false,
  isWorkspaceRoute = false
} = {}) {
  return enabled === true
    && isStaff === true
    && Boolean(text(organizationId))
    && portalMode !== true
    && workspaceReady === true
    && isUnscopedPlatformOperator !== true
    && isWorkspaceRoute === true;
}
