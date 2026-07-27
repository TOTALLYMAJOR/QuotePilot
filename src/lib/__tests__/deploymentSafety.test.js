import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, test } from "vitest";

const PRIMARY_DEPLOY_SCRIPT = path.resolve(
  process.cwd(),
  "scripts/deploy-firebase-production.mjs"
);
const CUSTOMER_DEPLOY_SCRIPT = path.resolve(
  process.cwd(),
  "scripts/deploy-hosting-customer.mjs"
);
const VERCEL_DEPLOY_SCRIPT = path.resolve(
  process.cwd(),
  "scripts/deploy-vercel-production.mjs"
);
const tempDirs = [];

function makeVercelDeployFixture(projectLink) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "quotepilot-vercel-deploy-"));
  tempDirs.push(root);
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.copyFileSync(
    VERCEL_DEPLOY_SCRIPT,
    path.join(root, "scripts", "deploy-vercel-production.mjs")
  );
  if (projectLink) {
    fs.mkdirSync(path.join(root, ".vercel"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".vercel", "project.json"),
      JSON.stringify(projectLink)
    );
  }
  return path.join(root, "scripts", "deploy-vercel-production.mjs");
}

afterEach(() => {
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("production deployment command safety", { timeout: 30_000 }, () => {
  test("rejects undeclared force flags before any deployment work", () => {
    const result = spawnSync(process.execPath, [
      PRIMARY_DEPLOY_SCRIPT,
      "--scope",
      "all",
      "--confirm",
      "DEPLOY tonicatering hosting:app,firestore,functions",
      "--force"
    ], {
      cwd: process.cwd(),
      encoding: "utf8"
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/unknown argument: --force/i);
  });

  test("rejects the primary Firebase site as a customer-site target", () => {
    const result = spawnSync(process.execPath, [
      CUSTOMER_DEPLOY_SCRIPT,
      "--site",
      "tonicatering",
      "--project",
      "tonicatering",
      "--confirm",
      "DEPLOY tonicatering hosting:tonicatering"
    ], {
      cwd: process.cwd(),
      encoding: "utf8"
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).toMatch(/usage:/i);
    expect(result.stdout).not.toMatch(/vite build/i);
  });

  test("requires the exact production-domain confirmation for Vercel", () => {
    const result = spawnSync(process.execPath, [
      VERCEL_DEPLOY_SCRIPT,
      "--confirm",
      "DEPLOY another-domain.example via vercel"
    ], {
      cwd: process.cwd(),
      encoding: "utf8"
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      'DEPLOY quotepilot.mbmapps.com via vercel'
    );
  });

  test("rejects a missing Vercel project link before repository checks", () => {
    const result = spawnSync(process.execPath, [
      makeVercelDeployFixture(null),
      "--confirm",
      "DEPLOY quotepilot.mbmapps.com via vercel"
    ], {
      encoding: "utf8"
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/approved \.vercel\/project\.json link/i);
  });

  test("rejects a relinked Vercel project before repository checks", () => {
    const result = spawnSync(process.execPath, [
      makeVercelDeployFixture({
        projectId: "prj_wrong",
        orgId: "team_wrong",
        projectName: "wrong-project"
      }),
      "--confirm",
      "DEPLOY quotepilot.mbmapps.com via vercel"
    ], {
      encoding: "utf8"
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/unapproved project link/i);
    expect(result.stderr).toMatch(/projectId, orgId, projectName/i);
  });
});
