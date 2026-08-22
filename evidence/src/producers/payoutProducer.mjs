// Processor payout settlement producer.
//
// This producer is deliberately inert.
//
// docs/STRIPE_CONNECT_PROGRAM.md stops the Connect program after authenticated
// hosted Sandbox UAT. Production connected-account creation, routing, charges,
// and settlement remain separately authorized. There is therefore no
// production payout store to read, and the correct output is an honest
// `blocked_by_integration` envelope naming that gate.
//
// It is intentionally easy to make this producer return data and intentionally
// impossible to do so by accident: a caller must pass a settlement source that
// declares itself authorized, and the guard below refuses anything else.

import { AVAILABILITY, blockedByIntegration, available, missing } from "../availability.mjs";

export const CONNECT_STOPPING_POINT = "stripe_connect_stopping_point";

export const PAYOUT_BLOCK_DETAIL =
  "No production processor settlement store exists. The Stripe Connect program "
  + "stops after hosted Sandbox UAT, so payout evidence cannot be produced or "
  + "simulated. See docs/STRIPE_CONNECT_PROGRAM.md.";

/**
 * @param {object} options
 * @param {object|null} options.settlementSource
 *   Reserved for the future settlement store. It must carry
 *   `authorized: true` and a `sourceObject`; anything else is refused. There is
 *   no such source today, so the default path is always blocked.
 */
export function createPayoutProducer({ settlementSource = null } = {}) {
  return {
    section: "payouts",
    producerId: "payout-settlement-producer-v1",
    produce(context) {
      if (!settlementSource) {
        return blockedByIntegration(
          context.provenanceFor("payouts"),
          CONNECT_STOPPING_POINT,
          PAYOUT_BLOCK_DETAIL
        );
      }
      if (settlementSource.authorized !== true || !settlementSource.sourceObject) {
        // A half-configured settlement source is more dangerous than none: it
        // would let unreviewed provider data reconcile real money.
        return blockedByIntegration(
          context.provenanceFor("payouts"),
          CONNECT_STOPPING_POINT,
          "A settlement source was supplied without explicit authorization and a "
          + "source object, so it was refused."
        );
      }

      const settlements = settlementSource.settlementsFor?.(context.record) ?? [];
      if (!settlements.length) {
        return missing(
          context.provenanceFor("payouts", {
            sourceObject: settlementSource.sourceObject
          }),
          "The authorized settlement source returned no payout for this record.",
          "integration"
        );
      }
      return available(
        settlements,
        context.provenanceFor("payouts", {
          sourceObject: settlementSource.sourceObject
        }),
        `${settlements.length} settlement record(s).`
      );
    }
  };
}

/** True when a bundle's payout envelope is the expected inert one. */
export function isPayoutBlocked(envelopeValue) {
  return envelopeValue?.availability === AVAILABILITY.BLOCKED_BY_INTEGRATION
    && envelopeValue?.blockedBy === CONNECT_STOPPING_POINT;
}
