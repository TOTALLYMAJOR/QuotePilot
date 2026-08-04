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
const RELEASE_EVIDENCE_SCRIPT = path.resolve(
  process.cwd(),
  "scripts/production-release-evidence.mjs"
);
const RELEASE_SHA = "a".repeat(40);
const ROLLBACK_SHA = "b".repeat(40);
const EXPECTED_VERCEL_LINK = {
  projectId: "prj_epLi14LmBItwYkv25XZoAkWZf4Jk",
  orgId: "team_AW2QNNgYt5vESEO3eOTJXHp1",
  projectName: "quoteflow"
};
const tempDirs = [];

function makeVercelDeployFixture(projectLink) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "quotepilot-vercel-deploy-"));
  tempDirs.push(root);
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.copyFileSync(
    VERCEL_DEPLOY_SCRIPT,
    path.join(root, "scripts", "deploy-vercel-production.mjs")
  );
  fs.copyFileSync(
    RELEASE_EVIDENCE_SCRIPT,
    path.join(root, "scripts", "production-release-evidence.mjs")
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

function writeExecutable(filePath, source) {
  fs.writeFileSync(filePath, source, { mode: 0o755 });
  fs.chmodSync(filePath, 0o755);
}

function makeVercelCommandGuardFixture() {
  const script = makeVercelDeployFixture(EXPECTED_VERCEL_LINK);
  const root = path.dirname(path.dirname(script));
  const bin = path.join(root, "bin");
  const providerSentinel = path.join(root, "provider-command-called.txt");
  fs.mkdirSync(bin, { recursive: true });

  writeExecutable(path.join(bin, "git"), `#!/usr/bin/env node
const command = process.argv.slice(2).join("\\u0000");
if (command === "status\\u0000--porcelain") process.exit(0);
if (command === "branch\\u0000--show-current") {
  process.stdout.write("main\\n");
  process.exit(0);
}
if (command === "rev-parse\\u0000HEAD") {
  process.stdout.write("${RELEASE_SHA}\\n");
  process.exit(0);
}
process.stderr.write("unexpected git command: " + command + "\\n");
process.exit(70);
`);

  const providerStub = `#!/usr/bin/env node
require("node:fs").writeFileSync(${JSON.stringify(providerSentinel)}, process.argv.join(" "));
process.exit(71);
`;
  writeExecutable(path.join(bin, "npm"), providerStub);
  writeExecutable(path.join(bin, "npx"), providerStub);

  return { script, bin, providerSentinel };
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

  test("rejects duplicate Firebase deployment arguments", () => {
    const result = spawnSync(process.execPath, [
      PRIMARY_DEPLOY_SCRIPT,
      "--scope",
      "hosting",
      "--scope",
      "hosting"
    ], {
      cwd: process.cwd(),
      encoding: "utf8"
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/duplicate argument: --scope/i);
  });

  test("rejects the legacy functions-only Firebase scope name", () => {
    const result = spawnSync(process.execPath, [
      PRIMARY_DEPLOY_SCRIPT,
      "--scope",
      "functions",
      "--confirm",
      "DEPLOY tonicatering firestore,functions"
    ], {
      cwd: process.cwd(),
      encoding: "utf8"
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/--scope must be one of: hosting, backend, all/i);
  });

  test("binds the backend scope to Firestore rules plus Functions", () => {
    const result = spawnSync(process.execPath, [
      PRIMARY_DEPLOY_SCRIPT,
      "--scope",
      "backend",
      "--confirm",
      "DEPLOY tonicatering functions"
    ], {
      cwd: process.cwd(),
      encoding: "utf8"
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      'Production deployment requires --confirm "DEPLOY tonicatering firestore,functions".'
    );
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

  test("rejects duplicate Vercel deployment arguments", () => {
    const result = spawnSync(process.execPath, [
      makeVercelDeployFixture(null),
      "--confirm",
      "DEPLOY quotepilot.mbmapps.com via vercel",
      "--confirm",
      "DEPLOY quotepilot.mbmapps.com via vercel"
    ], {
      encoding: "utf8"
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/duplicate argument: --confirm/i);
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

  test.each([
    [
      "a non-dispatch process",
      {
        GITHUB_ACTIONS: "false",
        GITHUB_EVENT_NAME: "",
        GITHUB_REF: "",
        GITHUB_SHA: ""
      },
      /anything other than main|outside an exact main workflow dispatch/i
    ],
    [
      "a dispatch whose GitHub SHA differs from HEAD",
      {
        GITHUB_ACTIONS: "true",
        GITHUB_EVENT_NAME: "workflow_dispatch",
        GITHUB_REF: "refs\/heads\/main",
        GITHUB_SHA: "c".repeat(40)
      },
      /GITHUB_SHA does not match HEAD/i
    ]
  ])("fails closed for %s before provider execution", (_label, githubEnv, expected) => {
    const { script, bin, providerSentinel } = makeVercelCommandGuardFixture();
    const result = spawnSync(process.execPath, [
      script,
      "--confirm",
      "DEPLOY quotepilot.mbmapps.com via vercel",
      "--release-sha",
      RELEASE_SHA,
      "--ci-run-id",
      "101",
      "--uat-run-id",
      "202",
      "--rollback-sha",
      ROLLBACK_SHA
    ], {
      encoding: "utf8",
      env: {
        ...process.env,
        ...githubEnv,
        PATH: `${bin}${path.delimiter}${process.env.PATH || ""}`
      }
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(expected);
    expect(fs.existsSync(providerSentinel)).toBe(false);
  });
});
