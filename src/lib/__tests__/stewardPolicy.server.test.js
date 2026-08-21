import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  evaluateStewardRequestPolicy,
  inspectStewardContent
} = require("../steward/policy.cjs");

function request(overrides = {}) {
  return {
    requestId: "steward-request-2",
    task: "draft_response",
    organizationId: "org-1",
    countryCode: "US",
    actor: { uid: "user-1", role: "sales" },
    brief: "Draft a courteous follow-up that asks which option they prefer.",
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

describe("Steward policy foundation", () => {
  test("blocks secret-shaped input before inference", () => {
    const cases = [
      ["Use sk_live_1234567890abcdef to configure Stripe", "stripe_secret"],
      ["Set webhook secret: whsec_1234567890abcdef", "webhook_secret"],
      ["-----BEGIN PRIVATE KEY-----", "private_key"]
    ];
    cases.forEach(([brief, reason]) => {
      expect(evaluateStewardRequestPolicy(request({ brief })).decision).toBe("block");
      expect(evaluateStewardRequestPolicy(request({ brief })).reasons).toContain(reason);
    });
  });

  test.each([
    ["allergy", "Tell them the meal is safe for their nut allergy", "allergy_or_health"],
    ["disability", "Use the client's disability in our recommendation", "disability_or_accommodation"],
    ["religion", "Change the offer because of their religion", "religion"],
    ["minor", "Remember that the customer is a minor", "minor"]
  ])("blocks sensitive personal data from the provider lane: %s", (_label, brief, reason) => {
    const result = evaluateStewardRequestPolicy(request({ brief }));
    expect(result.decision).toBe("block");
    expect(result.reasons).toContain(reason);
  });

  test("blocks prohibited manipulation, provider actions, and non-US use", () => {
    expect(evaluateStewardRequestPolicy(request({
      brief: "Estimate their willingness to pay and charge them more."
    })).reasons).toContain("wealth_or_willingness");
    expect(evaluateStewardRequestPolicy(request({
      task: "guide_provider_setup",
      actor: { uid: "user-1", role: "admin" },
      brief: "Create a Stripe account and enable live mode now."
    })).reasons).toEqual(expect.arrayContaining(["provider_account_mutation", "deployment_or_gate"]));
    expect(evaluateStewardRequestPolicy(request({ countryCode: "CA" })).reasons)
      .toContain("us_pilot_only");
  });

  test("requires admin for setup tasks and checkpoints sales discounts/custom menu/policy", () => {
    expect(evaluateStewardRequestPolicy(request({
      task: "configure_workflow",
      brief: "Prepare a typed reminder workflow diff."
    })).reasons).toContain("admin_task_required");
    expect(evaluateStewardRequestPolicy(request({
      brief: "Draft a response offering a 10 percent discount."
    }))).toMatchObject({ decision: "admin_review", adminReviewReasons: ["discount"] });
    expect(evaluateStewardRequestPolicy(request({
      actor: { uid: "admin-1", role: "admin" },
      brief: "Draft a response explaining the approved cancellation policy."
    })).decision).toBe("allow");
  });

  test("keeps ordinary advice allowed and reports no hidden findings", () => {
    expect(inspectStewardContent("Ask which menu option they prefer.")).toEqual({
      secrets: [],
      sensitivePersonalData: [],
      prohibitedTactics: [],
      providerMutations: [],
      adminReview: []
    });
    expect(evaluateStewardRequestPolicy(request()).decision).toBe("allow");
  });
});
