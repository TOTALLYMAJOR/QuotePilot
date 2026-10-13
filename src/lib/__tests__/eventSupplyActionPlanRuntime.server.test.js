import { createRequire } from "node:module";
import { describe, expect, test, vi } from "vitest";

const require = createRequire(import.meta.url);
const inventory = require("../../../functions/inventoryIngredientCore.cjs");
const recipe = require("../../../functions/inventoryRecipeCore.cjs");
const allocation = require("../../../functions/inventoryIngredientAllocationCore.cjs");
const supply = require("../../../functions/eventSupplyActionPlanCore.cjs");

const ORG = "org-supply";
const QUOTE = "quote-shortage";
const UID = "supply-admin";
const NOW = "2026-09-17T13:00:00.000Z";
const ACTOR = { uid: UID, email: "admin@example.test", role: "admin", organizationId: ORG };
const clone = (value) => typeof value === "undefined" ? undefined : structuredClone(value);

class DocRef {
  constructor(store, path) { this.store = store; this.path = path; this.id = path.split("/").at(-1); }
  collection(name) { return new CollectionRef(this.store, `${this.path}/${name}`); }
}
class CollectionRef {
  constructor(store, path) { this.store = store; this.path = path; }
  doc(id) { return new DocRef(this.store, `${this.path}/${id}`); }
}
function snap(ref, store) {
  const value = store.get(ref.path);
  return { id: ref.id, exists: typeof value !== "undefined", data: () => clone(value || {}) };
}
function fakeDb(entries) {
  const store = new Map(entries.map(([path, value]) => [path, clone(value)]));
  return {
    store,
    collection(name) { return new CollectionRef(store, name); },
    async runTransaction(callback) {
      const writes = [];
      let wrote = false;
      const tx = {
        async get(ref) { if (wrote) throw new Error("read after write"); return snap(ref, store); },
        async getAll(...refs) { if (wrote) throw new Error("read after write"); return refs.map((ref) => snap(ref, store)); },
        create(ref, value) { wrote = true; writes.push(["create", ref.path, clone(value)]); },
        set(ref, value) { wrote = true; writes.push(["set", ref.path, clone(value)]); }
      };
      const result = await callback(tx);
      for (const [operation, path, value] of writes) {
        if (operation === "create" && store.has(path)) throw new Error(`exists ${path}`);
        store.set(path, value);
      }
      return result;
    }
  };
}
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }

function evidenceFixture({ required = 50_000_000, onHand = 40_000_000, terminalState = "" } = {}) {
  const recipeRevisionId = recipe.recipeRevisionIdFor(ORG, "menu-chicken", 1);
  const recipeDigest = "e".repeat(64);
  const selection = {
    selectionId: "menu-chicken",
    menuItemId: "menu-chicken",
    recipeRevisionId,
    recipeDigest,
    requiredOutputQuantity: "1",
    outputUnitId: "portion",
    portionBasis: { kind: "explicit_output_quantity", evidenceId: "menu-chicken" },
    commercialProvenance: { kind: "direct", sourceId: "menu-chicken" }
  };
  const requirementIdentity = {
    authorityVersion: inventory.INVENTORY_AUTHORITY_VERSION,
    schemaVersion: 1,
    requirementVersion: "ingredient-event-requirement-v1",
    organizationId: ORG,
    quoteId: QUOTE,
    quoteRevisionId: "quote-version-1",
    requiredByISO: "2026-09-20T18:00:00.000Z",
    demandState: "complete",
    costState: "unavailable",
    selections: [selection],
    ingredients: [{ ingredientId: "chicken", baseUnitId: "lb", requiredQuantityMicros: required }],
    coverage: { selectionCount: 1 },
    issues: []
  };
  const eventRequirementRevisionId = `eir_${inventory.digest(requirementIdentity, "event ingredient requirement identity").slice(0, 48)}`;
  const requirementWithId = { ...requirementIdentity, eventRequirementRevisionId };
  const requirement = { ...requirementWithId, requirementDigest: inventory.digest(requirementWithId, "event ingredient requirement") };
  const head = {
    authorityVersion: inventory.INVENTORY_AUTHORITY_VERSION,
    schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
    model: "event-ingredient-requirement-head-v1",
    organizationId: ORG,
    quoteId: QUOTE,
    quoteRevisionId: requirement.quoteRevisionId,
    revision: 1,
    eventRequirementRevisionId,
    requirementDigest: requirement.requirementDigest,
    updatedAtISO: NOW
  };
  const stockState = inventory.createEmptyStockState({ organizationId: ORG, ingredientId: "chicken", locationId: "kitchen", baseUnitId: "lb" });
  const opened = { ...stockState, revision: 1, onHandMicros: onHand, lastMovementId: `imv_${"b".repeat(48)}`, updatedAtISO: NOW };
  const allocated = allocation.planEventAllocation({
    request: {
      kind: "allocate_event_ingredients",
      quoteId: QUOTE,
      eventRequirementRevisionId,
      locationId: "kitchen",
      expectedRequirementRevision: 1,
      expectedAllocationRevision: 0
    },
    organizationId: ORG,
    requirementHead: head,
    requirement,
    currentPlan: null,
    stockStates: [opened],
    fences: [],
    nowISO: NOW
  });
  let plan = allocated.plan;
  let fences = allocated.fences;
  if (terminalState === "released") {
    const released = allocation.planEventRelease({
      request: { kind: "release_event_ingredients", quoteId: QUOTE, expectedAllocationRevision: plan.allocationRevision, reason: "Released by operator" },
      organizationId: ORG, currentPlan: plan, fences, nowISO: NOW
    });
    plan = released.plan;
    fences = released.fences;
  } else if (terminalState === "settled") {
    const settled = allocation.planEventSettlement({
      organizationId: ORG,
      currentPlan: plan,
      fences,
      expectedAllocationRevision: plan.allocationRevision,
      settlementExecutionRevisionId: `eiex_${"a".repeat(48)}`,
      nowISO: NOW
    });
    plan = settled.plan;
    fences = settled.fences;
  }
  const projectionCoreBody = {
    authorityVersion: inventory.INVENTORY_AUTHORITY_VERSION,
    schemaVersion: 1,
    projectionVersion: "ingredient-event-projection-v1",
    organizationId: ORG,
    quoteId: QUOTE,
    quoteRevisionId: requirement.quoteRevisionId,
    eventRequirementRevisionId,
    requirementDigest: requirement.requirementDigest,
    requiredByISO: requirement.requiredByISO,
    demandState: "complete",
    costState: "unavailable",
    availabilityState: plan.shortageIngredientCount ? "shortage" : "available",
    selections: [selection],
    ingredients: [{ ingredientId: "chicken", baseUnitId: "lb", requiredQuantityMicros: required }],
    coverage: { selectionCount: 1 },
    sourceRevisions: {},
    issues: []
  };
  const projectionCore = { ...projectionCoreBody, projectionDigest: inventory.digest(projectionCoreBody, "event ingredient projection") };
  const allocationSummary = {
    state: plan.state,
    eventPlanId: plan.eventPlanId,
    allocationRevision: plan.allocationRevision,
    eventRequirementRevisionId: plan.eventRequirementRevisionId,
    ingredientCount: plan.ingredientCount,
    fullyAllocatedIngredientCount: plan.fullyAllocatedIngredientCount,
    shortageIngredientCount: plan.shortageIngredientCount,
    ingredients: plan.ingredients.map(({ ingredientId, locationId, baseUnitId, stockRevision, fenceRevision, requiredQuantityMicros, allocatedQuantityMicros, shortageQuantityMicros }) => ({
      ingredientId, locationId, baseUnitId, stockRevision, fenceRevision,
      requiredQuantityMicros, allocatedQuantityMicros, shortageQuantityMicros
    }))
  };
  const projection = {
    ...projectionCore,
    model: "event-ingredient-projection-v1",
    requirementRevision: 1,
    ingredientLabels: [{ ingredientId: "chicken", name: "Chicken" }],
    freshness: "as_recorded",
    staleReason: "",
    freshnessState: {
      demand: { state: "current", reason: "" },
      cost: { state: "current", reason: "" },
      availability: { state: "current", reason: "" },
      allocation: { state: ["released", "settled"].includes(plan.state) ? plan.state : "current", reason: "" }
    },
    allocation: allocationSummary,
    updatedAtISO: NOW
  };
  const menuIdentityBody = {
    menuItemId: "menu-chicken", eventTypeId: "event-type", categoryId: "entree", name: "Chicken",
    priceMinor: 1000, costMinor: null, pricingType: "flat", type: "food", active: true
  };
  const recipeHead = {
    authorityVersion: inventory.INVENTORY_AUTHORITY_VERSION,
    schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
    model: "ingredient-recipe-head-v2",
    organizationId: ORG,
    menuItemId: "menu-chicken",
    revision: 1,
    recipeRevisionId,
    recipeDigest,
    catalogRevision: 1,
    menuIdentity: { ...menuIdentityBody, identityDigest: inventory.digest(menuIdentityBody, "menu item recipe identity") },
    ingredientIds: ["chicken"],
    packConversionRevisionIds: [],
    updatedAtISO: NOW
  };
  const quoteSnapshot = {
    id: QUOTE,
    organizationId: ORG,
    activeVersionId: requirement.quoteRevisionId,
    selection: {
      packageId: "",
      packageInclusions: { menuItems: [] },
      menuItems: ["menu-chicken"],
      menuItemsSnapshot: [{ id: "menu-chicken", name: "Chicken", price: 18.75 }]
    },
    pricing: { subtotal: 1875.5, taxRate: 0.0825, total: 2030.22875 },
    acceptedAt: { seconds: 1_796_000_000, nanoseconds: 123_000_000 }
  };
  return { plan, head, requirement, projection, recipeHead, stockState: opened, fences, quote: {
    id: QUOTE, organizationId: ORG, status: "accepted", activeVersionId: requirement.quoteRevisionId,
    versionMeta: { versionId: requirement.quoteRevisionId },
    total: 2030.22875,
    taxRate: 0.0825,
    updatedAt: { _seconds: 1_796_000_100, _nanoseconds: 456_000_000 }
  }, quoteVersion: {
    versionId: requirement.quoteRevisionId,
    quoteId: QUOTE,
    organizationId: ORG,
    createdAt: { seconds: 1_796_000_000, nanoseconds: 999_000_000 },
    snapshot: quoteSnapshot
  } };
}

function harness({ fixture = evidenceFixture(), role = "admin", contextRole = role, enabled = true } = {}) {
  const { plan, head, requirement, projection, recipeHead, stockState, fences, quote, quoteVersion } = fixture;
  const db = fakeDb([
    [`organizations/${ORG}`, { active: true }],
    [`organizations/${ORG}/settings/config`, { inventoryAuthorityEnabled: enabled }],
    [`userRoles/${UID}`, { organizationId: ORG, role, email: "admin@example.test" }],
    [`organizations/${ORG}/eventIngredientPlans/${QUOTE}`, plan],
    [`organizations/${ORG}/eventIngredientRequirementHeads/${QUOTE}`, head],
    [`organizations/${ORG}/eventIngredientRequirements/${QUOTE}/revisions/${requirement.eventRequirementRevisionId}`, {
      authorityVersion: inventory.INVENTORY_AUTHORITY_VERSION,
      schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
      model: "event-ingredient-requirement-record-v1",
      organizationId: ORG,
      quoteId: QUOTE,
      eventRequirementRevisionId: requirement.eventRequirementRevisionId,
      requirementDigest: requirement.requirementDigest,
      requirement,
      recordedAtISO: NOW,
      recordedBy: ACTOR
    }],
    [`organizations/${ORG}/eventIngredientProjections/${QUOTE}`, projection],
    [`organizations/${ORG}/quotes/${QUOTE}`, quote],
    [`organizations/${ORG}/quotes/${QUOTE}/versions/${quoteVersion.versionId}`, quoteVersion],
    [`organizations/${ORG}/inventoryRecipeHeads/menu-chicken`, recipeHead],
    [`organizations/${ORG}/inventoryStockStates/${stockState.stockStateId}`, stockState],
    ...fences.map((fence) => [`organizations/${ORG}/inventoryAllocationFences/${fence.fenceId}`, fence])
  ]);
  const assertStaff = vi.fn(async (context, { expectedOrganizationId }) => {
    if (context?.staff?.organizationId !== expectedOrganizationId) throw new HttpsError("permission-denied", "staff required");
    return context.staff;
  });
  return {
    db,
    context: { staff: { ...ACTOR, role: contextRole, principalOrganizationId: ORG } },
    runtime: supply.createEventSupplyActionPlanRuntime({
      db,
      FieldValue: { serverTimestamp: () => ({ server: true }) },
      HttpsError,
      assertStaff,
      normalizeOrganizationId: (value) => String(value || "").trim(),
      isOrganizationRecordActive: (value) => value.active === true,
      globalEnabled: () => true,
      logger: { error: vi.fn() },
      now: () => NOW
    })
  };
}

function installFixture(h, fixture) {
  h.db.store.set(`organizations/${ORG}/eventIngredientPlans/${QUOTE}`, clone(fixture.plan));
  h.db.store.set(`organizations/${ORG}/eventIngredientRequirementHeads/${QUOTE}`, clone(fixture.head));
  h.db.store.set(`organizations/${ORG}/eventIngredientRequirements/${QUOTE}/revisions/${fixture.requirement.eventRequirementRevisionId}`, {
    authorityVersion: inventory.INVENTORY_AUTHORITY_VERSION,
    schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
    model: "event-ingredient-requirement-record-v1",
    organizationId: ORG,
    quoteId: QUOTE,
    eventRequirementRevisionId: fixture.requirement.eventRequirementRevisionId,
    requirementDigest: fixture.requirement.requirementDigest,
    requirement: clone(fixture.requirement),
    recordedAtISO: NOW,
    recordedBy: ACTOR
  });
  h.db.store.set(`organizations/${ORG}/eventIngredientProjections/${QUOTE}`, clone(fixture.projection));
  h.db.store.set(`organizations/${ORG}/quotes/${QUOTE}`, clone(fixture.quote));
  h.db.store.set(`organizations/${ORG}/quotes/${QUOTE}/versions/${fixture.quoteVersion.versionId}`, clone(fixture.quoteVersion));
  h.db.store.set(`organizations/${ORG}/inventoryRecipeHeads/menu-chicken`, clone(fixture.recipeHead));
  h.db.store.set(`organizations/${ORG}/inventoryStockStates/${fixture.stockState.stockStateId}`, clone(fixture.stockState));
  fixture.fences.forEach((fence) => h.db.store.set(
    `organizations/${ORG}/inventoryAllocationFences/${fence.fenceId}`, clone(fence)
  ));
}

function edit(source, overrides = {}) {
  const row = source.shortages[0];
  return {
    ingredientId: row.ingredientId,
    locationId: row.locationId,
    baseUnitId: row.baseUnitId,
    shortageQuantity: row.shortageQuantity,
    supplierId: "supplier-a",
    supplierLabel: "Supplier A",
    purchaseQuantity: "10",
    estimatedCostMinor: 5000,
    currency: "USD",
    note: "Internal option only",
    conditions: ["Subject to operator review"],
    policyFingerprint: "c".repeat(64),
    offerFingerprint: "d".repeat(64),
    ...overrides
  };
}
function fenced(kind, source, expectedPlanRevision, extra = {}) {
  return {
    kind,
    quoteId: QUOTE,
    expectedPlanRevision,
    expectedAllocationFingerprint: source.allocationFingerprint,
    expectedShortageFingerprint: source.shortageFingerprint,
    expectedSourceFingerprint: source.sourceFingerprint,
    ...extra
  };
}
function request(command, requestId) { return { schemaVersion: 1, organizationId: ORG, requestId, command }; }

describe("event supply action plan authority", () => {
  test("saves, approves, and replays an exact internal-only plan with immutable revisions and receipts", async () => {
    const h = harness();
    const initial = await h.runtime.getEventSupplyActionPlan({ schemaVersion: 1, organizationId: ORG, quoteId: QUOTE }, h.context);
    expect(initial).toMatchObject({ appCheck: "monitoring", plan: null, stale: false, resolution: "not_started" });
    const draftRequest = request(fenced("save_draft", initial.source, 0, { edits: [edit(initial.source)] }), "supply-draft-request-0001");
    const draft = await h.runtime.applyEventSupplyActionPlanCommand(draftRequest, h.context);
    expect(draft).toMatchObject({ appCheck: "monitoring", commandKind: "save_draft", planRevision: 1, status: "draft", resolution: "unresolved", idempotent: false });
    await expect(h.runtime.applyEventSupplyActionPlanCommand(draftRequest, h.context))
      .resolves.toMatchObject({ planRevision: 1, idempotent: true });
    const approved = await h.runtime.applyEventSupplyActionPlanCommand(request(
      fenced("approve", initial.source, 1, { confirmation: "approve_internal_supply_plan" }),
      "supply-approve-request-0002"
    ), h.context);
    expect(approved).toMatchObject({ planRevision: 2, status: "approved" });
    await expect(h.runtime.getEventSupplyActionPlan(
      { schemaVersion: 1, organizationId: ORG, quoteId: QUOTE },
      { ...h.context, app: { appId: "verified-app" } }
    )).resolves.toMatchObject({ appCheck: "verified" });
    const stored = h.db.store.get(`organizations/${ORG}/eventSupplyActionPlans/${QUOTE}`);
    expect(stored.approvalEvidence).toMatchObject({ confirmedBy: { uid: UID }, confirmedAtISO: NOW });
    expect(stored.boundary).toMatch(/does not contact a vendor/i);
    expect(h.db.store.has(`organizations/${ORG}/eventSupplyActionPlans/${QUOTE}/revisions/${stored.revisionId}`)).toBe(true);
    const cancelled = await h.runtime.applyEventSupplyActionPlanCommand(request({
      kind: "cancel", quoteId: QUOTE, expectedPlanRevision: 2, reason: "Operator chose no internal sourcing action"
    }, "supply-cancel-request-0003"), h.context);
    expect(cancelled).toMatchObject({ planRevision: 3, status: "cancelled" });
    expect(h.db.store.get(`organizations/${ORG}/eventSupplyActionPlans/${QUOTE}`)).toMatchObject({
      status: "cancelled",
      approvalEvidence: { confirmedBy: { uid: UID } },
      cancelEvidence: { cancelledBy: { uid: UID } }
    });
    expect([...h.db.store.keys()].filter((path) => path.includes("eventSupplyActionPlanReceipts/"))).toHaveLength(3);
  });

  test("rejects tenant, role, exact-key, request substitution, stale-source, and competing-revision attacks", async () => {
    const h = harness();
    const initial = await h.runtime.getEventSupplyActionPlan({ schemaVersion: 1, organizationId: ORG, quoteId: QUOTE }, h.context);
    const command = fenced("save_draft", initial.source, 0, { edits: [edit(initial.source)] });
    await expect(h.runtime.applyEventSupplyActionPlanCommand(request({ ...command, vendorMessage: "send" }, "supply-extra-field-0001"), h.context))
      .rejects.toMatchObject({ code: "invalid-argument" });
    const sales = harness({ role: "sales", contextRole: "sales" });
    await expect(sales.runtime.applyEventSupplyActionPlanCommand(request(command, "supply-sales-denied-0001"), sales.context))
      .rejects.toMatchObject({ code: "permission-denied" });
    await expect(h.runtime.applyEventSupplyActionPlanCommand(request(command, "supply-race-winner-0001"), h.context)).resolves.toBeTruthy();
    await expect(h.runtime.applyEventSupplyActionPlanCommand(request(command, "supply-race-loser-0002"), h.context))
      .rejects.toMatchObject({ code: "aborted" });
    await expect(h.runtime.applyEventSupplyActionPlanCommand(request(
      fenced("save_draft", { ...initial.source, sourceFingerprint: "e".repeat(64) }, 1, { edits: [edit(initial.source)] }),
      "supply-stale-source-0003"
    ), h.context)).rejects.toMatchObject({ code: "aborted" });
    const crossTenantContext = { staff: { ...h.context.staff, organizationId: "org-other" } };
    await expect(h.runtime.applyEventSupplyActionPlanCommand(request(command, "supply-cross-tenant-0004"), crossTenantContext))
      .rejects.toMatchObject({ code: "permission-denied" });
    await expect(h.runtime.applyEventSupplyActionPlanCommand(request(
      { ...command, edits: [edit(initial.source, { supplierId: "supplier-b" })] },
      "supply-race-winner-0001"
    ), h.context)).rejects.toMatchObject({ code: "already-exists" });
  });

  test("marks stale evidence and derives resolution only after a refreshed zero-shortage allocation rebase", async () => {
    const h = harness();
    const initial = await h.runtime.getEventSupplyActionPlan({ schemaVersion: 1, organizationId: ORG, quoteId: QUOTE }, h.context);
    await h.runtime.applyEventSupplyActionPlanCommand(request(
      fenced("save_draft", initial.source, 0, { edits: [edit(initial.source)] }), "supply-resolve-draft-0001"
    ), h.context);
    const refreshed = evidenceFixture({ required: 40_000_000, onHand: 40_000_000 });
    installFixture(h, refreshed);
    const stale = await h.runtime.getEventSupplyActionPlan({ schemaVersion: 1, organizationId: ORG, quoteId: QUOTE }, h.context);
    expect(stale).toMatchObject({ stale: true, resolution: "stale" });
    expect(stale.source.shortages).toEqual([]);
    const rebased = await h.runtime.applyEventSupplyActionPlanCommand(request(
      fenced("rebase", stale.source, 1, { edits: [] }), "supply-resolve-rebase-0002"
    ), h.context);
    expect(rebased).toMatchObject({ resolution: "resolved", planRevision: 2 });
    const resolved = await h.runtime.getEventSupplyActionPlan({ schemaVersion: 1, organizationId: ORG, quoteId: QUOTE }, h.context);
    expect(resolved).toMatchObject({ stale: false, resolution: "resolved" });
  });

  test("rebasing invalidates prior approval and cancellation preserves the last reviewed source", async () => {
    const h = harness();
    const initial = await h.runtime.getEventSupplyActionPlan({ schemaVersion: 1, organizationId: ORG, quoteId: QUOTE }, h.context);
    await h.runtime.applyEventSupplyActionPlanCommand(request(
      fenced("save_draft", initial.source, 0, { edits: [edit(initial.source)] }), "supply-rebase-draft-0001"
    ), h.context);
    await h.runtime.applyEventSupplyActionPlanCommand(request(
      fenced("approve", initial.source, 1, { confirmation: "approve_internal_supply_plan" }), "supply-rebase-approve-0002"
    ), h.context);
    const changed = evidenceFixture({ required: 55_000_000, onHand: 40_000_000 });
    installFixture(h, changed);
    const stale = await h.runtime.getEventSupplyActionPlan({ schemaVersion: 1, organizationId: ORG, quoteId: QUOTE }, h.context);
    const rebased = await h.runtime.applyEventSupplyActionPlanCommand(request(
      fenced("rebase", stale.source, 2, { edits: [edit(stale.source, { shortageQuantity: "15", purchaseQuantity: "15" })] }),
      "supply-rebase-changed-0003"
    ), h.context);
    expect(rebased).toMatchObject({ status: "draft", resolution: "unresolved" });
    expect(h.db.store.get(`organizations/${ORG}/eventSupplyActionPlans/${QUOTE}`).approvalEvidence).toBeNull();

    const latestSource = h.db.store.get(`organizations/${ORG}/eventSupplyActionPlans/${QUOTE}`).source;
    installFixture(h, evidenceFixture({ required: 40_000_000, onHand: 40_000_000 }));
    await h.runtime.applyEventSupplyActionPlanCommand(request({
      kind: "cancel", quoteId: QUOTE, expectedPlanRevision: 3, reason: "Operator stopped planning"
    }, "supply-cancel-stale-0004"), h.context);
    const cancelled = h.db.store.get(`organizations/${ORG}/eventSupplyActionPlans/${QUOTE}`);
    expect(cancelled).toMatchObject({ status: "cancelled", resolution: "unresolved", source: { sourceFingerprint: latestSource.sourceFingerprint } });
    expect(() => supply.verifyRevision(cancelled, { organizationId: ORG, quoteId: QUOTE })).not.toThrow();
  });

  test.each([
    ["quote revision", (h) => {
      const path = `organizations/${ORG}/quotes/${QUOTE}`;
      h.db.store.set(path, { ...h.db.store.get(path), activeVersionId: "quote-version-2", versionMeta: { versionId: "quote-version-2" } });
    }],
    ["recipe revision", (h) => {
      const path = `organizations/${ORG}/inventoryRecipeHeads/menu-chicken`;
      h.db.store.set(path, { ...h.db.store.get(path), recipeDigest: "9".repeat(64) });
    }],
    ["stock after allocation", (h) => {
      const fixture = evidenceFixture();
      const path = `organizations/${ORG}/inventoryStockStates/${fixture.stockState.stockStateId}`;
      h.db.store.set(path, {
        ...h.db.store.get(path), revision: 2, onHandMicros: 35_000_000,
        lastMovementId: `imv_${"8".repeat(48)}`, updatedAtISO: "2026-09-17T13:05:00.000Z"
      });
    }],
    ["allocation fence", (h) => {
      const fixture = evidenceFixture();
      const fence = fixture.fences[0];
      const path = `organizations/${ORG}/inventoryAllocationFences/${fence.fenceId}`;
      h.db.store.set(path, { ...h.db.store.get(path), revision: fence.revision + 1, updatedAtISO: "2026-09-17T13:05:00.000Z" });
    }]
  ])("marks %s changes stale and refuses approval against old evidence", async (_label, mutate) => {
    const h = harness();
    const initial = await h.runtime.getEventSupplyActionPlan({ schemaVersion: 1, organizationId: ORG, quoteId: QUOTE }, h.context);
    expect(initial.source).toMatchObject({ eligible: true, ineligibilityReasons: [] });
    await h.runtime.applyEventSupplyActionPlanCommand(request(
      fenced("save_draft", initial.source, 0, { edits: [edit(initial.source)] }), "supply-source-draft-0001"
    ), h.context);
    mutate(h);
    const stale = await h.runtime.getEventSupplyActionPlan({ schemaVersion: 1, organizationId: ORG, quoteId: QUOTE }, h.context);
    expect(stale).toMatchObject({ stale: true, resolution: "stale", source: { eligible: false } });
    await expect(h.runtime.applyEventSupplyActionPlanCommand(request(
      fenced("approve", initial.source, 1, { confirmation: "approve_internal_supply_plan" }), "supply-source-approve-0002"
    ), h.context)).rejects.toMatchObject({ code: "aborted" });
  });

  test.each([
    ["requirement head", `organizations/${ORG}/eventIngredientRequirementHeads/${QUOTE}`],
    ["event projection", `organizations/${ORG}/eventIngredientProjections/${QUOTE}`]
  ])("binds the full %s document into freshness even when semantic eligibility remains current", async (_label, path) => {
    const h = harness();
    const initial = await h.runtime.getEventSupplyActionPlan({ schemaVersion: 1, organizationId: ORG, quoteId: QUOTE }, h.context);
    await h.runtime.applyEventSupplyActionPlanCommand(request(
      fenced("save_draft", initial.source, 0, { edits: [edit(initial.source)] }), "supply-fingerprint-draft-0001"
    ), h.context);
    h.db.store.set(path, { ...h.db.store.get(path), updatedAtISO: "2026-09-17T13:05:00.000Z" });
    const changed = await h.runtime.getEventSupplyActionPlan({ schemaVersion: 1, organizationId: ORG, quoteId: QUOTE }, h.context);
    expect(changed).toMatchObject({ stale: true, resolution: "stale", source: { eligible: true } });
    expect(changed.source.sourceFingerprint).not.toBe(initial.source.sourceFingerprint);
    await expect(h.runtime.applyEventSupplyActionPlanCommand(request(
      fenced("approve", initial.source, 1, { confirmation: "approve_internal_supply_plan" }), "supply-fingerprint-approve-0002"
    ), h.context)).rejects.toMatchObject({ code: "aborted" });
  });

  test("fingerprints realistic decimal quote evidence and detects an exact total drift", async () => {
    const h = harness();
    const initial = await h.runtime.getEventSupplyActionPlan({ schemaVersion: 1, organizationId: ORG, quoteId: QUOTE }, h.context);
    expect(initial.source).toMatchObject({ eligible: true });
    await h.runtime.applyEventSupplyActionPlanCommand(request(
      fenced("save_draft", initial.source, 0, { edits: [edit(initial.source)] }), "supply-decimal-draft-0001"
    ), h.context);
    const quotePath = `organizations/${ORG}/quotes/${QUOTE}`;
    h.db.store.set(quotePath, { ...h.db.store.get(quotePath), total: 2030.23875 });
    const changed = await h.runtime.getEventSupplyActionPlan({ schemaVersion: 1, organizationId: ORG, quoteId: QUOTE }, h.context);
    expect(changed).toMatchObject({ stale: true, resolution: "stale", source: { eligible: true } });
    expect(changed.source.quoteRevisionFingerprint).not.toBe(initial.source.quoteRevisionFingerprint);
    await expect(h.runtime.applyEventSupplyActionPlanCommand(request(
      fenced("approve", initial.source, 1, { confirmation: "approve_internal_supply_plan" }), "supply-decimal-approve-0002"
    ), h.context)).rejects.toMatchObject({ code: "aborted" });
  });

  test.each([
    ["non-finite number", (fixture) => { fixture.quote.taxRate = Number.NaN; }],
    ["unsupported value", (fixture) => { fixture.quoteVersion.snapshot.unsupported = 1n; }]
  ])("rejects %s in quote fingerprint evidence deterministically", async (_label, mutate) => {
    const fixture = evidenceFixture();
    mutate(fixture);
    const h = harness({ fixture });
    await expect(h.runtime.getEventSupplyActionPlan(
      { schemaVersion: 1, organizationId: ORG, quoteId: QUOTE }, h.context
    )).rejects.toMatchObject({ code: "data-loss" });
  });

  test.each(["released", "settled"])("refuses %s allocation evidence and never derives resolved", async (terminalState) => {
    const h = harness();
    const initial = await h.runtime.getEventSupplyActionPlan({ schemaVersion: 1, organizationId: ORG, quoteId: QUOTE }, h.context);
    await h.runtime.applyEventSupplyActionPlanCommand(request(
      fenced("save_draft", initial.source, 0, { edits: [edit(initial.source)] }), `supply-${terminalState}-draft-0001`
    ), h.context);
    installFixture(h, evidenceFixture({ required: 40_000_000, onHand: 40_000_000, terminalState }));
    const stale = await h.runtime.getEventSupplyActionPlan({ schemaVersion: 1, organizationId: ORG, quoteId: QUOTE }, h.context);
    expect(stale).toMatchObject({ stale: true, resolution: "stale", source: { eligible: false, shortages: [] } });
    await expect(h.runtime.applyEventSupplyActionPlanCommand(request(
      fenced("rebase", stale.source, 1, { edits: [] }), `supply-${terminalState}-rebase-0002`
    ), h.context)).rejects.toMatchObject({ code: "aborted" });
    expect(h.db.store.get(`organizations/${ORG}/eventSupplyActionPlans/${QUOTE}`).resolution).toBe("unresolved");
  });
});
