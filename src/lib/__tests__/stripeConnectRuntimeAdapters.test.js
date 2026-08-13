import { beforeEach, describe, expect, test, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const contracts = require("../../../functions-connect/interfaceContracts.js");
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
  projectAccountObservation
} = require("../../../functions-connect/stripeSandboxAdapter.js");
const {
  STRIPE_CONNECT_API_VERSION,
  STRIPE_CONNECT_SDK_VERSION
} = require("../../../functions-connect/runtimePolicy.js");
const { createStripeConnectStatusOnboardingService } = require(
  "../../../functions-connect/statusOnboardingService.js"
);

const NOW_MS = Date.parse("2026-08-13T12:00:00.000Z");
const RATE_KEY = "connect-runtime-rate-limit-test-key-at-least-32-bytes";
const ORIGIN = "https://quotepilot-staging-20260804.web.app";
const PLATFORM_ACCOUNT = "acct_platformSandbox001";

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
        applied: true,
        capabilities: {
          card_payments: { status: "pending", status_details: [] }
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

describe("Connect named-database repository", () => {
  let database;
  let repository;

  beforeEach(() => {
    database = createMemoryFirestore({
      [`${COLLECTIONS.authorities}/org_alpha`]: {
        organizationId: "org_alpha",
        ownerUid: "owner_uid"
      }
    });
    repository = createConnectControlRepository({ database, now: () => NOW_MS });
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

  test("reserves a generation and stable 30-day provider identity before account creation", async () => {
    const input = mutation("beginStripeConnectOnboarding");
    const first = await repository.reserveOnboarding({
      organizationId: "org_alpha",
      actorUid: "owner_uid",
      actorEmail: "owner@example.test",
      input,
      reservedAtISO: new Date(NOW_MS).toISOString()
    });
    const replay = await repository.reserveOnboarding({
      organizationId: "org_alpha",
      actorUid: "owner_uid",
      actorEmail: "owner@example.test",
      input,
      reservedAtISO: new Date(NOW_MS + 1000).toISOString()
    });

    expect(first).toMatchObject({
      requestId: input.requestId,
      payloadDigest: input.payloadDigest,
      providerIdempotencyKey: expect.stringMatching(/^qpca_[a-f0-9]{64}$/),
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
      input,
      reservedAtISO: new Date(NOW_MS).toISOString()
    });
    await expect(repository.reserveOnboarding({
      organizationId: "org_alpha",
      actorUid: "new_owner_uid",
      actorEmail: "new-owner@example.test",
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
    expect(JSON.stringify(database.entries())).not.toContain("owner@example.test");
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
      input: alphaInput,
      reservedAtISO: new Date(NOW_MS).toISOString()
    });
    await repository.completeOnboarding({
      organizationId: "org_alpha",
      reservation: alphaReservation,
      providerAccount,
      publicReceipt: publicReceipt(alphaInput, alphaReservation.outcome),
      completedAtISO: new Date(NOW_MS).toISOString()
    });

    const betaInput = mutation("beginStripeConnectOnboarding", {
      requestId: "beginStripeConnectOnboarding-beta-request-0001"
    });
    const betaReservation = await repository.reserveOnboarding({
      organizationId: "org_beta",
      actorUid: "owner_beta",
      actorEmail: "beta@example.test",
      input: betaInput,
      reservedAtISO: new Date(NOW_MS).toISOString()
    });
    await expect(repository.completeOnboarding({
      organizationId: "org_beta",
      reservation: betaReservation,
      providerAccount,
      publicReceipt: publicReceipt(betaInput, betaReservation.outcome),
      completedAtISO: new Date(NOW_MS).toISOString()
    })).rejects.toMatchObject({ code: "failed-precondition" });
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
      schemaVersion: 1,
      organizationId: "org_alpha",
      generation: 1,
      revision: 3,
      requestId: "prepare-runtime-request-0001",
      payloadDigest: "c".repeat(64),
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
    expect(stored).toMatchObject({ state: "consumed", providerExpiresAtISO: "2026-08-13T12:05:00.000Z" });
    expect(JSON.stringify(stored)).not.toMatch(/https?:\/\//i);
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
    for (let index = 0; index < RATE_LIMIT_POLICIES.refresh_status[0].limit; index += 1) {
      await expect(limiter.consume({
        operation: "refresh_status",
        organizationId: "org_alpha",
        principalDigest,
        nowISO: new Date(NOW_MS + index).toISOString()
      })).resolves.toMatchObject({ allowed: true, operation: "refresh_status" });
    }
    await expect(limiter.consume({
      operation: "refresh_status",
      organizationId: "org_alpha",
      principalDigest,
      nowISO: new Date(NOW_MS + 10).toISOString()
    })).rejects.toMatchObject({ code: "resource-exhausted", retryAfterSeconds: expect.any(Number) });
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
    const adapter = createStripeSandboxAdapter({
      stripeClient: { v2: { core: { accounts, accountLinks } } },
      apiVersion: STRIPE_CONNECT_API_VERSION,
      sdkVersion: STRIPE_CONNECT_SDK_VERSION,
      providerMode: "sandbox",
      platformAccountBinding: PLATFORM_ACCOUNT,
      canonicalReturnOrigin: ORIGIN
    });
    return { adapter, accounts, accountLinks };
  }

  test("creates only the reviewed merchant/full-Dashboard/Stripe-responsibility payload", async () => {
    const fixture = createFixture();
    await expect(fixture.adapter.createMerchantAccount({
      idempotencyKey: `qpca_${"a".repeat(64)}`,
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
    }, { idempotencyKey: `qpca_${"a".repeat(64)}` });
    expect(JSON.stringify(fixture.accounts.create.mock.calls)).not.toMatch(
      /application_fee_amount|transfer_data|on_behalf_of/
    );
  });

  test("projects current provider truth and rejects live or responsibility-mismatched accounts", async () => {
    expect(projectAccountObservation(reviewedAccount({
      configuration: {
        merchant: {
          applied: true,
          capabilities: { card_payments: { status: "active", status_details: [] } }
        }
      }
    }))).toMatchObject({
      connectionState: "ready",
      requirementState: "clear",
      healthState: "healthy",
      cardPaymentsState: "active",
      responsibilityState: "confirmed"
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
});

describe("Connect reservation-to-provider recovery", () => {
  test("reuses the same Accounts v2 idempotency key after provider success and interrupted completion", async () => {
    const database = createMemoryFirestore({
      [`${COLLECTIONS.authorities}/org_alpha`]: {
        organizationId: "org_alpha",
        ownerUid: "owner_uid"
      }
    });
    const concreteRepository = createConnectControlRepository({ database, now: () => NOW_MS });
    let interruptCompletion = true;
    const repository = {
      ...concreteRepository,
      completeOnboarding: vi.fn(async (input) => {
        if (interruptCompletion) {
          interruptCompletion = false;
          throw new Error("simulated database interruption after provider success");
        }
        return concreteRepository.completeOnboarding(input);
      })
    };
    const account = reviewedAccount();
    const accounts = {
      create: vi.fn(async () => account),
      retrieve: vi.fn(async () => account)
    };
    const accountLinks = { create: vi.fn() };
    const provider = createStripeSandboxAdapter({
      stripeClient: { v2: { core: { accounts, accountLinks } } },
      apiVersion: STRIPE_CONNECT_API_VERSION,
      sdkVersion: STRIPE_CONNECT_SDK_VERSION,
      providerMode: "sandbox",
      platformAccountBinding: PLATFORM_ACCOUNT,
      canonicalReturnOrigin: ORIGIN
    });
    const rateLimiter = createDurableConnectRateLimiter({ database, hmacKey: RATE_KEY });
    const principalHasher = createConnectPrincipalHasher({ hmacKey: RATE_KEY });
    const service = createStripeConnectStatusOnboardingService({
      repository,
      provider,
      rateLimiter,
      principalHasher,
      hmacKey: "connect-onboarding-handoff-test-key-at-least-32-bytes",
      canonicalReturnOrigin: ORIGIN,
      now: () => NOW_MS
    });
    const data = mutation("beginStripeConnectOnboarding");
    const request = {
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

    await expect(service.beginStripeConnectOnboarding(request)).rejects.toThrow(/simulated database interruption/i);
    expect(database.read(`${COLLECTIONS.organizations}/org_alpha`)).toMatchObject({
      connectionState: "provisioning",
      activeReservation: { payloadDigest: data.payloadDigest }
    });
    await expect(service.beginStripeConnectOnboarding(request)).resolves.toMatchObject({
      operation: "beginStripeConnectOnboarding",
      generation: 1,
      revision: 1,
      state: "onboarding"
    });
    await expect(service.beginStripeConnectOnboarding(request)).resolves.toMatchObject({
      operation: "beginStripeConnectOnboarding",
      generation: 1,
      revision: 1
    });
    expect(accounts.create).toHaveBeenCalledTimes(2);
    expect(accounts.create.mock.calls[0][1]).toEqual(accounts.create.mock.calls[1][1]);
    expect(repository.completeOnboarding).toHaveBeenCalledTimes(2);
  });
});
