import { useSyncExternalStore } from "react";
import "./ambient.css";

let undoSequence = 0;

function boundedLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 5;
  return Math.max(1, Math.min(20, Math.floor(number)));
}

function freezeEntries(entries) {
  return Object.freeze(entries.map((entry) => Object.freeze({ ...entry })));
}

export function createAmbientUndoModel({
  limit = 5,
  now = () => Date.now(),
  createId,
  onChange
} = {}) {
  const maxEntries = boundedLimit(limit);
  const listeners = new Set();
  let entries = freezeEntries([]);

  function notify(nextEntries) {
    entries = freezeEntries(nextEntries);
    listeners.forEach((listener) => listener());
    onChange?.(entries);
  }

  function generatedId() {
    undoSequence += 1;
    return typeof createId === "function"
      ? String(createId())
      : `ambient-undo-${Number(now())}-${undoSequence}`;
  }

  function push(candidate) {
    if (!candidate || typeof candidate.undo !== "function") {
      throw new TypeError("An ambient undo entry requires an undo function.");
    }
    const label = String(candidate.label || "").trim();
    if (!label) throw new TypeError("An ambient undo entry requires a label.");
    const id = String(candidate.id || generatedId());
    const entry = {
      id,
      label,
      detail: candidate.detail || "",
      actionId: candidate.actionId ? String(candidate.actionId) : "",
      undo: candidate.undo,
      failureMessage: String(candidate.failureMessage || "This change could not be undone. Try again."),
      createdAt: Number.isFinite(Number(candidate.createdAt)) ? Number(candidate.createdAt) : Number(now()),
      status: "ready",
      error: ""
    };
    notify([entry, ...entries.filter((item) => item.id !== id)].slice(0, maxEntries));
    return id;
  }

  function replace(id, update) {
    let changed = false;
    const nextEntries = entries.map((entry) => {
      if (entry.id !== id) return entry;
      changed = true;
      return { ...entry, ...update };
    });
    if (changed) notify(nextEntries);
    return changed;
  }

  async function undo(id = entries[0]?.id) {
    const entry = entries.find((item) => item.id === id);
    if (!entry || entry.status === "pending") return false;
    replace(id, { status: "pending", error: "" });
    try {
      const result = await entry.undo();
      if (result === false) throw new Error("undo-refused");
      notify(entries.filter((item) => item.id !== id));
      return true;
    } catch {
      replace(id, { status: "failed", error: entry.failureMessage });
      return false;
    }
  }

  function dismiss(id) {
    const entry = entries.find((item) => item.id === id);
    if (!entry || entry.status === "pending") return false;
    notify(entries.filter((item) => item.id !== id));
    return true;
  }

  function clear() {
    if (entries.some((entry) => entry.status === "pending")) return false;
    if (!entries.length) return true;
    notify([]);
    return true;
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return Object.freeze({
    limit: maxEntries,
    push,
    undo,
    dismiss,
    clear,
    subscribe,
    getSnapshot: () => entries
  });
}

const EMPTY_SNAPSHOT = Object.freeze([]);
const EMPTY_MODEL = Object.freeze({
  subscribe: () => () => {},
  getSnapshot: () => EMPTY_SNAPSHOT,
  undo: async () => false,
  clear: () => false
});

export default function AmbientUndoRail({
  model,
  label = "Recent changes",
  onClearStart,
  onClear,
  onUndoStart,
  onUndoResult,
  clearActionId,
  undoActionId,
  className = ""
}) {
  const source = model?.subscribe && model?.getSnapshot ? model : EMPTY_MODEL;
  const entries = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
  if (!entries.length) return null;
  const hasPending = entries.some((entry) => entry.status === "pending");

  const clearHistory = () => {
    const clearContext = onClearStart?.({ count: entries.length });
    const cleared = source.clear();
    onClear?.({ cleared, count: entries.length, clearContext });
  };

  const undoEntry = async (entry) => {
    const undoContext = onUndoStart?.({ entry });
    const resolved = await source.undo(entry.id);
    onUndoResult?.({ entry, resolved, undoContext });
  };

  const resolveUndoActionId = (entry) => {
    if (typeof undoActionId === "function") return undoActionId(entry) || undefined;
    return entry.actionId || undoActionId || undefined;
  };

  return (
    <section
      className={["ambient-undo-rail", className].filter(Boolean).join(" ")}
      aria-label={typeof label === "string" ? label : "Recent changes"}
      data-ambient-undo-count={entries.length}
    >
      <header className="ambient-undo-rail__header">
        <h2>{label}</h2>
        <button
          type="button"
          onClick={clearHistory}
          disabled={hasPending}
          data-ambient-action-id={clearActionId || undefined}
        >
          Clear history
        </button>
      </header>
      <ol className="ambient-undo-rail__list">
        {entries.map((entry, index) => (
          <li key={entry.id} className="ambient-undo-rail__item" data-undo-state={entry.status}>
            <div>
              <strong>{entry.label}</strong>
              {entry.detail && <span>{entry.detail}</span>}
              {entry.status === "pending" && <span role="status">Undoing {entry.label}</span>}
              {entry.error && <span role="alert">{entry.error}</span>}
            </div>
            <button
              type="button"
              onClick={() => undoEntry(entry)}
              disabled={hasPending || index > 0}
              title={index > 0 ? "Undo newer scenario changes first." : undefined}
              aria-label={`${entry.status === "failed" ? "Try undo again for" : "Undo"} ${entry.label}`}
              data-ambient-action-id={resolveUndoActionId(entry)}
            >
              {entry.status === "pending" ? "Undoing" : entry.status === "failed" ? "Try again" : "Undo"}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
