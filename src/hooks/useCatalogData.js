import { useCallback, useEffect, useState } from "react";
import { doc, getDoc, getDocs, writeBatch } from "firebase/firestore";
import {
  DEFAULT_ADDONS,
  DEFAULT_PACKAGES,
  DEFAULT_RENTALS,
  DEFAULT_SETTINGS,
  normalizeCatalog,
  toStorageCatalog
} from "../data/mockCatalog";
import { db, firebaseReady } from "../lib/firebase";
import {
  getOrganizationCollectionRef,
  getOrganizationSubDocRef,
  resolveOrganizationId
} from "../lib/organizationService";
import { getEventTypes, getMenuCategories, getMenuItems } from "../lib/menuService";
import { recordDiagnosticError } from "../lib/sessionDiagnostics";

const LOCAL_KEY = "quoteWizard.catalog";
const ALLOW_LOCAL_CATALOG_FALLBACK =
  import.meta.env.DEV && String(import.meta.env.VITE_ALLOW_LOCAL_CATALOG_FALLBACK || "true").trim().toLowerCase() !== "false";

function defaultCatalog() {
  return normalizeCatalog({
    packages: DEFAULT_PACKAGES,
    addons: DEFAULT_ADDONS,
    rentals: DEFAULT_RENTALS,
    settings: DEFAULT_SETTINGS
  });
}

function blockedCatalog() {
  return normalizeCatalog({
    packages: [],
    addons: [],
    rentals: [],
    settings: {
      ...DEFAULT_SETTINGS,
      menuSections: []
    }
  });
}

function normalizePricingType(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "per_person" || raw === "per_item" || raw === "per_event") {
    return raw;
  }
  return "per_event";
}

function normalizeMenuSectionsFromEvent(categories = [], items = []) {
  const itemLookup = new Map();
  items.forEach((item) => {
    if (item?.active === false) return;
    const categoryId = String(item?.categoryId || "").trim();
    if (!categoryId) return;
    const pricingType = normalizePricingType(item?.pricingType || item?.type);
    const nextItems = itemLookup.get(categoryId) || [];
    nextItems.push({
      id: String(item?.id || "").trim(),
      name: String(item?.name || "").trim() || "Untitled Item",
      pricingType,
      type: pricingType,
      price: Number(item?.price || 0),
      active: item?.active !== false
    });
    itemLookup.set(categoryId, nextItems);
  });

  return categories.map((category) => {
    const id = String(category?.id || "").trim();
    const groupedItems = (itemLookup.get(id) || []).filter((item) => item.id);
    return {
      id,
      name: String(category?.name || "").trim() || "Untitled Category",
      items: groupedItems
    };
  });
}

function deriveEventTypesFromSettings(settings = {}) {
  const templates = Array.isArray(settings?.eventTemplates) ? settings.eventTemplates : [];
  const seen = new Set();
  return templates
    .map((template) => ({
      id: String(template?.id || "").trim(),
      name: String(template?.name || "").trim() || String(template?.id || "").trim()
    }))
    .filter((item) => {
      if (!item.id || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function hasCatalogRecords(catalog) {
  return Boolean(
    catalog?.packages?.length
    || catalog?.addons?.length
    || catalog?.rentals?.length
  );
}

async function loadFromFirebaseByOrganization(organizationId = "") {
  const resolvedOrganizationId = resolveOrganizationId(organizationId, "");
  if (!resolvedOrganizationId) {
    throw new Error("organizationId is required for catalog reads.");
  }

  const [pkgSnap, addSnap, rentSnap, settingsSnap] = await Promise.all([
    getDocs(getOrganizationCollectionRef("catalogPackages", resolvedOrganizationId)),
    getDocs(getOrganizationCollectionRef("catalogAddons", resolvedOrganizationId)),
    getDocs(getOrganizationCollectionRef("catalogRentals", resolvedOrganizationId)),
    getDoc(getOrganizationSubDocRef("settings", "config", resolvedOrganizationId))
  ]);

  const orgCatalog = normalizeCatalog({
    packages: pkgSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    addons: addSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    rentals: rentSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    settings: settingsSnap.exists() ? settingsSnap.data() : DEFAULT_SETTINGS
  });

  return {
    catalog: orgCatalog,
    source: "firebase-org"
  };
}

async function saveToFirebase(catalog, organizationId = "") {
  const resolvedOrganizationId = resolveOrganizationId(organizationId, "");
  if (!resolvedOrganizationId) {
    throw new Error("organizationId is required for catalog writes.");
  }

  const packageCollection = getOrganizationCollectionRef("catalogPackages", resolvedOrganizationId);
  const addonCollection = getOrganizationCollectionRef("catalogAddons", resolvedOrganizationId);
  const rentalCollection = getOrganizationCollectionRef("catalogRentals", resolvedOrganizationId);
  const settingsRef = getOrganizationSubDocRef("settings", "config", resolvedOrganizationId);

  const [pkgSnap, addSnap, rentSnap] = await Promise.all([
    getDocs(packageCollection),
    getDocs(addonCollection),
    getDocs(rentalCollection)
  ]);

  const batch = writeBatch(db);
  const packageIds = new Set(catalog.packages.map((item) => item.id));
  const addonIds = new Set(catalog.addons.map((item) => item.id));
  const rentalIds = new Set(catalog.rentals.map((item) => item.id));

  pkgSnap.docs.forEach((docSnap) => {
    if (!packageIds.has(docSnap.id)) batch.delete(docSnap.ref);
  });
  addSnap.docs.forEach((docSnap) => {
    if (!addonIds.has(docSnap.id)) batch.delete(docSnap.ref);
  });
  rentSnap.docs.forEach((docSnap) => {
    if (!rentalIds.has(docSnap.id)) batch.delete(docSnap.ref);
  });

  catalog.packages.forEach((item) => {
    batch.set(doc(packageCollection, item.id), {
      name: item.name,
      ppp: Number(item.ppp || 0)
    });
  });
  catalog.addons.forEach((item) => {
    const pricingType = normalizePricingType(item.pricingType || item.type || "per_person");
    batch.set(doc(addonCollection, item.id), {
      name: item.name,
      pricingType,
      type: pricingType,
      price: Number(item.price || 0),
      active: item.active !== false
    });
  });
  catalog.rentals.forEach((item) => {
    const pricingType = normalizePricingType(item.pricingType || item.type || "per_item");
    batch.set(doc(rentalCollection, item.id), {
      name: item.name,
      price: Number(item.price || 0),
      qtyPerGuests: Number(item.qtyPerGuests || 1),
      pricingType,
      type: pricingType,
      active: item.active !== false
    });
  });

  batch.set(settingsRef, catalog.settings, { merge: true });
  await batch.commit();
}

export function useCatalogData({ enabled = true, organizationId = "" } = {}) {
  const baseCatalog = enabled && !firebaseReady && !ALLOW_LOCAL_CATALOG_FALLBACK
    ? blockedCatalog()
    : defaultCatalog();
  const [state, setState] = useState(() => ({
    loading: enabled,
    saving: false,
    source: enabled ? (firebaseReady ? "firebase" : ALLOW_LOCAL_CATALOG_FALLBACK ? "local-defaults" : "firebase-required") : "auth-required",
    error: "",
    requiresFirebase: enabled && !firebaseReady && !ALLOW_LOCAL_CATALOG_FALLBACK,
    eventTypes: deriveEventTypesFromSettings(baseCatalog.settings),
    ...baseCatalog
  }));

  useEffect(() => {
    let alive = true;

    if (!enabled) {
      const fallback = defaultCatalog();
      setState((prev) => ({
        ...prev,
        loading: false,
        saving: false,
        source: "auth-required",
        error: "",
        requiresFirebase: false,
        eventTypes: [],
        ...fallback
      }));
      return () => {
        alive = false;
      };
    }

    async function load() {
      try {
        if (firebaseReady) {
          const [{ catalog, source }, eventTypes] = await Promise.all([
            loadFromFirebaseByOrganization(organizationId),
            getEventTypes({ organizationId })
          ]);
          if (!alive) return;
          const hasRecords = catalog.packages.length || catalog.addons.length || catalog.rentals.length;
          if (!hasRecords) {
            const defaults = defaultCatalog();
            if (alive) {
              setState((prev) => ({
                ...prev,
                loading: false,
                source: `${source}-empty-defaults`,
                requiresFirebase: false,
                eventTypes,
                ...defaults
              }));
            }
            return;
          }
          localStorage.setItem(LOCAL_KEY, JSON.stringify(toStorageCatalog(catalog)));
          setState((prev) => ({
            ...prev,
            loading: false,
            source,
            requiresFirebase: false,
            eventTypes,
            ...catalog
          }));
          return;
        }

        if (!ALLOW_LOCAL_CATALOG_FALLBACK) {
          const blocked = blockedCatalog();
          if (!alive) return;
          setState((prev) => ({
            ...prev,
            loading: false,
            source: "firebase-required",
            requiresFirebase: true,
            error: "Firebase catalog is required in this environment. Configure Firebase to continue.",
            eventTypes: [],
            ...blocked
          }));
          return;
        }

        const cached = localStorage.getItem(LOCAL_KEY);
        const catalog = cached ? normalizeCatalog(JSON.parse(cached)) : defaultCatalog();
        if (!alive) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          source: cached ? "local-cache" : "local-defaults",
          requiresFirebase: false,
          eventTypes: deriveEventTypesFromSettings(catalog.settings),
          ...catalog
        }));
      } catch (err) {
        if (!alive) return;
        recordDiagnosticError(err, {
          surface: "catalog",
          action: "load"
        });
        const shouldUseLocalFallback = !firebaseReady && ALLOW_LOCAL_CATALOG_FALLBACK;
        const fallback = shouldUseLocalFallback ? defaultCatalog() : blockedCatalog();
        setState((prev) => ({
          ...prev,
          loading: false,
          source: shouldUseLocalFallback ? "fallback-defaults" : "firebase-required",
          requiresFirebase: !shouldUseLocalFallback,
          error: shouldUseLocalFallback
            ? err?.message || "Failed to load catalog."
            : "Firebase catalog is required in this environment. Configure Firebase to continue.",
          eventTypes: deriveEventTypesFromSettings(fallback.settings),
          ...fallback
        }));
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [enabled, organizationId]);

  const saveCatalog = useCallback(async (nextCatalog) => {
    if (!enabled) {
      return { ok: false, error: "Sign in as staff to edit catalog." };
    }
    if (!firebaseReady && !ALLOW_LOCAL_CATALOG_FALLBACK) {
      return { ok: false, error: "Firebase catalog is required in this environment." };
    }
    const resolvedOrganizationId = resolveOrganizationId(organizationId, "");
    if (firebaseReady && !resolvedOrganizationId) {
      return { ok: false, error: "organizationId is required for catalog writes." };
    }
    const normalized = normalizeCatalog(nextCatalog);
    const baseVersion = Math.max(
      0,
      Number(state.settings?.pricingSettingsVersion || 0),
      Number(normalized.settings?.pricingSettingsVersion || 0)
    );
    const settingsVersion = baseVersion > 0 ? baseVersion + 1 : 1;
    const settingsUpdatedAtISO = new Date().toISOString();
    const normalizedWithPricingVersion = normalizeCatalog({
      ...normalized,
      settings: {
        ...normalized.settings,
        pricingSettingsVersion: settingsVersion,
        pricingSettingsUpdatedAtISO: settingsUpdatedAtISO
      }
    });
    setState((prev) => ({ ...prev, saving: true, error: "" }));

    try {
      if (firebaseReady) {
        await saveToFirebase(normalizedWithPricingVersion, resolvedOrganizationId);
      }

      if (ALLOW_LOCAL_CATALOG_FALLBACK) {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(toStorageCatalog(normalizedWithPricingVersion)));
      }
      setState((prev) => ({
        ...prev,
        saving: false,
        source: firebaseReady ? "firebase" : "local-cache",
        requiresFirebase: false,
        ...normalizedWithPricingVersion
      }));
      return { ok: true };
    } catch (err) {
      recordDiagnosticError(err, {
        surface: "catalog",
        action: "save"
      });
      setState((prev) => ({
        ...prev,
        saving: false,
        error: err?.message || "Failed to save catalog."
      }));
      return { ok: false, error: err?.message || "Failed to save catalog." };
    }
  }, [enabled, organizationId, state.settings?.pricingSettingsVersion]);

  const loadMenuByEvent = useCallback(async (eventTypeId) => {
    const nextEventTypeId = String(eventTypeId || "").trim();
    if (!nextEventTypeId) {
      return [];
    }

    const [categories, items] = await Promise.all([
      getMenuCategories(nextEventTypeId, { organizationId }),
      getMenuItems(nextEventTypeId, { organizationId })
    ]);
    return normalizeMenuSectionsFromEvent(categories, items);
  }, [organizationId]);

  return {
    ...state,
    saveCatalog,
    loadMenuByEvent
  };
}
