import { beforeEach, expect, test, vi } from "vitest";
const transport = vi.hoisted(() => ({ call: vi.fn(), callable: vi.fn() }));
vi.mock("firebase/functions", () => ({ httpsCallable: transport.callable }));
vi.mock("../firebase", () => ({ cloudFunctions: {}, firebaseReady: true }));
let client, phase, guard;
const scope = { organizationId: "org-a", quoteId: "quote-a", principalId: "admin-a" };
const at = "2026-09-05T19:00:00.000Z";
function absent(reasonCode = "journal_empty") { return { organizationId: scope.organizationId, quoteId: scope.quoteId, sourceVersionId: "version-a", acceptanceReceiptId: "accept-a", ledgerId: "ledger-a", workflowKind: "event_execution", journalKind: "event_work", schemaVersion: 1, workPolicyVersion: 1, workPolicyDigest: "a".repeat(64), phasePolicyVersion: 1, phasePolicyDigest: "b".repeat(64), revision: 0, checkpoints: ["venue_access", "team_briefing", "service_handoff", "pack_down"].map((code) => ({ code, state: "not_recorded", note: "", updatedAtISO: "", lastReceiptId: "" })), issues: [], lastReceiptId: "", updatedAtISO: "", latestReceipt: null, historyCoverage: "latest_receipt_only", evidenceBoundary: "Operator recorded only", availability: "not_yet_available", reasonCode }; }
const command = { ...scope, sourceVersionId: "version-a", acceptanceReceiptId: "accept-a", requestId: "work_request_one", workPolicyVersion: 1, expectedWorkRevision: 0, command: "checkpoint_record", checkpointCode: "venue_access", note: "Venue opened" };
const envelope = (snapshot) => ({ ok: true, storage: "firebase", organizationId: scope.organizationId, quoteId: scope.quoteId, snapshot });
function result(input = command) {
  const snapshot = absent(); const checkpoint = input.command.startsWith("checkpoint_");
  const receipt = { receiptId: "work-receipt-a", requestId: input.requestId, command: input.command, checkpointCode: checkpoint ? input.checkpointCode : "", issueId: checkpoint ? "" : "issue-a", priorRevision: input.expectedWorkRevision, resultRevision: input.expectedWorkRevision + 1, priorState: checkpoint ? "not_recorded" : null, resultState: checkpoint ? "recorded" : "open", recordedAtISO: at };
  Object.assign(snapshot, { availability: "available", reasonCode: "", revision: receipt.resultRevision, lastReceiptId: receipt.receiptId, updatedAtISO: at, latestReceipt: { ...receipt } });
  if (checkpoint) Object.assign(snapshot.checkpoints.find((item) => item.code === input.checkpointCode), { state: "recorded", note: input.note.trim(), updatedAtISO: at, lastReceiptId: receipt.receiptId });
  else snapshot.issues.push({ issueId: "issue-a", state: "open", severity: input.severity, description: input.note.trim(), latestNote: input.note.trim(), createdAtISO: at, updatedAtISO: at, lastReceiptId: receipt.receiptId });
  return { ...envelope(snapshot), receipt, idempotent: false };
}
beforeEach(async () => { vi.resetModules(); vi.clearAllMocks(); transport.callable.mockReturnValue(transport.call); client = await import("../eventOperatingWorkClient"); phase = await import("../eventOperationsClient"); guard = await import("../eventOperatingMutationGuard"); });

test("work reads preserve exact absent sources and reject forged journal fields", async () => {
  transport.call.mockResolvedValueOnce({ data: envelope(absent("phase_ledger_missing")) });
  expect((await client.getEventOperatingWorkSnapshot(scope)).snapshot.reasonCode).toBe("phase_ledger_missing");
  for (const snapshot of [{ ...absent(), organizationId: "foreign" }, { ...absent(), actorEmail: "private" }, { ...absent(), checkpoints: [] }]) {
    transport.call.mockResolvedValueOnce({ data: envelope(snapshot) });
    await expect(client.getEventOperatingWorkSnapshot(scope)).rejects.toMatchObject({ code: "invalid-server-response" });
  }
});

test("work commands normalize whitespace and multiline notes before dispatch and verification", async () => {
  const input = { ...command, note: "  Venue access\nTeam\tbriefed  " }; transport.call.mockResolvedValueOnce({ data: result(input) });
  expect((await client.applyEventOperatingWorkCommand(input)).snapshot.checkpoints[0].note).toBe("Venue access\nTeam\tbriefed");
  expect(transport.call.mock.calls[0][0].note).toBe("Venue access\nTeam\tbriefed");
  expect(transport.call.mock.calls[0][0]).not.toHaveProperty("principalId");
  expect(guard.readEventOperatingMutationGuard(scope)).toBeNull();
});

test("issue IDs are server-generated and returned issue evidence matches the exact description", async () => {
  const input = { ...scope, sourceVersionId: "version-a", acceptanceReceiptId: "accept-a", requestId: "issue-request", workPolicyVersion: 1, expectedWorkRevision: 0, command: "issue_open", note: "Generator supply interrupted", severity: "urgent" };
  transport.call.mockResolvedValueOnce({ data: result(input) });
  expect((await client.applyEventOperatingWorkCommand(input)).receipt.issueId).toBe("issue-a");
  await expect(client.applyEventOperatingWorkCommand({ ...input, title: "unsupported" })).rejects.toMatchObject({ code: "invalid-argument" });
  await expect(client.applyEventOperatingWorkCommand({ ...input, note: " " })).rejects.toMatchObject({ code: "invalid-argument" });
  expect(transport.call).toHaveBeenCalledTimes(1);
});

test("uncertain work locks phase across remount and gate denial then allows only exact reconciliation", async () => {
  transport.call.mockRejectedValueOnce(Object.assign(new Error("timeout"), { code: "functions/deadline-exceeded" }));
  await expect(client.applyEventOperatingWorkCommand(command)).rejects.toMatchObject({ code: "deadline-exceeded" });
  expect(client.readPendingEventWorkCommand({ ...scope }).command.requestId).toBe(command.requestId);
  const phaseCommand = { ...scope, sourceVersionId: "version-a", acceptanceReceiptId: "accept-a", requestId: "phase-request", command: "transition", expectedLedgerRevision: 1, targetPhase: "in_progress" };
  await expect(phase.applyEventOperatingCommand(phaseCommand)).rejects.toMatchObject({ code: "event-mutation-blocked" });
  transport.call.mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "functions/permission-denied" }));
  await expect(client.applyEventOperatingWorkCommand(command)).rejects.toMatchObject({ uncertain: true });
  expect(client.resetDefinitiveEventWorkCommand(scope)).toBe(false);
  expect(transport.call).toHaveBeenCalledTimes(2);
  transport.call.mockResolvedValueOnce({ data: { ...result(), idempotent: true } });
  expect((await client.applyEventOperatingWorkCommand(command)).idempotent).toBe(true);
  expect(transport.call.mock.calls[2][0]).toEqual(transport.call.mock.calls[0][0]);
});

test("phase transport starts synchronously before new work can claim the same event", async () => {
  let reject; transport.call.mockReturnValueOnce(new Promise((_, no) => { reject = no; }));
  const running = phase.applyEventOperatingCommand({ ...scope, sourceVersionId: "version-a", acceptanceReceiptId: "accept-a", requestId: "phase-request", command: "transition", expectedLedgerRevision: 1, targetPhase: "in_progress" });
  await expect(client.applyEventOperatingWorkCommand(command)).rejects.toMatchObject({ code: "event-mutation-blocked" });
  reject(Object.assign(new Error("timeout"), { code: "unavailable" })); await expect(running).rejects.toMatchObject({ code: "unavailable" });
  expect(transport.call).toHaveBeenCalledTimes(1);
});

test("malformed command receipts remain uncertain and child timestamps cannot exceed the journal", async () => {
  const wrong = result(); wrong.receipt.requestId = "other"; transport.call.mockResolvedValueOnce({ data: wrong });
  await expect(client.applyEventOperatingWorkCommand(command)).rejects.toMatchObject({ uncertain: true });
  expect(client.resetDefinitiveEventWorkCommand(scope)).toBe(false);
  const future = result().snapshot; future.checkpoints[1] = { code: "team_briefing", state: "recorded", note: "", updatedAtISO: "2027-01-01T00:00:00.000Z", lastReceiptId: "future" };
  transport.call.mockResolvedValueOnce({ data: envelope(future) });
  await expect(client.getEventOperatingWorkSnapshot(scope)).rejects.toMatchObject({ code: "invalid-server-response" });
});

test("definitive work rejection requires explicit reset and releases only its work lock", async () => {
  transport.call.mockRejectedValueOnce(Object.assign(new Error("stale"), { code: "functions/failed-precondition" }));
  await expect(client.applyEventOperatingWorkCommand(command)).rejects.toMatchObject({ code: "failed-precondition" });
  expect(guard.readEventOperatingMutationGuard(scope).status).toBe("rejected");
  expect(client.resetDefinitiveEventWorkCommand(scope)).toBe(true); expect(guard.readEventOperatingMutationGuard(scope)).toBeNull();
});

test("duplicate in-flight work requests share one transport through failure and exact retry", async () => {
  let reject; transport.call.mockReturnValueOnce(new Promise((_, no) => { reject = no; }));
  const first = client.applyEventOperatingWorkCommand(command), second = client.applyEventOperatingWorkCommand({ ...command });
  expect(second).toBe(first); expect(transport.call).toHaveBeenCalledTimes(1);
  expect(client.resetDefinitiveEventWorkCommand(scope)).toBe(false);
  reject(Object.assign(new Error("timeout"), { code: "unavailable" }));
  await expect(first).rejects.toMatchObject({ uncertain: true }); await expect(second).rejects.toMatchObject({ uncertain: true });
  let resolve; transport.call.mockReturnValueOnce(new Promise((yes) => { resolve = yes; }));
  const retry = client.applyEventOperatingWorkCommand(command), remount = client.applyEventOperatingWorkCommand({ ...command });
  expect(remount).toBe(retry); expect(transport.call).toHaveBeenCalledTimes(2);
  resolve({ data: { ...result(), idempotent: true } });
  await retry; await remount;
  expect(client.readPendingEventWorkCommand(scope)).toBeNull(); expect(guard.readEventOperatingMutationGuard(scope)).toBeNull();
});
