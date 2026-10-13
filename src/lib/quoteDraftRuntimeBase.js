import {
  normalizeEventHours,
  resolveFirstValidPackageId
} from "./wizardUi";
import { buildCommercialAmendmentContext } from "./commercialAmendmentContext";

function text(value) {
  return String(value ?? "").trim();
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === "") return "";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : "";
}

function record(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function immutableQuoteDraftValue(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(immutableQuoteDraftValue);
  return Object.freeze(value);
}

function copyTextFields(target, source, fields) {
  fields.forEach((field) => {
    target[field] = text(source[field]);
  });
}

function appliedRate(selection, snapshot, totals, role) {
  const override = selection[`${role}RateOverride`];
  return optionalNumber(
    override !== "" && override !== null && override !== undefined
      ? override
      : snapshot[`${role}RateApplied`] ?? totals?.[`${role}RateApplied`]
  );
}

export function resolveQuoteDraftRevisionId(quote = {}) {
  return text(
    quote.activeVersionId
    || quote.versionMeta?.versionId
    || quote.updatedAtISO
  );
}

export function hydrateSavedQuoteDraftBase({
  quote = {},
  previousForm = {},
  catalogPackages = [],
  organizationId = "",
  normalizedPatch = null,
  normalizedDraftIntent = null
} = {}) {
  if (!text(quote?.id)) {
    return immutableQuoteDraftValue({
      ok: false,
      code: "quote_id_missing",
      reason: "The selected quote has no stable identifier.",
      consequence: "No editor route opened and the current work remains unchanged.",
      nextResolution: "Return to Opportunities and select a valid saved quote."
    });
  }
  const commercialAmendment = buildCommercialAmendmentContext(quote);
  if (!commercialAmendment.editable) {
    return immutableQuoteDraftValue({
      ok: false,
      code: "quote_lifecycle_not_editable",
      reason: `${commercialAmendment.protocol.label}. ${commercialAmendment.protocol.explanation}`,
      consequence: "No editable draft was opened, and the saved commitment and its historical evidence remain unchanged.",
      nextResolution: commercialAmendment.protocol.nextAction
    });
  }
  const patch = normalizedPatch || { values: {}, fields: [], source: "" };
  const draftIntent = normalizedDraftIntent || {
    family: "",
    focusField: "",
    fields: [],
    kind: "",
    label: "",
    draftChange: null
  };
  if (patch.ok === false) return patch;
  if (draftIntent.ok === false) return draftIntent;

  const selection = record(quote.selection) ? quote.selection : {};
  const event = record(quote.event) ? quote.event : {};
  const customer = record(quote.customer) ? quote.customer : {};
  const menuItemDetails = Array.isArray(selection.menuItemDetails)
    ? selection.menuItemDetails
    : [];
  const menuItemQuantitiesFromDetails = {};
  const menuItemsFromDetails = [];
  menuItemDetails.forEach((item) => {
    const id = text(item?.id);
    if (!id) return;
    menuItemsFromDetails.push(id);
    menuItemQuantitiesFromDetails[id] = Math.max(1, number(item?.quantity, 1));
  });
  const selectedMenuItems = Array.isArray(selection.menuItems) ? selection.menuItems : [];
  const menuItems = selectedMenuItems.length ? selectedMenuItems : menuItemsFromDetails;
  const eventTypeId = text(quote.eventTypeId || selection.eventTypeId || event.eventTypeId);
  const laborRateSnapshot = record(selection.laborRateSnapshot)
    ? selection.laborRateSnapshot
    : {};
  const form = {
    ...previousForm,
    hours: normalizeEventHours(event.hours),
    eventName: text(event.name),
    clientOrg: text(customer.organization),
    style: text(event.style) || previousForm.style,
    pkg: resolveFirstValidPackageId(
      Array.isArray(catalogPackages) ? catalogPackages : [],
      selection.packageId || previousForm.pkg
    ),
    menuItems: [...menuItems],
    menuItemQuantities: {
      ...menuItemQuantitiesFromDetails,
      ...(record(selection.menuItemQuantities) ? selection.menuItemQuantities : {})
    },
    eventTypeId,
    bartenderRateTypeId: text(
      selection.bartenderRateTypeId || laborRateSnapshot.bartenderRateTypeId
    ),
    staffingRateTypeId: text(
      selection.staffingRateTypeId || laborRateSnapshot.staffingRateTypeId
    ),
    serverRateMixCsv: text(selection.serverRateMixCsv),
    chefRateMixCsv: text(selection.chefRateMixCsv),
    eventTemplateId: text(selection.eventTemplateId) || "custom",
    taxRegion: text(selection.taxRegion) || previousForm.taxRegion,
    seasonProfileId: text(selection.seasonProfileId || previousForm.seasonProfileId) || "auto",
    milesRT: number(selection.milesRT, 0),
    includeDisposables: quote.quoteMeta?.includeDisposables !== false,
    payMethod: text(selection.payMethod) || previousForm.payMethod
  };

  copyTextFields(form, event, [
    "date",
    "time",
    "venue",
    "venueAddress",
    "dietaryRestrictions"
  ]);
  copyTextFields(form, customer, ["name", "phone", "email"]);
  ["bartenders", "guests", "servers", "chefs"].forEach((field) => {
    form[field] = patch.values[field] ?? number(event[field], 0);
  });
  ["addon", "rental"].forEach((kind) => {
    const plural = `${kind}s`;
    const quantities = `${kind}Quantities`;
    form[plural] = Array.isArray(selection[plural]) ? [...selection[plural]] : [];
    form[quantities] = { ...(record(selection[quantities]) ? selection[quantities] : {}) };
  });
  ["bartender", "server", "chef"].forEach((role) => {
    form[`${role}RateOverride`] = appliedRate(
      selection,
      laborRateSnapshot,
      quote.totals,
      role
    );
  });

  return immutableQuoteDraftValue({
    ok: true,
    form,
    eventTypeId,
    stagedFields: patch.fields,
    patchSource: patch.source,
    ambientDraftIntent: draftIntent.kind ? {
      family: draftIntent.family || "event_logistics",
      kind: draftIntent.kind,
      label: draftIntent.label,
      focusField: draftIntent.focusField,
      fields: [...draftIntent.fields],
      draftChange: draftIntent.draftChange || null
    } : null,
    sourceRevisionId: resolveQuoteDraftRevisionId(quote),
    editingQuote: {
      id: text(quote.id),
      quoteNumber: text(quote.quoteNumber || quote.id),
      activeVersionId: text(quote.activeVersionId || quote.versionMeta?.versionId),
      customerId: text(quote.customerId),
      organizationId: text(quote.organizationId || organizationId),
      pricingCatalogAuthority: record(quote.pricingCatalogAuthority)
        ? { ...quote.pricingCatalogAuthority }
        : null,
      catalogRevisionReview: record(quote.catalogRevisionReview)
        ? { ...quote.catalogRevisionReview }
        : null,
      selection: record(quote.selection) ? { ...quote.selection } : {},
      baseForm: { ...form },
      rebooking: record(quote.rebooking) ? { ...quote.rebooking } : null,
      portalDecision: record(quote.portalDecision) ? { ...quote.portalDecision } : null,
      commercialAmendment
    }
  });
}
