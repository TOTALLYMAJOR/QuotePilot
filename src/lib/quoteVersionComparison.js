export const QUOTE_VERSION_COMPARISON_SCHEMA_VERSION = "quote-version-comparison-v1";

export const QUOTE_VERSION_COMPARISON_EVIDENCE_BOUNDARY =
  "Advisory comparison of stored immutable version fields only. It does not recalculate pricing or establish proposal acceptance, delivery, payment, booking, provider, or operational truth.";

export const QUOTE_VERSION_VALUE_STATES = Object.freeze({
  KNOWN: "known",
  UNKNOWN: "unknown",
  UNAVAILABLE: "unavailable"
});

export const QUOTE_VERSION_CHANGE_STATES = Object.freeze({
  CHANGED: "changed",
  UNCHANGED: "unchanged",
  UNKNOWN: "unknown",
  UNAVAILABLE: "unavailable"
});

const SECTION_DEFINITIONS = [
  {
    id: "scope",
    label: "Scope",
    fields: [
      field("scope.customerName", "Customer name", "text", ["snapshot.customer.name"]),
      field("scope.customerOrganization", "Customer organization", "text", ["snapshot.customer.organization"]),
      field("scope.customerEmail", "Customer email", "text", ["snapshot.customer.email"]),
      field("scope.customerPhone", "Customer phone", "text", ["snapshot.customer.phone"]),
      field("scope.eventName", "Event name", "text", ["snapshot.event.name"]),
      field("scope.guestCount", "Guest count", "number", ["snapshot.event.guests"]),
      field("scope.serviceStyle", "Service style", "text", ["snapshot.event.style"]),
      field("scope.dietaryRestrictions", "Dietary restrictions", "text", ["snapshot.event.dietaryRestrictions"]),
      field("scope.servers", "Servers", "number", ["snapshot.event.servers"]),
      field("scope.chefs", "Chefs", "number", ["snapshot.event.chefs"]),
      field("scope.bartenders", "Bartenders", "number", ["snapshot.event.bartenders"]),
      field("scope.roundTripMiles", "Round-trip miles", "number", ["snapshot.selection.milesRT"]),
      field("scope.package", "Package", "text", [
        "snapshot.selection.packageName",
        "snapshot.selection.packageId"
      ]),
      field("scope.menuItems", "Menu items", "items", [
        "snapshot.selection.menuItemsSnapshot",
        "snapshot.selection.menuItemDetails",
        "snapshot.selection.menuItemNames",
        "snapshot.selection.menuItems"
      ]),
      field("scope.addons", "Add-ons", "items", [
        "snapshot.selection.addonSnapshots",
        "snapshot.selection.addons"
      ]),
      field("scope.rentals", "Rentals", "items", [
        "snapshot.selection.rentalSnapshots",
        "snapshot.selection.rentals"
      ]),
      field("scope.includedMenuItems", "Included menu items", "items", [
        "snapshot.selection.packageInclusions.menuItems"
      ]),
      field("scope.includedAddons", "Included add-ons", "items", [
        "snapshot.selection.packageInclusions.addons"
      ]),
      field("scope.includedRentals", "Included rentals", "items", [
        "snapshot.selection.packageInclusions.rentals"
      ]),
      field("scope.menuItemQuantities", "Menu-item quantities", "quantities", [
        "snapshot.selection.menuItemQuantities"
      ]),
      field("scope.addonQuantities", "Add-on quantities", "quantities", [
        "snapshot.selection.addonQuantities"
      ]),
      field("scope.rentalQuantities", "Rental quantities", "quantities", [
        "snapshot.selection.rentalQuantities"
      ])
    ]
  },
  {
    id: "schedule",
    label: "Schedule",
    fields: [
      field("schedule.eventDate", "Event date", "date", ["snapshot.event.date"]),
      field("schedule.eventTime", "Event time", "time", ["snapshot.event.time"]),
      field("schedule.durationHours", "Duration (hours)", "number", ["snapshot.event.hours"]),
      field("schedule.venue", "Venue", "text", ["snapshot.event.venue"]),
      field("schedule.venueAddress", "Venue address", "text", ["snapshot.event.venueAddress"])
    ]
  },
  {
    id: "pricing",
    label: "Pricing",
    fields: [
      field("pricing.authority", "Pricing authority", "text", ["pricing.authority"]),
      field("pricing.version", "Pricing version", "text", ["pricing.pricingVersion"]),
      field("pricing.lineItems", "Line items", "line_items", ["pricing.lineItems"]),
      field("pricing.subtotal", "Subtotal", "money", ["pricing.subtotal"]),
      field("pricing.discount", "Discount", "money", ["pricing.discountTotal"]),
      field("pricing.serviceFee", "Service fee", "money", ["pricing.fees.serviceFee"]),
      field("pricing.tax", "Tax", "money", ["pricing.tax.amount"]),
      field("pricing.total", "Total", "money", ["pricing.grandTotal"]),
      field("pricing.deposit", "Deposit requirement", "money", ["pricing.deposit.amount"])
    ]
  },
  {
    id: "terms",
    label: "Terms",
    fields: [
      field("terms.paymentMethod", "Payment method", "text", ["snapshot.selection.payMethod"]),
      field("terms.quoteValidityDays", "Quote validity (days)", "number", [
        "snapshot.quoteMeta.quoteValidityDays"
      ]),
      field("terms.expiresAt", "Quote expires", "datetime", ["snapshot.expiresAtISO"]),
      field("terms.depositNotice", "Deposit notice", "text", ["snapshot.quoteMeta.depositNotice"]),
      field("terms.includeDisposables", "Disposables included", "boolean", [
        "snapshot.quoteMeta.includeDisposables"
      ]),
      field("terms.disposablesNote", "Disposables note", "text", [
        "snapshot.quoteMeta.disposablesNote"
      ])
    ]
  }
];

export const QUOTE_VERSION_COMPARISON_SECTIONS = deepFreeze(
  SECTION_DEFINITIONS.map((section) => ({
    id: section.id,
    label: section.label,
    fields: section.fields.map(({ id, label, valueType }) => ({ id, label, valueType }))
  }))
);

function field(id, label, valueType, paths) {
  return { id, label, valueType, paths };
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(record, key) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function known(value, sourcePath) {
  return {
    state: QUOTE_VERSION_VALUE_STATES.KNOWN,
    value,
    sourcePath
  };
}

function unknown(sourcePath, reason = "not_recorded") {
  return {
    state: QUOTE_VERSION_VALUE_STATES.UNKNOWN,
    value: null,
    sourcePath,
    reason
  };
}

function unavailable(sourcePath, reason = "source_unavailable") {
  return {
    state: QUOTE_VERSION_VALUE_STATES.UNAVAILABLE,
    value: null,
    sourcePath,
    reason
  };
}

function readPath(source, path) {
  const parts = path.split(".");
  let current = source;
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (!isRecord(current) || !hasOwn(current, parts[index]) || !isRecord(current[parts[index]])) {
      return unavailable(path);
    }
    current = current[parts[index]];
  }

  const key = parts.at(-1);
  if (!isRecord(current)) return unavailable(path);
  if (!hasOwn(current, key)) return unknown(path);
  return { state: "raw", value: current[key], sourcePath: path };
}

function normalizeText(value, sourcePath) {
  if (typeof value !== "string" && typeof value !== "number") {
    return unknown(sourcePath, "invalid_value");
  }
  const normalized = String(value).trim();
  return normalized ? known(normalized, sourcePath) : unknown(sourcePath);
}

function normalizeNumber(value, sourcePath) {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) {
    return unknown(sourcePath);
  }
  const normalized = typeof value === "number" || typeof value === "string"
    ? Number(value)
    : Number.NaN;
  return Number.isFinite(normalized)
    ? known(Object.is(normalized, -0) ? 0 : normalized, sourcePath)
    : unknown(sourcePath, "invalid_value");
}

function normalizeBoolean(value, sourcePath) {
  return typeof value === "boolean"
    ? known(value, sourcePath)
    : unknown(sourcePath, value === null || value === undefined ? "not_recorded" : "invalid_value");
}

function normalizeItem(value) {
  if (typeof value === "string" || typeof value === "number") {
    const normalized = String(value).trim();
    return normalized ? { id: normalized, label: normalized } : null;
  }
  if (!isRecord(value)) return null;
  const id = String(value.id ?? value.name ?? value.label ?? "").trim();
  const label = String(value.name ?? value.label ?? value.id ?? "").trim();
  return id && label ? { id, label } : null;
}

function normalizeItems(value, sourcePath) {
  if (!Array.isArray(value)) return unknown(sourcePath, "invalid_value");
  const items = value.map(normalizeItem);
  if (items.some((item) => !item)) return unknown(sourcePath, "invalid_value");
  return known(
    items.sort((left, right) => left.id.localeCompare(right.id) || left.label.localeCompare(right.label)),
    sourcePath
  );
}

function normalizeQuantities(value, sourcePath) {
  if (!isRecord(value)) return unknown(sourcePath, "invalid_value");
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  const normalized = {};
  for (const [rawKey, rawValue] of entries) {
    const key = String(rawKey).trim();
    const quantity = Number(rawValue);
    if (!key || !Number.isFinite(quantity) || quantity < 0) {
      return unknown(sourcePath, "invalid_value");
    }
    normalized[key] = Object.is(quantity, -0) ? 0 : quantity;
  }
  return known(normalized, sourcePath);
}

function normalizeLineItems(value, sourcePath) {
  if (!Array.isArray(value)) return unknown(sourcePath, "invalid_value");
  const items = [];
  for (const rawItem of value) {
    if (!isRecord(rawItem)) return unknown(sourcePath, "invalid_value");
    const id = String(rawItem.id ?? "").trim();
    const category = String(rawItem.category ?? "").trim();
    const name = String(rawItem.name ?? rawItem.label ?? "").trim();
    const pricingMode = String(rawItem.pricingMode ?? rawItem.type ?? "").trim();
    const unitPrice = Number(rawItem.unitPrice ?? rawItem.price);
    const quantity = Number(rawItem.quantity);
    const total = Number(rawItem.total);
    if (
      !id
      || !category
      || !name
      || !pricingMode
      || !Number.isFinite(unitPrice)
      || !Number.isFinite(quantity)
      || !Number.isFinite(total)
    ) {
      return unknown(sourcePath, "invalid_value");
    }
    items.push({ id, category, name, pricingMode, unitPrice, quantity, total });
  }
  return known(
    items.sort((left, right) => (
      left.id.localeCompare(right.id)
      || left.category.localeCompare(right.category)
      || left.name.localeCompare(right.name)
    )),
    sourcePath
  );
}

function normalizeRawValue(raw, valueType) {
  if (raw.state !== "raw") return raw;
  if (["text", "date", "time", "datetime"].includes(valueType)) {
    return normalizeText(raw.value, raw.sourcePath);
  }
  if (["number", "money"].includes(valueType)) {
    return normalizeNumber(raw.value, raw.sourcePath);
  }
  if (valueType === "boolean") return normalizeBoolean(raw.value, raw.sourcePath);
  if (valueType === "items") return normalizeItems(raw.value, raw.sourcePath);
  if (valueType === "quantities") return normalizeQuantities(raw.value, raw.sourcePath);
  if (valueType === "line_items") return normalizeLineItems(raw.value, raw.sourcePath);
  return unknown(raw.sourcePath, "unsupported_value_type");
}

function normalizeFieldValue(source, definition) {
  let firstUnknown = null;
  let firstUnavailable = null;
  for (const path of definition.paths) {
    const normalized = normalizeRawValue(readPath(source, path), definition.valueType);
    if (normalized.state === QUOTE_VERSION_VALUE_STATES.KNOWN) return normalized;
    if (normalized.state === QUOTE_VERSION_VALUE_STATES.UNKNOWN && !firstUnknown) {
      firstUnknown = normalized;
    }
    if (normalized.state === QUOTE_VERSION_VALUE_STATES.UNAVAILABLE && !firstUnavailable) {
      firstUnavailable = normalized;
    }
  }
  return firstUnknown || firstUnavailable || unavailable(definition.paths[0]);
}

function normalizeIdentityValue(source, paths, valueType = "text") {
  return normalizeFieldValue(source, { paths, valueType });
}

function knownIdentityValue(value) {
  return value?.state === QUOTE_VERSION_VALUE_STATES.KNOWN ? value.value : null;
}

function identityConflict(source, topLevelPath, snapshotPath) {
  const topLevel = normalizeIdentityValue(source, [topLevelPath]);
  const snapshot = normalizeIdentityValue(source, [snapshotPath]);
  return topLevel.state === QUOTE_VERSION_VALUE_STATES.KNOWN
    && snapshot.state === QUOTE_VERSION_VALUE_STATES.KNOWN
    && topLevel.value !== snapshot.value;
}

export function normalizeImmutableQuoteVersion(version) {
  const source = isRecord(version) ? version : {};
  const issues = [];
  if (!isRecord(version)) issues.push("missing_version");
  if (source.legacySynthetic === true) issues.push("legacy_synthetic_version");
  if (!isRecord(source.snapshot)) issues.push("missing_immutable_snapshot");
  if (identityConflict(source, "quoteId", "snapshot.id")) issues.push("quote_identity_conflict");
  if (identityConflict(source, "organizationId", "snapshot.organizationId")) {
    issues.push("organization_identity_conflict");
  }

  const identity = {
    quoteId: normalizeIdentityValue(source, ["quoteId", "snapshot.id"]),
    organizationId: normalizeIdentityValue(source, ["organizationId", "snapshot.organizationId"]),
    versionId: normalizeIdentityValue(source, ["versionId", "id"]),
    versionNumber: normalizeIdentityValue(source, ["versionNumber"], "number"),
    createdAtISO: normalizeIdentityValue(source, ["createdAtISO", "timestamp"], "datetime"),
    reason: normalizeIdentityValue(source, ["reason"])
  };

  if (identity.quoteId.state !== QUOTE_VERSION_VALUE_STATES.KNOWN) issues.push("missing_quote_identity");
  if (identity.organizationId.state !== QUOTE_VERSION_VALUE_STATES.KNOWN) {
    issues.push("missing_organization_identity");
  }
  if (identity.versionId.state !== QUOTE_VERSION_VALUE_STATES.KNOWN) issues.push("missing_version_identity");

  const versionUnavailable = issues.length > 0;
  const sections = SECTION_DEFINITIONS.map((section) => ({
    id: section.id,
    label: section.label,
    fields: section.fields.map((definition) => ({
      id: definition.id,
      label: definition.label,
      valueType: definition.valueType,
      value: versionUnavailable
        ? unavailable(definition.paths[0], "version_unavailable")
        : normalizeFieldValue(source, definition)
    }))
  }));

  return deepFreeze({
    schemaVersion: QUOTE_VERSION_COMPARISON_SCHEMA_VERSION,
    availability: {
      state: issues.length ? "unavailable" : "available",
      issues: [...new Set(issues)].sort()
    },
    identity,
    sections
  });
}

function normalizedValuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function compareValues(before, after, forcedUnavailable) {
  if (forcedUnavailable) return QUOTE_VERSION_CHANGE_STATES.UNAVAILABLE;
  if (
    before.state === QUOTE_VERSION_VALUE_STATES.UNAVAILABLE
    || after.state === QUOTE_VERSION_VALUE_STATES.UNAVAILABLE
  ) {
    return QUOTE_VERSION_CHANGE_STATES.UNAVAILABLE;
  }
  if (
    before.state === QUOTE_VERSION_VALUE_STATES.UNKNOWN
    || after.state === QUOTE_VERSION_VALUE_STATES.UNKNOWN
  ) {
    return QUOTE_VERSION_CHANGE_STATES.UNKNOWN;
  }
  return normalizedValuesEqual(before.value, after.value)
    ? QUOTE_VERSION_CHANGE_STATES.UNCHANGED
    : QUOTE_VERSION_CHANGE_STATES.CHANGED;
}

function sectionState(counts) {
  if (counts.unavailable > 0 || counts.unknown > 0) {
    return counts.changed > 0 ? "changed_partial" : "partial";
  }
  return counts.changed > 0 ? "changed" : "unchanged";
}

export function compareImmutableQuoteVersions(beforeVersion, afterVersion) {
  const before = normalizeImmutableQuoteVersion(beforeVersion);
  const after = normalizeImmutableQuoteVersion(afterVersion);
  const issues = [
    ...before.availability.issues.map((issue) => `before:${issue}`),
    ...after.availability.issues.map((issue) => `after:${issue}`)
  ];
  const beforeQuoteId = knownIdentityValue(before.identity.quoteId);
  const afterQuoteId = knownIdentityValue(after.identity.quoteId);
  const beforeOrganizationId = knownIdentityValue(before.identity.organizationId);
  const afterOrganizationId = knownIdentityValue(after.identity.organizationId);
  if (beforeQuoteId && afterQuoteId && beforeQuoteId !== afterQuoteId) {
    issues.push("quote_identity_mismatch");
  }
  if (
    beforeOrganizationId
    && afterOrganizationId
    && beforeOrganizationId !== afterOrganizationId
  ) {
    issues.push("organization_identity_mismatch");
  }

  const normalizedIssues = [...new Set(issues)].sort();
  const forcedUnavailable = normalizedIssues.length > 0;
  const summary = {
    changed: 0,
    unchanged: 0,
    unknown: 0,
    unavailable: 0
  };
  const sections = before.sections.map((beforeSection, sectionIndex) => {
    const afterSection = after.sections[sectionIndex];
    const counts = { changed: 0, unchanged: 0, unknown: 0, unavailable: 0 };
    const fields = beforeSection.fields.map((beforeField, fieldIndex) => {
      const afterField = afterSection.fields[fieldIndex];
      const comparison = compareValues(beforeField.value, afterField.value, forcedUnavailable);
      counts[comparison] += 1;
      summary[comparison] += 1;
      return {
        id: beforeField.id,
        label: beforeField.label,
        valueType: beforeField.valueType,
        before: beforeField.value,
        after: afterField.value,
        comparison
      };
    });
    return {
      id: beforeSection.id,
      label: beforeSection.label,
      state: forcedUnavailable ? "unavailable" : sectionState(counts),
      summary: counts,
      fields
    };
  });

  const comparisonState = forcedUnavailable
    ? "unavailable"
    : summary.unknown > 0 || summary.unavailable > 0
      ? "partial"
      : "complete";
  const equivalence = forcedUnavailable || (summary.changed === 0 && comparisonState !== "complete")
    ? "undetermined"
    : summary.changed > 0
      ? "different"
      : "equivalent";

  return deepFreeze({
    schemaVersion: QUOTE_VERSION_COMPARISON_SCHEMA_VERSION,
    advisory: true,
    evidenceBoundary: QUOTE_VERSION_COMPARISON_EVIDENCE_BOUNDARY,
    comparisonState,
    equivalence,
    issues: normalizedIssues,
    before,
    after,
    summary: {
      changedFieldCount: summary.changed,
      unchangedFieldCount: summary.unchanged,
      unknownFieldCount: summary.unknown,
      unavailableFieldCount: summary.unavailable,
      totalFieldCount: summary.changed + summary.unchanged + summary.unknown + summary.unavailable
    },
    sections
  });
}
