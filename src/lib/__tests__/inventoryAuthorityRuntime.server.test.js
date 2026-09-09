import { createRequire } from "node:module";
import { beforeEach, describe, expect, test, vi } from "vitest";

const require = createRequire(import.meta.url);
const inventory = require("../../../functions/inventoryIngredientCore.cjs");
const { createInventoryAuthorityRuntime } = require("../../../functions/inventoryAuthority.js");

const ORGANIZATION_ID = "org-inventory";
const ADMIN_UID = "inventory-admin";
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
  collection(name) { return new FakeCollectionRef(this.store, `${this.path}/${name}`); }
}

class FakeCollectionRef {
  constructor(store, path, constraints = {}) {
    this.store = store;
    this.path = path;
    this.constraints = constraints;
  }
  doc(id) { return new FakeDocumentRef(this.store, `${this.path}/${id}`); }
  where(field, operator, value) {
    return new FakeCollectionRef(this.store, this.path, {
      ...this.constraints, where: { field, operator, value }
    });
  }
  orderBy(field, direction = "asc") {
    return new FakeCollectionRef(this.store, this.path, {
      ...this.constraints, orderBy: { field, direction }
    });
  }
  limit(limit) { return new FakeCollectionRef(this.store, this.path, { ...this.constraints, limit }); }
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
  const filter = ref.constraints.where;
  if (filter) {
    if (filter.operator !== "==") throw new Error("Unsupported fake query operator.");
    docs = docs.filter((doc) => doc.data()[filter.field] === filter.value);
  }
  const ordering = ref.constraints.orderBy;
  if (ordering) {
    docs.sort((left, right) => {
      const a = left.data()[ordering.field];
      const b = right.data()[ordering.field];
      const order = a < b ? -1 : a > b ? 1 : left.id.localeCompare(right.id);
      return ordering.direction === "desc" ? -order : order;
    });
  } else docs.sort((left, right) => left.id.localeCompare(right.id));
  if (Number.isSafeInteger(ref.constraints.limit)) docs = docs.slice(0, ref.constraints.limit);
  return { docs, size: docs.length };
}

function createFakeDb(entries = []) {
  const store = new Map(entries.map(([path, value]) => [path, clone(value)]));
  const transactions = [];
  return {
    store,
    transactions,
    collection(name) { return new FakeCollectionRef(store, name); },
    async runTransaction(callback) {
      const trace = { reads: [], writes: [] };
      const staged = [];
      let wrote = false;
      const readable = () => {
        if (wrote) throw new Error("Firestore transaction attempted a read after a write.");
      };
      const tx = {
        async get(ref) {
          readable();
          trace.reads.push(ref.path);
          return ref instanceof FakeCollectionRef ? collectionSnapshot(ref, store) : documentSnapshot(ref, store);
        },
        async getAll(...refs) {
          readable();
          trace.reads.push(...refs.map((ref) => ref.path));
          return refs.map((ref) => documentSnapshot(ref, store));
        },
        create(ref, value) {
          wrote = true;
          trace.writes.push({ operation: "create", path: ref.path });
          staged.push({ operation: "create", ref, value: clone(value) });
        },
        set(ref, value) {
          wrote = true;
          trace.writes.push({ operation: "set", path: ref.path });
          staged.push({ operation: "set", ref, value: clone(value) });
        }
      };
      transactions.push(trace);
      const result = await callback(tx);
      for (const { operation, ref, value } of staged) {
        if (operation === "create" && store.has(ref.path)) throw new Error(`Document already exists: ${ref.path}`);
        store.set(ref.path, value);
      }
      return result;
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

function baseEntries({ enabled = true } = {}) {
  return [
    [`organizations/${ORGANIZATION_ID}`, { active: true }],
    [`organizations/${ORGANIZATION_ID}/settings/config`, { inventoryAuthorityEnabled: enabled }],
    [`userRoles/${ADMIN_UID}`, {
      organizationId: ORGANIZATION_ID, role: "admin", email: "admin@example.com"
    }]
  ];
}

function configurationState(overrides = {}) {
  return {
    authorityVersion: inventory.INVENTORY_AUTHORITY_VERSION,
    schemaVersion: 2,
    model: "inventory-configuration-state-v2",
    organizationId: ORGANIZATION_ID,
    stateId: "ingredient-v2",
    locationCount: 0,
    ingredientCount: 0,
    revision: 1,
    updatedAtISO: EVIDENCE_TIME,
    ...overrides
  };
}

function createHarness({ entries = [], globalEnabled = true } = {}) {
  const db = createFakeDb([...baseEntries(), ...entries]);
  const assertStaff = vi.fn(async (context, { expectedOrganizationId }) => {
    if (!context?.staff || context.staff.organizationId !== expectedOrganizationId) {
      throw new FakeHttpsError("permission-denied", "Staff authority is required.");
    }
    return context.staff;
  });
  return {
    db,
    assertStaff,
    runtime: createInventoryAuthorityRuntime({
      db,
      FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
      HttpsError: FakeHttpsError,
      assertStaff,
      normalizeOrganizationId: (value) => String(value || "").trim(),
      isOrganizationRecordActive: (value) => value.active === true,
      globalEnabled: () => globalEnabled,
      logger: { error: vi.fn() },
      now: () => EVIDENCE_TIME
    })
  };
}

const adminContext = {
  staff: {
    uid: ADMIN_UID,
    role: "admin",
    email: "admin@example.com",
    organizationId: ORGANIZATION_ID,
    principalOrganizationId: ORGANIZATION_ID
  }
};

function envelope(command, retryId) {
  return { schemaVersion: 2, organizationId: ORGANIZATION_ID, requestId: retryId, command };
}

const locationCommand = (overrides = {}) => ({
  kind: "upsert_location",
  locationId: "main-kitchen",
  name: "Main kitchen",
  active: true,
  expectedRevision: 0,
  ...overrides
});

const ingredientCommand = (overrides = {}) => ({
  kind: "upsert_ingredient",
  ingredientId: "chicken",
  name: "Chicken breast",
  category: "Protein",
  baseUnitId: "lb",
  active: true,
  expectedRevision: 0,
  ...overrides
});

const openingCommand = (overrides = {}) => ({
  kind: "opening_balance",
  ingredientId: "chicken",
  locationId: "main-kitchen",
  quantity: "40",
  baseUnitId: "lb",
  occurredAtISO: EVIDENCE_TIME,
  note: "Verified opening count",
  expectedStockRevision: 0,
  ...overrides
});

const costCommand = (overrides = {}) => ({
  kind: "record_ingredient_cost",
  ingredientId: "chicken",
  baseUnitId: "lb",
  availability: "available",
  sourceLabel: "Opening stock observation",
  observedAtISO: EVIDENCE_TIME,
  note: "Recorded from operator evidence",
  expectedCostRevision: 0,
  basisQuantity: "40",
  totalCostMinor: 12000,
  currency: "USD",
  ...overrides
});

async function configureChicken(harness) {
  await harness.runtime.applyInventoryCommand(envelope(locationCommand(), "location-create-0001"), adminContext);
  await harness.runtime.applyInventoryCommand(envelope(ingredientCommand(), "ingredient-create-0001"), adminContext);
}

describe("ingredient inventory authority runtime", () => {
  beforeEach(() => vi.restoreAllMocks());

  test("requires exact schema-v2 envelopes and supported ingredient commands", async () => {
    const harness = createHarness();
    await expect(harness.runtime.applyInventoryCommand({
      schemaVersion: 1,
      organizationId: ORGANIZATION_ID,
      requestId: "wrong-schema-0001",
      command: locationCommand()
    }, adminContext)).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(harness.runtime.applyInventoryCommand({
      ...envelope(locationCommand(), "extra-envelope-0001"), extra: true
    }, adminContext)).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(harness.runtime.applyInventoryCommand(envelope({
      ...locationCommand(), turnaroundMinutes: 60
    }, "equipment-field-0001"), adminContext)).rejects.toMatchObject({ code: "invalid-argument" });
    expect(harness.db.transactions).toHaveLength(0);
  });

  test("enforces environment, tenant, active organization, and admin gates", async () => {
    const globallyOff = createHarness({ globalEnabled: false });
    await expect(globallyOff.runtime.applyInventoryCommand(
      envelope(locationCommand(), "global-off-0001"), adminContext
    )).rejects.toMatchObject({ code: "failed-precondition" });

    const tenantOff = createHarness({ entries: [[
      `organizations/${ORGANIZATION_ID}/settings/config`, { inventoryAuthorityEnabled: false }
    ]] });
    await expect(tenantOff.runtime.applyInventoryCommand(
      envelope(locationCommand(), "tenant-off-0001"), adminContext
    )).rejects.toMatchObject({ code: "failed-precondition" });

    const salesContext = { staff: { ...adminContext.staff, role: "sales" } };
    await expect(createHarness().runtime.applyInventoryCommand(
      envelope(locationCommand(), "sales-denied-0001"), salesContext
    )).rejects.toMatchObject({ code: "permission-denied" });

    const crossTenant = { staff: { ...adminContext.staff, organizationId: "org-foreign" } };
    await expect(createHarness().runtime.applyInventoryCommand(
      envelope(locationCommand(), "cross-tenant-0001"), crossTenant
    )).rejects.toMatchObject({ code: "permission-denied" });
  });

  test("creates location and ingredient authorities with bounded projections", async () => {
    const harness = createHarness();
    const location = await harness.runtime.applyInventoryCommand(
      envelope(locationCommand(), "location-create-0001"), adminContext
    );
    const ingredient = await harness.runtime.applyInventoryCommand(
      envelope(ingredientCommand(), "ingredient-create-0001"), adminContext
    );
    expect(location).toMatchObject({
      ok: true, schemaVersion: 2, commandKind: "upsert_location", idempotent: false,
      result: { locationId: "main-kitchen", revision: 1 }
    });
    expect(ingredient).toMatchObject({
      ok: true, commandKind: "upsert_ingredient",
      result: { ingredientId: "chicken", revision: 1, baseUnitId: "lb" }
    });
    expect(harness.db.store.get(
      `organizations/${ORGANIZATION_ID}/inventoryWorkspaceProjections/current`
    )).toEqual({
      authorityVersion: inventory.INVENTORY_AUTHORITY_VERSION,
      schemaVersion: 2,
      model: "inventory-workspace-projection-v2",
      organizationId: ORGANIZATION_ID,
      projectionId: "current",
      workspaceRevision: 1,
      locations: [{ locationId: "main-kitchen", name: "Main kitchen", active: true, revision: 1 }],
      updatedAtISO: EVIDENCE_TIME
    });
    expect(harness.db.store.get(
      `organizations/${ORGANIZATION_ID}/inventoryIngredientProjections/chicken`
    )).toMatchObject({
      model: "inventory-ingredient-projection-v2",
      ingredientId: "chicken",
      stock: { availability: "not_yet_available", stockRevision: 0, quantity: "0" },
      cost: { availability: "not_yet_available", costRevision: 0 }
    });
  });

  test("records 40 lb opening stock and $120 cost as independent evidence axes", async () => {
    const harness = createHarness();
    await configureChicken(harness);
    const opening = await harness.runtime.applyInventoryCommand(
      envelope(openingCommand(), "opening-chicken-0001"), adminContext
    );
    let projection = harness.db.store.get(
      `organizations/${ORGANIZATION_ID}/inventoryIngredientProjections/chicken`
    );
    expect(opening.result).toMatchObject({
      ingredientId: "chicken", stockRevision: 1, onHandMicros: 40000000, onHandQuantity: "40"
    });
    expect(projection.stock).toEqual({
      availability: "current",
      stockRevision: 1,
      onHandMicros: 40000000,
      quantity: "40",
      locationId: "main-kitchen",
      lastMovementId: opening.result.movementId
    });
    expect(projection.cost).toMatchObject({ availability: "not_yet_available", costRevision: 0 });

    const cost = await harness.runtime.applyInventoryCommand(
      envelope(costCommand(), "cost-chicken-0001"), adminContext
    );
    projection = harness.db.store.get(
      `organizations/${ORGANIZATION_ID}/inventoryIngredientProjections/chicken`
    );
    expect(cost.result).toMatchObject({ costRevision: 1, availability: "available" });
    expect(projection.stock).toMatchObject({ onHandMicros: 40000000, stockRevision: 1 });
    expect(projection.cost).toEqual({
      availability: "available",
      costRevision: 1,
      sourceLabel: "Opening stock observation",
      observedAtISO: EVIDENCE_TIME,
      lastCostEvidenceId: cost.result.costEvidenceId,
      basisQuantityMicros: 40000000,
      totalCostMinor: 12000,
      currency: "USD"
    });
    expect(projection.cost).not.toHaveProperty("unitCostMinor");
  });

  test("cost evidence can be recorded before stock without manufacturing on-hand quantity", async () => {
    const harness = createHarness();
    await configureChicken(harness);
    await expect(harness.runtime.applyInventoryCommand(
      envelope(costCommand(), "cost-before-stock-0001"), adminContext
    )).resolves.toMatchObject({ result: { costRevision: 1 } });
    const projection = harness.db.store.get(
      `organizations/${ORGANIZATION_ID}/inventoryIngredientProjections/chicken`
    );
    expect(projection.stock).toMatchObject({ availability: "not_yet_available", onHandMicros: 0 });
    expect(projection.cost).toMatchObject({ availability: "available", totalCostMinor: 12000 });
    await expect(harness.runtime.applyInventoryCommand(envelope(ingredientCommand({
      baseUnitId: "kg",
      expectedRevision: 1
    }), "unit-change-after-cost-0001"), adminContext)).rejects.toMatchObject({
      code: "failed-precondition"
    });
    expect(harness.db.store.get(
      `organizations/${ORGANIZATION_ID}/inventoryIngredients/chicken`
    ).baseUnitId).toBe("lb");
  });

  test("unknown cost remains explicit and does not block confirmed stock", async () => {
    const harness = createHarness();
    await configureChicken(harness);
    await harness.runtime.applyInventoryCommand(envelope(openingCommand(), "opening-no-cost-0001"), adminContext);
    const unavailable = {
      kind: "record_ingredient_cost",
      ingredientId: "chicken",
      baseUnitId: "lb",
      availability: "missing",
      sourceLabel: "Opening count",
      observedAtISO: EVIDENCE_TIME,
      note: "Purchase cost unavailable",
      expectedCostRevision: 0
    };
    await harness.runtime.applyInventoryCommand(envelope(unavailable, "unknown-cost-0001"), adminContext);
    const projection = harness.db.store.get(
      `organizations/${ORGANIZATION_ID}/inventoryIngredientProjections/chicken`
    );
    expect(projection.stock).toMatchObject({ availability: "current", quantity: "40" });
    expect(projection.cost).toMatchObject({ availability: "missing", costRevision: 1 });
    expect(projection.cost).not.toHaveProperty("totalCostMinor");
  });

  test("rejects stale revisions without changing canonical evidence", async () => {
    const harness = createHarness();
    await configureChicken(harness);
    await harness.runtime.applyInventoryCommand(envelope(costCommand(), "cost-current-0001"), adminContext);
    const before = clone(harness.db.store);
    await expect(harness.runtime.applyInventoryCommand(
      envelope(costCommand({ totalCostMinor: 12500 }), "cost-stale-0001"), adminContext
    )).rejects.toMatchObject({ code: "aborted" });
    expect([...harness.db.store.entries()]).toEqual([...before.entries()]);
  });

  test("replays an exact request from its receipt and rejects request substitution", async () => {
    const harness = createHarness();
    const exact = envelope(locationCommand(), "idempotent-location-0001");
    const first = await harness.runtime.applyInventoryCommand(exact, adminContext);
    const replay = await harness.runtime.applyInventoryCommand(exact, adminContext);
    expect(replay).toEqual({ ...first, idempotent: true });
    expect(harness.db.transactions[1].reads[0]).toBe(
      `organizations/${ORGANIZATION_ID}/inventoryAuthorityReceipts/${first.receipt.receiptId}`
    );
    expect(harness.db.transactions[1].reads).not.toContain(
      `organizations/${ORGANIZATION_ID}/inventoryLocations/main-kitchen`
    );
    await expect(harness.runtime.applyInventoryCommand(envelope(
      locationCommand({ name: "Substituted kitchen" }), "idempotent-location-0001"
    ), adminContext)).rejects.toMatchObject({ code: "already-exists" });
  });

  test("replays an exact request after an authorized email change because identity uses stable uid and organization", async () => {
    const harness = createHarness();
    const exact = envelope(locationCommand(), "idempotent-after-email-0001");
    const first = await harness.runtime.applyInventoryCommand(exact, adminContext);
    harness.db.store.set(`userRoles/${ADMIN_UID}`, {
      organizationId: ORGANIZATION_ID,
      role: "admin",
      email: "renamed-admin@example.com"
    });
    const changedEmailContext = {
      staff: { ...adminContext.staff, email: "renamed-admin@example.com" }
    };
    await expect(harness.runtime.applyInventoryCommand(exact, changedEmailContext))
      .resolves.toEqual({ ...first, idempotent: true });
  });

  test("uses one shared configuration fence to reject location and ingredient record 201", async () => {
    const actor = {
      uid: ADMIN_UID,
      email: "admin@example.com",
      role: "admin",
      organizationId: ORGANIZATION_ID
    };
    const locationEntries = Array.from({ length: 200 }, (_, index) => {
      const locationId = `location-${String(index).padStart(3, "0")}`;
      const record = inventory.planLocation({
        organizationId: ORGANIZATION_ID,
        request: {
          kind: "upsert_location",
          locationId,
          name: `Location ${String(index).padStart(3, "0")}`,
          active: true,
          expectedRevision: 0
        },
        actor,
        nowISO: EVIDENCE_TIME
      }).location;
      return [`organizations/${ORGANIZATION_ID}/inventoryLocations/${locationId}`, record];
    });
    const locationHarness = createHarness({ entries: [
      ...locationEntries,
      [`organizations/${ORGANIZATION_ID}/inventoryAuthorityState/ingredient-v2`, configurationState({
        locationCount: 200,
        revision: 200
      })]
    ] });
    await expect(locationHarness.runtime.applyInventoryCommand(envelope(
      locationCommand({ locationId: "location-201", name: "Location 201" }),
      "location-limit-0001"
    ), adminContext)).rejects.toMatchObject({ code: "resource-exhausted" });

    const ingredientHarness = createHarness({ entries: [[
      `organizations/${ORGANIZATION_ID}/inventoryAuthorityState/ingredient-v2`,
      configurationState({ ingredientCount: 200, revision: 200 })
    ]] });
    await expect(ingredientHarness.runtime.applyInventoryCommand(envelope(
      ingredientCommand(), "ingredient-limit-0001"
    ), adminContext)).rejects.toMatchObject({ code: "resource-exhausted" });
  });

  test("reads every transaction dependency before the first write", async () => {
    const harness = createHarness();
    await configureChicken(harness);
    await expect(harness.runtime.applyInventoryCommand(
      envelope(openingCommand(), "read-before-write-0001"), adminContext
    )).resolves.toMatchObject({ ok: true });
    const trace = harness.db.transactions.at(-1);
    expect(trace.reads).toEqual(expect.arrayContaining([
      `organizations/${ORGANIZATION_ID}/inventoryIngredients/chicken`,
      `organizations/${ORGANIZATION_ID}/inventoryLocations/main-kitchen`,
      `organizations/${ORGANIZATION_ID}/settings/config`
    ]));
    expect(trace.writes[0].path).toContain("/inventoryMovements/");
  });

  test("workspace recovery is admin-only and bounded to safe projections", async () => {
    const harness = createHarness();
    await configureChicken(harness);
    await harness.runtime.applyInventoryCommand(envelope(openingCommand(), "workspace-opening-0001"), adminContext);
    const workspace = await harness.runtime.getInventoryWorkspace(
      { schemaVersion: 2, organizationId: ORGANIZATION_ID }, adminContext
    );
    expect(workspace).toMatchObject({
      schemaVersion: 2, organizationId: ORGANIZATION_ID, bounded: true, limit: 200
    });
    expect(workspace.locations).toHaveLength(1);
    expect(workspace.ingredients[0]).toMatchObject({
      ingredientId: "chicken", stock: { quantity: "40" }, cost: { availability: "not_yet_available" }
    });
    expect(JSON.stringify(workspace)).not.toContain("admin@example.com");
    expect(JSON.stringify(workspace)).not.toContain("Verified opening count");
  });

  test("fails closed when canonical evidence is misfiled across tenants", async () => {
    const harness = createHarness();
    await configureChicken(harness);
    const path = `organizations/${ORGANIZATION_ID}/inventoryIngredients/chicken`;
    harness.db.store.set(path, { ...harness.db.store.get(path), organizationId: "org-foreign" });
    await expect(harness.runtime.applyInventoryCommand(
      envelope(costCommand(), "foreign-evidence-0001"), adminContext
    )).rejects.toMatchObject({ code: "data-loss" });
  });

  test("fails closed on internally inconsistent stored stock and cost projections", async () => {
    const harness = createHarness();
    await configureChicken(harness);
    await harness.runtime.applyInventoryCommand(envelope(openingCommand(), "integrity-opening-0001"), adminContext);
    const stockPath = `organizations/${ORGANIZATION_ID}/inventoryStockStates/${inventory.stockStateId("chicken", "main-kitchen")}`;
    harness.db.store.set(stockPath, { ...harness.db.store.get(stockPath), stockStateId: "wrong-state" });
    await expect(harness.runtime.applyInventoryCommand(
      envelope(costCommand(), "integrity-cost-0001"), adminContext
    )).rejects.toMatchObject({ code: "data-loss" });
  });
});
