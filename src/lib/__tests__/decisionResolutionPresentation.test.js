import { describe, expect, test } from "vitest";

import {
  DECISION_RESOLUTION_PRESENTATION_MODEL,
  DecisionResolutionPresentationError,
  buildClearDeckDecisionPresentations
} from "../decisionResolutionPresentation";

const NOW = "2026-09-08T18:00:00.000Z";
const PORTAL_ISSUED_AT = "2026-09-01T15:00:00.000Z";
const PORTAL_KEY = "portal-key-current-abcdefghijklmnopqrstuvwxyz";

function quote(overrides = {}) {
  return {
    id: "quote-17",
    organizationId: "org-1",
    quoteNumber: "QP-0017",
    status: "accepted",
    activeVersionId: "v0004",
    event: {
      name: "Bennett wedding",
      date: "2026-10-17",
      startTime: "5:30 PM"
    },
    customer: {
      name: "Avery Bennett",
      email: "avery@example.com"
    },
    totals: {
      total: 1500,
      deposit: 375
    },
    portalKey: PORTAL_KEY,
    portalIssuedAtISO: PORTAL_ISSUED_AT,
    portalExpiresAtISO: "2026-10-01T15:00:00.000Z",
    booking: {},
    payment: { depositStatus: "unpaid" },
    workflow: {
      quoteDelivery: {
        revisionId: `v0004@${PORTAL_ISSUED_AT}`,
        state: "provider_accepted",
        portalActivationState: "active",
        providerMessageId: "provider-message-17",
        portalKey: PORTAL_KEY,
        portalIssuedAtISO: PORTAL_ISSUED_AT
      }
    },
    ...overrides
  };
}

function paymentScope(overrides = {}) {
  return {
    version: 1,
    kind: "stripe_checkout_deposit_request",
    organizationId: "org-1",
    quoteId: "quote-17",
    quoteRevisionId: `v0004@${PORTAL_ISSUED_AT}`,
    portalKey: PORTAL_KEY,
    portalIssuedAtISO: PORTAL_ISSUED_AT,
    portalExpiresAtISO: "2026-10-01T15:00:00.000Z",
    customerEmail: "avery@example.com",
    paymentKind: "deposit",
    currency: "usd",
    amountCents: 37500,
    ...overrides
  };
}

function request(id, action, overrides = {}) {
  return {
    id,
    action,
    state: "pending",
    note: "Please review before the client follow-up.",
    requestedAtISO: "2026-09-06T16:00:00.000Z",
    requestedByEmail: "sales@example.com",
    ...overrides
  };
}

function approvalItem(pendingRequests, quoteOverride = quote(), overrides = {}) {
  return {
    id: "approval:quote-17",
    type: "approval",
    state: "pending",
    quoteId: "quote-17",
    quote: quoteOverride,
    pendingRequests,
    ...overrides
  };
}

describe("buildClearDeckDecisionPresentations", () => {
  test("expands two pending requests on one quote into exact stable decision records", () => {
    const deposit = request("approval-deposit", "send_payment_request", {
      actionScope: paymentScope(),
      actionScopeDigest: "a".repeat(64)
    });
    const portal = request("approval-portal", "rotate_portal_link", {
      note: "Customer says the original link was forwarded."
    });

    const result = buildClearDeckDecisionPresentations({
      source: "firebase",
      items: [approvalItem([deposit, portal])]
    }, { nowISO: NOW });

    expect(result).toHaveLength(2);
    expect(result.map((item) => item.requestId)).toEqual([
      "approval-deposit",
      "approval-portal"
    ]);
    expect(result[0]).toMatchObject({
      model: DECISION_RESOLUTION_PRESENTATION_MODEL,
      id: "approval-deposit",
      stableId: "quote-17:approval-deposit",
      quoteId: "quote-17",
      attentionId: "approval:quote-17",
      attentionType: "approval",
      actionLabel: "Send payment request",
      title: "Decide send payment request",
      quoteLabel: "QP-0017",
      customerLabel: "Avery Bennett",
      eventLabel: "Bennett wedding",
      lifecycleLabel: "Accepted",
      requestSummary: "Please review before the client follow-up.",
      stakeLabel: "Deposit at stake",
      stakeValue: "$375.00",
      timingLabel: "Event timing",
      timingValue: "Oct 17, 2026 at 5:30 PM",
      requestAgeLabel: "Waiting",
      requestAgeValue: "2 days",
      requesterLabel: "sales@example.com",
      sourceRevisionLabel: `v0004@${PORTAL_ISSUED_AT}`,
      evidenceSource: "firebase",
      reviewable: true,
      nextStepLabel: "Approve or reject this request"
    });
    expect(result[0].dependencySummary).toMatch(/deposit amount/i);
    expect(result[0].authoritySummary).toMatch(/execution remains separate/i);
    expect(result[0].evidenceSummary).toMatch(/provider delivery.*separate evidence/i);
    expect(result[1]).toMatchObject({
      requestId: "approval-portal",
      actionLabel: "Rotate portal link",
      sourceRevisionTitle: "Current quote revision",
      stakeLabel: "Customer access at stake",
      stakeValue: "Current portal access will be replaced"
    });
    expect(result[1].dependencySummary).toMatch(/invalidates pending payment approvals/i);
  });

  test("does not impose the quote attention card cap on exact pending requests", () => {
    const pendingRequests = Array.from({ length: 4 }, (_, index) => (
      request(`delete-${index + 1}`, "delete_quote")
    ));

    const result = buildClearDeckDecisionPresentations({
      source: "firebase",
      attention: { items: [approvalItem(pendingRequests)] }
    }, { nowISO: NOW });

    expect(result).toHaveLength(4);
    expect(result.map((item) => item.id)).toEqual([
      "delete-1",
      "delete-2",
      "delete-3",
      "delete-4"
    ]);
  });

  test("presents trustworthy payment and final-balance stakes only from exact request scope", () => {
    const deposit = buildClearDeckDecisionPresentations({
      sourceMode: "firebase",
      items: [approvalItem([request("deposit", "send_payment_request", {
        actionScope: paymentScope(),
        actionScopeDigest: "b".repeat(64)
      })])]
    }, { nowISO: NOW })[0];

    const finalQuote = quote({
      status: "booked",
      booking: {
        contractNumber: "C-260901-17",
        contractConvertedAtISO: "2026-09-01T14:00:00.000Z"
      },
      payment: {
        depositStatus: "paid",
        stripeSessionId: "cs_test_deposit_17",
        depositConfirmedAtISO: "2026-09-01T14:30:00.000Z",
        finalBalance: { status: "unpaid", checkoutGeneration: 0 }
      }
    });
    const finalBalance = buildClearDeckDecisionPresentations({
      source: "firebase",
      items: [approvalItem([request("balance", "send_final_balance_request", {
        actionScope: paymentScope({
          kind: "stripe_checkout_final_balance_request",
          paymentKind: "final_balance",
          amountCents: 112500,
          depositStatus: "paid",
          depositAmountCents: 37500,
          depositStripeSessionId: "cs_test_deposit_17",
          depositConfirmedAtISO: "2026-09-01T14:30:00.000Z",
          contractNumber: "C-260901-17",
          contractConvertedAtISO: "2026-09-01T14:00:00.000Z",
          checkoutGeneration: 1
        }),
        actionScopeDigest: "c".repeat(64)
      })], finalQuote)]
    }, { nowISO: NOW })[0];

    expect(deposit).toMatchObject({
      stakeLabel: "Deposit at stake",
      stakeValue: "$375.00",
      stakeState: "available"
    });
    expect(finalBalance).toMatchObject({
      actionLabel: "Send final balance request",
      stakeLabel: "Final balance at stake",
      stakeValue: "$1,125.00",
      stakeState: "available",
      reviewable: true
    });
    expect(finalBalance.dependencySummary).toMatch(/converted contract.*paid-deposit evidence/i);
  });

  test("distinguishes contract, portal, and delete stakes without manufacturing money", () => {
    const contract = buildClearDeckDecisionPresentations({
      source: "firebase",
      items: [approvalItem([request("contract", "convert_to_contract")])]
    }, { nowISO: NOW })[0];
    const portal = buildClearDeckDecisionPresentations({
      source: "firebase",
      items: [approvalItem([request("portal", "rotate_portal_link")])]
    }, { nowISO: NOW })[0];
    const deletion = buildClearDeckDecisionPresentations({
      source: "firebase",
      items: [approvalItem([request("delete", "delete_quote")])]
    }, { nowISO: NOW })[0];

    expect(contract).toMatchObject({
      stakeLabel: "Accepted commitment at stake",
      stakeValue: "$1,500.00"
    });
    expect(portal).toMatchObject({
      stakeLabel: "Customer access at stake",
      stakeValue: "Current portal access will be replaced"
    });
    expect(deletion).toMatchObject({
      stakeLabel: "Quote record at stake",
      stakeValue: "Permanent removal through the existing delete authority"
    });
    expect(portal.stakeValue).not.toContain("$");
    expect(deletion.stakeValue).not.toContain("$");
  });

  test("keeps missing truth missing and routes contradictory scope to refresh", () => {
    const incompleteQuote = quote({
      status: "mystery",
      activeVersionId: "",
      versionMeta: {},
      latestVersionNumber: "",
      event: {},
      customer: {},
      portalKey: ""
    });
    const result = buildClearDeckDecisionPresentations({
      source: "firebase",
      items: [approvalItem([request("missing", "send_payment_request", {
        note: "",
        requestedAtISO: "",
        requestedByEmail: "",
        actionScope: paymentScope({
          quoteId: "another-quote",
          quoteRevisionId: "",
          amountCents: undefined,
          customerEmail: "",
          portalKey: "",
          portalIssuedAtISO: ""
        }),
        actionScopeDigest: "not-a-digest"
      })], incompleteQuote)]
    }, { nowISO: NOW })[0];

    expect(result).toMatchObject({
      lifecycleLabel: "Lifecycle not recorded",
      customerLabel: "Customer not recorded",
      eventLabel: "Event name not recorded",
      requestSummary: "No request note was recorded.",
      requestNoteState: "missing",
      requesterLabel: "Requester not recorded",
      sourceRevisionTitle: "Current quote revision",
      sourceRevisionLabel: "Current revision not recorded",
      stakeValue: "Amount unavailable from the exact approval scope",
      requestAgeValue: "Age unavailable",
      reviewable: false,
      nextStepLabel: "Refresh the exact Workflow request"
    });
    expect(result.dependencies.map((item) => item.state)).toContain("contradictory");
    expect(result.evidenceSummary).toMatch(/conflicts with the loaded quote/i);
  });

  test("fails closed when the current quote no longer matches the approved commercial scope", () => {
    const pending = request("stale-payment-scope", "send_payment_request", {
      actionScope: paymentScope(),
      actionScopeDigest: "d".repeat(64)
    });
    const currentQuote = quote({
      activeVersionId: "v0005",
      portalKey: "portal-key-new-abcdefghijklmnopqrstuvwxyz",
      portalIssuedAtISO: "2026-09-08T17:00:00.000Z",
      totals: { total: 1700, deposit: 425 },
      workflow: {
        quoteDelivery: {
          revisionId: "v0005@2026-09-08T17:00:00.000Z",
          state: "provider_accepted",
          portalActivationState: "active",
          providerMessageId: "provider-message-18",
          portalKey: "portal-key-new-abcdefghijklmnopqrstuvwxyz",
          portalIssuedAtISO: "2026-09-08T17:00:00.000Z"
        }
      }
    });

    const result = buildClearDeckDecisionPresentations({
      source: "firebase",
      items: [approvalItem([pending], currentQuote)]
    }, { nowISO: NOW })[0];

    expect(result).toMatchObject({
      reviewable: false,
      stakeState: "missing",
      nextStepLabel: "Refresh the exact Workflow request"
    });
    expect(result.dependencies).toEqual([
      expect.objectContaining({
        id: "governed-eligibility",
        state: "contradictory"
      })
    ]);
    expect(result.dependencySummary).toMatch(/older customer portal or commercial scope/i);
  });

  test("labels Firebase and browser-local evidence without converting either into provider proof", () => {
    const pending = request("delete-evidence", "delete_quote");
    const firebase = buildClearDeckDecisionPresentations({
      source: "firebase",
      items: [approvalItem([pending])]
    }, { nowISO: NOW })[0];
    const local = buildClearDeckDecisionPresentations({
      source: "local",
      items: [approvalItem([pending])]
    }, { nowISO: NOW })[0];
    const unknown = buildClearDeckDecisionPresentations({
      items: [approvalItem([pending])]
    }, { nowISO: NOW })[0];

    expect(firebase).toMatchObject({
      evidenceSource: "firebase",
      evidenceSourceLabel: "Firestore staff records",
      reviewable: true
    });
    expect(firebase.evidenceSummary).toMatch(/provider delivery.*separate evidence/i);
    expect(local).toMatchObject({
      evidenceSource: "local",
      evidenceSourceLabel: "Browser-local workspace",
      reviewable: true
    });
    expect(local.evidenceSummary).toMatch(/browser-local.*no server, provider/i);
    expect(unknown).toMatchObject({
      evidenceSource: "unknown",
      evidenceSourceLabel: "Source not confirmed",
      reviewable: false,
      nextStepLabel: "Refresh the exact Workflow request"
    });
  });

  test.each(["loading", "partial", "stale", "truncated"])(
    "fails closed when the bounded snapshot is %s",
    (state) => {
      const result = buildClearDeckDecisionPresentations({
        source: "firebase",
        [state]: true,
        items: [approvalItem([request(`stale-${state}`, "delete_quote")])]
      }, { nowISO: NOW })[0];

      expect(result.reviewable).toBe(false);
      expect(result.nextStepLabel).toBe("Refresh the exact Workflow request");
      expect(result.evidenceSummary).toMatch(/incomplete or stale/i);
    }
  );

  test("returns deeply immutable output without mutating the attention snapshot", () => {
    const snapshot = {
      source: "firebase",
      items: [approvalItem([request("immutable", "delete_quote")])]
    };
    const before = structuredClone(snapshot);
    const result = buildClearDeckDecisionPresentations(snapshot, { nowISO: NOW });

    expect(snapshot).toEqual(before);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result[0])).toBe(true);
    expect(Object.isFrozen(result[0].dependencies)).toBe(true);
    expect(Object.isFrozen(result[0].dependencies[0])).toBe(true);
  });

  test("fails closed on missing, duplicated, or contradictory exact identities", () => {
    expect(() => buildClearDeckDecisionPresentations({
      source: "firebase",
      items: [approvalItem([request("", "delete_quote")])]
    }, { nowISO: NOW })).toThrowError(expect.objectContaining({
      name: "DecisionResolutionPresentationError",
      code: "missing_request_identity"
    }));

    const duplicate = request("duplicate", "delete_quote");
    expect(() => buildClearDeckDecisionPresentations({
      source: "firebase",
      items: [approvalItem([duplicate, duplicate])]
    }, { nowISO: NOW })).toThrowError(expect.objectContaining({
      name: "DecisionResolutionPresentationError",
      code: "duplicate_request_identity"
    }));

    expect(() => buildClearDeckDecisionPresentations({
      source: "firebase",
      items: [approvalItem([request("mismatch", "delete_quote")], quote({ id: "quote-other" }))]
    }, { nowISO: NOW })).toThrowError(DecisionResolutionPresentationError);
  });

  test("retains exact Decision Debt and ignores unrelated or no-longer-pending entries", () => {
    const result = buildClearDeckDecisionPresentations({
      source: "firebase",
      items: [
        approvalItem([request("resolved", "delete_quote", { state: "approved" })]),
        {
          id: "decision-debt-42",
          type: "decision_debt",
          quoteId: "quote-17",
          quote: quote(),
          label: "Confirm final guest count",
          eventDate: "2026-10-17",
          lockDate: "2026-10-10",
          urgency: "high",
          commercialExposureCents: 150000,
          sourceRevisionId: "v0004",
          affectedNodeIds: ["staffing-plan", "kitchen-beo"],
          explanation: ["Final count is still unresolved."]
        },
        { id: "follow-up:quote-17", type: "follow_up", quoteId: "quote-17", quote: quote() }
      ]
    }, { nowISO: NOW });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      requestId: "decision-debt-42",
      attentionType: "decision_debt",
      title: "Confirm final guest count",
      stakeValue: "$1,500.00",
      sourceRevisionTitle: "Decision source revision",
      sourceRevisionLabel: "v0004",
      reviewable: true
    });
    expect(result[0].dependencySummary).toContain("2 affected dependencies");
    expect(result[0].authoritySummary).toMatch(/does not acknowledge or resolve/i);
  });
});
