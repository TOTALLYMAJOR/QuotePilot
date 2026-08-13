import fs from "node:fs";
import { describe, expect, test } from "vitest";

const source = fs.readFileSync(new URL("../../../functions/index.js", import.meta.url), "utf8");

function callable(name, nextName) {
  const start = source.indexOf(`exports.${name} =`);
  const end = nextName ? source.indexOf(`exports.${nextName} =`, start + 1) : source.length;
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("staff invitation runtime integration", () => {
  test("keeps preview and manual dispatch admin scoped to exact staffing evidence", () => {
    const preview = callable("previewStaffInvitation", "dispatchStaffInvitation");
    const dispatch = callable("dispatchStaffInvitation", "getStaffInvitation");
    for (const block of [preview, dispatch]) {
      expect(block).toContain("assertAdminStaff(");
      expect(block).toContain("assertOperationalStaffingSameOrganization");
      expect(block).toContain("readStaffInvitationContext");
    }
    expect(dispatch).toContain("preview.previewDigest !== suppliedPreviewDigest");
    expect(dispatch).toContain("staff-invitation:${claim.preview.invitationId}");
    expect(dispatch).toContain("provider_accepted");
    expect(dispatch).toContain("outcome_ambiguous");
    expect(dispatch).not.toContain("attendance:");
  });

  test("keeps public response token scoped and writes only invitation acknowledgement plus receipt", () => {
    const read = callable("getStaffInvitation", "respondToStaffInvitation");
    const respond = callable("respondToStaffInvitation", "getStaffDirectory");
    expect(read).toContain("verifyStaffInvitationToken");
    expect(read).toContain("staffInvitationMatchesToken");
    expect(read).not.toContain("assertStaff(context");
    expect(respond).toContain("verifyStaffInvitationToken");
    expect(respond).toContain("staffInvitationMatchesToken");
    expect(respond).toContain("recordStaffInvitationDecision");
    expect(respond).toContain('doc("acknowledgement")');
    expect(respond).toContain("staffing-plan, attendance, hours, payroll, and readiness evidence are unchanged");
    expect(respond).not.toContain("staffRecordRef");
    expect(respond).not.toContain("planRef");
  });

  test("routes the shared signed provider webhook by authority and never treats opens or clicks as acknowledgement", () => {
    const webhook = callable("revenueAutopilotResendWebhook", "reopenQuote");
    expect(webhook).toContain("new Webhook(webhookSecret).verify");
    expect(webhook).toContain("processStaffInvitationProviderEvent");
    expect(webhook).toContain('authority: "operational_staffing"');
    expect(webhook).toContain("STAFF_INVITATION_PROVIDER_MESSAGE_INDEX_COLLECTION");
    expect(webhook).toContain('"email.delivered": "delivered"');
    expect(webhook).toContain('"email.bounced": "bounced"');
    expect(webhook).toContain('"email.complained": "complained"');
    expect(webhook).toContain("engagement_event_never_establishes_acknowledgement");
    expect(webhook).toContain("provider_event_does_not_downgrade_terminal_evidence");
    expect(webhook).not.toContain('"email.opened": "');
    expect(webhook).not.toContain('"email.clicked": "');
  });
});
