export const AMBIENT_DRAFT_PATCH_SOURCES = /* @__PURE__ */ Object.freeze([
  "ambient-guest-scenario-v1",
  "ambient-staffing-recommendation-v1",
  "ambient-pricing-scenario-v1"
]);

export const AMBIENT_DRAFT_FIELD_BOUNDS = /* @__PURE__ */ Object.freeze({
  guests: /* @__PURE__ */ Object.freeze({ minimum: 1, maximum: 400 }),
  servers: /* @__PURE__ */ Object.freeze({ minimum: 0, maximum: 30 }),
  chefs: /* @__PURE__ */ Object.freeze({ minimum: 0, maximum: 20 }),
  bartenders: /* @__PURE__ */ Object.freeze({ minimum: 0, maximum: 20 })
});

export const AMBIENT_EVENT_LOGISTICS_DRAFT_INTENTS = /* @__PURE__ */ Object.freeze({
  date: /* @__PURE__ */ Object.freeze({
    objectId: "event-date",
    fieldPaths: /* @__PURE__ */ Object.freeze(["event.date"]),
    focusField: "date",
    label: "Event date"
  }),
  time: /* @__PURE__ */ Object.freeze({
    objectId: "event-time",
    fieldPaths: /* @__PURE__ */ Object.freeze(["event.time"]),
    focusField: "time",
    label: "Event time"
  }),
  duration: /* @__PURE__ */ Object.freeze({
    objectId: "event-duration",
    fieldPaths: /* @__PURE__ */ Object.freeze(["event.hours"]),
    focusField: "hours",
    label: "Event duration"
  }),
  venue: /* @__PURE__ */ Object.freeze({
    objectId: "event-venue",
    fieldPaths: /* @__PURE__ */ Object.freeze(["event.venue", "event.venueAddress"]),
    focusField: "venue",
    label: "Event venue"
  })
});

export const AMBIENT_PACKAGE_MENU_DRAFT_INTENTS = /* @__PURE__ */ Object.freeze({
  replace_package: /* @__PURE__ */ Object.freeze({
    actionId: "replace-package-in-draft",
    objectId: "package",
    fieldPaths: /* @__PURE__ */ Object.freeze([
      "selection.packageId",
      "selection.packageName"
    ]),
    trustedReconciliationRequired: /* @__PURE__ */ Object.freeze([
      "selection.packageInclusions"
    ]),
    label: "Package replacement"
  }),
  replace_menu_item: /* @__PURE__ */ Object.freeze({
    actionId: "replace-menu-item-in-draft",
    objectId: "menu",
    fieldPaths: /* @__PURE__ */ Object.freeze([
      "selection.menuItems",
      "selection.menuItemQuantities"
    ]),
    trustedReconciliationRequired: /* @__PURE__ */ Object.freeze([
      "selection.menuItemsSnapshot",
      "selection.menuItemNames",
      "selection.packageInclusions"
    ]),
    label: "Menu item replacement"
  }),
  reorder_menu: /* @__PURE__ */ Object.freeze({
    actionId: "reorder-menu-in-draft",
    objectId: "menu",
    fieldPaths: /* @__PURE__ */ Object.freeze(["selection.menuItems"]),
    trustedReconciliationRequired: /* @__PURE__ */ Object.freeze([
      "selection.menuItemsSnapshot",
      "selection.menuItemNames"
    ]),
    label: "Menu reorder"
  })
});

const AMBIENT_PACKAGE_MENU_DRAFT_INTENT_SCHEMA_VERSION = "ambient-package-menu-draft-intent-v1";
const AMBIENT_PACKAGE_MENU_CATALOG_BOUNDS = /* @__PURE__ */ Object.freeze({
  packages: 100,
  menuItems: 500,
  selectedMenuItems: 100,
  quantity: 10_000
});
const AMBIENT_MENU_REORDER_SEMANTICS = /* @__PURE__ */ Object.freeze({
  equivalence: "pointer_and_keyboard_produce_the_same_order_intent",
  pointer: /* @__PURE__ */ Object.freeze({
    input: "drag",
    requiredFeedback: /* @__PURE__ */ Object.freeze(["lift", "target_position", "drop_or_cancel"]),
    buttonAlternativeRequired: true
  }),
  keyboard: /* @__PURE__ */ Object.freeze({
    input: "move_command",
    commands: /* @__PURE__ */ Object.freeze(["move_previous", "move_next"]),
    requiredFeedback: /* @__PURE__ */ Object.freeze(["lift", "position_announcement", "drop_or_cancel"]),
    visibleButtonAlternativeRequired: true
  })
});

const PACKAGE_REPLACEMENT_KEYS = /* @__PURE__ */ Object.freeze([
  "ok",
  "schemaVersion",
  "kind",
  "actionId",
  "authority",
  "commit",
  "baseContext",
  "target",
  "before",
  "proposed",
  "candidate",
  "consequencePreviewRequired",
  "requiresOutcomeNamedSave"
]);
const MENU_REPLACEMENT_KEYS = PACKAGE_REPLACEMENT_KEYS;
const MENU_REORDER_KEYS = /* @__PURE__ */ Object.freeze([
  "ok",
  "schemaVersion",
  "kind",
  "actionId",
  "authority",
  "commit",
  "baseContext",
  "target",
  "itemId",
  "fromIndex",
  "toIndex",
  "beforeOrder",
  "proposedOrder",
  "interaction",
  "interactionSemantics",
  "consequencePreviewRequired",
  "requiresOutcomeNamedSave"
]);

const text = (value) => String(value ?? "").trim();
const record = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

function immutable(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || Object.isFrozen(value) || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((entry) => immutable(entry, seen));
  return Object.freeze(value);
}

function recovery(code, reason, nextResolution) {
  return immutable({
    ok: false,
    code,
    reason,
    consequence: "The priced editor was not opened and the saved quote remains unchanged.",
    nextResolution
  });
}

function revisionId(quote) {
  return text(quote?.activeVersionId || quote?.versionMeta?.versionId || quote?.updatedAtISO);
}

function exactList(left, right) {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function exactKeys(value, keys) {
  if (!record(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return exactList(actual, expected);
}

function strictText(value, maximum = 240) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximum
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function strictId(value) {
  return strictText(value, 160) && !/[/?#\\]/u.test(value);
}

function exactIso(value) {
  if (!strictText(value, 64)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function exactJson(left, right, seen = new WeakMap()) {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    if (seen.has(left)) return seen.get(left) === right;
    seen.set(left, right);
    return left.every((entry, index) => exactJson(entry, right[index], seen));
  }
  if (!record(left) || !record(right)) return false;
  if (seen.has(left)) return seen.get(left) === right;
  seen.set(left, right);
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return exactList(leftKeys, rightKeys)
    && leftKeys.every((key) => exactJson(left[key], right[key], seen));
}

function quotePackageMenuScope(quote) {
  const candidateRevision = revisionId(quote);
  return {
    quoteId: strictId(quote?.id) ? quote.id : "",
    organizationId: strictId(quote?.organizationId) ? quote.organizationId : "",
    revisionId: strictId(candidateRevision) ? candidateRevision : ""
  };
}

function validateCatalogRecords(context) {
  if (
    !Array.isArray(context?.packages)
    || context.packages.length > AMBIENT_PACKAGE_MENU_CATALOG_BOUNDS.packages
    || !Array.isArray(context?.menuItems)
    || context.menuItems.length > AMBIENT_PACKAGE_MENU_CATALOG_BOUNDS.menuItems
  ) {
    return false;
  }
  const packageIds = new Set();
  for (const entry of context.packages) {
    if (
      !record(entry)
      || !strictId(entry.id)
      || !strictText(entry.name)
      || typeof entry.catalogActive !== "boolean"
      || entry.operationalAvailability !== "not_evaluated"
      || packageIds.has(entry.id)
    ) return false;
    packageIds.add(entry.id);
  }
  const menuIds = new Set();
  for (const entry of context.menuItems) {
    if (
      !record(entry)
      || !strictId(entry.id)
      || !strictText(entry.name)
      || typeof entry.catalogActive !== "boolean"
      || entry.operationalAvailability !== "not_evaluated"
      || !record(entry.section)
      || !strictId(entry.section.id)
      || !strictText(entry.section.label)
      || !Number.isSafeInteger(entry.section.orderIndex)
      || entry.section.orderIndex < 0
      || menuIds.has(entry.id)
    ) return false;
    menuIds.add(entry.id);
  }
  return true;
}

function packageMenuCatalogScope(catalogContext, quoteScope, baseContext) {
  const freshness = record(catalogContext?.freshness) ? catalogContext.freshness : null;
  if (
    !record(catalogContext)
    || !record(baseContext)
    || !exactKeys(baseContext, [
      "quoteId",
      "organizationId",
      "baseRevisionId",
      "catalogRevision",
      "catalogSourceLabel",
      "catalogObservedAt"
    ])
    || catalogContext.state !== "current"
    || freshness?.state !== "fresh"
    || !exactIso(freshness?.observedAt)
    || !strictId(catalogContext.organizationId)
    || !strictText(catalogContext.sourceLabel, 120)
    || !Number.isSafeInteger(catalogContext.catalogRevision)
    || catalogContext.catalogRevision < 0
    || !quoteScope.quoteId
    || !quoteScope.organizationId
    || !quoteScope.revisionId
    || baseContext.quoteId !== quoteScope.quoteId
    || baseContext.organizationId !== quoteScope.organizationId
    || baseContext.baseRevisionId !== quoteScope.revisionId
    || catalogContext.organizationId !== quoteScope.organizationId
    || baseContext.catalogRevision !== catalogContext.catalogRevision
    || baseContext.catalogSourceLabel !== catalogContext.sourceLabel
    || baseContext.catalogObservedAt !== freshness.observedAt
    || !validateCatalogRecords(catalogContext)
  ) return null;
  return {
    organizationId: quoteScope.organizationId,
    catalogRevision: catalogContext.catalogRevision,
    sourceLabel: catalogContext.sourceLabel,
    observedAt: freshness.observedAt,
    freshness: "fresh"
  };
}

function exactTarget(target, definition) {
  return exactKeys(target, ["objectId", "fieldPaths", "trustedReconciliationRequired"])
    && target.objectId === definition.objectId
    && exactList(target.fieldPaths, definition.fieldPaths)
    && exactList(target.trustedReconciliationRequired, definition.trustedReconciliationRequired);
}

function selectedMenuSnapshot(quote) {
  const selection = record(quote?.selection) ? quote.selection : {};
  const snapshotSource = Array.isArray(selection.menuItemsSnapshot)
    ? selection.menuItemsSnapshot
    : Array.isArray(selection.menuItemDetails)
      ? selection.menuItemDetails
      : [];
  const snapshotById = new Map();
  for (const entry of snapshotSource) {
    if (!record(entry) || !strictId(entry.id) || snapshotById.has(entry.id)) return null;
    snapshotById.set(entry.id, entry);
  }
  const rawItems = Array.isArray(selection.menuItems)
    ? selection.menuItems
    : [...snapshotById.keys()];
  if (
    rawItems.length === 0
    || rawItems.length > AMBIENT_PACKAGE_MENU_CATALOG_BOUNDS.selectedMenuItems
    || rawItems.some((id) => !strictId(id))
    || new Set(rawItems).size !== rawItems.length
  ) return null;
  const quantities = record(selection.menuItemQuantities) ? selection.menuItemQuantities : {};
  const items = [];
  for (const [orderIndex, id] of rawItems.entries()) {
    const candidate = Object.prototype.hasOwnProperty.call(quantities, id)
      ? quantities[id]
      : snapshotById.get(id)?.quantity;
    if (
      !Number.isSafeInteger(candidate)
      || candidate < 1
      || candidate > AMBIENT_PACKAGE_MENU_CATALOG_BOUNDS.quantity
    ) return null;
    items.push({ id, quantity: candidate, orderIndex });
  }
  return { order: [...rawItems], items };
}

function exactCatalogRecord(records, id) {
  const matches = records.filter((entry) => entry.id === id);
  return matches.length === 1 ? matches[0] : null;
}

function commonPackageMenuIntentValid(intent, definition, expectedKeys) {
  return exactKeys(intent, expectedKeys)
    && intent.ok === true
    && intent.schemaVersion === AMBIENT_PACKAGE_MENU_DRAFT_INTENT_SCHEMA_VERSION
    && intent.actionId === definition.actionId
    && intent.authority === "draft_only"
    && intent.commit === false
    && intent.consequencePreviewRequired === true
    && intent.requiresOutcomeNamedSave === true
    && exactTarget(intent.target, definition);
}

function packageReplacementChange(intent, quote, catalogContext) {
  if (
    !exactKeys(intent.before, ["packageId"])
    || !exactKeys(intent.proposed, ["packageId", "packageName"])
    || !exactKeys(intent.candidate, [
      "id",
      "name",
      "catalogActive",
      "operationalAvailability"
    ])
    || !strictId(intent.before.packageId)
    || intent.before.packageId !== quote?.selection?.packageId
    || !strictId(intent.proposed.packageId)
    || !strictText(intent.proposed.packageName)
    || intent.proposed.packageId === intent.before.packageId
    || intent.candidate.id !== intent.proposed.packageId
    || intent.candidate.name !== intent.proposed.packageName
    || intent.candidate.catalogActive !== true
    || intent.candidate.operationalAvailability !== "not_evaluated"
  ) return null;
  const current = exactCatalogRecord(catalogContext.packages, intent.candidate.id);
  if (
    !current
    || current.name !== intent.candidate.name
    || current.catalogActive !== true
    || current.operationalAvailability !== "not_evaluated"
  ) return null;
  return {
    before: { packageId: intent.before.packageId },
    proposed: {
      packageId: intent.proposed.packageId,
      packageName: intent.proposed.packageName
    },
    candidate: {
      id: current.id,
      name: current.name,
      catalogActive: true,
      operationalAvailability: "not_evaluated"
    }
  };
}

function menuReplacementChange(intent, quote, catalogContext) {
  const selected = selectedMenuSnapshot(quote);
  if (
    !selected
    || !exactKeys(intent.before, ["itemId", "orderIndex", "quantity"])
    || !exactKeys(intent.proposed, ["itemId", "orderIndex", "quantity", "quantityPolicy"])
    || !exactKeys(intent.candidate, [
      "id",
      "name",
      "section",
      "catalogActive",
      "operationalAvailability"
    ])
    || !strictId(intent.before.itemId)
    || !Number.isSafeInteger(intent.before.orderIndex)
    || !Number.isSafeInteger(intent.before.quantity)
    || !strictId(intent.proposed.itemId)
    || intent.proposed.orderIndex !== intent.before.orderIndex
    || intent.proposed.quantity !== intent.before.quantity
    || intent.proposed.quantityPolicy !== "preserve_explicit_saved_quantity"
    || selected.items[intent.before.orderIndex]?.id !== intent.before.itemId
    || selected.items[intent.before.orderIndex]?.quantity !== intent.before.quantity
    || selected.order.includes(intent.proposed.itemId)
    || intent.candidate.id !== intent.proposed.itemId
    || intent.candidate.catalogActive !== true
    || intent.candidate.operationalAvailability !== "not_evaluated"
  ) return null;
  const current = exactCatalogRecord(catalogContext.menuItems, intent.candidate.id);
  if (
    !current
    || current.name !== intent.candidate.name
    || current.catalogActive !== true
    || current.operationalAvailability !== "not_evaluated"
    || !exactJson(current.section, intent.candidate.section)
  ) return null;
  return {
    before: {
      itemId: intent.before.itemId,
      orderIndex: intent.before.orderIndex,
      quantity: intent.before.quantity
    },
    proposed: {
      itemId: intent.proposed.itemId,
      orderIndex: intent.proposed.orderIndex,
      quantity: intent.proposed.quantity,
      quantityPolicy: "preserve_explicit_saved_quantity"
    },
    candidate: {
      id: current.id,
      name: current.name,
      section: { ...current.section },
      catalogActive: true,
      operationalAvailability: "not_evaluated"
    }
  };
}

function menuReorderChange(intent, quote, catalogContext) {
  const selected = selectedMenuSnapshot(quote);
  if (
    !selected
    || !strictId(intent.itemId)
    || !Number.isSafeInteger(intent.fromIndex)
    || !Number.isSafeInteger(intent.toIndex)
    || !["pointer", "keyboard"].includes(intent.interaction)
    || !exactList(intent.beforeOrder, selected.order)
    || intent.fromIndex !== selected.order.indexOf(intent.itemId)
    || intent.fromIndex < 0
    || intent.toIndex < 0
    || intent.toIndex >= selected.order.length
    || intent.toIndex === intent.fromIndex
    || !exactJson(intent.interactionSemantics, AMBIENT_MENU_REORDER_SEMANTICS)
    || selected.order.some((id) => !exactCatalogRecord(catalogContext.menuItems, id))
  ) return null;
  const expected = [...selected.order];
  const [moved] = expected.splice(intent.fromIndex, 1);
  expected.splice(intent.toIndex, 0, moved);
  if (!exactList(intent.proposedOrder, expected)) return null;
  return {
    before: { order: [...selected.order] },
    proposed: { order: [...expected] },
    interaction: {
      method: intent.interaction,
      equivalence: AMBIENT_MENU_REORDER_SEMANTICS.equivalence
    }
  };
}

function packageMenuDraftChange(kind, intent, quote, catalogContext) {
  if (kind === "replace_package") return packageReplacementChange(intent, quote, catalogContext);
  if (kind === "replace_menu_item") return menuReplacementChange(intent, quote, catalogContext);
  if (kind === "reorder_menu") return menuReorderChange(intent, quote, catalogContext);
  return null;
}

function validSavedLogisticsValue(kind, quote, candidate) {
  const event = record(quote?.event) ? quote.event : {};
  if (kind === "date") {
    const value = text(event.date);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
    if (!match || candidate !== value) return false;
    const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return parsed.getUTCFullYear() === Number(match[1])
      && parsed.getUTCMonth() === Number(match[2]) - 1
      && parsed.getUTCDate() === Number(match[3]);
  }
  if (kind === "time") {
    const value = text(event.time);
    const match = /^(\d{2}):(\d{2})$/u.exec(value);
    return candidate === value && Boolean(match)
      && Number(match[1]) <= 23 && Number(match[2]) <= 59;
  }
  if (kind === "duration") {
    return typeof event.hours === "number"
      && Number.isFinite(event.hours)
      && event.hours >= 1
      && event.hours <= 12
      && candidate === event.hours;
  }
  if (!record(candidate) || Object.keys(candidate).some((key) => !["name", "address"].includes(key))) {
    return false;
  }
  const name = typeof event.venue === "string" ? event.venue : "";
  const address = typeof event.venueAddress === "string" && event.venueAddress !== ""
    ? event.venueAddress
    : null;
  return candidate.name === name
    && candidate.address === address
    && name.length > 0
    && name.length <= 160
    && (address === null || address.length <= 240)
    && !/[\u0000-\u001f\u007f]/u.test(`${name}${address || ""}`);
}

export function normalizeAmbientEventLogisticsDraftIntent({
  quote = {},
  draftIntent = null,
  enabled = false
} = {}) {
  if (!enabled || !draftIntent) {
    return immutable({ ok: true, focusField: "", fields: [], kind: "", label: "" });
  }
  if (!record(draftIntent)) {
    return recovery(
      "ambient_logistics_intent_invalid",
      "The event-logistics handoff is not a structured draft intent.",
      "Reopen the exact event detail from the current opportunity."
    );
  }
  const kind = text(draftIntent.kind);
  const definition = AMBIENT_EVENT_LOGISTICS_DRAFT_INTENTS[kind];
  const revision = revisionId(quote);
  if (!revision) {
    return recovery(
      "ambient_logistics_intent_revision_unavailable",
      "The saved quote does not expose an exact revision for this event-logistics handoff.",
      "Refresh the opportunity until its saved version is available, then continue with the event detail."
    );
  }
  if (
    !definition
    || draftIntent.schemaVersion !== "ambient-event-logistics-draft-intent-v1"
    || draftIntent.source !== "ambient-event-logistics-v1"
    || text(draftIntent.baseRevisionId) !== revision
    || draftIntent.objectId !== definition.objectId
    || !exactList(draftIntent.fieldPaths, definition.fieldPaths)
    || draftIntent.authority !== "draft_only"
    || draftIntent.commit !== false
    || draftIntent.consequencePreviewRequired !== true
    || draftIntent.requiresOutcomeNamedSave !== true
    || !validSavedLogisticsValue(kind, quote, draftIntent.savedValue)
  ) {
    return recovery(
      "ambient_logistics_intent_invalid",
      "The event-logistics handoff is stale or does not exactly match the selected saved quote.",
      "Refresh the opportunity and reopen the exact event detail before continuing in the editor."
    );
  }
  return immutable({
    ok: true,
    focusField: definition.focusField,
    fields: [...definition.fieldPaths],
    kind,
    label: definition.label
  });
}

export function normalizeAmbientPackageMenuDraftIntent({
  quote = {},
  draftIntent = null,
  catalogContext = null,
  enabled = false
} = {}) {
  if (!enabled || !draftIntent) {
    return immutable({
      ok: true,
      family: "",
      focusField: "",
      fields: [],
      kind: "",
      label: "",
      draftChange: null
    });
  }
  if (!record(draftIntent)) {
    return recovery(
      "ambient_package_menu_intent_invalid",
      "The package or menu handoff is not a structured draft intent.",
      "Reopen the exact package or menu object from the current opportunity."
    );
  }
  const kind = text(draftIntent.kind);
  const definition = AMBIENT_PACKAGE_MENU_DRAFT_INTENTS[kind];
  const expectedKeys = kind === "reorder_menu"
    ? MENU_REORDER_KEYS
    : kind === "replace_package" || kind === "replace_menu_item"
      ? PACKAGE_REPLACEMENT_KEYS
      : [];
  if (
    !definition
    || !commonPackageMenuIntentValid(draftIntent, definition, expectedKeys)
  ) {
    return recovery(
      "ambient_package_menu_intent_invalid",
      "The package or menu handoff is ambiguous or does not match the supported draft-intent contract.",
      "Refresh the opportunity and reopen one exact package or menu outcome before continuing."
    );
  }
  const quoteScope = quotePackageMenuScope(quote);
  if (!quoteScope.revisionId) {
    return recovery(
      "ambient_package_menu_intent_revision_unavailable",
      "The saved quote does not expose an exact revision for this package or menu handoff.",
      "Refresh the opportunity until its exact saved revision is available, then stage the package or menu outcome again."
    );
  }
  if (draftIntent.baseContext?.baseRevisionId !== quoteScope.revisionId) {
    return recovery(
      "ambient_package_menu_intent_revision_mismatch",
      "The package or menu handoff was created for a different saved quote revision.",
      "Refresh the selected opportunity and recreate the outcome from its current revision."
    );
  }
  if (
    !quoteScope.quoteId
    || !quoteScope.organizationId
    || draftIntent.baseContext?.quoteId !== quoteScope.quoteId
    || draftIntent.baseContext?.organizationId !== quoteScope.organizationId
  ) {
    return recovery(
      "ambient_package_menu_intent_quote_scope_mismatch",
      "The package or menu handoff does not match the exact selected quote and organization.",
      "Return to the selected opportunity and recreate the outcome from that exact tenant-scoped record."
    );
  }
  const catalogScope = packageMenuCatalogScope(
    catalogContext,
    quoteScope,
    draftIntent.baseContext
  );
  if (!catalogScope) {
    return recovery(
      "ambient_package_menu_intent_catalog_scope_mismatch",
      "The package or menu handoff lacks the same fresh tenant catalog revision, source, or observation used to create it.",
      "Reload the current tenant catalog and recreate the package or menu outcome before opening the editor."
    );
  }
  const change = packageMenuDraftChange(kind, draftIntent, quote, catalogContext);
  if (!change) {
    return recovery(
      "ambient_package_menu_intent_saved_scope_mismatch",
      "The package or menu handoff no longer exactly matches the saved selection, quantity, order, or bounded catalog candidate.",
      "Refresh the selected opportunity and recreate one exact package or menu outcome from its current saved evidence."
    );
  }
  return immutable({
    ok: true,
    family: "package_menu",
    focusField: "",
    fields: [...definition.fieldPaths],
    kind,
    label: definition.label,
    draftChange: {
      state: "pending_review",
      actionId: definition.actionId,
      authority: "draft_only",
      commit: false,
      target: {
        objectId: definition.objectId,
        fieldPaths: [...definition.fieldPaths],
        trustedReconciliationRequired: [...definition.trustedReconciliationRequired]
      },
      catalogScope,
      ...change,
      consequencePreviewRequired: true,
      requiresOutcomeNamedSave: true
    }
  });
}

export function normalizeAmbientDraftIntent({
  quote = {},
  draftIntent = null,
  catalogContext = null,
  enabled = false
} = {}) {
  if (!enabled || !draftIntent) {
    return immutable({
      ok: true,
      family: "",
      focusField: "",
      fields: [],
      kind: "",
      label: "",
      draftChange: null
    });
  }
  if (
    record(draftIntent)
    && draftIntent.schemaVersion === AMBIENT_PACKAGE_MENU_DRAFT_INTENT_SCHEMA_VERSION
  ) {
    return normalizeAmbientPackageMenuDraftIntent({
      quote,
      draftIntent,
      catalogContext,
      enabled
    });
  }
  const logistics = normalizeAmbientEventLogisticsDraftIntent({
    quote,
    draftIntent,
    enabled
  });
  if (logistics.ok === false) return logistics;
  return immutable({
    ...logistics,
    family: logistics.kind ? "event_logistics" : "",
    draftChange: null
  });
}

export function normalizeAmbientQuoteDraftPatch({
  quote = {},
  draftPatch = null,
  enabled = false
} = {}) {
  if (!enabled || !draftPatch) {
    return immutable({ ok: true, values: {}, fields: [], source: "" });
  }

  const event = record(draftPatch.event) ? draftPatch.event : null;
  const source = text(draftPatch.source);
  const revision = revisionId(quote);
  const fields = event ? Object.keys(event) : [];
  if (!revision) {
    return recovery(
      "ambient_patch_revision_unavailable",
      "The saved quote does not expose an exact revision for this staged Ambient scenario.",
      "Refresh the selected opportunity until its exact saved revision is available, then stage the scenario again."
    );
  }
  if (
    !event
    || fields.length === 0
    || !AMBIENT_DRAFT_PATCH_SOURCES.includes(source)
    || text(draftPatch.baseRevisionId) !== revision
    || fields.some((field) => !(field in AMBIENT_DRAFT_FIELD_BOUNDS))
  ) {
    return recovery(
      "ambient_patch_invalid",
      "The staged Ambient scenario is stale or does not match the supported quote fields.",
      "Refresh the recommendation from the current opportunity, then stage it again."
    );
  }

  const values = {};
  for (const field of fields) {
    const bounds = AMBIENT_DRAFT_FIELD_BOUNDS[field];
    const value = Number(event[field]);
    if (!Number.isInteger(value) || value < bounds.minimum || value > bounds.maximum) {
      return recovery(
        "ambient_patch_out_of_bounds",
        "The staged Ambient scenario contains a value outside the supported editor bounds.",
        "Review the current recommendation and resolve the unsupported value before staging."
      );
    }
    values[field] = value;
  }
  return immutable({ ok: true, values, fields, source });
}
