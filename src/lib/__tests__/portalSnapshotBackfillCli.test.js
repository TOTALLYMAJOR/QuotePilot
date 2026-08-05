import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  parsePortalBackfillArgs,
  runPortalSnapshotBackfill
} from "../../../scripts/backfill-portal-snapshots.mjs";

describe("portal snapshot backfill CLI safety", () => {
  test("requires explicit project and organization scope", () => {
    expect(() => parsePortalBackfillArgs([])).toThrow("Missing --project");
    expect(() => parsePortalBackfillArgs(["--project", "demo-safe"]))
      .toThrow("Missing --organization");
  });

  test("requires exact confirmation and evidence destination before apply", () => {
    expect(() => parsePortalBackfillArgs([
      "--project", "demo-safe", "--organization", "org-a", "--apply"
    ])).toThrow(
      'Apply requires --confirm "BACKFILL PORTALS demo-safe org-a"'
    );

    expect(() => parsePortalBackfillArgs([
      "--project", "demo-safe",
      "--organization", "org-a",
      "--apply",
      "--confirm", "BACKFILL PORTALS demo-safe org-a"
    ])).toThrow("Apply requires --evidence-out");
  });

  test("rejects conflicting modes and unknown flags", () => {
    expect(() => parsePortalBackfillArgs([
      "--project", "demo-safe", "--organization", "org-a", "--apply", "--dry-run"
    ])).toThrow("Choose exactly one mode");

    expect(() => parsePortalBackfillArgs([
      "--project", "demo-safe", "--organization", "org-a", "--force"
    ])).toThrow("Unknown argument: --force");
  });

  test("rejects scope values that could alter Firestore paths", () => {
    expect(() => parsePortalBackfillArgs([
      "--project", "demo-safe", "--organization", "org-a/quotes"
    ])).toThrow("single Firestore-safe identifier");
    expect(() => parsePortalBackfillArgs([
      "--project", "demo safe", "--organization", "org-a"
    ])).toThrow("single Firestore-safe identifier");
  });

  test("refuses an existing evidence file before attempting credentials", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "quotepilot-portal-backfill-"));
    const evidencePath = path.join(tempDir, "evidence.json");
    fs.writeFileSync(evidencePath, "owner evidence\n", "utf8");
    try {
      const options = parsePortalBackfillArgs([
        "--project", "demo-safe",
        "--organization", "org-a",
        "--evidence-out", evidencePath
      ]);
      await expect(runPortalSnapshotBackfill(options)).rejects.toThrow("Refusing to overwrite it");
      expect(fs.readFileSync(evidencePath, "utf8")).toBe("owner evidence\n");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
