export const AMBIENT_LEGACY_RETIREMENT_MODEL = "ambient-legacy-retirement-v1";

export const AMBIENT_LEGACY_RETIREMENT_ITEMS = Object.freeze([
  Object.freeze({
    id: "legacy-stepper",
    replacement: "Living Opportunity plus trusted quote editor",
    sourceState: "compatibility-retained",
    requiredEvidence: "authenticated staff parity and one accepted rollback-capable release"
  }),
  Object.freeze({
    id: "duplicated-modal-routes",
    replacement: "build-selected focused route modules",
    sourceState: "ambient-graph-retired",
    requiredEvidence: "compatibility graph build plus focused arrival-contract parity"
  }),
  Object.freeze({
    id: "command-center",
    replacement: "Now briefing",
    sourceState: "compatibility-retained",
    requiredEvidence: "Now coverage and authenticated staff acceptance"
  }),
  Object.freeze({
    id: "operations-switchboard",
    replacement: "calendar-first Operations route with Workspace tools reachability",
    sourceState: "ambient-graph-retired",
    requiredEvidence: "calendar-first route ownership and role-safe direct-route coverage",
    retirementCondition: "calendar-first-route-active-and-zero-runtime-consumers",
    capabilityDisposition: "live-routes-preserved"
  }),
  Object.freeze({
    id: "primary-quote-table",
    replacement: "Opportunities stream",
    sourceState: "fallback-disclosure-retained",
    requiredEvidence: "provider, payment, portal, booking, BEO, and lifecycle action parity"
  }),
  Object.freeze({
    id: "redundant-search-palette",
    replacement: "global context-aware Pilot",
    sourceState: "compatibility-retained",
    requiredEvidence: "navigation and query parity with keyboard acceptance"
  }),
  Object.freeze({
    id: "presentation-only-pilot-flags",
    replacement: "Ambient capability manifest",
    sourceState: "compatibility-retained",
    requiredEvidence: "approved Ambient promotion and exact previous-release rollback artifact"
  })
]);

function boolean(value) {
  return value === true;
}

export function assessAmbientLegacyRetirement({
  parityAccepted = false,
  rollbackArtifactVerified = false,
  releaseAccepted = false,
  productionPromotionApproved = false
} = {}) {
  const externalGatesPassed = [
    parityAccepted,
    rollbackArtifactVerified,
    releaseAccepted,
    productionPromotionApproved
  ].every(boolean);
  const items = AMBIENT_LEGACY_RETIREMENT_ITEMS.map((item) => Object.freeze({
    ...item,
    eligible: item.sourceState === "ambient-graph-retired" || externalGatesPassed,
    retirementState: item.sourceState === "ambient-graph-retired"
      ? "retired-from-ambient-graph"
      : externalGatesPassed
        ? "eligible-for-reviewed-removal"
        : "retained-for-safe-rollback"
  }));
  return Object.freeze({
    modelId: AMBIENT_LEGACY_RETIREMENT_MODEL,
    externalGatesPassed,
    retiredFromAmbientGraph: Object.freeze(items.filter(({ retirementState }) => retirementState === "retired-from-ambient-graph")),
    retained: Object.freeze(items.filter(({ retirementState }) => retirementState === "retained-for-safe-rollback")),
    items: Object.freeze(items),
    removalAuthorized: externalGatesPassed,
    summary: externalGatesPassed
      ? "The named legacy surfaces are eligible for a separately reviewed removal change."
      : "Compatibility implementations remain available until parity, rollback, release acceptance, and promotion approval are all evidenced."
  });
}
