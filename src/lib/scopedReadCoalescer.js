const inFlightReads = new Map();

function requiredScopeValue(name, value) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${name} is required for scoped read coalescing.`);
  return normalized;
}

function stableSerializable(value, seen = new Set()) {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => stableSerializable(item, seen));
  if (typeof value !== "object") throw new Error("Scoped read arguments must be serializable data.");
  if (seen.has(value)) throw new Error("Scoped read arguments must not contain cycles.");
  seen.add(value);
  const result = {};
  Object.keys(value).sort().forEach((key) => {
    if (value[key] === undefined) return;
    result[key] = stableSerializable(value[key], seen);
  });
  seen.delete(value);
  return result;
}

function scopedReadKey({ organizationId, principalId, operation, readArguments }) {
  return JSON.stringify([
    organizationId,
    principalId,
    operation,
    stableSerializable(readArguments ?? {})
  ]);
}

export function coalesceScopedRead({
  organizationId,
  principalId,
  operation,
  arguments: readArguments = {},
  read
} = {}) {
  let scope;
  try {
    scope = {
      organizationId: requiredScopeValue("organizationId", organizationId),
      principalId: requiredScopeValue("principalId", principalId),
      operation: requiredScopeValue("operation", operation)
    };
    if (typeof read !== "function") throw new Error("read is required for scoped read coalescing.");
  } catch (error) {
    return Promise.reject(error);
  }

  let key;
  try {
    key = scopedReadKey({ ...scope, readArguments });
  } catch (error) {
    return Promise.reject(error);
  }
  const existing = inFlightReads.get(key);
  if (existing) return existing.promise;

  let result;
  try {
    result = read();
  } catch (error) {
    return Promise.reject(error);
  }
  const entry = { ...scope, promise: null };
  entry.promise = Promise.resolve(result).finally(() => {
    if (inFlightReads.get(key) === entry) inFlightReads.delete(key);
  });
  inFlightReads.set(key, entry);
  return entry.promise;
}

export function clearScopedReads({ organizationId = "", principalId = "" } = {}) {
  const organizationScope = String(organizationId || "").trim();
  const principalScope = String(principalId || "").trim();
  let cleared = 0;
  for (const [key, entry] of inFlightReads.entries()) {
    if (organizationScope && entry.organizationId !== organizationScope) continue;
    if (principalScope && entry.principalId !== principalScope) continue;
    inFlightReads.delete(key);
    cleared += 1;
  }
  return cleared;
}

export function scopedReadCount() {
  return inFlightReads.size;
}
