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
      settings: {
        pricingConfirmation: {
          actorUid: "admin-1",
          actorEmail: "admin@example.com",
          confirmedAtISO: "2026-08-04T10:00:00.000Z",
          confirmedCatalogRevision: 4
        }
      },
      nowISO
    });
    expect(result.delivery).toMatchObject({ total: 2, retryAvailable: 1, reviewRequired: 1 });
    expect(result.sync.totals).toMatchObject({ success: 1, error: 1 });
    expect(result.sync.successRate).toBe(50);
    expect(result.roles).toEqual({ admin: 1, sales: 1, staff: 2 });
    expect(result.actions.map((row) => row.action)).toEqual([
      "convert_to_contract",
      "quote_delivery_confirmed_not_sent",
      "catalog_pricing_confirmed"
    ]);
    expect(result.actions.every((row) => row.authority === "server")).toBe(true);
  });
});
