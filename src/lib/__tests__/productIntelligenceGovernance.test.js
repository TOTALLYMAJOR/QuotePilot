import { afterEach, describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPOSITORY_ROOT = process.cwd();
const CHECK_PATH = path.join(REPOSITORY_ROOT, "scripts", "check-product-intelligence.mjs");
const PRODUCT_FILES = [
  "docs/PRODUCT_INTELLIGENCE.md",
  "docs/product-intelligence/PRODUCT_OUTCOME_CONTRACT.md",
  "docs/product-intelligence/CAPABILITY_MAP.md",
  "docs/product-intelligence/SUCCESS_METRICS.md",
  "docs/product-intelligence/event-schema.json",
  "docs/product-intelligence/BASELINES_AND_TARGETS.md",
  "docs/product-intelligence/USER_JOURNEY_FUNNELS.md",
  "docs/product-intelligence/QUALITY_GUARDRAILS.md",
  "docs/product-intelligence/RELEASE_EXPERIMENT_LEDGER.md"
];

const fixtures = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "quotepilot-product-intelligence-"));
  fixtures.push(root);

  for (const relativePath of PRODUCT_FILES) {
    const target = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(REPOSITORY_ROOT, relativePath), target);
  }

  const schema = JSON.parse(fs.readFileSync(
    path.join(root, "docs/product-intelligence/event-schema.json"),
    "utf8"
  ));
  for (const sourcePath of schema.signals.flatMap((signal) => signal.sourcePaths)) {
    const target = path.join(root, sourcePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!fs.existsSync(target)) fs.writeFileSync(target, "fixture source\n");
  }

  return root;
}

function runCheck(root, { changedFiles = [], env = {}, staticOnly = true } = {}) {
  const args = [CHECK_PATH, "--root", root];
  if (staticOnly) args.push("--static-only");
  for (const file of changedFiles) args.push("--changed-file", file);
  return spawnSync(process.execPath, args, {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      PRODUCT_INTELLIGENCE_PR_ENFORCE: "false",
      PRODUCT_INTELLIGENCE_PR_BODY: "",
      ...env
    }
  });
}

function replaceInFixture(root, relativePath, from, to) {
  const filePath = path.join(root, relativePath);
  const current = fs.readFileSync(filePath, "utf8");
  expect(current).toContain(from);
  fs.writeFileSync(filePath, current.replace(from, to));
}

describe("product intelligence governance", () => {
  test("accepts the current canonical product-intelligence corpus", () => {
    const result = runCheck(REPOSITORY_ROOT);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/6 outcomes, 12 capabilities, 21 metrics, 21 signals/i);
  });

  test("rejects a signal that references an unknown metric", () => {
    const root = makeFixture();
    const schemaPath = path.join(root, "docs/product-intelligence/event-schema.json");
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
    schema.signals.find((signal) => signal.id === "SIG-001").metricIds = ["MET-999"];
    fs.writeFileSync(schemaPath, `${JSON.stringify(schema, null, 2)}\n`);

    const result = runCheck(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("SIG-001 references unknown metric MET-999");
  });

  test("rejects duplicate capability identifiers", () => {
    const root = makeFixture();
    replaceInFixture(
      root,
      "docs/product-intelligence/CAPABILITY_MAP.md",
      "| `CAP-02` |",
      "| `CAP-01` |"
    );

    const result = runCheck(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Duplicate capability ID: CAP-01");
  });

  test("rejects signal sources that do not exist", () => {
    const root = makeFixture();
    const schemaPath = path.join(root, "docs/product-intelligence/event-schema.json");
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
    schema.signals.find((signal) => signal.id === "SIG-001").sourcePaths.push("src/missing-product-signal.js");
    fs.writeFileSync(schemaPath, `${JSON.stringify(schema, null, 2)}\n`);

    const result = runCheck(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "SIG-001 source path does not exist: src/missing-product-signal.js"
    );
  });

  test("rejects an adoption decision without outcome evidence", () => {
    const root = makeFixture();
    replaceInFixture(
      root,
      "docs/product-intelligence/RELEASE_EXPERIMENT_LEDGER.md",
      "| `no_outcome_claim` |",
      "| `adopt` |"
    );

    const result = runCheck(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "LED-006 decision adopt requires explicit outcome evidence"
    );
  });

  test("requires analytics contract updates when analytics implementation changes", () => {
    const root = makeFixture();
    const result = runCheck(root, {
      staticOnly: false,
      changedFiles: ["src/lib/productAnalyticsCore.js"]
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Product analytics changed without updating docs/product-intelligence/event-schema.json"
    );
    expect(result.stderr).toContain(
      "Product analytics changed without updating docs/product-intelligence/SUCCESS_METRICS.md"
    );
    expect(result.stderr).toContain(
      "Product analytics changed without updating docs/product-intelligence/RELEASE_EXPERIMENT_LEDGER.md"
    );
  });

  test("accepts analytics changes when schema, metrics, and ledger move together", () => {
    const root = makeFixture();
    const result = runCheck(root, {
      staticOnly: false,
      changedFiles: [
        "src/lib/productAnalyticsCore.js",
        "docs/PRODUCT_INTELLIGENCE.md",
        "docs/product-intelligence/event-schema.json",
        "docs/product-intelligence/SUCCESS_METRICS.md",
        "docs/product-intelligence/RELEASE_EXPERIMENT_LEDGER.md"
      ]
    });

    expect(result.status, result.stderr).toBe(0);
  });

  test("requires the index and ledger for user-visible product source changes", () => {
    const root = makeFixture();
    const result = runCheck(root, {
      staticOnly: false,
      changedFiles: ["src/components/QuoteWorkspace.jsx"]
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "User-visible product source changed without updating docs/PRODUCT_INTELLIGENCE.md"
    );
    expect(result.stderr).toContain(
      "User-visible product source changed without updating docs/product-intelligence/RELEASE_EXPERIMENT_LEDGER.md"
    );
  });

  test("treats user-visible stylesheet changes as product source changes", () => {
    const root = makeFixture();
    const result = runCheck(root, {
      staticOnly: false,
      changedFiles: ["src/styles.css"]
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "User-visible product source changed without updating docs/PRODUCT_INTELLIGENCE.md"
    );
    expect(result.stderr).toContain(
      "User-visible product source changed without updating docs/product-intelligence/RELEASE_EXPERIMENT_LEDGER.md"
    );
  });

  test("rejects an incomplete required PR catering-value declaration", () => {
    const root = makeFixture();
    const result = runCheck(root, {
      env: {
        PRODUCT_INTELLIGENCE_PR_ENFORCE: "true",
        PRODUCT_INTELLIGENCE_PR_BODY: [
          "- disposition: required",
          "- Actor:",
          "- Catering job or decision:",
          "- Expected improvement:",
          "- Outcome or metric IDs:",
          "- Guardrail IDs:",
          "- Evidence needed:",
          "- Release / experiment ledger entry:"
        ].join("\n")
      }
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("PR Product Intelligence field is incomplete: Actor");
    expect(result.stderr).toContain(
      "PR Product Intelligence field is incomplete: Release / experiment ledger entry"
    );
  });

  test("accepts a complete required PR catering-value declaration", () => {
    const root = makeFixture();
    const result = runCheck(root, {
      env: {
        PRODUCT_INTELLIGENCE_PR_ENFORCE: "true",
        PRODUCT_INTELLIGENCE_PR_BODY: [
          "- disposition: required",
          "- If `not_applicable`, rationale:",
          "- Actor: Catering owner-operator",
          "- Catering job or decision: Keep product changes tied to measurable value",
          "- Expected improvement: Fewer untraceable product changes",
          "- Outcome or metric IDs: MET-18",
          "- Guardrail IDs: GRD-14, GRD-16",
          "- Evidence needed: Required CI gate and owner outcome review",
          "- Release / experiment ledger entry: LED-005"
        ].join("\n")
      }
    });

    expect(result.status, result.stderr).toBe(0);
  });

  test("requires a rationale when a PR declares product intelligence not applicable", () => {
    const root = makeFixture();
    const result = runCheck(root, {
      env: {
        PRODUCT_INTELLIGENCE_PR_ENFORCE: "true",
        PRODUCT_INTELLIGENCE_PR_BODY: [
          "- disposition: not_applicable",
          "- If `not_applicable`, rationale:"
        ].join("\n")
      }
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "PR Product Intelligence not_applicable disposition requires a rationale"
    );
  });

  test("rejects not_applicable for a user-visible product change", () => {
    const root = makeFixture();
    const result = runCheck(root, {
      staticOnly: false,
      changedFiles: [
        "src/components/QuoteWorkspace.jsx",
        "docs/PRODUCT_INTELLIGENCE.md",
        "docs/product-intelligence/RELEASE_EXPERIMENT_LEDGER.md"
      ],
      env: {
        PRODUCT_INTELLIGENCE_PR_ENFORCE: "true",
        PRODUCT_INTELLIGENCE_PR_BODY: [
          "- disposition: not_applicable",
          "- If `not_applicable`, rationale: The docs moved with the component."
        ].join("\n")
      }
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "PR Product Intelligence disposition must be required for product-relevant changes"
    );
  });
});
