import { createRequire } from "node:module";
import { describe, expect, test, vi } from "vitest";

const require = createRequire(import.meta.url);
const inventory = require("../../../functions/inventoryIngredientCore.cjs");
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

function allocationPlan({ required = 50_000_000, onHand = 40_000_000, currentPlan = null } = {}) {
  const requirement = {
    organizationId: ORG,
    quoteId: QUOTE,
    eventRequirementRevisionId: `eir_${"a".repeat(48)}`,
    demandState: "complete",
    requiredByISO: "2026-09-20T18:00:00.000Z",
    requirementDigest: "f".repeat(64),
    ingredients: [{ ingredientId: "chicken", baseUnitId: "lb", requiredQuantityMicros: required }]
  };
  const stockState = inventory.createEmptyStockState({ organizationId: ORG, ingredientId: "chicken", locationId: "kitchen", baseUnitId: "lb" });
  const opened = { ...stockState, revision: 1, onHandMicros: onHand, lastMovementId: `imv_${"b".repeat(48)}`, updatedAtISO: NOW };
  return allocation.planEventAllocation({
    request: {
      kind: "allocate_event_ingredients",
      quoteId: QUOTE,
      eventRequirementRevisionId: requirement.eventRequirementRevisionId,
      locationId: "kitchen",
      expectedRequirementRevision: 1,
      expectedAllocationRevision: currentPlan?.allocationRevision || 0
    },
    organizationId: ORG,
    requirementHead: {
      organizationId: ORG,
      quoteId: QUOTE,
      revision: 1,
      eventRequirementRevisionId: requirement.eventRequirementRevisionId,
      requirementDigest: requirement.requirementDigest
    },
    requirement,
    currentPlan,
    stockStates: [opened],
    fences: [],
    nowISO: NOW
  }).plan;
}

function harness({ plan = allocationPlan(), role = "admin", contextRole = role, enabled = true } = {}) {
  const db = fakeDb([
    [`organizations/${ORG}`, { active: true }],
    [`organizations/${ORG}/settings/config`, { inventoryAuthorityEnabled: enabled }],
    [`userRoles/${UID}`, { organizationId: ORG, role, email: "admin@example.test" }],
    [`organizations/${ORG}/eventIngredientPlans/${QUOTE}`, plan]
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
    const refreshed = allocationPlan({ required: 40_000_000, onHand: 40_000_000 });
    h.db.store.set(`organizations/${ORG}/eventIngredientPlans/${QUOTE}`, refreshed);
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
    const changed = allocationPlan({ required: 55_000_000, onHand: 40_000_000 });
    h.db.store.set(`organizations/${ORG}/eventIngredientPlans/${QUOTE}`, changed);
    const stale = await h.runtime.getEventSupplyActionPlan({ schemaVersion: 1, organizationId: ORG, quoteId: QUOTE }, h.context);
    const rebased = await h.runtime.applyEventSupplyActionPlanCommand(request(
      fenced("rebase", stale.source, 2, { edits: [edit(stale.source, { shortageQuantity: "15", purchaseQuantity: "15" })] }),
      "supply-rebase-changed-0003"
    ), h.context);
    expect(rebased).toMatchObject({ status: "draft", resolution: "unresolved" });
    expect(h.db.store.get(`organizations/${ORG}/eventSupplyActionPlans/${QUOTE}`).approvalEvidence).toBeNull();

    const latestSource = h.db.store.get(`organizations/${ORG}/eventSupplyActionPlans/${QUOTE}`).source;
    h.db.store.set(`organizations/${ORG}/eventIngredientPlans/${QUOTE}`, allocationPlan({ required: 40_000_000, onHand: 40_000_000 }));
    await h.runtime.applyEventSupplyActionPlanCommand(request({
      kind: "cancel", quoteId: QUOTE, expectedPlanRevision: 3, reason: "Operator stopped planning"
    }, "supply-cancel-stale-0004"), h.context);
    const cancelled = h.db.store.get(`organizations/${ORG}/eventSupplyActionPlans/${QUOTE}`);
    expect(cancelled).toMatchObject({ status: "cancelled", resolution: "unresolved", source: { sourceFingerprint: latestSource.sourceFingerprint } });
    expect(() => supply.verifyRevision(cancelled, { organizationId: ORG, quoteId: QUOTE })).not.toThrow();
  });
});
