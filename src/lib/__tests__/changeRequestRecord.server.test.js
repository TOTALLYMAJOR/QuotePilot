import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  ChangeRequestRecordError,
  buildChangeRequestRecord,
  normalizeChangeRequestRecordRequest,
  verifyChangeRequestRecordAgainstQuote
} = require("../../../functions/changeRequestRecord.js");

const validPayload = () => ({
  organizationId: "org-a",
  quoteId: "q1",
  requestId: "req-9",
  submittedAtISO: "2026-08-10T11:24:00.000Z",
  parseModelId: "change-request-parse-v1",
  proposals: [
    {
      id: "swap-1",
      kind: "swap_item",
      title: "Swap Grilled Salmon → Herb Chicken",
      clause: "chicken instead of the salmon",
      remove: { itemType: "menuItems", itemId: "salmon", itemName: "Grilled Salmon" },
      add: { itemType: "menuItems", itemId: "chicken", itemName: "Herb Chicken" }
    },
    { id: "guests-2", kind: "set_guests", title: "Guest count → 135", clause: "now at 135 guests", value: 135 }
  ],
  stagedProposalIds: ["swap-1"]
});

const matchingQuote = () => ({
  organizationId: "org-a",
  activeVersionId: "v0004",
  latestVersionNumber: 4,
  portalDecision: {
    decision: "changes_requested",
    requestId: "req-9",
    submittedAtISO: "2026-08-10T11:24:00.000Z",
    message: "Could we do chicken instead of the salmon? We're now at 135 guests."
  }
});

describe("normalizeChangeRequestRecordRequest", () => {
  test("accepts a bounded staged parse and rejects staging outside the submitted proposals", () => {
    const normalized = normalizeChangeRequestRecordRequest(validPayload());
    expect(normalized.proposals).toHaveLength(2);
    expect(normalized.stagedProposalIds).toEqual(["swap-1"]);

    expect(() => normalizeChangeRequestRecordRequest({
      ...validPayload(),
      stagedProposalIds: ["not-a-proposal"]
    })).toThrowError(/must reference the submitted proposals/);
  });

  test("requires at least one staged proposal and recognized kinds only", () => {
    expect(() => normalizeChangeRequestRecordRequest({ ...validPayload(), stagedProposalIds: [] }))
      .toThrowError(ChangeRequestRecordError);
    expect(() => normalizeChangeRequestRecordRequest({
      ...validPayload(),
      proposals: [{ id: "x", kind: "mystery", title: "t", clause: "c" }],
      stagedProposalIds: ["x"]
    })).toThrowError(/kind is not recognized/);
  });

  test("bounds proposal counts, integer ranges, and staff roles", () => {
    const oversized = {
      ...validPayload(),
      proposals: Array.from({ length: 17 }, (_, index) => ({
        id: `p-${index}`, kind: "set_guests", title: "t", clause: "c", value: 10
      })),
      stagedProposalIds: ["p-0"]
    };
    expect(() => normalizeChangeRequestRecordRequest(oversized)).toThrowError(/between 1 and 16/);
    expect(() => normalizeChangeRequestRecordRequest({
      ...validPayload(),
      proposals: [{ id: "g", kind: "set_guests", title: "t", clause: "c", value: 5000 }],
      stagedProposalIds: ["g"]
    })).toThrowError(/positive integer/);
    expect(() => normalizeChangeRequestRecordRequest({
      ...validPayload(),
      proposals: [{ id: "s", kind: "add_staff", title: "t", clause: "c", field: "managers", count: 1 }],
      stagedProposalIds: ["s"]
    })).toThrowError(/staff role/);
  });
});

describe("verifyChangeRequestRecordAgainstQuote", () => {
  test("binds the record to the exact stored request and hashes the exact message", () => {
    const normalized = normalizeChangeRequestRecordRequest(validPayload());
    const verification = verifyChangeRequestRecordAgainstQuote(normalized, matchingQuote());
    expect(verification.messageHash).toMatch(/^[a-f0-9]{64}$/);
    expect(verification.activeVersionIdAtRecord).toBe("v0004");
    expect(verification.latestVersionNumberAtRecord).toBe(4);
  });

  test("fails closed when the stored request no longer matches", () => {
    const normalized = normalizeChangeRequestRecordRequest(validPayload());
    const drifted = matchingQuote();
    drifted.portalDecision.submittedAtISO = "2026-08-11T09:00:00.000Z";
    expect(() => verifyChangeRequestRecordAgainstQuote(normalized, drifted))
      .toThrowError(/no longer matches/);
    const wrongOrg = { ...matchingQuote(), organizationId: "org-b" };
    expect(() => verifyChangeRequestRecordAgainstQuote(normalized, wrongOrg))
      .toThrowError(/does not belong/);
  });
});

describe("buildChangeRequestRecord", () => {
  test("produces a deterministic, staff-attributed, replay-stable record", () => {
    const normalized = normalizeChangeRequestRecordRequest(validPayload());
    const verification = verifyChangeRequestRecordAgainstQuote(normalized, matchingQuote());
    const actor = { uid: "staff-1", email: "Sales-A@Example.com" };
    const first = buildChangeRequestRecord({
      normalized, verification, actor, nowISO: "2026-08-10T12:00:00.000Z"
    });
    const second = buildChangeRequestRecord({
      normalized, verification, actor, nowISO: "2026-08-10T12:05:00.000Z"
    });
    expect(first.resolutionId).toMatch(/^crr_[a-f0-9]{48}$/);
    expect(second.resolutionId).toBe(first.resolutionId);
    expect(first.record.recordedByEmail).toBe("sales-a@example.com");
    expect(first.record.schemaVersion).toBe(1);
    expect(first.record.stagedProposalIds).toEqual(["swap-1"]);
    expect(() => buildChangeRequestRecord({
      normalized, verification, actor: { uid: "" }, nowISO: "2026-08-10T12:00:00.000Z"
    })).toThrowError(/staff actor/);
  });
});
