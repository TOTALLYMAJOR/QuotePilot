"use strict";

const { createHash } = require("node:crypto");

const QUOTE_VERSION_ID = "v0001";
const QUOTE_VALIDITY_DAYS_DEFAULT = 30;
const QUOTE_VALIDITY_DAYS_MAX = 365;
const PORTAL_VALIDITY_DAYS_MAX = 30;
const MAX_SELECTION_ITEMS = 100;
const MAX_CREW_MEMBERS = 20;
const PRICING_AUTHORITY = "server_authoritative";
const CRM_PROVIDERS = new Set(["webhook", "webhook_bridge", "hubspot", "salesforce"]);
const APPROVED_STRIPE_PAYMENT_HOSTS = new Set([
  "checkout.stripe.com",
  "buy.stripe.com"
]);

class QuoteCreationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "QuoteCreationError";
    this.code = code;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value, maxLength = 240) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).trim().slice(0, maxLength);
}

function sanitizeStoredStripePaymentLink(value) {
  const candidate = text(value, 2_000);
  if (!candidate) return "";

  try {
    const parsed = new URL(candidate);
    if (
      parsed.protocol !== "https:"
      || parsed.username
      || parsed.password
      || !APPROVED_STRIPE_PAYMENT_HOSTS.has(parsed.hostname.toLowerCase())
    ) {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

function email(value) {
  return text(value, 254).toLowerCase();
}

function customerProjectionDocumentId(value) {
  const normalizedEmail = email(value);
  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new QuoteCreationError(
      "invalid-argument",
      "A valid customer email is required for customer projection."
    );
  }
  return `email_${createHash("sha256").update(normalizedEmail).digest("hex")}`;
}

function buildCustomerProjection({
  organizationId,
  quoteId,
  quoteNumber,
  customer = {},
  event = {},
  nowISO,
  existingCustomer = null,
  existingCustomerId = ""
} = {}) {
  const orgId = sanitizeIdentifier(organizationId);
  const id = sanitizeIdentifier(quoteId);
  const number = text(quoteNumber, 80);
  const projectedAtISO = normalizeISO(nowISO, "");
  const customerEmail = email(customer?.email);
  const customerName = text(customer?.name, 160);
  const existing = isRecord(existingCustomer) ? existingCustomer : null;
  const deterministicId = customerProjectionDocumentId(customerEmail);
  const customerId = sanitizeIdentifier(existingCustomerId, 500) || deterministicId;

  if (!orgId || !id || !number || !projectedAtISO || !customerName) {
    throw new QuoteCreationError(
      "failed-precondition",
      "Trusted customer projection identity is incomplete."
    );
  }
  if (existing) {
    const existingOrgId = sanitizeIdentifier(existing.organizationId);
    const existingEmail = email(existing.email);
    if ((existingOrgId && existingOrgId !== orgId) || (existingEmail && existingEmail !== customerEmail)) {
      throw new QuoteCreationError(
        "failed-precondition",
        "Existing customer projection does not match this quote."
      );
    }
  }

  const optionalCustomerFields = {
    phone: text(customer?.phone, 40),
    company: text(customer?.organization ?? customer?.company, 160)
  };
  const patch = {
    customerId,
    organizationId: orgId,
    name: customerName,
    email: customerEmail,
    lastQuoteId: id,
    lastQuoteNumber: number,
    lastEventName: text(event?.name, 160),
    lastEventDate: text(event?.date, 10),
    lastProjectedAtISO: projectedAtISO,
    updatedAtISO: projectedAtISO,
    ...Object.fromEntries(
      Object.entries(optionalCustomerFields).filter(([, value]) => Boolean(value))
    )
  };
  if (!existing) {
    patch.recordSource = "trusted_quote_projection";
    patch.createdFromQuoteId = id;
    patch.createdAtISO = projectedAtISO;
  }

  return {
    customerId,
    isNew: !existing,
    patch
  };
}

function numberInRange(value, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function integerInRange(value, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return Math.round(numberInRange(value, fallback, min, max));
}

function boundedBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function sanitizeIdentifier(value, maxLength = 128) {
  return text(value, maxLength);
}

function sanitizeIdentifierList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const entry of value) {
    const id = sanitizeIdentifier(entry);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    if (result.length >= MAX_SELECTION_ITEMS) break;
  }
  return result;
}

function sanitizeQuantityMap(value, allowedIds) {
  if (!isRecord(value)) return {};
  const allowed = new Set(allowedIds);
  const result = {};
  for (const id of allowedIds) {
    if (!Object.prototype.hasOwnProperty.call(value, id)) continue;
    result[id] = integerInRange(value[id], 1, 1, 100_000);
    if (Object.keys(result).length >= MAX_SELECTION_ITEMS) break;
  }
  return Object.fromEntries(
    Object.entries(result).filter(([id]) => allowed.has(id))
  );
}

function sanitizeOptionalRate(value) {
  if (value === "" || value === null || value === undefined) return "";
  return numberInRange(value, 0, 0, 100_000);
}

function sanitizeDate(value) {
  const candidate = text(value, 10);
  if (!candidate) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    throw new QuoteCreationError("invalid-argument", "Event date must use YYYY-MM-DD format.");
  }
  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== candidate
  ) {
    throw new QuoteCreationError("invalid-argument", "Event date is invalid.");
  }
  return candidate;
}

function sanitizeTime(value) {
  const candidate = text(value, 5);
  if (!candidate) return "";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(candidate)) {
    throw new QuoteCreationError("invalid-argument", "Event time must use 24-hour HH:MM format.");
  }
  return candidate;
}

function sanitizeQuoteCreationRequest(data = {}) {
  const root = isRecord(data) ? data : {};
  const rawForm = isRecord(root.form)
    ? root.form
    : isRecord(root.presentation)
      ? root.presentation
      : {};

  const customerName = text(rawForm.name, 160);
  const customerEmail = email(rawForm.email);
  if (!customerName) {
    throw new QuoteCreationError("invalid-argument", "Customer name is required.");
  }
  if (!customerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
    throw new QuoteCreationError("invalid-argument", "A valid customer email is required.");
  }

  const packageId = sanitizeIdentifier(rawForm.pkg);
  if (!packageId) {
    throw new QuoteCreationError("invalid-argument", "A package selection is required.");
  }

  const addons = sanitizeIdentifierList(rawForm.addons);
  const rentals = sanitizeIdentifierList(rawForm.rentals);
  const menuItems = sanitizeIdentifierList(rawForm.menuItems);
  if (menuItems.length === 0) {
    throw new QuoteCreationError(
      "invalid-argument",
      "Select at least one menu item before saving the quote."
    );
  }
  const payMethod = text(rawForm.payMethod, 16).toLowerCase();

  return {
    organizationId: sanitizeIdentifier(root.organizationId),
    form: {
      name: customerName,
      email: customerEmail,
      phone: text(rawForm.phone, 40),
      clientOrg: text(rawForm.clientOrg, 160),
      eventName: text(rawForm.eventName, 160),
      date: sanitizeDate(rawForm.date),
      time: sanitizeTime(rawForm.time),
      venue: text(rawForm.venue, 240),
      venueAddress: text(rawForm.venueAddress, 500),
      guests: integerInRange(rawForm.guests, 0, 0, 100_000),
      hours: numberInRange(rawForm.hours, 0, 0, 72),
      servers: integerInRange(rawForm.servers, 0, 0, 1_000),
      chefs: integerInRange(rawForm.chefs, 0, 0, 1_000),
      bartenders: integerInRange(rawForm.bartenders, 0, 0, 1_000),
      dietaryRestrictions: text(rawForm.dietaryRestrictions, 1_200),
      style: text(rawForm.style, 80),
      pkg: packageId,
      addons,
      rentals,
      menuItems,
      addonQuantities: sanitizeQuantityMap(rawForm.addonQuantities, addons),
      rentalQuantities: sanitizeQuantityMap(rawForm.rentalQuantities, rentals),
      menuItemQuantities: sanitizeQuantityMap(rawForm.menuItemQuantities, menuItems),
      eventTypeId: sanitizeIdentifier(rawForm.eventTypeId),
      bartenderRateTypeId: sanitizeIdentifier(rawForm.bartenderRateTypeId),
      staffingRateTypeId: sanitizeIdentifier(rawForm.staffingRateTypeId),
      bartenderRateOverride: sanitizeOptionalRate(rawForm.bartenderRateOverride),
      serverRateOverride: sanitizeOptionalRate(rawForm.serverRateOverride),
      chefRateOverride: sanitizeOptionalRate(rawForm.chefRateOverride),
      serverRateMixCsv: text(rawForm.serverRateMixCsv, 300),
      chefRateMixCsv: text(rawForm.chefRateMixCsv, 300),
      eventTemplateId: sanitizeIdentifier(rawForm.eventTemplateId) || "custom",
      taxRegion: sanitizeIdentifier(rawForm.taxRegion),
      seasonProfileId: sanitizeIdentifier(rawForm.seasonProfileId) || "auto",
      milesRT: numberInRange(rawForm.milesRT, 0, 0, 100_000),
      includeDisposables: boundedBoolean(rawForm.includeDisposables, true),
      payMethod: payMethod === "ach" ? "ach" : "card"
    }
  };
}

function buildDuplicateQuoteForm(sourceQuote = {}) {
  const source = isRecord(sourceQuote) ? sourceQuote : {};
  const customer = isRecord(source.customer) ? source.customer : {};
  const event = isRecord(source.event) ? source.event : {};
  const selection = isRecord(source.selection) ? source.selection : {};
  const quoteMeta = isRecord(source.quoteMeta) ? source.quoteMeta : {};
  const idsFromSnapshots = (value) => (
    Array.isArray(value)
      ? value.map((item) => item?.id)
      : []
  );

  return sanitizeQuoteCreationRequest({
    form: {
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      clientOrg: customer.organization,
      eventName: event.name,
      date: event.date,
      time: event.time,
      venue: event.venue,
      venueAddress: event.venueAddress,
      guests: event.guests,
      hours: event.hours,
      servers: event.servers,
      chefs: event.chefs,
      bartenders: event.bartenders,
      dietaryRestrictions: event.dietaryRestrictions,
      style: event.style,
      pkg: selection.packageId,
      addons: Array.isArray(selection.addons)
        ? selection.addons
        : idsFromSnapshots(selection.addonSnapshots),
      rentals: Array.isArray(selection.rentals)
        ? selection.rentals
        : idsFromSnapshots(selection.rentalSnapshots),
      menuItems: Array.isArray(selection.menuItems)
        ? selection.menuItems
        : idsFromSnapshots(selection.menuItemsSnapshot),
      addonQuantities: selection.addonQuantities,
      rentalQuantities: selection.rentalQuantities,
      menuItemQuantities: selection.menuItemQuantities,
      eventTypeId: source.eventTypeId || selection.eventTypeId || event.eventTypeId,
      bartenderRateTypeId: selection.bartenderRateTypeId,
      staffingRateTypeId: selection.staffingRateTypeId,
      bartenderRateOverride: selection.bartenderRateOverride,
      serverRateOverride: selection.serverRateOverride,
      chefRateOverride: selection.chefRateOverride,
      serverRateMixCsv: selection.serverRateMixCsv,
      chefRateMixCsv: selection.chefRateMixCsv,
      eventTemplateId: selection.eventTemplateId,
      taxRegion: selection.taxRegion,
      seasonProfileId: selection.seasonProfileId,
      milesRT: selection.milesRT,
      includeDisposables: quoteMeta.includeDisposables,
      payMethod: selection.payMethod
    }
  }).form;
}

function normalizeISO(value, fallback = "") {
  const candidate = text(value, 64);
  if (!candidate) return fallback;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function addDaysISO(baseISO, days) {
  const parsed = new Date(baseISO);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString();
}

function sumLineItems(lineItems, categories) {
  const accepted = new Set(categories);
  return (Array.isArray(lineItems) ? lineItems : []).reduce((sum, line) => {
    if (!accepted.has(text(line?.category, 40).toLowerCase())) return sum;
    return sum + numberInRange(line?.total, 0, -1_000_000_000, 1_000_000_000);
  }, 0);
}

function sanitizeSelectedItem(item = {}, fallbackMode = "per_event") {
  const id = sanitizeIdentifier(item?.id);
  const mode = text(item?.pricingMode, 32).toLowerCase();
  return {
    id,
    name: text(item?.name, 200) || id,
    price: numberInRange(item?.unitPrice, 0, 0, 1_000_000_000),
    pricingType: new Set(["per_person", "per_item", "per_event"]).has(mode)
      ? mode
      : fallbackMode,
    quantity: integerInRange(item?.quantity, 1, 1, 100_000),
    includedInPackage: item?.includedInPackage === true
  };
}

function sanitizePackageInclusions(packageSelection = {}, selectedItems = {}) {
  const source = isRecord(packageSelection?.inclusions) ? packageSelection.inclusions : {};
  const normalize = (value, fallbackMode, selected) => {
    const selectedIds = new Set(sanitizeSelectedItems(selected, fallbackMode).map((item) => item.id));
    return sanitizeSelectedItems(value, fallbackMode)
      .filter((item) => selectedIds.has(item.id))
      .map((item) => ({
        ...item,
        price: 0,
        includedInPackage: true
      }));
  };
  return {
    menuItems: normalize(source.menuItems, "per_event", selectedItems.menuItems),
    addons: normalize(source.addons, "per_person", selectedItems.addons),
    rentals: normalize(source.rentals, "per_item", selectedItems.rentals)
  };
}

function sanitizeSelectedItems(value, fallbackMode) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_SELECTION_ITEMS)
    .map((item) => sanitizeSelectedItem(item, fallbackMode))
    .filter((item) => item.id);
}

function sanitizeRateArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 1_000)
    .map((entry) => numberInRange(entry, 0, 0, 100_000));
}

function sanitizeCrew(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_CREW_MEMBERS)
    .map((member) => ({
      label: text(member?.label, 120),
      imageUrl: text(member?.imageUrl, 1_000)
    }))
    .filter((member) => member.label || member.imageUrl);
}

function sanitizeFeatureFlags(value) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 50)
      .map(([key, enabled]) => [sanitizeIdentifier(key, 80), enabled === true])
      .filter(([key]) => key)
  );
}

function buildTotals(pricing) {
  const lineItems = Array.isArray(pricing.lineItems) ? pricing.lineItems : [];
  const fees = isRecord(pricing.fees) ? pricing.fees : {};
  const tax = isRecord(pricing.tax) ? pricing.tax : {};
  const deposit = isRecord(pricing.deposit) ? pricing.deposit : {};
  const rules = isRecord(pricing.rulesSnapshot) ? pricing.rulesSnapshot : {};
  const laborRates = isRecord(rules.laborRateSnapshot) ? rules.laborRateSnapshot : {};

  return {
    base: sumLineItems(lineItems, ["package"]),
    addons: sumLineItems(lineItems, ["addon", "addons"]),
    rentals: sumLineItems(lineItems, ["rental", "rentals"]),
    menu: sumLineItems(lineItems, ["menu_item", "menu_items", "menu"]),
    labor: numberInRange(fees.labor, 0, 0, 1_000_000_000),
    serverLabor: numberInRange(fees.serverLabor ?? laborRates.serverLabor, 0, 0, 1_000_000_000),
    chefLabor: numberInRange(fees.chefLabor ?? laborRates.chefLabor, 0, 0, 1_000_000_000),
    bartenderLabor: numberInRange(fees.bartenderLabor, 0, 0, 1_000_000_000),
    bartenderRateApplied: numberInRange(laborRates.bartenderRateApplied, 0, 0, 100_000),
    serverRateApplied: numberInRange(laborRates.serverRateApplied, 0, 0, 100_000),
    serverRatesApplied: sanitizeRateArray(laborRates.serverRatesApplied),
    chefRateApplied: numberInRange(laborRates.chefRateApplied, 0, 0, 100_000),
    chefRatesApplied: sanitizeRateArray(laborRates.chefRatesApplied),
    bartenderRateTypeId: sanitizeIdentifier(laborRates.bartenderRateTypeId),
    bartenderRateTypeName: text(laborRates.bartenderRateTypeName, 160),
    staffingRateTypeId: sanitizeIdentifier(laborRates.staffingRateTypeId),
    staffingRateTypeName: text(laborRates.staffingRateTypeName, 160),
    travel: numberInRange(fees.travel, 0, 0, 1_000_000_000),
    serviceFee: numberInRange(fees.serviceFee, 0, 0, 1_000_000_000),
    tax: numberInRange(tax.amount, 0, 0, 1_000_000_000),
    total: numberInRange(pricing.grandTotal, 0, 0, 1_000_000_000),
    deposit: numberInRange(deposit.amount, 0, 0, 1_000_000_000),
    serviceFeePctApplied: numberInRange(rules.serviceFeePctApplied, 0, 0, 100),
    taxRateApplied: numberInRange(tax.rate, 0, 0, 100),
    taxRegionId: sanitizeIdentifier(tax.regionId),
    taxRegionName: text(tax.regionName, 160),
    seasonProfileId: sanitizeIdentifier(rules.seasonProfileId),
    seasonProfileName: text(rules.seasonProfileName, 160),
    packageMultiplier: numberInRange(rules.packageMultiplier, 1, 0, 100),
    addonMultiplier: numberInRange(rules.addonMultiplier, 1, 0, 100),
    rentalMultiplier: numberInRange(rules.rentalMultiplier, 1, 0, 100)
  };
}

function buildQuoteMeta(settings, form, pricing) {
  const rules = isRecord(pricing.rulesSnapshot) ? pricing.rulesSnapshot : {};
  const provider = text(settings.crmProvider, 40).toLowerCase();
  return {
    organizationName: text(settings.organizationName, 160),
    quotePreparedBy: text(settings.quotePreparedBy, 160),
    brandName: text(settings.brandName, 160),
    brandTagline: text(settings.brandTagline, 240),
    brandLogoUrl: text(settings.brandLogoUrl, 1_000),
    brandPrimaryColor: text(settings.brandPrimaryColor, 32),
    brandAccentColor: text(settings.brandAccentColor, 32),
    brandDarkAccentColor: text(settings.brandDarkAccentColor, 32),
    brandBackgroundStart: text(settings.brandBackgroundStart, 32),
    brandBackgroundMid: text(settings.brandBackgroundMid, 32),
    brandBackgroundEnd: text(settings.brandBackgroundEnd, 32),
    brandCrew: sanitizeCrew(settings.brandCrew),
    businessPhone: text(settings.businessPhone, 40),
    businessEmail: email(settings.businessEmail),
    businessAddress: text(settings.businessAddress, 500),
    acceptanceEmail: email(settings.acceptanceEmail),
    includeDisposables: form.includeDisposables !== false,
    disposablesNote: text(settings.disposablesNote, 800),
    depositNotice: text(settings.depositNotice, 800),
    quoteValidityDays: integerInRange(
      settings.quoteValidityDays,
      QUOTE_VALIDITY_DAYS_DEFAULT,
      1,
      QUOTE_VALIDITY_DAYS_MAX
    ),
    pricingSettingsVersion: integerInRange(rules.pricingSettingsVersion, 0, 0, 1_000_000_000),
    pricingSettingsUpdatedAtISO: normalizeISO(rules.pricingSettingsUpdatedAtISO, ""),
    crmEnabled: settings.crmEnabled === true,
    crmProvider: CRM_PROVIDERS.has(provider) ? provider : "webhook",
    crmAutoSyncOnSent: settings.crmAutoSyncOnSent === true,
    crmAutoSyncOnBooked: settings.crmAutoSyncOnBooked === true,
    featureFlags: sanitizeFeatureFlags(settings.featureFlags),
    integrationRetryLimit: integerInRange(settings.integrationRetryLimit, 3, 1, 10),
    integrationAuditRetention: integerInRange(settings.integrationAuditRetention, 50, 10, 200)
  };
}

function buildCanonicalPortalSnapshot(quoteId, quote) {
  const customer = isRecord(quote?.customer) ? quote.customer : {};
  const event = isRecord(quote?.event) ? quote.event : {};
  const totals = isRecord(quote?.totals) ? quote.totals : {};
  const selection = isRecord(quote?.selection) ? quote.selection : {};
  const quoteMeta = isRecord(quote?.quoteMeta) ? quote.quoteMeta : {};
  const payment = isRecord(quote?.payment) ? quote.payment : {};
  const finalBalance = isRecord(payment.finalBalance) ? payment.finalBalance : {};
  const finalBalanceAmountCents = Number(finalBalance.amountCents);
  const finalBalanceStatus = text(finalBalance.status, 32).toLowerCase();
  const booking = isRecord(quote?.booking) ? quote.booking : {};
  const portalDecision = isRecord(quote?.portalDecision) ? quote.portalDecision : {};
  const acceptanceReceipt = isRecord(quote?.acceptanceReceipt)
    ? {
        receiptId: text(quote.acceptanceReceipt.receiptId, 160),
        signerName: text(quote.acceptanceReceipt.signerName, 160),
        actor: {
          type: text(quote.acceptanceReceipt.actor?.type, 32),
          uid: sanitizeIdentifier(quote.acceptanceReceipt.actor?.uid, 128),
          email: email(quote.acceptanceReceipt.actor?.email)
        },
        consentVersion: text(quote.acceptanceReceipt.consentVersion, 80),
        consentText: text(quote.acceptanceReceipt.consentText, 500),
        acceptedAtISO: normalizeISO(quote.acceptanceReceipt.acceptedAtISO, ""),
        quoteRevisionId: text(quote.acceptanceReceipt.quoteRevisionId, 160),
        portalIssuedAtISO: normalizeISO(quote.acceptanceReceipt.portalIssuedAtISO, ""),
        quoteNumber: text(quote.acceptanceReceipt.quoteNumber, 80),
        currency: text(quote.acceptanceReceipt.currency, 8),
        totalMinor: integerInRange(quote.acceptanceReceipt.totalMinor, 0, 0, Number.MAX_SAFE_INTEGER),
        depositMinor: integerInRange(quote.acceptanceReceipt.depositMinor, 0, 0, Number.MAX_SAFE_INTEGER),
        snapshotSha256: text(quote.acceptanceReceipt.snapshotSha256, 64)
      }
    : null;
  const lifecycle = isRecord(quote?.lifecycle) ? quote.lifecycle : {};
  const quoteDelivery = isRecord(quote?.workflow?.quoteDelivery)
    ? quote.workflow.quoteDelivery
    : {};
  const addonSnapshots = Array.isArray(selection.addonSnapshots) ? selection.addonSnapshots : [];
  const rentalSnapshots = Array.isArray(selection.rentalSnapshots) ? selection.rentalSnapshots : [];
  const menuItemNames = Array.isArray(selection.menuItemNames) ? selection.menuItemNames : [];
  const packageInclusions = isRecord(selection.packageInclusions) ? selection.packageInclusions : {};
  const inclusionNames = (value) => (Array.isArray(value) ? value : [])
    .slice(0, MAX_SELECTION_ITEMS)
    .map((item) => text(item?.name || item, 200))
    .filter(Boolean);
  const createdAtISO = normalizeISO(quote?.createdAtISO, "");
  const updatedAtISO = normalizeISO(quote?.updatedAtISO, createdAtISO);
  const portalExpiresAtISO = normalizeISO(quote?.portalExpiresAtISO, "");
  const portalKey = sanitizeIdentifier(quote?.portalKey, 128);
  const portalIssuedAtISO = normalizeISO(quote?.portalIssuedAtISO, createdAtISO);
  const deliveryPortalKey = sanitizeIdentifier(quoteDelivery.portalKey, 128);
  const deliveryPortalIssuedAtISO = normalizeISO(quoteDelivery.portalIssuedAtISO, "");
  const deliveryEvidenceIsCurrent = (
    text(quoteDelivery.state, 32).toLowerCase() === "provider_accepted"
    && text(quoteDelivery.portalActivationState, 32).toLowerCase() === "active"
    && deliveryPortalKey === portalKey
    && deliveryPortalIssuedAtISO === portalIssuedAtISO
    && Boolean(text(quoteDelivery.revisionId, 160))
    && Boolean(normalizeISO(quoteDelivery.providerAcceptedAtISO, ""))
  );
  const deliveryEvidence = deliveryEvidenceIsCurrent
    ? {
        revisionId: text(quoteDelivery.revisionId, 160),
        state: "provider_accepted",
        portalActivationState: "active",
        portalKey,
        portalIssuedAtISO,
        providerAcceptedAtISO: normalizeISO(quoteDelivery.providerAcceptedAtISO, "")
      }
    : {
        revisionId: "",
        state: "",
        portalActivationState: "",
        portalKey: "",
        portalIssuedAtISO: "",
        providerAcceptedAtISO: ""
      };

  return {
    quoteId: sanitizeIdentifier(quoteId),
    organizationId: sanitizeIdentifier(quote?.organizationId),
    portalKey,
    portalIssuedAtISO,
    portalExpiresAtISO,
    portalExpiresAtMs: new Date(portalExpiresAtISO).getTime(),
    quoteNumber: text(quote?.quoteNumber, 80),
    customerName: text(customer.name, 160),
    customerEmail: email(customer.email),
    eventName: text(event.name, 160),
    eventDate: text(event.date, 10),
    eventTime: text(event.time, 5),
    eventHours: numberInRange(event.hours, 0, 0, 72),
    eventGuests: integerInRange(event.guests, 0, 0, 100_000),
    eventStyle: text(event.style, 80),
    venue: text(event.venue, 240),
    venueAddress: text(event.venueAddress, 500),
    dietaryRestrictions: text(event.dietaryRestrictions, 1_200),
    total: numberInRange(totals.total, 0, 0, 1_000_000_000),
    deposit: numberInRange(totals.deposit, 0, 0, 1_000_000_000),
    totals: {
      base: numberInRange(totals.base, 0, 0, 1_000_000_000),
      addons: numberInRange(totals.addons, 0, 0, 1_000_000_000),
      rentals: numberInRange(totals.rentals, 0, 0, 1_000_000_000),
      menu: numberInRange(totals.menu, 0, 0, 1_000_000_000),
      labor: numberInRange(totals.labor, 0, 0, 1_000_000_000),
      travel: numberInRange(totals.travel, 0, 0, 1_000_000_000),
      serviceFee: numberInRange(totals.serviceFee, 0, 0, 1_000_000_000),
      ...(Object.prototype.hasOwnProperty.call(totals, "serviceFeePctApplied")
        ? { serviceFeePctApplied: numberInRange(totals.serviceFeePctApplied, 0, 0, 100) }
        : {}),
      tax: numberInRange(totals.tax, 0, 0, 1_000_000_000),
      total: numberInRange(totals.total, 0, 0, 1_000_000_000),
      deposit: numberInRange(totals.deposit, 0, 0, 1_000_000_000)
    },
    selection: {
      packageName: text(selection.packageName, 200),
      packageInclusions: {
        menuItems: inclusionNames(packageInclusions.menuItems),
        addons: inclusionNames(packageInclusions.addons),
        rentals: inclusionNames(packageInclusions.rentals)
      },
      addons: addonSnapshots.slice(0, MAX_SELECTION_ITEMS).map((item) => text(item?.name, 200)).filter(Boolean),
      rentals: rentalSnapshots.slice(0, MAX_SELECTION_ITEMS).map((item) => text(item?.name, 200)).filter(Boolean),
      menuItems: menuItemNames.slice(0, MAX_SELECTION_ITEMS).map((item) => text(item, 200)).filter(Boolean)
    },
    quoteMeta: {
      organizationName: text(quoteMeta.organizationName, 160),
      brandName: text(quoteMeta.brandName, 160),
      brandLogoUrl: text(quoteMeta.brandLogoUrl, 1_000),
      brandPrimaryColor: text(quoteMeta.brandPrimaryColor, 32),
      brandAccentColor: text(quoteMeta.brandAccentColor, 32),
      brandDarkAccentColor: text(quoteMeta.brandDarkAccentColor, 32),
      brandBackgroundStart: text(quoteMeta.brandBackgroundStart, 32),
      brandBackgroundMid: text(quoteMeta.brandBackgroundMid, 32),
      brandBackgroundEnd: text(quoteMeta.brandBackgroundEnd, 32),
      businessPhone: text(quoteMeta.businessPhone, 40),
      businessEmail: email(quoteMeta.businessEmail)
    },
    status: text(quote?.status, 32).toLowerCase() || "draft",
    expiresAtISO: normalizeISO(quote?.expiresAtISO, portalExpiresAtISO),
    payment: {
      depositLink: sanitizeStoredStripePaymentLink(payment.depositLink),
      depositStatus: text(payment.depositStatus, 32).toLowerCase() || "unpaid",
      depositConfirmedAtISO: normalizeISO(payment.depositConfirmedAtISO, ""),
      ...(Number.isSafeInteger(finalBalanceAmountCents) && finalBalanceAmountCents > 0
        ? {
          finalBalance: {
            amountCents: finalBalanceAmountCents,
            currency: text(finalBalance.currency, 3).toLowerCase() || "usd",
            status: new Set(["unpaid", "sent", "paid"]).has(finalBalanceStatus)
              ? finalBalanceStatus
              : "unpaid",
            paymentLink: sanitizeStoredStripePaymentLink(finalBalance.paymentLink),
            confirmedAtISO: normalizeISO(finalBalance.confirmedAtISO, ""),
            stripeCheckoutState: text(finalBalance.stripeCheckoutState, 32).toLowerCase()
          }
        }
        : {})
    },
    booking: {
      bookedAtISO: normalizeISO(booking.bookedAtISO, ""),
      contractNumber: text(booking.contractNumber, 120),
      confirmationStatus: text(booking.confirmationStatus, 32).toLowerCase() || "pending",
      confirmationSentAtISO: normalizeISO(booking.confirmationSentAtISO, ""),
      confirmedAtISO: normalizeISO(booking.confirmedAtISO, "")
    },
    portalDecision: { ...portalDecision },
    acceptanceReceipt,
    lifecycle: { ...lifecycle },
    deliveryEvidence,
    createdAtISO,
    updatedAtISO
  };
}

function hasTerminalDecisionEvidence(quote = {}) {
  const source = isRecord(quote) ? quote : {};
  const status = text(source.status, 32).toLowerCase();
  const decision = text(source.portalDecision?.decision, 32).toLowerCase();
  const lifecycle = isRecord(source.lifecycle) ? source.lifecycle : {};
  const booking = isRecord(source.booking) ? source.booking : {};
  const payment = isRecord(source.payment) ? source.payment : {};
  return (
    ["accepted", "declined", "booked"].includes(status)
    || ["accepted", "declined"].includes(decision)
    || Boolean(normalizeISO(lifecycle.acceptedAtISO, ""))
    || Boolean(normalizeISO(lifecycle.declinedAtISO, ""))
    || Boolean(normalizeISO(lifecycle.bookedAtISO, ""))
    || Boolean(normalizeISO(booking.bookedAtISO, ""))
    || Boolean(text(booking.contractNumber, 120))
    || Boolean(normalizeISO(booking.contractConvertedAtISO, ""))
    || ["paid", "refunded"].includes(text(payment.depositStatus, 32).toLowerCase())
    || Boolean(normalizeISO(payment.depositConfirmedAtISO, ""))
  );
}

function buildQuoteReopenDocuments({
  quoteId,
  quote,
  activeSnapshot,
  newPortalKey,
  staff,
  nowISO
} = {}) {
  const id = sanitizeIdentifier(quoteId);
  const source = isRecord(quote) ? quote : {};
  const baseline = isRecord(activeSnapshot) ? activeSnapshot : {};
  const organizationId = sanitizeIdentifier(source.organizationId);
  const portalKey = sanitizeIdentifier(newPortalKey, 128);
  const previousPortalKey = sanitizeIdentifier(source.portalKey, 128);
  const actorUid = sanitizeIdentifier(staff?.uid);
  const actorEmail = email(staff?.email);
  const actorRole = text(staff?.role, 32).toLowerCase();
  const reopenedAtISO = normalizeISO(nowISO, "");
  const status = text(source.status, 32).toLowerCase();

  if (
    !id
    || !organizationId
    || !text(source.quoteNumber, 80)
    || portalKey.length < 20
    || !actorUid
    || !actorEmail
    || !reopenedAtISO
  ) {
    throw new QuoteCreationError(
      "failed-precondition",
      "Server quote reopen identity is incomplete."
    );
  }
  if (actorRole !== "admin") {
    throw new QuoteCreationError(
      "permission-denied",
      "Admin role required to reopen quotes."
    );
  }
  if (!["expired", "deleted"].includes(status)) {
    throw new QuoteCreationError(
      "failed-precondition",
      "Only expired or deleted quotes can be reopened."
    );
  }
  if (status === "deleted" && !normalizeISO(source.deletedAtISO, "")) {
    throw new QuoteCreationError(
      "failed-precondition",
      "Deleted quotes require a valid deletion audit timestamp before reopen."
    );
  }
  if (!isRecord(activeSnapshot)) {
    throw new QuoteCreationError(
      "failed-precondition",
      "Quote active version is required before reopen."
    );
  }
  if (
    (
      sanitizeIdentifier(baseline.organizationId)
      && sanitizeIdentifier(baseline.organizationId) !== organizationId
    )
    || (
      sanitizeIdentifier(baseline.id)
      && sanitizeIdentifier(baseline.id) !== id
    )
    || (
      text(baseline.quoteNumber, 80)
      && text(baseline.quoteNumber, 80) !== text(source.quoteNumber, 80)
    )
    || sanitizeIdentifier(baseline.ownerUid) !== sanitizeIdentifier(source.ownerUid)
    || email(baseline.ownerEmail) !== email(source.ownerEmail)
  ) {
    throw new QuoteCreationError(
      "failed-precondition",
      "Quote active version identity does not match the terminal quote."
    );
  }
  if (["deleted", "expired"].includes(text(baseline.status, 32).toLowerCase())) {
    throw new QuoteCreationError(
      "failed-precondition",
      "Quote active version must be a nonterminal commercial snapshot."
    );
  }
  if (hasTerminalDecisionEvidence(source) || hasTerminalDecisionEvidence(baseline)) {
    throw new QuoteCreationError(
      "failed-precondition",
      "Accepted, declined, booked, or paid quotes cannot be reopened. Duplicate the quote instead."
    );
  }

  const sourceQuoteMeta = isRecord(source.quoteMeta) ? source.quoteMeta : {};
  const validityDays = integerInRange(
    sourceQuoteMeta.quoteValidityDays,
    QUOTE_VALIDITY_DAYS_DEFAULT,
    1,
    QUOTE_VALIDITY_DAYS_MAX
  );
  const expiresAtISO = addDaysISO(reopenedAtISO, validityDays);
  const portalExpiresAtISO = addDaysISO(
    reopenedAtISO,
    Math.min(validityDays, PORTAL_VALIDITY_DAYS_MAX)
  );
  const nextVersionNumber = integerInRange(
    source.latestVersionNumber,
    0,
    0,
    999_999
  ) + 1;
  const versionId = `v${String(nextVersionNumber).padStart(4, "0")}`;
  const versionMeta = {
    versionId,
    versionNumber: nextVersionNumber,
    createdAt: reopenedAtISO,
    createdBy: {
      uid: actorUid,
      email: actorEmail,
      role: actorRole
    },
    reason: "reopen_quote_before_restore"
  };
  const baselineSelection = isRecord(baseline.selection) ? baseline.selection : {};
  const baselineEvent = isRecord(baseline.event) ? baseline.event : {};
  const baselineCustomer = isRecord(baseline.customer) ? baseline.customer : {};
  const restoredCustomer = Object.keys(baselineCustomer).length
    ? baselineCustomer
    : (isRecord(source.customer) ? source.customer : {});
  const restoredSelection = Object.keys(baselineSelection).length
    ? baselineSelection
    : (isRecord(source.selection) ? source.selection : {});
  const restoredEvent = Object.keys(baselineEvent).length
    ? baselineEvent
    : (isRecord(source.event) ? source.event : {});
  const restoredPayment = isRecord(source.payment) ? source.payment : {};
  const restoredBooking = isRecord(source.booking) ? source.booking : {};
  const restoredTotals = isRecord(baseline.totals)
    ? baseline.totals
    : (isRecord(source.totals) ? source.totals : {});
  const restoredPricing = isRecord(baseline.pricing)
    ? baseline.pricing
    : (isRecord(source.pricing) ? source.pricing : {});
  const restoredQuoteMeta = {
    ...sourceQuoteMeta,
    portalRotatedByEmail: actorEmail,
    reopenedByEmail: actorEmail
  };
  const lifecycle = {
    ...(isRecord(source.lifecycle) ? source.lifecycle : {}),
    reopenedAtISO
  };
  const customerEmailKey = email(
    baseline.customerEmailKey
    || restoredCustomer.email
    || source.customerEmailKey
  );
  const customerNameKey = text(
    baseline.customerNameKey
    || restoredCustomer.name
    || source.customerNameKey,
    160
  ).toLowerCase().replace(/\s+/g, " ");
  const eventTypeId = sanitizeIdentifier(
    baseline.eventTypeId
    || restoredSelection.eventTypeId
    || restoredEvent.eventTypeId
    || source.eventTypeId
  );
  const reopenedQuote = {
    ...source,
    customer: restoredCustomer,
    customerEmailKey,
    customerNameKey,
    eventTypeId,
    ownerUid: sanitizeIdentifier(source.ownerUid),
    ownerEmail: email(source.ownerEmail),
    event: restoredEvent,
    selection: restoredSelection,
    payment: restoredPayment,
    booking: restoredBooking,
    totals: restoredTotals,
    pricing: restoredPricing,
    quoteMeta: restoredQuoteMeta,
    source: text(baseline.source || source.source, 120),
    status: "draft",
    portalDecision: isRecord(source.portalDecision) ? source.portalDecision : {},
    portalKey,
    portalIssuedAtISO: reopenedAtISO,
    portalExpiresAtISO,
    expiresAtISO,
    deletedAtISO: "",
    updatedAtISO: reopenedAtISO,
    lifecycle,
    latestVersionNumber: nextVersionNumber,
    versionMeta
  };

  return {
    previousPortalKey,
    quotePatch: {
      customer: reopenedQuote.customer,
      customerEmailKey,
      customerNameKey,
      eventTypeId,
      ownerUid: reopenedQuote.ownerUid,
      ownerEmail: reopenedQuote.ownerEmail,
      event: reopenedQuote.event,
      selection: reopenedQuote.selection,
      payment: reopenedQuote.payment,
      booking: reopenedQuote.booking,
      totals: reopenedQuote.totals,
      pricing: reopenedQuote.pricing,
      quoteMeta: reopenedQuote.quoteMeta,
      source: reopenedQuote.source,
      status: "draft",
      portalDecision: reopenedQuote.portalDecision,
      portalKey,
      portalIssuedAtISO: reopenedAtISO,
      portalExpiresAtISO,
      expiresAtISO,
      deletedAtISO: "",
      updatedAtISO: reopenedAtISO,
      lifecycle,
      latestVersionNumber: nextVersionNumber,
      versionMeta
    },
    portal: buildCanonicalPortalSnapshot(id, reopenedQuote),
    version: {
      versionId,
      quoteId: id,
      organizationId,
      versionNumber: nextVersionNumber,
      createdAtISO: reopenedAtISO,
      reason: versionMeta.reason,
      createdBy: versionMeta.createdBy,
      status,
      pricing: isRecord(source.pricing) ? source.pricing : {},
      snapshot: {
        ...source,
        id
      }
    },
    result: {
      status: "draft",
      portalKey,
      portalIssuedAtISO: reopenedAtISO,
      portalExpiresAtISO,
      expiresAtISO,
      versionId,
      versionNumber: nextVersionNumber
    }
  };
}

function buildPortalRotationDocuments({
  quoteId,
  quote,
  newPortalKey,
  staff,
  nowISO
} = {}) {
  const id = sanitizeIdentifier(quoteId);
  const source = isRecord(quote) ? quote : {};
  const organizationId = sanitizeIdentifier(source.organizationId);
  const portalKey = sanitizeIdentifier(newPortalKey, 128);
  const previousPortalKey = sanitizeIdentifier(source.portalKey, 128);
  const actorUid = sanitizeIdentifier(staff?.uid);
  const actorEmail = email(staff?.email);
  const actorRole = text(staff?.role, 32).toLowerCase();
  const rotatedAtISO = normalizeISO(nowISO, "");
  const status = text(source.status, 32).toLowerCase() || "draft";
  const bookedPortalRenewal = status === "booked";
  const acceptedPortalRenewal = status === "accepted";
  const commercialPortalRenewal = acceptedPortalRenewal || bookedPortalRenewal;

  if (
    !id
    || !organizationId
    || portalKey.length < 20
    || !actorUid
    || !actorEmail
    || !rotatedAtISO
  ) {
    throw new QuoteCreationError(
      "failed-precondition",
      "Server portal rotation identity is incomplete."
    );
  }
  if (actorRole !== "admin") {
    throw new QuoteCreationError(
      "permission-denied",
      "Admin role required to rotate portal links."
    );
  }
  if (!["draft", "sent", "viewed", "accepted", "booked"].includes(status)) {
    throw new QuoteCreationError(
      "failed-precondition",
      "Portal rotation is unavailable for this commercial state."
    );
  }
  if (bookedPortalRenewal) {
    const contractNumber = text(source?.booking?.contractNumber, 120);
    const contractConvertedAtISO = normalizeISO(
      source?.booking?.contractConvertedAtISO,
      ""
    );
    if (!contractNumber || !contractConvertedAtISO) {
      throw new QuoteCreationError(
        "failed-precondition",
        "Booked portal renewal requires an authoritative contract."
      );
    }
  }

  const hardPortalExpiryISO = addDaysISO(rotatedAtISO, PORTAL_VALIDITY_DAYS_MAX);
  const quoteExpiryISO = normalizeISO(source.expiresAtISO, hardPortalExpiryISO);
  const portalExpiresAtISO = commercialPortalRenewal
    ? hardPortalExpiryISO
    : new Date(quoteExpiryISO).getTime() <= new Date(hardPortalExpiryISO).getTime()
      ? quoteExpiryISO
      : hardPortalExpiryISO;
  if (new Date(portalExpiresAtISO).getTime() <= new Date(rotatedAtISO).getTime()) {
    throw new QuoteCreationError(
      "failed-precondition",
      "Quote expiry must be extended before portal rotation."
    );
  }

  const nextVersionNumber = integerInRange(
    source.latestVersionNumber,
    0,
    0,
    999_999
  ) + 1;
  const versionId = `v${String(nextVersionNumber).padStart(4, "0")}`;
  const versionMeta = {
    versionId,
    versionNumber: nextVersionNumber,
    createdAt: rotatedAtISO,
    createdBy: {
      uid: actorUid,
      email: actorEmail,
      role: actorRole
    },
    reason: "portal_key_rotate"
  };
  const nextQuoteMeta = {
    ...(isRecord(source.quoteMeta) ? source.quoteMeta : {}),
    portalRotatedByEmail: actorEmail
  };
  const rotatedQuote = {
    ...source,
    portalKey,
    portalIssuedAtISO: rotatedAtISO,
    portalExpiresAtISO,
    updatedAtISO: rotatedAtISO,
    quoteMeta: nextQuoteMeta,
    latestVersionNumber: nextVersionNumber,
    versionMeta
  };
  const pricing = isRecord(source.pricing) ? source.pricing : {};

  return {
    previousPortalKey,
    quotePatch: {
      portalKey,
      portalIssuedAtISO: rotatedAtISO,
      portalExpiresAtISO,
      updatedAtISO: rotatedAtISO,
      "quoteMeta.portalRotatedByEmail": actorEmail,
      latestVersionNumber: nextVersionNumber,
      versionMeta
    },
    portal: buildCanonicalPortalSnapshot(id, rotatedQuote),
    version: {
      versionId,
      quoteId: id,
      organizationId,
      versionNumber: nextVersionNumber,
      createdAtISO: rotatedAtISO,
      reason: versionMeta.reason,
      createdBy: versionMeta.createdBy,
      status,
      pricing,
      snapshot: {
        id,
        ...source
      }
    },
    result: {
      portalKey,
      portalIssuedAtISO: rotatedAtISO,
      portalExpiresAtISO,
      versionId,
      versionNumber: nextVersionNumber
    }
  };
}

function buildTrustedQuoteCreationDocuments({
  quoteId,
  quoteNumber,
  portalKey,
  organizationId,
  staff,
  form,
  pricing,
  catalogSource,
  settings,
  nowISO,
  creationReason = "initial_quote_create",
  sourceQuoteId = ""
} = {}) {
  const id = sanitizeIdentifier(quoteId);
  const number = text(quoteNumber, 80);
  const token = sanitizeIdentifier(portalKey, 128);
  const orgId = sanitizeIdentifier(organizationId);
  const actorUid = sanitizeIdentifier(staff?.uid);
  const actorEmail = email(staff?.email);
  const actorRole = text(staff?.role, 32).toLowerCase();
  const createdAtISO = normalizeISO(nowISO, "");
  const normalizedCreationReason = text(creationReason, 120) || "initial_quote_create";
  const normalizedSourceQuoteId = sanitizeIdentifier(sourceQuoteId);

  if (!id || !number || token.length < 20 || !orgId || !actorUid || !createdAtISO) {
    throw new QuoteCreationError("failed-precondition", "Server quote identity is incomplete.");
  }
  if (!isRecord(form) || !isRecord(pricing) || pricing.authority !== PRICING_AUTHORITY) {
    throw new QuoteCreationError("failed-precondition", "Server-authoritative pricing is required.");
  }
  if (pricing.inputs?.organizationId !== orgId) {
    throw new QuoteCreationError("permission-denied", "Pricing organization does not match quote scope.");
  }

  const customerEmail = email(form.email);
  const customerName = text(form.name, 160);
  const inputs = isRecord(pricing.inputs) ? pricing.inputs : {};
  const pricingEvent = isRecord(inputs.event) ? inputs.event : {};
  const pricingSelection = isRecord(inputs.selection) ? inputs.selection : {};
  const packageSelection = sanitizeSelectedItem(pricingSelection.package, "per_person");
  const addonSnapshots = sanitizeSelectedItems(pricingSelection.addons, "per_person");
  const rentalSnapshots = sanitizeSelectedItems(pricingSelection.rentals, "per_item");
  const menuItemsSnapshot = sanitizeSelectedItems(pricingSelection.menuItems, "per_event");
  const packageInclusions = sanitizePackageInclusions(pricingSelection.package, {
    addons: addonSnapshots,
    rentals: rentalSnapshots,
    menuItems: menuItemsSnapshot
  });
  if (menuItemsSnapshot.length === 0) {
    throw new QuoteCreationError(
      "failed-precondition",
      "Server pricing must include at least one valid menu item before the quote can be saved."
    );
  }
  const quantities = isRecord(pricingSelection.quantities) ? pricingSelection.quantities : {};
  const labor = isRecord(inputs.labor) ? inputs.labor : {};
  const rules = isRecord(pricing.rulesSnapshot) ? pricing.rulesSnapshot : {};
  const laborRateSnapshot = isRecord(rules.laborRateSnapshot)
    ? rules.laborRateSnapshot
    : {};
  const totals = buildTotals(pricing);
  const quoteMeta = buildQuoteMeta(isRecord(settings) ? settings : {}, form, pricing);
  const validityDays = quoteMeta.quoteValidityDays;
  const portalValidityDays = Math.min(validityDays, PORTAL_VALIDITY_DAYS_MAX);
  const expiresAtISO = addDaysISO(createdAtISO, validityDays);
  const portalExpiresAtISO = addDaysISO(createdAtISO, portalValidityDays);
  const versionMeta = {
    versionId: QUOTE_VERSION_ID,
    versionNumber: 1,
    createdAt: createdAtISO,
    createdBy: {
      uid: actorUid,
      email: actorEmail,
      role: actorRole
    },
    reason: normalizedCreationReason
  };
  const crmProvider = quoteMeta.crmProvider;
  const crmProviderConfig = {
    enabled: quoteMeta.crmEnabled,
    state: "idle",
    occurredAtISO: "",
    provider: crmProvider
  };

  const quote = {
    quoteNumber: number,
    customer: {
      name: customerName,
      email: customerEmail,
      phone: text(form.phone, 40),
      organization: text(form.clientOrg, 160)
    },
    customerEmailKey: customerEmail,
    customerNameKey: customerName.toLowerCase().replace(/\s+/g, " "),
    eventTypeId: sanitizeIdentifier(pricingEvent.eventTypeId),
    deletedAtISO: "",
    ownerUid: actorUid,
    ownerEmail: actorEmail,
    organizationId: orgId,
    ...(normalizedSourceQuoteId ? { duplicatedFromQuoteId: normalizedSourceQuoteId } : {}),
    portalKey: token,
    portalIssuedAtISO: createdAtISO,
    portalExpiresAtISO,
    event: {
      name: text(pricingEvent.name, 160),
      date: text(pricingEvent.date, 10),
      time: text(pricingEvent.time, 5),
      venue: text(pricingEvent.venue, 240),
      venueAddress: text(pricingEvent.venueAddress, 500),
      guests: integerInRange(pricingEvent.guests, 0, 0, 100_000),
      hours: numberInRange(pricingEvent.hours, 0, 0, 72),
      servers: integerInRange(pricingEvent.servers, 0, 0, 1_000),
      chefs: integerInRange(pricingEvent.chefs, 0, 0, 1_000),
      bartenders: integerInRange(pricingEvent.bartenders, 0, 0, 1_000),
      dietaryRestrictions: text(form.dietaryRestrictions, 1_200),
      style: text(pricingEvent.style, 80),
      eventTypeId: sanitizeIdentifier(pricingEvent.eventTypeId)
    },
    selection: {
      packageId: packageSelection.id,
      packageName: packageSelection.name,
      packageInclusions,
      addons: addonSnapshots.map((item) => item.id),
      rentals: rentalSnapshots.map((item) => item.id),
      addonQuantities: isRecord(quantities.addonQuantities) ? quantities.addonQuantities : {},
      rentalQuantities: isRecord(quantities.rentalQuantities) ? quantities.rentalQuantities : {},
      menuItemQuantities: isRecord(quantities.menuItemQuantities) ? quantities.menuItemQuantities : {},
      addonSnapshots,
      rentalSnapshots,
      menuItems: menuItemsSnapshot.map((item) => item.id),
      menuItemsSnapshot,
      menuItemNames: menuItemsSnapshot.map((item) => item.name),
      menuItemDetails: menuItemsSnapshot,
      milesRT: numberInRange(pricingEvent.milesRT, 0, 0, 100_000),
      payMethod: form.payMethod === "ach" ? "ach" : "card",
      eventTemplateId: sanitizeIdentifier(form.eventTemplateId) || "custom",
      eventTypeId: sanitizeIdentifier(pricingEvent.eventTypeId),
      taxRegion: sanitizeIdentifier(pricingEvent.taxRegionId),
      seasonProfileId: sanitizeIdentifier(pricingEvent.seasonProfileId),
      laborRateSnapshot: {
        bartenderRateApplied: numberInRange(laborRateSnapshot.bartenderRateApplied, 0, 0, 100_000),
        serverRateApplied: numberInRange(laborRateSnapshot.serverRateApplied, 0, 0, 100_000),
        serverRatesApplied: sanitizeRateArray(laborRateSnapshot.serverRatesApplied),
        serverLabor: numberInRange(laborRateSnapshot.serverLabor, 0, 0, 1_000_000_000),
        chefRateApplied: numberInRange(laborRateSnapshot.chefRateApplied, 0, 0, 100_000),
        chefRatesApplied: sanitizeRateArray(laborRateSnapshot.chefRatesApplied),
        chefLabor: numberInRange(laborRateSnapshot.chefLabor, 0, 0, 1_000_000_000),
        bartenderRateTypeId: sanitizeIdentifier(laborRateSnapshot.bartenderRateTypeId),
        bartenderRateTypeName: text(laborRateSnapshot.bartenderRateTypeName, 160),
        staffingRateTypeId: sanitizeIdentifier(laborRateSnapshot.staffingRateTypeId),
        staffingRateTypeName: text(laborRateSnapshot.staffingRateTypeName, 160)
      },
      bartenderRateTypeId: sanitizeIdentifier(laborRateSnapshot.bartenderRateTypeId),
      staffingRateTypeId: sanitizeIdentifier(laborRateSnapshot.staffingRateTypeId),
      bartenderRateOverride: sanitizeOptionalRate(labor.bartenderRateOverride),
      serverRateOverride: sanitizeOptionalRate(labor.serverRateOverride),
      serverRateMixCsv: text(labor.serverRateMixCsv, 300),
      chefRateMixCsv: text(labor.chefRateMixCsv, 300),
      chefRateOverride: sanitizeOptionalRate(labor.chefRateOverride)
    },
    payment: {
      depositLink: "",
      depositStatus: "unpaid",
      depositConfirmedAtISO: ""
    },
    booking: {
      bookedAtISO: "",
      bookedByEmail: "",
      staffLead: "",
      staffAssignedAtISO: "",
      kitchenCheckpoints: [],
      productionChecklist: [],
      contractNumber: "",
      contractConvertedAtISO: "",
      contractConvertedByEmail: "",
      confirmationStatus: "pending",
      confirmationSentAtISO: "",
      confirmedAtISO: "",
      confirmationUpdatedByEmail: "",
      availabilityCheckedAtISO: "",
      availabilitySummary: {}
    },
    workflow: {
      followUp: {
        stage: "new",
        dueAtISO: "",
        completedAtISO: "",
        note: "",
        updatedAtISO: ""
      },
      approvalRequests: []
    },
    portalDecision: {},
    integrations: {
      retryLimit: quoteMeta.integrationRetryLimit,
      retention: quoteMeta.integrationAuditRetention,
      lastSyncAtISO: "",
      providers: {
        crm: { ...crmProviderConfig },
        [crmProvider]: { ...crmProviderConfig }
      },
      logs: []
    },
    totals,
    pricing,
    quoteMeta,
    status: "draft",
    source: text(catalogSource, 120),
    createdAtISO,
    updatedAtISO: createdAtISO,
    expiresAtISO,
    lifecycle: {
      draftAtISO: createdAtISO
    },
    activeVersionId: QUOTE_VERSION_ID,
    latestVersionNumber: 1,
    versionMeta
  };

  const portal = buildCanonicalPortalSnapshot(id, quote);
  const version = {
    versionId: QUOTE_VERSION_ID,
    quoteId: id,
    organizationId: orgId,
    versionNumber: 1,
    createdAtISO,
    reason: versionMeta.reason,
    createdBy: versionMeta.createdBy,
    status: "draft",
    pricing,
    snapshot: {
      id,
      ...quote
    }
  };

  return {
    quote,
    portal,
    version,
    result: {
      id,
      quoteNumber: number,
      portalKey: token,
      portalIssuedAtISO: createdAtISO,
      portalExpiresAtISO,
      activeVersionId: QUOTE_VERSION_ID,
      latestVersionNumber: 1
    }
  };
}

function buildTrustedQuoteEditDocuments({
  quoteId,
  quote,
  staff,
  form,
  pricing,
  catalogSource,
  settings,
  nowISO
} = {}) {
  const id = sanitizeIdentifier(quoteId);
  const source = isRecord(quote) ? quote : {};
  const organizationId = sanitizeIdentifier(source.organizationId);
  const quoteNumber = text(source.quoteNumber, 80);
  const portalKey = sanitizeIdentifier(source.portalKey, 128);
  const actorUid = sanitizeIdentifier(staff?.uid);
  const actorEmail = email(staff?.email);
  const actorRole = text(staff?.role, 32).toLowerCase();
  const editedAtISO = normalizeISO(nowISO, "");
  const sourceStatus = text(source.status, 32).toLowerCase();

  if (
    !id
    || !organizationId
    || !quoteNumber
    || portalKey.length < 20
    || !actorUid
    || !actorEmail
    || !editedAtISO
  ) {
    throw new QuoteCreationError(
      "failed-precondition",
      "Server quote edit identity is incomplete."
    );
  }
  if (!["admin", "sales"].includes(actorRole)) {
    throw new QuoteCreationError(
      "permission-denied",
      "Staff role required to edit quotes."
    );
  }
  if (!["draft", "sent", "viewed"].includes(sourceStatus)) {
    throw new QuoteCreationError(
      "failed-precondition",
      "Only draft, sent, or viewed quotes can be edited. Reopen or duplicate another quote first."
    );
  }
  if (hasTerminalDecisionEvidence(source)) {
    throw new QuoteCreationError(
      "failed-precondition",
      "Accepted, declined, booked, paid, or refunded quote evidence cannot be overwritten."
    );
  }

  const canonical = buildTrustedQuoteCreationDocuments({
    quoteId: id,
    quoteNumber,
    portalKey,
    organizationId,
    staff,
    form,
    pricing,
    catalogSource,
    settings,
    nowISO: editedAtISO,
    creationReason: "quote_edit"
  });
  const nextVersionNumber = integerInRange(
    source.latestVersionNumber,
    0,
    0,
    999_999
  ) + 1;
  const versionId = `v${String(nextVersionNumber).padStart(4, "0")}`;
  const versionMeta = {
    versionId,
    versionNumber: nextVersionNumber,
    createdAt: editedAtISO,
    createdBy: {
      uid: actorUid,
      email: actorEmail,
      role: actorRole
    },
    reason: "quote_edit"
  };
  const sourceLifecycle = isRecord(source.lifecycle) ? source.lifecycle : {};
  const lifecycle = {
    ...sourceLifecycle,
    draftAtISO: normalizeISO(sourceLifecycle.draftAtISO, editedAtISO),
    editedAtISO
  };
  const sourceQuoteMeta = isRecord(source.quoteMeta) ? source.quoteMeta : {};
  const quoteMeta = {
    ...canonical.quote.quoteMeta,
    ...(text(sourceQuoteMeta.portalRotatedByEmail, 254)
      ? { portalRotatedByEmail: email(sourceQuoteMeta.portalRotatedByEmail) }
      : {}),
    ...(text(sourceQuoteMeta.reopenedByEmail, 254)
      ? { reopenedByEmail: email(sourceQuoteMeta.reopenedByEmail) }
      : {}),
    lastEditedByEmail: actorEmail
  };
  const payment = isRecord(source.payment)
    ? source.payment
    : canonical.quote.payment;
  const booking = isRecord(source.booking)
    ? source.booking
    : canonical.quote.booking;
  const workflow = isRecord(source.workflow)
    ? source.workflow
    : canonical.quote.workflow;
  const integrations = isRecord(source.integrations)
    ? source.integrations
    : canonical.quote.integrations;
  const portalDecision = isRecord(source.portalDecision)
    ? source.portalDecision
    : {};
  const ownerUid = sanitizeIdentifier(source.ownerUid);
  const ownerEmail = email(source.ownerEmail);
  const createdAtISO = normalizeISO(source.createdAtISO, canonical.quote.createdAtISO);
  const editedQuote = {
    ...source,
    ...canonical.quote,
    quoteNumber,
    organizationId,
    ownerUid,
    ownerEmail,
    createdAtISO,
    portalKey,
    portalIssuedAtISO: canonical.quote.portalIssuedAtISO,
    portalExpiresAtISO: canonical.quote.portalExpiresAtISO,
    payment,
    booking,
    workflow,
    integrations,
    portalDecision,
    quoteMeta,
    status: "draft",
    deletedAtISO: "",
    lifecycle,
    activeVersionId: versionId,
    latestVersionNumber: nextVersionNumber,
    versionMeta,
    updatedAtISO: editedAtISO
  };
  const quotePatch = {
    quoteNumber,
    customer: editedQuote.customer,
    customerEmailKey: editedQuote.customerEmailKey,
    customerNameKey: editedQuote.customerNameKey,
    eventTypeId: editedQuote.eventTypeId,
    deletedAtISO: "",
    ownerUid,
    ownerEmail,
    organizationId,
    portalKey,
    portalIssuedAtISO: editedQuote.portalIssuedAtISO,
    portalExpiresAtISO: editedQuote.portalExpiresAtISO,
    event: editedQuote.event,
    selection: editedQuote.selection,
    payment,
    booking,
    workflow,
    portalDecision,
    integrations,
    totals: editedQuote.totals,
    pricing: editedQuote.pricing,
    quoteMeta,
    status: "draft",
    source: editedQuote.source,
    updatedAtISO: editedAtISO,
    expiresAtISO: editedQuote.expiresAtISO,
    lifecycle,
    activeVersionId: versionId,
    latestVersionNumber: nextVersionNumber,
    versionMeta
  };
  const version = {
    versionId,
    quoteId: id,
    organizationId,
    versionNumber: nextVersionNumber,
    createdAtISO: editedAtISO,
    reason: versionMeta.reason,
    createdBy: versionMeta.createdBy,
    status: "draft",
    pricing: editedQuote.pricing,
    snapshot: {
      ...editedQuote,
      id
    }
  };

  return {
    quotePatch,
    portal: buildCanonicalPortalSnapshot(id, editedQuote),
    version,
    result: {
      id,
      quoteId: id,
      quoteNumber,
      status: "draft",
      portalKey,
      portalIssuedAtISO: editedQuote.portalIssuedAtISO,
      portalExpiresAtISO: editedQuote.portalExpiresAtISO,
      expiresAtISO: editedQuote.expiresAtISO,
      activeVersionId: versionId,
      latestVersionNumber: nextVersionNumber,
      versionId,
      versionNumber: nextVersionNumber
    }
  };
}

function buildServerQuoteNumber(nowISO, entropy = "") {
  const parsed = new Date(nowISO);
  if (Number.isNaN(parsed.getTime())) {
    throw new QuoteCreationError("failed-precondition", "Server quote timestamp is invalid.");
  }
  const compactDate = parsed.toISOString().slice(2, 10).replace(/-/g, "");
  const compactTime = parsed.toISOString().slice(11, 16).replace(":", "");
  const suffix = text(entropy, 64).replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toUpperCase();
  if (suffix.length < 8) {
    throw new QuoteCreationError("failed-precondition", "Server quote entropy is invalid.");
  }
  return `Q-${compactDate}-${compactTime}-${suffix}`;
}

module.exports = {
  PORTAL_VALIDITY_DAYS_MAX,
  QUOTE_VERSION_ID,
  QuoteCreationError,
  buildCanonicalPortalSnapshot,
  buildCustomerProjection,
  buildDuplicateQuoteForm,
  buildPortalRotationDocuments,
  buildQuoteReopenDocuments,
  buildServerQuoteNumber,
  buildTrustedQuoteCreationDocuments,
  buildTrustedQuoteEditDocuments,
  customerProjectionDocumentId,
  sanitizeQuoteCreationRequest,
  sanitizeStoredStripePaymentLink
};
