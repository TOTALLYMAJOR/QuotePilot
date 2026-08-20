const GOOGLE_IMAGE_RESULT_HOSTS = new Set([
  "google.com",
  "www.google.com",
  "images.google.com"
]);

const DATA_IMAGE_PATTERN = /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i;

function clean(value) {
  return String(value || "").trim();
}

function isSafeRelativeAssetPath(value) {
  return value.startsWith("/")
    && !value.startsWith("//")
    && !/[\s<>"'`]/.test(value);
}

function extractGoogleImageResultUrl(url) {
  if (!GOOGLE_IMAGE_RESULT_HOSTS.has(url.hostname.toLowerCase())) return "";
  const direct = clean(url.searchParams.get("imgurl"));
  if (!direct) return "";
  try {
    const parsed = new URL(direct);
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

export function normalizeBrandLogoUrl(value, { allowData = true, allowRelative = true } = {}) {
  const raw = clean(value);
  if (!raw) return "";
  if (allowData && DATA_IMAGE_PATTERN.test(raw)) return raw;
  if (allowRelative && isSafeRelativeAssetPath(raw)) return raw;

  try {
    const parsed = new URL(raw);
    const indirectImageUrl = extractGoogleImageResultUrl(parsed);
    if (indirectImageUrl) return indirectImageUrl;
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

export function logoUrlWasNormalized(value, normalized = normalizeBrandLogoUrl(value)) {
  const raw = clean(value);
  return Boolean(raw && normalized && raw !== normalized);
}
