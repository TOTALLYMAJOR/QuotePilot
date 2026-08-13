import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  STAFF_INVITATION_AUTHORITY_VERSION,
  buildStaffInvitationPreview,
  buildStaffInvitationToken,
  hashStaffInvitationToken,
  recordStaffInvitationDecision,
  verifyStaffInvitationToken
} = require("../../../functions/staffInvitationAuthority.js");

const scope = Object.freeze({
  organizationId: "org-alpha",
  quoteId: "quote-alpha",
  quoteRevisionId: "version-7",
  planRevision: 3,
  assignmentId: "assignment-avery",
  staffId: "staff-avery",
  recordRevision: 2
});
const staffRecord = Object.freeze({
  preferredName: "Avery",
  contact: {
    email: "AVERY@example.com",
    communicationsEnabled: true,
    emailStatus: "verified"
  }
});
const assignment = Object.freeze({
  role: "server",
  eventWindow: { startAtISO: "2026-08-18T20:00:00.000Z" },
  event: {
    name: "Smith Wedding",
    date: "2026-08-18",
    time: "4:00 PM",
    venue: "The Glass House",
    venueAddress: "100 Event Way",
    guests: 120
  },
  selection: { packageName: "Evening celebration" }
});
const secret = "staff-invitation-test-secret-that-is-at-least-32-bytes";

function preview() {
  return buildStaffInvitationPreview({ scope, staffRecord, assignment, organizationName: "Smith Catering" });
}

describe("staff invitation authority", () => {
  test("builds one exact, private-email preview without overstating its consequence", () => {
    const result = preview();
    expect(result).toMatchObject({
      authorityVersion: STAFF_INVITATION_AUTHORITY_VERSION,
      recipient: { email: "avery@example.com", name: "Avery" },
      event: { name: "Smith Wedding", guests: 120 },
      role: "server"
    });
    expect(result.textWithoutResponseLink).toContain("attendance, payroll, or event completion");
    expect(result.doNothing).toContain("Nothing is sent");
    expect(result.previewDigest).toMatch(/^[a-f0-9]{64}$/u);
  });

  test("requires verified enabled private contact evidence", () => {
    expect(() => buildStaffInvitationPreview({
      scope,
      staffRecord: { ...staffRecord, contact: { ...staffRecord.contact, emailStatus: "unverified" } },
      assignment
    })).toThrow(/verify the staff email/i);
    expect(() => buildStaffInvitationPreview({
      scope,
      staffRecord: { ...staffRecord, contact: { ...staffRecord.contact, communicationsEnabled: false } },
      assignment
    })).toThrow(/communications are disabled/i);
  });

  test("signs the exact invitation scope and rejects tampering and expiry", () => {
    const result = preview();
    const token = buildStaffInvitationToken({
      preview: result,
      secret,
      issuedAtISO: "2026-08-13T15:00:00.000Z",
      expiresAtISO: "2026-08-18T19:00:00.000Z"
    });
    expect(verifyStaffInvitationToken(token, secret, { nowISO: "2026-08-14T15:00:00.000Z" }))
      .toMatchObject({ ...scope, invitationId: result.invitationId, previewDigest: result.previewDigest });
    expect(hashStaffInvitationToken(token)).toMatch(/^[a-f0-9]{64}$/u);
    expect(() => verifyStaffInvitationToken(`${token}x`, secret, { nowISO: "2026-08-14T15:00:00.000Z" }))
      .toThrow(/invalid/i);
    expect(() => verifyStaffInvitationToken(token, secret, { nowISO: "2026-08-19T15:00:00.000Z" }))
      .toThrow(/expired/i);
  });

  test("records one immutable accept or decline acknowledgement without attendance authority", () => {
    const base = {
      invitationId: preview().invitationId,
      ...scope,
      role: "server",
      state: "delivered",
      expiresAtISO: "2026-08-18T19:00:00.000Z",
      acknowledgement: { state: "pending", respondedAtISO: "", declineReason: "" }
    };
    const accepted = recordStaffInvitationDecision({
      invitation: base,
      decision: "accepted",
      nowISO: "2026-08-14T15:00:00.000Z"
    });
    expect(accepted).toEqual({
      idempotent: false,
      acknowledgement: { state: "accepted", respondedAtISO: "2026-08-14T15:00:00.000Z", declineReason: "" }
    });
    const replay = recordStaffInvitationDecision({
      invitation: { ...base, acknowledgement: accepted.acknowledgement },
      decision: "accepted",
      nowISO: "2026-08-14T15:01:00.000Z"
    });
    expect(replay.idempotent).toBe(true);
    expect(() => recordStaffInvitationDecision({
      invitation: { ...base, acknowledgement: accepted.acknowledgement },
      decision: "declined",
      nowISO: "2026-08-14T15:01:00.000Z"
    })).toThrow(/already accepted/i);
  });
});
