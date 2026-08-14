import { describe, expect, test, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const contracts = require("../../../functions-connect/interfaceContracts.js");
const { buildConnectAuthorityProjection } = require(
  "../../../functions-connect/authorityProjection.js"
);
const {
  COLLECTIONS,
  createConnectControlRepository
} = require("../../../functions-connect/connectControlRepository.js");
const { createConnectCommandEdge } = require("../../../functions-connect/connectCommandEdge.js");
const { createConnectCommandWorker } = require("../../../functions-connect/connectCommandWorker.js");
const { createConnectProviderCommandExecutor } = require(
  "../../../functions-connect/connectProviderCommandExecutor.js"
);
const { createStripeConnectStatusOnboardingCommandEdgeService } = require(
  "../../../functions-connect/statusOnboardingCommandEdgeService.js"
);
const {
  REVIEWED_CONFIGURATION_DIGEST,
  StripeSandboxAccountQuarantineError
} = require(
  "../../../functions-connect/stripeSandboxAdapter.js"
);

const NOW_MS = Date.parse("2026-08-14T15:00:00.000Z");
const AUTHORITY_PUBLISHER = "stripe-connect-authority-publisher@quotepilot-staging-20260804.iam.gserviceaccount.com";
const ORIGIN = "https://quotepilot-staging-20260804.web.app";

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function createMemoryFirestore(seed = {}) {
  const records = new Map(Object.entries(seed).map(([path, value]) => [path, clone(value)]));
  const snapshot = (path, source) => ({
    exists: source.has(path),
    data: () => clone(source.get(path))
  });
  return {
    doc(path) {
      return { path, get: async () => snapshot(path, records) };
    },
    read(path) {
      return clone(records.get(path));
    },
    write(path, value) {
      records.set(path, clone(value));
    },
    remove(path) {
      records.delete(path);
    },
    entries() {
      return [...records.entries()].map(([path, value]) => [path, clone(value)]);
    },
    async runTransaction(callback) {
      const view = new Map([...records.entries()].map(([path, value]) => [path, clone(value)]));
      const writes = [];
      const transaction = {
        get: async (ref) => snapshot(ref.path, view),
        create(ref, value) {
          if (view.has(ref.path) || writes.some((write) => write.path === ref.path)) {
            throw new Error("already exists");
          }
          writes.push({ path: ref.path, value: clone(value) });
        },
        set(ref, value) {
          writes.push({ path: ref.path, value: clone(value) });
        }
      };
      const result = await callback(transaction);
      for (const write of writes) records.set(write.path, write.value);
      return result;
    }
  };
}

function authorityProjection(overrides = {}) {
  return buildConnectAuthorityProjection({
    organizationId: "org_alpha",
    authorityRevision: 1,
    organizationActive: true,
    ownerUid: "owner_uid",
    members: [{
      uid: "owner_uid",
      email: "owner@example.test",
      role: "admin",
      emailVerified: true,
      disabled: false
    }],
    sourceReceiptId: "owner-binding:org_alpha",
    sourceReceiptDigest: "a".repeat(64),
    observedAtISO: new Date(NOW_MS).toISOString(),
    expiresAtISO: new Date(NOW_MS + 600_000).toISOString(),
    ...overrides
  }, { nowMs: NOW_MS });
}

function storedAuthority(overrides = {}) {
  const projection = authorityProjection(overrides);
  return {
    schemaVersion: 1,
    organizationId: projection.organizationId,
    authorityRevision: projection.authorityRevision,
    payloadDigest: projection.payloadDigest,
    projection,
    publisherIdentityDigest: "b".repeat(64),
    receivedAtISO: new Date(NOW_MS).toISOString()
  };
}

function mutation(operation, revision, generation, requestId) {
  const input = {
    requestId,
    expectedRevision: revision,
    expectedGeneration: generation
  };
  input.payloadDigest = contracts.buildConnectMutationPayloadDigest(operation, input);
  return input;
}

function actorRequest(data) {
  return {
    data,
    auth: {
      uid: "owner_uid",
      token: {
        organizationId: "org_alpha",
        role: "admin",
        email: "owner@example.test",
        email_verified: true,
        auth_time: Math.floor(NOW_MS / 1000) - 30
      }
    },
    app: { appId: "staging-app", alreadyConsumed: false }
  };
}

function runtimeFixture({
  providerOverrides = {},
  interruptOnboardingCompletion = false,
  interruptCommandCompletion = false,
  afterProviderCreate = null
} = {}) {
  const database = createMemoryFirestore({
    [`${COLLECTIONS.authorities}/org_alpha`]: storedAuthority()
  });
  const repository = createConnectControlRepository({
    database,
    now: () => NOW_MS,
    authorityPublisherIdentity: AUTHORITY_PUBLISHER
  });
  const commandEdge = createConnectCommandEdge({ database, now: () => NOW_MS });
  const baseCommandWorker = createConnectCommandWorker({
    database,
    now: () => NOW_MS,
    leaseDurationSeconds: 60,
    maxAttempts: 3
  });
  let shouldInterruptCommandCompletion = interruptCommandCompletion;
  const commandWorker = interruptCommandCompletion
    ? {
        ...baseCommandWorker,
        completeCommand: vi.fn(async (input) => {
          if (shouldInterruptCommandCompletion) {
            shouldInterruptCommandCompletion = false;
            throw new Error("simulated command receipt interruption");
          }
          return baseCommandWorker.completeCommand(input);
        })
      }
    : baseCommandWorker;
  const provider = {
    createMerchantAccount: vi.fn(async () => {
      if (typeof afterProviderCreate === "function") await afterProviderCreate(database);
      return {
        privateAccountId: "acct_connectedSandbox01",
        providerMode: "sandbox",
        platformAccountBinding: "acct_platformSandbox001",
        configurationDigest: REVIEWED_CONFIGURATION_DIGEST
      };
    }),
    retrieveMerchantAccount: vi.fn(async () => ({
      connectionState: "onboarding",
      requirementState: "due",
      currentlyDueCount: 1,
      pastDueCount: 0,
      healthState: "attention",
      cardPaymentsState: "pending",
      payoutsState: "pending",
      responsibilityState: "confirmed",
      observationDigest: "c".repeat(64)
    })),
    ...providerOverrides
  };
  let shouldInterruptOnboardingCompletion = interruptOnboardingCompletion;
  const executorRepository = interruptOnboardingCompletion
    ? {
        ...repository,
        completeOnboarding: vi.fn(async (input) => {
          if (shouldInterruptOnboardingCompletion) {
            shouldInterruptOnboardingCompletion = false;
            throw new Error("simulated database interruption after provider success");
          }
          return repository.completeOnboarding(input);
        })
      }
    : repository;
  const edgeService = createStripeConnectStatusOnboardingCommandEdgeService({
    repository,
    commandEdge,
    rateLimiter: { consume: vi.fn(async () => ({ allowed: true })) },
    principalHasher: vi.fn(async () => "d".repeat(64)),
    hmacKey: "connect-command-edge-handoff-key-at-least-32-bytes",
    expectedAppId: "staging-app",
    canonicalReturnOrigin: ORIGIN,
    now: () => NOW_MS
  });
  const executor = createConnectProviderCommandExecutor({
    commandWorker,
    repository: executorRepository,
    provider,
    now: () => NOW_MS
  });
  return { database, repository, executorRepository, commandWorker, provider, edgeService, executor };
}

describe("Stripe Connect command orchestration", () => {
  test("keeps Stripe off the edge and completes account creation through one leased command", async () => {
    const fixture = runtimeFixture();
    const request = actorRequest(mutation(
      "beginStripeConnectOnboarding",
      0,
      0,
      "begin-command-onboarding-request-0001"
    ));
    const queued = await fixture.edgeService.beginStripeConnectOnboarding(request);

    expect(queued).toMatchObject({
      operation: "beginStripeConnectOnboarding",
      revision: 1,
      generation: 1,
      state: "queued",
      command: { state: "queued", replayed: false }
    });
    expect(fixture.provider.createMerchantAccount).not.toHaveBeenCalled();
    expect(await fixture.repository.readStatus("org_alpha")).toMatchObject({
      connectionState: "provisioning",
      activeReservation: { reservationId: expect.stringMatching(/^[a-f0-9]{64}$/) }
    });

    const executed = await fixture.executor.executeProviderCommand({
      commandId: queued.command.commandId,
      workerId: "connect_worker_one",
      leaseId: "connect-worker-lease-000001"
    });
    expect(executed).toMatchObject({
      terminal: true,
      receipt: { state: "succeeded", safeCode: "provider_bound" }
    });
    expect(fixture.provider.createMerchantAccount).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: expect.stringMatching(/^qpcmd_[a-f0-9]{64}$/),
      contactEmail: "owner@example.test"
    }));
    expect(await fixture.repository.readStatus("org_alpha")).toMatchObject({
      connectionState: "onboarding",
      privateAccountBinding: { privateAccountId: "acct_connectedSandbox01" },
      activeReservation: null
    });

    const replay = await fixture.edgeService.beginStripeConnectOnboarding(request);
    expect(replay).toMatchObject({ state: "completed", receipt: { state: "onboarding" } });
    expect(fixture.provider.createMerchantAccount).toHaveBeenCalledTimes(1);
  });

  test("recovers after provider success with the same idempotency key when repository completion is interrupted", async () => {
    const fixture = runtimeFixture({ interruptOnboardingCompletion: true });
    const queued = await fixture.edgeService.beginStripeConnectOnboarding(actorRequest(mutation(
      "beginStripeConnectOnboarding",
      0,
      0,
      "begin-command-interrupted-completion-0001"
    )));
    const executionIdentity = {
      commandId: queued.command.commandId,
      workerId: "connect_worker_recovery",
      leaseId: "connect-worker-lease-recovery-000001"
    };

    await expect(fixture.executor.executeProviderCommand(executionIdentity))
      .rejects.toThrow(/simulated database interruption after provider success/i);
    expect(await fixture.repository.readStatus("org_alpha")).toMatchObject({
      connectionState: "provisioning",
      activeReservation: { requestId: "begin-command-interrupted-completion-0001" }
    });
    expect(fixture.provider.createMerchantAccount).toHaveBeenCalledTimes(1);

    await expect(fixture.executor.executeProviderCommand(executionIdentity)).resolves.toMatchObject({
      terminal: true,
      replayed: false,
      receipt: { state: "succeeded", safeCode: "provider_bound" }
    });
    expect(fixture.provider.createMerchantAccount).toHaveBeenCalledTimes(2);
    expect(fixture.provider.createMerchantAccount.mock.calls[0][0].idempotencyKey)
      .toBe(fixture.provider.createMerchantAccount.mock.calls[1][0].idempotencyKey);
    expect(fixture.provider.createMerchantAccount.mock.calls[0][0])
      .toEqual(fixture.provider.createMerchantAccount.mock.calls[1][0]);
    expect(fixture.executorRepository.completeOnboarding).toHaveBeenCalledTimes(2);
    expect(await fixture.repository.readStatus("org_alpha")).toMatchObject({
      connectionState: "onboarding",
      privateAccountBinding: { privateAccountId: "acct_connectedSandbox01" },
      activeReservation: null
    });

    await expect(fixture.executor.executeProviderCommand({
      commandId: queued.command.commandId,
      workerId: "connect_worker_replay",
      leaseId: "connect-worker-lease-replay-0000001"
    })).resolves.toMatchObject({ terminal: true, replayed: true });
    expect(fixture.provider.createMerchantAccount).toHaveBeenCalledTimes(2);
  });

  test("queues provider refresh, applies it once, and completes after exact projection replay", async () => {
    const fixture = runtimeFixture();
    const begin = await fixture.edgeService.beginStripeConnectOnboarding(actorRequest(mutation(
      "beginStripeConnectOnboarding",
      0,
      0,
      "begin-command-onboarding-request-0002"
    )));
    await fixture.executor.executeProviderCommand({
      commandId: begin.command.commandId,
      workerId: "connect_worker_one",
      leaseId: "connect-worker-lease-000002"
    });

    const refresh = await fixture.edgeService.refreshStripeConnectStatus(actorRequest(mutation(
      "refreshStripeConnectStatus",
      1,
      1,
      "refresh-command-status-request-0001"
    )));
    expect(refresh).toMatchObject({ state: "queued", command: { operation: "refresh_merchant_account" } });
    expect(fixture.provider.retrieveMerchantAccount).not.toHaveBeenCalled();

    const applied = await fixture.executor.executeProviderCommand({
      commandId: refresh.command.commandId,
      workerId: "connect_worker_one",
      leaseId: "connect-worker-lease-000003"
    });
    expect(applied).toMatchObject({ receipt: { state: "succeeded", safeCode: "status_refreshed" } });
    expect(await fixture.repository.readStatus("org_alpha")).toMatchObject({
      revision: 2,
      lastStatusProviderCommand: {
        commandId: refresh.command.commandId,
        requestDigest: refresh.command.requestDigest,
        observationDigest: "c".repeat(64)
      }
    });
    await expect(fixture.executor.executeProviderCommand({
      commandId: refresh.command.commandId,
      workerId: "connect_worker_two",
      leaseId: "connect-worker-lease-000004"
    })).resolves.toMatchObject({ terminal: true, replayed: true });
    expect(fixture.provider.retrieveMerchantAccount).toHaveBeenCalledTimes(1);
  });

  test("persists a returned provider identity when post-create validation requires quarantine", async () => {
    const providerError = new StripeSandboxAccountQuarantineError(
      "provider response requires review",
      {
        privateAccountId: "acct_quarantinedSandbox01",
        providerMode: "sandbox",
        platformAccountBinding: "acct_platformSandbox001",
        configurationDigest: REVIEWED_CONFIGURATION_DIGEST,
        providerResponseDigest: "e".repeat(64),
        reviewReason: "unreviewed_configuration"
      }
    );
    const fixture = runtimeFixture({
      providerOverrides: {
        createMerchantAccount: vi.fn(async () => { throw providerError; })
      }
    });
    const begin = await fixture.edgeService.beginStripeConnectOnboarding(actorRequest(mutation(
      "beginStripeConnectOnboarding",
      0,
      0,
      "begin-command-provider-identity-review-0001"
    )));

    await expect(fixture.executor.executeProviderCommand({
      commandId: begin.command.commandId,
      workerId: "connect_worker_identity_review",
      leaseId: "connect-worker-lease-identity-00001"
    })).resolves.toMatchObject({
      receipt: {
        state: "quarantined",
        safeCode: "provider_failed-precondition",
        providerReferenceDigest: expect.stringMatching(/^[a-f0-9]{64}$/)
      }
    });
    const quarantinedStatus = await fixture.repository.readStatus("org_alpha");
    expect(quarantinedStatus).toMatchObject({
      connectionState: "security_review",
      lastProviderQuarantine: {
        safeCode: "provider_failed-precondition",
        providerReferenceDigest: expect.stringMatching(/^[a-f0-9]{64}$/)
      }
    });
    expect(quarantinedStatus).not.toHaveProperty("privateAccountBinding");
    const privateQuarantines = fixture.database.entries()
      .filter(([path]) => path.startsWith(`${COLLECTIONS.providerQuarantines}/`));
    expect(privateQuarantines).toHaveLength(1);
    expect(privateQuarantines[0][1]).toMatchObject({
      privateProviderEvidence: { privateAccountId: "acct_quarantinedSandbox01" }
    });
  });

  test("rechecks owner authority after provider creation and withholds the binding on drift", async () => {
    const fixture = runtimeFixture({
      afterProviderCreate: async (database) => {
        database.write(`${COLLECTIONS.authorities}/org_alpha`, storedAuthority({
          authorityRevision: 2,
          sourceReceiptDigest: "f".repeat(64)
        }));
      }
    });
    const begin = await fixture.edgeService.beginStripeConnectOnboarding(actorRequest(mutation(
      "beginStripeConnectOnboarding",
      0,
      0,
      "begin-command-post-provider-authority-0001"
    )));

    await expect(fixture.executor.executeProviderCommand({
      commandId: begin.command.commandId,
      workerId: "connect_worker_authority_recheck",
      leaseId: "connect-worker-lease-authority-0001"
    })).resolves.toMatchObject({
      receipt: { state: "quarantined", safeCode: "provider_authority_changed" }
    });
    const authorityDriftStatus = await fixture.repository.readStatus("org_alpha");
    expect(authorityDriftStatus).toMatchObject({
      connectionState: "security_review",
      lastProviderQuarantine: {
        safeCode: "provider_authority_changed",
        providerReferenceDigest: expect.stringMatching(/^[a-f0-9]{64}$/)
      }
    });
    expect(authorityDriftStatus).not.toHaveProperty("privateAccountBinding");
    expect(fixture.database.entries().some(([path, value]) => (
      path.startsWith(`${COLLECTIONS.providerQuarantines}/`)
      && value.privateProviderEvidence?.privateAccountId === "acct_connectedSandbox01"
    ))).toBe(true);
  });

  test("reconstructs the exact quarantine after command-receipt interruption", async () => {
    const providerError = new StripeSandboxAccountQuarantineError(
      "provider response requires review",
      {
        privateAccountId: "acct_recoveryQuarantine01",
        providerMode: "sandbox",
        platformAccountBinding: "acct_platformSandbox001",
        configurationDigest: REVIEWED_CONFIGURATION_DIGEST,
        providerResponseDigest: "a".repeat(64),
        reviewReason: "unreviewed_configuration"
      }
    );
    const fixture = runtimeFixture({
      interruptCommandCompletion: true,
      providerOverrides: {
        createMerchantAccount: vi.fn(async () => { throw providerError; })
      }
    });
    const begin = await fixture.edgeService.beginStripeConnectOnboarding(actorRequest(mutation(
      "beginStripeConnectOnboarding",
      0,
      0,
      "begin-command-quarantine-recovery-0001"
    )));
    const identity = {
      commandId: begin.command.commandId,
      workerId: "connect_worker_quarantine_recovery",
      leaseId: "connect-worker-lease-quarantine-0001"
    };

    await expect(fixture.executor.executeProviderCommand(identity))
      .rejects.toThrow(/simulated command receipt interruption/i);
    const firstQuarantine = (await fixture.repository.readStatus("org_alpha")).lastProviderQuarantine;
    expect(firstQuarantine).toMatchObject({
      safeCode: "provider_failed-precondition",
      requestDigest: begin.command.requestDigest,
      providerReferenceDigest: expect.stringMatching(/^[a-f0-9]{64}$/)
    });

    await expect(fixture.executor.executeProviderCommand(identity)).resolves.toMatchObject({
      receipt: {
        state: "quarantined",
        safeCode: "provider_failed-precondition",
        resultDigest: firstQuarantine.reasonDigest,
        providerReferenceDigest: firstQuarantine.providerReferenceDigest
      }
    });
    expect(fixture.provider.createMerchantAccount).toHaveBeenCalledTimes(1);
    expect(fixture.commandWorker.completeCommand).toHaveBeenCalledTimes(2);
  });

  test("rejects identity-backed quarantine replay when its private account claim is missing or tampered", async () => {
    for (const claimState of ["missing", "tampered"]) {
      const providerError = new StripeSandboxAccountQuarantineError(
        "provider response requires review",
        {
          privateAccountId: "acct_corruptQuarantine01",
          providerMode: "sandbox",
          platformAccountBinding: "acct_platformSandbox001",
          configurationDigest: REVIEWED_CONFIGURATION_DIGEST,
          providerResponseDigest: "b".repeat(64),
          reviewReason: "unreviewed_configuration"
        }
      );
      const fixture = runtimeFixture({
        interruptCommandCompletion: true,
        providerOverrides: {
          createMerchantAccount: vi.fn(async () => { throw providerError; })
        }
      });
      const begin = await fixture.edgeService.beginStripeConnectOnboarding(actorRequest(mutation(
        "beginStripeConnectOnboarding",
        0,
        0,
        `begin-command-corrupt-quarantine-${claimState}-0001`
      )));
      const identity = {
        commandId: begin.command.commandId,
        workerId: "connect_worker_corrupt_quarantine",
        leaseId: `connect-worker-lease-corrupt-${claimState}-0001`
      };
      await expect(fixture.executor.executeProviderCommand(identity))
        .rejects.toThrow(/simulated command receipt interruption/i);
      const [bindingPath, binding] = fixture.database.entries().find(([path]) => (
        path.startsWith(`${COLLECTIONS.accountBindings}/`)
      ));
      if (claimState === "missing") fixture.database.remove(bindingPath);
      else fixture.database.write(bindingPath, { ...binding, privateAccountId: "acct_tamperedIdentity01" });

      await expect(fixture.executor.executeProviderCommand(identity))
        .rejects.toMatchObject({ code: "data-loss" });
      expect(fixture.provider.createMerchantAccount).toHaveBeenCalledTimes(1);
    }
  });

  test("quarantines deterministic provider-contract failure without a replacement account", async () => {
    const providerError = new contracts.StripeConnectInterfaceError(
      "failed-precondition",
      "provider model mismatch"
    );
    const fixture = runtimeFixture({
      providerOverrides: {
        createMerchantAccount: vi.fn(async () => { throw providerError; })
      }
    });
    const begin = await fixture.edgeService.beginStripeConnectOnboarding(actorRequest(mutation(
      "beginStripeConnectOnboarding",
      0,
      0,
      "begin-command-quarantine-request-0001"
    )));
    const outcome = await fixture.executor.executeProviderCommand({
      commandId: begin.command.commandId,
      workerId: "connect_worker_one",
      leaseId: "connect-worker-lease-000005"
    });

    expect(outcome).toMatchObject({
      receipt: { state: "quarantined", safeCode: "provider_failed-precondition" }
    });
    expect(await fixture.repository.readStatus("org_alpha")).toMatchObject({
      revision: 2,
      generation: 1,
      connectionState: "security_review",
      activeReservation: { requestId: "begin-command-quarantine-request-0001" }
    });
    expect(fixture.provider.createMerchantAccount).toHaveBeenCalledTimes(1);
  });

  test("quarantines an expired provider-recovery reservation before calling Stripe", async () => {
    const fixture = runtimeFixture();
    const begin = await fixture.edgeService.beginStripeConnectOnboarding(actorRequest(mutation(
      "beginStripeConnectOnboarding",
      0,
      0,
      "begin-command-expired-recovery-0001"
    )));
    const organizationPath = `${COLLECTIONS.organizations}/org_alpha`;
    const status = fixture.database.read(organizationPath);
    fixture.database.write(organizationPath, {
      ...status,
      activeReservation: {
        ...status.activeReservation,
        providerRecoveryExpiresAtISO: new Date(NOW_MS - 1).toISOString()
      }
    });

    await expect(fixture.executor.executeProviderCommand({
      commandId: begin.command.commandId,
      workerId: "connect_worker_expired",
      leaseId: "connect-worker-lease-expired-00001"
    })).resolves.toMatchObject({
      receipt: { state: "quarantined", safeCode: "provider_failed-precondition" }
    });
    expect(fixture.provider.createMerchantAccount).not.toHaveBeenCalled();
    expect(await fixture.repository.readStatus("org_alpha")).toMatchObject({
      connectionState: "security_review",
      lastProviderQuarantine: { operation: "create_merchant_account" }
    });
  });
});
