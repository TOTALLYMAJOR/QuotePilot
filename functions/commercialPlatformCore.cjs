"use strict";

const COMMERCIAL_PLATFORM_SCHEMA_VERSION = 1;
const CONFIGURABLE_OFFER_VERSION = "configurable-offer-v1";
const COMMERCIAL_TEMPLATE_VERSION = "commercial-template-v1";
const CONFIGURATION_RULE_VERSION = "configuration-rule-v1";
const VERTICAL_PACK_VERSION = "vertical-pack-v1";

const COMPONENT_TYPES = new Set(["menu_item", "addon", "rental", "resource"]);
const RULE_TYPES = new Set(["validation", "requirement", "recommendation", "selection", "exclusion"]);
const CONDITION_OPERATORS = new Set(["eq", "neq", "gte", "lte", "includes", "selected"]);
const EFFECT_OPERATORS = new Set(["block", "require", "recommend", "select", "exclude"]);
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,159}$/i;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

class CommercialPlatformError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CommercialPlatformError";
    this.code = code;
    this.details = details;
  }
}

function text(value) {
  return String(value ?? "").trim();
}

function safeId(value, label = "id") {
  const id = text(value);
  if (!ID_PATTERN.test(id)) {
    throw new CommercialPlatformError("invalid_id", `${label} must be a stable identifier.`, { label, value: id });
  }
  return id;
}

function plainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null)
    && !Object.keys(value).some((key) => FORBIDDEN_KEYS.has(key));
}

function deepClone(value) {
  if (Array.isArray(value)) return value.map(deepClone);
  if (plainRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, deepClone(entry)]));
  }
  return value;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key], seen));
  return Object.freeze(value);
}

function uniqueIds(value, label, maximum = 100) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximum) {
    throw new CommercialPlatformError("invalid_reference_list", `${label} must be an array with at most ${maximum} references.`);
  }
  const ids = value.map((entry, index) => safeId(entry, `${label}[${index}]`));
  if (new Set(ids).size !== ids.length) {
    throw new CommercialPlatformError("duplicate_reference", `${label} contains a duplicate reference.`);
  }
  return ids;
}

function normalizeComponentRef(value, fallbackType = "") {
  if (!plainRecord(value)) {
    throw new CommercialPlatformError("invalid_component_reference", "Component references must be records.");
  }
  const componentType = text(value.componentType || value.type || fallbackType).toLowerCase();
  if (!COMPONENT_TYPES.has(componentType)) {
    throw new CommercialPlatformError("unsupported_component_type", `Unsupported component type ${componentType || "(missing)"}.`);
  }
  return { componentType, componentId: safeId(value.componentId || value.id, "componentId") };
}

function packageIncludedComponents(pkg = {}) {
  const groups = [
    ["menu_item", pkg.includedMenuItemIds],
    ["addon", pkg.includedAddonIds],
    ["rental", pkg.includedRentalIds]
  ];
  return groups.flatMap(([componentType, ids]) => (
    uniqueIds(ids, `${componentType} inclusions`).map((componentId) => ({ componentType, componentId }))
  ));
}

function normalizeChoiceGroup(group, index) {
  if (!plainRecord(group)) {
    throw new CommercialPlatformError("invalid_choice_group", `Choice group ${index + 1} must be a record.`);
  }
  const id = safeId(group.id, `choiceGroups[${index}].id`);
  const componentType = text(group.componentType || group.type).toLowerCase();
  if (!COMPONENT_TYPES.has(componentType)) {
    throw new CommercialPlatformError("unsupported_component_type", `Choice group ${id} has an unsupported component type.`);
  }
  const componentIds = uniqueIds(group.componentIds, `choice group ${id} componentIds`);
  const minChoices = Number(group.minChoices ?? (group.required === true ? 1 : 0));
  const maxChoices = Number(group.maxChoices ?? componentIds.length);
  if (
    !Number.isSafeInteger(minChoices)
    || !Number.isSafeInteger(maxChoices)
    || minChoices < 0
    || maxChoices < minChoices
    || maxChoices > componentIds.length
  ) {
    throw new CommercialPlatformError("invalid_choice_bounds", `Choice group ${id} has invalid minimum or maximum choices.`);
  }
  return {
    id,
    label: text(group.label || group.name) || id,
    componentType,
    componentIds,
    minChoices,
    maxChoices,
    required: minChoices > 0
  };
}

function adaptPackageToConfigurableOffer(pkg = {}) {
  const id = safeId(pkg.id, "package.id");
  const groups = Array.isArray(pkg.choiceGroups) ? pkg.choiceGroups : [];
  const choiceGroups = groups.map(normalizeChoiceGroup);
  if (new Set(choiceGroups.map((group) => group.id)).size !== choiceGroups.length) {
    throw new CommercialPlatformError("duplicate_choice_group", `Package ${id} contains duplicate choice-group IDs.`);
  }
  return deepFreeze({
    schemaVersion: COMMERCIAL_PLATFORM_SCHEMA_VERSION,
    offerVersion: text(pkg.offerVersion) || CONFIGURABLE_OFFER_VERSION,
    id,
    name: text(pkg.name) || id,
    verticalType: text(pkg.verticalType) || "catering",
    active: pkg.active !== false,
    legacyPackageId: id,
    includedComponents: packageIncludedComponents(pkg),
    choiceGroups,
    quantityPolicyRefs: uniqueIds(pkg.quantityPolicyRefs, `package ${id} quantityPolicyRefs`),
    ruleRefs: uniqueIds(pkg.ruleRefs, `package ${id} ruleRefs`)
  });
}

function componentLookups(catalog = {}) {
  const menuItems = Array.isArray(catalog.menuItems)
    ? catalog.menuItems
    : (Array.isArray(catalog.settings?.menuSections)
      ? catalog.settings.menuSections.flatMap((section) => section?.items || [])
      : []);
  return {
    menu_item: new Map(menuItems.map((item) => [text(item?.id), item])),
    addon: new Map((catalog.addons || []).map((item) => [text(item?.id), item])),
    rental: new Map((catalog.rentals || []).map((item) => [text(item?.id), item])),
    resource: new Map((catalog.resources || []).map((item) => [text(item?.id), item]))
  };
}

function assertComponentAvailable(reference, lookups, context) {
  const record = lookups[reference.componentType]?.get(reference.componentId);
  if (!record || record.active === false) {
    throw new CommercialPlatformError(
      "unavailable_component_reference",
      `${context} references unavailable ${reference.componentType} ${reference.componentId}.`,
      reference
    );
  }
}

function validateConfigurableOffer(value = {}, catalog = {}) {
  const offer = Array.isArray(value.includedComponents) && Array.isArray(value.choiceGroups)
    ? deepFreeze(deepClone(value))
    : adaptPackageToConfigurableOffer(value);
  if (offer.offerVersion !== CONFIGURABLE_OFFER_VERSION) {
    throw new CommercialPlatformError("unsupported_offer_version", `Offer ${offer.id || "(missing)"} uses an unsupported version.`);
  }
  const lookups = componentLookups(catalog);
  offer.includedComponents.forEach((reference) => {
    if (reference.componentType === "menu_item" && catalog.menuInventoryComplete === false && !lookups.menu_item.has(reference.componentId)) return;
    assertComponentAvailable(reference, lookups, `Offer ${offer.id}`);
  });
  offer.choiceGroups.forEach((group) => {
    group.componentIds.forEach((componentId) => {
      if (group.componentType === "menu_item" && catalog.menuInventoryComplete === false && !lookups.menu_item.has(componentId)) return;
      assertComponentAvailable({
        componentType: group.componentType,
        componentId
      }, lookups, `Offer ${offer.id} choice group ${group.id}`);
    });
  });
  return offer;
}

function evaluateOfferConfiguration(value = {}, selections = {}, catalog = {}) {
  const offer = validateConfigurableOffer(value, catalog);
  const selectedByGroup = plainRecord(selections) ? selections : {};
  const violations = [];
  const resolved = {};
  offer.choiceGroups.forEach((group) => {
    let selected;
    try {
      selected = uniqueIds(selectedByGroup[group.id], `selection ${group.id}`);
    } catch (error) {
      violations.push({ code: error.code || "invalid_selection", groupId: group.id, reason: error.message });
      selected = [];
    }
    const unknown = selected.filter((id) => !group.componentIds.includes(id));
    if (unknown.length) {
      violations.push({ code: "choice_not_offered", groupId: group.id, componentIds: unknown, reason: `Choice group ${group.label} includes a selection not offered by the authoritative offer.` });
    }
    if (selected.length < group.minChoices) {
      violations.push({ code: "choice_minimum_not_met", groupId: group.id, reason: `${group.label} requires at least ${group.minChoices} choice${group.minChoices === 1 ? "" : "s"}.` });
    }
    if (selected.length > group.maxChoices) {
      violations.push({ code: "choice_maximum_exceeded", groupId: group.id, reason: `${group.label} allows at most ${group.maxChoices} choice${group.maxChoices === 1 ? "" : "s"}.` });
    }
    resolved[group.id] = selected.filter((id) => group.componentIds.includes(id));
  });
  return deepFreeze({
    offerId: offer.id,
    valid: violations.length === 0,
    selections: resolved,
    violations
  });
}

function adaptEventTemplateToCommercialTemplate(template = {}) {
  const id = safeId(template.id, "eventTemplate.id");
  const packageId = safeId(template.pkg || template.offerRef, `event template ${id} package`);
  return deepFreeze({
    schemaVersion: COMMERCIAL_PLATFORM_SCHEMA_VERSION,
    templateVersion: text(template.templateVersion) || COMMERCIAL_TEMPLATE_VERSION,
    id,
    name: text(template.name) || id,
    verticalType: text(template.verticalType) || "catering",
    offerRef: packageId,
    configurationDefaults: {
      eventTypeId: text(template.eventTypeId) || id,
      style: text(template.style),
      hours: Number(template.hours || 0),
      milesRT: Number(template.milesRT || 0),
      payMethod: text(template.payMethod),
      taxRegion: text(template.taxRegion),
      seasonProfileId: text(template.seasonProfileId)
    },
    componentSelections: {
      addons: uniqueIds(template.addons, `event template ${id} addons`),
      rentals: uniqueIds(template.rentals, `event template ${id} rentals`),
      menuItems: uniqueIds(template.menuItems, `event template ${id} menuItems`)
    },
    resourcePolicyRefs: uniqueIds(template.resourcePolicyRefs, `event template ${id} resourcePolicyRefs`),
    pricingContextRefs: uniqueIds(template.pricingContextRefs, `event template ${id} pricingContextRefs`),
    moduleRefs: uniqueIds(template.moduleRefs, `event template ${id} moduleRefs`),
    presentationMetadata: plainRecord(template.presentationMetadata) ? deepClone(template.presentationMetadata) : {},
    provenance: plainRecord(template.provenance) ? deepClone(template.provenance) : { source: "legacy_event_template", sourceId: id }
  });
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function composeSection(target, source, section, moduleId, collisions) {
  if (!plainRecord(source)) return target;
  const next = { ...target };
  Object.entries(source).forEach(([key, value]) => {
    if (value === undefined || value === "") return;
    if (Object.prototype.hasOwnProperty.call(next, key) && !sameValue(next[key], value)) {
      collisions.push({ path: `${section}.${key}`, moduleId, before: next[key], proposed: value });
      return;
    }
    next[key] = deepClone(value);
  });
  return next;
}

function composeCommercialTemplate(baseValue = {}, moduleValues = []) {
  const base = baseValue.templateVersion ? deepClone(baseValue) : deepClone(adaptEventTemplateToCommercialTemplate(baseValue));
  const modules = Array.isArray(moduleValues) ? moduleValues : [];
  const collisions = [];
  const appliedModuleIds = [];
  modules.forEach((module, index) => {
    if (!plainRecord(module)) {
      throw new CommercialPlatformError("invalid_template_module", `Template module ${index + 1} must be a record.`);
    }
    const moduleId = safeId(module.id, `templateModules[${index}].id`);
    appliedModuleIds.push(moduleId);
    base.configurationDefaults = composeSection(base.configurationDefaults, module.configurationDefaults, "configurationDefaults", moduleId, collisions);
    base.componentSelections = composeSection(base.componentSelections, module.componentSelections, "componentSelections", moduleId, collisions);
    base.presentationMetadata = composeSection(base.presentationMetadata, module.presentationMetadata, "presentationMetadata", moduleId, collisions);
  });
  return deepFreeze({
    template: base,
    appliedModuleIds,
    collisions,
    valid: collisions.length === 0
  });
}

function applyCommercialTemplate({ draft = {}, template = {}, explicitFields = [] } = {}) {
  const normalized = template.templateVersion ? template : adaptEventTemplateToCommercialTemplate(template);
  const explicit = new Set((Array.isArray(explicitFields) ? explicitFields : []).map(text));
  const patch = {};
  const skipped = [];
  const candidates = {
    pkg: normalized.offerRef,
    ...normalized.configurationDefaults,
    ...normalized.componentSelections
  };
  Object.entries(candidates).forEach(([key, value]) => {
    if (explicit.has(key)) {
      skipped.push(key);
      return;
    }
    if (value !== undefined && value !== "") patch[key] = deepClone(value);
  });
  return deepFreeze({
    draft: { ...deepClone(draft), ...patch },
    patch,
    skippedExplicitFields: skipped,
    provenance: { templateVersion: normalized.templateVersion, templateId: normalized.id }
  });
}

function pathValue(source, path) {
  const parts = text(path).split(".").filter(Boolean);
  let current = source;
  for (const part of parts) {
    if (FORBIDDEN_KEYS.has(part) || (!plainRecord(current) && !Array.isArray(current))) return undefined;
    current = current[part];
  }
  return current;
}

function normalizeCondition(condition, ruleId, index) {
  if (!plainRecord(condition)) {
    throw new CommercialPlatformError("invalid_rule_condition", `Rule ${ruleId} condition ${index + 1} must be a record.`);
  }
  const operator = text(condition.operator).toLowerCase();
  if (!CONDITION_OPERATORS.has(operator)) {
    throw new CommercialPlatformError("unknown_condition_operator", `Rule ${ruleId} uses unknown condition operator ${operator || "(missing)"}.`);
  }
  const path = text(condition.path);
  if (!path || path.split(".").some((part) => FORBIDDEN_KEYS.has(part))) {
    throw new CommercialPlatformError("invalid_condition_path", `Rule ${ruleId} has an invalid condition path.`);
  }
  return { path, operator, value: deepClone(condition.value) };
}

function normalizeEffect(effect, ruleId) {
  if (!plainRecord(effect)) {
    throw new CommercialPlatformError("invalid_rule_effect", `Rule ${ruleId} effect must be a record.`);
  }
  const operator = text(effect.operator || effect.action).toLowerCase();
  if (!EFFECT_OPERATORS.has(operator)) {
    throw new CommercialPlatformError("unknown_effect_operator", `Rule ${ruleId} uses unknown effect operator ${operator || "(missing)"}.`);
  }
  const normalized = { operator, target: text(effect.target), value: deepClone(effect.value) };
  if (effect.componentRef) normalized.componentRef = normalizeComponentRef(effect.componentRef);
  if (!normalized.target && !normalized.componentRef && operator !== "block") {
    throw new CommercialPlatformError("missing_effect_target", `Rule ${ruleId} effect needs an exact target.`);
  }
  return normalized;
}

function validateConfigurationRule(rule = {}, catalog = {}) {
  if (!plainRecord(rule)) throw new CommercialPlatformError("invalid_rule", "Configuration rules must be records.");
  const id = safeId(rule.id, "rule.id");
  const type = text(rule.type).toLowerCase();
  if (!RULE_TYPES.has(type)) {
    throw new CommercialPlatformError("unknown_rule_type", `Rule ${id} has unsupported type ${type || "(missing)"}.`);
  }
  if (!Array.isArray(rule.conditions) || rule.conditions.length > 20) {
    throw new CommercialPlatformError("invalid_rule_conditions", `Rule ${id} must contain at most 20 conditions.`);
  }
  const normalized = {
    schemaVersion: COMMERCIAL_PLATFORM_SCHEMA_VERSION,
    ruleVersion: text(rule.ruleVersion) || CONFIGURATION_RULE_VERSION,
    id,
    type,
    conditions: rule.conditions.map((condition, index) => normalizeCondition(condition, id, index)),
    effect: normalizeEffect(rule.effect, id),
    reason: text(rule.reason),
    severity: text(rule.severity || (type === "recommendation" ? "info" : "warning")).toLowerCase(),
    verticalScope: text(rule.verticalScope) || "catering",
    enabled: rule.enabled !== false,
    provenance: plainRecord(rule.provenance) ? deepClone(rule.provenance) : { source: "tenant_configuration" }
  };
  if (normalized.ruleVersion !== CONFIGURATION_RULE_VERSION) {
    throw new CommercialPlatformError("unsupported_rule_version", `Rule ${id} uses an unsupported version.`);
  }
  if (normalized.effect.componentRef) {
    assertComponentAvailable(normalized.effect.componentRef, componentLookups(catalog), `Rule ${id}`);
  }
  return deepFreeze(normalized);
}

function conditionMatches(condition, context) {
  const actual = pathValue(context, condition.path);
  if (condition.operator === "eq") return actual === condition.value;
  if (condition.operator === "neq") return actual !== condition.value;
  if (condition.operator === "gte") return Number.isFinite(Number(actual)) && Number(actual) >= Number(condition.value);
  if (condition.operator === "lte") return Number.isFinite(Number(actual)) && Number(actual) <= Number(condition.value);
  if (condition.operator === "includes") return Array.isArray(actual) && actual.includes(condition.value);
  if (condition.operator === "selected") return actual === true || (Array.isArray(actual) && actual.includes(condition.value));
  return false;
}

function mandatoryEffectKey(rule) {
  if (!["requirement", "selection", "exclusion", "validation"].includes(rule.type)) return "";
  const ref = rule.effect.componentRef;
  return ref ? `${ref.componentType}:${ref.componentId}` : rule.effect.target;
}

function detectRuleConflicts(rules = []) {
  const effects = new Map();
  const conflicts = [];
  rules.forEach((rule) => {
    const key = mandatoryEffectKey(rule);
    if (!key) return;
    const current = effects.get(key);
    if (current && (
      current.effect.operator !== rule.effect.operator
      || !sameValue(current.effect.value, rule.effect.value)
    )) {
      conflicts.push({ target: key, ruleIds: [current.id, rule.id], reason: "Mandatory rules declare incompatible effects for the same target." });
      return;
    }
    effects.set(key, rule);
  });
  return conflicts;
}

function evaluateConfigurationRules(ruleValues = [], context = {}, catalog = {}) {
  if (!Array.isArray(ruleValues) || ruleValues.length > 500) {
    throw new CommercialPlatformError("invalid_rule_set", "Configuration rules must be a bounded array.");
  }
  const rules = ruleValues.map((rule) => validateConfigurationRule(rule, catalog));
  const conflicts = detectRuleConflicts(rules.filter((rule) => rule.enabled));
  const evaluations = rules.map((rule) => {
    const matched = rule.enabled && rule.conditions.every((condition) => conditionMatches(condition, context));
    return {
      ruleId: rule.id,
      ruleVersion: rule.ruleVersion,
      matched,
      type: rule.type,
      reason: rule.reason,
      severity: rule.severity,
      effect: matched ? deepClone(rule.effect) : null,
      provenance: deepClone(rule.provenance)
    };
  });
  return deepFreeze({
    deterministic: true,
    valid: conflicts.length === 0,
    conflicts,
    evaluations,
    matched: evaluations.filter((evaluation) => evaluation.matched)
  });
}

function validateVerticalPack(pack = {}) {
  if (!plainRecord(pack)) throw new CommercialPlatformError("invalid_vertical_pack", "Vertical pack must be a record.");
  const id = safeId(pack.id, "verticalPack.id");
  if (text(pack.version) !== VERTICAL_PACK_VERSION) {
    throw new CommercialPlatformError("unsupported_vertical_pack_version", `Vertical pack ${id} uses an unsupported version.`);
  }
  if (!plainRecord(pack.terminology) || !plainRecord(pack.starterData)) {
    throw new CommercialPlatformError("invalid_vertical_pack", `Vertical pack ${id} needs terminology and starterData records.`);
  }
  return deepFreeze({
    id,
    version: VERTICAL_PACK_VERSION,
    terminology: deepClone(pack.terminology),
    starterData: deepClone(pack.starterData),
    offerRefs: uniqueIds(pack.offerRefs, `vertical pack ${id} offerRefs`, 500),
    templateRefs: uniqueIds(pack.templateRefs, `vertical pack ${id} templateRefs`, 500),
    ruleRefs: uniqueIds(pack.ruleRefs, `vertical pack ${id} ruleRefs`, 500),
    pricingPolicyRefs: uniqueIds(pack.pricingPolicyRefs, `vertical pack ${id} pricingPolicyRefs`, 100),
    resourcePolicyRefs: uniqueIds(pack.resourcePolicyRefs, `vertical pack ${id} resourcePolicyRefs`, 100)
  });
}

function validateCommercialPublication(catalog = {}) {
  const packages = Array.isArray(catalog.packages) ? catalog.packages : [];
  const settings = plainRecord(catalog.settings) ? catalog.settings : {};
  const offers = packages.map((pkg) => validateConfigurableOffer(pkg, catalog));
  const templates = (Array.isArray(settings.eventTemplates) ? settings.eventTemplates : [])
    .map(adaptEventTemplateToCommercialTemplate);
  const packageIds = new Set(packages.map((pkg) => text(pkg?.id)));
  templates.forEach((template) => {
    if (!packageIds.has(template.offerRef)) {
      throw new CommercialPlatformError("unavailable_offer_reference", `Template ${template.id} references unavailable offer ${template.offerRef}.`);
    }
  });
  const rules = (Array.isArray(settings.configurationRules) ? settings.configurationRules : [])
    .map((rule) => validateConfigurationRule(rule, catalog));
  const conflicts = detectRuleConflicts(rules.filter((rule) => rule.enabled));
  if (conflicts.length) {
    throw new CommercialPlatformError("conflicting_mandatory_rules", "Configuration publication contains conflicting mandatory rules.", { conflicts });
  }
  return deepFreeze({ valid: true, offers, templates, rules, conflicts: [] });
}

const CATERING_VERTICAL_PACK = validateVerticalPack({
  id: "catering",
  version: VERTICAL_PACK_VERSION,
  terminology: {
    demandQuantity: "Guests",
    configurableOffer: "Package",
    commercialTemplate: "Event Template",
    component: "Menu item",
    fulfillmentLocation: "Venue",
    resourceRequirement: "Staffing",
    fulfillmentArtifact: "BEO",
    executionPlan: "Run of Show"
  },
  starterData: { source: "starter_catalog_pack" },
  offerRefs: [],
  templateRefs: [],
  ruleRefs: [],
  pricingPolicyRefs: ["catering-pricing-v2"],
  resourcePolicyRefs: ["catering-staffing"]
});

module.exports = {
  CATERING_VERTICAL_PACK,
  COMMERCIAL_PLATFORM_SCHEMA_VERSION,
  COMMERCIAL_TEMPLATE_VERSION,
  CONFIGURABLE_OFFER_VERSION,
  CONFIGURATION_RULE_VERSION,
  VERTICAL_PACK_VERSION,
  CommercialPlatformError,
  adaptEventTemplateToCommercialTemplate,
  adaptPackageToConfigurableOffer,
  applyCommercialTemplate,
  composeCommercialTemplate,
  detectRuleConflicts,
  evaluateConfigurationRules,
  evaluateOfferConfiguration,
  validateCommercialPublication,
  validateConfigurableOffer,
  validateConfigurationRule,
  validateVerticalPack
};
