// Declared processor fee schedule producer.
//
// The reconciler will explain a payout gap only against a schedule the
// organization has declared. This producer reads that declaration and does
// nothing else. It never derives a rate from observed payouts, and it never
// falls back to a published card rate, because a rate QuotePilot chose is not
// a rate the operator authorized.
//
// No organization settings field exists yet, so the ordinary result today is
// `missing` with a business-policy constraint: the blocker is a decision
// nobody has made, not code nobody has written.

import { available, contradictory, missing } from "../availability.mjs";

const SETTINGS_FIELD = "settings.processorFeeSchedule";

function isSafeInteger(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * @param {object} options
 * @param {(organizationId: string) => object|null} options.readOrganizationSettings
 */
export function createFeeScheduleProducer({ readOrganizationSettings = () => null } = {}) {
  return {
    section: "processorFeeSchedule",
    producerId: "declared-fee-schedule-producer-v1",
    produce(context) {
      const settings = readOrganizationSettings(context.record.organizationId);
      const declared = settings?.processorFeeSchedule ?? null;

      if (!declared) {
        return missing(
          context.provenanceFor("processorFeeSchedule", {
            sourceField: SETTINGS_FIELD
          }),
          "No organization has declared a processor fee schedule. A payout "
          + "difference cannot be explained without one, and this producer will "
          + "not infer a rate from history.",
          "business_policy"
        );
      }

      const percentBasisPoints = declared.percentBasisPoints;
      const fixedCents = declared.fixedCents;
      const declaredAtISO = String(declared.declaredAtISO || "").trim();
      const declaredBy = String(declared.declaredBy || "").trim();

      if (!declaredAtISO || !declaredBy) {
        // An undated or unattributed policy value is not a declaration.
        return missing(
          context.provenanceFor("processorFeeSchedule", {
            sourceField: SETTINGS_FIELD
          }),
          "A fee schedule is present but carries no declaring actor and "
          + "timestamp, so it is not an operator declaration.",
          "business_policy"
        );
      }
      if (!isSafeInteger(percentBasisPoints) || !isSafeInteger(fixedCents)) {
        return contradictory(
          context.provenanceFor("processorFeeSchedule", {
            sourceField: SETTINGS_FIELD
          }),
          { declared },
          "The declared fee schedule is not expressed in whole basis points and "
          + "whole cents, so it cannot be applied exactly."
        );
      }

      return available(
        {
          percentBasisPoints,
          fixedCents,
          toleranceCents: isSafeInteger(declared.toleranceCents)
            ? declared.toleranceCents
            : 0,
          declaredBy,
          declaredAtISO,
          label: String(declared.label || "").trim()
        },
        context.provenanceFor("processorFeeSchedule", {
          sourceField: SETTINGS_FIELD,
          observedAtISO: declaredAtISO
        }),
        `Declared by ${declaredBy}.`
      );
    }
  };
}
