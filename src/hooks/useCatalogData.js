import { useCallback, useEffect, useState } from "react";
import { doc, getDoc, getDocs, runTransaction, serverTimestamp } from "firebase/firestore";
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
const EDITABLE_SETTINGS_KEYS = Object.freeze(Object.keys(DEFAULT_SETTINGS));
const ALLOW_LOCAL_CATALOG_FALLBACK =
  import.meta.env.DEV
  && ["1", "true", "yes", "on"].includes(
    String(import.meta.env.VITE_ALLOW_LOCAL_CATALOG_FALLBACK || "").trim().toLowerCase()
  );

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

function normalizeAddonStaffRole(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "server" || raw === "chef" || raw === "bartender") return raw;
  return "";
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
  if (!settingsSnap.exists()) {
    throw new Error("Organization catalog settings are missing. Ask a platform administrator to repair this workspace.");
  }

  const orgCatalog = normalizeCatalog({
    packages: pkgSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    addons: addSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    rentals: rentSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    settings: settingsSnap.data()
  });

  return {
    catalog: orgCatalog,
    source: "firebase-org",
    serverFingerprints: {
      packages: Object.fromEntries(pkgSnap.docs.map((item) => [item.id, fingerprint(item.data())])),
      addons: Object.fromEntries(addSnap.docs.map((item) => [item.id, fingerprint(item.data())])),
      rentals: Object.fromEntries(rentSnap.docs.map((item) => [item.id, fingerprint(item.data())])),
      settings: fingerprint(settingsSnap.data())
    }
  };
}

function packageWriteShape(item = {}) {
  return {
    name: String(item.name || ""),
    ppp: Number(item.ppp || 0)
  };
}

function addonWriteShape(item = {}) {
  const pricingType = normalizePricingType(item.pricingType || item.type || "per_person");
  return {
    name: String(item.name || ""),
    pricingType,
    type: pricingType,
    price: Number(item.price || 0),
    staffRole: normalizeAddonStaffRole(item.staffRole),
    active: item.active !== false
  };
}

function rentalWriteShape(item = {}) {
  const pricingType = normalizePricingType(item.pricingType || item.type || "per_item");
  return {
    name: String(item.name || ""),
    price: Number(item.price || 0),
    qtyPerGuests: Number(item.qtyPerGuests || 1),
    pricingType,
    type: pricingType,
    active: item.active !== false
  };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        if (typeof value[key] !== "function" && value[key] !== undefined) {
          result[key] = stableValue(value[key]);
        }
        return result;
      }, {});
  }
  return value;
}

function valuesMatch(left, right) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function fingerprint(value) {
  return JSON.stringify(stableValue(value));
}

function mapCatalogItemsById(items = [], label = "catalog record") {
  const mapped = new Map();
  items.forEach((item) => {
    const id = String(item?.id || "").trim();
    if (!id) throw new Error(`${label} id is required.`);
    if (mapped.has(id)) throw new Error(`Duplicate ${label} id "${id}" must be resolved before saving.`);
    mapped.set(id, item);
  });
  return mapped;
}

function buildSettingsPatch(nextSettings = {}, baselineSettings = {}) {
  return EDITABLE_SETTINGS_KEYS.reduce((patch, key) => {
    if (!valuesMatch(nextSettings[key], baselineSettings[key])) {
      patch[key] = nextSettings[key];
    }
    return patch;
  }, {});
}

export function buildCatalogRecordChanges({
  catalog = {},
  baselineCatalog = {},
  serverFingerprints = {}
} = {}) {
  const groups = [
    {
      label: "package",
      key: "packages",
      baseline: baselineCatalog.packages || [],
      next: catalog.packages || [],
      writeShape: packageWriteShape
    },
    {
      label: "add-on",
      key: "addons",
      baseline: baselineCatalog.addons || [],
      next: catalog.addons || [],
      writeShape: addonWriteShape
    },
    {
      label: "rental",
      key: "rentals",
      baseline: baselineCatalog.rentals || [],
      next: catalog.rentals || [],
      writeShape: rentalWriteShape
    }
  ];
  const changes = [];
  groups.forEach((group) => {
    const baselineById = mapCatalogItemsById(group.baseline, group.label);
    const nextById = mapCatalogItemsById(group.next, group.label);
    const ids = new Set([...baselineById.keys(), ...nextById.keys()]);
    ids.forEach((id) => {
      const baselineItem = baselineById.get(id);
      const nextItem = nextById.get(id);
      if (
        baselineItem
        && nextItem
        && valuesMatch(group.writeShape(baselineItem), group.writeShape(nextItem))
      ) {
        return;
      }
      changes.push({
        id,
        key: group.key,
        label: group.label,
        nextItem,
        writeData: nextItem ? group.writeShape(nextItem) : null,
        expectedFingerprint: baselineItem
          ? String(serverFingerprints?.[group.key]?.[id] || "")
          : ""
      });
    });
  });
  return changes;
}

async function saveToFirebase(
  catalog,
  baselineCatalog,
  serverFingerprints,
  organizationId = ""
) {
  const resolvedOrganizationId = resolveOrganizationId(organizationId, "");
  if (!resolvedOrganizationId) {
    throw new Error("organizationId is required for catalog writes.");
  }

  const packageCollection = getOrganizationCollectionRef("catalogPackages", resolvedOrganizationId);
  const addonCollection = getOrganizationCollectionRef("catalogAddons", resolvedOrganizationId);
  const rentalCollection = getOrganizationCollectionRef("catalogRentals", resolvedOrganizationId);
  const settingsRef = getOrganizationSubDocRef("settings", "config", resolvedOrganizationId);
  const collectionRefs = {
    packages: packageCollection,
    addons: addonCollection,
    rentals: rentalCollection
  };
  const operations = buildCatalogRecordChanges({
    catalog,
    baselineCatalog,
    serverFingerprints
  }).map((change) => ({
    ...change,
    ref: doc(collectionRefs[change.key], change.id)
  }));
  const settingsPatch = buildSettingsPatch(catalog.settings, baselineCatalog.settings);
  const settingsChanged = Object.keys(settingsPatch).length > 0;
  const transactionReadCount = operations.length + (settingsChanged ? 1 : 0);
  if (transactionReadCount > 450) {
    throw new Error("This edit changes too many catalog records at once. Split it into smaller saves.");
  }
  const changedAtISO = new Date().toISOString();

  await runTransaction(db, async (transaction) => {
    const operationSnapshots = await Promise.all(
      operations.map((operation) => transaction.get(operation.ref))
    );
    let settingsSnap = null;
    if (settingsChanged) {
      settingsSnap = await transaction.get(settingsRef);
      if (!settingsSnap.exists()) {
        throw new Error("Catalog settings were removed. Reload before saving.");
      }
      if (
        !serverFingerprints?.settings
        || fingerprint(settingsSnap.data()) !== serverFingerprints.settings
      ) {
        throw new Error("Pricing, brand, or entitlement settings changed elsewhere. Reload before saving.");
      }
    }

    operations.forEach((operation, index) => {
      const snap = operationSnapshots[index];
      if (operation.expectedFingerprint) {
        if (!snap.exists()) {
          throw new Error(
            `Catalog changed elsewhere: ${operation.label} "${operation.id}" was removed. Reload before saving.`
          );
        }
        if (fingerprint(snap.data()) !== operation.expectedFingerprint) {
          throw new Error(
            `Catalog changed elsewhere: ${operation.label} "${operation.id}" was edited. Reload before saving.`
          );
        }
      } else if (snap.exists()) {
        throw new Error(
          `Catalog changed elsewhere: ${operation.label} id "${operation.id}" is already in use. Reload before saving.`
        );
      }

      if (!operation.nextItem) {
        transaction.delete(operation.ref);
        return;
      }
      transaction.set(operation.ref, {
        ...operation.writeData,
        updatedAtISO: changedAtISO,
        updatedAt: serverTimestamp(),
        ...(!operation.expectedFingerprint
          ? {
              createdAtISO: changedAtISO,
              createdAt: serverTimestamp()
            }
          : {})
      }, { merge: true });
    });
    if (settingsChanged) {
      transaction.set(settingsRef, settingsPatch, { merge: true });
    }
  });
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
    serverFingerprints: null,
    eventTypes: deriveEventTypesFromSettings(baseCatalog.settings),
    ...baseCatalog
  }));
  const [reloadVersion, setReloadVersion] = useState(0);

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
        serverFingerprints: null,
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
          const [{ catalog, source, serverFingerprints }, eventTypes] = await Promise.all([
            loadFromFirebaseByOrganization(organizationId),
            getEventTypes({ organizationId })
          ]);
          if (!alive) return;
          if (!hasCatalogRecords(catalog)) {
            if (alive) {
              setState((prev) => ({
                ...prev,
                loading: false,
                source: `${source}-empty`,
                requiresFirebase: false,
                serverFingerprints,
                eventTypes,
                ...catalog
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
            serverFingerprints,
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
            serverFingerprints: null,
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
          serverFingerprints: null,
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
          serverFingerprints: null,
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
  }, [enabled, organizationId, reloadVersion]);

  const reload = useCallback(() => {
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    setReloadVersion((version) => version + 1);
  }, []);

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
    const hasPricedPackage = normalized.packages.some((item) => {
      const name = String(item?.name || "").trim();
      return name
        && name.toLowerCase() !== "new package"
        && Number(item?.ppp || 0) > 0;
    });
    if (!hasPricedPackage) {
      return {
        ok: false,
        error: "Add at least one specifically named package with a price above $0 before saving the catalog."
      };
    }
    if (normalized.settings?.pricingSetupConfirmed !== true) {
      return {
        ok: false,
        error: "Review the Pricing tab and confirm this organization's fee, tax, deposit, travel, and staffing settings before saving."
      };
    }
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
      let persistedCatalog = normalizedWithPricingVersion;
      let persistedSource = firebaseReady ? "firebase-org" : "local-cache";
      let persistedFingerprints = state.serverFingerprints;
      let persistedEventTypes = state.eventTypes;
      if (firebaseReady) {
        await saveToFirebase(normalizedWithPricingVersion, {
          packages: state.packages,
          addons: state.addons,
          rentals: state.rentals,
          settings: state.settings
        }, state.serverFingerprints, resolvedOrganizationId);
        const [reloaded, eventTypes] = await Promise.all([
          loadFromFirebaseByOrganization(resolvedOrganizationId),
          getEventTypes({ organizationId: resolvedOrganizationId })
        ]);
        persistedCatalog = reloaded.catalog;
        persistedSource = reloaded.source;
        persistedFingerprints = reloaded.serverFingerprints;
        persistedEventTypes = eventTypes;
      }

      if (ALLOW_LOCAL_CATALOG_FALLBACK) {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(toStorageCatalog(persistedCatalog)));
      }
      setState((prev) => ({
        ...prev,
        saving: false,
        source: persistedSource,
        requiresFirebase: false,
        serverFingerprints: persistedFingerprints,
        eventTypes: persistedEventTypes,
        ...persistedCatalog
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
  }, [
    enabled,
    organizationId,
    state.addons,
    state.eventTypes,
    state.packages,
    state.rentals,
    state.serverFingerprints,
    state.settings
  ]);

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
    reload,
    saveCatalog,
    loadMenuByEvent
  };
}
