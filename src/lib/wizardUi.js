const EMAIL_REGEX = /^\S+@\S+\.\S+$/;

export const MIN_EVENT_HOURS = 1;
export const MAX_EVENT_HOURS = 12;

const TEMPLATE_SELECTION_FIELDS = Object.freeze({
  addons: "addonQuantities",
  rentals: "rentalQuantities",
  menuItems: "menuItemQuantities"
});

export const WIZARD_STEP_DEFINITIONS = [
  { label: "Event Basics", microcopy: "Choose your event basics" },
  { label: "Menu Selection", microcopy: "Build your menu" },
  { label: "Add-ons / Rentals", microcopy: "Refine services and rentals" },
  { label: "Pricing Summary", microcopy: "Review pricing details" },
  { label: "Save Quote", microcopy: "Review and save a draft" }
];

export const STEP1_REQUIRED_FIELDS = [
  { key: "eventTypeId", label: "event type" },
  { key: "date", label: "event date" },
  { key: "guests", label: "guest count" },
  { key: "eventName", label: "event name" },
  { key: "venue", label: "venue" },
  { key: "name", label: "client name" },
  { key: "email", label: "valid client email" }
];

function normalizeText(value) {
  return String(value || "").trim();
}

function isEmptyValue(value) {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "number") return Number(value) === 0;
  return normalizeText(value).length === 0;
}

function equalArrayValues(a = [], b = []) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function cloneTemplateValue(value) {
  if (Array.isArray(value)) return [...value];
  if (value && typeof value === "object") return { ...value };
  return value;
}

function equalTemplateValues(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    return equalArrayValues(Array.isArray(a) ? a : [], Array.isArray(b) ? b : []);
  }
  if ((a && typeof a === "object") || (b && typeof b === "object")) {
    const left = a && typeof a === "object" ? a : {};
    const right = b && typeof b === "object" ? b : {};
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    return [...keys].every((key) => left[key] === right[key]);
  }
  return a === b;
}

function normalizedSelectionIds(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function templateQuantityValue(value, itemId) {
  if (!value || typeof value !== "object") return undefined;
  return Object.prototype.hasOwnProperty.call(value, itemId) ? value[itemId] : undefined;
}

export function resolveFirstValidPackageId(packages = [], currentPackageId = "") {
  const validPackages = (Array.isArray(packages) ? packages : []).filter((item) => (
    item?.active !== false
    && String(item?.id || "").trim()
    && String(item?.name || "").trim()
    && Number.isFinite(Number(item?.ppp))
    && Number(item.ppp) > 0
  ));
  const currentId = String(currentPackageId || "").trim();
  if (currentId && validPackages.some((item) => String(item.id).trim() === currentId)) {
    return currentId;
  }
  return String(validPackages[0]?.id || "").trim();
}

export function normalizeEventHours(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return MIN_EVENT_HOURS;
  return Math.min(MAX_EVENT_HOURS, Math.max(MIN_EVENT_HOURS, parsed));
}

export function createTemplateDefaultsOwnership({
  beforeForm = {},
  afterForm = {},
  appliedFields = []
} = {}) {
  const fields = {};
  const selections = {};
  const uniqueFields = [...new Set((Array.isArray(appliedFields) ? appliedFields : []).filter(Boolean))];

  uniqueFields.forEach((field) => {
    const quantityField = TEMPLATE_SELECTION_FIELDS[field];
    if (quantityField) {
      const before = normalizedSelectionIds(beforeForm[field]);
      const applied = normalizedSelectionIds(afterForm[field]);
      const beforeQuantities = { ...(beforeForm[quantityField] || {}) };
      const appliedQuantities = { ...(afterForm[quantityField] || {}) };
      const candidateIds = new Set([...before, ...applied]);
      const changedIds = [...candidateIds].filter((itemId) => (
        before.includes(itemId) !== applied.includes(itemId)
        || templateQuantityValue(beforeQuantities, itemId) !== templateQuantityValue(appliedQuantities, itemId)
      ));
      if (changedIds.length) {
        selections[field] = {
          quantityField,
          before,
          applied,
          beforeQuantities,
          appliedQuantities,
          changedIds,
          releasedIds: [],
          releasedAll: false
        };
      }
      return;
    }

    if (Object.values(TEMPLATE_SELECTION_FIELDS).includes(field)) return;
    if (equalTemplateValues(beforeForm[field], afterForm[field])) return;
    fields[field] = {
      before: cloneTemplateValue(beforeForm[field]),
      applied: cloneTemplateValue(afterForm[field])
    };
  });

  return { fields, selections };
}

export function hasTemplateDefaultsOwnership(ownership = {}) {
  return Boolean(
    Object.keys(ownership?.fields || {}).length
    || Object.keys(ownership?.selections || {}).length
  );
}

export function releaseTemplateDefaultsOwnership(ownership = {}, field = "", itemId = "") {
  if (!hasTemplateDefaultsOwnership(ownership)) return ownership;
  const normalizedField = String(field || "").trim();
  const normalizedItemId = String(itemId || "").trim();
  const selectionField = TEMPLATE_SELECTION_FIELDS[normalizedField]
    ? normalizedField
    : Object.entries(TEMPLATE_SELECTION_FIELDS).find(([, quantityField]) => quantityField === normalizedField)?.[0];
  const next = {
    fields: { ...(ownership.fields || {}) },
    selections: { ...(ownership.selections || {}) }
  };

  if (selectionField && next.selections[selectionField]) {
    const current = next.selections[selectionField];
    next.selections[selectionField] = normalizedItemId
      ? {
          ...current,
          releasedIds: [...new Set([...(current.releasedIds || []), normalizedItemId])]
        }
      : { ...current, releasedAll: true };
    return next;
  }

  delete next.fields[normalizedField];
  return next;
}

export function restoreTemplateOwnedDefaults({ form = {}, ownership = {} } = {}) {
  const next = { ...form };

  Object.entries(ownership?.fields || {}).forEach(([field, record]) => {
    if (!equalTemplateValues(next[field], record?.applied)) return;
    next[field] = cloneTemplateValue(record?.before);
  });

  Object.entries(ownership?.selections || {}).forEach(([field, record]) => {
    if (record?.releasedAll) return;
    const releasedIds = new Set(record?.releasedIds || []);
    const beforeIds = new Set(normalizedSelectionIds(record?.before));
    const appliedIds = new Set(normalizedSelectionIds(record?.applied));
    const currentIds = normalizedSelectionIds(next[field]);
    const currentSet = new Set(currentIds);
    const quantityField = String(record?.quantityField || TEMPLATE_SELECTION_FIELDS[field] || "");
    const currentQuantities = { ...(next[quantityField] || {}) };

    (record?.changedIds || []).forEach((itemId) => {
      if (releasedIds.has(itemId)) return;
      const beforeHas = beforeIds.has(itemId);
      const appliedHas = appliedIds.has(itemId);
      const currentHas = currentSet.has(itemId);
      const beforeQuantity = templateQuantityValue(record?.beforeQuantities, itemId);
      const appliedQuantity = templateQuantityValue(record?.appliedQuantities, itemId);
      const currentQuantity = templateQuantityValue(currentQuantities, itemId);
      const membershipStillApplied = currentHas === appliedHas;
      const quantityStillApplied = currentQuantity === appliedQuantity;

      if (!membershipStillApplied || !quantityStillApplied) return;
      if (beforeHas) currentSet.add(itemId);
      else currentSet.delete(itemId);
      if (beforeQuantity === undefined) delete currentQuantities[itemId];
      else currentQuantities[itemId] = beforeQuantity;
    });

    const restoredIds = currentIds.filter((itemId) => currentSet.has(itemId));
    normalizedSelectionIds(record?.before).forEach((itemId) => {
      if (currentSet.has(itemId) && !restoredIds.includes(itemId)) restoredIds.push(itemId);
    });
    next[field] = restoredIds;
    if (quantityField) next[quantityField] = currentQuantities;
  });

  return next;
}

export function isValidEmail(email) {
  const text = normalizeText(email);
  return EMAIL_REGEX.test(text);
}

export function validateStep1(form = {}) {
  const guests = Number(form.guests || 0);
  const email = normalizeText(form.email);
  const fieldErrors = {};

  if (!normalizeText(form.eventTypeId)) fieldErrors.eventTypeId = "Choose an event type.";
  if (!normalizeText(form.date)) fieldErrors.date = "Select the event date.";
  if (!Number.isFinite(guests) || guests <= 0) fieldErrors.guests = "Enter guest count greater than 0.";
  if (!normalizeText(form.eventName)) fieldErrors.eventName = "Enter the event name.";
  if (!normalizeText(form.venue)) fieldErrors.venue = "Enter the event venue.";
  if (!normalizeText(form.name)) fieldErrors.name = "Enter the client name.";
  if (!email) {
    fieldErrors.email = "Enter client email.";
  } else if (!isValidEmail(email)) {
    fieldErrors.email = "Enter a valid email address.";
  }

  const missingFields = STEP1_REQUIRED_FIELDS.filter((field) => fieldErrors[field.key]);

  return {
    valid: missingFields.length === 0,
    missingFields,
    fieldErrors
  };
}

export function buildStepValidation(form = {}) {
  return {
    step1: validateStep1(form)
  };
}

export function buildStepStatus({ currentStep = 1, stepValidation = {} } = {}) {
  const normalizedStep = Math.min(Math.max(1, Number(currentStep || 1)), WIZARD_STEP_DEFINITIONS.length);
  const step1Valid = stepValidation?.step1?.valid === true;

  return WIZARD_STEP_DEFINITIONS.map((_, index) => {
    const stepNumber = index + 1;

    if (stepNumber === normalizedStep) {
      return "current";
    }

    if (stepNumber === 1) {
      return step1Valid ? "completed" : "incomplete";
    }

    if (!step1Valid && normalizedStep === 1 && stepNumber > 1) {
      return "locked";
    }

    if (stepNumber < normalizedStep) {
      return "completed";
    }

    return "incomplete";
  });
}

export function buildStepperModel({ currentStep = 1, stepStatus = [] } = {}) {
  return WIZARD_STEP_DEFINITIONS.map((item, index) => {
    const stepNumber = index + 1;
    const status = stepStatus[index] || (stepNumber === currentStep ? "current" : "incomplete");
    return {
      ...item,
      stepNumber,
      status,
      isLocked: status === "locked"
    };
  });
}

export function findTemplateForEventType({ eventTypeId = "", templates = [], eventTypes = [] } = {}) {
  const normalizedEventTypeId = normalizeText(eventTypeId);
  if (!normalizedEventTypeId) return null;

  const templateList = Array.isArray(templates) ? templates : [];
  const byId = templateList.find((template) => normalizeText(template?.id) === normalizedEventTypeId);
  if (byId) return byId;

  const eventTypeLabel = normalizeText(
    (Array.isArray(eventTypes) ? eventTypes : []).find((eventType) => normalizeText(eventType?.id) === normalizedEventTypeId)?.name
  );
  if (!eventTypeLabel) return null;

  const normalizedLabel = eventTypeLabel.toLowerCase();
  return templateList.find((template) => normalizeText(template?.name).toLowerCase() === normalizedLabel) || null;
}

function pickTemplateSelections(template, catalog = {}) {
  const addonIds = new Set((Array.isArray(catalog.addons) ? catalog.addons : [])
    .filter((item) => item?.active !== false)
    .map((item) => String(item.id)));
  const rentalIds = new Set((Array.isArray(catalog.rentals) ? catalog.rentals : [])
    .filter((item) => item?.active !== false)
    .map((item) => String(item.id)));
  const packageIds = new Set((Array.isArray(catalog.packages) ? catalog.packages : [])
    .filter((item) => item?.active !== false)
    .map((item) => String(item.id)));

  const templateAddons = (Array.isArray(template?.addons) ? template.addons : []).filter((id) => addonIds.has(String(id)));
  const templateRentals = (Array.isArray(template?.rentals) ? template.rentals : []).filter((id) => rentalIds.has(String(id)));
  const templateMenuItems = Array.isArray(template?.menuItems) ? template.menuItems.map((id) => String(id)) : [];

  return {
    templateAddons,
    templateRentals,
    templateMenuItems,
    templatePackageId: packageIds.has(String(template?.pkg || "")) ? String(template.pkg) : ""
  };
}

function isEligibleForDefault({ field, value, initialForm = {}, touchedFields = {} }) {
  if (touchedFields?.[field]) return false;
  const initialValue = initialForm[field];

  if (Array.isArray(value)) {
    if (value.length === 0) return true;
    return equalArrayValues(value, Array.isArray(initialValue) ? initialValue : []);
  }

  if (typeof value === "number") {
    if (Number(value) === 0) return true;
    return Number(value) === Number(initialValue || 0);
  }

  if (isEmptyValue(value)) return true;
  return normalizeText(value) === normalizeText(initialValue);
}

export function applyEventTypeTemplateDefaults({
  form = {},
  template,
  catalog = {},
  touchedFields = {},
  initialForm = {}
} = {}) {
  if (!template || typeof template !== "object") {
    return {
      nextForm: { ...form },
      appliedFields: []
    };
  }

  const {
    templateAddons,
    templateRentals,
    templateMenuItems,
    templatePackageId
  } = pickTemplateSelections(template, catalog);
  const nextForm = { ...form };
  const appliedFields = [];

  const maybeApply = (field, value) => {
    if (value === undefined || value === null || value === "") return;
    if (!isEligibleForDefault({ field, value: nextForm[field], initialForm, touchedFields })) return;
    nextForm[field] = value;
    appliedFields.push(field);
  };

  maybeApply("hours", normalizeEventHours(template.hours));
  maybeApply("style", String(template.style || ""));
  maybeApply("pkg", templatePackageId);
  maybeApply("taxRegion", String(template.taxRegion || ""));
  maybeApply("seasonProfileId", String(template.seasonProfileId || ""));
  maybeApply("milesRT", Number(template.milesRT || 0));
  maybeApply("payMethod", String(template.payMethod || ""));
  maybeApply("servers", Number(template.servers || 0));
  maybeApply("chefs", Number(template.chefs || 0));
  maybeApply("bartenders", Number(template.bartenders || 0));
  maybeApply("serverRateMixCsv", String(template.serverRateMixCsv || ""));
  maybeApply("chefRateMixCsv", String(template.chefRateMixCsv || ""));

  if (templateAddons.length && isEligibleForDefault({ field: "addons", value: nextForm.addons, initialForm, touchedFields })) {
    nextForm.addons = [...templateAddons];
    nextForm.addonQuantities = templateAddons.reduce((acc, id) => {
      acc[id] = Math.max(1, Number(nextForm.addonQuantities?.[id] || 1));
      return acc;
    }, {});
    appliedFields.push("addons");
  }

  if (templateRentals.length && isEligibleForDefault({ field: "rentals", value: nextForm.rentals, initialForm, touchedFields })) {
    nextForm.rentals = [...templateRentals];
    nextForm.rentalQuantities = templateRentals.reduce((acc, id) => {
      acc[id] = Math.max(1, Number(nextForm.rentalQuantities?.[id] || 1));
      return acc;
    }, {});
    appliedFields.push("rentals");
  }

  if (templateMenuItems.length && isEligibleForDefault({ field: "menuItems", value: nextForm.menuItems, initialForm, touchedFields })) {
    nextForm.menuItems = [...templateMenuItems];
    nextForm.menuItemQuantities = templateMenuItems.reduce((acc, id) => {
      acc[id] = Math.max(1, Number(nextForm.menuItemQuantities?.[id] || 1));
      return acc;
    }, {});
    appliedFields.push("menuItems");
  }

  return {
    nextForm,
    appliedFields
  };
}

export function detectBreakdownValueChanges(previousValues = {}, nextValues = {}, epsilon = 0.009) {
  const keys = new Set([...Object.keys(previousValues || {}), ...Object.keys(nextValues || {})]);
  const changes = {};

  keys.forEach((key) => {
    const previous = Number(previousValues?.[key] || 0);
    const next = Number(nextValues?.[key] || 0);
    const delta = next - previous;
    if (Math.abs(delta) > epsilon) {
      changes[key] = delta;
    }
  });

  return changes;
}
