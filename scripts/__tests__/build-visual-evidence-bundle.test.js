import { afterEach, describe, expect, test } from "vitest";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildVisualEvidenceBundle } from "../build-visual-evidence-bundle.mjs";

const fixtures = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "quotepilot-visual-evidence-"));
  fixtures.push(root);
  return root;
}

function write(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

function initializeGit(root) {
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "visual-evidence@example.test"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Visual Evidence Test"], { cwd: root });
  write(root, "README.md", "fixture\n");
  execFileSync("git", ["add", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-m", "fixture"], { cwd: root, stdio: "ignore" });
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
}

describe("visual evidence bundle", () => {
  test("retains screenshot bytes, hashes, stages, and Playwright stats", () => {
    const root = makeFixture();
    const checkoutSha = initializeGit(root);
    const beforeBody = Buffer.from("before-image");
    const currentBody = Buffer.from("current-image");
    write(root, "output/playwright/action-feedback/390-before-save.png", beforeBody);
    write(root, "test-results/current/surface-current-390.png", currentBody);
    write(root, ".cache/playwright-evidence/results.json", JSON.stringify({
      stats: { expected: 7, skipped: 1, unexpected: 0, flaky: 0, duration: 1234 }
    }));

    const result = buildVisualEvidenceBundle({
      repositoryRoot: root,
      requireScreenshots: true,
      playwrightJson: ".cache/playwright-evidence/results.json",
      validations: ["Visual proof cohort::npm run test:e2e:visual-evidence::passed"],
      env: {
        GITHUB_ACTIONS: "true",
        GITHUB_SHA: checkoutSha,
        GITHUB_REPOSITORY: "TOTALLYMAJOR/QuotePilot",
        GITHUB_RUN_ID: "42",
        GITHUB_RUN_ATTEMPT: "1"
      },
      now: new Date("2026-09-19T01:00:00.000Z")
    });

    expect(result.manifest.evidenceClass).toBe("ci");
    expect(result.manifest.evidenceSha).toBe(checkoutSha);
    expect(result.manifest.checkoutSha).toBe(checkoutSha);
    expect(result.manifest.screenshotCount).toBe(2);
    expect(result.manifest.playwright.stats.expected).toBe(7);
    expect(result.manifest.captures.map(({ stage }) => stage)).toEqual(["before", "current"]);
    expect(result.manifest.captures[0].sha256).toBe(
      crypto.createHash("sha256").update(beforeBody).digest("hex")
    );
    expect(fs.existsSync(path.join(result.output, "manifest.sha256"))).toBe(true);
    expect(fs.existsSync(path.join(result.output, "attachments/playwright-results.json"))).toBe(true);
  });

  test("fails closed when a qualifying run produces no screenshots", () => {
    const root = makeFixture();
    expect(() => buildVisualEvidenceBundle({
      repositoryRoot: root,
      requireScreenshots: true,
      env: { GITHUB_SHA: "abc123" }
    })).toThrow(/No screenshot evidence found/);
  });
});
