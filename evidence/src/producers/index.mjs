// Producer interfaces.
//
// A producer answers one question: "can you supply this evidence section for
// this record, and if not, precisely why not?" Every producer returns an
// envelope, never a throw and never a null, so an absent producer is as
// legible as a present one.
//
// A producer that cannot answer honestly must return an unavailable envelope.
// Fabricating evidence to make a record reconcile is the single failure this
// whole tier exists to prevent.

/**
 * @typedef {object} Producer
 * @property {string} section        Evidence section this producer supplies.
 * @property {string} producerId     Stable identifier for provenance.
 * @property {(context: object) => object} produce  Returns an evidence envelope.
 */

/** Wrap a producer so a thrown error becomes a legible `missing` envelope. */
export function guarded(producer, { missing }) {
  return {
    section: producer.section,
    producerId: producer.producerId,
    produce(context) {
      try {
        return producer.produce(context);
      } catch (error) {
        // A producer failure is a data-supply fact, not a crash. The record
        // stays unverifiable and names the producer that failed.
        return missing(
          context.provenanceFor(producer.section, { derivation: producer.producerId }),
          `Producer ${producer.producerId} failed: ${error?.message || error}`,
          "engineering"
        );
      }
    }
  };
}

export function producerRegistry(producers) {
  const bySection = new Map();
  for (const producer of producers) {
    if (bySection.has(producer.section)) {
      throw new Error(`Duplicate producer for section ${producer.section}.`);
    }
    bySection.set(producer.section, producer);
  }
  return {
    has: (section) => bySection.has(section),
    get: (section) => bySection.get(section) || null,
    sections: () => [...bySection.keys()].sort(),
    list: () => [...bySection.values()]
  };
}
