import { describe, expect, test } from "vitest";
import {
  canRotateQuotePortal,
  getExecutableApprovalRequest,
  isCustomerPortalShareable,
  getQuoteDeliveryUiState,
  getQuoteHistoryActionPermissions
} from "../QuoteHistoryModal";

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
      canReopenQuote: true,
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
      canReopenQuote: false,
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
      canReopenQuote: false,
      canRotatePortalLink: false,
      canDeleteQuote: false
    });
  });

  test("portal rotation stops before terminal commercial states", () => {
    expect(canRotateQuotePortal("draft")).toBe(true);
    expect(canRotateQuotePortal("sent")).toBe(true);
    expect(canRotateQuotePortal("viewed")).toBe(true);
    for (const status of ["accepted", "declined", "booked", "expired", "deleted"]) {
      expect(canRotateQuotePortal(status)).toBe(false);
    }
  });

  test("only returns an approved action that is still awaiting execution", () => {
    const quote = {
      workflow: {
        approvalRequests: [
          { id: "pending", action: "delete_quote", state: "pending", executionState: "" },
          { id: "completed", action: "delete_quote", state: "approved", executionState: "succeeded" },
          { id: "executable", action: "delete_quote", state: "approved", executionState: "awaiting_execution" },
          { id: "other-action", action: "rotate_portal_link", state: "approved", executionState: "awaiting_execution" }
        ]
      }
    };

    expect(getExecutableApprovalRequest(quote, "delete_quote")?.id).toBe("executable");
    expect(getExecutableApprovalRequest(quote, "send_payment_request")).toBeNull();
  });
});

describe("quote delivery recovery controls", () => {
  const revisionId = "v0001@2026-08-03T18:00:00.000Z";

  function quoteWithDelivery(delivery) {
    return { workflow: { quoteDelivery: { revisionId, ...delivery } } };
  }

  test("keeps an active lease locked and exposes a safe retry after lease expiry", () => {
    const delivery = {
      state: "sending",
      firstAttemptAtISO: "2026-08-03T18:00:00.000Z",
      retryDeadlineAtISO: "2026-08-04T17:00:00.000Z",
      leaseExpiresAtISO: "2026-08-03T18:02:00.000Z"
    };
    expect(getQuoteDeliveryUiState(
      quoteWithDelivery(delivery),
      revisionId,
      Date.parse("2026-08-03T18:01:00.000Z")
    )).toMatchObject({
      mutationLocked: true,
      activeLease: true,
      retryAvailable: false,
      canAttempt: false
    });
    expect(getQuoteDeliveryUiState(
      quoteWithDelivery(delivery),
      revisionId,
      Date.parse("2026-08-03T18:03:00.000Z")
    )).toMatchObject({
      mutationLocked: true,
      activeLease: false,
      retryAvailable: true,
      reviewRequired: false,
      canAttempt: true
    });
    expect(getQuoteDeliveryUiState(
      quoteWithDelivery({
        ...delivery,
        state: "outcome_ambiguous",
        leaseExpiresAtISO: ""
      }),
      revisionId,
      Date.parse("2026-08-03T18:03:00.000Z")
    )).toMatchObject({
      mutationLocked: true,
      retryAvailable: true,
      reviewRequired: false,
      reviewAvailable: true,
      canAttempt: true
    });
  });

  test("routes expired or explicitly uncertain outcomes to audited review", () => {
    expect(getQuoteDeliveryUiState(
      quoteWithDelivery({
        state: "sending",
        retryDeadlineAtISO: "2026-08-04T17:00:00.000Z",
        leaseExpiresAtISO: "2026-08-03T18:02:00.000Z"
      }),
      revisionId,
      Date.parse("2026-08-04T17:00:01.000Z")
    )).toMatchObject({ reviewRequired: true, canAttempt: false });
    expect(getQuoteDeliveryUiState(
      quoteWithDelivery({ state: "outcome_unknown" }),
      revisionId,
      Date.parse("2026-08-03T18:03:00.000Z")
    )).toMatchObject({
      mutationLocked: true,
      reviewRequired: true,
      reviewAvailable: true,
      canAttempt: false
    });
  });

  test("unlocks a manually reconciled not-sent outcome for a fresh dispatch", () => {
    expect(getQuoteDeliveryUiState(
      quoteWithDelivery({ state: "reconciled_not_sent" }),
      revisionId,
      Date.parse("2026-08-03T18:03:00.000Z")
    )).toMatchObject({
      mutationLocked: false,
      reviewRequired: false,
      canAttempt: true
    });
  });

  test("starts a fresh delivery generation after a definite failure window closes", () => {
    expect(getQuoteDeliveryUiState(
      quoteWithDelivery({
        state: "failed",
        firstAttemptAtISO: "2026-08-03T18:00:00.000Z",
        retryDeadlineAtISO: "2026-08-04T17:00:00.000Z"
      }),
      revisionId,
      Date.parse("2026-08-04T17:00:01.000Z")
    )).toMatchObject({
      mutationLocked: false,
      reviewRequired: false,
      retryAvailable: true,
      freshAttemptAvailable: true,
      canAttempt: true
    });
  });
});

describe("customer portal sharing evidence", () => {
  const issuedAtISO = "2026-08-03T18:00:00.000Z";
  const portalKey = "portal-key-abcdefghijklmnopqrstuvwxyz";
  const quote = {
    id: "quote-a",
    status: "sent",
    activeVersionId: "v0001",
    portalKey,
    portalIssuedAtISO: issuedAtISO,
    portalExpiresAtISO: "2099-08-03T18:00:00.000Z",
    workflow: {
      quoteDelivery: {
        revisionId: `v0001@${issuedAtISO}`,
        state: "provider_accepted",
        providerMessageId: "email-accepted",
        portalActivationState: "active",
        portalKey,
        portalIssuedAtISO: issuedAtISO
      }
    }
  };

  test("requires acceptance bound to the current portal issuance", () => {
    expect(isCustomerPortalShareable(quote, { requireDeliveryEvidence: true })).toBe(true);
    expect(isCustomerPortalShareable({
      ...quote,
      portalKey: "rotated-portal-key-abcdefghijklmnopqrstuvwxyz",
      portalIssuedAtISO: "2026-08-04T18:00:00.000Z"
    }, { requireDeliveryEvidence: true })).toBe(false);
  });
});
