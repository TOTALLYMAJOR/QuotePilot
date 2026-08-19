#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { CONNECT_DATABASE_ID } = require(path.join(ROOT, "functions-connect", "runtimePolicy.js"));

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

const manifest = readJson("config/stripe-connect/staging-foundation.json");

export const STAGING_CONNECT_PROJECT_ID = String(manifest.projectId);
export const STAGING_CONNECT_PROJECT_NUMBER = String(manifest.projectNumber);
export const STAGING_CONNECT_DATABASE_ID = String(manifest.databaseId || CONNECT_DATABASE_ID);
export const STAGING_CONNECT_CANONICAL_RETURN_ORIGIN = String(manifest.canonicalReturnOrigin);
export const STAGING_CONNECT_HOSTING_SITE = STAGING_CONNECT_PROJECT_ID;
export const STAGING_CONNECT_WEB_APP_ID = "1:844470813106:web:1b2137f26676ef780ca4ab";
export const STAGING_CONNECT_DATABASE_LOCATION = "nam5";
export const STAGING_CONNECT_DATABASE_TYPE = "FIRESTORE_NATIVE";
export const STAGING_CONNECT_DATABASE_EDITION = "STANDARD";
export const STAGING_CONNECT_DELETE_PROTECTION = "DELETE_PROTECTION_ENABLED";

function normalizeArray(payload) {
  if (Array.isArray(payload?.result)) return payload.result;
  if (Array.isArray(payload?.result?.apps)) return payload.result.apps;
  if (Array.isArray(payload?.result?.projects)) return payload.result.projects;
  if (Array.isArray(payload?.result?.databases)) return payload.result.databases;
  return [];
}

function runFirebase(args) {
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(command, ["firebase-tools", ...args, "--json"], {
    cwd: ROOT,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    const stderr = String(result.stderr || "").trim();
    throw new Error(
      stderr
        ? `Firebase CLI lookup failed: ${stderr}`
        : "Firebase CLI lookup failed. Confirm that firebase-tools is installed and authenticated."
    );
  }
  return normalizeArray(JSON.parse(result.stdout));
}

function exactDatabaseId(database) {
  const name = String(database?.name || "").trim();
  return name.includes("/databases/") ? name.split("/databases/").pop() : "";
}

export function evaluateStripeConnectStagingLive({
  projects = [],
  apps = [],
  databases = []
} = {}) {
  const blockers = [];

  const project = projects.find((entry) => String(entry?.projectId || "").trim() === STAGING_CONNECT_PROJECT_ID) || null;
  if (!project) {
    blockers.push(`staging Firebase project ${STAGING_CONNECT_PROJECT_ID} is not visible to the authenticated CLI principal.`);
  }

  if (project) {
    if (String(project.projectNumber || "").trim() !== STAGING_CONNECT_PROJECT_NUMBER) {
      blockers.push(`staging Firebase project number must remain ${STAGING_CONNECT_PROJECT_NUMBER}.`);
    }
    if (String(project?.resources?.hostingSite || "").trim() !== STAGING_CONNECT_HOSTING_SITE) {
      blockers.push(`staging Firebase hosting site must remain ${STAGING_CONNECT_HOSTING_SITE}.`);
    }
    if (String(project.state || "").trim() !== "ACTIVE") {
      blockers.push("staging Firebase project is not ACTIVE.");
    }
  }

  const webApps = apps.filter((entry) => String(entry?.platform || "").trim().toUpperCase() === "WEB");
  if (webApps.length !== 1) {
    blockers.push(`staging Firebase project must expose exactly one WEB app; found ${webApps.length}.`);
  }
  const webApp = webApps.find((entry) => String(entry?.appId || "").trim() === STAGING_CONNECT_WEB_APP_ID) || null;
  if (!webApp) {
    blockers.push(`staging Firebase WEB app ${STAGING_CONNECT_WEB_APP_ID} is missing or changed.`);
  }
  if (webApp && String(webApp.state || "").trim() !== "ACTIVE") {
    blockers.push("staging Firebase WEB app is not ACTIVE.");
  }

  const database = databases.find((entry) => exactDatabaseId(entry) === STAGING_CONNECT_DATABASE_ID) || null;
  if (!database) {
    blockers.push(`named Firestore database ${STAGING_CONNECT_DATABASE_ID} is missing from the staging project.`);
  }

  if (database) {
    if (String(database.locationId || "").trim() !== STAGING_CONNECT_DATABASE_LOCATION) {
      blockers.push(`named Firestore database must stay in ${STAGING_CONNECT_DATABASE_LOCATION}.`);
    }
    if (String(database.type || "").trim() !== STAGING_CONNECT_DATABASE_TYPE) {
      blockers.push(`named Firestore database type must remain ${STAGING_CONNECT_DATABASE_TYPE}.`);
    }
    if (String(database.databaseEdition || database.edition || "").trim() !== STAGING_CONNECT_DATABASE_EDITION) {
      blockers.push(`named Firestore database edition must remain ${STAGING_CONNECT_DATABASE_EDITION}.`);
    }
    if (String(database.deleteProtectionState || "").trim() !== STAGING_CONNECT_DELETE_PROTECTION) {
      blockers.push(`named Firestore database delete protection must remain ${STAGING_CONNECT_DELETE_PROTECTION}.`);
    }
  }

  return {
    ready: blockers.length === 0,
    blockers,
    expected: {
      projectId: STAGING_CONNECT_PROJECT_ID,
      projectNumber: STAGING_CONNECT_PROJECT_NUMBER,
      hostingSite: STAGING_CONNECT_HOSTING_SITE,
      webAppId: STAGING_CONNECT_WEB_APP_ID,
      databaseId: STAGING_CONNECT_DATABASE_ID,
      canonicalReturnOrigin: STAGING_CONNECT_CANONICAL_RETURN_ORIGIN
    },
    observed: {
      projectId: String(project?.projectId || "").trim() || null,
      projectNumber: String(project?.projectNumber || "").trim() || null,
      hostingSite: String(project?.resources?.hostingSite || "").trim() || null,
      webAppIds: webApps.map((entry) => String(entry?.appId || "").trim()).filter(Boolean),
      databaseIds: databases.map((entry) => exactDatabaseId(entry)).filter(Boolean)
    }
  };
}

export function formatStripeConnectStagingLiveReport(result) {
  const lines = [
    `Stripe Connect staging live preflight: ${result.ready ? "READY" : "BLOCKED"}`,
    `- Project: ${STAGING_CONNECT_PROJECT_ID}`,
    `- Expected web app: ${STAGING_CONNECT_WEB_APP_ID}`,
    `- Expected database: ${STAGING_CONNECT_DATABASE_ID}`
  ];
  if (result.ready) {
    lines.push("- Live Firebase inventory matches the reviewed staging foundation contract.");
    lines.push("- This remains read-only proof of current Firebase state, not Terraform apply, App Check binding, provider activation, or Stripe acceptance.");
    return lines.join("\n");
  }
  lines.push("- Blocking findings:");
  for (const blocker of result.blockers) {
    lines.push(`  * ${blocker}`);
  }
  lines.push("- Next authorized step: apply the separately reviewed staging infrastructure plan, then rerun this command before exporting Connect runtime or provider access.");
  return lines.join("\n");
}

export function inspectStripeConnectStagingLive() {
  const projects = runFirebase(["projects:list"]);
  const apps = runFirebase(["apps:list", "--project", STAGING_CONNECT_PROJECT_ID]);
  const databases = runFirebase(["firestore:databases:list", "--project", STAGING_CONNECT_PROJECT_ID]);
  return evaluateStripeConnectStagingLive({ projects, apps, databases });
}

function main() {
  const json = process.argv.includes("--json");
  const result = inspectStripeConnectStagingLive();
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatStripeConnectStagingLiveReport(result));
  }
  if (!result.ready) {
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Stripe Connect staging live check failed: ${message}`);
    process.exitCode = 1;
  }
}
