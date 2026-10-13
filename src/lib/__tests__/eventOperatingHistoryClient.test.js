import { beforeEach, expect, test, vi } from "vitest";
const transport = vi.hoisted(() => ({ call: vi.fn(), callable: vi.fn() }));
vi.mock("firebase/functions", () => ({ httpsCallable: transport.callable }));
vi.mock("../firebase", () => ({ cloudFunctions: {}, firebaseReady: true }));
import { getEventOperatingHistory, mergeEventHistoryPages } from "../eventOperatingHistoryClient";
const scope = { organizationId: "org-a", quoteId: "quote-a" }, ledgerId = `event_ops_${"a".repeat(48)}`;
const rid = (channel, n) => `${{ phase: "event_ops_command_", work: "event_work_command_", actuals: "event_actuals_command_" }[channel]}${n.toString(16).padStart(48, "0")}`;
function phase() { return { channel: "phase", receiptId: rid("phase", 1), requestId: "request-1", priorRevision: 0, resultRevision: 1, command: "initialize", recordedAtISO: "2026-09-05T10:00:00.000Z", actor: { uid: "admin-a", role: "admin" }, targetType: "phase", targetId: ledgerId, before: { phase: null }, after: { phase: "prepared" }, note: "" }; }
function snapshot() { return { ...scope, sourceVersionId: "version-a", acceptanceReceiptId: "accept-a", ledgerId, availability: "available", reasonCode: "", rows: [phase()], anchors: { phase: { revision: 1, receiptId: rid("phase", 1) }, work: { revision: 0, receiptId: "" }, actuals: { revision: 0, receiptId: "" } }, pageSize: 20, nextCursor: null, hasMore: false, completeForAnchors: true, newerAvailable: false, historyCoverage: "operational_channels_at_anchors", evidenceBoundary: "Operational channels only" }; }
const envelope = (s) => ({ ok: true, storage: "firebase", ...scope, snapshot: s });
beforeEach(() => { vi.clearAllMocks(); transport.callable.mockReturnValue(transport.call); });
test("history reads exact scope and strictly bounded public phase receipt", async () => {
  transport.call.mockResolvedValueOnce({ data: envelope(snapshot()) }); const result = await getEventOperatingHistory(scope);
  expect(transport.callable).toHaveBeenCalledWith({}, "getEventOperatingHistory"); expect(transport.call).toHaveBeenCalledWith(scope); expect(result.snapshot.rows[0].before).toEqual({ phase: null }); expect(Object.isFrozen(result.snapshot.rows[0].actor)).toBe(true);
  expect(mergeEventHistoryPages(null, result.snapshot).completeForAnchors).toBe(true);
});
test("history rejects foreign scope unknown private data and contradictory anchors", async () => {
  for (const change of [(s) => s.organizationId = "other", (s) => s.rows[0].actor.email = "private", (s) => s.rows[0].after.phase = "completed", (s) => s.anchors.phase.receiptId = rid("phase", 2), (s) => s.hasMore = true, (s) => s.rows.push(s.rows[0]), (s) => s.rows[0].targetId = "other", (s) => s.rows[0].note = "unexpected"]) {
    const s = snapshot(); change(s); transport.call.mockResolvedValueOnce({ data: envelope(s) }); await expect(getEventOperatingHistory(scope)).rejects.toMatchObject({ code: "invalid-server-response" });
  }
});
test("history validates typed work and actuals before after evidence", async () => {
  const base = phase(); const actual = { ...base, channel: "actuals", receiptId: rid("actuals", 1), command: "record", targetType: "actual_entry", targetId: `event_actual_${"a".repeat(32)}`, before: null, after: { category: "labor", state: "active", description: "Known labor", costCents: 0, durationMinutes: 60, laborRole: "server" } };
  const work = { ...base, channel: "work", receiptId: rid("work", 1), command: "checkpoint_record", targetType: "checkpoint", targetId: "venue_access", before: { state: "not_recorded" }, after: { state: "recorded" } };
  const s = snapshot(); s.rows.push(work, actual); s.anchors.work = { revision: 1, receiptId: work.receiptId }; s.anchors.actuals = { revision: 1, receiptId: actual.receiptId };
  transport.call.mockResolvedValueOnce({ data: envelope(s) }); expect((await getEventOperatingHistory(scope)).snapshot.rows).toHaveLength(3);
  for (const alter of [(v) => v.rows[2].after.costCents = null, (v) => v.rows[2].after.durationMinutes = 0, (v) => v.rows[1].after.state = "reopened", (v) => v.rows.reverse()]) { const invalid = structuredClone(s); alter(invalid); transport.call.mockResolvedValueOnce({ data: envelope(invalid) }); await expect(getEventOperatingHistory(scope)).rejects.toMatchObject({ code: "invalid-server-response" }); }
});
test("history pagination preserves anchors rejects gaps and never treats cursors as authority", async () => {
  const first = snapshot(); first.hasMore = true; first.completeForAnchors = false; first.nextCursor = "opaque_cursor";
  const next = snapshot(); next.rows = []; next.newerAvailable = true;
  expect(mergeEventHistoryPages(first, next)).toMatchObject({ completeForAnchors: true, newerAvailable: true });
  expect(() => mergeEventHistoryPages(first, { ...next, sourceVersionId: "different" })).toThrow("source changed");
  expect(() => mergeEventHistoryPages(first, snapshot())).toThrow();
  expect(() => mergeEventHistoryPages(null, { ...snapshot(), rows: [] })).toThrow("anchors");
  await expect(getEventOperatingHistory({ ...scope, cursor: "" })).rejects.toMatchObject({ code: "invalid-argument" }); expect(transport.call).not.toHaveBeenCalled();
  transport.call.mockRejectedValueOnce({ code: "functions/aborted", message: "private details" }); await expect(getEventOperatingHistory({ ...scope, cursor: "opaque_cursor" })).rejects.toThrow("accepted source changed"); expect(transport.call).toHaveBeenCalledWith({ ...scope, cursor: "opaque_cursor" });
});
