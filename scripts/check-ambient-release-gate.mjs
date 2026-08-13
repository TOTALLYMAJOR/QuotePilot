#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const AMBIENT_RELEASE_GATE_SCRIPT = [
  "bash ./scripts/run-playwright.sh test",
  "e2e/ambient-intelligence-accessibility.spec.js",
  "--grep \"maps every enabled Alpha control and records an exact zero-dead-click route handoff\""
].join(" ");

const CI_WORKFLOW = ".github/workflows/ci-quality.yml";
const PRODUCTION_WORKFLOWS = Object.freeze([
  ".github/workflows/deploy-firebase-hosting.yml",
  ".github/workflows/deploy-vercel-production.yml"
]);
const BROWSER_SPEC = "e2e/ambient-intelligence-accessibility.spec.js";
const ORCHESTRATION_SCRIPT = "scripts/orchestration-lanes.sh";

function read(root, relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`missing required file ${relativePath}`);
  }
  return fs.readFileSync(absolutePath, "utf8");
}

function stepBlock(workflow, name) {
  const marker = `      - name: ${name}`;
  const start = workflow.indexOf(marker);
  if (start < 0) return "";
  const next = workflow.indexOf("\n      - name:", start + marker.length);
  return workflow.slice(start, next < 0 ? workflow.length : next);
}

function requireText(errors, source, expected, message) {
  if (!source.includes(expected)) errors.push(message);
}

export function assertAmbientReleaseGate({ root = ROOT } = {}) {
  const errors = [];
  let packageJson;
  try {
    packageJson = JSON.parse(read(root, "package.json"));
  } catch (error) {
    throw new Error(`Ambient release gate check failed:\n- ${error.message}`);
  }

  if (packageJson?.scripts?.["test:e2e:ambient-release-gate"] !== AMBIENT_RELEASE_GATE_SCRIPT) {
    errors.push("package.json must retain the exact dedicated Ambient browser-gate command");
  }
  if (packageJson?.scripts?.["check:ambient-release-gate"]
    !== "node ./scripts/check-ambient-release-gate.mjs") {
    errors.push("package.json must expose the fast Ambient release-gate policy check");
  }

  let ciWorkflow = "";
  let browserSpec = "";
  let orchestration = "";
  try {
    ciWorkflow = read(root, CI_WORKFLOW);
    browserSpec = read(root, BROWSER_SPEC);
    orchestration = read(root, ORCHESTRATION_SCRIPT);
  } catch (error) {
    errors.push(error.message);
  }

  const gateStep = stepBlock(ciWorkflow, "Run Ambient zero-dead-click release gate");
  if (!gateStep) {
    errors.push("CI must retain the named Ambient zero-dead-click release-gate step");
  } else {
    requireText(
      errors,
      gateStep,
      "run: npm run test:e2e:ambient-release-gate",
      "the Ambient CI gate must run the dedicated browser-gate command"
    );
    [
      "VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED",
      "VITE_PILOT_NOW_ENABLED",
      "VITE_PILOT_EVENT_ROOM_ENABLED",
      "VITE_PILOT_COMMAND_ENABLED",
      "VITE_AMBIENT_UI_ENABLED"
    ].forEach((flag) => requireText(
      errors,
      gateStep,
      `${flag}: \"true\"`,
      `the Ambient CI gate must explicitly enable ${flag}`
    ));
    requireText(
      errors,
      gateStep,
      "VITE_OPERATIONAL_STAFFING_ENABLED: \"false\"",
      "the Ambient UI gate must keep independently governed staffing authority explicitly off"
    );
  }

  const compatibilityBundleStep = stepBlock(ciWorkflow, "Build compatibility production bundle");
  if (!compatibilityBundleStep) {
    errors.push("CI must retain the named compatibility production bundle step");
  } else {
    requireText(
      errors,
      compatibilityBundleStep,
      "run: npm run build && npm run check:perf:bundle",
      "the compatibility bundle step must build and enforce the bundle budget"
    );
    requireText(
      errors,
      compatibilityBundleStep,
      "VITE_AMBIENT_UI_ENABLED: \"false\"",
      "the compatibility bundle step must explicitly exclude Ambient presentation"
    );
    requireText(
      errors,
      compatibilityBundleStep,
      "BUNDLE_BUDGET_PROFILE: compatibility",
      "the compatibility bundle step must request the compatibility profile"
    );
  }

  const ambientBundleStep = stepBlock(ciWorkflow, "Build Ambient production bundle");
  if (!ambientBundleStep) {
    errors.push("CI must retain the named Ambient production bundle step");
  } else {
    requireText(
      errors,
      ambientBundleStep,
      "run: npm run build && npm run check:perf:bundle",
      "the Ambient bundle step must build and enforce the bundle budget"
    );
    requireText(
      errors,
      ambientBundleStep,
      "VITE_AMBIENT_UI_ENABLED: \"true\"",
      "the Ambient bundle step must explicitly enable Ambient presentation"
    );
    requireText(
      errors,
      ambientBundleStep,
      "VITE_OPERATIONAL_STAFFING_ENABLED: \"false\"",
      "the Ambient bundle step must keep independently governed staffing authority off"
    );
    requireText(
      errors,
      ambientBundleStep,
      "BUNDLE_BUDGET_PROFILE: ambient-production",
      "the Ambient bundle step must request the Ambient production profile"
    );
  }

  requireText(
    errors,
    orchestration,
    "npm run check:ambient-release-gate",
    "lane:quick must enforce Ambient release-gate configuration integrity"
  );
  requireText(
    errors,
    browserSpec,
    "maps every enabled Alpha control and records an exact zero-dead-click route handoff",
    "the dedicated browser proof must retain its enabled-control and route-handoff contract"
  );
  requireText(
    errors,
    browserSpec,
    "expect(await unmapped()).toEqual([])",
    "the browser proof must reject enabled controls without Ambient action identities"
  );
  requireText(
    errors,
    browserSpec,
    "deadClickRate: 0",
    "the browser proof must require a zero primary dead-click rate"
  );

  PRODUCTION_WORKFLOWS.forEach((relativePath) => {
    let workflow = "";
    try {
      workflow = read(root, relativePath);
    } catch (error) {
      errors.push(error.message);
      return;
    }
    requireText(
      errors,
      workflow,
      "VITE_AMBIENT_UI_ENABLED: \"true\"",
      `${relativePath} must retain the reviewed Ambient presentation flag`
    );
  });

  if (errors.length > 0) {
    throw new Error(`Ambient release gate check failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }

  return Object.freeze({
    browserCommand: AMBIENT_RELEASE_GATE_SCRIPT,
    productionWorkflowCount: PRODUCTION_WORKFLOWS.length,
    acknowledgementDeadlineMs: 250,
    requiredDeadClickRate: 0
  });
}

const isDirectExecution = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  try {
    const result = assertAmbientReleaseGate();
    process.stdout.write(
      `Ambient release gate is bound to protected CI: ${result.requiredDeadClickRate} dead clicks, ${result.acknowledgementDeadlineMs}ms acknowledgement contract.\n`
    );
  } catch (error) {
    process.stderr.write(`${error?.message || error}\n`);
    process.exitCode = 1;
  }
}
