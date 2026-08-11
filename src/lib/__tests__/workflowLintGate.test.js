import fs from "node:fs";
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

  test("keeps owner SMS acceptance inside the Firebase authorization lane", () => {
    expect(packageJson.scripts["test:owner-sms:emulator"]).toContain(
      "scripts/owner-sms-emulator-acceptance.mjs"
    );
    const firebaseLane = laneSource.slice(
      laneSource.indexOf("  lane:firebase-auth-rules)"),
      laneSource.indexOf("  lane:authoritative-pricing)")
    );
    expect(firebaseLane).toContain("npm run test:rules:firestore");
    expect(firebaseLane).toContain("npm run test:owner-sms:emulator");
    expect(firebaseLane).toContain("npm run test:e2e:firebase");
  });
});
