import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ call: vi.fn(), httpsCallable: vi.fn() }));

vi.mock("firebase/functions", () => ({
  httpsCallable: mocks.httpsCallable
}));
vi.mock("../firebase", () => ({
  cloudFunctions: {},
  firebaseReady: true
}));

import {
  beginEventProfitReviewAttempt,
  getPostEventProfitReview,
  readPendingEventProfitReviewAttempt,
  recordPostEventProfitReview,
  resetDefinitiveEventProfitReviewAttempt
} from "../postEventProfitReviewClient";

const ids = { organizationId: "org-one", quoteId: "quote-one", closeoutId: "closeout-one" };
const mutation = {
  ...ids,
  action: "save_draft",
  expectedReviewRevision: 0,
  actuals: {},
  lossSignals: {},
  confirmedZeroFields: [],
  targetMarginBps: null,
  notes: ""
};

describe("postEventProfitReviewClient", () => {
  beforeEach(() => {
    mocks.call.mockReset();
    mocks.httpsCallable.mockReset().mockReturnValue(mocks.call);
  });

  test("requires an exact scoped detail response", async () => {
    mocks.call.mockResolvedValue({ data: { ok: true, ...ids, profitReview: { state: "draft" } } });
    await expect(getPostEventProfitReview(ids)).resolves.toMatchObject({ profitReview: { state: "draft" } });
    mocks.call.mockResolvedValue({ data: { ok: true, ...ids, quoteId: "other", profitReview: {} } });
    await expect(getPostEventProfitReview(ids)).rejects.toThrow(/exact authoritative scope/i);
  });

  test("keeps one replay-stable request until an exact receipt returns", async () => {
    const first = beginEventProfitReviewAttempt({ ...mutation, requestId: "profit_review_request_123456789" });
    const second = beginEventProfitReviewAttempt({ ...mutation, requestId: first.requestId });
    expect(second).toMatchObject({ requestId: first.requestId, mode: "reconciliation" });
    mocks.call.mockResolvedValue({
      data: {
        ok: true,
        ...ids,
        profitReview: { state: "draft" },
        receipt: { requestId: first.requestId }
      }
    });
    await expect(recordPostEventProfitReview({ ...mutation, requestId: first.requestId })).resolves.toMatchObject({
      profitReview: { state: "draft" }
    });
    expect(readPendingEventProfitReviewAttempt(ids)).toBeNull();
  });

  test("allows reset only after a definitive rejection", async () => {
    const error = Object.assign(new Error("Revision conflict"), { code: "functions/aborted" });
    mocks.call.mockRejectedValue(error);
    await expect(recordPostEventProfitReview({
      ...mutation,
      quoteId: "quote-conflict",
      closeoutId: "closeout-conflict",
      requestId: "profit_review_request_conflict_1"
    })).rejects.toThrow("Revision conflict");
    const conflictIds = { ...ids, quoteId: "quote-conflict", closeoutId: "closeout-conflict" };
    expect(readPendingEventProfitReviewAttempt(conflictIds)?.definitive).toBe(true);
    expect(resetDefinitiveEventProfitReviewAttempt(conflictIds)).toBe(true);
  });
});
