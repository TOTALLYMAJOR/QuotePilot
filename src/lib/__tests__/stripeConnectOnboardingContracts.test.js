import { describe, expect, test, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const contracts = require("../../../functions-connect/interfaceContracts.js");
const { buildConnectAuthorityProjection } = require(
  "../../../functions-connect/authorityProjection.js"
);
const handoff = require("../../../functions-connect/onboardingHandoff.js");
const { createStripeConnectStatusOnboardingService } = require(
  "../../../functions-connect/statusOnboardingService.js"
);

const NOW_MS = Date.parse("2026-08-13T12:00:00.000Z");
const HMAC_KEY = "connect-onboarding-handoff-test-key-32-bytes-minimum";
const ORIGIN = "https://quotepilot-staging-20260804.web.app";

function actorRequest({ uid = "owner_uid", role = "admin", organizationId = "org_alpha", app = true } = {}) {
  return {
    auth: {
      uid,
      token: {
        organizationId,
        role,
        email: `${uid}@example.test`,
        email_verified: true,
        auth_time: Math.floor(NOW_MS / 1000) - 30
      }
    },
    app: app ? { appId: "staging-app", alreadyConsumed: false } : null
  };
}

function mutation(operation, overrides = {}) {
  const request = {
    requestId: `${operation}-request-0001`,
    expectedRevision: 3,
    expectedGeneration: 1,
    ...overrides
  };
  request.payloadDigest = contracts.buildConnectMutationPayloadDigest(operation, request);
  return request;
}

function statusRecord(overrides = {}) {
  return {
    revision: 3,
    generation: 1,
    connectionState: "onboarding",
    routingState: "legacy_platform",
    requirementState: "due",
    currentlyDueCount: 2,
    pastDueCount: 0,
    healthState: "attention",
    refreshedAtISO: "2026-08-13T11:59:00.000Z",
    privateAccountBinding: { accountId: "acct_private_never_project" },
    ...overrides
  };
}

function authorityProjection({ ownerUid = "owner_uid", members } = {}) {
  const projectedMembers = members || [
    {
      uid: "admin_uid",
      email: "admin_uid@example.test",
      role: "admin",
      emailVerified: true,
      disabled: false
    },
    {
      uid: ownerUid,
      email: `${ownerUid}@example.test`,
      role: "admin",
      emailVerified: true,
      disabled: false
    }
  ].sort((left, right) => left.uid.localeCompare(right.uid));
  return buildConnectAuthorityProjection({
    organizationId: "org_alpha",
    authorityRevision: 4,
    organizationActive: true,
    ownerUid,
    members: projectedMembers,
    sourceReceiptId: "role-snapshot:org_alpha:4",
    sourceReceiptDigest: "a".repeat(64),
    observedAtISO: new Date(NOW_MS).toISOString(),
    expiresAtISO: new Date(NOW_MS + 600_000).toISOString()
  }, { nowMs: NOW_MS });
}

function serviceFixture({ ownerUid = "owner_uid", current = statusRecord(), provider = {}, repository = {} } = {}) {
  const defaults = {
    readAuthority: vi.fn(async () => authorityProjection({ ownerUid })),
    readStatus: vi.fn(async () => current),
    findMutationReceipt: vi.fn(async () => null),
    reserveOnboarding: vi.fn(async ({ input }) => ({
      reservationId: "7".repeat(64),
      outcome: {
        revision: input.expectedRevision + 1,
        generation: input.expectedGeneration,
        state: "onboarding"
      }
    })),
    completeOnboarding: vi.fn(async () => undefined),
    savePreparedHandoff: vi.fn(async () => undefined),
    refreshStatus: vi.fn(async ({ observation, refreshedAtISO }) => ({
      ...current,
      ...observation,
      revision: current.revision + 1,
      refreshedAtISO
    })),
    ...repository
  };
  const providerDefaults = {
    createMerchantAccount: vi.fn(async () => ({ privateAccountId: "acct_private_never_return" })),
    retrieveMerchantAccount: vi.fn(async () => ({ healthState: "healthy", requirementState: "clear" })),
    ...provider
  };
  const rateLimiter = { consume: vi.fn(async () => undefined) };
  const principalHasher = vi.fn(async () => "e".repeat(64));
  const commandEdge = {
    enqueueCommand: vi.fn(async (input) => ({
      schemaVersion: 1,
      commandId: "8".repeat(64),
      operation: input.operation,
      requestId: input.requestId,
      requestDigest: "9".repeat(64),
      payloadDigest: input.payloadDigest,
      connectionGeneration: input.connectionGeneration,
      state: "queued",
      replayed: false,
      receiptDigest: ""
    }))
  };
  return {
    repository: defaults,
    provider: providerDefaults,
    rateLimiter,
    principalHasher,
    commandEdge,
    service: createStripeConnectStatusOnboardingService({
      repository: defaults,
      commandEdge,
      rateLimiter,
      principalHasher,
      hmacKey: HMAC_KEY,
      expectedAppId: "staging-app",
      canonicalReturnOrigin: ORIGIN,
      now: () => NOW_MS
    })
  };
}

describe("Stripe Connect public interface contracts", () => {
  test("uses strict exact-key mutation schemas and rejects organization scope from the browser", () => {
    const input = mutation("beginStripeConnectOnboarding");
    expect(contracts.normalizeMutationRequest(input, "beginStripeConnectOnboarding")).toEqual(input);
    expect(() => contracts.normalizeMutationRequest(
      { ...input, organizationId: "org_other" },
      "beginStripeConnectOnboarding"
    )).toThrow(/exact supported fields/i);
    expect(() => contracts.normalizeMutationRequest(
      { ...input, expectedRevision: 4 },
      "beginStripeConnectOnboarding"
    )).toThrow(/payloadDigest/i);
  });

  test("allows same-tenant admins to read a redacted cached status while owner actions remain owner-only", async () => {
    const { service } = serviceFixture();
    const admin = actorRequest({ uid: "admin_uid" });
    const result = await service.getStripeConnectStatus({ ...admin, data: {} });

    expect(result).toMatchObject({
      schemaVersion: 1,
      revision: 3,
      generation: 1,
      connection: { state: "onboarding" },
      health: { source: "connect_control_cache", stale: false },
      actions: { canRefresh: true, canBeginOnboarding: false, canContinueOnboarding: false }
    });
    expect(JSON.stringify(result)).not.toMatch(/acct_|accountId|organizationId|ownerUid|provider/i);
  });

  test("denies non-admin, unverified, and cross-authority status access", async () => {
    const fixture = serviceFixture();
    await expect(fixture.service.getStripeConnectStatus({
      ...actorRequest({ role: "sales" }),
      data: {}
    })).rejects.toMatchObject({ code: "permission-denied" });

    const unverified = actorRequest();
    unverified.auth.token.email_verified = false;
    await expect(fixture.service.getStripeConnectStatus({ ...unverified, data: {} }))
      .rejects.toMatchObject({ code: "failed-precondition" });

    const cross = serviceFixture({
      repository: {
        readAuthority: vi.fn(async () => ({
          ...authorityProjection(),
          organizationId: "org_other"
        }))
      }
    });
    await expect(cross.service.getStripeConnectStatus({ ...actorRequest(), data: {} }))
      .rejects.toMatchObject({ code: "failed-precondition" });
  });

  test("requires the exact App Check application for every status callable", async () => {
    const fixture = serviceFixture();
    await expect(fixture.service.getStripeConnectStatus({
      ...actorRequest({ app: false }),
      data: {}
    })).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(fixture.service.getStripeConnectStatus({
      ...actorRequest(),
      app: { appId: "foreign-app", alreadyConsumed: false },
      data: {}
    })).rejects.toMatchObject({ code: "permission-denied" });

    const replayedRefresh = actorRequest();
    replayedRefresh.app.alreadyConsumed = true;
    await expect(fixture.service.refreshStripeConnectStatus({
      ...replayedRefresh,
      data: mutation("refreshStripeConnectStatus")
    })).rejects.toMatchObject({ code: "permission-denied" });
    expect(fixture.rateLimiter.consume).not.toHaveBeenCalled();
    expect(fixture.commandEdge.enqueueCommand).not.toHaveBeenCalled();
  });

  test("rate-limits live refresh and queues only a private-binding digest for the worker", async () => {
    const fixture = serviceFixture();
    const request = actorRequest({ uid: "admin_uid" });
    const result = await fixture.service.refreshStripeConnectStatus({
      ...request,
      data: mutation("refreshStripeConnectStatus")
    });

    expect(fixture.rateLimiter.consume).toHaveBeenCalledWith(expect.objectContaining({
      operation: "refresh_status",
      organizationId: "org_alpha",
      principalDigest: "e".repeat(64)
    }));
    expect(fixture.principalHasher).toHaveBeenCalledWith({
      operation: "refresh_status",
      organizationId: "org_alpha",
      uid: "admin_uid"
    });
    expect(JSON.stringify(fixture.rateLimiter.consume.mock.calls)).not.toContain("admin_uid");
    expect(fixture.commandEdge.enqueueCommand).toHaveBeenCalledWith(expect.objectContaining({
      operation: "refresh_merchant_account",
      organizationId: "org_alpha",
      payload: {
        accountBindingDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        authorityPayloadDigest: expect.stringMatching(/^[a-f0-9]{64}$/)
      }
    }));
    expect(fixture.provider.retrieveMerchantAccount).not.toHaveBeenCalled();
    expect(result).toMatchObject({ state: "queued", command: { operation: "refresh_merchant_account" } });
    expect(JSON.stringify(result)).not.toContain("acct_private_never_project");
  });

  test("requires canonical owner, recent auth, and unused App Check for onboarding", async () => {
    const fixture = serviceFixture();
    await expect(fixture.service.beginStripeConnectOnboarding({
      ...actorRequest({ uid: "admin_uid" }),
      data: mutation("beginStripeConnectOnboarding")
    })).rejects.toMatchObject({ code: "permission-denied" });

    const stale = actorRequest();
    stale.auth.token.auth_time = Math.floor(NOW_MS / 1000) - 301;
    await expect(fixture.service.beginStripeConnectOnboarding({
      ...stale,
      data: mutation("beginStripeConnectOnboarding")
    })).rejects.toMatchObject({ code: "failed-precondition" });

    const replay = actorRequest();
    replay.app.alreadyConsumed = true;
    await expect(fixture.service.beginStripeConnectOnboarding({
      ...replay,
      data: mutation("beginStripeConnectOnboarding")
    })).rejects.toMatchObject({ code: "permission-denied" });

    const wrongApp = actorRequest();
    wrongApp.app.appId = "another-app";
    await expect(fixture.service.beginStripeConnectOnboarding({
      ...wrongApp,
      data: mutation("beginStripeConnectOnboarding")
    })).rejects.toMatchObject({ code: "permission-denied" });
  });

  test("reserves before enqueue and returns a provider-ID-free command acknowledgement", async () => {
    const calls = [];
    const fixture = serviceFixture({
      repository: {
        reserveOnboarding: vi.fn(async ({ input }) => {
          calls.push("reserve");
          return {
            reservationId: "7".repeat(64),
            outcome: { revision: 4, generation: 1, state: "onboarding" }
          };
        })
      }
    });
    fixture.commandEdge.enqueueCommand.mockImplementationOnce(async (input) => {
      calls.push("enqueue");
      expect(input).toMatchObject({
        operation: "create_merchant_account",
        expectedRevision: 4,
        connectionGeneration: 1,
        payload: {
          authorityPayloadDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
          configurationDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
          contactEmailDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
          reservationDigest: "7".repeat(64)
        }
      });
      return {
        schemaVersion: 1,
        commandId: "8".repeat(64),
        operation: input.operation,
        requestId: input.requestId,
        requestDigest: "9".repeat(64),
        payloadDigest: input.payloadDigest,
        connectionGeneration: 1,
        state: "queued",
        replayed: false,
        receiptDigest: ""
      };
    });
    const result = await fixture.service.beginStripeConnectOnboarding({
      ...actorRequest(),
      data: mutation("beginStripeConnectOnboarding")
    });

    expect(calls).toEqual(["reserve", "enqueue"]);
    expect(fixture.rateLimiter.consume).toHaveBeenCalledWith(expect.objectContaining({
      operation: "begin_onboarding",
      organizationId: "org_alpha"
    }));
    expect(result).toMatchObject({
      schemaVersion: 1,
      operation: "beginStripeConnectOnboarding",
      revision: 4,
      generation: 1,
      state: "queued",
      command: { operation: "create_merchant_account", state: "queued" }
    });
    expect(fixture.provider.createMerchantAccount).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/acct_|privateAccount|organizationId/i);
  });

  test("returns an exact replay receipt without another provider call", async () => {
    const input = mutation("beginStripeConnectOnboarding");
    const publicReceipt = {
      schemaVersion: 1,
      operation: "beginStripeConnectOnboarding",
      requestId: input.requestId,
      payloadDigest: input.payloadDigest,
      revision: 4,
      generation: 1,
      state: "onboarding",
      completedAtISO: "2026-08-13T12:00:00.000Z"
    };
    const fixture = serviceFixture({
      repository: { findMutationReceipt: vi.fn(async () => ({ payloadDigest: input.payloadDigest, publicReceipt })) }
    });
    await expect(fixture.service.beginStripeConnectOnboarding({ ...actorRequest(), data: input }))
      .resolves.toMatchObject({
        operation: "beginStripeConnectOnboarding",
        state: "completed",
        receipt: publicReceipt
      });
    expect(fixture.provider.createMerchantAccount).not.toHaveBeenCalled();
  });

  test("prepares only an internal, one-use redirect after exact owner and revision checks", async () => {
    const fixture = serviceFixture();
    const input = mutation("prepareStripeConnectOnboardingRedirect");
    const result = await fixture.service.prepareStripeConnectOnboardingRedirect({
      ...actorRequest(),
      data: input
    });

    expect(result).toMatchObject({
      handoffUrl: "https://quotepilot-staging-20260804.web.app/stripe-connect/onboarding/handoff",
      handoffMethod: "POST",
      handoffToken: expect.stringMatching(/^[A-Za-z0-9_-]{32,}$/),
      expiresAtISO: "2026-08-13T12:10:00.000Z",
      attempt: expect.stringMatching(/^[a-f0-9]{24}$/)
    });
    expect(result.handoffUrl).not.toContain("stripe.com");
    expect(fixture.repository.savePreparedHandoff).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org_alpha",
      generation: 1,
      revision: 3,
      ownerUid: "owner_uid",
      authorityRevision: 4,
      appIdDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      state: "prepared",
      tokenDigest: expect.stringMatching(/^[a-f0-9]{64}$/)
    }));
    expect(fixture.rateLimiter.consume).toHaveBeenCalledWith(expect.objectContaining({
      operation: "prepare_onboarding_redirect",
      organizationId: "org_alpha"
    }));
    expect(JSON.stringify(fixture.repository.savePreparedHandoff.mock.calls)).not.toContain(
      result.handoffUrl.split("/").at(-1)
    );

    await expect(fixture.service.prepareStripeConnectOnboardingRedirect({
      ...actorRequest(),
      data: mutation("prepareStripeConnectOnboardingRedirect", { expectedRevision: 2 })
    })).rejects.toMatchObject({ code: "aborted" });

    const stale = actorRequest();
    stale.auth.token.auth_time = Math.floor(NOW_MS / 1000) - 301;
    await expect(fixture.service.prepareStripeConnectOnboardingRedirect({
      ...stale,
      data: input
    })).rejects.toMatchObject({ code: "failed-precondition" });

    const ready = serviceFixture({ current: statusRecord({ connectionState: "ready" }) });
    await expect(ready.service.prepareStripeConnectOnboardingRedirect({
      ...actorRequest(),
      data: input
    })).rejects.toMatchObject({ code: "aborted" });
  });
});

describe("Stripe Connect one-use same-tab handoff", () => {
  test("accepts only default-port HTTPS Stripe Account Link destinations", () => {
    expect(handoff.assertStripeAccountLink({
      url: "https://accounts.stripe.com/r/reviewed-link",
      expiresAtSeconds: Math.floor(NOW_MS / 1000) + 600
    })).toMatchObject({ url: "https://accounts.stripe.com/r/reviewed-link" });
    expect(() => handoff.assertStripeAccountLink({
      url: "https://accounts.stripe.com:444/r/unreviewed-port",
      expiresAtSeconds: Math.floor(NOW_MS / 1000) + 600
    })).toThrow(expect.objectContaining({ code: "unavailable" }));
  });

  test("persists only the HMAC token digest and gives the browser an internal QuotePilot URL", () => {
    const result = handoff.prepareOneUseOnboardingHandoff({
      organizationId: "org_alpha",
      generation: 1,
      revision: 3,
      requestId: "prepare-redirect-request-0001",
      payloadDigest: "a".repeat(64),
      ownerUid: "owner_uid",
      authorityRevision: 4,
      appIdDigest: "f".repeat(64),
      canonicalReturnOrigin: ORIGIN,
      hmacKey: HMAC_KEY,
      nowMs: NOW_MS
    });

    expect(result.browser).toMatchObject({
      handoffUrl: `${ORIGIN}/stripe-connect/onboarding/handoff`,
      handoffMethod: "POST",
      handoffToken: expect.stringMatching(/^[A-Za-z0-9_-]{32,}$/)
    });
    expect(result.browser.handoffUrl).not.toContain(result.browser.handoffToken);
    expect(result.browser.handoffUrl).not.toContain("stripe.com");
    expect(result.privateRecord).toMatchObject({ state: "prepared", tokenDigest: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(JSON.stringify(result.privateRecord)).not.toContain(result.browser.handoffToken);

    const replay = handoff.prepareOneUseOnboardingHandoff({
      organizationId: "org_alpha",
      generation: 1,
      revision: 3,
      requestId: "prepare-redirect-request-0001",
      payloadDigest: "a".repeat(64),
      ownerUid: "owner_uid",
      authorityRevision: 4,
      appIdDigest: "f".repeat(64),
      canonicalReturnOrigin: ORIGIN,
      hmacKey: HMAC_KEY,
      nowMs: NOW_MS + 1_000
    });
    expect(replay.browser.handoffToken).toBe(result.browser.handoffToken);
    expect(replay.browser.attempt).toBe(result.browser.attempt);
  });

  test("consumes before provider access, stores no URL, and redirects with no-store frame denial", async () => {
    const token = "one-use-browser-token-at-least-32-bytes";
    const tokenDigest = handoff.digestToken(token);
    const calls = [];
    const store = {
      consumePreparedHandoff: vi.fn(async () => {
        calls.push("consume");
        return {
          tokenDigest,
          attemptDigest: "b".repeat(64),
          state: "consumed",
          expiresAtISO: "2026-08-13T12:10:00.000Z",
          privateAccountBinding: { accountId: "acct_hidden" }
        };
      }),
      recordProviderExpiry: vi.fn(async (value) => {
        calls.push("expiry");
        expect(JSON.stringify(value)).not.toContain("connect.stripe.com");
        return { state: "provider_issued" };
      }),
      recordHandoffFailure: vi.fn()
    };
    const provider = {
      createAccountLink: vi.fn(async ({ returnUrl, refreshUrl }) => {
        calls.push("provider");
        expect(returnUrl).toContain("connect_return=complete");
        expect(refreshUrl).toContain("connect_return=recover");
        return {
          url: "https://accounts.stripe.com/r/test-link#single-use-fragment",
          expiresAtSeconds: Math.floor(NOW_MS / 1000) + 3600
        };
      })
    };
    const response = await handoff.consumeOneUseOnboardingHandoff({
      method: "POST",
      token,
      canonicalReturnOrigin: ORIGIN,
      store,
      provider,
      now: () => NOW_MS
    });

    expect(calls).toEqual(["consume", "provider", "expiry"]);
    expect(response).toEqual({
      statusCode: 303,
      headers: {
        Location: "https://accounts.stripe.com/r/test-link#single-use-fragment",
        "Cache-Control": "no-store, private",
        Pragma: "no-cache",
        "Referrer-Policy": "no-referrer",
        "X-Frame-Options": "DENY",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "frame-ancestors 'none'"
      }
    });
    expect(store.recordProviderExpiry).toHaveBeenCalledWith({
      tokenDigest,
      attemptDigest: "b".repeat(64),
      expiresAtISO: "2026-08-13T12:10:00.000Z"
    });
  });

  test("does not call Stripe for invalid, replayed, or expired handoffs", async () => {
    const provider = { createAccountLink: vi.fn() };
    const missingStore = {
      consumePreparedHandoff: vi.fn(async () => null),
      recordProviderExpiry: vi.fn()
    };
    await expect(handoff.consumeOneUseOnboardingHandoff({
      method: "POST",
      token: "invalid-token",
      canonicalReturnOrigin: ORIGIN,
      store: missingStore,
      provider,
      now: () => NOW_MS
    })).rejects.toMatchObject({ code: "permission-denied" });
    expect(provider.createAccountLink).not.toHaveBeenCalled();

    const expiredStore = {
      consumePreparedHandoff: vi.fn(async ({ tokenDigest }) => ({
        tokenDigest,
        attemptDigest: "c".repeat(64),
        state: "consumed",
        expiresAtISO: "2026-08-13T11:59:59.000Z"
      })),
      recordProviderExpiry: vi.fn()
    };
    await expect(handoff.consumeOneUseOnboardingHandoff({
      method: "POST",
      token: "expired-token-at-least-32-bytes-long",
      canonicalReturnOrigin: ORIGIN,
      store: expiredStore,
      provider,
      now: () => NOW_MS
    })).rejects.toMatchObject({ code: "failed-precondition" });
    expect(provider.createAccountLink).not.toHaveBeenCalled();
  });

  test("fails to recovery without silently creating another link", async () => {
    const token = "provider-failure-token-at-least-32-bytes";
    const tokenDigest = handoff.digestToken(token);
    const store = {
      consumePreparedHandoff: vi.fn(async () => ({
        tokenDigest,
        attemptDigest: "d".repeat(64),
        state: "consumed",
        expiresAtISO: "2026-08-13T12:10:00.000Z",
        privateAccountBinding: { accountId: "acct_hidden" }
      })),
      recordProviderExpiry: vi.fn(),
      recordHandoffFailure: vi.fn()
    };
    const provider = { createAccountLink: vi.fn(async () => { throw new Error("network uncertain"); }) };
    const response = await handoff.consumeOneUseOnboardingHandoff({
      method: "POST",
      token,
      canonicalReturnOrigin: ORIGIN,
      store,
      provider,
      now: () => NOW_MS
    });

    expect(provider.createAccountLink).toHaveBeenCalledTimes(1);
    expect(store.recordProviderExpiry).not.toHaveBeenCalled();
    expect(store.recordHandoffFailure).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(303);
    expect(response.headers.Location).toContain("connect_return=recover");
    expect(response.headers.Location).not.toContain("stripe.com");
  });

  test("does not disclose a created Account Link when the post-provider authority receipt is withheld", async () => {
    const token = "post-provider-authority-token-at-least-32-bytes";
    const tokenDigest = handoff.digestToken(token);
    const providerUrl = "https://accounts.stripe.com/r/must-not-be-disclosed";
    const store = {
      consumePreparedHandoff: vi.fn(async () => ({
        tokenDigest,
        attemptDigest: "9".repeat(64),
        state: "consumed",
        expiresAtISO: "2026-08-13T12:10:00.000Z",
        privateAccountBinding: { accountId: "acct_hidden" }
      })),
      recordProviderExpiry: vi.fn(async () => ({ state: "provider_withheld" }))
    };
    const provider = {
      createAccountLink: vi.fn(async () => ({
        url: providerUrl,
        expiresAtSeconds: Math.floor(NOW_MS / 1000) + 600
      }))
    };

    const response = await handoff.consumeOneUseOnboardingHandoff({
      method: "POST",
      token,
      canonicalReturnOrigin: ORIGIN,
      store,
      provider,
      now: () => NOW_MS
    });
    expect(provider.createAccountLink).toHaveBeenCalledTimes(1);
    expect(store.recordProviderExpiry).toHaveBeenCalledTimes(1);
    expect(response.headers.Location).toContain("connect_return=recover");
    expect(JSON.stringify(response)).not.toContain(providerUrl);
  });

  test("withholds an Account Link when provider latency crosses the prepared handoff expiry", async () => {
    const token = "provider-latency-token-at-least-32-bytes";
    const tokenDigest = handoff.digestToken(token);
    let clockMs = NOW_MS;
    const store = {
      consumePreparedHandoff: vi.fn(async () => ({
        tokenDigest,
        attemptDigest: "8".repeat(64),
        state: "consumed",
        expiresAtISO: new Date(NOW_MS + 600_000).toISOString(),
        privateAccountBinding: { accountId: "acct_hidden" }
      })),
      recordProviderExpiry: vi.fn()
    };
    const providerUrl = "https://accounts.stripe.com/r/expired-during-provider-call";
    const provider = {
      createAccountLink: vi.fn(async () => {
        clockMs = NOW_MS + 600_001;
        return {
          url: providerUrl,
          expiresAtSeconds: Math.floor(NOW_MS / 1000) + 3600
        };
      })
    };

    const response = await handoff.consumeOneUseOnboardingHandoff({
      method: "POST",
      token,
      canonicalReturnOrigin: ORIGIN,
      store,
      provider,
      now: () => clockMs
    });
    expect(store.recordProviderExpiry).not.toHaveBeenCalled();
    expect(response.headers.Location).toContain("connect_return=recover");
    expect(JSON.stringify(response)).not.toContain(providerUrl);
  });

  test("rechecks expiry after the issuance receipt before disclosing the Account Link", async () => {
    const token = "post-receipt-expiry-token-at-least-32-bytes";
    const tokenDigest = handoff.digestToken(token);
    let clockMs = NOW_MS;
    const store = {
      consumePreparedHandoff: vi.fn(async () => ({
        tokenDigest,
        attemptDigest: "7".repeat(64),
        state: "consumed",
        expiresAtISO: new Date(NOW_MS + 600_000).toISOString(),
        privateAccountBinding: { accountId: "acct_hidden" }
      })),
      recordProviderExpiry: vi.fn(async () => {
        clockMs = NOW_MS + 600_001;
        return { state: "provider_issued" };
      })
    };
    const providerUrl = "https://accounts.stripe.com/r/expired-after-receipt";
    const response = await handoff.consumeOneUseOnboardingHandoff({
      method: "POST",
      token,
      canonicalReturnOrigin: ORIGIN,
      store,
      provider: {
        createAccountLink: vi.fn(async () => ({
          url: providerUrl,
          expiresAtSeconds: Math.floor(NOW_MS / 1000) + 3600
        }))
      },
      now: () => clockMs
    });

    expect(store.recordProviderExpiry).toHaveBeenCalledTimes(1);
    expect(response.headers.Location).toContain("connect_return=recover");
    expect(JSON.stringify(response)).not.toContain(providerUrl);
  });

  test("rejects GET before looking up or calling the provider", async () => {
    const store = {
      consumePreparedHandoff: vi.fn(),
      recordProviderExpiry: vi.fn()
    };
    const provider = { createAccountLink: vi.fn() };
    await expect(handoff.consumeOneUseOnboardingHandoff({
      method: "GET",
      token: "one-use-browser-token-with-32-bytes",
      canonicalReturnOrigin: ORIGIN,
      store,
      provider,
      now: () => NOW_MS
    })).rejects.toMatchObject({ code: "permission-denied" });
    expect(store.consumePreparedHandoff).not.toHaveBeenCalled();
    expect(provider.createAccountLink).not.toHaveBeenCalled();
  });
});
