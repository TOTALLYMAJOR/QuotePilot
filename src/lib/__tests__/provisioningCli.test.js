import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, test } from "vitest";

const REPO_ROOT = process.cwd();
const SCRIPT_PATH = path.join(REPO_ROOT, "scripts", "provision-customer-order.mjs");
const BASE_ARGS = [
  "--name",
  "CLI Acceptance Events",
  "--organization",
  "cli-acceptance-events",
  "--owner-email",
  "owner@example.test",
  "--plan",
  "starter",
  "--order-id",
  "cli-order-001"
];
const tempDirectories = [];

function runCli(args = [], options = {}) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      APP_BASE_URL: "https://quotepilot.mbmapps.com/app"
    },
    ...options
  });
}

function createTempDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "quotepilot-cli-test-"));
  tempDirectories.push(directory);
  return directory;
}

afterEach(() => {
  tempDirectories.splice(0).forEach((directory) => {
    fs.rmSync(directory, { recursive: true, force: true });
  });
});

describe("customer provisioning preview CLI", () => {
  test("is read-only, draft-labelled, and uses the server feature-plan policy", () => {
    const result = runCli(BASE_ARGS);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("No provider or Firebase writes were attempted.");
    expect(result.stdout).toContain("[DRAFT - DO NOT SEND]");
    expect(result.stdout).toContain("- AI Assist (Suggestions)");
    expect(result.stdout).toContain("Create one specifically named package with a positive price.");
  });

  test("rejects apply, unknown flags, and missing flag values", () => {
    expect(runCli([...BASE_ARGS, "--apply"]).status).toBe(1);

    const unknown = runCli([...BASE_ARGS, "--unknown-option"]);
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain("Unknown argument");

    const missingValue = runCli([
      "--name",
      "CLI Acceptance Events",
      "--organization",
      "--apply"
    ]);
    expect(missingValue.status).toBe(1);
    expect(missingValue.stderr).toContain("--organization requires a value");
  });

  test("requires exact organization and order targets", () => {
    const missingOrganization = runCli(BASE_ARGS.filter((value, index) => {
      return value !== "--organization" && BASE_ARGS[index - 1] !== "--organization";
    }));
    expect(missingOrganization.status).toBe(1);
    expect(missingOrganization.stderr).toContain("--organization");

    const missingOrder = runCli(BASE_ARGS.filter((value, index) => {
      return value !== "--order-id" && BASE_ARGS[index - 1] !== "--order-id";
    }));
    expect(missingOrder.status).toBe(1);
    expect(missingOrder.stderr).toContain("--order-id");
  });

  test("requires the canonical application URL", () => {
    const result = runCli([
      ...BASE_ARGS,
      "--app-url",
      "https://untrusted.example.test/app"
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must exactly match the canonical APP_BASE_URL");
  });

  test("creates draft output once and refuses to overwrite it", () => {
    const directory = createTempDirectory();
    const outputPath = path.join(directory, "owner-handoff.txt");

    const created = runCli([...BASE_ARGS, "--email-out", outputPath]);
    expect(created.status).toBe(0);
    expect(fs.readFileSync(outputPath, "utf8")).toContain("PREVIEW ONLY - DO NOT SEND");

    const existingContent = fs.readFileSync(outputPath, "utf8");
    const rejected = runCli([...BASE_ARGS, "--email-out", outputPath]);
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain("Refusing to overwrite existing draft");
    expect(fs.readFileSync(outputPath, "utf8")).toBe(existingContent);
  });
});
