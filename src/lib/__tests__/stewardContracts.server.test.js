import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  STEWARD_TASKS,
  normalizeStewardRequest,
  normalizeStewardSources,
  stableSerialize,
  stewardPacketDigest
} = require("../steward/contracts.cjs");

function request(overrides = {}) {
  return {
    requestId: "steward-request-1",
    task: "review_margin",
    organizationId: "org-1",
    countryCode: "US",
    actor: { uid: "user-1", role: "sales" },
    brief: "Review the verified margin and explain any evidence gaps.",
    scope: {
      resourceType: "quote",
      resourceId: "quote-1",
      baseRevision: "quote-v3",
      catalogRevision: "catalog-v7",
      policyRevision: "policy-v2"
    },
    ...overrides
  };
}

function source(overrides = {}) {
  return {
    id: "source-margin-1",
    type: "margin_authority",
    organizationId: "org-1",
    resourceId: "quote-1",
    field: "margin.percent",
    revision: "catalog-v7",
    observedAt: "2026-08-20T20:00:00.000Z",
    expiresAt: "2026-08-20T21:00:00.000Z",
    evidenceClass: "deterministic_result",
    ...overrides
  };
}

describe("Steward request and source contracts", () => {
  test("keeps the fixed task vocabulary and exact request shape", () => {
    expect(STEWARD_TASKS).toEqual([
      "setup_menu",
      "configure_workflow",
      "guide_provider_setup",
      "prepare_quote",
      "review_margin",
      "advise_client",
      "draft_response",
      "plan_strategy"
    ]);
    expect(normalizeStewardRequest(request())).toMatchObject({
      organizationId: "org-1",
      task: "review_margin",
      actor: { role: "sales" }
    });
    expect(() => normalizeStewardRequest({ ...request(), extra: "authority" }))
      .toThrow(/missing or unexpected/);
    expect(() => normalizeStewardRequest(request({ task: "run_any_tool" })))
      .toThrow(/unsupported/);
  });

  test("accepts only same-tenant, current, revision-fenced source handles", () => {
    expect(normalizeStewardSources([source()], {
      request: request(),
      nowISO: "2026-08-20T20:10:00.000Z"
    })).toEqual([source()]);

    expect(() => normalizeStewardSources([source({ organizationId: "org-2" })], {
      request: request(),
      nowISO: "2026-08-20T20:10:00.000Z"
    })).toThrow(/outside the authorized organization/);
    expect(() => normalizeStewardSources([source({ revision: "catalog-v6" })], {
      request: request(),
      nowISO: "2026-08-20T20:10:00.000Z"
    })).toThrow(/revision does not match/);
    expect(() => normalizeStewardSources([source()], {
      request: request(),
      nowISO: "2026-08-20T21:00:00.000Z"
    })).toThrow(/stale/);
  });

  test("never upgrades a model suggestion into trusted evidence", () => {
    expect(() => normalizeStewardSources([source({
      type: "model_suggestion_unverified",
      evidenceClass: "deterministic_result",
      revision: null
    })], {
      request: request(),
      nowISO: "2026-08-20T20:10:00.000Z"
    })).toThrow(/cannot be upgraded/);
  });

  test("canonical serialization and packet digests ignore key insertion order", () => {
    expect(stableSerialize({ z: 1, a: { y: true, b: "x" } }))
      .toBe('{"a":{"b":"x","y":true},"z":1}');
    const first = { schemaVersion: "v1", scope: { b: 2, a: 1 } };
    const second = { scope: { a: 1, b: 2 }, schemaVersion: "v1" };
    expect(stewardPacketDigest(first)).toBe(stewardPacketDigest(second));
  });
});
