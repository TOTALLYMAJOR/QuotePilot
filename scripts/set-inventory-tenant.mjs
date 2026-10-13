#!/usr/bin/env node

import process from "node:process";
import { pathToFileURL } from "node:url";

const FIRESTORE_ORIGIN = "https://firestore.googleapis.com";
const FOUNDER_PILOT_ORGANIZATION_ID = "mm05366-sandbox";

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : String(argv[index + 1] || "").trim();
}

export function parseInventoryTenantActivationArgs(argv = process.argv.slice(2)) {
  const projectId = argValue(argv, "--project");
  const organizationId = argValue(argv, "--organization");
  const rawEnabled = argValue(argv, "--enabled").toLowerCase();
  const confirmation = argValue(argv, "--confirm");
  if (projectId !== "tonicatering") throw new Error("Tenant activation is restricted to project tonicatering.");
  if (organizationId !== FOUNDER_PILOT_ORGANIZATION_ID) {
    throw new Error(`Inventory activation is restricted to organization ${FOUNDER_PILOT_ORGANIZATION_ID}.`);
  }
  if (!new Set(["true", "false"]).has(rawEnabled)) throw new Error("--enabled must be true or false.");
  const enabled = rawEnabled === "true";
  const expectedConfirmation = `SET inventory authority ${rawEnabled} for organization ${organizationId}`;
  if (confirmation !== expectedConfirmation) {
    throw new Error(`Tenant activation requires --confirm "${expectedConfirmation}".`);
  }
  return { projectId, organizationId, enabled, expectedConfirmation };
}

export function inventoryFirestoreDocumentUrl({ projectId, organizationId }) {
  return `${FIRESTORE_ORIGIN}/v1/projects/${encodeURIComponent(projectId)}`
    + `/databases/(default)/documents/organizations/${encodeURIComponent(organizationId)}/settings/config`;
}

export function inventoryTenantSettingPatch(enabled) {
  return { fields: { inventoryAuthorityEnabled: { booleanValue: enabled } } };
}

async function responseJson(response, label) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const providerMessage = String(body?.error?.message || "").trim();
    throw new Error(`${label} failed with HTTP ${response.status}${providerMessage ? `: ${providerMessage}` : "."}`);
  }
  return body;
}

function settingValue(document) {
  return document?.fields?.inventoryAuthorityEnabled?.booleanValue === true;
}

export async function setInventoryTenant({
  projectId,
  organizationId,
  enabled,
  accessToken,
  fetchImpl = globalThis.fetch
}) {
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");
  const bearerToken = String(accessToken || "").trim();
  if (!bearerToken) throw new Error("A workload-identity access token is required.");
  const documentUrl = inventoryFirestoreDocumentUrl({ projectId, organizationId });
  const headers = { authorization: `Bearer ${bearerToken}` };
  const beforeDocument = await responseJson(await fetchImpl(documentUrl, {
    headers,
    signal: AbortSignal.timeout(15_000)
  }), "Firestore settings read");
  const before = settingValue(beforeDocument);
  if (before !== enabled) {
    const patchUrl = `${documentUrl}?updateMask.fieldPaths=inventoryAuthorityEnabled&currentDocument.exists=true`;
    await responseJson(await fetchImpl(patchUrl, {
      method: "PATCH",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(inventoryTenantSettingPatch(enabled)),
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
  if (String(process.env.FIREBASE_TOKEN || "").trim()) {
    throw new Error("Production tenant activation forbids legacy FIREBASE_TOKEN authentication.");
  }
  const options = parseInventoryTenantActivationArgs();
  const result = await setInventoryTenant({
    ...options,
    accessToken: process.env.GOOGLE_OAUTH_ACCESS_TOKEN
  });
  console.log(
    `Inventory tenant setting verified for organization ${result.organizationId}: `
    + `${result.before} -> ${result.after}${result.changed ? " (changed)" : " (already set)"}.`
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
