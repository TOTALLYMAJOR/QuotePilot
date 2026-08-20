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
    expect(plan.dependencies.docRequirements).toContainEqual({
      mode: "all",
      paths: ["CHANGELOG.md"]
    });
    expect(plan.taskGraph.find((node) => node.id === "governance")?.dependsOn).toEqual(["implement"]);
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
});
