"use strict";

const { createHash } = require("node:crypto");
const { canonicalJson, StripeConnectInterfaceError } = require("./interfaceContracts");
const { normalizeConnectAuthorityProjection } = require("./authorityProjection");
const { HANDOFF_SCHEMA_VERSION } = require("./onboardingHandoff");
const { REVIEWED_CONFIGURATION_DIGEST } = require("./providerModel");
const { CONNECT_DATABASE_ID } = require("./runtimePolicy");

const CONNECT_CONTROL_SCHEMA_VERSION = 1;
const PROVIDER_RECOVERY_WINDOW_SECONDS = 30 * 24 * 60 * 60;
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,160}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const PROVIDER_ACCOUNT_PATTERN = /^acct_[A-Za-z0-9]{8,255}$/;

const COLLECTIONS = Object.freeze({
  authorities: "connectOrganizationAuthorities",
  authorityProjectionReceipts: "connectAuthorityProjectionReceipts",
  organizations: "connectOrganizations",
  mutationReceipts: "connectMutationReceipts",
  accountBindings: "connectAccountBindings",
  providerQuarantines: "connectProviderQuarantines",
  onboardingHandoffs: "connectOnboardingHandoffs",
  onboardingHandoffReceipts: "connectOnboardingHandoffReceipts",
  rateLimits: "connectRateLimitBuckets"
});

function fail(code, message) {
  throw new StripeConnectInterfaceError(code, message);
}

function text(value, max = 512) {
  return String(value || "").trim().slice(0, max);
}

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function safeId(value, label) {
  const normalized = text(value, 160);
  if (!SAFE_ID_PATTERN.test(normalized)) fail("invalid-argument", `${label} is invalid.`);
  return normalized;
}

function digest(value, label) {
  const normalized = text(value, 64).toLowerCase();
  if (!DIGEST_PATTERN.test(normalized)) fail("invalid-argument", `${label} is invalid.`);
  return normalized;
}

function safeInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) fail("invalid-argument", `${label} is invalid.`);
  return parsed;
}

function iso(value, label) {
  const parsed = Date.parse(text(value, 64));
  if (!Number.isFinite(parsed)) fail("invalid-argument", `${label} is invalid.`);
  return new Date(parsed).toISOString();
}

function snapshotData(snapshot) {
  return snapshot?.exists ? snapshot.data() : null;
}

function requireDatabase(database) {
  if (!database || typeof database.doc !== "function" || typeof database.runTransaction !== "function") {
    fail("internal", "The isolated Connect database is unavailable.");
  }
  return database;
}

function createNamedConnectControlDatabase({ firebaseApp, getFirestore, databaseId } = {}) {
  if (databaseId !== CONNECT_DATABASE_ID) {
    fail("failed-precondition", "The Connect repository must use the isolated connect-control database.");
  }
  if (typeof getFirestore !== "function") fail("internal", "The named Firestore selector is unavailable.");
  return requireDatabase(getFirestore(firebaseApp, CONNECT_DATABASE_ID));
}

function receiptDocumentId({ organizationId, operation, requestId }) {
  return sha256(`connect-receipt-v1\n${organizationId}\n${operation}\n${requestId}`);
}

function bindingDocumentId({ platformAccountBinding, providerMode, privateAccountId }) {
  return sha256(`connect-binding-v1\n${platformAccountBinding}\n${providerMode}\n${privateAccountId}`);
}

function reservationId({ organizationId, input }) {
  return sha256(`connect-onboarding-v1\n${organizationId}\n${input.requestId}\n${input.payloadDigest}`);
}

function authorityProjectionReceiptDocumentId({ organizationId, authorityRevision }) {
  return sha256(`connect-authority-projection-v1\n${organizationId}\n${authorityRevision}`);
}

function handoffRequestReceiptDocumentId({ organizationId, requestId }) {
  return sha256(`connect-onboarding-handoff-request-v1\n${organizationId}\n${requestId}`);
}

function providerQuarantineDocumentId({ organizationId, requestDigest }) {
  return sha256(`connect-provider-quarantine-v1\n${organizationId}\n${requestDigest}`);
}

function normalizeProviderAccount(providerAccount = {}) {
  const privateAccountId = text(providerAccount.privateAccountId, 255);
  const providerMode = text(providerAccount.providerMode, 32).toLowerCase();
  const platformAccountBinding = text(providerAccount.platformAccountBinding, 255);
  const configurationDigest = digest(providerAccount.configurationDigest, "provider configuration digest");
  if (!PROVIDER_ACCOUNT_PATTERN.test(privateAccountId)) {
    fail("failed-precondition", "The provider account identity is invalid.");
  }
  if (
    providerMode !== "sandbox"
    || !PROVIDER_ACCOUNT_PATTERN.test(platformAccountBinding)
    || configurationDigest !== REVIEWED_CONFIGURATION_DIGEST
  ) {
    fail("failed-precondition", "The provider account is not bound to the reviewed Sandbox platform.");
  }
  return Object.freeze({ privateAccountId, providerMode, platformAccountBinding, configurationDigest });
}

function normalizePrivateProviderEvidence(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid-argument", "The private provider quarantine evidence is invalid.");
  }
  const actual = Object.keys(value).sort();
  const expected = [
    "configurationDigest",
    "platformAccountBinding",
    "privateAccountId",
    "providerMode",
    "providerResponseDigest",
    "reviewReason"
  ].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("invalid-argument", "The private provider quarantine evidence contains unsupported fields.");
  }
  const privateAccountId = text(value.privateAccountId, 255);
  const providerMode = text(value.providerMode, 32).toLowerCase();
  const platformAccountBinding = text(value.platformAccountBinding, 255);
  const reviewReason = text(value.reviewReason, 64).toLowerCase();
  if (
    !PROVIDER_ACCOUNT_PATTERN.test(privateAccountId)
    || !["sandbox", "live", "unknown"].includes(providerMode)
    || !PROVIDER_ACCOUNT_PATTERN.test(platformAccountBinding)
    || !/^[a-z0-9_-]{1,64}$/.test(reviewReason)
  ) {
    fail("invalid-argument", "The private provider quarantine identity is invalid.");
  }
  return Object.freeze({
    privateAccountId,
    providerMode,
    platformAccountBinding,
    configurationDigest: digest(value.configurationDigest, "quarantine configuration digest"),
    providerResponseDigest: digest(value.providerResponseDigest, "provider response digest"),
    reviewReason
  });
}

function normalizeStoredQuarantineOccurrence(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("data-loss", "The private provider quarantine occurrence is unavailable.");
  }
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [
    "bindingConflict",
    "bindingId",
    "generation",
    "occurrenceDigest",
    "occurrenceId",
    "operation",
    "organizationId",
    "privateProviderEvidence",
    "providerReferenceDigest",
    "quarantinedAtISO",
    "reasonDigest",
    "requestDigest",
    "safeCode",
    "schemaVersion"
  ].sort();
  if (
    actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])
    || Number(value.schemaVersion) !== CONNECT_CONTROL_SCHEMA_VERSION
    || value.bindingConflict !== true && value.bindingConflict !== false
  ) {
    fail("data-loss", "The private provider quarantine occurrence shape is invalid.");
  }
  const evidence = normalizePrivateProviderEvidence(value.privateProviderEvidence);
  const providerReferenceDigest = evidence
    ? sha256(`stripe-connect-provider-account-v1\n${evidence.privateAccountId}`)
    : "";
  const bindingId = evidence ? bindingDocumentId(evidence) : "";
  const occurrenceCore = {
    schemaVersion: CONNECT_CONTROL_SCHEMA_VERSION,
    occurrenceId: digest(value.occurrenceId, "provider quarantine occurrenceId"),
    organizationId: safeId(value.organizationId, "provider quarantine organizationId"),
    generation: safeInteger(value.generation, "provider quarantine generation"),
    operation: safeId(value.operation, "provider quarantine operation"),
    requestDigest: digest(value.requestDigest, "provider quarantine request digest"),
    reasonDigest: digest(value.reasonDigest, "provider quarantine reason digest"),
    safeCode: text(value.safeCode, 64).toLowerCase(),
    providerReferenceDigest,
    bindingId,
    bindingConflict: value.bindingConflict,
    privateProviderEvidence: evidence,
    quarantinedAtISO: iso(value.quarantinedAtISO, "provider quarantine timestamp")
  };
  if (!/^[a-z0-9_-]{1,64}$/.test(occurrenceCore.safeCode)) {
    fail("data-loss", "The private provider quarantine safe code is invalid.");
  }
  const occurrenceDigest = sha256(canonicalJson(occurrenceCore));
  if (
    occurrenceCore.occurrenceId !== expected.occurrenceId
    || occurrenceCore.organizationId !== expected.organizationId
    || occurrenceCore.generation !== expected.generation
    || occurrenceCore.operation !== expected.operation
    || occurrenceCore.requestDigest !== expected.requestDigest
    || occurrenceCore.reasonDigest !== expected.reasonDigest
    || occurrenceCore.safeCode !== expected.safeCode
    || value.providerReferenceDigest !== providerReferenceDigest
    || value.bindingId !== bindingId
    || value.quarantinedAtISO !== occurrenceCore.quarantinedAtISO
    || value.occurrenceDigest !== occurrenceDigest
  ) {
    fail("data-loss", "The private provider quarantine occurrence is inconsistent.");
  }
  return Object.freeze({ ...occurrenceCore, occurrenceDigest });
}

function assertStoredQuarantineBinding(occurrence, binding) {
  const evidence = occurrence.privateProviderEvidence;
  if (!evidence) {
    if (binding) fail("data-loss", "A provider-free quarantine has an unexpected account claim.");
    return;
  }
  if (
    !binding
    || binding.bindingId !== occurrence.bindingId
    || binding.privateAccountId !== evidence.privateAccountId
    || binding.providerMode !== evidence.providerMode
    || binding.platformAccountBinding !== evidence.platformAccountBinding
    || !["bound", "quarantined"].includes(binding.claimState)
  ) {
    fail("data-loss", "The quarantined provider account claim is unavailable or inconsistent.");
  }
  if (!occurrence.bindingConflict && (
    binding.organizationId !== occurrence.organizationId
    || Number(binding.generation) !== occurrence.generation
    || binding.configurationDigest !== evidence.configurationDigest
    || binding.claimState !== "quarantined"
  )) {
    fail("data-loss", "The quarantined provider account claim lost its exact tenant binding.");
  }
}

function normalizeObservation(observation = {}) {
  const allowedConnectionStates = new Set([
    "onboarding", "pending_review", "ready", "attention_required", "access_lost", "closed", "security_review"
  ]);
  const allowedRequirementStates = new Set(["unknown", "clear", "due", "past_due", "unavailable"]);
  const allowedHealthStates = new Set(["unknown", "healthy", "attention", "unavailable"]);
  const connectionState = text(observation.connectionState, 64).toLowerCase();
  const requirementState = text(observation.requirementState, 64).toLowerCase();
  const healthState = text(observation.healthState, 64).toLowerCase();
  if (!allowedConnectionStates.has(connectionState)
    || !allowedRequirementStates.has(requirementState)
    || !allowedHealthStates.has(healthState)) {
    fail("failed-precondition", "The provider status observation is invalid.");
  }
  return Object.freeze({
    connectionState,
    requirementState,
    currentlyDueCount: safeInteger(observation.currentlyDueCount, "currently due count"),
    pastDueCount: safeInteger(observation.pastDueCount, "past due count"),
    healthState,
    cardPaymentsState: text(observation.cardPaymentsState, 32).toLowerCase(),
    payoutsState: text(observation.payoutsState, 32).toLowerCase(),
    responsibilityState: text(observation.responsibilityState, 32).toLowerCase(),
    observationDigest: digest(observation.observationDigest, "provider observation digest")
  });
}

function normalizeProviderCommandIdentity(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid-argument", "The provider command identity is invalid.");
  }
  const actual = Object.keys(value).sort();
  const expected = ["commandId", "requestDigest"].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("invalid-argument", "The provider command identity contains unsupported fields.");
  }
  return Object.freeze({
    commandId: digest(value.commandId, "provider commandId"),
    requestDigest: digest(value.requestDigest, "provider requestDigest")
  });
}

function createConnectControlRepository({
  database,
  now = () => Date.now(),
  authorityPublisherIdentity = ""
} = {}) {
  const db = requireDatabase(database);
  if (typeof now !== "function") fail("internal", "The Connect repository clock is unavailable.");
  const expectedAuthorityPublisher = text(authorityPublisherIdentity, 320).toLowerCase();

  const authorityRef = (organizationId) => db.doc(`${COLLECTIONS.authorities}/${safeId(organizationId, "organizationId")}`);
  const organizationRef = (organizationId) => db.doc(`${COLLECTIONS.organizations}/${safeId(organizationId, "organizationId")}`);
  const receiptRef = ({ organizationId, operation, requestId }) => db.doc(
    `${COLLECTIONS.mutationReceipts}/${receiptDocumentId({
      organizationId: safeId(organizationId, "organizationId"),
      operation: safeId(operation, "operation"),
      requestId: safeId(requestId, "requestId")
    })}`
  );

  async function readAuthority(organizationId) {
    const id = safeId(organizationId, "organizationId");
    const record = snapshotData(await authorityRef(id).get());
    if (!record) return null;
    if (text(record.organizationId, 160) !== id || !record.projection) {
      fail("data-loss", "The Connect authority tenant binding is invalid.");
    }
    return normalizeConnectAuthorityProjection(record.projection, {
      nowMs: Number(now()),
      allowExpired: true
    });
  }

  async function applyAuthorityProjection({ projection, publisherIdentity, receivedAtISO } = {}) {
    if (!expectedAuthorityPublisher) {
      fail("failed-precondition", "The Connect authority publisher identity is not configured.");
    }
    const publisher = text(publisherIdentity, 320).toLowerCase();
    if (!publisher || publisher !== expectedAuthorityPublisher) {
      fail("permission-denied", "The Connect authority publisher identity is not authorized.");
    }
    const receivedAt = iso(receivedAtISO, "authority receivedAtISO");
    const normalized = normalizeConnectAuthorityProjection(projection, {
      nowMs: Date.parse(receivedAt)
    });
    const ref = authorityRef(normalized.organizationId);
    const receiptRef = db.doc(
      `${COLLECTIONS.authorityProjectionReceipts}/${authorityProjectionReceiptDocumentId(normalized)}`
    );
    return db.runTransaction(async (transaction) => {
      const [currentSnapshot, receiptSnapshot] = await Promise.all([
        transaction.get(ref),
        transaction.get(receiptRef)
      ]);
      const currentRecord = snapshotData(currentSnapshot);
      const priorReceipt = snapshotData(receiptSnapshot);
      if (priorReceipt) {
        if (
          priorReceipt.organizationId !== normalized.organizationId
          || Number(priorReceipt.authorityRevision) !== normalized.authorityRevision
          || priorReceipt.payloadDigest !== normalized.payloadDigest
        ) {
          fail("data-loss", "The Connect authority projection receipt binding is invalid.");
        }
        return Object.freeze({
          replayed: true,
          authorityRevision: normalized.authorityRevision,
          payloadDigest: normalized.payloadDigest
        });
      }

      let currentProjection = null;
      if (currentRecord) {
        if (currentRecord.organizationId !== normalized.organizationId || !currentRecord.projection) {
          fail("data-loss", "The Connect authority tenant binding is invalid.");
        }
        currentProjection = normalizeConnectAuthorityProjection(currentRecord.projection, {
          nowMs: Date.parse(receivedAt),
          allowExpired: true
        });
        if (currentProjection.authorityRevision > normalized.authorityRevision) {
          fail("aborted", "The Connect authority projection is older than current authority.");
        }
        if (currentProjection.authorityRevision === normalized.authorityRevision) {
          if (currentProjection.payloadDigest !== normalized.payloadDigest) {
            fail("already-exists", "The Connect authority revision belongs to another payload.");
          }
          fail("data-loss", "The current Connect authority projection is missing its immutable receipt.");
        }
        if (currentProjection.ownerUid !== normalized.ownerUid) {
          fail("failed-precondition", "Canonical owner replacement requires separate operator review.");
        }
      }

      const receipt = {
        schemaVersion: CONNECT_CONTROL_SCHEMA_VERSION,
        organizationId: normalized.organizationId,
        authorityRevision: normalized.authorityRevision,
        payloadDigest: normalized.payloadDigest,
        sourceReceiptId: normalized.sourceReceiptId,
        sourceReceiptDigest: normalized.sourceReceiptDigest,
        publisherIdentityDigest: sha256(publisher),
        receivedAtISO: receivedAt
      };
      transaction.create(receiptRef, receipt);
      transaction.set(ref, {
        schemaVersion: CONNECT_CONTROL_SCHEMA_VERSION,
        organizationId: normalized.organizationId,
        authorityRevision: normalized.authorityRevision,
        payloadDigest: normalized.payloadDigest,
        projection: normalized,
        publisherIdentityDigest: receipt.publisherIdentityDigest,
        receivedAtISO: receivedAt
      });
      return Object.freeze({
        replayed: false,
        authorityRevision: normalized.authorityRevision,
        payloadDigest: normalized.payloadDigest
      });
    });
  }

  async function readStatus(organizationId) {
    const id = safeId(organizationId, "organizationId");
    const record = snapshotData(await organizationRef(id).get());
    if (!record) return Object.freeze({
      schemaVersion: CONNECT_CONTROL_SCHEMA_VERSION,
      organizationId: id,
      revision: 0,
      generation: 0,
      connectionState: "not_started",
      routingState: "legacy_platform"
    });
    if (text(record.organizationId, 160) !== id) fail("data-loss", "The Connect status tenant binding is invalid.");
    return Object.freeze({ ...record });
  }

  async function findMutationReceipt({ organizationId, operation, requestId } = {}) {
    const ref = receiptRef({ organizationId, operation, requestId });
    const record = snapshotData(await ref.get());
    if (!record) return null;
    if (record.organizationId !== organizationId || record.operation !== operation || record.requestId !== requestId) {
      fail("data-loss", "The Connect mutation receipt binding is invalid.");
    }
    return Object.freeze({ payloadDigest: record.payloadDigest, publicReceipt: Object.freeze({ ...record.publicReceipt }) });
  }

  async function reserveOnboarding({
    organizationId,
    actorUid,
    actorEmail,
    authorityPayloadDigest,
    input,
    reservedAtISO
  } = {}) {
    const id = safeId(organizationId, "organizationId");
    const uid = safeId(actorUid, "actorUid");
    const email = text(actorEmail, 320).toLowerCase();
    const protectedAuthority = digest(authorityPayloadDigest, "authority payload digest");
    const reservedAt = iso(reservedAtISO, "reservedAtISO");
    if (!email || !input) fail("invalid-argument", "The onboarding reservation is incomplete.");
    const orgRef = organizationRef(id);
    return db.runTransaction(async (transaction) => {
      const current = snapshotData(await transaction.get(orgRef)) || {
        schemaVersion: CONNECT_CONTROL_SCHEMA_VERSION,
        organizationId: id,
        revision: 0,
        generation: 0,
        connectionState: "not_started",
        routingState: "legacy_platform"
      };
      if (current.organizationId !== id) fail("data-loss", "The Connect status tenant binding is invalid.");
      const requestedReservationId = reservationId({ organizationId: id, input });
      if (current.activeReservation) {
        if (
          current.activeReservation.actorUid !== uid
          || current.activeReservation.actorEmailDigest !== sha256(email)
          || current.activeReservation.authorityPayloadDigest !== protectedAuthority
        ) {
          transaction.set(orgRef, {
            ...current,
            connectionState: "security_review",
            updatedAtISO: new Date(Number(now())).toISOString()
          });
          return Object.freeze({ reviewRequired: true });
        }
        if (
          current.activeReservation.reservationId !== requestedReservationId
          || current.activeReservation.payloadDigest !== input.payloadDigest
        ) {
          fail("aborted", "Another Stripe onboarding operation is already reserved.");
        }
        const recoveryDeadline = Date.parse(current.activeReservation.providerRecoveryExpiresAtISO || "");
        if (!Number.isFinite(recoveryDeadline) || recoveryDeadline <= Number(now())) {
          transaction.set(orgRef, {
            ...current,
            connectionState: "security_review",
            updatedAtISO: new Date(Number(now())).toISOString()
          });
          return Object.freeze({ reviewRequired: true });
        }
        return Object.freeze({ ...current.activeReservation });
      }
      const expectedRevision = safeInteger(input.expectedRevision, "expectedRevision");
      const expectedGeneration = safeInteger(input.expectedGeneration, "expectedGeneration");
      if (Number(current.revision || 0) !== expectedRevision || Number(current.generation || 0) !== expectedGeneration) {
        fail("aborted", "Stripe onboarding state changed. Refresh before trying again.");
      }
      if (current.privateAccountBinding) {
        fail("failed-precondition", "This organization already has a protected Stripe account binding.");
      }
      if (!["not_started", "attention_required"].includes(text(current.connectionState, 64))) {
        fail("failed-precondition", "Stripe onboarding cannot start from the current connection state.");
      }
      const targetGeneration = expectedGeneration + 1;
      const nextRevision = expectedRevision + 1;
      const providerRecoveryExpiresAtISO = new Date(
        Date.parse(reservedAt) + PROVIDER_RECOVERY_WINDOW_SECONDS * 1000
      ).toISOString();
      const outcome = Object.freeze({ revision: nextRevision, generation: targetGeneration, state: "onboarding" });
      const reservation = Object.freeze({
        schemaVersion: CONNECT_CONTROL_SCHEMA_VERSION,
        reservationId: requestedReservationId,
        requestId: input.requestId,
        payloadDigest: input.payloadDigest,
        actorUid: uid,
        actorEmailDigest: sha256(email),
        authorityPayloadDigest: protectedAuthority,
        reservedAtISO: reservedAt,
        providerRecoveryExpiresAtISO,
        outcome
      });
      transaction.set(orgRef, {
        ...current,
        schemaVersion: CONNECT_CONTROL_SCHEMA_VERSION,
        organizationId: id,
        revision: nextRevision,
        generation: targetGeneration,
        connectionState: "provisioning",
        routingState: text(current.routingState, 64) || "legacy_platform",
        activeReservation: reservation,
        updatedAtISO: reservedAt
      });
      return reservation;
    }).then((result) => {
      if (result?.reviewRequired) fail("failed-precondition", "Stripe onboarding requires security review before recovery.");
      return result;
    });
  }

  async function completeOnboarding({
    organizationId,
    reservation,
    providerAccount,
    publicReceipt,
    providerCommandIdentity,
    completedAtISO
  } = {}) {
    const id = safeId(organizationId, "organizationId");
    const completedAt = iso(completedAtISO, "completedAtISO");
    const provider = normalizeProviderAccount(providerAccount);
    const commandIdentity = normalizeProviderCommandIdentity(providerCommandIdentity);
    if (!commandIdentity) fail("invalid-argument", "The onboarding provider command identity is required.");
    const orgRef = organizationRef(id);
    const providerBindingId = bindingDocumentId(provider);
    const bindingRef = db.doc(`${COLLECTIONS.accountBindings}/${providerBindingId}`);
    const authorityDocumentRef = authorityRef(id);
    const quarantineOccurrenceId = providerQuarantineDocumentId({
      organizationId: id,
      requestDigest: commandIdentity.requestDigest
    });
    const quarantineRef = db.doc(`${COLLECTIONS.providerQuarantines}/${quarantineOccurrenceId}`);
    const mutationRef = receiptRef({
      organizationId: id,
      operation: publicReceipt?.operation,
      requestId: publicReceipt?.requestId
    });
    const result = await db.runTransaction(async (transaction) => {
      const committedAtMs = Number(now());
      if (!Number.isFinite(committedAtMs)) fail("internal", "The Connect repository clock is invalid.");
      const committedAtISO = new Date(committedAtMs).toISOString();
      const [statusSnapshot, bindingSnapshot, receiptSnapshot, authoritySnapshot, quarantineSnapshot] = await Promise.all([
        transaction.get(orgRef),
        transaction.get(bindingRef),
        transaction.get(mutationRef),
        transaction.get(authorityDocumentRef),
        transaction.get(quarantineRef)
      ]);
      const current = snapshotData(statusSnapshot);
      const existingBinding = snapshotData(bindingSnapshot);
      const existingReceipt = snapshotData(receiptSnapshot);
      const authorityRecord = snapshotData(authoritySnapshot);
      const existingQuarantine = snapshotData(quarantineSnapshot);
      if (!current || current.organizationId !== id) {
        fail("aborted", "The Stripe onboarding organization is no longer current.");
      }
      if (existingReceipt) {
        if (
          existingReceipt.payloadDigest !== publicReceipt?.payloadDigest
          || existingReceipt.publicReceipt?.requestId !== publicReceipt?.requestId
          || Number(existingReceipt.publicReceipt?.generation) !== Number(publicReceipt?.generation)
        ) {
          fail("already-exists", "The onboarding request ID belongs to another payload.");
        }
        return Object.freeze({ publicReceipt: existingReceipt.publicReceipt });
      }
      if (!current.activeReservation) {
        fail("aborted", "The Stripe onboarding reservation is no longer current.");
      }
      if (
        current.activeReservation.reservationId !== reservation?.reservationId
        || current.activeReservation.payloadDigest !== publicReceipt?.payloadDigest
        || Number(current.generation) !== Number(publicReceipt?.generation)
        || Number(current.revision) !== Number(publicReceipt?.revision)
      ) {
        fail("aborted", "The Stripe onboarding completion does not match its reservation.");
      }
      let authority = null;
      try {
        authority = authorityRecord?.projection
          ? normalizeConnectAuthorityProjection(authorityRecord.projection, {
              nowMs: committedAtMs
            })
          : null;
      } catch {
        authority = null;
      }
      const owner = authority?.members?.find((member) => member.uid === authority.ownerUid);
      const authorityMatches = Boolean(
        authority
        && authority.organizationId === id
        && authority.payloadDigest === current.activeReservation.authorityPayloadDigest
        && authority.ownerUid === current.activeReservation.actorUid
        && owner
        && sha256(owner.email) === current.activeReservation.actorEmailDigest
      );
      const bindingConflict = Boolean(existingBinding && (
        existingBinding.organizationId !== id
        || Number(existingBinding.generation) !== Number(publicReceipt.generation)
        || existingBinding.privateAccountId !== provider.privateAccountId
        || existingBinding.providerMode !== provider.providerMode
        || existingBinding.platformAccountBinding !== provider.platformAccountBinding
        || existingBinding.configurationDigest !== provider.configurationDigest
        || existingBinding.claimState === "quarantined"
      ));
      if (!authorityMatches || bindingConflict) {
        const safeCode = authorityMatches
          ? "provider_binding_conflict"
          : "provider_authority_changed";
        const reasonDigest = sha256(JSON.stringify({
          schemaVersion: CONNECT_CONTROL_SCHEMA_VERSION,
          operation: "create_merchant_account",
          requestDigest: commandIdentity.requestDigest,
          safeCode
        }));
        const providerReferenceDigest = sha256(
          `stripe-connect-provider-account-v1\n${provider.privateAccountId}`
        );
        const privateEvidence = Object.freeze({
          privateAccountId: provider.privateAccountId,
          providerMode: provider.providerMode,
          platformAccountBinding: provider.platformAccountBinding,
          configurationDigest: provider.configurationDigest,
          providerResponseDigest: sha256(JSON.stringify({
            schemaVersion: CONNECT_CONTROL_SCHEMA_VERSION,
            privateAccountId: provider.privateAccountId,
            providerMode: provider.providerMode,
            configurationDigest: provider.configurationDigest
          })),
          reviewReason: safeCode
        });
        const occurrenceCore = {
          schemaVersion: CONNECT_CONTROL_SCHEMA_VERSION,
          occurrenceId: quarantineOccurrenceId,
          organizationId: id,
          generation: Number(publicReceipt.generation),
          operation: "create_merchant_account",
          requestDigest: commandIdentity.requestDigest,
          reasonDigest,
          safeCode,
          providerReferenceDigest,
          bindingId: providerBindingId,
          bindingConflict,
          privateProviderEvidence: privateEvidence,
          quarantinedAtISO: committedAtISO
        };
        const occurrenceDigest = sha256(canonicalJson(occurrenceCore));
        if (existingQuarantine) {
          if (existingQuarantine.occurrenceDigest !== occurrenceDigest) {
            fail("data-loss", "The post-provider quarantine occurrence is inconsistent.");
          }
        } else {
          transaction.create(quarantineRef, { ...occurrenceCore, occurrenceDigest });
        }
        if (!existingBinding) {
          transaction.create(bindingRef, {
            schemaVersion: CONNECT_CONTROL_SCHEMA_VERSION,
            bindingId: providerBindingId,
            organizationId: id,
            generation: Number(publicReceipt.generation),
            privateAccountId: provider.privateAccountId,
            providerMode: provider.providerMode,
            platformAccountBinding: provider.platformAccountBinding,
            configurationDigest: provider.configurationDigest,
            claimState: "quarantined",
            claimedAtISO: committedAtISO
          });
        }
        const quarantine = Object.freeze({
          operation: "create_merchant_account",
          requestDigest: commandIdentity.requestDigest,
          reasonDigest,
          safeCode,
          providerReferenceDigest,
          occurrenceId: quarantineOccurrenceId,
          occurrenceDigest,
          quarantinedAtISO: committedAtISO
        });
        transaction.set(orgRef, {
          ...current,
          revision: Number(current.revision) + 1,
          connectionState: "security_review",
          lastProviderQuarantine: quarantine,
          updatedAtISO: committedAtISO
        });
        return Object.freeze({ quarantined: true, quarantine });
      }
      const privateAccountBinding = Object.freeze({
        bindingId: providerBindingId,
        privateAccountId: provider.privateAccountId,
        providerMode: provider.providerMode,
        platformAccountBinding: provider.platformAccountBinding,
        configurationDigest: provider.configurationDigest,
        generation: publicReceipt.generation
      });
      if (!existingBinding) {
        transaction.create(bindingRef, {
          schemaVersion: CONNECT_CONTROL_SCHEMA_VERSION,
          bindingId: providerBindingId,
          organizationId: id,
          generation: publicReceipt.generation,
          privateAccountId: provider.privateAccountId,
          providerMode: provider.providerMode,
          platformAccountBinding: provider.platformAccountBinding,
          configurationDigest: provider.configurationDigest,
          claimState: "bound",
          boundAtISO: committedAtISO
        });
      }
      transaction.create(mutationRef, {
        schemaVersion: CONNECT_CONTROL_SCHEMA_VERSION,
        organizationId: id,
        operation: publicReceipt.operation,
        requestId: publicReceipt.requestId,
        payloadDigest: publicReceipt.payloadDigest,
        publicReceipt,
        completedAtISO: completedAt
      });
      transaction.set(orgRef, {
        ...current,
        connectionState: "onboarding",
        privateAccountBinding,
        activeReservation: null,
        connectionConfirmedAtISO: "",
        updatedAtISO: committedAtISO
      });
      return Object.freeze({ publicReceipt });
    });
    return result.quarantined ? result : result.publicReceipt;
  }

  async function refreshStatus({
    organizationId,
    expectedRevision,
    expectedGeneration,
    observation,
    refreshedAtISO,
    providerCommandIdentity
  } = {}) {
    const id = safeId(organizationId, "organizationId");
    const normalized = normalizeObservation(observation);
    const commandIdentity = normalizeProviderCommandIdentity(providerCommandIdentity);
    const refreshedAt = iso(refreshedAtISO, "refreshedAtISO");
    const orgRef = organizationRef(id);
    return db.runTransaction(async (transaction) => {
      const current = snapshotData(await transaction.get(orgRef));
      if (!current || current.organizationId !== id || !current.privateAccountBinding) {
        fail("failed-precondition", "The Stripe account binding is unavailable.");
      }
      if (commandIdentity && current.lastStatusProviderCommand?.commandId === commandIdentity.commandId) {
        if (current.lastStatusProviderCommand.requestDigest !== commandIdentity.requestDigest) {
          fail("data-loss", "The Stripe status command identity is bound to another request digest.");
        }
        return Object.freeze(current);
      }
      if (
        Number(current.revision) !== safeInteger(expectedRevision, "expectedRevision")
        || Number(current.generation) !== safeInteger(expectedGeneration, "expectedGeneration")
      ) {
        fail("aborted", "Stripe status changed during the provider refresh.");
      }
      const updated = {
        ...current,
        ...normalized,
        revision: Number(current.revision) + 1,
        refreshedAtISO: refreshedAt,
        updatedAtISO: refreshedAt
      };
      if (commandIdentity) {
        updated.lastStatusProviderCommand = Object.freeze({
          ...commandIdentity,
          observationDigest: normalized.observationDigest,
          appliedAtISO: refreshedAt
        });
      }
      if (
        normalized.connectionState === "ready"
        && !current.connectionConfirmedAtISO
        && DIGEST_PATTERN.test(text(current.latestOnboardingAttemptDigest, 64).toLowerCase())
      ) {
        updated.connectionConfirmedAtISO = refreshedAt;
        updated.connectionConfirmedAttemptDigest = text(
          current.latestOnboardingAttemptDigest,
          64
        ).toLowerCase();
      }
      transaction.set(orgRef, updated);
      return Object.freeze(updated);
    });
  }

  async function quarantineProviderOperation({
    organizationId,
    expectedRevision,
    expectedGeneration,
    operation,
    requestDigest,
    reasonDigest,
    safeCode,
    privateProviderEvidence,
    quarantinedAtISO
  } = {}) {
    const id = safeId(organizationId, "organizationId");
    const providerOperation = safeId(operation, "provider operation");
    if (!["create_merchant_account", "refresh_merchant_account"].includes(providerOperation)) {
      fail("invalid-argument", "The provider operation cannot enter Connect security review.");
    }
    const protectedRequest = digest(requestDigest, "provider request digest");
    const protectedReason = digest(reasonDigest, "provider quarantine reason digest");
    const protectedSafeCode = text(safeCode, 64).toLowerCase();
    if (!/^[a-z0-9_-]{1,64}$/.test(protectedSafeCode)) {
      fail("invalid-argument", "The provider quarantine safe code is invalid.");
    }
    const evidence = normalizePrivateProviderEvidence(privateProviderEvidence);
    const quarantinedAt = iso(quarantinedAtISO, "provider quarantinedAtISO");
    const orgRef = organizationRef(id);
    const occurrenceId = providerQuarantineDocumentId({
      organizationId: id,
      requestDigest: protectedRequest
    });
    const occurrenceRef = db.doc(`${COLLECTIONS.providerQuarantines}/${occurrenceId}`);
    const evidenceBindingId = evidence ? bindingDocumentId(evidence) : "";
    return db.runTransaction(async (transaction) => {
      const [statusSnapshot, occurrenceSnapshot] = await Promise.all([
        transaction.get(orgRef),
        transaction.get(occurrenceRef)
      ]);
      const current = snapshotData(statusSnapshot);
      const existingOccurrence = snapshotData(occurrenceSnapshot);
      if (!current || current.organizationId !== id) {
        fail("failed-precondition", "The Connect organization is unavailable for security review.");
      }
      const storedBindingId = text(existingOccurrence?.bindingId, 64).toLowerCase();
      if (storedBindingId && !DIGEST_PATTERN.test(storedBindingId)) {
        fail("data-loss", "The private provider quarantine binding identity is invalid.");
      }
      const bindingIdToRead = storedBindingId || evidenceBindingId;
      const evidenceBindingRef = bindingIdToRead
        ? db.doc(`${COLLECTIONS.accountBindings}/${bindingIdToRead}`)
        : null;
      const existingBinding = evidenceBindingRef
        ? snapshotData(await transaction.get(evidenceBindingRef))
        : null;
      if (current.lastProviderQuarantine?.requestDigest === protectedRequest) {
        const verifiedOccurrence = normalizeStoredQuarantineOccurrence(existingOccurrence, {
          occurrenceId,
          organizationId: id,
          generation: safeInteger(current.generation, "provider quarantine generation"),
          operation: providerOperation,
          requestDigest: protectedRequest,
          reasonDigest: protectedReason,
          safeCode: protectedSafeCode
        });
        if (
          current.lastProviderQuarantine.operation !== verifiedOccurrence.operation
          || current.lastProviderQuarantine.reasonDigest !== verifiedOccurrence.reasonDigest
          || current.lastProviderQuarantine.safeCode !== verifiedOccurrence.safeCode
          || current.lastProviderQuarantine.occurrenceId !== verifiedOccurrence.occurrenceId
          || current.lastProviderQuarantine.occurrenceDigest !== verifiedOccurrence.occurrenceDigest
          || current.lastProviderQuarantine.providerReferenceDigest
            !== verifiedOccurrence.providerReferenceDigest
          || current.lastProviderQuarantine.quarantinedAtISO !== verifiedOccurrence.quarantinedAtISO
        ) {
          fail("data-loss", "The provider quarantine request is bound to another outcome.");
        }
        assertStoredQuarantineBinding(verifiedOccurrence, existingBinding);
        return Object.freeze({ ...current.lastProviderQuarantine });
      }
      if (
        Number(current.revision) !== safeInteger(expectedRevision, "expectedRevision")
        || Number(current.generation) !== safeInteger(expectedGeneration, "expectedGeneration")
      ) {
        fail("aborted", "Stripe state changed before the provider operation could be quarantined.");
      }
      const generation = safeInteger(expectedGeneration, "expectedGeneration");
      let bindingConflict = false;
      if (evidence) {
        bindingConflict = Boolean(existingBinding && (
          existingBinding.organizationId !== id
          || Number(existingBinding.generation) !== generation
          || existingBinding.privateAccountId !== evidence.privateAccountId
          || existingBinding.providerMode !== evidence.providerMode
          || existingBinding.platformAccountBinding !== evidence.platformAccountBinding
        ));
        if (!existingBinding) {
          transaction.create(evidenceBindingRef, {
            schemaVersion: CONNECT_CONTROL_SCHEMA_VERSION,
            bindingId: evidenceBindingId,
            organizationId: id,
            generation,
            privateAccountId: evidence.privateAccountId,
            providerMode: evidence.providerMode,
            platformAccountBinding: evidence.platformAccountBinding,
            configurationDigest: evidence.configurationDigest,
            claimState: "quarantined",
            claimedAtISO: quarantinedAt
          });
        }
      }
      const providerReferenceDigest = evidence
        ? sha256(`stripe-connect-provider-account-v1\n${evidence.privateAccountId}`)
        : "";
      const occurrenceCore = {
        schemaVersion: CONNECT_CONTROL_SCHEMA_VERSION,
        occurrenceId,
        organizationId: id,
        generation,
        operation: providerOperation,
        requestDigest: protectedRequest,
        reasonDigest: protectedReason,
        safeCode: protectedSafeCode,
        providerReferenceDigest,
        bindingId: evidenceBindingId,
        bindingConflict,
        privateProviderEvidence: evidence,
        quarantinedAtISO: quarantinedAt
      };
      const occurrenceDigest = sha256(canonicalJson(occurrenceCore));
      if (existingOccurrence) {
        if (existingOccurrence.occurrenceDigest !== occurrenceDigest) {
          fail("data-loss", "The private provider quarantine occurrence is inconsistent.");
        }
      } else {
        transaction.create(occurrenceRef, { ...occurrenceCore, occurrenceDigest });
      }
      const quarantine = Object.freeze({
        operation: providerOperation,
        requestDigest: protectedRequest,
        reasonDigest: protectedReason,
        safeCode: protectedSafeCode,
        providerReferenceDigest,
        occurrenceId,
        occurrenceDigest,
        quarantinedAtISO: quarantinedAt
      });
      const updated = {
        ...current,
        revision: Number(current.revision) + 1,
        connectionState: "security_review",
        lastProviderQuarantine: quarantine,
        updatedAtISO: quarantinedAt
      };
      transaction.set(orgRef, updated);
      return quarantine;
    });
  }

  async function savePreparedHandoff(privateRecord = {}) {
    const organizationId = safeId(privateRecord.organizationId, "organizationId");
    const ownerUid = safeId(privateRecord.ownerUid, "ownerUid");
    const requestId = safeId(privateRecord.requestId, "requestId");
    const authorityRevision = safeInteger(privateRecord.authorityRevision, "authorityRevision");
    if (authorityRevision < 1 || Number(privateRecord.schemaVersion) !== HANDOFF_SCHEMA_VERSION) {
      fail("invalid-argument", "The onboarding handoff authority binding is invalid.");
    }
    const tokenDigest = digest(privateRecord.tokenDigest, "handoff token digest");
    const attemptDigest = digest(privateRecord.attemptDigest, "handoff attempt digest");
    const appIdDigest = digest(privateRecord.appIdDigest, "handoff App Check digest");
    const payloadDigest = digest(privateRecord.payloadDigest, "handoff payload digest");
    const createdAtISO = iso(privateRecord.createdAtISO, "handoff createdAtISO");
    const expiresAtISO = iso(privateRecord.expiresAtISO, "handoff expiresAtISO");
    if (
      privateRecord.state !== "prepared"
      || Date.parse(expiresAtISO) <= Date.parse(createdAtISO)
      || Date.parse(expiresAtISO) <= Number(now())
    ) {
      fail("failed-precondition", "The onboarding handoff is not usable.");
    }
    const orgRef = organizationRef(organizationId);
    const handoffRef = db.doc(`${COLLECTIONS.onboardingHandoffs}/${tokenDigest}`);
    const authorityDocumentRef = authorityRef(organizationId);
    const requestReceiptRef = db.doc(
      `${COLLECTIONS.onboardingHandoffReceipts}/${handoffRequestReceiptDocumentId({ organizationId, requestId })}`
    );
    return db.runTransaction(async (transaction) => {
      const [statusSnapshot, handoffSnapshot, authoritySnapshot, requestReceiptSnapshot] = await Promise.all([
        transaction.get(orgRef),
        transaction.get(handoffRef),
        transaction.get(authorityDocumentRef),
        transaction.get(requestReceiptRef)
      ]);
      const current = snapshotData(statusSnapshot);
      const existing = snapshotData(handoffSnapshot);
      const authorityRecord = snapshotData(authoritySnapshot);
      const requestReceipt = snapshotData(requestReceiptSnapshot);
      if (
        !current
        || current.organizationId !== organizationId
        || Number(current.revision) !== safeInteger(privateRecord.revision, "revision")
        || Number(current.generation) !== safeInteger(privateRecord.generation, "generation")
        || !current.privateAccountBinding
        || Number(current.privateAccountBinding.generation) !== Number(privateRecord.generation)
        || !["onboarding", "pending_review", "attention_required"].includes(text(current.connectionState, 64))
      ) {
        fail("aborted", "Stripe onboarding changed before the handoff was prepared.");
      }
      if (!authorityRecord?.projection) {
        fail("failed-precondition", "Current Stripe owner authority is unavailable.");
      }
      const authority = normalizeConnectAuthorityProjection(authorityRecord.projection, { nowMs: Number(now()) });
      if (
        authority.organizationId !== organizationId
        || authority.ownerUid !== ownerUid
        || authority.authorityRevision !== authorityRevision
        || !authority.members.some((member) => member.uid === ownerUid)
      ) {
        fail("permission-denied", "Current Stripe owner authority no longer matches this handoff.");
      }

      if (requestReceipt) {
        if (
          requestReceipt.organizationId !== organizationId
          || requestReceipt.requestId !== requestId
          || requestReceipt.payloadDigest !== payloadDigest
          || requestReceipt.tokenDigest !== tokenDigest
          || requestReceipt.attemptDigest !== attemptDigest
        ) {
          fail("already-exists", "The onboarding handoff request ID belongs to another payload.");
        }
        if (!existing || existing.requestId !== requestId || existing.attemptDigest !== attemptDigest) {
          fail("data-loss", "The onboarding handoff receipt is missing its protected attempt.");
        }
        if (existing.state !== "prepared" || Date.parse(existing.expiresAtISO || "") <= Number(now())) {
          fail("failed-precondition", "This onboarding handoff was already used or expired. Start a recovery attempt.");
        }
        return Object.freeze({ ...existing, privateAccountBinding: current.privateAccountBinding });
      }
      if (existing) {
        fail("data-loss", "The onboarding handoff is missing its immutable request receipt.");
      }

      const activeTokenDigest = text(current.activeHandoffTokenDigest, 64).toLowerCase();
      if (activeTokenDigest && activeTokenDigest !== tokenDigest) {
        const activeRef = db.doc(`${COLLECTIONS.onboardingHandoffs}/${digest(activeTokenDigest, "active handoff digest")}`);
        const active = snapshotData(await transaction.get(activeRef));
        if (!active) fail("data-loss", "The active onboarding handoff is unavailable.");
        const activeExpiryMs = Date.parse(active.providerExpiresAtISO || active.expiresAtISO || "");
        const terminal = ["provider_failed", "provider_withheld", "expired"].includes(text(active.state, 32));
        if (!terminal && (!Number.isFinite(activeExpiryMs) || activeExpiryMs > Number(now()))) {
          fail("failed-precondition", "Another onboarding handoff is already active.");
        }
        if (!terminal) transaction.set(activeRef, {
          ...active,
          state: "expired",
          expiredAtISO: new Date(Number(now())).toISOString()
        });
      }
      const record = {
        ...privateRecord,
        schemaVersion: HANDOFF_SCHEMA_VERSION,
        organizationId,
        ownerUid,
        requestId,
        authorityRevision,
        appIdDigest,
        payloadDigest,
        tokenDigest,
        attemptDigest,
        createdAtISO,
        expiresAtISO,
        privateAccountBinding: current.privateAccountBinding
      };
      transaction.create(handoffRef, record);
      transaction.create(requestReceiptRef, {
        schemaVersion: CONNECT_CONTROL_SCHEMA_VERSION,
        organizationId,
        requestId,
        payloadDigest,
        tokenDigest,
        attemptDigest,
        ownerUid,
        authorityRevision,
        createdAtISO,
        expiresAtISO
      });
      transaction.set(orgRef, {
        ...current,
        activeHandoffTokenDigest: tokenDigest,
        activeHandoffAttemptDigest: attemptDigest,
        updatedAtISO: createdAtISO
      });
      return Object.freeze(record);
    });
  }

  async function consumePreparedHandoff({ tokenDigest, nowISO } = {}) {
    const protectedToken = digest(tokenDigest, "handoff token digest");
    const consumedAt = iso(nowISO, "nowISO");
    const ref = db.doc(`${COLLECTIONS.onboardingHandoffs}/${protectedToken}`);
    return db.runTransaction(async (transaction) => {
      const current = snapshotData(await transaction.get(ref));
      if (!current || current.tokenDigest !== protectedToken || current.state !== "prepared") return null;
      if (Date.parse(current.expiresAtISO || "") <= Date.parse(consumedAt)) return null;
      const orgRef = organizationRef(current.organizationId);
      const authorityDocumentRef = authorityRef(current.organizationId);
      const [statusSnapshot, authoritySnapshot] = await Promise.all([
        transaction.get(orgRef),
        transaction.get(authorityDocumentRef)
      ]);
      const status = snapshotData(statusSnapshot);
      const authorityRecord = snapshotData(authoritySnapshot);
      if (
        !status
        || status.organizationId !== current.organizationId
        || status.activeHandoffTokenDigest !== protectedToken
        || Number(status.revision) !== Number(current.revision)
        || Number(status.generation) !== Number(current.generation)
        || Number(status.privateAccountBinding?.generation) !== Number(current.generation)
        || !["onboarding", "pending_review", "attention_required"].includes(text(status.connectionState, 64))
        || !authorityRecord?.projection
      ) {
        return null;
      }
      const authority = normalizeConnectAuthorityProjection(authorityRecord.projection, {
        nowMs: Date.parse(consumedAt)
      });
      if (
        authority.ownerUid !== current.ownerUid
        || authority.authorityRevision !== Number(current.authorityRevision)
        || !authority.members.some((member) => member.uid === current.ownerUid)
      ) {
        return null;
      }
      const consumed = { ...current, state: "consumed", consumedAtISO: consumedAt };
      transaction.set(ref, consumed);
      return Object.freeze(consumed);
    });
  }

  async function recordProviderExpiry({ tokenDigest, attemptDigest, expiresAtISO } = {}) {
    const protectedToken = digest(tokenDigest, "handoff token digest");
    const protectedAttempt = digest(attemptDigest, "handoff attempt digest");
    const providerExpiresAtISO = iso(expiresAtISO, "provider expiresAtISO");
    const ref = db.doc(`${COLLECTIONS.onboardingHandoffs}/${protectedToken}`);
    return db.runTransaction(async (transaction) => {
      const recordedAtMs = Number(now());
      if (!Number.isFinite(recordedAtMs)) fail("internal", "The Connect repository clock is invalid.");
      const recordedAtISO = new Date(recordedAtMs).toISOString();
      const current = snapshotData(await transaction.get(ref));
      if (!current || current.tokenDigest !== protectedToken || current.attemptDigest !== protectedAttempt) {
        fail("aborted", "The onboarding handoff result no longer matches its consumed attempt.");
      }
      if (current.state !== "consumed") {
        fail("failed-precondition", "The onboarding handoff is not awaiting a provider result.");
      }
      const orgRef = organizationRef(current.organizationId);
      const authorityDocumentRef = authorityRef(current.organizationId);
      const [statusSnapshot, authoritySnapshot] = await Promise.all([
        transaction.get(orgRef),
        transaction.get(authorityDocumentRef)
      ]);
      const status = snapshotData(statusSnapshot);
      const authorityRecord = snapshotData(authoritySnapshot);
      let authority = null;
      try {
        authority = authorityRecord?.projection
          ? normalizeConnectAuthorityProjection(authorityRecord.projection, {
              nowMs: recordedAtMs
            })
          : null;
      } catch {
        authority = null;
      }
      const statusMatches = Boolean(
        status
        && status.organizationId === current.organizationId
        && status.activeHandoffTokenDigest === protectedToken
        && Number(status.revision) === Number(current.revision)
        && Number(status.generation) === Number(current.generation)
      );
      const expiryMatches = Date.parse(providerExpiresAtISO) > recordedAtMs
        && Date.parse(current.expiresAtISO || "") > recordedAtMs;
      const authorityMatches = Boolean(
        authority
        && authority.organizationId === current.organizationId
        && authority.ownerUid === current.ownerUid
        && authority.authorityRevision === Number(current.authorityRevision)
        && authority.members.some((member) => member.uid === current.ownerUid)
      );
      if (!statusMatches || !authorityMatches || !expiryMatches) {
        const withheld = {
          ...current,
          state: "provider_withheld",
          providerExpiresAtISO,
          withheldAtISO: recordedAtISO
        };
        transaction.set(ref, withheld);
        return Object.freeze(withheld);
      }
      const updated = {
        ...current,
        state: "provider_issued",
        providerExpiresAtISO,
        providerIssuedAtISO: recordedAtISO
      };
      transaction.set(ref, updated);
      transaction.set(orgRef, {
        ...status,
        latestOnboardingAttemptDigest: protectedAttempt,
        latestOnboardingAttemptIssuedAtISO: updated.providerIssuedAtISO,
        updatedAtISO: updated.providerIssuedAtISO
      });
      return Object.freeze(updated);
    });
  }

  async function recordHandoffFailure({ tokenDigest, attemptDigest, reason } = {}) {
    const safeReason = text(reason, 64).toLowerCase();
    if (!/^[a-z0-9_-]{1,64}$/.test(safeReason)) fail("invalid-argument", "handoff failure reason is invalid.");
    return updateConsumedHandoff({ tokenDigest, attemptDigest }, (current) => ({
      ...current,
      state: "provider_failed",
      failureReason: safeReason,
      failedAtISO: new Date(Number(now())).toISOString()
    }));
  }

  async function updateConsumedHandoff({ tokenDigest, attemptDigest }, transform) {
    const protectedToken = digest(tokenDigest, "handoff token digest");
    const protectedAttempt = digest(attemptDigest, "handoff attempt digest");
    const ref = db.doc(`${COLLECTIONS.onboardingHandoffs}/${protectedToken}`);
    return db.runTransaction(async (transaction) => {
      const current = snapshotData(await transaction.get(ref));
      if (!current || current.tokenDigest !== protectedToken || current.attemptDigest !== protectedAttempt) {
        fail("aborted", "The onboarding handoff result no longer matches its consumed attempt.");
      }
      if (current.state !== "consumed") fail("failed-precondition", "The onboarding handoff is not awaiting a provider result.");
      const updated = transform(current);
      transaction.set(ref, updated);
      return Object.freeze(updated);
    });
  }

  return Object.freeze({
    applyAuthorityProjection,
    readAuthority,
    readStatus,
    findMutationReceipt,
    reserveOnboarding,
    completeOnboarding,
    quarantineProviderOperation,
    refreshStatus,
    savePreparedHandoff,
    consumePreparedHandoff,
    recordProviderExpiry,
    recordHandoffFailure
  });
}

module.exports = {
  COLLECTIONS,
  CONNECT_CONTROL_SCHEMA_VERSION,
  PROVIDER_RECOVERY_WINDOW_SECONDS,
  authorityProjectionReceiptDocumentId,
  bindingDocumentId,
  createConnectControlRepository,
  createNamedConnectControlDatabase,
  handoffRequestReceiptDocumentId,
  receiptDocumentId,
  reservationId
};
