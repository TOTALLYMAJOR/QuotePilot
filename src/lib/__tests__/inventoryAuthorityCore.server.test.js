import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const inventory = require("../../../functions/inventoryAuthorityCore.cjs");

const organizationId = "org-inventory";
const itemId = "chafer";
const actor = {
  organizationId,
  principalOrganizationId: organizationId,
  uid: "inventory-admin",
  role: "admin"
};
const recordedAtISO = "2026-09-08T22:00:00.000Z";

function endpoint(locationId, bucket) {
  return { locationId, bucket };
}

function request(overrides = {}) {
  return {
    organizationId,
    itemId,
    requestId: "inventory-movement-request-0001",
    kind: "opening_balance",
    quantity: 30,
    from: null,
    to: endpoint("warehouse", "usable"),
    eventPlanId: "",
    sourceMovementId: "",
    adjustmentReason: "",
    note: "Initial verified count",
    occurredAtISO: recordedAtISO,
    expectedStockRevisions: { warehouse: 0 },
    ...overrides
  };
}

function plan(input, states = {}, options = {}) {
  return inventory.planMovement({
    request: input,
    actor,
    currentStockStates: states,
    nowISO: recordedAtISO,
    ...options
  });
}

function redigestMovement(movement) {
  const { movementDigest: _discarded, createdAt: _createdAt, updatedAt: _updatedAt, ...body } = movement;
  return { ...movement, movementDigest: inventory.digest(body, "Inventory movement") };
}

describe("inventory physical authority", () => {
  test("derives physical truth from immutable bucket transitions", () => {
    const opening = plan(request());
    const warehouse = opening.nextStockStates.warehouse;
    expect(inventory.publicStockState(warehouse)).toMatchObject({ owned: 30, usable: 30, out: 0, unavailable: 0, revision: 1 });

    const damaged = plan(request({
      requestId: "inventory-movement-request-0002",
      kind: "damage",
      quantity: 2,
      from: endpoint("warehouse", "usable"),
      to: endpoint("warehouse", "damaged"),
      expectedStockRevisions: { warehouse: 1 }
    }), { warehouse });
    const repaired = plan(request({
      requestId: "inventory-movement-request-0003",
      kind: "repair",
      quantity: 1,
      from: endpoint("warehouse", "damaged"),
      to: endpoint("warehouse", "usable"),
      expectedStockRevisions: { warehouse: 2 }
    }), { warehouse: damaged.nextStockStates.warehouse });
    const lost = plan(request({
      requestId: "inventory-movement-request-0004",
      kind: "loss",
      quantity: 1,
      from: endpoint("warehouse", "usable"),
      to: endpoint("warehouse", "lost"),
      expectedStockRevisions: { warehouse: 3 }
    }), { warehouse: repaired.nextStockStates.warehouse });

    expect(inventory.publicStockState(lost.nextStockStates.warehouse)).toMatchObject({
      owned: 29,
      usable: 28,
      out: 0,
      unavailable: 1
    });

    const replayed = inventory.replayMovements({
      organizationId,
      itemId,
      movements: [opening.movement, damaged.movement, repaired.movement, lost.movement]
    });
    expect(replayed.warehouse).toEqual(lost.nextStockStates.warehouse);
  });

  test("keeps checkout distinct from owned and usable stock", () => {
    const opening = plan(request());
    const checkout = plan(request({
      requestId: "inventory-checkout-request-0001",
      kind: "checkout",
      quantity: 2,
      from: endpoint("warehouse", "usable"),
      to: endpoint("warehouse", "checked_out"),
      eventPlanId: "quote-smith",
      expectedStockRevisions: { warehouse: 1 }
    }), { warehouse: opening.nextStockStates.warehouse });
    expect(inventory.publicStockState(checkout.nextStockStates.warehouse)).toMatchObject({ owned: 30, usable: 28, out: 2 });
  });

  test("moves stock between locations without changing organization ownership", () => {
    const opening = plan(request());
    const transfer = plan(request({
      requestId: "inventory-transfer-request-0001",
      kind: "transfer",
      quantity: 4,
      from: endpoint("warehouse", "usable"),
      to: endpoint("venue-store", "usable"),
      expectedStockRevisions: { warehouse: 1, "venue-store": 0 }
    }), { warehouse: opening.nextStockStates.warehouse });
    const summaries = Object.values(transfer.nextStockStates).map(inventory.publicStockState);
    expect(summaries.reduce((total, state) => total + state.owned, 0)).toBe(30);
    expect(summaries).toEqual(expect.arrayContaining([
      expect.objectContaining({ locationId: "warehouse", usable: 26 }),
      expect.objectContaining({ locationId: "venue-store", usable: 4 })
    ]));
  });

  test("rejects negative stock, stale revisions, and a second opening balance", () => {
    const opening = plan(request());
    expect(() => plan(request({
      requestId: "inventory-overdraw-request-0001",
      kind: "damage",
      quantity: 31,
      from: endpoint("warehouse", "usable"),
      to: endpoint("warehouse", "damaged"),
      expectedStockRevisions: { warehouse: 1 }
    }), { warehouse: opening.nextStockStates.warehouse })).toThrow(/would make usable stock invalid/i);
    expect(() => plan(request({ requestId: "inventory-stale-request-0001" }), { warehouse: opening.nextStockStates.warehouse })).toThrow(/changed at warehouse/i);
    expect(() => plan(request({
      requestId: "inventory-opening-request-0002",
      expectedStockRevisions: { warehouse: 1 }
    }), { warehouse: opening.nextStockStates.warehouse })).toThrow(/only before/i);
  });

  test("requires reasoned adjustments and keeps missing outside physical truth", () => {
    expect(() => inventory.normalizeMovementRequest(request({
      kind: "adjustment",
      from: null,
      to: endpoint("warehouse", "usable"),
      adjustmentReason: ""
    }))).toThrow(/requires a supported reason/i);
    expect(() => inventory.normalizeMovementRequest(request({ kind: "missing" }))).toThrow(/unsupported/i);
  });

  test("replays identical requests but rejects request identity substitution", () => {
    const opening = plan(request());
    const replay = plan(request(), {}, { existingMovement: opening.movement });
    expect(replay.idempotent).toBe(true);
    expect(replay.nextStockStates.warehouse).toEqual(opening.nextStockStates.warehouse);
    expect(() => plan(request({ quantity: 29 }), {}, { existingMovement: opening.movement })).toThrow(/different immutable/i);
  });

  test("freezes item units after movement history exists", () => {
    const current = inventory.normalizeItem({
      organizationId,
      itemId,
      expectedRevision: 0,
      name: "Chafer",
      category: "Service equipment",
      unit: "each",
      turnaroundMinutes: 60,
      active: true
    });
    expect(() => inventory.normalizeItem({
      organizationId,
      itemId,
      expectedRevision: 1,
      name: "Chafer",
      category: "Service equipment",
      unit: "sets",
      turnaroundMinutes: 60,
      active: true
    }, current, { hasMovements: true })).toThrow(/cannot change/i);
  });

  test("requires administrator mutation authority and both rollout gates", () => {
    expect(() => inventory.normalizeActor({ ...actor, role: "sales" }, organizationId, { mutation: true })).toThrow(/administrator/i);
    expect(() => inventory.normalizeActor({ ...actor, role: "sales" }, organizationId)).not.toThrow();
    expect(() => inventory.assertEnabled(true, { inventoryAuthorityEnabled: false })).toThrow(/not enabled/i);
    expect(() => inventory.assertEnabled(false, { inventoryAuthorityEnabled: true })).toThrow(/not enabled/i);
    expect(() => inventory.assertEnabled(true, { inventoryAuthorityEnabled: true })).not.toThrow();
  });

  test("replays reversed evidence through retained revision dependencies", () => {
    const opening = plan(request());
    const damaged = plan(request({
      requestId: "inventory-replay-damage-0001",
      kind: "damage",
      quantity: 2,
      from: endpoint("warehouse", "usable"),
      to: endpoint("warehouse", "damaged"),
      expectedStockRevisions: { warehouse: 1 }
    }), { warehouse: opening.nextStockStates.warehouse });
    const replayed = inventory.replayMovements({ organizationId, itemId, movements: [damaged.movement, opening.movement] });
    expect(replayed.warehouse).toEqual(damaged.nextStockStates.warehouse);
    expect(damaged.movement.request.expectedStockRevisions).toEqual({ warehouse: 1 });
  });

  test("joins independent location chains deterministically at a transfer", () => {
    const warehouseOpening = plan(request());
    const annexOpening = plan(request({
      requestId: "inventory-annex-opening-0001",
      quantity: 5,
      to: endpoint("annex", "usable"),
      expectedStockRevisions: { annex: 0 }
    }));
    const transfer = plan(request({
      requestId: "inventory-chain-transfer-0001",
      kind: "transfer",
      quantity: 3,
      from: endpoint("warehouse", "usable"),
      to: endpoint("annex", "usable"),
      expectedStockRevisions: { warehouse: 1, annex: 1 }
    }), {
      warehouse: warehouseOpening.nextStockStates.warehouse,
      annex: annexOpening.nextStockStates.annex
    });
    const replayed = inventory.replayMovements({
      organizationId,
      itemId,
      movements: [transfer.movement, annexOpening.movement, warehouseOpening.movement]
    });
    expect(replayed).toEqual(transfer.nextStockStates);
  });

  test("rejects replay gaps, duplicate evidence, missing buckets, and poison identifiers", () => {
    const opening = plan(request());
    const damaged = plan(request({
      requestId: "inventory-gap-damage-0001",
      kind: "damage",
      quantity: 1,
      from: endpoint("warehouse", "usable"),
      to: endpoint("warehouse", "damaged"),
      expectedStockRevisions: { warehouse: 1 }
    }), { warehouse: opening.nextStockStates.warehouse });
    expect(() => inventory.replayMovements({ organizationId, itemId, movements: [damaged.movement] })).toThrow(/gap|cycle/i);
    expect(() => inventory.replayMovements({ organizationId, itemId, movements: [opening.movement, opening.movement] })).toThrow(/duplicate/i);
    expect(() => inventory.normalizeStockState({ ...opening.nextStockStates.warehouse, buckets: { usable: 30, checked_out: 0 } }, { organizationId, itemId, locationId: "warehouse" })).toThrow(/exact supported/i);
    expect(() => inventory.opaqueId("__proto__", "locationId")).toThrow(/stable opaque/i);
  });

  test("rejects unknown command fields and internally contradictory retained evidence", () => {
    expect(() => inventory.normalizeMovementRequest({ ...request(), surprise: true })).toThrow(/unsupported fields/i);
    const opening = plan(request());
    const tampered = structuredClone(opening.movement);
    tampered.eventPlanId = "forged-event";
    const { movementDigest: _discarded, ...body } = tampered;
    tampered.movementDigest = inventory.digest(body, "Inventory movement");
    expect(() => inventory.verifyMovement(tampered)).toThrow(/inconsistent/i);
  });

  test("requires an empty, exact-typed ledger genesis", () => {
    const identity = { organizationId, itemId, locationId: "warehouse" };
    const empty = inventory.createEmptyStockState(identity);
    expect(() => inventory.normalizeStockState({
      ...empty,
      buckets: { usable: 1, checked_out: 0, damaged: 0 }
    }, identity)).toThrow(/empty ledger genesis/i);
    expect(() => inventory.normalizeStockState({
      ...empty,
      updatedAtISO: recordedAtISO
    }, identity)).toThrow(/empty ledger genesis/i);
    expect(() => inventory.normalizeStockState({
      ...empty,
      revision: "0"
    }, identity)).toThrow(/integer revision/i);
    expect(() => inventory.normalizeStockState({
      ...empty,
      buckets: { usable: "0", checked_out: 0, damaged: 0 }
    }, identity)).toThrow(/invalid quantity/i);
  });

  test("rejects coherently re-signed movement evidence with impossible derived facts", () => {
    const opening = plan(request());

    const wrongSequence = structuredClone(opening.movement);
    wrongSequence.sequence = 999;
    expect(() => inventory.verifyMovement(redigestMovement(wrongSequence))).toThrow(/derived evidence/i);

    const timeTravel = structuredClone(opening.movement);
    timeTravel.recordedAtISO = "2026-09-08T21:59:59.000Z";
    timeTravel.stockOutcomes[0].resultStockState.updatedAtISO = timeTravel.recordedAtISO;
    expect(() => inventory.verifyMovement(redigestMovement(timeTravel))).toThrow(/derived evidence/i);

    const inventedGenesis = structuredClone(opening.movement);
    inventedGenesis.stockOutcomes[0].beforeBuckets.usable = 10;
    inventedGenesis.stockOutcomes[0].afterBuckets.usable = 40;
    inventedGenesis.stockOutcomes[0].resultStockState.buckets.usable = 40;
    expect(() => inventory.verifyMovement(redigestMovement(inventedGenesis))).toThrow(/impossible genesis/i);
  });

  test("requires canonical transfer outcome order and strict retained outcome quantities", () => {
    const opening = plan(request());
    const transfer = plan(request({
      requestId: "inventory-outcome-order-0001",
      kind: "transfer",
      quantity: 2,
      from: endpoint("warehouse", "usable"),
      to: endpoint("annex", "usable"),
      expectedStockRevisions: { warehouse: 1, annex: 0 }
    }), { warehouse: opening.nextStockStates.warehouse });
    const reversed = structuredClone(transfer.movement);
    reversed.stockOutcomes.reverse();
    expect(() => inventory.verifyMovement(redigestMovement(reversed))).toThrow(/derived evidence/i);

    const coerced = structuredClone(opening.movement);
    coerced.stockOutcomes[0].afterBuckets.usable = "30";
    coerced.stockOutcomes[0].resultStockState.buckets.usable = "30";
    expect(() => inventory.verifyMovement(redigestMovement(coerced))).toThrow(/invalid quantity/i);
  });

  test("supports safe opaque identifiers that overlap inherited object keys", () => {
    const opening = plan(request({
      requestId: "inventory-inherited-key-0001",
      to: endpoint("toString", "usable"),
      expectedStockRevisions: { toString: 0 }
    }), {});
    const replayed = inventory.replayMovements({ organizationId, itemId, movements: [opening.movement] });
    expect(replayed.toString).toEqual(opening.nextStockStates.toString);
  });

  test("requires exact booleans for configurable active state", () => {
    expect(() => inventory.normalizeLocation({
      organizationId,
      locationId: "warehouse",
      expectedRevision: 0,
      name: "Warehouse",
      active: "false"
    })).toThrow(/must be boolean/i);
    expect(() => inventory.normalizeItem({
      organizationId,
      itemId,
      expectedRevision: 0,
      name: "Chafer",
      category: "Service equipment",
      unit: "each",
      turnaroundMinutes: 60,
      active: null
    })).toThrow(/must be boolean/i);
  });
});
