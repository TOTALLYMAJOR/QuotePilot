const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normalizedText(value) {
  return String(value ?? "").trim();
}

function parseWorkspaceDate(value, { dateOnly = false } = {}) {
  const raw = normalizedText(value);
  if (!raw) return null;
  const parsed = DATE_ONLY_PATTERN.test(raw) || dateOnly
    ? new Date(`${raw.slice(0, 10)}T12:00:00.000Z`)
    : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatWorkspaceDate(value, { emptyLabel = "Date not set" } = {}) {
  const raw = normalizedText(value);
  const parsed = parseWorkspaceDate(raw);
  if (!parsed) return emptyLabel;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(DATE_ONLY_PATTERN.test(raw) ? { timeZone: "UTC" } : {})
  }).format(parsed);
}

export function formatWorkspaceDateTime(value, { emptyLabel = "Time not recorded" } = {}) {
  const parsed = parseWorkspaceDate(value);
  if (!parsed) return emptyLabel;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(parsed);
}

export function hasWorkspaceNumber(value) {
  return value !== null
    && value !== undefined
    && normalizedText(value) !== ""
    && Number.isFinite(Number(value));
}

export function formatWorkspaceMoney(value, { emptyLabel = "Amount not recorded" } = {}) {
  if (!hasWorkspaceNumber(value)) return emptyLabel;
  const amount = Number(value);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
}

export function formatWorkspaceInteger(value, { emptyLabel = "Not recorded" } = {}) {
  if (!hasWorkspaceNumber(value)) return emptyLabel;
  const number = Number(value);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(number));
}

export function humanizeWorkspaceValue(value, {
  emptyLabel = "Not recorded",
  labels = {}
} = {}) {
  const raw = normalizedText(value);
  if (!raw) return emptyLabel;
  const normalized = raw.toLowerCase();
  if (labels[normalized]) return labels[normalized];
  const readable = raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return readable ? readable.charAt(0).toUpperCase() + readable.slice(1) : emptyLabel;
}

export function formatWorkspaceSource(value) {
  const source = normalizedText(value).toLowerCase();
  if (source === "firebase") return "Firestore staff records";
  if (source === "local") return "Browser-local workspace";
  if (source === "mixed") return "Mixed staff read sources";
  if (source === "firebase-required") return "Firestore connection required";
  return humanizeWorkspaceValue(source, { emptyLabel: "Source not confirmed" });
}

export function formatWorkspaceText(value, { emptyLabel = "Not recorded" } = {}) {
  return normalizedText(value) || emptyLabel;
}
