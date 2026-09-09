#!/usr/bin/env node

import process from "node:process";
import { pathToFileURL } from "node:url";

const FIRESTORE_ORIGIN = "https://firestore.googleapis.com";
const APPROVED_ORGANIZATION_ID = "mm05366-sandbox";

function argValue(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 ? "" : String(argv[index + 1] || "").trim();
}

export function parseEventCommercialTenantArgs(argv = process.argv.slice(2)) {
  const projectId = argValue(argv, "--project");
  const organizationId = argValue(argv, "--organization");
  const rawEnabled = argValue(argv, "--enabled").toLowerCase();
  const confirmation = argValue(argv, "--confirm");
  if (projectId !== "tonicatering") throw new Error("Tenant activation is restricted to project tonicatering.");
  if (organizationId !== APPROVED_ORGANIZATION_ID) {
    throw new Error("Event and Commercial Change activation is restricted to the approved founder-pilot organization.");
  }
  if (!new Set(["true", "false"]).has(rawEnabled)) throw new Error("--enabled must be true or false.");
  const enabled = rawEnabled === "true";
  const expectedConfirmation = `SET event and commercial authority ${rawEnabled} for organization ${organizationId}`;
  if (confirmation !== expectedConfirmation) {
    throw new Error(`Tenant activation requires --confirm "${expectedConfirmation}".`);
  }
  return { projectId, organizationId, enabled, expectedConfirmation };
}

export function eventCommercialDocumentUrl({ projectId, organizationId }) {
  return `${FIRESTORE_ORIGIN}/v1/projects/${encodeURIComponent(projectId)}`
    + `/databases/(default)/documents/organizations/${encodeURIComponent(organizationId)}/settings/config`;
}

export function eventCommercialPatch(enabled) {
  return {
    fields: {
      commercialChangeAuthorityEnabled: { booleanValue: enabled },
      eventOperatingSpineEnabled: { booleanValue: enabled }
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

function state(document) {
  return {
    commercialChangeAuthorityEnabled:
      document?.fields?.commercialChangeAuthorityEnabled?.booleanValue === true,
    eventOperatingSpineEnabled:
      document?.fields?.eventOperatingSpineEnabled?.booleanValue === true
  };
}

export async function setEventCommercialTenant({
  projectId,
  organizationId,
  enabled,
  accessToken,
  fetchImpl = globalThis.fetch
}) {
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");
  const bearerToken = String(accessToken || "").trim();
  if (!bearerToken) throw new Error("A workload-identity access token is required.");
  const documentUrl = eventCommercialDocumentUrl({ projectId, organizationId });
  const headers = { authorization: `Bearer ${bearerToken}` };
  const beforeDocument = await responseJson(await fetchImpl(documentUrl, {
    headers,
    signal: AbortSignal.timeout(15_000)
  }), "Firestore settings read");
  const before = state(beforeDocument);
  if (
    before.commercialChangeAuthorityEnabled !== enabled
    || before.eventOperatingSpineEnabled !== enabled
  ) {
    const patchUrl = `${documentUrl}?updateMask.fieldPaths=commercialChangeAuthorityEnabled`
      + "&updateMask.fieldPaths=eventOperatingSpineEnabled&currentDocument.exists=true";
    await responseJson(await fetchImpl(patchUrl, {
      method: "PATCH",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(eventCommercialPatch(enabled)),
      signal: AbortSignal.timeout(15_000)
    }), "Firestore tenant settings update");
  }
  const afterDocument = await responseJson(await fetchImpl(documentUrl, {
    headers,
    signal: AbortSignal.timeout(15_000)
  }), "Firestore settings verification");
  const after = state(afterDocument);
  if (
    after.commercialChangeAuthorityEnabled !== enabled
    || after.eventOperatingSpineEnabled !== enabled
  ) {
    throw new Error("Firestore tenant settings verification did not match the requested state.");
  }
  return { projectId, organizationId, before, after, changed: JSON.stringify(before) !== JSON.stringify(after) };
}

async function main() {
  if (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_REF !== "refs/heads/main") {
    throw new Error("Production tenant activation is restricted to a main-branch GitHub Actions run.");
  }
  if (String(process.env.FIREBASE_TOKEN || "").trim()) {
    throw new Error("Production tenant activation forbids legacy FIREBASE_TOKEN authentication.");
  }
  const options = parseEventCommercialTenantArgs();
  const result = await setEventCommercialTenant({
    ...options,
    accessToken: process.env.GOOGLE_OAUTH_ACCESS_TOKEN
  });
  console.log(
    `Event and Commercial Change tenant settings verified for organization ${result.organizationId}: `
    + `${JSON.stringify(result.before)} -> ${JSON.stringify(result.after)}`
    + `${result.changed ? " (changed)" : " (already set)"}.`
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
