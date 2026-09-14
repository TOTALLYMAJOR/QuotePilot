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
import { isCatalogPricingConfirmationCurrent } from "../lib/catalogPricingConfirmation";
import { useModalDialog } from "../hooks/useModalDialog";
import { useCatalogSetupDraft } from "../hooks/useCatalogSetupDraft";
import {
  applyCatalogSetupDraftChanges,
  buildCatalogSetupChanges,
  createCatalogSetupRequestId,
  stageCatalogSetupPreset
} from "../lib/catalogSetupDraftService";
import PackageWorkspace from "./PackageWorkspace";
import DeliveryPlanningConfigurationPanel from "./DeliveryPlanningConfigurationPanel";
import CatalogDraftStateBar, { catalogDraftCapabilityState } from "./CatalogDraftStateBar";
import AdaptiveChoiceField from "./AdaptiveChoiceField";
import FieldStateIndicator from "./FieldStateIndicator";
import InventoryRecipeEditor from "./InventoryRecipeEditor";
import {
  validateCommercialPublication,
  validateConfigurationRule
} from "../lib/commercialPlatform";
import {
  buildDeliveryPlanningDraftCatalog,
  validateDeliveryPlanningConfiguration
} from "../lib/deliveryPlanningConfiguration";

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
    key: "configurationRules",
    label: "Configuration Rules JSON",
    hint: "Bounded declarative rules only: id, type, conditions, effect, reason, severity, verticalScope, enabled, and provenance."
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
  { value: "package", label: "Offer" }
];

const ADMIN_TABS = [
  { id: "starter", label: "Setup" },
  { id: "packages", label: "Offers" },
  { id: "addons", label: "Addons" },
  { id: "rentals", label: "Rentals" },
  { id: "menu", label: "Menu" },
  ...(AMBIENT_UI_ENABLED ? [{ id: "templates", label: "Templates" }] : []),
  { id: "delivery", label: "Delivery" },
  { id: "rules", label: "Rules" },
  { id: "pricing", label: "Pricing" }
];

const RULE_TYPE_LABELS = Object.freeze({
  recommendation: "Recommendation",
  requirement: "Required choice",
  selection: "Selection",
  exclusion: "Excluded choice",
  validation: "Quote check"
});

const RULE_TYPE_OPTIONS = Object.freeze(Object.entries(RULE_TYPE_LABELS).map(([value, label]) => ({ value, label })));
const RULE_CONDITION_OPERATOR_OPTIONS = Object.freeze([
  { value: "eq", label: "Is" },
  { value: "neq", label: "Is not" },
  { value: "gte", label: "Is at least" },
  { value: "lte", label: "Is at most" },
  { value: "includes", label: "Includes" },
  { value: "selected", label: "Has selected" }
]);
const RULE_EFFECT_OPERATOR_OPTIONS = Object.freeze([
  { value: "block", label: "Stop quote" },
  { value: "require", label: "Require" },
  { value: "recommend", label: "Recommend" },
  { value: "select", label: "Select" },
  { value: "exclude", label: "Exclude" }
]);
const RULE_COMPONENT_TYPE_LABELS = Object.freeze({
  menu_item: "Menu item",
  addon: "Add-on",
  rental: "Rental",
  resource: "Resource"
});

const RULE_PATH_LABELS = Object.freeze({
  "event.demandQuantity": "Guests",
  "event.guests": "Guests",
  "event.serviceStyle": "Service style",
  "selection.offerRef": "Offer",
  "selection.package": "Offer",
  "selection.bar": "Bar service",
  "resources.servers": "Servers",
  "resources.chefs": "Chefs",
  "resources.bartenders": "Bartenders"
});

function sentenceCaseIdentifier(value = "") {
  const normalized = String(value || "")
    .trim()
    .split(".")
    .at(-1)
    ?.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  if (!normalized) return "Unspecified detail";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function rulePathLabel(value = "") {
  const normalized = String(value || "").trim();
  return RULE_PATH_LABELS[normalized] || sentenceCaseIdentifier(normalized);
}

function ruleValueLabel(value) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  if (value === null || value === undefined || value === "") return "No value";
  if (Array.isArray(value)) return value.map(ruleValueLabel).join(", ");
  if (typeof value === "object") return "Configured value";
  return String(value);
}

function ruleConditionLabel(condition = {}) {
  const operator = String(condition?.operator || "").trim();
  const operatorLabel = {
    eq: "is",
    neq: "is not",
    gte: "is at least",
    lte: "is at most",
    includes: "includes",
    selected: "has selected"
  }[operator] || sentenceCaseIdentifier(operator || "condition");
  return `${rulePathLabel(condition?.path)} ${operatorLabel} ${ruleValueLabel(condition?.value)}`;
}

function isPlainRuleRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function configurationRuleMenuItems(catalog = {}) {
  const direct = Array.isArray(catalog?.menuItems) ? catalog.menuItems : [];
  const sectionItems = Array.isArray(catalog?.settings?.menuSections)
    ? catalog.settings.menuSections.flatMap((section) => Array.isArray(section?.items) ? section.items : [])
    : [];
  const byId = new Map();
  [...direct, ...sectionItems].forEach((item) => {
    const id = String(item?.id || "").trim();
    if (id && !byId.has(id)) byId.set(id, item);
  });
  return [...byId.values()];
}

function configurationRuleComponentRecords(catalog = {}, componentType = "") {
  if (componentType === "menu_item") return configurationRuleMenuItems(catalog);
  if (componentType === "addon") return Array.isArray(catalog?.addons) ? catalog.addons : [];
  if (componentType === "rental") return Array.isArray(catalog?.rentals) ? catalog.rentals : [];
  if (componentType === "resource") return Array.isArray(catalog?.resources) ? catalog.resources : [];
  return [];
}

export function resolveConfigurationRuleComponentRef(componentRef = {}, catalog = {}, options = {}) {
  const componentType = String(componentRef?.componentType || "").trim();
  const componentId = String(componentRef?.componentId || "").trim();
  const typeLabel = RULE_COMPONENT_TYPE_LABELS[componentType] || "Component";
  const record = configurationRuleComponentRecords(catalog, componentType)
    .find((candidate) => String(candidate?.id || "").trim() === componentId);
  if (record) {
    return {
      label: String(record.name || record.label || "").trim() || `Unnamed ${typeLabel.toLowerCase()}`,
      available: record.active !== false,
      evidenceComplete: true
    };
  }
  if (componentType === "menu_item" && options.menuInventoryComplete === false) {
    return {
      label: "Menu item awaiting full Library check",
      available: null,
      evidenceComplete: false
    };
  }
  return {
    label: `Unavailable ${typeLabel.toLowerCase()}`,
    available: false,
    evidenceComplete: true
  };
}

function ruleEffectLabel(effect = {}, catalog = {}, options = {}) {
  const operator = String(effect?.operator || effect?.action || "").trim();
  const action = {
    recommend: "Recommend",
    require: "Require",
    exclude: "Exclude",
    block: "Stop quoting until resolved",
    select: "Select"
  }[operator] || sentenceCaseIdentifier(operator || "action");
  const target = String(effect?.target || "").trim();
  const componentRef = isPlainRuleRecord(effect?.componentRef)
    ? resolveConfigurationRuleComponentRef(effect.componentRef, catalog, options).label
    : "";
  const hasValue = effect?.value !== undefined && effect?.value !== null && effect?.value !== "";
  if (!target && componentRef) return `${action} ${componentRef}`;
  if (!target) return hasValue ? `${action}: ${ruleValueLabel(effect.value)}` : action;
  return hasValue
    ? `${action} ${rulePathLabel(target)}: ${ruleValueLabel(effect.value)}`
    : `${action} ${rulePathLabel(target)}`;
}

function configurationRuleValidationMessage(error) {
  const messages = {
    invalid_rule: "This rule is not structured as an editable record.",
    invalid_id: "Add a stable rule identity in Advanced rule source.",
    unknown_rule_type: "Choose a supported rule type.",
    invalid_rule_conditions: "Conditions must be a list of no more than 20 entries.",
    invalid_rule_condition: "One of the rule conditions is not structured correctly.",
    invalid_condition_path: "Each condition needs a valid business-data path.",
    unknown_condition_operator: "Choose a supported condition operator.",
    invalid_rule_effect: "The result needs a structured action.",
    unknown_effect_operator: "Choose a supported result operator.",
    missing_effect_target: "Choose an exact result target or catalog component.",
    unavailable_component_reference: "Choose an available catalog component.",
    unsupported_rule_version: "This rule version requires Advanced rule source review."
  };
  return messages[error?.code] || "Correct this rule before publishing the Library draft.";
}

function isConfigurationRuleStructurable(rule) {
  return isPlainRuleRecord(rule)
    && Array.isArray(rule.conditions)
    && rule.conditions.every(isPlainRuleRecord)
    && isPlainRuleRecord(rule.effect);
}

function configurationRuleValidation(rule, catalog, options) {
  try {
    // Validation is presentation evidence only. Persist the original record so
    // forward-compatible fields that the canonical validator does not normalize survive.
    validateConfigurationRule(rule, catalog);
    return { state: "ready", message: "" };
  } catch (error) {
    const componentType = String(rule?.effect?.componentRef?.componentType || "").trim();
    const componentId = String(rule?.effect?.componentRef?.componentId || "").trim();
    const resolved = resolveConfigurationRuleComponentRef(rule?.effect?.componentRef, catalog, options);
    if (
      error?.code === "unavailable_component_reference"
      && componentType === "menu_item"
      && componentId
      && options.menuInventoryComplete === false
      && resolved.evidenceComplete === false
    ) {
      return {
        state: "needs-check",
        message: "The menu reference needs a full Library inventory check before publication."
      };
    }
    return { state: "attention", message: configurationRuleValidationMessage(error) };
  }
}

export function buildConfigurationRulesPresentation(source = "[]", context = {}) {
  try {
    const parsed = typeof source === "string" ? JSON.parse(source || "[]") : source;
    if (!Array.isArray(parsed)) throw new Error("Rule source must be a list.");
    const catalog = context?.catalog || {};
    const options = { menuInventoryComplete: context?.menuInventoryComplete !== true ? false : true };
    const records = parsed.map((rule, index) => {
      const structurable = isConfigurationRuleStructurable(rule);
      const safeRule = isPlainRuleRecord(rule) ? rule : {};
      const conditions = Array.isArray(safeRule.conditions) ? safeRule.conditions : [];
      const reason = String(safeRule.reason || "").trim();
      const validation = structurable
        ? configurationRuleValidation(safeRule, catalog, options)
        : { state: "attention", message: "Use Advanced rule source to restore this rule's structure." };
      return {
        id: String(safeRule.id || `rule-${index + 1}`).trim(),
        title: String(safeRule.name || "").trim() || `Rule ${index + 1}`,
        type: RULE_TYPE_LABELS[safeRule.type] || sentenceCaseIdentifier(safeRule.type || "rule"),
        typeValue: String(safeRule.type || "").trim(),
        enabled: safeRule.enabled !== false,
        conditions: conditions.length
          ? conditions.map(ruleConditionLabel)
          : ["Applies to every quote"],
        effect: ruleEffectLabel(safeRule.effect, catalog, options),
        reason,
        structurable,
        validationState: validation.state,
        validationMessage: validation.message,
        sourceIndex: index,
        sourceRule: safeRule
      };
    });
    return {
      records,
      enabledCount: records.filter((record) => record.enabled && record.validationState === "ready").length,
      error: "",
      requiresAdvancedSource: records.some((record) => !record.structurable)
    };
  } catch (error) {
    return {
      records: [],
      enabledCount: 0,
      error: error?.message || "Rule source is not valid JSON.",
      requiresAdvancedSource: true
    };
  }
}

export function patchConfigurationRuleSource(source, patch = {}) {
  const parsed = typeof source === "string" ? JSON.parse(source || "[]") : source;
  if (!Array.isArray(parsed)) throw new Error("Rule source must be a list.");
  const ruleIndex = Number(patch.ruleIndex);
  const currentRule = parsed[ruleIndex];
  if (!Number.isInteger(ruleIndex) || !isPlainRuleRecord(currentRule)) {
    throw new Error("The selected rule cannot be edited in the structured view.");
  }
  let nextRule;
  if (patch.section === "condition") {
    const conditionIndex = Number(patch.conditionIndex);
    if (!Array.isArray(currentRule.conditions) || !isPlainRuleRecord(currentRule.conditions[conditionIndex])) {
      throw new Error("The selected condition cannot be edited in the structured view.");
    }
    nextRule = {
      ...currentRule,
      conditions: currentRule.conditions.map((condition, index) => index === conditionIndex
        ? { ...condition, [patch.field]: patch.value }
        : condition)
    };
  } else if (patch.section === "effect") {
    if (!isPlainRuleRecord(currentRule.effect)) throw new Error("The rule result cannot be edited in the structured view.");
    nextRule = { ...currentRule, effect: { ...currentRule.effect, [patch.field]: patch.value } };
  } else if (patch.section === "componentRef") {
    if (!isPlainRuleRecord(currentRule.effect) || !isPlainRuleRecord(currentRule.effect.componentRef)) {
      throw new Error("The catalog component reference cannot be edited in the structured view.");
    }
    nextRule = {
      ...currentRule,
      effect: {
        ...currentRule.effect,
        componentRef: { ...currentRule.effect.componentRef, [patch.field]: patch.value }
      }
    };
  } else {
    nextRule = { ...currentRule, [patch.field]: patch.value };
  }
  const nextRules = parsed.map((rule, index) => index === ruleIndex ? nextRule : rule);
  return JSON.stringify(nextRules, null, 2);
}

function coerceRuleScalarInput(value, currentValue) {
  if (typeof currentValue === "number") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : currentValue;
  }
  if (typeof currentValue === "boolean") return value === true || value === "true";
  return value;
}

function configurationRuleComponentOptions(catalog = {}, componentType = "", selectedId = "") {
  const normalizedSelectedId = String(selectedId || "").trim();
  const options = configurationRuleComponentRecords(catalog, componentType)
    .filter((record) => record?.active !== false || String(record?.id || "").trim() === normalizedSelectedId)
    .map((record) => ({
      value: String(record?.id || "").trim(),
      label: `${String(record?.name || record?.label || "").trim() || `Unnamed ${(RULE_COMPONENT_TYPE_LABELS[componentType] || "component").toLowerCase()}`}${record?.active === false ? " (not available)" : ""}`
    })).filter((option) => option.value);
  if (normalizedSelectedId && !options.some((option) => option.value === normalizedSelectedId)) {
    const resolved = resolveConfigurationRuleComponentRef(
      { componentType, componentId: normalizedSelectedId },
      catalog,
      { menuInventoryComplete: catalog?.menuInventoryComplete === true }
    );
    options.unshift({ value: normalizedSelectedId, label: resolved.label });
  }
  return options;
}

function RuleScalarEditor({ value, ariaLabel, onChange }) {
  if (value && typeof value === "object") {
    return (
      <div className="rule-complex-value" data-rule-value-mode="advanced">
        <strong>Configured value</strong>
        <small>Edit this value in Advanced rule source. It remains unchanged here.</small>
      </div>
    );
  }
  if (typeof value === "boolean") {
    return (
      <select aria-label={ariaLabel} value={String(value)} onChange={(event) => onChange(event.target.value === "true")}>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }
  return (
    <input
      aria-label={ariaLabel}
      type={typeof value === "number" ? "number" : "text"}
      value={value ?? ""}
      onChange={(event) => onChange(coerceRuleScalarInput(event.target.value, value))}
    />
  );
}

export function buildAdvancedPricingPolicySummary({
  marginsEnabled = false,
  activeCostCount = 0,
  recordedCostCount = 0,
  recordedStaffCostCount = 0,
  sourceErrorCount = 0
} = {}) {
  const missingCostCount = marginsEnabled
    ? Math.max(0, Number(activeCostCount || 0) - Number(recordedCostCount || 0))
      + Math.max(0, 3 - Number(recordedStaffCostCount || 0))
    : 0;
  const invalidSourceCount = Math.max(0, Number(sourceErrorCount || 0));
  const attention = [];
  if (missingCostCount) attention.push(`${missingCostCount} cost ${missingCostCount === 1 ? "entry needs" : "entries need"} attention`);
  if (invalidSourceCount) attention.push(`${invalidSourceCount} advanced ${invalidSourceCount === 1 ? "source needs" : "sources need"} correction`);
  return {
    hasAttention: attention.length > 0,
    attention,
    label: attention.length ? `Needs attention · ${attention.join(" · ")}` : "Ready for optional review"
  };
}

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
const TEMPLATE_INCLUSION_FIELD_BY_COLLECTION = Object.freeze({
  addons: "addons",
  rentals: "rentals"
});
const UPSELL_KIND_BY_COLLECTION = Object.freeze({
  packages: "package",
  addons: "addon",
  rentals: "rental"
});

export function buildCommercialComponentUsageProjection(draft = {}, collection = "", componentId = "") {
  const id = String(componentId || "").trim();
  const packageField = PACKAGE_INCLUSION_FIELD_BY_COLLECTION[collection];
  const templateField = TEMPLATE_INCLUSION_FIELD_BY_COLLECTION[collection];
  if (!id || !packageField || !templateField) {
    return { offerNames: [], templateNames: [], offerCount: 0, templateCount: 0, totalCount: 0 };
  }

  const offerNames = (Array.isArray(draft?.packages) ? draft.packages : [])
    .filter((offer) => (
      Array.isArray(offer?.[packageField]) && offer[packageField].some((reference) => String(reference || "").trim() === id)
    ))
    .map((offer) => String(offer?.name || "").trim() || "Unnamed offer");
  const templateNames = (Array.isArray(draft?.settings?.eventTemplates) ? draft.settings.eventTemplates : [])
    .filter((template) => (
      Array.isArray(template?.[templateField]) && template[templateField].some((reference) => String(reference || "").trim() === id)
    ))
    .map((template) => String(template?.name || "").trim() || "Unnamed template");

  return {
    offerNames,
    templateNames,
    offerCount: offerNames.length,
    templateCount: templateNames.length,
    totalCount: offerNames.length + templateNames.length
  };
}
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

function MenuItemFields({ item, isNew = false, onChange, onBlur, onKeyDown, disabled = false }) {
  const aria = (field) => isNew ? `New menu item ${field}` : undefined;
  return (
    <>
      <label>
        <span>Name</span>
        <input type="text" aria-label={aria("name")} value={item.name || ""} onChange={(event) => onChange("name", event.target.value)} onBlur={onBlur} onKeyDown={onKeyDown} disabled={disabled} />
      </label>
      <label>
        <span>Price basis</span>
        <select aria-label={aria("price basis")} value={item.pricingType || item.type || "per_event"} onChange={(event) => onChange("pricingType", event.target.value)} onBlur={onBlur} onKeyDown={onKeyDown} disabled={disabled}>
          {PRICE_BASIS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label>
        <span>Selling price</span>
        <input type="number" step="0.01" aria-label={aria("price")} value={Number(item.price || 0)} onChange={(event) => onChange("price", event.target.value)} onBlur={onBlur} onKeyDown={onKeyDown} disabled={disabled} />
      </label>
      <label>
        <span>Cost</span>
        <input type="number" step="0.01" min="0" aria-label={aria("cost")} value={item.cost ?? ""} onChange={(event) => onChange("cost", event.target.value)} onBlur={onBlur} onKeyDown={onKeyDown} disabled={disabled} />
      </label>
      <label className="admin-inline-toggle admin-menu-item-availability">
        <input type="checkbox" checked={item.active !== false} onChange={(event) => onChange("active", event.target.checked)} onBlur={onBlur} disabled={disabled} />
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
  if (kind === "package") return "Offer recommendation";
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
    configurationRules: JSON.stringify(settings.configurationRules || [], null, 2),
    deliveryBlueprints: JSON.stringify(settings.deliveryBlueprints || [], null, 2),
    quantityPolicies: JSON.stringify(settings.quantityPolicies || [], null, 2),
    purchasingPacks: JSON.stringify(settings.purchasingPacks || [], null, 2),
    seasonalProfiles: JSON.stringify(settings.seasonalProfiles || [], null, 2),
    brandCrew: JSON.stringify(settings.brandCrew || [], null, 2)
  };
}

function countInvalidJsonArrayDrafts(jsonDrafts = {}, fields = []) {
  return fields.reduce((count, field) => {
    try {
      return Array.isArray(JSON.parse(jsonDrafts?.[field] || "[]")) ? count : count + 1;
    } catch {
      return count + 1;
    }
  }, 0);
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
  const nextCatalog = buildDeliveryPlanningDraftCatalog({
    ...draft,
    settings: {
      ...(draft?.settings || {}),
      featureFlags,
      brandLogoUrl: normalizeBrandLogoUrl(draft?.settings?.brandLogoUrl),
      documentFontScale: normalizeProposalDocumentFontScale(draft?.settings?.documentFontScale).id,
      serviceFeeTiers: parseArray("serviceFeeTiers", "Service Fee Tiers JSON"),
      taxRegions: parseArray("taxRegions", "Tax Regions JSON"),
      eventTemplates: parseEventTemplateDrafts(jsonDrafts?.eventTemplates),
      configurationRules: parseArray("configurationRules", "Configuration Rules JSON"),
      seasonalProfiles: parseArray("seasonalProfiles", "Seasonal Profiles JSON"),
      brandCrew: parseArray("brandCrew", "Brand Crew JSON")
    }
  }, jsonDrafts);
  validateCommercialPublication({ ...nextCatalog, menuInventoryComplete: false });
  validateDeliveryPlanningConfiguration(nextCatalog);
  return nextCatalog;
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

function Section({ title, onAdd, addLabel = "Add", className = "", children, ...sectionProps }) {
  return (
    <section className={`admin-section ${className}`.trim()} {...sectionProps}>
      <div className="admin-section-head">
        <h3>{title}</h3>
        {onAdd && <button type="button" className="ghost" onClick={onAdd}>{addLabel}</button>}
      </div>
      <div className="admin-section-body">{children}</div>
    </section>
  );
}

function CommercialComponentRecord({
  collection,
  item,
  index,
  usage,
  onPatch,
  onRemove
}) {
  const rental = collection === "rentals";
  const typeLabel = rental ? "Rental" : "Add-on";
  const recordedName = String(item?.name || "").trim();
  const itemName = recordedName || `${typeLabel} ${index + 1}`;
  const pricingType = normalizePricingType(
    item?.pricingType || item?.type,
    rental ? "per_item" : "per_person"
  );
  const pricingBasisLabel = {
    per_person: "per guest",
    per_item: "per item",
    per_event: "per event"
  }[pricingType] || "pricing basis unavailable";
  const numericPrice = Number(item?.price);
  const priceRecorded = item?.price !== null && item?.price !== undefined && item?.price !== "";
  const priceNeedsAttention = !priceRecorded || !Number.isFinite(numericPrice) || numericPrice < 0;
  const attention = [
    !recordedName ? "Add a display name" : "",
    priceNeedsAttention ? "Enter a valid sell price" : ""
  ].filter(Boolean);
  const hasAttention = attention.length > 0;
  const usageProjection = usage || {
    offerNames: [],
    templateNames: [],
    offerCount: 0,
    templateCount: 0,
    totalCount: 0
  };

  return (
    <details
      className="commercial-component-record"
      data-commercial-component-kind={rental ? "rental" : "addon"}
      data-commercial-component-id={item.id}
      data-commercial-component-state={hasAttention ? "attention" : "ready"}
    >
      <summary className="commercial-component-summary">
        <span className="commercial-component-summary-identity">
          <span className="eyebrow">{typeLabel}</span>
          <strong>{itemName}</strong>
        </span>
        <span className="commercial-component-summary-price">
          <strong>{priceNeedsAttention ? "Price needs attention" : `$${numericPrice.toFixed(2)}`}</strong>
          <small>{pricingBasisLabel}</small>
        </span>
        <span
          className="commercial-component-summary-availability"
          data-state={item.active !== false ? "available" : "unavailable"}
        >
          {item.active !== false ? "Available" : "Not available"}
        </span>
        {hasAttention && (
          <span className="commercial-component-summary-attention" data-component-attention>
            Needs attention · {attention.join(" · ")}
          </span>
        )}
      </summary>

      <div className="commercial-component-record-body">
        <div className="commercial-component-primary-fields" data-commercial-component-group="primary">
          <label>
            <span>Display name</span>
            <input
              aria-label={`${typeLabel} ${index + 1} display name`}
              value={item.name}
              onChange={(event) => onPatch("name", event.target.value)}
            />
          </label>
          <label>
            <span>Sell by</span>
            <select
              aria-label={`${itemName} pricing type`}
              value={pricingType}
              onChange={(event) => {
                const nextPricingType = normalizePricingType(
                  event.target.value,
                  rental ? "per_item" : "per_person"
                );
                onPatch("pricingType", nextPricingType);
                onPatch("type", nextPricingType);
              }}
            >
              {rental && <option value="per_item">Per item</option>}
              <option value="per_person">Per guest</option>
              {!rental && <option value="per_item">Per item</option>}
              <option value="per_event">Per event</option>
            </select>
          </label>
          <label>
            <span>Sell price</span>
            <input
              aria-label={`${itemName} sell price`}
              type="number"
              value={item.price}
              onChange={(event) => onPatch("price", Number(event.target.value))}
            />
          </label>
          <label className="admin-inline-toggle commercial-component-availability">
            <span>Available for new quotes</span>
            <input
              type="checkbox"
              aria-label={`${itemName} available for new quotes`}
              checked={item.active !== false}
              onChange={(event) => onPatch("active", event.target.checked)}
            />
          </label>
        </div>

        <section className="commercial-component-usage" aria-label={`Usage for ${itemName}`} data-commercial-component-group="usage">
          <div className="commercial-component-usage-summary">
            <span className="eyebrow">Usage</span>
            <strong>
              {usageProjection.totalCount
                ? `Used by ${usageProjection.offerCount} ${usageProjection.offerCount === 1 ? "offer" : "offers"} and ${usageProjection.templateCount} ${usageProjection.templateCount === 1 ? "template" : "templates"}`
                : "Not currently used by an offer or template"}
            </strong>
          </div>
          <div className="commercial-component-usage-groups">
            <div data-component-usage-kind="offers">
              <span>Offers <strong>{usageProjection.offerCount}</strong></span>
              {usageProjection.offerNames.length ? (
                <ul>{usageProjection.offerNames.map((name, usageIndex) => <li key={`${name}-${usageIndex}`}>{name}</li>)}</ul>
              ) : <small>None</small>}
            </div>
            <div data-component-usage-kind="templates">
              <span>Templates <strong>{usageProjection.templateCount}</strong></span>
              {usageProjection.templateNames.length ? (
                <ul>{usageProjection.templateNames.map((name, usageIndex) => <li key={`${name}-${usageIndex}`}>{name}</li>)}</ul>
              ) : <small>None</small>}
            </div>
          </div>
        </section>

        {rental && (
          <details className="commercial-component-group" data-commercial-component-group="quantity-planning">
            <summary>
              <span>Quantity planning</span>
              <small>Set the guest interval used to suggest rental quantities.</small>
            </summary>
            <div className="commercial-component-group-body">
              <label>
                <span>Guests per item</span>
                <input
                  aria-label={`${itemName} guests per item`}
                  type="number"
                  value={item.qtyPerGuests}
                  onChange={(event) => onPatch("qtyPerGuests", Number(event.target.value))}
                />
              </label>
            </div>
          </details>
        )}

        {PILOT_DECISION_ROOM_ENABLED && (
          <details className="commercial-component-group" data-commercial-component-group="customer-choice">
            <summary>
              <span>Customer choice</span>
              <small>Choose whether customers may request this option from their proposal.</small>
            </summary>
            <div className="commercial-component-group-body">
              <label className="admin-inline-toggle">
                <span>Offer as a customer choice</span>
                <input
                  type="checkbox"
                  aria-label={`Offer ${itemName} as a decidable option in the customer portal`}
                  checked={item.portalDecidable === true}
                  onChange={(event) => onPatch("portalDecidable", event.target.checked)}
                />
              </label>
            </div>
          </details>
        )}

        {PILOT_MARGINS_ENABLED && (
          <details className="commercial-component-group" data-commercial-component-group="cost-evidence">
            <summary>
              <span>Cost and margin evidence</span>
              <small>Record internal cost without changing the customer price.</small>
            </summary>
            <div className="commercial-component-group-body">
              <label>
                <span>Internal cost</span>
                <input
                  aria-label={`${itemName} cost`}
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Not recorded"
                  value={item.cost ?? ""}
                  onChange={(event) => onPatch("cost", event.target.value === "" ? null : Number(event.target.value))}
                />
              </label>
            </div>
          </details>
        )}

        <details className="commercial-component-group commercial-component-technical" data-commercial-component-group="technical">
          <summary>
            <span>Technical details</span>
            <small>Stable identity used by saved offers, templates, and quotes.</small>
          </summary>
          <div className="commercial-component-group-body">
            <label>
              <span>Internal item ID</span>
              <input value={item.id} disabled />
            </label>
          </div>
        </details>

        <div className="commercial-component-actions">
          <button type="button" className="ghost compact" onClick={onRemove}>Delete {typeLabel.toLowerCase()}</button>
        </div>
      </div>
    </details>
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
  surfaceTitle = "Library settings",
  embeddedCloseLabel = "Back to Home",
  returnFocusRef = null,
  initialTab = "",
  focusRequest = null,
  onFocusResolution,
  onActiveTabChange,
  onInteractionStateChange,
  onDismissGuardChange,
  selectedEventType: selectedEventTypeProp = "",
  onEventTypeChange,
  onToast,
  catalogSetupDraftController = null,
  inventoryRecipeExtension = null
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
  const [recipeEditorInteraction, setRecipeEditorInteraction] = useState({ dirty: false, busy: false, locked: false });
  const recipeInteractionLocked = Boolean(
    recipeEditorInteraction.locked
    || recipeEditorInteraction.busy
    || recipeEditorInteraction.dirty
  );
  const menuItemSaveInFlightRef = useRef(new Set());
  const resetOnNextOpenRef = useRef(true);
  const initializedViewScopeRef = useRef("");
  const eventTypesLoadScopeRef = useRef("");
  const confirmedInventoryLoadScopeRef = useRef("");
  const eventMenuLoadScopeRef = useRef("");
  const [packActionId, setPackActionId] = useState("");
  const [catalogRefreshRequired, setCatalogRefreshRequired] = useState(false);
  const [manualSetupEnabled, setManualSetupEnabled] = useState(false);
  const [confirmedMenuRecoveryProbe, setConfirmedMenuRecoveryProbe] = useState({
    status: "idle",
    reason: ""
  });
  const [confirmedMenuRecoveryRetryNonce, setConfirmedMenuRecoveryRetryNonce] = useState(0);
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
    catalog?.settings?.pricingSetupConfirmed === true,
    confirmedMenuRecoveryRetryNonce
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
  const hasAnyUnsavedChanges = hasUnsavedChanges || hasManagedMenuDraft || recipeEditorInteraction.dirty;
  const hasDeviceOnlySetupChanges = Boolean(
    catalogSetupDraft.deviceOnly && catalogSetupDraftChanges.length > 0
  );
  const hasDismissableChanges = hasAnyUnsavedChanges || hasDeviceOnlySetupChanges;
  const packageWorkspace = buildPackageWorkspaceCollectionModel({
    catalog: draft,
    menuItems,
    selectedPackageId
  });
  const componentUsageDraft = (() => {
    let eventTemplates = [];
    try {
      eventTemplates = parseEventTemplateDrafts(jsonDrafts.eventTemplates);
    } catch {
      eventTemplates = [];
    }
    return {
      ...(draft || {}),
      settings: {
        ...(draft?.settings || {}),
        eventTemplates
      }
    };
  })();
  const configurationRuleCatalog = {
    ...(draft || {}),
    menuItems: configurationRuleMenuItems({ ...(draft || {}), menuItems }),
    menuInventoryComplete: false
  };
  const configurationRulesPresentation = buildConfigurationRulesPresentation(
    jsonDrafts.configurationRules,
    { catalog: configurationRuleCatalog, menuInventoryComplete: false }
  );
  const pricingConfirmationCurrent = isCatalogPricingConfirmationCurrent(draft?.settings);
  const publishedCatalogAvailable = /^firebase(?:-org)?(?:-empty)?$/.test(
    String(catalog?.source || "").trim().toLowerCase()
  );
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
    setConfirmedMenuRecoveryProbe({ status: "idle", reason: "" });
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
    if (catalog?.settings?.pricingSetupConfirmed !== true) {
      setConfirmedMenuRecoveryProbe({
        status: "not_applicable",
        reason: "Menu recovery is checked only after pricing is confirmed."
      });
      return undefined;
    }
    if (!scopedOrganizationId || !firebaseReady) {
      setConfirmedMenuRecoveryProbe({
        status: "unavailable",
        reason: !scopedOrganizationId
          ? "Choose an organization before QuotePilot checks its confirmed menu."
          : "The live Library connection is unavailable, so QuotePilot cannot verify whether menu recovery is needed."
      });
      return undefined;
    }

    let alive = true;
    setConfirmedMenuRecoveryProbe({ status: "checking", reason: "" });
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
        setConfirmedMenuRecoveryProbe(hasNoMenuInventory(inventory)
          ? {
              status: "empty",
              reason: "The complete confirmed-menu inventory contains no sections or items."
            }
          : {
              status: "present",
              reason: "Confirmed menu records are present; setup recovery is not needed."
            });
      } catch (error) {
        if (!alive) return;
        setConfirmedMenuRecoveryProbe({
          status: "failed",
          reason: error?.message || "QuotePilot could not inspect the confirmed menu inventory."
        });
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
    if (recipeInteractionLocked) {
      const message = recipeEditorInteraction.busy
        ? "Wait for the recipe publication outcome before changing another Library record."
        : recipeEditorInteraction.dirty
          ? "Publish or discard the open recipe changes before changing another Library record."
          : "Finish the current recipe outcome review before changing another Library record.";
      setStatus(message);
      pushToast(message, "info");
      return true;
    }
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
    || recipeInteractionLocked
  );
  useEffect(() => {
    onInteractionStateChange?.({
      dirty: hasDismissableChanges,
      busy: closeBlocked
    });
  }, [
    catalogSetupDraftChanges.length,
    closeBlocked,
    hasDismissableChanges,
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
    if (hasDismissableChanges && !window.confirm("Discard unsaved catalog, menu, and branding changes?")) {
      return { status: "guarded", reason: "dirty", trigger: reason };
    }
    if (hasDeviceOnlySetupChanges) {
      catalogSetupDraft.discardDeviceChanges?.(catalogSetupDraft.deviceChanges);
    }
    resetOnNextOpenRef.current = true;
    onInteractionStateChange?.({ dirty: false, busy: false });
    if (typeof continuation === "function") continuation();
    return { status: "dismissed", trigger: reason };
  }, [
    catalogSetupDraft,
    closeBlocked,
    hasDeviceOnlySetupChanges,
    hasDismissableChanges,
    onInteractionStateChange
  ]);
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
      dirty: hasDismissableChanges,
      busy: closeBlocked,
      requestDismiss
    });
    return () => onDismissGuardChange(null);
  }, [closeBlocked, embedded, hasDismissableChanges, onDismissGuardChange, open, requestDismiss]);
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
  const confirmedMissingMenuRecovery = confirmedMenuRecoveryProbe.status === "empty"
    && draft?.settings?.pricingSetupConfirmed === true;
  const retryConfirmedMenuRecoveryProbe = () => {
    setConfirmedMenuRecoveryProbe({ status: "checking", reason: "" });
    setConfirmedMenuRecoveryRetryNonce((value) => value + 1);
  };
  const confirmedMenuRecoveryProbeVisible = draft?.settings?.pricingSetupConfirmed === true
    && !["idle", "not_applicable", "empty"].includes(confirmedMenuRecoveryProbe.status);
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

  useEffect(() => {
    if (!open || !resolvedActiveTab || typeof onActiveTabChange !== "function") return;
    onActiveTabChange(resolvedActiveTab);
  }, [onActiveTabChange, open, resolvedActiveTab]);

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
    const records = kind === "rental"
      ? (draft.rentals || [])
      : kind === "package"
        ? (draft.packages || [])
        : (draft.addons || []);
    const options = records
        .filter((item) => item?.active !== false || item.id === selectedId)
        .map((item) => optionFor(
          item,
          kind === "package" ? `${item.name} (${item.ppp}/person)` : item.name
        ));
    if (selectedId && !options.some((option) => option.value === selectedId)) {
      options.unshift({
        value: selectedId,
        label: `Previously selected ${kind === "package" ? "offer" : kind} (not available)`
      });
    }
    return options;
  };

  const patchJsonDraft = (field, value) => {
    setJsonDrafts((prev) => ({ ...prev, [field]: value }));
  };

  const patchConfigurationRule = (patch) => {
    try {
      patchJsonDraft(
        "configurationRules",
        patchConfigurationRuleSource(jsonDrafts.configurationRules, patch)
      );
      setStatus("Quote rule updated in this Library draft.");
    } catch (error) {
      setStatus(error?.message || "Open Advanced rule source to correct this rule.");
    }
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
    if (tabId !== "menu" && recipeInteractionLocked) {
      setStatus(recipeEditorInteraction.busy
        ? "Wait for the recipe publication outcome before leaving Menu."
        : recipeEditorInteraction.dirty
          ? "Publish or discard recipe changes before leaving Menu."
          : "Finish the current recipe outcome review before leaving Menu.");
      return false;
    }
    if (tabId !== "templates") {
      setActiveTab(tabId);
      return true;
    }
    try {
      const eventTemplates = parseEventTemplateDrafts(jsonDrafts.eventTemplates);
      setDraft((prev) => ({
        ...prev,
        settings: { ...(prev.settings || {}), eventTemplates }
      }));
      setActiveTab("templates");
      return true;
    } catch (error) {
      setActiveTab("pricing");
      setStatus(`Fix Event Templates JSON before opening the structured editor: ${error.message}`);
      return true;
    }
  };

  const handleAdminTabKeyDown = (event, currentIndex) => {
    const key = event.key;
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(key)) return;
    event.preventDefault();
    const lastIndex = visibleAdminTabs.length - 1;
    const nextIndex = key === "Home"
      ? 0
      : key === "End"
        ? lastIndex
        : key === "ArrowRight"
          ? (currentIndex + 1) % visibleAdminTabs.length
          : (currentIndex - 1 + visibleAdminTabs.length) % visibleAdminTabs.length;
    const nextTab = visibleAdminTabs[nextIndex];
    if (!nextTab) return;
    if (!selectAdminTab(nextTab.id)) return;
    window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector(`[data-admin-tab-id="${nextTab.id}"]`)?.focus?.({
        preventScroll: true
      });
    });
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
      const message = `Remove this menu item from ${dependencies}, save those Library changes, then reopen Library settings to delete it.`;
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
  const catalogRecoveryOwnsSaveAction = catalogSetupDraft.status === "sync_failed"
    || catalogSetupDraft.deviceOnly;
  const catalogEditorStateLabel = saving || catalogSetupDraft.status === "saving"
    ? "Saving draft…"
    : catalogSetupDraft.deviceOnly && catalogSetupDraftChanges.length > 0
      ? "Changes waiting to save"
      : hasAnyUnsavedChanges
        ? "Unsaved changes"
        : Number(catalogSetupDraft.changedRecordCount || 0) > 0
          ? "Draft saved"
          : publishedCatalogAvailable ? "Published Library active" : "Local Library";
  const catalogFooterStatus = catalogSetupDraft.deviceOnly && catalogSetupDraftChanges.length > 0
    ? publishedCatalogAvailable
      ? "Changes are preserved here but are not in the shared draft. Published pricing remains active."
      : "Changes are preserved here but are not in the shared draft. No shared catalog or pricing changed."
    : status || (hasAnyUnsavedChanges
      ? "Your changes are not saved yet."
      : Number(catalogSetupDraft.changedRecordCount || 0) > 0
        ? publishedCatalogAvailable
          ? "Library draft saved. Active pricing is unchanged until publication."
          : "Library changes are saved here. Publishing is unavailable from this source."
        : publishedCatalogAvailable
          ? "Published Library is active."
          : "Library is available here. Publishing is unavailable from this source.");

  const normalizedMenuSearch = String(menuSearch || "").trim().toLowerCase();
  const selectedCategoryItems = menuItems.filter((item) => (
    item.categoryId === selectedCategory
    && (showUnavailableMenuItems || item.active !== false)
    && (!normalizedMenuSearch || `${item.name || ""} ${item.id || ""}`.toLowerCase().includes(normalizedMenuSearch))
  ));
  const activeMenuItem = selectedCategoryItems.find((item) => item.id === activeMenuItemId)
    || selectedCategoryItems[0]
    || null;
  const recipeContextLocked = recipeInteractionLocked;
  const recipeContextLockMessage = recipeEditorInteraction.busy
    ? "Wait for the recipe publication outcome before changing the menu context."
    : recipeEditorInteraction.dirty
      ? "Publish or discard recipe changes before changing the menu context."
      : "Finish the current recipe outcome review before changing the menu context.";
  const blockRecipeContextChange = () => {
    if (!recipeContextLocked) return false;
    setStatus(recipeContextLockMessage);
    return true;
  };
  const notifyActiveInventoryMenuItem = inventoryRecipeExtension?.onActiveMenuItemChange;
  useEffect(() => {
    notifyActiveInventoryMenuItem?.(open ? activeMenuItem?.id || "" : "");
  }, [activeMenuItem?.id, notifyActiveInventoryMenuItem, open]);
  const selectActiveMenuItem = (itemId) => {
    if (itemId === activeMenuItem?.id) return;
    if (blockRecipeContextChange()) return;
    setActiveMenuItemId(itemId);
  };
  const recipeExtensionEnabled = inventoryRecipeExtension?.enabled === true;
  const activeMenuRecipe = activeMenuItem
    ? inventoryRecipeExtension?.recipesByMenuItemId?.[activeMenuItem.id] || null
    : null;
  const activeMenuCostProjection = activeMenuItem
    ? inventoryRecipeExtension?.menuCostProjectionsByMenuItemId?.[activeMenuItem.id] || null
    : null;
  const activeMenuCostProjectionState = typeof notifyActiveInventoryMenuItem === "function"
    ? inventoryRecipeExtension?.activeMenuItemId === activeMenuItem?.id
      ? inventoryRecipeExtension?.activeMenuCostProjectionState || "loading"
      : "loading"
    : "current";
  const activeMenuItemStaged = Boolean(activeMenuItem && catalogSetupDraftChanges.some((change) => (
    change?.collection === "menuItems" && change?.recordId === activeMenuItem.id
  )));
  const activeMenuItemLocal = /local/u.test(String(activeMenuItem?.source || "").toLowerCase());
  const recipePublishEligibility = activeMenuCostProjectionState !== "current"
    ? { allowed: false, reason: "Wait for the current exact menu recipe projection before publishing. Cached, pending, or unavailable evidence cannot authorize a revision." }
    : !publishedCatalogAvailable || activeMenuItemLocal
    ? { allowed: false, reason: "Recipe publication requires a server-confirmed Library menu item." }
    : activeMenuItemStaged
      ? { allowed: false, reason: "Publish the staged menu item first, then reopen it to attach a recipe." }
      : activeMenuItem && menuItemDirty[activeMenuItem.id]
        ? { allowed: false, reason: "Save the menu item change before publishing its recipe." }
        : saving || menuActionLoading || Boolean(menuItemSavingId)
          ? { allowed: false, reason: "Wait for the current Library save to finish before publishing a recipe." }
          : catalogRefreshRequired
            ? { allowed: false, reason: "Load the newer Library version before publishing a recipe." }
            : { allowed: true, reason: "" };
  const saveActiveMenuItem = () => activeMenuItem && handleManagedMenuItemBlur(activeMenuItem.id);
  const saveActiveMenuItemOnEnter = (event) => activeMenuItem && handleManagedMenuItemKeyDown(event, activeMenuItem.id);
  const selectedCategoryItemCount = menuItems.filter((item) => item.categoryId === selectedCategory).length;
  const menuEventTypeOptions = menuEventTypes.map((eventType) => ({
    value: eventType.id,
    label: eventType.name
  }));
  if (
    selectedEventType
    && !menuEventTypeOptions.some((option) => option.value === selectedEventType)
  ) {
    menuEventTypeOptions.unshift({
      value: selectedEventType,
      label: "Previously selected event type (not in the current Library read)"
    });
  }
  const menuEventTypeSelectionStale = Boolean(selectedEventType && !selectedEventTypeRecord);
  const menuEventTypeChoiceOptions = menuEventTypeSelectionStale && menuEventTypes.length === 0
    ? []
    : menuEventTypeOptions;
  const menuSectionOptions = menuCategories.map((category) => ({
    value: category.id,
    label: category.name
  }));
  if (
    selectedCategory
    && !menuSectionOptions.some((option) => option.value === selectedCategory)
  ) {
    menuSectionOptions.unshift({
      value: selectedCategory,
      label: "Previously selected menu section (not in the current Library read)"
    });
  }
  const menuSectionSelectionStale = Boolean(selectedCategory && !selectedCategoryRecord);
  const menuSectionChoiceOptions = menuSectionSelectionStale && menuCategories.length === 0
    ? []
    : menuSectionOptions;
  const bulkDestinationOptions = menuCategories
    .filter((section) => section.id !== selectedCategory)
    .map((section) => ({ value: section.id, label: section.name }));
  if (
    bulkTargetSection
    && bulkTargetSection !== selectedCategory
    && !bulkDestinationOptions.some((option) => option.value === bulkTargetSection)
  ) {
    bulkDestinationOptions.unshift({
      value: bulkTargetSection,
      label: "Previously selected destination (not in the current Library read)"
    });
  }
  const resolvedBulkTargetSection = bulkTargetSection
    || (bulkDestinationOptions.length === 1 ? bulkDestinationOptions[0].value : "");
  const focusMenuStructureInput = (ariaLabel) => {
    window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector(`[aria-label="${ariaLabel}"]`)?.focus?.();
    });
  };
  const applyBulkMenuChange = ({ active, categoryId } = {}) => {
    if (blockRecipeContextChange()) return;
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
  const serviceFeeSourceNeedsAttention = countInvalidJsonArrayDrafts(jsonDrafts, ["serviceFeeTiers"]) > 0;
  const taxRegionSourceNeedsAttention = countInvalidJsonArrayDrafts(jsonDrafts, ["taxRegions"]) > 0;
  const advancedPricingSourceErrorCount = countInvalidJsonArrayDrafts(jsonDrafts, [
    "eventTemplates",
    "seasonalProfiles",
    "brandCrew"
  ]);
  const advancedPricingPolicySummary = buildAdvancedPricingPolicySummary({
    marginsEnabled: PILOT_MARGINS_ENABLED,
    activeCostCount: activeCostRecords.length,
    recordedCostCount,
    recordedStaffCostCount,
    sourceErrorCount: advancedPricingSourceErrorCount
  });
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
      setStatus("The latest Library version cannot be loaded here. Close and reopen Library settings.");
      return;
    }
    setStatus("Loading the latest shared Library version…");
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
          publishedCatalogAvailable={publishedCatalogAvailable}
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

        <div className="admin-tabs" role="tablist" aria-label="Library sections">
          {visibleAdminTabs.map((tab, index) => (
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
              onKeyDown={(event) => handleAdminTabKeyDown(event, index)}
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

        {confirmedMenuRecoveryProbeVisible && (
          <div
            className="starter-pack-review-banner"
            data-menu-recovery-probe-state={confirmedMenuRecoveryProbe.status}
          >
            <FieldStateIndicator
              state={confirmedMenuRecoveryProbe.status === "failed"
                ? { evidence: "failed" }
                : confirmedMenuRecoveryProbe.status === "unavailable"
                  ? { availability: "unavailable" }
                  : confirmedMenuRecoveryProbe.status === "present"
                    ? { evidence: "confirmed" }
                    : { evidence: "pending" }}
              label="Menu recovery check"
              reason={["failed", "unavailable"].includes(confirmedMenuRecoveryProbe.status)
                ? confirmedMenuRecoveryProbe.reason
                : ""}
              supportingDetail={confirmedMenuRecoveryProbe.status === "present"
                ? confirmedMenuRecoveryProbe.reason
                : confirmedMenuRecoveryProbe.status === "checking"
                  ? "Checking the complete confirmed-menu inventory before offering recovery."
                  : ""}
              recoveryAction={["failed", "unavailable"].includes(confirmedMenuRecoveryProbe.status)
                ? {
                    label: "Retry menu check",
                    onClick: retryConfirmedMenuRecoveryProbe
                  }
                : undefined}
            />
          </div>
        )}

        {confirmedMissingMenuRecovery && (
          <div
            className="starter-pack-review-banner"
            role="alert"
            data-menu-recovery-probe-state="empty"
          >
            <div>
              <strong>This confirmed catalog has no menu.</strong>
              <span> Choose a setup preset to add missing records to the shared draft. Active pricing stays unchanged until review and publication.</span>
            </div>
            <button type="button" className="cta" onClick={() => setActiveTab("starter")}>
              Choose a setup option
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
                        <span className="eyebrow">Setup option</span>
                        <h4>{pack.name}</h4>
                        <p className="starter-pack-fit"><strong>Best for:</strong> {pack.bestFor}</p>
                        <p>{pack.outcome}</p>
                      </div>
                      <div className="starter-pack-includes" aria-label={`${pack.name} contents`}>
                        <span>{pack.counts.menuItems} menu items</span>
                        <span>{pack.counts.packages} offers</span>
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
                  >Set up Library manually</button>
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
              {!catalogRecoveryOwnsSaveAction && (saving || hasUnsavedChanges) && (
                <button
                  type="button"
                  className="cta"
                  onClick={handleSave}
                  disabled={saving || !hasUnsavedChanges || Boolean(pendingCatalogEvidenceRef.current)}
                >
                  {saving ? "Saving..." : "Save draft now"}
                </button>
              )}
            </div>
          </>
        )}

        {resolvedActiveTab === "delivery" && (
          <DeliveryPlanningConfigurationPanel
            catalog={draft}
            jsonDrafts={jsonDrafts}
            onPatchJson={patchJsonDraft}
            onPatchSetting={patchToggleSetting}
            onPatchPackageField={patchPackageField}
            onReviewOffers={() => setActiveTab("packages")}
          />
        )}

        {resolvedActiveTab === "addons" && (
          <Section
            title="Add-ons"
            onAdd={() => addRow("addons")}
            addLabel="Add add-on"
            className="commercial-component-editor"
            data-commercial-component-collection="addons"
          >
            <p className="source-note">
              Add-ons add a priced service or enhancement to a quote without changing staffing. Choose Per item when a quote may need more than one.
            </p>
            <div className="commercial-component-list">
              {draft.addons.map((item, index) => (
                <CommercialComponentRecord
                  key={item.id}
                  collection="addons"
                  item={item}
                  index={index}
                  usage={buildCommercialComponentUsageProjection(componentUsageDraft, "addons", item.id)}
                  onPatch={(field, value) => patchArrayItem("addons", index, field, value)}
                  onRemove={() => removeRow("addons", index)}
                />
              ))}
              {draft.addons.length === 0 && (
                <p className="source-note">No add-ons are available yet.</p>
              )}
            </div>
          </Section>
        )}

        {resolvedActiveTab === "rentals" && (
          <Section
            title="Rentals"
            onAdd={() => addRow("rentals")}
            addLabel="Add rental"
            className="commercial-component-editor"
            data-commercial-component-collection="rentals"
          >
            <p className="source-note">
              Rentals keep customer price and quantity planning together while each quote retains its own selected quantity.
            </p>
            <div className="commercial-component-list">
              {draft.rentals.map((item, index) => (
                <CommercialComponentRecord
                  key={item.id}
                  collection="rentals"
                  item={item}
                  index={index}
                  usage={buildCommercialComponentUsageProjection(componentUsageDraft, "rentals", item.id)}
                  onPatch={(field, value) => patchArrayItem("rentals", index, field, value)}
                  onRemove={() => removeRow("rentals", index)}
                />
              ))}
              {draft.rentals.length === 0 && (
                <p className="source-note">No rentals are available yet.</p>
              )}
            </div>
          </Section>
        )}

        {resolvedActiveTab === "menu" && (
          <section className="admin-section admin-menu-builder">
            <h3 className="admin-menu-builder-heading">Menu Builder</h3>

            <div className="admin-section-body admin-menu-workbench">
              <aside className="admin-menu-context-panel" aria-label="Menu context">
                <div className="admin-menu-field" data-choice-field="catalog-event-type">
                  <AdaptiveChoiceField
                    label="Event type"
                    options={menuEventTypeChoiceOptions}
                    value={selectedEventType}
                    onChange={(event) => {
                      if (blockRecipeContextChange()) return;
                      setManagedEventType(event.target.value);
                      setActiveMenuItemId("");
                    }}
                    disabled={menuLoading || recipeContextLocked}
                    description={recipeContextLocked ? recipeContextLockMessage : ""}
                    placeholder="Choose event type"
                    emptyState="unavailable"
                    emptyReason={menuEventTypeSelectionStale
                      ? `The previously selected event type ${selectedEventType} is not in the current Library read.`
                      : menuLoading
                        ? "Event types are still loading. You can prepare a new event type below if this Library has none."
                        : "No event types are available in this Library. Add one before building menu sections."}
                    recoveryAction={{
                      label: "Add event type",
                      onClick: () => focusMenuStructureInput("New event type name")
                    }}
                    singleChoiceDetail="This is the only event type in the current Library read."
                    fieldState={menuEventTypeSelectionStale ? { evidence: "stale" } : undefined}
                    fieldStateDetails={menuEventTypeSelectionStale ? {
                      reason: "The saved event type is not present in the current Library read.",
                      recoveryAction: {
                        label: "Add event type",
                        onClick: () => focusMenuStructureInput("New event type name")
                      }
                    } : undefined}
                  />
                </div>

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

                <div className="admin-menu-field" data-choice-field="catalog-menu-section">
                  <AdaptiveChoiceField
                    label="Menu section"
                    options={menuSectionChoiceOptions}
                    value={selectedCategory}
                    onChange={(event) => {
                      if (blockRecipeContextChange()) return;
                      setSelectedCategory(event.target.value);
                      setActiveMenuItemId("");
                    }}
                    disabled={!selectedEventType || menuLoading || recipeContextLocked}
                    description={recipeContextLocked ? recipeContextLockMessage : ""}
                    placeholder="Choose menu section"
                    emptyReason={menuSectionSelectionStale
                      ? `The previously selected menu section ${selectedCategory} is not in the current Library read.`
                      : selectedEventType
                        ? "This event type has no menu sections. Add one before adding menu items."
                        : "Choose or add an event type before adding a menu section."}
                    recoveryAction={{
                      label: selectedEventType ? "Add menu section" : "Add event type",
                      onClick: () => focusMenuStructureInput(
                        selectedEventType ? "New menu section name" : "New event type name"
                      )
                    }}
                    singleChoiceDetail="This is the only menu section for the selected event type."
                    fieldState={menuSectionSelectionStale ? { evidence: "stale" } : undefined}
                    fieldStateDetails={menuSectionSelectionStale ? {
                      reason: "The saved menu section is not present in the current Library read.",
                      recoveryAction: {
                        label: "Add menu section",
                        onClick: () => focusMenuStructureInput("New menu section name")
                      }
                    } : undefined}
                  />
                </div>

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
                  {recipeContextLocked && (
                    <p id="inventory-recipe-context-lock" className="source-note" role="status">
                      {recipeContextLockMessage} Recipe recovery actions remain available in the open editor.
                    </p>
                  )}
                  <label className="admin-menu-search-field">
                    <span>Find an item</span>
                    <input
                      type="search"
                      placeholder="Search by name"
                      value={menuSearch}
                      disabled={recipeContextLocked}
                      aria-describedby={recipeContextLocked ? "inventory-recipe-context-lock" : undefined}
                      onChange={(event) => {
                        if (blockRecipeContextChange()) return;
                        setMenuSearch(event.target.value);
                      }}
                    />
                  </label>
                  <label className="admin-inline-toggle admin-menu-availability-filter">
                    <input
                      type="checkbox"
                      checked={showUnavailableMenuItems}
                      disabled={recipeContextLocked}
                      aria-describedby={recipeContextLocked ? "inventory-recipe-context-lock" : undefined}
                      onChange={(event) => {
                        if (blockRecipeContextChange()) return;
                        setShowUnavailableMenuItems(event.target.checked);
                      }}
                    />
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
                    <button type="button" className="ghost compact" disabled={recipeContextLocked} onClick={() => applyBulkMenuChange({ active: true })}>Make available</button>
                    <button type="button" className="ghost compact" disabled={recipeContextLocked} onClick={() => applyBulkMenuChange({ active: false })}>Make unavailable</button>
                    <AdaptiveChoiceField
                      label="Move selected items to menu section"
                      options={bulkDestinationOptions}
                      value={resolvedBulkTargetSection}
                      onChange={(event) => setBulkTargetSection(event.target.value)}
                      disabled={recipeContextLocked}
                      placeholder="Move to menu section…"
                      emptyReason="There is no other menu section to move these items into."
                      recoveryAction={{
                        label: "Add menu section",
                        onClick: () => focusMenuStructureInput("New menu section name")
                      }}
                      singleChoiceDetail="This is the only other menu section, so it is the confirmed destination."
                    />
                    <button type="button" className="ghost compact" disabled={!resolvedBulkTargetSection || recipeContextLocked} onClick={() => applyBulkMenuChange({ categoryId: resolvedBulkTargetSection })}>Move selected</button>
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
                              disabled={recipeContextLocked}
                              onChange={(event) => setSelectedMenuItemIds((current) => event.target.checked ? [...new Set([...current, item.id])] : current.filter((id) => id !== item.id))}
                            />
                            <button
                              type="button"
                              className="admin-menu-item-choice"
                              aria-pressed={isActiveItem}
                              aria-describedby={recipeContextLocked && !isActiveItem ? "inventory-recipe-context-lock" : undefined}
                              disabled={recipeContextLocked && !isActiveItem}
                              onClick={() => selectActiveMenuItem(item.id)}
                            >
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
                          disabled={recipeContextLocked}
                        />
                      </div>
                      {recipeExtensionEnabled && (
                        <InventoryRecipeEditor
                          menuItem={activeMenuItem}
                          ingredients={inventoryRecipeExtension?.ingredients}
                          recipe={activeMenuRecipe}
                          projection={activeMenuCostProjection}
                          expectedCatalogRevision={catalogRevision}
                          ingredientSourceState={inventoryRecipeExtension?.ingredientSourceState}
                          recipeSourceState={activeMenuCostProjectionState}
                          publishEligibility={recipePublishEligibility}
                          onPublish={inventoryRecipeExtension?.publishRecipe}
                          onReconcile={inventoryRecipeExtension?.reconcileRecipe}
                          onReset={inventoryRecipeExtension?.resetRecipe}
                          onInteractionStateChange={setRecipeEditorInteraction}
                        />
                      )}
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

        {resolvedActiveTab === "rules" && (
          <section className="admin-section" data-commercial-library-section="rules">
            <div className="admin-section-head"><h3>Quote rules</h3></div>
            <div className="admin-section-body">
              <p className="source-note">
                Set consistent recommendations and requirements for new quotes. Rules explain their result and never silently change a quote.
              </p>
              <div className="rule-system-summary" data-configuration-rule-summary>
                <div>
                  <span>{configurationRulesPresentation.enabledCount}</span>
                  <small>Active rules</small>
                </div>
                <div>
                  <span>{configurationRulesPresentation.records.length}</span>
                  <small>Total rules</small>
                </div>
                <p>
                  Rule changes stay in the Library draft. Published quote policy remains active until this catalog revision is checked and published.
                </p>
              </div>

              {configurationRulesPresentation.error ? (
                <p className="field-error" role="alert" data-configuration-rule-source-state="invalid">
                  Rule summaries are unavailable until the advanced rule source is corrected: {configurationRulesPresentation.error}
                </p>
              ) : configurationRulesPresentation.records.length ? (
                <div className="rule-config-list" data-configuration-rule-ledger>
                  {configurationRulesPresentation.records.map((rule, index) => {
                    const sourceRule = rule.sourceRule || {};
                    const statusLabel = rule.validationState === "attention"
                      ? "Needs attention"
                      : rule.validationState === "needs-check"
                        ? "Check menu reference"
                        : rule.enabled ? "Active" : "Off";
                    const state = rule.validationState === "attention"
                      ? "attention"
                      : rule.validationState === "needs-check"
                        ? "needs-check"
                        : rule.enabled ? "active" : "off";
                    const effect = isPlainRuleRecord(sourceRule.effect) ? sourceRule.effect : {};
                    const effectOperatorField = Object.prototype.hasOwnProperty.call(effect, "operator")
                      ? "operator"
                      : Object.prototype.hasOwnProperty.call(effect, "action") ? "action" : "operator";
                    const effectOperator = String(effect[effectOperatorField] || "").trim();
                    const componentRef = isPlainRuleRecord(effect.componentRef) ? effect.componentRef : null;
                    const componentType = String(componentRef?.componentType || "").trim();
                    const componentId = String(componentRef?.componentId || "").trim();
                    const componentOptions = componentRef
                      ? configurationRuleComponentOptions(configurationRuleCatalog, componentType, componentId)
                      : [];
                    const componentResolution = componentRef
                      ? resolveConfigurationRuleComponentRef(
                          componentRef,
                          configurationRuleCatalog,
                          { menuInventoryComplete: false }
                        )
                      : null;
                    const componentSelectionStale = Boolean(
                      componentId && componentResolution?.available !== true
                    );
                    const componentChoiceOptions = componentSelectionStale
                      && !componentOptions.some((option) => option.value !== componentId)
                      ? []
                      : componentOptions;
                    return (
                      <article
                        className="rule-config-card rule-editor-card"
                        key={`${rule.id}-${index}`}
                        data-configuration-rule-id={rule.id}
                        data-configuration-rule-state={state}
                      >
                        <div className="rule-config-head">
                          <div>
                            <strong>{rule.title}</strong>
                            <small>{rule.type}</small>
                          </div>
                          <span className="status-chip" data-state={state === "active" ? "ready" : state === "off" ? "neutral" : "watch"}>
                            {statusLabel}
                          </span>
                        </div>
                        <dl className="rule-config-sequence">
                          <div data-rule-statement="when">
                            <dt>When</dt>
                            <dd>{rule.conditions.join(" AND ")}</dd>
                          </div>
                          <div data-rule-statement="then">
                            <dt>Then</dt>
                            <dd>{rule.effect}</dd>
                          </div>
                          <div data-rule-statement="why">
                            <dt>Why</dt>
                            <dd>{rule.reason || "No explanation recorded."}</dd>
                          </div>
                        </dl>

                        {rule.validationMessage && (
                          <p className="rule-validation-message" role={rule.validationState === "attention" ? "alert" : undefined}>
                            {rule.validationMessage}
                          </p>
                        )}

                        {rule.structurable ? (
                          <details className="rule-structured-editor" data-configuration-rule-editor={rule.sourceIndex}>
                            <summary>Edit rule</summary>
                            <div className="rule-structured-editor-body">
                              <div className="rule-editor-meta">
                                <label className="admin-inline-toggle">
                                  <span>Enabled</span>
                                  <input
                                    type="checkbox"
                                    aria-label={`${rule.title} enabled`}
                                    checked={sourceRule.enabled !== false}
                                    onChange={(event) => patchConfigurationRule({
                                      ruleIndex: rule.sourceIndex,
                                      field: "enabled",
                                      value: event.target.checked
                                    })}
                                  />
                                </label>
                                <label>
                                  <span>Rule type</span>
                                  <select
                                    aria-label={`${rule.title} rule type`}
                                    value={rule.typeValue}
                                    onChange={(event) => patchConfigurationRule({
                                      ruleIndex: rule.sourceIndex,
                                      field: "type",
                                      value: event.target.value
                                    })}
                                  >
                                    {!RULE_TYPE_LABELS[rule.typeValue] && rule.typeValue && (
                                      <option value={rule.typeValue}>Unsupported: {sentenceCaseIdentifier(rule.typeValue)}</option>
                                    )}
                                    {RULE_TYPE_OPTIONS.map((option) => (
                                      <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                  </select>
                                </label>
                              </div>

                              <div className="rule-editor-sequence" data-rule-editor-sequence>
                                <section className="rule-editor-stage" data-rule-editor-stage="when">
                                  <span className="eyebrow">When</span>
                                  {sourceRule.conditions.map((condition, conditionIndex) => {
                                    const conditionOperator = String(condition.operator || "").trim();
                                    return (
                                      <div className="rule-condition-editor" key={`${rule.id}-condition-${conditionIndex}`}>
                                        {conditionIndex > 0 && <strong className="rule-and-marker" data-rule-conjunction="and">AND</strong>}
                                        <div className="rule-condition-fields">
                                          <label>
                                            <span>Business data</span>
                                            <select
                                              aria-label={`${rule.title} condition ${conditionIndex + 1} path`}
                                              value={condition.path || ""}
                                              onChange={(event) => patchConfigurationRule({
                                                section: "condition",
                                                ruleIndex: rule.sourceIndex,
                                                conditionIndex,
                                                field: "path",
                                                value: event.target.value
                                              })}
                                            >
                                              {!condition.path && <option value="">Choose business data</option>}
                                              {condition.path && !RULE_PATH_LABELS[condition.path] && (
                                                <option value={condition.path}>Custom field: {sentenceCaseIdentifier(condition.path)}</option>
                                              )}
                                              {Object.entries(RULE_PATH_LABELS).map(([value, label]) => (
                                                <option key={value} value={value}>{label}</option>
                                              ))}
                                            </select>
                                          </label>
                                          <label>
                                            <span>Comparison</span>
                                            <select
                                              aria-label={`${rule.title} condition ${conditionIndex + 1} operator`}
                                              value={conditionOperator}
                                              onChange={(event) => patchConfigurationRule({
                                                section: "condition",
                                                ruleIndex: rule.sourceIndex,
                                                conditionIndex,
                                                field: "operator",
                                                value: event.target.value
                                              })}
                                            >
                                              {!RULE_CONDITION_OPERATOR_OPTIONS.some((option) => option.value === conditionOperator) && conditionOperator && (
                                                <option value={conditionOperator}>Unsupported: {sentenceCaseIdentifier(conditionOperator)}</option>
                                              )}
                                              {RULE_CONDITION_OPERATOR_OPTIONS.map((option) => (
                                                <option key={option.value} value={option.value}>{option.label}</option>
                                              ))}
                                            </select>
                                          </label>
                                          <label>
                                            <span>Value</span>
                                            <RuleScalarEditor
                                              ariaLabel={`${rule.title} condition ${conditionIndex + 1} value`}
                                              value={condition.value}
                                              onChange={(value) => patchConfigurationRule({
                                                section: "condition",
                                                ruleIndex: rule.sourceIndex,
                                                conditionIndex,
                                                field: "value",
                                                value
                                              })}
                                            />
                                          </label>
                                        </div>
                                      </div>
                                    );
                                  })}
                                  {sourceRule.conditions.length === 0 && (
                                    <p className="source-note">This rule applies to every quote.</p>
                                  )}
                                </section>

                                <section className="rule-editor-stage" data-rule-editor-stage="then">
                                  <span className="eyebrow">Then</span>
                                  <div className="rule-effect-fields">
                                    <label>
                                      <span>Action</span>
                                      <select
                                        aria-label={`${rule.title} result operator`}
                                        value={effectOperator}
                                        onChange={(event) => patchConfigurationRule({
                                          section: "effect",
                                          ruleIndex: rule.sourceIndex,
                                          field: effectOperatorField,
                                          value: event.target.value
                                        })}
                                      >
                                        {!RULE_EFFECT_OPERATOR_OPTIONS.some((option) => option.value === effectOperator) && effectOperator && (
                                          <option value={effectOperator}>Unsupported: {sentenceCaseIdentifier(effectOperator)}</option>
                                        )}
                                        {RULE_EFFECT_OPERATOR_OPTIONS.map((option) => (
                                          <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                      </select>
                                    </label>
                                    {componentRef ? (
                                      <>
                                        <label>
                                          <span>Catalog component type</span>
                                          <select
                                            aria-label={`${rule.title} result component type`}
                                            value={componentType}
                                            onChange={(event) => patchConfigurationRule({
                                              section: "componentRef",
                                              ruleIndex: rule.sourceIndex,
                                              field: "componentType",
                                              value: event.target.value
                                            })}
                                          >
                                            {Object.entries(RULE_COMPONENT_TYPE_LABELS).map(([value, label]) => (
                                              <option key={value} value={value}>{label}</option>
                                            ))}
                                          </select>
                                        </label>
                                        <AdaptiveChoiceField
                                          label="Catalog component"
                                          options={componentChoiceOptions}
                                          value={componentId}
                                          onChange={(event) => patchConfigurationRule({
                                            section: "componentRef",
                                            ruleIndex: rule.sourceIndex,
                                            field: "componentId",
                                            value: event.target.value
                                          })}
                                          placeholder="Choose a component"
                                          emptyReason={componentSelectionStale
                                            ? `The saved ${(
                                                RULE_COMPONENT_TYPE_LABELS[componentType] || "catalog component"
                                              ).toLowerCase()} ${componentResolution?.label || componentId} is not available in this Library draft.`
                                            : `No ${(
                                                RULE_COMPONENT_TYPE_LABELS[componentType] || "catalog component"
                                              ).toLowerCase()} records are available for this rule.`}
                                          recoveryAction={{
                                            label: "Change component type",
                                            onClick: () => focusMenuStructureInput(`${rule.title} result component type`)
                                          }}
                                          singleChoiceDetail="This is the only catalog component available for the selected type."
                                          fieldState={componentSelectionStale ? { evidence: "stale" } : undefined}
                                          fieldStateDetails={componentSelectionStale ? {
                                            reason: "The saved component remains visible but is not available in the current Library draft.",
                                            recoveryAction: {
                                              label: "Change component type",
                                              onClick: () => focusMenuStructureInput(`${rule.title} result component type`)
                                            }
                                          } : undefined}
                                        />
                                      </>
                                    ) : (
                                      <label>
                                        <span>Business target</span>
                                        <select
                                          aria-label={`${rule.title} result target`}
                                          value={effect.target || ""}
                                          onChange={(event) => patchConfigurationRule({
                                            section: "effect",
                                            ruleIndex: rule.sourceIndex,
                                            field: "target",
                                            value: event.target.value
                                          })}
                                        >
                                          {!effect.target && <option value="">Choose a business target</option>}
                                          {effect.target && !RULE_PATH_LABELS[effect.target] && (
                                            <option value={effect.target}>Custom field: {sentenceCaseIdentifier(effect.target)}</option>
                                          )}
                                          {Object.entries(RULE_PATH_LABELS).map(([value, label]) => (
                                            <option key={value} value={value}>{label}</option>
                                          ))}
                                        </select>
                                      </label>
                                    )}
                                    <label>
                                      <span>Result value</span>
                                      <RuleScalarEditor
                                        ariaLabel={`${rule.title} result value`}
                                        value={effect.value}
                                        onChange={(value) => patchConfigurationRule({
                                          section: "effect",
                                          ruleIndex: rule.sourceIndex,
                                          field: "value",
                                          value
                                        })}
                                      />
                                    </label>
                                  </div>
                                </section>

                                <section className="rule-editor-stage" data-rule-editor-stage="why">
                                  <label>
                                    <span className="eyebrow">Why</span>
                                    <textarea
                                      aria-label={`${rule.title} reason`}
                                      rows="3"
                                      value={sourceRule.reason || ""}
                                      onChange={(event) => patchConfigurationRule({
                                        ruleIndex: rule.sourceIndex,
                                        field: "reason",
                                        value: event.target.value
                                      })}
                                    />
                                  </label>
                                </section>
                              </div>
                            </div>
                          </details>
                        ) : (
                          <p className="source-note">This record can only be corrected in Advanced rule source.</p>
                        )}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p className="source-note" data-configuration-rule-ledger="empty">
                  No quote rules have been added. New quotes use the published offers, components, templates, and pricing without additional rule guidance.
                </p>
              )}

              <details
                className="admin-menu-disclosure rule-source-disclosure"
                open={configurationRulesPresentation.error || configurationRulesPresentation.requiresAdvancedSource ? true : undefined}
                data-configuration-rule-technical-source
              >
                <summary>Advanced rule source</summary>
                <div className="admin-menu-disclosure-body">
                  <label className="json-label">
                    <span>Rule source (JSON)</span>
                    <textarea
                      className="json-editor"
                      data-configuration-rules-editor
                      value={jsonDrafts.configurationRules}
                      onChange={(event) => patchJsonDraft("configurationRules", event.target.value)}
                    />
                    <small>For advanced administrators. Publication checks operators, references, and conflicting requirements before anything becomes active.</small>
                  </label>
                </div>
              </details>
            </div>
          </section>
        )}

        {resolvedActiveTab === "pricing" && (
          <>
            <section className="admin-section" data-commercial-library-section="pricing">
              <div className="admin-section-head"><h3>Pricing readiness</h3></div>
              <div className="admin-section-body">
                <p className="source-note">
                  This Library supplies the shared rates and defaults used for new quotes. Each quote keeps its own exact total and line-by-line price explanation in the quote workspace.
                </p>
                <div className="rule-system-summary" data-pricing-policy-summary>
                  <div>
                    <span>{publishedCatalogAvailable ? "Published" : "Review only"}</span>
                    <small>Library use</small>
                  </div>
                  <div>
                    <span>{pricingConfirmationCurrent ? "Reviewed" : "Needs review"}</span>
                    <small>Pricing readiness</small>
                  </div>
                  <p data-pricing-explanation="quote-waterfall">
                    {publishedCatalogAvailable && pricingConfirmationCurrent
                      ? "Pricing is confirmed for this catalog revision. Draft edits do not affect active quote calculations until publication."
                      : pricingConfirmationCurrent
                        ? "These rates are checked only in this workspace. Publishing is unavailable from this source, and no shared catalog or pricing changed."
                        : "Pricing is not confirmed for this catalog revision. Check the rates and defaults below before publishing changes for new quotes."}
                  </p>
                </div>
                <label className="admin-inline-toggle">
                  <span>I confirm these rates and defaults are ready for new quotes.</span>
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

            <section className="admin-section pricing-policy-editor" data-pricing-policy-editor>
              <div className="admin-section-head"><h3>Pricing policy</h3></div>
              <div className="admin-section-body pricing-policy-groups">
                <section className="pricing-policy-group pricing-policy-group-primary" data-pricing-policy-group="base">
                  <div className="pricing-policy-group-head">
                    <span className="eyebrow">Base pricing</span>
                    <h4>Standard staffing rates</h4>
                    <p>Set the sell rates and billing basis used when a quote has no staff-rate override.</p>
                  </div>
                  <div className="admin-grid-settings">
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
                    <label>
                      Default bartender rate
                      <small className="admin-field-hint">Event Basics uses this unless a quote-level bartender rate override is entered.</small>
                      <input type="number" step="0.01" min="0" value={draft.settings.bartenderRate} onChange={(e) => patchNumericSetting("bartenderRate", e.target.value)} />
                    </label>
                    <label>
                      <span>Include staffing labor in quote totals</span>
                      <small className="admin-field-hint">When off, server, chef, and bartender labor is excluded from quote totals.</small>
                      <input
                        type="checkbox"
                        checked={draft.settings.staffingLaborEnabled !== false}
                        onChange={(e) => patchToggleSetting("staffingLaborEnabled", e.target.checked)}
                      />
                    </label>
                    <label>
                      Staffing charge mode
                      <small className="admin-field-hint">Per hour uses rate x staff count x hours. Per event ignores hours.</small>
                      <select
                        value={normalizeStaffingChargeMode(draft.settings?.staffingChargeMode, "per_hour")}
                        onChange={(e) => patchTextSetting("staffingChargeMode", normalizeStaffingChargeMode(e.target.value, "per_hour"))}
                      >
                        <option value="per_hour">Per hour x staff count</option>
                        <option value="per_event_per_staff">Per event x staff count</option>
                      </select>
                    </label>
                  </div>
                </section>

                <details className="pricing-policy-group" data-pricing-policy-group="adjustments-context">
                  <summary>
                    <span>Adjustments &amp; context</span>
                    <small>Travel rates, quote window, seasonal default, and capacity warning.</small>
                  </summary>
                  <div className="admin-grid-settings pricing-policy-group-body">
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
                      Quote validity days
                      <small className="admin-field-hint">Printed on the proposal as the expiration window.</small>
                      <input type="number" step="1" min="1" value={draft.settings.quoteValidityDays} onChange={(e) => patchNumericSetting("quoteValidityDays", e.target.value)} />
                    </label>
                    <label>
                      Default season
                      <input type="text" value={draft.settings.defaultSeasonProfile || "auto"} onChange={(e) => patchTextSetting("defaultSeasonProfile", e.target.value)} />
                    </label>
                    <label>
                      Capacity limit
                      <small className="admin-field-hint">Operations warning limit for same-venue demand.</small>
                      <input type="number" step="1" min="1" value={draft.settings.capacityLimit || 400} onChange={(e) => patchNumericSetting("capacityLimit", e.target.value)} />
                    </label>
                  </div>
                </details>

                <details className="pricing-policy-group" data-pricing-policy-group="fees">
                  <summary>
                    <span>Fees</span>
                    <small>Fallback service fee and advanced guest-count tiers.</small>
                    {serviceFeeSourceNeedsAttention && (
                      <strong className="pricing-policy-group-attention" data-pricing-policy-attention>
                        Needs attention · fee tiers source
                      </strong>
                    )}
                  </summary>
                  <div className="pricing-policy-group-body">
                    <div className="admin-grid-settings">
                      <label>
                        Service fee % fallback
                        <small className="admin-field-hint">Used only when no service-fee tier matches guest count.</small>
                        <input type="number" step="0.01" value={draft.settings.serviceFeePct} onChange={(e) => patchNumericSetting("serviceFeePct", e.target.value)} />
                      </label>
                    </div>
                    <details className="admin-menu-disclosure pricing-policy-technical">
                      <summary>Advanced fee tiers</summary>
                      <div className="admin-menu-disclosure-body">
                        <label className="json-label">
                          <span>Service fee tier source (JSON)</span>
                          <textarea className="json-editor" value={jsonDrafts.serviceFeeTiers} onChange={(e) => patchJsonDraft("serviceFeeTiers", e.target.value)} />
                          <small>{JSON_FIELD_META.find((field) => field.key === "serviceFeeTiers")?.hint}</small>
                        </label>
                      </div>
                    </details>
                  </div>
                </details>

                <details className="pricing-policy-group" data-pricing-policy-group="tax">
                  <summary>
                    <span>Tax</span>
                    <small>Fallback rate, default region, and advanced regional rates.</small>
                    {taxRegionSourceNeedsAttention && (
                      <strong className="pricing-policy-group-attention" data-pricing-policy-attention>
                        Needs attention · tax region source
                      </strong>
                    )}
                  </summary>
                  <div className="pricing-policy-group-body">
                    <div className="admin-grid-settings">
                      <label>
                        Tax rate fallback
                        <small className="admin-field-hint">Used only when no tax region is selected or found.</small>
                        <input type="number" step="0.01" value={draft.settings.taxRate} onChange={(e) => patchNumericSetting("taxRate", e.target.value)} />
                      </label>
                      <label>
                        Default tax region
                        <input type="text" value={draft.settings.defaultTaxRegion || ""} onChange={(e) => patchTextSetting("defaultTaxRegion", e.target.value)} />
                      </label>
                    </div>
                    <details className="admin-menu-disclosure pricing-policy-technical">
                      <summary>Advanced tax regions</summary>
                      <div className="admin-menu-disclosure-body">
                        <label className="json-label">
                          <span>Tax region source (JSON)</span>
                          <textarea className="json-editor" value={jsonDrafts.taxRegions} onChange={(e) => patchJsonDraft("taxRegions", e.target.value)} />
                          <small>{JSON_FIELD_META.find((field) => field.key === "taxRegions")?.hint}</small>
                        </label>
                      </div>
                    </details>
                  </div>
                </details>

                <details className="pricing-policy-group" data-pricing-policy-group="deposit">
                  <summary>
                    <span>Deposit</span>
                    <small>Required deposit percentage and customer-facing notice.</small>
                  </summary>
                  <div className="admin-grid-settings pricing-policy-group-body">
                    <label>
                      Deposit %
                      <small className="admin-field-hint">Controls the required deposit shown in totals and proposal summary.</small>
                      <input type="number" step="0.01" value={draft.settings.depositPct} onChange={(e) => patchNumericSetting("depositPct", e.target.value)} />
                    </label>
                    <label>
                      Deposit notice
                      <input type="text" value={draft.settings.depositNotice || ""} onChange={(e) => patchTextSetting("depositNotice", e.target.value)} />
                    </label>
                  </div>
                </details>
              </div>
            </section>

            <details className="admin-section admin-menu-disclosure pricing-policy-advanced" data-pricing-policy-group="advanced">
              <summary>
                <span className="pricing-policy-summary-title">Advanced policy</span>
                <small>Margin evidence, recommendations, workspace controls, proposal details, brand, and technical sources.</small>
                <strong
                  className="pricing-policy-summary-attention"
                  data-state={advancedPricingPolicySummary.hasAttention ? "attention" : "ready"}
                  data-pricing-policy-attention
                >
                  {advancedPricingPolicySummary.label}
                </strong>
              </summary>
              <div className="admin-section-body admin-menu-disclosure-body pricing-policy-advanced-body">
                {PILOT_MARGINS_ENABLED && (
                  <details className="admin-menu-disclosure pricing-policy-child" data-pricing-policy-advanced-section="margin">
                    <summary>
                      <span>Cost and margin evidence</span>
                      <small>{activeCostRecords.length - recordedCostCount + (3 - recordedStaffCostCount)} cost entries still need evidence.</small>
                    </summary>
                    <div className="admin-menu-disclosure-body pricing-policy-child-body">
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
                    <div className="admin-grid-settings">
                      <label>
                        Server cost rate
                        <small className="admin-field-hint">Staff-only; what a server actually costs you per hour. Leave blank until recorded.</small>
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
                        <small className="admin-field-hint">Staff-only comparison line on the margin strip. Leave blank for no target comparison.</small>
                        <input type="number" step="0.01" min="0" max="1" placeholder="Not set" value={draft.settings.targetMarginPct ?? ""} onChange={(e) => patchNullableNumericSetting("targetMarginPct", e.target.value)} />
                      </label>
                    </div>
                    </div>
                  </details>
                )}

                <details className="admin-menu-disclosure pricing-policy-child pricing-policy-technical" data-pricing-policy-advanced-section="integration">
                  <summary>
                    <span>Integration recovery limits</span>
                    <small>Retry and audit-retention safeguards.</small>
                  </summary>
                  <div className="admin-grid-settings admin-menu-disclosure-body">
                    <label>Retry limit<input type="number" step="1" min="1" max="10" value={draft.settings.integrationRetryLimit || 3} onChange={(e) => patchNumericSetting("integrationRetryLimit", e.target.value)} /></label>
                    <label>Audit records retained<input type="number" step="1" min="10" max="200" value={draft.settings.integrationAuditRetention || 50} onChange={(e) => patchNumericSetting("integrationAuditRetention", e.target.value)} /></label>
                  </div>
                </details>

            <details className="admin-menu-disclosure pricing-policy-child" data-pricing-policy-advanced-section="guided-recommendations">
              <summary>
                <span>Guided recommendations</span>
                <small>{enabledUpsellRules.length} active · suggestions shown in quote context.</small>
              </summary>
              <div className="admin-menu-disclosure-body pricing-policy-child-body">
          <div className="admin-section-head">
            <h3>Recommendation rules</h3>
            <button type="button" className="ghost" onClick={addUpsellRule}>Add recommendation</button>
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
          </div>
          <div className="rule-config-list">
            {(draft.settings?.upsellRules || []).map((rule, ruleIndex) => {
              const kind = String(rule.kind || "addon");
              const targets = getUpsellTargetOptions(kind, rule.targetId);
              const autoPackageTargetAvailable = kind === "package"
                && (draft.packages || []).filter((item) => item?.active !== false).length >= 2;
              const targetOptions = autoPackageTargetAvailable
                ? [{ value: "__auto_next_package__", label: "Auto next higher package" }, ...targets]
                : targets;
              const targetValue = kind === "package" && !rule.targetId
                ? "__auto_next_package__"
                : (rule.targetId || "");
              const targetCollection = kind === "rental"
                ? (draft.rentals || [])
                : kind === "package"
                  ? (draft.packages || [])
                  : (draft.addons || []);
              const selectedTargetRecord = targetCollection.find((item) => item.id === rule.targetId);
              const targetSelectionStale = Boolean(
                rule.targetId && (!selectedTargetRecord || selectedTargetRecord.active === false)
              );
              const targetChoiceOptions = targetSelectionStale
                && !targetOptions.some((option) => option.value !== targetValue)
                ? []
                : targetOptions;
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
                    <AdaptiveChoiceField
                      label="Target item"
                      options={targetChoiceOptions}
                      value={targetValue}
                      onChange={(event) => patchUpsellRule(
                        ruleIndex,
                        "targetId",
                        event.target.value === "__auto_next_package__" ? "" : event.target.value
                      )}
                      placeholder="Choose target"
                      emptyReason={targetSelectionStale
                        ? `The saved target ${rule.targetId} is not available in this Library draft.`
                        : `No active ${kind === "package" ? "offers" : `${kind}s`} are available for this recommendation.`}
                      recoveryAction={{
                        label: `Review ${kind === "package" ? "offers" : `${kind}s`}`,
                        onClick: () => setActiveTab(kind === "package" ? "packages" : `${kind}s`)
                      }}
                      singleChoiceDetail="This is the only available target for this recommendation."
                      fieldState={targetSelectionStale ? { evidence: "stale" } : undefined}
                      fieldStateDetails={targetSelectionStale ? {
                        reason: "The saved recommendation target remains visible but is not available in the current Library draft.",
                        recoveryAction: {
                          label: `Review ${kind === "package" ? "offers" : `${kind}s`}`,
                          onClick: () => setActiveTab(kind === "package" ? "packages" : `${kind}s`)
                        }
                      } : undefined}
                    />
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
              </div>
            </details>

            <details className="admin-menu-disclosure pricing-policy-child" data-pricing-policy-advanced-section="workspace-access">
              <summary>
                <span>Workspace access</span>
                <small>Plan-controlled tools and assisted-work settings.</small>
              </summary>
              <div className="admin-menu-disclosure-body pricing-policy-child-body">
          {enforceOrderFeatureAccess && (
            <p className="source-note">
              These tools reflect the organization&apos;s current workspace plan. Manage plan access in Administration, then reopen Library settings.
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
              </div>
            </details>

            <details className="admin-menu-disclosure pricing-policy-child" data-pricing-policy-advanced-section="proposal-details">
              <summary>
                <span>Proposal details</span>
                <small>Contact, document, and customer-facing proposal defaults.</small>
              </summary>
              <div className="admin-menu-disclosure-body pricing-policy-child-body">
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
                Use a recognized time zone such as America/Chicago. Revenue timing stays blocked until this is valid.
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
              </div>
            </details>

            <details className="admin-menu-disclosure pricing-policy-child" data-pricing-policy-advanced-section="customer-connections">
              <summary>
                <span>Customer-system connections</span>
                <small>Current delivery boundary and Administration handoff.</small>
              </summary>
              <div className="admin-menu-disclosure-body pricing-policy-child-body">
          <p className="source-note">
            Customer-system delivery is not connected. Quotes remain in QuotePilot until an authorized connection is enabled in Administration.
          </p>
              </div>
            </details>

            <details className="admin-menu-disclosure pricing-policy-child" data-pricing-policy-advanced-section="brand">
              <summary>
                <span>Customer-facing brand</span>
                <small>{brandNamePreview} · {brandReadinessItems.filter((item) => item.state === "ready").length}/{brandReadinessItems.length} brand details ready.</small>
              </summary>
              <div className="admin-menu-disclosure-body pricing-policy-child-body">
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
              </div>
            </details>

            <details className="admin-menu-disclosure pricing-policy-child pricing-policy-technical" data-pricing-policy-advanced-section="technical-sources">
          <summary>
            <span>Technical source data</span>
            <small>{advancedPricingSourceErrorCount ? `${advancedPricingSourceErrorCount} sources need correction.` : "Provenance and advanced structured sources."}</small>
          </summary>
          <div className="admin-section-body admin-menu-disclosure-body">
            {JSON_FIELD_META.filter((field) => ![
              "configurationRules",
              "serviceFeeTiers",
              "taxRegions"
            ].includes(field.key)).map((field) => (
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
            </details>
              </div>
            </details>
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
          {!catalogRecoveryOwnsSaveAction && !starterChoiceOnly && !packageWorkspaceActive && (saving || hasUnsavedChanges) && (
            <button
              type="button"
              className="cta"
              onClick={handleSave}
              disabled={saving || !hasUnsavedChanges || Boolean(pendingCatalogEvidenceRef.current)}
            >
                {saving ? "Saving..." : "Save draft now"}
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
