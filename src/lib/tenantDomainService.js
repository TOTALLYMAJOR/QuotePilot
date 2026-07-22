import { httpsCallable } from "firebase/functions";
import { cloudFunctions } from "./firebase";

const BASE_DOMAIN = String(import.meta.env.VITE_BASE_DOMAIN || "mbmapps.com").trim().toLowerCase() || "mbmapps.com";
const SHARED_APP_HOSTS = new Set(
  String(import.meta.env.VITE_SHARED_APP_HOSTS || `app.${BASE_DOMAIN},quotepilot.${BASE_DOMAIN}`)
    .split(",")
    .map((value) => normalizeHostname(value))
    .filter(Boolean)
);
const TENANT_CACHE_KEY = "quoteWizard.tenantContext.v1";
const TENANT_CACHE_TTL_MS = Math.max(60_000, Number(import.meta.env.VITE_TENANT_CONTEXT_TTL_MS || 600_000) || 600_000);
const TENANT_NEGATIVE_CACHE_TTL_MS = Math.max(5_000, Number(import.meta.env.VITE_TENANT_NEGATIVE_TTL_MS || 30_000) || 30_000);
const RESERVED_SUBDOMAINS = new Set(["www", "app", "api", "admin"]);
const RESOLVE_TENANT_CALLABLE = "resolveTenantByHost";

export function normalizeHostname(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  return raw
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.+$/, "");
}

export function getHostType(hostname = "") {
  const normalizedHost = normalizeHostname(hostname);
  if (!normalizedHost) return "unknown";
  if (normalizedHost === "localhost" || normalizedHost.endsWith(".localhost")) return "local";
  if (normalizedHost === "127.0.0.1" || normalizedHost === "::1") return "local";
  if (normalizedHost.endsWith(".web.app") || normalizedHost.endsWith(".firebaseapp.com")) return "app";
  if (SHARED_APP_HOSTS.has(normalizedHost)) return "app";
  if (normalizedHost === BASE_DOMAIN || normalizedHost === `www.${BASE_DOMAIN}`) return "marketing";
  if (normalizedHost.endsWith(`.${BASE_DOMAIN}`)) {
    const label = normalizedHost.slice(0, -1 * (`.${BASE_DOMAIN}`.length)).split(".")[0];
    if (RESERVED_SUBDOMAINS.has(label)) return "reserved";
    return "tenant";
  }
  return "unknown";
}

export function getCurrentHostname() {
  if (typeof window === "undefined") return "";
  return normalizeHostname(window.location.hostname);
}

function readTenantCache() {
  if (typeof window === "undefined" || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(TENANT_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeTenantCache(cache = {}) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(TENANT_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // no-op: cache writes are best effort only
  }
}

export function readCachedTenantContext(hostname = "") {
  const normalizedHost = normalizeHostname(hostname);
  if (!normalizedHost) return null;
  const cache = readTenantCache();
  const entry = cache[normalizedHost];
  if (!entry || typeof entry !== "object") return null;
  const expiresAtMs = Number(entry.expiresAtMs || 0);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    return null;
  }
  return entry.context && typeof entry.context === "object"
    ? { ...entry.context, source: "cache" }
    : null;
}

export function cacheTenantContext(hostname = "", context = {}, { negative = false } = {}) {
  const normalizedHost = normalizeHostname(hostname);
  if (!normalizedHost) return;
  const cache = readTenantCache();
  const ttl = negative ? TENANT_NEGATIVE_CACHE_TTL_MS : TENANT_CACHE_TTL_MS;
  cache[normalizedHost] = {
    expiresAtMs: Date.now() + ttl,
    context
  };
  writeTenantCache(cache);
}

export function clearTenantContextCache() {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.removeItem(TENANT_CACHE_KEY);
  } catch {
    // no-op
  }
}

export async function resolveTenantByHost(hostname = "") {
  const normalizedHost = normalizeHostname(hostname);
  if (!normalizedHost) {
    throw new Error("hostname is required.");
  }
  if (!cloudFunctions) {
    throw new Error("Tenant resolver is unavailable.");
  }

  const call = httpsCallable(cloudFunctions, RESOLVE_TENANT_CALLABLE);
  const result = await call({ hostname: normalizedHost });
  const tenant = result?.data || {};
  return {
    hostname: normalizeHostname(tenant.hostname || normalizedHost),
    hostType: String(tenant.hostType || getHostType(normalizedHost)).trim().toLowerCase() || "unknown",
    organizationId: String(tenant.organizationId || "").trim().toLowerCase(),
    active: tenant.active !== false,
    environment: String(tenant.environment || "prod").trim().toLowerCase(),
    brandingRef: String(tenant.brandingRef || "").trim(),
    resolvedAtISO: String(tenant.resolvedAtISO || new Date().toISOString()),
    source: "resolver"
  };
}
