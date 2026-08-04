const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const TURNSTILE_SITE_KEY_PATTERN = /^[A-Za-z0-9_-]{10,100}$/;

export function isBuyerAccessEnabled(env = {}) {
  const explicitlyEnabled = TRUE_VALUES.has(
    String(env.VITE_BUYER_ACCESS_ENABLED || "").trim().toLowerCase()
  );
  const e2eAuthBypass = TRUE_VALUES.has(
    String(env.VITE_E2E_BYPASS_AUTH || "").trim().toLowerCase()
  );
  return explicitlyEnabled || e2eAuthBypass;
}

export function isBuyerAccessPublicCtaEnabled(env = {}) {
  return isBuyerAccessEnabled(env)
    && TRUE_VALUES.has(
      String(env.VITE_BUYER_ACCESS_PUBLIC_CTA_ENABLED || "").trim().toLowerCase()
    )
    && isBuyerAccessTurnstileConfigured(env);
}

export function getBuyerAccessTurnstileSiteKey(env = {}) {
  return String(env.VITE_BUYER_ACCESS_TURNSTILE_SITE_KEY || "").trim();
}

export function isBuyerAccessTurnstileConfigured(env = {}) {
  const siteKey = getBuyerAccessTurnstileSiteKey(env);
  return TURNSTILE_SITE_KEY_PATTERN.test(siteKey)
    && !/^(?:your_|replace_|changeme$)/i.test(siteKey);
}

export function isBuyerE2eAuthBypassEnabled(env = {}) {
  return TRUE_VALUES.has(
    String(env.VITE_E2E_BYPASS_AUTH || "").trim().toLowerCase()
  );
}
