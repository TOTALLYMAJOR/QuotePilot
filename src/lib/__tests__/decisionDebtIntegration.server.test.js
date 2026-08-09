import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const FUNCTIONS_SOURCE = readFileSync(
  new URL("../../../functions/index.js", import.meta.url),
  "utf8"
);

function sourceBetween(startMarker, endMarker) {
  const start = FUNCTIONS_SOURCE.indexOf(startMarker);
  const end = FUNCTIONS_SOURCE.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`Unable to locate source between ${startMarker} and ${endMarker}.`);
  }
  return FUNCTIONS_SOURCE.slice(start, end);
}

describe("Decision Debt persisted dependency integration", () => {
  test("derives debt only from bounded trusted unresolved dependency state", () => {
    const callable = sourceBetween(
      "exports.getDecisionDebtSnapshot =",
      "exports.configureDecisionDebtPolicy ="
    );

    expect(callable).toContain("COMMERCIAL_DEPENDENCY_STATE_COLLECTION");
    expect(callable).toContain('.where("openInvalidationCount", ">", 0).limit(101)');
    expect(callable).toContain("COMMERCIAL_CHANGE_INVALIDATION_LIMIT + 1");
    expect(callable).toContain("assertDecisionDebtDependencyState({");
    expect(callable).toContain("commercialChangeAuthority.validateApplyReceipt(");
    expect(callable).toContain("commercialChangeAuthority.validateSimulationReceipt(");
    expect(callable).toContain("decisionDebtAuthority.buildCandidatesFromInvalidations({");
    expect(callable).toContain("decisionDebtCommercialExposureCents(simulationReceipt)");
    expect(callable).not.toContain("productionChecklist");
    expect(callable).not.toContain("deriveArtifactStatus");
  });

  test("fails closed when state, quote, apply, simulation, counts, or bounds drift", () => {
    const validation = sourceBetween(
      "function assertDecisionDebtDependencyState",
      "function listMissingFields"
    );

    expect(validation).toContain('state?.authority === "server_authoritative"');
    expect(validation).toContain("invalidationSetComplete === true");
    expect(validation).toContain("COMMERCIAL_CHANGE_INVALIDATION_LIMIT");
    expect(validation).toContain("openInvalidationCount + resolvedInvalidationCount");
    expect(validation).toContain("item?.targetRevisionId");
    expect(validation).toContain("item?.applyReceiptId");
    expect(validation).toContain('"Decision Debt dependency evidence is incomplete or stale."');
  });
});
