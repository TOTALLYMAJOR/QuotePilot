import { describe, expect, test } from "vitest";
import {
  buildQuoteHistoryController,
  buildRoleSafeQuoteActionController,
  getQuoteActionPermissions
} from "../quoteHistoryController";

describe("quote history controller seams", () => {
  test("preserves the existing admin and sales permission boundary", () => {
    expect(getQuoteActionPermissions("admin")).toMatchObject({
      canEditQuote: true,
      canSendQuoteEmail: true,
      canConvertToContract: true,
      canDeleteQuote: true
    });
    expect(getQuoteActionPermissions("sales")).toMatchObject({
      canEditQuote: true,
      canExportProposal: true,
      canSendQuoteEmail: false,
      canConvertToContract: false,
      canDeleteQuote: false
    });
    expect(getQuoteActionPermissions("customer").isStaff).toBe(false);
  });

  test("enumerates every provider, payment, booking, BEO, portal, and lifecycle controller outcome", () => {
    const controller = buildRoleSafeQuoteActionController({
      quote: { id: "quote-1", status: "accepted" },
      currentUserRole: "admin",
      source: "firebase"
    });
    expect(Object.keys(controller.actions)).toEqual([
      "edit",
      "duplicate",
      "export_proposal",
      "review_beo",
      "review_delivery",
      "open_conversation",
      "send_quote",
      "copy_artifacts",
      "copy_email",
      "copy_portal",
      "copy_payment_link",
      "copy_balance_link",
      "open_integration_recovery",
      "request_deposit",
      "request_balance",
      "reconcile_deposit",
      "reconcile_balance",
      "change_status",
      "convert_contract",
      "manage_confirmation",
      "reopen",
      "rotate_portal",
      "delete"
    ]);
    expect(Object.values(controller.actions).every((action) => action.enabled)).toBe(true);
    expect(Object.isFrozen(controller)).toBe(true);
  });

  test("fails provider-backed outcomes closed for local fallback and non-admin roles", () => {
    const localSales = buildRoleSafeQuoteActionController({
      quote: { id: "quote-1", status: "draft" },
      currentUserRole: "sales",
      source: "local"
    });
    expect(localSales.actions.edit.enabled).toBe(true);
    expect(localSales.actions.send_quote.enabled).toBe(false);
    expect(localSales.actions.request_deposit.enabled).toBe(false);
    expect(localSales.actions.rotate_portal.enabled).toBe(false);
  });

  test("splits bounded opportunities, exact Event Room selection, and role-safe actions", () => {
    const result = buildQuoteHistoryController({
      quotes: [{ id: "quote-1" }, { id: "quote-2" }],
      visibleQuoteIds: ["quote-2"],
      focusQuoteId: "quote-2",
      currentUserRole: "sales",
      source: "firebase"
    });
    expect(result.opportunities).toMatchObject({ totalCount: 2, visibleCount: 1 });
    expect(result.eventRoom).toMatchObject({ quoteId: "quote-2", visible: true, missing: false });
    expect(result.actions.quoteId).toBe("quote-2");
  });
});
