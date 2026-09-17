import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callable: vi.fn(),
  httpsCallable: vi.fn(),
  auth: { currentUser: { uid: "admin" } },
  functions: { id: "functions" }
}));
vi.mock("firebase/functions", () => ({ httpsCallable: mocks.httpsCallable }));
vi.mock("../firebase", () => ({ auth: mocks.auth, cloudFunctions: mocks.functions, firebaseReady: true }));

import {
  EVENT_SUPPLY_ACTION_PLAN_CALLABLES,
  applyEventSupplyActionPlanCommand,
  buildEventSupplyActionPlanRequestId,
  getEventSupplyActionPlan
} from "../eventSupplyActionPlanClient";

const ORG = "org-supply-client";
const QUOTE = "quote-1";
const REQUEST = `supply_plan_request_${"a".repeat(32)}`;
const source = {
  eventPlanId: `eip_${"1".repeat(48)}`,
  planRevisionId: `eipr_${"2".repeat(48)}`,
  allocationRevision: 2,
  eventRequirementRevisionId: `eir_${"3".repeat(48)}`,
  allocationFingerprint: "4".repeat(64),
  shortageFingerprint: "5".repeat(64),
  sourceFingerprint: "6".repeat(64),
  shortages: [{ ingredientId: "chicken", locationId: "kitchen", baseUnitId: "lb", shortageQuantity: "5", shortageQuantityMicros: 5_000_000 }]
};
const edit = {
  ingredientId: "chicken",
  locationId: "kitchen",
  baseUnitId: "lb",
  shortageQuantity: "5",
  supplierId: "supplier-a",
  supplierLabel: "Supplier A",
  purchaseQuantity: "10",
  estimatedCostMinor: 5000,
  currency: "USD",
  note: "Internal option",
  conditions: ["Operator review required"],
  policyFingerprint: "7".repeat(64),
  offerFingerprint: "8".repeat(64)
};
const command = {
  kind: "save_draft",
  quoteId: QUOTE,
  expectedPlanRevision: 0,
  expectedAllocationFingerprint: source.allocationFingerprint,
  expectedShortageFingerprint: source.shortageFingerprint,
  expectedSourceFingerprint: source.sourceFingerprint,
  edits: [edit]
};
const scope = { organizationId: ORG, quoteId: QUOTE, role: "admin" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.currentUser = { uid: "admin" };
  mocks.httpsCallable.mockReturnValue(mocks.callable);
});

describe("event supply action plan client", () => {
  test("uses callables only and validates exact read and mutation authority envelopes", async () => {
    mocks.callable
      .mockResolvedValueOnce({ data: { ok: true, schemaVersion: 1, appCheck: "verified", organizationId: ORG, quoteId: QUOTE, source, plan: null, stale: false, resolution: "not_started" } })
      .mockResolvedValueOnce({ data: {
        ok: true, schemaVersion: 1, appCheck: "verified", organizationId: ORG, quoteId: QUOTE, commandKind: "save_draft",
        planRevision: 1, revisionId: `esapr_${"9".repeat(48)}`, status: "draft", resolution: "unresolved",
        sourceFingerprint: source.sourceFingerprint, idempotent: false,
        receipt: { schemaVersion: 1, organizationId: ORG, receiptId: `esaprc_${"a".repeat(48)}`, requestId: REQUEST, commandKind: "save_draft", recordedAtISO: "2026-09-17T13:00:00.000Z" }
      } });

    await expect(getEventSupplyActionPlan(scope)).resolves.toMatchObject({ resolution: "not_started", source: { sourceFingerprint: source.sourceFingerprint } });
    expect(mocks.httpsCallable).toHaveBeenNthCalledWith(1, mocks.functions, EVENT_SUPPLY_ACTION_PLAN_CALLABLES.get);
    await expect(applyEventSupplyActionPlanCommand({ ...scope, requestId: REQUEST, command }))
      .resolves.toMatchObject({ commandKind: "save_draft", planRevision: 1, idempotent: false });
    expect(mocks.httpsCallable).toHaveBeenNthCalledWith(2, mocks.functions, EVENT_SUPPLY_ACTION_PLAN_CALLABLES.apply);
    expect(mocks.callable).toHaveBeenLastCalledWith({ schemaVersion: 1, organizationId: ORG, requestId: REQUEST, command });
  });

  test("enforces tenant role, exact keys, fingerprints, and receipt provenance", async () => {
    await expect(getEventSupplyActionPlan({ ...scope, role: "customer" })).rejects.toMatchObject({ code: "permission-denied" });
    await expect(applyEventSupplyActionPlanCommand({ ...scope, role: "sales", requestId: REQUEST, command }))
      .rejects.toMatchObject({ code: "permission-denied" });
    await expect(applyEventSupplyActionPlanCommand({ ...scope, requestId: REQUEST, command: { ...command, vendorMessage: "send" } }))
      .rejects.toThrow(/unsupported fields/i);
    await expect(applyEventSupplyActionPlanCommand({
      ...scope, requestId: REQUEST, command: { ...command, edits: [{ ...edit, policyFingerprint: "not-a-hash" }] }
    })).rejects.toThrow(/fingerprint/i);
    mocks.callable.mockResolvedValueOnce({ data: {
      ok: true, schemaVersion: 1, appCheck: "verified", organizationId: "org-other", quoteId: QUOTE, commandKind: "save_draft",
      planRevision: 1, revisionId: `esapr_${"9".repeat(48)}`, status: "draft", resolution: "unresolved",
      sourceFingerprint: source.sourceFingerprint, idempotent: false,
      receipt: { schemaVersion: 1, organizationId: ORG, receiptId: `esaprc_${"a".repeat(48)}`, requestId: REQUEST, commandKind: "save_draft", recordedAtISO: "2026-09-17T13:00:00.000Z" }
    } });
    await expect(applyEventSupplyActionPlanCommand({ ...scope, requestId: REQUEST, command }))
      .rejects.toMatchObject({ code: "data-loss" });
  });

  test("generates request identities only from cryptographic bytes", () => {
    expect(buildEventSupplyActionPlanRequestId({ getRandomValues(bytes) { bytes.fill(15); return bytes; } }))
      .toBe(`supply_plan_request_${"0f".repeat(16)}`);
    expect(() => buildEventSupplyActionPlanRequestId({})).toThrow(/secure supply-plan request identity/i);
  });
});
