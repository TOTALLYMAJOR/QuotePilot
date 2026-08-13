#!/usr/bin/env node

import process from "node:process";
import { pathToFileURL } from "node:url";

const FIREBASE_CLI_CLIENT_ID = "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
const FIREBASE_CLI_CLIENT_SECRET = "j9iVZfS8kkCEFUPaAeJV0sAi";
const TOKEN_ENDPOINT = "https://www.googleapis.com/oauth2/v3/token";
const FIRESTORE_ORIGIN = "https://firestore.googleapis.com";

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : String(argv[index + 1] || "").trim();
}

export function parseTenantActivationArgs(argv = process.argv.slice(2)) {
  const projectId = argValue(argv, "--project");
  const organizationId = argValue(argv, "--organization");
  const rawEnabled = argValue(argv, "--enabled").toLowerCase();
  const confirmation = argValue(argv, "--confirm");
  if (projectId !== "tonicatering") throw new Error("Tenant activation is restricted to project tonicatering.");
  if (!/^\d{1,12}$/u.test(organizationId)) throw new Error("A numeric organization id is required.");
  if (!new Set(["true", "false"]).has(rawEnabled)) throw new Error("--enabled must be true or false.");
  const enabled = rawEnabled === "true";
  const expectedConfirmation = `SET operational staffing ${rawEnabled} for organization ${organizationId}`;
  if (confirmation !== expectedConfirmation) {
    throw new Error(`Tenant activation requires --confirm "${expectedConfirmation}".`);
  }
  return { projectId, organizationId, enabled, expectedConfirmation };
}

export function firestoreDocumentUrl({ projectId, organizationId }) {
  return `${FIRESTORE_ORIGIN}/v1/projects/${encodeURIComponent(projectId)}`
    + `/databases/(default)/documents/organizations/${encodeURIComponent(organizationId)}/settings/config`;
}

export function tenantSettingPatch(enabled) {
  return {
    fields: {
      operationalStaffingAuthorityEnabled: { booleanValue: enabled }
    }
  };
}

async function responseJson(response, label) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const providerMessage = String(body?.error?.message || "").trim();
    throw new Error(`${label} failed with HTTP ${response.status}${providerMessage ? `: ${providerMessage}` : "."}`);
  }
  return body;
}

async function exchangeFirebaseToken(refreshToken, fetchImpl) {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: FIREBASE_CLI_CLIENT_ID,
    client_secret: FIREBASE_CLI_CLIENT_SECRET,
    grant_type: "refresh_token",
    scope: "https://www.googleapis.com/auth/cloud-platform"
  });
  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(15_000)
  });
  const payload = await responseJson(response, "Firebase credential exchange");
  const accessToken = String(payload.access_token || "").trim();
  if (!accessToken) throw new Error("Firebase credential exchange returned no access token.");
  return accessToken;
}

function settingValue(document) {
  return document?.fields?.operationalStaffingAuthorityEnabled?.booleanValue === true;
}

export async function setOperationalStaffingTenant({
  projectId,
  organizationId,
  enabled,
  firebaseToken,
  fetchImpl = globalThis.fetch
}) {
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");
  const refreshToken = String(firebaseToken || "").trim();
  if (!refreshToken) throw new Error("FIREBASE_TOKEN is required.");
  const accessToken = await exchangeFirebaseToken(refreshToken, fetchImpl);
  const documentUrl = firestoreDocumentUrl({ projectId, organizationId });
  const headers = { authorization: `Bearer ${accessToken}` };
  const beforeDocument = await responseJson(await fetchImpl(documentUrl, {
    headers,
    signal: AbortSignal.timeout(15_000)
  }), "Firestore settings read");
  const before = settingValue(beforeDocument);
  if (before !== enabled) {
    const patchUrl = `${documentUrl}?updateMask.fieldPaths=operationalStaffingAuthorityEnabled`;
    await responseJson(await fetchImpl(patchUrl, {
      method: "PATCH",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(tenantSettingPatch(enabled)),
      signal: AbortSignal.timeout(15_000)
    }), "Firestore tenant setting update");
  }
  const afterDocument = await responseJson(await fetchImpl(documentUrl, {
    headers,
    signal: AbortSignal.timeout(15_000)
  }), "Firestore settings verification");
  const after = settingValue(afterDocument);
  if (after !== enabled) throw new Error("Firestore tenant setting verification did not match the requested state.");
  return { projectId, organizationId, before, after, changed: before !== after };
}

async function main() {
  if (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_REF !== "refs/heads/main") {
    throw new Error("Production tenant activation is restricted to a main-branch GitHub Actions run.");
  }
  const options = parseTenantActivationArgs();
  const result = await setOperationalStaffingTenant({
    ...options,
    firebaseToken: process.env.FIREBASE_TOKEN
  });
  console.log(
    `Operational staffing tenant setting verified for organization ${result.organizationId}: `
    + `${result.before} -> ${result.after}${result.changed ? " (changed)" : " (already set)"}.`
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
