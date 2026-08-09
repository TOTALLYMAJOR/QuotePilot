import { describe, expect, test } from "vitest";
import {
  buildCommercialSnapshotResult,
  createSnapshotRequestGeneration
} from "../useCommercialWorkspaceSnapshot";

describe("createSnapshotRequestGeneration", () => {
  test("invalidates an older request when a newer generation begins", () => {
    const guard = createSnapshotRequestGeneration();
    const first = guard.begin();
    const second = guard.begin();

    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
  });

  test("can invalidate an in-flight request during cleanup", () => {
    const guard = createSnapshotRequestGeneration();
    const request = guard.begin();
    guard.begin();

    expect(guard.isCurrent(request)).toBe(false);
  });
});

describe("buildCommercialSnapshotResult", () => {
  const attentionResult = {
    status: "fulfilled",
    value: { source: "firebase", quotes: [] }
  };
  const historyResult = {
    status: "fulfilled",
    value: { source: "firebase", quotes: [{ id: "quote-1" }], truncated: true }
  };

  test("records a last-success timestamp only after both staff reads complete", () => {
    const result = buildCommercialSnapshotResult({
      current: { loadedAt: 0, source: "", attentionSummary: null, quotes: [], truncated: false },
      attentionResult,
      historyResult,
      nowMs: 1234
    });

    expect(result).toMatchObject({
      loadedAt: 1234,
      source: "firebase",
      partial: false,
      stale: false,
      truncated: true,
      truncationKnown: true,
      reads: {
        attention: { status: "success", source: "firebase" },
        history: { status: "success", source: "firebase" }
      }
    });
  });

  test("marks a first incomplete read as partial without inventing a complete refresh", () => {
    const result = buildCommercialSnapshotResult({
      current: { loadedAt: 0, source: "", attentionSummary: null, quotes: [], truncated: false },
      attentionResult,
      historyResult: { status: "rejected", reason: new Error("Quote history unavailable.") },
      nowMs: 1234
    });

    expect(result.loadedAt).toBe(0);
    expect(result.partial).toBe(true);
    expect(result.stale).toBe(false);
    expect(result.error).toBe("Quote history unavailable.");
    expect(result.reads.history.status).toBe("error");
    expect(result.truncationKnown).toBe(false);
  });

  test("retains prior data and marks it stale after a later incomplete refresh", () => {
    const current = {
      loadedAt: 900,
      source: "firebase",
      attentionSummary: { itemCount: 1 },
      quotes: [{ id: "retained" }],
      truncated: false,
      truncationKnown: true
    };
    const result = buildCommercialSnapshotResult({
      current,
      attentionResult: { status: "rejected", reason: new Error("Attention unavailable.") },
      historyResult,
      nowMs: 1234
    });

    expect(result.loadedAt).toBe(900);
    expect(result.stale).toBe(true);
    expect(result.partial).toBe(true);
    expect(result.attentionSummary).toEqual(current.attentionSummary);
    expect(result.quotes).toEqual(current.quotes);
    expect(result.source).toBe(current.source);
    expect(result.truncated).toBe(current.truncated);
    expect(result.truncationKnown).toBe(true);
  });

  test("does not mislabel retained Firebase data when the only fresh result is local", () => {
    const current = {
      loadedAt: 900,
      source: "firebase",
      attentionSummary: { itemCount: 2 },
      quotes: [{ id: "firebase-retained" }],
      truncated: true,
      truncationKnown: true
    };
    const result = buildCommercialSnapshotResult({
      current,
      attentionResult: {
        status: "fulfilled",
        value: { source: "local", quotes: [{ id: "local-not-applied" }] }
      },
      historyResult: { status: "rejected", reason: new Error("History unavailable.") },
      nowMs: 1234
    });

    expect(result).toMatchObject({
      source: "firebase",
      attentionSummary: current.attentionSummary,
      quotes: current.quotes,
      truncated: true,
      truncationKnown: true,
      stale: true,
      partial: true
    });
  });

  test("does not mislabel retained local data when the only fresh result is Firebase", () => {
    const current = {
      loadedAt: 900,
      source: "local",
      attentionSummary: { itemCount: 1 },
      quotes: [{ id: "local-retained" }],
      truncated: false,
      truncationKnown: true
    };
    const result = buildCommercialSnapshotResult({
      current,
      attentionResult: { status: "rejected", reason: new Error("Attention unavailable.") },
      historyResult,
      nowMs: 1234
    });

    expect(result).toMatchObject({
      source: "local",
      attentionSummary: current.attentionSummary,
      quotes: current.quotes,
      truncated: false,
      truncationKnown: true,
      stale: true,
      partial: true
    });
  });

  test("records known truncation from the first successful history half-read", () => {
    const result = buildCommercialSnapshotResult({
      current: { loadedAt: 0, source: "", attentionSummary: null, quotes: [], truncated: false },
      attentionResult: { status: "rejected", reason: new Error("Attention unavailable.") },
      historyResult,
      nowMs: 1234
    });

    expect(result.loadedAt).toBe(0);
    expect(result.partial).toBe(true);
    expect(result.truncationKnown).toBe(true);
    expect(result.truncated).toBe(true);
  });
});
