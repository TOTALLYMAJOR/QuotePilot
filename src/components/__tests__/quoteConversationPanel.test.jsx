import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  ConversationHistoryAction,
  QuoteConversationMutationStatus,
  beginConversationPendingAttempt,
  buildConversationCloseGuard,
  buildConversationMutationPresentation,
  clearConversationPendingAttempt,
  formatConversationTimestamp,
  isDefinitiveConversationSendError,
  isConversationRequestGenerationCurrent,
  markConversationPendingAttemptError,
  readConversationPendingAttempt,
  mergeConversationMessages,
  syncConversationPendingAttemptUnloadGuard
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
  test("renders older-history loading and recovery as explicit capability states", () => {
    const loading = renderToStaticMarkup(
      <ConversationHistoryAction
        hasOlder
        oldestCursor={{ createdAtMs: 1, messageId: "message-1" }}
        phase="loading_older"
        busy
      />
    );
    const recovery = renderToStaticMarkup(
      <ConversationHistoryAction
        hasOlder
        oldestCursor={{ createdAtMs: 1, messageId: "message-1" }}
        phase="older_error"
        error="Older history is temporarily unavailable."
      />
    );
    expect(loading).toContain('data-capability-state="loading_older"');
    expect(loading).toContain("Loading older messages...");
    expect(recovery).toContain('data-capability-state="older_error"');
    expect(recovery).toContain("Older history is temporarily unavailable.");
  });
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
    expect(isDefinitiveConversationSendError({ code: "functions/already-exists" })).toBe(true);
    expect(isDefinitiveConversationSendError({ code: "permission-denied" })).toBe(true);
    expect(isDefinitiveConversationSendError({
      message: "Conversation requires a connected QuotePilot workspace."
    })).toBe(true);
    expect(isDefinitiveConversationSendError({ code: "functions/unavailable" })).toBe(false);
    expect(isDefinitiveConversationSendError({
      message: "Message send did not return a valid receipt."
    })).toBe(false);
  });

  test("allows panel close while protecting page unload for an unresolved request", () => {
    expect(buildConversationCloseGuard({
      phase: "sending",
      pendingRequestId: "conversation:request-0001"
    })).toEqual({
      blocked: false,
      protectsUnload: true,
      message: "The unresolved request will be kept for exact reconciliation when this conversation is reopened."
    });
    expect(buildConversationCloseGuard({
      phase: "send_error",
      pendingRequestId: "conversation:request-0001"
    })).toEqual({
      blocked: false,
      protectsUnload: true,
      message: "The unresolved request will be kept for exact reconciliation when this conversation is reopened."
    });
    expect(buildConversationCloseGuard({
      phase: "send_error",
      pendingRequestId: ""
    })).toEqual({ blocked: false, protectsUnload: false, message: "" });
  });

  test("restores the exact unresolved request identity and body after a simulated unmount", () => {
    const identity = "staff:org-a:quote-a::staff-a";
    const first = beginConversationPendingAttempt({
      identity,
      body: "Please confirm the loading dock.",
      createRequestId: () => "conversation:request-preserved"
    });
    markConversationPendingAttemptError({
      identity,
      clientRequestId: first.clientRequestId,
      error: "Connection closed before a receipt returned."
    });

    const reopened = readConversationPendingAttempt(identity);
    const reconciliation = beginConversationPendingAttempt({
      identity,
      body: reopened.body,
      createRequestId: () => {
        throw new Error("A reopened request must not allocate a replacement identity.");
      }
    });

    expect(reopened).toMatchObject({
      clientRequestId: "conversation:request-preserved",
      body: "Please confirm the loading dock.",
      resetAllowed: false
    });
    expect(reconciliation).toMatchObject({
      clientRequestId: "conversation:request-preserved",
      body: "Please confirm the loading dock.",
      sendMode: "reconcile"
    });
    expect(() => beginConversationPendingAttempt({
      identity,
      body: "Changed text must use a new request.",
      clientRequestId: reconciliation.clientRequestId
    })).toThrow(/retried unchanged/i);
    expect(clearConversationPendingAttempt({
      identity,
      clientRequestId: reconciliation.clientRequestId,
      resolution: "unknown"
    })).toBe(false);
    expect(readConversationPendingAttempt(identity)).not.toBeNull();
    expect(clearConversationPendingAttempt({
      identity,
      clientRequestId: reconciliation.clientRequestId,
      resolution: "receipt"
    })).toBe(true);
    expect(readConversationPendingAttempt(identity)).toBeNull();
  });

  test("clears a definitively rejected request only through an explicit safe reset", () => {
    const identity = "portal:::portal-token-safe-reset:";
    const attempt = beginConversationPendingAttempt({
      identity,
      body: "Please confirm dietary restrictions.",
      createRequestId: () => "conversation:request-safe-reset"
    });
    expect(markConversationPendingAttemptError({
      identity,
      clientRequestId: attempt.clientRequestId,
      error: "The portal is no longer active.",
      resetAllowed: true
    })).toBe(true);
    expect(readConversationPendingAttempt(identity)?.resetAllowed).toBe(true);
    expect(clearConversationPendingAttempt({
      identity,
      clientRequestId: attempt.clientRequestId,
      resolution: "safe_reset"
    })).toBe(true);
    expect(readConversationPendingAttempt(identity)).toBeNull();
  });

  test("keeps one global unload guard after panel unmount until the final attempt resolves", () => {
    const listeners = new Map();
    const target = {
      addCalls: 0,
      removeCalls: 0,
      addEventListener(type, listener) {
        this.addCalls += 1;
        listeners.set(type, listener);
      },
      removeEventListener(type, listener) {
        this.removeCalls += 1;
        if (listeners.get(type) === listener) listeners.delete(type);
      }
    };
    const identity = "staff:org-a:quote-unload::staff-a";
    const attempt = beginConversationPendingAttempt({
      identity,
      body: "Preserve this request while the panel is closed.",
      createRequestId: () => "conversation:request-unload"
    });

    expect(syncConversationPendingAttemptUnloadGuard(target)).toEqual({
      active: true,
      pendingCount: 1
    });
    expect(syncConversationPendingAttemptUnloadGuard(target).active).toBe(true);
    expect(target.addCalls).toBe(1);

    const event = {
      returnValue: undefined,
      preventDefaultCalled: false,
      preventDefault() {
        this.preventDefaultCalled = true;
      }
    };
    listeners.get("beforeunload")(event);
    expect(event.preventDefaultCalled).toBe(true);
    expect(event.returnValue).toBe("");

    expect(clearConversationPendingAttempt({
      identity,
      clientRequestId: attempt.clientRequestId,
      resolution: "receipt"
    })).toBe(true);
    expect(target.removeCalls).toBe(1);
    expect(listeners.has("beforeunload")).toBe(false);
    expect(syncConversationPendingAttemptUnloadGuard(target)).toEqual({
      active: false,
      pendingCount: 0
    });
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
    const safeResetHtml = renderConversationMutationState({
      phase: "send_error",
      pendingRequestId: "conversation:request-rejected",
      sendMode: "safe_reset",
      error: "The portal is no longer active."
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
    expect(safeResetHtml).toContain('data-mutation-state="error"');
    expect(safeResetHtml).toContain("Reset rejected attempt");
    expect(safeResetHtml).toContain("definitive rejection");
    expect(recoveryHtml).toContain('data-mutation-state="recovery"');
    expect(recoveryHtml).toContain('data-capability-state="recovery"');
    expect(recoveryHtml).toContain("explicitly cleared");
    expect(recoveryHtml).toContain(">Send revised message</button>");
  });
});
