const { createHash, timingSafeEqual } = require("node:crypto");

const SHOWCASE_SCHEMA_VERSION = 1;
const INQUIRY_SCHEMA_VERSION = 1;
const SHOWCASE_STATES = Object.freeze(["draft", "published", "paused"]);
const INQUIRY_STATES = Object.freeze(["received", "acknowledged", "converted", "dismissed"]);
const REFERENCE_TYPES = Object.freeze(["offer", "addon", "rental", "menu_item", "template"]);
const ANALYTICS_EVENTS = Object.freeze([
  "inquiry_page_viewed",
  "inquiry_form_started",
  "inquiry_submitted",
  "inquiry_reviewed",
  "inquiry_converted",
  "inquiry_dismissed"
]);
const MAX_ENTRIES = 48;
const MAX_PREFERENCES = 16;

class InquiryShowcaseError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "InquiryShowcaseError";
    this.code = code;
    this.details = details;
  }
}

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value, max = 240) {
  return String(value ?? "").trim().replace(/\s+/gu, " ").slice(0, max);
}

function multiline(value, max = 2000) {
  return String(value ?? "").trim().replace(/\r\n?/gu, "\n").slice(0, max);
}

function id(value, max = 160) {
  const normalized = text(value, max);
  return /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/u.test(normalized) ? normalized : "";
}

function email(value) {
  const normalized = text(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized) ? normalized : "";
}

function slug(value) {
  const normalized = text(value, 80).toLowerCase();
  return /^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$/u.test(normalized) ? normalized : "";
}

function imageUrl(value) {
  const normalized = text(value, 900);
  if (!normalized) return "";
  try {
    const parsed = new URL(normalized);
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (record(value)) {
    return Object.keys(value).sort().reduce((result, key) => {
      if (value[key] !== undefined) result[key] = canonical(value[key]);
      return result;
    }, {});
  }
  return value;
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function hashRecoverySecret(secret) {
  const normalized = text(secret, 256);
  if (normalized.length < 24) {
    throw new InquiryShowcaseError("invalid-argument", "A valid recovery secret is required.");
  }
  return digest({ purpose: "inquiry-recovery-v1", secret: normalized });
}

function recoverySecretMatches(secret, expectedHash) {
  let actual;
  try {
    actual = Buffer.from(hashRecoverySecret(secret), "hex");
  } catch {
    return false;
  }
  const expected = Buffer.from(text(expectedHash, 64), "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function catalogCollections(catalog = {}, settings = {}) {
  return {
    offer: Array.isArray(catalog.packages) ? catalog.packages : [],
    addon: Array.isArray(catalog.addons) ? catalog.addons : [],
    rental: Array.isArray(catalog.rentals) ? catalog.rentals : [],
    menu_item: Array.isArray(catalog.menuItems) ? catalog.menuItems : [],
    template: Array.isArray(settings.eventTemplates) ? settings.eventTemplates : []
  };
}

function sourceItemVersion(item = {}) {
  return text(
    item.offerVersion || item.itemVersion || item.templateVersion || item.version || item.revisionId || item.updatedAtISO,
    160
  ) || `sha256:${digest(item)}`;
}

function publicCopy(value, limit, label) {
  const normalized = multiline(value, limit);
  const prohibited = /(?:[$€£]\s*\d|\b\d+(?:\.\d+)?\s*%|\bper\s+(?:person|guest|head)\b|\b(?:available|availability|booked|booking|reserved|reservation|allergen[- ]?(?:safe|free)|guarantee(?:d)?)\b)/iu;
  if (prohibited.test(normalized)) {
    throw new InquiryShowcaseError("invalid-argument", `${label} cannot claim price, availability, booking, reservation, guarantees, or allergen safety.`);
  }
  return normalized;
}

function catalogReferenceMap(catalog = {}, settings = {}) {
  const map = new Map();
  Object.entries(catalogCollections(catalog, settings)).forEach(([type, values]) => {
    values.forEach((item) => {
      const itemId = id(item?.id);
      if (itemId) map.set(`${type}:${itemId}`, { type, itemId, item });
    });
  });
  return map;
}

function normalizeEntry(raw = {}, index = 0) {
  const referenceType = text(raw.referenceType, 32).toLowerCase();
  const referenceId = id(raw.referenceId);
  const publicTitle = publicCopy(raw.publicTitle, 120, `Showcase entry ${index + 1} title`);
  if (!REFERENCE_TYPES.includes(referenceType) || !referenceId || !publicTitle) {
    throw new InquiryShowcaseError(
      "invalid-argument",
      `Showcase entry ${index + 1} needs a supported catalog reference and public title.`
    );
  }
  const rawImage = text(raw.imageUrl, 900);
  const safeImage = imageUrl(rawImage);
  if (rawImage && !safeImage) {
    throw new InquiryShowcaseError("invalid-argument", `Showcase entry ${index + 1} needs an HTTPS image URL.`);
  }
  return {
    entryId: id(raw.entryId) || `entry_${digest({ referenceType, referenceId, index }).slice(0, 24)}`,
    referenceType,
    referenceId,
    publicTitle,
    shortDescription: publicCopy(raw.shortDescription, 360, `Showcase entry ${index + 1} description`),
    imageUrl: safeImage,
    featuredLabel: publicCopy(raw.featuredLabel, 48, `Showcase entry ${index + 1} featured label`),
    displayOrder: Number.isInteger(Number(raw.displayOrder)) ? Math.max(0, Math.min(999, Number(raw.displayOrder))) : index,
    visible: raw.visible !== false
  };
}

function normalizeDraft(raw = {}) {
  const entries = Array.isArray(raw.entries) ? raw.entries : [];
  if (entries.length > MAX_ENTRIES) {
    throw new InquiryShowcaseError("invalid-argument", `An Inquiry Showcase supports at most ${MAX_ENTRIES} entries.`);
  }
  const normalizedSlug = slug(raw.slug);
  if (!normalizedSlug) {
    throw new InquiryShowcaseError("invalid-argument", "Use a unique slug with lowercase letters, numbers, and hyphens.");
  }
  const normalizedEntries = entries.map(normalizeEntry);
  const identities = new Set();
  normalizedEntries.forEach((entry) => {
    const identity = `${entry.referenceType}:${entry.referenceId}`;
    if (identities.has(identity)) {
      throw new InquiryShowcaseError("invalid-argument", `The ${identity} reference appears more than once.`);
    }
    identities.add(identity);
  });
  return {
    schemaVersion: SHOWCASE_SCHEMA_VERSION,
    slug: normalizedSlug,
    pageTitle: publicCopy(raw.pageTitle, 120, "Page title") || "Tell us about your event",
    introduction: publicCopy(raw.introduction, 600, "Introduction"),
    responsePromise: publicCopy(raw.responsePromise, 180, "Response expectation"),
    shareOnly: true,
    searchIndexing: "noindex",
    entries: normalizedEntries.sort((a, b) => a.displayOrder - b.displayOrder || a.entryId.localeCompare(b.entryId))
  };
}

function validateDraftReferences(draft, { catalog = {}, settings = {} } = {}) {
  const references = catalogReferenceMap(catalog, settings);
  const violations = [];
  const entries = draft.entries.map((entry) => {
    const found = references.get(`${entry.referenceType}:${entry.referenceId}`);
    if (!found) {
      violations.push({ entryId: entry.entryId, reason: "missing", message: `${entry.publicTitle} no longer resolves in the catalog.` });
      return null;
    }
    if (found.item.active === false) {
      violations.push({ entryId: entry.entryId, reason: "inactive", message: `${entry.publicTitle} is inactive in the catalog.` });
    }
    if (found.item.internalOnly === true || found.item.customerVisible === false) {
      violations.push({ entryId: entry.entryId, reason: "internal_only", message: `${entry.publicTitle} is not customer-safe.` });
    }
    return {
      ...entry,
      sourceItemVersion: sourceItemVersion(found.item)
    };
  }).filter(Boolean);
  if (entries.filter((entry) => entry.visible).length === 0) {
    violations.push({ entryId: "", reason: "empty", message: "Publish at least one visible customer preference." });
  }
  return { ok: violations.length === 0, entries, violations };
}

function buildPublication({ organizationId, showcaseId = "default", versionId, draft, catalog = {}, settings = {}, actor = {}, nowISO } = {}) {
  const orgId = id(organizationId);
  const publicationId = id(versionId);
  const publishedAtISO = text(nowISO, 40);
  if (!orgId || !publicationId || !publishedAtISO) {
    throw new InquiryShowcaseError("failed-precondition", "Publication identity is incomplete.");
  }
  const normalizedDraft = normalizeDraft(draft);
  const validation = validateDraftReferences(normalizedDraft, { catalog, settings });
  if (!validation.ok) {
    throw new InquiryShowcaseError("failed-precondition", "The Inquiry Showcase is not safe to publish.", validation.violations);
  }
  const catalogRevision = Math.max(0, Number(settings.catalogRevision || 0));
  const projection = {
    schemaVersion: SHOWCASE_SCHEMA_VERSION,
    organizationId: orgId,
    showcaseId: id(showcaseId) || "default",
    versionId: publicationId,
    slug: normalizedDraft.slug,
    pageTitle: normalizedDraft.pageTitle,
    introduction: normalizedDraft.introduction,
    responsePromise: normalizedDraft.responsePromise,
    shareOnly: true,
    searchIndexing: "noindex",
    catalogRevision,
    entries: validation.entries.filter((entry) => entry.visible).map((entry) => ({
      entryId: entry.entryId,
      referenceType: entry.referenceType,
      referenceId: entry.referenceId,
      sourceCatalogRevision: catalogRevision,
      sourceItemVersion: entry.sourceItemVersion,
      publicTitle: entry.publicTitle,
      shortDescription: entry.shortDescription,
      imageUrl: entry.imageUrl,
      featuredLabel: entry.featuredLabel,
      displayOrder: entry.displayOrder
    })),
    publishedAtISO,
    publishedBy: { uid: id(actor.uid), email: email(actor.email), role: text(actor.role, 32).toLowerCase() }
  };
  return { ...projection, publicationDigest: digest(projection) };
}

function publicProjection(publication = {}, branding = {}) {
  if (!publication.versionId || !Array.isArray(publication.entries)) {
    throw new InquiryShowcaseError("not-found", "This inquiry page is not available.");
  }
  return {
    schemaVersion: SHOWCASE_SCHEMA_VERSION,
    slug: publication.slug,
    publicationVersionId: publication.versionId,
    publicationDigest: publication.publicationDigest,
    pageTitle: publication.pageTitle,
    introduction: publication.introduction,
    responsePromise: publication.responsePromise,
    searchIndexing: "noindex",
    branding: {
      name: text(branding.brandName || branding.organizationName, 120) || "Event team",
      logoUrl: imageUrl(branding.brandLogoUrl),
      primaryColor: /^#[0-9a-f]{6}$/iu.test(text(branding.brandPrimaryColor, 7)) ? text(branding.brandPrimaryColor, 7) : "#243126",
      contactEmail: email(branding.businessEmail)
    },
    entries: publication.entries.map((entry) => ({
      entryId: entry.entryId,
      referenceType: entry.referenceType,
      referenceId: entry.referenceId,
      sourceCatalogRevision: entry.sourceCatalogRevision,
      sourceItemVersion: entry.sourceItemVersion,
      publicTitle: entry.publicTitle,
      shortDescription: entry.shortDescription,
      imageUrl: entry.imageUrl,
      featuredLabel: entry.featuredLabel,
      displayOrder: entry.displayOrder
    }))
  };
}

function normalizeInquiryFields(raw = {}) {
  const normalized = {
    name: text(raw.name, 160),
    email: email(raw.email),
    phone: text(raw.phone, 40),
    organization: text(raw.organization, 160),
    eventType: text(raw.eventType, 120),
    eventDate: /^\d{4}-\d{2}-\d{2}$/u.test(text(raw.eventDate, 10)) ? text(raw.eventDate, 10) : "",
    estimatedGuests: Number.isInteger(Number(raw.estimatedGuests)) ? Number(raw.estimatedGuests) : 0,
    location: text(raw.location, 500),
    notes: multiline(raw.notes, 1600),
    serviceResponseConsent: raw.serviceResponseConsent === true
  };
  if (!normalized.name || !normalized.email || !normalized.eventType || !normalized.eventDate || !normalized.location) {
    throw new InquiryShowcaseError("invalid-argument", "Name, email, event type, event date, and location are required.");
  }
  if (normalized.estimatedGuests < 1 || normalized.estimatedGuests > 100000) {
    throw new InquiryShowcaseError("invalid-argument", "Estimated guests must be between 1 and 100,000.");
  }
  if (!normalized.serviceResponseConsent) {
    throw new InquiryShowcaseError("failed-precondition", "Consent to receive a response about this inquiry is required.");
  }
  return normalized;
}

function normalizePreferenceRefs(raw = [], publication = {}) {
  const values = Array.isArray(raw) ? raw : [];
  if (values.length > MAX_PREFERENCES) {
    throw new InquiryShowcaseError("invalid-argument", `Choose at most ${MAX_PREFERENCES} preferences.`);
  }
  const entryMap = new Map((publication.entries || []).map((entry) => [entry.entryId, entry]));
  const unique = new Set();
  return values.map((value) => {
    const entryId = id(record(value) ? value.entryId : value);
    const entry = entryMap.get(entryId);
    if (!entry || unique.has(entryId)) {
      throw new InquiryShowcaseError("failed-precondition", "A selected preference is no longer part of this publication.");
    }
    unique.add(entryId);
    return {
      entryId,
      referenceType: entry.referenceType,
      referenceId: entry.referenceId,
      sourceCatalogRevision: entry.sourceCatalogRevision,
      sourceItemVersion: entry.sourceItemVersion,
      publicTitle: entry.publicTitle
    };
  });
}

function buildInquiry({ organizationId, inquiryId, requestId, recoverySecret, publication, fields, preferenceRefs, nowISO, deleteAtISO } = {}) {
  const orgId = id(organizationId);
  const normalizedInquiryId = id(inquiryId);
  const normalizedRequestId = id(requestId);
  if (!orgId || !normalizedInquiryId || !normalizedRequestId) {
    throw new InquiryShowcaseError("invalid-argument", "Inquiry request identity is incomplete.");
  }
  const normalizedFields = normalizeInquiryFields(fields);
  const preferences = normalizePreferenceRefs(preferenceRefs, publication);
  return {
    schemaVersion: INQUIRY_SCHEMA_VERSION,
    organizationId: orgId,
    inquiryId: normalizedInquiryId,
    requestId: normalizedRequestId,
    state: "received",
    assignment: { uid: "", email: "" },
    submittedAtISO: text(nowISO, 40),
    acknowledgedAtISO: "",
    convertedAtISO: "",
    dismissedAtISO: "",
    deleteAtISO: text(deleteAtISO, 40),
    source: {
      slug: publication.slug,
      showcaseId: publication.showcaseId,
      publicationVersionId: publication.versionId,
      publicationDigest: publication.publicationDigest,
      catalogRevision: publication.catalogRevision
    },
    fields: normalizedFields,
    preferences,
    recoverySecretHash: hashRecoverySecret(recoverySecret),
    notification: { state: "pending", attemptedAtISO: "", provider: "", messageId: "", failureCode: "" },
    conversion: { quoteId: "", receiptId: "" }
  };
}

function transitionInquiry(inquiry = {}, action, { actor = {}, nowISO, reason = "" } = {}) {
  const state = text(inquiry.state, 32).toLowerCase();
  const next = text(action, 32).toLowerCase();
  const allowed = {
    received: ["acknowledged", "dismissed"],
    acknowledged: ["dismissed", "converted"],
    dismissed: [],
    converted: []
  };
  if (!INQUIRY_STATES.includes(state) || !(allowed[state] || []).includes(next)) {
    throw new InquiryShowcaseError("failed-precondition", `Inquiry cannot move from ${state || "unknown"} to ${next || "unknown"}.`);
  }
  return {
    state: next,
    assignment: next === "acknowledged" ? { uid: id(actor.uid), email: email(actor.email) } : inquiry.assignment,
    [`${next}AtISO`]: text(nowISO, 40),
    ...(next === "dismissed" ? { dismissalReason: text(reason, 300) } : {})
  };
}

function resolveReferenceDrift(preferences = [], { catalog = {}, settings = {} } = {}) {
  const current = catalogReferenceMap(catalog, settings);
  const currentCatalogRevision = Math.max(0, Number(settings.catalogRevision || 0));
  return preferences.map((preference) => {
    const found = current.get(`${preference.referenceType}:${preference.referenceId}`);
    const currentVersion = found ? sourceItemVersion(found.item) : "";
    const state = !found
      ? "missing"
      : found.item.active === false
        ? "inactive"
        : found.item.internalOnly === true || found.item.customerVisible === false
          ? "incompatible"
          : currentVersion !== preference.sourceItemVersion || Number(preference.sourceCatalogRevision || 0) !== currentCatalogRevision
            ? "changed"
            : "current";
    return {
      entryId: preference.entryId,
      publicTitle: preference.publicTitle,
      referenceType: preference.referenceType,
      referenceId: preference.referenceId,
      seenVersion: preference.sourceItemVersion,
      currentVersion,
      state,
      requiresResolution: state !== "current"
    };
  });
}

function buildQuotePrefill(inquiry = {}, drift = []) {
  const currentRefs = drift.filter((item) => item.state === "current");
  const find = (type) => currentRefs.filter((item) => item.referenceType === type).map((item) => item.referenceId);
  return {
    name: inquiry.fields?.name || "",
    email: inquiry.fields?.email || "",
    phone: inquiry.fields?.phone || "",
    clientOrg: inquiry.fields?.organization || "",
    eventName: inquiry.fields?.eventType ? `${inquiry.fields.eventType} inquiry` : "Event inquiry",
    eventTypeId: "custom",
    date: inquiry.fields?.eventDate || "",
    venue: inquiry.fields?.location || "",
    venueAddress: inquiry.fields?.location || "",
    guests: Number(inquiry.fields?.estimatedGuests || 0),
    packageId: find("offer")[0] || "",
    addons: find("addon"),
    rentals: find("rental"),
    menuItems: find("menu_item"),
    eventTemplateId: find("template")[0] || "custom",
    inquiryNotes: inquiry.fields?.notes || "",
    inquiryPreferenceSummary: (inquiry.preferences || []).map((item) => item.publicTitle).join(", ")
  };
}

function contentFreeDeletionReceipt(inquiry = {}, nowISO = "") {
  return {
    schemaVersion: 1,
    receiptType: "inquiry_content_deleted",
    organizationId: id(inquiry.organizationId),
    inquiryId: id(inquiry.inquiryId),
    sourcePublicationVersionId: id(inquiry.source?.publicationVersionId),
    previousState: text(inquiry.state, 32),
    deletedAtISO: text(nowISO, 40),
    contentRetained: false
  };
}

module.exports = {
  ANALYTICS_EVENTS,
  INQUIRY_SCHEMA_VERSION,
  INQUIRY_STATES,
  InquiryShowcaseError,
  MAX_ENTRIES,
  MAX_PREFERENCES,
  REFERENCE_TYPES,
  SHOWCASE_SCHEMA_VERSION,
  SHOWCASE_STATES,
  buildInquiry,
  buildPublication,
  buildQuotePrefill,
  catalogReferenceMap,
  contentFreeDeletionReceipt,
  digest,
  hashRecoverySecret,
  normalizeDraft,
  normalizeInquiryFields,
  normalizePreferenceRefs,
  publicProjection,
  recoverySecretMatches,
  resolveReferenceDrift,
  slug,
  sourceItemVersion,
  transitionInquiry,
  validateDraftReferences
};
