import CommercialScenarioWorkbench from "./CommercialScenarioWorkbench";

function focusInventoryEvidence() {
  if (typeof document === "undefined") return;
  const target = document.getElementById("commercial-twin-inventory-evidence");
  if (!target) return;
  const disclosure = target.closest("details");
  if (disclosure) disclosure.open = true;
  target.scrollIntoView?.({ behavior: "smooth", block: "start" });
  const control = target.querySelector("input, select, textarea, button, [tabindex]");
  control?.focus?.({ preventScroll: true });
}

/**
 * Compatibility boundary for the original Living Commercial Twin seam.
 * The rendered product is now the session-only Commercial Scenario Workbench;
 * commercial review/apply authority remains outside this component.
 */
export default function LivingCommercialTwin({
  scopeKey,
  onPreview,
  onRequestConsequences,
  onRetryConsequences,
  onReviewEvidence,
  onReviewForCommitment,
  onOpenInventory,
  inventoryEvidenceAvailable = false,
  ...props
}) {
  return (
    <CommercialScenarioWorkbench
      key={scopeKey}
      {...props}
      scopeKey={scopeKey}
      inventoryEvidenceAvailable={inventoryEvidenceAvailable}
      onRequestConsequences={onRequestConsequences || onPreview}
      onPreview={onPreview}
      onRetryConsequences={onRetryConsequences || onPreview}
      onReviewForCommitment={onReviewForCommitment || onReviewEvidence}
      onOpenInventory={onOpenInventory || (inventoryEvidenceAvailable ? focusInventoryEvidence : undefined)}
    />
  );
}
