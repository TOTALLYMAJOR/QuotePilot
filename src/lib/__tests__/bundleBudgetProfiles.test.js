import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  checkBundleBudget,
  detectBundleProfile,
  PRODUCTION_FIXTURE_CHUNK_PREFIXES,
  PRODUCTION_FIXTURE_PAYLOAD_SENTINELS
} from "../../../scripts/check-bundle-budget.mjs";

const temporaryDirectories = [];

function write(root, relativePath, content) {
  const absolutePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
}

function fixture({ marker = "LegacyQuoteHistoryModal-test.js", bytes = 12 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "quotepilot-bundle-profile-"));
  temporaryDirectories.push(root);
  write(root, `dist/assets/${marker}`, Buffer.alloc(bytes));
  write(root, "docs/performance/bundle-budget.json", JSON.stringify({
    generatedAt: "2026-08-07",
    allowancePercent: 5,
    metrics: { totalJsBytes: 10, largestJsChunkBytes: 10 }
  }));
  write(root, "docs/performance/bundle-exception.json", JSON.stringify({
    id: "test-profile-budget",
    status: "active",
    baselineGeneratedAt: "2026-08-07",
    baselineMetrics: { totalJsBytes: 10, largestJsChunkBytes: 10 },
    profiles: {
      compatibility: {
        maxMetrics: { totalJsBytes: 12, largestJsChunkBytes: 12 }
      },
      "ambient-production": {
        maxMetrics: { totalJsBytes: 20, largestJsChunkBytes: 20 }
      }
    }
  }));
  return root;
}

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    fs.rmSync(directory, { recursive: true, force: true });
  });
});

describe("bundle budget profiles", () => {
  test("detects exactly one compatibility or Ambient production graph", () => {
    expect(detectBundleProfile(["LegacyQuoteHistoryModal-hash.js"])).toBe("compatibility");
    expect(detectBundleProfile(["AmbientLivingOpportunityRoute-hash.js"])).toBe("ambient-production");
    expect(() => detectBundleProfile([])).toThrow("detected none");
    expect(() => detectBundleProfile([
      "LegacyQuoteHistoryModal-hash.js",
      "AmbientLivingOpportunityRoute-hash.js"
    ])).toThrow("detected compatibility, ambient-production");
  });

  test("rejects a requested profile that does not match the emitted graph", () => {
    expect(() => checkBundleBudget({
      root: fixture(),
      requestedProfile: "ambient-production",
      log: { log() {} }
    })).toThrow("does not match detected graph compatibility");
  });

  test("uses the detected profile ceiling without widening compatibility", () => {
    const compatibility = checkBundleBudget({
      root: fixture(),
      requestedProfile: "compatibility",
      log: { log() {} }
    });
    expect(compatibility.effectiveMaximums).toEqual({
      totalJsBytes: 12,
      largestJsChunkBytes: 12
    });

    const ambient = checkBundleBudget({
      root: fixture({ marker: "AmbientLivingOpportunityRoute-test.js", bytes: 20 }),
      requestedProfile: "ambient-production",
      log: { log() {} }
    });
    expect(ambient.effectiveMaximums).toEqual({
      totalJsBytes: 20,
      largestJsChunkBytes: 20
    });
  });

  test("fails closed when either graph exceeds its own ceiling", () => {
    expect(() => checkBundleBudget({
      root: fixture({ bytes: 13 }),
      requestedProfile: "compatibility",
      log: { log() {} }
    })).toThrow("totalJsBytes 13 exceeds allowed 12");
  });

  test("fails closed when a production asset exposes a development fixture chunk or payload", () => {
    const fixtureChunkRoot = fixture();
    write(
      fixtureChunkRoot,
      "dist/assets/localCustomerDirectoryFixture-test.js",
      "export const fixture = true;"
    );
    expect(() => checkBundleBudget({
      root: fixtureChunkRoot,
      requestedProfile: "compatibility",
      log: { log() {} }
    })).toThrow("matches development fixture chunk prefix localCustomerDirectoryFixture-");

    const fixturePayloadRoot = fixture();
    write(
      fixturePayloadRoot,
      "dist/assets/LegacyQuoteHistoryModal-test.js",
      'console.log("avery.staff@example.com");'
    );
    expect(() => checkBundleBudget({
      root: fixturePayloadRoot,
      requestedProfile: "compatibility",
      log: { log() {} }
    })).toThrow('contains development fixture payload sentinel "avery.staff@example.com"');
  });

  test("keeps shared local-state and client-action contract labels outside the fixture ban", () => {
    expect(PRODUCTION_FIXTURE_CHUNK_PREFIXES).not.toContain("review-client-");
    expect(PRODUCTION_FIXTURE_PAYLOAD_SENTINELS).not.toContain("local_fixture");
    expect(PRODUCTION_FIXTURE_PAYLOAD_SENTINELS).not.toContain("review-client-");
  });
});
