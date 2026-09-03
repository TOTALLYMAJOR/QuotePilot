import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
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
  normalizeProposalDocumentFontScale,
  PROPOSAL_DOCUMENT_FONT_SCALE_OPTIONS
} from "../lib/proposalDocumentPreferences";
import { normalizeBrandLogoUrl } from "../lib/brandLogoUrl";
import {
  getEventTypes,
  getMenuCategories,
  getMenuItems
} from "../lib/menuService";
import { buildPackageWorkspaceCollectionModel } from "../lib/packageWorkspaceModel";
import { useModalDialog } from "../hooks/useModalDialog";
import { useCatalogSetupDraft } from "../hooks/useCatalogSetupDraft";
import {
  applyCatalogSetupDraftChanges,
  buildCatalogSetupChanges,
  createCatalogSetupRequestId,
  stageCatalogSetupPreset
} from "../lib/catalogSetupDraftService";
import PackageWorkspace from "./PackageWorkspace";
import CatalogDraftStateBar, { catalogDraftCapabilityState } from "./CatalogDraftStateBar";

const AMBIENT_UI_ENABLED = import.meta.env.VITE_AMBIENT_UI_ENABLED === "1"
  || import.meta.env.VITE_AMBIENT_UI_ENABLED === "true"
  || import.meta.env.VITE_AMBIENT_UI_ENABLED === "yes"
  || import.meta.env.VITE_AMBIENT_UI_ENABLED === "on";
const EventTemplatesEditor = AMBIENT_UI_ENABLED
  ? lazy(() => import("./EventTemplatesEditor"))
  : null;

// The package workspace now reads package cost directly for readiness and margin
// evidence. The remaining add-on and rental cost inputs stay under the margin
// pilot gate until those surfaces use the values deterministically.
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
const AMBIENT_DECISION_ROOM_AUTHORING_ENABLED = PILOT_DECISION_ROOM_ENABLED
  && AMBIENT_UI_ENABLED;

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
  ...(AMBIENT_UI_ENABLED ? [{ id: "templates", label: "Templates" }] : []),
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
  { id: "aiAutopilot", label: "Apply suggestions automatically" }
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
const EXISTING_CATALOG_CONTENT_CONFLICTS = [
  "already has catalog content",
  "existing catalog content is not attributable"
];

function hasCatalogConflictFromExistingContent(error = "") {
  const normalized = String(error || "").toLowerCase();
  return EXISTING_CATALOG_CONTENT_CONFLICTS.some((needle) => normalized.includes(needle));
}

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

export function packageCatalogDependencySummary(catalog = {}, packageId = "", eventTemplates = null) {
  const id = String(packageId || "").trim();
  const settings = catalog?.settings || {};
  const templates = Array.isArray(eventTemplates)
    ? eventTemplates
    : (Array.isArray(settings.eventTemplates) ? settings.eventTemplates : []);
  const rules = Array.isArray(settings.upsellRules) ? settings.upsellRules : [];
  if (!id) {
    return { available: false, eventTemplateCount: 0, ruleCount: 0, total: 0 };
  }
  const eventTemplateCount = templates.filter((template) => (
    String(template?.pkg || "").trim() === id
  )).length;
  const ruleCount = rules.filter((rule) => (
    rule?.kind === "package" && String(rule?.targetId || "").trim() === id
  )).length;
  return {
    available: true,
    eventTemplateCount,
    ruleCount,
    total: eventTemplateCount + ruleCount
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

function MenuStructureEditor({
  kind,
  addLabel,
  open,
  selected,
  currentValue,
  newValue,
  disabled,
  actionLoading,
  onCurrentChange,
  onCurrentSave,
  onNewChange,
  onNewSave
}) {
  return (
    <details className="admin-menu-disclosure" open={open}>
      <summary>Manage {kind}s</summary>
      <div className="admin-menu-disclosure-body">
        {selected && (
          <div className="admin-menu-form-block">
            <label>Current {kind}</label>
            <div className="admin-menu-action-row">
              <input type="text" aria-label={`Selected ${kind} name`} value={currentValue} onChange={onCurrentChange} disabled={disabled} />
              <button type="button" className="ghost compact" onClick={onCurrentSave} disabled={actionLoading}>Save name</button>
            </div>
          </div>
        )}
        <div className="admin-menu-form-block">
          <label>New {kind}</label>
          <div className="admin-menu-action-row">
            <input type="text" aria-label={`New ${kind} name`} value={newValue} onChange={onNewChange} disabled={disabled} />
            <button type="button" className="ghost compact" onClick={onNewSave} disabled={actionLoading || disabled}>{addLabel}</button>
          </div>
        </div>
      </div>
    </details>
  );
}

const PRICE_BASIS_OPTIONS = [
  ["per_event", "Per event"],
  ["per_person", "Per guest"],
  ["per_item", "Per item"]
];

function MenuItemFields({ item, isNew = false, onChange, onBlur, onKeyDown }) {
  const aria = (field) => isNew ? `New menu item ${field}` : undefined;
  return (
    <>
      <label>
        <span>Name</span>
        <input type="text" aria-label={aria("name")} value={item.name || ""} onChange={(event) => onChange("name", event.target.value)} onBlur={onBlur} onKeyDown={onKeyDown} />
      </label>
      <label>
        <span>Price basis</span>
        <select aria-label={aria("price basis")} value={item.pricingType || item.type || "per_event"} onChange={(event) => onChange("pricingType", event.target.value)} onBlur={onBlur} onKeyDown={onKeyDown}>
          {PRICE_BASIS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label>
        <span>Selling price</span>
        <input type="number" step="0.01" aria-label={aria("price")} value={Number(item.price || 0)} onChange={(event) => onChange("price", event.target.value)} onBlur={onBlur} onKeyDown={onKeyDown} />
      </label>
      <label>
        <span>Cost</span>
        <input type="number" step="0.01" min="0" aria-label={aria("cost")} value={item.cost ?? ""} onChange={(event) => onChange("cost", event.target.value)} onBlur={onBlur} onKeyDown={onKeyDown} />
      </label>
      <label className="admin-inline-toggle admin-menu-item-availability">
        <input type="checkbox" checked={item.active !== false} onChange={(event) => onChange("active", event.target.checked)} onBlur={onBlur} />
        <span>Available in new quotes</span>
      </label>
    </>
  );
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

function brandInitials(value) {
  const initials = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return initials || "QP";
}

function hasRecordedNonNegativeNumber(value) {
  if (value === null || value === undefined || value === "") return false;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0;
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

function buildPersistableCatalogDraft(draft, jsonDrafts) {
  const parseArray = (field, label) => {
    const parsed = JSON.parse(jsonDrafts?.[field] || "[]");
    if (!Array.isArray(parsed)) throw new Error(`${label}: Must be a JSON array.`);
    return parsed;
  };
  const featureFlagsLocked = draft?.settings?.featureFlagsLocked === true;
  const featureFlags = { ...(draft?.settings?.featureFlags || {}) };
  if (!featureFlagsLocked && featureFlags.aiAssist === false) featureFlags.aiAutopilot = false;
  return {
    ...draft,
    settings: {
      ...(draft?.settings || {}),
      featureFlags,
      brandLogoUrl: normalizeBrandLogoUrl(draft?.settings?.brandLogoUrl),
      documentFontScale: normalizeProposalDocumentFontScale(draft?.settings?.documentFontScale).id,
      serviceFeeTiers: parseArray("serviceFeeTiers", "Service Fee Tiers JSON"),
      taxRegions: parseArray("taxRegions", "Tax Regions JSON"),
      eventTemplates: parseEventTemplateDrafts(jsonDrafts?.eventTemplates),
      seasonalProfiles: parseArray("seasonalProfiles", "Seasonal Profiles JSON"),
      brandCrew: parseArray("brandCrew", "Brand Crew JSON")
    }
  };
}

function cloneCatalogSnapshot(catalog = {}) {
  return JSON.parse(JSON.stringify(catalog || {}));
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
  surfaceTitle = "Catalog Admin",
  embeddedCloseLabel = "Back to Home",
  returnFocusRef = null,
  initialTab = "",
  focusRequest = null,
  onFocusResolution,
  onInteractionStateChange,
  onDismissGuardChange,
  selectedEventType: selectedEventTypeProp = "",
  onEventTypeChange,
  onToast,
  catalogSetupDraftController = null
}) {
  const embedded = presentation === "embedded";
  const [draft, setDraft] = useState(catalog);
  const [savedCatalogSnapshot, setSavedCatalogSnapshot] = useState(() => cloneCatalogSnapshot(catalog));
  const [activeTab, setActiveTab] = useState(() => resolveCatalogAdminTab(catalog, initialTab));
  const [status, setStatus] = useState("");
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [jsonDrafts, setJsonDrafts] = useState(() => buildJsonDrafts(catalog));
  const [savedFingerprint, setSavedFingerprint] = useState(() =>
    catalogDraftFingerprint(catalog, buildJsonDrafts(catalog))
  );
  const [selectedPackageId, setSelectedPackageId] = useState(() => String(catalog?.packages?.[0]?.id || "").trim());
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
  const [eventTypeRenameTouched, setEventTypeRenameTouched] = useState(false);
  const [categoryRenameTouched, setCategoryRenameTouched] = useState(false);
  const [newItemDraft, setNewItemDraft] = useState({
    name: "",
    price: 0,
    cost: "",
    pricingType: "per_event",
    active: true
  });
  const [menuItemBaselines, setMenuItemBaselines] = useState({});
  const [menuItemDirty, setMenuItemDirty] = useState({});
  const [menuItemSavingId, setMenuItemSavingId] = useState("");
  const [menuSearch, setMenuSearch] = useState("");
  const [showUnavailableMenuItems, setShowUnavailableMenuItems] = useState(false);
  const [selectedMenuItemIds, setSelectedMenuItemIds] = useState([]);
  const [activeMenuItemId, setActiveMenuItemId] = useState("");
  const [bulkTargetSection, setBulkTargetSection] = useState("");
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
  const handledFocusRequestRef = useRef("");
  const pendingCatalogEvidenceRef = useRef(null);
  const acceptedCatalogRevisionRef = useRef(null);
  const scopedOrganizationId = String(organizationId || "").trim();
  const catalogRevision = Math.max(0, Number(catalog?.settings?.catalogRevision || 0));
  const internalCatalogSetupDraft = useCatalogSetupDraft({
    enabled: Boolean(open && scopedOrganizationId && !catalogSetupDraftController),
    organizationId: scopedOrganizationId,
    baseCatalogRevision: catalogRevision
  });
  const catalogSetupDraft = catalogSetupDraftController || internalCatalogSetupDraft;
  const catalogSetupDraftChanges = Array.isArray(catalogSetupDraft?.changes)
    ? catalogSetupDraft.changes
    : [
        ...(Array.isArray(catalogSetupDraft?.serverChanges) ? catalogSetupDraft.serverChanges : []),
        ...(Array.isArray(catalogSetupDraft?.deviceChanges) ? catalogSetupDraft.deviceChanges : [])
      ];
  const stagedIntentFor = (collection, recordId, fallbackIntent) => (
    catalogSetupDraftChanges.some((change) => (
      change.collection === collection
      && change.recordId === recordId
      && change.intent === "create"
    )) ? "create" : fallbackIntent
  );
  const authoritativeVersion = Math.max(0, Number(catalog?.authoritativeVersion || 0));
  const starterPackRevision = Math.max(
    0,
    Number(catalog?.settings?.starterCatalogPack?.appliedCatalogRevision || 0)
  );
  const viewScopeKey = JSON.stringify([
    scopedOrganizationId,
    String(initialTab || ""),
    catalogRevision,
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
    catalogRevision,
    authoritativeVersion,
    starterPackRevision
  ]);
  const confirmedInventoryLoadScopeKey = JSON.stringify([
    scopedOrganizationId,
    catalogRevision,
    authoritativeVersion,
    starterPackRevision,
    catalog?.settings?.pricingSetupConfirmed === true
  ]);
  const eventMenuLoadScopeKey = JSON.stringify([
    scopedOrganizationId,
    String(selectedEventType || ""),
    catalogRevision,
    authoritativeVersion,
    starterPackRevision
  ]);
  const hasUnsavedChanges = catalogDraftFingerprint(draft, jsonDrafts) !== savedFingerprint;
  const selectedEventTypeRecord = menuEventTypes.find((item) => item.id === selectedEventType);
  const selectedCategoryRecord = menuCategories.find((item) => item.id === selectedCategory);
  const newItemDraftDirty = Boolean(
    String(newItemDraft.name || "").trim()
    || Number(newItemDraft.price || 0) !== 0
    || String(newItemDraft.cost || "").trim()
    || normalizePricingType(newItemDraft.pricingType, "per_event") !== "per_event"
    || newItemDraft.active === false
  );
  const eventTypeRenameDirty = Boolean(
    eventTypeRenameTouched
    && selectedEventTypeRecord
    && String(eventTypeEditName || "").trim() !== String(selectedEventTypeRecord.name || "").trim()
  );
  const categoryRenameDirty = Boolean(
    categoryRenameTouched
    && selectedCategoryRecord
    && String(categoryEditName || "").trim() !== String(selectedCategoryRecord.name || "").trim()
  );
  const hasPendingMenuEditorDraft = Boolean(
    String(newEventTypeName || "").trim()
    || String(newCategoryName || "").trim()
    || newItemDraftDirty
    || eventTypeRenameDirty
    || categoryRenameDirty
  );
  const hasManagedMenuDraft = hasPendingMenuEditorDraft
    || Object.values(menuItemDirty).some((dirty) => dirty === true);
  const hasAnyUnsavedChanges = hasUnsavedChanges || hasManagedMenuDraft;
  const packageWorkspace = buildPackageWorkspaceCollectionModel({
    catalog: draft,
    menuItems,
    selectedPackageId
  });
  const packageDeletionSummary = (() => {
    try {
      return packageCatalogDependencySummary(
        draft,
        packageWorkspace.selectedPackageId,
        parseEventTemplateDrafts(jsonDrafts.eventTemplates)
      );
    } catch {
      return { available: false, eventTemplateCount: 0, ruleCount: 0, total: 0 };
    }
  })();

  const pushToast = (message, tone = "info") => {
    if (typeof onToast === "function") {
      onToast(message, tone);
    }
  };
  const blockForNewerCatalog = () => {
    if (!pendingCatalogEvidenceRef.current) return false;
    const message = "A newer Library version is ready. Your unsaved work is still here. Load the latest version before making another saved change.";
    setCatalogRefreshRequired(true);
    setStatus(message);
    pushToast(message, "info");
    return true;
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
    const acceptedRevision = acceptedCatalogRevisionRef.current === catalogRevision;
    if (!resetOnNextOpenRef.current && hasAnyUnsavedChanges && !acceptedRevision) {
      pendingCatalogEvidenceRef.current = { catalog, viewScopeKey };
      setCatalogRefreshRequired(true);
      setStatus("A newer Library version is ready. Your unsaved work is still here. Load the latest version when you are ready to replace these changes.");
      return;
    }
    initializedViewScopeRef.current = viewScopeKey;
    pendingCatalogEvidenceRef.current = null;
    acceptedCatalogRevisionRef.current = null;
    resetOnNextOpenRef.current = false;
    const nextDraft = applyCatalogSetupDraftChanges({
      ...catalog,
      settings: {
        ...(catalog?.settings || {}),
        featureFlags: { ...(catalog?.settings?.featureFlags || {}) }
      }
    }, catalogSetupDraftChanges);
    const nextJsonDrafts = buildJsonDrafts(catalog);
    setDraft(nextDraft);
    setSavedCatalogSnapshot(cloneCatalogSnapshot(nextDraft));
    setJsonDrafts(nextJsonDrafts);
    setSavedFingerprint(catalogDraftFingerprint(nextDraft, nextJsonDrafts));
    if (!acceptedRevision || catalog?.error) {
      setStatus(String(catalog?.error || ""));
    }
    setUploadingLogo(false);
    if (!acceptedRevision) {
      setActiveTab(resolveCatalogAdminTab(catalog, initialTab));
    }
    setSelectedPackageId(String(nextDraft?.packages?.[0]?.id || "").trim());
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
    if (!acceptedRevision) {
      setManualSetupEnabled(false);
    }
    setConfirmedMenuRecoveryAvailable(false);
    setConfirmedMenuRecoveryChecked(false);
    setMenuLoading(false);
    setMenuActionLoading(false);
    setNewEventTypeName("");
    setNewCategoryName("");
    setEventTypeEditName("");
    setCategoryEditName("");
    setEventTypeRenameTouched(false);
    setCategoryRenameTouched(false);
    setNewItemDraft({ name: "", price: 0, cost: "", pricingType: "per_event", active: true });
    setMenuSearch("");
    setShowUnavailableMenuItems(false);
    setSelectedMenuItemIds([]);
    setBulkTargetSection("");
  }, [open, viewScopeKey]); // Draft state is intentionally read inside this scope-change reconciliation effect.

  useEffect(() => {
    if (!open) return;
    if (pendingCatalogEvidenceRef.current) return;
    if (!shouldInitializeView && eventTypesLoadScopeRef.current === eventTypesLoadScopeKey) return;
    eventTypesLoadScopeRef.current = eventTypesLoadScopeKey;
    let alive = true;

    async function loadEventTypeOptions() {
      setMenuLoading(true);
      try {
        const publishedEventTypes = await getEventTypes({ organizationId: scopedOrganizationId });
        const eventTypes = applyCatalogSetupDraftChanges(
          { eventTypes: publishedEventTypes },
          catalogSetupDraftChanges
        ).eventTypes;
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
  }, [open, eventTypesLoadScopeKey, catalogRefreshRequired]);

  useEffect(() => {
    if (!open) return undefined;
    if (pendingCatalogEvidenceRef.current) return undefined;
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
  }, [open, confirmedInventoryLoadScopeKey, catalogRefreshRequired]);

  useEffect(() => {
    if (!open) return;
    if (pendingCatalogEvidenceRef.current) return;
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
        const [publishedCategories, publishedItems] = await Promise.all([
          getMenuCategories(eventTypeId, { organizationId: scopedOrganizationId }),
          getMenuItems(eventTypeId, { includeInactive: true, organizationId: scopedOrganizationId })
        ]);
        if (!alive) return;
        const stagedMenu = applyCatalogSetupDraftChanges({
          categories: publishedCategories,
          items: publishedItems
        }, catalogSetupDraftChanges);
        const categories = stagedMenu.categories.filter((item) => item.eventTypeId === eventTypeId);
        const items = stagedMenu.items.filter((item) => item.eventTypeId === eventTypeId);
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
  }, [open, eventMenuLoadScopeKey, catalogRefreshRequired]);

  useEffect(() => {
    if (!open || pendingCatalogEvidenceRef.current) return;
    const selected = menuEventTypes.find((eventType) => eventType.id === selectedEventType);
    setEventTypeEditName(selected?.name || "");
    setEventTypeRenameTouched(false);
  }, [selectedEventType, menuEventTypes]);

  useEffect(() => {
    if (!open || pendingCatalogEvidenceRef.current) return;
    const selected = menuCategories.find((category) => category.id === selectedCategory);
    setCategoryEditName(selected?.name || "");
    setCategoryRenameTouched(false);
  }, [selectedCategory, menuCategories]);

  const blockManagedMenuMutationForDraft = (action, targetItemId) => {
    if (!hasUnrelatedManagedMenuDraft({
      catalogDraftDirty: hasUnsavedChanges,
      menuItemDirty,
      targetItemId,
      pendingMenuEditorDraft: hasPendingMenuEditorDraft
    })) {
      return false;
    }
    const actionLabel = action === "delete" ? "deleting" : "deactivating";
    const message = `You already have another catalog change in progress. Save or discard it, then try ${actionLabel} this menu item again. This item is unchanged.`;
    setStatus(message);
    pushToast(message, "error");
    return true;
  };
  const blockForOtherDrafts = (
    ownDraft = "",
    targetItemId = "",
    options = {}
  ) => {
    const includeCatalogDraft = options?.includeCatalogDraft !== false;
    const blocked = (includeCatalogDraft && hasUnsavedChanges)
      || (ownDraft !== "event-create" && Boolean(String(newEventTypeName || "").trim()))
      || (ownDraft !== "category-create" && Boolean(String(newCategoryName || "").trim()))
      || (ownDraft !== "item-create" && newItemDraftDirty)
      || (ownDraft !== "event-rename" && eventTypeRenameDirty)
      || (ownDraft !== "category-rename" && categoryRenameDirty)
      || Object.entries(menuItemDirty).some(([itemId, dirty]) => (
        dirty === true && !(ownDraft === "item-update" && itemId === targetItemId)
      ));
    if (!blocked) return false;
    const message = "One Library edit is already in progress. Save or discard it, then try this change again. Nothing changed.";
    setStatus(message);
    pushToast(message, "info");
    return true;
  };
  const closeBlocked = Boolean(
    saving
    || uploadingLogo
    || menuActionLoading
    || menuItemSavingId
    || packActionId
  );
  useEffect(() => {
    onInteractionStateChange?.({
      dirty: hasAnyUnsavedChanges || (catalogSetupDraft.deviceOnly && catalogSetupDraftChanges.length > 0),
      busy: closeBlocked
    });
  }, [
    catalogSetupDraftChanges.length,
    catalogSetupDraft.deviceOnly,
    closeBlocked,
    hasAnyUnsavedChanges,
    onInteractionStateChange
  ]);

  useEffect(() => {
    if (!open || !hasUnsavedChanges || shouldInitializeView || !scopedOrganizationId) return;
    try {
      const nextDraft = buildPersistableCatalogDraft(draft, jsonDrafts);
      const normalizedBaseline = buildPersistableCatalogDraft(
        savedCatalogSnapshot,
        buildJsonDrafts(savedCatalogSnapshot)
      );
      const changes = buildCatalogSetupChanges({
        catalog: nextDraft,
        baselineCatalog: normalizedBaseline,
        serverFingerprints: catalog?.serverFingerprints || {}
      });
      if (changes.length > 0) catalogSetupDraft.queueChanges(changes);
    } catch {
      // Invalid advanced JSON remains local and visibly unsaved until corrected.
    }
  }, [
    catalog?.serverFingerprints,
    catalogSetupDraft.queueChanges,
    draft,
    hasUnsavedChanges,
    jsonDrafts,
    open,
    savedCatalogSnapshot,
    scopedOrganizationId,
    shouldInitializeView
  ]);

  useEffect(() => {
    if (!open) return;
    if (selectedPackageId === packageWorkspace.selectedPackageId) return;
    setSelectedPackageId(packageWorkspace.selectedPackageId);
  }, [open, packageWorkspace.selectedPackageId, selectedPackageId]);

  const requestDismiss = useCallback((reason = "close", continuation = null) => {
    if (closeBlocked) {
      setStatus("Wait for the current catalog action to finish before closing.");
      return { status: "blocked", reason: "busy", trigger: reason };
    }
    if (hasAnyUnsavedChanges && !window.confirm("Discard unsaved catalog, menu, and branding changes?")) {
      return { status: "guarded", reason: "dirty", trigger: reason };
    }
    resetOnNextOpenRef.current = true;
    onInteractionStateChange?.({ dirty: false, busy: false });
    if (typeof continuation === "function") continuation();
    return { status: "dismissed", trigger: reason };
  }, [closeBlocked, hasAnyUnsavedChanges, onInteractionStateChange]);
  const handleClose = useCallback(() => {
    requestDismiss("close", onClose);
  }, [onClose, requestDismiss]);
  useEffect(() => {
    if (typeof onDismissGuardChange !== "function") return undefined;
    if (!open || !embedded) {
      onDismissGuardChange(null);
      return undefined;
    }
    onDismissGuardChange({
      modelId: "catalog-editor-navigation-guard-v1",
      open: true,
      dirty: hasAnyUnsavedChanges,
      busy: closeBlocked,
      requestDismiss
    });
    return () => onDismissGuardChange(null);
  }, [closeBlocked, embedded, hasAnyUnsavedChanges, onDismissGuardChange, open, requestDismiss]);
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

  useEffect(() => {
    if (!open || !embedded || typeof window === "undefined") return undefined;
    const requestId = String(focusRequest?.requestId || focusRequest?.id || "").trim();
    if (!requestId || handledFocusRequestRef.current === requestId) return undefined;
    const sectionId = String(focusRequest?.sectionId || "").trim();
    const supported = ADMIN_TABS.some((tab) => tab.id === sectionId);
    if (!supported) {
      handledFocusRequestRef.current = requestId;
      onFocusResolution?.({
        requestId,
        status: "recovery",
        result: "recovery",
        object: { type: "library-section", id: sectionId || "unknown" },
        reason: "The requested Library section is not available in this catalog editor.",
        consequence: "No catalog field was changed and the current Library context remains available.",
        nextResolutions: ["Return to Library and choose an available section"]
      });
      return undefined;
    }

    setActiveTab(sectionId);
    if (sectionId === "templates" && String(focusRequest?.recordId || "").trim()) {
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => {
      const target = dialogRef.current?.querySelector(`[data-admin-tab-id="${sectionId}"]`)
        || dialogRef.current;
      target?.focus?.({ preventScroll: true });
      target?.scrollIntoView?.({ block: "nearest", behavior: "auto" });
      handledFocusRequestRef.current = requestId;
      onFocusResolution?.({
        requestId,
        status: "focused",
        result: "context",
        object: { type: "library-section", id: sectionId },
        reason: String(focusRequest?.reason || "The requested Library section is open."),
        consequence: "Reviewing this section changes nothing until an administrator explicitly saves catalog changes.",
        nextResolutions: ["Review this section", "Review and publish the catalog when ready"]
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [dialogRef, embedded, focusRequest, onFocusResolution, open]);

  const stagedPack = draft?.settings?.starterCatalogPack || {};
  const recoveryReplacementBlocked = stagedPack.replacementBlocked === true;
  const confirmedMissingMenuRecovery = confirmedMenuRecoveryChecked
    && confirmedMenuRecoveryAvailable
    && draft?.settings?.pricingSetupConfirmed === true;
  const pricingReviewRequired = Boolean(stagedPack.id)
    && draft?.settings?.pricingSetupConfirmed !== true;
  const hasCatalogContent = Boolean(
    stagedPack.id
    || draft?.packages?.length
    || draft?.addons?.length
    || draft?.rentals?.length
    || catalog?.eventTypes?.length
    || menuEventTypes.length
  );
  const showStarterTab = !hasCatalogContent
    || (draft?.settings?.pricingSetupConfirmed !== true
      && !recoveryReplacementBlocked
      && Boolean(stagedPack.id))
    || confirmedMissingMenuRecovery;
  const existingContentRequiresManualSetup = String(initialTab || "").trim() === "starter"
    && hasCatalogContent
    && !stagedPack.id
    && !confirmedMissingMenuRecovery;
  const starterChoiceOnly = !hasCatalogContent && !manualSetupEnabled;
  const visibleAdminTabs = starterChoiceOnly
    ? ADMIN_TABS.filter((tab) => tab.id === "starter")
    : ADMIN_TABS.filter(
      (tab) => tab.id !== "starter"
        || showStarterTab
    );
  const hasActiveVisibleTab = visibleAdminTabs.some((tab) => tab.id === activeTab);
  const resolvedActiveTab = hasActiveVisibleTab ? activeTab : (visibleAdminTabs[0]?.id || "");
  const packageWorkspaceActive = resolvedActiveTab === "packages" && !starterChoiceOnly;

  useEffect(() => {
    if (open && !hasActiveVisibleTab && resolvedActiveTab && activeTab !== resolvedActiveTab) {
      setActiveTab(resolvedActiveTab);
    }
  }, [open, hasActiveVisibleTab, resolvedActiveTab, activeTab]);

  if (!open) return null;

  const handleApplyStarterPack = async (pack) => {
    if (blockForNewerCatalog()) return;
    if (blockForOtherDrafts()) return;
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
    let result;
    try {
      result = await stageCatalogSetupPreset({
        organizationId: scopedOrganizationId,
        packId: pack.id,
        packVersion: pack.version
      });
    } catch (error) {
      result = { ok: false, error: error?.message || "Failed to stage setup preset." };
    }
    setPackActionId("");
    if (!result?.ok) {
      setCatalogRefreshRequired(result?.refreshRequired === true);
      const resultError = result?.error || "Failed to apply starter catalog pack.";
      if (hasCatalogConflictFromExistingContent(resultError)) {
        const conflictStatus = `${resultError} Manual catalog setup has been opened so you can continue editing.`;
        setStatus(conflictStatus);
        setManualSetupEnabled(true);
        setActiveTab("packages");
        pushToast(conflictStatus, "error");
        return;
      }
      setStatus(resultError);
      pushToast(resultError, "error");
      return;
    }
    setCatalogRefreshRequired(false);
    const message = `${pack.name} setup preset added to the shared draft. Review every suggested amount before publishing.`;
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
    if (key === "packages") {
      setSelectedPackageId(id);
    }
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
    setStatus(`${label} removed from the setup draft. Dependent package inclusions, recommendation rules, and quote starting points were removed too.`);
  };

  const patchPackageField = (packageId, field, value) => {
    const id = String(packageId || "").trim();
    if (!id) return;
    setDraft((prev) => ({
      ...prev,
      packages: (Array.isArray(prev.packages) ? prev.packages : []).map((pkg) => (
        String(pkg?.id || "").trim() === id
          ? { ...pkg, [field]: value }
          : pkg
      ))
    }));
  };

  const replacePackageInclusionIds = (packageId, field, nextIds) => {
    const id = String(packageId || "").trim();
    if (!id) return;
    setDraft((prev) => ({
      ...prev,
      packages: (Array.isArray(prev.packages) ? prev.packages : []).map((pkg) => (
        String(pkg?.id || "").trim() === id
          ? { ...pkg, [field]: [...(Array.isArray(nextIds) ? nextIds : [])] }
          : pkg
      ))
    }));
  };

  const deletePackageById = (packageId) => {
    const id = String(packageId || "").trim();
    const packageIndex = (Array.isArray(draft?.packages) ? draft.packages : [])
      .findIndex((pkg) => String(pkg?.id || "").trim() === id);
    if (packageIndex < 0) return;
    removeRow("packages", packageIndex);
  };

  const revertPackageDraft = (packageId) => {
    const id = String(packageId || "").trim();
    if (!id) return;
    const savedPackage = (Array.isArray(savedCatalogSnapshot?.packages) ? savedCatalogSnapshot.packages : [])
      .find((pkg) => String(pkg?.id || "").trim() === id);
    if (!savedPackage) {
      catalogSetupDraft.discardDeviceChanges?.([{
        collection: "catalogPackages",
        recordId: id
      }]);
      setDraft((prev) => ({
        ...prev,
        packages: (Array.isArray(prev.packages) ? prev.packages : []).filter((pkg) => (
          String(pkg?.id || "").trim() !== id
        ))
      }));
      setStatus("Unsaved package removed from this draft.");
      return;
    }
    catalogSetupDraft.discardDeviceChanges?.([{
      collection: "catalogPackages",
      recordId: id
    }]);
    setDraft((prev) => ({
      ...prev,
      packages: (Array.isArray(prev.packages) ? prev.packages : []).map((pkg) => (
        String(pkg?.id || "").trim() === id ? { ...savedPackage } : pkg
      ))
    }));
    setStatus(`${savedPackage.name || savedPackage.id || "Package"} reverted to the last saved catalog state.`);
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

  const patchEventTemplates = (templates, meta = {}) => {
    const nextTemplates = Array.isArray(templates) ? templates : [];
    setDraft((prev) => ({
      ...prev,
      settings: {
        ...(prev.settings || {}),
        eventTemplates: nextTemplates
      }
    }));
    setJsonDrafts((prev) => ({
      ...prev,
      eventTemplates: JSON.stringify(nextTemplates, null, 2)
    }));
    const templateName = nextTemplates.find((template) => template.id === meta.templateId)?.name
      || meta.templateId
      || "Template";
    setStatus(meta.type === "remove"
      ? "Quote starting point removed from this setup draft."
      : `${templateName} updated in this setup draft.`);
  };

  const selectAdminTab = (tabId) => {
    if (tabId !== "templates") {
      setActiveTab(tabId);
      return;
    }
    try {
      const eventTemplates = parseEventTemplateDrafts(jsonDrafts.eventTemplates);
      setDraft((prev) => ({
        ...prev,
        settings: { ...(prev.settings || {}), eventTemplates }
      }));
      setActiveTab("templates");
    } catch (error) {
      setActiveTab("pricing");
      setStatus(`Fix Event Templates JSON before opening the structured editor: ${error.message}`);
    }
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
    if (blockForNewerCatalog()) return;
    const name = String(newEventTypeName || "").trim();
    if (!name) {
      setStatus("Enter an event type name first.");
      return;
    }
    if (blockForOtherDrafts("event-create")) return;
    const id = createCatalogSetupRequestId("event_type");
    const created = { id, name, active: true };
    setMenuEventTypes((current) => [...current, created]);
    setManagedEventType(id);
    setMenuCategories([]);
    setMenuItems([]);
    setSelectedCategory("");
    setNewEventTypeName("");
    catalogSetupDraft.queueChanges([{ collection: "eventTypes", recordId: id, intent: "create", payload: { name, active: true } }]);
    setStatus(`Event type "${name}" added to the setup draft.`);
    pushToast(`Event type "${name}" added to the setup draft.`, "success");
  };

  const handleCreateCategory = async () => {
    if (blockForNewerCatalog()) return;
    const name = String(newCategoryName || "").trim();
    if (!selectedEventType) {
      setStatus("Choose an event type before adding a menu section.");
      return;
    }
    if (!name) {
      setStatus("Enter a menu section name first.");
      return;
    }
    if (blockForOtherDrafts("category-create")) return;
    const id = createCatalogSetupRequestId("menu_section");
    const created = { id, eventTypeId: selectedEventType, name, active: true };
    setMenuCategories((current) => [...current, created]);
    setSelectedCategory(id);
    setNewCategoryName("");
    catalogSetupDraft.queueChanges([{ collection: "menuCategories", recordId: id, intent: "create", payload: { eventTypeId: selectedEventType, name, active: true } }]);
    setStatus(`Menu section "${name}" added to the setup draft.`);
    pushToast(`Menu section "${name}" added to the setup draft.`, "success");
  };

  const handleUpdateEventType = async () => {
    if (blockForNewerCatalog()) return;
    if (!selectedEventType) {
      setStatus("Choose an event type first.");
      return;
    }
    const name = String(eventTypeEditName || "").trim();
    if (!name) {
      setStatus("Event type name cannot be empty.");
      return;
    }
    if (blockForOtherDrafts("event-rename")) return;

    setMenuEventTypes((current) => current.map((item) => item.id === selectedEventType ? { ...item, name } : item));
    setEventTypeRenameTouched(false);
    catalogSetupDraft.queueChanges([{ collection: "eventTypes", recordId: selectedEventType, intent: stagedIntentFor("eventTypes", selectedEventType, "update"), payload: { name, active: true } }]);
    setStatus("Event type updated in the setup draft.");
    pushToast("Event type updated in the setup draft.", "success");
  };

  const handleUpdateCategory = async () => {
    if (blockForNewerCatalog()) return;
    if (!selectedEventType || !selectedCategory) {
      setStatus("Choose an event type and menu section first.");
      return;
    }
    const name = String(categoryEditName || "").trim();
    if (!name) {
      setStatus("Menu section name cannot be empty.");
      return;
    }
    if (blockForOtherDrafts("category-rename")) return;

    setMenuCategories((current) => current.map((item) => item.id === selectedCategory ? { ...item, name } : item));
    setCategoryRenameTouched(false);
    catalogSetupDraft.queueChanges([{ collection: "menuCategories", recordId: selectedCategory, intent: stagedIntentFor("menuCategories", selectedCategory, "update"), payload: { eventTypeId: selectedEventType, name, active: true } }]);
    setStatus("Menu section updated in the setup draft.");
    pushToast("Menu section updated in the setup draft.", "success");
  };

  const handleCreateMenuItem = async () => {
    if (blockForNewerCatalog()) return;
    const name = String(newItemDraft.name || "").trim();
    if (!selectedEventType || !selectedCategory) {
      setStatus("Choose an event type and menu section before adding an item.");
      return;
    }
    if (!name) {
      setStatus("Enter a menu item name first.");
      return;
    }
    if (blockForOtherDrafts("item-create", "", { includeCatalogDraft: false })) return;
    const id = createCatalogSetupRequestId("menu_item");
    const pricingType = normalizePricingType(newItemDraft.pricingType, "per_event");
    const created = { id, eventTypeId: selectedEventType, categoryId: selectedCategory, name, price: Number(newItemDraft.price || 0), cost: newItemDraft.cost === "" ? null : Number(newItemDraft.cost), pricingType, type: pricingType, active: newItemDraft.active !== false };
    setMenuItems((current) => [...current, created]);
    setMenuItemBaselines((current) => ({ ...current, [id]: created }));
    setActiveMenuItemId(id);
    setNewItemDraft({ name: "", price: 0, cost: "", pricingType: "per_event", active: true });
    catalogSetupDraft.queueChanges([{ collection: "menuItems", recordId: id, intent: "create", payload: { name, eventTypeId: selectedEventType, categoryId: selectedCategory, priceMinor: Math.round(created.price * 100), costMinor: created.cost === null ? null : Math.round(created.cost * 100), pricingType, type: pricingType, active: created.active } }]);
    setStatus("Menu item added to the setup draft.");
    pushToast("Menu item added to the setup draft.", "success");
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
    if (blockForNewerCatalog()) return;
    const itemId = String(item?.id || "").trim();
    if (!itemId) return;
    const baseline = menuItemBaselines[itemId];
    const pricingType = normalizePricingType(item.pricingType || item.type, "per_event");
    const normalized = {
      ...item,
      name: String(item.name || "").trim() || "Untitled Item",
      eventTypeId: selectedEventType || item.eventTypeId,
      categoryId: item.categoryId || selectedCategory,
      price: Number(item.price || 0),
      cost: item.cost === "" || item.cost === null || item.cost === undefined ? null : Number(item.cost),
      pricingType,
      type: pricingType,
      active: item.active !== false
    };
    catalogSetupDraft.queueChanges([{
      collection: "menuItems",
      recordId: itemId,
      intent: stagedIntentFor(
        "menuItems",
        itemId,
        baseline ? (normalized.active ? "update" : "deactivate") : "create"
      ),
      payload: {
        name: normalized.name,
        eventTypeId: normalized.eventTypeId,
        categoryId: normalized.categoryId,
        priceMinor: Math.round(normalized.price * 100),
        costMinor: normalized.cost === null ? null : Math.round(normalized.cost * 100),
        pricingType,
        type: pricingType,
        active: normalized.active
      }
    }]);
    setMenuItems((current) => current.map((entry) => entry.id === itemId ? normalized : entry));
    setMenuItemBaselines((current) => ({ ...current, [itemId]: normalized }));
    setMenuItemDirty((current) => {
      const next = { ...current };
      delete next[itemId];
      return next;
    });
    setStatus("Menu item added to the shared setup draft.");
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
    if (blockForNewerCatalog()) return;
    if (blockManagedMenuMutationForDraft("delete", id)) return;
    if (blockForOtherDrafts()) return;
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
    const item = menuItems.find((entry) => entry.id === id);
    if (!item) return;
    const pricingType = normalizePricingType(item.pricingType || item.type, "per_event");
    catalogSetupDraft.queueChanges([{
      collection: "menuItems",
      recordId: id,
      intent: stagedIntentFor("menuItems", id, "deactivate"),
      payload: {
        name: item.name,
        eventTypeId: item.eventTypeId || selectedEventType,
        categoryId: item.categoryId || selectedCategory,
        priceMinor: Math.round(Number(item.price || 0) * 100),
        costMinor: item.cost === null || item.cost === undefined || item.cost === "" ? null : Math.round(Number(item.cost) * 100),
        pricingType,
        type: pricingType,
        active: false
      }
    }]);
    setMenuItems((current) => current.map((entry) => entry.id === id ? { ...entry, active: false } : entry));
    setStatus("Menu item made unavailable in the setup draft. Active quotes are unchanged.");
    pushToast("Menu item made unavailable in the setup draft.", "success");
  };

  const handleLogoUpload = async (file) => {
    if (!file) return;
    if (blockForNewerCatalog()) return;
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
    if (blockForNewerCatalog()) return;
    if (hasManagedMenuDraft) {
      setStatus("One menu edit is still in progress. Save or discard it, then save the rest of the Library. Nothing else was saved.");
      return;
    }
    try {
      const nextDraft = buildPersistableCatalogDraft(draft, jsonDrafts);
      const normalizedBaseline = buildPersistableCatalogDraft(
        savedCatalogSnapshot,
        buildJsonDrafts(savedCatalogSnapshot)
      );
      const changes = buildCatalogSetupChanges({
        catalog: nextDraft,
        baselineCatalog: normalizedBaseline,
        serverFingerprints: catalog?.serverFingerprints || {}
      });
      if (changes.length === 0) {
        setStatus("No unpublished catalog changes.");
        return;
      }
      catalogSetupDraft.queueChanges(changes);
      await catalogSetupDraft.syncNow();
      setCatalogRefreshRequired(false);
      setStatus("Catalog draft saved. Active pricing is unchanged until publication.");
      pushToast("Catalog draft saved. Active pricing is unchanged until publication.", "success");
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
    : catalogDraftCapabilityState(catalogSetupDraft);
  const catalogEditorStateLabel = saving || catalogSetupDraft.status === "saving"
    ? "Saving draft…"
    : catalogSetupDraft.deviceOnly && catalogSetupDraftChanges.length > 0
      ? "Device-only changes"
      : hasAnyUnsavedChanges
        ? "Unsaved changes"
        : Number(catalogSetupDraft.changedRecordCount || 0) > 0
          ? "Draft saved"
          : "Published catalog active";
  const catalogFooterStatus = catalogSetupDraft.deviceOnly && catalogSetupDraftChanges.length > 0
    ? catalogSetupDraft.label
    : status || (hasAnyUnsavedChanges
      ? "Your changes are not saved yet."
      : Number(catalogSetupDraft.changedRecordCount || 0) > 0
        ? "Catalog draft saved. Active pricing is unchanged until publication."
        : "Published catalog is active.");

  const normalizedMenuSearch = String(menuSearch || "").trim().toLowerCase();
  const selectedCategoryItems = menuItems.filter((item) => (
    item.categoryId === selectedCategory
    && (showUnavailableMenuItems || item.active !== false)
    && (!normalizedMenuSearch || `${item.name || ""} ${item.id || ""}`.toLowerCase().includes(normalizedMenuSearch))
  ));
  const activeMenuItem = selectedCategoryItems.find((item) => item.id === activeMenuItemId)
    || selectedCategoryItems[0]
    || null;
  const saveActiveMenuItem = () => activeMenuItem && handleManagedMenuItemBlur(activeMenuItem.id);
  const saveActiveMenuItemOnEnter = (event) => activeMenuItem && handleManagedMenuItemKeyDown(event, activeMenuItem.id);
  const selectedCategoryItemCount = menuItems.filter((item) => item.categoryId === selectedCategory).length;
  const applyBulkMenuChange = ({ active, categoryId } = {}) => {
    const selected = menuItems.filter((item) => selectedMenuItemIds.includes(item.id));
    if (!selected.length) return;
    if (categoryId && !menuCategories.some((section) => section.id === categoryId)) {
      setStatus("Choose a menu section first.");
      return;
    }
    selected.forEach((item) => {
      void handleUpdateManagedMenuItem({
        ...item,
        ...(typeof active === "boolean" ? { active } : {}),
        ...(categoryId ? { categoryId } : {})
      });
    });
    setSelectedMenuItemIds([]);
    setStatus(categoryId
      ? `${selected.length} items moved in the draft.`
      : `${selected.length} availability changes saved to the draft.`);
  };
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
  const documentFontPreference = normalizeProposalDocumentFontScale(draft?.settings?.documentFontScale);
  const brandNamePreview = String(
    draft?.settings?.brandName || draft?.settings?.organizationName || "your business"
  ).trim() || "your business";
  const brandTaglinePreview = String(draft?.settings?.brandTagline || "").trim();
  const brandLogoDraftValue = String(draft?.settings?.brandLogoUrl || "").trim();
  const brandLogoPreview = normalizeBrandLogoUrl(brandLogoDraftValue);
  const brandLogoNeedsDirectUrl = Boolean(brandLogoDraftValue && !brandLogoPreview);
  const brandReadinessItems = [
    {
      label: "Logo",
      detail: brandLogoPreview
        ? "Defined"
        : brandLogoNeedsDirectUrl
          ? "Use a direct HTTPS image URL"
          : "Monogram fallback",
      state: brandLogoPreview ? "ready" : "watch"
    },
    {
      label: "Name",
      detail: brandNamePreview,
      state: brandNamePreview === "your business" ? "watch" : "ready"
    },
    {
      label: "Font",
      detail: documentFontPreference.label,
      state: "ready"
    },
    {
      label: "Contact",
      detail: draft?.settings?.businessEmail || draft?.settings?.businessPhone ? "Included" : "Missing",
      state: draft?.settings?.businessEmail || draft?.settings?.businessPhone ? "ready" : "watch"
    }
  ];
  const enabledUpsellRules = (Array.isArray(draft.settings?.upsellRules) ? draft.settings.upsellRules : [])
    .filter((rule) => rule?.enabled !== false);
  const targetedUpsellRules = enabledUpsellRules.filter((rule) => (
    String(rule?.kind || "") === "package" || String(rule?.targetId || "").trim()
  ));
  const activeCostRecords = [
    ...(Array.isArray(draft.packages) ? draft.packages : [])
      .filter((item) => item?.active !== false)
      .map((item) => ({ id: item.id, kind: "Package", name: item.name, recorded: hasRecordedNonNegativeNumber(item.costPpp) })),
    ...(Array.isArray(draft.addons) ? draft.addons : [])
      .filter((item) => item?.active !== false)
      .map((item) => ({ id: item.id, kind: "Add-on", name: item.name, recorded: hasRecordedNonNegativeNumber(item.cost) })),
    ...(Array.isArray(draft.rentals) ? draft.rentals : [])
      .filter((item) => item?.active !== false)
      .map((item) => ({ id: item.id, kind: "Rental", name: item.name, recorded: hasRecordedNonNegativeNumber(item.cost) }))
  ];
  const recordedCostCount = activeCostRecords.filter((item) => item.recorded).length;
  const missingCostExamples = activeCostRecords
    .filter((item) => !item.recorded)
    .slice(0, 4)
    .map((item) => `${item.kind}: ${item.name || item.id || "Untitled"}`);
  const staffCostRates = [
    { id: "server", recorded: hasRecordedNonNegativeNumber(draft.settings?.serverCostRate) },
    { id: "chef", recorded: hasRecordedNonNegativeNumber(draft.settings?.chefCostRate) },
    { id: "bartender", recorded: hasRecordedNonNegativeNumber(draft.settings?.bartenderCostRate) }
  ];
  const recordedStaffCostCount = staffCostRates.filter((item) => item.recorded).length;
  const targetMarginCandidate = Number(draft.settings?.targetMarginPct);
  const targetMarginPct = Number.isFinite(targetMarginCandidate) && targetMarginCandidate >= 0 && targetMarginCandidate <= 1
    ? targetMarginCandidate
    : null;
  const handleReload = () => {
    if (pendingCatalogEvidenceRef.current) {
      if (!window.confirm("Discard unsaved Library changes and load the newer version?")) {
        setStatus("Your unsaved Library changes are still here. Nothing was reloaded.");
        return;
      }
      const pending = pendingCatalogEvidenceRef.current;
      pendingCatalogEvidenceRef.current = null;
      resetOnNextOpenRef.current = false;
      initializedViewScopeRef.current = pending.viewScopeKey;
      eventTypesLoadScopeRef.current = "";
      confirmedInventoryLoadScopeRef.current = "";
      eventMenuLoadScopeRef.current = "";
      setDraft(pending.catalog);
      setSavedCatalogSnapshot(cloneCatalogSnapshot(pending.catalog));
      const latestJsonDrafts = buildJsonDrafts(pending.catalog);
      setJsonDrafts(latestJsonDrafts);
      setSavedFingerprint(catalogDraftFingerprint(pending.catalog, latestJsonDrafts));
      setSelectedPackageId(String(pending?.catalog?.packages?.[0]?.id || "").trim());
      setSelectedEventType(String(selectedEventTypeProp || "").trim());
      setSelectedCategory("");
      setMenuEventTypes([]);
      setMenuCategories([]);
      setMenuItems([]);
      setMenuItemBaselines({});
      setMenuItemDirty({});
      setMenuItemSavingId("");
      menuItemSaveInFlightRef.current.clear();
      setNewEventTypeName("");
      setNewCategoryName("");
      setEventTypeEditName("");
      setCategoryEditName("");
      setEventTypeRenameTouched(false);
      setCategoryRenameTouched(false);
      setNewItemDraft({ name: "", price: 0, cost: "", pricingType: "per_event", active: true });
      setMenuSearch("");
      setShowUnavailableMenuItems(false);
      setSelectedMenuItemIds([]);
      setBulkTargetSection("");
      setCatalogRefreshRequired(false);
      setStatus("The latest Library version is loaded. Review it before making changes.");
      onInteractionStateChange?.({ dirty: false, busy: false });
      return;
    }
    if (typeof onReload !== "function") {
      setStatus("Catalog refresh is unavailable. Close and reopen Catalog Admin.");
      return;
    }
    setStatus("Refreshing the latest catalog from the server...");
    onReload({ background: true });
  };
  return (
    <div
      ref={dialogRef}
      className={embedded ? "container workspace-route-main embedded-workspace-route" : "modal-overlay"}
      data-layout-overlap-allowed={embedded ? undefined : "true"}
      data-portal-option-authoring={PILOT_DECISION_ROOM_ENABLED
        ? AMBIENT_DECISION_ROOM_AUTHORING_ENABLED ? "ambient" : "legacy-v0.7"
        : "off"}
      role={embedded ? "region" : "dialog"}
      aria-modal={embedded ? undefined : "true"}
      aria-labelledby="catalog-admin-title"
      tabIndex={-1}
    >
      <div className={`modal-card admin-catalog-card${embedded ? " workspace-route-card" : ""}`}>
        <div className="modal-head">
          <h2 id="catalog-admin-title">{surfaceTitle}</h2>
          <div className="admin-save-actions">
            <span className={hasAnyUnsavedChanges ? "admin-save-state unsaved" : "admin-save-state"}>
              {catalogEditorStateLabel}
            </span>
            {!starterChoiceOnly && !packageWorkspaceActive && (saving || hasUnsavedChanges) && (
              <button
                type="button"
                className="cta"
                onClick={handleSave}
                disabled={saving || !hasUnsavedChanges || Boolean(pendingCatalogEvidenceRef.current)}
              >
                {saving ? "Saving..." : "Sync draft now"}
              </button>
            )}
            <button
              type="button"
              className="ghost"
              data-modal-initial-focus
              onClick={handleClose}
              disabled={closeBlocked}
            >
              {embedded ? embeddedCloseLabel : "Close"}
            </button>
          </div>
        </div>

        <CatalogDraftStateBar
          draftState={catalogSetupDraft}
          disabled={saving || menuActionLoading}
          onRetry={catalogSetupDraft.retry}
          onReview={catalogSetupDraft.review}
          onPublish={async () => {
            const receipt = await catalogSetupDraft.publish();
            acceptedCatalogRevisionRef.current = receipt.catalogRevisionAfter;
            setStatus(`Catalog revision ${receipt.catalogRevisionAfter} published and pricing confirmed.`);
            pushToast(`Catalog revision ${receipt.catalogRevisionAfter} published.`, "success");
            onReload?.({ background: true });
            return receipt;
          }}
        />

        <div className="admin-tabs" role="tablist" aria-label="Catalog admin sections">
          {visibleAdminTabs.map((tab) => (
            <button
              key={tab.id}
              id={`catalog-admin-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={resolvedActiveTab === tab.id}
              aria-controls={`catalog-admin-panel-${tab.id}`}
              tabIndex={resolvedActiveTab === tab.id ? 0 : -1}
              className={`admin-tab ${resolvedActiveTab === tab.id ? "active" : ""}`}
              data-admin-tab-id={tab.id}
              onClick={() => selectAdminTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div
          id={`catalog-admin-panel-${resolvedActiveTab}`}
          role="tabpanel"
          aria-labelledby={`catalog-admin-tab-${resolvedActiveTab}`}
          tabIndex={0}
        >

        {pricingReviewRequired && (
          <div className="starter-pack-review-banner" role="status">
            <strong>{stagedPack.name || "Setup preset"} is a draft.</strong>
            <span> Suggested prices are not active until an admin reviews the complete catalog and confirms pricing.</span>
          </div>
        )}

        {existingContentRequiresManualSetup && (
          <div className="starter-pack-review-banner" role="status">
            <strong>Existing catalog records were found.</strong>
            <span> Setup presets are staged intent. Continue editing this catalog, or close and choose Import Studio.</span>
          </div>
        )}

        {confirmedMissingMenuRecovery && (
          <div className="starter-pack-review-banner" role="alert">
            <div>
              <strong>This confirmed catalog has no menu.</strong>
              <span> Choose a setup preset to add missing records to the shared draft. Active pricing stays unchanged until review and publication.</span>
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

        {resolvedActiveTab === "starter" && showStarterTab && (
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
                          || !showStarterTab}
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
                  >Create my own catalog</button>
                </div>
              )}
            </div>
          </section>
        )}

        {resolvedActiveTab === "packages" && (
          <>
            <PackageWorkspace
              workspace={packageWorkspace}
              draftCatalog={draft}
              savedCatalog={savedCatalogSnapshot}
              selectedPackageId={packageWorkspace.selectedPackageId}
              onSelectPackage={setSelectedPackageId}
              onAddPackage={() => addRow("packages")}
              onDeletePackage={deletePackageById}
              onRevertPackage={revertPackageDraft}
              onPatchPackageField={patchPackageField}
              onReplacePackageInclusionIds={replacePackageInclusionIds}
              menuItems={menuItems}
              menuEventTypes={menuEventTypes}
              menuCategories={menuCategories}
              selectedEventType={selectedEventType}
              onSelectEventType={setManagedEventType}
              menuLoading={menuLoading}
              marginsEnabled
              packageDeletionSummary={packageDeletionSummary}
            />
            <div className="package-workspace-savebar">
              <div>
                <span className={hasAnyUnsavedChanges ? "admin-save-state unsaved" : "admin-save-state"}>
                  {catalogEditorStateLabel}
                </span>
                <small>Edits auto-save as staged intent. Publication is the only action that activates pricing.</small>
              </div>
              {(saving || hasUnsavedChanges) && (
                <button
                  type="button"
                  className="cta"
                  onClick={handleSave}
                  disabled={saving || !hasUnsavedChanges || Boolean(pendingCatalogEvidenceRef.current)}
                >
                  {saving ? "Saving..." : "Sync draft now"}
                </button>
              )}
            </div>
          </>
        )}

        {resolvedActiveTab === "addons" && (
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
                <option value="per_person">Per guest</option>
                <option value="per_item">Per item</option>
                <option value="per_event">Per event</option>
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

        {resolvedActiveTab === "rentals" && (
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
                <option value="per_item">Per item</option>
                <option value="per_person">Per guest</option>
                <option value="per_event">Per event</option>
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

        {resolvedActiveTab === "menu" && (
          <section className="admin-section admin-menu-builder">
            <h3 className="admin-menu-builder-heading">Menu Builder</h3>

            <div className="admin-section-body admin-menu-workbench">
              <aside className="admin-menu-context-panel" aria-label="Menu context">
                <label className="admin-menu-field">
                  <span>Event type</span>
                  <select
                    value={selectedEventType}
                    onChange={(e) => {
                      setManagedEventType(e.target.value);
                      setActiveMenuItemId("");
                    }}
                    disabled={menuLoading}
                  >
                    <option value="">Choose event type</option>
                    {menuEventTypes.map((eventType) => (
                      <option key={eventType.id} value={eventType.id}>{eventType.name}</option>
                    ))}
                  </select>
                </label>

                <MenuStructureEditor
                  kind="event type"
                  addLabel="Add Event Type"
                  open={menuEventTypes.length === 0}
                  selected={selectedEventType}
                  currentValue={eventTypeEditName}
                  newValue={newEventTypeName}
                  disabled={menuLoading}
                  actionLoading={menuActionLoading}
                  onCurrentChange={(event) => {
                    setEventTypeEditName(event.target.value);
                    setEventTypeRenameTouched(true);
                  }}
                  onCurrentSave={handleUpdateEventType}
                  onNewChange={(event) => setNewEventTypeName(event.target.value)}
                  onNewSave={handleCreateEventType}
                />

                <label className="admin-menu-field">
                  <span>Menu section</span>
                  <select
                    value={selectedCategory}
                    onChange={(e) => {
                      setSelectedCategory(e.target.value);
                      setActiveMenuItemId("");
                    }}
                    disabled={!selectedEventType || menuLoading}
                  >
                    <option value="">Choose menu section</option>
                    {menuCategories.map((category) => (
                      <option key={category.id} value={category.id}>{category.name}</option>
                    ))}
                  </select>
                </label>

                <MenuStructureEditor
                  kind="menu section"
                  addLabel="Add Menu Section"
                  open={menuCategories.length === 0}
                  selected={selectedCategory}
                  currentValue={categoryEditName}
                  newValue={newCategoryName}
                  disabled={!selectedEventType}
                  actionLoading={menuActionLoading}
                  onCurrentChange={(event) => {
                    setCategoryEditName(event.target.value);
                    setCategoryRenameTouched(true);
                  }}
                  onCurrentSave={handleUpdateCategory}
                  onNewChange={(event) => setNewCategoryName(event.target.value)}
                  onNewSave={handleCreateCategory}
                />
              </aside>

              <section className="admin-menu-items-panel" aria-label="Menu items">
                <div className="admin-menu-panel-heading">
                  <h4>{selectedCategoryRecord ? `${selectedCategoryItemCount} items` : "Choose a menu section"}</h4>
                </div>

                <div className="admin-menu-builder-tools">
                  <label className="admin-menu-search-field">
                    <span>Find an item</span>
                    <input
                      type="search"
                      placeholder="Search by name"
                      value={menuSearch}
                      onChange={(event) => setMenuSearch(event.target.value)}
                    />
                  </label>
                  <label className="admin-inline-toggle admin-menu-availability-filter">
                    <input type="checkbox" checked={showUnavailableMenuItems} onChange={(event) => setShowUnavailableMenuItems(event.target.checked)} />
                    <span>Show unavailable</span>
                  </label>
                </div>

                {selectedCategory && (
                  <details className="admin-menu-add-item" open={selectedCategoryItemCount === 0}>
                    <summary>+ Add an item to {selectedCategoryRecord?.name || "this menu section"}</summary>
                    <div className="admin-menu-new-item-grid">
                      <MenuItemFields
                        item={newItemDraft}
                        isNew
                        onChange={(field, value) => setNewItemDraft((current) => ({ ...current, [field]: value }))}
                      />
                      <button type="button" className="ghost compact admin-menu-add-item-action" onClick={handleCreateMenuItem} disabled={menuActionLoading}>
                        {menuActionLoading ? "Adding..." : "Add Item"}
                      </button>
                    </div>
                  </details>
                )}

                {selectedMenuItemIds.length > 0 && (
                  <div className="admin-menu-bulk-bar">
                    <strong>{selectedMenuItemIds.length} selected</strong>
                    <button type="button" className="ghost compact" onClick={() => applyBulkMenuChange({ active: true })}>Make available</button>
                    <button type="button" className="ghost compact" onClick={() => applyBulkMenuChange({ active: false })}>Make unavailable</button>
                    <select aria-label="Move selected items to menu section" value={bulkTargetSection} onChange={(event) => setBulkTargetSection(event.target.value)}>
                      <option value="">Move to menu section…</option>
                      {menuCategories.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
                    </select>
                    <button type="button" className="ghost compact" disabled={!bulkTargetSection} onClick={() => applyBulkMenuChange({ categoryId: bulkTargetSection })}>Move selected</button>
                  </div>
                )}

                {menuLoading && <p className="source-note">Loading menu data...</p>}
                {!menuLoading && selectedCategory && selectedCategoryItems.length === 0 && (
                  <div className="admin-menu-empty-state">
                    <strong>No items match this view.</strong>
                  </div>
                )}

                {!menuLoading && activeMenuItem && (
                  <div className="admin-menu-item-workspace">
                    <div className="admin-menu-item-list">
                      {selectedCategoryItems.map((item) => {
                        const priceBasis = normalizePricingType(item.pricingType || item.type, "per_event");
                        const priceBasisLabel = priceBasis === "per_person" ? "Per guest" : priceBasis === "per_item" ? "Per item" : "Per event";
                        const isActiveItem = item.id === activeMenuItem.id;
                        return (
                          <div className={`admin-menu-item-list-row${isActiveItem ? " is-active" : ""}`} key={item.id}>
                            <input
                              type="checkbox"
                              aria-label={`Select ${item.name || "menu item"}`}
                              checked={selectedMenuItemIds.includes(item.id)}
                              onChange={(event) => setSelectedMenuItemIds((current) => event.target.checked ? [...new Set([...current, item.id])] : current.filter((id) => id !== item.id))}
                            />
                            <button type="button" className="admin-menu-item-choice" aria-pressed={isActiveItem} onClick={() => setActiveMenuItemId(item.id)}>
                              <strong>{item.name || "Unnamed item"}</strong>
                              <span>${Number(item.price || 0).toFixed(2)} · {priceBasisLabel}</span>
                            </button>
                          </div>
                        );
                      })}
                    </div>

                    <section className="admin-menu-item-editor" aria-label={`Edit ${activeMenuItem.name || "menu item"}`}>
                      <div className="admin-menu-item-fields">
                        <MenuItemFields
                          item={activeMenuItem}
                          onChange={(field, value) => patchManagedMenuItem(activeMenuItem.id, field, value)}
                          onBlur={saveActiveMenuItem}
                          onKeyDown={saveActiveMenuItemOnEnter}
                        />
                      </div>
                    </section>
                  </div>
                )}
              </section>
            </div>
          </section>
        )}

        {AMBIENT_UI_ENABLED && EventTemplatesEditor && resolvedActiveTab === "templates" && (
          <Suspense fallback={<div className="admin-section" role="status">Opening event templates…</div>}>
            <EventTemplatesEditor
              templates={draft.settings?.eventTemplates || []}
              eventTypes={menuEventTypes}
              packages={draft.packages || []}
              addons={draft.addons || []}
              rentals={draft.rentals || []}
              menuItems={menuItems}
              menuSections={draft.settings?.menuSections || []}
              menuInventoryComplete={false}
              onChange={patchEventTemplates}
              focusRequest={String(focusRequest?.sectionId || "").trim() === "templates"
                && String(focusRequest?.recordId || "").trim()
                ? {
                    requestId: focusRequest.requestId || focusRequest.id,
                    templateId: focusRequest.recordId,
                    field: focusRequest.field || "summary",
                    reason: focusRequest.reason
                  }
                : null}
              onFocusResolution={onFocusResolution}
              disabled={saving || closeBlocked}
            />
          </Suspense>
        )}

        {resolvedActiveTab === "pricing" && (
          <>
            <section className="admin-section">
              <div className="admin-section-head"><h3>Review Pricing Before Quoting</h3></div>
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
          <div className="admin-section-head"><h3>Pricing &amp; Quote Defaults</h3></div>
          {PILOT_MARGINS_ENABLED && (
            <div className="cost-margin-summary" data-testid="catalog-cost-margin-summary">
              <div>
                <span>{recordedCostCount}/{activeCostRecords.length}</span>
                <small>active catalog costs</small>
              </div>
              <div>
                <span>{recordedStaffCostCount}/3</span>
                <small>staff cost rates</small>
              </div>
              <div>
                <span>{targetMarginPct === null ? "—" : `${Math.round(targetMarginPct * 100)}%`}</span>
                <small>target margin</small>
              </div>
              <p>
                {missingCostExamples.length
                  ? `Margin remains unavailable for quotes using missing cost fields, including ${missingCostExamples.join(", ")}.`
                  : "Active catalog cost fields are recorded. A quote still needs complete selected-line cost coverage before margin is shown."}
              </p>
            </div>
          )}
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
            <h3>Suggestions &amp; Staffing</h3>
            <button type="button" className="ghost" onClick={addUpsellRule}>Add Rule</button>
          </div>
          <div className="rule-system-summary" data-testid="catalog-rules-summary">
            <div>
              <span>{enabledUpsellRules.length}</span>
              <small>enabled rules</small>
            </div>
            <div>
              <span>{targetedUpsellRules.length}</span>
              <small>targeted offers</small>
            </div>
            <p>
              {draft.settings?.guidedSellingEnabled !== false
                ? "Guided selling is active; matching rules appear inside the quote workspace with their next step."
                : "Guided selling is off; rules stay saved but will not be shown to quote builders."}
            </p>
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
          <div className="admin-section-head"><h3>Workspace Features</h3></div>
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
          <div className="admin-section-head"><h3>Proposal Details</h3></div>
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
            <label data-testid="proposal-font-size-setting">
              Proposal font size
              <small className="admin-field-hint">Controls client preview and PDF text size for future saved quotes.</small>
              <select
                value={documentFontPreference.id}
                onChange={(e) => patchTextSetting("documentFontScale", normalizeProposalDocumentFontScale(e.target.value).id)}
              >
                {PROPOSAL_DOCUMENT_FONT_SCALE_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label} - {option.description}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Proposal intro title
              <input
                type="text"
                value={draft.settings.proposalIntroTitle || ""}
                onChange={(e) => patchTextSetting("proposalIntroTitle", e.target.value)}
              />
            </label>
            <label className="admin-field-span-2">
              Proposal intro message
              <textarea
                rows="4"
                maxLength={1200}
                value={draft.settings.proposalIntroMessage || ""}
                onChange={(e) => patchTextSetting("proposalIntroMessage", e.target.value)}
              />
            </label>
            <label className="admin-field-span-2">
              Proposal closing message
              <textarea
                rows="4"
                maxLength={1200}
                value={draft.settings.proposalClosingMessage || ""}
                onChange={(e) => patchTextSetting("proposalClosingMessage", e.target.value)}
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
            {PILOT_DECISION_ROOM_ENABLED && (
              <label>
                Portal terms (shown to customers in their proposal; leave blank for no terms block)
                <textarea
                  rows="5"
                  maxLength={5000}
                  value={draft.settings.portalTermsText || ""}
                  onChange={(e) => patchTextSetting("portalTermsText", e.target.value)}
                />
              </label>
            )}
          </div>
            </section>

            <section className="admin-section">
          <div className="admin-section-head"><h3>CRM integrations</h3></div>
          <p className="source-note">
            Outbound CRM delivery is not enabled in this release. QuotePilot does not accept endpoint or bearer-token settings here, and Integration Ops records audit events only until a server-authorized connector is installed.
          </p>
            </section>

            <section className="admin-section">
          <div className="admin-section-head"><h3>Your Customer-facing Brand</h3></div>
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
                <div className="portal-theme-preview-mark" aria-hidden="true">
                  {brandLogoPreview ? (
                    <img src={brandLogoPreview} alt="" />
                  ) : (
                    <span>{brandInitials(brandNamePreview)}</span>
                  )}
                </div>
                <span>Customer portal preview</span>
                <strong>
                  Your proposal from {brandNamePreview}
                </strong>
                <small>
                  {selectedPortalTheme?.name || "Custom colors"} · {documentFontPreference.label} proposal text
                </small>
              </div>
            </div>
          </div>
          <div className="brand-readiness-panel" data-testid="brand-readiness-panel">
            <div className="brand-readiness-mark">
              {brandLogoPreview ? (
                <img src={brandLogoPreview} alt={`${brandNamePreview} logo`} />
              ) : (
                <span>{brandInitials(brandNamePreview)}</span>
              )}
            </div>
            <div className="brand-readiness-copy">
              <p className="portal-theme-label">Proposal letterhead</p>
              <strong>{brandNamePreview}</strong>
              <small>{brandTaglinePreview || "No tagline set"}</small>
            </div>
            <ul className="brand-readiness-list" aria-label="Brand readiness">
              {brandReadinessItems.map((item) => (
                <li key={item.label} data-state={item.state}>
                  <span>{item.label}</span>
                  <strong>{item.detail}</strong>
                </li>
              ))}
            </ul>
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
            <div className="admin-brand-actions">
              <span>{brandLogoPreview
                ? "Logo preview is active."
                : brandLogoNeedsDirectUrl
                  ? "This URL cannot be used as an image. Use a direct HTTPS image URL or upload a logo."
                  : "No image logo yet; proposal uses the monogram fallback."}</span>
              <button
                type="button"
                className="ghost compact"
                onClick={() => {
                  patchTextSetting("brandLogoUrl", "");
                  setStatus("Logo removed from draft. Click Save Catalog to persist.");
                }}
                disabled={!brandLogoDraftValue || uploadingLogo}
              >
                Clear logo
              </button>
            </div>
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
          <div className="admin-section-head"><h3>Smart Defaults</h3></div>
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
          <div className="admin-section-head"><h3>Advanced Settings (JSON)</h3></div>
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
        </div>

        <div className="modal-foot" data-capability-state={catalogSaveCapabilityState}>
          <span className="source-note" role="status" aria-live="polite">
            {catalogFooterStatus}
          </span>
          {catalogRefreshRequired && (
            <button type="button" className="ghost" onClick={handleReload} disabled={closeBlocked}>
              Refresh latest catalog
            </button>
          )}
          {!starterChoiceOnly && !packageWorkspaceActive && (saving || hasUnsavedChanges) && (
            <button
              type="button"
              className="cta"
              onClick={handleSave}
              disabled={saving || !hasUnsavedChanges || Boolean(pendingCatalogEvidenceRef.current)}
            >
              {saving ? "Saving..." : "Sync draft now"}
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
