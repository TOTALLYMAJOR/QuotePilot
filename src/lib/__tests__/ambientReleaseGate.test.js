import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  AMBIENT_RELEASE_GATE_SCRIPT,
  assertAmbientReleaseGate
} from "../../../scripts/check-ambient-release-gate.mjs";

const temporaryDirectories = [];

function write(root, relativePath, content) {
  const absolutePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
}

function fixture(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "quotepilot-ambient-gate-"));
  temporaryDirectories.push(root);
  const sources = {
    package: JSON.stringify({ scripts: {
      "test:e2e:ambient-release-gate": AMBIENT_RELEASE_GATE_SCRIPT,
      "check:ambient-release-gate": "node ./scripts/check-ambient-release-gate.mjs"
    } }),
    ci: `jobs:
  playwright_smoke:
    steps:
      - name: Run Ambient zero-dead-click release gate
        run: npm run test:e2e:ambient-release-gate
        env:
          VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED: "true"
          VITE_PILOT_NOW_ENABLED: "true"
          VITE_PILOT_EVENT_ROOM_ENABLED: "true"
          VITE_PILOT_COMMAND_ENABLED: "true"
          VITE_AMBIENT_UI_ENABLED: "true"
          VITE_OPERATIONAL_STAFFING_ENABLED: "true"
      - name: Build compatibility production bundle
        run: npm run build && npm run check:perf:bundle
        env:
          VITE_AMBIENT_UI_ENABLED: "false"
          BUNDLE_BUDGET_PROFILE: compatibility
      - name: Build Ambient production bundle
        run: npm run build && npm run check:perf:bundle
        env:
          VITE_AMBIENT_UI_ENABLED: "true"
          VITE_OPERATIONAL_STAFFING_ENABLED: "true"
          BUNDLE_BUDGET_PROFILE: ambient-production
      - name: Continue protected lane
        run: npm run build
`,
    spec: `test("maps every enabled Alpha control and records an exact zero-dead-click route handoff", async () => {
  expect(await unmapped()).toEqual([]);
  expect(receipt).toMatchObject({ deadClickRate: 0 });
});
`,
    orchestration: "npm run check:ambient-release-gate\n",
    deploy: "env:\n  VITE_AMBIENT_UI_ENABLED: \"true\"\n  VITE_OPERATIONAL_STAFFING_ENABLED: \"true\"\n",
    workPlan: Array.from(
      { length: 50 },
      (_, index) => `- **AIUI-${String(index + 1).padStart(2, "0")} [EVOLVE]** Contract.`
    ).join("\n"),
    uatChecklist: JSON.stringify({
      candidateProfiles: [{
        id: "staging-safe-off",
        itemStates: {
          "operator.authenticated-workspace-journey": { state: "applicable" }
        }
      }],
      items: [{
        id: "operator.authenticated-workspace-journey",
        targets: ["firebase-hosting", "firebase-all", "vercel"]
      }]
    }),
    ...overrides
  };

  write(root, "package.json", sources.package);
  write(root, ".github/workflows/ci-quality.yml", sources.ci);
  write(root, ".github/workflows/deploy-firebase-hosting.yml", sources.deploy);
  write(root, ".github/workflows/deploy-vercel-production.yml", sources.deploy);
  write(root, "e2e/ambient-intelligence-accessibility.spec.js", sources.spec);
  write(root, "scripts/orchestration-lanes.sh", sources.orchestration);
  write(root, "docs/AMBIENT_INTELLIGENCE_WORK_PLAN.md", sources.workPlan);
  write(root, "docs/release-uat-checklist.json", sources.uatChecklist);
  return root;
}

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    fs.rmSync(directory, { recursive: true, force: true });
  });
});

describe("Ambient zero-dead-click release gate", () => {
  test("accepts the protected browser, policy, production-flag, and authority boundaries", () => {
    expect(assertAmbientReleaseGate({ root: fixture() })).toEqual({
      browserCommand: AMBIENT_RELEASE_GATE_SCRIPT,
      materialItemCount: 50,
      operatorUatItemId: "operator.authenticated-workspace-journey",
      productionWorkflowCount: 2,
      retirementGateCount: 4,
      acknowledgementDeadlineMs: 250,
      requiredDeadClickRate: 0
    });
  });

  test("fails closed when the browser gate loses its zero-dead-click assertion", () => {
    const root = fixture({
      spec: `test("maps every enabled Alpha control and records an exact zero-dead-click route handoff", async () => {
  expect(await unmapped()).toEqual([]);
});
`
    });

    expect(() => assertAmbientReleaseGate({ root })).toThrow(
      "the browser proof must require a zero primary dead-click rate"
    );
  });

  test("fails closed when the promoted staffing presentation is missing from the UI gate", () => {
    const root = fixture({
      ci: `jobs:
  playwright_smoke:
    steps:
      - name: Run Ambient zero-dead-click release gate
        run: npm run test:e2e:ambient-release-gate
        env:
          VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED: "true"
          VITE_PILOT_NOW_ENABLED: "true"
          VITE_PILOT_EVENT_ROOM_ENABLED: "true"
          VITE_PILOT_COMMAND_ENABLED: "true"
          VITE_AMBIENT_UI_ENABLED: "true"
          VITE_OPERATIONAL_STAFFING_ENABLED: "false"
      - name: Build compatibility production bundle
        run: npm run build && npm run check:perf:bundle
        env:
          VITE_AMBIENT_UI_ENABLED: "false"
          BUNDLE_BUDGET_PROFILE: compatibility
      - name: Build Ambient production bundle
        run: npm run build && npm run check:perf:bundle
        env:
          VITE_AMBIENT_UI_ENABLED: "true"
          VITE_OPERATIONAL_STAFFING_ENABLED: "true"
          BUNDLE_BUDGET_PROFILE: ambient-production
`
    });

    expect(() => assertAmbientReleaseGate({ root })).toThrow(
      "must exercise the promoted staffing presentation"
    );
  });

  test("fails closed when the canonical 50-item inventory is incomplete", () => {
    const root = fixture({
      workPlan: Array.from(
        { length: 49 },
        (_, index) => `- **AIUI-${String(index + 1).padStart(2, "0")} [EVOLVE]** Contract.`
      ).join("\n")
    });

    expect(() => assertAmbientReleaseGate({ root })).toThrow(
      "must retain exactly one definition for AIUI-01 through AIUI-50"
    );
  });

  test("fails closed when authenticated operator UAT is no longer browser-applicable", () => {
    const root = fixture({
      uatChecklist: JSON.stringify({
        candidateProfiles: [{
          id: "staging-safe-off",
          itemStates: {
            "operator.authenticated-workspace-journey": { state: "blocked" }
          }
        }],
        items: [{
          id: "operator.authenticated-workspace-journey",
          targets: ["firebase-backend", "firebase-all"]
        }]
      })
    });

    expect(() => assertAmbientReleaseGate({ root })).toThrow(
      /browser-target authenticated operator UAT item.*safe-off candidate.*applicable/is
    );
  });

  test("fails closed when AIUI-48 removal is authorized before every external gate", () => {
    const assessRetirement = (inputs = {}) => ({
      removalAuthorized: Object.values(inputs).filter(Boolean).length >= 3
    });

    expect(() => assertAmbientReleaseGate({
      root: fixture(),
      assessRetirement
    })).toThrow(
      "AIUI-48 removal must remain blocked until parity, rollback, release acceptance, and promotion approval all pass"
    );
  });
});
