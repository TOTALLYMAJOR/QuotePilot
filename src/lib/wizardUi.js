const EMAIL_REGEX = /^\S+@\S+\.\S+$/;

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
  const addonIds = new Set((Array.isArray(catalog.addons) ? catalog.addons : []).map((item) => String(item.id)));
  const rentalIds = new Set((Array.isArray(catalog.rentals) ? catalog.rentals : []).map((item) => String(item.id)));

  const templateAddons = (Array.isArray(template?.addons) ? template.addons : []).filter((id) => addonIds.has(String(id)));
  const templateRentals = (Array.isArray(template?.rentals) ? template.rentals : []).filter((id) => rentalIds.has(String(id)));
  const templateMenuItems = Array.isArray(template?.menuItems) ? template.menuItems.map((id) => String(id)) : [];

  return {
    templateAddons,
    templateRentals,
    templateMenuItems
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

  const { templateAddons, templateRentals, templateMenuItems } = pickTemplateSelections(template, catalog);
  const nextForm = { ...form };
  const appliedFields = [];

  const maybeApply = (field, value) => {
    if (value === undefined || value === null || value === "") return;
    if (!isEligibleForDefault({ field, value: nextForm[field], initialForm, touchedFields })) return;
    nextForm[field] = value;
    appliedFields.push(field);
  };

  maybeApply("hours", Number(template.hours || 0));
  maybeApply("style", String(template.style || ""));
  maybeApply("pkg", String(template.pkg || ""));
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
