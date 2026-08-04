const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

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
  return isBuyerAccessEnabled(env) && TRUE_VALUES.has(
    String(env.VITE_BUYER_ACCESS_PUBLIC_CTA_ENABLED || "").trim().toLowerCase()
  );
}

export function isBuyerE2eAuthBypassEnabled(env = {}) {
  return TRUE_VALUES.has(
    String(env.VITE_E2E_BYPASS_AUTH || "").trim().toLowerCase()
  );
}
