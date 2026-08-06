import { describe, expect, test } from "vitest";
import { parseSeedArgs } from "../../../scripts/seed-firestore-menu.mjs";

const scope = [
  "--project",
  "demo-seed-project",
  "--organization",
  "safe-tenant"
];

describe("Firestore tenant seed command safety", () => {
  test("defaults to a read-only dry run for an explicit scope", () => {
    expect(parseSeedArgs(scope)).toMatchObject({
      projectId: "demo-seed-project",
      organizationId: "safe-tenant",
      dryRun: true,
      apply: false
    });
  });

  test("requires explicit project and organization scope", () => {
    expect(() => parseSeedArgs([
      "--organization",
      "safe-tenant"
    ])).toThrow(/missing project id/i);
    expect(() => parseSeedArgs([
      "--project",
      "demo-seed-project"
    ])).toThrow(/missing organization id/i);
    expect(() => parseSeedArgs([
      "--project",
      "",
      "--organization",
      "safe-tenant"
    ])).toThrow(/requires a value/i);
  });

  test("rejects unknown, duplicate, and conflicting arguments", () => {
    expect(() => parseSeedArgs([
      ...scope,
      "--force"
    ])).toThrow(/unknown argument: --force/i);
    expect(() => parseSeedArgs([
      ...scope,
      "--org",
      "another-tenant"
    ])).toThrow(/duplicate argument: --organization/i);
    expect(() => parseSeedArgs([
      ...scope,
      "--dry-run",
      "--apply"
    ])).toThrow(/exactly one seed mode/i);
  });

  test("requires the exact project-and-tenant confirmation for apply", () => {
    expect(() => parseSeedArgs([
      ...scope,
      "--apply"
    ])).toThrow(
      'Apply requires --confirm "SEED demo-seed-project safe-tenant"'
    );
    expect(() => parseSeedArgs([
      ...scope,
      "--apply",
      "--confirm",
      "SEED another-project safe-tenant"
    ])).toThrow(
      'Apply requires --confirm "SEED demo-seed-project safe-tenant"'
    );
    expect(parseSeedArgs([
      ...scope,
      "--apply",
      "--confirm",
      "SEED demo-seed-project safe-tenant"
    ])).toMatchObject({
      dryRun: false,
      apply: true,
      expectedConfirmation: "SEED demo-seed-project safe-tenant"
    });
  });

  test("does not accept a confirmation token in dry-run mode", () => {
    expect(() => parseSeedArgs([
      ...scope,
      "--confirm",
      "SEED demo-seed-project safe-tenant"
    ])).toThrow(/only with --apply/i);
  });

  test("accepts an exact versioned starter pack and keeps dry-run as the default", () => {
    expect(parseSeedArgs([
      ...scope,
      "--pack",
      "wedding-events",
      "--pack-version",
      "1"
    ])).toMatchObject({
      dryRun: true,
      packId: "wedding-events",
      packVersion: 1,
      replaceStagedPack: false
    });
  });

  test("requires pack scope for version and replacement flags", () => {
    expect(() => parseSeedArgs([
      ...scope,
      "--pack-version",
      "1"
    ])).toThrow(/requires --pack/i);
    expect(() => parseSeedArgs([
      ...scope,
      "--replace-staged-pack"
    ])).toThrow(/requires --pack/i);
  });
});
