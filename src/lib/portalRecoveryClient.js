import { httpsCallable } from "firebase/functions";
import { cloudFunctions } from "./firebase";

const LOCAL_QUOTES_KEY = "quoteWizard.quotes";
const RECOVERABLE_LOCAL_STATUSES = new Set(["sent", "viewed", "accepted", "declined", "booked", "expired"]);

function cleanText(value, maxLength = 240) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeContact(value) {
  if (!value || typeof value !== "object") return null;
  const contact = {
    brandName: cleanText(value.brandName, 160),
    organizationName: cleanText(value.organizationName, 160),
    email: cleanText(value.email, 254),
    phone: cleanText(value.phone, 40),
    logoUrl: cleanText(value.logoUrl, 1_000),
    brandPrimaryColor: cleanText(value.brandPrimaryColor, 32),
    brandAccentColor: cleanText(value.brandAccentColor, 32),
    brandDarkAccentColor: cleanText(value.brandDarkAccentColor, 32),
    brandBackgroundStart: cleanText(value.brandBackgroundStart, 32),
    brandBackgroundMid: cleanText(value.brandBackgroundMid, 32),
    brandBackgroundEnd: cleanText(value.brandBackgroundEnd, 32)
  };
  return Object.values(contact).some(Boolean) ? contact : null;
}

function localRecoveryContact(portalKey) {
  if (typeof localStorage === "undefined") return null;
  const quotes = JSON.parse(localStorage.getItem(LOCAL_QUOTES_KEY) || "[]");
  const quote = quotes.find((item) => String(item?.portalKey || "").trim() === portalKey);
  if (!quote || !RECOVERABLE_LOCAL_STATUSES.has(String(quote.status || "").trim().toLowerCase())) return null;
  const meta = quote.quoteMeta || {};
  return normalizeContact({
    brandName: meta.brandName,
    organizationName: meta.organizationName,
    email: meta.businessEmail,
    phone: meta.businessPhone,
    logoUrl: meta.brandLogoUrl,
    brandPrimaryColor: meta.brandPrimaryColor,
    brandAccentColor: meta.brandAccentColor,
    brandDarkAccentColor: meta.brandDarkAccentColor,
    brandBackgroundStart: meta.brandBackgroundStart,
    brandBackgroundMid: meta.brandBackgroundMid,
    brandBackgroundEnd: meta.brandBackgroundEnd
  });
}

export async function getPortalRecoveryContact(portalKey) {
  const key = cleanText(portalKey, 128);
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(key)) return null;

  const adapter = globalThis.__quotePilotE2eFunctions?.getPortalRecoveryContact;
  if (typeof adapter === "function") {
    const result = await adapter({ portalKey: key });
    return normalizeContact(result?.contact);
  }

  if (!cloudFunctions) return localRecoveryContact(key);
  const callable = httpsCallable(cloudFunctions, "getPortalRecoveryContact");
  const response = await callable({ portalKey: key });
  return normalizeContact(response?.data?.contact);
}
