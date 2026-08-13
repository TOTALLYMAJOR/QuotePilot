import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const root = process.cwd();

describe("Stripe Connect staging infrastructure source", () => {
  test("passes the exact secret-free and apply-disabled infrastructure policy", () => {
    expect(() => execFileSync(process.execPath, [
      path.resolve(root, "scripts/check-stripe-connect-infra.mjs")
    ], {
      cwd: root,
      encoding: "utf8",
      stdio: "pipe"
    })).not.toThrow();
  });

  test("keeps browser clients denied and isolates the Firebase deployment selector", () => {
    const rules = fs.readFileSync(
      path.resolve(root, "firestore.connect-control.rules"),
      "utf8"
    );
    const config = JSON.parse(fs.readFileSync(
      path.resolve(root, "firebase.connect.staging.json"),
      "utf8"
    ));

    expect(rules).toContain("allow read, write: if false;");
    expect(config.functions).toEqual([
      expect.objectContaining({ codebase: "connect", source: "functions-connect" })
    ]);
    expect(config.firestore).toEqual([
      expect.objectContaining({ database: "connect-control" })
    ]);
    expect(config).not.toHaveProperty("hosting");
  });

  test("admits no secret values, production root, or Terraform apply workflow", () => {
    const policy = fs.readFileSync(
      path.resolve(root, "scripts/check-stripe-connect-infra.mjs"),
      "utf8"
    );
    const workflow = fs.readFileSync(
      path.resolve(root, ".github/workflows/stripe-connect-infra-validation.yml"),
      "utf8"
    );

    expect(policy).toContain("google_secret_manager_secret_version");
    expect(policy).toContain("production infrastructure must remain absent");
    expect(workflow).not.toMatch(/terraform\s+apply/);
    expect(workflow).not.toMatch(/id-token:\s*write/);
  });
});
