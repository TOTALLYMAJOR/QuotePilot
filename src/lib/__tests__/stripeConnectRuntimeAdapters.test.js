import { beforeEach, describe, expect, test, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const contracts = require("../../../functions-connect/interfaceContracts.js");
const {
  buildConnectAuthorityProjection
} = require("../../../functions-connect/authorityProjection.js");
const {
  COLLECTIONS,
  createConnectControlRepository,
  createNamedConnectControlDatabase
} = require("../../../functions-connect/connectControlRepository.js");
const {
  RATE_LIMIT_POLICIES,
  createConnectPrincipalHasher,
  createDurableConnectRateLimiter
} = require("../../../functions-connect/durableRateLimiter.js");
const {
  REVIEWED_CONFIGURATION_DIGEST,
  createStripeSandboxAdapter,
  hasReviewedConfiguration,
  projectAccountObservation
} = require("../../../functions-connect/stripeSandboxAdapter.js");
const {
  STRIPE_CONNECT_API_VERSION,
  STRIPE_CONNECT_SDK_VERSION
} = require("../../../functions-connect/runtimePolicy.js");

const NOW_MS = Date.parse("2026-08-13T12:00:00.000Z");
const RATE_KEY = "connect-runtime-rate-limit-test-key-at-least-32-bytes";
const ORIGIN = "https://quotepilot-staging-20260804.web.app";
const PLATFORM_ACCOUNT = "acct_platformSandbox001";
const AUTHORITY_PUBLISHER = "stripe-connect-authority-publisher@quotepilot-staging-20260804.iam.gserviceaccount.com";

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function createMemoryFirestore(seed = {}) {
  const records = new Map(Object.entries(seed).map(([path, value]) => [path, clone(value)]));
  let failTransactions = false;
  const snapshot = (path, source = records) => ({
    exists: source.has(path),
    data: () => clone(source.get(path))
  });
  const doc = (path) => ({
    path,
    get: async () => snapshot(path)
  });
  const database = {
    doc,
    seed(path, value) {
      records.set(path, clone(value));
    },
    read(path) {
      return clone(records.get(path));
    },
    entries() {
      return [...records.entries()].map(([path, value]) => [path, clone(value)]);
    },
    setTransactionFailure(value) {
      failTransactions = value;
    },
    async runTransaction(callback) {
      if (failTransactions) throw new Error("database unavailable");
      const view = new Map([...records.entries()].map(([path, value]) => [path, clone(value)]));
      const writes = [];
      const transaction = {
        get: async (ref) => snapshot(ref.path, view),
        set(ref, value) {
          writes.push({ type: "set", path: ref.path, value: clone(value) });
        },
        create(ref, value) {
          if (view.has(ref.path) || writes.some((write) => write.path === ref.path)) {
            const error = new Error("already exists");
            error.code = 6;
            throw error;
          }
          writes.push({ type: "create", path: ref.path, value: clone(value) });
        }
      };
      const result = await callback(transaction);
      for (const write of writes) records.set(write.path, clone(write.value));
      return result;
    }
  };
  return database;
}

function mutation(operation, overrides = {}) {
  const input = {
    requestId: `${operation}-runtime-request-0001`,
    expectedRevision: 0,
    expectedGeneration: 0,
    ...overrides
  };
  input.payloadDigest = contracts.buildConnectMutationPayloadDigest(operation, input);
  return input;
}

function publicReceipt(input, outcome = { revision: 1, generation: 1, state: "onboarding" }) {
  return contracts.buildConnectMutationReceiptV1({
    operation: "beginStripeConnectOnboarding",
    request: input,
    outcome,
    completedAtISO: new Date(NOW_MS).toISOString()
  });
}

function reviewedAccount(overrides = {}) {
  return {
    id: "acct_connectedSandbox01",
    object: "v2.core.account",
    livemode: false,
    closed: false,
    dashboard: "full",
    applied_configurations: ["merchant"],
    defaults: {
      currency: "usd",
      responsibilities: {
        fees_collector: "stripe",
        losses_collector: "stripe",
        requirements_collector: "stripe"
      }
    },
    configuration: {
      merchant: {
        applied: "2026-08-13T11:55:00.000Z",
        capabilities: {
          card_payments: { status: "pending", status_details: [] },
          stripe_balance: {
            payouts: { status: "pending", status_details: [] }
          }
        }
      }
    },
    requirements: { entries: [] },
    ...overrides
  };
}

function privateBinding(overrides = {}) {
  return {
    bindingId: "f".repeat(64),
    privateAccountId: "acct_connectedSandbox01",
    providerMode: "sandbox",
    platformAccountBinding: PLATFORM_ACCOUNT,
    configurationDigest: REVIEWED_CONFIGURATION_DIGEST,
    generation: 1,
    ...overrides
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

describe("Connect named-database repository", () => {
  let database;
  let repository;

  beforeEach(() => {
    database = createMemoryFirestore({
      [`${COLLECTIONS.authorities}/org_alpha`]: storedAuthority()
    });
    repository = createConnectControlRepository({
      database,
      now: () => NOW_MS,
      authorityPublisherIdentity: AUTHORITY_PUBLISHER
    });
  });

  test("selects only the exact connect-control database", () => {
    const selected = createMemoryFirestore();
    const getFirestore = vi.fn(() => selected);
    expect(createNamedConnectControlDatabase({
      firebaseApp: { name: "connect" },
      getFirestore,
      databaseId: "connect-control"
    })).toBe(selected);
    expect(getFirestore).toHaveBeenCalledWith({ name: "connect" }, "connect-control");
    expect(() => createNamedConnectControlDatabase({
      firebaseApp: {},
      getFirestore,
      databaseId: "(default)"
    })).toThrow(/connect-control/i);
  });

  test("applies monotonically versioned authority projections with immutable replay receipts", async () => {
    const emptyDatabase = createMemoryFirestore();
    const authorityRepository = createConnectControlRepository({
      database: emptyDatabase,
      now: () => NOW_MS,
      authorityPublisherIdentity: AUTHORITY_PUBLISHER
    });
    const first = authorityProjection();
    await expect(authorityRepository.applyAuthorityProjection({
      projection: first,
      publisherIdentity: AUTHORITY_PUBLISHER,
      receivedAtISO: new Date(NOW_MS).toISOString()
    })).resolves.toEqual({
      replayed: false,
      authorityRevision: 1,
      payloadDigest: first.payloadDigest
    });
    await expect(authorityRepository.applyAuthorityProjection({
      projection: first,
      publisherIdentity: AUTHORITY_PUBLISHER,
      receivedAtISO: new Date(NOW_MS + 1).toISOString()
    })).resolves.toMatchObject({ replayed: true, authorityRevision: 1 });
    await expect(authorityRepository.readAuthority("org_alpha")).resolves.toEqual(first);

    await expect(authorityRepository.applyAuthorityProjection({
      projection: authorityProjection({
        authorityRevision: 2,
        ownerUid: "another_owner",
        members: [{
          uid: "another_owner",
          email: "another-owner@example.test",
          role: "admin",
          emailVerified: true,
          disabled: false
        }]
      }),
      publisherIdentity: AUTHORITY_PUBLISHER,
      receivedAtISO: new Date(NOW_MS + 2).toISOString()
    })).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(authorityRepository.applyAuthorityProjection({
      projection: authorityProjection({ authorityRevision: 2 }),
      publisherIdentity: "unexpected-publisher@example.test",
      receivedAtISO: new Date(NOW_MS + 2).toISOString()
    })).rejects.toMatchObject({ code: "permission-denied" });
  });

  test("reserves a generation, authority digest, and 30-day recovery deadline before account creation", async () => {
    const input = mutation("beginStripeConnectOnboarding");
    const first = await repository.reserveOnboarding({
      organizationId: "org_alpha",
      actorUid: "owner_uid",
      actorEmail: "owner@example.test",
      authorityPayloadDigest: authorityProjection().payloadDigest,
      input,
      reservedAtISO: new Date(NOW_MS).toISOString()
    });
    const replay = await repository.reserveOnboarding({
      organizationId: "org_alpha",
      actorUid: "owner_uid",
      actorEmail: "owner@example.test",
      authorityPayloadDigest: authorityProjection().payloadDigest,
      input,
      reservedAtISO: new Date(NOW_MS + 1000).toISOString()
    });

    expect(first).toMatchObject({
      requestId: input.requestId,
      payloadDigest: input.payloadDigest,
      authorityPayloadDigest: authorityProjection().payloadDigest,
      providerRecoveryExpiresAtISO: new Date(NOW_MS + 30 * 24 * 60 * 60 * 1000).toISOString(),
      outcome: { revision: 1, generation: 1, state: "onboarding" }
    });
    expect(replay).toEqual(first);
    expect(database.read(`${COLLECTIONS.organizations}/org_alpha`)).toMatchObject({
      organizationId: "org_alpha",
      revision: 1,
      generation: 1,
      connectionState: "provisioning",
      activeReservation: { reservationId: first.reservationId }
    });
  });

  test("quarantines reservation recovery when canonical owner identity changes", async () => {
    const input = mutation("beginStripeConnectOnboarding");
    await repository.reserveOnboarding({
      organizationId: "org_alpha",
      actorUid: "owner_uid",
      actorEmail: "owner@example.test",
      authorityPayloadDigest: authorityProjection().payloadDigest,
      input,
      reservedAtISO: new Date(NOW_MS).toISOString()
    });
    await expect(repository.reserveOnboarding({
      organizationId: "org_alpha",
      actorUid: "new_owner_uid",
      actorEmail: "new-owner@example.test",
      authorityPayloadDigest: authorityProjection().payloadDigest,
      input,
      reservedAtISO: new Date(NOW_MS + 1000).toISOString()
    })).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(repository.readStatus("org_alpha")).resolves.toMatchObject({
      connectionState: "security_review"
    });
  });

  test("atomically binds one provider account and stores a replay-stable private receipt", async () => {
    const input = mutation("beginStripeConnectOnboarding");
    const reservation = await repository.reserveOnboarding({
      organizationId: "org_alpha",
      actorUid: "owner_uid",
      actorEmail: "owner@example.test",
      authorityPayloadDigest: authorityProjection().payloadDigest,
      input,
      reservedAtISO: new Date(NOW_MS).toISOString()
    });
    const receipt = publicReceipt(input, reservation.outcome);
    const providerAccount = {
      privateAccountId: "acct_connectedSandbox01",
      providerMode: "sandbox",
      platformAccountBinding: PLATFORM_ACCOUNT,
      configurationDigest: REVIEWED_CONFIGURATION_DIGEST
    };

    await expect(repository.completeOnboarding({
      organizationId: "org_alpha",
      reservation,
      providerAccount,
      publicReceipt: receipt,
      providerCommandIdentity: {
        commandId: "1".repeat(64),
        requestDigest: "2".repeat(64)
      },
      completedAtISO: new Date(NOW_MS).toISOString()
    })).resolves.toEqual(receipt);

    const status = await repository.readStatus("org_alpha");
    expect(status).toMatchObject({
      revision: 1,
      generation: 1,
      connectionState: "onboarding",
      privateAccountBinding: {
        ...privateBinding(),
        bindingId: expect.stringMatching(/^[a-f0-9]{64}$/)
      }
    });
    expect(status.activeReservation).toBeNull();
    await expect(repository.findMutationReceipt({
      organizationId: "org_alpha",
      operation: "beginStripeConnectOnboarding",
      requestId: input.requestId
    })).resolves.toEqual({ payloadDigest: input.payloadDigest, publicReceipt: receipt });
    expect(JSON.stringify(
      database.entries().filter(([path]) => !path.startsWith(`${COLLECTIONS.authorities}/`))
    )).not.toContain("owner@example.test");
  });

  test("rejects an unreviewed platform or configuration before provider binding", async () => {
    const input = mutation("beginStripeConnectOnboarding", {
      requestId: "beginStripeConnectOnboarding-invalid-binding-0001"
    });
    const reservation = await repository.reserveOnboarding({
      organizationId: "org_alpha",
      actorUid: "owner_uid",
      actorEmail: "owner@example.test",
      authorityPayloadDigest: authorityProjection().payloadDigest,
      input,
      reservedAtISO: new Date(NOW_MS).toISOString()
    });
    const completion = {
      organizationId: "org_alpha",
      reservation,
      publicReceipt: publicReceipt(input, reservation.outcome),
      providerCommandIdentity: {
        commandId: "f".repeat(64),
        requestDigest: "e".repeat(64)
      },
      completedAtISO: new Date(NOW_MS).toISOString()
    };

    await expect(repository.completeOnboarding({
      ...completion,
      providerAccount: {
        privateAccountId: "acct_connectedSandbox01",
        providerMode: "sandbox",
        platformAccountBinding: "foreign_platform",
        configurationDigest: REVIEWED_CONFIGURATION_DIGEST
      }
    })).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(repository.completeOnboarding({
      ...completion,
      providerAccount: {
        privateAccountId: "acct_connectedSandbox01",
        providerMode: "sandbox",
        platformAccountBinding: PLATFORM_ACCOUNT,
        configurationDigest: "0".repeat(64)
      }
    })).rejects.toMatchObject({ code: "failed-precondition" });
    expect(database.entries().some(([path]) => (
      path.startsWith(`${COLLECTIONS.accountBindings}/`)
    ))).toBe(false);
  });

  test("rechecks authority with the current transaction-attempt clock before account binding", async () => {
    let currentNowMs = NOW_MS;
    const timedDatabase = createMemoryFirestore({
      [`${COLLECTIONS.authorities}/org_alpha`]: storedAuthority()
    });
    const timedRepository = createConnectControlRepository({
      database: timedDatabase,
      now: () => currentNowMs,
      authorityPublisherIdentity: AUTHORITY_PUBLISHER
    });
    const input = mutation("beginStripeConnectOnboarding", {
      requestId: "beginStripeConnectOnboarding-expired-at-commit-0001"
    });
    const reservation = await timedRepository.reserveOnboarding({
      organizationId: "org_alpha",
      actorUid: "owner_uid",
      actorEmail: "owner@example.test",
      authorityPayloadDigest: authorityProjection().payloadDigest,
      input,
      reservedAtISO: new Date(NOW_MS).toISOString()
    });
    currentNowMs = NOW_MS + 600_001;

    await expect(timedRepository.completeOnboarding({
      organizationId: "org_alpha",
      reservation,
      providerAccount: {
        privateAccountId: "acct_expiredAuthority01",
        providerMode: "sandbox",
        platformAccountBinding: PLATFORM_ACCOUNT,
        configurationDigest: REVIEWED_CONFIGURATION_DIGEST
      },
      publicReceipt: publicReceipt(input, reservation.outcome),
      providerCommandIdentity: {
        commandId: "d".repeat(64),
        requestDigest: "c".repeat(64)
      },
      completedAtISO: new Date(NOW_MS + 1_000).toISOString()
    })).resolves.toMatchObject({
      quarantined: true,
      quarantine: {
        safeCode: "provider_authority_changed",
        quarantinedAtISO: new Date(currentNowMs).toISOString()
      }
    });
    await expect(timedRepository.readStatus("org_alpha")).resolves.toMatchObject({
      connectionState: "security_review"
    });
  });

  test("quarantines a provider account that collides with another organization generation", async () => {
    const providerAccount = {
      privateAccountId: "acct_connectedSandbox01",
      providerMode: "sandbox",
      platformAccountBinding: PLATFORM_ACCOUNT,
      configurationDigest: REVIEWED_CONFIGURATION_DIGEST
    };
    const alphaInput = mutation("beginStripeConnectOnboarding");
    const alphaReservation = await repository.reserveOnboarding({
      organizationId: "org_alpha",
      actorUid: "owner_uid",
      actorEmail: "owner@example.test",
      authorityPayloadDigest: authorityProjection().payloadDigest,
      input: alphaInput,
      reservedAtISO: new Date(NOW_MS).toISOString()
    });
    await repository.completeOnboarding({
      organizationId: "org_alpha",
      reservation: alphaReservation,
      providerAccount,
      publicReceipt: publicReceipt(alphaInput, alphaReservation.outcome),
      providerCommandIdentity: {
        commandId: "3".repeat(64),
        requestDigest: "4".repeat(64)
      },
      completedAtISO: new Date(NOW_MS).toISOString()
    });

    const betaAuthority = storedAuthority({
      organizationId: "org_beta",
      ownerUid: "owner_beta",
      members: [{
        uid: "owner_beta",
        email: "beta@example.test",
        role: "admin",
        emailVerified: true,
        disabled: false
      }],
      sourceReceiptId: "owner-binding:org_beta"
    });
    database.seed(`${COLLECTIONS.authorities}/org_beta`, betaAuthority);
    const betaInput = mutation("beginStripeConnectOnboarding", {
      requestId: "beginStripeConnectOnboarding-beta-request-0001"
    });
    const betaReservation = await repository.reserveOnboarding({
      organizationId: "org_beta",
      actorUid: "owner_beta",
      actorEmail: "beta@example.test",
      authorityPayloadDigest: betaAuthority.payloadDigest,
      input: betaInput,
      reservedAtISO: new Date(NOW_MS).toISOString()
    });
    await expect(repository.completeOnboarding({
      organizationId: "org_beta",
      reservation: betaReservation,
      providerAccount,
      publicReceipt: publicReceipt(betaInput, betaReservation.outcome),
      providerCommandIdentity: {
        commandId: "5".repeat(64),
        requestDigest: "6".repeat(64)
      },
      completedAtISO: new Date(NOW_MS).toISOString()
    })).resolves.toMatchObject({
      quarantined: true,
      quarantine: { safeCode: "provider_binding_conflict" }
    });
    await expect(repository.readStatus("org_beta")).resolves.toMatchObject({
      connectionState: "security_review",
      generation: 1
    });
  });

  test("consumes each HMAC-digested handoff once and retains no provider URL", async () => {
    const statusPath = `${COLLECTIONS.organizations}/org_alpha`;
    database.seed(statusPath, {
      organizationId: "org_alpha",
      revision: 3,
      generation: 1,
      connectionState: "onboarding",
      routingState: "legacy_platform",
      privateAccountBinding: privateBinding()
    });
    const tokenDigest = "a".repeat(64);
    const attemptDigest = "b".repeat(64);
    await repository.savePreparedHandoff({
      schemaVersion: 2,
      organizationId: "org_alpha",
      generation: 1,
      revision: 3,
      requestId: "prepare-runtime-request-0001",
      payloadDigest: "c".repeat(64),
      ownerUid: "owner_uid",
      authorityRevision: 1,
      appIdDigest: "d".repeat(64),
      tokenDigest,
      attemptDigest,
      state: "prepared",
      createdAtISO: new Date(NOW_MS).toISOString(),
      expiresAtISO: new Date(NOW_MS + 600_000).toISOString()
    });

    await expect(repository.consumePreparedHandoff({
      tokenDigest,
      nowISO: new Date(NOW_MS).toISOString()
    })).resolves.toMatchObject({ state: "consumed", privateAccountBinding: privateBinding() });
    await expect(repository.consumePreparedHandoff({
      tokenDigest,
      nowISO: new Date(NOW_MS + 1).toISOString()
    })).resolves.toBeNull();
    await repository.recordProviderExpiry({
      tokenDigest,
      attemptDigest,
      expiresAtISO: new Date(NOW_MS + 300_000).toISOString()
    });
    const stored = database.read(`${COLLECTIONS.onboardingHandoffs}/${tokenDigest}`);
    expect(stored).toMatchObject({ state: "provider_issued", providerExpiresAtISO: "2026-08-13T12:05:00.000Z" });
    expect(database.read(statusPath)).toMatchObject({ latestOnboardingAttemptDigest: attemptDigest });
    expect(JSON.stringify(stored)).not.toMatch(/https?:\/\//i);
  });

  test("revokes a prepared handoff when authority revision or connection state changes", async () => {
    const statusPath = `${COLLECTIONS.organizations}/org_alpha`;
    database.seed(statusPath, {
      organizationId: "org_alpha",
      revision: 3,
      generation: 1,
      connectionState: "onboarding",
      routingState: "legacy_platform",
      privateAccountBinding: privateBinding()
    });
    const record = {
      schemaVersion: 2,
      organizationId: "org_alpha",
      generation: 1,
      revision: 3,
      requestId: "prepare-revocation-request-0001",
      payloadDigest: "c".repeat(64),
      ownerUid: "owner_uid",
      authorityRevision: 1,
      appIdDigest: "d".repeat(64),
      tokenDigest: "e".repeat(64),
      attemptDigest: "f".repeat(64),
      state: "prepared",
      createdAtISO: new Date(NOW_MS).toISOString(),
      expiresAtISO: new Date(NOW_MS + 600_000).toISOString()
    };
    await repository.savePreparedHandoff(record);

    database.seed(`${COLLECTIONS.authorities}/org_alpha`, storedAuthority({ authorityRevision: 2 }));
    await expect(repository.consumePreparedHandoff({
      tokenDigest: record.tokenDigest,
      nowISO: new Date(NOW_MS + 1).toISOString()
    })).resolves.toBeNull();

    database.seed(`${COLLECTIONS.authorities}/org_alpha`, storedAuthority());
    database.seed(statusPath, {
      ...database.read(statusPath),
      connectionState: "security_review"
    });
    await expect(repository.consumePreparedHandoff({
      tokenDigest: record.tokenDigest,
      nowISO: new Date(NOW_MS + 2).toISOString()
    })).resolves.toBeNull();
  });

  test("withholds a provider-issued Account Link when owner authority changes during the provider call", async () => {
    const statusPath = `${COLLECTIONS.organizations}/org_alpha`;
    database.seed(statusPath, {
      organizationId: "org_alpha",
      revision: 3,
      generation: 1,
      connectionState: "onboarding",
      routingState: "legacy_platform",
      privateAccountBinding: privateBinding()
    });
    const record = {
      schemaVersion: 2,
      organizationId: "org_alpha",
      generation: 1,
      revision: 3,
      requestId: "prepare-post-provider-authority-request-0001",
      payloadDigest: "1".repeat(64),
      ownerUid: "owner_uid",
      authorityRevision: 1,
      appIdDigest: "2".repeat(64),
      tokenDigest: "3".repeat(64),
      attemptDigest: "4".repeat(64),
      state: "prepared",
      createdAtISO: new Date(NOW_MS).toISOString(),
      expiresAtISO: new Date(NOW_MS + 600_000).toISOString()
    };
    await repository.savePreparedHandoff(record);
    await repository.consumePreparedHandoff({
      tokenDigest: record.tokenDigest,
      nowISO: new Date(NOW_MS).toISOString()
    });
    database.seed(`${COLLECTIONS.authorities}/org_alpha`, storedAuthority({
      authorityRevision: 2,
      sourceReceiptDigest: "5".repeat(64)
    }));

    await expect(repository.recordProviderExpiry({
      tokenDigest: record.tokenDigest,
      attemptDigest: record.attemptDigest,
      expiresAtISO: new Date(NOW_MS + 300_000).toISOString()
    })).resolves.toMatchObject({ state: "provider_withheld" });
    expect(database.read(`${COLLECTIONS.onboardingHandoffs}/${record.tokenDigest}`))
      .toMatchObject({ state: "provider_withheld" });
    expect(database.read(statusPath)).not.toHaveProperty("latestOnboardingAttemptDigest");
  });

  test("withholds a provider result whose effective expiry is no longer in the future", async () => {
    const statusPath = `${COLLECTIONS.organizations}/org_alpha`;
    database.seed(statusPath, {
      organizationId: "org_alpha",
      revision: 3,
      generation: 1,
      connectionState: "onboarding",
      routingState: "legacy_platform",
      privateAccountBinding: privateBinding()
    });
    const record = {
      schemaVersion: 2,
      organizationId: "org_alpha",
      generation: 1,
      revision: 3,
      requestId: "prepare-expired-provider-result-request-0001",
      payloadDigest: "6".repeat(64),
      ownerUid: "owner_uid",
      authorityRevision: 1,
      appIdDigest: "7".repeat(64),
      tokenDigest: "8".repeat(64),
      attemptDigest: "9".repeat(64),
      state: "prepared",
      createdAtISO: new Date(NOW_MS).toISOString(),
      expiresAtISO: new Date(NOW_MS + 600_000).toISOString()
    };
    await repository.savePreparedHandoff(record);
    await repository.consumePreparedHandoff({
      tokenDigest: record.tokenDigest,
      nowISO: new Date(NOW_MS).toISOString()
    });

    await expect(repository.recordProviderExpiry({
      tokenDigest: record.tokenDigest,
      attemptDigest: record.attemptDigest,
      expiresAtISO: new Date(NOW_MS - 1).toISOString()
    })).resolves.toMatchObject({ state: "provider_withheld" });
    expect(database.read(statusPath)).not.toHaveProperty("latestOnboardingAttemptDigest");
  });
});

describe("Connect durable rate limiter", () => {
  test("uses HMAC-only principals and enforces all transactional windows", async () => {
    const database = createMemoryFirestore();
    const limiter = createDurableConnectRateLimiter({ database, hmacKey: RATE_KEY });
    const hashPrincipal = createConnectPrincipalHasher({ hmacKey: RATE_KEY });
    const principalDigest = await hashPrincipal({
      operation: "refresh_status",
      organizationId: "org_alpha",
      uid: "admin_uid"
    });
    expect(principalDigest).toMatch(/^[a-f0-9]{64}$/);
    await expect(limiter.consume({
      operation: "refresh_status",
      organizationId: "org_alpha",
      principalDigest,
      nowISO: new Date(NOW_MS).toISOString()
    })).resolves.toMatchObject({ allowed: true, operation: "refresh_status" });
    await expect(limiter.consume({
      operation: "refresh_status",
      organizationId: "org_alpha",
      principalDigest,
      nowISO: new Date(NOW_MS + 9_999).toISOString()
    })).rejects.toMatchObject({ code: "resource-exhausted", retryAfterSeconds: 1 });
    for (let index = 1; index < RATE_LIMIT_POLICIES.refresh_status[0].limit; index += 1) {
      await expect(limiter.consume({
        operation: "refresh_status",
        organizationId: "org_alpha",
        principalDigest,
        nowISO: new Date(NOW_MS + index * 10_000).toISOString()
      })).resolves.toMatchObject({ allowed: true, operation: "refresh_status" });
    }
    await expect(limiter.consume({
      operation: "refresh_status",
      organizationId: "org_alpha",
      principalDigest,
      nowISO: new Date(NOW_MS + 60_000).toISOString()
    })).rejects.toMatchObject({ code: "resource-exhausted", retryAfterSeconds: expect.any(Number) });
    expect(RATE_LIMIT_POLICIES.prepare_onboarding_redirect).toEqual([
      { scope: "principal", limit: 3, windowSeconds: 15 * 60, minIntervalSeconds: 0 },
      { scope: "organization", limit: 10, windowSeconds: 24 * 60 * 60, minIntervalSeconds: 0 }
    ]);
    const stored = JSON.stringify(database.entries());
    expect(stored).not.toContain("admin_uid");
    expect(stored).not.toContain("org_alpha");
  });

  test("fails closed when transactional limiter state is unavailable", async () => {
    const database = createMemoryFirestore();
    database.setTransactionFailure(true);
    const limiter = createDurableConnectRateLimiter({ database, hmacKey: RATE_KEY });
    await expect(limiter.consume({
      operation: "begin_onboarding",
      organizationId: "org_alpha",
      principalDigest: "d".repeat(64),
      nowISO: new Date(NOW_MS).toISOString()
    })).rejects.toMatchObject({ code: "internal" });
  });
});

describe("Stripe Accounts v2 Sandbox adapter", () => {
  function createFixture({ createAccount = reviewedAccount(), retrievedAccount = reviewedAccount() } = {}) {
    const accounts = {
      create: vi.fn(async () => createAccount),
      retrieve: vi.fn(async () => retrievedAccount)
    };
    const accountLinks = {
      create: vi.fn(async () => ({
        object: "v2.core.account_link",
        account: "acct_connectedSandbox01",
        livemode: false,
        url: "https://accounts.stripe.com/r/sandbox-link#one-use",
        expires_at: "2026-08-13T12:10:00.000Z"
      }))
    };
    const platformAccounts = {
      retrieve: vi.fn(async () => ({ object: "account", id: PLATFORM_ACCOUNT }))
    };
    const balance = {
      retrieve: vi.fn(async () => ({ object: "balance", livemode: false }))
    };
    const adapter = createStripeSandboxAdapter({
      stripeClient: {
        accounts: platformAccounts,
        balance,
        v2: { core: { accounts, accountLinks } }
      },
      apiVersion: STRIPE_CONNECT_API_VERSION,
      sdkVersion: STRIPE_CONNECT_SDK_VERSION,
      providerMode: "sandbox",
      platformAccountBinding: PLATFORM_ACCOUNT,
      canonicalReturnOrigin: ORIGIN
    });
    return { adapter, accounts, accountLinks, platformAccounts, balance };
  }

  test("creates only the reviewed merchant/full-Dashboard/Stripe-responsibility payload", async () => {
    const fixture = createFixture();
    await expect(fixture.adapter.createMerchantAccount({
      idempotencyKey: `qpcmd_${"a".repeat(64)}`,
      country: "US",
      currency: "usd",
      dashboard: "full",
      feesCollector: "stripe",
      lossesCollector: "stripe",
      capabilities: { cardPayments: "requested" },
      contactEmail: "owner@example.test"
    })).resolves.toEqual({
      privateAccountId: "acct_connectedSandbox01",
      providerMode: "sandbox",
      platformAccountBinding: PLATFORM_ACCOUNT,
      configurationDigest: REVIEWED_CONFIGURATION_DIGEST
    });

    expect(fixture.accounts.create).toHaveBeenCalledWith({
      contact_email: "owner@example.test",
      dashboard: "full",
      defaults: {
        currency: "usd",
        responsibilities: { fees_collector: "stripe", losses_collector: "stripe" }
      },
      identity: { country: "US" },
      configuration: {
        merchant: { capabilities: { card_payments: { requested: true } } }
      },
      include: ["configuration.merchant", "defaults", "requirements"]
    }, { idempotencyKey: `qpcmd_${"a".repeat(64)}` });
    expect(JSON.stringify(fixture.accounts.create.mock.calls)).not.toMatch(
      /application_fee_amount|transfer_data|on_behalf_of/
    );
    expect(fixture.platformAccounts.retrieve).toHaveBeenCalledWith(PLATFORM_ACCOUNT);
    expect(fixture.balance.retrieve).toHaveBeenCalledWith();
    expect(fixture.platformAccounts.retrieve.mock.invocationCallOrder[0])
      .toBeLessThan(fixture.accounts.create.mock.invocationCallOrder[0]);
  });

  test("returns non-enumerable private identity evidence when a created account requires review", async () => {
    const fixture = createFixture({
      createAccount: reviewedAccount({
        defaults: {
          currency: "usd",
          responsibilities: {
            fees_collector: "application",
            losses_collector: "stripe",
            requirements_collector: "stripe"
          }
        }
      })
    });
    let caught;
    try {
      await fixture.adapter.createMerchantAccount({
        idempotencyKey: `qpcmd_${"f".repeat(64)}`,
        country: "US",
        currency: "usd",
        dashboard: "full",
        feesCollector: "stripe",
        lossesCollector: "stripe",
        capabilities: { cardPayments: "requested" },
        contactEmail: "owner@example.test"
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: "failed-precondition",
      privateProviderEvidence: {
        privateAccountId: "acct_connectedSandbox01",
        providerMode: "sandbox",
        platformAccountBinding: PLATFORM_ACCOUNT,
        reviewReason: "unreviewed_configuration"
      }
    });
    expect(Object.keys(caught)).not.toContain("privateProviderEvidence");
    expect(JSON.stringify(caught)).not.toContain("acct_connectedSandbox01");
  });

  test("projects current provider truth and rejects live or responsibility-mismatched accounts", async () => {
    expect(projectAccountObservation(reviewedAccount({
      configuration: {
        merchant: {
          applied: "2026-08-13T11:55:00.000Z",
          capabilities: {
            card_payments: { status: "active", status_details: [] },
            stripe_balance: {
              payouts: { status: "active", status_details: [] }
            }
          }
        }
      }
    }))).toMatchObject({
      connectionState: "ready",
      requirementState: "clear",
      healthState: "healthy",
      cardPaymentsState: "active",
      payoutsState: "active",
      responsibilityState: "confirmed"
    });
    expect(projectAccountObservation(reviewedAccount({
      configuration: {
        merchant: {
          applied: "2026-08-13T11:55:00.000Z",
          capabilities: {
            card_payments: { status: "active", status_details: [] },
            stripe_balance: {
              payouts: { status: "pending", status_details: [] }
            }
          }
        }
      }
    }))).toMatchObject({
      connectionState: "pending_review",
      healthState: "attention",
      cardPaymentsState: "active",
      payoutsState: "pending"
    });
    expect(projectAccountObservation(reviewedAccount({
      configuration: {
        merchant: {
          applied: "2026-08-13T11:55:00.000Z",
          capabilities: {
            card_payments: { status: "active", status_details: [] },
            stripe_balance: {
              payouts: { status: "restricted", status_details: [] }
            }
          }
        }
      }
    }))).toMatchObject({
      connectionState: "attention_required",
      payoutsState: "restricted"
    });
    expect(projectAccountObservation(reviewedAccount({
      requirements: {
        entries: [{
          awaiting_action_from: "user",
          minimum_deadline: { status: "past_due" }
        }]
      }
    }))).toMatchObject({
      connectionState: "attention_required",
      requirementState: "past_due",
      currentlyDueCount: 1,
      pastDueCount: 1
    });
    expect(() => projectAccountObservation(reviewedAccount({ livemode: true }))).toThrow(/Sandbox/i);
    expect(projectAccountObservation(reviewedAccount({
      defaults: {
        currency: "usd",
        responsibilities: {
          fees_collector: "application",
          losses_collector: "stripe",
          requirements_collector: "stripe"
        }
      }
    }))).toMatchObject({ connectionState: "security_review", responsibilityState: "mismatch" });
  });

  test("accepts only an applied merchant configuration with a valid RFC3339 timestamp", () => {
    expect(hasReviewedConfiguration(reviewedAccount())).toBe(true);
    expect(hasReviewedConfiguration(reviewedAccount({
      configuration: {
        merchant: {
          applied: "2026-08-13T06:55:00-05:00",
          capabilities: {}
        }
      }
    }))).toBe(true);

    for (const applied of [
      true,
      false,
      "",
      "2026-08-13",
      "2026-02-30T11:55:00.000Z",
      "2026-08-13T24:00:00.000Z",
      "2026-08-13T11:55:00.000Z "
    ]) {
      const account = reviewedAccount({
        configuration: {
          merchant: {
            applied,
            capabilities: {}
          }
        }
      });
      expect(hasReviewedConfiguration(account)).toBe(false);
      expect(projectAccountObservation(account)).toMatchObject({
        connectionState: "security_review",
        healthState: "unavailable",
        responsibilityState: "mismatch"
      });
    }
  });

  test("creates a merchant-only one-use Account Link with stable v2 idempotency", async () => {
    const fixture = createFixture();
    const result = await fixture.adapter.createAccountLink({
      privateAccountBinding: privateBinding(),
      returnUrl: `${ORIGIN}/app/integrations?focus=stripe&connect_return=complete`,
      refreshUrl: `${ORIGIN}/app/integrations?focus=stripe&connect_return=recover`,
      attemptDigest: "e".repeat(64)
    });
    expect(result).toEqual({
      url: "https://accounts.stripe.com/r/sandbox-link#one-use",
      expiresAtSeconds: Math.floor(Date.parse("2026-08-13T12:10:00.000Z") / 1000)
    });
    expect(fixture.accountLinks.create).toHaveBeenCalledWith({
      account: "acct_connectedSandbox01",
      use_case: {
        type: "account_onboarding",
        account_onboarding: {
          configurations: ["merchant"],
          collection_options: { fields: "currently_due", future_requirements: "omit" },
          return_url: `${ORIGIN}/app/integrations?focus=stripe&connect_return=complete`,
          refresh_url: `${ORIGIN}/app/integrations?focus=stripe&connect_return=recover`
        }
      }
    }, { idempotencyKey: `qpal_${"e".repeat(64)}` });
  });

  test("fails before provider access for live mode, version drift, or foreign return origins", async () => {
    expect(() => createStripeSandboxAdapter({
      stripeClient: {},
      apiVersion: STRIPE_CONNECT_API_VERSION,
      sdkVersion: STRIPE_CONNECT_SDK_VERSION,
      providerMode: "live",
      platformAccountBinding: PLATFORM_ACCOUNT,
      canonicalReturnOrigin: ORIGIN
    })).toThrow(/restricted to Stripe Sandbox/i);

    const fixture = createFixture();
    await expect(fixture.adapter.createAccountLink({
      privateAccountBinding: privateBinding(),
      returnUrl: "https://attacker.example/return",
      refreshUrl: `${ORIGIN}/app/integrations?focus=stripe`,
      attemptDigest: "e".repeat(64)
    })).rejects.toMatchObject({ code: "failed-precondition" });
    expect(fixture.accountLinks.create).not.toHaveBeenCalled();
  });

  test("fails before mutation when the credential platform or mode preflight does not match", async () => {
    const wrongPlatform = createFixture();
    wrongPlatform.platformAccounts.retrieve.mockResolvedValueOnce({
      object: "account",
      id: "acct_anotherPlatform001"
    });
    await expect(wrongPlatform.adapter.createMerchantAccount({
      idempotencyKey: `qpcmd_${"a".repeat(64)}`,
      country: "US",
      currency: "usd",
      dashboard: "full",
      feesCollector: "stripe",
      lossesCollector: "stripe",
      capabilities: { cardPayments: "requested" },
      contactEmail: "owner@example.test"
    })).rejects.toMatchObject({ code: "failed-precondition" });
    expect(wrongPlatform.accounts.create).not.toHaveBeenCalled();

    const liveMode = createFixture();
    liveMode.balance.retrieve.mockResolvedValueOnce({ object: "balance", livemode: true });
    await expect(liveMode.adapter.createMerchantAccount({
      idempotencyKey: `qpcmd_${"b".repeat(64)}`,
      country: "US",
      currency: "usd",
      dashboard: "full",
      feesCollector: "stripe",
      lossesCollector: "stripe",
      capabilities: { cardPayments: "requested" },
      contactEmail: "owner@example.test"
    })).rejects.toMatchObject({ code: "failed-precondition" });
    expect(liveMode.accounts.create).not.toHaveBeenCalled();
  });
});
