import { describe, expect, test } from "vitest";
import {
  buildRoleSafeQuoteActionController,
  getQuoteActionPermissions
} from "../quoteHistoryController";
import { compileConfiguredQuoteActions } from "../quoteActionState";

const FUTURE_PORTAL_EXPIRY = "2099-09-03T12:00:00.000Z";

function providerAcceptedDelivery(overrides = {}) {
  return {
    revisionId: "v0001@2099-08-03T12:00:00.000Z",
    state: "provider_accepted",
    portalActivationState: "active",
    providerMessageId: "provider-message-1",
    providerAcceptedAtISO: "2099-08-03T12:01:00.000Z",
    ...overrides
  };
}

function approval(action, overrides = {}) {
  return {
    id: `${action}-approval`,
    action,
    state: "approved",
    executionState: "awaiting_execution",
    ...overrides
  };
}

function quote(status = "draft", overrides = {}) {
  const workflow = overrides.workflow || {};
  return {
    id: "quote-1",
    quoteNumber: "Q-1",
    status,
    activeVersionId: "v0001",
    latestVersionNumber: 1,
    portalKey: "portal-key-abcdefghijklmnopqrstuvwxyz",
    portalIssuedAtISO: "2099-08-03T12:00:00.000Z",
    portalExpiresAtISO: FUTURE_PORTAL_EXPIRY,
    totals: { total: 1000, deposit: 250 },
    customer: { name: "Avery", email: "avery@example.com" },
    payment: {
      depositStatus: "unpaid",
      depositConfirmedAtISO: "",
      finalBalance: {
        amountCents: 75000,
        status: "unpaid"
      }
    },
    booking: {
      contractNumber: "",
      contractConvertedAtISO: "",
      confirmationStatus: "pending"
    },
    ...overrides,
    workflow: {
      ...workflow,
      approvalRequests: Array.isArray(workflow.approvalRequests)
        ? workflow.approvalRequests
        : []
    }
  };
}

function controller(currentQuote, role = "admin", source = "firebase") {
  return buildRoleSafeQuoteActionController({
    quote: currentQuote,
    currentUserRole: role,
    source
  });
}

describe("configured quote action state", () => {
  test("makes tracked proposal delivery the primary action for a saved draft", () => {
    const result = controller(quote("draft")).actionState;

    expect(result.primaryAction).toMatchObject({
      id: "send_quote",
      label: "Send proposal",
      enabled: true,
      presentation: "primary_candidate"
    });
    expect(result.actions.edit.label).toBe("Edit draft");
    expect(result.actions.duplicate).toMatchObject({
      label: "Create alternate draft",
      requiresConfirmation: true,
      enabled: true
    });
  });

  test("describes a sent quote change as revision rather than in-place editing", () => {
    const result = controller(quote("sent", {
      workflow: { quoteDelivery: providerAcceptedDelivery() }
    })).actionState;

    expect(result.actions.edit).toMatchObject({
      label: "Revise quote",
      enabled: true
    });
    expect(result.actions.edit.consequence).toMatch(/new draft version/i);
    expect(result.actions.send_quote.visible).toBe(false);
    expect(result.evidence.delivery.state).toBe("provider_accepted");
    expect(result.primaryAction?.id).toBe("open_conversation");
  });

  test("does not treat provider acceptance for an older revision as current delivery evidence", () => {
    const result = controller(quote("draft", {
      activeVersionId: "v0002",
      latestVersionNumber: 2,
      workflow: { quoteDelivery: providerAcceptedDelivery() }
    })).actionState;

    expect(result.state.providerAccepted).toBe(false);
    expect(result.evidence.delivery.state).toBe("not_recorded");
    expect(result.actions.send_quote).toMatchObject({
      visible: true,
      enabled: true,
      label: "Send proposal"
    });
    expect(result.primaryAction?.id).toBe("send_quote");
  });

  test("recovery overrides routine quote-changing actions when delivery is uncertain", () => {
    const result = controller(quote("sent", {
      workflow: {
        quoteDelivery: {
          revisionId: "v0001@2099-08-03T12:00:00.000Z",
          state: "outcome_unknown"
        }
      }
    })).actionState;

    expect(result.primaryAction).toMatchObject({
      id: "review_delivery",
      label: "Resolve delivery outcome",
      presentation: "recovery",
      enabled: true
    });
    expect(result.actions.edit.enabled).toBe(false);
    expect(result.actions.duplicate.enabled).toBe(false);
    expect(result.actions.duplicate.disabledReason).toMatch(/resolve.*delivery/i);
  });

  test("defaults accepted progression to the existing contract-first presentation policy", () => {
    const currentQuote = quote("accepted", {
      workflow: {
        quoteDelivery: providerAcceptedDelivery(),
        approvalRequests: [
          approval("convert_to_contract"),
          approval("send_payment_request")
        ]
      }
    });
    const result = controller(currentQuote).actionState;

    expect(result.acceptedProgressionPolicy).toBe("contract_first");
    expect(result.primaryAction).toMatchObject({
      id: "convert_contract",
      label: "Create contract",
      enabled: true
    });
    expect(result.actions.request_deposit.enabled).toBe(true);
  });

  test("supports deposit-first ranking without changing either underlying authority", () => {
    const currentQuote = quote("accepted", {
      workflow: {
        quoteDelivery: providerAcceptedDelivery(),
        approvalRequests: [
          approval("convert_to_contract"),
          approval("send_payment_request")
        ]
      }
    });
    const base = controller(currentQuote);
    const result = compileConfiguredQuoteActions({
      quote: currentQuote,
      baseActions: base.actions,
      source: "firebase",
      acceptedProgressionPolicy: "deposit_first"
    });

    expect(result.primaryAction?.id).toBe("request_deposit");
    expect(result.actions.convert_contract.enabled).toBe(true);
    expect(result.actions.request_deposit.enabled).toBe(true);
  });

  test("ranks deposit collection before normal booked-event secondary actions", () => {
    const result = controller(quote("booked", {
      booking: {
        contractNumber: "C-1",
        contractConvertedAtISO: "2099-08-03T12:05:00.000Z",
        confirmationStatus: "pending"
      },
      workflow: {
        quoteDelivery: providerAcceptedDelivery(),
        approvalRequests: [approval("send_payment_request")]
      }
    })).actionState;

    expect(result.primaryAction).toMatchObject({
      id: "request_deposit",
      label: "Request deposit",
      enabled: true
    });
    expect(result.actions.manage_confirmation.label).toBe("Record customer confirmation");
    expect(result.actions.manage_confirmation.consequence).toMatch(/does not send/i);
  });

  test("ranks final-balance collection only after contract and paid-deposit evidence", () => {
    const result = controller(quote("booked", {
      payment: {
        depositStatus: "paid",
        depositConfirmedAtISO: "2099-08-03T12:10:00.000Z",
        stripeSessionId: "cs_test_deposit",
        finalBalance: {
          amountCents: 75000,
          status: "unpaid"
        }
      },
      booking: {
        contractNumber: "C-1",
        contractConvertedAtISO: "2099-08-03T12:05:00.000Z",
        confirmationStatus: "pending"
      },
      workflow: {
        quoteDelivery: providerAcceptedDelivery(),
        approvalRequests: [approval("send_final_balance_request")]
      }
    })).actionState;

    expect(result.state.finalBalanceDue).toBe(true);
    expect(result.primaryAction).toMatchObject({
      id: "request_balance",
      label: "Request final balance",
      enabled: true
    });
  });

  test("restores an expired quote through an explicit draft outcome", () => {
    const result = controller(quote("expired", {
      portalExpiresAtISO: "2020-01-01T00:00:00.000Z"
    })).actionState;

    expect(result.primaryAction).toMatchObject({
      id: "reopen",
      label: "Restore as draft",
      enabled: true
    });
  });

  test("keeps provider-outcome resolution admin-only because it mutates audited delivery evidence", () => {
    expect(getQuoteActionPermissions("admin").canReviewDelivery).toBe(true);
    expect(getQuoteActionPermissions("sales").canReviewDelivery).toBe(false);

    const sales = controller(quote("sent", {
      workflow: {
        quoteDelivery: {
          revisionId: "v0001@2099-08-03T12:00:00.000Z",
          state: "outcome_unknown"
        }
      }
    }), "sales").actionState;
    expect(sales.actions.review_delivery.visible).toBe(false);
    expect(sales.primaryAction).toBeNull();
  });
});
