export const AMBIENT_PACKAGE_MENU_DRAFT_ADOPTION_MODEL =
  "ambient-package-menu-draft-adoption-v1";

const CATALOG_BOUNDS = Object.freeze({
  packages: 100,
  menuItems: 500,
  selectedMenuItems: 100,
  quantity: 10_000
});

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

const CHANGE_DEFINITIONS = Object.freeze({
  replace_package: Object.freeze({
    actionId: "replace-package-in-draft",
    label: "Package replacement",
    objectId: "package",
    fields: Object.freeze(["selection.packageId", "selection.packageName"]),
    reconciliation: Object.freeze(["selection.packageInclusions"]),
    dirtyFields: Object.freeze(["pkg"])
  }),
  replace_menu_item: Object.freeze({
    actionId: "replace-menu-item-in-draft",
    label: "Menu item replacement",
    objectId: "menu",
    fields: Object.freeze(["selection.menuItems", "selection.menuItemQuantities"]),
    reconciliation: Object.freeze([
      "selection.menuItemsSnapshot",
      "selection.menuItemNames",
      "selection.packageInclusions"
    ]),
    dirtyFields: Object.freeze(["menuItems", "menuItemQuantities"])
  }),
  reorder_menu: Object.freeze({
    actionId: "reorder-menu-in-draft",
    label: "Menu reorder",
    objectId: "menu",
    fields: Object.freeze(["selection.menuItems"]),
    reconciliation: Object.freeze([
      "selection.menuItemsSnapshot",
      "selection.menuItemNames"
    ]),
    dirtyFields: Object.freeze(["menuItems"])
  })
});

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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

function exactList(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function exactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  return exactList(actual, required);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key], seen));
  return Object.freeze(value);
}

function cloneDraftValue(value, seen = new WeakSet()) {
  if (
    value === null
    || value === undefined
    || typeof value === "string"
    || typeof value === "boolean"
  ) return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("The editor draft contains a non-finite number.");
    return value;
  }
  if (!value || typeof value !== "object" || seen.has(value)) {
    throw new TypeError("The editor draft contains an unsupported or cyclic value.");
  }
  seen.add(value);
  if (Array.isArray(value)) {
    if (value.length > 10_000) throw new TypeError("The editor draft exceeds its safe array bound.");
    return value.map((entry) => cloneDraftValue(entry, seen));
  }
  if (!isRecord(value)) throw new TypeError("The editor draft contains an unsupported record type.");
  const keys = Object.keys(value);
  if (
    keys.length > 1_000
    || Reflect.ownKeys(value).length !== keys.length
    || keys.some((key) => FORBIDDEN_KEYS.has(key))
  ) {
    throw new TypeError("The editor draft contains an unsafe record shape.");
  }
  return Object.fromEntries(keys.map((key) => [key, cloneDraftValue(value[key], seen)]));
}

function immutableResult(value) {
  return deepFreeze(value);
}

function recovery(form, code, reason, nextResolution) {
  return immutableResult({
    ok: false,
    form,
    dirtyFields: [],
    acknowledgement: {
      kind: "recovery",
      state: "not_applied",
      code,
      reason,
      consequence: "The current editor draft was not changed and nothing was saved.",
      nextResolutions: [nextResolution],
      reconciliationRequired: [],
      inclusionReconciliationRequired: false
    }
  });
}

function exactWrapperKeys(intent) {
  if (!isRecord(intent)) return false;
  const expected = ["family", "focusField", "fields", "kind", "label", "draftChange"];
  if (Object.prototype.hasOwnProperty.call(intent, "ok")) expected.push("ok");
  return exactKeys(intent, expected) && (!expected.includes("ok") || intent.ok === true);
}

function exactTarget(value, definition) {
  return exactKeys(value, ["objectId", "fieldPaths", "trustedReconciliationRequired"])
    && value.objectId === definition.objectId
    && exactList(value.fieldPaths, definition.fields)
    && exactList(value.trustedReconciliationRequired, definition.reconciliation);
}

function exactCatalogScope(scope, context) {
  const freshness = context?.freshness;
  return exactKeys(scope, [
    "organizationId",
    "catalogRevision",
    "sourceLabel",
    "observedAt",
    "freshness"
  ])
    && isRecord(context)
    && context.state === "current"
    && isRecord(freshness)
    && freshness.state === "fresh"
    && exactIso(freshness.observedAt)
    && strictId(context.organizationId)
    && strictText(context.sourceLabel, 120)
    && Number.isSafeInteger(context.catalogRevision)
    && context.catalogRevision >= 0
    && scope.organizationId === context.organizationId
    && scope.catalogRevision === context.catalogRevision
    && scope.sourceLabel === context.sourceLabel
    && scope.observedAt === freshness.observedAt
    && scope.freshness === "fresh";
}

function validateCatalogRecords(context) {
  if (
    !Array.isArray(context?.packages)
    || context.packages.length > CATALOG_BOUNDS.packages
    || !Array.isArray(context?.menuItems)
    || context.menuItems.length > CATALOG_BOUNDS.menuItems
  ) return null;

  const packages = new Map();
  for (const entry of context.packages) {
    if (
      !isRecord(entry)
      || !strictId(entry.id)
      || !strictText(entry.name)
      || typeof entry.catalogActive !== "boolean"
      || entry.operationalAvailability !== "not_evaluated"
      || packages.has(entry.id)
    ) return null;
    packages.set(entry.id, entry);
  }

  const menuItems = new Map();
  for (const entry of context.menuItems) {
    if (
      !isRecord(entry)
      || !strictId(entry.id)
      || !strictText(entry.name)
      || typeof entry.catalogActive !== "boolean"
      || entry.operationalAvailability !== "not_evaluated"
      || !isRecord(entry.section)
      || !strictId(entry.section.id)
      || !strictText(entry.section.label)
      || !Number.isSafeInteger(entry.section.orderIndex)
      || entry.section.orderIndex < 0
      || menuItems.has(entry.id)
    ) return null;
    menuItems.set(entry.id, entry);
  }
  return { packages, menuItems };
}

function validCommonIntent(intent, definition, catalogContext) {
  const change = intent?.draftChange;
  const changeKeys = intent?.kind === "reorder_menu"
    ? [
        "state",
        "actionId",
        "authority",
        "commit",
        "target",
        "catalogScope",
        "before",
        "proposed",
        "interaction",
        "consequencePreviewRequired",
        "requiresOutcomeNamedSave"
      ]
    : [
        "state",
        "actionId",
        "authority",
        "commit",
        "target",
        "catalogScope",
        "before",
        "proposed",
        "candidate",
        "consequencePreviewRequired",
        "requiresOutcomeNamedSave"
      ];
  return exactWrapperKeys(intent)
    && intent.family === "package_menu"
    && intent.focusField === ""
    && intent.label === definition.label
    && exactList(intent.fields, definition.fields)
    && isRecord(change)
    && exactKeys(change, changeKeys)
    && change.state === "pending_review"
    && change.actionId === definition.actionId
    && change.authority === "draft_only"
    && change.commit === false
    && change.consequencePreviewRequired === true
    && change.requiresOutcomeNamedSave === true
    && exactTarget(change.target, definition)
    && exactCatalogScope(change.catalogScope, catalogContext);
}

function exactCandidate(candidate, current, { menu = false } = {}) {
  if (
    !isRecord(candidate)
    || !current
    || candidate.id !== current.id
    || candidate.name !== current.name
    || candidate.catalogActive !== true
    || current.catalogActive !== true
    || candidate.operationalAvailability !== "not_evaluated"
    || current.operationalAvailability !== "not_evaluated"
  ) return false;
  if (!menu) {
    return exactKeys(candidate, ["id", "name", "catalogActive", "operationalAvailability"]);
  }
  return exactKeys(candidate, [
    "id",
    "name",
    "section",
    "catalogActive",
    "operationalAvailability"
  ])
    && exactKeys(candidate.section, ["id", "label", "orderIndex"])
    && candidate.section.id === current.section.id
    && candidate.section.label === current.section.label
    && candidate.section.orderIndex === current.section.orderIndex;
}

function selectedMenuForm(form, catalogRecords) {
  if (
    !Array.isArray(form.menuItems)
    || form.menuItems.length === 0
    || form.menuItems.length > CATALOG_BOUNDS.selectedMenuItems
    || form.menuItems.some((id) => !strictId(id))
    || new Set(form.menuItems).size !== form.menuItems.length
    || !isRecord(form.menuItemQuantities)
  ) return null;
  const quantityKeys = Object.keys(form.menuItemQuantities);
  if (
    quantityKeys.length !== form.menuItems.length
    || quantityKeys.some((id) => !strictId(id) || !form.menuItems.includes(id))
  ) return null;
  for (const id of form.menuItems) {
    const quantity = form.menuItemQuantities[id];
    if (
      !catalogRecords.menuItems.has(id)
      || !Number.isSafeInteger(quantity)
      || quantity < 1
      || quantity > CATALOG_BOUNDS.quantity
    ) return null;
  }
  return {
    order: [...form.menuItems],
    quantities: { ...form.menuItemQuantities }
  };
}

function exactSingleMove(before, proposed) {
  if (
    !exactList([...before].sort(), [...proposed].sort())
    || exactList(before, proposed)
  ) return false;
  for (let fromIndex = 0; fromIndex < before.length; fromIndex += 1) {
    for (let toIndex = 0; toIndex < before.length; toIndex += 1) {
      if (fromIndex === toIndex) continue;
      const candidate = [...before];
      const [moved] = candidate.splice(fromIndex, 1);
      candidate.splice(toIndex, 0, moved);
      if (exactList(candidate, proposed)) return true;
    }
  }
  return false;
}

function success(form, definition, reason, consequence) {
  const reconciliationRequired = [...definition.reconciliation];
  return immutableResult({
    ok: true,
    form,
    dirtyFields: [...definition.dirtyFields],
    acknowledgement: {
      kind: "preview",
      state: "draft_updated",
      actionId: definition.actionId,
      objectId: definition.objectId,
      reason,
      consequence,
      nextResolutions: [
        "Review the recalculated draft consequences.",
        "Use the outcome-named save only after the preview is acceptable."
      ],
      reconciliationRequired,
      inclusionReconciliationRequired: reconciliationRequired.includes(
        "selection.packageInclusions"
      ),
      saveRequired: true
    }
  });
}

function applyPackageReplacement(form, change, definition, records) {
  if (
    !exactKeys(change, [
      "state",
      "actionId",
      "authority",
      "commit",
      "target",
      "catalogScope",
      "before",
      "proposed",
      "candidate",
      "consequencePreviewRequired",
      "requiresOutcomeNamedSave"
    ])
    || !exactKeys(change.before, ["packageId"])
    || !exactKeys(change.proposed, ["packageId", "packageName"])
    || !strictId(change.before.packageId)
    || !strictId(change.proposed.packageId)
    || !strictText(change.proposed.packageName)
    || change.proposed.packageId === change.before.packageId
    || form.pkg !== change.before.packageId
    || change.candidate.id !== change.proposed.packageId
    || change.candidate.name !== change.proposed.packageName
    || !exactCandidate(
      change.candidate,
      records.packages.get(change.candidate.id)
    )
  ) return null;

  const nextForm = { ...form, pkg: change.candidate.id };
  return success(
    nextForm,
    definition,
    `${change.candidate.name} replaced the exact prior package in this editor draft.`,
    "The package id is staged only. Package inclusions remain unchanged and require explicit trusted reconciliation before save."
  );
}

function applyMenuReplacement(form, change, definition, records) {
  const selected = selectedMenuForm(form, records);
  if (
    !selected
    || !exactKeys(change, [
      "state",
      "actionId",
      "authority",
      "commit",
      "target",
      "catalogScope",
      "before",
      "proposed",
      "candidate",
      "consequencePreviewRequired",
      "requiresOutcomeNamedSave"
    ])
    || !exactKeys(change.before, ["itemId", "orderIndex", "quantity"])
    || !exactKeys(change.proposed, ["itemId", "orderIndex", "quantity", "quantityPolicy"])
    || !strictId(change.before.itemId)
    || !strictId(change.proposed.itemId)
    || !Number.isSafeInteger(change.before.orderIndex)
    || !Number.isSafeInteger(change.before.quantity)
    || change.before.orderIndex < 0
    || change.before.orderIndex >= selected.order.length
    || change.proposed.orderIndex !== change.before.orderIndex
    || change.proposed.quantity !== change.before.quantity
    || change.proposed.quantityPolicy !== "preserve_explicit_saved_quantity"
    || selected.order[change.before.orderIndex] !== change.before.itemId
    || selected.quantities[change.before.itemId] !== change.before.quantity
    || selected.order.includes(change.proposed.itemId)
    || Object.prototype.hasOwnProperty.call(selected.quantities, change.proposed.itemId)
    || change.candidate.id !== change.proposed.itemId
    || !exactCandidate(
      change.candidate,
      records.menuItems.get(change.candidate.id),
      { menu: true }
    )
  ) return null;

  const nextItems = [...selected.order];
  nextItems[change.before.orderIndex] = change.proposed.itemId;
  const nextQuantities = { ...selected.quantities };
  delete nextQuantities[change.before.itemId];
  nextQuantities[change.proposed.itemId] = change.before.quantity;
  const nextForm = {
    ...form,
    menuItems: nextItems,
    menuItemQuantities: nextQuantities
  };
  return success(
    nextForm,
    definition,
    `${change.candidate.name} replaced the exact selected menu item in this editor draft.`,
    `The explicit quantity of ${change.before.quantity} was preserved and moved to the replacement id; snapshot, name, and inclusion evidence still require trusted reconciliation.`
  );
}

function applyMenuReorder(form, change, definition, records) {
  const selected = selectedMenuForm(form, records);
  if (
    !selected
    || !exactKeys(change, [
      "state",
      "actionId",
      "authority",
      "commit",
      "target",
      "catalogScope",
      "before",
      "proposed",
      "interaction",
      "consequencePreviewRequired",
      "requiresOutcomeNamedSave"
    ])
    || !exactKeys(change.before, ["order"])
    || !exactKeys(change.proposed, ["order"])
    || !exactKeys(change.interaction, ["method", "equivalence"])
    || !["pointer", "keyboard"].includes(change.interaction.method)
    || change.interaction.equivalence !== "pointer_and_keyboard_produce_the_same_order_intent"
    || !exactList(selected.order, change.before.order)
    || change.proposed.order.length !== selected.order.length
    || change.proposed.order.some((id) => !strictId(id) || !records.menuItems.has(id))
    || new Set(change.proposed.order).size !== change.proposed.order.length
    || !exactSingleMove(change.before.order, change.proposed.order)
  ) return null;

  const nextForm = {
    ...form,
    menuItems: [...change.proposed.order],
    menuItemQuantities: { ...selected.quantities }
  };
  return success(
    nextForm,
    definition,
    "The exact requested menu order is now staged in this editor draft.",
    "Every menu quantity is unchanged. Snapshot and display-name evidence still require trusted reconciliation before save."
  );
}

/**
 * Applies one already-normalized Package/Menu pending-review change to an
 * isolated editor-draft copy. This function performs no pricing, persistence,
 * authorization, network, or catalog reads.
 */
export function adoptAmbientPackageMenuDraftChange({
  ambientDraftIntent = null,
  form = null,
  catalogContext = null
} = {}) {
  let currentForm;
  try {
    currentForm = cloneDraftValue(form);
  } catch (error) {
    return recovery(
      null,
      "ambient_package_menu_adoption_form_invalid",
      error?.message || "The current editor draft could not be safely isolated.",
      "Reload the exact saved quote into a clean editor draft, then recreate the package or menu outcome."
    );
  }
  if (!isRecord(currentForm)) {
    return recovery(
      null,
      "ambient_package_menu_adoption_form_invalid",
      "The current editor draft is not a plain record.",
      "Reload the exact saved quote into a clean editor draft, then recreate the package or menu outcome."
    );
  }

  const kind = typeof ambientDraftIntent?.kind === "string"
    ? ambientDraftIntent.kind
    : "";
  const definition = CHANGE_DEFINITIONS[kind];
  if (!definition || !validCommonIntent(ambientDraftIntent, definition, catalogContext)) {
    return recovery(
      currentForm,
      "ambient_package_menu_adoption_intent_invalid",
      "The handoff is not one exact, fresh, draft-only Package/Menu pending-review change.",
      "Refresh the opportunity and recreate one exact package or menu outcome from the current tenant catalog."
    );
  }
  const records = validateCatalogRecords(catalogContext);
  if (!records) {
    return recovery(
      currentForm,
      "ambient_package_menu_adoption_catalog_invalid",
      "The current tenant catalog contains ambiguous or unsupported package or menu evidence.",
      "Reload the exact tenant catalog and recreate the package or menu outcome."
    );
  }

  let result = null;
  try {
    if (kind === "replace_package") {
      result = applyPackageReplacement(currentForm, ambientDraftIntent.draftChange, definition, records);
    } else if (kind === "replace_menu_item") {
      result = applyMenuReplacement(currentForm, ambientDraftIntent.draftChange, definition, records);
    } else if (kind === "reorder_menu") {
      result = applyMenuReorder(currentForm, ambientDraftIntent.draftChange, definition, records);
    }
  } catch {
    result = null;
  }
  return result || recovery(
    currentForm,
    "ambient_package_menu_adoption_drift",
    "The current editor selection, order, quantity, or catalog candidate no longer exactly matches the pending change.",
    "Keep the current draft, refresh the opportunity evidence, and recreate the package or menu outcome."
  );
}
