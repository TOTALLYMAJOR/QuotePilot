import { createHash, webcrypto } from "node:crypto";
import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";
import {
  COMMERCIAL_DEPENDENCY_GRAPH_V1 as browserRegistry,
  canonicalSerialize as browserCanonicalSerialize,
  evaluateCommercialDependencyImpact as evaluateBrowserImpact,
  sha256CanonicalValue
} from "../commercialDependencyGraph";

const require = createRequire(import.meta.url);
const serverCore = require("../commercialDependencyGraphCore.cjs");
const parityFixture = require("./fixtures/commercialDependencyGraphParity.v1.json");

describe("commercial dependency graph browser and Node parity", () => {
  test("produces identical canonical bytes, SHA-256, and traversal results", async () => {
    expect(Object.is(parityFixture.canonicalValue.z[1], -0)).toBe(true);

    const browserBytes = browserCanonicalSerialize(parityFixture.canonicalValue);
    const serverBytes = serverCore.canonicalSerialize(parityFixture.canonicalValue);
    expect(browserBytes).toBe(parityFixture.canonicalBytes);
    expect(serverBytes).toBe(parityFixture.canonicalBytes);

    const browserDigest = await sha256CanonicalValue(parityFixture.canonicalValue, {
      cryptoApi: webcrypto
    });
    const serverDigest = createHash("sha256")
      .update(serverBytes, "utf8")
      .digest("hex");
    expect(browserDigest).toBe(parityFixture.sha256);
    expect(serverDigest).toBe(parityFixture.sha256);
    expect(browserDigest).toMatch(/^[a-f0-9]{64}$/);

    expect(evaluateBrowserImpact({
      registry: browserRegistry,
      changedNodeIds: parityFixture.changedNodeIds
    })).toEqual(parityFixture.expectedImpact);
    expect(serverCore.evaluateCommercialDependencyImpact({
      registry: serverCore.COMMERCIAL_DEPENDENCY_GRAPH_V1,
      changedNodeIds: parityFixture.changedNodeIds
    })).toEqual(parityFixture.expectedImpact);
  });
});
