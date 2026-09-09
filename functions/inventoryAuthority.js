"use strict";

const inventory = require("./inventoryIngredientCore.cjs");

const COLLECTIONS = Object.freeze({
  locations: "inventoryLocations",
  ingredients: "inventoryIngredients",
  movements: "inventoryMovements",
  stockStates: "inventoryStockStates",
  costEvidence: "inventoryCostEvidence",
  costStates: "inventoryCostStates",
  authorityState: "inventoryAuthorityState",
  receipts: "inventoryAuthorityReceipts",
  workspaceProjections: "inventoryWorkspaceProjections",
  ingredientProjections: "inventoryIngredientProjections"
});
const WORKSPACE_LIMIT = 200;
const COMMAND_KINDS = new Set([
  "upsert_location", "upsert_ingredient", "opening_balance", "record_ingredient_cost"
]);

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys, label) {
  if (!isRecord(value) || Object.keys(value).length !== keys.length
    || keys.some((key) => !Object.hasOwn(value, key))) {
    throw new inventory.InventoryIngredientError("invalid-argument", `${label} contains missing or unsupported fields.`);
  }
}

function normalizeCommand(value) {
  if (!isRecord(value) || !COMMAND_KINDS.has(value.kind)) {
    throw new inventory.InventoryIngredientError("invalid-argument", "A supported ingredient inventory command is required.");
  }
  if (value.kind === "upsert_location") inventory.normalizeLocationRequest(value);
  else if (value.kind === "upsert_ingredient") inventory.normalizeIngredientRequest(value);
  else if (value.kind === "opening_balance") inventory.normalizeOpeningBalanceRequest(value);
  else inventory.normalizeCostEvidenceRequest(value);
  return inventory.canonicalClone(value, "ingredient inventory command");
}

function normalizeApplyEnvelope(data) {
  exactKeys(data, ["schemaVersion", "organizationId", "requestId", "command"], "Ingredient inventory command envelope");
  if (data.schemaVersion !== inventory.INVENTORY_SCHEMA_VERSION) {
    throw new inventory.InventoryIngredientError("invalid-argument", "Ingredient inventory command schemaVersion is unsupported.");
  }
  return Object.freeze({
    schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
    organizationId: inventory.opaqueId(data.organizationId, "organizationId"),
    requestId: inventory.requestId(data.requestId),
    command: Object.freeze(normalizeCommand(data.command))
  });
}

function normalizeWorkspaceEnvelope(data) {
  exactKeys(data, ["schemaVersion", "organizationId"], "Ingredient inventory workspace request");
  if (data.schemaVersion !== inventory.INVENTORY_SCHEMA_VERSION) {
    throw new inventory.InventoryIngredientError("invalid-argument", "Ingredient inventory workspace schemaVersion is unsupported.");
  }
  return Object.freeze({
    schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
    organizationId: inventory.opaqueId(data.organizationId, "organizationId")
  });
}

function receiptIdFor(organizationId, retryId) {
  return `iar_${inventory.digest({
    organizationId: inventory.opaqueId(organizationId, "organizationId"),
    requestId: inventory.requestId(retryId)
  }).slice(0, 48)}`;
}

function safeLocation(location) {
  return Object.freeze({
    schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
    locationId: location.locationId,
    name: location.name,
    active: location.active,
    revision: location.revision,
    updatedAtISO: location.updatedAtISO
  });
}

function projectedLocation(location) {
  return Object.freeze({
    locationId: location.locationId,
    name: location.name,
    active: location.active,
    revision: location.revision
  });
}

function projectStockAxis(stockStates) {
  if (stockStates.length > 1) {
    throw new inventory.InventoryIngredientError(
      "failed-precondition",
      "Ingredient stock currently supports one authoritative location. Multiple states require an explicit later-phase aggregation policy."
    );
  }
  if (!stockStates.length) {
    return Object.freeze({
      availability: "not_yet_available",
      stockRevision: 0,
      onHandMicros: 0,
      quantity: "0",
      locationId: "",
      lastMovementId: ""
    });
  }
  const [state] = stockStates;
  return Object.freeze({
    availability: "current",
    stockRevision: state.revision,
    onHandMicros: state.onHandMicros,
    quantity: inventory.formatQuantityMicros(state.onHandMicros),
    locationId: state.locationId,
    lastMovementId: state.lastMovementId
  });
}

function projectCostAxis(costState) {
  if (!costState) return Object.freeze({
    availability: "not_yet_available",
    costRevision: 0,
    sourceLabel: "",
    observedAtISO: "",
    lastCostEvidenceId: ""
  });
  const result = {
    availability: costState.availability,
    costRevision: costState.revision,
    sourceLabel: costState.sourceLabel,
    observedAtISO: costState.observedAtISO,
    lastCostEvidenceId: costState.lastCostEvidenceId
  };
  if (costState.availability === "available") {
    Object.assign(result, {
      basisQuantityMicros: costState.basisQuantityMicros,
      totalCostMinor: costState.totalCostMinor,
      currency: costState.currency
    });
  }
  return Object.freeze(result);
}

function ingredientProjection({ ingredient, stockStates, costState, nowISO }) {
  const stock = projectStockAxis(stockStates);
  const cost = projectCostAxis(costState);
  return Object.freeze({
    authorityVersion: inventory.INVENTORY_AUTHORITY_VERSION,
    schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
    model: "inventory-ingredient-projection-v2",
    organizationId: ingredient.organizationId,
    ingredientId: ingredient.ingredientId,
    name: ingredient.name,
    nameSortKey: ingredient.nameSortKey,
    category: ingredient.category,
    baseUnitId: ingredient.baseUnitId,
    dimension: ingredient.dimension,
    active: ingredient.active,
    ingredientRevision: ingredient.revision,
    stock,
    cost,
    updatedAtISO: nowISO
  });
}

function publicReceipt(receipt) {
  return Object.freeze({
    schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
    organizationId: receipt.organizationId,
    receiptId: receipt.receiptId,
    requestId: receipt.requestId,
    commandKind: receipt.commandKind,
    recordedAtISO: receipt.recordedAtISO
  });
}

function publicOutcome(receipt, idempotent) {
  return Object.freeze({
    ok: true,
    schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
    organizationId: receipt.organizationId,
    commandKind: receipt.commandKind,
    idempotent,
    receipt: publicReceipt(receipt),
    result: receipt.result
  });
}

function verifyConfigurationState(value, organizationId) {
  exactKeys(value, [
    "authorityVersion", "schemaVersion", "model", "organizationId", "stateId",
    "locationCount", "ingredientCount", "revision", "updatedAtISO"
  ], "Ingredient inventory configuration state");
  if (value.authorityVersion !== inventory.INVENTORY_AUTHORITY_VERSION
    || value.schemaVersion !== inventory.INVENTORY_SCHEMA_VERSION
    || value.model !== "inventory-configuration-state-v2"
    || value.organizationId !== organizationId || value.stateId !== "ingredient-v2"
    || !Number.isSafeInteger(value.locationCount) || value.locationCount < 0 || value.locationCount > WORKSPACE_LIMIT
    || !Number.isSafeInteger(value.ingredientCount) || value.ingredientCount < 0 || value.ingredientCount > WORKSPACE_LIMIT) {
    throw new inventory.InventoryIngredientError("data-loss", "Ingredient inventory configuration state is invalid.");
  }
  inventory.revision(value.revision, "configuration revision", { allowZero: false });
  if (value.revision !== value.locationCount + value.ingredientCount) {
    throw new inventory.InventoryIngredientError("data-loss", "Ingredient inventory configuration revision is inconsistent.");
  }
  inventory.exactISO(value.updatedAtISO, "configuration updatedAtISO");
  return value;
}

function advanceConfigurationState({ current, organizationId, increment, nowISO }) {
  const prior = current || {
    locationCount: 0,
    ingredientCount: 0,
    revision: 0
  };
  const field = increment === "location" ? "locationCount" : "ingredientCount";
  if (prior[field] >= WORKSPACE_LIMIT) {
    throw new inventory.InventoryIngredientError(
      "resource-exhausted",
      `Ingredient inventory currently supports at most ${WORKSPACE_LIMIT} ${increment} records per organization.`
    );
  }
  return Object.freeze({
    authorityVersion: inventory.INVENTORY_AUTHORITY_VERSION,
    schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
    model: "inventory-configuration-state-v2",
    organizationId,
    stateId: "ingredient-v2",
    locationCount: prior.locationCount + (increment === "location" ? 1 : 0),
    ingredientCount: prior.ingredientCount + (increment === "ingredient" ? 1 : 0),
    revision: prior.revision + 1,
    updatedAtISO: nowISO
  });
}

function verifyWorkspaceProjection(value, organizationId) {
  exactKeys(value, [
    "authorityVersion", "schemaVersion", "model", "organizationId", "projectionId",
    "workspaceRevision", "locations", "updatedAtISO"
  ], "Ingredient inventory workspace projection");
  if (value.authorityVersion !== inventory.INVENTORY_AUTHORITY_VERSION
    || value.schemaVersion !== inventory.INVENTORY_SCHEMA_VERSION
    || value.model !== "inventory-workspace-projection-v2"
    || value.organizationId !== organizationId || value.projectionId !== "current") {
    throw new inventory.InventoryIngredientError("data-loss", "Ingredient inventory workspace projection identity is invalid.");
  }
  inventory.revision(value.workspaceRevision, "workspaceRevision", { allowZero: false });
  inventory.exactISO(value.updatedAtISO, "workspace updatedAtISO");
  if (!Array.isArray(value.locations) || value.locations.length > WORKSPACE_LIMIT) {
    throw new inventory.InventoryIngredientError("data-loss", "Ingredient inventory workspace location projection is invalid.");
  }
  value.locations.forEach((location) => {
    exactKeys(location, ["locationId", "name", "active", "revision"], "Projected inventory location");
    inventory.opaqueId(location.locationId, "projected locationId");
    inventory.revision(location.revision, "projected location revision", { allowZero: false });
    if (typeof location.name !== "string" || typeof location.active !== "boolean") {
      throw new inventory.InventoryIngredientError("data-loss", "Projected inventory location fields are invalid.");
    }
  });
  return value;
}

function verifyIngredientProjection(value, organizationId, ingredientId) {
  exactKeys(value, [
    "authorityVersion", "schemaVersion", "model", "organizationId", "ingredientId", "name",
    "nameSortKey", "category", "baseUnitId", "dimension", "active", "ingredientRevision",
    "stock", "cost", "updatedAtISO"
  ], "Ingredient inventory projection");
  if (value.authorityVersion !== inventory.INVENTORY_AUTHORITY_VERSION
    || value.schemaVersion !== inventory.INVENTORY_SCHEMA_VERSION
    || value.model !== "inventory-ingredient-projection-v2"
    || value.organizationId !== organizationId || value.ingredientId !== ingredientId) {
    throw new inventory.InventoryIngredientError("data-loss", "Ingredient inventory projection identity is invalid.");
  }
  const unit = inventory.baseUnitId(value.baseUnitId);
  inventory.revision(value.ingredientRevision, "projected ingredient revision", { allowZero: false });
  inventory.exactISO(value.updatedAtISO, "ingredient projection updatedAtISO");
  if (typeof value.active !== "boolean" || typeof value.name !== "string"
    || typeof value.nameSortKey !== "string" || typeof value.category !== "string"
    || value.nameSortKey !== value.name.toLocaleLowerCase("en-US")
    || value.dimension !== inventory.BASE_UNITS[unit]) {
    throw new inventory.InventoryIngredientError("data-loss", "Ingredient inventory projection fields are invalid.");
  }
  exactKeys(value.stock, [
    "availability", "stockRevision", "onHandMicros", "quantity", "locationId", "lastMovementId"
  ], "Ingredient stock projection");
  if (!new Set(["current", "not_yet_available"]).has(value.stock.availability)) {
    throw new inventory.InventoryIngredientError("data-loss", "Ingredient stock projection availability is invalid.");
  }
  const stockRevision = inventory.revision(value.stock.stockRevision, "projected stock revision");
  if (inventory.formatQuantityMicros(value.stock.onHandMicros) !== value.stock.quantity
    || (value.stock.availability === "not_yet_available"
      && (stockRevision !== 0 || value.stock.onHandMicros !== 0 || value.stock.locationId || value.stock.lastMovementId))
    || (value.stock.availability === "current"
      && (stockRevision < 1 || !/^imv_[a-f0-9]{48}$/u.test(value.stock.lastMovementId)))) {
    throw new inventory.InventoryIngredientError("data-loss", "Ingredient stock projection quantity is invalid.");
  }
  if (value.stock.availability === "current") inventory.opaqueId(value.stock.locationId, "projected stock locationId");
  const costKeys = ["availability", "costRevision", "sourceLabel", "observedAtISO", "lastCostEvidenceId"];
  if (value.cost.availability === "available") {
    costKeys.push("basisQuantityMicros", "totalCostMinor", "currency");
  }
  exactKeys(value.cost, costKeys, "Ingredient cost projection");
  if (!inventory.COST_AVAILABILITY.includes(value.cost.availability)) {
    throw new inventory.InventoryIngredientError("data-loss", "Ingredient cost projection availability is invalid.");
  }
  const costRevision = inventory.revision(value.cost.costRevision, "projected cost revision");
  if (costRevision === 0 && (value.cost.availability !== "not_yet_available"
    || value.cost.sourceLabel || value.cost.observedAtISO || value.cost.lastCostEvidenceId)) {
    throw new inventory.InventoryIngredientError("data-loss", "Unrecorded ingredient cost projection is invalid.");
  }
  if (costRevision > 0) {
    inventory.exactISO(value.cost.observedAtISO, "projected cost observedAtISO");
    if (typeof value.cost.sourceLabel !== "string" || !value.cost.sourceLabel
      || !/^ice_[a-f0-9]{48}$/u.test(value.cost.lastCostEvidenceId)) {
      throw new inventory.InventoryIngredientError("data-loss", "Ingredient cost projection lacks evidence provenance.");
    }
  }
  if (value.cost.availability === "available") {
    inventory.formatQuantityMicros(value.cost.basisQuantityMicros, "projected basisQuantityMicros");
    if (!Number.isSafeInteger(value.cost.totalCostMinor) || value.cost.totalCostMinor < 0
      || !/^[A-Z]{3}$/u.test(value.cost.currency)) {
      throw new inventory.InventoryIngredientError("data-loss", "Available ingredient cost projection is invalid.");
    }
  }
  return value;
}

function createInventoryAuthorityRuntime({
  db, FieldValue, HttpsError, assertStaff, normalizeOrganizationId,
  isOrganizationRecordActive, globalEnabled, logger = { error() {} },
  now = () => new Date().toISOString()
}) {
  if (!db || !FieldValue || !HttpsError || typeof assertStaff !== "function"
    || typeof normalizeOrganizationId !== "function" || typeof isOrganizationRecordActive !== "function"
    || typeof globalEnabled !== "function" || typeof now !== "function") {
    throw new TypeError("Ingredient inventory authority runtime dependencies are required.");
  }

  function refsFor(organizationId) {
    const organizationRef = db.collection("organizations").doc(organizationId);
    return {
      organizationRef,
      tombstoneRef: db.collection("organizationTombstones").doc(organizationId),
      settingsRef: organizationRef.collection("settings").doc("config"),
      roleRef: (uid) => db.collection("userRoles").doc(uid),
      locations: organizationRef.collection(COLLECTIONS.locations),
      ingredients: organizationRef.collection(COLLECTIONS.ingredients),
      movements: organizationRef.collection(COLLECTIONS.movements),
      stockStates: organizationRef.collection(COLLECTIONS.stockStates),
      costEvidence: organizationRef.collection(COLLECTIONS.costEvidence),
      costStates: organizationRef.collection(COLLECTIONS.costStates),
      configurationStateRef: organizationRef.collection(COLLECTIONS.authorityState).doc("ingredient-v2"),
      receipts: organizationRef.collection(COLLECTIONS.receipts),
      workspaceProjectionRef: organizationRef.collection(COLLECTIONS.workspaceProjections).doc("current"),
      ingredientProjections: organizationRef.collection(COLLECTIONS.ingredientProjections)
    };
  }

  function actorFor(staff, organizationId) {
    return inventory.normalizeActor({
      uid: staff?.uid,
      email: staff?.email,
      role: String(staff?.role || "").trim().toLowerCase(),
      organizationId: normalizeOrganizationId(staff?.principalOrganizationId || staff?.organizationId)
    }, organizationId);
  }

  function assertStoredAuthority({ organizationId, actor, roleSnap, organizationSnap, tombstoneSnap, settingsSnap }) {
    if (!roleSnap.exists || !organizationSnap.exists || tombstoneSnap.exists || !settingsSnap.exists) {
      throw new inventory.InventoryIngredientError("failed-precondition", "Current ingredient inventory authority is unavailable.");
    }
    const role = roleSnap.data() || {};
    const storedEmail = String(role.email || "").trim().toLowerCase();
    if (normalizeOrganizationId(role.organizationId) !== organizationId
      || String(role.role || "").trim().toLowerCase() !== "admin"
      || actor.role !== "admin"
      || (storedEmail && storedEmail !== actor.email.toLowerCase())
      || !isOrganizationRecordActive(organizationSnap.data() || {})) {
      throw new inventory.InventoryIngredientError("permission-denied", "Ingredient inventory authority changed. Refresh access before continuing.");
    }
    if (globalEnabled(organizationId) !== true || settingsSnap.data()?.inventoryAuthorityEnabled !== true) {
      throw new inventory.InventoryIngredientError("failed-precondition", "Ingredient inventory authority is not enabled for this environment and organization.");
    }
  }

  async function readAuthorityEnvelope(tx, refs, actor) {
    const [roleSnap, organizationSnap, tombstoneSnap, settingsSnap] = await tx.getAll(
      refs.roleRef(actor.uid), refs.organizationRef, refs.tombstoneRef, refs.settingsRef
    );
    assertStoredAuthority({
      organizationId: actor.organizationId, actor, roleSnap, organizationSnap, tombstoneSnap, settingsSnap
    });
  }

  function storedCanonical(value, kind, identity) {
    if (kind === "location") inventory.verifyLocation(value, {
      ...identity,
      locationId: identity.locationId || value?.locationId
    });
    else if (kind === "ingredient") inventory.verifyIngredient(value, {
      ...identity,
      ingredientId: identity.ingredientId || value?.ingredientId
    });
    else if (kind === "stock state") inventory.verifyStockState(value, {
      ...identity,
      locationId: identity.locationId || value?.locationId
    });
    else if (kind === "cost state") inventory.verifyCostState(value, identity);
    else throw new inventory.InventoryIngredientError("data-loss", "Stored ingredient inventory kind is unsupported.");
    const storedDocumentId = kind === "location" ? value.locationId
      : kind === "ingredient" ? value.ingredientId
        : kind === "stock state" ? value.stockStateId : value.costStateId;
    if (identity.documentId && identity.documentId !== storedDocumentId) {
      throw new inventory.InventoryIngredientError("data-loss", `Stored ingredient inventory ${kind} is filed under the wrong document identity.`);
    }
    return value;
  }

  function verifyReceipt(wrapper, claim) {
    const receipt = wrapper?.receipt;
    if (!isRecord(receipt)) {
      throw new inventory.InventoryIngredientError("data-loss", "Ingredient inventory receipt is unavailable.");
    }
    const { receiptDigest, ...body } = receipt;
    if (receiptDigest !== inventory.digest(body, "ingredient inventory receipt")) {
      throw new inventory.InventoryIngredientError("data-loss", "Ingredient inventory receipt failed integrity validation.");
    }
    if (receipt.authorityVersion !== inventory.INVENTORY_AUTHORITY_VERSION
      || receipt.schemaVersion !== inventory.INVENTORY_SCHEMA_VERSION
      || receipt.organizationId !== claim.organizationId || receipt.receiptId !== claim.receiptId
      || receipt.requestId !== claim.requestId) {
      throw new inventory.InventoryIngredientError("data-loss", "Ingredient inventory receipt identity is invalid.");
    }
    if (receipt.commandKind !== claim.commandKind || receipt.commandDigest !== claim.commandDigest) {
      throw new inventory.InventoryIngredientError("already-exists", "This request identity belongs to a different immutable ingredient inventory command.");
    }
    return receipt;
  }

  async function readIngredientInputs(tx, refs, organizationId, ingredientId) {
    const ingredientRef = refs.ingredients.doc(ingredientId);
    const costRef = refs.costStates.doc(inventory.costStateId(ingredientId));
    const stockQuery = refs.stockStates.where("ingredientId", "==", ingredientId).limit(WORKSPACE_LIMIT + 1);
    const [ingredientSnap, costSnap, stockSnap] = await Promise.all([
      tx.get(ingredientRef), tx.get(costRef), tx.get(stockQuery)
    ]);
    const ingredient = ingredientSnap.exists
      ? storedCanonical(ingredientSnap.data() || {}, "ingredient", {
        organizationId, ingredientId, documentId: ingredientSnap.id
      }) : null;
    if (stockSnap.size > WORKSPACE_LIMIT) {
      throw new inventory.InventoryIngredientError("resource-exhausted", "Ingredient stock projection exceeds its bounded location limit.");
    }
    const stockStates = stockSnap.docs.map((doc) => storedCanonical(doc.data() || {}, "stock state", {
      organizationId, ingredientId, documentId: doc.id
    }));
    const costState = costSnap.exists
      ? storedCanonical(costSnap.data() || {}, "cost state", {
        organizationId, ingredientId, documentId: costSnap.id
      }) : null;
    if (!ingredient && (stockStates.length || costState)) {
      throw new inventory.InventoryIngredientError("data-loss", "Ingredient evidence exists without its ingredient authority.");
    }
    if (ingredient && (stockStates.some((state) => state.baseUnitId !== ingredient.baseUnitId)
      || (costState && costState.baseUnitId !== ingredient.baseUnitId))) {
      throw new inventory.InventoryIngredientError("data-loss", "Ingredient evidence base units do not match the ingredient authority.");
    }
    return { ingredientRef, costRef, ingredient, costState, stockStates };
  }

  function commandResult(commandKind, planned) {
    if (commandKind === "upsert_location") return safeLocation(planned.location);
    if (commandKind === "upsert_ingredient") return Object.freeze({
      schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
      ingredientId: planned.ingredient.ingredientId,
      revision: planned.ingredient.revision,
      baseUnitId: planned.ingredient.baseUnitId,
      active: planned.ingredient.active
    });
    if (commandKind === "opening_balance") return Object.freeze({
      schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
      ingredientId: planned.movement.ingredientId,
      locationId: planned.movement.locationId,
      movementId: planned.movement.movementId,
      stockRevision: planned.nextStockState.revision,
      onHandMicros: planned.nextStockState.onHandMicros,
      onHandQuantity: inventory.formatQuantityMicros(planned.nextStockState.onHandMicros)
    });
    return Object.freeze({
      schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
      ingredientId: planned.costEvidence.ingredientId,
      costEvidenceId: planned.costEvidence.costEvidenceId,
      costRevision: planned.nextCostState.revision,
      availability: planned.nextCostState.availability
    });
  }

  async function applyInventoryCommand(data = {}, context = {}) {
    try {
      const envelope = normalizeApplyEnvelope(data);
      const staff = await assertStaff(context, { expectedOrganizationId: envelope.organizationId });
      const actor = actorFor(staff, envelope.organizationId);
      const refs = refsFor(envelope.organizationId);
      const receiptId = receiptIdFor(envelope.organizationId, envelope.requestId);
      const receiptRef = refs.receipts.doc(receiptId);
      const commandDigest = inventory.digest({
        schemaVersion: envelope.schemaVersion,
        organizationId: envelope.organizationId,
        requestId: envelope.requestId,
        command: envelope.command,
        principal: { uid: actor.uid, organizationId: actor.organizationId }
      }, "ingredient inventory command");

      return await db.runTransaction(async (tx) => {
        const receiptSnap = await tx.get(receiptRef);
        await readAuthorityEnvelope(tx, refs, actor);
        if (receiptSnap.exists) {
          return publicOutcome(verifyReceipt(receiptSnap.data() || {}, {
            organizationId: envelope.organizationId,
            receiptId,
            requestId: envelope.requestId,
            commandKind: envelope.command.kind,
            commandDigest
          }), true);
        }

        const nowISO = inventory.exactISO(now(), "recordedAtISO");
        const commandKind = envelope.command.kind;
        let planned;
        let priorRevision = 0;
        const writes = [];

        if (commandKind === "upsert_location") {
          const locationRef = refs.locations.doc(envelope.command.locationId);
          const [locationSnap, locationsSnap, workspaceSnap, configurationSnap] = await Promise.all([
            tx.get(locationRef),
            tx.get(refs.locations.orderBy("name").limit(WORKSPACE_LIMIT + 1)),
            tx.get(refs.workspaceProjectionRef),
            tx.get(refs.configurationStateRef)
          ]);
          if (locationsSnap.size > WORKSPACE_LIMIT) {
            throw new inventory.InventoryIngredientError("resource-exhausted", "Inventory locations exceed the bounded workspace limit.");
          }
          const current = locationSnap.exists ? storedCanonical(locationSnap.data() || {}, "location", {
            organizationId: envelope.organizationId, locationId: envelope.command.locationId,
            documentId: locationSnap.id
          }) : null;
          const configuration = configurationSnap.exists
            ? verifyConfigurationState(configurationSnap.data() || {}, envelope.organizationId) : null;
          if ((current || locationsSnap.size > 0) && !configuration) {
            throw new inventory.InventoryIngredientError("data-loss", "Inventory locations exist without their configuration fence.");
          }
          if (configuration && configuration.locationCount !== locationsSnap.size) {
            throw new inventory.InventoryIngredientError("data-loss", "Inventory location count disagrees with its configuration fence.");
          }
          planned = inventory.planLocation({
            organizationId: envelope.organizationId, request: envelope.command, current, actor, nowISO
          });
          priorRevision = current?.revision || 0;
          const locations = locationsSnap.docs.filter((doc) => doc.id !== planned.location.locationId)
            .map((doc) => projectedLocation(storedCanonical(doc.data() || {}, "location", {
              organizationId: envelope.organizationId, documentId: doc.id
            })))
            .concat(projectedLocation(planned.location))
            .sort((left, right) => left.name.localeCompare(right.name) || left.locationId.localeCompare(right.locationId));
          const priorWorkspaceRevision = workspaceSnap.exists
            ? verifyWorkspaceProjection(workspaceSnap.data() || {}, envelope.organizationId).workspaceRevision : 0;
          inventory.revision(priorWorkspaceRevision, "workspaceRevision");
          writes.push({ operation: locationSnap.exists ? "set" : "create", ref: locationRef, value: planned.location });
          if (!current) writes.push({
            operation: configuration ? "set" : "create",
            ref: refs.configurationStateRef,
            value: advanceConfigurationState({
              current: configuration,
              organizationId: envelope.organizationId,
              increment: "location",
              nowISO
            })
          });
          writes.push({ operation: "set", ref: refs.workspaceProjectionRef, value: {
            authorityVersion: inventory.INVENTORY_AUTHORITY_VERSION,
            schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
            model: "inventory-workspace-projection-v2",
            organizationId: envelope.organizationId,
            projectionId: "current",
            workspaceRevision: priorWorkspaceRevision + 1,
            locations,
            updatedAtISO: nowISO
          } });
        } else {
          const ingredientId = envelope.command.ingredientId;
          const projectionRef = refs.ingredientProjections.doc(ingredientId);
          const inputs = await readIngredientInputs(tx, refs, envelope.organizationId, ingredientId);
          if (commandKind === "upsert_ingredient") {
            const configurationSnap = await tx.get(refs.configurationStateRef);
            const configuration = configurationSnap.exists
              ? verifyConfigurationState(configurationSnap.data() || {}, envelope.organizationId) : null;
            if (inputs.ingredient && !configuration) {
              throw new inventory.InventoryIngredientError("data-loss", "Inventory ingredients exist without their configuration fence.");
            }
            planned = inventory.planIngredient({
              organizationId: envelope.organizationId, request: envelope.command,
              current: inputs.ingredient, currentCostState: inputs.costState, actor, nowISO
            });
            priorRevision = inputs.ingredient?.revision || 0;
            writes.push({ operation: inputs.ingredient ? "set" : "create", ref: inputs.ingredientRef, value: planned.ingredient });
            if (!inputs.ingredient) writes.push({
              operation: configuration ? "set" : "create",
              ref: refs.configurationStateRef,
              value: advanceConfigurationState({
                current: configuration,
                organizationId: envelope.organizationId,
                increment: "ingredient",
                nowISO
              })
            });
            writes.push({ operation: "set", ref: projectionRef, value: ingredientProjection({
              ingredient: planned.ingredient, stockStates: inputs.stockStates, costState: inputs.costState, nowISO
            }) });
          } else if (commandKind === "opening_balance") {
            const stockRef = refs.stockStates.doc(inventory.stockStateId(ingredientId, envelope.command.locationId));
            const locationRef = refs.locations.doc(envelope.command.locationId);
            const [stockSnap, locationSnap] = await Promise.all([tx.get(stockRef), tx.get(locationRef)]);
            const stockState = stockSnap.exists ? storedCanonical(stockSnap.data() || {}, "stock state", {
              organizationId: envelope.organizationId, ingredientId, locationId: envelope.command.locationId,
              documentId: stockSnap.id
            }) : null;
            const location = locationSnap.exists ? storedCanonical(locationSnap.data() || {}, "location", {
              organizationId: envelope.organizationId, locationId: envelope.command.locationId,
              documentId: locationSnap.id
            }) : null;
            planned = inventory.planOpeningBalance({
              organizationId: envelope.organizationId, requestId: envelope.requestId,
              request: envelope.command, ingredient: inputs.ingredient, location,
              stockState, actor, nowISO
            });
            priorRevision = stockState?.revision || 0;
            const nextIngredient = Object.freeze({
              ...inputs.ingredient,
              firstMovementId: inputs.ingredient.firstMovementId || planned.movement.movementId,
              movementCount: (inputs.ingredient.movementCount || 0) + 1,
              updatedAtISO: nowISO,
              updatedBy: actor
            });
            const stockStates = inputs.stockStates.filter((state) => state.stockStateId !== planned.nextStockState.stockStateId)
              .concat(planned.nextStockState);
            writes.push({ operation: "create", ref: refs.movements.doc(planned.movement.movementId), value: planned.movement });
            writes.push({ operation: stockSnap.exists ? "set" : "create", ref: stockRef, value: planned.nextStockState });
            writes.push({ operation: "set", ref: inputs.ingredientRef, value: nextIngredient });
            writes.push({ operation: "set", ref: projectionRef, value: ingredientProjection({
              ingredient: nextIngredient, stockStates, costState: inputs.costState, nowISO
            }) });
          } else {
            planned = inventory.planIngredientCostEvidence({
              organizationId: envelope.organizationId, requestId: envelope.requestId,
              request: envelope.command, ingredient: inputs.ingredient,
              currentCostState: inputs.costState, actor, nowISO
            });
            priorRevision = inputs.costState?.revision || 0;
            writes.push({ operation: "create", ref: refs.costEvidence.doc(planned.costEvidence.costEvidenceId), value: planned.costEvidence });
            writes.push({ operation: inputs.costState ? "set" : "create", ref: inputs.costRef, value: planned.nextCostState });
            writes.push({ operation: "set", ref: projectionRef, value: ingredientProjection({
              ingredient: inputs.ingredient, stockStates: inputs.stockStates,
              costState: planned.nextCostState, nowISO
            }) });
          }
        }

        const result = commandResult(commandKind, planned);
        const resultRevision = commandKind === "upsert_location" ? planned.location.revision
          : commandKind === "upsert_ingredient" ? planned.ingredient.revision
            : commandKind === "opening_balance" ? planned.nextStockState.revision : planned.nextCostState.revision;
        const body = {
          authorityVersion: inventory.INVENTORY_AUTHORITY_VERSION,
          schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
          organizationId: envelope.organizationId,
          receiptId,
          requestId: envelope.requestId,
          commandKind,
          commandDigest,
          recordedAtISO: nowISO,
          recordedBy: actor,
          priorRevision,
          resultRevision,
          result
        };
        const receipt = Object.freeze({ ...body, receiptDigest: inventory.digest(body, "ingredient inventory receipt") });
        writes.push({ operation: "create", ref: receiptRef, value: {
          receipt, createdAt: FieldValue.serverTimestamp()
        } });
        for (const write of writes) tx[write.operation](write.ref, write.value);
        return publicOutcome(receipt, false);
      });
    } catch (error) {
      return throwFailure(error, "applyInventoryCommand");
    }
  }

  async function getInventoryWorkspace(data = {}, context = {}) {
    try {
      const envelope = normalizeWorkspaceEnvelope(data);
      const staff = await assertStaff(context, { expectedOrganizationId: envelope.organizationId });
      const actor = actorFor(staff, envelope.organizationId);
      const refs = refsFor(envelope.organizationId);
      return await db.runTransaction(async (tx) => {
        await readAuthorityEnvelope(tx, refs, actor);
        const [locationsSnap, projectionsSnap] = await Promise.all([
          tx.get(refs.locations.orderBy("name").limit(WORKSPACE_LIMIT + 1)),
          tx.get(refs.ingredientProjections.orderBy("nameSortKey").limit(WORKSPACE_LIMIT + 1))
        ]);
        if (locationsSnap.size > WORKSPACE_LIMIT || projectionsSnap.size > WORKSPACE_LIMIT) {
          throw new inventory.InventoryIngredientError("resource-exhausted", "Ingredient inventory workspace exceeds its bounded recovery limit.");
        }
        const locations = locationsSnap.docs.map((doc) => safeLocation(storedCanonical(doc.data() || {}, "location", {
          organizationId: envelope.organizationId, documentId: doc.id
        })));
        const ingredients = projectionsSnap.docs.map((doc) => {
          const projection = doc.data() || {};
          return verifyIngredientProjection(projection, envelope.organizationId, doc.id);
        });
        return Object.freeze({
          schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
          organizationId: envelope.organizationId,
          locations,
          ingredients,
          bounded: true,
          limit: WORKSPACE_LIMIT
        });
      });
    } catch (error) {
      return throwFailure(error, "getInventoryWorkspace");
    }
  }

  function throwFailure(error, operation) {
    if (error instanceof HttpsError) throw error;
    if (error instanceof inventory.InventoryIngredientError) throw new HttpsError(error.code, error.message);
    logger.error("Ingredient inventory authority failed.", {
      operation,
      errorName: String(error?.name || "Error"),
      errorMessage: String(error?.message || "Unknown failure")
    });
    throw new HttpsError("internal", "Ingredient inventory authority failed without a confirmed outcome. Retry the same request identity.");
  }

  return Object.freeze({ applyInventoryCommand, getInventoryWorkspace });
}

module.exports = {
  COLLECTIONS,
  WORKSPACE_LIMIT,
  createInventoryAuthorityRuntime,
  ingredientProjection,
  normalizeApplyEnvelope,
  normalizeWorkspaceEnvelope,
  receiptIdFor,
  verifyIngredientProjection,
  verifyWorkspaceProjection
};
