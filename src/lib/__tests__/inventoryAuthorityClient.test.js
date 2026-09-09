import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callable: vi.fn(),
  httpsCallable: vi.fn(),
  collection: vi.fn(),
  doc: vi.fn(),
  limit: vi.fn(),
  onSnapshot: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  auth: { currentUser: { uid: "admin-user" } },
  cloudFunctions: { id: "functions" },
  db: { id: "firestore" }
}));

vi.mock("firebase/functions", () => ({ httpsCallable: mocks.httpsCallable }));
vi.mock("firebase/firestore", () => ({
  collection: mocks.collection,
  doc: mocks.doc,
  limit: mocks.limit,
  onSnapshot: mocks.onSnapshot,
  orderBy: mocks.orderBy,
  query: mocks.query
}));
vi.mock("../firebase", () => ({
  auth: mocks.auth,
  cloudFunctions: mocks.cloudFunctions,
  db: mocks.db,
  firebaseReady: true
}));

import {
  INVENTORY_AUTHORITY_CALLABLES,
  INVENTORY_INGREDIENT_PROJECTION_LIMIT,
  applyInventoryCommand,
  buildInventoryRequestId,
  getInventoryBrowserAccess,
  inventoryMoneyInputToMinorUnits,
  inventoryProjectionConfirmsReceipt,
  normalizeInventoryIngredientProjection,
  normalizeInventoryWorkspaceProjection,
  readPendingInventoryCommands,
  reconcileInventoryCommand,
  resetDefinitiveInventoryCommand,
  subscribeToInventoryIngredientProjections
} from "../inventoryAuthorityClient";

const ORGANIZATION_ID = "org-inventory-client";
const REQUEST_ID = `inventory_request_${"a".repeat(32)}`;
const RECEIPT_ID = `iar_${"b".repeat(48)}`;
const NOW = "2026-09-09T05:00:00.000Z";
const ADMIN_SCOPE = Object.freeze({
  organizationId: ORGANIZATION_ID,
  role: "admin",
  browserEnabled: true,
  tenantEnabled: true
});

function workspaceProjection(overrides = {}) {
  return {
    authorityVersion: "inventory-ingredient-authority-v2",
    schemaVersion: 2,
    model: "inventory-workspace-projection-v2",
    organizationId: ORGANIZATION_ID,
    projectionId: "current",
    workspaceRevision: 1,
    locations: [{ locationId: "main-kitchen", name: "Main kitchen", active: true, revision: 1 }],
    updatedAtISO: NOW,
    ...overrides
  };
}

function ingredientProjection(overrides = {}) {
  return {
    authorityVersion: "inventory-ingredient-authority-v2",
    schemaVersion: 2,
    model: "inventory-ingredient-projection-v2",
    organizationId: ORGANIZATION_ID,
    ingredientId: "chicken",
    name: "Chicken",
    nameSortKey: "chicken",
    category: "Protein",
    baseUnitId: "lb",
    dimension: "mass",
    active: true,
    ingredientRevision: 1,
    stock: {
      availability: "current",
      stockRevision: 1,
      onHandMicros: 40_000_000,
      quantity: "40",
      locationId: "main-kitchen",
      lastMovementId: `imv_${"c".repeat(48)}`
    },
    cost: {
      availability: "available",
      costRevision: 1,
      sourceLabel: "Opening invoice",
      observedAtISO: "2026-09-09T04:00:00.000Z",
      lastCostEvidenceId: `ice_${"d".repeat(48)}`,
      basisQuantityMicros: 40_000_000,
      totalCostMinor: 12_000,
      currency: "USD"
    },
    updatedAtISO: NOW,
    ...overrides
  };
}

function locationCommand() {
  return {
    kind: "upsert_location",
    locationId: "main-kitchen",
    name: "Main kitchen",
    active: true,
    expectedRevision: 0
  };
}

function responseFor(payload, resultOverrides = {}) {
  const common = {
    schemaVersion: 2,
    organizationId: payload.organizationId,
    receiptId: RECEIPT_ID,
    requestId: payload.requestId,
    commandKind: payload.command.kind,
    recordedAtISO: NOW
  };
  let result;
  if (payload.command.kind === "upsert_location") {
    result = { schemaVersion: 2, locationId: payload.command.locationId, name: payload.command.name, active: payload.command.active, revision: payload.command.expectedRevision + 1, updatedAtISO: NOW };
  } else if (payload.command.kind === "upsert_ingredient") {
    result = { schemaVersion: 2, ingredientId: payload.command.ingredientId, revision: payload.command.expectedRevision + 1, baseUnitId: payload.command.baseUnitId, active: payload.command.active };
  } else if (payload.command.kind === "opening_balance") {
    result = { schemaVersion: 2, ingredientId: payload.command.ingredientId, locationId: payload.command.locationId, movementId: `imv_${"c".repeat(48)}`, stockRevision: payload.command.expectedStockRevision + 1, onHandMicros: 40_000_000, onHandQuantity: payload.command.quantity };
  } else {
    result = { schemaVersion: 2, ingredientId: payload.command.ingredientId, costEvidenceId: `ice_${"d".repeat(48)}`, costRevision: payload.command.expectedCostRevision + 1, availability: payload.command.availability };
  }
  return {
    ok: true,
    schemaVersion: 2,
    organizationId: payload.organizationId,
    commandKind: payload.command.kind,
    idempotent: false,
    receipt: common,
    result: { ...result, ...resultOverrides }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.currentUser = { uid: "admin-user" };
  mocks.httpsCallable.mockReturnValue(mocks.callable);
  mocks.collection.mockImplementation((...segments) => ({ kind: "collection", segments }));
  mocks.doc.mockImplementation((...segments) => ({ id: segments.at(-1), kind: "doc", segments }));
  mocks.limit.mockImplementation((value) => ({ kind: "limit", value }));
  mocks.orderBy.mockImplementation((field, direction) => ({ kind: "orderBy", field, direction }));
  mocks.query.mockImplementation((...parts) => ({ kind: "query", parts }));
});

describe("inventory schema-v2 access and request identity", () => {
  test("requires exact browser, tenant, organization, and administrator gates", () => {
    expect(getInventoryBrowserAccess(ADMIN_SCOPE)).toMatchObject({ readEnabled: true, mutationEnabled: true });
    expect(getInventoryBrowserAccess({ ...ADMIN_SCOPE, browserEnabled: "true" })).toMatchObject({ readEnabled: false, mutationEnabled: false });
    expect(getInventoryBrowserAccess({ ...ADMIN_SCOPE, tenantEnabled: "true" })).toMatchObject({ readEnabled: false, mutationEnabled: false });
    expect(getInventoryBrowserAccess({ ...ADMIN_SCOPE, role: "sales" }).readEnabled).toBe(false);
    expect(getInventoryBrowserAccess({ ...ADMIN_SCOPE, role: "customer" }).readEnabled).toBe(false);
    expect(getInventoryBrowserAccess({ ...ADMIN_SCOPE, organizationId: "" }).readEnabled).toBe(false);
  });

  test("generates request IDs only from cryptographic bytes and fails closed without them", () => {
    expect(buildInventoryRequestId({ getRandomValues: (bytes) => { bytes.fill(15); return bytes; } }))
      .toBe(`inventory_request_${"0f".repeat(16)}`);
    expect(() => buildInventoryRequestId({})).toThrow(/secure inventory request identity/i);
    expect(() => buildInventoryRequestId({ random: Math.random })).toThrow(/secure inventory request identity/i);
  });

  test("converts operator money input to exact safe minor units", () => {
    expect(inventoryMoneyInputToMinorUnits("120")).toBe(12_000);
    expect(inventoryMoneyInputToMinorUnits("120.05")).toBe(12_005);
    expect(() => inventoryMoneyInputToMinorUnits("120.005")).toThrow(/two decimal/i);
    expect(() => inventoryMoneyInputToMinorUnits(" 120.00")).toThrow(/canonical money/i);
  });
});

describe("inventory schema-v2 command authority", () => {
  test("sends and validates the exact flat location command and outcome", async () => {
    mocks.callable.mockImplementation(async (payload) => ({ data: responseFor(payload) }));
    const result = await applyInventoryCommand({ ...ADMIN_SCOPE, requestId: REQUEST_ID, command: locationCommand() });

    expect(mocks.httpsCallable).toHaveBeenCalledWith(mocks.cloudFunctions, INVENTORY_AUTHORITY_CALLABLES.applyCommand);
    expect(mocks.callable).toHaveBeenCalledWith({
      schemaVersion: 2,
      organizationId: ORGANIZATION_ID,
      requestId: REQUEST_ID,
      command: locationCommand()
    });
    expect(result).toMatchObject({
      commandKind: "upsert_location",
      confirmation: { locationId: "main-kitchen", revision: 1 },
      receipt: { receiptId: RECEIPT_ID, requestId: REQUEST_ID }
    });
    expect(readPendingInventoryCommands(ADMIN_SCOPE)).toEqual([]);
  });

  test.each([
    {
      label: "ingredient",
      requestCharacter: "1",
      command: { kind: "upsert_ingredient", ingredientId: "chicken", name: "Chicken", category: "Protein", baseUnitId: "lb", active: true, expectedRevision: 0 }
    },
    {
      label: "opening stock",
      requestCharacter: "2",
      command: { kind: "opening_balance", ingredientId: "chicken", locationId: "main-kitchen", quantity: "40", baseUnitId: "lb", occurredAtISO: "2026-09-09T04:00:00.000Z", note: "Opening count", expectedStockRevision: 0 }
    },
    {
      label: "available cost",
      requestCharacter: "3",
      command: { kind: "record_ingredient_cost", ingredientId: "chicken", baseUnitId: "lb", availability: "available", sourceLabel: "Opening invoice", observedAtISO: "2026-09-09T04:00:00.000Z", note: "", expectedCostRevision: 0, basisQuantity: "40", totalCostMinor: 12_000, currency: "USD" }
    },
    {
      label: "missing cost",
      requestCharacter: "4",
      command: { kind: "record_ingredient_cost", ingredientId: "chicken", baseUnitId: "lb", availability: "missing", sourceLabel: "Invoice unavailable", observedAtISO: "2026-09-09T04:00:00.000Z", note: "Awaiting vendor", expectedCostRevision: 0 }
    }
  ])("accepts the exact $label command shape", async ({ command, requestCharacter }) => {
    const requestId = `inventory_request_${requestCharacter.repeat(32)}`;
    mocks.callable.mockImplementation(async (payload) => ({ data: responseFor(payload) }));
    await expect(applyInventoryCommand({ ...ADMIN_SCOPE, organizationId: `org-command-${requestCharacter}`, requestId, command }))
      .resolves.toMatchObject({ commandKind: command.kind });
  });

  test("keeps a transport-uncertain request byte-equivalent for reconciliation", async () => {
    const organizationId = "org-uncertain-command";
    const scope = { ...ADMIN_SCOPE, organizationId };
    const error = Object.assign(new Error("connection ended"), { code: "functions/unavailable" });
    mocks.callable.mockRejectedValueOnce(error);
    await expect(applyInventoryCommand({ ...scope, requestId: REQUEST_ID, command: locationCommand() })).rejects.toThrow(/connection ended/i);

    expect(readPendingInventoryCommands(scope)).toEqual([
      expect.objectContaining({ requestId: REQUEST_ID, commandKind: "upsert_location", state: "uncertain", definitive: false })
    ]);
    mocks.callable.mockImplementationOnce(async (payload) => ({ data: { ...responseFor(payload), idempotent: true } }));
    await expect(reconcileInventoryCommand({ ...scope, requestId: REQUEST_ID })).resolves.toMatchObject({ mutationMode: "reconciliation", idempotent: true });
    expect(mocks.callable.mock.calls[1][0]).toEqual(mocks.callable.mock.calls[0][0]);
  });

  test("treats aborted as definitive and allows a deliberate reset", async () => {
    const scope = { ...ADMIN_SCOPE, organizationId: "org-stale-command" };
    mocks.callable.mockRejectedValueOnce(Object.assign(new Error("revision stale"), { code: "functions/aborted" }));
    await expect(applyInventoryCommand({ ...scope, requestId: REQUEST_ID, command: locationCommand() })).rejects.toThrow(/revision stale/i);
    expect(readPendingInventoryCommands(scope)[0]).toMatchObject({ definitive: true, state: "error" });
    await expect(reconcileInventoryCommand({ ...scope, requestId: REQUEST_ID })).rejects.toThrow(/definitively rejected/i);
    expect(resetDefinitiveInventoryCommand({ ...scope, requestId: REQUEST_ID })).toBe(true);
  });

  test("rejects poison fields before calling Firebase", async () => {
    const command = Object.create(null);
    Object.assign(command, locationCommand());
    command.constructor = "poison";
    await expect(applyInventoryCommand({ ...ADMIN_SCOPE, requestId: REQUEST_ID, command })).rejects.toThrow(/unsupported fields/i);
    expect(mocks.callable).not.toHaveBeenCalled();
  });

  test("does not claim success from extra response keys or mismatched evidence", async () => {
    const scope = { ...ADMIN_SCOPE, organizationId: "org-invalid-response" };
    mocks.callable.mockImplementationOnce(async (payload) => ({ data: { ...responseFor(payload), storage: "firebase" } }));
    await expect(applyInventoryCommand({ ...scope, requestId: REQUEST_ID, command: locationCommand() })).rejects.toThrow(/unsupported fields/i);
    expect(readPendingInventoryCommands(scope)[0]).toMatchObject({ state: "uncertain", definitive: false });
  });
});

describe("inventory projection validation and listeners", () => {
  test("validates fixed-point stock and independent cost evidence without combining their state", () => {
    const projection = normalizeInventoryIngredientProjection(ingredientProjection(), ORGANIZATION_ID, "chicken");
    expect(projection.stock).toMatchObject({ state: "recorded", quantity: "40", revision: 1 });
    expect(projection.cost).toMatchObject({ state: "recorded", basisQuantity: "40", totalMinorUnits: 12_000 });

    const withoutEvidence = normalizeInventoryIngredientProjection(ingredientProjection({
      cost: { availability: "not_yet_available", costRevision: 0, sourceLabel: "", observedAtISO: "", lastCostEvidenceId: "" }
    }), ORGANIZATION_ID, "chicken");
    expect(withoutEvidence.stock.state).toBe("recorded");
    expect(withoutEvidence.cost.state).toBe("not_recorded");
  });

  test("rejects schema drift, cross-document identity, and contradictory micros", () => {
    expect(() => normalizeInventoryIngredientProjection(ingredientProjection({ schemaVersion: 1 }), ORGANIZATION_ID, "chicken"))
      .toThrow(/internally inconsistent|authority/i);
    expect(() => normalizeInventoryIngredientProjection(ingredientProjection(), ORGANIZATION_ID, "pasta"))
      .toThrow(/internally inconsistent/i);
    expect(() => normalizeInventoryIngredientProjection(ingredientProjection({ stock: { ...ingredientProjection().stock, quantity: "41" } }), ORGANIZATION_ID, "chicken"))
      .toThrow(/contradicts/i);
    expect(() => normalizeInventoryWorkspaceProjection({ ...workspaceProjection(), rogue: true }, ORGANIZATION_ID))
      .toThrow(/unsupported fields/i);
  });

  test("subscribes to the exact workspace doc and bounded ordered ingredient query with metadata", () => {
    const registrations = [];
    const unsubscribes = [vi.fn(), vi.fn()];
    mocks.onSnapshot.mockImplementation((reference, options, onNext, onError) => {
      registrations.push({ reference, options, onNext, onError });
      return unsubscribes[registrations.length - 1];
    });
    const onData = vi.fn();
    const onError = vi.fn();
    const unsubscribe = subscribeToInventoryIngredientProjections({ ...ADMIN_SCOPE, onData, onError });

    expect(mocks.doc).toHaveBeenCalledWith(mocks.db, "organizations", ORGANIZATION_ID, "inventoryWorkspaceProjections", "current");
    expect(mocks.collection).toHaveBeenCalledWith(mocks.db, "organizations", ORGANIZATION_ID, "inventoryIngredientProjections");
    expect(mocks.orderBy).toHaveBeenCalledWith("nameSortKey", "asc");
    expect(mocks.limit).toHaveBeenCalledWith(INVENTORY_INGREDIENT_PROJECTION_LIMIT);
    expect(registrations).toHaveLength(2);
    expect(registrations.every((entry) => entry.options.includeMetadataChanges === true)).toBe(true);

    registrations[0].onNext({ id: "current", exists: () => true, data: () => workspaceProjection(), metadata: { fromCache: false, hasPendingWrites: false } });
    expect(onData.mock.calls.at(-1)[0]).toMatchObject({ freshness: "loading", sources: { workspace: { state: "current" }, ingredients: { state: "loading" } } });
    registrations[1].onNext({ docs: [{ id: "chicken", data: () => ingredientProjection() }], metadata: { fromCache: true, hasPendingWrites: false } });
    expect(onData.mock.calls.at(-1)[0]).toMatchObject({ freshness: "cached", sources: { ingredients: { state: "cached" } } });
    registrations[1].onNext({ docs: [{ id: "chicken", data: () => ingredientProjection() }], metadata: { fromCache: false, hasPendingWrites: true } });
    expect(onData.mock.calls.at(-1)[0].freshness).toBe("pending");
    registrations[1].onNext({ docs: [{ id: "chicken", data: () => ingredientProjection() }], metadata: { fromCache: false, hasPendingWrites: false } });
    expect(onData.mock.calls.at(-1)[0]).toMatchObject({ freshness: "current", ingredients: [{ ingredientId: "chicken" }] });

    const countBeforeUnsubscribe = onData.mock.calls.length;
    unsubscribe();
    expect(unsubscribes[0]).toHaveBeenCalledOnce();
    expect(unsubscribes[1]).toHaveBeenCalledOnce();
    registrations[1].onNext({ docs: [], metadata: { fromCache: false, hasPendingWrites: false } });
    expect(onData).toHaveBeenCalledTimes(countBeforeUnsubscribe);
  });

  test("turns projection schema drift into unavailable evidence rather than a current snapshot", () => {
    const registrations = [];
    mocks.onSnapshot.mockImplementation((reference, options, onNext, onError) => {
      registrations.push({ onNext, onError });
      return vi.fn();
    });
    const onData = vi.fn();
    const onError = vi.fn();
    subscribeToInventoryIngredientProjections({ ...ADMIN_SCOPE, onData, onError });
    registrations[0].onNext({ id: "current", exists: () => true, data: () => workspaceProjection(), metadata: {} });
    registrations[1].onNext({ docs: [{ id: "chicken", data: () => ingredientProjection({ schemaVersion: 1 }) }], metadata: {} });

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "inventory-projections-unavailable", source: "ingredients" }));
    expect(onData.mock.calls.at(-1)[0].freshness).not.toBe("current");
  });

  test("confirms receipts only from a matching server-current projection", () => {
    const workspace = normalizeInventoryWorkspaceProjection(workspaceProjection(), ORGANIZATION_ID);
    const ingredient = normalizeInventoryIngredientProjection(ingredientProjection(), ORGANIZATION_ID, "chicken");
    const model = {
      organizationId: ORGANIZATION_ID,
      freshness: "current",
      workspace,
      ingredients: [ingredient]
    };
    const attempt = {
      receipt: { organizationId: ORGANIZATION_ID, commandKind: "opening_balance" },
      confirmation: { ingredientId: "chicken", stockRevision: 1, movementId: ingredient.stock.lastMovementId }
    };
    expect(inventoryProjectionConfirmsReceipt(model, attempt)).toBe(true);
    expect(inventoryProjectionConfirmsReceipt({ ...model, freshness: "cached" }, attempt)).toBe(false);
  });
});
