import { useEffect, useMemo, useState } from "react";
import {
  PORTAL_CONVERSATION_BODY_MAX_LENGTH,
  buildPortalConversationClientRequestId,
  loadQuotePortalConversation,
  sendQuotePortalConversationMessage
} from "../lib/portalConversationClient";

function accessIdentity(access = {}) {
  return [
    access?.accessMode,
    access?.organizationId,
    access?.quoteId,
    access?.portalKey
  ].map((value) => String(value || "").trim()).join(":");
}

function friendlyConversationError(error, fallback) {
  const message = String(error?.message || fallback || "Conversation is temporarily unavailable.")
    .replace(/^FirebaseError:\s*/i, "")
    .trim();
  return message || fallback;
}

export function mergeConversationMessages(current, incoming) {
  const byId = new Map();
  for (const message of [...(current || []), ...(incoming || [])]) {
    if (message?.messageId) byId.set(message.messageId, message);
  }
  return [...byId.values()].sort((a, b) => (
    Date.parse(a.createdAtISO || "") - Date.parse(b.createdAtISO || "")
    || String(a.messageId).localeCompare(String(b.messageId))
  ));
}

export function formatConversationTimestamp(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Time unavailable";
  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export default function QuoteConversationPanel({
  access,
  title = "Quote conversation",
  defaultOpen = false,
  onClose = null
}) {
  const identity = useMemo(() => accessIdentity(access), [
    access?.accessMode,
    access?.organizationId,
    access?.quoteId,
    access?.portalKey
  ]);
  const [open, setOpen] = useState(defaultOpen);
  const [phase, setPhase] = useState(defaultOpen ? "loading" : "closed");
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState("");
  const [pendingRequestId, setPendingRequestId] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [readOnly, setReadOnly] = useState(false);
  const [readOnlyReason, setReadOnlyReason] = useState("");

  const load = async ({ refresh = false } = {}) => {
    setPhase(refresh && messages.length ? "refreshing" : "loading");
    setError("");
    setStatus("");
    try {
      const result = await loadQuotePortalConversation(access);
      setMessages(result.messages);
      setReadOnly(result.readOnly);
      setReadOnlyReason(result.readOnlyReason);
      setPhase("ready");
      if (refresh) setStatus("Conversation refreshed.");
    } catch (loadError) {
      setPhase(refresh && messages.length ? "refresh_error" : "load_error");
      setError(friendlyConversationError(loadError, "Unable to load this quote conversation."));
    }
  };

  const openConversation = () => {
    setOpen(true);
    void load();
  };

  const closeConversation = () => {
    setOpen(false);
    setPhase("closed");
    setError("");
    setStatus("");
    if (typeof onClose === "function") onClose();
  };

  const updateBody = (nextBody) => {
    setBody(nextBody);
    if (phase === "send_error") {
      setPendingRequestId("");
      setError("");
      setPhase("ready");
    }
    setStatus("");
  };

  const send = async () => {
    const normalizedBody = body.trim();
    if (!normalizedBody || readOnly) return;
    const clientRequestId = pendingRequestId || buildPortalConversationClientRequestId();
    setPendingRequestId(clientRequestId);
    setPhase("sending");
    setError("");
    setStatus("");
    try {
      const result = await sendQuotePortalConversationMessage({
        access,
        body: normalizedBody,
        clientRequestId
      });
      setMessages((current) => mergeConversationMessages(current, [result.message]));
      setReadOnly(result.readOnly);
      setReadOnlyReason(result.readOnlyReason);
      setBody("");
      setPendingRequestId("");
      setPhase("success");
      setStatus(result.idempotent
        ? "Message was already delivered. The conversation is up to date."
        : "Message sent.");
    } catch (sendError) {
      setPhase("send_error");
      setError(friendlyConversationError(sendError, "Message was not sent. Retry when ready."));
    }
  };

  useEffect(() => {
    setMessages([]);
    setBody("");
    setPendingRequestId("");
    setError("");
    setStatus("");
    setReadOnly(false);
    setReadOnlyReason("");
    if (defaultOpen) {
      setOpen(true);
      void load();
    } else {
      setOpen(false);
      setPhase("closed");
    }
    // The normalized access identity is the boundary that requires a reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, defaultOpen]);

  if (!open) {
    return (
      <section className="quote-conversation-launch">
        <div>
          <h3>{title}</h3>
          <p>Keep quote questions and answers with this proposal.</p>
        </div>
        <button type="button" className="ghost" onClick={openConversation}>
          Open conversation
        </button>
      </section>
    );
  }

  const busy = phase === "loading" || phase === "refreshing" || phase === "sending";
  const canSend = !readOnly && body.trim().length > 0 && !busy;
  return (
    <section className="quote-conversation" aria-busy={busy} aria-labelledby="quote-conversation-title">
      <header className="quote-conversation-head">
        <div>
          <p className="eyebrow">Quote messages</p>
          <h3 id="quote-conversation-title">{title}</h3>
        </div>
        <div className="quote-conversation-head-actions">
          <button
            type="button"
            className="ghost compact"
            onClick={() => void load({ refresh: true })}
            disabled={busy}
          >
            {phase === "refreshing" ? "Refreshing..." : "Refresh conversation"}
          </button>
          <button type="button" className="ghost compact" onClick={closeConversation}>
            Close conversation
          </button>
        </div>
      </header>

      {phase === "loading" && (
        <p className="source-note" role="status">Loading conversation...</p>
      )}
      {phase === "load_error" && (
        <div className="quote-conversation-recovery">
          <p className="error-note" role="alert">{error}</p>
          <button type="button" className="ghost" onClick={() => void load()}>
            Retry conversation
          </button>
        </div>
      )}

      {phase !== "loading" && phase !== "load_error" && (
        <>
          <div className="quote-conversation-messages" aria-live="polite">
            {messages.length === 0 ? (
              <p className="source-note">No messages yet. Start with a question or update about this quote.</p>
            ) : messages.map((message) => (
              <article
                key={message.messageId}
                className={`quote-conversation-message actor-${message.actorType}`}
              >
                <header>
                  <strong>{message.actorName}</strong>
                  <span>{message.actorType === "staff" ? "Catering team" : "Customer"}</span>
                  <time dateTime={message.createdAtISO}>
                    {formatConversationTimestamp(message.createdAtISO)}
                  </time>
                </header>
                <p>{message.body}</p>
              </article>
            ))}
          </div>

          {readOnly ? (
            <p className="warning-note" role="status">
              {readOnlyReason || "This conversation is read-only."}
            </p>
          ) : (
            <div className="quote-conversation-compose">
              <label className="field">
                <span>Message</span>
                <textarea
                  rows="4"
                  maxLength={PORTAL_CONVERSATION_BODY_MAX_LENGTH}
                  value={body}
                  disabled={phase === "sending"}
                  onChange={(event) => updateBody(event.target.value)}
                  placeholder="Ask a question or share an update"
                />
              </label>
              <div className="quote-conversation-compose-footer">
                <small>{body.length}/{PORTAL_CONVERSATION_BODY_MAX_LENGTH}</small>
                <button
                  type="button"
                  className="cta"
                  onClick={() => void send()}
                  disabled={!canSend}
                  aria-busy={phase === "sending"}
                >
                  {phase === "sending"
                    ? "Sending message..."
                    : phase === "send_error" && pendingRequestId
                      ? "Retry message"
                      : "Send message"}
                </button>
              </div>
            </div>
          )}
          {phase === "send_error" && <p className="error-note" role="alert">{error}</p>}
          {phase === "refresh_error" && <p className="error-note" role="alert">{error}</p>}
          {status && <p className="source-note" role="status">{status}</p>}
        </>
      )}
    </section>
  );
}
