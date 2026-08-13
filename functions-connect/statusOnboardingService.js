"use strict";

const {
  StripeConnectInterfaceError,
  assertAuthenticatedAdmin,
  assertCanonicalOwner,
  assertConsumedAppCheck,
  assertRecentAuthentication,
  buildConnectMutationReceiptV1,
  buildStripeConnectStatusV1,
  normalizeMutationRequest,
  normalizeStatusRequest
} = require("./interfaceContracts");
const { prepareOneUseOnboardingHandoff } = require("./onboardingHandoff");

function fail(code, message) {
  throw new StripeConnectInterfaceError(code, message);
}

function requireFunction(value, name) {
  if (typeof value !== "function") fail("internal", `${name} is unavailable.`);
  return value;
}

function createStripeConnectStatusOnboardingService({
  repository,
  provider,
  rateLimiter,
  principalHasher,
  hmacKey,
  canonicalReturnOrigin,
  now = () => Date.now()
} = {}) {
  if (!repository || !provider || !rateLimiter) fail("internal", "Stripe Connect service dependencies are unavailable.");
  const readAuthority = requireFunction(repository.readAuthority, "Connect authority projection");
  const readStatus = requireFunction(repository.readStatus, "Connect status projection");
  const findMutationReceipt = requireFunction(repository.findMutationReceipt, "Connect mutation receipt lookup");
  const reserveOnboarding = requireFunction(repository.reserveOnboarding, "Connect onboarding reservation");
  const completeOnboarding = requireFunction(repository.completeOnboarding, "Connect onboarding completion");
  const savePreparedHandoff = requireFunction(repository.savePreparedHandoff, "Connect onboarding handoff store");
  const refreshStatusRecord = requireFunction(repository.refreshStatus, "Connect status refresh store");
  const consumeRateLimit = requireFunction(rateLimiter.consume, "Connect rate limiter");
  const hashPrincipal = requireFunction(principalHasher, "Connect principal hasher");
  const createMerchantAccount = requireFunction(provider.createMerchantAccount, "Stripe merchant-account adapter");
  const retrieveMerchantAccount = requireFunction(provider.retrieveMerchantAccount, "Stripe status adapter");

  async function resolveActor(request) {
    const actor = assertAuthenticatedAdmin(request?.auth);
    const authority = await readAuthority(actor.organizationId);
    if (!authority || authority.organizationId !== actor.organizationId) {
      fail("failed-precondition", "Stripe authority is not available for this organization.");
    }
    return Object.freeze({ actor, authority });
  }

  async function consumeActorRateLimit(operation, actor) {
    const principalDigest = await hashPrincipal({
      operation,
      organizationId: actor.organizationId,
      uid: actor.uid
    });
    if (!/^[a-f0-9]{64}$/.test(String(principalDigest || ""))) {
      fail("internal", "The Connect rate-limit principal could not be protected.");
    }
    await consumeRateLimit({
      operation,
      organizationId: actor.organizationId,
      principalDigest,
      nowISO: new Date(now()).toISOString()
    });
  }

  async function getStripeConnectStatus(request = {}) {
    normalizeStatusRequest(request.data || {});
    const { actor, authority } = await resolveActor(request);
    const record = await readStatus(actor.organizationId);
    return buildStripeConnectStatusV1({ actor, authority, record: record || {}, nowMs: now() });
  }

  async function refreshStripeConnectStatus(request = {}) {
    const input = normalizeMutationRequest(request.data || {}, "refreshStripeConnectStatus");
    const { actor, authority } = await resolveActor(request);
    await consumeActorRateLimit("refresh_status", actor);
    const current = await readStatus(actor.organizationId);
    if (Number(current?.revision || 0) !== input.expectedRevision || Number(current?.generation || 0) !== input.expectedGeneration) {
      fail("aborted", "Stripe status changed. Refresh before requesting another provider read.");
    }
    if (!current?.privateAccountBinding) {
      return buildStripeConnectStatusV1({ actor, authority, record: current || {}, nowMs: now() });
    }
    const observation = await retrieveMerchantAccount({
      privateAccountBinding: current.privateAccountBinding,
      operationDigest: input.payloadDigest
    });
    const refreshed = await refreshStatusRecord({
      organizationId: actor.organizationId,
      expectedRevision: input.expectedRevision,
      expectedGeneration: input.expectedGeneration,
      observation,
      refreshedAtISO: new Date(now()).toISOString()
    });
    return buildStripeConnectStatusV1({ actor, authority, record: refreshed, nowMs: now() });
  }

  async function beginStripeConnectOnboarding(request = {}) {
    const input = normalizeMutationRequest(request.data || {}, "beginStripeConnectOnboarding");
    const { actor, authority } = await resolveActor(request);
    assertCanonicalOwner(actor, authority);
    assertRecentAuthentication(actor, now());
    assertConsumedAppCheck(request.app);
    const existing = await findMutationReceipt({
      organizationId: actor.organizationId,
      operation: "beginStripeConnectOnboarding",
      requestId: input.requestId
    });
    if (existing) {
      if (existing.payloadDigest !== input.payloadDigest) fail("already-exists", "requestId was already used for another onboarding request.");
      return existing.publicReceipt;
    }
    await consumeActorRateLimit("begin_onboarding", actor);
    const reservation = await reserveOnboarding({
      organizationId: actor.organizationId,
      actorUid: actor.uid,
      actorEmail: actor.email,
      input,
      reservedAtISO: new Date(now()).toISOString()
    });
    const providerAccount = await createMerchantAccount({
      idempotencyKey: reservation.providerIdempotencyKey,
      country: "US",
      currency: "usd",
      dashboard: "full",
      feesCollector: "stripe",
      lossesCollector: "stripe",
      capabilities: Object.freeze({ cardPayments: "requested" }),
      contactEmail: actor.email
    });
    const completedAtISO = new Date(now()).toISOString();
    const publicReceipt = buildConnectMutationReceiptV1({
      operation: "beginStripeConnectOnboarding",
      request: input,
      outcome: reservation.outcome,
      completedAtISO
    });
    await completeOnboarding({
      organizationId: actor.organizationId,
      reservation,
      providerAccount,
      publicReceipt,
      completedAtISO
    });
    return publicReceipt;
  }

  async function prepareStripeConnectOnboardingRedirect(request = {}) {
    const input = normalizeMutationRequest(request.data || {}, "prepareStripeConnectOnboardingRedirect");
    const { actor, authority } = await resolveActor(request);
    assertCanonicalOwner(actor, authority);
    assertConsumedAppCheck(request.app);
    const current = await readStatus(actor.organizationId);
    if (
      Number(current?.revision || 0) !== input.expectedRevision
      || Number(current?.generation || 0) !== input.expectedGeneration
      || !current?.privateAccountBinding
    ) {
      fail("aborted", "Stripe onboarding state changed. Refresh before continuing.");
    }
    await consumeActorRateLimit("prepare_onboarding_redirect", actor);
    const handoff = prepareOneUseOnboardingHandoff({
      organizationId: actor.organizationId,
      generation: input.expectedGeneration,
      revision: input.expectedRevision,
      requestId: input.requestId,
      payloadDigest: input.payloadDigest,
      canonicalReturnOrigin,
      hmacKey,
      nowMs: now()
    });
    await savePreparedHandoff(handoff.privateRecord);
    return handoff.browser;
  }

  return Object.freeze({
    getStripeConnectStatus,
    refreshStripeConnectStatus,
    beginStripeConnectOnboarding,
    prepareStripeConnectOnboardingRedirect
  });
}

module.exports = { createStripeConnectStatusOnboardingService };
