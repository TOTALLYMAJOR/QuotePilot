// Local draft recovery for the quote builder (draft-recovery-v1).
// A crash or closed tab must not cost an operator a composed quote, so the
// builder keeps a debounced localStorage snapshot of the in-progress NEW
// draft and offers to resume it on return. Scope is deliberately narrow:
// new drafts only (an edit session always has its saved canonical revision),
// per organization, cleared on explicit discard or a successful save. This
// is loss protection, not persistence — the ordinary save path remains the
// only way a quote exists in the system.

const STORAGE_VERSION = "quotepilot.draft-recovery.v1";
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function text(value) {
  return String(value ?? "").trim();
}

export function draftRecoveryKey({ organizationId = "" } = {}) {
  return `${STORAGE_VERSION}:${text(organizationId) || "local"}:new`;
}

export function writeDraftSnapshot(storage, key, { form, now = Date.now() } = {}) {
  if (!storage || !key || !form || typeof form !== "object") return false;
  try {
    storage.setItem(key, JSON.stringify({
      version: STORAGE_VERSION,
      savedAtMs: now,
      form
    }));
    return true;
  } catch {
    // Quota or privacy-mode failures degrade silently: recovery is an extra
    // safety net, never a required capability.
    return false;
  }
}

export function readDraftSnapshot(storage, key, {
  now = Date.now(),
  maxAgeMs = DEFAULT_MAX_AGE_MS
} = {}) {
  if (!storage || !key) return null;
  let raw = null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    !parsed
    || parsed.version !== STORAGE_VERSION
    || !parsed.form
    || typeof parsed.form !== "object"
    || Array.isArray(parsed.form)
  ) {
    return null;
  }
  const savedAtMs = Number(parsed.savedAtMs);
  if (!Number.isFinite(savedAtMs)) return null;
  const ageMs = Math.max(0, now - savedAtMs);
  if (ageMs > maxAgeMs) return null;
  return { form: parsed.form, savedAtMs, ageMs };
}

export function clearDraftSnapshot(storage, key) {
  if (!storage || !key) return;
  try {
    storage.removeItem(key);
  } catch {
    // ignore
  }
}

// A snapshot is worth offering only when it differs from the pristine
// baseline in a way an operator would miss: any changed text, number, array
// selection, or quantity map relative to the baseline form.
export function snapshotMeaningful(form, baseline) {
  if (!form || typeof form !== "object") return false;
  if (!baseline || typeof baseline !== "object") return false;
  return Object.keys(baseline).some((key) => {
    const base = baseline[key];
    const value = form[key];
    if (Array.isArray(base)) {
      return Array.isArray(value) && value.length > 0;
    }
    if (base && typeof base === "object") {
      return Boolean(value) && typeof value === "object" && Object.keys(value).length > 0;
    }
    if (typeof base === "number") {
      const numeric = Number(value);
      return Number.isFinite(numeric) && numeric !== base;
    }
    if (typeof base === "boolean") {
      return typeof value === "boolean" && value !== base;
    }
    return text(value) !== "" && text(value) !== text(base);
  });
}

export function describeSnapshotAge(ageMs) {
  const age = Number(ageMs);
  if (!Number.isFinite(age) || age < 0) return "recently";
  const minutes = Math.floor(age / 60000);
  if (minutes < 1) return "moments ago";
  if (minutes === 1) return "a minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return "an hour ago";
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "a day ago" : `${days} days ago`;
}
