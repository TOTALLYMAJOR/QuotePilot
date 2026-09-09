import { describe, expect, test } from "vitest";
import {
  buildTaskPlan,
  loadTaskContract
} from "../../../scripts/task-orchestration-plan.mjs";

const contract = loadTaskContract(process.cwd());

describe("task orchestration planning", () => {
  test("uses the economy model for deterministic documentation work", () => {
    const plan = buildTaskPlan({
      task: "Update documentation copy",
      files: ["docs/USER_MANUAL.md"],
      contract,
      env: {}
    });

    expect(plan.classification).toMatchObject({
      profile: "docs",
      riskLevel: "low",
      highRiskSignal: false
    });
    expect(plan.schemaVersion).toBe(2);
    expect(plan.domainClassification).toMatchObject({
      applicable: false,
      contexts: ["none"]
    });
    expect(plan.modelRouting).toMatchObject({
      tier: "economy",
      selectedModel: "gpt-5.6-luna",
      reasoningEffort: "low",
      switchAuthority: "external_runner"
    });
  });

  test("maps bounded UI work to the balanced model and changelog dependency", () => {
    const plan = buildTaskPlan({
      task: "Fix the composer mobile layout",
      files: ["src/components/ProposalComposer.jsx"],
      contract,
      env: {}
    });

    expect(plan.classification.profile).toBe("ui");
    expect(plan.modelRouting).toMatchObject({
      tier: "balanced",
      selectedModel: "gpt-5.6-terra",
      reasoningEffort: "medium"
    });
    expect(plan.dependencies.requiredSkills).toEqual([
      "design-language",
      "catering-domain-intelligence"
    ]);
    expect(plan.domainClassification.contexts).toEqual(expect.arrayContaining([
      "commercial",
      "proposal_revision"
    ]));
    expect(plan.domainClassification.referenceSlices).toContain(
      ".codex/skills/catering-domain-intelligence/references/commercial.md"
    );
    expect(plan.dependencies.readFirst).not.toContain(
      ".codex/skills/catering-domain-intelligence/references/commercial.md"
    );
    expect(plan.dependencies.readFirst).toEqual(expect.arrayContaining([
      "docs/DESIGN_SYSTEM.md",
      "docs/DESIGN_PRINCIPLES.md"
    ]));
    expect(plan.dependencies.docRequirements).toContainEqual({
      mode: "all",
      paths: ["CHANGELOG.md"]
    });
    expect(plan.taskGraph.map((node) => node.id)).toEqual([
      "discover",
      "form_provisional_action",
      "domain_reconsideration",
      "implement",
      "governance",
      "verify"
    ]);
    expect(plan.taskGraph.find((node) => node.id === "implement")?.dependsOn)
      .toEqual(["domain_reconsideration"]);
  });

  test("escalates authority and payment work to the frontier model", () => {
    const plan = buildTaskPlan({
      task: "Change Stripe payment authorization",
      files: ["functions/index.js"],
      contract,
      env: {}
    });

    expect(plan.classification.riskLevel).toBe("high");
    expect(plan.modelRouting).toMatchObject({
      tier: "frontier",
      selectedModel: "gpt-5.6-sol",
      reasoningEffort: "high"
    });
    expect(plan.domainClassification.contexts).toEqual(expect.arrayContaining([
      "commercial",
      "payments"
    ]));
    expect(plan.dependencies.readFirst).toEqual(expect.arrayContaining([
      "docs/COMMERCIAL_TRUTH_LOOP_ADR.md",
      "docs/PRICING_CONSTITUTION.md",
      "docs/STRIPE_CONNECT_PROGRAM.md"
    ]));
    expect(plan.dependencies.docRequirements).toContainEqual({
      mode: "all",
      paths: [
        "CHANGELOG.md",
        "docs/FEATURE_MATRIX.md",
        "docs/USER_MANUAL.md",
        "docs/capability-surfacing-contracts.json"
      ]
    });
  });

  test("allows the runner to override a tier without changing repository policy", () => {
    const plan = buildTaskPlan({
      task: "Adjust a settings panel",
      files: ["src/components/AdminCatalogModal.jsx"],
      contract,
      env: { TASK_MODEL_BALANCED: "runner-balanced-model" }
    });

    expect(plan.modelRouting.selectedModel).toBe("runner-balanced-model");
    expect(plan.modelRouting.environmentOverride).toBe("TASK_MODEL_BALANCED");
    expect(plan.dependencies.requiredSkills).toEqual([
      "design-language",
      "catering-domain-intelligence"
    ]);
  });

  test("records an exact UTC timestamp for completion handoff", () => {
    const plan = buildTaskPlan({
      task: "Finish orchestration documentation",
      files: ["docs/ORCHESTRATION_RUNBOOK.md"],
      phase: "complete",
      now: new Date("2026-08-20T18:55:22.000Z"),
      contract,
      env: {}
    });

    expect(plan.lifecycle).toEqual({
      phase: "complete",
      recordedAt: "2026-08-20T18:55:22.000Z",
      timestampFormat: "iso8601_utc"
    });
  });

  test("rejects unknown lifecycle phases", () => {
    expect(() => buildTaskPlan({
      task: "Finish orchestration documentation",
      files: ["docs/ORCHESTRATION_RUNBOOK.md"],
      phase: "finished-ish",
      contract,
      env: {}
    })).toThrow(/unsupported lifecycle phase/i);
  });

  test("classifies navigation and staffing independently from the UI execution profile", () => {
    const plan = buildTaskPlan({
      task: "Add Staffing to primary navigation",
      files: ["src/App.jsx"],
      contract,
      env: {}
    });

    expect(plan.classification.profile).toBe("ui");
    expect(plan.domainClassification).toMatchObject({
      applicable: true,
      contexts: ["customer_experience", "event_operations", "staffing"]
    });
    expect(plan.dependencies.requiredSkills).toEqual([
      "design-language",
      "catering-domain-intelligence"
    ]);
    expect(plan.domainClassification.referenceSlices).toEqual([
      ".codex/skills/catering-domain-intelligence/references/domain-model.md",
      ".codex/skills/catering-domain-intelligence/references/ux-customer-experience.md",
      ".codex/skills/catering-domain-intelligence/references/event-operations.md",
      ".codex/skills/catering-domain-intelligence/references/staffing.md"
    ]);
  });

  test("routes a cross-domain accepted guest-count revision to the smallest relevant slices", () => {
    const plan = buildTaskPlan({
      task: "Allow guest count changes after acceptance",
      files: ["src/lib/quoteStore.js"],
      contract,
      env: {}
    });

    expect(plan.domainClassification.contexts).toEqual([
      "commercial",
      "pricing",
      "proposal_revision",
      "event_operations"
    ]);
    expect(plan.domainClassification.referenceSlices).toEqual([
      ".codex/skills/catering-domain-intelligence/references/domain-model.md",
      ".codex/skills/catering-domain-intelligence/references/commercial.md",
      ".codex/skills/catering-domain-intelligence/references/event-operations.md"
    ]);
    expect(plan.domainClassification.authorityReads).toEqual(expect.arrayContaining([
      "docs/ATTENDANCE_STATE_ADR.md",
      "docs/COMMERCIAL_PLATFORM_PROGRAM.md",
      "docs/PRICING_CONSTITUTION.md"
    ]));
  });

  test("uses owned payment paths when the task text is semantically empty", () => {
    const plan = buildTaskPlan({
      task: "Fix this bug",
      files: ["functions/paymentLedger.js"],
      contract,
      env: {}
    });

    expect(plan.domainClassification.contexts).toEqual(["commercial", "payments"]);
    expect(plan.domainClassification.matchedSignals.paths).toEqual(expect.arrayContaining([
      "commercial:functions/paymentLedger.js",
      "payments:functions/paymentLedger.js"
    ]));
  });

  test("adds failure patterns for ambiguous payment outcomes", () => {
    const plan = buildTaskPlan({
      task: "Re-enable payment immediately after a provider timeout",
      files: ["functions/paymentSafety.js"],
      contract,
      env: {}
    });

    expect(plan.domainClassification.contexts).toEqual(["commercial", "payments"]);
    expect(plan.domainClassification.referenceSlices).toContain(
      ".codex/skills/catering-domain-intelligence/references/failure-patterns.md"
    );
  });

  test.each([
    {
      task: "Replace an entree on an accepted event",
      file: "src/lib/menuService.js",
      contexts: ["commercial", "catalog_menu"]
    },
    {
      task: "Fix this view",
      file: "src/lib/beoExport.js",
      contexts: ["event_operations", "beo_document_truth"]
    },
    {
      task: "Improve the customer portal decision flow",
      file: "src/components/CustomerPortalView.jsx",
      contexts: ["customer_experience"]
    },
    {
      task: "Add more metrics to the reporting dashboard",
      file: "src/components/ReportingDashboardRoute.jsx",
      contexts: ["reporting"]
    },
    {
      task: "Expose event blockers in readiness",
      file: "src/components/ReadinessRing.jsx",
      contexts: ["readiness"]
    }
  ])("routes $task through domain contexts", ({ task, file, contexts }) => {
    const plan = buildTaskPlan({ task, files: [file], contract, env: {} });
    expect(plan.domainClassification.contexts).toEqual(expect.arrayContaining(contexts));
    expect(plan.dependencies.requiredSkills).toContain("catering-domain-intelligence");
  });

  test("routes evidence-tier paths to reporting and readiness without relying on task wording", () => {
    const plan = buildTaskPlan({
      task: "Adjust this producer",
      files: ["evidence/src/producers/attendanceProducer.mjs"],
      contract,
      env: {}
    });

    expect(plan.domainClassification.contexts).toEqual(["readiness", "reporting"]);
  });

  test("mechanical work suppresses domain routing even on a payment path", () => {
    const plan = buildTaskPlan({
      task: "Reformat this payment configuration without behavioral changes",
      files: ["src/lib/paymentLink.js"],
      contract,
      env: {}
    });

    expect(plan.domainClassification).toMatchObject({
      applicable: false,
      contexts: ["none"]
    });
    expect(plan.domainClassification.matchedSignals.exclusions).toEqual([
      "mechanical:reformat",
      "mechanical:without behavioral changes"
    ]);
    expect(plan.dependencies.requiredSkills).not.toContain("catering-domain-intelligence");
  });

  test("overloaded software terms do not masquerade as catering domain signals", () => {
    const plan = buildTaskPlan({
      task: "Update the server package contract and production report",
      files: ["package.json"],
      contract,
      env: {}
    });

    expect(plan.domainClassification).toMatchObject({
      applicable: false,
      contexts: ["none"]
    });
    expect(plan.dependencies.requiredSkills).not.toContain("catering-domain-intelligence");
  });

  test("agent process files and evaluation fixtures do not self-trigger", () => {
    const plan = buildTaskPlan({
      task: "Update payment examples in the catering domain skill",
      files: [
        ".codex/skills/catering-domain-intelligence/references/payment-reconciliation.md",
        "CHANGELOG.md",
        "scripts/task-orchestration-plan.mjs",
        "src/lib/__tests__/taskOrchestrationPlan.test.js"
      ],
      contract,
      env: {}
    });

    expect(plan.classification.profile).toBe("process");
    expect(plan.domainClassification).toMatchObject({
      applicable: false,
      contexts: ["none"]
    });
    expect(plan.dependencies.requiredSkills).not.toContain("catering-domain-intelligence");
  });

  test("fixture filenames do not self-trigger domain retrieval", () => {
    const plan = buildTaskPlan({
      task: "Update the payment fixture",
      files: ["src/lib/paymentFixture.js"],
      contract,
      env: {}
    });

    expect(plan.domainClassification).toMatchObject({
      applicable: false,
      contexts: ["none"]
    });
  });

  test("agent behavior changes add an expertise evaluation after deterministic verification", () => {
    const plan = buildTaskPlan({
      task: "Refine repository agent behavior",
      files: ["AGENTS.md"],
      contract,
      env: {}
    });

    expect(plan.taskGraph.at(-1)).toMatchObject({
      id: "expertise_eval",
      dependsOn: ["verify"]
    });
  });
});
