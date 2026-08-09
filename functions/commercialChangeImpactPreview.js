"use strict";

const { createHash } = require("node:crypto");

const SNAPSHOT_SCHEMA_VERSION = "commercial-change-impact-snapshot-v1";
const AUTHORITY = "server_authoritative";
const SOURCE_LABELS = Object.freeze({
  before: "canonical_quote_revision",
  proposedAfter: "authoritative_proposed_revision",
  beforePricing: "canonical_pricing_snapshot",
  proposedAfterPricing: "authoritative_pricing_preview"
});
const MAX_PREVIEW_BYTES = 262_144;

class CommercialChangeImpactPreviewError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CommercialChangeImpactPreviewError";
    this.code = code;
  }
}

function text(value) {
  return String(value ?? "").trim();
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function opaqueId(value, label) {
  const normalized = text(value);
  if (
    !normalized
    || normalized.length > 256
    || /[\s/?#\\\u0000]/u.test(normalized)
    || normalized === "."
    || normalized === ".."
    || /^[^@\s]+@[^@\s]+$/.test(normalized)
  ) {
    throw new CommercialChangeImpactPreviewError("invalid-argument", `${label} is invalid.`);
  }
  return normalized;
}

function finiteMoney(value, label) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000_000) {
    throw new CommercialChangeImpactPreviewError(
      "failed-precondition",
      `${label} is unavailable from authoritative pricing.`
    );
  }
  return amount;
}

function stableValue(value, depth = 0) {
  if (depth > 12) {
    throw new CommercialChangeImpactPreviewError("resource-exhausted", "Change-impact input is too deeply nested.");
  }
  if (value === null || ["string", "boolean"].includes(typeof value)) return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new CommercialChangeImpactPreviewError("failed-precondition", "Change-impact input contains an invalid number.");
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => stableValue(item, depth + 1));
  if (!isRecord(value)) return null;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key], depth + 1)])
  );
}

function stableSerialize(value) {
  return JSON.stringify(stableValue(value));
}

function exactISO(value) {
  const normalized = text(value);
  if (!normalized) return "";
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function selectionInput(pricing, key, fallback = null) {
  const selection = isRecord(pricing?.inputs?.selection) ? pricing.inputs.selection : {};
  const value = selection[key];
  if (Array.isArray(value)) return stableValue(value.slice(0, 250));
  if (isRecord(value)) return stableValue(value);
  return fallback;
}

function eventFacts({ quote, form, proposed }) {
  const event = proposed ? form : (isRecord(quote.event) ? quote.event : {});
  return {
    "fact.event.date": text(event.date) || null,
    "fact.event.dietary_constraints": text(event.dietaryRestrictions) || null,
    "fact.event.duration": Number.isFinite(Number(event.hours)) ? Number(event.hours) : null,
    "fact.event.guest_count": Number.isFinite(Number(event.guests)) ? Number(event.guests) : null,
    "fact.event.name": text(event.eventName || event.name) || null,
    "fact.event.service_style": text(event.style) || null,
    "fact.event.time": text(event.time) || null,
    "fact.event.venue": {
      name: text(event.venue) || null,
      address: text(event.venueAddress) || null
    }
  };
}

function pricingFacts(pricing) {
  const rules = isRecord(pricing.rulesSnapshot) ? pricing.rulesSnapshot : {};
  const pricingEvent = isRecord(pricing.inputs?.event) ? pricing.inputs.event : {};
  return {
    "fact.pricing.catalog_snapshot": {
      pricingVersion: text(pricing.pricingVersion) || null,
      pricingSettingsVersion: Number.isFinite(Number(rules.pricingSettingsVersion))
        ? Number(rules.pricingSettingsVersion)
        : null,
      selectedLineItems: (Array.isArray(pricing.lineItems) ? pricing.lineItems : [])
        .slice(0, 500)
        .map((item) => ({
          id: text(item?.id) || null,
          category: text(item?.category) || null,
          pricingMode: text(item?.pricingMode) || null,
          unitPrice: Number.isFinite(Number(item?.unitPrice)) ? Number(item.unitPrice) : null,
          quantity: Number.isFinite(Number(item?.quantity)) ? Number(item.quantity) : null
        }))
    },
    "fact.pricing.season_profile": {
      id: text(rules.seasonProfileId || pricingEvent.seasonProfileId) || null,
      multiplier: Number.isFinite(Number(rules.packageMultiplier))
        ? Number(rules.packageMultiplier)
        : null
    },
    "fact.pricing.settings_snapshot": stableValue(isRecord(rules.settingsSnapshot)
      ? rules.settingsSnapshot
      : {
        pricingSettingsVersion: rules.pricingSettingsVersion ?? null,
        pricingSettingsUpdatedAtISO: exactISO(rules.pricingSettingsUpdatedAtISO) || null
      }),
    "fact.pricing.tax_region": {
      id: text(rules.taxRegionId || pricingEvent.taxRegionId) || null,
      rate: Number.isFinite(Number(rules.taxRateApplied)) ? Number(rules.taxRateApplied) : null
    },
    "fact.pricing.travel": stableValue(isRecord(rules.travel)
      ? rules.travel
      : { milesRT: Number.isFinite(Number(pricingEvent.milesRT)) ? Number(pricingEvent.milesRT) : null })
  };
}

function operationalFacts(quote) {
  const operations = isRecord(quote.operations) ? quote.operations : {};
  const kitchen = isRecord(quote.kitchen) ? quote.kitchen : {};
  const booking = isRecord(quote.booking) ? quote.booking : {};
  const payment = isRecord(quote.payment) ? quote.payment : {};
  return {
    "fact.customer.day_of_contact": null,
    "fact.organization.day_of_contact": null,
    "fact.operations.checkpoint_overrides": stableValue(
      operations.checkpointOverrides || kitchen.checkpointOverrides || []
    ),
    "fact.operations.production_checklist": stableValue(
      operations.productionChecklist || kitchen.productionChecklist || []
    ),
    "fact.operations.staff_lead": text(
      booking.staffLead || operations.staffLead || kitchen.staffLead
    ) || null,
    "fact.payment.verified_deposit_state": {
      status: text(payment.depositStatus).toLowerCase() || null,
      paidAtISO: exactISO(payment.depositPaidAtISO || payment.paidAtISO) || null,
      refundedAtISO: exactISO(payment.depositRefundedAtISO || payment.refundedAtISO) || null
    }
  };
}

function acceptedRevision(quote) {
  const receiptRevision = text(quote.acceptanceReceipt?.quoteRevisionId);
  if (receiptRevision.includes("@")) return receiptRevision.slice(0, receiptRevision.indexOf("@"));
  return receiptRevision || text(quote.acceptedVersionId) || null;
}

function buildFacts({ organizationId, quoteId, quote, form, pricing, revisionId, proposed }) {
  const pricingEvent = isRecord(pricing.inputs?.event) ? pricing.inputs.event : {};
  const event = proposed ? form : (isRecord(quote.event) ? quote.event : {});
  return {
    ...eventFacts({ quote, form, proposed }),
    ...operationalFacts(quote),
    ...pricingFacts(pricing),
    "fact.quote.accepted_revision": acceptedRevision(quote),
    "fact.quote.active_revision": revisionId,
    "fact.quote.identity": { organizationId, quoteId },
    "fact.selection.addons": selectionInput(pricing, "addons", []),
    "fact.selection.menu": selectionInput(pricing, "menuItems", []),
    "fact.selection.package": selectionInput(pricing, "package", null),
    "fact.selection.rentals": selectionInput(pricing, "rentals", []),
    "fact.staffing.counts": {
      servers: Number.isFinite(Number(event.servers ?? pricingEvent.servers))
        ? Number(event.servers ?? pricingEvent.servers)
        : null,
      chefs: Number.isFinite(Number(event.chefs ?? pricingEvent.chefs))
        ? Number(event.chefs ?? pricingEvent.chefs)
        : null,
      bartenders: Number.isFinite(Number(event.bartenders ?? pricingEvent.bartenders))
        ? Number(event.bartenders ?? pricingEvent.bartenders)
        : null
    }
  };
}

function protectedEvidence(quote) {
  const lifecycle = isRecord(quote.lifecycle) ? quote.lifecycle : {};
  const payment = isRecord(quote.payment) ? quote.payment : {};
  const booking = isRecord(quote.booking) ? quote.booking : {};
  const delivery = isRecord(quote.workflow?.quoteDelivery) ? quote.workflow.quoteDelivery : {};
  const acceptance = isRecord(quote.acceptanceReceipt) ? quote.acceptanceReceipt : {};
  return stableValue({
    lifecycle: {
      status: text(quote.status).toLowerCase() || null,
      acceptedAtISO: exactISO(lifecycle.acceptedAtISO || acceptance.acceptedAtISO) || null,
      declinedAtISO: exactISO(lifecycle.declinedAtISO) || null
    },
    provider: {
      state: text(delivery.state).toLowerCase() || null,
      revisionId: text(delivery.revisionId) || null,
      providerAcceptedAtISO: exactISO(delivery.providerAcceptedAtISO) || null
    },
    payment: {
      depositStatus: text(payment.depositStatus).toLowerCase() || null,
      finalBalanceStatus: text(payment.finalBalance?.status).toLowerCase() || null,
      depositPaidAtISO: exactISO(payment.depositPaidAtISO || payment.paidAtISO) || null,
      finalBalancePaidAtISO: exactISO(payment.finalBalance?.paidAtISO) || null
    },
    portal: {
      activeVersionId: text(quote.activeVersionId) || null,
      issuedAtISO: exactISO(quote.portalIssuedAtISO) || null,
      acceptanceReceiptId: text(acceptance.receiptId) || null,
      acceptedRevisionId: text(acceptance.quoteRevisionId) || null
    },
    booking: {
      contractNumber: text(booking.contractNumber) || null,
      convertedAtISO: exactISO(booking.contractConvertedAtISO) || null,
      confirmationStatus: text(booking.confirmationStatus).toLowerCase() || null
    }
  });
}

function buildSnapshot({ role, organizationId, quoteId, revisionId, facts, pricing, evidence }) {
  const before = role === "before";
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    source: {
      label: before ? SOURCE_LABELS.before : SOURCE_LABELS.proposedAfter,
      authority: AUTHORITY,
      organizationId,
      quoteId,
      revisionId
    },
    facts,
    pricing: {
      sourceLabel: before ? SOURCE_LABELS.beforePricing : SOURCE_LABELS.proposedAfterPricing,
      authority: AUTHORITY,
      currency: "USD",
      authoritativeTotal: finiteMoney(pricing.grandTotal, `${role} total`),
      depositRequirement: finiteMoney(pricing.deposit?.amount, `${role} deposit`)
    },
    protectedEvidence: evidence
  };
}

function buildCommercialChangeImpactPreviewSnapshots({
  organizationId,
  quoteId,
  expectedActiveVersionId,
  currentQuote,
  proposedForm,
  proposedPricing
} = {}) {
  const orgId = opaqueId(organizationId, "organizationId");
  const id = opaqueId(quoteId, "quoteId");
  const quote = isRecord(currentQuote) ? currentQuote : {};
  const form = isRecord(proposedForm) ? proposedForm : {};
  const beforePricing = isRecord(quote.pricing) ? quote.pricing : {};
  const afterPricing = isRecord(proposedPricing) ? proposedPricing : {};
  const beforeRevisionId = opaqueId(
    quote.activeVersionId || quote.versionMeta?.versionId,
    "before revisionId"
  );
  const expectedRevisionId = opaqueId(
    expectedActiveVersionId,
    "expected active revisionId"
  );
  if (text(quote.organizationId) !== orgId) {
    throw new CommercialChangeImpactPreviewError("permission-denied", "Quote is outside this organization.");
  }
  if (beforeRevisionId !== expectedRevisionId) {
    throw new CommercialChangeImpactPreviewError(
      "aborted",
      "The canonical quote revision changed while the impact preview was being prepared. Reload and retry."
    );
  }
  if (beforePricing.authority !== AUTHORITY || afterPricing.authority !== AUTHORITY) {
    throw new CommercialChangeImpactPreviewError(
      "failed-precondition",
      "Both change-impact pricing snapshots must be server authoritative."
    );
  }
  const proposedInputs = isRecord(afterPricing.inputs) ? afterPricing.inputs : {};
  const stableProposedInputs = Object.fromEntries(
    Object.entries(proposedInputs).filter(([key]) => !["actor", "metadata"].includes(key))
  );
  const proposalKey = stableSerialize({
    organizationId: orgId,
    quoteId: id,
    beforeRevisionId,
    form,
    pricing: {
      pricingVersion: afterPricing.pricingVersion,
      grandTotal: afterPricing.grandTotal,
      deposit: afterPricing.deposit,
      inputs: stableProposedInputs,
      rulesSnapshot: afterPricing.rulesSnapshot
    }
  });
  const proposedRevisionId = `preview_${createHash("sha256").update(proposalKey).digest("hex").slice(0, 48)}`;
  const evidence = protectedEvidence(quote);
  const beforeSnapshot = buildSnapshot({
    role: "before",
    organizationId: orgId,
    quoteId: id,
    revisionId: beforeRevisionId,
    facts: buildFacts({
      organizationId: orgId,
      quoteId: id,
      quote,
      form,
      pricing: beforePricing,
      revisionId: beforeRevisionId,
      proposed: false
    }),
    pricing: beforePricing,
    evidence
  });
  const proposedAfterSnapshot = buildSnapshot({
    role: "proposedAfter",
    organizationId: orgId,
    quoteId: id,
    revisionId: proposedRevisionId,
    facts: buildFacts({
      organizationId: orgId,
      quoteId: id,
      quote,
      form,
      pricing: afterPricing,
      // A preview has its own deterministic request identity, but it has not
      // activated a quote revision. Keep the canonical active-revision fact
      // unchanged so a no-op edit does not manufacture artifact staleness.
      revisionId: beforeRevisionId,
      proposed: true
    }),
    pricing: afterPricing,
    evidence
  });
  const result = {
    identity: {
      organizationId: orgId,
      quoteId: id,
      beforeRevisionId,
      proposedRevisionId
    },
    beforeSnapshot,
    proposedAfterSnapshot
  };
  if (Buffer.byteLength(stableSerialize(result), "utf8") > MAX_PREVIEW_BYTES) {
    throw new CommercialChangeImpactPreviewError(
      "resource-exhausted",
      "The bounded change-impact preview is too large."
    );
  }
  return result;
}

module.exports = {
  AUTHORITY,
  CommercialChangeImpactPreviewError,
  MAX_PREVIEW_BYTES,
  SNAPSHOT_SCHEMA_VERSION,
  SOURCE_LABELS,
  buildCommercialChangeImpactPreviewSnapshots
};
