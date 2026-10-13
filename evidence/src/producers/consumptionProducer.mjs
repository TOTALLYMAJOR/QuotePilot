// Operator-declared costs require exact private proof and explicit completeness.
// No date, phase, absent category, historic rate, or total substitutes for it.
import { actualsEvidenceEnvelope } from "../actualsProjection.mjs";

export function createConsumptionProducer({ readConsumption = null } = {}) {
  return {
    section: "actualConsumption",
    producerId: "actual-consumption-producer-v2",
    produce(context) {
      const recorded = readConsumption
        ? readConsumption(context.record, context)
        : context.source.actualsEvidence ?? context.source.actualsProof ?? null;
      return actualsEvidenceEnvelope(context, recorded);
    }
  };
}
