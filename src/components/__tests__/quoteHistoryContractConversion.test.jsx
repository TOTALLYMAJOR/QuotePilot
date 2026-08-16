import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import {
  ContractConversionMutationStatus,
  beginContractConversionAttempt,
  buildContractConversionMutationPresentation,
  buildQuoteHistoryCloseGuard,
  canOpenQuoteConversation,
  createContractConversionMutationState,
  getContractConversionMutationState,
  isDefinitiveContractConversionError,
  quoteHistoryCloseBlockedByConversation,
  reduceContractConversionMutationState,
  resolveFocusedConversationQuote,
  recoverContractConversionFromCanonicalHistory,
  shouldRenderQuoteHistory,
  shouldRestoreBlockedQuoteHistoryRoute
} from "../QuoteHistoryModal";

function renderContractConversionState(props) {
  const presentation = buildContractConversionMutationPresentation(props);
  return renderToStaticMarkup(
    <ContractConversionMutationStatus presentation={presentation} showReady />
  );
}

describe("Quote History contract conversion presentation", () => {
  test("renders contract conversion ready, submitting, uncertain, reconciliation, receipt, error, and recovery states", () => {
    const readyHtml = renderContractConversionState({ phase: "ready", approvalReady: true });
    const submittingHtml = renderContractConversionState({ phase: "submitting" });
    const uncertainHtml = renderContractConversionState({
      phase: "uncertain",
      error: "Connection closed before the trusted receipt returned."
    });
    const reconciliationHtml = renderContractConversionState({ phase: "reconciliation" });
    const receiptHtml = renderContractConversionState({
      phase: "receipt",
      receipt: {
        contractNumber: "C-260809-0042",
        status: "booked",
        versionNumber: 4
      }
    });
    const errorHtml = renderContractConversionState({
      phase: "error",
      error: "Only accepted quotes can be converted to a contract."
    });
    const recoveryHtml = renderContractConversionState({ phase: "recovery" });

    expect(readyHtml).toContain('data-capability-state="ready"');
    expect(submittingHtml).toContain('data-capability-state="submitting"');
    expect(uncertainHtml).toContain('data-capability-state="uncertain"');
    expect(reconciliationHtml).toContain('data-capability-state="reconciliation"');
    expect(receiptHtml).toContain('data-capability-state="receipt"');
    expect(errorHtml).toContain('data-capability-state="error"');
    expect(recoveryHtml).toContain('data-capability-state="recovery"');
    expect(readyHtml).toContain("No conversion request has been submitted");
    expect(submittingHtml).toContain("Waiting for the trusted conversion receipt");
    expect(uncertainHtml).toContain("same approved request");
    expect(reconciliationHtml).toContain("same approval request identity");
    expect(receiptHtml).toContain("contract C-260809-0042");
    expect(receiptHtml).toContain("quote status booked");
    expect(receiptHtml).not.toContain("payment received");
    expect(receiptHtml).not.toContain("customer confirmed");
    expect(receiptHtml).not.toContain("operationally ready");
    expect(errorHtml).toContain("No contract or status change is assumed");
    expect(recoveryHtml).toContain("reloading the authoritative quote");
  });

  test("distinguishes customer acceptance from internal conversion authorization", () => {
    const awaitingAuthorizationHtml = renderContractConversionState({
      phase: "ready",
      approvalReady: false,
      customerAccepted: true
    });
    const authorizedHtml = renderContractConversionState({
      phase: "ready",
      approvalReady: true,
      customerAccepted: true
    });

    expect(awaitingAuthorizationHtml).toContain("Customer accepted");
    expect(awaitingAuthorizationHtml).toContain("separate administrator authorization");
    expect(authorizedHtml).toContain("Internal conversion authorized");
    expect(authorizedHtml).toContain("separate records");
  });

  test("preserves the exact approval request identity across uncertain reconciliation", () => {
    const submitting = beginContractConversionAttempt({
      currentState: createContractConversionMutationState("quote-42"),
      quoteId: "quote-42",
      approvalRequestId: "approval-contract-42",
      requiresApproval: true
    });
    const uncertain = {
      ...submitting,
      phase: "uncertain",
      error: "Network connection ended before the receipt returned."
    };
    const reconciliation = beginContractConversionAttempt({
      currentState: uncertain,
      quoteId: "quote-42",
      approvalRequestId: "approval-contract-different",
      requiresApproval: true,
      reconcile: true
    });

    expect(submitting.approvalRequestId).toBe("approval-contract-42");
    expect(reconciliation.phase).toBe("reconciliation");
    expect(reconciliation.approvalRequestId).toBe("approval-contract-42");
  });

  test("keeps independent uncertain conversion identities for multiple quote rows", () => {
    const quoteA = {
      phase: "uncertain",
      quoteId: "quote-a",
      approvalRequestId: "approval-a",
      requiresApproval: true,
      error: "Receipt unavailable.",
      receipt: null
    };
    const quoteB = {
      phase: "submitting",
      quoteId: "quote-b",
      approvalRequestId: "approval-b",
      requiresApproval: true,
      error: "",
      receipt: null
    };
    const states = reduceContractConversionMutationState(
      reduceContractConversionMutationState({}, quoteA),
      quoteB
    );

    expect(getContractConversionMutationState(states, "quote-a")).toMatchObject({
      phase: "uncertain",
      approvalRequestId: "approval-a"
    });
    expect(getContractConversionMutationState(states, "quote-b")).toMatchObject({
      phase: "submitting",
      approvalRequestId: "approval-b"
    });
    expect(getContractConversionMutationState(states, "quote-c"))
      .toEqual(createContractConversionMutationState("quote-c"));
  });

  test("forces the quote conversation to close before the Quotes surface can unmount it", () => {
    expect(quoteHistoryCloseBlockedByConversation({ id: "quote-42" })).toBe(true);
    expect(quoteHistoryCloseBlockedByConversation(null)).toBe(false);
    expect(canOpenQuoteConversation({ id: "quote-42" })).toBe(false);
    expect(canOpenQuoteConversation(null)).toBe(true);

    const closeGuard = buildQuoteHistoryCloseGuard({
      conversationQuote: { id: "quote-42" }
    });
    expect(closeGuard).toMatchObject({
      blocked: true,
      reason: "conversation",
      quoteId: "quote-42"
    });
    expect(shouldRestoreBlockedQuoteHistoryRoute({ open: false, closeGuard })).toBe(true);
    expect(shouldRenderQuoteHistory({ open: false, closeGuard })).toBe(true);
    expect(shouldRenderQuoteHistory({ open: false, closeGuard: { blocked: false } })).toBe(false);
  });

  test("opens only the exact focused quote conversation and never replaces an active thread", () => {
    const quotes = [{ id: "quote-41" }, { id: "quote-42" }];
    expect(resolveFocusedConversationQuote({
      focusAction: "conversation",
      focusQuoteId: "quote-42",
      quotes
    })).toBe(quotes[1]);
    expect(resolveFocusedConversationQuote({
      focusAction: "send_payment_request",
      focusQuoteId: "quote-42",
      quotes
    })).toBeNull();
    expect(resolveFocusedConversationQuote({
      focusAction: "conversation",
      focusQuoteId: "quote-42",
      quotes,
      conversationQuote: quotes[0]
    })).toBeNull();
  });

  test("preserves every unresolved contract-conversion identity across route-close attempts", () => {
    for (const phase of ["submitting", "uncertain", "reconciliation", "recovery"]) {
      const closeGuard = buildQuoteHistoryCloseGuard({
        contractConversions: {
          "quote-42": {
            phase,
            quoteId: "quote-42",
            approvalRequestId: "approval-contract-42",
            requiresApproval: true
          }
        }
      });
      expect(closeGuard).toMatchObject({
        blocked: true,
        reason: "contract_conversion",
        quoteId: "quote-42"
      });
      expect(shouldRestoreBlockedQuoteHistoryRoute({ open: false, closeGuard })).toBe(true);
    }

    for (const phase of ["ready", "error", "receipt"]) {
      const closeGuard = buildQuoteHistoryCloseGuard({
        contractConversions: {
          "quote-42": { phase, quoteId: "quote-42" }
        }
      });
      expect(closeGuard.blocked).toBe(false);
      expect(shouldRestoreBlockedQuoteHistoryRoute({ open: false, closeGuard })).toBe(false);
    }
  });

  test("separates definitive conversion rejection from an uncertain dispatched outcome", () => {
    for (const code of [
      "functions/invalid-argument",
      "failed-precondition",
      "permission-denied",
      "unauthenticated"
    ]) {
      expect(isDefinitiveContractConversionError({ code })).toBe(true);
    }
    expect(isDefinitiveContractConversionError({
      message: "This quote is already converted to a contract."
    })).toBe(true);
    expect(isDefinitiveContractConversionError({ code: "functions/unavailable" })).toBe(false);
    expect(isDefinitiveContractConversionError({
      message: "Network connection ended before the receipt returned."
    })).toBe(false);
    expect(isDefinitiveContractConversionError({
      message: "Trusted contract conversion returned an invalid response."
    })).toBe(false);
  });

  test("refreshes canonical history during recovery and returns a safe ready or receipt state", async () => {
    const confirmedRefresh = vi.fn().mockResolvedValue({
      source: "firebase",
      quotes: [{
        id: "quote-42",
        status: "booked",
        latestVersionNumber: 4,
        booking: { contractNumber: "C-260809-0042" }
      }]
    });
    const readyRefresh = vi.fn().mockResolvedValue({
      source: "firebase",
      quotes: [{
        id: "quote-42",
        status: "accepted",
        booking: { contractNumber: "" }
      }]
    });

    const receiptState = await recoverContractConversionFromCanonicalHistory({
      quoteId: "quote-42",
      refreshHistory: confirmedRefresh
    });
    const readyState = await recoverContractConversionFromCanonicalHistory({
      quoteId: "quote-42",
      refreshHistory: readyRefresh
    });

    expect(confirmedRefresh).toHaveBeenCalledOnce();
    expect(receiptState).toMatchObject({
      phase: "receipt",
      quoteId: "quote-42",
      approvalRequestId: "",
      receipt: {
        contractNumber: "C-260809-0042",
        status: "booked",
        source: "canonical_history"
      }
    });
    expect(readyRefresh).toHaveBeenCalledOnce();
    expect(readyState).toEqual(createContractConversionMutationState("quote-42"));
  });

  test("fails recovery instead of leaving a row stuck when canonical history no longer contains the quote", async () => {
    await expect(recoverContractConversionFromCanonicalHistory({
      quoteId: "quote-42",
      refreshHistory: vi.fn().mockResolvedValue({ source: "firebase", quotes: [] })
    })).rejects.toThrow("no longer available in canonical quote history");
  });
});
