const ENABLED_BUILD_VALUES = new Set(["1", "true", "yes", "on"]);

export function resolveQuoteCompletionCommandPathGate({
  buildValue = "",
  tenantValue = false
} = {}) {
  return ENABLED_BUILD_VALUES.has(String(buildValue).trim().toLowerCase())
    && tenantValue === true;
}

export default resolveQuoteCompletionCommandPathGate;
