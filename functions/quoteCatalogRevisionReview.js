"use strict";

const { createHash } = require("node:crypto");

const QUOTE_CATALOG_REVIEW_SCHEMA_VERSION = 1;
const QUOTE_CATALOG_REVIEW_STATES = Object.freeze([
  "current",
  "newer_catalog_no_selected_impact",
  "review_required",
  "legacy_unknown",
  "unavailable"
]);
const QUOTE_CATALOG_REVIEW_OUTCOMES = Object.freeze(["keep_quoted_values", "review_and_update"]);
const TERMINAL_QUOTE_STATUSES = new Set([
  "accepted", "declined", "booked", "paid", "refunded", "cancelled", "expired", "void"
]);

class QuoteCatalogRevisionReviewError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "QuoteCatalogRevisionReviewError";
    this.code = code;
    this.details = details;
  }
}

function text(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function integer(value, fallback = null) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : fallback;
}

function moneyMajor(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric * 100) / 100 : null;
}

function storedMoney(data, minorKey, legacyKey) {
  if (Object.prototype.hasOwnProperty.call(record(data), minorKey)) {
    const minor = Number(data[minorKey]);
    return Number.isSafeInteger(minor) && minor >= 0 ? minor / 100 : null;
  }
  return moneyMajor(data?.[legacyKey]);
}

function active(data) {
  return data?.active !== false;
}

function mapCollection(entries = []) {
  return new Map((Array.isArray(entries) ? entries : []).map((entry) => {
    const data = record(entry?.data);
    return [text(entry?.id || data.id, 256), { id: text(entry?.id || data.id, 256), ...data }];
  }).filter(([id]) => Boolean(id)));
}

function selectedSnapshots(quote = {}) {
  const pricingSelection = record(quote.pricing?.inputs?.selection);
  const selection = record(quote.selection);
  const asArray = (value) => Array.isArray(value) ? value.filter((entry) => record(entry).id) : [];
  return {
    package: record(pricingSelection.package).id
      ? record(pricingSelection.package)
      : selection.packageId
        ? { id: selection.packageId, name: selection.packageName }
        : null,
    addons: asArray(pricingSelection.addons).length
      ? asArray(pricingSelection.addons)
      : asArray(selection.addonSnapshots),
    rentals: asArray(pricingSelection.rentals).length
      ? asArray(pricingSelection.rentals)
      : asArray(selection.rentalSnapshots),
    menuItems: asArray(pricingSelection.menuItems).length
      ? asArray(pricingSelection.menuItems)
      : asArray(selection.menuItemsSnapshot || selection.menuItemDetails)
  };
}

function addDiff(diffs, { category, recordId = "", label, field, quotedValue, currentValue, blocking = true }) {
  if (JSON.stringify(quotedValue) === JSON.stringify(currentValue)) return;
  diffs.push({
    id: `${category}:${recordId || "policy"}:${field}`,
    category,
    recordId,
    label,
    field,
    quotedValue: quotedValue ?? null,
    currentValue: currentValue ?? null,
    blocking
  });
}

function compareSelectedRecord(diffs, category, snapshot, current, { priceMinorKey = "priceMinor", priceLegacyKey = "price", quantityRule = false } = {}) {
  const id = text(snapshot?.id, 256);
  const label = text(snapshot?.name || current?.name || id, 240) || "Selected item";
  if (!current) {
    addDiff(diffs, { category, recordId: id, label, field: "availability", quotedValue: "selected", currentValue: "missing" });
    return;
  }
  addDiff(diffs, { category, recordId: id, label, field: "name", quotedValue: text(snapshot?.name), currentValue: text(current.name) });
  addDiff(diffs, { category, recordId: id, label, field: "availability", quotedValue: true, currentValue: active(current) });
  if (category !== "package") {
    addDiff(diffs, {
      category,
      recordId: id,
      label,
      field: "price_basis",
      quotedValue: text(snapshot?.pricingType || snapshot?.type),
      currentValue: text(current.pricingType || current.type)
    });
  }
  addDiff(diffs, {
    category,
    recordId: id,
    label,
    field: "price",
    quotedValue: moneyMajor(snapshot?.price ?? snapshot?.ppp),
    currentValue: storedMoney(current, priceMinorKey, priceLegacyKey)
  });
  if (quantityRule) {
    addDiff(diffs, {
      category,
      recordId: id,
      label,
      field: "quantity_rule",
      quotedValue: Number(snapshot?.qtyPerGuests || 1),
      currentValue: Number(current.qtyPerGuests || 1)
    });
  }
}

function confirmationCurrent(settings = {}) {
  const revision = integer(settings.catalogRevision);
  const confirmation = record(settings.pricingConfirmation);
  return settings.pricingSetupConfirmed === true
    && revision !== null
    && integer(confirmation.confirmedCatalogRevision) === revision
    && Boolean(text(confirmation.actorUid))
    && Boolean(text(confirmation.actorEmail))
    && Boolean(text(confirmation.confirmedAtISO));
}

function rateProvenanceLabel({ override = null, quoteAuthority = null, currentRevision = null } = {}) {
  if (override !== null && override !== "" && override !== undefined) return "Quote override";
  const quotedRevision = integer(quoteAuthority?.catalogRevision);
  if (quotedRevision !== null && quotedRevision === integer(currentRevision)) return "Current catalog rate";
  if (quotedRevision !== null) return `Quoted at catalog revision ${quotedRevision}`;
  return "Saved rate — source revision unavailable";
}

function buildQuoteCatalogRevisionReview({
  organizationId = "",
  quoteId = "",
  quote = {},
  settings = {},
  collections = {},
  observedAtISO = ""
} = {}) {
  const orgId = text(organizationId, 160);
  const id = text(quoteId || quote.id, 256);
  if (!orgId || !id || text(quote.organizationId, 160) !== orgId) {
    throw new QuoteCatalogRevisionReviewError("permission-denied", "Quote revision review requires one same-organization quote.");
  }
  const authority = record(quote.pricingCatalogAuthority);
  const quotedRevision = integer(authority.catalogRevision);
  const currentRevision = integer(settings.catalogRevision);
  const activeVersionId = text(quote.activeVersionId || quote.versionMeta?.versionId, 256);
  const terminal = TERMINAL_QUOTE_STATUSES.has(text(quote.status, 40).toLowerCase());
  const base = {
    schemaVersion: QUOTE_CATALOG_REVIEW_SCHEMA_VERSION,
    organizationId: orgId,
    quoteId: id,
    quoteVersionId: activeVersionId,
    quoteStatus: text(quote.status, 40).toLowerCase() || "draft",
    terminal,
    quotedCatalogRevision: quotedRevision,
    currentCatalogRevision: currentRevision,
    evidenceAt: text(observedAtISO || settings.pricingConfirmation?.confirmedAtISO),
    nextAction: null,
    diffs: [],
    rateProvenance: {}
  };
  if (quotedRevision === null || !text(authority.settingsFingerprintSha256)) {
    return {
      ...base,
      state: "legacy_unknown",
      reasonCode: "legacy_revision_unknown",
      headline: "Legacy revision unknown",
      blocking: true,
      nextAction: terminal
        ? { route: `opportunities/${id}`, label: "Duplicate or reopen quote" }
        : { route: `opportunities/${id}/edit`, label: "Review with current catalog" },
      rateProvenance: {
        server: rateProvenanceLabel({ override: quote.selection?.serverRateOverride }),
        chef: rateProvenanceLabel({ override: quote.selection?.chefRateOverride }),
        bartender: rateProvenanceLabel({ override: quote.selection?.bartenderRateOverride })
      }
    };
  }
  if (!confirmationCurrent(settings) || currentRevision === null) {
    return {
      ...base,
      state: "unavailable",
      reasonCode: "current_catalog_authority_unavailable",
      headline: "Catalog revision review unavailable",
      blocking: true,
      nextAction: { route: "library", label: "Review catalog pricing" }
    };
  }

  const currentFingerprint = text(settings.settingsFingerprintSha256);
  if (quotedRevision === currentRevision && (!currentFingerprint || currentFingerprint === text(authority.settingsFingerprintSha256))) {
    return {
      ...base,
      state: "current",
      reasonCode: "catalog_revision_current",
      headline: `Current at catalog revision ${currentRevision}`,
      blocking: false,
      nextAction: { route: `opportunities/${id}`, label: "Continue quote" },
      rateProvenance: {
        server: rateProvenanceLabel({ override: quote.selection?.serverRateOverride, quoteAuthority: authority, currentRevision }),
        chef: rateProvenanceLabel({ override: quote.selection?.chefRateOverride, quoteAuthority: authority, currentRevision }),
        bartender: rateProvenanceLabel({ override: quote.selection?.bartenderRateOverride, quoteAuthority: authority, currentRevision })
      }
    };
  }

  const diffs = [];
  const selected = selectedSnapshots(quote);
  const maps = {
    package: mapCollection(collections.catalogPackages),
    addon: mapCollection(collections.catalogAddons),
    rental: mapCollection(collections.catalogRentals),
    menu_item: mapCollection(collections.menuItems)
  };
  if (selected.package?.id) compareSelectedRecord(diffs, "package", selected.package, maps.package.get(text(selected.package.id)), { priceMinorKey: "pppMinor", priceLegacyKey: "ppp" });
  selected.addons.forEach((item) => compareSelectedRecord(diffs, "addon", item, maps.addon.get(text(item.id))));
  selected.rentals.forEach((item) => compareSelectedRecord(diffs, "rental", item, maps.rental.get(text(item.id)), { quantityRule: true }));
  selected.menuItems.forEach((item) => compareSelectedRecord(diffs, "menu_item", item, maps.menu_item.get(text(item.id))));

  const savedRates = record(quote.selection?.laborRateSnapshot);
  const savedRules = record(quote.pricing?.rulesSnapshot);
  addDiff(diffs, { category: "staffing", label: "Server rate", field: "server_rate", quotedValue: moneyMajor(savedRates.serverRateApplied), currentValue: storedMoney(settings, "serverRateMinor", "serverRate") });
  addDiff(diffs, { category: "staffing", label: "Chef rate", field: "chef_rate", quotedValue: moneyMajor(savedRates.chefRateApplied), currentValue: storedMoney(settings, "chefRateMinor", "chefRate") });
  addDiff(diffs, { category: "staffing", label: "Bartender rate", field: "bartender_rate", quotedValue: moneyMajor(savedRates.bartenderRateApplied), currentValue: storedMoney(settings, "bartenderRateMinor", "bartenderRate") });
  addDiff(diffs, { category: "staffing", label: "Staffing charge mode", field: "staffing_charge_mode", quotedValue: text(savedRules.staffingChargeMode), currentValue: text(settings.staffingChargeMode) });

  const state = diffs.length ? "review_required" : "newer_catalog_no_selected_impact";
  const provenance = {
    server: rateProvenanceLabel({ override: quote.selection?.serverRateOverride, quoteAuthority: authority, currentRevision }),
    chef: rateProvenanceLabel({ override: quote.selection?.chefRateOverride, quoteAuthority: authority, currentRevision }),
    bartender: rateProvenanceLabel({ override: quote.selection?.bartenderRateOverride, quoteAuthority: authority, currentRevision })
  };
  return {
    ...base,
    state,
    reasonCode: diffs.length ? "selected_commercial_inputs_changed" : "catalog_changed_without_selected_impact",
    headline: diffs.length ? `${diffs.length} catalog change${diffs.length === 1 ? "" : "s"} need review` : "Newer catalog has no selected impact",
    blocking: diffs.length > 0,
    diffs,
    rateProvenance: provenance,
    nextAction: terminal
      ? { route: `opportunities/${id}`, label: "Duplicate or reopen quote" }
      : diffs.length
        ? { route: `opportunities/${id}/catalog-review`, label: "Review catalog changes" }
        : { route: `opportunities/${id}`, label: "Continue quote" }
  };
}

function normalizeReviewOutcome(value) {
  const outcome = text(value, 80).toLowerCase();
  if (!QUOTE_CATALOG_REVIEW_OUTCOMES.includes(outcome)) {
    throw new QuoteCatalogRevisionReviewError("invalid-argument", "Choose Keep quoted values or Review and update.");
  }
  return outcome;
}

function buildQuoteCatalogReviewReceipt({ review, outcome, requestId, actor, recordedAtISO } = {}) {
  const normalizedOutcome = normalizeReviewOutcome(outcome);
  const receiptId = text(requestId, 128);
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(receiptId) || !text(actor?.uid) || !text(actor?.email)) {
    throw new QuoteCatalogRevisionReviewError("invalid-argument", "A stable request id and attributed actor are required.");
  }
  if (review?.terminal) {
    throw new QuoteCatalogRevisionReviewError("failed-precondition", "Terminal quotes are immutable. Duplicate or reopen the quote instead.");
  }
  if (review?.state === "unavailable") {
    throw new QuoteCatalogRevisionReviewError("failed-precondition", "Catalog authority is unavailable for this review outcome.");
  }
  const receipt = {
    schemaVersion: QUOTE_CATALOG_REVIEW_SCHEMA_VERSION,
    receiptId,
    organizationId: text(review?.organizationId, 160),
    quoteId: text(review?.quoteId, 256),
    quoteVersionId: text(review?.quoteVersionId, 256),
    quotedCatalogRevision: integer(review?.quotedCatalogRevision),
    reviewedCatalogRevision: integer(review?.currentCatalogRevision),
    reviewState: text(review?.state, 80),
    outcome: normalizedOutcome,
    freezesCommercialInputs: normalizedOutcome === "keep_quoted_values",
    requiresGovernedCurrentCatalogSimulation: normalizedOutcome === "review_and_update",
    diffDigestSha256: createHash("sha256").update(JSON.stringify(review?.diffs || [])).digest("hex"),
    recordedAtISO: text(recordedAtISO),
    recordedBy: { uid: text(actor.uid, 160), email: text(actor.email, 320).toLowerCase(), role: text(actor.role, 40) }
  };
  return Object.freeze(receipt);
}

module.exports = {
  QUOTE_CATALOG_REVIEW_OUTCOMES,
  QUOTE_CATALOG_REVIEW_SCHEMA_VERSION,
  QUOTE_CATALOG_REVIEW_STATES,
  QuoteCatalogRevisionReviewError,
  buildQuoteCatalogRevisionReview,
  buildQuoteCatalogReviewReceipt,
  rateProvenanceLabel
};
