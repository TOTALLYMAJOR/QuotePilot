function text(value) {
  return String(value ?? "").trim();
}

function isIsoTimestamp(value) {
  const normalized = text(value);
  if (!normalized) return false;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === normalized;
}

export function isCatalogPricingConfirmationCurrent(settings = {}) {
  if (settings?.pricingSetupConfirmed !== true) return false;
  const catalogRevision = Number(settings?.catalogRevision);
  const confirmation = settings?.pricingConfirmation;
  if (!Number.isSafeInteger(catalogRevision) || catalogRevision < 0) return false;
  if (!confirmation || typeof confirmation !== "object" || Array.isArray(confirmation)) return false;
  if (!text(confirmation.actorUid) || !text(confirmation.actorEmail)) return false;
  if (!isIsoTimestamp(confirmation.confirmedAtISO)) return false;
  return Number.isSafeInteger(Number(confirmation.confirmedCatalogRevision))
    && Number(confirmation.confirmedCatalogRevision) === catalogRevision;
}

export function buildLocalCatalogPricingConfirmation(settings = {}, {
  actorUid = "local-development",
  actorEmail = "local-development@quotepilot.invalid",
  confirmedAtISO = new Date().toISOString()
} = {}) {
  const catalogRevision = Number(settings?.catalogRevision);
  if (!Number.isSafeInteger(catalogRevision) || catalogRevision < 0) return null;
  return {
    actorUid: text(actorUid),
    actorEmail: text(actorEmail).toLowerCase(),
    confirmedAtISO,
    confirmedCatalogRevision: catalogRevision
  };
}
