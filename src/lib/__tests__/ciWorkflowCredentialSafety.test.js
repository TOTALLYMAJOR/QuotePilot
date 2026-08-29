import fs from "node:fs";
import { describe, expect, test } from "vitest";

const workflowSource = fs.readFileSync(
  new URL("../../../.github/workflows/ci-quality.yml", import.meta.url),
  "utf8"
);
const checkoutReferencePattern = /^\s*uses:\s*["']?actions\/checkout@[^\s"'#]+["']?(?:\s*#.*)?$/gim;

function extractCheckoutStepBlocks(source) {
  return source
    .split(/\n(?= {6}- )/)
    .filter((block) => {
      checkoutReferencePattern.lastIndex = 0;
      return checkoutReferencePattern.test(block);
    });
}

function countCheckoutReferences(source) {
  checkoutReferencePattern.lastIndex = 0;
  return Array.from(source.matchAll(checkoutReferencePattern)).length;
}

function hasNestedPermissions(source) {
  const jobsIndex = source.indexOf("\njobs:");
  if (jobsIndex < 0) return false;
  return /^\s+permissions\s*:/m.test(source.slice(jobsIndex + 1));
}

describe("CI workflow credential safety", () => {
  test("grants only read access to repository contents", () => {
    const workflowHeader = workflowSource.slice(0, workflowSource.indexOf("\njobs:"));
    const permissions = workflowHeader.match(/^permissions:\n((?: {2}[^\n]+\n?)+)/m);

    expect(permissions).not.toBeNull();
    expect(
      permissions[1]
        .trim()
        .split(/\r?\n/)
        .map((line) => line.trim())
    ).toEqual(["contents: read"]);

    expect(hasNestedPermissions(workflowSource)).toBe(false);
  });

  test("does not persist the GitHub token in any checkout", () => {
    const checkoutSteps = extractCheckoutStepBlocks(workflowSource);
    const checkoutReferences = countCheckoutReferences(workflowSource);

    expect(checkoutReferences).toBeGreaterThan(0);
    expect(checkoutSteps).toHaveLength(checkoutReferences);
    for (const checkoutStep of checkoutSteps) {
      expect(checkoutStep).toMatch(/\n\s+with:\n/);
      expect(checkoutStep).toMatch(/\n\s+persist-credentials:\s+false\s*(?:\n|$)/);
    }
  });

  test("detects quoted mixed-case checkout references", () => {
    const fixture = [
      "jobs:",
      "  fixture:",
      "    steps:",
      "      - name: Checkout variant",
      "        uses: \"Actions/Checkout@0123456789abcdef\""
    ].join("\n");

    expect(countCheckoutReferences(fixture)).toBe(1);
    expect(extractCheckoutStepBlocks(fixture)).toHaveLength(1);
    expect(extractCheckoutStepBlocks(fixture)[0]).not.toMatch(/persist-credentials:\s+false/i);
  });

  test("detects differently indented job-level permission overrides", () => {
    const fixture = [
      "name: Unsafe override",
      "permissions:",
      "  contents: read",
      "jobs:",
      "    build:",
      "      permissions:",
      "        contents: write",
      "      runs-on: ubuntu-latest"
    ].join("\n");

    expect(hasNestedPermissions(fixture)).toBe(true);
  });
});
