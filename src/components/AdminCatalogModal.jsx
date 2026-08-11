import { useEffect, useRef, useState } from "react";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { firebaseReady, storage } from "../lib/firebase";
import { STARTER_CATALOG_PACKS } from "../data/starterCatalogPacks";
import {
  applyPortalThemePreset,
  buildPortalThemeStyle,
  findPortalThemePreset,
  PORTAL_THEME_PRESETS
} from "../data/portalThemePresets";
import {
  createCategory,
  createEventType,
  createMenuItem,
  deleteMenuItem,
  getEventTypes,
  getMenuCategories,
  getMenuItems,
  isMenuCatalogRevisionConflict,
  updateCategory,
  updateEventType,
  updateMenuItem
} from "../lib/menuService";
import { useModalDialog } from "../hooks/useModalDialog";

// Same default-off gate as the staff-only margin strip in LiveBreakdown.jsx;
// cost entry is only shown once a tenant has opted into the margin pilot,
// since the fields do nothing on their own until that surface reads them.
const PILOT_MARGINS_ENABLED = ["1", "true", "yes", "on"].includes(
  String(import.meta.env.VITE_PILOT_MARGINS_ENABLED || "").trim().toLowerCase()
);
// Decision-room pilot gate (design §4.7): the per-option "Portal offer"
// mark below decides which add-ons/rentals the customer portal may offer
// as decidable options. Marking is staff data entry only — every offer a
// customer taps still arrives as a staged change request for staff
// approval through the ordinary Request Changes path; nothing applies
// itself.
const PILOT_DECISION_ROOM_ENABLED = ["1", "true", "yes", "on"].includes(
  String(import.meta.env.VITE_PILOT_DECISION_ROOM_ENABLED || "").trim().toLowerCase()
);

const JSON_FIELD_META = [
  {
    key: "serviceFeeTiers",
    label: "Service Fee Tiers JSON",
    hint: "Array of { id, minGuests, maxGuests, pct }."
  },
  {
    key: "taxRegions",
    label: "Tax Regions JSON",
    hint: "Array of { id, name, rate }."
  },
  {
    key: "eventTemplates",
    label: "Event Templates JSON",
    hint: "Array of defaults used by template picker in Step 1."
  },
  {
    key: "seasonalProfiles",
    label: "Seasonal Profiles JSON",
    hint: "Array of { id, name, startMonth, startDay, endMonth, endDay, multipliers }."
  },
  {
    key: "brandCrew",
    label: "Brand Crew JSON",
    hint: "Array of { label, imageUrl } shown in header and proposal."
  }
];

const RULE_KIND_META = [
  { value: "addon", label: "Add-on" },
  { value: "rental", label: "Rental" },
  { value: "package", label: "Package" }
];

const ADMIN_TABS = [
  { id: "starter", label: "Starter Packs" },
  { id: "packages", label: "Packages" },
  { id: "addons", label: "Addons" },
  { id: "rentals", label: "Rentals" },
  { id: "menu", label: "Menu" },
  { id: "pricing", label: "Pricing" }
];

const FEATURE_FLAG_META = [
  { id: "customerPortal", label: "Customer Portal" },
  { id: "eventSchedule", label: "Event Schedule" },
  { id: "integrationsOps", label: "Integrations Ops" },
  { id: "diagnostics", label: "Diagnostics" },
  { id: "reportingDashboard", label: "Reporting Dashboard" },
  { id: "quoteCompare", label: "Quote Compare" },
  { id: "guidedSelling", label: "Guided Selling" },
  { id: "aiAssist", label: "AI Assist (Suggestions)" },
  { id: "aiAutopilot", label: "AI Autopilot (Auto Apply)" }
];

const PACKAGE_INCLUSION_FIELD_BY_COLLECTION = Object.freeze({
  addons: "includedAddonIds",
  rentals: "includedRentalIds"
});
const UPSELL_KIND_BY_COLLECTION = Object.freeze({
  packages: "package",
  addons: "addon",
  rentals: "rental"
});

export function removeCatalogRowWithInclusions(catalog = {}, key, index) {
  const rows = Array.isArray(catalog?.[key]) ? catalog[key] : [];
  const removedId = String(rows[index]?.id || "").trim();
  const next = { ...catalog, [key]: rows.filter((_, rowIndex) => rowIndex !== index) };
  if (!removedId) return next;
  const inclusionField = PACKAGE_INCLUSION_FIELD_BY_COLLECTION[key];
  const upsellKind = UPSELL_KIND_BY_COLLECTION[key];
  const settings = catalog.settings || {};
  const eventTemplates = (Array.isArray(settings.eventTemplates) ? settings.eventTemplates : []).flatMap((template) => {
    if (key === "packages") {
      return String(template.pkg || "").trim() === removedId ? [] : [{ ...template }];
    }
    if (key === "addons") {
      return [{
        ...template,
        addons: (Array.isArray(template.addons) ? template.addons : []).filter((id) => id !== removedId)
      }];
    }
    if (key === "rentals") {
      return [{
        ...template,
        rentals: (Array.isArray(template.rentals) ? template.rentals : []).filter((id) => id !== removedId)
      }];
    }
    return [{ ...template }];
  });
  return {
    ...next,
    packages: inclusionField
      ? (Array.isArray(catalog.packages) ? catalog.packages : []).map((pkg) => ({
          ...pkg,
          [inclusionField]: (Array.isArray(pkg[inclusionField]) ? pkg[inclusionField] : [])
            .filter((id) => id !== removedId)
        }))
      : next.packages,
    settings: {
      ...settings,
      eventTemplates,
      upsellRules: (Array.isArray(settings.upsellRules) ? settings.upsellRules : []).filter((rule) => !(
        rule.kind === upsellKind && String(rule.targetId || "").trim() === removedId
      ))
    }
  };
}

export function packageMenuItemReferences(packages = [], menuItemId = "") {
  const id = String(menuItemId || "").trim();
  if (!id) return [];
  return (Array.isArray(packages) ? packages : []).filter((pkg) => (
    Array.isArray(pkg?.includedMenuItemIds) && pkg.includedMenuItemIds.includes(id)
  ));
}

export function eventTemplateMenuItemReferences(eventTemplates = [], menuItemId = "") {
  const id = String(menuItemId || "").trim();
  if (!id) return [];
  return (Array.isArray(eventTemplates) ? eventTemplates : []).filter((template) => (
    Array.isArray(template?.menuItems) && template.menuItems.includes(id)
  ));
}

export function parseEventTemplateDrafts(value = "[]") {
  const parsed = JSON.parse(String(value || "[]"));
  if (!Array.isArray(parsed)) throw new Error("Must be a JSON array.");
  parsed.forEach((template, index) => {
    if (!template || typeof template !== "object" || Array.isArray(template)) {
      throw new Error(`Event template ${index + 1} must be an object.`);
    }
    ["addons", "rentals", "menuItems"].forEach((field) => {
      if (template[field] !== undefined && !Array.isArray(template[field])) {
        throw new Error(`Event template ${index + 1} ${field} must be an array.`);
      }
    });
  });
  return parsed;
}

function normalizePricingType(value, fallback = "per_event") {
  const raw = String(value || fallback).trim().toLowerCase();
  if (raw === "per_person" || raw === "per_item" || raw === "per_event") return raw;
  return fallback;
}

function normalizeStaffingChargeMode(value, fallback = "per_hour") {
  const raw = String(value || fallback).trim().toLowerCase();
  if (raw === "per_event_per_staff") return "per_event_per_staff";
  return "per_hour";
}

function defaultRuleName(kind) {
  if (kind === "rental") return "Rental recommendation";
  if (kind === "package") return "Package recommendation";
  return "Add-on recommendation";
}

function buildJsonDrafts(catalog) {
  const settings = catalog?.settings || {};
  return {
    serviceFeeTiers: JSON.stringify(settings.serviceFeeTiers || [], null, 2),
    taxRegions: JSON.stringify(settings.taxRegions || [], null, 2),
    eventTemplates: JSON.stringify(settings.eventTemplates || [], null, 2),
    seasonalProfiles: JSON.stringify(settings.seasonalProfiles || [], null, 2),
    brandCrew: JSON.stringify(settings.brandCrew || [], null, 2)
  };
}

function initialCatalogAdminTab(catalog) {
  if (catalog?.settings?.starterCatalogPack?.id) return "menu";
  if (catalog?.settings?.pricingSetupConfirmed !== true) {
    return (catalog?.packages || []).length > 0 ? "pricing" : "starter";
  }
  return "packages";
}

function resolveCatalogAdminTab(catalog, requestedTab = "") {
  const requested = String(requestedTab || "").trim();
  if (catalog?.settings?.pricingSetupConfirmed === true && requested === "starter") {
    return "packages";
  }
  return requested || initialCatalogAdminTab(catalog);
}

export function blurManagedMenuItemOnEnter(event) {
  if (event?.key !== "Enter") return false;
  event.preventDefault();
  event.currentTarget?.blur?.();
  return true;
}

export function resolveManagedEventTypeId(eventTypes = [], preferredId = "") {
  const preferred = String(preferredId || "").trim();
  if (preferred && eventTypes.some((item) => String(item?.id || "").trim() === preferred)) {
    return preferred;
  }
  return String(eventTypes[0]?.id || "").trim();
}

export function hasNoMenuInventory(inventory = []) {
  return (Array.isArray(inventory) ? inventory : []).every(({ categories, items }) => (
    (Array.isArray(categories) ? categories : []).length === 0
    && (Array.isArray(items) ? items : []).length === 0
  ));
}

export function hasUnrelatedManagedMenuDraft({
  catalogDraftDirty = false,
  menuItemDirty = {},
  targetItemId = "",
  pendingMenuEditorDraft = false
} = {}) {
  const targetId = String(targetItemId || "").trim();
  return Boolean(
    catalogDraftDirty
    || pendingMenuEditorDraft
    || Object.entries(menuItemDirty || {}).some(([itemId, dirty]) => (
      dirty === true && String(itemId || "").trim() !== targetId
    ))
  );
}

function catalogDraftFingerprint(draft, jsonDrafts) {
  return JSON.stringify({ draft, jsonDrafts });
}

function toDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

function Section({ title, onAdd, children }) {
  return (
    <section className="admin-section">
      <div className="admin-section-head">
        <h3>{title}</h3>
        {onAdd && <button type="button" className="ghost" onClick={onAdd}>Add</button>}
      </div>
      <div className="admin-section-body">{children}</div>
    </section>
  );
}

export function AdminCatalogView({
  open,
  catalog,
  organizationId = "",
  onClose,
  onSave,
  onApplyStarterPack,
  onCatalogMutation,
  onReload,
  saving,
  presentation = "embedded",
  returnFocusRef = null,
  initialTab = "",
  selectedEventType: selectedEventTypeProp = "",
  onEventTypeChange,
  onToast
}) {
  const embedded = presentation === "embedded";
  const [draft, setDraft] = useState(catalog);
  const [activeTab, setActiveTab] = useState(() => resolveCatalogAdminTab(catalog, initialTab));
  const [status, setStatus] = useState("");
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [jsonDrafts, setJsonDrafts] = useState(() => buildJsonDrafts(catalog));
  const [savedFingerprint, setSavedFingerprint] = useState(() =>
    catalogDraftFingerprint(catalog, buildJsonDrafts(catalog))
  );
  const [selectedEventType, setSelectedEventType] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [menuEventTypes, setMenuEventTypes] = useState([]);
  const [menuCategories, setMenuCategories] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [menuLoading, setMenuLoading] = useState(false);
  const [menuActionLoading, setMenuActionLoading] = useState(false);
  const [newEventTypeName, setNewEventTypeName] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [eventTypeEditName, setEventTypeEditName] = useState("");
  const [categoryEditName, setCategoryEditName] = useState("");
  const [newItemDraft, setNewItemDraft] = useState({
    name: "",
    price: 0,
    pricingType: "per_event",
    active: true
  });
  const [menuItemBaselines, setMenuItemBaselines] = useState({});
  const [menuItemDirty, setMenuItemDirty] = useState({});
  const [menuItemSavingId, setMenuItemSavingId] = useState("");
  const menuItemSaveInFlightRef = useRef(new Set());
  const resetOnNextOpenRef = useRef(true);
  const initializedViewScopeRef = useRef("");
  const eventTypesLoadScopeRef = useRef("");
  const confirmedInventoryLoadScopeRef = useRef("");
  const eventMenuLoadScopeRef = useRef("");
  const [packActionId, setPackActionId] = useState("");
  const [catalogRefreshRequired, setCatalogRefreshRequired] = useState(false);
  const [manualSetupEnabled, setManualSetupEnabled] = useState(false);
  const [confirmedMenuRecoveryAvailable, setConfirmedMenuRecoveryAvailable] = useState(false);
  const [confirmedMenuRecoveryChecked, setConfirmedMenuRecoveryChecked] = useState(false);
  const scopedOrganizationId = String(organizationId || "").trim();
  const catalogRevision = Math.max(0, Number(catalog?.settings?.catalogRevision || 0));
  const authoritativeVersion = Math.max(0, Number(catalog?.authoritativeVersion || 0));
  const starterPackRevision = Math.max(
    0,
    Number(catalog?.settings?.starterCatalogPack?.appliedCatalogRevision || 0)
  );
  const viewScopeKey = JSON.stringify([
    scopedOrganizationId,
    String(initialTab || ""),
    authoritativeVersion,
    starterPackRevision
  ]);
  const shouldInitializeView = Boolean(
    open
    && (resetOnNextOpenRef.current || initializedViewScopeRef.current !== viewScopeKey)
  );
  const eventTypesLoadScopeKey = JSON.stringify([
    scopedOrganizationId,
    String(selectedEventTypeProp || ""),
    authoritativeVersion,
    starterPackRevision
  ]);
  const confirmedInventoryLoadScopeKey = JSON.stringify([
    scopedOrganizationId,
    authoritativeVersion,
    starterPackRevision,
    catalog?.settings?.pricingSetupConfirmed === true
  ]);
  const eventMenuLoadScopeKey = JSON.stringify([
    scopedOrganizationId,
    String(selectedEventType || ""),
    authoritativeVersion,
    starterPackRevision
  ]);

  const pushToast = (message, tone = "info") => {
    if (typeof onToast === "function") {
      onToast(message, tone);
    }
  };

  const normalizeManagedMenuItem = (item) => {
    const pricingType = normalizePricingType(item?.pricingType || item?.type, "per_event");
    return {
      ...item,
      name: String(item?.name || "").trim(),
      price: Number(item?.price || 0),
      pricingType,
      type: pricingType,
      active: item?.active !== false
    };
  };

  const buildMenuItemBaselineMap = (items) =>
    (items || []).reduce((acc, item) => {
      acc[item.id] = { ...item };
      return acc;
    }, {});

  const applyManagedMenuItems = (items) => {
    const normalized = (items || []).map(normalizeManagedMenuItem);
    setMenuItems(normalized);
    setMenuItemBaselines(buildMenuItemBaselineMap(normalized));
    setMenuItemDirty({});
    setMenuItemSavingId("");
  };

  const setManagedEventType = (eventTypeId) => {
    const nextEventTypeId = String(eventTypeId || "").trim();
    setSelectedEventType(nextEventTypeId);
    if (typeof onEventTypeChange === "function") {
      onEventTypeChange(nextEventTypeId);
    }
  };

  useEffect(() => {
    if (!shouldInitializeView) return;
    initializedViewScopeRef.current = viewScopeKey;
    resetOnNextOpenRef.current = false;
    const nextDraft = {
      ...catalog,
      settings: {
        ...(catalog?.settings || {}),
        featureFlags: { ...(catalog?.settings?.featureFlags || {}) }
      }
    };
    const nextJsonDrafts = buildJsonDrafts(catalog);
    setDraft(nextDraft);
    setJsonDrafts(nextJsonDrafts);
    setSavedFingerprint(catalogDraftFingerprint(nextDraft, nextJsonDrafts));
    setStatus(String(catalog?.error || ""));
    setUploadingLogo(false);
    setActiveTab(resolveCatalogAdminTab(catalog, initialTab));
    setSelectedEventType(String(selectedEventTypeProp || "").trim());
    setSelectedCategory("");
    setMenuEventTypes([]);
    setMenuCategories([]);
    setMenuItems([]);
    setMenuItemBaselines({});
    setMenuItemDirty({});
    setMenuItemSavingId("");
    menuItemSaveInFlightRef.current.clear();
    setPackActionId("");
    setCatalogRefreshRequired(false);
    setManualSetupEnabled(false);
    setConfirmedMenuRecoveryAvailable(false);
    setConfirmedMenuRecoveryChecked(false);
    setMenuLoading(false);
    setMenuActionLoading(false);
    setNewEventTypeName("");
    setNewCategoryName("");
    setEventTypeEditName("");
    setCategoryEditName("");
    setNewItemDraft({ name: "", price: 0, pricingType: "per_event", active: true });
  }, [open, viewScopeKey]);

  useEffect(() => {
    if (!open) return;
    if (!shouldInitializeView && eventTypesLoadScopeRef.current === eventTypesLoadScopeKey) return;
    eventTypesLoadScopeRef.current = eventTypesLoadScopeKey;
    let alive = true;

    async function loadEventTypeOptions() {
      setMenuLoading(true);
      try {
        const eventTypes = await getEventTypes({ organizationId: scopedOrganizationId });
        if (!alive) return;
        setMenuEventTypes(eventTypes);
        setManagedEventType(resolveManagedEventTypeId(eventTypes, selectedEventTypeProp));
      } catch (err) {
        if (!alive) return;
        setStatus(err?.message || "Failed to load menu event types.");
        pushToast(err?.message || "Failed to load menu event types.", "error");
      } finally {
        if (alive) setMenuLoading(false);
      }
    }

    loadEventTypeOptions();
    return () => {
      alive = false;
    };
  }, [open, eventTypesLoadScopeKey]);

  useEffect(() => {
    if (!open) return undefined;
    if (
      !shouldInitializeView
      && confirmedInventoryLoadScopeRef.current === confirmedInventoryLoadScopeKey
    ) {
      return undefined;
    }
    confirmedInventoryLoadScopeRef.current = confirmedInventoryLoadScopeKey;
    if (!firebaseReady || catalog?.settings?.pricingSetupConfirmed !== true) {
      setConfirmedMenuRecoveryAvailable(false);
      setConfirmedMenuRecoveryChecked(true);
      return undefined;
    }

    let alive = true;
    setConfirmedMenuRecoveryChecked(false);
    async function inspectConfirmedMenuInventory() {
      try {
        const eventTypes = await getEventTypes({ organizationId: scopedOrganizationId });
        const inventory = await Promise.all((eventTypes || []).map(async (eventType) => {
          const eventTypeId = String(eventType?.id || "").trim();
          if (!eventTypeId) return { categories: [], items: [] };
          const [categories, items] = await Promise.all([
            getMenuCategories(eventTypeId, { organizationId: scopedOrganizationId }),
            getMenuItems(eventTypeId, {
              includeInactive: true,
              organizationId: scopedOrganizationId
            })
          ]);
          return { categories, items };
        }));
        if (!alive) return;
        setConfirmedMenuRecoveryAvailable(hasNoMenuInventory(inventory));
      } catch {
        if (!alive) return;
        setConfirmedMenuRecoveryAvailable(false);
      } finally {
        if (alive) setConfirmedMenuRecoveryChecked(true);
      }
    }
    inspectConfirmedMenuInventory();
    return () => {
      alive = false;
    };
  }, [open, confirmedInventoryLoadScopeKey]);

  useEffect(() => {
    if (!open) return;
    if (!shouldInitializeView && eventMenuLoadScopeRef.current === eventMenuLoadScopeKey) return;
    eventMenuLoadScopeRef.current = eventMenuLoadScopeKey;
    const eventTypeId = String(selectedEventType || "").trim();
    if (!eventTypeId) {
      setMenuCategories([]);
      setMenuItems([]);
      setSelectedCategory("");
      return;
    }

    let alive = true;
    async function loadEventMenuData() {
      setMenuLoading(true);
      try {
        const [categories, items] = await Promise.all([
          getMenuCategories(eventTypeId, { organizationId: scopedOrganizationId }),
          getMenuItems(eventTypeId, { includeInactive: true, organizationId: scopedOrganizationId })
        ]);
        if (!alive) return;
        setMenuCategories(categories);
        applyManagedMenuItems(items);
        setSelectedCategory((current) => {
          const keepCurrent = current && categories.some((category) => category.id === current);
          if (keepCurrent) return current;
          return categories[0]?.id || "";
        });
      } catch (err) {
        if (!alive) return;
        setStatus(err?.message || "Failed to load menu categories/items.");
        pushToast(err?.message || "Failed to load menu categories/items.", "error");
      } finally {
        if (alive) setMenuLoading(false);
      }
    }

    loadEventMenuData();
    return () => {
      alive = false;
    };
  }, [open, eventMenuLoadScopeKey]);

  useEffect(() => {
    if (!open) return;
    const selected = menuEventTypes.find((eventType) => eventType.id === selectedEventType);
    setEventTypeEditName(selected?.name || "");
  }, [selectedEventType, menuEventTypes]);

  useEffect(() => {
    if (!open) return;
    const selected = menuCategories.find((category) => category.id === selectedCategory);
    setCategoryEditName(selected?.name || "");
  }, [selectedCategory, menuCategories]);

  const hasUnsavedChanges = catalogDraftFingerprint(draft, jsonDrafts) !== savedFingerprint;
  const hasPendingMenuEditorDraft = () => {
    const selectedEventTypeRecord = menuEventTypes.find((item) => item.id === selectedEventType);
    const selectedCategoryRecord = menuCategories.find((item) => item.id === selectedCategory);
    return Boolean(
      String(newEventTypeName || "").trim()
      || String(newCategoryName || "").trim()
      || String(newItemDraft.name || "").trim()
      || Number(newItemDraft.price || 0) !== 0
      || normalizePricingType(newItemDraft.pricingType, "per_event") !== "per_event"
      || newItemDraft.active === false
      || String(eventTypeEditName || "").trim()
        !== String(selectedEventTypeRecord?.name || "").trim()
      || String(categoryEditName || "").trim()
        !== String(selectedCategoryRecord?.name || "").trim()
    );
  };
  const blockManagedMenuMutationForDraft = (action, targetItemId) => {
    if (!hasUnrelatedManagedMenuDraft({
      catalogDraftDirty: hasUnsavedChanges,
      menuItemDirty,
      targetItemId,
      pendingMenuEditorDraft: hasPendingMenuEditorDraft()
    })) {
      return false;
    }
    const actionLabel = action === "delete" ? "deleting" : "deactivating";
    const message = `Save or finish the other Catalog Admin edits, or close and discard them, then reopen Catalog Admin before ${actionLabel} this menu item. No menu change was made.`;
    setStatus(message);
    pushToast(message, "error");
    return true;
  };
  const closeBlocked = Boolean(
    saving
    || uploadingLogo
    || menuActionLoading
    || menuItemSavingId
    || packActionId
  );
  const handleClose = () => {
    if (closeBlocked) {
      setStatus("Wait for the current catalog action to finish before closing.");
      return;
    }
    if (hasUnsavedChanges && !window.confirm("Discard unsaved catalog and branding changes?")) {
      return;
    }
    resetOnNextOpenRef.current = true;
    onClose();
  };
  const { dialogRef } = useModalDialog({
    open: open && !embedded,
    onRequestClose: handleClose,
    canClose: !closeBlocked,
    onCloseBlocked: () => setStatus("Wait for the current catalog action to finish before closing."),
    returnFocusRef
  });

  useEffect(() => {
    if (!open || !embedded || typeof window === "undefined") return undefined;
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [embedded, open]);

  if (!open) return null;

  const stagedPack = draft?.settings?.starterCatalogPack || {};
  const recoveryReplacementBlocked = stagedPack.replacementBlocked === true;
  const confirmedMissingMenuRecovery = confirmedMenuRecoveryChecked
    && confirmedMenuRecoveryAvailable
    && draft?.settings?.pricingSetupConfirmed === true;
  const pricingReviewRequired = Boolean(stagedPack.id)
    && draft?.settings?.pricingSetupConfirmed !== true;

  const handleApplyStarterPack = async (pack) => {
    if (typeof onApplyStarterPack !== "function") {
      setStatus("Starter pack application is unavailable.");
      return;
    }
    const replacing = Boolean(stagedPack.id) || confirmedMissingMenuRecovery;
    if (replacing && hasUnsavedChanges) {
      setStatus("Save or discard local catalog changes before replacing a staged pack.");
      return;
    }
    if (confirmedMissingMenuRecovery) {
      const confirmed = window.confirm(
        `Add the ${pack.name} starter catalog to repair this empty confirmed menu? `
        + "Existing catalog records and pricing settings will be preserved. Pricing confirmation will reopen because the catalog revision changes."
      );
      if (!confirmed) return;
    } else if (replacing && stagedPack.id !== pack.id) {
      const confirmed = window.confirm(
        `Replace the staged ${stagedPack.name || stagedPack.id} pack with ${pack.name}? `
        + "Replacement is allowed only when no generated record or suggested pricing setting has been edited."
      );
      if (!confirmed) return;
    }
    setPackActionId(pack.id);
    setStatus("");
    const result = await onApplyStarterPack({
      packId: pack.id,
      packVersion: pack.version,
      replaceStagedPack: replacing
    });
    setPackActionId("");
    if (!result?.ok) {
      setCatalogRefreshRequired(result?.refreshRequired === true);
      setStatus(result?.error || "Failed to apply starter catalog pack.");
      pushToast(result?.error || "Failed to apply starter catalog pack.", "error");
      return;
    }
    setCatalogRefreshRequired(false);
    const message = confirmedMissingMenuRecovery
      ? `${pack.name} added without replacing existing records or pricing settings. Review the recovered catalog and confirm pricing again.`
      : `${pack.name} staged. Review every suggested amount before confirming pricing.`;
    setActiveTab("menu");
    setStatus(message);
    pushToast(message, "success");
  };

  const patchArrayItem = (key, index, field, value) => {
    setDraft((prev) => {
      const next = { ...prev, [key]: [...prev[key]] };
      next[key][index] = { ...next[key][index], [field]: value };
      return next;
    });
  };

  const addRow = (key) => {
    const id = `${key}-${Date.now()}`;
    const template =
      key === "packages"
        ? {
            id,
            name: "",
            ppp: 0,
            costPpp: null,
            includedMenuItemIds: [],
            includedAddonIds: [],
            includedRentalIds: [],
            active: true
          }
      : key === "addons"
          ? {
              id,
              name: "New Add-on",
              pricingType: "per_person",
              type: "per_person",
              price: 0,
              cost: null,
              staffRole: "",
              active: true
            }
          : { id, name: "New Rental", pricingType: "per_item", type: "per_item", price: 0, cost: null, qtyPerGuests: 10, active: true };

    setDraft((prev) => ({ ...prev, [key]: [...prev[key], template] }));
  };

  const removeRow = (key, index) => {
    let eventTemplates;
    try {
      eventTemplates = parseEventTemplateDrafts(jsonDrafts.eventTemplates);
    } catch (err) {
      setActiveTab("pricing");
      setStatus(`Fix Event Templates JSON before deleting catalog records: ${err.message}`);
      return;
    }
    const removed = draft?.[key]?.[index];
    const next = removeCatalogRowWithInclusions({
      ...draft,
      settings: { ...draft.settings, eventTemplates }
    }, key, index);
    setDraft(next);
    setJsonDrafts((prev) => ({
      ...prev,
      eventTemplates: JSON.stringify(next.settings?.eventTemplates || [], null, 2)
    }));
    const label = String(removed?.name || removed?.id || "Catalog record").trim();
    setStatus(`${label} removed. Dependent package inclusions, recommendation rules, and event-template defaults were removed too. Save catalog changes to persist.`);
  };

  const togglePackageInclusion = (packageIndex, field, itemId, checked) => {
    const id = String(itemId || "").trim();
    if (!id) return;
    setDraft((prev) => {
      const packages = [...(prev.packages || [])];
      const current = { ...(packages[packageIndex] || {}) };
      const ids = new Set(Array.isArray(current[field]) ? current[field] : []);
      if (checked) ids.add(id);
      else ids.delete(id);
      current[field] = [...ids];
      packages[packageIndex] = current;
      return { ...prev, packages };
    });
  };

  const patchNumericSetting = (field, value) => {
    setDraft((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        [field]: Number(value || 0)
      }
    }));
  };

  // Unlike patchNumericSetting, blank must persist as "not recorded" (null),
  // not 0 — these back fail-closed margin math where an entered $0 and an
  // unrecorded rate are different facts.
  const patchNullableNumericSetting = (field, value) => {
    setDraft((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        [field]: value === "" || value === null || value === undefined ? null : Number(value)
      }
    }));
  };

  const patchTextSetting = (field, value) => {
    setDraft((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        [field]: value
      }
    }));
  };

  const selectPortalTheme = (preset) => {
    setDraft((prev) => ({
      ...prev,
      settings: applyPortalThemePreset(prev.settings, preset.id)
    }));
    setStatus(`${preset.name} selected. Review the preview, then save catalog changes.`);
  };

  const patchToggleSetting = (field, checked) => {
    setDraft((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        [field]: Boolean(checked)
      }
    }));
  };

  const patchFeatureFlag = (flagId, checked) => {
    setDraft((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        featureFlags: {
          ...(prev.settings?.featureFlags || {}),
          [flagId]: Boolean(checked)
        }
      }
    }));
  };

  const patchUpsellRule = (index, field, value) => {
    setDraft((prev) => {
      const rules = [...(prev.settings?.upsellRules || [])];
      const current = { ...(rules[index] || {}) };

      if (field === "enabled") {
        current.enabled = Boolean(value);
      } else if (field === "minGuests" || field === "minHours") {
        current[field] = Math.max(0, Number(value || 0));
      } else if (field === "kind") {
        current.kind = value;
        current.targetId =
          value === "rental"
            ? prev.rentals?.find((item) => item?.active !== false)?.id || ""
            : value === "package"
              ? ""
              : prev.addons?.find((item) => item?.active !== false)?.id || "";
        current.name = current.name || defaultRuleName(value);
      } else {
        current[field] = value;
      }

      rules[index] = current;
      return {
        ...prev,
        settings: {
          ...prev.settings,
          upsellRules: rules
        }
      };
    });
  };

  const addUpsellRule = () => {
    const fallbackAddon = draft.addons?.find((item) => item?.active !== false)?.id || "";
    const fallbackRental = draft.rentals?.find((item) => item?.active !== false)?.id || "";
    const activePackages = (draft.packages || []).filter((item) => item?.active !== false);
    if (!fallbackAddon && !fallbackRental && activePackages.length < 2) {
      const message = "Add active catalog choices before creating a recommendation rule.";
      setStatus(message);
      pushToast(message, "error");
      return;
    }
    const kind = fallbackAddon ? "addon" : fallbackRental ? "rental" : "package";
    const nextRule = {
      id: `upsell-rule-${Date.now()}`,
      name: "New recommendation rule",
      kind,
      targetId: fallbackAddon || fallbackRental || activePackages[1]?.id || "",
      enabled: true,
      minGuests: 0,
      minHours: 0,
      reason: "Upsell rule matched this quote."
    };

    setDraft((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        upsellRules: [...(prev.settings?.upsellRules || []), nextRule]
      }
    }));
  };

  const removeUpsellRule = (index) => {
    setDraft((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        upsellRules: (prev.settings?.upsellRules || []).filter((_, idx) => idx !== index)
      }
    }));
  };

  const getUpsellTargetOptions = (kind, selectedTargetId = "") => {
    const selectedId = String(selectedTargetId || "").trim();
    const optionFor = (item, label) => ({
      value: item.id,
      label: `${label}${item.active === false ? " (inactive — choose another target)" : ""}`
    });
    if (kind === "rental") {
      return (draft.rentals || [])
        .filter((item) => item?.active !== false || item.id === selectedId)
        .map((item) => optionFor(item, item.name));
    }
    if (kind === "package") {
      return (draft.packages || [])
        .filter((item) => item?.active !== false || item.id === selectedId)
        .map((item) => optionFor(item, `${item.name} (${item.ppp}/person)`));
    }
    return (draft.addons || [])
      .filter((item) => item?.active !== false || item.id === selectedId)
      .map((item) => optionFor(item, item.name));
  };

  const patchJsonDraft = (field, value) => {
    setJsonDrafts((prev) => ({ ...prev, [field]: value }));
  };

  const refreshEventTypes = async (preferredId = "") => {
    const items = await getEventTypes({ organizationId: scopedOrganizationId });
    setMenuEventTypes(items);
    const currentId = String(selectedEventType || "").trim();
    const nextId = resolveManagedEventTypeId(
      items,
      preferredId || currentId
    );
    setManagedEventType(nextId);
    return items;
  };

  const refreshEventMenuData = async (eventTypeId = selectedEventType) => {
    const nextEventTypeId = String(eventTypeId || "").trim();
    if (!nextEventTypeId) {
      setMenuCategories([]);
      setMenuItems([]);
      setSelectedCategory("");
      return;
    }
    const [categories, items] = await Promise.all([
      getMenuCategories(nextEventTypeId, { organizationId: scopedOrganizationId }),
      getMenuItems(nextEventTypeId, { includeInactive: true, organizationId: scopedOrganizationId })
    ]);
    setMenuCategories(categories);
    applyManagedMenuItems(items);
    setSelectedCategory((current) => {
      if (current && categories.some((category) => category.id === current)) return current;
      return categories[0]?.id || "";
    });
  };

  const handleCreateEventType = async () => {
    const name = String(newEventTypeName || "").trim();
    if (!name) {
      setStatus("Enter an event type name first.");
      return;
    }
    setMenuActionLoading(true);
    try {
      const created = await createEventType({ name, organizationId: scopedOrganizationId });
      onCatalogMutation?.(created);
      setNewEventTypeName("");
      await refreshEventTypes(created.id);
      await refreshEventMenuData(created.id);
      const seededLabel = created?.seeded
        ? ` Seeded ${Number(created.seeded.categories || 0)} categories and ${Number(created.seeded.items || 0)} items.`
        : "";
      setStatus(`Event type "${created.name}" added.${seededLabel}`);
      pushToast(`Event type "${created.name}" added.${seededLabel}`, "success");
    } catch (err) {
      setStatus(err?.message || "Failed to create event type.");
      pushToast(err?.message || "Failed to create event type.", "error");
    } finally {
      setMenuActionLoading(false);
    }
  };

  const handleCreateCategory = async () => {
    const name = String(newCategoryName || "").trim();
    if (!selectedEventType) {
      setStatus("Choose an event type before adding a category.");
      return;
    }
    if (!name) {
      setStatus("Enter a category name first.");
      return;
    }
    setMenuActionLoading(true);
    try {
      const created = await createCategory({
        eventTypeId: selectedEventType,
        name,
        organizationId: scopedOrganizationId
      });
      onCatalogMutation?.(created);
      setNewCategoryName("");
      await refreshEventMenuData(selectedEventType);
      setSelectedCategory(created.id);
      setStatus(`Category "${created.name}" added.`);
      pushToast(`Category "${created.name}" added.`, "success");
    } catch (err) {
      setStatus(err?.message || "Failed to create category.");
      pushToast(err?.message || "Failed to create category.", "error");
    } finally {
      setMenuActionLoading(false);
    }
  };

  const handleUpdateEventType = async () => {
    if (!selectedEventType) {
      setStatus("Choose an event type first.");
      return;
    }
    const name = String(eventTypeEditName || "").trim();
    if (!name) {
      setStatus("Event type name cannot be empty.");
      return;
    }

    setMenuActionLoading(true);
    try {
      const updated = await updateEventType(selectedEventType, { name, organizationId: scopedOrganizationId });
      onCatalogMutation?.(updated);
      await refreshEventTypes(selectedEventType);
      setStatus("Event type updated.");
      pushToast("Event type updated.", "success");
    } catch (err) {
      setStatus(err?.message || "Failed to update event type.");
      pushToast(err?.message || "Failed to update event type.", "error");
    } finally {
      setMenuActionLoading(false);
    }
  };

  const handleUpdateCategory = async () => {
    if (!selectedEventType || !selectedCategory) {
      setStatus("Choose event type and category first.");
      return;
    }
    const name = String(categoryEditName || "").trim();
    if (!name) {
      setStatus("Category name cannot be empty.");
      return;
    }

    setMenuActionLoading(true);
    try {
      const updated = await updateCategory(selectedCategory, {
        name,
        eventTypeId: selectedEventType,
        organizationId: scopedOrganizationId
      });
      onCatalogMutation?.(updated);
      await refreshEventMenuData(selectedEventType);
      setStatus("Category updated.");
      pushToast("Category updated.", "success");
    } catch (err) {
      setStatus(err?.message || "Failed to update category.");
      pushToast(err?.message || "Failed to update category.", "error");
    } finally {
      setMenuActionLoading(false);
    }
  };

  const handleCreateMenuItem = async () => {
    const name = String(newItemDraft.name || "").trim();
    if (!selectedEventType || !selectedCategory) {
      setStatus("Choose event type and category before adding an item.");
      return;
    }
    if (!name) {
      setStatus("Enter a menu item name first.");
      return;
    }
    setMenuActionLoading(true);
    try {
      const created = await createMenuItem({
        eventTypeId: selectedEventType,
        categoryId: selectedCategory,
        name,
        price: Number(newItemDraft.price || 0),
        pricingType: normalizePricingType(newItemDraft.pricingType, "per_event"),
        active: newItemDraft.active !== false,
        organizationId: scopedOrganizationId
      });
      onCatalogMutation?.(created);
      setNewItemDraft({ name: "", price: 0, pricingType: "per_event", active: true });
      await refreshEventMenuData(selectedEventType);
      setStatus("Menu item added.");
      pushToast("Menu item added.", "success");
    } catch (err) {
      setStatus(err?.message || "Failed to add menu item.");
      pushToast(err?.message || "Failed to add menu item.", "error");
    } finally {
      setMenuActionLoading(false);
    }
  };

  const patchManagedMenuItem = (id, field, value) => {
    setMenuItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        if (field === "pricingType") {
          const pricingType = normalizePricingType(value, "per_event");
          return { ...item, pricingType, type: pricingType };
        }
        if (field === "active") {
          return { ...item, active: Boolean(value) };
        }
        if (field === "price") {
          return { ...item, price: Number(value || 0) };
        }
        return { ...item, [field]: value };
      })
    );
    setMenuItemDirty((prev) => ({ ...prev, [id]: true }));
  };

  const handleUpdateManagedMenuItem = async (item) => {
    const itemId = String(item?.id || "").trim();
    if (!itemId || menuItemSaveInFlightRef.current.has(itemId)) return;
    if (
      item?.active === false
      && blockManagedMenuMutationForDraft("deactivate", itemId)
    ) {
      const baseline = menuItemBaselines[itemId];
      if (baseline) {
        const revertedItem = { ...item, active: baseline.active !== false };
        const stillDirty = (
          String(revertedItem.name || "").trim() !== String(baseline.name || "").trim()
          || Number(revertedItem.price || 0) !== Number(baseline.price || 0)
          || normalizePricingType(revertedItem.pricingType || revertedItem.type, "per_event")
            !== normalizePricingType(baseline.pricingType || baseline.type, "per_event")
        );
        setMenuItems((prev) => prev.map((entry) => (
          entry.id === itemId ? revertedItem : entry
        )));
        setMenuItemDirty((prev) => {
          const next = { ...prev };
          if (stillDirty) next[itemId] = true;
          else delete next[itemId];
          return next;
        });
      }
      return;
    }
    menuItemSaveInFlightRef.current.add(itemId);
    setMenuItemSavingId(itemId);
    try {
      const pricingType = normalizePricingType(item.pricingType || item.type, "per_event");
      const nextPayload = {
        name: String(item.name || "").trim() || "Untitled Item",
        price: Number(item.price || 0),
        pricingType,
        active: item.active !== false
      };
      const updated = await updateMenuItem(item.id, {
        ...nextPayload,
        eventTypeId: selectedEventType,
        categoryId: selectedCategory || item.categoryId,
        organizationId: scopedOrganizationId,
        expectedCatalogRevision: catalogRevision
      });
      if (updated?.authoritativeMutation) {
        onReload?.();
      } else {
        onCatalogMutation?.(updated);
      }
      setMenuItems((prev) =>
        prev.map((entry) =>
          entry.id === itemId
            ? {
              ...entry,
              ...nextPayload,
              type: pricingType
            }
            : entry
        )
      );
      setMenuItemBaselines((prev) => ({
        ...prev,
        [itemId]: {
          ...(prev[itemId] || item),
          ...nextPayload,
          type: pricingType
        }
      }));
      setMenuItemDirty((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      const successMessage = updated?.authoritativeMutation
        ? "Menu item deactivated. Pricing review reopened for the new catalog revision."
        : "Menu item updated.";
      setStatus(successMessage);
      pushToast(successMessage, "success");
    } catch (err) {
      const revisionConflict = isMenuCatalogRevisionConflict(err);
      const errorMessage = revisionConflict
        ? `${err?.message || "Catalog revision changed."} Refreshing the latest catalog before retry.`
        : err?.message || "Failed to update menu item.";
      if (revisionConflict) onReload?.();
      setStatus(errorMessage);
      const baseline = menuItemBaselines[itemId];
      if (baseline) {
        setMenuItems((prev) => prev.map((entry) => (entry.id === itemId ? { ...baseline } : entry)));
      }
      setMenuItemDirty((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      pushToast(errorMessage, "error");
    } finally {
      menuItemSaveInFlightRef.current.delete(itemId);
      setMenuItemSavingId("");
    }
  };

  const handleManagedMenuItemBlur = (itemId) => {
    if (!menuItemDirty[itemId]) return;
    const current = menuItems.find((entry) => entry.id === itemId);
    if (!current) return;
    handleUpdateManagedMenuItem(current);
  };

  const handleManagedMenuItemKeyDown = (event, itemId) => {
    if (!itemId) return;
    blurManagedMenuItemOnEnter(event);
  };

  const handleDeleteManagedMenuItem = async (id) => {
    if (blockManagedMenuMutationForDraft("delete", id)) return;
    let draftEventTemplates;
    try {
      draftEventTemplates = parseEventTemplateDrafts(jsonDrafts.eventTemplates);
    } catch (err) {
      const message = `Fix Event Templates JSON before deleting menu items: ${err.message}`;
      setActiveTab("pricing");
      setStatus(message);
      pushToast(message, "error");
      return;
    }
    const packageReferences = [
      ...packageMenuItemReferences(catalog.packages, id),
      ...packageMenuItemReferences(draft.packages, id)
    ].filter((pkg, index, all) => all.findIndex((item) => item.id === pkg.id) === index);
    const templateReferences = [
      ...eventTemplateMenuItemReferences(catalog.settings?.eventTemplates, id),
      ...eventTemplateMenuItemReferences(draftEventTemplates, id)
    ].filter((template, index, all) => (
      all.findIndex((item) => item.id === template.id) === index
    ));
    if (packageReferences.length > 0 || templateReferences.length > 0) {
      const packageNames = packageReferences
        .map((pkg) => String(pkg.name || pkg.id || "package").trim())
        .filter(Boolean)
        .join(", ");
      const templateNames = templateReferences
        .map((template) => String(template.name || template.id || "event template").trim())
        .filter(Boolean)
        .join(", ");
      const dependencies = [
        packageNames ? `packages: ${packageNames}` : "",
        templateNames ? `event templates: ${templateNames}` : ""
      ].filter(Boolean).join("; ");
      const message = `Remove this menu item from ${dependencies}, save those catalog changes, then reopen Catalog Admin to delete it.`;
      setActiveTab(packageReferences.length > 0 ? "packages" : "pricing");
      setStatus(message);
      pushToast(message, "error");
      return;
    }
    setMenuActionLoading(true);
    try {
      await deleteMenuItem(id, {
        organizationId: scopedOrganizationId,
        expectedCatalogRevision: catalogRevision
      });
      onReload?.();
      setStatus("Menu item deleted. Pricing review reopened for the new catalog revision.");
      pushToast("Menu item deleted. Pricing review reopened for the new catalog revision.", "success");
    } catch (err) {
      const revisionConflict = isMenuCatalogRevisionConflict(err);
      const errorMessage = revisionConflict
        ? `${err?.message || "Catalog revision changed."} Refreshing the latest catalog before retry.`
        : err?.message || "Failed to delete menu item.";
      if (revisionConflict) onReload?.();
      setStatus(errorMessage);
      pushToast(errorMessage, "error");
    } finally {
      setMenuActionLoading(false);
    }
  };

  const handleLogoUpload = async (file) => {
    if (!file) return;
    if (!String(file.type || "").startsWith("image/")) {
      setStatus("Logo upload failed: choose an image file.");
      return;
    }

    setUploadingLogo(true);
    try {
      if (firebaseReady && storage) {
        const safeName = String(file.name || "logo").replace(/[^\w.-]+/g, "_");
        const path = `brand-assets/logos/${Date.now()}-${safeName}`;
        const logoRef = storageRef(storage, path);
        await uploadBytes(logoRef, file, { contentType: file.type || "image/png" });
        const downloadUrl = await getDownloadURL(logoRef);
        patchTextSetting("brandLogoUrl", downloadUrl);
        setStatus("Logo uploaded. Click Save Catalog to persist.");
      } else {
        const dataUrl = await toDataUrl(file);
        patchTextSetting("brandLogoUrl", dataUrl);
        setStatus("Logo loaded locally. Click Save Catalog to persist.");
      }
    } catch (err) {
      setStatus(err?.message || "Logo upload failed.");
    } finally {
      setUploadingLogo(false);
    }
  };

  const parseJsonArray = (field, label) => {
    try {
      const parsed = JSON.parse(jsonDrafts[field] || "[]");
      if (!Array.isArray(parsed)) {
        throw new Error("Must be a JSON array.");
      }
      return parsed;
    } catch (err) {
      throw new Error(`${label}: ${err.message}`);
    }
  };

  const handleSave = async () => {
    try {
      const serviceFeeTiers = parseJsonArray("serviceFeeTiers", "Service Fee Tiers JSON");
      const taxRegions = parseJsonArray("taxRegions", "Tax Regions JSON");
      const eventTemplates = parseEventTemplateDrafts(jsonDrafts.eventTemplates);
      const seasonalProfiles = parseJsonArray("seasonalProfiles", "Seasonal Profiles JSON");
      const brandCrew = parseJsonArray("brandCrew", "Brand Crew JSON");
      const featureFlagsLocked = draft.settings?.featureFlagsLocked === true;
      const normalizedFeatureFlags = {
        ...(draft.settings?.featureFlags || {})
      };
      if (!featureFlagsLocked && normalizedFeatureFlags.aiAssist === false) {
        normalizedFeatureFlags.aiAutopilot = false;
      }

      const nextDraft = {
        ...draft,
        settings: {
          ...draft.settings,
          featureFlags: normalizedFeatureFlags,
          serviceFeeTiers,
          taxRegions,
          eventTemplates,
          seasonalProfiles,
          brandCrew
        }
      };

      const result = await onSave(nextDraft);
      if (result.ok) {
        setCatalogRefreshRequired(false);
        setDraft(nextDraft);
        setSavedFingerprint(catalogDraftFingerprint(nextDraft, jsonDrafts));
        setStatus("Catalog saved.");
        pushToast("Catalog saved.", "success");
        return;
      }
      setCatalogRefreshRequired(result?.refreshRequired === true);
      setStatus(result.error || "Save failed.");
      pushToast(result.error || "Save failed.", "error");
    } catch (err) {
      setStatus(err?.message || "Invalid JSON in advanced settings.");
      pushToast(err?.message || "Invalid JSON in advanced settings.", "error");
    }
  };

  // Derived, canonical save-state marker (docs/capability-surfacing-contracts.json
  // #catalog-cost-and-pricing-data-entry). Mirrors useCatalogData.js's saveCatalog
  // real outcomes rather than inventing new ones: a concurrent-edit conflict that
  // reload confirmed is "reconciliation"; a save whose revision matched but whose
  // secondary pricing confirmation did not land is "uncertain" (data is saved, one
  // fact about it is not yet confirmed); a reload-itself failure needing a manual
  // refresh is "recovery"; anything else non-empty while idle is a plain "error".
  const catalogSaveCapabilityState = saving
    ? "submitting"
    : status === "Catalog saved."
      ? "receipt"
      : catalogRefreshRequired
        ? "recovery"
        : status.includes("pricing is not confirmed for that revision")
          ? "uncertain"
          : status.includes("Catalog changed while the save was in progress")
            ? "reconciliation"
            : status && status !== "Your changes are not saved yet." && status !== "Settings are up to date."
              ? "error"
              : "ready";

  const selectedCategoryItems = menuItems.filter((item) => item.categoryId === selectedCategory);
  const featureFlagsLocked = draft.settings?.featureFlagsLocked === true;
  const featureFlagsPaid = Array.isArray(draft.settings?.featureFlagsPaid)
    ? draft.settings.featureFlagsPaid.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const paidFeatureIdSet = new Set(featureFlagsPaid);
  const enforceOrderFeatureAccess = featureFlagsLocked;
  const isFeatureEnabled = (featureId) => {
    if (enforceOrderFeatureAccess && !paidFeatureIdSet.has(featureId)) return false;
    return draft.settings?.featureFlags?.[featureId] !== false;
  };
  const getFeatureAccessLabel = (featureId) => {
    if (!enforceOrderFeatureAccess) return "Editable in this catalog.";
    return paidFeatureIdSet.has(featureId)
      ? "Included in order (read only)."
      : "Not included in order (read only).";
  };
  const selectedPortalTheme = findPortalThemePreset(draft?.settings);
  const portalThemePreviewStyle = buildPortalThemeStyle(draft?.settings);
  const hasCatalogContent = Boolean(
    stagedPack.id
    || draft?.packages?.length
    || draft?.addons?.length
    || draft?.rentals?.length
    || menuEventTypes.length
  );
  const starterChoiceOnly = !hasCatalogContent && !manualSetupEnabled;
  const visibleAdminTabs = starterChoiceOnly
    ? ADMIN_TABS.filter((tab) => tab.id === "starter")
    : ADMIN_TABS.filter(
      (tab) => tab.id !== "starter"
        || ((!recoveryReplacementBlocked && draft?.settings?.pricingSetupConfirmed !== true)
          || confirmedMissingMenuRecovery)
    );
  const handleReload = () => {
    if (typeof onReload !== "function") {
      setStatus("Catalog refresh is unavailable. Close and reopen Catalog Admin.");
      return;
    }
    setStatus("Refreshing the latest catalog from the server...");
    onReload();
  };
  return (
    <div
      ref={dialogRef}
      className={embedded ? "container workspace-route-main embedded-workspace-route" : "modal-overlay"}
      role={embedded ? "region" : "dialog"}
      aria-modal={embedded ? undefined : "true"}
      aria-labelledby="catalog-admin-title"
      tabIndex={-1}
    >
      <div className={`modal-card admin-catalog-card${embedded ? " workspace-route-card" : ""}`}>
        <div className="modal-head">
          <h2 id="catalog-admin-title">Catalog Admin</h2>
          <div className="admin-save-actions">
            <span className={hasUnsavedChanges ? "admin-save-state unsaved" : "admin-save-state"}>
              {saving ? "Saving…" : hasUnsavedChanges ? "Unsaved changes" : status === "Catalog saved." ? "Saved" : "No pending changes"}
            </span>
            {!starterChoiceOnly && (
              <button type="button" className="cta" onClick={handleSave} disabled={saving || !hasUnsavedChanges}>
                {saving ? "Saving..." : "Save catalog changes"}
              </button>
            )}
            <button
              type="button"
              className="ghost"
              data-modal-initial-focus
              onClick={handleClose}
              disabled={closeBlocked}
            >
              {embedded ? "Back to Home" : "Close"}
            </button>
          </div>
        </div>

        <div className="admin-tabs" role="tablist" aria-label="Catalog admin sections">
          {visibleAdminTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`admin-tab ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {pricingReviewRequired && (
          <div className="starter-pack-review-banner" role="status">
            <strong>{stagedPack.name || "Starter pack"} is a draft.</strong>
            <span> Suggested prices are not active until an admin reviews the complete catalog and confirms pricing.</span>
          </div>
        )}

        {confirmedMissingMenuRecovery && (
          <div className="starter-pack-review-banner" role="alert">
            <div>
              <strong>This confirmed catalog has no menu.</strong>
              <span> Choose a starter pack to add only missing catalog records. Existing records and pricing settings stay unchanged, and pricing must be confirmed again after recovery.</span>
            </div>
            <button type="button" className="cta" onClick={() => setActiveTab("starter")}>
              Choose a recovery pack
            </button>
          </div>
        )}

        {stagedPack.id && (
          <div className="starter-pack-populated-banner" role="status">
            <div>
              <strong>Your {stagedPack.name || "starter"} catalog is populated.</strong>
              <span>{recoveryReplacementBlocked
                ? " Missing starter records were added without replacing your existing catalog or pricing settings. Continue review and confirm this catalog revision."
                : " Menu, packages, add-ons, rentals, and staffing are ready to review."}</span>
            </div>
            <button type="button" className="ghost" onClick={() => setActiveTab("menu")}>View populated menu</button>
          </div>
        )}

        {activeTab === "starter" && (
          draft?.settings?.pricingSetupConfirmed !== true || confirmedMissingMenuRecovery
        ) && (
          <section className="admin-section">
            <div className="admin-section-head"><h3>What kind of catering do you do most?</h3></div>
            <div className="admin-section-body">
              <div className="starter-pack-intro">
                <p>{confirmedMissingMenuRecovery
                  ? "Choose the closest fit to restore the missing menu and add any other missing starter records."
                  : "Choose the closest fit. We will immediately fill your menu, packages, add-ons, rentals, and staffing setup."}</p>
                <p className="source-note">{confirmedMissingMenuRecovery
                  ? "This additive recovery does not replace existing records or pricing settings. It reopens pricing review for the new catalog revision."
                  : "Everything remains editable. Suggested prices stay locked from quoting until you review and confirm them."}</p>
              </div>
              <div className="starter-pack-grid">
                {STARTER_CATALOG_PACKS.map((pack) => {
                  const selected = stagedPack.id === pack.id && Number(stagedPack.version) === pack.version;
                  return (
                    <article className={`starter-pack-card ${selected ? "selected" : ""}`} key={`${pack.id}-${pack.version}`}>
                      <div>
                        <span className="eyebrow">Starter catalog</span>
                        <h4>{pack.name}</h4>
                        <p className="starter-pack-fit"><strong>Best for:</strong> {pack.bestFor}</p>
                        <p>{pack.outcome}</p>
                      </div>
                      <div className="starter-pack-includes" aria-label={`${pack.name} contents`}>
                        <span>{pack.counts.menuItems} menu items</span>
                        <span>{pack.counts.packages} packages</span>
                        <span>{pack.counts.addons} add-ons</span>
                        <span>{pack.counts.rentals} rentals</span>
                      </div>
                      <button
                        type="button"
                        className={selected ? "ghost" : "cta"}
                        onClick={() => handleApplyStarterPack(pack)}
                        disabled={saving
                          || Boolean(packActionId)
                          || selected
                          || (draft?.settings?.pricingSetupConfirmed === true && !confirmedMissingMenuRecovery)}
                      >
                        {packActionId === pack.id
                          ? "Populating your catalog..."
                          : selected
                            ? "Catalog populated"
                            : confirmedMissingMenuRecovery
                              ? `Recover with ${pack.name}`
                            : stagedPack.id
                              ? `Switch to ${pack.name}`
                              : `Use ${pack.name}`}
                      </button>
                    </article>
                  );
                })}
              </div>
              {draft?.settings?.pricingSetupConfirmed === true && !confirmedMissingMenuRecovery && (
                <p className="warning-note">Starter packs are available only during initial unconfirmed catalog setup.</p>
              )}
              {starterChoiceOnly && (
                <div className="starter-pack-manual-path">
                  <span>None of these fit?</span>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      setManualSetupEnabled(true);
                      setActiveTab("packages");
                    }}
                  >Build my catalog manually</button>
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === "packages" && (
          <Section title="Packages" onAdd={() => addRow("packages")}>
          <p className="source-note">
            Choose which catalog items the package price can cover. These items are not added to a quote automatically: the quote builder must select each one, and selected inclusions are charged $0.
          </p>
          <label className="admin-package-menu-filter">
            Menu event type for package inclusions
            <select
              value={selectedEventType}
              onChange={(event) => setManagedEventType(event.target.value)}
              disabled={menuLoading}
            >
              <option value="">Choose event type</option>
              {menuEventTypes.map((eventType) => (
                <option key={eventType.id} value={eventType.id}>{eventType.name}</option>
              ))}
            </select>
          </label>
          <div className="admin-row admin-row-headings" aria-hidden="true">
            <span>Package ID</span>
            <span>Display Name</span>
            <span>Price Per Person</span>
            {PILOT_MARGINS_ENABLED && <span>Cost Per Person</span>}
            <span>Active</span>
            <span>Actions</span>
          </div>
          {draft.packages.map((item, i) => (
            <div className="admin-package-editor" key={item.id}>
              <div className="admin-row">
                <input aria-label={`Package ${i + 1} ID`} value={item.id} disabled />
                <input
                  aria-label={`Package ${i + 1} name`}
                  placeholder="Customer package name"
                  value={item.name}
                  onChange={(e) => patchArrayItem("packages", i, "name", e.target.value)}
                />
                <input
                  aria-label={`Package ${i + 1} price per person`}
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.ppp}
                  onChange={(e) => patchArrayItem("packages", i, "ppp", Number(e.target.value))}
                />
                {PILOT_MARGINS_ENABLED && (
                  <input
                    aria-label={`Package ${i + 1} cost per person`}
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Not recorded"
                    value={item.costPpp ?? ""}
                    onChange={(e) => patchArrayItem("packages", i, "costPpp", e.target.value === "" ? null : Number(e.target.value))}
                  />
                )}
                <label className="admin-inline-toggle">
                  <span>Active</span>
                  <input
                    type="checkbox"
                    aria-label={`Package ${i + 1} active`}
                    checked={item.active !== false}
                    onChange={(e) => patchArrayItem("packages", i, "active", e.target.checked)}
                  />
                </label>
                <button type="button" className="ghost" onClick={() => removeRow("packages", i)}>Delete</button>
              </div>
              <div className="package-inclusion-editor" aria-label={`${item.name || `Package ${i + 1}`} inclusions`}>
                {[
                  ["includedMenuItemIds", "Menu items", menuItems],
                  ["includedAddonIds", "Add-ons", draft.addons || []],
                  ["includedRentalIds", "Rentals", draft.rentals || []]
                ].map(([field, label, options]) => {
                  const includedIds = new Set(item[field] || []);
                  const availableOptions = options.filter((option) => (
                    option.active !== false || includedIds.has(option.id)
                  ));
                  return (
                    <fieldset key={field}>
                      <legend>{label} available at no added charge</legend>
                      {availableOptions.length === 0 ? (
                        <small>{field === "includedMenuItemIds" ? "Choose an event type with menu items." : `No active ${label.toLowerCase()} available.`}</small>
                      ) : availableOptions.map((option) => (
                        <label key={option.id} className="admin-inline-toggle">
                          <input
                            type="checkbox"
                            checked={includedIds.has(option.id)}
                            onChange={(event) => togglePackageInclusion(i, field, option.id, event.target.checked)}
                          />
                          <span>
                            {option.name}
                            {option.active === false ? " (inactive — remove from this package before saving)" : ""}
                          </span>
                        </label>
                      ))}
                    </fieldset>
                  );
                })}
              </div>
            </div>
          ))}
          </Section>
        )}

        {activeTab === "addons" && (
          <Section title="Add-ons" onAdd={() => addRow("addons")}>
          <p className="source-note">
            Add-ons are <strong>price-only</strong> and do not change server/chef/bartender counts.
            Use quantity with <code>per_item</code> pricing when you need multiple units.
          </p>
          <div className="admin-row admin-row-headings" aria-hidden="true">
            <span>Item ID</span>
            <span>Display Name</span>
            <span>Pricing Type</span>
            <span>Price</span>
            {PILOT_MARGINS_ENABLED && <span>Cost</span>}
            <span>Active</span>
            {PILOT_DECISION_ROOM_ENABLED && <span>Portal offer</span>}
            <span>Actions</span>
          </div>
          {draft.addons.map((item, i) => (
            <div className="admin-row" key={item.id}>
              <input value={item.id} disabled />
              <input value={item.name} onChange={(e) => patchArrayItem("addons", i, "name", e.target.value)} />
              <select
                value={item.pricingType || item.type || "per_person"}
                onChange={(e) => {
                  const pricingType = normalizePricingType(e.target.value, "per_person");
                  patchArrayItem("addons", i, "pricingType", pricingType);
                  patchArrayItem("addons", i, "type", pricingType);
                }}
              >
                <option value="per_person">per_person</option>
                <option value="per_item">per_item</option>
                <option value="per_event">per_event</option>
              </select>
              <input type="number" value={item.price} onChange={(e) => patchArrayItem("addons", i, "price", Number(e.target.value))} />
              {PILOT_MARGINS_ENABLED && (
                <input
                  aria-label={`${item.name || `Add-on ${i + 1}`} cost`}
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Not recorded"
                  value={item.cost ?? ""}
                  onChange={(e) => patchArrayItem("addons", i, "cost", e.target.value === "" ? null : Number(e.target.value))}
                />
              )}
              <label className="admin-inline-toggle">
                <span>Active</span>
                <input
                  type="checkbox"
                  checked={item.active !== false}
                  onChange={(e) => patchArrayItem("addons", i, "active", e.target.checked)}
                />
              </label>
              {PILOT_DECISION_ROOM_ENABLED && (
                <label className="admin-inline-toggle">
                  <span>Portal offer</span>
                  <input
                    type="checkbox"
                    aria-label={`Offer ${item.name || `add-on ${i + 1}`} as a decidable option in the customer portal`}
                    checked={item.portalDecidable === true}
                    onChange={(e) => patchArrayItem("addons", i, "portalDecidable", e.target.checked)}
                  />
                </label>
              )}
              <button type="button" className="ghost" onClick={() => removeRow("addons", i)}>Delete</button>
            </div>
          ))}
          </Section>
        )}

        {activeTab === "rentals" && (
          <Section title="Rentals" onAdd={() => addRow("rentals")}>
          {draft.rentals.map((item, i) => (
            <div className="admin-row" key={item.id}>
              <input value={item.id} disabled />
              <input value={item.name} onChange={(e) => patchArrayItem("rentals", i, "name", e.target.value)} />
              <select
                value={item.pricingType || item.type || "per_item"}
                onChange={(e) => {
                  const pricingType = normalizePricingType(e.target.value, "per_item");
                  patchArrayItem("rentals", i, "pricingType", pricingType);
                  patchArrayItem("rentals", i, "type", pricingType);
                }}
              >
                <option value="per_item">per_item</option>
                <option value="per_person">per_person</option>
                <option value="per_event">per_event</option>
              </select>
              <input type="number" value={item.price} onChange={(e) => patchArrayItem("rentals", i, "price", Number(e.target.value))} />
              {PILOT_MARGINS_ENABLED && (
                <input
                  aria-label={`${item.name || `Rental ${i + 1}`} cost`}
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Not recorded"
                  value={item.cost ?? ""}
                  onChange={(e) => patchArrayItem("rentals", i, "cost", e.target.value === "" ? null : Number(e.target.value))}
                />
              )}
              <input type="number" value={item.qtyPerGuests} onChange={(e) => patchArrayItem("rentals", i, "qtyPerGuests", Number(e.target.value))} />
              <label className="admin-inline-toggle">
                <span>Active</span>
                <input
                  type="checkbox"
                  checked={item.active !== false}
                  onChange={(e) => patchArrayItem("rentals", i, "active", e.target.checked)}
                />
              </label>
              {PILOT_DECISION_ROOM_ENABLED && (
                <label className="admin-inline-toggle">
                  <span>Portal offer</span>
                  <input
                    type="checkbox"
                    aria-label={`Offer ${item.name || `rental ${i + 1}`} as a decidable option in the customer portal`}
                    checked={item.portalDecidable === true}
                    onChange={(e) => patchArrayItem("rentals", i, "portalDecidable", e.target.checked)}
                  />
                </label>
              )}
              <button type="button" className="ghost" onClick={() => removeRow("rentals", i)}>Delete</button>
            </div>
          ))}
          </Section>
        )}

        {activeTab === "menu" && (
          <section className="admin-section">
          <div className="admin-section-head"><h3>Menu Management</h3></div>
          <div className="admin-section-body">
            <div className="admin-menu-management-grid">
              <label>
                Event type
                <select
                  value={selectedEventType}
                  onChange={(e) => setManagedEventType(e.target.value)}
                  disabled={menuLoading}
                >
                  <option value="">Choose event type</option>
                  {menuEventTypes.map((eventType) => (
                    <option key={eventType.id} value={eventType.id}>{eventType.name}</option>
                  ))}
                </select>
              </label>
              <div className="admin-inline-actions">
                <input
                  type="text"
                  placeholder="Edit selected event type"
                  value={eventTypeEditName}
                  onChange={(e) => setEventTypeEditName(e.target.value)}
                  disabled={!selectedEventType || menuLoading}
                />
                <button
                  type="button"
                  className="ghost compact"
                  onClick={handleUpdateEventType}
                  disabled={menuActionLoading || !selectedEventType}
                >
                  {menuActionLoading ? "Saving..." : "Save Event Type"}
                </button>
              </div>
              <div className="admin-inline-actions">
                <input
                  type="text"
                  placeholder="New event type"
                  value={newEventTypeName}
                  onChange={(e) => setNewEventTypeName(e.target.value)}
                />
                <button type="button" className="ghost compact" onClick={handleCreateEventType} disabled={menuActionLoading}>
                  {menuActionLoading ? "Saving..." : "Add Event Type"}
                </button>
              </div>
            </div>

            <div className="admin-menu-management-grid">
              <label>
                Category
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  disabled={!selectedEventType || menuLoading}
                >
                  <option value="">Choose category</option>
                  {menuCategories.map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
              </label>
              <div className="admin-inline-actions">
                <input
                  type="text"
                  placeholder="Edit selected category"
                  value={categoryEditName}
                  onChange={(e) => setCategoryEditName(e.target.value)}
                  disabled={!selectedCategory}
                />
                <button
                  type="button"
                  className="ghost compact"
                  onClick={handleUpdateCategory}
                  disabled={menuActionLoading || !selectedCategory}
                >
                  {menuActionLoading ? "Saving..." : "Save Category"}
                </button>
              </div>
              <div className="admin-inline-actions">
                <input
                  type="text"
                  placeholder="New category"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  disabled={!selectedEventType}
                />
                <button type="button" className="ghost compact" onClick={handleCreateCategory} disabled={menuActionLoading || !selectedEventType}>
                  {menuActionLoading ? "Saving..." : "Add Category"}
                </button>
              </div>
            </div>

            <div className="admin-inline-actions admin-inline-actions-create-item">
              <input
                type="text"
                placeholder="New item name"
                value={newItemDraft.name}
                onChange={(e) => setNewItemDraft((prev) => ({ ...prev, name: e.target.value }))}
                disabled={!selectedCategory}
              />
              <input
                type="number"
                step="0.01"
                value={Number(newItemDraft.price || 0)}
                onChange={(e) => setNewItemDraft((prev) => ({ ...prev, price: Number(e.target.value) }))}
                disabled={!selectedCategory}
              />
              <select
                value={newItemDraft.pricingType}
                onChange={(e) =>
                  setNewItemDraft((prev) => ({
                    ...prev,
                    pricingType: normalizePricingType(e.target.value, "per_event")
                  }))
                }
                disabled={!selectedCategory}
              >
                <option value="per_event">per_event</option>
                <option value="per_person">per_person</option>
                <option value="per_item">per_item</option>
              </select>
              <label className="admin-inline-toggle">
                <span>Active</span>
                <input
                  type="checkbox"
                  checked={newItemDraft.active !== false}
                  onChange={(e) => setNewItemDraft((prev) => ({ ...prev, active: e.target.checked }))}
                  disabled={!selectedCategory}
                />
              </label>
              <button type="button" className="ghost compact" onClick={handleCreateMenuItem} disabled={menuActionLoading || !selectedCategory}>
                {menuActionLoading ? "Saving..." : "Add Item"}
              </button>
            </div>

            {menuLoading && <p className="source-note">Loading menu data...</p>}
            {!menuLoading && selectedCategory && selectedCategoryItems.length === 0 && (
              <p className="source-note">No menu items in this category yet.</p>
            )}

            {!menuLoading && selectedCategoryItems.map((item) => (
              <div className="admin-menu-row admin-menu-row-managed" key={item.id}>
                <input value={item.id || ""} disabled />
                <input
                  type="text"
                  value={item.name || ""}
                  onChange={(e) => patchManagedMenuItem(item.id, "name", e.target.value)}
                  onBlur={() => handleManagedMenuItemBlur(item.id)}
                  onKeyDown={(e) => handleManagedMenuItemKeyDown(e, item.id)}
                />
                <select
                  value={item.pricingType || item.type || "per_event"}
                  onChange={(e) => patchManagedMenuItem(item.id, "pricingType", e.target.value)}
                  onBlur={() => handleManagedMenuItemBlur(item.id)}
                  onKeyDown={(e) => handleManagedMenuItemKeyDown(e, item.id)}
                >
                  <option value="per_event">per_event</option>
                  <option value="per_person">per_person</option>
                  <option value="per_item">per_item</option>
                </select>
                <input
                  type="number"
                  step="0.01"
                  value={Number(item.price || 0)}
                  onChange={(e) => patchManagedMenuItem(item.id, "price", e.target.value)}
                  onBlur={() => handleManagedMenuItemBlur(item.id)}
                  onKeyDown={(e) => handleManagedMenuItemKeyDown(e, item.id)}
                />
                <label className="admin-inline-toggle">
                  <span>Active</span>
                  <input
                    type="checkbox"
                    checked={item.active !== false}
                    onChange={(e) => patchManagedMenuItem(item.id, "active", e.target.checked)}
                    onBlur={() => handleManagedMenuItemBlur(item.id)}
                  />
                </label>
                <span className="admin-row-state">
                  {menuItemSavingId === item.id ? "Saving..." : (menuItemDirty[item.id] ? "Unsaved" : "Saved")}
                </span>
                <button
                  type="button"
                  className="ghost compact"
                  onClick={() => handleDeleteManagedMenuItem(item.id)}
                  disabled={menuActionLoading}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </section>
        )}

        {activeTab === "pricing" && (
          <>
            <section className="admin-section">
              <div className="admin-section-head"><h3>Pricing Review Required</h3></div>
              <div className="admin-section-body">
                <p className="source-note">
                  Review every fee, tax, deposit, travel, staffing, tier, and seasonal value below for this organization. These values affect customer totals.
                </p>
                <label className="admin-inline-toggle">
                  <span>I reviewed and approve this organization&apos;s pricing settings.</span>
                  <input
                    type="checkbox"
                    aria-label="Pricing setup reviewed and approved"
                    checked={draft.settings?.pricingSetupConfirmed === true}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setDraft((prev) => ({
                        ...prev,
                        settings: {
                          ...prev.settings,
                          pricingSetupConfirmed: checked
                        }
                      }));
                    }}
                  />
                </label>
              </div>
            </section>

            <section className="admin-section">
          <div className="admin-section-head"><h3>Numeric Settings</h3></div>
          <div className="admin-grid-settings">
            <label>
              Per-mile rate
              <small className="admin-field-hint">Travel charge per mile up to the delivery threshold. Shown in Travel / Logistics.</small>
              <input type="number" step="0.01" value={draft.settings.perMileRate} onChange={(e) => patchNumericSetting("perMileRate", e.target.value)} />
            </label>
            <label>
              Long-distance per-mile
              <small className="admin-field-hint">Travel charge per mile after the threshold is exceeded.</small>
              <input type="number" step="0.01" value={draft.settings.longDistancePerMileRate} onChange={(e) => patchNumericSetting("longDistancePerMileRate", e.target.value)} />
            </label>
            <label>
              Delivery threshold miles
              <small className="admin-field-hint">Miles billed at Per-mile rate before Long-distance rate starts.</small>
              <input type="number" step="1" min="0" value={draft.settings.deliveryThresholdMiles} onChange={(e) => patchNumericSetting("deliveryThresholdMiles", e.target.value)} />
            </label>
            <label>
              Capacity limit
              <small className="admin-field-hint">Operations/scheduling warning limit for same-venue load.</small>
              <input type="number" step="1" min="1" value={draft.settings.capacityLimit || 400} onChange={(e) => patchNumericSetting("capacityLimit", e.target.value)} />
            </label>
            <label>
              Default bartender rate
              <small className="admin-field-hint">Event Basics uses this unless a quote-level bartender rate override is entered.</small>
              <input type="number" step="0.01" min="0" value={draft.settings.bartenderRate} onChange={(e) => patchNumericSetting("bartenderRate", e.target.value)} />
            </label>
            <label>
              Service fee pct fallback
              <small className="admin-field-hint">Used only when no service-fee tier matches guest count.</small>
              <input type="number" step="0.01" value={draft.settings.serviceFeePct} onChange={(e) => patchNumericSetting("serviceFeePct", e.target.value)} />
            </label>
            <label>
              Tax rate fallback
              <small className="admin-field-hint">Used only when no tax region is selected/found.</small>
              <input type="number" step="0.01" value={draft.settings.taxRate} onChange={(e) => patchNumericSetting("taxRate", e.target.value)} />
            </label>
            <label>
              Deposit pct
              <small className="admin-field-hint">Controls required deposit shown in totals and proposal summary.</small>
              <input type="number" step="0.01" value={draft.settings.depositPct} onChange={(e) => patchNumericSetting("depositPct", e.target.value)} />
            </label>
            <label>
              Quote validity days
              <small className="admin-field-hint">Printed on quote/proposal as the expiration window.</small>
              <input type="number" step="1" min="1" value={draft.settings.quoteValidityDays} onChange={(e) => patchNumericSetting("quoteValidityDays", e.target.value)} />
            </label>
            <label>
              Default server rate
              <small className="admin-field-hint">Event Basics uses this unless a quote-level server rate override is entered.</small>
              <input type="number" step="0.01" value={draft.settings.serverRate} onChange={(e) => patchNumericSetting("serverRate", e.target.value)} />
            </label>
            <label>
              Default chef rate
              <small className="admin-field-hint">Event Basics uses this unless a quote-level chef rate override is entered.</small>
              <input type="number" step="0.01" value={draft.settings.chefRate} onChange={(e) => patchNumericSetting("chefRate", e.target.value)} />
            </label>
            {PILOT_MARGINS_ENABLED && (
              <>
                <label>
                  Server cost rate
                  <small className="admin-field-hint">Staff-only; what a server actually costs you per hour. Leave blank until recorded — margin stays unavailable rather than guessing.</small>
                  <input type="number" step="0.01" min="0" placeholder="Not recorded" value={draft.settings.serverCostRate ?? ""} onChange={(e) => patchNullableNumericSetting("serverCostRate", e.target.value)} />
                </label>
                <label>
                  Chef cost rate
                  <small className="admin-field-hint">Staff-only; what a chef actually costs you per hour.</small>
                  <input type="number" step="0.01" min="0" placeholder="Not recorded" value={draft.settings.chefCostRate ?? ""} onChange={(e) => patchNullableNumericSetting("chefCostRate", e.target.value)} />
                </label>
                <label>
                  Bartender cost rate
                  <small className="admin-field-hint">Staff-only; what a bartender actually costs you per hour.</small>
                  <input type="number" step="0.01" min="0" placeholder="Not recorded" value={draft.settings.bartenderCostRate ?? ""} onChange={(e) => patchNullableNumericSetting("bartenderCostRate", e.target.value)} />
                </label>
                <label>
                  Target margin %
                  <small className="admin-field-hint">Staff-only comparison line on the margin strip, e.g. 0.45 for 45%. Leave blank to see raw margin with no target comparison.</small>
                  <input type="number" step="0.01" min="0" max="1" placeholder="Not set" value={draft.settings.targetMarginPct ?? ""} onChange={(e) => patchNullableNumericSetting("targetMarginPct", e.target.value)} />
                </label>
              </>
            )}
            <label>Integration retry limit<input type="number" step="1" min="1" max="10" value={draft.settings.integrationRetryLimit || 3} onChange={(e) => patchNumericSetting("integrationRetryLimit", e.target.value)} /></label>
            <label>Integration audit retention<input type="number" step="1" min="10" max="200" value={draft.settings.integrationAuditRetention || 50} onChange={(e) => patchNumericSetting("integrationAuditRetention", e.target.value)} /></label>
          </div>
            </section>

            <section className="admin-section">
          <div className="admin-section-head">
            <h3>Guided Selling & Staffing Controls</h3>
            <button type="button" className="ghost" onClick={addUpsellRule}>Add Rule</button>
          </div>
          <div className="admin-grid-settings">
            <label>
              <span>Enable guided selling recommendations</span>
              <input
                type="checkbox"
                checked={draft.settings.guidedSellingEnabled !== false}
                onChange={(e) => patchToggleSetting("guidedSellingEnabled", e.target.checked)}
              />
            </label>
            <label>
              <span>Include staffing labor automation in totals</span>
              <small className="admin-field-hint">When off, server/chef/bartender labor is excluded from quote totals.</small>
              <input
                type="checkbox"
                checked={draft.settings.staffingLaborEnabled !== false}
                onChange={(e) => patchToggleSetting("staffingLaborEnabled", e.target.checked)}
              />
            </label>
            <label>
              Staffing charge mode
              <small className="admin-field-hint">Per hour = rate x staff count x hours. Per event = rate x staff count (hours ignored).</small>
              <select
                value={normalizeStaffingChargeMode(draft.settings?.staffingChargeMode, "per_hour")}
                onChange={(e) => patchTextSetting("staffingChargeMode", normalizeStaffingChargeMode(e.target.value, "per_hour"))}
              >
                <option value="per_hour">Per hour x staff count</option>
                <option value="per_event_per_staff">Per event x staff count</option>
              </select>
            </label>
          </div>
          <div className="rule-config-list">
            {(draft.settings?.upsellRules || []).map((rule, ruleIndex) => {
              const kind = String(rule.kind || "addon");
              const targets = getUpsellTargetOptions(kind, rule.targetId);
              return (
                <article className="rule-config-card" key={rule.id || `rule-${ruleIndex}`}>
                  <div className="rule-config-head">
                    <strong>{rule.name || `Rule ${ruleIndex + 1}`}</strong>
                    <label className="rule-toggle">
                      <span>Enabled</span>
                      <input
                        type="checkbox"
                        checked={Boolean(rule.enabled)}
                        onChange={(e) => patchUpsellRule(ruleIndex, "enabled", e.target.checked)}
                      />
                    </label>
                  </div>
                  <div className="rule-config-grid">
                    <label>
                      Rule name
                      <input
                        type="text"
                        value={rule.name || ""}
                        onChange={(e) => patchUpsellRule(ruleIndex, "name", e.target.value)}
                      />
                    </label>
                    <label>
                      Rule type
                      <select
                        value={kind}
                        onChange={(e) => patchUpsellRule(ruleIndex, "kind", e.target.value)}
                      >
                        {RULE_KIND_META.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Target item
                      <select
                        value={rule.targetId || ""}
                        onChange={(e) => patchUpsellRule(ruleIndex, "targetId", e.target.value)}
                      >
                        {kind === "package" && <option value="">Auto next higher package</option>}
                        {kind !== "package" && <option value="">Choose target</option>}
                        {targets.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Min guests
                      <input
                        type="number"
                        min="0"
                        max="400"
                        value={Number(rule.minGuests || 0)}
                        onChange={(e) => patchUpsellRule(ruleIndex, "minGuests", e.target.value)}
                      />
                    </label>
                    <label>
                      Min hours
                      <input
                        type="number"
                        min="0"
                        max="24"
                        step="0.5"
                        value={Number(rule.minHours || 0)}
                        onChange={(e) => patchUpsellRule(ruleIndex, "minHours", e.target.value)}
                      />
                    </label>
                    <label className="rule-reason-field">
                      Reason shown in quote wizard
                      <input
                        type="text"
                        value={rule.reason || ""}
                        onChange={(e) => patchUpsellRule(ruleIndex, "reason", e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="rule-config-actions">
                    <button type="button" className="ghost compact" onClick={() => removeUpsellRule(ruleIndex)}>Delete Rule</button>
                  </div>
                </article>
              );
            })}
            {(draft.settings?.upsellRules || []).length === 0 && (
              <p className="source-note">No upsell rules are configured yet. Add at least one to power guided selling.</p>
            )}
          </div>
            </section>

            <section className="admin-section">
          <div className="admin-section-head"><h3>Optional Modules</h3></div>
          {enforceOrderFeatureAccess && (
            <p className="source-note">
              Module access is read only because this organization&apos;s order controls entitlements. To change access, update provisioning entitlements for this org and reopen this modal.
            </p>
          )}
          <div className="admin-grid-settings">
            {FEATURE_FLAG_META.map((flag) => (
              <label key={flag.id}>
                <span>{flag.label}</span>
                {enforceOrderFeatureAccess && <small className="source-note">{getFeatureAccessLabel(flag.id)}</small>}
                <input
                  type="checkbox"
                  checked={isFeatureEnabled(flag.id)}
                  onChange={(e) => patchFeatureFlag(flag.id, e.target.checked)}
                  disabled={featureFlagsLocked}
                  aria-readonly={featureFlagsLocked}
                  title={getFeatureAccessLabel(flag.id)}
                />
              </label>
            ))}
          </div>
            </section>

            <section className="admin-section">
          <div className="admin-section-head"><h3>Quote Meta</h3></div>
          <div className="admin-grid-settings">
            <label>
              Quote prepared by
              <input
                type="text"
                value={draft.settings.quotePreparedBy || ""}
                onChange={(e) => patchTextSetting("quotePreparedBy", e.target.value)}
              />
            </label>
            <label>
              Business phone
              <input
                type="text"
                value={draft.settings.businessPhone || ""}
                onChange={(e) => patchTextSetting("businessPhone", e.target.value)}
              />
            </label>
            <label>
              Business email
              <input
                type="text"
                value={draft.settings.businessEmail || ""}
                onChange={(e) => patchTextSetting("businessEmail", e.target.value)}
              />
            </label>
            <label>
              Business address
              <input
                type="text"
                value={draft.settings.businessAddress || ""}
                onChange={(e) => patchTextSetting("businessAddress", e.target.value)}
              />
            </label>
            <label>
              Business time zone
              <input
                type="text"
                list="quote-pilot-iana-time-zones"
                placeholder="America/Chicago"
                value={draft.settings.businessTimeZone || ""}
                onChange={(e) => patchTextSetting("businessTimeZone", e.target.value)}
                aria-describedby="business-time-zone-help"
              />
              <small id="business-time-zone-help">
                Use an IANA time zone. Revenue timing stays blocked until this is valid.
              </small>
              <datalist id="quote-pilot-iana-time-zones">
                <option value="America/New_York" />
                <option value="America/Chicago" />
                <option value="America/Denver" />
                <option value="America/Phoenix" />
                <option value="America/Los_Angeles" />
                <option value="America/Anchorage" />
                <option value="Pacific/Honolulu" />
                <option value="UTC" />
              </datalist>
            </label>
            <label>
              Acceptance email
              <input
                type="text"
                value={draft.settings.acceptanceEmail || ""}
                onChange={(e) => patchTextSetting("acceptanceEmail", e.target.value)}
              />
            </label>
            <label>
              Disposables note
              <input
                type="text"
                value={draft.settings.disposablesNote || ""}
                onChange={(e) => patchTextSetting("disposablesNote", e.target.value)}
              />
            </label>
            <label>
              Deposit notice
              <input
                type="text"
                value={draft.settings.depositNotice || ""}
                onChange={(e) => patchTextSetting("depositNotice", e.target.value)}
              />
            </label>
          </div>
            </section>

            <section className="admin-section">
          <div className="admin-section-head"><h3>CRM integrations</h3></div>
          <p className="source-note">
            Outbound CRM delivery is not enabled in this release. QuotePilot does not accept endpoint or bearer-token settings here, and Integration Ops records audit events only until a server-authorized connector is installed.
          </p>
            </section>

            <section className="admin-section">
          <div className="admin-section-head"><h3>Customer-facing business branding</h3></div>
          <p className="source-note">
            These details identify your catering business on proposals and the customer portal. They do not replace the QuotePilot by MBMApps product identity.
          </p>
          <div className="portal-theme-config">
            <div>
              <p className="portal-theme-label">Choose a customer portal look</p>
              <div className="portal-theme-preset-grid" role="group" aria-label="Customer portal theme presets">
                {PORTAL_THEME_PRESETS.map((preset) => {
                  const selected = selectedPortalTheme?.id === preset.id;
                  return (
                    <button
                      type="button"
                      key={preset.id}
                      className={`portal-theme-preset ${selected ? "active" : ""}`}
                      onClick={() => selectPortalTheme(preset)}
                      aria-pressed={selected}
                      aria-label={`Use ${preset.name}. ${preset.description}`}
                    >
                      <span className="portal-theme-swatches" aria-hidden="true">
                        <i style={{ background: preset.colors.brandPrimaryColor }} />
                        <i style={{ background: preset.colors.brandAccentColor }} />
                        <i style={{ background: preset.colors.brandBackgroundStart }} />
                      </span>
                      <strong>{preset.name}</strong>
                      <span>{preset.description}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div
              className="portal-theme-preview"
              style={portalThemePreviewStyle}
              aria-live="polite"
              aria-label={`Customer portal preview: ${selectedPortalTheme?.name || "Custom colors"}`}
            >
              <div className="portal-theme-preview-card">
                <span>Customer portal preview</span>
                <strong>
                  Your proposal from {String(draft.settings.brandName || "your business").trim() || "your business"}
                </strong>
                <small>{selectedPortalTheme?.name || "Custom colors"}</small>
              </div>
            </div>
          </div>
          <div className="admin-grid-settings">
            <label>
              Business name
              <input
                type="text"
                value={draft.settings.brandName || ""}
                onChange={(e) => patchTextSetting("brandName", e.target.value)}
              />
            </label>
            <label>
              Business tagline
              <input
                type="text"
                value={draft.settings.brandTagline || ""}
                onChange={(e) => patchTextSetting("brandTagline", e.target.value)}
              />
            </label>
            <label>
              Business logo URL/path
              <input
                type="text"
                value={draft.settings.brandLogoUrl || ""}
                onChange={(e) => patchTextSetting("brandLogoUrl", e.target.value)}
              />
            </label>
            <label>
              Upload logo image
              <input
                type="file"
                accept="image/*"
                onChange={(e) => handleLogoUpload(e.target.files?.[0])}
                disabled={uploadingLogo}
              />
            </label>
            <label>
              Primary color
              <input
                type="color"
                value={draft.settings.brandPrimaryColor || "#c99334"}
                onChange={(e) => patchTextSetting("brandPrimaryColor", e.target.value)}
              />
            </label>
            <label>
              Accent color
              <input
                type="color"
                value={draft.settings.brandAccentColor || "#f0d29a"}
                onChange={(e) => patchTextSetting("brandAccentColor", e.target.value)}
              />
            </label>
            <label>
              Deep accent color
              <input
                type="color"
                value={draft.settings.brandDarkAccentColor || "#8d611a"}
                onChange={(e) => patchTextSetting("brandDarkAccentColor", e.target.value)}
              />
            </label>
            <label>
              Background start
              <input
                type="color"
                value={draft.settings.brandBackgroundStart || "#100d09"}
                onChange={(e) => patchTextSetting("brandBackgroundStart", e.target.value)}
              />
            </label>
            <label>
              Background mid
              <input
                type="color"
                value={draft.settings.brandBackgroundMid || "#221a12"}
                onChange={(e) => patchTextSetting("brandBackgroundMid", e.target.value)}
              />
            </label>
            <label>
              Background end
              <input
                type="color"
                value={draft.settings.brandBackgroundEnd || "#ae7d2b"}
                onChange={(e) => patchTextSetting("brandBackgroundEnd", e.target.value)}
              />
            </label>
            <label>
              Hero eyebrow
              <input
                type="text"
                value={draft.settings.heroEyebrow || ""}
                onChange={(e) => patchTextSetting("heroEyebrow", e.target.value)}
              />
            </label>
            <label>
              Hero headline
              <input
                type="text"
                value={draft.settings.heroHeadline || ""}
                onChange={(e) => patchTextSetting("heroHeadline", e.target.value)}
              />
            </label>
            <label>
              Hero description
              <textarea
                value={draft.settings.heroDescription || ""}
                onChange={(e) => patchTextSetting("heroDescription", e.target.value)}
              />
            </label>
          </div>
            </section>

            <section className="admin-section">
          <div className="admin-section-head"><h3>Default Selectors</h3></div>
          <div className="admin-grid-settings">
            <label>
              Default tax region id
              <input
                type="text"
                value={draft.settings.defaultTaxRegion || ""}
                onChange={(e) => patchTextSetting("defaultTaxRegion", e.target.value)}
              />
            </label>
            <label>
              Default season profile id
              <input
                type="text"
                value={draft.settings.defaultSeasonProfile || "auto"}
                onChange={(e) => patchTextSetting("defaultSeasonProfile", e.target.value)}
              />
            </label>
          </div>
            </section>

            <section className="admin-section">
          <div className="admin-section-head"><h3>Advanced Config (JSON)</h3></div>
          <div className="admin-section-body">
            {JSON_FIELD_META.map((field) => (
              <label key={field.key} className="json-label">
                <span>{field.label}</span>
                <textarea
                  className="json-editor"
                  value={jsonDrafts[field.key]}
                  onChange={(e) => patchJsonDraft(field.key, e.target.value)}
                />
                <small>{field.hint}</small>
              </label>
            ))}
          </div>
            </section>
          </>
        )}

        <div className="modal-foot" data-capability-state={catalogSaveCapabilityState}>
          <span className="source-note">
            {status || (hasUnsavedChanges ? "Your changes are not saved yet." : "Settings are up to date.")}
          </span>
          {catalogRefreshRequired && (
            <button type="button" className="ghost" onClick={handleReload} disabled={saving}>
              Refresh latest catalog
            </button>
          )}
          {!starterChoiceOnly && (
            <button type="button" className="cta" onClick={handleSave} disabled={saving || !hasUnsavedChanges}>
              {saving ? "Saving..." : "Save catalog changes"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminCatalogModal(props) {
  return <AdminCatalogView {...props} presentation="modal" />;
}
