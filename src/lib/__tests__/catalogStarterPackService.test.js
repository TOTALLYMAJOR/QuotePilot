import { describe, expect, test, vi } from "vitest";
import {
  applyStarterCatalogPackWithCompatibility,
  isUnsupportedStarterPackVersionError
} from "../catalogStarterPackService";

function unsupportedVersionError() {
  return Object.assign(
    new Error("Choose a supported starter catalog pack version."),
    { code: "functions/invalid-argument" }
  );
}

function request(packVersion = 2) {
  return {
    organizationId: "tenant-a",
    packId: "wedding-events",
    packVersion,
    replaceStagedPack: false,
    expectedCatalogRevision: 0
  };
}

describe("starter catalog pack version compatibility", () => {
  test("recognizes only the server-owned unsupported-version rejection", () => {
    expect(isUnsupportedStarterPackVersionError(unsupportedVersionError())).toBe(true);
    expect(isUnsupportedStarterPackVersionError(Object.assign(
      new Error("Choose a supported starter catalog pack version."),
      { code: "functions/failed-precondition" }
    ))).toBe(false);
    expect(isUnsupportedStarterPackVersionError(Object.assign(
      new Error("Catalog revision changed."),
      { code: "functions/invalid-argument" }
    ))).toBe(false);
  });

  test("retries retained version 1 once with the same revision precondition", async () => {
    const apply = vi.fn()
      .mockRejectedValueOnce(unsupportedVersionError())
      .mockResolvedValueOnce({ ok: true, catalogRevision: 1, pack: { version: 1 } });

    const outcome = await applyStarterCatalogPackWithCompatibility(request(), apply);

    expect(outcome).toMatchObject({
      completed: true,
      attemptedPackVersion: 1,
      compatibilityFallback: true,
      result: { ok: true, catalogRevision: 1, pack: { version: 1 } }
    });
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply.mock.calls.map(([payload]) => ({
      packVersion: payload.packVersion,
      expectedCatalogRevision: payload.expectedCatalogRevision
    }))).toEqual([
      { packVersion: 2, expectedCatalogRevision: 0 },
      { packVersion: 1, expectedCatalogRevision: 0 }
    ]);
  });

  test("does not retry revision, authorization, network, or version 1 failures", async () => {
    const revisionError = Object.assign(new Error("Catalog revision changed."), {
      code: "functions/failed-precondition"
    });
    const applyRevisionFailure = vi.fn().mockRejectedValue(revisionError);
    const revisionOutcome = await applyStarterCatalogPackWithCompatibility(
      request(),
      applyRevisionFailure
    );
    expect(revisionOutcome).toMatchObject({
      completed: false,
      error: revisionError,
      attemptedPackVersion: 2,
      compatibilityFallback: false
    });
    expect(applyRevisionFailure).toHaveBeenCalledTimes(1);

    const applyVersionOneFailure = vi.fn().mockRejectedValue(unsupportedVersionError());
    const versionOneOutcome = await applyStarterCatalogPackWithCompatibility(
      request(1),
      applyVersionOneFailure
    );
    expect(versionOneOutcome).toMatchObject({
      completed: false,
      attemptedPackVersion: 1,
      compatibilityFallback: false
    });
    expect(applyVersionOneFailure).toHaveBeenCalledTimes(1);
  });

  test("preserves the fallback version when its response is uncertain", async () => {
    const networkError = new Error("Connection closed before the response was received.");
    const apply = vi.fn()
      .mockRejectedValueOnce(unsupportedVersionError())
      .mockRejectedValueOnce(networkError);

    const outcome = await applyStarterCatalogPackWithCompatibility(request(), apply);

    expect(outcome).toMatchObject({
      completed: false,
      error: networkError,
      attemptedPackVersion: 1,
      compatibilityFallback: true
    });
    expect(apply).toHaveBeenCalledTimes(2);
  });
});
