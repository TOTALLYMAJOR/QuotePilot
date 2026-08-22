// Evidence coverage report.
//
// Answers one question per rule: of the evidence this rule needs, how much can
// we actually produce today, and for the rest, is the blocker engineering,
// integration, or a business decision nobody has made?
//
// It is computed two ways and both are reported:
//   * structural  -- from the contract alone, independent of any data. This is
//                    the honest ceiling: what could ever reconcile today.
//   * observed    -- from an actual bundle. This is what did reconcile.
// A structural ceiling below 100% means no amount of data fixes that rule.

import { AVAILABILITY } from "./availability.mjs";
import { evidenceContract } from "./schemaDrift.mjs";

const RESOLVING_STATES = new Set([AVAILABILITY.AVAILABLE, AVAILABILITY.NOT_APPLICABLE]);

function basisPoints(part, whole) {
  return whole ? Math.round((part * 10_000) / whole) : 0;
}

/** Coverage implied by the contract alone, with no bundle. */
export function structuralCoverage(contract = evidenceContract()) {
  const rules = Object.entries(contract.rules).map(([ruleId, rule]) => {
    const required = rule.requires;
    const blockers = required
      .map((section) => ({ section, ...contract.evidenceSections[section] }))
      .filter((section) => section.producible !== true)
      .map((section) => ({
        section: section.section,
        constraintClass: section.constraintClass,
        blockedBy: section.blockedBy || "",
        notes: section.notes
      }));
    const producible = required.length - blockers.length;
    return {
      ruleId,
      chainLink: rule.chainLink,
      requiredSections: [...required].sort(),
      producibleSections: producible,
      structurallyUnavailableSections: blockers.length,
      producibleBasisPoints: basisPoints(producible, required.length),
      canReachAVerdict: blockers.length === 0,
      blockers
    };
  });

  const reachable = rules.filter((rule) => rule.canReachAVerdict);
  const byConstraint = {};
  for (const rule of rules) {
    for (const blocker of rule.blockers) {
      byConstraint[blocker.constraintClass] ||= { rules: new Set(), sections: new Set() };
      byConstraint[blocker.constraintClass].rules.add(rule.ruleId);
      byConstraint[blocker.constraintClass].sections.add(blocker.section);
    }
  }

  return {
    contractVersion: contract.contractVersion,
    rulesTotal: rules.length,
    rulesReachable: reachable.length,
    rulesReachableBasisPoints: basisPoints(reachable.length, rules.length),
    // The ceiling on fullyReconciled: every rule must reach a verdict for a
    // record to be fully reconciled, so one structurally blocked rule caps the
    // whole reconciliation rate at zero.
    fullyReconcilableToday: reachable.length === rules.length,
    constraintSummary: Object.fromEntries(
      Object.entries(byConstraint)
        .map(([constraintClass, entry]) => [
          constraintClass,
          {
            blockedRules: [...entry.rules].sort(),
            blockedSections: [...entry.sections].sort()
          }
        ])
        .sort(([left], [right]) => left.localeCompare(right))
    ),
    rules: rules.sort((left, right) => left.ruleId.localeCompare(right.ruleId))
  };
}

/** Coverage actually observed in a bundle. */
export function observedCoverage(bundle, contract = evidenceContract()) {
  const records = Array.isArray(bundle?.records) ? bundle.records : [];
  const rules = Object.entries(contract.rules).map(([ruleId, rule]) => {
    const counts = { resolved: 0, blocked: 0 };
    const stateTally = {};
    for (const record of records) {
      const states = rule.requires.map(
        (section) => record?.evidence?.[section]?.availability || "missing"
      );
      for (const state of states) stateTally[state] = (stateTally[state] || 0) + 1;
      if (states.every((state) => RESOLVING_STATES.has(state))) counts.resolved += 1;
      else counts.blocked += 1;
    }
    return {
      ruleId,
      chainLink: rule.chainLink,
      recordsEvaluated: records.length,
      recordsWithCompleteEvidence: counts.resolved,
      recordsBlocked: counts.blocked,
      completeEvidenceBasisPoints: basisPoints(counts.resolved, records.length),
      availabilityTally: Object.fromEntries(
        Object.entries(stateTally).sort(([left], [right]) => left.localeCompare(right))
      )
    };
  });

  return {
    contractVersion: contract.contractVersion,
    recordsEvaluated: records.length,
    rules: rules.sort((left, right) => left.ruleId.localeCompare(right.ruleId))
  };
}

export function coverageReport(bundle, contract = evidenceContract()) {
  return {
    reportVersion: "truthloop-evidence-coverage-v1",
    evaluatedAtISO: bundle?.evaluatedAtISO || "",
    structural: structuralCoverage(contract),
    observed: observedCoverage(bundle, contract)
  };
}

export function renderCoverageText(report) {
  const lines = [];
  const structural = report.structural;
  lines.push(`Evidence coverage — contract ${structural.contractVersion}`);
  lines.push(
    `${structural.rulesReachable}/${structural.rulesTotal} rules can reach a verdict `
    + `today (${(structural.rulesReachableBasisPoints / 100).toFixed(2)}%)`
  );
  lines.push(
    structural.fullyReconcilableToday
      ? "A record can reach fullyReconciled today."
      : "No record can reach fullyReconciled today: at least one rule is structurally blocked."
  );
  lines.push("");
  lines.push("Structural blockers by constraint:");
  for (const [constraintClass, entry] of Object.entries(structural.constraintSummary)) {
    lines.push(
      `  ${constraintClass}: sections ${entry.blockedSections.join(", ")} `
      + `→ blocks ${entry.blockedRules.length} rule(s)`
    );
  }
  lines.push("");
  lines.push("Per rule:");
  const observedByRule = new Map(report.observed.rules.map((rule) => [rule.ruleId, rule]));
  for (const rule of structural.rules) {
    const observed = observedByRule.get(rule.ruleId);
    const producible = `${rule.producibleSections}/${rule.requiredSections.length}`;
    const detail = rule.canReachAVerdict
      ? "producible"
      : rule.blockers
          .map((blocker) => `${blocker.section} (${blocker.constraintClass})`)
          .join(", ");
    const observedPart = observed
      ? ` | observed ${observed.recordsWithCompleteEvidence}/${observed.recordsEvaluated} records`
      : "";
    lines.push(`  ${rule.ruleId}: ${producible} sections ${detail}${observedPart}`);
  }
  return `${lines.join("\n")}\n`;
}
