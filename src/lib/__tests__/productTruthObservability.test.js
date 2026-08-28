import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, test } from "vitest";
import {
  PRODUCT_TRUTH_SCHEMA,
  collectProductionClaims,
  productTruthExitCode,
  reconcileProductTruth,
  renderProductTruthText,
  sortFindings
} from "../../../scripts/product-truth-observability.mjs";

const ROOT = process.cwd();
const SCRIPT = path.join(ROOT, "scripts", "product-truth-observability.mjs");
const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quotepilot-product-truth-"));
  tempDirs.push(dir);
  return dir;
}

function run(command, args, cwd) {
  return spawnSync(command, args, {
    cwd,
    env: { ...process.env },
    encoding: "utf8"
  });
}

function git(cwd, args) {
  const result = run("git", args, cwd);
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

function write(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function createFixtureRepository({ malformedContracts = false } = {}) {
  const root = makeTempDir();
  write(root, "PROJECT_STATUS.md", [
    "# Project Status",
    "",
    "## Current Production Release",
    "",
    "- Annotated tag `v2.0.0` is the current release.",
    "",
    "## Operational Health",
    "",
    "- Production runtime: `v1.5.0` is live from commit `fixture`."
  ].join("\n"));
  write(root, "docs/FEATURE_MATRIX.md", [
    "# Feature Matrix",
    "",
    "As of this snapshot, recorded production is `v1.5.0`.",
    "",
    "| # | Feature Area | Status | Primary Evidence |",
    "|---|---|---|---|",
    "| 1 | Example | Implemented (source/local) | `example.js` |"
  ].join("\n"));
  write(
    root,
    "docs/capability-surfacing-contracts.json",
    malformedContracts ? "{not-json}\n" : JSON.stringify({ schemaVersion: 1, contracts: [{ id: "example" }] })
  );

  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.email", "fixture@example.test"]);
  git(root, ["config", "user.name", "Product Truth Fixture"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "fixture"]);
  git(root, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  return root;
}

function fixtureEvidenceCoverage() {
  return {
    classes: {
      source: { status: "verified", recordCount: 1, meaning: "recorded" },
      local: { status: "verified", recordCount: 1, meaning: "recorded" },
      ci: { status: "unknown", recordCount: 0, meaning: "unavailable" },
      hosted: { status: "unknown", recordCount: 0, meaning: "unavailable" },
      provider: { status: "unknown", recordCount: 0, meaning: "unavailable" },
      production: { status: "unknown", recordCount: 0, meaning: "unavailable" },
      human: { status: "unknown", recordCount: 0, meaning: "unavailable" },
      outcome: { status: "unknown", recordCount: 0, meaning: "unavailable" }
    },
    totals: { invalidRecords: 0 },
    sourceLocator: ".cache/development-evidence/"
  };
}

function fixtureDigestInput() {
  return {
    generatedAt: "2026-08-28T22:22:06.605Z",
    git: {
      branch: "feature/example",
      headSha: "a".repeat(40),
      dirty: true,
      mainRef: "origin/main",
      mainSha: "b".repeat(40),
      ahead: 4,
      behind: 2,
      latestReleaseTag: "v2.1.0"
    },
    productionClaims: [
      {
        claimType: "current-production-release",
        version: "v2.0.0",
        evidenceClass: "source",
        sourceLocator: "PROJECT_STATUS.md:5"
      },
      {
        claimType: "operational-runtime",
        version: "v1.5.0",
        evidenceClass: "source",
        sourceLocator: "PROJECT_STATUS.md:20"
      }
    ],
    reachability: [
      { id: "vercel-edge", url: "https://example.test/", status: "unknown", httpStatus: null, reason: "probe disabled" }
    ],
    capabilities: {
      matrixRows: 1,
      stages: { deployed: 0, source: 1, partial: 0, other: 0 },
      surfacingContracts: 1,
      sourceLocator: "docs/FEATURE_MATRIX.md"
    },
    capabilityGate: {
      status: "verified",
      command: "npm run check:capability-surfaces",
      messages: [],
      sourceLocator: "scripts/check-capability-surfacing.mjs"
    },
    evidenceCoverage: fixtureEvidenceCoverage()
  };
}

afterEach(() => {
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("product truth reconciliation", () => {
  test("preserves contradictory production claims with exact locators", () => {
    const claims = collectProductionClaims({
      projectStatusText: [
        "## Current Production Release",
        "- Annotated tag `v2.0.0` is current.",
        "## Operational Health",
        "- Production runtime: `v1.5.0` is live from commit `fixture`."
      ].join("\n"),
      featureMatrixText: "As of this snapshot, recorded production is `v1.5.0`."
    });

    expect(claims.map((claim) => claim.version)).toEqual(["v1.5.0", "v2.0.0", "v1.5.0"]);
    expect(claims.map((claim) => claim.sourceLocator)).toEqual([
      "docs/FEATURE_MATRIX.md:1",
      "PROJECT_STATUS.md:2",
      "PROJECT_STATUS.md:4"
    ]);
  });

  test("emits blocking release drift and nonblocking dirty divergence", () => {
    const digest = reconcileProductTruth(fixtureDigestInput());

    expect(digest.schemaVersion).toBe(PRODUCT_TRUTH_SCHEMA);
    expect(digest.production).toMatchObject({ status: "drift", resolvedRelease: null });
    expect(digest.findings.map((item) => item.id)).toEqual([
      "release.identity.conflict",
      "git.main.diverged",
      "git.working-tree.dirty"
    ]);
    expect(digest.findings[0]).toMatchObject({ status: "drift", severity: "blocking", blocking: true });
    expect(digest.findings[1]).toMatchObject({ status: "attention", blocking: false });
    expect(digest.findings[2].summary).toContain("dirty-worktree evidence");
    expect(digest.ownerDecisions).toHaveLength(3);
  });

  test("sorts findings by severity, category, and stable id", () => {
    const findings = [
      { id: "z", category: "release", severity: "attention" },
      { id: "b", category: "capability", severity: "blocking" },
      { id: "a", category: "capability", severity: "blocking" },
      { id: "u", category: "evidence", severity: "unknown" }
    ];
    expect(sortFindings(findings).map((item) => item.id)).toEqual(["a", "b", "z", "u"]);
  });

  test("renders owner sections in the required order and keeps gate semantics separate", () => {
    const digest = reconcileProductTruth(fixtureDigestInput());
    const text = renderProductTruthText(digest);
    const headings = ["Production", "Candidate", "Evidence coverage", "Drift", "Owner decisions"];
    const offsets = headings.map((heading) => text.indexOf(`\n${heading}\n`));

    expect(offsets.every((offset) => offset >= 0)).toBe(true);
    expect(offsets).toEqual([...offsets].sort((left, right) => left - right));
    expect(productTruthExitCode("status", digest)).toBe(0);
    expect(productTruthExitCode("gate", digest)).toBe(1);
  });
});

describe("product truth command", () => {
  test("status and gate emit the same digest semantics with different exit policy", () => {
    const root = createFixtureRepository();
    const commonArgs = [SCRIPT, "--root", root, "--skip-capability-check", "--json"];
    const status = run(process.execPath, [...commonArgs, "--mode", "status"], root);
    const gate = run(process.execPath, [...commonArgs, "--mode", "gate"], root);

    expect(status.status).toBe(0);
    expect(gate.status).toBe(1);
    const statusDigest = JSON.parse(status.stdout);
    const gateDigest = JSON.parse(gate.stdout);
    expect(statusDigest.production.status).toBe("drift");
    expect(statusDigest.findings.some((item) => item.id === "release.identity.conflict")).toBe(true);
    expect({ ...statusDigest, generatedAt: null }).toEqual({ ...gateDigest, generatedAt: null });
  });

  test("malformed required input exits 2 with the exact locator", () => {
    const root = createFixtureRepository({ malformedContracts: true });
    const result = run(process.execPath, [
      SCRIPT,
      "--root", root,
      "--skip-capability-check",
      "--mode", "status"
    ], root);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/docs\/capability-surfacing-contracts\.json/);
  });

  test("writes snapshots only under the ignored product-truth directory", () => {
    const root = createFixtureRepository();
    const accepted = run(process.execPath, [
      SCRIPT,
      "--root", root,
      "--skip-capability-check",
      "--mode", "status",
      "--snapshot", ".cache/product-truth/fixture.json"
    ], root);
    const rejected = run(process.execPath, [
      SCRIPT,
      "--root", root,
      "--skip-capability-check",
      "--mode", "status",
      "--snapshot", "tracked-digest.json"
    ], root);

    expect(accepted.status).toBe(0);
    const snapshot = JSON.parse(fs.readFileSync(
      path.join(root, ".cache", "product-truth", "fixture.json"),
      "utf8"
    ));
    expect(snapshot.schemaVersion).toBe(PRODUCT_TRUTH_SCHEMA);
    expect(rejected.status).toBe(2);
    expect(rejected.stderr).toMatch(/must stay under \.cache\/product-truth/i);
    expect(fs.existsSync(path.join(root, "tracked-digest.json"))).toBe(false);
  });
});
