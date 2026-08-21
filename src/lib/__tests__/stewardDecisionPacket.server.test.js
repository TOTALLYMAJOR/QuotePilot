import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  assertStewardDecisionPacketCurrent,
  buildStewardDecisionPacket
} = require("../steward/validate.cjs");
const { stewardPacketDigest } = require("../steward/contracts.cjs");

function request(overrides = {}) {
  return {
    requestId: "steward-request-3",
    task: "review_margin",
    organizationId: "org-1",
    countryCode: "US",
    actor: { uid: "user-1", role: "sales" },
    brief: "Review the verified margin and explain the current result.",
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

function candidate(overrides = {}) {
  return {
    status: "ready_for_review",
    facts: [{
      id: "fact-margin",
      text: "Verified margin is 31.5%.",
      sourceIds: ["source-margin-1"]
    }],
    assumptions: [],
    questions: [],
    options: [{
      id: "option-review",
      title: "Review scope",
      summary: "Keep the verified scope and discuss tradeoffs.",
      sourceIds: ["source-margin-1"]
    }],
    proposedChanges: [],
    responseDraft: null,
    risks: [],
    ...overrides
  };
}

function packet(overrides = {}) {
  return buildStewardDecisionPacket({
    request: request(),
    sources: [source()],
    candidate: candidate(),
    packetId: "steward-packet-1",
    nowISO: "2026-08-20T20:10:00.000Z",
    ...overrides
  });
}

describe("Steward Decision Packet validation", () => {
  test("builds a deterministic, expiring, revision-bound review packet", () => {
    const result = packet();
    expect(result).toMatchObject({
      schemaVersion: "steward-decision-packet-v1",
      task: "review_margin",
      status: "ready_for_review",
      actor: { uid: "user-1", role: "sales" },
      scope: {
        organizationId: "org-1",
        resourceId: "quote-1",
        catalogRevision: "catalog-v7"
      },
      sourceCoverage: {
        authorizedSourceIds: ["source-margin-1"],
        usedSourceIds: ["source-margin-1"],
        unusedSourceIds: []
      }
    });
    expect(result.packetDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.expiresAt).toBe("2026-08-20T20:25:00.000Z");
    expect(assertStewardDecisionPacketCurrent({
      packet: result,
      request: request(),
      expectedPacketDigest: result.packetDigest,
      nowISO: "2026-08-20T20:20:00.000Z"
    })).toBe(result);
  });

  test("rejects model-originated commercial numbers without deterministic authority", () => {
    expect(() => packet({
      sources: [source({
        type: "model_suggestion_unverified",
        evidenceClass: "unverified_model",
        revision: null
      })]
    })).toThrow(/without deterministic authority/);
  });

  test.each([
    ["script", "<script>alert(1)</script>"],
    ["script URL", "javascript:alert(1)"],
    ["bidi controls", "Review \u202Egpj.exe"]
  ])("rejects unsafe rendering content: %s", (_label, unsafeText) => {
    expect(() => packet({
      candidate: candidate({ assumptions: [{ id: "unsafe", text: unsafeText }] })
    })).toThrow(/unsafe rendering content/);
  });

  test("rejects sensitive claims and provider actions in untrusted model output", () => {
    expect(() => packet({
      candidate: candidate({
        questions: [{ id: "unsafe", text: "Should we mention their nut allergy?" }]
      })
    })).toThrow(/violates policy/);
    expect(() => packet({
      candidate: candidate({
        questions: [{ id: "unsafe", text: "Should we send it now?" }]
      })
    })).toThrow(/violates policy/);
  });

  test("detects packet tampering, authority drift, and expiry", () => {
    const valid = packet();
    const attackerRecomputed = { ...valid, status: "refused" };
    attackerRecomputed.packetDigest = stewardPacketDigest(attackerRecomputed);
    expect(() => assertStewardDecisionPacketCurrent({
      packet: attackerRecomputed,
      request: request(),
      expectedPacketDigest: valid.packetDigest,
      nowISO: "2026-08-20T20:20:00.000Z"
    })).toThrow(/integrity/);
    expect(() => assertStewardDecisionPacketCurrent({
      packet: valid,
      request: request({ scope: { ...request().scope, catalogRevision: "catalog-v8" } }),
      expectedPacketDigest: valid.packetDigest,
      nowISO: "2026-08-20T20:20:00.000Z"
    })).toThrow(/current authority/);
    expect(() => assertStewardDecisionPacketCurrent({
      packet: valid,
      request: request(),
      expectedPacketDigest: valid.packetDigest,
      nowISO: "2026-08-20T20:25:00.000Z"
    })).toThrow(/expired/);
  });

  test("keeps setup and workflow changes behind admin review and fixed fields", () => {
    const discountPacket = packet({
      request: request({
        task: "draft_response",
        brief: "Draft a response offering a discount for administrator review."
      }),
      candidate: candidate({
        facts: [],
        options: [],
        responseDraft: "We can prepare a discount for administrator review."
      })
    });
    expect(discountPacket.status).toBe("needs_information");
    expect(discountPacket.policyGates).toContainEqual({
      code: "admin-review-discount",
      status: "admin_review",
      reason: "This request requires an administrator checkpoint before any existing action path is used."
    });

    const adminRequest = request({
      task: "configure_workflow",
      actor: { uid: "admin-1", role: "admin" },
      brief: "Prepare a typed workflow reminder diff for administrator review."
    });
    const workflowSource = source({
      id: "source-workflow-1",
      type: "workflow_policy",
      field: "workflow.reminderDelayHours",
      revision: "policy-v2",
      evidenceClass: "canonical_record"
    });
    expect(() => packet({
      request: adminRequest,
      sources: [workflowSource],
      candidate: candidate({
        facts: [],
        options: [],
        proposedChanges: [{
          field: "workflow.reminderDelayHours",
          operation: "set",
          value: "48",
          sourceIds: ["source-workflow-1"],
          requiresAdminReview: false
        }]
      })
    })).toThrow(/administrator checkpoint/);
    expect(() => packet({
      request: adminRequest,
      sources: [workflowSource],
      candidate: candidate({
        facts: [],
        options: [],
        proposedChanges: [{
          field: "workflow.enableAutonomousSending",
          operation: "set",
          value: true,
          sourceIds: ["source-workflow-1"],
          requiresAdminReview: true
        }]
      })
    })).toThrow(/outside the fixed task plan/);
  });
});
