#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  RELEASE_CANDIDATE_POLICY,
  RELEASE_CANDIDATE_UAT_PROFILE,
  CANDIDATE_REQUIRED_SECRET_METADATA,
  candidateReceiptRelativePath,
  candidateConfirmation,
  parseDotenv,
  requireCandidateTarget,
  requireFullSha,
  requireReleaseBranch,
  reserveCandidateReceipt,
  updateCandidateReceipt,
  validateCandidateBrowserEnvironment,
  validateCandidateCiEvidence,
  validateCandidateFunctionsEnvironment,
  validateFirebaseFunctionsReadback,
  validateFirebaseHostingReadback,
  validateFirebaseReceipt,
  validateFirebaseRulesReadback,
  validateVercelReceipt
} from "./release-candidate-policy.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIREBASE_TOOLS = "firebase-tools@15.24.0";
const FIREBASE_TOOLS_VERSION = "15.24.0";
const VERCEL_CLI = "vercel@57.0.0";
const require = createRequire(import.meta.url);

function readArgs(argv = process.argv.slice(2)) {
  const allowed = new Set(["--target", "--release-sha", "--ci-run-id", "--confirm"]);
  if (argv.length !== allowed.size * 2) {
    throw new Error("Candidate deployment requires target, release SHA, CI run id, and confirmation.");
  }
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(name)) throw new Error(`Unknown argument: ${name || "<blank>"}`);
    if (Object.hasOwn(values, name)) throw new Error(`Duplicate argument: ${name}`);
    if (!value || String(value).startsWith("--")) throw new Error(`${name} requires a value.`);
    values[name] = String(value).trim();
  }
  if (Object.keys(values).length !== allowed.size) {
    throw new Error("Candidate deployment requires all four exact arguments.");
  }
  return values;
}

function capture(command, args, { env = process.env } = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || "Command failed.").trim());
  }
  return String(result.stdout || "").trim();
}

function run(command, args, { env = process.env } = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env,
    stdio: "inherit",
    shell: false
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}.`);
}

function parseJsonOutput(output, label) {
  try {
    return JSON.parse(output);
  } catch {
    const start = output.indexOf("{");
    const end = output.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(output.slice(start, end + 1));
      } catch {
        // Fall through to the provider-safe error below.
      }
    }
    throw new Error(`${label} did not return valid JSON.`);
  }
}

async function fetchJson(url, { token = "", label = "Provider" } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "User-Agent": "QuotePilot-release-candidate"
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`${label} request failed with HTTP ${response.status}.`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function validateWorkspace(releaseSha) {
  const head = requireFullSha(capture("git", ["rev-parse", "HEAD"]), "HEAD");
  if (head !== releaseSha) throw new Error("Release candidate rejected: HEAD does not match --release-sha.");
  const branch = requireReleaseBranch(capture("git", ["branch", "--show-current"]));
  if (capture("git", ["status", "--porcelain", "--untracked-files=all"])) {
    throw new Error("Release candidate rejected: the release worktree must be clean.");
  }
  const remote = capture("git", ["ls-remote", "--heads", "origin", `refs/heads/${branch}`]);
  const [remoteSha, remoteRef, extra] = remote.split(/\s+/);
  if (extra || remoteRef !== `refs/heads/${branch}` || String(remoteSha).toLowerCase() !== releaseSha) {
    throw new Error("Release candidate rejected: origin release branch is missing or not at exact HEAD.");
  }
  return branch;
}

async function verifyCi(ciRunId, releaseSha, branch) {
  if (!/^[1-9][0-9]*$/.test(ciRunId)) {
    throw new Error("Release candidate rejected: CI run id must be a positive integer.");
  }
  const token = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "").trim();
  const headersToken = token;
  const base = `https://api.github.com/repos/${RELEASE_CANDIDATE_POLICY.repository.fullName}`;
  const run = await fetchJson(`${base}/actions/runs/${ciRunId}`, {
    token: headersToken,
    label: "GitHub CI run"
  });
  const jobsResponse = await fetchJson(`${base}/actions/runs/${ciRunId}/jobs?per_page=100`, {
    token: headersToken,
    label: "GitHub CI jobs"
  });
  if (Number(jobsResponse.total_count) > 100) {
    throw new Error("Release candidate rejected: CI job evidence exceeds one complete provider page.");
  }
  return validateCandidateCiEvidence({
    run,
    jobs: jobsResponse.jobs,
    releaseSha,
    branch
  });
}

function readFixedFirebaseWebConfig() {
  const tokenArgs = String(process.env.FIREBASE_TOKEN || "").trim()
    ? ["--token", process.env.FIREBASE_TOKEN]
    : [];
  const output = capture("npx", [
    "--yes",
    FIREBASE_TOOLS,
    "apps:sdkconfig",
    "WEB",
    RELEASE_CANDIDATE_POLICY.firebase.appId,
    "--project",
    RELEASE_CANDIDATE_POLICY.firebase.projectId,
    "--json",
    ...tokenArgs
  ]);
  const response = parseJsonOutput(output, "Firebase Web SDK config");
  if (response?.status !== "success" || !response?.result?.sdkConfig) {
    throw new Error("Release candidate rejected: Firebase did not return the fixed staging Web SDK config.");
  }
  const sdk = response.result.sdkConfig;
  return {
    VITE_FIREBASE_API_KEY: sdk.apiKey,
    VITE_FIREBASE_AUTH_DOMAIN: sdk.authDomain,
    VITE_FIREBASE_PROJECT_ID: sdk.projectId,
    VITE_FIREBASE_STORAGE_BUCKET: sdk.storageBucket,
    VITE_FIREBASE_MESSAGING_SENDER_ID: sdk.messagingSenderId,
    VITE_FIREBASE_APP_ID: sdk.appId
  };
}

function candidateBrowserEnvironment() {
  const providerConfig = readFixedFirebaseWebConfig();
  const fixed = validateCandidateBrowserEnvironment(providerConfig);
  return {
    ...process.env,
    ...providerConfig,
    ...fixed,
    QUOTEPILOT_BUILD_PROFILE: "release-candidate",
    FIREBASE_PROJECT_ID: RELEASE_CANDIDATE_POLICY.firebase.projectId,
    VITE_APP_URL: `${RELEASE_CANDIDATE_POLICY.firebase.hostingUrl}/app`,
    VITE_APP_HOST: new URL(RELEASE_CANDIDATE_POLICY.firebase.hostingUrl).hostname,
    VITE_BASE_DOMAIN: "mbmapps.com",
    VITE_FIREBASE_FUNCTIONS_REGION: "us-central1",
    VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED: "true",
    VITE_PILOT_NOW_ENABLED: "true",
    VITE_PILOT_EVENT_ROOM_ENABLED: "true",
    VITE_PILOT_GUIDED_SELLING_ENABLED: "true",
    VITE_PILOT_CREATE_ENABLED: "true",
    VITE_PILOT_CHANGE_REQUESTS_ENABLED: "true",
    VITE_PILOT_COMMAND_ENABLED: "true",
    VITE_PILOT_MARGINS_ENABLED: "true",
    VITE_PILOT_DECISION_ROOM_ENABLED: "true",
    VITE_AMBIENT_UI_ENABLED: "true",
    VITE_OPERATIONAL_STAFFING_ENABLED: "true",
    VITE_PILOT_MEMORY_ENABLED: "false",
    VITE_PILOT_MODEL_ENABLED: "false",
    VITE_BUYER_ACCESS_ENABLED: "false",
    VITE_BUYER_ACCESS_PUBLIC_CTA_ENABLED: "false",
    VITE_E2E_BYPASS_AUTH: "false",
    VITE_USE_FIREBASE_EMULATORS: "false",
    VITE_ALLOW_LOCAL_CATALOG_FALLBACK: "false",
    VITE_E2E_ALLOW_NON_AUTHORITATIVE_PRICING: "false"
  };
}

function validateFunctionsEnvironmentFile() {
  const projectId = RELEASE_CANDIDATE_POLICY.firebase.projectId;
  const envPath = path.join(ROOT, "functions", `.env.${projectId}`);
  if (!fs.existsSync(envPath)) {
    throw new Error(`Release candidate rejected: missing functions/.env.${projectId}.`);
  }
  const stat = fs.lstatSync(envPath);
  if (
    !stat.isFile()
    || stat.isSymbolicLink()
    || fs.realpathSync(envPath) !== envPath
  ) {
    throw new Error(`Release candidate rejected: functions/.env.${projectId} must be a real regular file.`);
  }
  if ((stat.mode & 0o777) !== 0o600) {
    throw new Error(`Release candidate rejected: functions/.env.${projectId} must have mode 0600.`);
  }
  const ignored = spawnSync("git", ["check-ignore", "--quiet", envPath], {
    cwd: ROOT,
    stdio: "ignore",
    shell: false
  });
  if (ignored.status !== 0) {
    throw new Error(`Release candidate rejected: functions/.env.${projectId} must remain ignored.`);
  }
  return validateCandidateFunctionsEnvironment(parseDotenv(fs.readFileSync(envPath, "utf8")));
}

function writeCandidateManifest(outputDirectory, releaseSha, ciRunId) {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const manifest = {
    schema: "com.mbmapps.quotepilot.release-candidate/v2",
    sourceSha: releaseSha,
    ciRunId: Number(ciRunId),
    uatProfile: RELEASE_CANDIDATE_UAT_PROFILE,
    ambientUiEnabled: true,
    operationalStaffingBrowserEnabled: true,
    operationalStaffingAuthorityEnabled: false
  };
  fs.writeFileSync(
    path.join(outputDirectory, "release-candidate.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { encoding: "utf8", mode: 0o644 }
  );
  return manifest;
}

async function validateHostedManifest(url, expected) {
  const manifest = await fetchJson(`${url}/release-candidate.json?sha=${expected.sourceSha}`, {
    label: "Hosted release candidate manifest"
  });
  if (JSON.stringify(manifest) !== JSON.stringify(expected)) {
    throw new Error("Release candidate rejected: hosted source/authority manifest did not match the exact candidate.");
  }
  return `${url}/release-candidate.json`;
}

function firebaseTokenArgs() {
  return String(process.env.FIREBASE_TOKEN || "").trim()
    ? ["--token", process.env.FIREBASE_TOKEN]
    : [];
}

function locateFirebaseToolsRoot() {
  const candidates = [path.join(ROOT, "node_modules", "firebase-tools")];
  try {
    candidates.push(path.join(capture("npm", ["root", "-g"]), "firebase-tools"));
  } catch {
    // Continue to the exact package downloaded by npx.
  }
  try {
    const npxRoot = path.join(capture("npm", ["config", "get", "cache"]), "_npx");
    if (fs.existsSync(npxRoot)) {
      for (const entry of fs.readdirSync(npxRoot)) {
        candidates.push(path.join(npxRoot, entry, "node_modules", "firebase-tools"));
      }
    }
  } catch {
    // The fixed exact-version validation below remains authoritative.
  }
  for (const candidate of candidates) {
    try {
      const packageRoot = fs.realpathSync(candidate);
      const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
      if (packageJson?.name === "firebase-tools" && packageJson?.version === FIREBASE_TOOLS_VERSION) {
        return packageRoot;
      }
    } catch {
      // Try the next exact package location.
    }
  }
  throw new Error(`Release candidate rejected: firebase-tools ${FIREBASE_TOOLS_VERSION} provider readback client is unavailable.`);
}

async function authenticateFirebaseTools(packageRoot) {
  const firebaseAuth = require(path.join(packageRoot, "lib", "auth.js"));
  const { requireAuth } = require(path.join(packageRoot, "lib", "requireAuth.js"));
  const project = RELEASE_CANDIDATE_POLICY.firebase.projectId;
  const account = firebaseAuth.getGlobalDefaultAccount();
  const authOptions = {
    project,
    ...(String(process.env.FIREBASE_TOKEN || "").trim()
      ? { token: process.env.FIREBASE_TOKEN }
      : account || {})
  };
  await requireAuth(authOptions);
  return project;
}

async function validateFirebaseSecretPrerequisites() {
  const packageRoot = locateFirebaseToolsRoot();
  const secretManager = require(path.join(packageRoot, "lib", "gcp", "secretManager.js"));
  const project = await authenticateFirebaseTools(packageRoot);
  const results = await Promise.all(CANDIDATE_REQUIRED_SECRET_METADATA.map(async (name) => {
    const metadata = await secretManager.getSecretMetadata(project, name, "latest");
    return {
      name,
      available: metadata?.secret?.name === name
        && metadata?.secretVersion?.state === "ENABLED"
    };
  }));
  const missing = results.filter((result) => !result.available).map((result) => result.name);
  if (missing.length) {
    throw new Error(
      `Release candidate rejected: staging Secret Manager prerequisites are missing or have no enabled version: ${missing.join(", ")}. Create non-provider staging placeholders through the separately authorized secret process; this command will not create or access values.`
    );
  }
  return {
    source: "Secret Manager metadata only",
    projectId: project,
    requiredNames: [...CANDIDATE_REQUIRED_SECRET_METADATA]
  };
}

async function readFirebaseHostingAndRules({ providerDeploymentId }) {
  const packageRoot = locateFirebaseToolsRoot();
  const hostingApi = require(path.join(packageRoot, "lib", "hosting", "api.js"));
  const rulesApi = require(path.join(packageRoot, "lib", "gcp", "rules.js"));
  const project = await authenticateFirebaseTools(packageRoot);
  const [channel, releases] = await Promise.all([
    hostingApi.getChannel(project, RELEASE_CANDIDATE_POLICY.firebase.siteId, "live"),
    rulesApi.listAllReleases(project)
  ]);
  const firestoreRelease = releases.find((release) => (
    release?.name === `projects/${project}/releases/cloud.firestore`
  ));
  const files = firestoreRelease
    ? await rulesApi.getRulesetContent(firestoreRelease.rulesetName)
    : [];
  return {
    hosting: validateFirebaseHostingReadback({ channel, providerDeploymentId }),
    firestoreRules: validateFirebaseRulesReadback({
      release: firestoreRelease,
      files,
      localRulesSource: fs.readFileSync(path.join(ROOT, "firestore.rules"), "utf8")
    })
  };
}

function readFirebaseFunctions() {
  const output = capture("npx", [
    "--yes",
    FIREBASE_TOOLS,
    "functions:list",
    "--project",
    RELEASE_CANDIDATE_POLICY.firebase.projectId,
    "--json",
    ...firebaseTokenArgs()
  ]);
  return validateFirebaseFunctionsReadback({
    response: parseJsonOutput(output, "Firebase Functions readback")
  });
}

async function readFirebaseProviderEvidence(providerDeploymentId) {
  const [surfaces, functions] = await Promise.all([
    readFirebaseHostingAndRules({ providerDeploymentId }),
    Promise.resolve().then(() => readFirebaseFunctions())
  ]);
  return { ...surfaces, functions };
}

async function deployFirebase({
  releaseSha,
  ciRunId,
  browserEnv,
  functionsGates,
  secretPrerequisites,
  reservation,
  attempt
}) {
  updateCandidateReceipt(reservation, { status: "preparing" });
  run("npm", ["run", "build"], { env: browserEnv });
  const manifest = writeCandidateManifest(path.join(ROOT, "dist"), releaseSha, ciRunId);
  const originalConfig = JSON.parse(fs.readFileSync(path.join(ROOT, "firebase.json"), "utf8"));
  const appHosting = (Array.isArray(originalConfig.hosting) ? originalConfig.hosting : [originalConfig.hosting])
    .find((entry) => entry?.target === "app");
  if (!appHosting) throw new Error("Release candidate rejected: canonical app Hosting config is missing.");
  const temporaryConfigPath = path.join(ROOT, `.firebase-candidate-${process.pid}.tmp`);
  const temporaryConfig = {
    functions: originalConfig.functions,
    firestore: originalConfig.firestore,
    hosting: { ...appHosting, target: undefined, site: RELEASE_CANDIDATE_POLICY.firebase.siteId }
  };
  fs.writeFileSync(temporaryConfigPath, `${JSON.stringify(temporaryConfig, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx"
  });
  let response;
  try {
    attempt.providerMutationAttempted = true;
    updateCandidateReceipt(reservation, {
      status: "deploying",
      providerMutationAttempted: true,
      providerMutationAttemptedAt: new Date().toISOString()
    });
    const output = capture("npx", [
      "--yes",
      FIREBASE_TOOLS,
      "deploy",
      "--config",
      temporaryConfigPath,
      "--only",
      "hosting,firestore,functions",
      "--project",
      RELEASE_CANDIDATE_POLICY.firebase.projectId,
      "--non-interactive",
      "--message",
      `QuotePilot candidate ${releaseSha}`,
      ...firebaseTokenArgs(),
      "--json"
    ], { env: process.env });
    response = parseJsonOutput(output, "Firebase");
  } finally {
    fs.rmSync(temporaryConfigPath, { force: true });
  }
  const provider = validateFirebaseReceipt({ response, releaseSha });
  updateCandidateReceipt(reservation, {
    status: "provider_succeeded_unverified",
    provider: {
      name: "firebase",
      projectId: RELEASE_CANDIDATE_POLICY.firebase.projectId,
      siteId: RELEASE_CANDIDATE_POLICY.firebase.siteId,
      deploymentId: provider.providerDeploymentId
    }
  });
  const manifestUrl = await validateHostedManifest(RELEASE_CANDIDATE_POLICY.firebase.hostingUrl, manifest);
  const providerSurfaces = await readFirebaseProviderEvidence(provider.providerDeploymentId);
  const functionsTree = capture("git", ["rev-parse", `${releaseSha}:functions`]);
  if (!/^[0-9a-f]{40,64}$/i.test(functionsTree)) {
    throw new Error("Release candidate rejected: exact Functions source tree cannot be resolved.");
  }
  return {
    provider: {
      name: "firebase",
      projectId: RELEASE_CANDIDATE_POLICY.firebase.projectId,
      siteId: RELEASE_CANDIDATE_POLICY.firebase.siteId,
      deploymentId: provider.providerDeploymentId
    },
    sourceShaEvidenceUrl: manifestUrl,
    sourceBindings: {
      functionsGitTree: functionsTree,
      firestoreRulesSha256: providerSurfaces.firestoreRules.sourceSha256
    },
    providerSurfaces,
    secretPrerequisites,
    browserFlags: {
      VITE_AMBIENT_UI_ENABLED: true,
      VITE_OPERATIONAL_STAFFING_ENABLED: true
    },
    serverGates: functionsGates
  };
}

function validateVercelLink() {
  const linkPath = path.join(ROOT, ".vercel", "project.json");
  let link;
  try {
    link = JSON.parse(fs.readFileSync(linkPath, "utf8"));
  } catch {
    throw new Error("Release candidate rejected: run vercel link for the fixed quoteflow project first.");
  }
  for (const [key, expected] of Object.entries(RELEASE_CANDIDATE_POLICY.vercel)) {
    if (String(link[key] || "") !== expected) {
      throw new Error(`Release candidate rejected: Vercel project link has unexpected ${key}.`);
    }
  }
}

async function deployVercel({
  releaseSha,
  ciRunId,
  browserEnv,
  stagingBackendEvidence,
  reservation,
  attempt
}) {
  const token = String(process.env.VERCEL_TOKEN || "").trim();
  const tokenArgs = token ? ["--token", token] : [];
  updateCandidateReceipt(reservation, { status: "preparing" });
  validateVercelLink();
  run("npx", ["--yes", VERCEL_CLI, "pull", "--yes", "--environment=preview", ...tokenArgs]);
  validateVercelLink();
  run("npx", ["--yes", VERCEL_CLI, "build", ...tokenArgs], { env: browserEnv });
  const manifest = writeCandidateManifest(
    path.join(ROOT, ".vercel", "output", "static"),
    releaseSha,
    ciRunId
  );
  attempt.providerMutationAttempted = true;
  updateCandidateReceipt(reservation, {
    status: "deploying",
    providerMutationAttempted: true,
    providerMutationAttemptedAt: new Date().toISOString()
  });
  const output = capture("npx", [
    "--yes",
    VERCEL_CLI,
    "deploy",
    "--prebuilt",
    "--yes",
    "--meta",
    `candidateSha=${releaseSha}`,
    "--meta",
    `candidateCiRunId=${ciRunId}`,
    ...tokenArgs
  ]);
  const deploymentUrl = output.split(/\r?\n/).map((line) => line.trim()).reverse()
    .find((line) => /^https:\/\//i.test(line));
  if (!deploymentUrl) throw new Error("Vercel did not return a deployment URL.");
  updateCandidateReceipt(reservation, {
    status: "provider_succeeded_unverified",
    provider: {
      name: "vercel",
      ...RELEASE_CANDIDATE_POLICY.vercel,
      target: "preview",
      deploymentUrl
    }
  });
  const inspect = parseJsonOutput(capture("npx", [
    "--yes",
    VERCEL_CLI,
    "inspect",
    deploymentUrl,
    "--wait",
    "--timeout",
    "5m",
    "--format=json",
    ...tokenArgs
  ]), "Vercel inspect");
  const provider = validateVercelReceipt({ deployment: inspect, releaseSha });
  updateCandidateReceipt(reservation, {
    status: "provider_succeeded_unverified",
    provider: {
      name: "vercel",
      ...RELEASE_CANDIDATE_POLICY.vercel,
      target: "preview",
      deploymentId: provider.providerDeploymentId,
      deploymentUrl: provider.url
    }
  });
  const manifestUrl = await validateHostedManifest(provider.url, manifest);
  return {
    provider: {
      name: "vercel",
      ...RELEASE_CANDIDATE_POLICY.vercel,
      target: "preview",
      deploymentId: provider.providerDeploymentId,
      deploymentUrl: provider.url
    },
    sourceShaEvidenceUrl: manifestUrl,
    browserFlags: {
      VITE_AMBIENT_UI_ENABLED: true,
      VITE_OPERATIONAL_STAFFING_ENABLED: true
    },
    dependencies: {
      firebaseFunctions: stagingBackendEvidence
    }
  };
}

function receiptProviderIdentity(target) {
  return target === "firebase-all"
    ? {
        name: "firebase",
        projectId: RELEASE_CANDIDATE_POLICY.firebase.projectId,
        siteId: RELEASE_CANDIDATE_POLICY.firebase.siteId
      }
    : {
        name: "vercel",
        ...RELEASE_CANDIDATE_POLICY.vercel,
        target: "preview"
      };
}

function sanitizedFailure(error) {
  let message = String(error?.message || error || "Unknown candidate deployment failure.");
  for (const value of [
    process.env.FIREBASE_TOKEN,
    process.env.VERCEL_TOKEN,
    process.env.GITHUB_TOKEN,
    process.env.GH_TOKEN
  ]) {
    const secret = String(value || "");
    if (secret) message = message.split(secret).join("[redacted]");
  }
  return {
    name: String(error?.name || "Error"),
    message: message.slice(0, 4000)
  };
}

async function main() {
  let reservation;
  const attempt = { providerMutationAttempted: false };
  try {
    const args = readArgs();
    const target = requireCandidateTarget(args["--target"]);
    const releaseSha = requireFullSha(args["--release-sha"]);
    const expectedConfirmation = candidateConfirmation(target, releaseSha);
    if (args["--confirm"] !== expectedConfirmation) {
      throw new Error(`Candidate deployment requires --confirm "${expectedConfirmation}".`);
    }
    const branch = validateWorkspace(releaseSha);
    const ciEvidence = await verifyCi(args["--ci-run-id"], releaseSha, branch);
    const browserEnv = candidateBrowserEnvironment();
    const functionsGates = target === "firebase-all"
      ? validateFunctionsEnvironmentFile()
      : undefined;
    const secretPrerequisites = target === "firebase-all"
      ? await validateFirebaseSecretPrerequisites()
      : undefined;
    const stagingBackendEvidence = target === "vercel-preview"
      ? readFirebaseFunctions()
      : undefined;
    if (target === "vercel-preview") validateVercelLink();
    reservation = reserveCandidateReceipt({
      root: ROOT,
      target,
      releaseSha,
      ci: ciEvidence,
      provider: receiptProviderIdentity(target)
    });
    const context = {
      releaseSha,
      ciRunId: args["--ci-run-id"],
      browserEnv,
      functionsGates,
      secretPrerequisites,
      stagingBackendEvidence,
      reservation,
      attempt
    };
    const evidence = target === "firebase-all"
      ? await deployFirebase(context)
      : await deployVercel(context);
    updateCandidateReceipt(reservation, {
      status: "verified",
      providerMutationCompleted: true,
      verifiedAt: new Date().toISOString(),
      ...evidence
    });
    const receiptPath = candidateReceiptRelativePath(ROOT, reservation);
    process.stdout.write(`Candidate deployed without production promotion. Receipt: ${receiptPath}\n`);
  } catch (error) {
    if (reservation) {
      try {
        updateCandidateReceipt(reservation, {
          status: attempt.providerMutationAttempted ? "partial" : "failed",
          providerMutationAttempted: attempt.providerMutationAttempted,
          failedAt: new Date().toISOString(),
          failure: sanitizedFailure(error)
        });
        error.message = `${error.message} Receipt: ${candidateReceiptRelativePath(ROOT, reservation)}.`;
      } catch (receiptError) {
        error.message = `${error.message} Receipt journal update also failed: ${sanitizedFailure(receiptError).message}`;
      }
    }
    throw error;
  }
}

await main();
