import { useEffect, useState } from "react";
import { appendPortalMessage, getPortalMessages } from "../lib/quoteStore";

function formatTimestamp(value) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

export default function QuoteConversationModal({ quote, currentUserEmail = "", onClose, onToast }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const portalKey = String(quote?.portalKey || "").trim();

  const load = async () => {
    if (!portalKey) return;
    setLoading(true);
    setError("");
    try {
      setMessages(await getPortalMessages(portalKey));
    } catch (err) {
      setError(err?.message || "Unable to load the conversation.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [portalKey]);

  const send = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    setError("");
    try {
      await appendPortalMessage({
        portalKey,
        body: draft,
        authorType: "staff",
        authorName: currentUserEmail || "Quote team"
      });
      setDraft("");
      await load();
      onToast?.("Reply sent to the customer portal.", "success");
    } catch (err) {
      setError(err?.message || "Unable to send the reply.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="confirm-modal portal-chat-modal" role="dialog" aria-modal="true" aria-labelledby="staff-chat-title">
      <div className="portal-chat-head">
        <div>
          <span>Customer conversation</span>
          <h3 id="staff-chat-title">{quote?.quoteNumber || "Quote"} · {quote?.customer?.name || quote?.customer?.email || "Customer"}</h3>
        </div>
        <button type="button" className="ghost compact" onClick={onClose}>Close</button>
      </div>
      {error && <p className="error-note">{error}</p>}
      <div className="portal-chat-thread">
        {loading && <p className="source-note">Loading conversation...</p>}
        {!loading && messages.length === 0 && <p className="source-note">No portal messages yet.</p>}
        {messages.map((message) => (
          <article className={`portal-chat-message ${message.authorType}`} key={message.id}>
            <div><strong>{message.authorName || message.authorType}</strong><time>{formatTimestamp(message.createdAtISO)}</time></div>
            <p>{message.body}</p>
          </article>
        ))}
      </div>
      <label className="field portal-chat-compose">
        <span>Reply</span>
        <textarea rows="3" maxLength="1200" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Reply to the customer" />
      </label>
      <div className="portal-decision-submit">
        <button type="button" className="cta" onClick={send} disabled={busy || !draft.trim()}>{busy ? "Sending..." : "Send Reply"}</button>
      </div>
    </div>
  );
}
