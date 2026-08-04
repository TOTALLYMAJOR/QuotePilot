import { describe, expect, test } from "vitest";
import {
  canRotateQuotePortal,
  getFinalBalanceDisplayStatus,
  getExecutableApprovalRequest,
  isCustomerPortalShareable,
  isFinalBalanceRequestEligible,
  getQuoteDeliveryUiState,
  getQuoteHistoryActionPermissions
} from "../QuoteHistoryModal";

describe("quote history action permissions", () => {
  test("admin can manage quote, payment requests, booking, portal, and contract state", () => {
    expect(getQuoteHistoryActionPermissions("admin")).toMatchObject({
      role: "admin",
      isStaff: true,
      canEditQuote: true,
      canDuplicateQuote: true,
      canExportProposal: true,
      canSendQuoteEmail: true,
      canCopyArtifacts: true,
      canCopyPaymentLink: true,
      canCopyFinalBalanceLink: true,
      canSendPaymentRequest: true,
      canSendFinalBalanceRequest: true,
      canReconcilePayment: true,
      canReconcileFinalBalance: true,
      canManageQuoteStatus: true,
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
      canCopyFinalBalanceLink: false,
      canSendPaymentRequest: false,
      canSendFinalBalanceRequest: false,
      canReconcilePayment: false,
      canReconcileFinalBalance: false,
      canManageQuoteStatus: false,
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
      canCopyFinalBalanceLink: false,
      canSendPaymentRequest: false,
      canSendFinalBalanceRequest: false,
      canReconcilePayment: false,
      canReconcileFinalBalance: false,
      canManageQuoteStatus: false,
      canConvertToContract: false,
      canManageConfirmation: false,
      canReopenQuote: false,
      canRotatePortalLink: false,
      canDeleteQuote: false
    });
  });

  test("no browser role receives authority to mutate provider payment evidence", () => {
    for (const role of ["admin", "sales", "customer", "unknown"]) {
      expect(getQuoteHistoryActionPermissions(role)).not.toHaveProperty("canManagePaymentStatus");
      expect(getQuoteHistoryActionPermissions(role)).not.toHaveProperty("canCreateCheckoutLink");
    }
  });

  test("portal rotation includes booked renewal but excludes other terminal states", () => {
    expect(canRotateQuotePortal("draft")).toBe(true);
    expect(canRotateQuotePortal("sent")).toBe(true);
    expect(canRotateQuotePortal("viewed")).toBe(true);
    expect(canRotateQuotePortal("booked")).toBe(true);
    for (const status of ["accepted", "declined", "expired", "deleted"]) {
      expect(canRotateQuotePortal(status)).toBe(false);
    }
  });

  test("renders provider substates without widening the stored balance status", () => {
    expect(getFinalBalanceDisplayStatus({
      status: "sent",
      stripeCheckoutState: "processing"
    })).toBe("processing");
    expect(getFinalBalanceDisplayStatus({
      status: "unpaid",
      stripeCheckoutState: "failed"
    })).toBe("failed");
    expect(getFinalBalanceDisplayStatus({
      status: "unpaid",
      stripeCheckoutState: "expired"
    })).toBe("expired");
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

  test("allows an approved payment request to resume after an interrupted execution", () => {
    const quote = {
      workflow: {
        approvalRequests: [
          {
            id: "payment-in-progress",
            action: "send_payment_request",
            state: "approved",
            executionState: "in_progress",
            actionScope: { paymentKind: "deposit", amountCents: 12500 },
            actionScopeDigest: "a".repeat(64)
          }
        ]
      }
    };

    expect(getExecutableApprovalRequest(quote, "send_payment_request")?.id)
      .toBe("payment-in-progress");
  });

  test("allows an approved final-balance request to resume after an interrupted execution", () => {
    const quote = {
      workflow: {
        approvalRequests: [
          {
            id: "final-balance-in-progress",
            action: "send_final_balance_request",
            state: "approved",
            executionState: "in_progress",
            actionScope: { paymentKind: "final_balance", amountCents: 37500 },
            actionScopeDigest: "b".repeat(64)
          }
        ]
      }
    };

    expect(getExecutableApprovalRequest(quote, "send_final_balance_request")?.id)
      .toBe("final-balance-in-progress");
  });

  test("does not execute payment approvals after their exact server scope is lost", () => {
    const quote = {
      workflow: {
        approvalRequests: [{
          id: "unscoped-final-balance",
          action: "send_final_balance_request",
          state: "approved",
          executionState: "awaiting_execution"
        }]
      }
    };

    expect(getExecutableApprovalRequest(quote, "send_final_balance_request")).toBeNull();
  });

  test("requires booked contract and provider-paid deposit evidence for final-balance controls", () => {
    const eligible = {
      status: "booked",
      booking: {
        contractNumber: "C-260804-12345",
        contractConvertedAtISO: "2026-08-04T14:30:00.000Z"
      },
      payment: {
        depositStatus: "paid",
        stripeSessionId: "cs_test_deposit_123",
        depositConfirmedAtISO: "2026-08-04T14:00:00.000Z",
        finalBalance: {
          amountCents: 37500,
          status: "unpaid"
        }
      }
    };

    expect(isFinalBalanceRequestEligible(eligible)).toBe(true);
    expect(isFinalBalanceRequestEligible({ ...eligible, status: "accepted" })).toBe(false);
    expect(isFinalBalanceRequestEligible({
      ...eligible,
      booking: { ...eligible.booking, contractNumber: "" }
    })).toBe(false);
    expect(isFinalBalanceRequestEligible({
      ...eligible,
      payment: { ...eligible.payment, depositStatus: "sent" }
    })).toBe(false);
    expect(isFinalBalanceRequestEligible({
      ...eligible,
      payment: {
        ...eligible.payment,
        finalBalance: { ...eligible.payment.finalBalance, status: "paid" }
      }
    })).toBe(false);
  });

  test("does not resume in-progress execution for non-payment approval actions", () => {
    const quote = {
      workflow: {
        approvalRequests: [
          {
            id: "contract-in-progress",
            action: "convert_to_contract",
            state: "approved",
            executionState: "in_progress"
          }
        ]
      }
    };

    expect(getExecutableApprovalRequest(quote, "convert_to_contract")).toBeNull();
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
