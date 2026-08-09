import { describe, expect, test } from "vitest";
import { createSnapshotRequestGeneration } from "../useCommercialWorkspaceSnapshot";

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
