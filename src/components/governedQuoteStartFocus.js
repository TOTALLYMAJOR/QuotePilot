function resolvedRoot(root) {
  if (root?.current) return root.current;
  if (root?.querySelector) return root;
  return typeof document === "undefined" ? null : document;
}

export function scheduleGovernedTemplateDestinationFocus({
  editorMode,
  root = null
} = {}) {
  if (typeof window === "undefined") return;
  window.requestAnimationFrame(() => {
    const surface = resolvedRoot(root);
    if (!surface) return;
    if (editorMode === "composer") {
      const domain = surface.querySelector('[data-testid="workbench-domain-commercials"]');
      if (domain?.getAttribute("aria-current") !== "step") domain?.click();
      window.requestAnimationFrame(() => {
        const field = resolvedRoot(root)?.querySelector("#proposal-event-template");
        const disclosure = field?.closest("details");
        if (disclosure && !disclosure.open) disclosure.querySelector("summary")?.click();
        window.requestAnimationFrame(() => {
          const currentField = resolvedRoot(root)?.querySelector("#proposal-event-template");
          currentField?.scrollIntoView?.({ behavior: "smooth", block: "center" });
          currentField?.focus?.({ preventScroll: true });
        });
      });
      return;
    }
    const trigger = surface.querySelector('[aria-controls="accordion-panel-advancedPricing"]');
    if (trigger?.getAttribute("aria-expanded") !== "true") trigger?.click();
    window.requestAnimationFrame(() => {
      const choice = resolvedRoot(root)?.querySelector(
        '[data-choice-field="event-template"] select, [data-choice-field="event-template"] button, [data-choice-field="event-template"] input'
      );
      choice?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      choice?.focus?.({ preventScroll: true });
    });
  });
}

export default scheduleGovernedTemplateDestinationFocus;
