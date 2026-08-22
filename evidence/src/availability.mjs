// Evidence availability vocabulary.
//
// The whole point of this module is that "we do not have it" is never one
// thing. A payout we cannot produce because Stripe Connect has not shipped is
// a different fact from a fee schedule nobody has declared, which is different
// again from consumption that will exist after the event. Collapsing them into
// null destroys the only signal that tells an operator whether the next move is
// engineering, integration, or a business decision.
//
// The vocabulary is defined once in docs/truthloop-evidence-contract.json and
// mirrored here as frozen constants so a typo fails fast.

export const AVAILABILITY = Object.freeze({
  AVAILABLE: "available",
  MISSING: "missing",
  NOT_APPLICABLE: "not_applicable",
  NOT_YET_AVAILABLE: "not_yet_available",
  BLOCKED_BY_INTEGRATION: "blocked_by_integration",
  CONTRADICTORY: "contradictory",
  SCHEMA_DRIFT: "schema_drift"
});

export const AVAILABILITY_STATES = Object.freeze(Object.values(AVAILABILITY));

export const CONSTRAINT_CLASS = Object.freeze({
  NONE: "none",
  ENGINEERING: "engineering",
  INTEGRATION: "integration",
  BUSINESS_POLICY: "business_policy"
});

export class EvidenceContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "EvidenceContractError";
  }
}

function assertAvailability(availability) {
  if (!AVAILABILITY_STATES.includes(availability)) {
    throw new EvidenceContractError(`Unknown availability state: ${availability}`);
  }
  return availability;
}

/**
 * Build one evidence envelope.
 *
 * Every section of every record is one of these, including the sections we
 * cannot produce. An envelope always carries provenance, even when it carries
 * no value: knowing which source we looked at and came up empty is itself
 * evidence.
 */
export function envelope({
  availability,
  value = null,
  provenance = null,
  detail = "",
  blockedBy = "",
  constraintClass = CONSTRAINT_CLASS.NONE,
  conflict = null
} = {}) {
  assertAvailability(availability);

  if (availability === AVAILABILITY.AVAILABLE && value === null) {
    throw new EvidenceContractError("An available envelope must carry a value.");
  }
  if (availability !== AVAILABILITY.AVAILABLE && value !== null) {
    throw new EvidenceContractError(
      `A ${availability} envelope must not carry a value; use conflict for disagreeing sources.`
    );
  }
  if (availability === AVAILABILITY.BLOCKED_BY_INTEGRATION && !blockedBy) {
    throw new EvidenceContractError(
      "A blocked_by_integration envelope must name what blocks it."
    );
  }
  if (availability === AVAILABILITY.CONTRADICTORY && !conflict) {
    throw new EvidenceContractError(
      "A contradictory envelope must carry the disagreeing values."
    );
  }

  const built = { availability, constraintClass };
  if (value !== null) built.value = value;
  if (detail) built.detail = detail;
  if (blockedBy) built.blockedBy = blockedBy;
  if (conflict) built.conflict = conflict;
  if (provenance) built.provenance = provenance;
  return built;
}

export const available = (value, provenance, detail = "") =>
  envelope({ availability: AVAILABILITY.AVAILABLE, value, provenance, detail });

export const missing = (provenance, detail, constraintClass = CONSTRAINT_CLASS.NONE) =>
  envelope({ availability: AVAILABILITY.MISSING, provenance, detail, constraintClass });

export const notApplicable = (provenance, detail) =>
  envelope({ availability: AVAILABILITY.NOT_APPLICABLE, provenance, detail });

export const notYetAvailable = (provenance, detail, constraintClass = CONSTRAINT_CLASS.NONE) =>
  envelope({
    availability: AVAILABILITY.NOT_YET_AVAILABLE,
    provenance,
    detail,
    constraintClass
  });

export const blockedByIntegration = (provenance, blockedBy, detail) =>
  envelope({
    availability: AVAILABILITY.BLOCKED_BY_INTEGRATION,
    provenance,
    blockedBy,
    detail,
    constraintClass: CONSTRAINT_CLASS.INTEGRATION
  });

export const contradictory = (provenance, conflict, detail) =>
  envelope({
    availability: AVAILABILITY.CONTRADICTORY,
    provenance,
    conflict,
    detail
  });

export const schemaDrift = (provenance, detail) =>
  envelope({
    availability: AVAILABILITY.SCHEMA_DRIFT,
    provenance,
    detail,
    constraintClass: CONSTRAINT_CLASS.ENGINEERING
  });
