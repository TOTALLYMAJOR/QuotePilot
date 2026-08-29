#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { GoogleAuth } from "google-auth-library";
import { prepareFirebaseToolsBinary } from "./firebase-tools-binary.mjs";
import {
  RELEASE_CANDIDATE_POLICY,
  CANDIDATE_REQUIRED_SECRET_METADATA,
  candidateFunctionsRuntimeExpected,
  candidateReceiptRelativePath,
  candidateConfirmation,
  parseDotenv,
  requireCandidateTarget,
  requireCandidateUatProfile,
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
const VERCEL_API = "https://api.vercel.com";
const VERCEL_DEPLOYMENT_TIMEOUT_MS = 5 * 60 * 1000;

function readArgs(argv = process.argv.slice(2)) {
  const allowed = new Set([
    "--target",
    "--release-sha",
    "--ci-run-id",
    "--candidate-profile",
    "--confirm"
  ]);
  if (argv.length !== allowed.size * 2) {
    throw new Error(
      "Candidate deployment requires target, release SHA, CI run id, candidate profile, and confirmation."
    );
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
    throw new Error("Candidate deployment requires all five exact arguments.");
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

export function providerRequestHeaders({ token = "", quotaProject = "" } = {}) {
  return {
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(quotaProject ? { "x-goog-user-project": quotaProject } : {}),
    "User-Agent": "QuotePilot-release-candidate"
  };
}

async function fetchJson(url, { token = "", quotaProject = "", label = "Provider" } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      headers: providerRequestHeaders({ token, quotaProject }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`${label} request failed with HTTP ${response.status}.`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export function resolveGitHubToken({
  env = process.env,
  readCliToken = () => capture("gh", ["auth", "token"], { env })
} = {}) {
  const configured = String(env.GITHUB_TOKEN || env.GH_TOKEN || "").trim();
  if (configured) return configured;
  try {
    const cliToken = String(readCliToken() || "").trim();
    if (cliToken) return cliToken;
  } catch {
    // Replace provider- or CLI-specific output with the bounded remediation below.
  }
  throw new Error(
    "Release candidate rejected: GitHub CI verification requires GITHUB_TOKEN, GH_TOKEN, or an authenticated GitHub CLI session."
  );
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
  const token = resolveGitHubToken();
  const base = `https://api.github.com/repos/${RELEASE_CANDIDATE_POLICY.repository.fullName}`;
  const run = await fetchJson(`${base}/actions/runs/${ciRunId}`, {
    token,
    label: "GitHub CI run"
  });
  const jobsResponse = await fetchJson(`${base}/actions/runs/${ciRunId}/jobs?per_page=100`, {
    token,
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

function readFixedFirebaseWebConfig(firebaseCliPath) {
  const output = capture(firebaseCliPath, [
    "apps:sdkconfig",
    "WEB",
    RELEASE_CANDIDATE_POLICY.firebase.appId,
    "--project",
    RELEASE_CANDIDATE_POLICY.firebase.projectId,
    "--json",
    ...firebaseTokenArgs()
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

function candidateBrowserEnvironment(firebaseCliPath) {
  const providerConfig = readFixedFirebaseWebConfig(firebaseCliPath);
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

function validateFunctionsEnvironmentFile(candidateProfile) {
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
  return validateCandidateFunctionsEnvironment(
    parseDotenv(fs.readFileSync(envPath, "utf8")),
    candidateProfile
  );
}

function writeCandidateManifest(
  outputDirectory,
  releaseSha,
  ciRunId,
  candidateProfile,
  functionsGates
) {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const manifest = {
    schema: "com.mbmapps.quotepilot.release-candidate/v2",
    sourceSha: releaseSha,
    ciRunId: Number(ciRunId),
    uatProfile: candidateProfile,
    ambientUiEnabled: true,
    operationalStaffingBrowserEnabled: true,
    operationalStaffingAuthorityEnabled:
      functionsGates.OPERATIONAL_STAFFING_AUTHORITY_ENABLED === "true"
  };
  fs.writeFileSync(
    path.join(outputDirectory, "release-candidate.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { encoding: "utf8", mode: 0o644 }
  );
  return manifest;
}

export async function validateHostedManifest(url, expected, {
  fetchManifest = fetchJson,
  wait = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  attempts = 6,
  delayMs = 2_000
} = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const manifest = await fetchManifest(`${url}/release-candidate.json?sha=${expected.sourceSha}`, {
      label: "Hosted release candidate manifest"
    });
    if (JSON.stringify(manifest) === JSON.stringify(expected)) {
      return `${url}/release-candidate.json`;
    }
    if (attempt < attempts) await wait(delayMs);
  }
  throw new Error("Release candidate rejected: hosted source/authority manifest did not match the exact candidate.");
}

function firebaseTokenArgs() {
  return String(process.env.FIREBASE_TOKEN || "").trim()
    ? ["--token", process.env.FIREBASE_TOKEN]
    : [];
}

export function isEnabledFirebaseSecretVersion(version, expectedName) {
  const secret = version?.secret;
  const observedName = typeof secret === "string"
    ? secret.split("/").at(-1)
    : secret?.name;
  return observedName === expectedName && version?.state === "ENABLED";
}

async function validateFirebaseSecretPrerequisites(firebaseCliPath) {
  const project = RELEASE_CANDIDATE_POLICY.firebase.projectId;
  const results = CANDIDATE_REQUIRED_SECRET_METADATA.map((name) => {
    let response;
    try {
      response = parseJsonOutput(capture(firebaseCliPath, [
        "functions:secrets:get",
        name,
        "--project",
        project,
        "--json",
        ...firebaseTokenArgs()
      ]), `Firebase Secret Manager metadata for ${name}`);
    } catch {
      response = undefined;
    }
    const versions = response?.status === "success" && Array.isArray(response?.result?.secrets)
      ? response.result.secrets
      : [];
    return {
      name,
      available: versions.some((version) => isEnabledFirebaseSecretVersion(version, name))
    };
  });
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

async function resolveFirebaseRulesAccessToken() {
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const client = await auth.getClient();
  const accessTokenResult = await client.getAccessToken();
  const accessToken = typeof accessTokenResult === "string"
    ? accessTokenResult
    : accessTokenResult?.token;
  if (!accessToken) {
    throw new Error("Release candidate rejected: ADC did not provide an access token for Firestore Rules readback.");
  }
  return accessToken;
}

async function readFirebaseRulesReleases(accessToken) {
  const project = RELEASE_CANDIDATE_POLICY.firebase.projectId;
  const releasesResponse = await fetchJson(
    `https://firebaserules.googleapis.com/v1/projects/${project}/releases?pageSize=100`,
    { token: accessToken, quotaProject: project, label: "Firebase Rules releases" }
  );
  if (releasesResponse.nextPageToken) {
    throw new Error("Release candidate rejected: Firebase Rules release evidence exceeds one complete provider page.");
  }
  if (!Array.isArray(releasesResponse.releases)) {
    throw new Error("Release candidate rejected: Firebase Rules release readback is unavailable.");
  }
  return releasesResponse.releases;
}

async function readFirebaseRules(accessToken) {
  const project = RELEASE_CANDIDATE_POLICY.firebase.projectId;
  const releases = await readFirebaseRulesReleases(accessToken);
  const firestoreRelease = releases.find((release) => (
    release?.name === `projects/${project}/releases/cloud.firestore`
  ));
  const ruleset = firestoreRelease?.rulesetName
      ? await fetchJson(`https://firebaserules.googleapis.com/v1/${firestoreRelease.rulesetName}`, {
        token: accessToken,
        quotaProject: project,
        label: "Firebase Rules ruleset"
      })
    : undefined;
  return validateFirebaseRulesReadback({
    release: firestoreRelease,
    files: ruleset?.source?.files,
    localRulesSource: fs.readFileSync(path.join(ROOT, "firestore.rules"), "utf8")
  });
}

async function readFirebaseHostingAndRules({
  providerDeploymentId,
  firebaseCliPath,
  firebaseRulesAccessToken
}) {
  const project = RELEASE_CANDIDATE_POLICY.firebase.projectId;
  const hostingResponse = parseJsonOutput(capture(firebaseCliPath, [
    "hosting:channel:list",
    "--site",
    RELEASE_CANDIDATE_POLICY.firebase.siteId,
    "--project",
    project,
    "--json",
    ...firebaseTokenArgs()
  ]), "Firebase Hosting channel readback");
  const channels = hostingResponse?.status === "success" && Array.isArray(hostingResponse?.result?.channels)
    ? hostingResponse.result.channels
    : [];
  const channel = channels.find((entry) => entry?.name === (
    `projects/${project}/sites/${RELEASE_CANDIDATE_POLICY.firebase.siteId}/channels/live`
  ));
  return {
    hosting: validateFirebaseHostingReadback({ channel, providerDeploymentId }),
    firestoreRules: await readFirebaseRules(firebaseRulesAccessToken)
  };
}

function readFirebaseFunctions(firebaseCliPath, candidateProfile) {
  const output = capture(firebaseCliPath, [
    "functions:list",
    "--project",
    RELEASE_CANDIDATE_POLICY.firebase.projectId,
    "--json",
    ...firebaseTokenArgs()
  ]);
  return validateFirebaseFunctionsReadback({
    response: parseJsonOutput(output, "Firebase Functions readback"),
    candidateProfile
  });
}

async function readFirebaseProviderEvidence(
  providerDeploymentId,
  firebaseCliPath,
  firebaseRulesAccessToken,
  candidateProfile
) {
  const [surfaces, functions] = await Promise.all([
    readFirebaseHostingAndRules({ providerDeploymentId, firebaseCliPath, firebaseRulesAccessToken }),
    Promise.resolve().then(() => readFirebaseFunctions(firebaseCliPath, candidateProfile))
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
  attempt,
  firebaseCliPath,
  firebaseRulesAccessToken,
  candidateProfile
}) {
  updateCandidateReceipt(reservation, { status: "preparing" });
  run("npm", ["run", "build"], { env: browserEnv });
  const manifest = writeCandidateManifest(
    path.join(ROOT, "dist"),
    releaseSha,
    ciRunId,
    candidateProfile,
    functionsGates
  );
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
    const output = capture(firebaseCliPath, [
      "deploy",
      "--config",
      temporaryConfigPath,
      "--only",
      "hosting,firestore,functions:default",
      "--project",
      RELEASE_CANDIDATE_POLICY.firebase.projectId,
      "--non-interactive",
      "--force",
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
  const providerSurfaces = await readFirebaseProviderEvidence(
    provider.providerDeploymentId,
    firebaseCliPath,
    firebaseRulesAccessToken,
    candidateProfile
  );
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

export function buildVercelOutputConfig() {
  return {
    version: 3,
    routes: [
      {
        src: "^(?:/(.*))$",
        headers: {
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "strict-origin-when-cross-origin"
        },
        continue: true
      },
      { handle: "filesystem" },
      { src: "^(?:/(.*))$", dest: "/index.html", check: true },
      { handle: "error" },
      { status: 404, src: "^(?!/api).*$", dest: "/404.html" }
    ],
    crons: []
  };
}

function writeVercelBuildOutput({
  browserEnv,
  releaseSha,
  ciRunId,
  candidateProfile,
  functionsGates
}) {
  run("npm", ["run", "build"], { env: browserEnv });
  const outputDirectory = path.join(ROOT, ".vercel", "output");
  const staticDirectory = path.join(outputDirectory, "static");
  fs.rmSync(outputDirectory, { recursive: true, force: true });
  fs.mkdirSync(staticDirectory, { recursive: true });
  fs.cpSync(path.join(ROOT, "dist"), staticDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(outputDirectory, "config.json"),
    `${JSON.stringify(buildVercelOutputConfig(), null, 2)}\n`,
    { encoding: "utf8", mode: 0o644 }
  );
  const manifest = writeCandidateManifest(
    staticDirectory,
    releaseSha,
    ciRunId,
    candidateProfile,
    functionsGates
  );
  return { outputDirectory, manifest };
}

export function collectVercelBuildFiles(outputDirectory, { root = ROOT } = {}) {
  const absoluteOutput = path.resolve(outputDirectory);
  const absoluteRoot = path.resolve(root);
  let outputStat;
  try {
    outputStat = fs.lstatSync(absoluteOutput);
  } catch {
    throw new Error("Release candidate rejected: Vercel Build Output directory is unavailable.");
  }
  if (
    !absoluteOutput.startsWith(`${absoluteRoot}${path.sep}`)
    || !outputStat.isDirectory()
    || outputStat.isSymbolicLink()
    || !fs.realpathSync(absoluteOutput).startsWith(`${fs.realpathSync(absoluteRoot)}${path.sep}`)
  ) {
    throw new Error("Release candidate rejected: Vercel Build Output must remain inside the repository.");
  }
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolutePath);
      if (stat.isSymbolicLink()) {
        throw new Error("Release candidate rejected: Vercel Build Output may not contain symbolic links.");
      }
      if (stat.isDirectory()) {
        visit(absolutePath);
      } else if (stat.isFile()) {
        const content = fs.readFileSync(absolutePath);
        files.push({
          absolutePath,
          file: path.relative(absoluteRoot, absolutePath).split(path.sep).join("/"),
          sha: crypto.createHash("sha1").update(content).digest("hex"),
          size: stat.size,
          mode: stat.mode,
          content
        });
      } else {
        throw new Error("Release candidate rejected: Vercel Build Output contains a non-file entry.");
      }
    }
  };
  visit(absoluteOutput);
  return files.sort((left, right) => left.file.localeCompare(right.file));
}

async function vercelFetch(pathname, {
  token,
  method = "GET",
  headers = {},
  body,
  timeoutMs = 30_000
}) {
  if (!token) throw new Error("Release candidate rejected: VERCEL_TOKEN is required for preview deployment.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${VERCEL_API}${pathname}`, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "QuotePilot-release-candidate",
        ...headers
      },
      body,
      signal: controller.signal
    });
    if (!response.ok) {
      let providerMessage = "";
      try {
        const payload = await response.json();
        providerMessage = String(payload?.error?.code || payload?.error?.message || "").slice(0, 200);
      } catch {
        // Keep provider response bodies out of release logs.
      }
      throw new Error(
        `Vercel request failed with HTTP ${response.status}${providerMessage ? ` (${providerMessage})` : ""}.`
      );
    }
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function uploadVercelFiles(files, token) {
  const teamId = encodeURIComponent(RELEASE_CANDIDATE_POLICY.vercel.orgId);
  const uniqueFiles = new Map(files.map((file) => [file.sha, file]));
  for (const file of uniqueFiles.values()) {
    await vercelFetch(`/v2/files?teamId=${teamId}`, {
      token,
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(file.size),
        "x-vercel-digest": file.sha,
        "x-now-digest": file.sha,
        "x-now-size": String(file.size)
      },
      body: file.content
    });
  }
}

export function vercelDeploymentPayload({ files, releaseSha, ciRunId }) {
  return {
    name: RELEASE_CANDIDATE_POLICY.vercel.projectName,
    project: RELEASE_CANDIDATE_POLICY.vercel.projectId,
    version: 2,
    files: files.map(({ file, sha, size, mode }) => ({ file, sha, size, mode })),
    meta: {
      candidateSha: releaseSha,
      candidateCiRunId: String(ciRunId)
    }
  };
}

async function createVercelDeployment({ files, releaseSha, ciRunId, token }) {
  const teamId = encodeURIComponent(RELEASE_CANDIDATE_POLICY.vercel.orgId);
  const response = await vercelFetch(
    `/v13/deployments?teamId=${teamId}&forceNew=1&skipAutoDetectionConfirmation=1&prebuilt=1`,
    {
      token,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(vercelDeploymentPayload({ files, releaseSha, ciRunId }))
    }
  );
  return response.json();
}

async function waitForVercelDeployment(deployment, token) {
  const deploymentId = String(deployment?.id || "");
  if (!deploymentId.startsWith("dpl_")) {
    throw new Error("Release candidate rejected: Vercel did not return a deployment id.");
  }
  const teamId = encodeURIComponent(RELEASE_CANDIDATE_POLICY.vercel.orgId);
  const startedAt = Date.now();
  let current = deployment;
  while (!["READY", "ready"].includes(current?.readyState || current?.state)) {
    if (["ERROR", "CANCELED"].includes(current?.readyState || current?.state)) {
      throw new Error("Release candidate rejected: Vercel preview deployment failed before READY.");
    }
    if (Date.now() - startedAt >= VERCEL_DEPLOYMENT_TIMEOUT_MS) {
      throw new Error("Release candidate rejected: Vercel preview did not reach READY within five minutes.");
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const response = await vercelFetch(`/v13/deployments/${encodeURIComponent(deploymentId)}?teamId=${teamId}`, {
      token
    });
    current = await response.json();
  }
  return current;
}

async function validateVercelProjectAccess(token) {
  const teamId = encodeURIComponent(RELEASE_CANDIDATE_POLICY.vercel.orgId);
  const projectId = encodeURIComponent(RELEASE_CANDIDATE_POLICY.vercel.projectId);
  const response = await vercelFetch(`/v9/projects/${projectId}?teamId=${teamId}`, { token });
  const project = await response.json();
  if (
    project?.id !== RELEASE_CANDIDATE_POLICY.vercel.projectId
    || project?.name !== RELEASE_CANDIDATE_POLICY.vercel.projectName
    || project?.accountId !== RELEASE_CANDIDATE_POLICY.vercel.orgId
  ) {
    throw new Error("Release candidate rejected: Vercel token does not resolve the fixed preview project.");
  }
}

async function deployVercel({
  releaseSha,
  ciRunId,
  browserEnv,
  stagingBackendEvidence,
  candidateProfile,
  functionsGates,
  reservation,
  attempt,
  vercelToken
}) {
  const token = vercelToken;
  updateCandidateReceipt(reservation, { status: "preparing" });
  validateVercelLink();
  const { outputDirectory, manifest } = writeVercelBuildOutput({
    browserEnv,
    releaseSha,
    ciRunId,
    candidateProfile,
    functionsGates
  });
  const files = collectVercelBuildFiles(outputDirectory);
  attempt.providerMutationAttempted = true;
  updateCandidateReceipt(reservation, {
    status: "deploying",
    providerMutationAttempted: true,
    providerMutationAttemptedAt: new Date().toISOString()
  });
  await uploadVercelFiles(files, token);
  const created = await createVercelDeployment({ files, releaseSha, ciRunId, token });
  const deploymentUrl = `https://${String(created?.url || "").replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  if (!/^https:\/\/[^/]+$/.test(deploymentUrl)) throw new Error("Vercel did not return a deployment URL.");
  updateCandidateReceipt(reservation, {
    status: "provider_succeeded_unverified",
    provider: {
      name: "vercel",
      ...RELEASE_CANDIDATE_POLICY.vercel,
      target: "preview",
      deploymentUrl
    }
  });
  const ready = await waitForVercelDeployment(created, token);
  const provider = validateVercelReceipt({ deployment: ready, releaseSha });
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
    const candidateProfile = requireCandidateUatProfile(args["--candidate-profile"]);
    const releaseSha = requireFullSha(args["--release-sha"]);
    const expectedConfirmation = candidateConfirmation(target, releaseSha);
    if (args["--confirm"] !== expectedConfirmation) {
      throw new Error(`Candidate deployment requires --confirm "${expectedConfirmation}".`);
    }
    const branch = validateWorkspace(releaseSha);
    const ciEvidence = await verifyCi(args["--ci-run-id"], releaseSha, branch);
    const firebaseCliPath = await prepareFirebaseToolsBinary();
    const browserEnv = candidateBrowserEnvironment(firebaseCliPath);
    const functionsGates = target === "firebase-all"
      ? validateFunctionsEnvironmentFile(candidateProfile)
      : candidateFunctionsRuntimeExpected(candidateProfile);
    const secretPrerequisites = target === "firebase-all"
      ? await validateFirebaseSecretPrerequisites(firebaseCliPath)
      : undefined;
    const firebaseRulesAccessToken = target === "firebase-all"
      ? await resolveFirebaseRulesAccessToken()
      : undefined;
    if (firebaseRulesAccessToken) await readFirebaseRulesReleases(firebaseRulesAccessToken);
    const stagingBackendEvidence = target === "vercel-preview"
      ? readFirebaseFunctions(firebaseCliPath, candidateProfile)
      : undefined;
    const vercelToken = target === "vercel-preview"
      ? String(process.env.VERCEL_TOKEN || "").trim()
      : undefined;
    if (target === "vercel-preview") {
      validateVercelLink();
      await validateVercelProjectAccess(vercelToken);
    }
    reservation = reserveCandidateReceipt({
      root: ROOT,
      target,
      releaseSha,
      ci: ciEvidence,
      provider: receiptProviderIdentity(target),
      uatProfile: candidateProfile
    });
    const context = {
      releaseSha,
      ciRunId: args["--ci-run-id"],
      browserEnv,
      functionsGates,
      secretPrerequisites,
      firebaseCliPath,
      firebaseRulesAccessToken,
      stagingBackendEvidence,
      vercelToken,
      reservation,
      attempt,
      candidateProfile
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
