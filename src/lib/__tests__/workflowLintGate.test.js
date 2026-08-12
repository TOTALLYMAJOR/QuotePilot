import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";
import {
  ACTIONLINT_ARGUMENTS,
  ACTIONLINT_ASSETS,
  ACTIONLINT_RELEASE_COMMIT,
  ACTIONLINT_VERSION,
  resolveActionlintAsset
} from "../../../scripts/check-github-workflows.mjs";

const packageJson = JSON.parse(
  fs.readFileSync(new URL("../../../package.json", import.meta.url), "utf8")
);
const laneSource = fs.readFileSync(
  new URL("../../../scripts/orchestration-lanes.sh", import.meta.url),
  "utf8"
);
const checkerSource = fs.readFileSync(
  new URL("../../../scripts/check-github-workflows.mjs", import.meta.url),
  "utf8"
);
const mainlineSafetyNetSource = fs.readFileSync(
  new URL("../../../.github/workflows/mainline-safety-net.yml", import.meta.url),
  "utf8"
);

function runGit(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

describe("reproducible GitHub workflow lint gate", () => {
  test("pins the official actionlint release and supported archive digests", () => {
    expect(ACTIONLINT_VERSION).toBe("1.7.12");
    expect(ACTIONLINT_RELEASE_COMMIT).toBe("914e7df21a07ef503a81201c76d2b11c789d3fca");
    expect(ACTIONLINT_ASSETS).toEqual({
      "linux:x64": {
        archive: "actionlint_1.7.12_linux_amd64.tar.gz",
        sha256: "8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8"
      },
      "linux:arm64": {
        archive: "actionlint_1.7.12_linux_arm64.tar.gz",
        sha256: "325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6"
      },
      "darwin:x64": {
        archive: "actionlint_1.7.12_darwin_amd64.tar.gz",
        sha256: "5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644"
      },
      "darwin:arm64": {
        archive: "actionlint_1.7.12_darwin_arm64.tar.gz",
        sha256: "aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f"
      }
    });
    expect(resolveActionlintAsset("linux", "x64")).toBe(ACTIONLINT_ASSETS["linux:x64"]);
    expect(() => resolveActionlintAsset("win32", "x64")).toThrow(/unsupported actionlint platform/i);
  });

  test("runs deterministic built-in checks without host tool integrations", () => {
    expect(ACTIONLINT_ARGUMENTS).toEqual([
      "-no-color",
      "-shellcheck=",
      "-pyflakes=",
      "-verbose"
    ]);
    expect(checkerSource).toContain("releases/download/v${ACTIONLINT_VERSION}");
    expect(checkerSource).not.toMatch(/releases\/latest|ACTIONLINT_(?:URL|SHA|BIN)/);
  });

  test("keeps workflow lint inside the existing required quick lane", () => {
    expect(packageJson.scripts["check:workflows"]).toBe(
      "node ./scripts/check-github-workflows.mjs"
    );
    const quickLane = laneSource.slice(
      laneSource.indexOf("  lane:quick)"),
      laneSource.indexOf("  lane:core)")
    );
    expect(quickLane).toContain("npm run check:workflows");
  });

  test("checks the staged revert and opens a protected-main recovery PR", () => {
    expect(mainlineSafetyNetSource).toContain('git revert --no-commit "${FAILED_SHA}"');
    expect(mainlineSafetyNetSource).toContain(
      "if git diff --quiet && git diff --cached --quiet; then"
    );
    expect(mainlineSafetyNetSource).toContain("git diff --cached --check");
    expect(mainlineSafetyNetSource).toContain(
      'git commit -m "chore(main-guard): auto-revert ${FAILED_SHA} after CI Quality failure"'
    );
    expect(mainlineSafetyNetSource).toContain("pull-requests: write");
    expect(mainlineSafetyNetSource).toContain("actions: write");
    expect(mainlineSafetyNetSource).toContain('git push origin "HEAD:refs/heads/${recovery_branch}"');
    expect(mainlineSafetyNetSource).toContain("gh pr create");
    expect(mainlineSafetyNetSource).toContain(
      'gh workflow run ci-quality.yml --ref "${RECOVERY_BRANCH}"'
    );
    expect(mainlineSafetyNetSource).not.toContain("git push origin HEAD:main");
  });

  test("a no-commit revert is staged-only and remains detectable through the index", () => {
    const repository = fs.mkdtempSync(path.join(os.tmpdir(), "quotepilot-main-guard-"));

    try {
      runGit(repository, ["init", "--quiet"]);
      runGit(repository, ["config", "user.name", "QuotePilot test"]);
      runGit(repository, ["config", "user.email", "quotepilot-test@example.invalid"]);
      fs.writeFileSync(path.join(repository, "guard.txt"), "healthy\n");
      runGit(repository, ["add", "guard.txt"]);
      runGit(repository, ["commit", "--quiet", "-m", "healthy baseline"]);

      fs.writeFileSync(path.join(repository, "guard.txt"), "failing\n");
      runGit(repository, ["add", "guard.txt"]);
      runGit(repository, ["commit", "--quiet", "-m", "failing change"]);
      runGit(repository, ["revert", "--no-commit", "HEAD"]);

      const worktreeDiff = spawnSync("git", ["diff", "--quiet"], { cwd: repository });
      const stagedDiff = spawnSync("git", ["diff", "--cached", "--quiet"], { cwd: repository });

      expect(worktreeDiff.status).toBe(0);
      expect(stagedDiff.status).toBe(1);
      expect(runGit(repository, ["diff", "--cached", "--", "guard.txt"])).toContain("+healthy");
    } finally {
      fs.rmSync(repository, { recursive: true, force: true });
    }
  });
});
