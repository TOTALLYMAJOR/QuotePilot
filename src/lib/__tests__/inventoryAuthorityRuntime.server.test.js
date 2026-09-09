import { createRequire } from "node:module";
import fs from "node:fs";
import { beforeEach, describe, expect, test, vi } from "vitest";

const require = createRequire(import.meta.url);
const inventory = require("../../../functions/inventoryAuthorityCore.cjs");
const { createInventoryAuthorityRuntime } = require("../../../functions/inventoryAuthority.js");
const FUNCTIONS_INDEX_SOURCE = fs.readFileSync(
  new URL("../../../functions/index.js", import.meta.url),
  "utf8"
);
const FIRESTORE_RULES_SOURCE = fs.readFileSync(
  new URL("../../../firestore.rules", import.meta.url),
  "utf8"
);

const ORGANIZATION_ID = "org-inventory";
const ADMIN_UID = "inventory-admin";
const SALES_UID = "inventory-sales";
const EVIDENCE_TIME = "2026-09-08T22:00:00.000Z";

function clone(value) {
  return typeof value === "undefined" ? undefined : structuredClone(value);
}

class FakeDocumentRef {
  constructor(store, path) {
    this.store = store;
    this.path = path;
    this.id = path.split("/").at(-1);
  }

  collection(name) {
    return new FakeCollectionRef(this.store, `${this.path}/${name}`);
  }
}

class FakeCollectionRef {
  constructor(store, path, constraints = {}) {
    this.store = store;
    this.path = path;
    this.constraints = constraints;
  }

  doc(id) {
    return new FakeDocumentRef(this.store, `${this.path}/${id}`);
  }

  limit(count) {
    return new FakeCollectionRef(this.store, this.path, { ...this.constraints, limit: count });
  }

  orderBy(field, direction) {
    return new FakeCollectionRef(this.store, this.path, { ...this.constraints, orderBy: { field, direction } });
  }
}

function documentSnapshot(ref, store) {
  const retained = store.get(ref.path);
  return {
    id: ref.id,
    ref,
    exists: typeof retained !== "undefined",
    data: () => clone(retained || {})
  };
}

function collectionSnapshot(ref, store) {
  const prefix = `${ref.path}/`;
  let docs = [...store.keys()]
    .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
    .map((path) => documentSnapshot(new FakeDocumentRef(store, path), store));
  const ordering = ref.constraints.orderBy;
  if (ordering) {
    docs.sort((left, right) => {
      const leftValue = left.data()[ordering.field];
      const rightValue = right.data()[ordering.field];
      const result = leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
      return ordering.direction === "desc" ? -result : result;
    });
  } else {
    docs.sort((left, right) => left.id.localeCompare(right.id));
  }
  if (Number.isSafeInteger(ref.constraints.limit)) docs = docs.slice(0, ref.constraints.limit);
  return { docs, size: docs.length };
}

function createFakeDb(entries = []) {
  const store = new Map(entries.map(([path, value]) => [path, clone(value)]));
  const transactions = [];
  let retryMutation = null;

  return {
    store,
    transactions,
    collection(name) {
      return new FakeCollectionRef(store, name);
    },
    retryNextTransactionWith(mutation) {
      retryMutation = mutation;
    },
    async runTransaction(callback) {
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const trace = { attempt, reads: [], writes: [] };
        const staged = [];
        let hasWritten = false;
        const assertReadable = () => {
          if (hasWritten) throw new Error("Firestore transaction attempted a read after a write.");
        };
        const tx = {
          async get(ref) {
            assertReadable();
            trace.reads.push(ref.path);
            return ref instanceof FakeCollectionRef
              ? collectionSnapshot(ref, store)
              : documentSnapshot(ref, store);
          },
          async getAll(...refs) {
            assertReadable();
            trace.reads.push(...refs.map((ref) => ref.path));
            return refs.map((ref) => documentSnapshot(ref, store));
          },
          create(ref, value) {
            hasWritten = true;
            trace.writes.push({ operation: "create", path: ref.path });
            staged.push({ operation: "create", ref, value: clone(value) });
          },
          set(ref, value) {
            hasWritten = true;
            trace.writes.push({ operation: "set", path: ref.path });
            staged.push({ operation: "set", ref, value: clone(value) });
          }
        };
        transactions.push(trace);
        const result = await callback(tx);
        if (attempt === 1 && retryMutation) {
          const mutate = retryMutation;
          retryMutation = null;
          mutate(store);
          continue;
        }
        staged.forEach(({ operation, ref, value }) => {
          if (operation === "create" && store.has(ref.path)) throw new Error(`Document already exists: ${ref.path}`);
          store.set(ref.path, value);
        });
        return result;
      }
      throw new Error("Transaction retry limit exceeded.");
    }
  };
}

class FakeHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "HttpsError";
    this.code = code;
  }
}

function principal(uid, role) {
  return {
    uid,
    role,
    organizationId: ORGANIZATION_ID,
    principalOrganizationId: ORGANIZATION_ID
  };
}

function baseEntries({ tenantEnabled = true } = {}) {
  return [
    [`organizations/${ORGANIZATION_ID}`, { active: true }],
    [`organizations/${ORGANIZATION_ID}/settings/config`, { inventoryAuthorityEnabled: tenantEnabled }],
    [`userRoles/${ADMIN_UID}`, { organizationId: ORGANIZATION_ID, role: "admin" }],
    [`userRoles/${SALES_UID}`, { organizationId: ORGANIZATION_ID, role: "sales" }]
  ];
}

function storedLocation(overrides = {}) {
  return {
    ...inventory.normalizeLocation({
      organizationId: ORGANIZATION_ID,
      locationId: "warehouse",
      expectedRevision: 0,
      name: "Main warehouse",
      active: true
    }),
    createdAtISO: EVIDENCE_TIME,
    updatedAtISO: EVIDENCE_TIME,
    ...overrides
  };
}

function storedItem(overrides = {}) {
  return {
    ...inventory.normalizeItem({
      organizationId: ORGANIZATION_ID,
      itemId: "chafer",
      expectedRevision: 0,
      name: "Chafer",
      category: "Service equipment",
      unit: "each",
      active: true,
      turnaroundMinutes: 60
    }),
    movementCount: 0,
    firstMovementId: "",
    lastMovementId: "",
    physicalUpdatedAtISO: "",
    createdAtISO: EVIDENCE_TIME,
    updatedAtISO: EVIDENCE_TIME,
    ...overrides
  };
}

function inventoryEntries() {
  return [
    [`organizations/${ORGANIZATION_ID}/inventoryLocations/warehouse`, storedLocation()],
    [`organizations/${ORGANIZATION_ID}/inventoryItems/chafer`, storedItem()]
  ];
}

function applyEnvelope(command, requestId = "inventory-command-request-0001") {
  return {
    schemaVersion: 1,
    organizationId: ORGANIZATION_ID,
    requestId,
    command
  };
}

function openingBalanceCommand(overrides = {}) {
  return {
    kind: "record_movement",
    movement: {
      itemId: "chafer",
      kind: "opening_balance",
      quantity: 30,
      from: null,
      to: { locationId: "warehouse", bucket: "usable" },
      eventPlanId: "",
      sourceMovementId: "",
      adjustmentReason: "",
      note: "Initial verified count",
      occurredAtISO: EVIDENCE_TIME,
      expectedStockRevisions: { warehouse: 0 },
      ...overrides
    }
  };
}

function createHarness({ entries = [], globalEnabled = true } = {}) {
  const db = createFakeDb([...baseEntries(), ...entries]);
  let environmentGate = globalEnabled;
  const assertStaff = vi.fn(async (context, { expectedOrganizationId }) => {
    if (!context?.staff || context.staff.organizationId !== expectedOrganizationId) {
      throw new FakeHttpsError("permission-denied", "Staff authority is required.");
    }
    return context.staff;
  });
  const runtime = createInventoryAuthorityRuntime({
    db,
    FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
    HttpsError: FakeHttpsError,
    assertStaff,
    normalizeOrganizationId: (value) => String(value || "").trim(),
    isOrganizationRecordActive: (value) => value.active === true,
    globalEnabled: () => environmentGate,
    logger: { error: vi.fn() }
  });
  return {
    db,
    runtime,
    assertStaff,
    setGlobalEnabled(value) { environmentGate = value; }
  };
}

const adminContext = { staff: principal(ADMIN_UID, "admin") };
const salesContext = { staff: principal(SALES_UID, "sales") };

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("inventory authority runtime", () => {
  test("binds exactly two App Check enforced callable surfaces to the direct server gate", () => {
    expect(FUNCTIONS_INDEX_SOURCE.match(/exports\.getInventoryWorkspace\s*=/gu)).toHaveLength(1);
    expect(FUNCTIONS_INDEX_SOURCE.match(/exports\.applyInventoryCommand\s*=/gu)).toHaveLength(1);
    expect(FUNCTIONS_INDEX_SOURCE).toContain("createInventoryAuthorityRuntime({");
    expect(FUNCTIONS_INDEX_SOURCE).toContain("process.env.INVENTORY_AUTHORITY_ENABLED");
    expect(FUNCTIONS_INDEX_SOURCE).toContain(".runWith({ enforceAppCheck: true })");
    expect(FUNCTIONS_INDEX_SOURCE).not.toContain('tenantWorkflowRuntimeEnabled("INVENTORY_AUTHORITY_ENABLED"');
    expect(FIRESTORE_RULES_SOURCE).toContain("match /organizations/{orgId}/inventoryMovements/{movementId}");
    expect(FIRESTORE_RULES_SOURCE).toContain("match /organizations/{orgId}/inventoryAuthorityReceipts/{receiptId}");
  });

  test("rejects non-v1 and open-ended envelopes before authentication or persistence", async () => {
    const harness = createHarness();
    const invalid = [
      {},
      { schemaVersion: 2, organizationId: ORGANIZATION_ID, requestId: "inventory-command-request-0001", command: { kind: "upsert_location", location: {} } },
      { ...applyEnvelope({ kind: "upsert_location", location: {} }), surprise: true },
      applyEnvelope({ kind: "upsert_location", location: {}, item: {} }),
      applyEnvelope({ kind: "invent_stock", item: {} })
    ];

    for (const envelope of invalid) {
      await expect(harness.runtime.applyInventoryCommand(envelope, adminContext)).rejects.toMatchObject({ code: "invalid-argument" });
    }
    await expect(harness.runtime.getInventoryWorkspace({ schemaVersion: 1, organizationId: ORGANIZATION_ID, cursor: "all" }, salesContext))
      .rejects.toMatchObject({ code: "invalid-argument" });
    expect(harness.assertStaff).not.toHaveBeenCalled();
    expect(harness.db.transactions).toHaveLength(0);
  });

  test("permits sales reads but reserves every mutation for administrators", async () => {
    const harness = createHarness({ entries: inventoryEntries() });
    const workspace = await harness.runtime.getInventoryWorkspace(
      { schemaVersion: 1, organizationId: ORGANIZATION_ID },
      salesContext
    );
    expect(workspace).toMatchObject({ ok: true, role: "sales", organizationId: ORGANIZATION_ID });
    expect(workspace.items).toEqual([expect.objectContaining({ itemId: "chafer", unit: "each" })]);

    await expect(harness.runtime.applyInventoryCommand(applyEnvelope({
      kind: "upsert_location",
      location: { locationId: "annex", expectedRevision: 0, name: "Annex", active: true }
    }), salesContext)).rejects.toMatchObject({ code: "permission-denied" });
    expect(harness.db.store.has(`organizations/${ORGANIZATION_ID}/inventoryLocations/annex`)).toBe(false);
  });

  test("fails closed unless both environment and tenant gates are enabled", async () => {
    const environmentOff = createHarness({ entries: inventoryEntries(), globalEnabled: false });
    await expect(environmentOff.runtime.getInventoryWorkspace(
      { schemaVersion: 1, organizationId: ORGANIZATION_ID },
      adminContext
    )).rejects.toMatchObject({ code: "failed-precondition" });

    const tenantOff = createHarness({ entries: [
      ...inventoryEntries(),
      [`organizations/${ORGANIZATION_ID}/settings/config`, { inventoryAuthorityEnabled: false }]
    ] });
    await expect(tenantOff.runtime.getInventoryWorkspace(
      { schemaVersion: 1, organizationId: ORGANIZATION_ID },
      adminContext
    )).rejects.toMatchObject({ code: "failed-precondition" });
  });

  test("creates an immutable receipt, replays it exactly, and rejects request-ID substitution", async () => {
    const harness = createHarness();
    const envelope = applyEnvelope({
      kind: "upsert_location",
      location: { locationId: "annex", expectedRevision: 0, name: "Annex", active: true }
    }, "inventory-location-request-0001");
    const first = await harness.runtime.applyInventoryCommand(envelope, adminContext);
    const receiptPath = [...harness.db.store.keys()].find((path) => path.includes("/inventoryAuthorityReceipts/"));
    const retainedReceipt = clone(harness.db.store.get(receiptPath));
    const replay = await harness.runtime.applyInventoryCommand(envelope, adminContext);

    expect(first.idempotent).toBe(false);
    expect(replay).toEqual({ ...first, idempotent: true });
    expect(harness.db.store.get(receiptPath)).toEqual(retainedReceipt);
    expect(harness.db.transactions[1].reads).not.toContain(
      `organizations/${ORGANIZATION_ID}/inventoryLocations/annex`
    );
    await expect(harness.runtime.applyInventoryCommand(applyEnvelope({
      kind: "upsert_location",
      location: { locationId: "annex", expectedRevision: 0, name: "Substituted annex", active: true }
    }, "inventory-location-request-0001"), adminContext)).rejects.toMatchObject({ code: "already-exists" });
    expect(harness.db.store.get(receiptPath)).toEqual(retainedReceipt);
  });

  test("rejects a coherently re-signed configuration receipt with a substituted result", async () => {
    const harness = createHarness();
    const envelope = applyEnvelope({
      kind: "upsert_location",
      location: { locationId: "annex", expectedRevision: 0, name: "Annex", active: true }
    }, "inventory-location-tamper-0001");
    await harness.runtime.applyInventoryCommand(envelope, adminContext);
    const receiptPath = [...harness.db.store.keys()].find((path) => path.includes("/inventoryAuthorityReceipts/"));
    const wrapper = clone(harness.db.store.get(receiptPath));
    wrapper.receipt.result.name = "Substituted warehouse";
    const { receiptDigest: _discarded, ...body } = wrapper.receipt;
    wrapper.receipt.receiptDigest = inventory.digest(body, "Inventory authority receipt");
    harness.db.store.set(receiptPath, wrapper);

    await expect(harness.runtime.applyInventoryCommand(envelope, adminContext))
      .rejects.toMatchObject({ code: "data-loss" });
  });

  test("reads every transaction dependency before its first write", async () => {
    const harness = createHarness({ entries: inventoryEntries() });
    await expect(harness.runtime.applyInventoryCommand(
      applyEnvelope(openingBalanceCommand(), "inventory-opening-request-0001"),
      adminContext
    )).resolves.toMatchObject({ ok: true, idempotent: false });

    expect(harness.db.transactions).toHaveLength(1);
    expect(harness.db.transactions[0].reads).toEqual(expect.arrayContaining([
      `organizations/${ORGANIZATION_ID}/inventoryItems/chafer`,
      `organizations/${ORGANIZATION_ID}/inventoryLocations/warehouse`,
      `organizations/${ORGANIZATION_ID}/inventoryAuthorityState/current`,
      `organizations/${ORGANIZATION_ID}/settings/config`,
      `userRoles/${ADMIN_UID}`
    ]));
    expect(harness.db.transactions[0].writes[0].operation).toBe("create");
  });

  test("fences item units with the first movement marker and advances movementCount", async () => {
    const harness = createHarness({ entries: inventoryEntries() });
    const outcome = await harness.runtime.applyInventoryCommand(
      applyEnvelope(openingBalanceCommand(), "inventory-opening-request-0002"),
      adminContext
    );
    const item = harness.db.store.get(`organizations/${ORGANIZATION_ID}/inventoryItems/chafer`);

    expect(item).toMatchObject({
      movementCount: 1,
      firstMovementId: outcome.movement.movementId,
      lastMovementId: outcome.movement.movementId
    });
    expect(item.physicalUpdatedAtISO).toMatch(/^\d{4}-\d{2}-\d{2}T/u);

    await expect(harness.runtime.applyInventoryCommand(applyEnvelope({
      kind: "upsert_item",
      item: {
        itemId: "chafer",
        expectedRevision: 1,
        name: "Chafer",
        category: "Service equipment",
        unit: "sets",
        active: true,
        turnaroundMinutes: 60
      }
    }, "inventory-unit-change-request-0001"), adminContext)).rejects.toMatchObject({ code: "failed-precondition" });
  });

  test("movement replay returns the movement-sealed stock outcome, not mutable projection state", async () => {
    const harness = createHarness({ entries: inventoryEntries() });
    const envelope = applyEnvelope(openingBalanceCommand(), "inventory-opening-request-0003");
    const first = await harness.runtime.applyInventoryCommand(envelope, adminContext);
    const stockPath = `organizations/${ORGANIZATION_ID}/inventoryStockStates/${first.stock[0].stockStateId}`;
    harness.db.store.set(stockPath, {
      ...harness.db.store.get(stockPath),
      buckets: { usable: 999, checked_out: 0, damaged: 0 }
    });

    const replay = await harness.runtime.applyInventoryCommand(envelope, adminContext);
    expect(replay.idempotent).toBe(true);
    expect(replay.stock).toEqual(first.stock);
    expect(replay.stock).toEqual([expect.objectContaining({ usable: 30, owned: 30, revision: 1 })]);
    [
      `organizations/${ORGANIZATION_ID}/inventoryAuthorityState/current`,
      `organizations/${ORGANIZATION_ID}/inventoryItems/chafer`,
      `organizations/${ORGANIZATION_ID}/inventoryLocations/warehouse`,
      stockPath
    ].forEach((path) => expect(harness.db.transactions[1].reads).not.toContain(path));
  });

  test("fails closed on valid foreign-organization evidence misfiled under the active tenant", async () => {
    const foreignOrganizationId = "org-foreign";
    const foreignActor = {
      organizationId: foreignOrganizationId,
      principalOrganizationId: foreignOrganizationId,
      uid: "foreign-admin",
      role: "admin"
    };
    const foreign = inventory.planMovement({
      request: {
        organizationId: foreignOrganizationId,
        itemId: "chafer",
        requestId: "inventory-foreign-opening-0001",
        kind: "opening_balance",
        quantity: 30,
        from: null,
        to: { locationId: "warehouse", bucket: "usable" },
        eventPlanId: "",
        sourceMovementId: "",
        adjustmentReason: "",
        note: "Foreign opening",
        occurredAtISO: EVIDENCE_TIME,
        expectedStockRevisions: { warehouse: 0 }
      },
      actor: foreignActor,
      nowISO: EVIDENCE_TIME
    });
    const stockState = foreign.nextStockStates.warehouse;
    const stockHarness = createHarness({ entries: [
      ...inventoryEntries(),
      [`organizations/${ORGANIZATION_ID}/inventoryStockStates/${stockState.stockStateId}`, stockState]
    ] });
    await expect(stockHarness.runtime.getInventoryWorkspace(
      { schemaVersion: 1, organizationId: ORGANIZATION_ID },
      adminContext
    )).rejects.toMatchObject({ code: "data-loss" });

    const movementHarness = createHarness({ entries: [
      ...inventoryEntries(),
      [`organizations/${ORGANIZATION_ID}/inventoryMovements/${foreign.movement.movementId}`, foreign.movement]
    ] });
    await expect(movementHarness.runtime.getInventoryWorkspace(
      { schemaVersion: 1, organizationId: ORGANIZATION_ID },
      adminContext
    )).rejects.toMatchObject({ code: "data-loss" });
  });

  test("rejects execution movements until allocation-aware Phase 9 authority exists", async () => {
    const harness = createHarness({ entries: inventoryEntries() });
    const executionKinds = ["checkout", "return", "damage", "repair", "loss", "retire"];
    const shapes = {
      checkout: { from: { locationId: "warehouse", bucket: "usable" }, to: { locationId: "warehouse", bucket: "checked_out" }, eventPlanId: "event-plan-1" },
      return: { from: { locationId: "warehouse", bucket: "checked_out" }, to: { locationId: "warehouse", bucket: "usable" }, eventPlanId: "event-plan-1", sourceMovementId: "movement-checkout-1" },
      damage: { from: { locationId: "warehouse", bucket: "usable" }, to: { locationId: "warehouse", bucket: "damaged" } },
      repair: { from: { locationId: "warehouse", bucket: "damaged" }, to: { locationId: "warehouse", bucket: "usable" } },
      loss: { from: { locationId: "warehouse", bucket: "usable" }, to: { locationId: "warehouse", bucket: "lost" } },
      retire: { from: { locationId: "warehouse", bucket: "usable" }, to: { locationId: "warehouse", bucket: "retired" } }
    };

    for (const [index, kind] of executionKinds.entries()) {
      const movement = openingBalanceCommand({
        kind,
        quantity: 1,
        from: shapes[kind].from,
        to: shapes[kind].to,
        eventPlanId: shapes[kind].eventPlanId || "",
        sourceMovementId: shapes[kind].sourceMovementId || "",
        expectedStockRevisions: { warehouse: 0 }
      });
      await expect(harness.runtime.applyInventoryCommand(
        applyEnvelope(movement, `inventory-execution-request-000${index + 1}`),
        adminContext
      )).rejects.toMatchObject({ code: "failed-precondition" });
    }
    expect(harness.db.transactions).toHaveLength(0);
  });

  test("retries against a concurrent first movement and then rejects a stale unit change", async () => {
    const harness = createHarness({ entries: inventoryEntries() });
    const concurrentMovementId = inventory.movementIdFor(ORGANIZATION_ID, "inventory-concurrent-first-0001");
    harness.db.retryNextTransactionWith((store) => {
      store.set(`organizations/${ORGANIZATION_ID}/inventoryItems/chafer`, storedItem({
        movementCount: 1,
        firstMovementId: concurrentMovementId,
        lastMovementId: concurrentMovementId,
        physicalUpdatedAtISO: EVIDENCE_TIME
      }));
    });

    await expect(harness.runtime.applyInventoryCommand(applyEnvelope({
      kind: "upsert_item",
      item: {
        itemId: "chafer",
        expectedRevision: 1,
        name: "Chafer",
        category: "Service equipment",
        unit: "sets",
        active: true,
        turnaroundMinutes: 60
      }
    }, "inventory-concurrent-unit-request-0001"), adminContext)).rejects.toMatchObject({ code: "failed-precondition" });

    expect(harness.db.transactions.map(({ attempt }) => attempt)).toEqual([1, 2]);
    expect(harness.db.store.get(`organizations/${ORGANIZATION_ID}/inventoryItems/chafer`)).toMatchObject({
      unit: "each",
      movementCount: 1,
      firstMovementId: concurrentMovementId
    });
  });
});
