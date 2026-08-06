function cleanText(value, maxLength = 240) {
  return String(value || "").trim().slice(0, maxLength);
}

function cleanEmail(value) {
  const candidate = cleanText(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : "";
}

function cleanHttpsUrl(value) {
  const candidate = cleanText(value, 1_000);
  if (!candidate) return "";
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function cleanColor(value) {
  const candidate = cleanText(value, 32);
  return /^#[0-9a-f]{6}$/i.test(candidate) ? candidate : "";
}

function isPortalRecoveryToken(value) {
  return /^[A-Za-z0-9_-]{20,128}$/.test(String(value || "").trim());
}

function createPortalRecoveryThrottle({ limit = 30, windowMs = 5 * 60 * 1000, now = Date.now } = {}) {
  const counters = new Map();
  return (ip = "") => {
    const key = cleanText(ip, 240) || "unknown";
    const timestamp = now();
    const current = counters.get(key);
    const inWindow = current && current.expiresAt > timestamp;
    const nextCount = inWindow ? current.count + 1 : 1;
    const expiresAt = inWindow ? current.expiresAt : timestamp + windowMs;
    counters.set(key, { count: nextCount, expiresAt });
    return nextCount > limit;
  };
}

function isRecoverablePortalSnapshot(portal = {}, portalKey = "") {
  const key = cleanText(portalKey, 128);
  const status = cleanText(portal.status, 32).toLowerCase();
  const portalIssuedAtISO = cleanText(portal.portalIssuedAtISO, 64);
  const delivery = portal?.deliveryEvidence && typeof portal.deliveryEvidence === "object"
    ? portal.deliveryEvidence
    : {};
  return (
    isPortalRecoveryToken(key)
    && cleanText(portal.portalKey, 128) === key
    && !["", "draft", "deleted"].includes(status)
    && cleanText(delivery.state, 32).toLowerCase() === "provider_accepted"
    && cleanText(delivery.portalActivationState, 32).toLowerCase() === "active"
    && cleanText(delivery.portalKey, 128) === key
    && Boolean(cleanText(delivery.revisionId, 160))
    && Boolean(cleanText(delivery.providerAcceptedAtISO, 64))
    && Boolean(portalIssuedAtISO)
    && cleanText(delivery.portalIssuedAtISO, 64) === portalIssuedAtISO
  );
}

function buildPortalRecoveryContact({ portal = {}, organization = {}, settings = {} } = {}) {
  const organizationName = cleanText(
    organization.name || portal?.quoteMeta?.organizationName,
    160
  );
  const brandName = cleanText(
    settings.brandName || portal?.quoteMeta?.brandName || organizationName,
    160
  );
  const email = cleanEmail(settings.businessEmail || portal?.quoteMeta?.businessEmail);
  const phone = cleanText(settings.businessPhone || portal?.quoteMeta?.businessPhone, 40);
  const logoUrl = cleanHttpsUrl(settings.brandLogoUrl || portal?.quoteMeta?.brandLogoUrl);

  if (!brandName && !organizationName && !email && !phone) return null;

  return {
    brandName,
    organizationName,
    email,
    phone,
    logoUrl,
    brandPrimaryColor: cleanColor(
      settings.brandPrimaryColor || portal?.quoteMeta?.brandPrimaryColor
    ),
    brandAccentColor: cleanColor(
      settings.brandAccentColor || portal?.quoteMeta?.brandAccentColor
    ),
    brandDarkAccentColor: cleanColor(
      settings.brandDarkAccentColor || portal?.quoteMeta?.brandDarkAccentColor
    ),
    brandBackgroundStart: cleanColor(
      settings.brandBackgroundStart || portal?.quoteMeta?.brandBackgroundStart
    ),
    brandBackgroundMid: cleanColor(
      settings.brandBackgroundMid || portal?.quoteMeta?.brandBackgroundMid
    ),
    brandBackgroundEnd: cleanColor(
      settings.brandBackgroundEnd || portal?.quoteMeta?.brandBackgroundEnd
    )
  };
}

async function resolvePortalRecoveryContact({
  portalKey,
  readPortal,
  readOrganization,
  readSettings,
  isOrganizationActive = () => false
} = {}) {
  const key = cleanText(portalKey, 128);
  if (!isPortalRecoveryToken(key)) return null;

  const portal = typeof readPortal === "function" ? await readPortal(key) : null;
  if (!portal || !isRecoverablePortalSnapshot(portal, key)) return null;

  const organizationId = cleanText(portal.organizationId, 160);
  if (!organizationId) return null;
  const organization = typeof readOrganization === "function"
    ? await readOrganization(organizationId)
    : null;
  if (!organization || !isOrganizationActive(organization)) return null;
  const settings = typeof readSettings === "function"
    ? await readSettings(organizationId)
    : {};

  return buildPortalRecoveryContact({
    portal,
    organization,
    settings: settings || {}
  });
}

module.exports = {
  buildPortalRecoveryContact,
  createPortalRecoveryThrottle,
  isRecoverablePortalSnapshot,
  isPortalRecoveryToken,
  resolvePortalRecoveryContact
};
