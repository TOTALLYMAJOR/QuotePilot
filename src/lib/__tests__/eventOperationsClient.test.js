import { beforeEach, expect, test, vi } from "vitest";
const transport = vi.hoisted(() => ({ call: vi.fn(), callable: vi.fn() }));
vi.mock("firebase/functions", () => ({ httpsCallable: transport.callable }));
vi.mock("../firebase", () => ({ cloudFunctions: {}, firebaseReady: true }));
let client;
const scope = { organizationId: "org-a", quoteId: "quote-a" };
const absent = { ...scope, workflowKind: "event_execution", ledgerId: "ledger-a", schemaVersion: 1, templateVersion: 1, policyDigest: "a".repeat(64), evidenceBoundary: "Operator recorded only", historyCoverage: "latest_receipt_only", lastReceiptId: "", updatedAtISO: "", latestReceipt: null, policyVersion: 1, sourceVersionId: "version-a", acceptanceReceiptId: "accept-a", availability: "not_yet_available", revision: 0, phase: null };
const command = { ...scope, principalId: "admin-a", sourceVersionId: "version-a", acceptanceReceiptId: "accept-a", requestId: "event_request_one", command: "initialize", expectedLedgerRevision: 0, targetPhase: "prepared" };
function result(overrides = {}) { return { ok: true, storage: "firebase", ...scope, snapshot: absent, ...overrides }; }
function receiptResult() {
  const receipt = { receiptId: "receipt-a", requestId: command.requestId, priorRevision: 0, resultRevision: 1, priorPhase: null, resultPhase: "prepared", recordedAtISO: "2026-09-05T12:00:00.000Z" };
  return result({ snapshot: { ...absent, availability: "available", ledgerId: "ledger-a", lastReceiptId: "receipt-a", revision: 1, phase: "prepared", updatedAtISO: "2026-09-05T12:00:00.000Z", latestReceipt: { ...receipt } }, idempotent: false, receipt });
}
beforeEach(async () => { vi.resetModules(); vi.clearAllMocks(); transport.callable.mockReturnValue(transport.call); client = await import("../eventOperationsClient"); });

test("reads only exact event source and rejects foreign envelopes", async () => {
  transport.call.mockResolvedValueOnce({ data: result() });
  expect((await client.getEventOperatingSnapshot(scope)).snapshot.availability).toBe("not_yet_available");
  expect(transport.call).toHaveBeenCalledWith(scope);
  transport.call.mockResolvedValueOnce({ data: result({ organizationId: "foreign" }) });
  await expect(client.getEventOperatingSnapshot(scope)).rejects.toMatchObject({ code: "invalid-server-response" });
});

test("records verified exact receipts without sending principal authority", async () => {
  transport.call.mockResolvedValueOnce({ data: receiptResult() });
  const value = await client.applyEventOperatingCommand(command);
  expect(value.receipt.receiptId).toBe("receipt-a");
  expect(transport.call.mock.calls[0][0]).not.toHaveProperty("principalId");
  expect(client.readPendingEventOperatingCommand(command)).toBeNull();
});

test("ambiguous transport freezes exact request and refuses replacement", async () => {
  transport.call.mockRejectedValueOnce(Object.assign(new Error("provider internals"), { code: "functions/unavailable" }));
  await expect(client.applyEventOperatingCommand(command)).rejects.toMatchObject({ code: "unavailable" });
  expect(client.resetDefinitiveEventOperatingCommand(command)).toBe(false);
  expect(client.readPendingEventOperatingCommand({ ...command, principalId: "other-admin" })).toBeNull();
  await expect(client.applyEventOperatingCommand({ ...command, requestId: "changed_request" })).rejects.toMatchObject({ code: "failed-precondition" });
  expect(transport.call).toHaveBeenCalledTimes(1);
  transport.call.mockResolvedValueOnce({ data: { ...receiptResult(), idempotent: true } });
  expect((await client.applyEventOperatingCommand(command)).idempotent).toBe(true);
  expect(transport.call.mock.calls[1][0]).toEqual(transport.call.mock.calls[0][0]);
});

test("malformed post-dispatch receipt remains uncertain until exact reconciliation", async () => {
  const malformed = receiptResult(); malformed.receipt.requestId = "foreign-request";
  transport.call.mockResolvedValueOnce({ data: malformed });
  await expect(client.applyEventOperatingCommand(command)).rejects.toMatchObject({ code: "invalid-server-response" });
  expect(client.readPendingEventOperatingCommand(command).definitive).toBe(false);
  expect(client.resetDefinitiveEventOperatingCommand(command)).toBe(false);
});

test("definitive rejection permits only an explicit reviewed reset", async () => {
  transport.call.mockRejectedValueOnce(Object.assign(new Error("stale source"), { code: "functions/failed-precondition" }));
  await expect(client.applyEventOperatingCommand(command)).rejects.toMatchObject({ code: "failed-precondition" });
  expect(client.readPendingEventOperatingCommand(command).definitive).toBe(true);
  expect(client.resetDefinitiveEventOperatingCommand(command)).toBe(true);
});


test("a gate denial after timeout cannot erase the original uncertain result", async () => {
  transport.call.mockRejectedValueOnce(Object.assign(new Error("timeout"), { code: "functions/deadline-exceeded" }));
  await expect(client.applyEventOperatingCommand(command)).rejects.toMatchObject({ code: "deadline-exceeded" });
  transport.call.mockRejectedValueOnce(Object.assign(new Error("gate revoked"), { code: "functions/failed-precondition" }));
  let rejection;
  try { await client.applyEventOperatingCommand(command); } catch (error) { rejection = error; }
  expect(client.isDefinitiveEventOperatingError(rejection)).toBe(false);
  expect(client.readPendingEventOperatingCommand(command).definitive).toBe(false);
  expect(client.resetDefinitiveEventOperatingCommand(command)).toBe(false);
});

test("read projections reject unknown fields and contradictory latest receipts", async () => {
  transport.call.mockResolvedValueOnce({ data: result({ snapshot: { ...absent, organizationId: "foreign" } }) });
  await expect(client.getEventOperatingSnapshot(scope)).rejects.toMatchObject({ code: "invalid-server-response" });
  transport.call.mockResolvedValueOnce({ data: result({ snapshot: { ...absent, rawActor: { email: "private" } } }) });
  await expect(client.getEventOperatingSnapshot(scope)).rejects.toMatchObject({ code: "invalid-server-response" });
  const available = receiptResult().snapshot; available.latestReceipt.resultPhase = "completed";
  transport.call.mockResolvedValueOnce({ data: result({ snapshot: available }) });
  await expect(client.getEventOperatingSnapshot(scope)).rejects.toMatchObject({ code: "invalid-server-response" });
});

test("duplicate in-flight phase calls share completion and cannot leave a late orphaned attempt", async () => {
  let resolve; transport.call.mockReturnValueOnce(new Promise((yes) => { resolve = yes; }));
  const first = client.applyEventOperatingCommand(command), second = client.applyEventOperatingCommand({ ...command });
  expect(second).toBe(first); expect(transport.call).toHaveBeenCalledTimes(1);
  expect(client.resetDefinitiveEventOperatingCommand(command)).toBe(false);
  resolve({ data: receiptResult() }); await first; await second;
  expect(client.readPendingEventOperatingCommand(command)).toBeNull();
});
