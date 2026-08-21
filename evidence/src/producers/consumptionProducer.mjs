// Post-event actual consumption producer.
//
// Realized contribution and overrun detection both need what the event
// actually consumed in labor and purchasing. No capture surface and no schema
// exist for that today, so this producer distinguishes two honest answers:
//
//   * the event has not happened yet  -> not_applicable (nothing to record)
//   * the event has happened          -> missing, engineering constraint
//
// Those are different operator instructions. The first needs patience; the
// second needs a capture surface built.

import { available, missing, notApplicable } from "../availability.mjs";

function isSafeInteger(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * @param {object} options
 * @param {(record: object) => object|null} options.readConsumption
 */
export function createConsumptionProducer({ readConsumption = () => null } = {}) {
  return {
    section: "actualConsumption",
    producerId: "actual-consumption-producer-v1",
    produce(context) {
      if (!context.record.eventCompleted) {
        return notApplicable(
          context.provenanceFor("actualConsumption"),
          "The event has not been delivered, so there is nothing to consume yet."
        );
      }

      const recorded = readConsumption(context.record);
      if (!recorded) {
        return missing(
          context.provenanceFor("actualConsumption"),
          "The event is delivered but no labor or purchasing consumption has "
          + "been captured. No capture surface exists yet.",
          "engineering"
        );
      }

      const laborCostCents = recorded.laborCostCents ?? 0;
      const purchasingCostCents = recorded.purchasingCostCents ?? 0;
      const otherCostCents = recorded.otherCostCents ?? 0;
      const recordedAtISO = String(recorded.recordedAtISO || "").trim();

      if (
        !isSafeInteger(laborCostCents)
        || !isSafeInteger(purchasingCostCents)
        || !isSafeInteger(otherCostCents)
        || !recordedAtISO
      ) {
        return missing(
          context.provenanceFor("actualConsumption"),
          "Recorded consumption is not expressed in whole cents with a recorded "
          + "timestamp, so it cannot be compared to the planned cost basis.",
          "engineering"
        );
      }

      return available(
        { laborCostCents, purchasingCostCents, otherCostCents, recordedAtISO },
        context.provenanceFor("actualConsumption", { observedAtISO: recordedAtISO }),
        "Recorded post-event consumption."
      );
    }
  };
}
