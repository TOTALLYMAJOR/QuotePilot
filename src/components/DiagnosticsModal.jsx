import { useEffect, useMemo, useState } from "react";
import {
  clearSessionDiagnostics,
  readSessionDiagnostics,
  recordDiagnosticEvent
} from "../lib/sessionDiagnostics";
import { useModalDialog } from "../hooks/useModalDialog";

function formatDateTime(iso) {
  const date = new Date(iso || "");
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function previewContext(context) {
  try {
    const text = JSON.stringify(context || {});
    return text.length > 160 ? `${text.slice(0, 160)}...` : text;
  } catch {
    return "{}";
  }
}

function eventTitle(event) {
  if (event.error?.name) {
    return `${event.error.name}: ${event.message || ""}`.trim();
  }
  return event.message || "-";
}

export default function DiagnosticsModal({ open, onClose, returnFocusRef = null }) {
  const [state, setState] = useState(() => readSessionDiagnostics());
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const refresh = () => {
    setState(readSessionDiagnostics());
  };

  useEffect(() => {
    if (!open) return;
    refresh();
    setFeedback("");
    setError("");
    recordDiagnosticEvent({
      level: "info",
      type: "diagnostics.open",
      message: "Diagnostics modal opened"
    });
  }, [open]);

  const filteredEvents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return state.events;
    return state.events.filter((event) => {
      const haystack = [
        event.level,
        event.type,
        event.message,
        event.error?.name,
        event.error?.message,
        previewContext(event.context)
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [state.events, search]);

  const handleCopyJson = async () => {
    try {
      if (!navigator?.clipboard) {
        throw new Error("Clipboard unavailable in this browser.");
      }
      await navigator.clipboard.writeText(JSON.stringify(state, null, 2));
      setError("");
      setFeedback("Diagnostics JSON copied.");
      recordDiagnosticEvent({
        level: "info",
        type: "diagnostics.copy",
        message: "Diagnostics JSON copied",
        context: {
          eventCount: state.summary.total
        }
      });
    } catch (err) {
      setFeedback("");
      setError(err?.message || "Failed to copy diagnostics JSON.");
    }
  };

  const handleClear = () => {
    clearSessionDiagnostics();
    setState(readSessionDiagnostics());
    setError("");
    setFeedback("Diagnostics cleared.");
  };
  const { dialogRef } = useModalDialog({
    open,
    onRequestClose: onClose,
    returnFocusRef
  });

  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-diagnostics-title"
      tabIndex={-1}
    >
      <div className="modal-card diagnostics-card">
        <div className="modal-head">
          <h2 id="session-diagnostics-title">Session Diagnostics</h2>
          <div className="right-actions">
            <button type="button" className="ghost" onClick={refresh}>Refresh</button>
            <button type="button" className="ghost" data-modal-initial-focus onClick={onClose}>Close</button>
          </div>
        </div>

        {error && <p className="error-note">{error}</p>}
        {feedback && <p className="source-note">{feedback}</p>}

        <section className="admin-section">
          <div className="admin-section-head">
            <h3>Session</h3>
          </div>
          <div className="diagnostics-session-grid">
            <span><strong>Session ID:</strong> {state.session.sessionId || "-"}</span>
            <span><strong>App:</strong> {state.session.appName || "-"} {state.session.appVersion || ""}</span>
            <span><strong>Started:</strong> {formatDateTime(state.session.startedAtISO)}</span>
            <span><strong>Updated:</strong> {formatDateTime(state.session.lastUpdatedAtISO)}</span>
            <span><strong>User:</strong> {state.session.user?.email || "anonymous"}</span>
            <span><strong>Role:</strong> {state.session.user?.role || "-"}</span>
            <span><strong>Path:</strong> {state.session.path || "-"}</span>
            <span>
              <strong>Viewport:</strong> {state.session.viewport?.width || 0}x{state.session.viewport?.height || 0}
            </span>
          </div>
          <div className="status-strip">
            <span>Total events: <strong>{state.summary.total}</strong></span>
            <span>Errors: <strong>{state.summary.errors}</strong></span>
            <span>Warnings: <strong>{state.summary.warnings}</strong></span>
            <span>Info: <strong>{state.summary.info}</strong></span>
            <span>Last error: <strong>{formatDateTime(state.summary.lastErrorAtISO)}</strong></span>
          </div>
        </section>

        <section className="admin-section">
          <div className="admin-section-head">
            <h3>Recent Events</h3>
          </div>
          <div className="diagnostics-controls">
            <input
              type="text"
              placeholder="Search level, type, message, context"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className="right-actions">
              <button type="button" className="ghost compact" onClick={handleCopyJson}>Copy JSON</button>
              <button type="button" className="ghost compact" onClick={handleClear}>Clear</button>
            </div>
          </div>
          <div className="history-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Level</th>
                  <th>Type</th>
                  <th>Message</th>
                  <th>Context</th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.length === 0 && (
                  <tr>
                    <td colSpan="5">No diagnostics events captured.</td>
                  </tr>
                )}
                {filteredEvents.map((event) => (
                  <tr key={event.id}>
                    <td>{formatDateTime(event.atISO)}</td>
                    <td>{event.level || "-"}</td>
                    <td>{event.type || "-"}</td>
                    <td>{eventTitle(event)}</td>
                    <td className="diagnostics-context">{previewContext(event.context)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
