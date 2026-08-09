import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  QuoteConversationMutationStatus,
  buildConversationCloseGuard,
  buildConversationMutationPresentation,
  formatConversationTimestamp,
  isDefinitiveConversationSendError,
  isConversationRequestGenerationCurrent,
  mergeConversationMessages
} from "../QuoteConversationPanel";

function renderConversationMutationState(props) {
  const presentation = buildConversationMutationPresentation(props);
  return renderToStaticMarkup(
    <section>
      <QuoteConversationMutationStatus presentation={presentation} showReady />
      <button type="button">{presentation.actionLabel}</button>
    </section>
  );
}

describe("quote conversation panel states", () => {
  test("deduplicates replayed message receipts and keeps canonical time order", () => {
    const first = {
      messageId: "message-a",
      createdAtISO: "2026-08-06T18:00:00.000Z"
    };
    const second = {
      messageId: "message-b",
      createdAtISO: "2026-08-06T18:01:00.000Z"
    };
    expect(mergeConversationMessages([second], [first, second])).toEqual([first, second]);
    expect(formatConversationTimestamp(first.createdAtISO)).not.toBe("Time unavailable");
    expect(formatConversationTimestamp("invalid")).toBe("Time unavailable");
  });

  test("separates definitive conversation rejection from an uncertain dispatched request", () => {
    expect(isDefinitiveConversationSendError({ code: "functions/invalid-argument" })).toBe(true);
    expect(isDefinitiveConversationSendError({ code: "permission-denied" })).toBe(true);
    expect(isDefinitiveConversationSendError({
      message: "Conversation requires a connected QuotePilot workspace."
    })).toBe(true);
    expect(isDefinitiveConversationSendError({ code: "functions/unavailable" })).toBe(false);
    expect(isDefinitiveConversationSendError({
      message: "Message send did not return a valid receipt."
    })).toBe(false);
  });

  test("blocks close and editing while a message identity still needs a receipt", () => {
    expect(buildConversationCloseGuard({
      phase: "sending",
      pendingRequestId: "conversation:request-0001"
    })).toMatchObject({
      blocked: true
    });
    expect(buildConversationCloseGuard({
      phase: "send_error",
      pendingRequestId: "conversation:request-0001"
    })).toEqual({
      blocked: true,
      message: "Reconcile the unresolved message request before closing this conversation."
    });
    expect(buildConversationCloseGuard({
      phase: "send_error",
      pendingRequestId: ""
    })).toEqual({ blocked: false, message: "" });
  });

  test("rejects stale conversation results after a newer load or access identity takes over", () => {
    expect(isConversationRequestGenerationCurrent({
      requestGeneration: 4,
      currentGeneration: 4,
      requestIdentity: "staff:test-org:quote-a:",
      currentIdentity: "staff:test-org:quote-a:"
    })).toBe(true);
    expect(isConversationRequestGenerationCurrent({
      requestGeneration: 3,
      currentGeneration: 4,
      requestIdentity: "staff:test-org:quote-a:",
      currentIdentity: "staff:test-org:quote-a:"
    })).toBe(false);
    expect(isConversationRequestGenerationCurrent({
      requestGeneration: 4,
      currentGeneration: 4,
      requestIdentity: "staff:test-org:quote-a:",
      currentIdentity: "staff:test-org:quote-b:"
    })).toBe(false);
  });

  test("renders conversation ready, submitting, and uncertain states through the live presentation seam", () => {
    const readyHtml = renderConversationMutationState({ phase: "ready" });
    const submittingHtml = renderConversationMutationState({ phase: "sending", sendMode: "submit" });
    const uncertainHtml = renderConversationMutationState({
      phase: "send_error",
      pendingRequestId: "conversation:request-0001",
      error: "Connection closed before a receipt returned."
    });

    expect(readyHtml).toContain('data-mutation-state="ready"');
    expect(readyHtml).toContain('data-capability-state="ready"');
    expect(readyHtml).toContain("Nothing new has been recorded.");
    expect(readyHtml).toContain(">Send message</button>");
    expect(submittingHtml).toContain('data-mutation-state="submitting"');
    expect(submittingHtml).toContain('data-capability-state="submitting"');
    expect(submittingHtml).toContain("Waiting for the quote conversation receipt");
    expect(submittingHtml).toContain(">Sending message...</button>");
    expect(uncertainHtml).toContain('data-mutation-state="uncertain"');
    expect(uncertainHtml).toContain('data-capability-state="uncertain"');
    expect(uncertainHtml).toContain("Message outcome is uncertain.");
    expect(uncertainHtml).toContain("same request identity");
    expect(uncertainHtml).toContain(">Reconcile message</button>");
    expect(uncertainHtml).not.toContain("Message was not sent");
  });

  test("renders conversation reconciliation, receipt, error, and recovery without delivery claims", () => {
    const reconciliationHtml = renderConversationMutationState({
      phase: "sending",
      pendingRequestId: "conversation:request-0001",
      sendMode: "reconcile"
    });
    const receiptHtml = renderConversationMutationState({
      phase: "success",
      status: "The existing message request was reconciled. The conversation receipt is current."
    });
    const errorHtml = renderConversationMutationState({
      phase: "send_error",
      error: "A safe message retry id is required."
    });
    const recoveryHtml = renderConversationMutationState({
      phase: "ready",
      sendMode: "recovery"
    });

    expect(reconciliationHtml).toContain('data-mutation-state="reconciliation"');
    expect(reconciliationHtml).toContain('data-capability-state="reconciliation"');
    expect(reconciliationHtml).toContain("The same request identity is being retried.");
    expect(reconciliationHtml).toContain(">Reconciling message...</button>");
    expect(receiptHtml).toContain('data-mutation-state="receipt"');
    expect(receiptHtml).toContain('data-capability-state="receipt"');
    expect(receiptHtml).toContain("conversation receipt is current");
    expect(receiptHtml).not.toContain("delivered");
    expect(errorHtml).toContain('data-mutation-state="error"');
    expect(errorHtml).toContain('data-capability-state="error"');
    expect(errorHtml).toContain("No recorded message is assumed.");
    expect(errorHtml).toContain(">Retry message</button>");
    expect(recoveryHtml).toContain('data-mutation-state="recovery"');
    expect(recoveryHtml).toContain('data-capability-state="recovery"');
    expect(recoveryHtml).toContain("earlier request remains unconfirmed");
    expect(recoveryHtml).toContain(">Send revised message</button>");
  });
});
