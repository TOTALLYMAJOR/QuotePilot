import { describe, expect, test } from "vitest";
import { getQuoteHistoryActionPermissions } from "../QuoteHistoryModal";

describe("quote history action permissions", () => {
  test("admin can manage quote, payment, booking, portal, and contract state", () => {
    expect(getQuoteHistoryActionPermissions("admin")).toMatchObject({
      role: "admin",
      isStaff: true,
      canEditQuote: true,
      canDuplicateQuote: true,
      canExportProposal: true,
      canSendQuoteEmail: true,
      canCopyArtifacts: true,
      canCopyPaymentLink: true,
      canSendPaymentRequest: true,
      canCreateCheckoutLink: true,
      canManageQuoteStatus: true,
      canManagePaymentStatus: true,
      canConvertToContract: true,
      canManageConfirmation: true,
      canRotatePortalLink: true,
      canDeleteQuote: true
    });
  });

  test("sales can prepare proposal artifacts without provider, payment, or booking authority", () => {
    expect(getQuoteHistoryActionPermissions("sales")).toMatchObject({
      role: "sales",
      isStaff: true,
      canEditQuote: true,
      canDuplicateQuote: true,
      canExportProposal: true,
      canSendQuoteEmail: false,
      canCopyArtifacts: true,
      canCopyPaymentLink: false,
      canSendPaymentRequest: false,
      canCreateCheckoutLink: false,
      canManageQuoteStatus: false,
      canManagePaymentStatus: false,
      canConvertToContract: false,
      canManageConfirmation: false,
      canRotatePortalLink: false,
      canDeleteQuote: false
    });
  });

  test("unknown roles get no staff actions", () => {
    expect(getQuoteHistoryActionPermissions("customer")).toMatchObject({
      role: "customer",
      isStaff: false,
      canEditQuote: false,
      canDuplicateQuote: false,
      canExportProposal: false,
      canSendQuoteEmail: false,
      canCopyArtifacts: false,
      canCopyPaymentLink: false,
      canSendPaymentRequest: false,
      canCreateCheckoutLink: false,
      canManageQuoteStatus: false,
      canManagePaymentStatus: false,
      canConvertToContract: false,
      canManageConfirmation: false,
      canRotatePortalLink: false,
      canDeleteQuote: false
    });
  });
});
