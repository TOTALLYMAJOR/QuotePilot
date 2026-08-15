// Human summary of an exact commercial-change fact diff
// (commercial-change-diff-v1). The server simulation carries exact before /
// proposed-after values per changed fact; some of those values are entire
// snapshots (pricing catalog, pricing settings). Rendering them raw is
// unreadable, so this module reduces a pair of exact values to field-level
// rows a caterer can read — "Salmon Entrée · price: 28 → 32" — without ever
// inventing data: every row is derived from the two exact values, and the
// exact values themselves stay available behind a disclosure in the panel.
import { humanizeWorkspaceValue } from "../lib/workspacePresentation";

export const COMMERCIAL_CHANGE_DIFF_MODEL = "commercial-change-diff-v1";

const DEFAULT_MAX_ROWS = 8;
// Snapshot diffs can be arbitrarily large; stop collecting past this many
// rows so a pathological pair cannot stall the panel. The disclosure with
// exact data remains the complete record.
const COLLECTION_CAP = 200;
const MAX_TEXT = 48;

function text(value) {
  return String(value ?? "").trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function tryParseJson(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function clip(value) {
  return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT - 1)}…` : value;
}

export function formatDiffValue(value) {
  if (value === undefined || value === null) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : "—";
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? clip(trimmed) : "—";
  }
  try {
    return clip(JSON.stringify(value));
  } catch {
    return "Value";
  }
}

function sameValue(a, b) {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((entry, index) => sameValue(entry, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => sameValue(a[key], b[key]));
  }
  return false;
}

function itemLabel(item, id) {
  return text(item?.name) || text(item?.label) || text(item?.title) || text(id) || "Item";
}

function keyedById(list) {
  return Array.isArray(list)
    && list.length > 0
    && list.every((entry) => isPlainObject(entry) && text(entry.id));
}

function pushRow(out, { path, label, before, after, kind }) {
  if (out.rows.length >= COLLECTION_CAP) {
    out.truncated = true;
    return false;
  }
  out.rows.push({
    path,
    label: label || "Value",
    before,
    after,
    kind
  });
  return true;
}

function collect(out, path, labelParts, before, after) {
  if (out.truncated || sameValue(before, after)) return;

  if (keyedById(before) && keyedById(after)) {
    const beforeById = new Map(before.map((entry) => [text(entry.id), entry]));
    const afterById = new Map(after.map((entry) => [text(entry.id), entry]));
    const ids = [...new Set([...beforeById.keys(), ...afterById.keys()])];
    for (const id of ids) {
      if (out.truncated) return;
      const beforeItem = beforeById.get(id);
      const afterItem = afterById.get(id);
      const name = itemLabel(afterItem || beforeItem, id);
      const itemPath = `${path}[${id}]`;
      if (beforeItem && !afterItem) {
        pushRow(out, { path: itemPath, label: [...labelParts, name].join(" · "), before: "Included", after: "Removed", kind: "removed" });
      } else if (!beforeItem && afterItem) {
        pushRow(out, { path: itemPath, label: [...labelParts, name].join(" · "), before: "—", after: "Added", kind: "added" });
      } else {
        collect(out, itemPath, [...labelParts, name], beforeItem, afterItem);
      }
    }
    return;
  }

  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    for (const key of keys) {
      if (out.truncated) return;
      // Identity fields never differ inside a matched pair and read as noise.
      if (["id"].includes(key)) continue;
      collect(
        out,
        path ? `${path}.${key}` : key,
        [...labelParts, humanizeWorkspaceValue(key, { emptyLabel: key })],
        before[key],
        after[key]
      );
    }
    return;
  }

  pushRow(out, {
    path: path || "value",
    label: labelParts.join(" · "),
    before: formatDiffValue(before),
    after: formatDiffValue(after),
    kind: "changed"
  });
}

// Reduce one exact before/proposed-after pair to display rows.
// Returns { rows, total, moreCount, truncated } where rows.length <= maxRows.
export function summarizeExactDiff(before, proposedAfter, { maxRows = DEFAULT_MAX_ROWS } = {}) {
  const out = { rows: [], truncated: false };
  collect(out, "", [], tryParseJson(before), tryParseJson(proposedAfter));
  const total = out.rows.length;
  const rows = out.rows.slice(0, Math.max(1, maxRows));
  return {
    modelId: COMMERCIAL_CHANGE_DIFF_MODEL,
    rows,
    total,
    moreCount: Math.max(0, total - rows.length),
    truncated: out.truncated
  };
}

// Plain-language rendering of a dependency trigger list:
// ["fact.guest_count", "fact.venue"] → "Guest count, Venue".
export function humanizeTriggerList(triggeredBy) {
  const entries = (Array.isArray(triggeredBy) ? triggeredBy : [])
    .map((entry) => humanizeWorkspaceValue(text(entry).replace(/^fact\./, ""), { emptyLabel: "" }))
    .filter(Boolean);
  return entries.join(", ");
}
