import { beforeEach, expect, test, vi } from "vitest";
const transport = vi.hoisted(() => ({ call: vi.fn(), callable: vi.fn() }));
vi.mock("firebase/functions", () => ({ httpsCallable: transport.callable }));
vi.mock("../firebase", () => ({ cloudFunctions: {}, firebaseReady: true }));
let client, phase, work, guard;
const scope = { organizationId: "org-a", quoteId: "quote-a", principalId: "admin-a" };
const source = { sourceVersionId: "version-a", acceptanceReceiptId: "accept-a" };
const at = "2026-09-05T19:00:00.000Z";
function absent() { return { organizationId: scope.organizationId, quoteId: scope.quoteId, ...source, ledgerId: "ledger-a", workflowKind: "event_execution", journalKind: "event_actuals", schemaVersion: 1, actualsPolicyVersion: 1, actualsPolicyDigest: "a".repeat(64), phasePolicyVersion: 1, phasePolicyDigest: "b".repeat(64), currency: "USD", revision: 0, entries: [], categories: Object.fromEntries(["labor", "purchasing", "other"].map((category) => [category, { state: "not_declared", note: "", declaredAtISO: "", lastDeclarationReceiptId: "" }])), totals: { laborCostCents: 0, purchasingCostCents: 0, otherCostCents: 0, totalCostCents: 0, durationMinutes: 0 }, captureComplete: false, latestReceipt: null, lastReceiptId: "", updatedAtISO: "", historyCoverage: "latest_receipt_only", evidenceBoundary: "Recorded costs only", availability: "not_yet_available", reasonCode: "actuals_empty" }; }
const command = { ...scope, ...source, requestId: "actuals-request", actualsPolicyVersion: 1, expectedActualsRevision: 0, command: "record", category: "labor", description: "Recorded serving labor", costCents: 12500, laborRole: "server", durationMinutes: 120 };
const envelope = (snapshot) => ({ ok: true, storage: "firebase", organizationId: scope.organizationId, quoteId: scope.quoteId, snapshot });
function result(input = command) {
  const snapshot = absent(), receipt = { receiptId: "actuals-receipt", requestId: input.requestId, command: input.command, entryId: input.command === "declare_category" ? "" : "entry-a", category: input.category, priorRevision: input.expectedActualsRevision, resultRevision: input.expectedActualsRevision + 1, recordedAtISO: at };
  Object.assign(snapshot, { revision: receipt.resultRevision, latestReceipt: { ...receipt }, lastReceiptId: receipt.receiptId, updatedAtISO: at, availability: "available", reasonCode: "" });
  if (input.command === "declare_category") snapshot.categories[input.category] = { state: input.state, note: input.note.trim(), declaredAtISO: at, lastDeclarationReceiptId: receipt.receiptId };
  else { snapshot.entries.push({ entryId: "entry-a", category: input.category, state: "active", description: input.description.trim(), costCents: input.costCents, laborRole: input.category === "labor" ? input.laborRole : "", durationMinutes: input.category === "labor" ? input.durationMinutes : null, createdAtISO: at, updatedAtISO: at, lastReceiptId: receipt.receiptId }); snapshot.categories[input.category].state = "partial"; snapshot.totals[`${input.category}CostCents`] = input.costCents; snapshot.totals.totalCostCents = input.costCents; snapshot.totals.durationMinutes = input.category === "labor" ? input.durationMinutes : 0; }
  return { ...envelope(snapshot), receipt, idempotent: false };
}
beforeEach(async () => { vi.resetModules(); vi.clearAllMocks(); transport.callable.mockReturnValue(transport.call); client = await import("../eventOperatingActualsClient"); phase = await import("../eventOperationsClient"); work = await import("../eventOperatingWorkClient"); guard = await import("../eventOperatingMutationGuard"); });

test("actuals zero captured subtotal is not completeness and unknown fields fail closed", async () => {
  transport.call.mockResolvedValueOnce({ data: envelope(absent()) }); const read = await client.getEventOperatingActualsSnapshot(scope);
  expect(read.snapshot.totals.totalCostCents).toBe(0); expect(read.snapshot.captureComplete).toBe(false);
  for (const malformed of [{ ...absent(), captureComplete: true }, { ...absent(), rawProviderData: {} }, { ...absent(), organizationId: "foreign" }, { ...absent(), currency: "EUR" }]) { transport.call.mockResolvedValueOnce({ data: envelope(malformed) }); await expect(client.getEventOperatingActualsSnapshot(scope)).rejects.toMatchObject({ code: "invalid-server-response" }); }
});

test("actuals records exact cents and minutes and normalizes declared text", async () => {
  const input = { ...command, description: "  Server labor\nBreak excluded  " }; transport.call.mockResolvedValueOnce({ data: result(input) });
  expect((await client.applyEventOperatingActualsCommand(input)).snapshot.totals).toMatchObject({ laborCostCents: 12500, durationMinutes: 120 });
  expect(transport.call.mock.calls[0][0]).toMatchObject({ description: "Server labor\nBreak excluded", costCents: 12500 }); expect(transport.call.mock.calls[0][0]).not.toHaveProperty("principalId");
  expect(guard.readEventOperatingMutationGuard(scope)).toBeNull();
});

test("actuals rejects inferred or missing costs and unsupported labor dimensions before dispatch", async () => {
  for (const invalid of [{ costCents: null }, { costCents: -1 }, { costCents: 1.5 }, { durationMinutes: 0 }, { laborRole: "manager" }, { rate: 500 }, { category: "" }]) await expect(client.applyEventOperatingActualsCommand({ ...command, ...invalid })).rejects.toMatchObject({ code: "invalid-argument" });
  expect(transport.call).not.toHaveBeenCalled();
  transport.call.mockResolvedValueOnce({ data: result({ ...command, costCents: 0 }) });
  expect((await client.applyEventOperatingActualsCommand({ ...command, costCents: 0 })).snapshot.captureComplete).toBe(false);
});

test("actuals declaration is explicit and contradicting complete timing is rejected", async () => {
  const declaration = { ...scope, ...source, requestId: "declare-request", actualsPolicyVersion: 1, expectedActualsRevision: 0, command: "declare_category", category: "purchasing", state: "not_applicable", note: "No purchases for this event" };
  transport.call.mockResolvedValueOnce({ data: result(declaration) }); expect((await client.applyEventOperatingActualsCommand(declaration)).snapshot.categories.purchasing.state).toBe("not_applicable");
  const stale = result().snapshot; stale.categories.labor = { state: "complete", note: "Reviewed earlier", declaredAtISO: "2026-09-04T19:00:00.000Z", lastDeclarationReceiptId: "old-declaration" };
  transport.call.mockResolvedValueOnce({ data: envelope(stale) }); await expect(client.getEventOperatingActualsSnapshot(scope)).rejects.toMatchObject({ code: "invalid-server-response" });
  const undeclared = result().snapshot; undeclared.categories.labor.state = "not_declared";
  transport.call.mockResolvedValueOnce({ data: envelope(undeclared) }); await expect(client.getEventOperatingActualsSnapshot(scope)).rejects.toMatchObject({ code: "invalid-server-response" });
});

test("uncertain actuals freezes phase and work and preserves original replay after gate denial", async () => {
  transport.call.mockRejectedValueOnce(Object.assign(new Error("timeout"), { code: "unavailable" })); await expect(client.applyEventOperatingActualsCommand(command)).rejects.toMatchObject({ uncertain: true });
  await expect(phase.applyEventOperatingCommand({ ...scope, ...source, requestId: "phase", command: "transition", expectedLedgerRevision: 1, targetPhase: "in_progress" })).rejects.toMatchObject({ code: "event-mutation-blocked" });
  await expect(work.applyEventOperatingWorkCommand({ ...scope, ...source, requestId: "work", workPolicyVersion: 1, expectedWorkRevision: 0, command: "checkpoint_record", checkpointCode: "venue_access", note: "" })).rejects.toMatchObject({ code: "event-mutation-blocked" });
  transport.call.mockRejectedValueOnce(Object.assign(new Error("revoked"), { code: "functions/permission-denied" })); await expect(client.applyEventOperatingActualsCommand(command)).rejects.toMatchObject({ uncertain: true });
  expect(client.resetDefinitiveEventActualsCommand(scope)).toBe(false);
  transport.call.mockResolvedValueOnce({ data: { ...result(), idempotent: true } }); await client.applyEventOperatingActualsCommand(command);
  expect(transport.call.mock.calls[2][0]).toEqual(transport.call.mock.calls[0][0]);
});

test("actuals exact in-flight promise dedupe prevents remount duplicate transports", async () => {
  let resolve; transport.call.mockReturnValueOnce(new Promise((yes) => { resolve = yes; }));
  const first = client.applyEventOperatingActualsCommand(command), second = client.applyEventOperatingActualsCommand({ ...command }); expect(second).toBe(first); expect(transport.call).toHaveBeenCalledTimes(1);
  expect(client.resetDefinitiveEventActualsCommand(scope)).toBe(false);
  resolve({ data: result() }); await first; await second; expect(client.readPendingEventActualsCommand(scope)).toBeNull();
});

test("actuals rejects mismatched captured totals and receipts without releasing uncertainty", async () => {
  const wrong = result(); wrong.snapshot.totals.totalCostCents += 1; transport.call.mockResolvedValueOnce({ data: wrong });
  await expect(client.applyEventOperatingActualsCommand(command)).rejects.toMatchObject({ uncertain: true }); expect(guard.readEventOperatingMutationGuard(scope).status).toBe("uncertain");
});

test("actuals retained entries include voids and void requests require a reason", async () => {
  await expect(client.applyEventOperatingActualsCommand({ ...scope, ...source, requestId: "void", actualsPolicyVersion: 1, expectedActualsRevision: 1, command: "void", entryId: "entry-a", reason: "" })).rejects.toMatchObject({ code: "invalid-argument" });
  const tooMany = result().snapshot; tooMany.entries = Array.from({ length: 51 }, (_, i) => ({ ...tooMany.entries[0], entryId: `entry-${i}`, state: "voided" })); transport.call.mockResolvedValueOnce({ data: envelope(tooMany) });
  await expect(client.getEventOperatingActualsSnapshot(scope)).rejects.toMatchObject({ code: "invalid-server-response" });
});
