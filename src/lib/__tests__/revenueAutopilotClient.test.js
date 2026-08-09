// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  callable: vi.fn(),
  httpsCallable: vi.fn(),
  cloudFunctions: { id: "functions" }
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: mockState.httpsCallable
}));

vi.mock("../firebase", () => ({
  cloudFunctions: mockState.cloudFunctions,
  firebaseReady: true
}));

import {
  MAX_PENDING_REVENUE_AUTOPILOT_ATTEMPTS,
  MAX_REVENUE_AUTOPILOT_ATTENTION_READS,
  MAX_REVENUE_AUTOPILOT_JOB_READS,
  REVENUE_AUTOPILOT_CALLABLES,
  REVENUE_AUTOPILOT_KINDS,
  REVENUE_AUTOPILOT_MUTATION_OPERATIONS,
  REVENUE_AUTOPILOT_REQUEST_ID_PATTERN,
  acknowledgeRevenueAutopilotReply,
  buildRevenueAutopilotRequestId,
  configureRevenueAutopilotCustomerControls,
  configureRevenueAutopilotPolicy,
  getRevenueAutopilotCustomerControls,
  getRevenueAutopilotOperations,
  getRevenueAutopilotUnsubscribeContext,
  isDefinitiveRevenueAutopilotError,
  materializeRevenueAutopilotJobs,
  normalizeRevenueAutopilotReviewRequestUrl,
  readPendingRevenueAutopilotJobAttempt,
  readPendingRevenueAutopilotCustomerControlsAttempt,
  readPendingRevenueAutopilotMaterializationAttempt,
  readPendingRevenueAutopilotPolicyAttempt,
  readPendingRevenueAutopilotReplyAttempt,
  readPendingRevenueAutopilotUnsubscribeAttempt,
  reconcileRevenueAutopilotJob,
  resetDefinitiveRevenueAutopilotReplyAttempt,
  unsubscribeRevenueAutopilotEmail
} from "../revenueAutopilotClient";

const IDS = Object.freeze({
  organizationId: "org-one",
  customerId: "customer-one",
  quoteId: "quote-one",
  jobId: "ra_job_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  attentionId: "raa_reply_bbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  messageId: "message-one",
  token: "unsubscribe_token_cccccccccccccccccccccccccccc"
});

function requestId(suffix) {
  return `ra_request_${suffix.repeat(32)}`;
}

function policy(overrides = {}) {
  return {
    enabled: true,
    timeZone: "America/Chicago",
    quietHours: { enabled: true, start: "21:00", end: "08:00" },
    kinds: {
      quote_follow_up: true,
      deposit_reminder: true,
      final_balance_reminder: true,
      post_event_review_request: false,
      unread_customer_reply: true
    },
    reviewRequestUrl: "",
    maxAttempts: 3,
    quoteFollowUpDayOffsets: [7, 2],
    depositReminderDayOffsets: [5, 1],
    finalBalanceReminderDayOffsets: [3, 14, 7],
    ...overrides
  };
}

function mutationResponse(operation, input, overrides = {}) {
  const scope = {
    ...(input.organizationId ? { organizationId: input.organizationId } : {}),
    ...(input.customerId ? { customerId: input.customerId } : {}),
    ...(input.quoteId ? { quoteId: input.quoteId } : {}),
    ...(input.jobId ? { jobId: input.jobId } : {}),
    ...(input.attentionId ? { attentionId: input.attentionId } : {}),
    ...(input.messageId ? { messageId: input.messageId } : {}),
    ...(input.token ? { token: input.token } : {})
  };
  return {
    ok: true,
    storage: "firebase",
    ...scope,
    receipt: {
      requestId: input.requestId,
      operation,
      ...scope,
      recordedAtISO: "2026-08-09T16:30:00.000Z"
    },
    ...overrides
  };
}

function operationsResponse(input, overrides = {}) {
  return {
    ok: true,
    storage: "firebase",
    organizationId: input.organizationId,
    ...(input.quoteId ? { quoteId: input.quoteId } : {}),
    policy: { version: "policy-v8", enabled: true },
    jobs: [{ jobId: IDS.jobId, quoteId: IDS.quoteId, state: "scheduled" }],
    attention: [{
      attentionId: IDS.attentionId,
      quoteId: IDS.quoteId,
      messageId: IDS.messageId,
      state: "open"
    }],
    bounds: {
      totalJobs: 1,
      maximumJobs: input.jobLimit,
      totalAttention: 1,
      maximumAttention: input.attentionLimit,
      complete: true,
      truncated: false
    },
    providerOutcomes: { delivered: 0 },
    source: "firebase",
    observedAtISO: "2026-08-09T16:00:00.000Z",
    readState: "success",
    ...overrides
  };
}

function customerControlsResponse(input, controls = {}) {
  return {
    ok: true,
    storage: "firebase",
    organizationId: input.organizationId,
    customerId: input.customerId,
    controls: {
      schemaVersion: 1,
      authority: "server_projection",
      source: "firebase_server_projection",
      organizationId: input.organizationId,
      customerId: input.customerId,
      observedAtISO: "2026-08-09T16:00:00.000Z",
      authorityState: "dormant",
      revision: 0,
      consent: { state: "unknown", recordedAtISO: "" },
      subscription: { state: "unknown", recordedAtISO: "" },
      ...controls
    }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockState.httpsCallable.mockReturnValue(mockState.callable);
});

describe("Revenue Autopilot read contracts", () => {
  test("reads the exact same-tenant customer-control projection without mutation fields", async () => {
    const input = {
      organizationId: IDS.organizationId,
      customerId: IDS.customerId
    };
    mockState.callable.mockResolvedValue({ data: customerControlsResponse(input) });

    await expect(getRevenueAutopilotCustomerControls(input)).resolves.toEqual({
      schemaVersion: 1,
      authority: "server_projection",
      source: "firebase_server_projection",
      ...input,
      observedAtISO: "2026-08-09T16:00:00.000Z",
      authorityState: "dormant",
      revision: 0,
      consent: { state: "unknown", recordedAtISO: "" },
      subscription: { state: "unknown", recordedAtISO: "" }
    });
    expect(mockState.httpsCallable).toHaveBeenCalledWith(
      mockState.cloudFunctions,
      REVENUE_AUTOPILOT_CALLABLES.getCustomerControls
    );
    expect(mockState.callable).toHaveBeenCalledWith(input);
  });

  test("accepts only a complete configured projection and rejects cross-scope or malformed state", async () => {
    const input = {
      organizationId: IDS.organizationId,
      customerId: IDS.customerId
    };
    mockState.callable.mockResolvedValueOnce({
      data: customerControlsResponse(input, {
        authorityState: "configured",
        revision: 7,
        consent: { state: "granted", recordedAtISO: "2026-08-09T15:00:00-05:00" },
        subscription: { state: "subscribed", recordedAtISO: "2026-08-09T15:01:00-05:00" }
      })
    });
    await expect(getRevenueAutopilotCustomerControls(input)).resolves.toMatchObject({
      authorityState: "configured",
      revision: 7,
      consent: { state: "granted", recordedAtISO: "2026-08-09T20:00:00.000Z" },
      subscription: { state: "subscribed", recordedAtISO: "2026-08-09T20:01:00.000Z" }
    });

    mockState.callable.mockResolvedValueOnce({
      data: customerControlsResponse(input, { customerId: "customer-two" })
    });
    await expect(getRevenueAutopilotCustomerControls(input)).rejects.toThrow(/invalid scoped projection/i);

    mockState.callable.mockResolvedValueOnce({
      data: customerControlsResponse(input, {
        authorityState: "configured",
        revision: 1,
        consent: { state: "revoked", recordedAtISO: "2026-08-09T16:00:00.000Z" },
        subscription: { state: "subscribed", recordedAtISO: "2026-08-09T16:00:00.000Z" }
      })
    });
    await expect(getRevenueAutopilotCustomerControls(input)).rejects.toThrow(/invalid scoped projection/i);
  });

  test("uses the exact bounded operations-read payload and validates its tenant scope", async () => {
    const input = {
      organizationId: IDS.organizationId,
      quoteId: IDS.quoteId,
      jobLimit: 40,
      attentionLimit: 20
    };
    mockState.callable.mockResolvedValue({ data: operationsResponse(input) });

    await expect(getRevenueAutopilotOperations(input)).resolves.toMatchObject({
      organizationId: IDS.organizationId,
      quoteId: IDS.quoteId,
      readState: "success",
      bounds: { maximumJobs: 40, maximumAttention: 20 }
    });
    expect(mockState.httpsCallable).toHaveBeenCalledWith(
      mockState.cloudFunctions,
      REVENUE_AUTOPILOT_CALLABLES.getOperations
    );
    expect(mockState.callable).toHaveBeenCalledWith(input);
    expect(mockState.callable.mock.calls[0][0]).not.toHaveProperty("requestId");
  });

  test("normalizes the optional public HTTPS review destination and fails closed on an invalid enabled-lane projection", async () => {
    const input = {
      organizationId: IDS.organizationId,
      jobLimit: MAX_REVENUE_AUTOPILOT_JOB_READS,
      attentionLimit: MAX_REVENUE_AUTOPILOT_ATTENTION_READS
    };
    mockState.callable.mockResolvedValueOnce({
      data: operationsResponse(input, {
        policy: {
          version: "policy-v9",
          reviewRequestUrl: "https://reviews.example.test/collect?source=quotepilot",
          kinds: { post_event_review_request: { enabled: true } }
        }
      })
    });

    await expect(getRevenueAutopilotOperations({
      organizationId: IDS.organizationId
    })).resolves.toMatchObject({
      policy: {
        reviewRequestUrl: "https://reviews.example.test/collect?source=quotepilot"
      }
    });

    mockState.callable.mockResolvedValueOnce({
      data: operationsResponse(input, {
        policy: {
          version: "policy-v10",
          reviewRequestUrl: "http://localhost/reviews",
          kinds: { post_event_review_request: { enabled: true } }
        }
      })
    });
    await expect(getRevenueAutopilotOperations({
      organizationId: IDS.organizationId
    })).rejects.toThrow(/invalid review-request policy projection/i);

    mockState.callable.mockResolvedValueOnce({
      data: operationsResponse(input, {
        policy: {
          version: "policy-v11",
          reviewRequestUrl: "",
          kinds: { post_event_review_request: { enabled: true } }
        }
      })
    });
    await expect(getRevenueAutopilotOperations({
      organizationId: IDS.organizationId
    })).rejects.toThrow(/invalid review-request policy projection/i);
  });

  test("defaults reads to the hard caps and refuses contradictory or oversized results", async () => {
    const payload = {
      organizationId: IDS.organizationId,
      jobLimit: MAX_REVENUE_AUTOPILOT_JOB_READS,
      attentionLimit: MAX_REVENUE_AUTOPILOT_ATTENTION_READS
    };
    mockState.callable.mockResolvedValue({
      data: operationsResponse(payload, {
        bounds: {
          totalJobs: 2,
          maximumJobs: MAX_REVENUE_AUTOPILOT_JOB_READS,
          totalAttention: 1,
          maximumAttention: MAX_REVENUE_AUTOPILOT_ATTENTION_READS,
          complete: true,
          truncated: true
        }
      })
    });

    await expect(getRevenueAutopilotOperations({
      organizationId: IDS.organizationId
    })).rejects.toThrow(/read bounds/i);
    expect(mockState.callable).toHaveBeenCalledWith(payload);

    await expect(getRevenueAutopilotOperations({
      organizationId: IDS.organizationId,
      jobLimit: MAX_REVENUE_AUTOPILOT_JOB_READS + 1
    })).rejects.toThrow(/jobLimit/i);
    expect(mockState.callable).toHaveBeenCalledTimes(1);
  });

  test("fails closed when unread-reply attention is not bound to an exact message", async () => {
    const payload = {
      organizationId: IDS.organizationId,
      jobLimit: MAX_REVENUE_AUTOPILOT_JOB_READS,
      attentionLimit: MAX_REVENUE_AUTOPILOT_ATTENTION_READS
    };
    mockState.callable.mockResolvedValue({
      data: operationsResponse(payload, {
        attention: [{
          attentionId: IDS.attentionId,
          quoteId: IDS.quoteId,
          state: "open"
        }]
      })
    });

    await expect(getRevenueAutopilotOperations({
      organizationId: IDS.organizationId
    })).rejects.toThrow(/scoped attention/i);
  });

  test("reads public unsubscribe context with only the opaque token and strips it from output", async () => {
    mockState.callable.mockResolvedValue({
      data: {
        ok: true,
        storage: "firebase",
        token: IDS.token,
        context: { state: "subscribed", tenantLabel: "Example Catering" }
      }
    });

    const result = await getRevenueAutopilotUnsubscribeContext({ token: IDS.token });
    expect(mockState.httpsCallable).toHaveBeenCalledWith(
      mockState.cloudFunctions,
      REVENUE_AUTOPILOT_CALLABLES.getUnsubscribeContext
    );
    expect(mockState.callable).toHaveBeenCalledWith({ token: IDS.token });
    expect(result).toEqual({
      ok: true,
      storage: "firebase",
      context: { state: "subscribed", tenantLabel: "Example Catering" }
    });
    expect(result).not.toHaveProperty("token");
  });
});

describe("Revenue Autopilot exact mutation payloads and receipts", () => {
  test("configures only the strict canonical policy fields", async () => {
    const input = {
      organizationId: IDS.organizationId,
      expectedPolicyVersion: "policy-v7",
      policy: policy(),
      requestId: requestId("a")
    };
    const expectedPayload = {
      organizationId: IDS.organizationId,
      expectedPolicyVersion: "policy-v7",
      policy: {
        ...policy(),
        quoteFollowUpDayOffsets: [2, 7],
        depositReminderDayOffsets: [1, 5],
        finalBalanceReminderDayOffsets: [14, 7, 3]
      },
      requestId: input.requestId
    };
    const response = mutationResponse(
      REVENUE_AUTOPILOT_MUTATION_OPERATIONS.configurePolicy,
      expectedPayload,
      { policyVersion: "policy-v8" }
    );
    response.receipt.policyVersion = "policy-v8";
    response.providerAccepted = true;
    response.payment = { state: "paid" };
    mockState.callable.mockResolvedValue({ data: response });

    const result = await configureRevenueAutopilotPolicy(input);
    expect(mockState.httpsCallable).toHaveBeenCalledWith(
      mockState.cloudFunctions,
      REVENUE_AUTOPILOT_CALLABLES.configurePolicy
    );
    expect(mockState.callable).toHaveBeenCalledWith(expectedPayload);
    expect(result).toMatchObject({
      mutationMode: "submitting",
      receipt: {
        requestId: input.requestId,
        operation: REVENUE_AUTOPILOT_MUTATION_OPERATIONS.configurePolicy,
        policyVersion: "policy-v8"
      }
    });
    expect(result).not.toHaveProperty("providerAccepted");
    expect(result).not.toHaveProperty("payment");
    expect(readPendingRevenueAutopilotPolicyAttempt(input)).toBeNull();
  });

  test("configures the fifth lane only with a canonical public HTTPS review destination", async () => {
    const input = {
      organizationId: IDS.organizationId,
      expectedPolicyVersion: "policy-v8",
      policy: policy({
        reviewRequestUrl: "https://reviews.example.test",
        kinds: {
          ...policy().kinds,
          post_event_review_request: true
        }
      }),
      requestId: requestId("8")
    };
    const expectedPolicy = {
      ...input.policy,
      reviewRequestUrl: "https://reviews.example.test/",
      quoteFollowUpDayOffsets: [2, 7],
      depositReminderDayOffsets: [1, 5],
      finalBalanceReminderDayOffsets: [14, 7, 3]
    };
    const expectedPayload = {
      organizationId: IDS.organizationId,
      expectedPolicyVersion: "policy-v8",
      policy: expectedPolicy,
      requestId: input.requestId
    };
    const response = mutationResponse(
      REVENUE_AUTOPILOT_MUTATION_OPERATIONS.configurePolicy,
      expectedPayload,
      { policyVersion: "policy-v9" }
    );
    response.receipt.policyVersion = "policy-v9";
    mockState.callable.mockResolvedValue({ data: response });

    await configureRevenueAutopilotPolicy(input);
    expect(mockState.callable).toHaveBeenCalledWith(expectedPayload);
    expect(REVENUE_AUTOPILOT_KINDS).toEqual([
      "quote_follow_up",
      "deposit_reminder",
      "final_balance_reminder",
      "post_event_review_request",
      "unread_customer_reply"
    ]);
  });

  test.each([
    [
      "configures exact customer controls",
      REVENUE_AUTOPILOT_CALLABLES.configureCustomerControls,
      REVENUE_AUTOPILOT_MUTATION_OPERATIONS.configureCustomerControls,
      configureRevenueAutopilotCustomerControls,
      readPendingRevenueAutopilotCustomerControlsAttempt,
      {
        organizationId: IDS.organizationId,
        customerId: IDS.customerId,
        expectedRevision: 0,
        consentState: "granted",
        subscriptionState: "subscribed",
        requestId: requestId("0")
      }
    ],
    [
      "materializes an exact quote",
      REVENUE_AUTOPILOT_CALLABLES.materializeJobs,
      REVENUE_AUTOPILOT_MUTATION_OPERATIONS.materializeJobs,
      materializeRevenueAutopilotJobs,
      readPendingRevenueAutopilotMaterializationAttempt,
      { organizationId: IDS.organizationId, quoteId: IDS.quoteId, requestId: requestId("b") }
    ],
    [
      "reconciles an exact job",
      REVENUE_AUTOPILOT_CALLABLES.reconcileJob,
      REVENUE_AUTOPILOT_MUTATION_OPERATIONS.reconcileJob,
      reconcileRevenueAutopilotJob,
      readPendingRevenueAutopilotJobAttempt,
      {
        organizationId: IDS.organizationId,
        quoteId: IDS.quoteId,
        jobId: IDS.jobId,
        requestId: requestId("c")
      }
    ],
    [
      "acknowledges an exact attention record",
      REVENUE_AUTOPILOT_CALLABLES.acknowledgeReply,
      REVENUE_AUTOPILOT_MUTATION_OPERATIONS.acknowledgeReply,
      acknowledgeRevenueAutopilotReply,
      readPendingRevenueAutopilotReplyAttempt,
      {
        organizationId: IDS.organizationId,
        quoteId: IDS.quoteId,
        attentionId: IDS.attentionId,
        messageId: IDS.messageId,
        requestId: requestId("d")
      }
    ]
  ])("%s and accepts only its exact record receipt", async (
    _label,
    callableName,
    operation,
    invoke,
    readPending,
    input
  ) => {
    mockState.callable.mockResolvedValue({ data: mutationResponse(operation, input) });

    await expect(invoke(input)).resolves.toMatchObject({
      mutationMode: "submitting",
      receipt: { requestId: input.requestId, operation }
    });
    expect(mockState.httpsCallable).toHaveBeenCalledWith(mockState.cloudFunctions, callableName);
    expect(mockState.callable).toHaveBeenCalledWith(input);
    expect(readPending(input)).toBeNull();
  });

  test("unsubscribes through one public exact-token mutation and does not return the token", async () => {
    const input = { token: IDS.token, requestId: requestId("e") };
    mockState.callable.mockResolvedValue({
      data: mutationResponse(REVENUE_AUTOPILOT_MUTATION_OPERATIONS.unsubscribeEmail, input)
    });

    const result = await unsubscribeRevenueAutopilotEmail(input);
    expect(mockState.httpsCallable).toHaveBeenCalledWith(
      mockState.cloudFunctions,
      REVENUE_AUTOPILOT_CALLABLES.unsubscribeEmail
    );
    expect(mockState.callable).toHaveBeenCalledWith(input);
    expect(result).toMatchObject({
      mutationMode: "submitting",
      receipt: {
        requestId: input.requestId,
        operation: REVENUE_AUTOPILOT_MUTATION_OPERATIONS.unsubscribeEmail
      }
    });
    expect(result).not.toHaveProperty("token");
    expect(result.receipt).not.toHaveProperty("token");
    expect(readPendingRevenueAutopilotUnsubscribeAttempt(input)).toBeNull();
  });

  test("rejects a mismatched receipt as uncertain instead of inferring success", async () => {
    const input = {
      organizationId: IDS.organizationId,
      quoteId: IDS.quoteId,
      jobId: IDS.jobId,
      requestId: requestId("f")
    };
    mockState.callable.mockResolvedValue({
      data: mutationResponse(REVENUE_AUTOPILOT_MUTATION_OPERATIONS.reconcileJob, {
        ...input,
        jobId: "ra_job_wrong"
      })
    });

    await expect(reconcileRevenueAutopilotJob(input)).rejects.toThrow(/exact server receipt/i);
    expect(readPendingRevenueAutopilotJobAttempt(input)).toMatchObject({
      requestId: input.requestId,
      state: "uncertain",
      definitive: false
    });

    mockState.callable.mockResolvedValue({
      data: mutationResponse(REVENUE_AUTOPILOT_MUTATION_OPERATIONS.reconcileJob, input)
    });
    await expect(reconcileRevenueAutopilotJob(input)).resolves.toMatchObject({
      mutationMode: "reconciliation"
    });
  });
});

describe("Revenue Autopilot mutation recovery", () => {
  test("holds an ambiguous action in memory and reconciles only the unchanged request", async () => {
    const input = {
      organizationId: IDS.organizationId,
      quoteId: "quote-ambiguous",
      requestId: requestId("1")
    };
    const unavailable = Object.assign(new Error("network unavailable"), {
      code: "functions/unavailable"
    });
    mockState.callable
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValueOnce({
        data: mutationResponse(REVENUE_AUTOPILOT_MUTATION_OPERATIONS.materializeJobs, input)
      });

    await expect(materializeRevenueAutopilotJobs(input)).rejects.toThrow("network unavailable");
    expect(readPendingRevenueAutopilotMaterializationAttempt(input)).toMatchObject({
      operation: REVENUE_AUTOPILOT_MUTATION_OPERATIONS.materializeJobs,
      requestId: input.requestId,
      mode: "submitting",
      state: "uncertain",
      definitive: false
    });
    await expect(materializeRevenueAutopilotJobs({
      ...input,
      requestId: requestId("2")
    })).rejects.toThrow(/reconciled with unchanged input/i);
    expect(mockState.callable).toHaveBeenCalledTimes(1);

    await expect(materializeRevenueAutopilotJobs(input)).resolves.toMatchObject({
      mutationMode: "reconciliation"
    });
    expect(mockState.callable).toHaveBeenNthCalledWith(1, input);
    expect(mockState.callable).toHaveBeenNthCalledWith(2, input);
  });

  test("locks a definitive rejection until explicit exact reset", async () => {
    const input = {
      organizationId: IDS.organizationId,
      quoteId: "quote-definitive",
      attentionId: "raa_reply_definitive",
      messageId: "message-definitive",
      requestId: requestId("3")
    };
    const denied = Object.assign(new Error("not authorized"), {
      code: "functions/permission-denied"
    });
    mockState.callable.mockRejectedValueOnce(denied);

    await expect(acknowledgeRevenueAutopilotReply(input)).rejects.toThrow("not authorized");
    expect(readPendingRevenueAutopilotReplyAttempt(input)).toMatchObject({
      state: "error",
      definitive: true
    });
    await expect(acknowledgeRevenueAutopilotReply(input)).rejects.toThrow(/Reset the definitively rejected/i);
    expect(mockState.callable).toHaveBeenCalledTimes(1);
    expect(resetDefinitiveRevenueAutopilotReplyAttempt({
      ...input,
      requestId: requestId("4")
    })).toBe(false);
    expect(resetDefinitiveRevenueAutopilotReplyAttempt(input)).toBe(true);

    const retry = { ...input, requestId: requestId("4") };
    mockState.callable.mockResolvedValue({
      data: mutationResponse(REVENUE_AUTOPILOT_MUTATION_OPERATIONS.acknowledgeReply, retry)
    });
    await expect(acknowledgeRevenueAutopilotReply(retry)).resolves.toMatchObject({
      mutationMode: "submitting"
    });
  });

  test.each([
    ["functions/failed-precondition", true],
    ["permission-denied", true],
    ["functions/unavailable", false],
    ["deadline-exceeded", false],
    ["functions/aborted", false]
  ])("classifies %s without claiming an operation result", (code, definitive) => {
    expect(isDefinitiveRevenueAutopilotError({ code })).toBe(definitive);
  });

  test("never writes an attempt or token to browser storage", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    const input = {
      organizationId: IDS.organizationId,
      quoteId: "quote-memory-only",
      requestId: requestId("5")
    };
    mockState.callable.mockResolvedValue({
      data: mutationResponse(REVENUE_AUTOPILOT_MUTATION_OPERATIONS.materializeJobs, input)
    });

    await materializeRevenueAutopilotJobs(input);
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    getItem.mockRestore();
    setItem.mockRestore();
    removeItem.mockRestore();
  });
});

describe("Revenue Autopilot input and capacity limits", () => {
  test("generates a bounded opaque request identity", () => {
    expect(buildRevenueAutopilotRequestId()).toMatch(REVENUE_AUTOPILOT_REQUEST_ID_PATTERN);
  });

  test.each([
    "http://reviews.example.test/collect",
    "https://user:password@reviews.example.test/collect",
    "https://reviews.example.test:8443/collect",
    "https://reviews.example.test/collect#private-fragment",
    "https://localhost/collect",
    "https://reviews.internal/collect",
    "https://192.168.1.2/collect",
    "https://[::1]/collect"
  ])("rejects unsafe post-event review destination %s", async (reviewRequestUrl) => {
    expect(() => normalizeRevenueAutopilotReviewRequestUrl(reviewRequestUrl, {
      required: true
    })).toThrow(/public HTTPS review URL/i);
    await expect(configureRevenueAutopilotPolicy({
      organizationId: IDS.organizationId,
      policy: policy({
        reviewRequestUrl,
        kinds: {
          ...policy().kinds,
          post_event_review_request: true
        }
      })
    })).rejects.toThrow(/public HTTPS review URL/i);
    expect(mockState.callable).not.toHaveBeenCalled();
  });

  test("requires the optional review destination only when the post-event lane is enabled", async () => {
    expect(normalizeRevenueAutopilotReviewRequestUrl("", { required: false })).toBe("");
    expect(() => normalizeRevenueAutopilotReviewRequestUrl("", { required: true }))
      .toThrow(/public HTTPS review URL/i);
    await expect(configureRevenueAutopilotPolicy({
      organizationId: IDS.organizationId,
      policy: policy({
        reviewRequestUrl: "",
        kinds: {
          ...policy().kinds,
          post_event_review_request: true
        }
      })
    })).rejects.toThrow(/public HTTPS review URL/i);
    expect(mockState.callable).not.toHaveBeenCalled();
  });

  test.each([
    () => materializeRevenueAutopilotJobs({
      organizationId: "owner@example.test",
      quoteId: IDS.quoteId
    }),
    () => materializeRevenueAutopilotJobs({
      organizationId: IDS.organizationId,
      quoteId: IDS.quoteId,
      quote: { customerEmail: "customer@example.test" }
    }),
    () => getRevenueAutopilotUnsubscribeContext({
      token: IDS.token,
      customerEmail: "customer@example.test"
    }),
    () => configureRevenueAutopilotPolicy({
      organizationId: IDS.organizationId,
      policy: policy({ customerName: "Henderson" })
    }),
    () => configureRevenueAutopilotPolicy({
      organizationId: IDS.organizationId,
      policy: policy({ finalBalanceReminderDayOffsets: [30, 14, 7] })
    }),
    () => configureRevenueAutopilotCustomerControls({
      organizationId: IDS.organizationId,
      customerId: IDS.customerId,
      expectedRevision: 0,
      consentState: "granted",
      subscriptionState: "subscribed",
      recordedAtISO: "2026-08-09T16:00:00.000Z"
    }),
    () => configureRevenueAutopilotCustomerControls({
      organizationId: IDS.organizationId,
      customerId: IDS.customerId,
      expectedRevision: 0,
      consentState: "unknown",
      subscriptionState: "subscribed"
    }),
    () => configureRevenueAutopilotCustomerControls({
      organizationId: IDS.organizationId,
      customerId: IDS.customerId,
      consentState: "granted",
      subscriptionState: "subscribed"
    }),
    () => configureRevenueAutopilotCustomerControls({
      organizationId: IDS.organizationId,
      customerId: IDS.customerId,
      expectedRevision: -1,
      consentState: "granted",
      subscriptionState: "subscribed"
    })
  ])("rejects content-bearing, non-opaque, or non-canonical scope before dispatch", async (invoke) => {
    await expect(Promise.resolve().then(invoke)).rejects.toThrow();
    expect(mockState.callable).not.toHaveBeenCalled();
  });

  test("caps unresolved process-memory attempts without evicting an exact replay lock", async () => {
    const unavailable = Object.assign(new Error("network unavailable"), {
      code: "functions/unavailable"
    });
    mockState.callable.mockRejectedValue(unavailable);

    for (let index = 0; index < MAX_PENDING_REVENUE_AUTOPILOT_ATTEMPTS; index += 1) {
      const suffix = index.toString(16).padStart(2, "0");
      await expect(materializeRevenueAutopilotJobs({
        organizationId: "org-capacity",
        quoteId: `quote-capacity-${suffix}`,
        requestId: `ra_request_${suffix.repeat(16)}`
      })).rejects.toThrow("network unavailable");
    }
    expect(mockState.callable).toHaveBeenCalledTimes(MAX_PENDING_REVENUE_AUTOPILOT_ATTEMPTS);

    await expect(materializeRevenueAutopilotJobs({
      organizationId: "org-capacity",
      quoteId: "quote-capacity-overflow",
      requestId: requestId("9")
    })).rejects.toThrow(/Reconcile or safely reset/i);
    expect(mockState.callable).toHaveBeenCalledTimes(MAX_PENDING_REVENUE_AUTOPILOT_ATTEMPTS);
    expect(readPendingRevenueAutopilotMaterializationAttempt({
      organizationId: "org-capacity",
      quoteId: "quote-capacity-00"
    })).toMatchObject({ state: "uncertain" });
  });
});
