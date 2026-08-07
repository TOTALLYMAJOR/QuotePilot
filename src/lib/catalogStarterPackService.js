import { httpsCallable } from "firebase/functions";
import { cloudFunctions, firebaseReady } from "./firebase";

const APPLY_STARTER_PACK_CALLABLE = "applyStarterCatalogPack";
const CONFIRM_CATALOG_PRICING_CALLABLE = "confirmCatalogPricing";
const MUTATE_MANAGED_MENU_ITEM_CALLABLE = "mutateManagedMenuItemAvailability";
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
