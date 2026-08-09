import fs from "node:fs";
import { describe, expect, test } from "vitest";

const FUNCTIONS_SOURCE = fs.readFileSync(
  new URL("../../../functions/index.js", import.meta.url),
  "utf8"
);

function sourceBetween(startMarker, endMarker) {
  const start = FUNCTIONS_SOURCE.indexOf(startMarker);
  const end = FUNCTIONS_SOURCE.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`Unable to locate source between ${startMarker} and ${endMarker}.`);
  }
  return FUNCTIONS_SOURCE.slice(start, end);
}

describe("Revenue Autopilot scheduler fairness contract", () => {
  test("pages enabled tenants deterministically and persists a wrap-safe cursor", () => {
    const helper = sourceBetween(
      "async function readRevenueAutopilotSchedulerTenantPage",
      "async function readRevenueAutopilotTenantWorkPage"
    );
    expect(helper).toContain('.where("enabled", "==", true)');
    expect(helper).toContain(".orderBy(FieldPath.documentId())");
    expect(helper).toContain("tenantQuery.startAfter(cursor)");
    expect(helper).toContain("if (!tenantSnap.docs.length && priorCursor)");
    expect(helper).toContain("nextCursor");

    const schedule = sourceBetween(
      "exports.runRevenueAutopilotSchedule =",
      "exports.revenueAutopilotResendWebhook ="
    );
    expect(schedule).toContain("tenantCursor: tenantPage.nextCursor");
    expect(schedule).toContain("priorTenantCursor: tenantPage.priorCursor");
    expect(schedule).toContain("wrapped: tenantPage.wrapped");
  });

  test("rotates bounded quote and job pages for every selected tenant", () => {
    const helper = sourceBetween(
      "async function readRevenueAutopilotTenantWorkPage",
      "exports.runRevenueAutopilotSchedule ="
    );
    expect(helper).toContain(".orderBy(FieldPath.documentId())");
    expect(helper).toContain("workQuery.startAfter(startCursor)");
    expect(helper).toContain("if (!snapshot.docs.length && cursor)");

    const schedule = sourceBetween(
      "exports.runRevenueAutopilotSchedule =",
      "exports.revenueAutopilotResendWebhook ="
    );
    expect(schedule).toContain("const perTenantQuoteLimit = 10");
    expect(schedule).toContain("const perTenantDispatchLimit = 4");
    expect(schedule).toContain("schedulerQuoteCursor: quotePage.nextCursor");
    expect(schedule).toContain("schedulerJobCursor: jobPage.nextCursor");
    expect(schedule).not.toContain("remainingQuoteBudget");
    expect(schedule).not.toContain("remainingDispatchBudget");
  });

  test("binds the post-event review lane to private closeout authority without portal-expiry coupling", () => {
    const executionAuthority = sourceBetween(
      "async function readRevenueAutopilotExecutionAuthority",
      "async function dispatchRevenueAutopilotJob"
    );
    expect(executionAuthority).toContain("quote.workflow?.postEventCloseout?.closeoutId");
    expect(executionAuthority).toContain("collection(POST_EVENT_CLOSEOUTS_COLLECTION)");
    expect(executionAuthority).toContain("canonical.postEventCloseout =");
    expect(executionAuthority).toContain(
      'new Set(["deposit_reminder", "final_balance_reminder"]).has(kind)'
    );
    const dispatch = sourceBetween(
      "async function dispatchRevenueAutopilotJob",
      "async function materializeScheduledRevenueAutopilotQuote"
    );
    expect(dispatch).toContain(
      'ignorePortalExpiry: jobKind === "post_event_review_request"'
    );

    const scheduledMaterialization = sourceBetween(
      "async function materializeScheduledRevenueAutopilotQuote",
      "function throwDecisionDebtFailure"
    );
    expect(scheduledMaterialization).toContain(
      'normalizeText(snapshot.data()?.kind).toLowerCase() !== "post_event_review_request"'
    );
    expect(scheduledMaterialization).toContain(
      'if (portalExpired && kind !== "post_event_review_request") continue;'
    );
    expect(scheduledMaterialization).toContain('"post_event_review_request"');
    expect(scheduledMaterialization).toContain("reviewUrl: policy.reviewRequestUrl");

    const staffMaterialization = sourceBetween(
      "exports.materializeRevenueAutopilotJobs =",
      "exports.acknowledgeRevenueAutopilotReply ="
    );
    expect(staffMaterialization).toContain("tx.get(closeoutRef)");
    expect(staffMaterialization).toContain("canonicalBase.postEventCloseout =");
    expect(staffMaterialization).toContain(
      'if (portalExpired && kind !== "post_event_review_request")'
    );
    expect(staffMaterialization).toContain("reviewUrl: policy.reviewRequestUrl");
  });
});
