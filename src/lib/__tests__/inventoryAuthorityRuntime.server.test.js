import { createRequire } from "node:module";
import { beforeEach, describe, expect, test, vi } from "vitest";

const require = createRequire(import.meta.url);
const inventory = require("../../../functions/inventoryIngredientCore.cjs");
const allocation = require("../../../functions/inventoryIngredientAllocationCore.cjs");
const recipe = require("../../../functions/inventoryRecipeCore.cjs");
const { createInventoryAuthorityRuntime, packHeadId } = require("../../../functions/inventoryAuthority.js");

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

const receivingCommand = (overrides = {}) => ({
  kind: "receive_stock",
  ingredientId: "chicken",
  locationId: "main-kitchen",
  quantity: "10",
  baseUnitId: "lb",
  occurredAtISO: EVIDENCE_TIME,
  sourceLabel: "Receiving record",
  note: "Verified delivery",
  expectedStockRevision: 1,
  expectedCostRevision: 0,
  cost: { availability: "available", totalCostMinor: 3000, currency: "USD" },
  ...overrides
});

const stockCountCommand = (overrides = {}) => ({
  kind: "record_stock_count",
  ingredientId: "chicken",
  locationId: "main-kitchen",
  countedQuantity: "37.5",
  baseUnitId: "lb",
  occurredAtISO: EVIDENCE_TIME,
  note: "Human-confirmed shelf count",
  expectedStockRevision: 1,
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

const packCommand = (overrides = {}) => ({
  kind: "publish_pack_conversion",
  ingredientId: "chicken",
  packUnitId: "case",
  packLabel: "40 lb case",
  baseUnitId: "lb",
  baseQuantity: "40",
  sourceLabel: "Operator-declared purchase pack",
  expectedRevision: 0,
  ...overrides
});

const recipeCommand = (overrides = {}) => ({
  kind: "publish_menu_recipe",
  menuItemId: "chicken-alfredo",
  expectedCatalogRevision: 7,
  expectedRecipeRevision: 0,
  outputYield: "10",
  outputUnitId: "portion",
  lines: [
    {
      lineId: "chicken-line",
      ingredientId: "chicken",
      quantity: "2",
      unitKind: "standard",
      unitId: "lb",
      quantityBasis: "as_purchased",
      usableYield: null
    },
    {
      lineId: "pasta-line",
      ingredientId: "pasta",
      quantity: "1",
      unitKind: "standard",
      unitId: "lb",
      quantityBasis: "as_purchased",
      usableYield: null
    }
  ],
  ...overrides
});

const eventDemandCommand = ({ recipeRevisionId, overrides = {} } = {}) => ({
  kind: "compile_event_ingredient_demand",
  quoteId: "quote-alfredo",
  quoteRevisionId: "v0001",
  requiredByBasis: { kind: "quote_event_start" },
  expectedRequirementRevision: 0,
  expectedPreviewProjectionDigest: "a".repeat(64),
  selections: [{
    selectionId: "quote-alfredo-menu-chicken-alfredo",
    menuItemId: "chicken-alfredo",
    recipeRevisionId,
    requiredOutputQuantity: "100",
    outputUnitId: "portion",
    portionBasis: { kind: "explicit_output_quantity", evidenceId: "chicken-alfredo" },
    commercialProvenance: {
      kind: "direct",
      sourceId: "chicken-alfredo"
    }
  }],
  ...overrides
});

const allocateCommand = (eventRequirementRevisionId, overrides = {}) => ({
  kind: "allocate_event_ingredients",
  quoteId: "quote-alfredo",
  eventRequirementRevisionId,
  locationId: "main-kitchen",
  expectedRequirementRevision: 1,
  expectedAllocationRevision: 0,
  ...overrides
});

const releaseCommand = (overrides = {}) => ({
  kind: "release_event_ingredients",
  quoteId: "quote-alfredo",
  expectedAllocationRevision: 1,
  reason: "Event cancelled by operator",
  ...overrides
});

const reconcileCommand = (eventRequirementRevisionId, overrides = {}) => ({
  kind: "reconcile_event_ingredients",
  quoteId: "quote-alfredo",
  eventRequirementRevisionId,
  locationId: "main-kitchen",
  expectedRequirementRevision: 2,
  expectedAllocationRevision: 1,
  reason: "Reconcile accepted commercial revision",
  ...overrides
});

const executionCommand = (eventRequirementRevisionId, overrides = {}) => ({
  kind: "record_event_ingredient_execution",
  quoteId: "quote-alfredo",
  eventRequirementRevisionId,
  expectedExecutionRevision: 0,
  expectedAllocationRevision: 1,
  occurredAtISO: EVIDENCE_TIME,
  reason: "Event kitchen closeout",
  ingredients: [
    {
      ingredientId: "chicken",
      locationId: "main-kitchen",
      baseUnitId: "lb",
      consumedQuantity: "18",
      wasteQuantity: "1",
      expectedStockRevision: 1
    },
    {
      ingredientId: "pasta",
      locationId: "main-kitchen",
      baseUnitId: "lb",
      consumedQuantity: "9",
      wasteQuantity: "0",
      expectedStockRevision: 1
    }
  ],
  ...overrides
});

function installQuoteRevision(harness, { versionId = "v0002", guests = 150 } = {}) {
  const quotePath = `organizations/${ORGANIZATION_ID}/quotes/quote-alfredo`;
  const priorQuote = harness.db.store.get(quotePath);
  const priorVersion = harness.db.store.get(`${quotePath}/versions/v0001`);
  const versionNumber = Number(versionId.slice(1));
  harness.db.store.set(quotePath, {
    ...priorQuote,
    activeVersionId: versionId,
    latestVersionNumber: versionNumber,
    versionMeta: { versionId, versionNumber }
  });
  harness.db.store.set(`${quotePath}/versions/${versionId}`, {
    ...priorVersion,
    versionId,
    versionNumber,
    snapshot: {
      ...priorVersion.snapshot,
      activeVersionId: versionId,
      event: { ...priorVersion.snapshot.event, guests }
    }
  });
}

function menuItem(overrides = {}) {
  return {
    eventTypeId: "event-dinner",
    categoryId: "entrees",
    name: "Chicken Alfredo",
    priceMinor: 1800,
    costMinor: null,
    pricingType: "per_person",
    type: "menu_item",
    active: true,
    createdAtISO: EVIDENCE_TIME,
    ...overrides
  };
}

function quoteDemandEntries() {
  const snapshot = {
    id: "quote-alfredo",
    organizationId: ORGANIZATION_ID,
    activeVersionId: "v0001",
    event: {
      name: "Alfredo dinner",
      date: "2026-10-04",
      time: "17:00",
      guests: 100
    },
    selection: {
      packageId: "dinner-package",
      packageInclusions: { menuItems: [] },
      menuItems: ["chicken-alfredo"],
      menuItemsSnapshot: [{ id: "chicken-alfredo", name: "Chicken Alfredo" }]
    }
  };
  return [
    [`organizations/${ORGANIZATION_ID}/quotes/quote-alfredo`, {
      id: "quote-alfredo",
      organizationId: ORGANIZATION_ID,
      status: "accepted",
      activeVersionId: "v0001",
      latestVersionNumber: 1,
      versionMeta: { versionId: "v0001", versionNumber: 1 }
    }],
    [`organizations/${ORGANIZATION_ID}/quotes/quote-alfredo/versions/v0001`, {
      versionId: "v0001",
      quoteId: "quote-alfredo",
      organizationId: ORGANIZATION_ID,
      versionNumber: 1,
      snapshot
    }]
  ];
}

function projectedQuoteVersion(harness, {
  versionId = "v0002",
  versionNumber = 2,
  date = "2026-10-05",
  time = "18:30",
  menuItems = ["chicken-alfredo"]
} = {}) {
  const prior = clone(harness.db.store.get(
    `organizations/${ORGANIZATION_ID}/quotes/quote-alfredo/versions/v0001`
  ));
  return {
    ...prior,
    versionId,
    versionNumber,
    createdAtISO: EVIDENCE_TIME,
    reason: "quote_edit",
    status: "draft",
    snapshot: {
      ...prior.snapshot,
      activeVersionId: versionId,
      latestVersionNumber: versionNumber,
      versionMeta: { versionId, versionNumber },
      event: { ...prior.snapshot.event, date, time },
      selection: {
        ...prior.snapshot.selection,
        packageInclusions: { menuItems: [] },
        menuItems,
        menuItemsSnapshot: menuItems.map((id) => ({
          id,
          name: id === "chicken-alfredo" ? "Chicken Alfredo" : "Garden salad"
        }))
      }
    }
  };
}

async function configureEventDemandFixture(harness) {
  await configureRecipeFixture(harness);
  await harness.runtime.applyInventoryCommand(
    envelope(openingCommand(), "opening-event-chicken-0001"),
    adminContext
  );
  await harness.runtime.applyInventoryCommand(envelope(openingCommand({
    ingredientId: "pasta",
    quantity: "30"
  }), "opening-event-pasta-0001"), adminContext);
  const published = await harness.runtime.applyInventoryCommand(
    envelope(recipeCommand(), "recipe-event-alfredo-0001"),
    adminContext
  );
  return published.result.recipeRevisionId;
}

async function compileEventDemandFixture(harness) {
  const recipeRevisionId = await configureEventDemandFixture(harness);
  const command = eventDemandCommand({ recipeRevisionId });
  const preview = await harness.runtime.previewEventInventory({
    schemaVersion: 2,
    organizationId: ORGANIZATION_ID,
    quoteId: command.quoteId,
    quoteRevisionId: command.quoteRevisionId,
    requiredByBasis: command.requiredByBasis,
    selections: command.selections
  }, adminContext);
  const result = await harness.runtime.applyInventoryCommand(envelope(eventDemandCommand({
    recipeRevisionId,
    overrides: { expectedPreviewProjectionDigest: preview.projection.projectionDigest }
  }), "compile-event-allocation-fixture-0001"), adminContext);
  return result.result;
}

async function configureRecipeFixture(harness, { pastaCost = true } = {}) {
  await configureChicken(harness);
  await harness.runtime.applyInventoryCommand(envelope(ingredientCommand({
    ingredientId: "pasta",
    name: "Pasta",
    category: "Pantry"
  }), "ingredient-pasta-0001"), adminContext);
  await harness.runtime.applyInventoryCommand(envelope(costCommand(), "cost-chicken-recipe-0001"), adminContext);
  if (pastaCost) {
    await harness.runtime.applyInventoryCommand(envelope(costCommand({
      ingredientId: "pasta",
      sourceLabel: "Opening pasta observation",
      basisQuantity: "30",
      totalCostMinor: 6000
    }), "cost-pasta-recipe-0001"), adminContext);
  }
}

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
      lastMovementId: opening.result.movementId,
      allocationRevision: 0,
      committedMicros: 0,
      committedQuantity: "0",
      availableToAllocateMicros: 40000000,
      availableToAllocateQuantity: "40"
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

  test("receives stock idempotently and preserves an established planning-cost basis", async () => {
    const harness = createHarness();
    await configureChicken(harness);
    await harness.runtime.applyInventoryCommand(
      envelope(openingCommand(), "opening-before-receiving-0001"), adminContext
    );

    const firstRequest = envelope(receivingCommand(), "receive-chicken-0001");
    const first = await harness.runtime.applyInventoryCommand(firstRequest, adminContext);
    expect(first).toMatchObject({
      ok: true,
      idempotent: false,
      commandKind: "receive_stock",
      result: {
        ingredientId: "chicken",
        locationId: "main-kitchen",
        stockRevision: 2,
        costRevision: 1,
        onHandMicros: 50000000,
        onHandQuantity: "50"
      }
    });
    expect(Object.keys(first.result).sort()).toEqual([
      "costEvidenceId", "costRevision", "ingredientId", "locationId", "movementId",
      "onHandMicros", "onHandQuantity", "schemaVersion", "stockRevision"
    ]);
    await expect(harness.runtime.applyInventoryCommand(firstRequest, adminContext))
      .resolves.toEqual({ ...first, idempotent: true });
    await expect(harness.runtime.applyInventoryCommand(envelope(receivingCommand({
      quantity: "11"
    }), "receive-chicken-0001"), adminContext)).rejects.toMatchObject({ code: "already-exists" });

    const costPath = `organizations/${ORGANIZATION_ID}/inventoryCostStates/${inventory.costStateId("chicken")}`;
    const establishedCost = clone(harness.db.store.get(costPath));
    const later = await harness.runtime.applyInventoryCommand(envelope(receivingCommand({
      quantity: "5",
      expectedStockRevision: 2,
      expectedCostRevision: 1,
      sourceLabel: "Later high-price delivery",
      cost: { availability: "available", totalCostMinor: 5000, currency: "USD" }
    }), "receive-chicken-0002"), adminContext);
    expect(later.result).toMatchObject({ stockRevision: 3, costRevision: 1, onHandQuantity: "55" });
    expect(harness.db.store.get(costPath)).toEqual(establishedCost);
    expect(harness.db.store.get(
      `organizations/${ORGANIZATION_ID}/inventoryCostEvidence/${later.result.costEvidenceId}`
    )).toMatchObject({
      costEvidenceVersion: inventory.INVENTORY_RECEIVING_COST_VERSION,
      planningBasisAction: "retained_existing",
      basisQuantity: "5",
      totalCostMinor: 5000
    });
    expect(harness.db.store.get(
      `organizations/${ORGANIZATION_ID}/inventoryIngredientProjections/chicken`
    )).toMatchObject({
      stock: { onHandMicros: 55000000, stockRevision: 3 },
      cost: { costRevision: 1, basisQuantityMicros: 10000000, totalCostMinor: 3000 }
    });
  });

  test("records an exact human stock count idempotently and refuses stale or substituted evidence", async () => {
    const harness = createHarness();
    await configureChicken(harness);
    await harness.runtime.applyInventoryCommand(
      envelope(openingCommand(), "opening-before-count-0001"), adminContext
    );
    const request = envelope(stockCountCommand(), "stock-count-chicken-0001");
    const first = await harness.runtime.applyInventoryCommand(request, adminContext);
    expect(first).toMatchObject({
      ok: true,
      idempotent: false,
      commandKind: "record_stock_count",
      result: {
        ingredientId: "chicken",
        locationId: "main-kitchen",
        stockRevision: 2,
        countedQuantity: "37.5",
        countedQuantityMicros: 37_500_000,
        signedDeltaMicros: -2_500_000,
        onHandQuantity: "37.5"
      }
    });
    const movement = harness.db.store.get(
      `organizations/${ORGANIZATION_ID}/inventoryMovements/${first.result.movementId}`
    );
    expect(inventory.verifyMovement(movement)).toBe(movement);
    await expect(harness.runtime.applyInventoryCommand(request, adminContext))
      .resolves.toEqual({ ...first, idempotent: true });
    await expect(harness.runtime.applyInventoryCommand(envelope(
      stockCountCommand({ countedQuantity: "38" }), "stock-count-chicken-0001"
    ), adminContext)).rejects.toMatchObject({ code: "already-exists" });
    await expect(harness.runtime.applyInventoryCommand(envelope(
      stockCountCommand({ expectedStockRevision: 1 }), "stock-count-chicken-stale-0002"
    ), adminContext)).rejects.toMatchObject({ code: "aborted" });
    await expect(harness.runtime.applyInventoryCommand(envelope(
      { ...stockCountCommand({ expectedStockRevision: 2 }), purchaseOrderId: "forbidden" },
      "stock-count-chicken-extra-0003"
    ), adminContext)).rejects.toMatchObject({ code: "invalid-argument" });
  });

  test("rejects stale receiving revisions before writing quantity or cost evidence", async () => {
    const harness = createHarness();
    await configureChicken(harness);
    await harness.runtime.applyInventoryCommand(
      envelope(openingCommand(), "opening-before-stale-receive-0001"), adminContext
    );
    const before = clone([...harness.db.store.entries()]);
    await expect(harness.runtime.applyInventoryCommand(envelope(receivingCommand({
      expectedStockRevision: 2
    }), "receive-stale-stock-0001"), adminContext)).rejects.toMatchObject({ code: "aborted" });
    expect([...harness.db.store.entries()]).toEqual(before);
  });

  test("receives physical stock after a concurrent missing-cost observation without replacing cost authority", async () => {
    const harness = createHarness();
    await configureChicken(harness);
    await harness.runtime.applyInventoryCommand(
      envelope(openingCommand(), "opening-before-cost-race-0001"), adminContext
    );
    await harness.runtime.applyInventoryCommand(envelope({
      kind: "record_ingredient_cost",
      ingredientId: "chicken",
      baseUnitId: "lb",
      availability: "missing",
      sourceLabel: "Unpriced count",
      observedAtISO: EVIDENCE_TIME,
      note: "Cost not yet available",
      expectedCostRevision: 0
    }, "missing-cost-before-receive-0001"), adminContext);

    const received = await harness.runtime.applyInventoryCommand(envelope(receivingCommand({
      quantity: "5",
      expectedCostRevision: 0,
      sourceLabel: "Receipt observed after cost edit",
      cost: { availability: "available", totalCostMinor: 2500, currency: "USD" }
    }), "receive-after-cost-race-0001"), adminContext);
    expect(received.result).toMatchObject({
      stockRevision: 2,
      costRevision: 1,
      onHandMicros: 45000000
    });
    expect(harness.db.store.get(
      `organizations/${ORGANIZATION_ID}/inventoryCostStates/${inventory.costStateId("chicken")}`
    )).toMatchObject({ availability: "missing", revision: 1 });
    expect(harness.db.store.get(
      `organizations/${ORGANIZATION_ID}/inventoryCostEvidence/${received.result.costEvidenceId}`
    )).toMatchObject({
      planningBasisAction: "retained_existing",
      priorCostRevision: 1,
      resultCostRevision: 1,
      availability: "available",
      totalCostMinor: 2500
    });
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

  test("publishes immutable ingredient-specific pack conversions and projects only their current heads", async () => {
    const harness = createHarness();
    await configureChicken(harness);
    const first = await harness.runtime.applyInventoryCommand(
      envelope(packCommand(), "pack-chicken-case-0001"), adminContext
    );
    expect(first).toMatchObject({
      commandKind: "publish_pack_conversion",
      result: { ingredientId: "chicken", packUnitId: "case", revision: 1 }
    });
    expect(first.result.packConversionRevisionId).toBe(
      recipe.packConversionRevisionIdFor(ORGANIZATION_ID, "chicken", "case", 1)
    );
    expect(harness.db.store.get(
      `organizations/${ORGANIZATION_ID}/inventoryPackConversionRevisions/${first.result.packConversionRevisionId}`
    )).toMatchObject({ baseQuantity: "40", baseUnitId: "lb", revision: 1 });
    expect(harness.db.store.get(
      `organizations/${ORGANIZATION_ID}/inventoryIngredientProjections/chicken`
    ).packConversions).toEqual([expect.objectContaining({
      packUnitId: "case", packLabel: "40 lb case", baseQuantity: "40", revision: 1
    })]);

    await expect(harness.runtime.applyInventoryCommand(
      envelope(packCommand({ baseQuantity: "42" }), "pack-chicken-case-stale"), adminContext
    )).rejects.toMatchObject({ code: "aborted" });
    const replay = await harness.runtime.applyInventoryCommand(
      envelope(packCommand(), "pack-chicken-case-0001"), adminContext
    );
    expect(replay).toMatchObject({ idempotent: true, result: first.result });

    await expect(harness.runtime.applyInventoryCommand(envelope(ingredientCommand({
      baseUnitId: "kg",
      expectedRevision: 1
    }), "ingredient-unit-after-pack-0001"), adminContext)).rejects.toMatchObject({
      code: "failed-precondition"
    });
    expect(harness.db.store.get(
      `organizations/${ORGANIZATION_ID}/inventoryIngredients/chicken`
    ).baseUnitId).toBe("lb");
  });

  test("fails closed when stored pack-conversion evidence disagrees with the ingredient base unit", async () => {
    const harness = createHarness();
    await configureChicken(harness);
    await harness.runtime.applyInventoryCommand(
      envelope(packCommand(), "pack-integrity-case-0001"), adminContext
    );
    const headPath = `organizations/${ORGANIZATION_ID}/inventoryPackConversionHeads/${packHeadId("chicken", "case")}`;
    harness.db.store.set(headPath, { ...harness.db.store.get(headPath), baseUnitId: "kg" });

    await expect(harness.runtime.applyInventoryCommand(envelope(ingredientCommand({
      expectedRevision: 1
    }), "ingredient-pack-integrity-0001"), adminContext)).rejects.toMatchObject({
      code: "data-loss"
    });
  });

  test("previews exact event ingredient demand and cost without writing or inferring billing quantities", async () => {
    const harness = createHarness({ entries: [
      [`organizations/${ORGANIZATION_ID}/settings/config`, {
        inventoryAuthorityEnabled: true, catalogRevision: 7, businessTimeZone: "America/Chicago"
      }],
      [`organizations/${ORGANIZATION_ID}/menuItems/chicken-alfredo`, menuItem()],
      ...quoteDemandEntries()
    ] });
    const recipeRevisionId = await configureEventDemandFixture(harness);
    const before = clone([...harness.db.store.entries()]);
    const command = eventDemandCommand({ recipeRevisionId });
    const transactionCountBeforePreview = harness.db.transactions.length;
    const preview = await harness.runtime.previewEventInventory({
      schemaVersion: 2,
      organizationId: ORGANIZATION_ID,
      quoteId: command.quoteId,
      quoteRevisionId: command.quoteRevisionId,
      requiredByBasis: command.requiredByBasis,
      selections: command.selections
    }, adminContext);

    expect(preview).toMatchObject({
      ok: true,
      preview: true,
      quoteId: "quote-alfredo",
      quoteRevisionId: "v0001",
      projection: {
        demandState: "complete",
        costState: "complete",
        availabilityState: "available",
        projectedCostMinor: 8000,
        currency: "USD"
      },
      ingredientLabels: [
        { ingredientId: "chicken", name: "Chicken breast" },
        { ingredientId: "pasta", name: "Pasta" }
      ]
    });
    expect(preview.projection.ingredients).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ingredientId: "chicken",
        requiredQuantityMicros: 20000000,
        onHandQuantityMicros: 40000000,
        shortageQuantityMicros: 0,
        projectedCostMinor: 6000
      }),
      expect.objectContaining({
        ingredientId: "pasta",
        requiredQuantityMicros: 10000000,
        onHandQuantityMicros: 30000000,
        shortageQuantityMicros: 0,
        projectedCostMinor: 2000
      })
    ]));
    expect([...harness.db.store.entries()]).toEqual(before);
    const previewReads = harness.db.transactions.slice(transactionCountBeforePreview)
      .flatMap(({ reads }) => reads);
    expect(previewReads.some((path) => path.includes("/inventoryMenuCostProjections/"))).toBe(true);
    expect(previewReads.some((path) => path.includes("/inventoryStockStates"))).toBe(true);
    expect(previewReads.some((path) => path.includes("/inventoryCostStates/"))).toBe(false);
    expect(previewReads.some((path) => path.includes("/inventoryCostEvidence/"))).toBe(false);
    expect(previewReads.some((path) => path.includes("/inventoryPackConversionRevisions/"))).toBe(false);

    const menuCostPath = `organizations/${ORGANIZATION_ID}/inventoryMenuCostProjections/chicken-alfredo`;
    const menuCost = harness.db.store.get(menuCostPath);
    harness.db.store.set(menuCostPath, {
      ...menuCost,
      status: "stale",
      freshness: "stale",
      staleReason: "cost_evidence_changed"
    });
    await expect(harness.runtime.previewEventInventory({
      schemaVersion: 2,
      organizationId: ORGANIZATION_ID,
      quoteId: command.quoteId,
      quoteRevisionId: command.quoteRevisionId,
      requiredByBasis: command.requiredByBasis,
      selections: command.selections
    }, adminContext)).rejects.toMatchObject({ code: "aborted" });
  });

  test("previews proposed vNext Inventory demand from the proposed date and explicit output rows without writes", async () => {
    const harness = createHarness({ entries: [
      [`organizations/${ORGANIZATION_ID}/settings/config`, {
        inventoryAuthorityEnabled: true, catalogRevision: 7, businessTimeZone: "America/Chicago"
      }],
      [`organizations/${ORGANIZATION_ID}/menuItems/chicken-alfredo`, menuItem()],
      ...quoteDemandEntries()
    ] });
    await configureEventDemandFixture(harness);
    const projectedVersion = projectedQuoteVersion(harness);
    const before = clone([...harness.db.store.entries()]);
    const transactionCountBeforePreview = harness.db.transactions.length;

    const preview = await harness.runtime.previewProjectedEventInventory({
      organizationId: ORGANIZATION_ID,
      quoteId: "quote-alfredo",
      expectedBaseQuoteRevisionId: "v0001",
      projectedVersion,
      outputRows: [{ menuItemId: "chicken-alfredo", requiredOutputQuantity: "42.5" }]
    }, adminContext);

    expect(preview).toMatchObject({
      ok: true,
      schemaVersion: 2,
      organizationId: ORGANIZATION_ID,
      quoteId: "quote-alfredo",
      quoteRevisionId: "v0002",
      preview: true,
      projection: {
        quoteRevisionId: "v0002",
        requiredByISO: "2026-10-05T23:30:00.000Z",
        demandState: "complete",
        costState: "complete",
        projectedCostMinor: 3400
      },
      ingredientLabels: [
        { ingredientId: "chicken", name: "Chicken breast" },
        { ingredientId: "pasta", name: "Pasta" }
      ]
    });
    expect(preview.inputDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(preview.requirementRevision).toMatchObject({
      quoteRevisionId: "v0002",
      requiredByISO: "2026-10-05T23:30:00.000Z",
      selections: [expect.objectContaining({
        selectionId: "chicken-alfredo",
        menuItemId: "chicken-alfredo",
        requiredOutputQuantity: "42.5"
      })]
    });
    expect(preview.projection.ingredients).toEqual(expect.arrayContaining([
      expect.objectContaining({ ingredientId: "chicken", requiredQuantityMicros: 8500000 }),
      expect.objectContaining({ ingredientId: "pasta", requiredQuantityMicros: 4250000 })
    ]));
    expect([...harness.db.store.entries()]).toEqual(before);
    expect(harness.db.transactions.slice(transactionCountBeforePreview)).toHaveLength(1);
    expect(harness.db.transactions.slice(transactionCountBeforePreview)
      .every(({ writes }) => writes.length === 0)).toBe(true);
  });

  test("uses the proposed menu and derives missing recipe evidence instead of accepting caller authority fields", async () => {
    const harness = createHarness({ entries: [
      [`organizations/${ORGANIZATION_ID}/settings/config`, {
        inventoryAuthorityEnabled: true, catalogRevision: 7, businessTimeZone: "America/Chicago"
      }],
      ...quoteDemandEntries()
    ] });
    const projectedVersion = projectedQuoteVersion(harness, { menuItems: ["garden-salad"] });
    const before = clone([...harness.db.store.entries()]);

    const preview = await harness.runtime.previewProjectedEventInventory({
      organizationId: ORGANIZATION_ID,
      quoteId: "quote-alfredo",
      expectedBaseQuoteRevisionId: "v0001",
      projectedVersion,
      outputRows: [{ menuItemId: "garden-salad", requiredOutputQuantity: "12" }]
    }, adminContext);

    expect(preview.requirementRevision).toMatchObject({
      quoteRevisionId: "v0002",
      demandState: "incomplete",
      selections: [expect.objectContaining({
        selectionId: "garden-salad",
        menuItemId: "garden-salad",
        recipeRevisionId: null,
        requiredOutputQuantity: "12",
        outputUnitId: null
      })],
      issues: [{ code: "missing_recipe_revision", menuItemId: "garden-salad", selectionId: "garden-salad" }]
    });
    expect([...harness.db.store.entries()]).toEqual(before);

    const transactionCountBeforeInvalidRow = harness.db.transactions.length;
    await expect(harness.runtime.previewProjectedEventInventory({
      organizationId: ORGANIZATION_ID,
      quoteId: "quote-alfredo",
      expectedBaseQuoteRevisionId: "v0001",
      projectedVersion,
      outputRows: [{
        menuItemId: "garden-salad",
        requiredOutputQuantity: "12",
        recipeRevisionId: "forged-recipe"
      }]
    }, adminContext)).rejects.toMatchObject({ code: "invalid-argument" });
    expect(harness.db.transactions).toHaveLength(transactionCountBeforeInvalidRow);
  });

  test("aborts projected Inventory preview when the saved base quote revision drifts", async () => {
    const harness = createHarness({ entries: [
      [`organizations/${ORGANIZATION_ID}/settings/config`, {
        inventoryAuthorityEnabled: true, catalogRevision: 7, businessTimeZone: "America/Chicago"
      }],
      ...quoteDemandEntries()
    ] });
    const projectedVersion = projectedQuoteVersion(harness);
    installQuoteRevision(harness, { versionId: "v0009" });
    const before = clone([...harness.db.store.entries()]);
    const transactionCountBeforePreview = harness.db.transactions.length;

    await expect(harness.runtime.previewProjectedEventInventory({
      organizationId: ORGANIZATION_ID,
      quoteId: "quote-alfredo",
      expectedBaseQuoteRevisionId: "v0001",
      projectedVersion,
      outputRows: [{ menuItemId: "chicken-alfredo", requiredOutputQuantity: "42.5" }]
    }, adminContext)).rejects.toMatchObject({ code: "aborted" });
    expect([...harness.db.store.entries()]).toEqual(before);
    expect(harness.db.transactions.slice(transactionCountBeforePreview)
      .every(({ writes }) => writes.length === 0)).toBe(true);
  });

  test("records immutable event demand and an as-recorded exact-document projection with receipt replay", async () => {
    const harness = createHarness({ entries: [
      [`organizations/${ORGANIZATION_ID}/settings/config`, {
        inventoryAuthorityEnabled: true, catalogRevision: 7, businessTimeZone: "America/Chicago"
      }],
      [`organizations/${ORGANIZATION_ID}/menuItems/chicken-alfredo`, menuItem()],
      ...quoteDemandEntries()
    ] });
    const recipeRevisionId = await configureEventDemandFixture(harness);
    const draft = eventDemandCommand({ recipeRevisionId });
    const preview = await harness.runtime.previewEventInventory({
      schemaVersion: 2,
      organizationId: ORGANIZATION_ID,
      quoteId: draft.quoteId,
      quoteRevisionId: draft.quoteRevisionId,
      requiredByBasis: draft.requiredByBasis,
      selections: draft.selections
    }, adminContext);
    const request = envelope(eventDemandCommand({ recipeRevisionId, overrides: {
      expectedPreviewProjectionDigest: preview.projection.projectionDigest
    } }), "compile-event-demand-0001");
    const first = await harness.runtime.applyInventoryCommand(request, adminContext);
    const replay = await harness.runtime.applyInventoryCommand(request, adminContext);

    expect(first).toMatchObject({
      ok: true,
      idempotent: false,
      commandKind: "compile_event_ingredient_demand",
      result: {
        quoteId: "quote-alfredo",
        quoteRevisionId: "v0001",
        requirementRevision: 1,
        demandState: "complete",
        costState: "complete",
        availabilityState: "available"
      }
    });
    expect(replay).toEqual({ ...first, idempotent: true });
    const projection = harness.db.store.get(
      `organizations/${ORGANIZATION_ID}/eventIngredientProjections/quote-alfredo`
    );
    expect(projection).toMatchObject({
      model: "event-ingredient-projection-v1",
      requirementRevision: 1,
      eventRequirementRevisionId: first.result.eventRequirementRevisionId,
      requirementDigest: first.result.requirementDigest,
      freshness: "as_recorded",
      staleReason: "",
      projectedCostMinor: 8000
    });
    const immutable = harness.db.store.get(
      `organizations/${ORGANIZATION_ID}/eventIngredientRequirements/quote-alfredo/revisions/${first.result.eventRequirementRevisionId}`
    );
    expect(immutable).toMatchObject({
      model: "event-ingredient-requirement-record-v1",
      requirement: {
        eventRequirementRevisionId: first.result.eventRequirementRevisionId,
        projectedCostMinor: 8000
      }
    });
  });

  test("partially allocates consumable stock against a cross-date shared fence and releases only commitment", async () => {
    const harness = createHarness({ entries: [
      [`organizations/${ORGANIZATION_ID}/settings/config`, {
        inventoryAuthorityEnabled: true, catalogRevision: 7, businessTimeZone: "America/Chicago"
      }],
      [`organizations/${ORGANIZATION_ID}/menuItems/chicken-alfredo`, menuItem()],
      ...quoteDemandEntries()
    ] });
    const compiled = await compileEventDemandFixture(harness);
    const chickenFenceId = allocation.allocationFenceId(ORGANIZATION_ID, "chicken", "main-kitchen");
    const otherPlanId = allocation.eventPlanIdFor(ORGANIZATION_ID, "quote-other-day");
    harness.db.store.set(
      `organizations/${ORGANIZATION_ID}/inventoryAllocationFences/${chickenFenceId}`,
      {
        authorityVersion: inventory.INVENTORY_AUTHORITY_VERSION,
        schemaVersion: 2,
        allocationVersion: allocation.ALLOCATION_VERSION,
        model: "ingredient-allocation-fence-v1",
        organizationId: ORGANIZATION_ID,
        fenceId: chickenFenceId,
        ingredientId: "chicken",
        locationId: "main-kitchen",
        baseUnitId: "lb",
        revision: 1,
        committedMicros: 25000000,
        allocations: [{
          allocationId: allocation.allocationIdFor(
            ORGANIZATION_ID, "quote-other-day", "chicken", "main-kitchen"
          ),
          eventPlanId: otherPlanId,
          quoteId: "quote-other-day",
          eventRequirementRevisionId: "eir_" + "1".repeat(48),
          quantityMicros: 25000000
        }],
        updatedAtISO: EVIDENCE_TIME
      }
    );

    const allocateRequest = envelope(
      allocateCommand(compiled.eventRequirementRevisionId),
      "allocate-alfredo-0001"
    );
    const first = await harness.runtime.applyInventoryCommand(allocateRequest, adminContext);
    expect(first).toMatchObject({
      ok: true,
      idempotent: false,
      commandKind: "allocate_event_ingredients",
      result: {
        quoteId: "quote-alfredo",
        allocationRevision: 1,
        state: "shortage",
        ingredientCount: 2,
        fullyAllocatedIngredientCount: 1,
        shortageIngredientCount: 1
      }
    });
    expect(Object.keys(first.result).sort()).toEqual([
      "allocationRevision", "eventPlanId", "eventRequirementRevisionId", "fullyAllocatedIngredientCount",
      "ingredientCount", "quoteId", "schemaVersion", "shortageIngredientCount", "state"
    ]);
    await expect(harness.runtime.applyInventoryCommand(allocateRequest, adminContext))
      .resolves.toEqual({ ...first, idempotent: true });
    await expect(harness.runtime.applyInventoryCommand(envelope(allocateCommand(
      compiled.eventRequirementRevisionId,
      { locationId: "substituted-location" }
    ), "allocate-alfredo-0001"), adminContext)).rejects.toMatchObject({ code: "already-exists" });

    const currentPlanPath = `organizations/${ORGANIZATION_ID}/eventIngredientPlans/quote-alfredo`;
    const currentPlan = harness.db.store.get(currentPlanPath);
    expect(currentPlan.ingredients).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ingredientId: "chicken",
        requiredQuantityMicros: 20000000,
        allocatedQuantityMicros: 15000000,
        shortageQuantityMicros: 5000000
      }),
      expect.objectContaining({
        ingredientId: "pasta",
        requiredQuantityMicros: 10000000,
        allocatedQuantityMicros: 10000000,
        shortageQuantityMicros: 0
      })
    ]));
    expect(harness.db.store.has(`${currentPlanPath}/revisions/${currentPlan.planRevisionId}`)).toBe(true);
    expect(harness.db.store.get(
      `organizations/${ORGANIZATION_ID}/inventoryStockStates/${inventory.stockStateId("chicken", "main-kitchen")}`
    ).onHandMicros).toBe(40000000);
    expect(harness.db.store.get(
      `organizations/${ORGANIZATION_ID}/inventoryIngredientProjections/chicken`
    ).stock).toMatchObject({
      onHandMicros: 40000000,
      committedMicros: 40000000,
      availableToAllocateMicros: 0,
      allocationRevision: 2
    });
    expect(harness.db.store.get(
      `organizations/${ORGANIZATION_ID}/eventIngredientProjections/quote-alfredo`
    ).allocation).toMatchObject({
      state: "shortage",
      allocationRevision: 1,
      ingredientCount: 2,
      shortageIngredientCount: 1
    });

    await harness.runtime.applyInventoryCommand(envelope(receivingCommand({
      quantity: "5",
      expectedStockRevision: 1,
      expectedCostRevision: 1,
      sourceLabel: "Supply received for shortage recovery",
      cost: { availability: "available", totalCostMinor: 1800, currency: "USD" }
    }), "receive-for-allocation-top-up-0001"), adminContext);
    const eventProjectionPath =
      `organizations/${ORGANIZATION_ID}/eventIngredientProjections/quote-alfredo`;
    const projectionBeforeTamper = harness.db.store.get(eventProjectionPath);
    harness.db.store.set(eventProjectionPath, {
      ...projectionBeforeTamper,
      allocation: {
        ...projectionBeforeTamper.allocation,
        ingredients: projectionBeforeTamper.allocation.ingredients.map((row, index) => index === 0
          ? { ...row, allocatedQuantityMicros: row.allocatedQuantityMicros - 1,
            shortageQuantityMicros: row.shortageQuantityMicros + 1 }
          : row)
      }
    });
    await expect(harness.runtime.applyInventoryCommand(envelope(allocateCommand(
      compiled.eventRequirementRevisionId,
      { expectedAllocationRevision: 1 }
    ), "allocate-alfredo-top-up-tampered-0002"), adminContext)).rejects.toMatchObject({
      code: "data-loss"
    });
    harness.db.store.set(eventProjectionPath, projectionBeforeTamper);
    const toppedUp = await harness.runtime.applyInventoryCommand(envelope(allocateCommand(
      compiled.eventRequirementRevisionId,
      { expectedAllocationRevision: 1 }
    ), "allocate-alfredo-top-up-0002"), adminContext);
    expect(toppedUp.result).toMatchObject({
      state: "reserved",
      allocationRevision: 2,
      fullyAllocatedIngredientCount: 2,
      shortageIngredientCount: 0
    });
    expect(harness.db.store.get(currentPlanPath).ingredients).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ingredientId: "chicken",
        requiredQuantityMicros: 20000000,
        allocatedQuantityMicros: 20000000,
        shortageQuantityMicros: 0
      })
    ]));
    expect(harness.db.store.get(
      `organizations/${ORGANIZATION_ID}/inventoryAllocationFences/${chickenFenceId}`
    )).toMatchObject({ committedMicros: 45000000, revision: 3 });

    const release = await harness.runtime.applyInventoryCommand(
      envelope(releaseCommand({ expectedAllocationRevision: 2 }), "release-alfredo-0001"), adminContext
    );
    expect(release.result).toEqual({
      schemaVersion: 2,
      quoteId: "quote-alfredo",
      eventPlanId: first.result.eventPlanId,
      allocationRevision: 3,
      state: "released",
      eventRequirementRevisionId: compiled.eventRequirementRevisionId,
      ingredientCount: 2,
      fullyAllocatedIngredientCount: 2,
      shortageIngredientCount: 0,
      releasedIngredientCount: 2
    });
    expect(release.result).not.toHaveProperty("releaseReason");
    expect(harness.db.store.get(
      `organizations/${ORGANIZATION_ID}/inventoryStockStates/${inventory.stockStateId("chicken", "main-kitchen")}`
    ).onHandMicros).toBe(45000000);
    expect(harness.db.store.get(
      `organizations/${ORGANIZATION_ID}/inventoryAllocationFences/${chickenFenceId}`
    )).toMatchObject({ committedMicros: 25000000, revision: 4 });
    const releasedPlan = harness.db.store.get(currentPlanPath);
    expect(releasedPlan).toMatchObject({
      state: "released", allocationRevision: 3, releaseReason: "Event cancelled by operator"
    });
    expect(harness.db.store.has(`${currentPlanPath}/revisions/${releasedPlan.planRevisionId}`)).toBe(true);
    await expect(harness.runtime.applyInventoryCommand(envelope(releaseCommand({
      expectedAllocationRevision: 3
    }), "release-alfredo-new-request-0002"), adminContext)).rejects.toMatchObject({
      code: "failed-precondition"
    });
  });

  test("settles ingredient use atomically and applies correction deltas without double subtraction", async () => {
    const harness = createHarness({ entries: [
      [`organizations/${ORGANIZATION_ID}/settings/config`, {
        inventoryAuthorityEnabled: true, catalogRevision: 7, businessTimeZone: "America/Chicago"
      }],
      [`organizations/${ORGANIZATION_ID}/menuItems/chicken-alfredo`, menuItem()],
      ...quoteDemandEntries()
    ] });
    const compiled = await compileEventDemandFixture(harness);
    await harness.runtime.applyInventoryCommand(envelope(
      allocateCommand(compiled.eventRequirementRevisionId),
      "allocate-execution-fixture-0001"
    ), adminContext);

    const request = envelope(
      executionCommand(compiled.eventRequirementRevisionId),
      "record-execution-fixture-0001"
    );
    const recorded = await harness.runtime.applyInventoryCommand(request, adminContext);
    expect(recorded).toMatchObject({
      ok: true,
      idempotent: false,
      commandKind: "record_event_ingredient_execution",
      result: {
        quoteId: "quote-alfredo",
        executionRevision: 1,
        state: "settled"
      }
    });
    await expect(harness.runtime.applyInventoryCommand(request, adminContext))
      .resolves.toEqual({ ...recorded, idempotent: true });

    const planPath = `organizations/${ORGANIZATION_ID}/eventIngredientPlans/quote-alfredo`;
    expect(harness.db.store.get(planPath)).toMatchObject({
      state: "settled",
      allocationRevision: 2,
      settlementExecutionRevisionId: recorded.result.eventExecutionRevisionId
    });
    expect(harness.db.store.get(
      `organizations/${ORGANIZATION_ID}/inventoryStockStates/${inventory.stockStateId("chicken", "main-kitchen")}`
    )).toMatchObject({ onHandMicros: 21000000, revision: 2 });
    expect(harness.db.store.get(
      `organizations/${ORGANIZATION_ID}/inventoryStockStates/${inventory.stockStateId("pasta", "main-kitchen")}`
    )).toMatchObject({ onHandMicros: 21000000, revision: 2 });
    expect(harness.db.store.get(
      `organizations/${ORGANIZATION_ID}/inventoryAllocationFences/${allocation.allocationFenceId(
        ORGANIZATION_ID, "chicken", "main-kitchen"
      )}`
    )).toMatchObject({ committedMicros: 0 });
    expect(harness.db.store.get(
      `organizations/${ORGANIZATION_ID}/eventIngredientExecutionProjections/quote-alfredo`
    )).toMatchObject({
      model: "event-ingredient-execution-projection-v1",
      executionRevision: 1,
      lastReceiptId: recorded.receipt.receiptId,
      costSummary: {
        actualCogsState: "unavailable",
        actualCogsReason: "valuation_policy_unresolved",
        plannedBasisState: "complete"
      }
    });

    const corrected = await harness.runtime.applyInventoryCommand(envelope(executionCommand(
      compiled.eventRequirementRevisionId,
      {
        kind: "correct_event_ingredient_execution",
        expectedExecutionRevision: 1,
        expectedAllocationRevision: 2,
        reason: "Corrected final kitchen count",
        ingredients: [
          {
            ingredientId: "chicken", locationId: "main-kitchen", baseUnitId: "lb",
            consumedQuantity: "17", wasteQuantity: "1", expectedStockRevision: 2
          },
          {
            ingredientId: "pasta", locationId: "main-kitchen", baseUnitId: "lb",
            consumedQuantity: "8", wasteQuantity: "1", expectedStockRevision: 2
          }
        ]
      }
    ), "correct-execution-fixture-0002"), adminContext);
    expect(corrected.result).toMatchObject({ executionRevision: 2, state: "settled" });
    expect(corrected.result.movementIds).toHaveLength(1);
    expect(harness.db.store.get(
      `organizations/${ORGANIZATION_ID}/inventoryStockStates/${inventory.stockStateId("chicken", "main-kitchen")}`
    )).toMatchObject({ onHandMicros: 22000000, revision: 3 });
    expect(harness.db.store.get(
      `organizations/${ORGANIZATION_ID}/inventoryStockStates/${inventory.stockStateId("pasta", "main-kitchen")}`
    )).toMatchObject({ onHandMicros: 21000000, revision: 2 });
    const immutablePath = `organizations/${ORGANIZATION_ID}/eventIngredientExecutions/quote-alfredo/revisions/${corrected.result.eventExecutionRevisionId}`;
    expect(harness.db.store.has(immutablePath)).toBe(true);
  });

  test("fails allocation closed when commercial, recipe, or projection authority drifts", async () => {
    async function preparedHarness() {
      const harness = createHarness({ entries: [
        [`organizations/${ORGANIZATION_ID}/settings/config`, {
          inventoryAuthorityEnabled: true, catalogRevision: 7, businessTimeZone: "America/Chicago"
        }],
        [`organizations/${ORGANIZATION_ID}/menuItems/chicken-alfredo`, menuItem()],
        ...quoteDemandEntries()
      ] });
      const compiled = await compileEventDemandFixture(harness);
      return { harness, compiled };
    }

    const sent = await preparedHarness();
    const quotePath = `organizations/${ORGANIZATION_ID}/quotes/quote-alfredo`;
    sent.harness.db.store.set(quotePath, {
      ...sent.harness.db.store.get(quotePath), status: "sent"
    });
    await expect(sent.harness.runtime.applyInventoryCommand(envelope(
      allocateCommand(sent.compiled.eventRequirementRevisionId),
      "allocate-sent-denied-0001"
    ), adminContext)).rejects.toMatchObject({ code: "failed-precondition" });

    const revisionDrift = await preparedHarness();
    revisionDrift.harness.db.store.set(quotePath, {
      ...revisionDrift.harness.db.store.get(quotePath), activeVersionId: "v0002"
    });
    await expect(revisionDrift.harness.runtime.applyInventoryCommand(envelope(
      allocateCommand(revisionDrift.compiled.eventRequirementRevisionId),
      "allocate-revision-drift-0001"
    ), adminContext)).rejects.toMatchObject({ code: "aborted" });

    const recipeDrift = await preparedHarness();
    await recipeDrift.harness.runtime.applyInventoryCommand(envelope(recipeCommand({
      expectedRecipeRevision: 1
    }), "recipe-drift-before-allocation-0002"), adminContext);
    await expect(recipeDrift.harness.runtime.applyInventoryCommand(envelope(
      allocateCommand(recipeDrift.compiled.eventRequirementRevisionId),
      "allocate-recipe-drift-0001"
    ), adminContext)).rejects.toMatchObject({ code: "aborted" });

    const staleProjection = await preparedHarness();
    const eventProjectionPath = `organizations/${ORGANIZATION_ID}/eventIngredientProjections/quote-alfredo`;
    staleProjection.harness.db.store.set(eventProjectionPath, {
      ...staleProjection.harness.db.store.get(eventProjectionPath),
      freshness: "stale",
      staleReason: "recipe_changed",
      freshnessState: {
        ...staleProjection.harness.db.store.get(eventProjectionPath).freshnessState,
        demand: { state: "stale", reason: "recipe_changed" }
      }
    });
    await expect(staleProjection.harness.runtime.applyInventoryCommand(envelope(
      allocateCommand(staleProjection.compiled.eventRequirementRevisionId),
      "allocate-stale-projection-0001"
    ), adminContext)).rejects.toMatchObject({ code: "aborted" });

    const tamperedProjection = await preparedHarness();
    await tamperedProjection.harness.runtime.applyInventoryCommand(envelope(
      allocateCommand(tamperedProjection.compiled.eventRequirementRevisionId),
      "allocate-before-projection-tamper-0001"
    ), adminContext);
    const projection = tamperedProjection.harness.db.store.get(eventProjectionPath);
    tamperedProjection.harness.db.store.set(eventProjectionPath, {
      ...projection,
      allocation: {
        ...projection.allocation,
        fullyAllocatedIngredientCount: 1,
        shortageIngredientCount: 1,
        ingredients: projection.allocation.ingredients.map((row, index) => index === 0
          ? { ...row, allocatedQuantityMicros: row.allocatedQuantityMicros - 1,
            shortageQuantityMicros: row.shortageQuantityMicros + 1 }
          : row)
      }
    });
    await expect(tamperedProjection.harness.runtime.applyInventoryCommand(envelope(releaseCommand(),
      "release-tampered-projection-0001"), adminContext)).rejects.toMatchObject({ code: "data-loss" });
  });

  test("preserves active holds across a new commercial requirement and reconciles them explicitly with receipt replay", async () => {
    const harness = createHarness({ entries: [
      [`organizations/${ORGANIZATION_ID}/settings/config`, {
        inventoryAuthorityEnabled: true, catalogRevision: 7, businessTimeZone: "America/Chicago"
      }],
      [`organizations/${ORGANIZATION_ID}/menuItems/chicken-alfredo`, menuItem()],
      ...quoteDemandEntries()
    ] });
    const firstRequirement = await compileEventDemandFixture(harness);
    await harness.runtime.applyInventoryCommand(envelope(
      allocateCommand(firstRequirement.eventRequirementRevisionId),
      "allocate-before-commercial-change-0001"
    ), adminContext);
    const eventProjectionPath = `organizations/${ORGANIZATION_ID}/eventIngredientProjections/quote-alfredo`;
    const planPath = `organizations/${ORGANIZATION_ID}/eventIngredientPlans/quote-alfredo`;
    const oldPlan = clone(harness.db.store.get(planPath));
    const chickenFencePath = `organizations/${ORGANIZATION_ID}/inventoryAllocationFences/${
      allocation.allocationFenceId(ORGANIZATION_ID, "chicken", "main-kitchen")}`;

    installQuoteRevision(harness, { guests: 150 });
    await expect(harness.runtime.invalidateEventIngredientsForQuoteChange({
      organizationId: ORGANIZATION_ID,
      quoteId: "quote-alfredo",
      beforeActiveVersionId: "v0001",
      afterActiveVersionId: "v0002"
    })).resolves.toEqual({ changed: true, affectedQuoteCount: 1 });
    await expect(harness.runtime.invalidateEventIngredientsForQuoteChange({
      organizationId: ORGANIZATION_ID,
      quoteId: "quote-alfredo",
      beforeActiveVersionId: "v0001",
      afterActiveVersionId: "v0002"
    })).resolves.toEqual({ changed: false, affectedQuoteCount: 0 });
    expect(harness.db.store.get(eventProjectionPath)).toMatchObject({
      freshness: "stale",
      freshnessState: {
        demand: { state: "stale", reason: "commercial_revision_changed" },
        allocation: { state: "stale", reason: "commercial_revision_changed" }
      }
    });
    expect(harness.db.store.get(planPath)).toEqual(oldPlan);

    const recipeRevisionId = harness.db.store.get(
      `organizations/${ORGANIZATION_ID}/inventoryRecipeHeads/chicken-alfredo`
    ).recipeRevisionId;
    const nextDraft = eventDemandCommand({ recipeRevisionId, overrides: {
      quoteRevisionId: "v0002",
      expectedRequirementRevision: 1,
      selections: [{
        ...eventDemandCommand({ recipeRevisionId }).selections[0],
        requiredOutputQuantity: "150"
      }]
    } });
    const nextPreview = await harness.runtime.previewEventInventory({
      schemaVersion: 2,
      organizationId: ORGANIZATION_ID,
      quoteId: nextDraft.quoteId,
      quoteRevisionId: nextDraft.quoteRevisionId,
      requiredByBasis: nextDraft.requiredByBasis,
      selections: nextDraft.selections
    }, adminContext);
    const recorded = await harness.runtime.applyInventoryCommand(envelope({
      ...nextDraft,
      expectedPreviewProjectionDigest: nextPreview.projection.projectionDigest
    }, "compile-commercial-change-0002"), adminContext);

    const retainedProjection = harness.db.store.get(eventProjectionPath);
    expect(retainedProjection).toMatchObject({
      freshness: "as_recorded",
      eventRequirementRevisionId: recorded.result.eventRequirementRevisionId,
      allocation: {
        eventRequirementRevisionId: firstRequirement.eventRequirementRevisionId,
        allocationRevision: 1
      },
      freshnessState: {
        demand: { state: "current", reason: "" },
        cost: { state: "current", reason: "" },
        availability: { state: "current", reason: "" },
        allocation: { state: "stale", reason: "requirement_changed" }
      }
    });
    expect(harness.db.store.get(chickenFencePath).committedMicros).toBe(20000000);
    await expect(harness.runtime.invalidateEventIngredientsForQuoteChange({
      organizationId: ORGANIZATION_ID,
      quoteId: "quote-alfredo",
      beforeActiveVersionId: "v0001",
      afterActiveVersionId: "v0002"
    })).resolves.toEqual({ changed: false, affectedQuoteCount: 0 });
    expect(harness.db.store.get(eventProjectionPath).freshness).toBe("as_recorded");
    await expect(harness.runtime.applyInventoryCommand(envelope(allocateCommand(
      recorded.result.eventRequirementRevisionId,
      { expectedRequirementRevision: 2, expectedAllocationRevision: 1 }
    ), "top-up-stale-plan-denied-0001"), adminContext)).rejects.toMatchObject({ code: "failed-precondition" });

    const request = envelope(reconcileCommand(recorded.result.eventRequirementRevisionId),
      "reconcile-commercial-change-0001");
    const reconciled = await harness.runtime.applyInventoryCommand(request, adminContext);
    await expect(harness.runtime.applyInventoryCommand(request, adminContext))
      .resolves.toEqual({ ...reconciled, idempotent: true });
    expect(reconciled).toMatchObject({
      idempotent: false,
      commandKind: "reconcile_event_ingredients",
      result: {
        allocationRevision: 3,
        state: "reserved",
        reconciledFromAllocationRevision: 1,
        eventRequirementRevisionId: recorded.result.eventRequirementRevisionId
      }
    });
    expect(harness.db.store.get(chickenFencePath).committedMicros).toBe(30000000);
    expect(harness.db.store.get(planPath).ingredients).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ingredientId: "chicken",
        requiredQuantityMicros: 30000000,
        allocatedQuantityMicros: 30000000
      })
    ]));
    expect(harness.db.store.get(eventProjectionPath).freshnessState.allocation)
      .toEqual({ state: "current", reason: "" });
    await expect(harness.runtime.applyInventoryCommand(envelope(reconcileCommand(
      recorded.result.eventRequirementRevisionId,
      { reason: "Substituted retry" }
    ), "reconcile-commercial-change-0001"), adminContext)).rejects.toMatchObject({ code: "already-exists" });
  });

  test("keeps release available for stale holds and isolates cost-only invalidation from demand and allocation", async () => {
    const harness = createHarness({ entries: [
      [`organizations/${ORGANIZATION_ID}/settings/config`, {
        inventoryAuthorityEnabled: true, catalogRevision: 7, businessTimeZone: "America/Chicago"
      }],
      [`organizations/${ORGANIZATION_ID}/menuItems/chicken-alfredo`, menuItem()],
      ...quoteDemandEntries()
    ] });
    const compiled = await compileEventDemandFixture(harness);
    await harness.runtime.applyInventoryCommand(envelope(
      allocateCommand(compiled.eventRequirementRevisionId), "allocate-before-recipe-change-0001"
    ), adminContext);
    const projectionPath = `organizations/${ORGANIZATION_ID}/eventIngredientProjections/quote-alfredo`;
    const planPath = `organizations/${ORGANIZATION_ID}/eventIngredientPlans/quote-alfredo`;
    const heldPlan = clone(harness.db.store.get(planPath));
    const pinnedSelection = harness.db.store.get(projectionPath).selections[0];
    await harness.runtime.applyInventoryCommand(envelope(costCommand({
      expectedCostRevision: 1,
      totalCostMinor: 16000
    }), "cost-before-event-invalidation-0002"), adminContext);
    const changedMenuCost = harness.db.store.get(
      `organizations/${ORGANIZATION_ID}/inventoryMenuCostProjections/chicken-alfredo`
    );

    await expect(harness.runtime.invalidateEventIngredientsForMenuChange({
      organizationId: ORGANIZATION_ID,
      menuItemId: "chicken-alfredo",
      changeKind: "cost",
      beforeSourceDigest: pinnedSelection.recipeCostResultDigest,
      afterSourceDigest: changedMenuCost.cost.resultDigest
    })).resolves.toEqual({ changed: true, affectedQuoteCount: 1 });
    await expect(harness.runtime.invalidateEventIngredientsForMenuChange({
      organizationId: ORGANIZATION_ID,
      menuItemId: "chicken-alfredo",
      changeKind: "cost",
      beforeSourceDigest: pinnedSelection.recipeCostResultDigest,
      afterSourceDigest: changedMenuCost.cost.resultDigest
    })).resolves.toEqual({ changed: false, affectedQuoteCount: 0 });
    expect(harness.db.store.get(projectionPath).freshnessState).toMatchObject({
      demand: { state: "current", reason: "" },
      cost: { state: "stale", reason: "menu_cost_basis_changed" },
      availability: { state: "current", reason: "" },
      allocation: { state: "current", reason: "" }
    });
    expect(harness.db.store.get(planPath)).toEqual(heldPlan);

    const changedRecipe = await harness.runtime.applyInventoryCommand(envelope(recipeCommand({
      expectedRecipeRevision: 1
    }), "recipe-before-event-invalidation-0002"), adminContext);
    await expect(harness.runtime.invalidateEventIngredientsForMenuChange({
      organizationId: ORGANIZATION_ID,
      menuItemId: "chicken-alfredo",
      changeKind: "recipe",
      beforeSourceDigest: pinnedSelection.recipeRevisionId,
      afterSourceDigest: changedRecipe.result.recipeRevisionId
    })).resolves.toEqual({ changed: true, affectedQuoteCount: 1 });
    expect(harness.db.store.get(projectionPath).freshnessState.allocation)
      .toEqual({ state: "stale", reason: "recipe_revision_changed" });
    expect(harness.db.store.get(planPath)).toEqual(heldPlan);

    const released = await harness.runtime.applyInventoryCommand(envelope(
      releaseCommand({ reason: "Release stale preserved hold" }),
      "release-stale-plan-0001"
    ), adminContext);
    expect(released.result).toMatchObject({ state: "released", allocationRevision: 2 });
    expect(harness.db.store.get(projectionPath)).toMatchObject({
      freshness: "stale",
      freshnessState: { allocation: { state: "released", reason: "" } },
      allocation: { state: "released" }
    });
  });

  test("ignores replayed or out-of-order recipe and cost invalidations after their event projection advances", async () => {
    const entries = () => [
      [`organizations/${ORGANIZATION_ID}/settings/config`, {
        inventoryAuthorityEnabled: true, catalogRevision: 7, businessTimeZone: "America/Chicago"
      }],
      [`organizations/${ORGANIZATION_ID}/menuItems/chicken-alfredo`, menuItem()],
      ...quoteDemandEntries()
    ];
    async function recordCurrent(harness, recipeRevisionId, expectedRequirementRevision, requestId) {
      const draft = eventDemandCommand({ recipeRevisionId, overrides: {
        expectedRequirementRevision
      } });
      const preview = await harness.runtime.previewEventInventory({
        schemaVersion: 2,
        organizationId: ORGANIZATION_ID,
        quoteId: draft.quoteId,
        quoteRevisionId: draft.quoteRevisionId,
        requiredByBasis: draft.requiredByBasis,
        selections: draft.selections
      }, adminContext);
      return harness.runtime.applyInventoryCommand(envelope({
        ...draft,
        expectedPreviewProjectionDigest: preview.projection.projectionDigest
      }, requestId), adminContext);
    }

    const recipeHarness = createHarness({ entries: entries() });
    const firstRecipeRequirement = await compileEventDemandFixture(recipeHarness);
    const firstRecipeId = recipeHarness.db.store.get(
      `organizations/${ORGANIZATION_ID}/inventoryRecipeHeads/chicken-alfredo`
    ).recipeRevisionId;
    const secondRecipe = await recipeHarness.runtime.applyInventoryCommand(envelope(recipeCommand({
      expectedRecipeRevision: 1,
      outputYield: "20"
    }), "recipe-source-transition-0002"), adminContext);
    const recipeTransition = {
      organizationId: ORGANIZATION_ID,
      menuItemId: "chicken-alfredo",
      changeKind: "recipe",
      beforeSourceDigest: firstRecipeId,
      afterSourceDigest: secondRecipe.result.recipeRevisionId
    };
    await expect(recipeHarness.runtime.invalidateEventIngredientsForMenuChange(recipeTransition))
      .resolves.toEqual({ changed: true, affectedQuoteCount: 1 });
    await recordCurrent(recipeHarness, secondRecipe.result.recipeRevisionId, 1,
      "compile-after-recipe-transition-0002");
    await expect(recipeHarness.runtime.invalidateEventIngredientsForMenuChange(recipeTransition))
      .resolves.toEqual({ changed: false, affectedQuoteCount: 0 });
    expect(recipeHarness.db.store.get(
      `organizations/${ORGANIZATION_ID}/eventIngredientProjections/quote-alfredo`
    )).toMatchObject({
      freshness: "as_recorded",
      freshnessState: { demand: { state: "current", reason: "" } }
    });
    expect(firstRecipeRequirement.requirementRevision).toBe(1);
    await recipeHarness.runtime.applyInventoryCommand(envelope(recipeCommand({
      expectedRecipeRevision: 2,
      outputYield: "25"
    }), "recipe-source-transition-0003"), adminContext);
    await expect(recipeHarness.runtime.invalidateEventIngredientsForMenuChange(recipeTransition))
      .resolves.toEqual({ changed: false, affectedQuoteCount: 0 });

    const costHarness = createHarness({ entries: entries() });
    await compileEventDemandFixture(costHarness);
    const eventProjectionPath = `organizations/${ORGANIZATION_ID}/eventIngredientProjections/quote-alfredo`;
    const pinned = costHarness.db.store.get(eventProjectionPath).selections[0];
    const changedCost = await costHarness.runtime.applyInventoryCommand(envelope(costCommand({
      expectedCostRevision: 1,
      totalCostMinor: 16000
    }), "cost-source-transition-0002"), adminContext);
    expect(changedCost.result.costRevision).toBe(2);
    const currentMenuCost = costHarness.db.store.get(
      `organizations/${ORGANIZATION_ID}/inventoryMenuCostProjections/chicken-alfredo`
    );
    const costTransition = {
      organizationId: ORGANIZATION_ID,
      menuItemId: "chicken-alfredo",
      changeKind: "cost",
      beforeSourceDigest: pinned.recipeCostResultDigest,
      afterSourceDigest: currentMenuCost.cost.resultDigest
    };
    await expect(costHarness.runtime.invalidateEventIngredientsForMenuChange(costTransition))
      .resolves.toEqual({ changed: true, affectedQuoteCount: 1 });
    const recipeRevisionId = costHarness.db.store.get(
      `organizations/${ORGANIZATION_ID}/inventoryRecipeHeads/chicken-alfredo`
    ).recipeRevisionId;
    await recordCurrent(costHarness, recipeRevisionId, 1, "compile-after-cost-transition-0002");
    await expect(costHarness.runtime.invalidateEventIngredientsForMenuChange(costTransition))
      .resolves.toEqual({ changed: false, affectedQuoteCount: 0 });
    expect(costHarness.db.store.get(eventProjectionPath).freshnessState.cost)
      .toEqual({ state: "current", reason: "" });
    await costHarness.runtime.applyInventoryCommand(envelope(costCommand({
      expectedCostRevision: 2,
      totalCostMinor: 18000
    }), "cost-source-transition-0003"), adminContext);
    await expect(costHarness.runtime.invalidateEventIngredientsForMenuChange(costTransition))
      .resolves.toEqual({ changed: false, affectedQuoteCount: 0 });
  });

  test("gates background invalidation before tenant-wide reads when inventory authority is disabled", async () => {
    const enabled = createHarness({ entries: [
      [`organizations/${ORGANIZATION_ID}/settings/config`, {
        inventoryAuthorityEnabled: true, catalogRevision: 7, businessTimeZone: "America/Chicago"
      }],
      [`organizations/${ORGANIZATION_ID}/menuItems/chicken-alfredo`, menuItem()],
      ...quoteDemandEntries()
    ] });
    await compileEventDemandFixture(enabled);
    installQuoteRevision(enabled);
    const copiedEntries = [...enabled.db.store.entries()].map(([path, value]) => [path, clone(value)]);
    const globalOff = createHarness({ entries: copiedEntries, globalEnabled: false });
    const quoteTransition = {
      organizationId: ORGANIZATION_ID,
      quoteId: "quote-alfredo",
      beforeActiveVersionId: "v0001",
      afterActiveVersionId: "v0002"
    };
    await expect(globalOff.runtime.invalidateEventIngredientsForQuoteChange(quoteTransition))
      .resolves.toEqual({ changed: false, affectedQuoteCount: 0 });
    await expect(globalOff.runtime.invalidateEventIngredientsForMenuChange({
      organizationId: ORGANIZATION_ID,
      menuItemId: "chicken-alfredo",
      changeKind: "cost",
      beforeSourceDigest: "1".repeat(64),
      afterSourceDigest: "2".repeat(64)
    })).resolves.toEqual({ changed: false, affectedQuoteCount: 0 });
    expect(globalOff.db.transactions).toHaveLength(0);

    const tenantOff = createHarness({ entries: copiedEntries });
    tenantOff.db.store.set(`organizations/${ORGANIZATION_ID}/settings/config`, {
      inventoryAuthorityEnabled: false,
      catalogRevision: 7,
      businessTimeZone: "America/Chicago"
    });
    const projectionBefore = clone(tenantOff.db.store.get(
      `organizations/${ORGANIZATION_ID}/eventIngredientProjections/quote-alfredo`
    ));
    await expect(tenantOff.runtime.invalidateEventIngredientsForQuoteChange(quoteTransition))
      .resolves.toEqual({ changed: false, affectedQuoteCount: 0 });
    await expect(tenantOff.runtime.invalidateEventIngredientsForMenuChange({
      organizationId: ORGANIZATION_ID,
      menuItemId: "chicken-alfredo",
      changeKind: "recipe",
      beforeSourceDigest: "old-recipe-revision",
      afterSourceDigest: "new-recipe-revision"
    })).resolves.toEqual({ changed: false, affectedQuoteCount: 0 });
    const settingsPath = `organizations/${ORGANIZATION_ID}/settings/config`;
    expect(tenantOff.db.transactions.slice(-2).map(({ reads }) => reads)).toEqual([
      [settingsPath],
      [settingsPath]
    ]);
    expect(tenantOff.db.store.get(
      `organizations/${ORGANIZATION_ID}/eventIngredientProjections/quote-alfredo`
    )).toEqual(projectionBefore);
  });

  test("rejects recording when cost or stock evidence changes after preview", async () => {
    const harness = createHarness({ entries: [
      [`organizations/${ORGANIZATION_ID}/settings/config`, {
        inventoryAuthorityEnabled: true, catalogRevision: 7, businessTimeZone: "America/Chicago"
      }],
      [`organizations/${ORGANIZATION_ID}/menuItems/chicken-alfredo`, menuItem()],
      ...quoteDemandEntries()
    ] });
    const recipeRevisionId = await configureEventDemandFixture(harness);
    const draft = eventDemandCommand({ recipeRevisionId });
    const preview = await harness.runtime.previewEventInventory({
      schemaVersion: 2,
      organizationId: ORGANIZATION_ID,
      quoteId: draft.quoteId,
      quoteRevisionId: draft.quoteRevisionId,
      requiredByBasis: draft.requiredByBasis,
      selections: draft.selections
    }, adminContext);

    await harness.runtime.applyInventoryCommand(envelope(costCommand({
      expectedCostRevision: 1,
      totalCostMinor: 16000,
      observedAtISO: "2026-09-09T09:00:00.000Z"
    }), "cost-after-event-preview-0001"), adminContext);

    await expect(harness.runtime.applyInventoryCommand(envelope(eventDemandCommand({
      recipeRevisionId,
      overrides: { expectedPreviewProjectionDigest: preview.projection.projectionDigest }
    }), "compile-stale-event-preview-0001"), adminContext)).rejects.toMatchObject({ code: "aborted" });
    expect(harness.db.store.has(
      `organizations/${ORGANIZATION_ID}/eventIngredientRequirementHeads/quote-alfredo`
    )).toBe(false);
  });

  test("allows same-tenant sales preview but denies compile and rejects stale commercial or recipe evidence", async () => {
    const salesUid = "inventory-sales";
    const salesContext = {
      staff: {
        uid: salesUid,
        role: "sales",
        email: "sales@example.com",
        organizationId: ORGANIZATION_ID,
        principalOrganizationId: ORGANIZATION_ID
      }
    };
    const harness = createHarness({ entries: [
      [`organizations/${ORGANIZATION_ID}/settings/config`, {
        inventoryAuthorityEnabled: true, catalogRevision: 7, businessTimeZone: "America/Chicago"
      }],
      [`userRoles/${salesUid}`, {
        organizationId: ORGANIZATION_ID, role: "sales", email: "sales@example.com"
      }],
      [`organizations/${ORGANIZATION_ID}/menuItems/chicken-alfredo`, menuItem()],
      ...quoteDemandEntries()
    ] });
    const recipeRevisionId = await configureEventDemandFixture(harness);
    const command = eventDemandCommand({ recipeRevisionId });
    await expect(harness.runtime.previewEventInventory({
      schemaVersion: 2,
      organizationId: ORGANIZATION_ID,
      quoteId: command.quoteId,
      quoteRevisionId: command.quoteRevisionId,
      requiredByBasis: command.requiredByBasis,
      selections: command.selections
    }, salesContext)).resolves.toMatchObject({ ok: true, preview: true });
    await expect(harness.runtime.applyInventoryCommand(
      envelope(command, "sales-compile-denied-0001"),
      salesContext
    )).rejects.toMatchObject({ code: "permission-denied" });

    const badSelection = eventDemandCommand({ recipeRevisionId, overrides: {
      selections: [{
        ...command.selections[0],
        menuItemId: "unselected-dish",
        commercialProvenance: { kind: "direct", sourceId: "unselected-dish" }
      }]
    } });
    await expect(harness.runtime.previewEventInventory({
      schemaVersion: 2,
      organizationId: ORGANIZATION_ID,
      quoteId: badSelection.quoteId,
      quoteRevisionId: badSelection.quoteRevisionId,
      requiredByBasis: badSelection.requiredByBasis,
      selections: badSelection.selections
    }, adminContext)).rejects.toMatchObject({ code: "failed-precondition" });

    const staleRecipe = eventDemandCommand({ recipeRevisionId: "irr_stale_recipe_revision" });
    await expect(harness.runtime.previewEventInventory({
      schemaVersion: 2,
      organizationId: ORGANIZATION_ID,
      quoteId: staleRecipe.quoteId,
      quoteRevisionId: staleRecipe.quoteRevisionId,
      requiredByBasis: staleRecipe.requiredByBasis,
      selections: staleRecipe.selections
    }, adminContext)).rejects.toMatchObject({ code: "aborted" });
  });

  test("publishes a catalog-fenced recipe and materializes exact $0.80 per-portion costing without stock", async () => {
    const harness = createHarness({ entries: [
      [`organizations/${ORGANIZATION_ID}/settings/config`, {
        inventoryAuthorityEnabled: true, catalogRevision: 7
      }],
      [`organizations/${ORGANIZATION_ID}/menuItems/chicken-alfredo`, menuItem()]
    ] });
    await configureRecipeFixture(harness);
    const result = await harness.runtime.applyInventoryCommand(
      envelope(recipeCommand(), "recipe-alfredo-0001"), adminContext
    );
    expect(result).toMatchObject({
      commandKind: "publish_menu_recipe",
      result: { menuItemId: "chicken-alfredo", recipeRevision: 1, status: "complete" }
    });
    const projection = harness.db.store.get(
      `organizations/${ORGANIZATION_ID}/inventoryMenuCostProjections/chicken-alfredo`
    );
    expect(projection).toMatchObject({
      status: "complete",
      freshness: "current",
      observedCatalogRevision: 7,
      recipeDefinition: { outputYield: "10", outputUnitId: "portion" },
      cost: {
        projectedCostMinor: 800,
        exactCostPerOutputUnitMinor: { numerator: "80", denominator: "1" },
        coverage: { expectedIngredientCount: 2, costedIngredientCount: 2 }
      }
    });
    expect(harness.db.store.get(
      `organizations/${ORGANIZATION_ID}/inventoryIngredientProjections/chicken`
    ).stock.availability).toBe("not_yet_available");
    expect(harness.db.store.get(
      `organizations/${ORGANIZATION_ID}/inventoryRecipeDependencyIndex/chicken`
    ).menuItemIds).toEqual(["chicken-alfredo"]);
    expect(harness.db.store.get(
      `organizations/${ORGANIZATION_ID}/inventoryRecipeDependencyIndex/pasta`
    ).menuItemIds).toEqual(["chicken-alfredo"]);
    expect(menuItem().costMinor).toBeNull();
    expect(harness.db.store.get(`organizations/${ORGANIZATION_ID}/menuItems/chicken-alfredo`).costMinor).toBeNull();
  });

  test("reads recipe publication and dependency-refresh inputs before their first transactional write", async () => {
    const harness = createHarness({ entries: [
      [`organizations/${ORGANIZATION_ID}/settings/config`, {
        inventoryAuthorityEnabled: true, catalogRevision: 7
      }],
      [`organizations/${ORGANIZATION_ID}/menuItems/chicken-alfredo`, menuItem()]
    ] });
    await configureRecipeFixture(harness);
    harness.db.transactions.length = 0;

    await harness.runtime.applyInventoryCommand(
      envelope(recipeCommand(), "recipe-read-before-write-0001"), adminContext
    );
    expect(harness.db.transactions).toHaveLength(1);
    expect(harness.db.transactions[0].reads).toEqual(expect.arrayContaining([
      `organizations/${ORGANIZATION_ID}/menuItems/chicken-alfredo`,
      `organizations/${ORGANIZATION_ID}/inventoryRecipeHeads/chicken-alfredo`,
      `organizations/${ORGANIZATION_ID}/inventoryRecipeDependencyIndex/chicken`,
      `organizations/${ORGANIZATION_ID}/inventoryRecipeDependencyIndex/pasta`,
      `organizations/${ORGANIZATION_ID}/inventoryIngredients/chicken`,
      `organizations/${ORGANIZATION_ID}/inventoryCostStates/${inventory.costStateId("chicken")}`
    ]));
    expect(harness.db.transactions[0].writes[0].path)
      .toContain(`/inventoryRecipePolicies/`);

    harness.db.transactions.length = 0;
    await harness.runtime.applyInventoryCommand(envelope(costCommand({
      expectedCostRevision: 1,
      basisQuantity: "40",
      totalCostMinor: 16000,
      sourceLabel: "Current chicken receipt"
    }), "cost-read-before-write-0002"), adminContext);
    expect(harness.db.transactions).toHaveLength(2);
    expect(harness.db.transactions[0].reads).toEqual(expect.arrayContaining([
      `organizations/${ORGANIZATION_ID}/inventoryRecipeDependencyIndex/chicken`,
      `organizations/${ORGANIZATION_ID}/inventoryMenuCostProjections/chicken-alfredo`
    ]));
    expect(harness.db.transactions[1].reads).toEqual(expect.arrayContaining([
      `organizations/${ORGANIZATION_ID}/inventoryRecipeHeads/chicken-alfredo`,
      `organizations/${ORGANIZATION_ID}/inventoryRecipePolicies/${harness.db.store.get(`organizations/${ORGANIZATION_ID}/inventoryRecipeHeads/chicken-alfredo`).recipeRevisionId}`
    ]));
  });

  test("keeps a published recipe pinned when a newer purchase-pack head is declared", async () => {
    const harness = createHarness({ entries: [
      [`organizations/${ORGANIZATION_ID}/settings/config`, {
        inventoryAuthorityEnabled: true, catalogRevision: 7
      }],
      [`organizations/${ORGANIZATION_ID}/menuItems/chicken-alfredo`, menuItem()]
    ] });
    await configureRecipeFixture(harness);
    const firstPack = await harness.runtime.applyInventoryCommand(
      envelope(packCommand(), "pack-pinned-recipe-0001"), adminContext
    );
    await harness.runtime.applyInventoryCommand(envelope(recipeCommand({
      lines: [{
        lineId: "chicken-case",
        ingredientId: "chicken",
        quantity: "0.05",
        unitKind: "ingredient_pack",
        packConversionRevisionId: firstPack.result.packConversionRevisionId,
        quantityBasis: "as_purchased",
        usableYield: null
      }]
    }), "recipe-pinned-pack-0001"), adminContext);
    const projectionPath = `organizations/${ORGANIZATION_ID}/inventoryMenuCostProjections/chicken-alfredo`;
    const before = clone(harness.db.store.get(projectionPath));

    const secondPack = await harness.runtime.applyInventoryCommand(envelope(packCommand({
      expectedRevision: 1,
      packLabel: "50 lb case",
      baseQuantity: "50"
    }), "pack-pinned-recipe-0002"), adminContext);

    expect(secondPack.result.affectedMenuItemIds).toEqual([]);
    expect(harness.db.store.get(projectionPath)).toEqual(before);
    expect(harness.db.store.get(
      `organizations/${ORGANIZATION_ID}/inventoryRecipeHeads/chicken-alfredo`
    ).revision).toBe(1);
  });

  test("changes only reverse-indexed menu costs when an ingredient cost changes", async () => {
    const harness = createHarness({ entries: [
      [`organizations/${ORGANIZATION_ID}/settings/config`, {
        inventoryAuthorityEnabled: true, catalogRevision: 7
      }],
      [`organizations/${ORGANIZATION_ID}/menuItems/chicken-alfredo`, menuItem()]
    ] });
    await configureRecipeFixture(harness);
    await harness.runtime.applyInventoryCommand(envelope(recipeCommand(), "recipe-alfredo-cost-change"), adminContext);
    const result = await harness.runtime.applyInventoryCommand(envelope(costCommand({
      expectedCostRevision: 1,
      basisQuantity: "40",
      totalCostMinor: 16000,
      sourceLabel: "Current chicken receipt"
    }), "cost-chicken-current-0002"), adminContext);
    expect(result.result.affectedMenuItemIds).toEqual(["chicken-alfredo"]);
    const projection = harness.db.store.get(
      `organizations/${ORGANIZATION_ID}/inventoryMenuCostProjections/chicken-alfredo`
    );
    expect(projection).toMatchObject({
      freshness: "current",
      status: "complete",
      cost: {
        projectedCostMinor: 1000,
        exactCostPerOutputUnitMinor: { numerator: "100", denominator: "1" }
      }
    });
    const lastTransaction = harness.db.transactions.at(-1);
    expect(lastTransaction.writes.map((write) => write.path)).toEqual([
      `organizations/${ORGANIZATION_ID}/inventoryMenuCostProjections/chicken-alfredo`
    ]);
  });

  test("keeps partial costing explicit and preserves prior immutable recipe revisions", async () => {
    const harness = createHarness({ entries: [
      [`organizations/${ORGANIZATION_ID}/settings/config`, {
        inventoryAuthorityEnabled: true, catalogRevision: 7
      }],
      [`organizations/${ORGANIZATION_ID}/menuItems/chicken-alfredo`, menuItem()]
    ] });
    await configureRecipeFixture(harness, { pastaCost: false });
    const first = await harness.runtime.applyInventoryCommand(
      envelope(recipeCommand(), "recipe-partial-0001"), adminContext
    );
    let projection = harness.db.store.get(
      `organizations/${ORGANIZATION_ID}/inventoryMenuCostProjections/chicken-alfredo`
    );
    expect(first.result.status).toBe("partial");
    expect(projection.cost).toMatchObject({
      status: "partial", knownCostMinor: 600,
      coverage: { expectedIngredientCount: 2, costedIngredientCount: 1, missingCostIngredientCount: 1 }
    });
    expect(projection.cost).not.toHaveProperty("projectedCostMinor");
    const firstPolicy = clone(harness.db.store.get(
      `organizations/${ORGANIZATION_ID}/inventoryRecipePolicies/${first.result.recipeRevisionId}`
    ));
    const second = await harness.runtime.applyInventoryCommand(envelope(recipeCommand({
      expectedRecipeRevision: 1,
      outputYield: "20"
    }), "recipe-partial-0002"), adminContext);
    projection = harness.db.store.get(
      `organizations/${ORGANIZATION_ID}/inventoryMenuCostProjections/chicken-alfredo`
    );
    expect(second.result.recipeRevision).toBe(2);
    expect(projection.recipeDefinition.outputYield).toBe("20");
    expect(harness.db.store.get(
      `organizations/${ORGANIZATION_ID}/inventoryRecipePolicies/${first.result.recipeRevisionId}`
    )).toEqual(firstPolicy);
  });

  test("rejects unpublished menu identities, stale catalog revisions, and recipe request substitution", async () => {
    const harness = createHarness({ entries: [
      [`organizations/${ORGANIZATION_ID}/settings/config`, {
        inventoryAuthorityEnabled: true, catalogRevision: 7
      }],
      [`organizations/${ORGANIZATION_ID}/menuItems/chicken-alfredo`, menuItem()]
    ] });
    await configureRecipeFixture(harness);
    await expect(harness.runtime.applyInventoryCommand(envelope(
      recipeCommand({ menuItemId: "not-published" }), "recipe-missing-menu"
    ), adminContext)).rejects.toMatchObject({ code: "not-found" });
    await expect(harness.runtime.applyInventoryCommand(envelope(
      recipeCommand({ expectedCatalogRevision: 6 }), "recipe-stale-catalog"
    ), adminContext)).rejects.toMatchObject({ code: "aborted" });
    const exact = envelope(recipeCommand(), "recipe-idempotent-0001");
    const first = await harness.runtime.applyInventoryCommand(exact, adminContext);
    await expect(harness.runtime.applyInventoryCommand(exact, adminContext))
      .resolves.toEqual({ ...first, idempotent: true });
    await expect(harness.runtime.applyInventoryCommand(envelope(
      recipeCommand({ outputYield: "11" }), "recipe-idempotent-0001"
    ), adminContext)).rejects.toMatchObject({ code: "already-exists" });
  });
});
