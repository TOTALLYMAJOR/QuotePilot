import assert from "node:assert/strict";
import test from "node:test";
import {
  extractEnhancementIds,
  resolveEnhancementImpact,
  validateEnhancementManifest
} from "../check-enhancement-impact-contract.mjs";
import {
  buildTaskPlan,
  loadTaskContract
} from "../task-orchestration-plan.mjs";

function fixtureManifest(overrides = {}) {
  return {
    schemaVersion: 1,
    authorityBoundaries: [
      {
        id: "pricing",
        exactPaths: ["src/lib/quoteCalculator.js"],
        pathPrefixes: []
      },
      {
        id: "inventory",
        exactPaths: ["functions/inventoryAuthority.js"],
        pathPrefixes: ["src/lib/inventoryAuthority"]
      },
      {
        id: "task_orchestration",
        exactPaths: ["scripts/task-orchestration-plan.mjs"],
        pathPrefixes: []
      }
    ],
    enhancements: [
      {
        id: "97",
        title: "Declare enhancement impact",
        changeType: "process",
        routes: [],
        authorities: ["task_orchestration"],
        tests: ["node --test scripts/__tests__/enhancement-impact-contract.test.mjs"]
      }
    ],
    ...overrides
  };
}

test("accepts presentation-only work only with an explicit empty authority list", () => {
  const manifest = fixtureManifest({
    enhancements: [{
      id: "31",
      title: "Improve accessible names",
      changeType: "presentation",
      routes: ["/app/clients"],
      authorities: [],
      tests: ["src/components/__tests__/ambientClientsExperience.test.jsx"]
    }]
  });

  assert.doesNotThrow(() => validateEnhancementManifest(manifest));
  assert.deepEqual(
    resolveEnhancementImpact({
      manifest,
      enhancementIds: ["31"],
      files: ["src/components/AmbientClientsExperience.jsx"]
    })[0].authorities,
    []
  );
});

test("rejects presentation-only work that declares an authority", () => {
  const manifest = fixtureManifest({
    enhancements: [{
      id: "31",
      title: "Improve accessible names",
      changeType: "presentation",
      routes: ["/app/clients"],
      authorities: ["pricing"],
      tests: ["src/components/__tests__/ambientClientsExperience.test.jsx"]
    }]
  });

  assert.throws(
    () => validateEnhancementManifest(manifest),
    /presentation-only and must declare authorities: \[\]/i
  );
});

test("rejects missing routes and tests instead of accepting an incomplete declaration", () => {
  const manifest = fixtureManifest({
    enhancements: [{
      id: "31",
      title: "Incomplete",
      changeType: "presentation",
      authorities: [],
      tests: []
    }]
  });

  assert.throws(
    () => validateEnhancementManifest(manifest),
    /routes must be an array[\s\S]*tests must contain at least 1 item/i
  );
});

test("rejects a presentation declaration that crosses a pricing authority path", () => {
  const manifest = fixtureManifest({
    enhancements: [{
      id: "31",
      title: "Presentation-only change",
      changeType: "presentation",
      routes: ["/app/clients"],
      authorities: [],
      tests: ["src/components/__tests__/ambientClientsExperience.test.jsx"]
    }]
  });

  assert.throws(
    () => resolveEnhancementImpact({
      manifest,
      enhancementIds: ["31"],
      files: ["src/lib/quoteCalculator.js"]
    }),
    /does not declare authority pricing[\s\S]*presentation-only work/i
  );
});

test("rejects an undeclared Inventory authority crossing", () => {
  assert.throws(
    () => resolveEnhancementImpact({
      manifest: fixtureManifest(),
      enhancementIds: ["97"],
      files: ["functions/inventoryAuthority.js"]
    }),
    /does not declare authority inventory/i
  );
});

test("extracts singular, plural, and ranged enhancement identifiers", () => {
  assert.deepEqual(extractEnhancementIds("Implement item 97"), ["97"]);
  assert.deepEqual(extractEnhancementIds("Implement enhancements 26–28"), ["26", "27", "28"]);
  assert.deepEqual(extractEnhancementIds("Implement items 35, 39 and 47"), ["35", "39", "47"]);
});

test("fails closed when a named enhancement has no declaration", () => {
  assert.throws(
    () => resolveEnhancementImpact({
      manifest: fixtureManifest(),
      enhancementIds: ["98"],
      files: []
    }),
    /declarations missing for: 98/i
  );
});

test("publishes registered routes, authorities, and tests in the planner packet", () => {
  const plan = buildTaskPlan({
    task: "Implement item 97",
    files: ["scripts/task-orchestration-plan.mjs"],
    contract: loadTaskContract(process.cwd()),
    enhancementManifest: fixtureManifest(),
    env: {}
  });

  assert.equal(plan.enhancementImpact.required, true);
  assert.deepEqual(plan.enhancementImpact.declarations, [{
    id: "97",
    title: "Declare enhancement impact",
    changeType: "process",
    routes: [],
    authorities: ["task_orchestration"],
    tests: ["node --test scripts/__tests__/enhancement-impact-contract.test.mjs"]
  }]);
  assert.ok(plan.dependencies.validations.includes("node scripts/check-enhancement-impact-contract.mjs"));
  assert.ok(plan.dependencies.validations.includes(
    "node --test scripts/__tests__/enhancement-impact-contract.test.mjs"
  ));
});
