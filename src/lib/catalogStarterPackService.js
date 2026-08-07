import { httpsCallable } from "firebase/functions";
import { cloudFunctions, firebaseReady } from "./firebase";

const APPLY_STARTER_PACK_CALLABLE = "applyStarterCatalogPack";
const CONFIRM_CATALOG_PRICING_CALLABLE = "confirmCatalogPricing";
const MUTATE_MANAGED_MENU_ITEM_CALLABLE = "mutateManagedMenuItemAvailability";
const LEGACY_STARTER_PACK_VERSION = 1;
const UNSUPPORTED_STARTER_PACK_VERSION_MESSAGE =
  "Choose a supported starter catalog pack version.";
const E2E_FUNCTION_ADAPTER_ENABLED = ["1", "true", "yes", "on"].includes(
  String(import.meta.env.VITE_E2E_BYPASS_AUTH || "").trim().toLowerCase()
);

async function callE2eAdapter(name, payload) {
  if (!E2E_FUNCTION_ADAPTER_ENABLED) return null;
  const adapter = globalThis.__quotePilotE2eFunctions;
  if (typeof adapter?.[name] !== "function") return null;
  return { handled: true, result: await adapter[name](payload) };
}

async function callCatalogFunction(name, payload) {
  const e2e = await callE2eAdapter(name, payload);
  if (e2e?.handled) return e2e.result;
  if (!firebaseReady || !cloudFunctions) {
    throw new Error("Cloud Functions unavailable. Configure Firebase before changing the catalog.");
  }
  const callable = httpsCallable(cloudFunctions, name);
  const result = await callable(payload);
  return result?.data || { ok: false };
}

export function isUnsupportedStarterPackVersionError(error) {
  const code = String(error?.code || "").trim().toLowerCase();
  const message = String(error?.message || "");
  return message.includes(UNSUPPORTED_STARTER_PACK_VERSION_MESSAGE)
    && (!code || code === "invalid-argument" || code === "functions/invalid-argument");
}

export async function applyStarterCatalogPackWithCompatibility(
  request = {},
  apply = applyStarterCatalogPack
) {
  const requestedPackVersion = Number(request?.packVersion);
  try {
    return {
      completed: true,
      result: await apply(request),
      attemptedPackVersion: request?.packVersion,
      compatibilityFallback: false
    };
  } catch (error) {
    const canUseLegacyManifest = Number.isSafeInteger(requestedPackVersion)
      && requestedPackVersion > LEGACY_STARTER_PACK_VERSION
      && isUnsupportedStarterPackVersionError(error);
    if (!canUseLegacyManifest) {
      return {
        completed: false,
        error,
        attemptedPackVersion: request?.packVersion,
        compatibilityFallback: false
      };
    }

    const fallbackRequest = {
      ...request,
      packVersion: LEGACY_STARTER_PACK_VERSION
    };
    try {
      return {
        completed: true,
        result: await apply(fallbackRequest),
        attemptedPackVersion: LEGACY_STARTER_PACK_VERSION,
        compatibilityFallback: true
      };
    } catch (fallbackError) {
      return {
        completed: false,
        error: fallbackError,
        attemptedPackVersion: LEGACY_STARTER_PACK_VERSION,
        compatibilityFallback: true
      };
    }
  }
}

export async function applyStarterCatalogPack({
  organizationId = "",
  packId = "",
  packVersion,
  replaceStagedPack = false,
  expectedCatalogRevision
} = {}) {
  return callCatalogFunction(APPLY_STARTER_PACK_CALLABLE, {
    organizationId,
    packId,
    packVersion,
    replaceStagedPack,
    expectedCatalogRevision
  });
}

export async function confirmCatalogPricing({
  organizationId = "",
  expectedCatalogRevision
} = {}) {
  return callCatalogFunction(CONFIRM_CATALOG_PRICING_CALLABLE, {
    organizationId,
    expectedCatalogRevision
  });
}

export async function mutateManagedMenuItemAvailability({
  organizationId = "",
  itemId = "",
  action = "",
  item = {},
  expectedCatalogRevision
} = {}) {
  return callCatalogFunction(MUTATE_MANAGED_MENU_ITEM_CALLABLE, {
    organizationId,
    itemId,
    action,
    item,
    expectedCatalogRevision
  });
}
