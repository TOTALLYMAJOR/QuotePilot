// Intercept only ordinary same-tab link activation. The caller remains the
// owner of route guards, dirty-draft review, return context, and navigation.
export function shouldHandleWorkspaceLink(event) {
  if (!event || event.defaultPrevented || event.button !== 0
    || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  const anchor = event.currentTarget;
  if (!anchor || anchor.hasAttribute("download")) return false;
  const target = anchor.getAttribute("target");
  return !target || target.toLowerCase() === "_self";
}
