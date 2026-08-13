"use strict";

const { createHash } = require("node:crypto");
const { StripeConnectInterfaceError } = require("./interfaceContracts");
const { CONNECT_DATABASE_ID } = require("./runtimePolicy");

const CONNECT_CONTROL_SCHEMA_VERSION = 1;
const PROVIDER_RECOVERY_WINDOW_SECONDS = 30 * 24 * 60 * 60;
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,160}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const PROVIDER_ACCOUNT_PATTERN = /^acct_[A-Za-z0-9]{8,255}$/;

const COLLECTIONS = Object.freeze({
  authorities: "connectOrganizationAuthorities",
  organizations: "connectOrganizations",
  mutationReceipts: "connectMutationReceipts",
  accountBindings: "connectAccountBindings",
  onboardingHandoffs: "connectOnboardingHandoffs",
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

function normalizeProviderAccount(providerAccount = {}) {
  const privateAccountId = text(providerAccount.privateAccountId, 255);
  const providerMode = text(providerAccount.providerMode, 32).toLowerCase();
  const platformAccountBinding = text(providerAccount.platformAccountBinding, 255);
  const configurationDigest = digest(providerAccount.configurationDigest, "provider configuration digest");
  if (!PROVIDER_ACCOUNT_PATTERN.test(privateAccountId)) {
    fail("failed-precondition", "The provider account identity is invalid.");
  }
  if (providerMode !== "sandbox" || !platformAccountBinding || platformAccountBinding === "unbound") {
    fail("failed-precondition", "The provider account is not bound to the reviewed Sandbox platform.");
  }
  return Object.freeze({ privateAccountId, providerMode, platformAccountBinding, configurationDigest });
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
    responsibilityState: text(observation.responsibilityState, 32).toLowerCase(),
    observationDigest: digest(observation.observationDigest, "provider observation digest")
  });
}

function createConnectControlRepository({ database, now = () => Date.now() } = {}) {
  const db = requireDatabase(database);
  if (typeof now !== "function") fail("internal", "The Connect repository clock is unavailable.");

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
    if (!record || text(record.organizationId, 160) !== id) return null;
    return Object.freeze({ organizationId: id, ownerUid: text(record.ownerUid, 160) });
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

  async function reserveOnboarding({ organizationId, actorUid, actorEmail, input, reservedAtISO } = {}) {
    const id = safeId(organizationId, "organizationId");
    const uid = safeId(actorUid, "actorUid");
    const email = text(actorEmail, 320).toLowerCase();
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
      const providerIdempotencyKey = `qpca_${sha256(`${id}\n${targetGeneration}\n${input.payloadDigest}`)}`;
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
        providerIdempotencyKey,
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

  async function completeOnboarding({ organizationId, reservation, providerAccount, publicReceipt, completedAtISO } = {}) {
    const id = safeId(organizationId, "organizationId");
    const completedAt = iso(completedAtISO, "completedAtISO");
    const provider = normalizeProviderAccount(providerAccount);
    const orgRef = organizationRef(id);
    const providerBindingId = bindingDocumentId(provider);
    const bindingRef = db.doc(`${COLLECTIONS.accountBindings}/${providerBindingId}`);
    const mutationRef = receiptRef({
      organizationId: id,
      operation: publicReceipt?.operation,
      requestId: publicReceipt?.requestId
    });
    const result = await db.runTransaction(async (transaction) => {
      const [statusSnapshot, bindingSnapshot, receiptSnapshot] = await Promise.all([
        transaction.get(orgRef),
        transaction.get(bindingRef),
        transaction.get(mutationRef)
      ]);
      const current = snapshotData(statusSnapshot);
      const existingBinding = snapshotData(bindingSnapshot);
      const existingReceipt = snapshotData(receiptSnapshot);
      if (!current || current.organizationId !== id || !current.activeReservation) {
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
      if (existingReceipt) {
        if (existingReceipt.payloadDigest !== publicReceipt.payloadDigest) {
          fail("already-exists", "The onboarding request ID belongs to another payload.");
        }
        return Object.freeze({ publicReceipt: existingReceipt.publicReceipt });
      }
      if (existingBinding && (
        existingBinding.organizationId !== id
        || Number(existingBinding.generation) !== Number(publicReceipt.generation)
      )) {
        transaction.set(orgRef, {
          ...current,
          connectionState: "security_review",
          updatedAtISO: completedAt
        });
        return Object.freeze({ bindingConflict: true });
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
          boundAtISO: completedAt
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
        updatedAtISO: completedAt
      });
      return Object.freeze({ publicReceipt });
    });
    if (result?.bindingConflict) fail("failed-precondition", "The provider account binding requires security review.");
    return result.publicReceipt;
  }

  async function refreshStatus({ organizationId, expectedRevision, expectedGeneration, observation, refreshedAtISO } = {}) {
    const id = safeId(organizationId, "organizationId");
    const normalized = normalizeObservation(observation);
    const refreshedAt = iso(refreshedAtISO, "refreshedAtISO");
    const orgRef = organizationRef(id);
    return db.runTransaction(async (transaction) => {
      const current = snapshotData(await transaction.get(orgRef));
      if (!current || current.organizationId !== id || !current.privateAccountBinding) {
        fail("failed-precondition", "The Stripe account binding is unavailable.");
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
      if (normalized.connectionState === "ready" && !current.connectionConfirmedAtISO) {
        updated.connectionConfirmedAtISO = refreshedAt;
      }
      transaction.set(orgRef, updated);
      return Object.freeze(updated);
    });
  }

  async function savePreparedHandoff(privateRecord = {}) {
    const organizationId = safeId(privateRecord.organizationId, "organizationId");
    const tokenDigest = digest(privateRecord.tokenDigest, "handoff token digest");
    const orgRef = organizationRef(organizationId);
    const handoffRef = db.doc(`${COLLECTIONS.onboardingHandoffs}/${tokenDigest}`);
    return db.runTransaction(async (transaction) => {
      const [statusSnapshot, handoffSnapshot] = await Promise.all([
        transaction.get(orgRef),
        transaction.get(handoffRef)
      ]);
      const current = snapshotData(statusSnapshot);
      const existing = snapshotData(handoffSnapshot);
      if (
        !current
        || current.organizationId !== organizationId
        || Number(current.revision) !== safeInteger(privateRecord.revision, "revision")
        || Number(current.generation) !== safeInteger(privateRecord.generation, "generation")
        || !current.privateAccountBinding
      ) {
        fail("aborted", "Stripe onboarding changed before the handoff was prepared.");
      }
      if (existing) {
        if (existing.attemptDigest !== privateRecord.attemptDigest || existing.requestId !== privateRecord.requestId) {
          fail("already-exists", "The onboarding handoff identity is already in use.");
        }
        return Object.freeze({ ...existing });
      }
      const record = {
        ...privateRecord,
        organizationId,
        tokenDigest,
        privateAccountBinding: current.privateAccountBinding
      };
      transaction.create(handoffRef, record);
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
      const consumed = { ...current, state: "consumed", consumedAtISO: consumedAt };
      transaction.set(ref, consumed);
      return Object.freeze(consumed);
    });
  }

  async function recordProviderExpiry({ tokenDigest, attemptDigest, expiresAtISO } = {}) {
    return updateConsumedHandoff({ tokenDigest, attemptDigest }, (current) => ({
      ...current,
      providerExpiresAtISO: iso(expiresAtISO, "provider expiresAtISO")
    }));
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
    readAuthority,
    readStatus,
    findMutationReceipt,
    reserveOnboarding,
    completeOnboarding,
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
  bindingDocumentId,
  createConnectControlRepository,
  createNamedConnectControlDatabase,
  receiptDocumentId,
  reservationId
};
