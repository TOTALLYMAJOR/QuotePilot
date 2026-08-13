import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  buildPortalDecisionAttempt as buildAmbientPortalDecisionAttempt,
  getCustomerFinalBalanceUi as getAmbientFinalBalanceUi,
  getPaymentReturnMessage as getAmbientPaymentReturnMessage,
  reconcilePortalDecisionSnapshot as reconcileAmbientPortalDecisionSnapshot
} from "../CustomerPortalView";
import {
  buildPortalDecisionAttempt as buildLegacyPortalDecisionAttempt,
  getCustomerFinalBalanceUi as getLegacyFinalBalanceUi,
  getPaymentReturnMessage as getLegacyPaymentReturnMessage,
  reconcilePortalDecisionSnapshot as reconcileLegacyPortalDecisionSnapshot
} from "../LegacyCustomerPortalView";
import {
  buildConversationMutationPresentation as buildAmbientConversationMutationPresentation,
  mergeConversationMessages as mergeAmbientConversationMessages
} from "../QuoteConversationPanel";
import {
  buildConversationMutationPresentation as buildLegacyConversationMutationPresentation,
  mergeConversationMessages as mergeLegacyConversationMessages
} from "../LegacyQuoteConversationPanel";

describe("legacy portal bundle compatibility", () => {
  test("keeps payment and exact-decision authority semantics aligned", () => {
    const quote = {
      portalKey: "portal_key_12345678901234567890",
      status: "viewed",
      portalIssuedAtISO: "2026-08-12T15:00:00.000Z",
      deliveryEvidence: { revisionId: "v0017" },
      payment: {
        depositStatus: "paid",
        stripeCheckoutState: "paid",
        finalBalance: {
          amountCents: 42000,
          currency: "usd",
          status: "sent",
          stripeCheckoutState: "processing"
        }
      }
    };
    const decisionInput = {
      quote,
      decision: "accepted",
      message: "Please call before arrival.",
      signerName: "  Ada   Lovelace  "
    };
    const ambientAttempt = buildAmbientPortalDecisionAttempt(decisionInput);
    const legacyAttempt = buildLegacyPortalDecisionAttempt(decisionInput);
    const snapshot = {
      ...quote,
      status: "accepted",
      portalDecision: { decision: "accepted" },
      acceptanceReceipt: {
        receiptId: "acceptance-17",
        signerName: "Ada Lovelace",
        consentVersion: "proposal-acceptance-v1",
        quoteRevisionId: "v0017",
        portalIssuedAtISO: quote.portalIssuedAtISO
      }
    };

    expect(legacyAttempt).toEqual(ambientAttempt);
    expect(reconcileLegacyPortalDecisionSnapshot(legacyAttempt, snapshot))
      .toEqual(reconcileAmbientPortalDecisionSnapshot(ambientAttempt, snapshot));
    expect(getLegacyFinalBalanceUi(quote)).toEqual(getAmbientFinalBalanceUi(quote));
    expect(getLegacyPaymentReturnMessage("success", quote.payment, "final_balance"))
      .toEqual(getAmbientPaymentReturnMessage("success", quote.payment, "final_balance"));
  });

  test("keeps conversation receipt and replay behavior aligned", () => {
    const first = { messageId: "message-a", createdAtISO: "2026-08-12T15:00:00.000Z" };
    const second = { messageId: "message-b", createdAtISO: "2026-08-12T15:01:00.000Z" };
    const mutation = {
      phase: "send_error",
      pendingRequestId: "conversation:request-17",
      error: "Connection closed before a receipt returned."
    };

    expect(mergeLegacyConversationMessages([second], [first, second]))
      .toEqual(mergeAmbientConversationMessages([second], [first, second]));
    expect(buildLegacyConversationMutationPresentation(mutation))
      .toEqual(buildAmbientConversationMutationPresentation(mutation));
  });

  test("keeps the production portal dependency graph on the legacy conversation", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../LegacyCustomerPortalView.jsx", import.meta.url)),
      "utf8"
    );

    expect(source).toContain('from "./LegacyQuoteConversationPanel"');
    expect(source).not.toContain('from "./QuoteConversationPanel"');
    expect(source).not.toContain("VITE_AMBIENT_UI_ENABLED");
  });
});
