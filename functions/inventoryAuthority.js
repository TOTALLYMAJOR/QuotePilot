"use strict";

const inventory = require("./inventoryAuthorityCore.cjs");

const COLLECTIONS = Object.freeze({
  locations: "inventoryLocations",
  items: "inventoryItems",
  movements: "inventoryMovements",
  stockStates: "inventoryStockStates",
  authorityReceipts: "inventoryAuthorityReceipts",
  authorityState: "inventoryAuthorityState"
});
const WORKSPACE_LIMIT = 200;
const MOVEMENT_LIMIT = 100;
const COMMAND_SCHEMA_VERSION = 1;
const PHASE_ONE_MOVEMENT_KINDS = new Set(["opening_balance", "adjustment", "transfer"]);

function isPlainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(value, allowed, label) {
  if (!isPlainRecord(value)) {
    throw new inventory.InventoryAuthorityError("invalid-argument", `${label} must be an object.`);
  }
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) {
    throw new inventory.InventoryAuthorityError("invalid-argument", `${label} contains unsupported fields.`);
  }
}

function normalizeApplyEnvelope(data) {
  assertExactKeys(data, ["schemaVersion", "organizationId", "requestId", "command"], "Inventory command envelope");
  if (data.schemaVersion !== COMMAND_SCHEMA_VERSION) {
    throw new inventory.InventoryAuthorityError("invalid-argument", "Inventory command schemaVersion is unsupported.");
  }
  const organizationId = inventory.opaqueId(data.organizationId, "organizationId");
  const retryId = inventory.requestId(data.requestId);
  assertExactKeys(data.command, ["kind", "location", "item", "movement"], "Inventory command");
  const kind = String(data.command.kind || "").trim().toLowerCase();
  const expectedKeys = {
    upsert_location: ["kind", "location"],
    upsert_item: ["kind", "item"],
    record_movement: ["kind", "movement"]
  }[kind];
  if (!expectedKeys) {
    throw new inventory.InventoryAuthorityError("invalid-argument", "A supported inventory command kind is required.");
  }
  assertExactKeys(data.command, expectedKeys, `Inventory ${kind} command`);
  const normalizedCommand = inventory.canonicalClone(data.command, "Inventory command");
  normalizedCommand.kind = kind;
  return Object.freeze({
    schemaVersion: COMMAND_SCHEMA_VERSION,
    organizationId,
    requestId: retryId,
    command: normalizedCommand
  });
}

function normalizeWorkspaceEnvelope(data) {
  assertExactKeys(data, ["schemaVersion", "organizationId"], "Inventory workspace request");
  if (data.schemaVersion !== COMMAND_SCHEMA_VERSION) {
    throw new inventory.InventoryAuthorityError("invalid-argument", "Inventory workspace schemaVersion is unsupported.");
  }
  return Object.freeze({
    schemaVersion: COMMAND_SCHEMA_VERSION,
    organizationId: inventory.opaqueId(data.organizationId, "organizationId")
  });
}

function createInventoryAuthorityRuntime({
  db,
  FieldValue,
  HttpsError,
  assertStaff,
  normalizeOrganizationId,
  isOrganizationRecordActive,
  globalEnabled,
  logger = { error() {} }
}) {
  if (!db || !FieldValue || !HttpsError || typeof assertStaff !== "function"
    || typeof normalizeOrganizationId !== "function" || typeof isOrganizationRecordActive !== "function"
    || typeof globalEnabled !== "function") {
    throw new TypeError("Inventory authority runtime dependencies are required.");
  }

  function scopeFor(data = {}) {
    const organizationId = normalizeOrganizationId(data?.organizationId);
    try {
      return { organizationId: inventory.opaqueId(organizationId, "organizationId") };
    } catch (error) {
      throwFailure(error, "scope");
    }
  }

  function actorFor(staff, organizationId) {
    return inventory.normalizeActor({
      organizationId,
      principalOrganizationId: normalizeOrganizationId(staff?.principalOrganizationId),
      uid: staff?.uid,
      role: String(staff?.role || "").trim().toLowerCase()
    }, organizationId, { mutation: false });
  }

  function refsFor(organizationId) {
    const organizationRef = db.collection("organizations").doc(organizationId);
    return {
      organizationRef,
      tombstoneRef: db.collection("organizationTombstones").doc(organizationId),
      settingsRef: organizationRef.collection("settings").doc("config"),
      roleRef(uid) { return db.collection("userRoles").doc(uid); },
      locations: organizationRef.collection(COLLECTIONS.locations),
      items: organizationRef.collection(COLLECTIONS.items),
      movements: organizationRef.collection(COLLECTIONS.movements),
      stockStates: organizationRef.collection(COLLECTIONS.stockStates),
      authorityReceipts: organizationRef.collection(COLLECTIONS.authorityReceipts),
      authorityStateRef: organizationRef.collection(COLLECTIONS.authorityState).doc("current")
    };
  }

  function assertStoredPrincipal({ actor, organizationId, roleSnap, organizationSnap, tombstoneSnap, settingsSnap }) {
    if (!roleSnap?.exists || !organizationSnap?.exists || tombstoneSnap?.exists || !settingsSnap?.exists) {
      throw new inventory.InventoryAuthorityError("failed-precondition", "Current inventory organization authority is unavailable.");
    }
    const role = roleSnap.data() || {};
    if (normalizeOrganizationId(role.organizationId) !== organizationId
      || String(role.role || "").trim().toLowerCase() !== actor.role
      || !isOrganizationRecordActive(organizationSnap.data() || {})) {
      throw new inventory.InventoryAuthorityError("permission-denied", "Inventory authority changed. Refresh your access before continuing.");
    }
    inventory.assertEnabled(globalEnabled(organizationId) === true, settingsSnap.data() || {});
  }

  async function authorityEnvelope(tx, refs, actor) {
    const [roleSnap, organizationSnap, tombstoneSnap, settingsSnap] = await tx.getAll(
      refs.roleRef(actor.uid),
      refs.organizationRef,
      refs.tombstoneRef,
      refs.settingsRef
    );
    assertStoredPrincipal({
      actor,
      organizationId: actor.organizationId,
      roleSnap,
      organizationSnap,
      tombstoneSnap,
      settingsSnap
    });
    return { settings: settingsSnap.data() || {} };
  }

  function receiptIdFor(organizationId, retryId) {
    return `iar_${inventory.digest({ organizationId, requestId: inventory.requestId(retryId) }).slice(0, 48)}`;
  }

  function publicReceipt(receipt) {
    return Object.freeze({
      schemaVersion: COMMAND_SCHEMA_VERSION,
      organizationId: receipt.organizationId,
      receiptId: receipt.receiptId,
      requestId: receipt.requestId,
      commandKind: receipt.commandKind,
      recordedAtISO: receipt.recordedAtISO
    });
  }

  function verifyAuthorityReceipt(value, { organizationId, receiptId, requestId: retryId, commandKind, commandDigest, actor }) {
    if (!value || typeof value !== "object") throw new inventory.InventoryAuthorityError("data-loss", "Inventory authority receipt is unavailable.");
    const receipt = value.receipt || value;
    try {
      assertExactKeys(receipt, [
        "authorityVersion", "schemaVersion", "organizationId", "receiptId", "requestId",
        "commandKind", "commandDigest", "recordedAtISO", "recordedBy", "priorRevision",
        "resultRevision", "result", "receiptDigest"
      ], "Inventory authority receipt");
    } catch {
      throw new inventory.InventoryAuthorityError("data-loss", "Inventory authority receipt schema is invalid.");
    }
    const { receiptDigest, ...body } = receipt;
    let retainedDigest;
    try {
      retainedDigest = inventory.digest(body, "Inventory authority receipt");
    } catch {
      throw new inventory.InventoryAuthorityError("data-loss", "Inventory authority receipt contains invalid retained evidence.");
    }
    if (receiptDigest !== retainedDigest) {
      throw new inventory.InventoryAuthorityError("data-loss", "Inventory authority receipt failed integrity validation.");
    }
    let retainedActor;
    try {
      retainedActor = inventory.normalizeActor(receipt.recordedBy, organizationId, { mutation: true });
    } catch {
      throw new inventory.InventoryAuthorityError("data-loss", "Inventory authority receipt actor evidence is invalid.");
    }
    if (receipt.authorityVersion !== inventory.INVENTORY_AUTHORITY_VERSION
      || receipt.schemaVersion !== COMMAND_SCHEMA_VERSION
      || receipt.organizationId !== organizationId
      || receipt.receiptId !== receiptId
      || receipt.requestId !== retryId
      || receipt.commandKind !== commandKind
      || receipt.commandDigest !== commandDigest
      || inventory.digest(retainedActor) !== inventory.digest(actor)) {
      throw new inventory.InventoryAuthorityError("already-exists", "This request identity belongs to a different immutable inventory command.");
    }
    try {
      inventory.exactISO(receipt.recordedAtISO, "receipt recordedAtISO", "data-loss");
      inventory.revision(receipt.priorRevision, "receipt prior revision");
      inventory.revision(receipt.resultRevision, "receipt result revision", { allowZero: false });
    } catch {
      throw new inventory.InventoryAuthorityError("data-loss", "Inventory authority receipt revision or time evidence is invalid.");
    }
    if (receipt.resultRevision !== receipt.priorRevision + 1) {
      throw new inventory.InventoryAuthorityError("data-loss", "Inventory authority receipt revision transition is invalid.");
    }
    return receipt;
  }

  function verifyConfigurationReceiptResult(receipt, { commandKind, entity, entityId, organizationId }) {
    let retained;
    let expected;
    try {
      retained = commandKind === "upsert_location"
        ? inventory.verifyLocation(receipt.result)
        : inventory.verifyItem(receipt.result);
      const artificialCurrent = entity.expectedRevision === 0
        ? null
        : { ...retained, revision: entity.expectedRevision };
      expected = commandKind === "upsert_location"
        ? inventory.normalizeLocation({ ...entity, organizationId }, artificialCurrent)
        : inventory.normalizeItem(
          { ...entity, organizationId },
          artificialCurrent,
          { hasMovements: Boolean(retained.firstMovementId) }
        );
    } catch {
      throw new inventory.InventoryAuthorityError("data-loss", "Inventory configuration receipt result is invalid.");
    }
    const retainedId = commandKind === "upsert_location" ? retained.locationId : retained.itemId;
    if (retained.organizationId !== organizationId
      || retainedId !== entityId
      || retained.revision !== receipt.resultRevision
      || retained.updatedAtISO !== receipt.recordedAtISO
      || Object.keys(expected).some((key) => retained[key] !== expected[key])) {
      throw new inventory.InventoryAuthorityError("data-loss", "Inventory configuration receipt result does not match its immutable command.");
    }
    return retained;
  }

  async function applyConfigurationCommand({ envelope, actor, refs, nowISO }) {
    const commandKind = envelope.command.kind;
    const retryId = envelope.requestId;
    const entity = commandKind === "upsert_location" ? envelope.command.location : envelope.command.item;
    const request = inventory.canonicalClone({ commandKind, requestId: retryId, entity }, "Inventory configuration command");
    const receiptId = receiptIdFor(actor.organizationId, retryId);
    const commandDigest = inventory.digest({ request, actor }, "Inventory configuration command");
    const receiptRef = refs.authorityReceipts.doc(receiptId);
    const entityId = inventory.opaqueId(commandKind === "upsert_location" ? entity.locationId : entity.itemId, commandKind === "upsert_location" ? "locationId" : "itemId");
    const entityRef = commandKind === "upsert_location" ? refs.locations.doc(entityId) : refs.items.doc(entityId);
    return db.runTransaction(async (tx) => {
      const receiptSnap = await tx.get(receiptRef);
      await authorityEnvelope(tx, refs, actor);
      if (receiptSnap.exists) {
        const retained = verifyAuthorityReceipt(receiptSnap.data() || {}, {
          organizationId: actor.organizationId,
          receiptId,
          requestId: retryId,
          commandKind,
          commandDigest,
          actor
        });
        const retainedResult = verifyConfigurationReceiptResult(retained, {
          commandKind,
          entity,
          entityId,
          organizationId: actor.organizationId
        });
        return { idempotent: true, entity: retainedResult, receipt: publicReceipt(retained) };
      }
      inventory.normalizeActor(actor, actor.organizationId, { mutation: true });
      const entitySnap = await tx.get(entityRef);
      const current = entitySnap.exists ? entitySnap.data() || {} : null;
      if (commandKind === "upsert_item" && current) inventory.verifyItem(current);
      if (commandKind === "upsert_location" && current) inventory.verifyLocation(current);
      const result = commandKind === "upsert_location"
        ? inventory.normalizeLocation({ ...entity, organizationId: actor.organizationId }, current)
        : inventory.normalizeItem({ ...entity, organizationId: actor.organizationId }, current, { hasMovements: Boolean(current?.firstMovementId) });
      const resultWithEvidence = {
        ...result,
        ...(commandKind === "upsert_item" ? {
          movementCount: Number(current?.movementCount || 0),
          firstMovementId: String(current?.firstMovementId || ""),
          lastMovementId: String(current?.lastMovementId || ""),
          physicalUpdatedAtISO: String(current?.physicalUpdatedAtISO || "")
        } : {}),
        createdAtISO: current?.createdAtISO || nowISO,
        updatedAtISO: nowISO
      };
      const body = {
        authorityVersion: inventory.INVENTORY_AUTHORITY_VERSION,
        schemaVersion: COMMAND_SCHEMA_VERSION,
        organizationId: actor.organizationId,
        receiptId,
        requestId: retryId,
        commandKind,
        commandDigest,
        recordedAtISO: nowISO,
        recordedBy: actor,
        priorRevision: Number(current?.revision || 0),
        resultRevision: result.revision,
        result: resultWithEvidence
      };
      const receipt = { ...body, receiptDigest: inventory.digest(body, "Inventory authority receipt") };
      const timestamps = {
        createdAt: entitySnap.exists && entitySnap.data()?.createdAt ? entitySnap.data().createdAt : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      };
      if (entitySnap.exists) tx.set(entityRef, { ...resultWithEvidence, ...timestamps });
      else tx.create(entityRef, { ...resultWithEvidence, ...timestamps });
      tx.create(receiptRef, { receipt, createdAtISO: nowISO, createdAt: FieldValue.serverTimestamp() });
      return { idempotent: false, entity: resultWithEvidence, receipt: publicReceipt(receipt) };
    });
  }

  function authorityRevisionFrom(snapshot, organizationId) {
    if (!snapshot.exists) return 0;
    const value = snapshot.data() || {};
    if (value.authorityVersion !== inventory.INVENTORY_AUTHORITY_VERSION
      || value.schemaVersion !== inventory.INVENTORY_SCHEMA_VERSION
      || value.organizationId !== organizationId
      || !Number.isSafeInteger(value.inventoryRevision)
      || value.inventoryRevision < 1
      || value.inventoryRevision > 1_000_000_000
      || !/^imv_[a-f0-9]{48}$/u.test(String(value.lastMovementId || ""))) {
      throw new inventory.InventoryAuthorityError("data-loss", "Inventory authority revision evidence is invalid.");
    }
    return value.inventoryRevision;
  }

  async function applyMovementCommand({ envelope, actor, refs, nowISO }) {
    const commandKind = envelope.command.kind;
    const request = inventory.normalizeMovementRequest({
      ...envelope.command.movement,
      organizationId: actor.organizationId,
      requestId: envelope.requestId
    });
    if (!PHASE_ONE_MOVEMENT_KINDS.has(request.kind)) {
      throw new inventory.InventoryAuthorityError(
        "failed-precondition",
        "This inventory movement requires the event allocation and execution authority introduced in a later phase."
      );
    }
    const movementId = inventory.movementIdFor(actor.organizationId, request.requestId);
    const movementRef = refs.movements.doc(movementId);
    const receiptId = receiptIdFor(actor.organizationId, request.requestId);
    const receiptRef = refs.authorityReceipts.doc(receiptId);
    const commandDigest = inventory.digest({
      request: { commandKind, requestId: request.requestId, movement: request },
      actor
    }, "Inventory movement command");
    const itemRef = refs.items.doc(request.itemId);
    const locationIds = [...new Set([request.from?.locationId, request.to?.locationId].filter(Boolean))].sort();
    const locationRefs = locationIds.map((locationId) => refs.locations.doc(locationId));
    const stockRefs = locationIds.map((locationId) => refs.stockStates.doc(inventory.stockStateId(request.itemId, locationId)));
    return db.runTransaction(async (tx) => {
      const receiptSnap = await tx.get(receiptRef);
      await authorityEnvelope(tx, refs, actor);
      inventory.normalizeActor(actor, actor.organizationId, { mutation: true });
      if (receiptSnap.exists) {
        const retainedReceipt = verifyAuthorityReceipt(receiptSnap.data() || {}, {
          organizationId: actor.organizationId,
          receiptId,
          requestId: request.requestId,
          commandKind,
          commandDigest,
          actor
        });
        const movementSnap = await tx.get(movementRef);
        if (!movementSnap.exists) {
          throw new inventory.InventoryAuthorityError("data-loss", "Inventory movement receipt has no immutable movement evidence.");
        }
        const replay = inventory.planMovement({ request, actor, existingMovement: movementSnap.data() || {}, nowISO });
        const stock = Object.values(replay.nextStockStates).map(inventory.publicStockState);
        if (retainedReceipt.result?.movementId !== replay.movement.movementId
          || retainedReceipt.result?.inventoryRevision !== retainedReceipt.resultRevision
          || inventory.digest(retainedReceipt.result?.stock) !== inventory.digest(stock)) {
          throw new inventory.InventoryAuthorityError("data-loss", "Inventory movement receipt outcome is inconsistent.");
        }
        return { idempotent: true, movement: replay.movement, stock, inventoryRevision: retainedReceipt.resultRevision, receipt: publicReceipt(retainedReceipt) };
      }
      const [movementSnap, itemSnap, authorityStateSnap, ...remaining] = await tx.getAll(
        movementRef,
        itemRef,
        refs.authorityStateRef,
        ...locationRefs,
        ...stockRefs
      );
      if (movementSnap.exists) {
        throw new inventory.InventoryAuthorityError("data-loss", "Inventory movement evidence has no immutable command receipt.");
      }
      if (!itemSnap.exists || itemSnap.data()?.organizationId !== actor.organizationId || itemSnap.data()?.itemId !== request.itemId) {
        throw new inventory.InventoryAuthorityError("failed-precondition", "The inventory item is unavailable or outside this organization.");
      }
      const item = inventory.verifyItem(itemSnap.data() || {});
      if (item.movementCount >= 1_000_000_000) {
        throw new inventory.InventoryAuthorityError("resource-exhausted", "Inventory item movement count limit was reached.");
      }
      const addsOwnedStock = request.kind === "opening_balance" || (request.kind === "adjustment" && request.to != null);
      if (!item.active && addsOwnedStock) {
        throw new inventory.InventoryAuthorityError("failed-precondition", "New stock cannot be introduced for an inactive inventory item.");
      }
      const locationSnaps = remaining.slice(0, locationRefs.length);
      const stockSnaps = remaining.slice(locationRefs.length);
      locationSnaps.forEach((snapshot, index) => {
        if (!snapshot.exists) {
          throw new inventory.InventoryAuthorityError("failed-precondition", "A movement location is unavailable or outside this organization.");
        }
        const location = inventory.verifyLocation(snapshot.data() || {});
        if (location.organizationId !== actor.organizationId || location.locationId !== locationIds[index]) {
          throw new inventory.InventoryAuthorityError("failed-precondition", "A movement location is unavailable or outside this organization.");
        }
        if (!location.active && request.to?.locationId === locationIds[index]) {
          throw new inventory.InventoryAuthorityError("failed-precondition", "New stock cannot move into an inactive location.");
        }
      });
      const currentStockStates = Object.fromEntries(stockSnaps.map((snapshot, index) => [locationIds[index], snapshot.exists ? snapshot.data() || {} : null]));
      const planned = inventory.planMovement({ request, actor, currentStockStates, nowISO });
      const priorAuthorityRevision = authorityRevisionFrom(authorityStateSnap, actor.organizationId);
      if (priorAuthorityRevision >= 1_000_000_000) {
        throw new inventory.InventoryAuthorityError("resource-exhausted", "Inventory authority revision limit was reached.");
      }
      const authorityRevision = priorAuthorityRevision + 1;
      const stock = Object.values(planned.nextStockStates).map(inventory.publicStockState);
      const receiptResult = {
        movementId: planned.movement.movementId,
        inventoryRevision: authorityRevision,
        stock
      };
      const receiptBody = {
        authorityVersion: inventory.INVENTORY_AUTHORITY_VERSION,
        schemaVersion: COMMAND_SCHEMA_VERSION,
        organizationId: actor.organizationId,
        receiptId,
        requestId: request.requestId,
        commandKind,
        commandDigest,
        recordedAtISO: nowISO,
        recordedBy: actor,
        priorRevision: priorAuthorityRevision,
        resultRevision: authorityRevision,
        result: receiptResult
      };
      const receipt = {
        ...receiptBody,
        receiptDigest: inventory.digest(receiptBody, "Inventory authority receipt")
      };
      tx.create(movementRef, { ...planned.movement, createdAt: FieldValue.serverTimestamp() });
      locationIds.forEach((locationId, index) => {
        const stockRef = stockRefs[index];
        const priorSnap = stockSnaps[index];
        const state = planned.nextStockStates[locationId];
        const record = {
          ...state,
          createdAt: priorSnap.exists && priorSnap.data()?.createdAt ? priorSnap.data().createdAt : FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        };
        if (priorSnap.exists) tx.set(stockRef, record);
        else tx.create(stockRef, record);
      });
      tx.set(itemRef, {
        ...itemSnap.data(),
        movementCount: item.movementCount + 1,
        firstMovementId: item.firstMovementId || planned.movement.movementId,
        lastMovementId: planned.movement.movementId,
        physicalUpdatedAtISO: nowISO,
        updatedAt: FieldValue.serverTimestamp()
      });
      const authorityRecord = {
        authorityVersion: inventory.INVENTORY_AUTHORITY_VERSION,
        schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
        organizationId: actor.organizationId,
        inventoryRevision: authorityRevision,
        lastMovementId: planned.movement.movementId,
        updatedAtISO: nowISO,
        createdAtISO: authorityStateSnap.exists ? authorityStateSnap.data()?.createdAtISO : nowISO,
        createdAt: authorityStateSnap.exists && authorityStateSnap.data()?.createdAt ? authorityStateSnap.data().createdAt : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      };
      if (authorityStateSnap.exists) tx.set(refs.authorityStateRef, authorityRecord);
      else tx.create(refs.authorityStateRef, authorityRecord);
      tx.create(receiptRef, { receipt, createdAtISO: nowISO, createdAt: FieldValue.serverTimestamp() });
      return {
        idempotent: false,
        movement: planned.movement,
        stock,
        inventoryRevision: authorityRevision,
        receipt: publicReceipt(receipt)
      };
    });
  }

  async function applyInventoryCommand(data, context) {
    let envelope;
    try {
      envelope = normalizeApplyEnvelope(data);
    } catch (error) {
      return throwFailure(error, "applyInventoryCommand");
    }
    const scope = scopeFor(envelope);
    const staff = await assertStaff(context, { expectedOrganizationId: scope.organizationId });
    const actor = actorFor(staff, scope.organizationId);
    const refs = refsFor(scope.organizationId);
    const nowISO = new Date().toISOString();
    try {
      const commandKind = envelope.command.kind;
      const result = commandKind === "record_movement"
        ? await applyMovementCommand({ envelope, actor, refs, nowISO })
        : await applyConfigurationCommand({ envelope, actor, refs, nowISO });
      return {
        ok: true,
        storage: "firebase",
        schemaVersion: COMMAND_SCHEMA_VERSION,
        organizationId: scope.organizationId,
        commandKind,
        ...result
      };
    } catch (error) {
      return throwFailure(error, "applyInventoryCommand", { organizationId: scope.organizationId, actorUid: actor.uid });
    }
  }

  function boundedDocs(snapshot, maximum, label) {
    if (snapshot.size > maximum) throw new inventory.InventoryAuthorityError("resource-exhausted", `${label} exceeds the bounded workspace read. Narrow or archive inventory records.`);
    return snapshot.docs;
  }

  async function getInventoryWorkspace(data, context) {
    let envelope;
    try {
      envelope = normalizeWorkspaceEnvelope(data);
    } catch (error) {
      return throwFailure(error, "getInventoryWorkspace");
    }
    const scope = scopeFor(envelope);
    const staff = await assertStaff(context, { expectedOrganizationId: scope.organizationId });
    const actor = actorFor(staff, scope.organizationId);
    const refs = refsFor(scope.organizationId);
    const observedAtISO = new Date().toISOString();
    try {
      return await db.runTransaction(async (tx) => {
        const locationQuery = refs.locations.limit(WORKSPACE_LIMIT + 1);
        const itemQuery = refs.items.limit(WORKSPACE_LIMIT + 1);
        const stockQuery = refs.stockStates.limit(WORKSPACE_LIMIT + 1);
        const movementQuery = refs.movements.orderBy("occurredAtISO", "desc").limit(MOVEMENT_LIMIT + 1);
        const [locationsSnap, itemsSnap, stockSnap, movementsSnap, authorityStateSnap] = await Promise.all([
          tx.get(locationQuery),
          tx.get(itemQuery),
          tx.get(stockQuery),
          tx.get(movementQuery),
          tx.get(refs.authorityStateRef)
        ]);
        await authorityEnvelope(tx, refs, actor);
        const locations = boundedDocs(locationsSnap, WORKSPACE_LIMIT, "Inventory locations").map((snapshot) => {
          const value = inventory.verifyLocation(snapshot.data() || {});
          if (snapshot.id !== value.locationId || value.organizationId !== scope.organizationId) {
            throw new inventory.InventoryAuthorityError("data-loss", "Inventory location document identity is inconsistent.");
          }
          return { locationId: value.locationId, name: value.name, active: value.active, revision: value.revision };
        }).sort((left, right) => left.name.localeCompare(right.name) || left.locationId.localeCompare(right.locationId));
        const items = boundedDocs(itemsSnap, WORKSPACE_LIMIT, "Inventory items").map((snapshot) => {
          const value = inventory.verifyItem(snapshot.data() || {});
          if (snapshot.id !== value.itemId || value.organizationId !== scope.organizationId) {
            throw new inventory.InventoryAuthorityError("data-loss", "Inventory item document identity is inconsistent.");
          }
          return { itemId: value.itemId, name: value.name, category: value.category, unit: value.unit, active: value.active, turnaroundMinutes: value.turnaroundMinutes, revision: value.revision };
        }).sort((left, right) => left.name.localeCompare(right.name) || left.itemId.localeCompare(right.itemId));
        const stock = boundedDocs(stockSnap, WORKSPACE_LIMIT, "Inventory stock pools").map((snapshot) => {
          const raw = snapshot.data() || {};
          const value = inventory.publicStockState(raw);
          if (raw.organizationId !== scope.organizationId || snapshot.id !== value.stockStateId) {
            throw new inventory.InventoryAuthorityError("data-loss", "Inventory stock document identity is inconsistent.");
          }
          return value;
        }).sort((left, right) => left.itemId.localeCompare(right.itemId) || left.locationId.localeCompare(right.locationId));
        const movements = boundedDocs(movementsSnap, MOVEMENT_LIMIT, "Inventory movement history").map((snapshot) => {
          const value = inventory.verifyMovement(snapshot.data() || {});
          if (value.organizationId !== scope.organizationId || snapshot.id !== value.movementId) {
            throw new inventory.InventoryAuthorityError("data-loss", "Inventory movement document identity is inconsistent.");
          }
          return {
            movementId: value.movementId,
            itemId: value.itemId,
            kind: value.kind,
            quantity: value.quantity,
            from: value.from,
            to: value.to,
            eventPlanId: value.eventPlanId,
            adjustmentReason: value.adjustmentReason,
            note: value.note,
            occurredAtISO: value.occurredAtISO,
            recordedAtISO: value.recordedAtISO
          };
        });
        const inventoryRevision = authorityRevisionFrom(authorityStateSnap, scope.organizationId);
        return {
          ok: true,
          storage: "firebase",
          schemaVersion: COMMAND_SCHEMA_VERSION,
          authorityVersion: inventory.INVENTORY_AUTHORITY_VERSION,
          organizationId: scope.organizationId,
          role: actor.role,
          inventoryRevision,
          locations,
          items,
          stock,
          movements,
          observedAtISO,
          evidenceBoundary: inventory.INVENTORY_EVIDENCE_BOUNDARY
        };
      });
    } catch (error) {
      return throwFailure(error, "getInventoryWorkspace", { organizationId: scope.organizationId, actorUid: actor.uid });
    }
  }

  function throwFailure(error, operation, scope = {}) {
    if (error instanceof HttpsError) throw error;
    if (error instanceof inventory.InventoryAuthorityError) throw new HttpsError(error.code, error.message);
    logger.error(`${operation} failed`, {
      organizationId: String(scope.organizationId || ""),
      actorUid: String(scope.actorUid || ""),
      error: String(error?.message || "").slice(0, 240)
    });
    throw new HttpsError("internal", "The authoritative inventory operation did not complete.");
  }

  return Object.freeze({ applyInventoryCommand, getInventoryWorkspace });
}

module.exports = {
  COLLECTIONS,
  WORKSPACE_LIMIT,
  MOVEMENT_LIMIT,
  createInventoryAuthorityRuntime
};
