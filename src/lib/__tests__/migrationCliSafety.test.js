import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

const SCRIPT_PATH = path.resolve(
  process.cwd(),
  "scripts/migrate-to-multi-tenant.mjs"
);

function runMigration(args = []) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      GCLOUD_PROJECT: "",
      FIREBASE_PROJECT_ID: "",
      VITE_FIREBASE_PROJECT_ID: "",
      FIREBASE_ORGANIZATION_ID: ""
    }
  });
}

describe("multi-tenant migration CLI safety", () => {
  test("requires explicit project and organization scope", () => {
    const result = runMigration([]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Missing Firebase project id");
  });

  test("requires an exact confirmation token before apply mode", () => {
    const result = runMigration([
      "--project",
      "demo-safe",
      "--organization",
      "safe-org",
      "--apply"
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'Apply requires --confirm "MIGRATE demo-safe safe-org"'
    );
    expect(result.stderr).toContain("The default mode is read-only");
  });

  test("rejects conflicting migration modes", () => {
    const result = runMigration([
      "--project",
      "demo-safe",
      "--organization",
      "safe-org",
      "--apply",
      "--dry-run"
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Choose exactly one migration mode: --dry-run or --apply"
    );
  });

  test("refuses to overwrite an existing evidence file", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "quotepilot-migration-"));
    const evidencePath = path.join(tempDir, "evidence.json");
    fs.writeFileSync(evidencePath, "owner evidence\n", "utf8");

    try {
      const result = runMigration([
        "--project",
        "demo-safe",
        "--organization",
        "safe-org",
        "--evidence-out",
        evidencePath
      ]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Refusing to overwrite it");
      expect(fs.readFileSync(evidencePath, "utf8")).toBe("owner evidence\n");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
