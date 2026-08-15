"use strict";

const {
  StripeConnectInterfaceError,
  assertAppCheck,
  assertAuthenticatedAdmin,
  assertCanonicalOwner,
  assertConsumedAppCheck,
  assertRecentAuthentication,
  buildStripeConnectStatusV1,
  canonicalJson,
  normalizeMutationRequest,
  normalizeStatusRequest,
  sha256
} = require("./interfaceContracts");
const { assertProjectedConnectAdmin } = require("./authorityProjection");
const {
  buildConnectCommandPayloadDigest
} = require("./connectCommandContracts");
const {
  buildOnboardingHandoffBrowser,
  prepareOneUseOnboardingHandoff
} = require("./onboardingHandoff");
const { REVIEWED_CONFIGURATION_DIGEST } = require("./providerModel");

const CONNECT_EDGE_RESPONSE_SCHEMA_VERSION = 1;

function fail(code, message) {
  throw new StripeConnectInterfaceError(code, message);
}

function requireFunction(value, name) {
  if (typeof value !== "function") fail("internal", `${name} is unavailable.`);
  return value;
}

function commandPayloadDigest(operation, payload) {
  return buildConnectCommandPayloadDigest({ operation, payload });
}

function operationResponse({ operation, requestId, revision, generation, state, command = null, receipt = null }) {
  return Object.freeze({
    schemaVersion: CONNECT_EDGE_RESPONSE_SCHEMA_VERSION,
    operation,
    requestId,
    revision: Number(revision),
    generation: Number(generation),
    state,
    command,
    receipt
  });
}

function createStripeConnectStatusOnboardingCommandEdgeService({
  repository,
  commandEdge,
  rateLimiter,
  principalHasher,
  hmacKey,
  expectedAppId,
  canonicalReturnOrigin,
  now = () => Date.now()
} = {}) {
  if (!repository || !commandEdge || !rateLimiter) {
    fail("internal", "Stripe Connect edge dependencies are unavailable.");
  }
  const readAuthority = requireFunction(repository.readAuthority, "Connect authority projection");
  const readStatus = requireFunction(repository.readStatus, "Connect status projection");
  const findMutationReceipt = requireFunction(repository.findMutationReceipt, "Connect mutation receipt lookup");
  const reserveOnboarding = requireFunction(repository.reserveOnboarding, "Connect onboarding reservation");
  const savePreparedHandoff = requireFunction(repository.savePreparedHandoff, "Connect onboarding handoff store");
  const enqueueCommand = requireFunction(commandEdge.enqueueCommand, "Connect provider command enqueue");
  const consumeRateLimit = requireFunction(rateLimiter.consume, "Connect rate limiter");
  const hashPrincipal = requireFunction(principalHasher, "Connect principal hasher");

  async function resolveActor(request) {
    const actor = assertAuthenticatedAdmin(request?.auth);
    const authority = await readAuthority(actor.organizationId);
    if (!authority || authority.organizationId !== actor.organizationId) {
      fail("failed-precondition", "Stripe authority is not available for this organization.");
    }
    const current = assertProjectedConnectAdmin(actor, authority, now());
    return Object.freeze({ actor, authority: current.projection });
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
      nowISO: new Date(Number(now())).toISOString()
    });
  }

  async function getStripeConnectStatus(request = {}) {
    normalizeStatusRequest(request.data || {});
    assertAppCheck(request.app, expectedAppId);
    const { actor, authority } = await resolveActor(request);
    const record = await readStatus(actor.organizationId);
    return buildStripeConnectStatusV1({ actor, authority, record: record || {}, nowMs: now() });
  }

  async function beginStripeConnectOnboarding(request = {}) {
    const input = normalizeMutationRequest(request.data || {}, "beginStripeConnectOnboarding");
    const { actor, authority } = await resolveActor(request);
    assertCanonicalOwner(actor, authority);
    assertRecentAuthentication(actor, now());
    assertConsumedAppCheck(request.app, expectedAppId);

    const existing = await findMutationReceipt({
      organizationId: actor.organizationId,
      operation: "beginStripeConnectOnboarding",
      requestId: input.requestId
    });
    if (existing) {
      if (existing.payloadDigest !== input.payloadDigest) {
        fail("already-exists", "requestId was already used for another onboarding request.");
      }
      return operationResponse({
        operation: "beginStripeConnectOnboarding",
        requestId: input.requestId,
        revision: existing.publicReceipt.revision,
        generation: existing.publicReceipt.generation,
        state: "completed",
        receipt: existing.publicReceipt
      });
    }

    await consumeActorRateLimit("begin_onboarding", actor);
    const reservation = await reserveOnboarding({
      organizationId: actor.organizationId,
      actorUid: actor.uid,
      actorEmail: actor.email,
      authorityPayloadDigest: authority.payloadDigest,
      input,
      reservedAtISO: new Date(Number(now())).toISOString()
    });
    const payload = Object.freeze({
      authorityPayloadDigest: authority.payloadDigest,
      configurationDigest: REVIEWED_CONFIGURATION_DIGEST,
      contactEmailDigest: sha256(actor.email),
      reservationDigest: reservation.reservationId
    });
    const command = await enqueueCommand({
      organizationId: actor.organizationId,
      operation: "create_merchant_account",
      requestId: input.requestId,
      expectedRevision: reservation.outcome.revision,
      connectionGeneration: reservation.outcome.generation,
      payload,
      payloadDigest: commandPayloadDigest("create_merchant_account", payload)
    });
    return operationResponse({
      operation: "beginStripeConnectOnboarding",
      requestId: input.requestId,
      revision: reservation.outcome.revision,
      generation: reservation.outcome.generation,
      state: command.state,
      command
    });
  }

  async function refreshStripeConnectStatus(request = {}) {
    const input = normalizeMutationRequest(request.data || {}, "refreshStripeConnectStatus");
    assertConsumedAppCheck(request.app, expectedAppId);
    const { actor, authority } = await resolveActor(request);
    await consumeActorRateLimit("refresh_status", actor);
    const current = await readStatus(actor.organizationId);
    if (
      Number(current?.revision || 0) !== input.expectedRevision
      || Number(current?.generation || 0) !== input.expectedGeneration
    ) {
      fail("aborted", "Stripe status changed. Refresh before requesting another provider read.");
    }
    if (!current?.privateAccountBinding) {
      return operationResponse({
        operation: "refreshStripeConnectStatus",
        requestId: input.requestId,
        revision: input.expectedRevision,
        generation: input.expectedGeneration,
        state: "cached"
      });
    }
    const payload = Object.freeze({
      accountBindingDigest: sha256(canonicalJson(current.privateAccountBinding)),
      authorityPayloadDigest: authority.payloadDigest
    });
    const command = await enqueueCommand({
      organizationId: actor.organizationId,
      operation: "refresh_merchant_account",
      requestId: input.requestId,
      expectedRevision: input.expectedRevision,
      connectionGeneration: input.expectedGeneration,
      payload,
      payloadDigest: commandPayloadDigest("refresh_merchant_account", payload)
    });
    return operationResponse({
      operation: "refreshStripeConnectStatus",
      requestId: input.requestId,
      revision: input.expectedRevision,
      generation: input.expectedGeneration,
      state: command.state,
      command
    });
  }

  async function prepareStripeConnectOnboardingRedirect(request = {}) {
    const input = normalizeMutationRequest(request.data || {}, "prepareStripeConnectOnboardingRedirect");
    const { actor, authority } = await resolveActor(request);
    assertCanonicalOwner(actor, authority);
    assertRecentAuthentication(actor, now());
    const appCheck = assertConsumedAppCheck(request.app, expectedAppId);
    const current = await readStatus(actor.organizationId);
    if (
      Number(current?.revision || 0) !== input.expectedRevision
      || Number(current?.generation || 0) !== input.expectedGeneration
      || !current?.privateAccountBinding
      || !["onboarding", "pending_review", "attention_required"].includes(
        String(current?.connectionState || "").trim().toLowerCase()
      )
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
      ownerUid: actor.uid,
      authorityRevision: authority.authorityRevision,
      appIdDigest: sha256(appCheck.appId),
      canonicalReturnOrigin,
      hmacKey,
      nowMs: now()
    });
    const savedHandoff = await savePreparedHandoff(handoff.privateRecord);
    return buildOnboardingHandoffBrowser({
      privateRecord: savedHandoff || handoff.privateRecord,
      canonicalReturnOrigin,
      hmacKey
    });
  }

  return Object.freeze({
    beginStripeConnectOnboarding,
    getStripeConnectStatus,
    prepareStripeConnectOnboardingRedirect,
    refreshStripeConnectStatus
  });
}

module.exports = {
  CONNECT_EDGE_RESPONSE_SCHEMA_VERSION,
  createStripeConnectStatusOnboardingCommandEdgeService,
  operationResponse
};
