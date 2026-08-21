import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  STEWARD_PRIVATE_COLLECTIONS,
  STEWARD_RETENTION_DAYS,
  buildStewardAuditMetadata,
  buildStewardDeletionPlan,
  buildStewardIncidentDirective,
  evaluateStewardExecutionGate,
  retentionDeadline
} = require("../steward/controls.cjs");
const { evaluateStewardRequestPolicy } = require("../steward/policy.cjs");

const corpus = JSON.parse(fs.readFileSync(
  path.resolve(process.cwd(), "src/lib/__tests__/fixtures/stewardAdversarialCorpus.v1.json"),
  "utf8"
));

function policyRequest(brief) {
  return {
    requestId: "steward-corpus-request",
    task: "draft_response",
    organizationId: "org-1",
    countryCode: "US",
    actor: { uid: "sales-1", role: "sales" },
    brief,
    scope: {
      resourceType: "quote",
      resourceId: "quote-1",
      baseRevision: "quote-v3",
      catalogRevision: "catalog-v7",
      policyRevision: "policy-v2"
    }
  };
}

function controls(overrides = {}) {
  return {
    policyRevision: "policy-v2",
    organizationId: "org-1",
    globalEnabled: true,
    providerEnabled: true,
    organizationEnabled: true,
    incidentHold: false,
    enabledTasks: ["draft_response"],
    allowedModelSnapshots: ["model-snapshot-1"],
    updatedAt: "2026-08-20T20:00:00.000Z",
    ...overrides
  };
}

describe("Steward Phase 0 controls", () => {
  test("uses only synthetic redacted adversarial fixtures and matches every expected policy result", () => {
    expect(corpus).toMatchObject({
      schemaVersion: "steward-adversarial-corpus-v1",
      fixturesAreSynthetic: true,
      rawCustomerDataAllowed: false
    });
    expect(corpus.cases.length).toBeGreaterThanOrEqual(14);
    corpus.cases.forEach((fixture) => {
      const result = evaluateStewardRequestPolicy(policyRequest(fixture.brief));
      expect(result.decision, fixture.id).toBe(fixture.expectedDecision);
      if (fixture.expectedDecision === "admin_review") {
        expect(result.adminReviewReasons, fixture.id).toContain(fixture.expectedReason);
      } else if (fixture.expectedReason) {
        expect(result.reasons, fixture.id).toContain(fixture.expectedReason);
      }
    });
  });

  test("defines bounded retention with zero raw prompt or response storage", () => {
    expect(STEWARD_RETENTION_DAYS).toEqual({
      run_metadata: 30,
      decision_packet: 30,
      audit_receipt: 395,
      usage_bucket: 395,
      entitlement_receipt: 2555,
      client_memory_fact: 180,
      deletion_receipt: 395,
      policy_version: 2555,
      incident_directive: 395
    });
    expect(STEWARD_RETENTION_DAYS).not.toHaveProperty("raw_prompt");
    expect(STEWARD_RETENTION_DAYS).not.toHaveProperty("raw_response");
    expect(retentionDeadline({
      kind: "decision_packet",
      createdAt: "2026-08-20T00:00:00.000Z",
      reviewedAt: null,
      explicitExpiresAt: "2026-08-25T00:00:00.000Z"
    }).deleteAt).toBe("2026-08-25T00:00:00.000Z");
    expect(() => retentionDeadline({
      kind: "client_memory_fact",
      createdAt: "2026-08-20T00:00:00.000Z",
      reviewedAt: null,
      explicitExpiresAt: null
    })).toThrow(/explicit review time/);
  });

  test("builds allowlisted pseudonymous audit metadata and rejects raw fields", () => {
    const metadata = buildStewardAuditMetadata({
      auditKey: "audit-pseudonymization-key-32-bytes-minimum",
      nowISO: "2026-08-20T20:00:00.000Z",
      record: {
        organizationId: "org-1",
        actorUid: "sales-1",
        requestId: "request-1",
        task: "draft_response",
        outcome: "blocked",
        packetDigest: null,
        modelProvider: "none",
        modelSnapshot: "",
        inputTokens: 0,
        outputTokens: 0,
        blockedReasonCodes: ["sensitive-input"]
      }
    });
    expect(metadata.organizationDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(metadata).not.toHaveProperty("organizationId");
    expect(metadata).not.toHaveProperty("actorUid");
    expect(metadata).not.toHaveProperty("requestId");
    expect(metadata.deleteAt).toBe("2027-09-19T20:00:00.000Z");
    expect(() => buildStewardAuditMetadata({
      auditKey: "audit-pseudonymization-key-32-bytes-minimum",
      nowISO: "2026-08-20T20:00:00.000Z",
      record: {
        organizationId: "org-1",
        actorUid: "sales-1",
        requestId: "request-1",
        task: "draft_response",
        outcome: "blocked",
        packetDigest: null,
        modelProvider: "none",
        modelSnapshot: "",
        inputTokens: 0,
        outputTokens: 0,
        blockedReasonCodes: [],
        prompt: "raw content must never enter audit metadata"
      }
    })).toThrow(/missing or unexpected/);
  });

  test.each([
    ["global kill", { globalEnabled: false }, "global_kill"],
    ["provider kill", { providerEnabled: false }, "provider_kill"],
    ["organization kill", { organizationEnabled: false }, "organization_kill"],
    ["incident hold", { incidentHold: true }, "incident_hold"],
    ["task kill", { enabledTasks: [] }, "task_kill"],
    ["model rollback", { allowedModelSnapshots: ["model-snapshot-0"] }, "model_snapshot_blocked"]
  ])("fails closed for %s", (_label, override, reason) => {
    expect(evaluateStewardExecutionGate({
      task: "draft_response",
      organizationId: "org-1",
      modelSnapshot: "model-snapshot-1",
      controls: controls(override)
    })).toMatchObject({ allowed: false, reasons: expect.arrayContaining([reason]) });
  });

  test("allows only an exact enabled organization, task, and model snapshot", () => {
    expect(evaluateStewardExecutionGate({
      task: "draft_response",
      organizationId: "org-1",
      modelSnapshot: "model-snapshot-1",
      controls: controls()
    })).toEqual({
      policyVersion: "steward-controls-v1",
      allowed: true,
      reasons: [],
      policyRevision: "policy-v2"
    });
  });

  test("requires evidence before releasing an incident hold", () => {
    const base = {
      incidentId: "incident-1",
      action: "release",
      scope: "provider",
      target: "openai",
      reasonCode: "provider-review-complete",
      actorRole: "admin",
      recoveryEvidenceDigest: null,
      createdAt: "2026-08-20T20:00:00.000Z"
    };
    expect(() => buildStewardIncidentDirective(base)).toThrow(/recovery evidence/);
    expect(buildStewardIncidentDirective({
      ...base,
      recoveryEvidenceDigest: "a".repeat(64)
    })).toMatchObject({ action: "release", scope: "provider", target: "openai" });
  });

  test("creates non-executing deletion plans with owner-only organization scope", () => {
    const base = {
      requestId: "deletion-1",
      organizationId: "org-1",
      actorDigest: "b".repeat(64),
      actorRole: "admin",
      scope: "client",
      targetId: "client-1",
      requestedAt: "2026-08-20T20:00:00.000Z"
    };
    expect(buildStewardDeletionPlan(base)).toMatchObject({
      actorDigest: "b".repeat(64),
      targetField: "clientId",
      executionAuthority: "trusted_server_only",
      providerDeletionRequired: true
    });
    expect(() => buildStewardDeletionPlan({
      ...base,
      scope: "organization",
      targetId: "org-1"
    })).toThrow(/owner authority/);
    expect(buildStewardDeletionPlan({
      ...base,
      actorRole: "owner",
      scope: "organization",
      targetId: "org-1"
    }).collections).toEqual(STEWARD_PRIVATE_COLLECTIONS);
  });
});
