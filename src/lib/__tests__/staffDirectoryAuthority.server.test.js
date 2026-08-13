import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  STAFF_DIRECTORY_AUTHORITY_VERSION,
  StaffDirectoryAuthorityError,
  defaultStaffRecord,
  normalizeStaffRecord,
  planStaffRecordCommand,
  projectStaffRecord
} = require("../../../functions/staffDirectoryAuthority.js");

const scope = Object.freeze({ organizationId: "org-alpha", staffId: "staff-alpha" });
const actor = Object.freeze({
  organizationId: "org-alpha",
  uid: "admin-alpha",
  role: "admin"
});

function command(record, overrides = {}) {
  return {
    requestId: "staff-record:test-command-0001",
    organizationId: scope.organizationId,
    staffId: scope.staffId,
    expectedRevision: 0,
    record,
    ...overrides
  };
}

function raw(record) {
  const { schemaVersion, authority, authorityVersion, organizationId, staffId, ...value } = record;
  return value;
}

describe("staff directory server authority", () => {
  test("normalizes the full private record without weakening its tenant identity", () => {
    const draft = defaultStaffRecord({ ...scope, displayName: "Avery Lane", capabilities: ["lead", "server"] });
    const normalized = normalizeStaffRecord({
      ...raw(draft),
      contact: { ...draft.contact, email: "AVERY@example.com", communicationsEnabled: true },
      compensation: { ...draft.compensation, hourlyRate: 27.456 },
      qualifications: [{
        qualificationId: "food-handler-1",
        type: "Food handler",
        number: "FH-100",
        provider: "County Health",
        issuedOn: "2026-01-01",
        expiresOn: "2028-01-01",
        status: "current",
        documentUrl: "https://example.com/food-handler.pdf",
        notes: "Verified by operations"
      }]
    }, scope);

    expect(normalized).toMatchObject({
      authority: "server_authoritative",
      authorityVersion: STAFF_DIRECTORY_AUTHORITY_VERSION,
      organizationId: "org-alpha",
      staffId: "staff-alpha",
      contact: { email: "avery@example.com" },
      compensation: { hourlyRate: 27.46 }
    });
    expect(normalized.roleDetails.map((item) => item.role)).toEqual(["lead", "server"]);
    expect(Object.isFrozen(normalized)).toBe(true);
  });

  test("rejects unsafe media URLs and cross-tenant actors", () => {
    const draft = defaultStaffRecord(scope);
    expect(() => normalizeStaffRecord({ ...raw(draft), photoUrl: "http://example.com/avatar.jpg" }, scope))
      .toThrow(/HTTPS URL/i);
    expect(() => planStaffRecordCommand({
      request: command(raw(draft)),
      actor: { ...actor, organizationId: "org-other" },
      serverTimeISO: "2026-08-13T15:00:00.000Z"
    })).toThrow(StaffDirectoryAuthorityError);
  });

  test("creates an immutable optimistic receipt and reconciles the exact retry", () => {
    const draft = defaultStaffRecord({ ...scope, displayName: "Avery Lane" });
    const applied = planStaffRecordCommand({
      request: command(raw(draft)),
      actor,
      serverTimeISO: "2026-08-13T15:00:00.000Z"
    });

    expect(applied).toMatchObject({
      kind: "apply",
      idempotent: false,
      snapshot: { revision: 1, preferredName: "Avery Lane" },
      receipt: { priorRevision: 0, resultRevision: 1, receiptType: "staff_record_command" }
    });
    expect(Object.isFrozen(applied.receipt)).toBe(true);

    const replay = planStaffRecordCommand({
      request: command(raw(draft)),
      currentRecord: applied.nextRecord,
      actor,
      serverTimeISO: "2026-08-13T15:01:00.000Z",
      existingReceipt: applied.receipt
    });
    expect(replay).toMatchObject({ kind: "reconcile", idempotent: true, snapshot: { revision: 1 } });
  });

  test("fails stale revisions and request-id reuse with changed evidence", () => {
    const draft = defaultStaffRecord(scope);
    const applied = planStaffRecordCommand({
      request: command(raw(draft)),
      actor,
      serverTimeISO: "2026-08-13T15:00:00.000Z"
    });
    expect(() => planStaffRecordCommand({
      request: command(raw(draft)),
      currentRecord: { ...applied.nextRecord, revision: 2 },
      actor,
      serverTimeISO: "2026-08-13T15:01:00.000Z"
    })).toThrow(/changed after it was opened/i);
    expect(() => planStaffRecordCommand({
      request: command({ ...raw(draft), privateNotes: "different" }),
      currentRecord: applied.nextRecord,
      actor,
      serverTimeISO: "2026-08-13T15:01:00.000Z",
      existingReceipt: applied.receipt
    })).toThrow(/bound to different evidence/i);
  });

  test("projects stored server metadata into the exact client contract", () => {
    const draft = defaultStaffRecord(scope);
    const projected = projectStaffRecord({
      ...draft,
      revision: 4,
      updatedAtISO: "2026-08-13T15:00:00.000Z",
      updatedBy: actor,
      createdAt: { internal: true }
    }, scope);
    expect(projected).toMatchObject({ revision: 4, updatedAtISO: "2026-08-13T15:00:00.000Z" });
    expect(projected).not.toHaveProperty("updatedBy");
    expect(projected).not.toHaveProperty("createdAt");
  });
});
