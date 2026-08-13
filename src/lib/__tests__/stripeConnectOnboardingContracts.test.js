import { describe, expect, test, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const contracts = require("../../../functions-connect/interfaceContracts.js");
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

function serviceFixture({ ownerUid = "owner_uid", current = statusRecord(), provider = {}, repository = {} } = {}) {
  const defaults = {
    readAuthority: vi.fn(async (organizationId) => ({ organizationId, ownerUid })),
    readStatus: vi.fn(async () => current),
    findMutationReceipt: vi.fn(async () => null),
    reserveOnboarding: vi.fn(async ({ input }) => ({
      providerIdempotencyKey: `connect-account-${input.payloadDigest}`,
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
  return {
    repository: defaults,
    provider: providerDefaults,
    rateLimiter,
    principalHasher,
    service: createStripeConnectStatusOnboardingService({
      repository: defaults,
      provider: providerDefaults,
      rateLimiter,
      principalHasher,
      hmacKey: HMAC_KEY,
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
      repository: { readAuthority: vi.fn(async () => ({ organizationId: "org_other", ownerUid: "owner_uid" })) }
    });
    await expect(cross.service.getStripeConnectStatus({ ...actorRequest(), data: {} }))
      .rejects.toMatchObject({ code: "failed-precondition" });
  });

  test("rate-limits live refresh and sends only the private binding to the provider adapter", async () => {
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
    expect(fixture.provider.retrieveMerchantAccount).toHaveBeenCalledWith(expect.objectContaining({
      privateAccountBinding: { accountId: "acct_private_never_project" }
    }));
    expect(result.health.state).toBe("healthy");
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
  });

  test("reserves before provider access and returns a provider-ID-free mutation receipt", async () => {
    const calls = [];
    const fixture = serviceFixture({
      repository: {
        reserveOnboarding: vi.fn(async ({ input }) => {
          calls.push("reserve");
          return {
            providerIdempotencyKey: `stable-${input.payloadDigest}`,
            outcome: { revision: 4, generation: 1, state: "onboarding" }
          };
        }),
        completeOnboarding: vi.fn(async ({ publicReceipt }) => {
          calls.push("complete");
          expect(publicReceipt).toMatchObject({ revision: 4, generation: 1, state: "onboarding" });
        })
      },
      provider: {
        createMerchantAccount: vi.fn(async (input) => {
          calls.push("provider");
          expect(input).toMatchObject({
            country: "US",
            currency: "usd",
            dashboard: "full",
            feesCollector: "stripe",
            lossesCollector: "stripe",
            capabilities: { cardPayments: "requested" }
          });
          return { privateAccountId: "acct_hidden" };
        })
      }
    });
    const result = await fixture.service.beginStripeConnectOnboarding({
      ...actorRequest(),
      data: mutation("beginStripeConnectOnboarding")
    });

    expect(calls).toEqual(["reserve", "provider", "complete"]);
    expect(result).toMatchObject({
      schemaVersion: 1,
      operation: "beginStripeConnectOnboarding",
      revision: 4,
      generation: 1,
      state: "onboarding"
    });
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
      .resolves.toEqual(publicReceipt);
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
      state: "prepared",
      tokenDigest: expect.stringMatching(/^[a-f0-9]{64}$/)
    }));
    expect(JSON.stringify(fixture.repository.savePreparedHandoff.mock.calls)).not.toContain(
      result.handoffUrl.split("/").at(-1)
    );

    await expect(fixture.service.prepareStripeConnectOnboardingRedirect({
      ...actorRequest(),
      data: mutation("prepareStripeConnectOnboardingRedirect", { expectedRevision: 2 })
    })).rejects.toMatchObject({ code: "aborted" });
  });
});

describe("Stripe Connect one-use same-tab handoff", () => {
  test("persists only the HMAC token digest and gives the browser an internal QuotePilot URL", () => {
    const result = handoff.prepareOneUseOnboardingHandoff({
      organizationId: "org_alpha",
      generation: 1,
      revision: 3,
      requestId: "prepare-redirect-request-0001",
      payloadDigest: "a".repeat(64),
      canonicalReturnOrigin: ORIGIN,
      hmacKey: HMAC_KEY,
      nowMs: NOW_MS,
      randomToken: () => "one-use-browser-token-with-32-bytes"
    });

    expect(result.browser).toMatchObject({
      handoffUrl: `${ORIGIN}/stripe-connect/onboarding/handoff`,
      handoffMethod: "POST",
      handoffToken: "one-use-browser-token-with-32-bytes"
    });
    expect(result.browser.handoffUrl).not.toContain(result.browser.handoffToken);
    expect(result.browser.handoffUrl).not.toContain("stripe.com");
    expect(result.privateRecord).toMatchObject({ state: "prepared", tokenDigest: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(JSON.stringify(result.privateRecord)).not.toContain("one-use-browser-token-with-32-bytes");
  });

  test("consumes before provider access, stores no URL, and redirects with no-store frame denial", async () => {
    const token = "one-use-browser-token";
    const tokenDigest = handoff.digestToken(token, HMAC_KEY);
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
      }),
      recordHandoffFailure: vi.fn()
    };
    const provider = {
      createAccountLink: vi.fn(async ({ returnUrl, refreshUrl }) => {
        calls.push("provider");
        expect(returnUrl).toContain("connect_return=complete");
        expect(refreshUrl).toContain("connect_return=recover");
        return {
          url: "https://connect.stripe.com/setup/s/test-link",
          expiresAtSeconds: Math.floor(NOW_MS / 1000) + 3600
        };
      })
    };
    const response = await handoff.consumeOneUseOnboardingHandoff({
      method: "POST",
      token,
      hmacKey: HMAC_KEY,
      canonicalReturnOrigin: ORIGIN,
      store,
      provider,
      nowMs: NOW_MS
    });

    expect(calls).toEqual(["consume", "provider", "expiry"]);
    expect(response).toEqual({
      statusCode: 303,
      headers: {
        Location: "https://connect.stripe.com/setup/s/test-link",
        "Cache-Control": "no-store, private",
        Pragma: "no-cache",
        "Referrer-Policy": "no-referrer",
        "X-Frame-Options": "DENY",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "frame-ancestors 'none'"
      }
    });
    expect(store.recordProviderExpiry).toHaveBeenCalledWith({
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
      hmacKey: HMAC_KEY,
      canonicalReturnOrigin: ORIGIN,
      store: missingStore,
      provider,
      nowMs: NOW_MS
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
      token: "expired-token",
      hmacKey: HMAC_KEY,
      canonicalReturnOrigin: ORIGIN,
      store: expiredStore,
      provider,
      nowMs: NOW_MS
    })).rejects.toMatchObject({ code: "failed-precondition" });
    expect(provider.createAccountLink).not.toHaveBeenCalled();
  });

  test("fails to recovery without silently creating another link", async () => {
    const token = "provider-failure-token";
    const tokenDigest = handoff.digestToken(token, HMAC_KEY);
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
      hmacKey: HMAC_KEY,
      canonicalReturnOrigin: ORIGIN,
      store,
      provider,
      nowMs: NOW_MS
    });

    expect(provider.createAccountLink).toHaveBeenCalledTimes(1);
    expect(store.recordProviderExpiry).not.toHaveBeenCalled();
    expect(store.recordHandoffFailure).toHaveBeenCalledWith({
      attemptDigest: "d".repeat(64),
      reason: "provider_unavailable"
    });
    expect(response.statusCode).toBe(303);
    expect(response.headers.Location).toContain("connect_return=recover");
    expect(response.headers.Location).not.toContain("stripe.com");
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
      hmacKey: HMAC_KEY,
      canonicalReturnOrigin: ORIGIN,
      store,
      provider,
      nowMs: NOW_MS
    })).rejects.toMatchObject({ code: "permission-denied" });
    expect(store.consumePreparedHandoff).not.toHaveBeenCalled();
    expect(provider.createAccountLink).not.toHaveBeenCalled();
  });
});
