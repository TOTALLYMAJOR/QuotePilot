import { createRequire } from "node:module";
import fs from "node:fs";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  PaymentDispatchStateError,
  beginPaymentDispatchAttempt,
  classifyPaymentDispatchError,
  planExpiredPortalPaymentDispatchRecovery,
  planPaymentDispatchFailure,
  planPaymentDispatchResume,
  recordPaymentDispatchProviderAcceptance
} = require("../../../functions/paymentDispatchState.js");
const {
  assertPreparedCheckoutPublicationTransition,
  buildPreparedCheckoutState,
  buildPublishedCheckoutState
} = require("../../../functions/paymentSafety.js");

const FUNCTIONS_INDEX_SOURCE = fs.readFileSync(
  new URL("../../../functions/index.js", import.meta.url),
  "utf8"
);

function callableSource(name, nextName) {
  const start = FUNCTIONS_INDEX_SOURCE.indexOf(`exports.${name} =`);
  const end = FUNCTIONS_INDEX_SOURCE.indexOf(`exports.${nextName} =`, start + 1);
  return FUNCTIONS_INDEX_SOURCE.slice(start, end);
}

function approvedPaymentRequestSource() {
  const start = FUNCTIONS_INDEX_SOURCE.indexOf("async function sendApprovedPaymentRequestEmail");
  const end = FUNCTIONS_INDEX_SOURCE.indexOf("exports.sendPaymentRequestEmail =", start + 1);
  return FUNCTIONS_INDEX_SOURCE.slice(start, end);
}

const NOW = "2026-08-04T15:00:00.000Z";
const LATER = "2026-08-04T15:01:00.000Z";
const identity = {
  operationId: "approval-request-1",
  actorUid: "admin-uid-1",
  actionScopeDigest: "a".repeat(64),
  idempotencyKey: "quote-approval/org-a/quote-1/approval-request-1"
};

function start() {
  return beginPaymentDispatchAttempt({
    ...identity,
    nowISO: NOW
  });
}

function providerError(message, fields = {}) {
  return Object.assign(new Error(message), fields);
}

describe("payment dispatch state", () => {
  test.each([
    ["network ambiguity", providerError("fetch failed", {
      paymentDispatchOutcome: "ambiguous",
      paymentDispatchReason: "provider_network_error"
    })],
    ["HTTP 202 without a message id", providerError("missing id", {
      providerHttpStatus: 202,
      paymentDispatchReason: "provider_2xx_missing_message_id"
    })],
    ["HTTP 408", providerError("timeout", { providerHttpStatus: 408 })],
    ["HTTP 409", providerError("conflict", { providerHttpStatus: 409 })],
    ["HTTP 429", providerError("rate limit", { providerHttpStatus: 429 })],
    ["HTTP 503", providerError("unavailable", { providerHttpStatus: 503 })],
    ["unknown provider outcome", providerError("socket closed")]
  ])("keeps %s in progress without neutralizing its checkout", (_label, error) => {
    const plan = planPaymentDispatchFailure({
      dispatch: start(),
      error,
      nowISO: LATER
    });

    expect(plan).toMatchObject({
      outcome: "ambiguous",
      executionState: "in_progress",
      resumable: true,
      nextAction: "retry_provider_with_same_key",
      shouldNeutralizeCheckout: false,
      shouldAdvanceCheckoutGeneration: false,
      requiresNewApproval: false,
      dispatch: {
        state: "outcome_ambiguous",
        idempotencyKey: identity.idempotencyKey,
        completedAtISO: ""
      }
    });
  });

  test.each([
    ["HTTP 400", providerError("invalid recipient", { providerHttpStatus: 400 })],
    ["HTTP 422", providerError("validation failed", { providerHttpStatus: 422 })],
    ["local configuration", providerError("provider disabled", {
      code: "failed-precondition"
    })],
    ["explicit provider rejection", providerError("rejected", {
      paymentDispatchOutcome: "definite_failure",
      paymentDispatchReason: "provider_rejected"
    })]
  ])("fails %s and permits checkout neutralization", (_label, error) => {
    const plan = planPaymentDispatchFailure({
      dispatch: start(),
      error,
      nowISO: LATER
    });

    expect(plan).toMatchObject({
      outcome: "definite_failure",
      executionState: "failed",
      resumable: false,
      nextAction: "new_approval_required",
      shouldNeutralizeCheckout: true,
      shouldAdvanceCheckoutGeneration: true,
      requiresNewApproval: true,
      dispatch: {
        state: "definite_failure",
        completedAtISO: LATER
      }
    });
  });

  test("idempotently preserves a definite failure during crash recovery", () => {
    const recorded = planPaymentDispatchFailure({
      dispatch: start(),
      error: providerError("recipient rejected", {
        providerHttpStatus: 422,
        paymentDispatchReason: "invalid_recipient"
      }),
      nowISO: LATER
    });
    const recovered = planPaymentDispatchFailure({
      dispatch: recorded.dispatch,
      error: providerError("retry interrupted", {
        paymentDispatchOutcome: "ambiguous",
        paymentDispatchReason: "provider_network_error"
      }),
      nowISO: "2026-08-04T15:02:00.000Z"
    });

    expect(recovered).toEqual(recorded);
    expect(recovered).toMatchObject({
      outcome: "definite_failure",
      executionState: "failed",
      resumable: false,
      shouldNeutralizeCheckout: true,
      shouldAdvanceCheckoutGeneration: true,
      requiresNewApproval: true,
      dispatch: {
        state: "definite_failure",
        outcomeReason: "invalid_recipient",
        completedAtISO: LATER
      }
    });
    expect(planPaymentDispatchResume({
      executionState: "in_progress",
      dispatch: recovered.dispatch,
      ...identity
    })).toEqual({
      action: "new_approval_required",
      resumable: false,
      idempotencyKey: identity.idempotencyKey
    });
  });

  test("waits for an active send before claiming expired-portal provider-unknown recovery", () => {
    const waiting = planExpiredPortalPaymentDispatchRecovery({
      dispatch: start(),
      nowISO: "2026-08-04T15:14:59.999Z",
      staleAfterMs: 15 * 60 * 1000
    });
    expect(waiting).toMatchObject({
      action: "wait_for_active_provider_attempt",
      changed: false,
      retryAfterISO: "2026-08-04T15:15:00.000Z",
      dispatch: { state: "sending" }
    });

    const stale = planExpiredPortalPaymentDispatchRecovery({
      dispatch: start(),
      nowISO: "2026-08-04T15:15:00.000Z",
      staleAfterMs: 15 * 60 * 1000
    });
    expect(stale).toMatchObject({
      action: "recover_provider_unknown",
      changed: true,
      retryAfterISO: "",
      dispatch: {
        state: "recovery_claimed",
        lastOutcome: "ambiguous",
        outcomeReason: "portal_expired_stale_sending",
        completedAtISO: ""
      }
    });

    const alreadyAmbiguous = planExpiredPortalPaymentDispatchRecovery({
      dispatch: planPaymentDispatchFailure({
        dispatch: start(),
        error: providerError("network outcome unknown"),
        nowISO: LATER
      }).dispatch,
      nowISO: LATER,
      staleAfterMs: 15 * 60 * 1000
    });
    expect(alreadyAmbiguous).toMatchObject({
      action: "recover_provider_unknown",
      changed: true,
      dispatch: {
        state: "recovery_claimed",
        outcomeReason: "portal_expired_recovery_claimed"
      }
    });
    expect(planPaymentDispatchResume({
      executionState: "in_progress",
      dispatch: alreadyAmbiguous.dispatch,
      ...identity
    })).toEqual({
      action: "expired_portal_recovery_in_progress",
      resumable: false,
      idempotencyKey: identity.idempotencyKey
    });
    expect(() => beginPaymentDispatchAttempt({
      dispatch: alreadyAmbiguous.dispatch,
      ...identity,
      nowISO: "2026-08-04T15:16:00.000Z"
    })).toThrowError(/recovery is already in progress/i);
    expect(planPaymentDispatchFailure({
      dispatch: alreadyAmbiguous.dispatch,
      error: providerError("competing retry"),
      nowISO: "2026-08-04T15:16:00.000Z"
    })).toMatchObject({
      executionState: "in_progress",
      nextAction: "complete_expired_portal_recovery",
      resumable: false,
      dispatch: { state: "recovery_claimed" }
    });
  });

  test("retries an ambiguous attempt with the exact same provider key", () => {
    const ambiguous = planPaymentDispatchFailure({
      dispatch: start(),
      error: providerError("fetch failed", {
        paymentDispatchOutcome: "ambiguous",
        paymentDispatchReason: "provider_network_error"
      }),
      nowISO: LATER
    });
    const resume = planPaymentDispatchResume({
      executionState: ambiguous.executionState,
      dispatch: ambiguous.dispatch,
      ...identity
    });
    expect(resume).toEqual({
      action: "retry_provider_with_same_key",
      resumable: true,
      idempotencyKey: identity.idempotencyKey
    });

    const retry = beginPaymentDispatchAttempt({
      dispatch: ambiguous.dispatch,
      ...identity,
      nowISO: "2026-08-04T15:02:00.000Z"
    });
    expect(retry).toMatchObject({
      state: "sending",
      attemptCount: 2,
      startedAtISO: NOW,
      lastAttemptAtISO: "2026-08-04T15:02:00.000Z",
      idempotencyKey: identity.idempotencyKey
    });
  });

  test("persists provider acceptance as publication-only resumable work", () => {
    const accepted = recordPaymentDispatchProviderAcceptance({
      dispatch: start(),
      provider: "resend",
      providerMessageId: "email-message-1",
      nowISO: LATER
    });
    expect(accepted).toMatchObject({
      executionState: "in_progress",
      resumable: true,
      nextAction: "complete_publication",
      shouldNeutralizeCheckout: false,
      dispatch: {
        state: "provider_accepted",
        provider: "resend",
        providerMessageId: "email-message-1",
        providerAcceptedAtISO: LATER
      }
    });
    expect(planPaymentDispatchResume({
      executionState: accepted.executionState,
      dispatch: accepted.dispatch,
      ...identity
    })).toEqual({
      action: "complete_publication",
      resumable: true,
      idempotencyKey: identity.idempotencyKey,
      provider: "resend",
      providerMessageId: "email-message-1"
    });
    expect(() => beginPaymentDispatchAttempt({
      dispatch: accepted.dispatch,
      ...identity,
      nowISO: "2026-08-04T15:02:00.000Z"
    })).toThrowError(/finish publication without sending again/i);
  });

  test("recovers one prepared checkout through provider acceptance and idempotent publication", () => {
    const preparedPayment = buildPreparedCheckoutState({
      expectedPayment: {
        depositStatus: "unpaid",
        depositLink: "",
        depositConfirmedAtISO: "",
        stripeSessionId: "",
        stripeCheckoutState: "",
        checkoutGeneration: 0,
        knownStripeSessionIds: []
      },
      stripeSessionId: "cs_test_combined_recovery",
      checkoutGeneration: 1
    });
    const publishedPayment = buildPublishedCheckoutState({
      preparedPayment,
      depositLink: "https://checkout.stripe.com/c/pay/combined-recovery"
    });
    const accepted = recordPaymentDispatchProviderAcceptance({
      dispatch: start(),
      provider: "resend",
      providerMessageId: "email-combined-recovery",
      nowISO: LATER
    });

    expect(planPaymentDispatchResume({
      executionState: accepted.executionState,
      dispatch: accepted.dispatch,
      ...identity
    })).toMatchObject({
      action: "complete_publication",
      provider: "resend",
      providerMessageId: "email-combined-recovery"
    });
    expect(assertPreparedCheckoutPublicationTransition({
      currentPayment: preparedPayment,
      expectedPreparedPayment: preparedPayment,
      publishedPayment
    })).toEqual({ alreadyApplied: false });
    expect(assertPreparedCheckoutPublicationTransition({
      currentPayment: publishedPayment,
      expectedPreparedPayment: preparedPayment,
      publishedPayment
    })).toEqual({ alreadyApplied: true });
  });

  test("wires publication-only recovery ahead of any second provider email", () => {
    const source = approvedPaymentRequestSource();
    const recoveryBranch = source.indexOf(
      'if (dispatchAttempt.action === "complete_publication")'
    );
    const providerSend = source.indexOf("email = await sendCustomerEmail");
    const acceptanceRecord = source.indexOf(
      "paymentDispatch = await recordPaymentDispatchAcceptance"
    );
    const publication = source.indexOf("const completed = await db.runTransaction");

    expect(recoveryBranch).toBeGreaterThan(-1);
    expect(providerSend).toBeGreaterThan(recoveryBranch);
    expect(acceptanceRecord).toBeGreaterThan(providerSend);
    expect(publication).toBeGreaterThan(acceptanceRecord);
    const recoveryPath = source.slice(recoveryBranch, providerSend);
    expect(recoveryPath).toContain("providerAccepted = true");
    expect(recoveryPath).not.toContain("await sendCustomerEmail");
  });

  test("closes provider-accepted expired checkout recovery before the generic resumable branch", () => {
    const callable = approvedPaymentRequestSource();
    const finalizerStart = FUNCTIONS_INDEX_SOURCE.indexOf(
      "async function finalizeProviderAcceptedExpiredCheckout"
    );
    const finalizerEnd = FUNCTIONS_INDEX_SOURCE.indexOf(
      "exports.resolveTenantByHost =",
      finalizerStart
    );
    const finalizer = FUNCTIONS_INDEX_SOURCE.slice(finalizerStart, finalizerEnd);
    const expiredFlag = FUNCTIONS_INDEX_SOURCE.indexOf(
      "expiredError.paymentCheckoutExpired = true"
    );
    const recoveryBranch = callable.indexOf(
      "const providerAcceptedCheckoutExpired = Boolean("
    );
    const recoveryCall = callable.indexOf(
      "await finalizeProviderAcceptedExpiredCheckout",
      recoveryBranch
    );
    const resumableBranch = callable.indexOf(
      "let keepExecutionResumable = providerAccepted",
      recoveryBranch
    );

    expect(finalizerStart).toBeGreaterThan(-1);
    expect(expiredFlag).toBeGreaterThan(-1);
    expect(recoveryBranch).toBeGreaterThan(-1);
    expect(recoveryCall).toBeGreaterThan(recoveryBranch);
    expect(resumableBranch).toBeGreaterThan(recoveryCall);
    expect(finalizer).toContain("const [quoteSnap, executionSnap, privateDispatchSnap]");
    expect(finalizer).toContain("const portalSnap = portalRef ? await tx.get(portalRef) : null");
    expect(finalizer.indexOf("const portalSnap")).toBeLessThan(
      finalizer.indexOf("tx.update(quoteRef")
    );
    expect(finalizer).toContain('state: "failed"');
    expect(finalizer).toContain('nextState: "expired"');
    expect(finalizer).toContain('exposureState: "expired_after_provider_acceptance"');
    expect(finalizer).toContain('privateDepositLink: ""');
    expect(callable.slice(recoveryBranch, resumableBranch)).toContain(
      "The operation is closed; request and approve a fresh payment request."
    );
  });

  test("closes stale work only before any checkout preparation or email dispatch is recorded", () => {
    const callable = approvedPaymentRequestSource();
    const helperStart = FUNCTIONS_INDEX_SOURCE.indexOf(
      "async function finalizeUnpreparedPaymentExecutionFailure"
    );
    const helperEnd = FUNCTIONS_INDEX_SOURCE.indexOf(
      "exports.resolveTenantByHost =",
      helperStart
    );
    const helper = FUNCTIONS_INDEX_SOURCE.slice(helperStart, helperEnd);
    const recoveryCall = callable.indexOf(
      "await finalizeUnpreparedPaymentExecutionFailure"
    );
    const executionRecheck = callable.indexOf(
      "let executionStateUncertain = false"
    );

    expect(helperStart).toBeGreaterThan(-1);
    expect(helper).toContain(
      'normalizeText(execution.state).toLowerCase() !== "in_progress"'
    );
    expect(helper).toContain(
      "normalizeText(execution.executedBy?.uid) !== normalizeText(staff?.uid)"
    );
    expect(helper).toContain("execution.checkoutPreparation");
    expect(helper).toContain("execution.paymentDispatch");
    expect(helper).toContain("privateDispatchSnap.exists");
    expect(helper).toContain("buildApprovalExecutionStart({");
    expect(helper).toContain("tx.create(executionRef, buildApprovalExecutionAudit({");
    expect(helper).toContain(
      'normalizeText(approvalRequest?.state).toLowerCase() !== "approved"'
    );
    expect(helper).toContain('"awaiting_execution"');
    expect(helper).toContain('state: "failed"');
    expect(helper).toContain("checkoutPreparationRecorded: false");
    expect(helper).toContain('stripeCheckoutOutcome: "unverified"');
    expect(helper).toContain("emailProviderContacted: false");
    expect(recoveryCall).toBeGreaterThan(-1);
    expect(executionRecheck).toBeGreaterThan(recoveryCall);
    expect(callable.slice(recoveryCall, executionRecheck)).toContain(
      "The operation is closed; request and approve a fresh payment request."
    );

    const classifierStart = FUNCTIONS_INDEX_SOURCE.indexOf(
      "function isDefinitePaymentExecutionClaimError"
    );
    const classifierEnd = FUNCTIONS_INDEX_SOURCE.indexOf(
      "async function advanceCheckoutGenerationIfUnchanged",
      classifierStart
    );
    const classifier = FUNCTIONS_INDEX_SOURCE.slice(classifierStart, classifierEnd);
    const abortedGuard = classifier.indexOf(
      'if (code === "aborted" || !definiteCodes.has(code)) return false;'
    );
    const quoteDeliveryClass = classifier.indexOf(
      "error instanceof QuoteDeliveryError"
    );
    expect(abortedGuard).toBeGreaterThan(-1);
    expect(quoteDeliveryClass).toBeGreaterThan(abortedGuard);
    expect(classifier).toContain('"failed-precondition"');
    expect(callable).toContain(
      "if (!claimedQuote && isDefinitePaymentExecutionClaimError(err))"
    );
  });

  test("redacts every nested checkout URL before writing the readable execution audit", () => {
    const redactionStart = FUNCTIONS_INDEX_SOURCE.indexOf(
      "function redactCheckoutPreparation"
    );
    const redactionEnd = FUNCTIONS_INDEX_SOURCE.indexOf(
      "function restorePrivateCheckoutPreparation",
      redactionStart
    );
    const redactionSource = FUNCTIONS_INDEX_SOURCE.slice(redactionStart, redactionEnd);
    const persistenceStart = FUNCTIONS_INDEX_SOURCE.indexOf(
      "async function persistApprovedCheckoutPreparation"
    );
    const persistenceEnd = FUNCTIONS_INDEX_SOURCE.indexOf(
      "async function prepareDepositCheckoutForApprovedSend",
      persistenceStart
    );
    const persistenceSource = FUNCTIONS_INDEX_SOURCE.slice(
      persistenceStart,
      persistenceEnd
    );

    expect(redactionStart).toBeGreaterThan(-1);
    expect(redactionSource).toContain("privateDepositLink: _privateDepositLink");
    expect(redactionSource).toContain("url: _url");
    expect(redactionSource).toContain('depositLink: ""');
    for (const field of ["expectedPayment", "preparedPayment", "publishedPayment"]) {
      expect(redactionSource).toContain(
        `${field}: redactPaymentLink(safePreparation.${field})`
      );
    }
    expect(persistenceSource).toContain(
      "checkoutPreparation: redactCheckoutPreparation(preparation)"
    );
    expect(persistenceSource).toContain(
      "privateDepositLink: preparation.privateDepositLink"
    );
  });

  test("keeps post-create and preparation-persistence uncertainty resumable", () => {
    const callable = approvedPaymentRequestSource();
    const preparationStart = FUNCTIONS_INDEX_SOURCE.indexOf(
      "async function prepareCheckoutForApprovedSend"
    );
    const preparationEnd = FUNCTIONS_INDEX_SOURCE.indexOf(
      "async function reconcileCheckout",
      preparationStart
    );
    const preparationSource = FUNCTIONS_INDEX_SOURCE.slice(
      preparationStart,
      preparationEnd
    );

    expect(callable).toContain("await persistApprovedCheckoutPreparation");
    expect(callable).toContain("await recoverPersistedApprovedCheckoutPreparation");
    expect(callable).toContain("checkout_preparation_persistence_ambiguous");
    expect(callable).toContain(
      'normalizeText(err?.paymentCheckoutOutcome).toLowerCase()\n      === "ambiguous"'
    );
    expect(callable).toContain("|| checkoutPreparationAmbiguous");
    expect(callable).toContain(
      "Stripe checkout preparation is uncertain. Retry the same approved payment request"
    );

    expect(preparationSource).toContain(
      "if (!isAmbiguousStripeProviderError(err)) throw err"
    );
    expect(preparationSource).toContain("post_create_provider_cleanup_ambiguous");
    expect(preparationSource).toContain("post_create_generation_cleanup_ambiguous");
    expect(preparationSource).toContain("annotatePaymentCheckoutOutcome");

    const cleanupStart = callable.indexOf("let checkoutCleanupIncomplete = false");
    const cleanupSource = callable.slice(cleanupStart);
    const preparedToExpired = cleanupSource.indexOf(
      "await markPreparedCheckoutExpiredIfUnchanged"
    );
    const expectedToAdvanced = cleanupSource.indexOf(
      "await advanceCheckoutGenerationIfUnchanged"
    );
    const authoritativeConfirmation = cleanupSource.indexOf(
      "await isCheckoutCleanupStateResolved"
    );
    const failureUnlock = cleanupSource.indexOf(
      "const outcome = buildApprovalExecutionOutcome"
    );

    expect(cleanupStart).toBeGreaterThan(-1);
    expect(preparedToExpired).toBeGreaterThan(-1);
    expect(expectedToAdvanced).toBeGreaterThan(preparedToExpired);
    expect(authoritativeConfirmation).toBeGreaterThan(expectedToAdvanced);
    expect(failureUnlock).toBeGreaterThan(authoritativeConfirmation);
    expect(cleanupSource.slice(preparedToExpired, expectedToAdvanced)).toContain(
      "if (!cleanupResolved)"
    );
    expect(cleanupSource.slice(expectedToAdvanced, authoritativeConfirmation)).toContain(
      "if (!cleanupResolved)"
    );
    expect(cleanupSource.slice(authoritativeConfirmation, failureUnlock)).toContain(
      "checkoutCleanupIncomplete = !cleanupResolved"
    );
  });

  test("replays a concurrent successful execution before any failure cleanup", () => {
    const callable = approvedPaymentRequestSource();
    const executionRecheck = callable.indexOf(
      "const latestExecutionSnap = await executionRef.get()"
    );
    const successfulReplay = callable.indexOf('if (latestState === "succeeded")');
    const cleanup = callable.indexOf("await neutralizeRejectedStripeCheckout");

    expect(executionRecheck).toBeGreaterThan(-1);
    expect(successfulReplay).toBeGreaterThan(executionRecheck);
    expect(cleanup).toBeGreaterThan(successfulReplay);
    expect(callable.slice(successfulReplay, cleanup)).toContain("idempotent: true");
    expect(callable).toContain("&& !executionAlreadyFinalized");
    expect(callable).toContain("|| executionStateUncertain");
  });

  test("locks quote edits, reopen, and portal rotation while payment dispatch is unresolved", () => {
    const editStart = FUNCTIONS_INDEX_SOURCE.indexOf(
      "async function updateTrustedQuoteDraftInternal"
    );
    const editEnd = FUNCTIONS_INDEX_SOURCE.indexOf(
      "function quoteCreationFailure",
      editStart
    );
    const editSource = FUNCTIONS_INDEX_SOURCE.slice(editStart, editEnd);
    const reopenSource = callableSource("reopenQuote", "rotateQuotePortalKey");
    const rotationSource = callableSource(
      "rotateQuotePortalKey",
      "notifyOwnerNewQuote"
    );

    expect(editStart).toBeGreaterThan(-1);
    expect(editSource).toContain(
      'assertNoInProgressPaymentDispatch(quote, "editing the quote")'
    );
    expect(editSource.indexOf("assertNoInProgressPaymentDispatch")).toBeLessThan(
      editSource.indexOf("tx.update(quoteRef")
    );

    expect(reopenSource).toContain(
      'assertNoInProgressPaymentDispatch(quote, "reopening the quote")'
    );
    expect(reopenSource.indexOf("assertNoInProgressPaymentDispatch")).toBeLessThan(
      reopenSource.indexOf("buildQuoteReopenDocuments")
    );

    expect(rotationSource).toContain(
      'assertNoInProgressPaymentDispatch(quote, "rotating the portal link")'
    );
    expect(rotationSource.indexOf("assertNoInProgressPaymentDispatch")).toBeLessThan(
      rotationSource.indexOf("buildPortalRotationDocuments")
    );
  });

  test("reconciles every material checkout before portal rotation and survives concurrent expiry", () => {
    const resolverStart = FUNCTIONS_INDEX_SOURCE.indexOf(
      "async function resolveCheckoutRailBeforePortalRotation"
    );
    const callableStart = FUNCTIONS_INDEX_SOURCE.indexOf("exports.rotateQuotePortalKey =");
    const resolverSource = FUNCTIONS_INDEX_SOURCE.slice(resolverStart, callableStart);
    const rotationSource = callableSource("rotateQuotePortalKey", "notifyOwnerNewQuote");

    expect(resolverStart).toBeGreaterThan(-1);
    expect(resolverSource).toContain("portalRotationPaymentKinds(options.quote)");
    expect(resolverSource).toContain("await stripe.checkout.sessions.expire(stripeSessionId)");
    expect(resolverSource).toContain("const observedAfterConflict = await stripe.checkout.sessions.retrieve");
    expect(resolverSource.indexOf("observedAfterConflict")).toBeGreaterThan(
      resolverSource.indexOf("catch (expirationError)")
    );

    const preflight = rotationSource.indexOf("buildApprovalExecutionStart({");
    const providerReconciliation = rotationSource.indexOf(
      "await resolveCheckoutBeforePortalRotation"
    );
    const transaction = rotationSource.indexOf("await db.runTransaction");
    const invalidation = rotationSource.indexOf(
      "invalidatePaymentApprovalsForPortalRotation"
    );
    const portalWrite = rotationSource.indexOf("tx.create(newPortalRef");
    expect(preflight).toBeGreaterThan(-1);
    expect(providerReconciliation).toBeGreaterThan(preflight);
    expect(transaction).toBeGreaterThan(providerReconciliation);
    expect(invalidation).toBeGreaterThan(transaction);
    expect(portalWrite).toBeGreaterThan(invalidation);
  });

  test.each([
    ["operation", { operationId: "another-approval" }],
    ["actor", { actorUid: "another-admin" }],
    ["scope", { actionScopeDigest: "b".repeat(64) }],
    ["idempotency key", { idempotencyKey: "another-provider-key" }]
  ])("rejects resume with changed %s identity", (_label, changed) => {
    expect(() => planPaymentDispatchResume({
      executionState: "in_progress",
      dispatch: start(),
      ...identity,
      ...changed
    })).toThrowError(PaymentDispatchStateError);
  });

  test("fails closed on incomplete stored provider acceptance evidence", () => {
    expect(() => planPaymentDispatchResume({
      executionState: "in_progress",
      dispatch: {
        ...start(),
        state: "provider_accepted",
        provider: "resend",
        providerMessageId: "",
        providerAcceptedAtISO: LATER
      },
      ...identity
    })).toThrowError(/provider-accepted payment dispatch evidence is incomplete/i);
  });

  test("classifies existing quote-delivery ambiguity annotations for direct integration", () => {
    expect(classifyPaymentDispatchError(providerError("fetch failed", {
      quoteDeliveryOutcome: "ambiguous",
      quoteDeliveryReason: "provider_network_error"
    }))).toEqual({
      outcome: "ambiguous",
      reason: "provider_network_error",
      providerHttpStatus: 0
    });
  });
});
