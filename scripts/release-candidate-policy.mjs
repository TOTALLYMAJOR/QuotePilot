import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  RELEASE_ACCEPTANCE_CANDIDATE_PROFILE,
  RELEASE_EVIDENCE_POLICY
} from "./production-release-evidence.mjs";

export const RELEASE_CANDIDATE_POLICY = Object.freeze({
  repository: RELEASE_EVIDENCE_POLICY.repository,
  ciWorkflow: RELEASE_EVIDENCE_POLICY.ciWorkflow,
  requiredCiJobs: RELEASE_EVIDENCE_POLICY.requiredCiJobs,
  firebase: Object.freeze({
    projectId: "quotepilot-staging-20260804",
    projectNumber: "844470813106",
    siteId: "quotepilot-staging-20260804",
    hostingUrl: "https://quotepilot-staging-20260804.web.app",
    appId: "1:844470813106:web:1b2137f26676ef780ca4ab",
    messagingSenderId: "844470813106",
    authDomain: "quotepilot-staging-20260804.firebaseapp.com",
    storageBucket: "quotepilot-staging-20260804.firebasestorage.app"
  }),
  vercel: Object.freeze({
    projectId: "prj_epLi14LmBItwYkv25XZoAkWZf4Jk",
    orgId: "team_AW2QNNgYt5vESEO3eOTJXHp1",
    projectName: "quoteflow"
  }),
  targets: Object.freeze(["firebase-all", "vercel-preview"])
});

export const RELEASE_CANDIDATE_UAT_PROFILE = "staging-safe-off";
export const RELEASE_CANDIDATE_STAFFING_UAT_PROFILE = "staging-staffing-authority";
export const RELEASE_CANDIDATE_PROVIDER_UAT_PROFILE =
  RELEASE_ACCEPTANCE_CANDIDATE_PROFILE;
export const RELEASE_CANDIDATE_EVENT_SPINE_UAT_PROFILE = "staging-event-operating-spine";
export const RELEASE_CANDIDATE_UAT_PROFILES = Object.freeze([
  RELEASE_CANDIDATE_UAT_PROFILE,
  RELEASE_CANDIDATE_STAFFING_UAT_PROFILE,
  RELEASE_CANDIDATE_PROVIDER_UAT_PROFILE,
  RELEASE_CANDIDATE_EVENT_SPINE_UAT_PROFILE
]);

const CANDIDATE_FUNCTIONS_RUNTIME_BASE = Object.freeze({
  APP_BASE_URL: `${RELEASE_CANDIDATE_POLICY.firebase.hostingUrl}/app`,
  APP_BASE_DOMAIN: "mbmapps.com",
  AUTH_PLATFORM_ADMIN_EMAILS: "flightcontrol@quietpilot.us",
  NOTIFICATIONS_EMAIL_PROVIDER: "none",
  EMAIL_FROM_NAME: "QuotePilot by MBMApps",
  EMAIL_FROM_EMAIL: "quotepilot@quietpilot.us",
  NOTIFICATIONS_SMS_PROVIDER: "none",
  STRIPE_MODE: "test",
  COMMERCIAL_CHANGE_AUTHORITY_ENABLED: "false",
  REVENUE_AUTOPILOT_ENABLED: "false",
  REVENUE_AUTOPILOT_SENDS_ENABLED: "false",
  BUYER_ACCESS_ENABLED: "false",
  BUYER_ACCESS_STRIPE_MODE: "test",
  BUYER_ACCESS_APP_BASE_URL: `${RELEASE_CANDIDATE_POLICY.firebase.hostingUrl}/app`,
  INQUIRY_SHOWCASE_ENABLED: "false"
});

export function requireCandidateUatProfile(value) {
  const profile = String(value || "").trim();
  if (!RELEASE_CANDIDATE_UAT_PROFILES.includes(profile)) {
    reject(`candidate profile must be one of: ${RELEASE_CANDIDATE_UAT_PROFILES.join(", ")}.`);
  }
  return profile;
}

export function candidateFunctionsRuntimeExpected(
  profileValue = RELEASE_CANDIDATE_UAT_PROFILE
) {
  const profile = requireCandidateUatProfile(profileValue);
  const providerAcceptance = profile === RELEASE_CANDIDATE_PROVIDER_UAT_PROFILE;
  return Object.freeze({
    ...CANDIDATE_FUNCTIONS_RUNTIME_BASE,
    NOTIFICATIONS_EMAIL_PROVIDER: providerAcceptance ? "resend" : "none",
    BUYER_ACCESS_ENABLED: providerAcceptance ? "true" : "false",
    ...(providerAcceptance ? {
      BUYER_ACCESS_TURNSTILE_HOSTNAMES:
        new URL(RELEASE_CANDIDATE_POLICY.firebase.hostingUrl).hostname
    } : {}),
    OPERATIONAL_STAFFING_AUTHORITY_ENABLED:
      [
        RELEASE_CANDIDATE_STAFFING_UAT_PROFILE,
        RELEASE_CANDIDATE_PROVIDER_UAT_PROFILE
      ].includes(profile) ? "true" : "false",
    ...(profile === RELEASE_CANDIDATE_EVENT_SPINE_UAT_PROFILE ? { EVENT_OPERATING_SPINE_ENABLED: "true", COMMERCIAL_CHANGE_AUTHORITY_ENABLED: "true" } : {})
  });
}

export function candidateEventSpineRequirements(profileValue) {
  const profile = requireCandidateUatProfile(profileValue);
  if (profile !== RELEASE_CANDIDATE_EVENT_SPINE_UAT_PROFILE) return null;
  return Object.freeze({
    serverFlag: Object.freeze({ name: "EVENT_OPERATING_SPINE_ENABLED", value: true }),
    commercialServerFlag: Object.freeze({ name: "COMMERCIAL_CHANGE_AUTHORITY_ENABLED", value: true }),
    commercialTenantGate: Object.freeze({ documentPath: "organizations/{organizationId}/settings/config", field: "commercialChangeAuthorityEnabled", requiredValue: true, availability: "not_yet_available", reasonCode: "tenant_activation_not_performed", observedValue: null }),
    browserFlags: Object.freeze({ VITE_AMBIENT_UI_ENABLED: true, VITE_EVENT_OPERATING_SPINE_ENABLED: true }),
    tenantGate: Object.freeze({ documentPath: "organizations/{organizationId}/settings/config", field: "eventOperatingSpineEnabled", requiredValue: true, availability: "not_yet_available", reasonCode: "tenant_activation_not_performed", observedValue: null }),
    tenantActivationIncluded: false,
    tenantSelectionRequired: true,
    operatorAcceptanceEstablished: false
  });
}

export const CANDIDATE_FUNCTIONS_RUNTIME_EXPECTED =
  candidateFunctionsRuntimeExpected(RELEASE_CANDIDATE_UAT_PROFILE);

export const CANDIDATE_FUNCTIONS_FORBIDDEN_PLAINTEXT = Object.freeze([
  "RESEND_API_KEY",
  "RESEND_WEBHOOK_SECRET",
  "TWILIO_AUTH_TOKEN",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "REVENUE_AUTOPILOT_TOKEN_SECRET",
  "STAFF_INVITATION_TOKEN_SECRET",
  "BUYER_ACCESS_STRIPE_SECRET_KEY",
  "BUYER_ACCESS_STRIPE_WEBHOOK_SECRET",
  "BUYER_ACCESS_TURNSTILE_SECRET",
  "BUYER_ACCESS_RATE_LIMIT_SECRET",
  "INQUIRY_TURNSTILE_SECRET",
  "INQUIRY_RATE_LIMIT_SECRET"
]);

export const CANDIDATE_REQUIRED_SECRET_METADATA = Object.freeze([
  "BUYER_ACCESS_RATE_LIMIT_SECRET",
  "BUYER_ACCESS_STRIPE_SECRET_KEY",
  "BUYER_ACCESS_STRIPE_WEBHOOK_SECRET",
  "BUYER_ACCESS_TURNSTILE_SECRET",
  "INQUIRY_RATE_LIMIT_SECRET",
  "INQUIRY_TURNSTILE_SECRET",
  "PINGRAM_API_KEY",
  "PINGRAM_WEBHOOK_SECRET",
  "RESEND_API_KEY",
  "RESEND_WEBHOOK_SECRET",
  "REVENUE_AUTOPILOT_TOKEN_SECRET",
  "SMS_CONTACT_DIGEST_SECRET",
  "STAFF_INVITATION_TOKEN_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "TWILIO_AUTH_TOKEN"
]);

const CANDIDATE_FUNCTIONS_DISABLED_RESIDUE = Object.freeze([
  "TWILIO_ACCOUNT_SID",
  "TWILIO_MESSAGING_SERVICE_SID",
  "NOTIFICATIONS_OWNER_PHONE",
  "BUYER_ACCESS_ALLOWED_EMAILS",
  "INQUIRY_TURNSTILE_HOSTNAMES"
]);

const CANDIDATE_FUNCTIONS_ALLOWED_KEYS = new Set([
  ...RELEASE_CANDIDATE_UAT_PROFILES.filter((profile) => (
    profile !== RELEASE_CANDIDATE_EVENT_SPINE_UAT_PROFILE
  )).flatMap((profile) => (
    Object.keys(candidateFunctionsRuntimeExpected(profile))
  ))
]);

const CLOUDFLARE_TURNSTILE_TEST_SITE_KEYS = new Set([
  "1x00000000000000000000AA",
  "2x00000000000000000000AB",
  "1x00000000000000000000BB",
  "2x00000000000000000000BB",
  "3x00000000000000000000FF"
]);

function reject(message) {
  throw new Error(`Release candidate rejected: ${message}`);
}

export function requireFullSha(value, field = "release SHA") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(normalized)) {
    reject(`${field} must be a full 40-character commit SHA.`);
  }
  return normalized;
}

export function requireReleaseBranch(value) {
  const branch = String(value || "").trim();
  if (!/^release\/v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(branch)) {
    reject("the current branch must use release/vX.Y.Z (an optional prerelease suffix is allowed).");
  }
  return branch;
}

export function requireCandidateTarget(value) {
  const target = String(value || "").trim();
  if (!RELEASE_CANDIDATE_POLICY.targets.includes(target)) {
    reject(`target must be one of: ${RELEASE_CANDIDATE_POLICY.targets.join(", ")}.`);
  }
  return target;
}

export function requireCandidateProfileTarget(targetValue, profileValue) {
  const target = requireCandidateTarget(targetValue);
  const profile = requireCandidateUatProfile(profileValue);
  if (
    profile === RELEASE_CANDIDATE_PROVIDER_UAT_PROFILE
    && target !== "firebase-all"
  ) {
    reject(
      "staging-provider-acceptance is Firebase-only because immutable Vercel preview hostnames cannot be pre-bound to the Turnstile hostname allowlist."
    );
  }
  return Object.freeze({ target, profile });
}

export function candidateConfirmation(
  target,
  releaseSha,
  candidateProfile = RELEASE_CANDIDATE_UAT_PROFILE
) {
  const {
    target: normalizedTarget,
    profile
  } = requireCandidateProfileTarget(target, candidateProfile);
  const sha = requireFullSha(releaseSha);
  const base = normalizedTarget === "firebase-all"
    ? `DEPLOY CANDIDATE ${RELEASE_CANDIDATE_POLICY.firebase.projectId} ${sha}`
    : `DEPLOY CANDIDATE ${RELEASE_CANDIDATE_POLICY.vercel.projectName} PREVIEW ${sha}`;
  return profile === RELEASE_CANDIDATE_PROVIDER_UAT_PROFILE
    ? `${base} PROFILE ${profile}`
    : base;
}

export function validateCandidateCiEvidence({ run, jobs, releaseSha, branch }) {
  const sha = requireFullSha(releaseSha);
  const releaseBranch = requireReleaseBranch(branch);
  const repository = run?.repository || run?.head_repository || {};
  if (
    Number(repository.id) !== RELEASE_CANDIDATE_POLICY.repository.id
    || String(repository.full_name || "") !== RELEASE_CANDIDATE_POLICY.repository.fullName
  ) {
    reject("CI evidence belongs to a different repository.");
  }
  if (
    Number(run?.workflow_id) !== RELEASE_CANDIDATE_POLICY.ciWorkflow.id
    || String(run?.name || "") !== RELEASE_CANDIDATE_POLICY.ciWorkflow.name
    || String(run?.path || "").split("@")[0] !== RELEASE_CANDIDATE_POLICY.ciWorkflow.path
  ) {
    reject("CI evidence is not the canonical CI Quality workflow.");
  }
  if (!new Set(["pull_request", "workflow_dispatch"]).has(String(run?.event || ""))) {
    reject("candidate CI must be a pull-request or manually dispatched release-branch run.");
  }
  if (String(run?.head_branch || "") !== releaseBranch) {
    reject("CI head branch does not match the checked-out release branch.");
  }
  if (String(run?.head_sha || "").toLowerCase() !== sha) {
    reject("CI head SHA does not match the release candidate SHA.");
  }
  if (run?.status !== "completed" || run?.conclusion !== "success") {
    reject("CI run is not completed successfully.");
  }
  if (!Array.isArray(jobs)) reject("CI job evidence is missing.");
  const byName = new Map(jobs.map((job) => [String(job?.name || ""), job]));
  for (const requiredName of RELEASE_CANDIDATE_POLICY.requiredCiJobs) {
    const job = byName.get(requiredName);
    if (!job || job.status !== "completed" || job.conclusion !== "success") {
      reject(`required CI job did not complete successfully: ${requiredName}.`);
    }
  }
  return Object.freeze({
    runId: Number(run.id),
    runUrl: String(run.html_url || ""),
    releaseSha: sha,
    branch: releaseBranch,
    requiredJobs: [...RELEASE_CANDIDATE_POLICY.requiredCiJobs]
  });
}

export function validateCandidateBrowserEnvironment(
  environment = {},
  candidateProfile = RELEASE_CANDIDATE_UAT_PROFILE
) {
  const profile = requireCandidateUatProfile(candidateProfile);
  const providerAcceptance = profile === RELEASE_CANDIDATE_PROVIDER_UAT_PROFILE;
  const firebase = RELEASE_CANDIDATE_POLICY.firebase;
  const exact = {
    VITE_FIREBASE_PROJECT_ID: firebase.projectId,
    VITE_FIREBASE_AUTH_DOMAIN: firebase.authDomain,
    VITE_FIREBASE_STORAGE_BUCKET: firebase.storageBucket,
    VITE_FIREBASE_MESSAGING_SENDER_ID: firebase.messagingSenderId,
    VITE_FIREBASE_APP_ID: firebase.appId
  };
  for (const [name, expected] of Object.entries(exact)) {
    if (String(environment[name] || "").trim() !== expected) {
      reject(`${name} must identify the fixed Firebase staging application.`);
    }
  }
  if (!String(environment.VITE_FIREBASE_API_KEY || "").trim()) {
    reject("VITE_FIREBASE_API_KEY is required for the fixed Firebase staging application.");
  }
  for (const forbidden of [
    "VITE_E2E_BYPASS_AUTH",
    "VITE_USE_FIREBASE_EMULATORS",
    "VITE_ALLOW_LOCAL_CATALOG_FALLBACK",
    "VITE_E2E_ALLOW_NON_AUTHORITATIVE_PRICING"
  ]) {
    if (["1", "true", "yes", "on"].includes(String(environment[forbidden] || "").trim().toLowerCase())) {
      reject(`${forbidden} must be disabled.`);
    }
  }
  const turnstileSiteKey = String(
    environment.VITE_BUYER_ACCESS_TURNSTILE_SITE_KEY || ""
  ).trim();
  if (
    providerAcceptance
    && (
      !/^[A-Za-z0-9_-]{10,100}$/.test(turnstileSiteKey)
      || CLOUDFLARE_TURNSTILE_TEST_SITE_KEYS.has(turnstileSiteKey)
      || /(?:placeholder|example|changeme|test[_-]?key)/i.test(turnstileSiteKey)
    )
  ) {
    reject(
      "VITE_BUYER_ACCESS_TURNSTILE_SITE_KEY must be a reviewed non-test staging site key for provider acceptance."
    );
  }
  if (["1", "true", "yes", "on"].includes(
    String(environment.VITE_INQUIRY_SHOWCASE_ENABLED || "").trim().toLowerCase()
  )) {
    reject("VITE_INQUIRY_SHOWCASE_ENABLED must remain false in every existing candidate profile.");
  }
  if (String(environment.VITE_INQUIRY_TURNSTILE_SITE_KEY || "").trim()) {
    reject("VITE_INQUIRY_TURNSTILE_SITE_KEY must remain empty while Inquiry Showcase is disabled.");
  }
  return Object.freeze({
    ...exact,
    VITE_AMBIENT_UI_ENABLED: "true",
    VITE_OPERATIONAL_STAFFING_ENABLED: "true",
    VITE_BUYER_ACCESS_ENABLED: providerAcceptance ? "true" : "false",
    VITE_BUYER_ACCESS_PUBLIC_CTA_ENABLED: providerAcceptance ? "true" : "false",
    VITE_BUYER_ACCESS_TURNSTILE_SITE_KEY: providerAcceptance
      ? turnstileSiteKey
      : "",
    VITE_INQUIRY_SHOWCASE_ENABLED: "false",
    VITE_INQUIRY_TURNSTILE_SITE_KEY: "",
    ...(profile === RELEASE_CANDIDATE_EVENT_SPINE_UAT_PROFILE ? { VITE_EVENT_OPERATING_SPINE_ENABLED: "true" } : {})
  });
}

export function parseDotenv(source) {
  const result = {};
  for (const line of String(source || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) reject("Functions environment contains an invalid line.");
    const name = trimmed.slice(0, separator).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
      reject("Functions environment contains an invalid variable name.");
    }
    if (Object.hasOwn(result, name)) {
      reject(`Functions environment contains duplicate variable ${name}.`);
    }
    result[name] = trimmed.slice(separator + 1).trim();
  }
  return result;
}

export function validateCandidateFunctionsEnvironment(
  environment = {},
  candidateProfile = RELEASE_CANDIDATE_UAT_PROFILE
) {
  const profile = requireCandidateUatProfile(candidateProfile);
  const expectedRuntime = candidateFunctionsRuntimeExpected(candidateProfile);
  for (const secretName of CANDIDATE_FUNCTIONS_FORBIDDEN_PLAINTEXT) {
    if (String(environment[secretName] || "").trim()) {
      reject(`${secretName} must use staging Secret Manager and cannot appear in Functions dotenv.`);
    }
  }
  for (const residueName of CANDIDATE_FUNCTIONS_DISABLED_RESIDUE) {
    if (String(environment[residueName] || "").trim()) {
      reject(`${residueName} must be empty while its staging provider or buyer rail is disabled.`);
    }
  }
  if (
    profile !== RELEASE_CANDIDATE_PROVIDER_UAT_PROFILE
    && String(environment.BUYER_ACCESS_TURNSTILE_HOSTNAMES || "").trim()
  ) {
    reject(
      "BUYER_ACCESS_TURNSTILE_HOSTNAMES must be empty while the staging buyer rail is disabled."
    );
  }
  const unknownKeys = Object.keys(environment)
    .filter((name) => String(environment[name] || "").trim())
    .filter((name) => !CANDIDATE_FUNCTIONS_ALLOWED_KEYS.has(name) && !Object.hasOwn(expectedRuntime, name));
  if (unknownKeys.length) {
    reject(`Functions environment contains unreviewed variables: ${unknownKeys.sort().join(", ")}.`);
  }
  for (const [name, value] of Object.entries(expectedRuntime)) {
    const actual = String(environment[name] || "").trim();
    const normalizedActual = value === value.toLowerCase() ? actual.toLowerCase() : actual;
    if (normalizedActual !== value) {
      reject(`${name} must be explicitly ${value} in the staging Functions environment.`);
    }
  }
  const platformAdmins = String(environment.AUTH_PLATFORM_ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (
    !platformAdmins.length
    || platformAdmins.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    || platformAdmins.some((email) => email.endsWith("@example.com") || email.endsWith("@example.test"))
  ) {
    reject("AUTH_PLATFORM_ADMIN_EMAILS must contain verified non-placeholder staging operators.");
  }
  return Object.freeze({
    ...expectedRuntime,
    platformAdminCount: new Set(platformAdmins).size
  });
}

export function validateFirebaseFunctionsReadback({
  response,
  candidateProfile = RELEASE_CANDIDATE_UAT_PROFILE
}) {
  const profile = requireCandidateUatProfile(candidateProfile);
  const expectedRuntime = candidateFunctionsRuntimeExpected(candidateProfile);
  if (response?.status !== "success" || !Array.isArray(response?.result) || !response.result.length) {
    reject("Firebase Functions provider readback is missing or empty.");
  }
  const seen = new Set();
  const revisions = response.result.map((entry) => {
    const id = String(entry?.id || "").trim();
    const region = String(entry?.region || "").trim();
    const platform = String(entry?.platform || "").trim();
    const hash = String(entry?.hash || entry?.labels?.["firebase-functions-hash"] || "").trim();
    const key = `${region}/${id}`;
    if (
      !id
      || !region
      || !["gcfv1", "gcfv2", "run"].includes(platform)
      || entry?.project !== RELEASE_CANDIDATE_POLICY.firebase.projectId
      || entry?.state !== "ACTIVE"
      || !/^[0-9a-f]{40,128}$/i.test(hash)
      || seen.has(key)
    ) {
      reject(`Firebase Functions provider revision is invalid for ${key || "an unknown endpoint"}.`);
    }
    seen.add(key);
    const runtime = entry.environmentVariables || {};
    for (const [name, expected] of Object.entries(expectedRuntime)) {
      if (String(runtime[name] || "").trim() !== expected) {
        reject(`Firebase Functions runtime readback for ${key} does not prove ${name}=${expected}.`);
      }
    }
    for (const forbidden of [
      ...CANDIDATE_FUNCTIONS_FORBIDDEN_PLAINTEXT,
      ...CANDIDATE_FUNCTIONS_DISABLED_RESIDUE,
      ...(profile === RELEASE_CANDIDATE_PROVIDER_UAT_PROFILE
        ? []
        : ["BUYER_ACCESS_TURNSTILE_HOSTNAMES"])
    ]) {
      if (String(runtime[forbidden] || "").trim()) {
        reject(`Firebase Functions runtime readback for ${key} contains forbidden plaintext ${forbidden}.`);
      }
    }
    return Object.freeze({ id, region, platform, hash, state: "ACTIVE" });
  }).sort((left, right) => `${left.region}/${left.id}`.localeCompare(`${right.region}/${right.id}`));
  return Object.freeze({
    source: "firebase functions:list --json",
    functionCount: revisions.length,
    revisions,
    runtimeConfig: { ...expectedRuntime }
  });
}

export function validateFirebaseHostingReadback({ channel, providerDeploymentId }) {
  const projectId = RELEASE_CANDIDATE_POLICY.firebase.projectId;
  const projectNumber = RELEASE_CANDIDATE_POLICY.firebase.projectNumber;
  const siteId = RELEASE_CANDIDATE_POLICY.firebase.siteId;
  const expectedChannel = `projects/${projectId}/sites/${siteId}/channels/live`;
  const expectedVersionSuffix = String(providerDeploymentId || "")
    .replace(/^sites\//, `projects/${projectId}/sites/`)
    .replace(`projects/${projectNumber}/sites/`, `projects/${projectId}/sites/`);
  if (
    channel?.name !== expectedChannel
    || channel?.release?.type !== "DEPLOY"
    || channel?.release?.version?.name !== expectedVersionSuffix
    || channel?.release?.version?.status !== "FINALIZED"
    || !String(channel?.release?.name || "").startsWith(`${expectedChannel}/releases/`)
  ) {
    reject("Firebase Hosting provider readback does not match the deployed staging version.");
  }
  return Object.freeze({
    source: "Firebase Hosting API",
    channel: channel.name,
    release: channel.release.name,
    version: channel.release.version.name,
    releaseTime: String(channel.release.releaseTime || "")
  });
}

export function validateFirebaseRulesReadback({ release, files, localRulesSource }) {
  const projectId = RELEASE_CANDIDATE_POLICY.firebase.projectId;
  const expectedRelease = `projects/${projectId}/releases/cloud.firestore`;
  const rulesetPrefix = `projects/${projectId}/rulesets/`;
  const sourceFiles = Array.isArray(files) ? files : [];
  const deployedRules = sourceFiles.find((file) => file?.name === "firestore.rules");
  const localContent = String(localRulesSource || "");
  const deployedContent = String(deployedRules?.content || "");
  const localSha256 = crypto.createHash("sha256").update(localContent).digest("hex");
  const deployedSha256 = crypto.createHash("sha256").update(deployedContent).digest("hex");
  if (
    release?.name !== expectedRelease
    || !String(release?.rulesetName || "").startsWith(rulesetPrefix)
    || !release?.updateTime
    || !localContent
    || deployedContent !== localContent
  ) {
    reject("Firestore Rules provider readback does not match the exact tracked rules source.");
  }
  return Object.freeze({
    source: "Firebase Rules API",
    release: release.name,
    ruleset: release.rulesetName,
    updateTime: release.updateTime,
    sourceSha256: localSha256,
    providerSourceSha256: deployedSha256
  });
}

export function validateFirebaseReceipt({ response, releaseSha }) {
  const sha = requireFullSha(releaseSha);
  if (response?.status !== "success") reject("Firebase did not report a successful deployment.");
  const version = String(response?.result?.hosting || "");
  const prefixes = [
    `sites/${RELEASE_CANDIDATE_POLICY.firebase.siteId}/versions/`,
    `projects/${RELEASE_CANDIDATE_POLICY.firebase.projectNumber}/sites/${RELEASE_CANDIDATE_POLICY.firebase.siteId}/versions/`
  ];
  const prefix = prefixes.find((candidate) => version.startsWith(candidate));
  if (!prefix || version.length <= prefix.length) {
    reject("Firebase did not return the fixed staging Hosting version id.");
  }
  return Object.freeze({
    provider: "firebase",
    projectId: RELEASE_CANDIDATE_POLICY.firebase.projectId,
    siteId: RELEASE_CANDIDATE_POLICY.firebase.siteId,
    providerDeploymentId: version,
    sourceSha: sha
  });
}

export function validateVercelReceipt({ deployment, releaseSha }) {
  const sha = requireFullSha(releaseSha);
  if (
    String(deployment?.id || "").startsWith("dpl_") !== true
    || deployment?.name !== RELEASE_CANDIDATE_POLICY.vercel.projectName
    || deployment?.target !== null && deployment?.target !== "preview"
    || !["READY", "ready"].includes(deployment?.readyState || deployment?.state)
  ) {
    reject("Vercel provider evidence does not match the fixed preview project or state.");
  }
  const hostname = String(deployment.url || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!/^quoteflow-[a-z0-9-]+-mbmapps\.vercel\.app$/i.test(hostname)) {
    reject("Vercel did not return an immutable QuoteFlow preview hostname.");
  }
  return Object.freeze({
    provider: "vercel",
    projectId: RELEASE_CANDIDATE_POLICY.vercel.projectId,
    providerDeploymentId: deployment.id,
    sourceSha: sha,
    url: `https://${hostname}`
  });
}

function assertRealDirectory(directory, label) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(directory) !== directory) {
    reject(`${label} must be a real directory.`);
  }
}

function ensureReceiptDirectory(root, releaseSha) {
  const resolvedRoot = path.resolve(root);
  assertRealDirectory(resolvedRoot, "repository root");
  const relativeSegments = ["artifacts", "release", "candidates", releaseSha];
  let cursor = resolvedRoot;
  for (const segment of relativeSegments) {
    cursor = path.join(cursor, segment);
    if (!fs.existsSync(cursor)) fs.mkdirSync(cursor, { mode: 0o700 });
    assertRealDirectory(cursor, "candidate receipt directory");
  }
  return cursor;
}

function assertReservedReceipt(receiptPath, reservationId) {
  const stat = fs.lstatSync(receiptPath);
  if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(receiptPath) !== receiptPath) {
    reject("candidate receipt reservation must remain a real file.");
  }
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  if (receipt?.reservationId !== reservationId) {
    reject("candidate receipt reservation identity changed unexpectedly.");
  }
  return receipt;
}

function atomicWriteReservedReceipt(receiptPath, receipt) {
  const temporaryPath = `${receiptPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx"
    });
    fs.renameSync(temporaryPath, receiptPath);
    fs.chmodSync(receiptPath, 0o600);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

const CANDIDATE_RECEIPT_IMMUTABLE_FIELDS = Object.freeze([
  "schema",
  "reservationId",
  "target",
  "uatProfile",
  "rolloutRequirements",
  "sourceSha",
  "ci",
  "createdAt"
]);

const CANDIDATE_RECEIPT_PATCH_FIELDS = new Set([
  "status",
  "provider",
  "providerMutationAttempted",
  "providerMutationAttemptedAt",
  "providerMutationCompleted",
  "verifiedAt",
  "sourceShaEvidenceUrl",
  "sourceBindings",
  "providerSurfaces",
  "secretPrerequisites",
  "browserFlags",
  "serverGates",
  "dependencies",
  "failedAt",
  "failure"
]);

const CANDIDATE_RECEIPT_STATUS_TRANSITIONS = Object.freeze({
  reserved: new Set(["reserved", "preparing", "failed"]),
  preparing: new Set(["preparing", "deploying", "failed", "partial"]),
  deploying: new Set(["deploying", "provider_succeeded_unverified", "partial"]),
  provider_succeeded_unverified: new Set([
    "provider_succeeded_unverified",
    "verified",
    "partial"
  ]),
  verified: new Set(["verified"]),
  partial: new Set(["partial"]),
  failed: new Set(["failed"])
});

const CANDIDATE_PROVIDER_EVIDENCE_FIELDS = Object.freeze([
  "deploymentId",
  "deploymentUrl"
]);

function isCandidateReceiptRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireCandidateReceiptPatch(patch) {
  if (!isCandidateReceiptRecord(patch)) {
    reject("candidate receipt patch must be a plain object.");
  }
  for (const field of Reflect.ownKeys(patch)) {
    if (typeof field !== "string") {
      reject("candidate receipt patch contains an unknown symbol field.");
    }
    if (CANDIDATE_RECEIPT_IMMUTABLE_FIELDS.includes(field)) {
      reject(`candidate receipt field ${field} is immutable.`);
    }
    if (!CANDIDATE_RECEIPT_PATCH_FIELDS.has(field)) {
      reject(`candidate receipt patch contains unknown field ${field}.`);
    }
  }
  return patch;
}

function requireCandidateReceiptStatusTransition(currentStatus, requestedStatus) {
  const allowed = CANDIDATE_RECEIPT_STATUS_TRANSITIONS[currentStatus];
  if (!allowed) reject(`candidate receipt has unknown lifecycle status ${String(currentStatus)}.`);
  const nextStatus = requestedStatus === undefined ? currentStatus : requestedStatus;
  if (typeof nextStatus !== "string" || !allowed.has(nextStatus)) {
    reject(`candidate receipt status cannot transition from ${currentStatus} to ${String(nextStatus)}.`);
  }
  return nextStatus;
}

function isBlankCandidateProviderEvidence(value) {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

function mergeCandidateProvider(currentProvider, patchProvider) {
  if (!isCandidateReceiptRecord(currentProvider)) {
    reject("candidate receipt provider identity is invalid.");
  }
  if (!isCandidateReceiptRecord(patchProvider)) {
    reject("candidate receipt provider patch must be a plain object.");
  }
  const current = currentProvider;
  const patch = patchProvider;
  const next = { ...current };
  for (const field of Reflect.ownKeys(patch)) {
    if (typeof field !== "string") {
      reject("candidate receipt provider patch contains an unknown symbol field.");
    }
    if (CANDIDATE_PROVIDER_EVIDENCE_FIELDS.includes(field)) {
      const patchValue = patch[field];
      if (isBlankCandidateProviderEvidence(patchValue)) continue;
      if (typeof patchValue !== "string") {
        reject(`candidate receipt provider ${field} must be a non-empty string.`);
      }
      const normalizedPatchValue = patchValue.trim();
      const currentValue = current[field];
      if (!isBlankCandidateProviderEvidence(currentValue)) {
        if (typeof currentValue !== "string" || currentValue.trim() !== normalizedPatchValue) {
          reject(`candidate receipt provider ${field} conflicts with existing evidence.`);
        }
        continue;
      }
      next[field] = normalizedPatchValue;
      continue;
    }
    if (!Object.hasOwn(current, field)) {
      reject(`candidate receipt provider patch contains unknown field ${field}.`);
    }
    if (!Object.is(patch[field], current[field])) {
      reject(`candidate receipt provider identity field ${field} is immutable.`);
    }
  }
  return next;
}

export function reserveCandidateReceipt({
  root,
  target,
  releaseSha,
  ci,
  provider,
  uatProfile = RELEASE_CANDIDATE_UAT_PROFILE
}) {
  const normalizedTarget = requireCandidateTarget(target);
  const normalizedUatProfile = requireCandidateUatProfile(uatProfile);
  const sha = requireFullSha(releaseSha);
  const directory = ensureReceiptDirectory(root, sha);
  const receiptPath = path.join(
    directory,
    `${normalizedTarget}.${normalizedUatProfile}.json`
  );
  const reservationId = crypto.randomUUID();
  const now = new Date().toISOString();
  const receipt = {
    schema: "com.mbmapps.quotepilot.release-candidate-receipt/v3",
    reservationId,
    status: "reserved",
    target: normalizedTarget,
    uatProfile: normalizedUatProfile,
    ...(candidateEventSpineRequirements(normalizedUatProfile) ? { rolloutRequirements: candidateEventSpineRequirements(normalizedUatProfile) } : {}),
    sourceSha: sha,
    ci,
    provider,
    providerMutationAttempted: false,
    createdAt: now,
    updatedAt: now
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx"
  });
  fs.chmodSync(receiptPath, 0o600);
  return Object.freeze({ receiptPath, reservationId });
}

export function updateCandidateReceipt(reservation, patch = {}) {
  const current = assertReservedReceipt(reservation.receiptPath, reservation.reservationId);
  const validatedPatch = requireCandidateReceiptPatch(patch);
  const status = requireCandidateReceiptStatusTransition(current.status, validatedPatch.status);
  if (typeof current.providerMutationAttempted !== "boolean") {
    reject("candidate receipt providerMutationAttempted state is invalid.");
  }
  if (
    Object.hasOwn(validatedPatch, "providerMutationAttempted")
    && typeof validatedPatch.providerMutationAttempted !== "boolean"
  ) {
    reject("candidate receipt providerMutationAttempted must be boolean.");
  }
  if (current.providerMutationAttempted && validatedPatch.providerMutationAttempted === false) {
    reject("candidate receipt providerMutationAttempted cannot regress from true to false.");
  }
  const next = {
    ...current,
    ...validatedPatch,
    status,
    provider: Object.hasOwn(validatedPatch, "provider")
      ? mergeCandidateProvider(current.provider, validatedPatch.provider)
      : current.provider,
    providerMutationAttempted: current.providerMutationAttempted
      ? true
      : validatedPatch.providerMutationAttempted ?? false,
    updatedAt: new Date().toISOString()
  };
  for (const field of CANDIDATE_RECEIPT_IMMUTABLE_FIELDS) {
    next[field] = current[field];
  }
  atomicWriteReservedReceipt(reservation.receiptPath, next);
  return next;
}

export function candidateReceiptRelativePath(root, reservation) {
  return path.relative(path.resolve(root), reservation.receiptPath);
}
