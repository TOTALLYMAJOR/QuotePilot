"use strict";

const {
  StripeConnectInterfaceError,
  buildConnectMutationReceiptV1,
  canonicalJson,
  sha256
} = require("./interfaceContracts");
const { normalizeConnectAuthorityProjection } = require("./authorityProjection");
const { reservationId } = require("./connectControlRepository");
const { REVIEWED_CONFIGURATION_DIGEST } = require("./providerModel");

function fail(code, message) {
  throw new StripeConnectInterfaceError(code, message);
}

function requireFunction(value, name) {
  if (typeof value !== "function") fail("internal", `${name} is unavailable.`);
  return value;
}

function digestValue(value) {
  return sha256(canonicalJson(value));
}

function providerReferenceDigest(privateAccountBinding) {
  const privateAccountId = String(privateAccountBinding?.privateAccountId || "").trim();
  return privateAccountId ? sha256(`stripe-connect-provider-account-v1\n${privateAccountId}`) : "";
}

function terminalOutcome({ state = "succeeded", safeCode, resultDigest, providerDigest = "" }) {
  return Object.freeze({
    state,
    safeCode,
    resultDigest,
    providerReferenceDigest: providerDigest
  });
}

function priorQuarantineOutcome(command, status = {}) {
  const prior = status.lastProviderQuarantine;
  if (!prior || prior.requestDigest !== command.requestDigest) return null;
  if (
    prior.operation !== command.operation
    || !/^[a-z0-9_-]{1,64}$/.test(String(prior.safeCode || ""))
    || !/^[a-f0-9]{64}$/.test(String(prior.reasonDigest || ""))
    || (prior.providerReferenceDigest && !/^[a-f0-9]{64}$/.test(prior.providerReferenceDigest))
  ) {
    fail("data-loss", "The prior provider quarantine does not match its immutable command.");
  }
  return terminalOutcome({
    state: "quarantined",
    safeCode: prior.safeCode,
    resultDigest: prior.reasonDigest,
    providerDigest: prior.providerReferenceDigest || ""
  });
}

function isQuarantineError(error) {
  return error instanceof StripeConnectInterfaceError
    && ["already-exists", "data-loss", "failed-precondition", "invalid-argument", "permission-denied"]
      .includes(error.code);
}

function createConnectProviderCommandExecutor({
  commandWorker,
  repository,
  provider,
  now = () => Date.now()
} = {}) {
  if (!commandWorker || !repository || !provider) {
    fail("internal", "Connect provider command executor dependencies are unavailable.");
  }
  const claimCommand = requireFunction(commandWorker.claimCommand, "Connect command claim");
  const completeCommand = requireFunction(commandWorker.completeCommand, "Connect command completion");
  const readStatus = requireFunction(repository.readStatus, "Connect status read");
  const readAuthority = requireFunction(repository.readAuthority, "Connect authority read");
  const findMutationReceipt = requireFunction(repository.findMutationReceipt, "Connect mutation receipt lookup");
  const completeOnboarding = requireFunction(repository.completeOnboarding, "Connect onboarding completion");
  const refreshStatus = requireFunction(repository.refreshStatus, "Connect status refresh");
  const quarantineProviderOperation = requireFunction(
    repository.quarantineProviderOperation,
    "Connect provider quarantine"
  );
  const createMerchantAccount = requireFunction(provider.createMerchantAccount, "Stripe merchant-account adapter");
  const retrieveMerchantAccount = requireFunction(provider.retrieveMerchantAccount, "Stripe status adapter");

  function currentAuthorityForCommand(command, authority) {
    const projection = normalizeConnectAuthorityProjection(authority, { nowMs: Number(now()) });
    if (
      projection.organizationId !== command.organizationId
      || projection.payloadDigest !== command.payload.authorityPayloadDigest
    ) {
      fail("permission-denied", "Current organization authority no longer matches the provider command.");
    }
    return projection;
  }

  async function executeCreateMerchantAccount(command) {
    const prior = await findMutationReceipt({
      organizationId: command.organizationId,
      operation: "beginStripeConnectOnboarding",
      requestId: command.requestId
    });
    if (prior) {
      const priorReservationId = reservationId({
        organizationId: command.organizationId,
        input: {
          requestId: command.requestId,
          payloadDigest: prior.payloadDigest
        }
      });
      if (
        prior.publicReceipt?.operation !== "beginStripeConnectOnboarding"
        || prior.publicReceipt?.requestId !== command.requestId
        || prior.publicReceipt?.payloadDigest !== prior.payloadDigest
        || Number(prior.publicReceipt?.revision) !== command.expectedRevision
        || Number(prior.publicReceipt?.generation) !== command.connectionGeneration
        || priorReservationId !== command.payload.reservationDigest
      ) {
        fail("data-loss", "The onboarding receipt does not match its provider command.");
      }
      const status = await readStatus(command.organizationId);
      if (
        !status.privateAccountBinding
        || Number(status.privateAccountBinding.generation) !== command.connectionGeneration
        || status.privateAccountBinding.configurationDigest !== REVIEWED_CONFIGURATION_DIGEST
      ) {
        fail("data-loss", "The onboarding receipt is missing its protected provider binding.");
      }
      return terminalOutcome({
        safeCode: "provider_bound",
        resultDigest: digestValue(prior.publicReceipt),
        providerDigest: providerReferenceDigest(status.privateAccountBinding)
      });
    }

    const [status, authorityRecord] = await Promise.all([
      readStatus(command.organizationId),
      readAuthority(command.organizationId)
    ]);
    const priorQuarantine = priorQuarantineOutcome(command, status);
    if (priorQuarantine) {
      await quarantineProviderOperation({
        organizationId: command.organizationId,
        expectedRevision: status.revision,
        expectedGeneration: status.generation,
        operation: command.operation,
        requestDigest: command.requestDigest,
        reasonDigest: status.lastProviderQuarantine.reasonDigest,
        safeCode: status.lastProviderQuarantine.safeCode,
        privateProviderEvidence: null,
        quarantinedAtISO: status.lastProviderQuarantine.quarantinedAtISO
      });
      return priorQuarantine;
    }
    const reservation = status.activeReservation;
    const recoveryExpiresAtMs = Date.parse(reservation?.providerRecoveryExpiresAtISO || "");
    if (
      status.organizationId !== command.organizationId
      || Number(status.revision) !== command.expectedRevision
      || Number(status.generation) !== command.connectionGeneration
      || status.connectionState !== "provisioning"
      || !reservation
      || !Number.isFinite(recoveryExpiresAtMs)
      || recoveryExpiresAtMs <= Number(now())
      || reservation.requestId !== command.requestId
      || reservation.reservationId !== command.payload.reservationDigest
      || reservation.authorityPayloadDigest !== command.payload.authorityPayloadDigest
      || reservation.actorEmailDigest !== command.payload.contactEmailDigest
      || command.payload.configurationDigest !== REVIEWED_CONFIGURATION_DIGEST
    ) {
      fail("failed-precondition", "The onboarding reservation no longer matches its provider command.");
    }
    const authority = currentAuthorityForCommand(command, authorityRecord);
    if (reservation.actorUid !== authority.ownerUid) {
      fail("permission-denied", "Current canonical owner authority no longer matches onboarding.");
    }
    const owner = authority.members.find((member) => member.uid === authority.ownerUid);
    if (!owner || sha256(owner.email) !== command.payload.contactEmailDigest) {
      fail("permission-denied", "Current canonical owner contact authority no longer matches onboarding.");
    }

    const providerAccount = await createMerchantAccount({
      idempotencyKey: command.providerIdempotencyKey,
      country: "US",
      currency: "usd",
      dashboard: "full",
      feesCollector: "stripe",
      lossesCollector: "stripe",
      capabilities: Object.freeze({ cardPayments: "requested" }),
      contactEmail: owner.email
    });
    const completedAtISO = new Date(Number(now())).toISOString();
    const publicReceipt = buildConnectMutationReceiptV1({
      operation: "beginStripeConnectOnboarding",
      request: {
        requestId: reservation.requestId,
        payloadDigest: reservation.payloadDigest
      },
      outcome: reservation.outcome,
      completedAtISO
    });
    const completion = await completeOnboarding({
      organizationId: command.organizationId,
      reservation,
      providerAccount,
      publicReceipt,
      providerCommandIdentity: {
        commandId: command.commandId,
        requestDigest: command.requestDigest
      },
      completedAtISO
    });
    if (completion?.quarantined === true) {
      return terminalOutcome({
        state: "quarantined",
        safeCode: completion.quarantine.safeCode,
        resultDigest: completion.quarantine.reasonDigest,
        providerDigest: completion.quarantine.providerReferenceDigest
      });
    }
    return terminalOutcome({
      safeCode: "provider_bound",
      resultDigest: digestValue(publicReceipt),
      providerDigest: sha256(
        `stripe-connect-provider-account-v1\n${String(providerAccount.privateAccountId || "")}`
      )
    });
  }

  async function executeRefreshMerchantAccount(command) {
    const [status, authorityRecord] = await Promise.all([
      readStatus(command.organizationId),
      readAuthority(command.organizationId)
    ]);
    const priorQuarantine = priorQuarantineOutcome(command, status);
    if (priorQuarantine) {
      await quarantineProviderOperation({
        organizationId: command.organizationId,
        expectedRevision: status.revision,
        expectedGeneration: status.generation,
        operation: command.operation,
        requestDigest: command.requestDigest,
        reasonDigest: status.lastProviderQuarantine.reasonDigest,
        safeCode: status.lastProviderQuarantine.safeCode,
        privateProviderEvidence: null,
        quarantinedAtISO: status.lastProviderQuarantine.quarantinedAtISO
      });
      return priorQuarantine;
    }
    const prior = status.lastStatusProviderCommand;
    if (prior?.commandId === command.commandId) {
      if (prior.requestDigest !== command.requestDigest) {
        fail("data-loss", "The status projection belongs to another provider command digest.");
      }
      return terminalOutcome({
        safeCode: "status_refreshed",
        resultDigest: prior.observationDigest,
        providerDigest: providerReferenceDigest(status.privateAccountBinding)
      });
    }
    currentAuthorityForCommand(command, authorityRecord);
    if (
      status.organizationId !== command.organizationId
      || Number(status.revision) !== command.expectedRevision
      || Number(status.generation) !== command.connectionGeneration
      || !status.privateAccountBinding
      || digestValue(status.privateAccountBinding) !== command.payload.accountBindingDigest
    ) {
      fail("failed-precondition", "The Stripe binding no longer matches its provider refresh command.");
    }
    const observation = await retrieveMerchantAccount({
      privateAccountBinding: status.privateAccountBinding,
      operationDigest: command.requestDigest
    });
    await refreshStatus({
      organizationId: command.organizationId,
      expectedRevision: command.expectedRevision,
      expectedGeneration: command.connectionGeneration,
      observation,
      refreshedAtISO: new Date(Number(now())).toISOString(),
      providerCommandIdentity: {
        commandId: command.commandId,
        requestDigest: command.requestDigest
      }
    });
    return terminalOutcome({
      safeCode: "status_refreshed",
      resultDigest: observation.observationDigest,
      providerDigest: providerReferenceDigest(status.privateAccountBinding)
    });
  }

  async function executeProviderCommand({ commandId, workerId, leaseId } = {}) {
    const claim = await claimCommand({ commandId, workerId, leaseId });
    if (!claim.claimed) return claim;
    const { command } = claim;
    let outcome;
    try {
      if (command.operation === "create_merchant_account") {
        outcome = await executeCreateMerchantAccount(command);
      } else if (command.operation === "refresh_merchant_account") {
        outcome = await executeRefreshMerchantAccount(command);
      } else {
        fail("failed-precondition", "The Connect provider command operation has no reviewed executor.");
      }
    } catch (error) {
      if (!isQuarantineError(error)) throw error;
      const reasonDigest = sha256(canonicalJson({
        schemaVersion: 1,
        operation: command.operation,
        code: error.code
      }));
      const safeCode = `provider_${error.code.replace(/[^a-z0-9_-]/g, "_")}`;
      const quarantine = await quarantineProviderOperation({
        organizationId: command.organizationId,
        expectedRevision: command.expectedRevision,
        expectedGeneration: command.connectionGeneration,
        operation: command.operation,
        requestDigest: command.requestDigest,
        reasonDigest,
        safeCode,
        privateProviderEvidence: error.privateProviderEvidence || null,
        quarantinedAtISO: new Date(Number(now())).toISOString()
      });
      outcome = terminalOutcome({
        state: "quarantined",
        safeCode: quarantine.safeCode,
        resultDigest: quarantine.reasonDigest,
        providerDigest: quarantine.providerReferenceDigest
      });
    }

    const completion = await completeCommand({
      commandId: command.commandId,
      requestDigest: command.requestDigest,
      workerId,
      leaseId,
      outcome
    });
    return Object.freeze({
      claimed: true,
      terminal: true,
      replayed: completion.replayed,
      receipt: completion.receipt
    });
  }

  return Object.freeze({ executeProviderCommand });
}

module.exports = {
  createConnectProviderCommandExecutor,
  digestValue,
  providerReferenceDigest
};
