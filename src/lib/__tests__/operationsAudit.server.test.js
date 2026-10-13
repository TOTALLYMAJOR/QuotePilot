import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const { buildOperationsAuditSnapshot } = require("../../../functions/operationsAudit.js");

describe("operations audit snapshot", () => {
  test("summarizes delivery retry/review states, sync trend, roles, and server actions", () => {
    const nowISO = "2026-08-06T18:00:00.000Z";
    const quotes = [
      {
        id: "quote-1",
        quoteNumber: "QP-1",
        workflow: {
          quoteDelivery: {
            state: "outcome_ambiguous",
            retryDeadlineAtISO: "2026-08-06T19:00:00.000Z"
          }
        },
        integrations: { logs: [{ state: "error", occurredAtISO: "2026-08-06T12:00:00.000Z" }] }
      },
      {
        id: "quote-2",
        quoteNumber: "QP-2",
        workflow: {
          quoteDelivery: {
            state: "outcome_unknown",
            lastResolution: {
              resolution: "confirmed_not_sent",
              resolvedAtISO: "2026-08-06T16:00:00.000Z",
              actorUid: "admin-1",
              actorEmail: "admin@example.com"
            }
          }
        },
        integrations: { logs: [{ state: "success", occurredAtISO: "2026-08-05T12:00:00.000Z" }] }
      }
    ];
    const result = buildOperationsAuditSnapshot({
      quotes,
      executions: [{
        id: "execution-1",
        approvalRequestId: "approval-1",
        quoteId: "quote-1",
        action: "convert_to_contract",
        state: "succeeded",
        completedAtISO: "2026-08-06T17:00:00.000Z",
        executedBy: { email: "admin@example.com", role: "admin" }
      }],
      roles: [
        { uid: "admin-1", role: "admin" },
        { uid: "sales-1", role: "sales" }
      ],
      roleAuthorityReceipts: [{
        schemaVersion: 1,
        requestId: "role-authority-request-0001",
        organizationId: "org-a",
        actorUid: "private-owner-uid",
        actorEmail: "OWNER@EXAMPLE.COM",
        actorWasOwner: true,
        targetUid: "private-target-uid",
        targetEmail: "STAFF@EXAMPLE.COM",
        previousRole: "sales",
        nextRole: "admin",
        changedAtISO: "2026-08-06T17:30:00.000Z",
        authenticatedAtISO: "2026-08-06T17:29:00.000Z",
        appCheckAppId: "private-app-id"
      }],
      resendAcceptanceReceipts: [{
        schemaVersion: 1,
        requestId: `email_test_${"a".repeat(32)}`,
        organizationId: "org-a",
        recipientEmail: "flightcontrol@quietpilot.us",
        state: "provider_accepted",
        requestedAtISO: "2026-08-06T17:44:59.000Z",
        acceptedAtISO: "2026-08-06T17:45:00.000Z",
        actorEmail: "owner@example.com",
        actorUid: "private-email-test-actor",
        providerMessageId: "private-provider-message-id"
      }],
      settings: {
        pricingConfirmation: {
          actorUid: "admin-1",
          actorEmail: "admin@example.com",
          confirmedAtISO: "2026-08-04T10:00:00.000Z",
          confirmedCatalogRevision: 4
        }
      },
      organizationId: "org-a",
      nowISO
    });
    expect(result.delivery).toMatchObject({ total: 2, retryAvailable: 1, reviewRequired: 1 });
    expect(result.sync.totals).toMatchObject({ success: 1, error: 1 });
    expect(result.sync.successRate).toBe(50);
    expect(result.roles).toEqual({ admin: 1, sales: 1, staff: 2 });
    expect(result.actions.map((row) => row.action)).toEqual([
      "resend_acceptance_test",
      "organization_role_changed",
      "convert_to_contract",
      "quote_delivery_confirmed_not_sent",
      "catalog_pricing_confirmed"
    ]);
    expect(result.security).toMatchObject({
      taxonomyVersion: 2,
      receiptBackedActionCount: 3,
      legacyObservationCount: 2,
      storageRetention: "indefinite_server_record",
      clearPolicy: "not_available",
      exportPolicy: "not_available",
      privacy: "bounded_projection"
    });
    expect(result.actions.slice(0, 3).every((row) => row.authority === "server_receipt")).toBe(true);
    expect(result.actions.slice(3).every((row) => row.authority === "server_projection")).toBe(true);
    expect(JSON.stringify(result.actions)).not.toMatch(
      /private-owner-uid|private-target-uid|private-app-id|private-email-test-actor|private-provider-message-id|authenticatedAtISO/
    );
  });

  test("deduplicates replayed receipts, drops cross-tenant rows, retains failed executions, and bounds projection", () => {
    const roleAuthorityReceipts = Array.from({ length: 55 }, (_, index) => ({
      schemaVersion: 1,
      requestId: `role-request-${String(index).padStart(3, "0")}`,
      organizationId: "org-a",
      actorEmail: "owner@example.com",
      actorWasOwner: true,
      targetEmail: `staff-${index}@example.com`,
      previousRole: "sales",
      nextRole: "admin",
      changedAtISO: new Date(Date.parse("2026-08-06T18:00:00.000Z") - index * 1000).toISOString()
    }));
    roleAuthorityReceipts.push(
      { ...roleAuthorityReceipts[0] },
      { ...roleAuthorityReceipts[1], requestId: "foreign", organizationId: "org-b" }
    );
    const result = buildOperationsAuditSnapshot({
      organizationId: "org-a",
      roleAuthorityReceipts,
      executions: [{
        approvalRequestId: "failed-approval",
        action: "hard_delete_quote",
        state: "failed",
        quoteId: "quote-1",
        completedAtISO: "2026-08-06T18:01:00.000Z",
        executedBy: { role: "admin", email: "admin@example.com" }
      }],
      nowISO: "2026-08-06T18:02:00.000Z"
    });

    expect(result.security.receiptBackedActionCount).toBe(56);
    expect(result.actions).toHaveLength(50);
    expect(result.actions[0]).toMatchObject({
      action: "hard_delete_quote",
      state: "failed",
      evidenceClass: "immutable_receipt"
    });
    expect(result.actions.some((row) => row.id === "role:foreign")).toBe(false);
    expect(result.actions.filter((row) => row.id === "role:role-request-000")).toHaveLength(1);
  });
});
