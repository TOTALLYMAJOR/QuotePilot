#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { DEFAULT_FEATURE_FLAGS } from "../src/data/mockCatalog.js";

const require = createRequire(import.meta.url);
const admin = require("../functions/node_modules/firebase-admin");

const FEATURE_LABELS = {
  customerPortal: "Customer Portal",
  eventSchedule: "Event Schedule",
  integrationsOps: "Integrations Ops",
  diagnostics: "Diagnostics",
  reportingDashboard: "Reporting Dashboard",
  quoteCompare: "Quote Compare",
  crmSync: "CRM Sync",
  guidedSelling: "Guided Selling"
};

const FEATURE_IDS = Object.keys(DEFAULT_FEATURE_FLAGS);
const PLAN_PRESETS = {
  starter: ["customerPortal", "eventSchedule", "guidedSelling"],
  growth: ["customerPortal", "eventSchedule", "guidedSelling", "quoteCompare", "reportingDashboard"],
  enterprise: [...FEATURE_IDS]
};
const DEFAULT_SEQUENCE_START = 250;
const NEUTRAL_CATALOG_SKELETON = {
  packages: [
    { id: "starter-package", name: "Starter Package", ppp: 0 },
    { id: "standard-package", name: "Standard Package", ppp: 0 },
    { id: "signature-package", name: "Signature Package", ppp: 0 }
  ],
  addons: [
    { id: "custom-addon", name: "Custom Add-on", pricingType: "per_event", type: "per_event", price: 0, active: true }
  ],
  rentals: [
    { id: "custom-rental", name: "Custom Rental", pricingType: "per_item", type: "per_item", price: 0, qtyPerGuests: 10, active: true }
  ]
};

function normalizeText(value, fallback = "") {
  const text = String(value || "").trim();
  return text || String(fallback || "").trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function slugify(value, fallback = "customer-org") {
  const raw = normalizeText(value, fallback).toLowerCase();
  const slug = raw
    .replace(/[^\w-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
  return slug || fallback;
}

function parseList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePositiveInteger(value, fallback = DEFAULT_SEQUENCE_START) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseArgs(argv) {
  const args = {
    projectId: "",
    organizationId: "",
    organizationName: "",
    ownerEmail: "",
    ownerName: "",
    ownerUid: "",
    appUrl: "https://quotepilot.mbmapps.com",
    supportEmail: "",
    orderId: "",
    plan: "growth",
    features: "",
    disableFeatures: "",
    skipSeed: true,
    dryRun: false,
    emailOut: "",
    sequenceStart: DEFAULT_SEQUENCE_START
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "").trim();
    if (token === "--project") {
      args.projectId = normalizeText(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--organization" || token === "--org") {
      args.organizationId = slugify(argv[i + 1], "customer-org");
      i += 1;
      continue;
    }
    if (token === "--name") {
      args.organizationName = normalizeText(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--owner-email") {
      args.ownerEmail = normalizeEmail(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--owner-name") {
      args.ownerName = normalizeText(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--owner-uid") {
      args.ownerUid = normalizeText(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--app-url") {
      args.appUrl = normalizeText(argv[i + 1], args.appUrl);
      i += 1;
      continue;
    }
    if (token === "--support-email") {
      args.supportEmail = normalizeEmail(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--order-id") {
      args.orderId = normalizeText(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--plan") {
      args.plan = normalizeText(argv[i + 1], args.plan).toLowerCase();
      i += 1;
      continue;
    }
    if (token === "--features") {
      args.features = normalizeText(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--disable-features") {
      args.disableFeatures = normalizeText(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--email-out") {
      args.emailOut = normalizeText(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--sequence-start") {
      args.sequenceStart = parsePositiveInteger(argv[i + 1], DEFAULT_SEQUENCE_START);
      i += 1;
      continue;
    }
    if (token === "--skip-seed") {
      args.skipSeed = true;
      continue;
    }
    if (token === "--seed-menu") {
      args.skipSeed = false;
      continue;
    }
    if (token === "--dry-run") {
      args.dryRun = true;
      continue;
    }
  }

  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  npm run customer:provision -- --name <orgName> --owner-email <email> [options]");
  console.log("");
  console.log("Options:");
  console.log("  --project <projectId>            Firebase project id");
  console.log("  --organization <orgId>           Organization id (optional; auto-sequenced if omitted)");
  console.log("  --owner-name <name>              Owner full name for email copy");
  console.log("  --owner-uid <uid>                Existing Firebase Auth uid (grants role immediately)");
  console.log("  --plan <starter|growth|enterprise>");
  console.log(`  --sequence-start <n>             Starting sequence for auto org ids (default: ${DEFAULT_SEQUENCE_START})`);
  console.log("  --features <a,b,c>               Explicit feature list override");
  console.log("  --disable-features <a,b,c>       Explicit feature disables after plan/feature selection");
  console.log("  --app-url <url>                  Login URL to include in onboarding email");
  console.log("  --support-email <email>          Support contact included in onboarding email");
  console.log("  --order-id <id>                  Internal order reference");
  console.log("  --email-out <path>               Write onboarding email template to file");
  console.log("  --seed-menu                      Seed baseline menu/event data (disabled by default)");
  console.log("  --skip-seed                      Explicitly skip baseline menu/event seeding");
  console.log("  --dry-run                        Do not write data; print intended operations");
}

function validateFeatureIds(featureIds) {
  const invalid = featureIds.filter((id) => !FEATURE_IDS.includes(id));
  if (!invalid.length) return;
  throw new Error(`Unknown feature id(s): ${invalid.join(", ")}. Allowed: ${FEATURE_IDS.join(", ")}`);
}

function buildFeatureFlags({ plan, features, disableFeatures }) {
  const base = { ...Object.fromEntries(FEATURE_IDS.map((id) => [id, false])) };

  const planFeatures = PLAN_PRESETS[plan] || PLAN_PRESETS.growth;
  planFeatures.forEach((id) => {
    base[id] = true;
  });

  const explicitFeatures = parseList(features);
  if (explicitFeatures.length) {
    if (explicitFeatures.length === 1 && explicitFeatures[0].toLowerCase() === "all") {
      FEATURE_IDS.forEach((id) => {
        base[id] = true;
      });
    } else {
      validateFeatureIds(explicitFeatures);
      FEATURE_IDS.forEach((id) => {
        base[id] = explicitFeatures.includes(id);
      });
    }
  }

  const explicitDisables = parseList(disableFeatures);
  if (explicitDisables.length) {
    validateFeatureIds(explicitDisables);
    explicitDisables.forEach((id) => {
      base[id] = false;
    });
  }

  return base;
}

function getFeatureLabel(featureId) {
  return FEATURE_LABELS[featureId] || featureId;
}

function normalizeOrderId(value, fallback = "") {
  const raw = normalizeText(value).toLowerCase();
  const normalized = raw
    .replace(/[^\w-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
  if (normalized) return normalized;
  const fallbackRaw = normalizeText(fallback).toLowerCase();
  return fallbackRaw
    .replace(/[^\w-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

function buildNeutralSettingsPatch({
  organizationName = "",
  ownerName = "",
  ownerEmail = "",
  supportEmail = ""
} = {}) {
  const resolvedOrgName = normalizeText(organizationName, "Organization Workspace");
  const resolvedSupportEmail = normalizeEmail(supportEmail) || normalizeEmail(ownerEmail);
  const resolvedPreparedBy = normalizeText(ownerName, "Sales Team");
  return {
    quotePreparedBy: resolvedPreparedBy,
    brandName: resolvedOrgName,
    brandTagline: "Powered by QuotePilot by MBMApps",
    brandLogoUrl: "",
    brandPrimaryColor: "#1f2937",
    brandAccentColor: "#4b5563",
    brandDarkAccentColor: "#111827",
    brandBackgroundStart: "#f3f4f6",
    brandBackgroundMid: "#e5e7eb",
    brandBackgroundEnd: "#d1d5db",
    heroEyebrow: "Event Catering Workspace",
    heroHeadline: `${resolvedOrgName} Quote Operations`,
    heroDescription: "Build quotes, configure pricing, and manage proposals from one workspace.",
    brandCrew: [],
    businessPhone: "",
    businessEmail: resolvedSupportEmail,
    businessAddress: "",
    acceptanceEmail: resolvedSupportEmail,
    menuSections: []
  };
}

async function resolveSequencedOrganizationId({ db, sequenceStart }) {
  const start = parsePositiveInteger(sequenceStart, DEFAULT_SEQUENCE_START);
  const snap = await db.collection("organizations").get();
  let maxId = start - 1;
  snap.forEach((docSnap) => {
    const id = String(docSnap.id || "").trim();
    if (!/^\d+$/.test(id)) return;
    const value = Number(id);
    if (!Number.isInteger(value) || value < start) return;
    if (value > maxId) maxId = value;
  });
  return String(maxId + 1);
}

async function resolveProvisioningIds({
  db,
  providedOrganizationId = "",
  providedOrderId = "",
  sequenceStart = DEFAULT_SEQUENCE_START,
  dryRun = false
} = {}) {
  let organizationId = normalizeText(providedOrganizationId);
  if (!organizationId) {
    if (dryRun || !db) {
      organizationId = String(parsePositiveInteger(sequenceStart, DEFAULT_SEQUENCE_START));
    } else {
      organizationId = await resolveSequencedOrganizationId({ db, sequenceStart });
    }
  }

  let orderId = normalizeText(providedOrderId);
  if (!orderId) {
    if (/^\d+$/.test(organizationId)) {
      orderId = String(Number(organizationId) + 1);
    } else {
      orderId = `${organizationId}-${Date.now()}`;
    }
  }

  const fallbackOrderId = `${organizationId}-${Date.now()}`;
  return {
    organizationId,
    orderId: normalizeOrderId(orderId, fallbackOrderId) || fallbackOrderId
  };
}

async function ensureNeutralCatalogSkeleton({ db, organizationId, nowISO }) {
  const orgRef = db.doc(`organizations/${organizationId}`);
  const packagesCollection = orgRef.collection("catalogPackages");
  const addonsCollection = orgRef.collection("catalogAddons");
  const rentalsCollection = orgRef.collection("catalogRentals");

  const [packageSnap, addonSnap, rentalSnap] = await Promise.all([
    packagesCollection.limit(1).get(),
    addonsCollection.limit(1).get(),
    rentalsCollection.limit(1).get()
  ]);

  const batch = db.batch();
  const summary = {
    packagesCreated: 0,
    addonsCreated: 0,
    rentalsCreated: 0
  };

  if (packageSnap.empty) {
    NEUTRAL_CATALOG_SKELETON.packages.forEach((item) => {
      summary.packagesCreated += 1;
      batch.set(packagesCollection.doc(item.id), {
        ...item,
        source: "provisioning-default",
        createdAtISO: nowISO
      }, { merge: true });
    });
  }

  if (addonSnap.empty) {
    NEUTRAL_CATALOG_SKELETON.addons.forEach((item) => {
      summary.addonsCreated += 1;
      batch.set(addonsCollection.doc(item.id), {
        ...item,
        source: "provisioning-default",
        createdAtISO: nowISO
      }, { merge: true });
    });
  }

  if (rentalSnap.empty) {
    NEUTRAL_CATALOG_SKELETON.rentals.forEach((item) => {
      summary.rentalsCreated += 1;
      batch.set(rentalsCollection.doc(item.id), {
        ...item,
        source: "provisioning-default",
        createdAtISO: nowISO
      }, { merge: true });
    });
  }

  if (summary.packagesCreated || summary.addonsCreated || summary.rentalsCreated) {
    await batch.commit();
  }

  return summary;
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function toFirestoreValue(value) {
  if (value === null) return { nullValue: null };
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map((item) => toFirestoreValue(item))
      }
    };
  }
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { doubleValue: 0 };
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  if (isPlainObject(value)) {
    return {
      mapValue: {
        fields: toFirestoreFields(value)
      }
    };
  }
  return { stringValue: String(value ?? "") };
}

function toFirestoreFields(obj) {
  return Object.entries(obj || {}).reduce((acc, [key, value]) => {
    if (value === undefined) return acc;
    acc[key] = toFirestoreValue(value);
    return acc;
  }, {});
}

function collectFieldPaths(value, prefix = "", out = []) {
  if (value === undefined) return out;
  if (!isPlainObject(value)) {
    if (prefix) out.push(prefix);
    return out;
  }
  const keys = Object.keys(value);
  if (!keys.length) {
    if (prefix) out.push(prefix);
    return out;
  }
  keys.forEach((key) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    const nextValue = value[key];
    if (isPlainObject(nextValue)) {
      collectFieldPaths(nextValue, nextPrefix, out);
      return;
    }
    out.push(nextPrefix);
  });
  return out;
}

function truncateErrorBody(text, max = 220) {
  const raw = String(text || "").trim();
  if (raw.length <= max) return raw;
  return `${raw.slice(0, max)}...`;
}

function readFirebaseCliAccessToken() {
  try {
    const configPath = path.join(process.env.HOME || "", ".config", "configstore", "firebase-tools.json");
    const raw = fs.readFileSync(configPath, "utf8");
    const json = JSON.parse(raw);
    return normalizeText(json?.tokens?.access_token);
  } catch {
    return "";
  }
}

async function firestorePatchDocument({
  projectId = "",
  documentPath = "",
  data = {},
  accessToken = ""
} = {}) {
  const normalizedProjectId = normalizeText(projectId);
  const normalizedDocPath = normalizeText(documentPath).replace(/^\/+/, "");
  if (!normalizedProjectId || !normalizedDocPath) {
    throw new Error("projectId and documentPath are required for Firestore REST writes.");
  }
  if (!accessToken) {
    throw new Error("Missing Firebase CLI access token for Firestore REST writes.");
  }

  const documentName = `projects/${normalizedProjectId}/databases/(default)/documents/${normalizedDocPath}`;
  const updateMask = collectFieldPaths(data);
  const params = new URLSearchParams();
  updateMask.forEach((fieldPath) => {
    params.append("updateMask.fieldPaths", fieldPath);
  });
  const url = `https://firestore.googleapis.com/v1/${documentName}?${params.toString()}`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: documentName,
      fields: toFirestoreFields(data)
    })
  });

  if (response.ok) return;
  const errorText = truncateErrorBody(await response.text());
  throw new Error(`Firestore REST write failed (${response.status}) for ${normalizedDocPath}: ${errorText}`);
}

async function firestoreCollectionHasDocuments({
  projectId = "",
  collectionPath = "",
  accessToken = ""
} = {}) {
  const normalizedProjectId = normalizeText(projectId);
  const normalizedCollectionPath = normalizeText(collectionPath).replace(/^\/+/, "");
  if (!normalizedProjectId || !normalizedCollectionPath || !accessToken) return false;
  const url = `https://firestore.googleapis.com/v1/projects/${normalizedProjectId}/databases/(default)/documents/${normalizedCollectionPath}?pageSize=1`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  if (response.status === 404) return false;
  if (!response.ok) {
    const errorText = truncateErrorBody(await response.text());
    throw new Error(`Firestore REST read failed (${response.status}) for ${normalizedCollectionPath}: ${errorText}`);
  }
  const body = await response.json();
  return Array.isArray(body?.documents) && body.documents.length > 0;
}

function isAdcMissingError(error) {
  return String(error?.message || "").toLowerCase().includes("could not load the default credentials");
}

async function writeProvisioningViaFirestoreRest({
  projectId = "",
  organizationId = "",
  organizationName = "",
  ownerEmail = "",
  ownerName = "",
  ownerUid = "",
  appUrl = "",
  supportEmail = "",
  plan = "growth",
  featureFlags = {},
  enabledFeatures = [],
  disabledFeatures = [],
  resolvedOrderId = "",
  nowISO = ""
} = {}) {
  const accessToken = readFirebaseCliAccessToken();
  if (!accessToken) {
    throw new Error("Firebase CLI access token not found. Run `npx firebase-tools login` and retry.");
  }

  const normalizedProjectId = normalizeText(projectId);
  if (!normalizedProjectId) {
    throw new Error("projectId is required for Firestore REST fallback writes.");
  }

  await firestorePatchDocument({
    projectId: normalizedProjectId,
    documentPath: `organizations/${organizationId}`,
    accessToken,
    data: {
      name: organizationName,
      slug: slugify(organizationName, organizationId),
      ownerEmail,
      ownerUid: ownerUid || "",
      orderId: resolvedOrderId,
      featureFlagsLocked: true,
      featureFlagsPaid: enabledFeatures,
      updatedAtISO: nowISO
    }
  });

  await firestorePatchDocument({
    projectId: normalizedProjectId,
    documentPath: `organizations/${organizationId}/settings/config`,
    accessToken,
    data: {
      featureFlags,
      featureFlagsLocked: true,
      featureFlagsPaid: enabledFeatures,
      featureFlagsLockReason: "Unpaid modules are locked by ordered package.",
      featureFlagsLockUpdatedAtISO: nowISO,
      ...buildNeutralSettingsPatch({
        organizationName,
        ownerName,
        ownerEmail,
        supportEmail
      }),
      orderId: resolvedOrderId,
      onboarding: {
        status: "provisioned",
        plan,
        ownerEmail,
        ownerName: ownerName || "",
        appUrl,
        provisionedAtISO: nowISO
      },
      updatedAtISO: nowISO
    }
  });

  await firestorePatchDocument({
    projectId: normalizedProjectId,
    documentPath: `provisioningOrders/${resolvedOrderId}`,
    accessToken,
    data: {
      orderId: resolvedOrderId,
      status: "provisioned_local",
      organizationId,
      organizationName,
      ownerEmail,
      ownerName: ownerName || "",
      ownerUid: ownerUid || "",
      plan,
      appUrl,
      supportEmail: supportEmail || "",
      featureFlags,
      featureFlagsPaid: enabledFeatures,
      featureFlagsUnpaid: disabledFeatures,
      sendEmail: false,
      requestedBy: {
        uid: "local-script",
        email: ""
      },
      emailTemplate: {
        subject: `Workspace Ready: ${organizationName}`
      },
      updatedAtISO: nowISO,
      createdAtISO: nowISO
    }
  });

  if (ownerUid) {
    await firestorePatchDocument({
      projectId: normalizedProjectId,
      documentPath: `userRoles/${ownerUid}`,
      accessToken,
      data: {
        role: "admin",
        email: ownerEmail,
        organizationId,
        updatedAtISO: nowISO,
        createdAtISO: nowISO
      }
    });
  } else {
    const inviteId = normalizeEmail(ownerEmail)
      .replace(/[^\w-]+/g, "_")
      .replace(/_{2,}/g, "_")
      .replace(/^_|_$/g, "");
    if (inviteId) {
      await firestorePatchDocument({
        projectId: normalizedProjectId,
        documentPath: `organizationInvites/${inviteId}`,
        accessToken,
        data: {
          email: ownerEmail,
          ownerName: ownerName || "",
          role: "admin",
          organizationId,
          organizationName,
          featureFlags,
          featureFlagsLocked: true,
          featureFlagsPaid: enabledFeatures,
          plan,
          orderId: resolvedOrderId,
          appUrl,
          status: "pending",
          createdAtISO: nowISO,
          updatedAtISO: nowISO
        }
      });
    }
  }

  const packagesEmpty = !(await firestoreCollectionHasDocuments({
    projectId: normalizedProjectId,
    collectionPath: `organizations/${organizationId}/catalogPackages`,
    accessToken
  }));
  const addonsEmpty = !(await firestoreCollectionHasDocuments({
    projectId: normalizedProjectId,
    collectionPath: `organizations/${organizationId}/catalogAddons`,
    accessToken
  }));
  const rentalsEmpty = !(await firestoreCollectionHasDocuments({
    projectId: normalizedProjectId,
    collectionPath: `organizations/${organizationId}/catalogRentals`,
    accessToken
  }));

  const skeletonSummary = {
    packagesCreated: 0,
    addonsCreated: 0,
    rentalsCreated: 0
  };

  if (packagesEmpty) {
    for (const item of NEUTRAL_CATALOG_SKELETON.packages) {
      skeletonSummary.packagesCreated += 1;
      await firestorePatchDocument({
        projectId: normalizedProjectId,
        documentPath: `organizations/${organizationId}/catalogPackages/${item.id}`,
        accessToken,
        data: {
          ...item,
          source: "provisioning-default",
          createdAtISO: nowISO
        }
      });
    }
  }

  if (addonsEmpty) {
    for (const item of NEUTRAL_CATALOG_SKELETON.addons) {
      skeletonSummary.addonsCreated += 1;
      await firestorePatchDocument({
        projectId: normalizedProjectId,
        documentPath: `organizations/${organizationId}/catalogAddons/${item.id}`,
        accessToken,
        data: {
          ...item,
          source: "provisioning-default",
          createdAtISO: nowISO
        }
      });
    }
  }

  if (rentalsEmpty) {
    for (const item of NEUTRAL_CATALOG_SKELETON.rentals) {
      skeletonSummary.rentalsCreated += 1;
      await firestorePatchDocument({
        projectId: normalizedProjectId,
        documentPath: `organizations/${organizationId}/catalogRentals/${item.id}`,
        accessToken,
        data: {
          ...item,
          source: "provisioning-default",
          createdAtISO: nowISO
        }
      });
    }
  }

  const recordsCreated =
    skeletonSummary.packagesCreated + skeletonSummary.addonsCreated + skeletonSummary.rentalsCreated;
  await firestorePatchDocument({
    projectId: normalizedProjectId,
    documentPath: `provisioningOrders/${resolvedOrderId}`,
    accessToken,
    data: {
      catalogBootstrap: {
        template: "neutral",
        recordsCreated
      },
      updatedAtISO: nowISO
    }
  });

  return {
    mode: "firestore-rest",
    skeletonSummary
  };
}

function buildEmailTemplate({
  ownerName,
  ownerEmail,
  organizationName,
  organizationId,
  appUrl,
  enabledFeatures,
  disabledFeatures,
  supportEmail,
  ownerUid,
  orderId
}) {
  const subject = `Workspace Ready: ${organizationName}`;
  const greetingName = ownerName || "there";
  const supportLine = supportEmail
    ? `If you need help, reply to this message or contact ${supportEmail}.`
    : "If you need help, reply to this message and we will assist right away.";
  const roleLine = ownerUid
    ? "Your admin access is already linked to your account."
    : "Your admin access is pre-authorized for this email and will activate on first sign-in.";

  const lines = [
    `Hi ${greetingName},`,
    "",
    `Your ${organizationName} workspace is ready.`,
    "",
    "Getting started:",
    `1. Open ${appUrl}`,
    `2. Sign in (or create an account) using ${ownerEmail}`,
    `3. Confirm you are in organization "${organizationName}" (${organizationId})`,
    "",
    roleLine,
    orderId ? `Order reference: ${orderId}` : "",
    "",
    "Enabled modules:",
    ...enabledFeatures.map((feature) => `- ${getFeatureLabel(feature)}`),
    "",
    "Not included in this order:",
    ...disabledFeatures.map((feature) => `- ${getFeatureLabel(feature)}`),
    "",
    "These modules are locked to your current order package. If you want to upgrade, contact us.",
    "",
    supportLine,
    "",
    "Thank you."
  ].filter(Boolean);

  return {
    subject,
    body: lines.join("\n")
  };
}

function runSeedScript({ projectId, organizationId, dryRun }) {
  const seedScriptPath = path.resolve(process.cwd(), "scripts", "seed-firestore-menu.mjs");
  const args = [seedScriptPath, "--organization", organizationId];
  if (projectId) {
    args.push("--project", projectId);
  }
  if (dryRun) {
    args.push("--dry-run");
  }

  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Seed script failed with exit code ${result.status || 1}.`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.ownerEmail || !args.organizationName) {
    printUsage();
    throw new Error("Missing required arguments: --name and --owner-email are required.");
  }

  const plan = PLAN_PRESETS[args.plan] ? args.plan : "growth";
  const featureFlags = buildFeatureFlags({
    plan,
    features: args.features,
    disableFeatures: args.disableFeatures
  });
  const enabledFeatures = FEATURE_IDS.filter((id) => featureFlags[id]);
  const disabledFeatures = FEATURE_IDS.filter((id) => !featureFlags[id]);
  const nowISO = new Date().toISOString();
  let db = null;
  if (!args.dryRun || !args.organizationId) {
    if (!admin.apps.length) {
      admin.initializeApp(args.projectId ? { projectId: args.projectId } : {});
    }
    db = admin.firestore();
  }

  const { organizationId, orderId: resolvedOrderId } = await resolveProvisioningIds({
    db: args.dryRun ? null : db,
    providedOrganizationId: args.organizationId,
    providedOrderId: args.orderId,
    sequenceStart: args.sequenceStart,
    dryRun: args.dryRun
  });
  if (!organizationId) {
    throw new Error("Unable to resolve organization id.");
  }

  if (!args.skipSeed) {
    runSeedScript({
      projectId: args.projectId,
      organizationId,
      dryRun: args.dryRun
    });
  }

  let provisioningWriteMode = args.dryRun ? "dry-run" : "admin-sdk";
  if (!args.dryRun) {
    try {
      const now = admin.firestore.FieldValue.serverTimestamp();

      await db.doc(`organizations/${organizationId}`).set({
        name: args.organizationName,
        slug: slugify(args.organizationName, organizationId),
        ownerEmail: args.ownerEmail,
        ownerUid: args.ownerUid || "",
        orderId: resolvedOrderId,
        featureFlagsLocked: true,
        featureFlagsPaid: enabledFeatures,
        updatedAtISO: nowISO,
        updatedAt: now
      }, { merge: true });

      await db.doc(`organizations/${organizationId}/settings/config`).set({
        featureFlags,
        featureFlagsLocked: true,
        featureFlagsPaid: enabledFeatures,
        featureFlagsLockReason: "Unpaid modules are locked by ordered package.",
        featureFlagsLockUpdatedAtISO: nowISO,
        ...buildNeutralSettingsPatch({
          organizationName: args.organizationName,
          ownerName: args.ownerName,
          ownerEmail: args.ownerEmail,
          supportEmail: args.supportEmail
        }),
        orderId: resolvedOrderId,
        onboarding: {
          status: "provisioned",
          plan,
          ownerEmail: args.ownerEmail,
          ownerName: args.ownerName || "",
          appUrl: args.appUrl,
          provisionedAtISO: nowISO
        },
        updatedAtISO: nowISO,
        updatedAt: now
      }, { merge: true });

      await db.doc(`provisioningOrders/${resolvedOrderId}`).set({
        orderId: resolvedOrderId,
        status: "provisioned_local",
        organizationId,
        organizationName: args.organizationName,
        ownerEmail: args.ownerEmail,
        ownerName: args.ownerName || "",
        ownerUid: args.ownerUid || "",
        plan,
        appUrl: args.appUrl,
        supportEmail: args.supportEmail || "",
        featureFlags,
        featureFlagsPaid: enabledFeatures,
        featureFlagsUnpaid: disabledFeatures,
        sendEmail: false,
        requestedBy: {
          uid: "local-script",
          email: ""
        },
        emailTemplate: {
          subject: `Workspace Ready: ${args.organizationName}`
        },
        createdAtISO: nowISO,
        updatedAtISO: nowISO,
        createdAt: now,
        updatedAt: now
      }, { merge: true });

      if (args.ownerUid) {
        await db.doc(`userRoles/${args.ownerUid}`).set({
          role: "admin",
          email: args.ownerEmail,
          organizationId,
          updatedAt: now,
          createdAt: now
        }, { merge: true });
      } else {
        const inviteId = normalizeEmail(args.ownerEmail)
          .replace(/[^\w-]+/g, "_")
          .replace(/_{2,}/g, "_")
          .replace(/^_|_$/g, "");
        if (inviteId) {
          await db.doc(`organizationInvites/${inviteId}`).set({
            email: args.ownerEmail,
            ownerName: args.ownerName || "",
            role: "admin",
            organizationId,
            organizationName: args.organizationName,
            featureFlags,
            featureFlagsLocked: true,
            featureFlagsPaid: enabledFeatures,
            plan,
            orderId: resolvedOrderId,
            appUrl: args.appUrl,
            status: "pending",
            createdAtISO: nowISO,
            updatedAtISO: nowISO,
            createdAt: now,
            updatedAt: now
          }, { merge: true });
        }
      }

      const skeletonSummary = await ensureNeutralCatalogSkeleton({
        db,
        organizationId,
        nowISO
      });
      const skeletonCreatedCount =
        skeletonSummary.packagesCreated + skeletonSummary.addonsCreated + skeletonSummary.rentalsCreated;
      await db.doc(`provisioningOrders/${resolvedOrderId}`).set({
        catalogBootstrap: {
          template: "neutral",
          recordsCreated: skeletonCreatedCount
        },
        updatedAtISO: nowISO,
        updatedAt: now
      }, { merge: true });
      if (skeletonSummary.packagesCreated || skeletonSummary.addonsCreated || skeletonSummary.rentalsCreated) {
        console.log(
          `Neutral catalog skeleton created: packages=${skeletonSummary.packagesCreated}, addons=${skeletonSummary.addonsCreated}, rentals=${skeletonSummary.rentalsCreated}`
        );
      }
    } catch (error) {
      if (!isAdcMissingError(error)) {
        throw error;
      }
      const fallbackResult = await writeProvisioningViaFirestoreRest({
        projectId: args.projectId,
        organizationId,
        organizationName: args.organizationName,
        ownerEmail: args.ownerEmail,
        ownerName: args.ownerName,
        ownerUid: args.ownerUid,
        appUrl: args.appUrl,
        supportEmail: args.supportEmail,
        plan,
        featureFlags,
        enabledFeatures,
        disabledFeatures,
        resolvedOrderId,
        nowISO
      });
      provisioningWriteMode = fallbackResult.mode;
      if (
        fallbackResult?.skeletonSummary?.packagesCreated
        || fallbackResult?.skeletonSummary?.addonsCreated
        || fallbackResult?.skeletonSummary?.rentalsCreated
      ) {
        console.log(
          `Neutral catalog skeleton created: packages=${fallbackResult.skeletonSummary.packagesCreated}, addons=${fallbackResult.skeletonSummary.addonsCreated}, rentals=${fallbackResult.skeletonSummary.rentalsCreated}`
        );
      }
    }
  }

  const emailTemplate = buildEmailTemplate({
    ownerName: args.ownerName,
    ownerEmail: args.ownerEmail,
    organizationName: args.organizationName,
    organizationId,
    appUrl: args.appUrl,
    enabledFeatures,
    disabledFeatures,
    supportEmail: args.supportEmail,
    ownerUid: args.ownerUid,
    orderId: resolvedOrderId
  });

  console.log("");
  console.log(args.dryRun ? "Dry run complete." : "Provisioning complete.");
  console.log(`Organization: ${args.organizationName} (${organizationId})`);
  console.log(`Owner email: ${args.ownerEmail}`);
  console.log(`Order id: ${resolvedOrderId}`);
  console.log(`Plan: ${plan}`);
  console.log(`Enabled features: ${enabledFeatures.join(", ") || "(none)"}`);
  console.log(`Disabled features: ${disabledFeatures.join(", ") || "(none)"}`);
  if (!args.ownerUid) {
    console.log("Role provisioning mode: invite-by-email (auto-consumed on first sign-in).");
  } else {
    console.log(`Role provisioning mode: direct userRoles grant for uid ${args.ownerUid}.`);
  }
  if (!args.dryRun) {
    console.log(`Write mode: ${provisioningWriteMode}`);
  }

  const emailOutput = `Subject: ${emailTemplate.subject}\n\n${emailTemplate.body}\n`;
  if (args.emailOut) {
    const outputPath = path.resolve(process.cwd(), args.emailOut);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, emailOutput, "utf8");
    console.log(`Email template written to: ${outputPath}`);
  }

  console.log("");
  console.log("----- EMAIL TEMPLATE START -----");
  console.log(emailOutput.trimEnd());
  console.log("----- EMAIL TEMPLATE END -----");
}

main().catch((error) => {
  console.error("Customer provisioning failed:", error?.message || error);
  process.exitCode = 1;
});
