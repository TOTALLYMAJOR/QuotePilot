import { useEffect, useMemo, useRef, useState } from "react";
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

const DEFINITIVE_CONVERSATION_ERROR_CODES = new Set([
  "failed-precondition",
  "invalid-argument",
  "not-found",
  "permission-denied",
  "resource-exhausted",
  "unauthenticated"
]);

export function isDefinitiveConversationSendError(error) {
  const code = String(error?.code || "")
    .trim()
    .toLowerCase()
    .replace(/^functions\//, "");
  if (DEFINITIVE_CONVERSATION_ERROR_CODES.has(code)) return true;

  const message = String(error?.message || "").replace(/^FirebaseError:\s*/i, "").trim();
  return [
    /requires a connected QuotePilot workspace/i,
    /open the current customer portal link/i,
    /quote and organization are required/i,
    /conversation access mode is invalid/i,
    /enter a message before sending/i,
    /messages must be .* characters or fewer/i,
    /safe message retry id is required/i
  ].some((pattern) => pattern.test(message));
}

export function buildConversationCloseGuard({ phase = "ready", pendingRequestId = "" } = {}) {
  const hasPendingRequest = Boolean(String(pendingRequestId || "").trim());
  const blocked = phase === "sending" || hasPendingRequest;
  return {
    blocked,
    message: blocked
      ? (phase === "sending"
          ? "Keep this conversation open until the message request returns a receipt."
          : "Reconcile the unresolved message request before closing this conversation.")
      : ""
  };
}

export function isConversationRequestGenerationCurrent({
  requestGeneration = 0,
  currentGeneration = 0,
  requestIdentity = "",
  currentIdentity = ""
} = {}) {
  return Number(requestGeneration) === Number(currentGeneration)
    && String(requestIdentity || "") === String(currentIdentity || "");
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

export function buildConversationMutationPresentation({
  phase = "ready",
  pendingRequestId = "",
  sendMode = "idle",
  error = "",
  status = ""
} = {}) {
  const hasPendingRequest = Boolean(String(pendingRequestId || "").trim());
  const normalizedError = String(error || "").trim();
  const normalizedStatus = String(status || "").trim();

  if (phase === "sending" && sendMode === "reconcile") {
    return {
      state: "reconciliation",
      actionLabel: "Reconciling message...",
      title: "Reconciling message",
      detail: "The same request identity is being retried. Waiting for the quote conversation receipt.",
      error: ""
    };
  }
  if (phase === "sending") {
    return {
      state: "submitting",
      actionLabel: "Sending message...",
      title: "Submitting message",
      detail: "Waiting for the quote conversation receipt before reporting the message as recorded. Keep this conversation open until the request resolves.",
      error: ""
    };
  }
  if (hasPendingRequest) {
    return {
      state: "uncertain",
      actionLabel: "Reconcile message",
      title: "Message outcome is uncertain.",
      detail: "No server receipt returned. Retry the unchanged message to reconcile the same request identity before editing or closing.",
      error: normalizedError
    };
  }
  if (phase === "send_error") {
    return {
      state: "error",
      actionLabel: "Retry message",
      title: "Message needs attention.",
      detail: "No recorded message is assumed. Review the issue and retry when ready.",
      error: normalizedError
    };
  }
  if (phase === "success") {
    return {
      state: "receipt",
      actionLabel: "Send message",
      title: normalizedStatus || "Message recorded in this quote conversation.",
      detail: "The server receipt confirms the conversation record; it does not claim delivery outside QuotePilot.",
      error: ""
    };
  }
  if (phase === "ready" && sendMode === "recovery") {
    return {
      state: "recovery",
      actionLabel: "Send revised message",
      title: "Revised message ready.",
      detail: "Editing cleared the prior retry identity. The earlier request remains unconfirmed until the conversation is refreshed.",
      error: ""
    };
  }
  return {
    state: "ready",
    actionLabel: "Send message",
    title: "Ready to send",
    detail: "Nothing new has been recorded.",
    error: ""
  };
}

export function QuoteConversationMutationStatus({ presentation, showReady = false }) {
  if (!presentation) return null;
  if (!showReady && presentation.state === "ready") return null;
  const alertState = ["uncertain", "error", "recovery"].includes(presentation.state)
    || Boolean(presentation.error);
  return (
    <div
      className="quote-conversation-mutation-status"
      data-capability-state={presentation.state}
      data-mutation-state={presentation.state}
      role={alertState ? "alert" : "status"}
    >
      <p className={alertState ? "warning-note" : "source-note"}>
        <strong>{presentation.title}</strong> {presentation.detail}
      </p>
      {presentation.error && <p className="error-note">{presentation.error}</p>}
    </div>
  );
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
  const [sendMode, setSendMode] = useState("idle");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [readOnly, setReadOnly] = useState(false);
  const [readOnlyReason, setReadOnlyReason] = useState("");
  const requestGenerationRef = useRef(0);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const mutationPresentation = buildConversationMutationPresentation({
    phase,
    pendingRequestId,
    sendMode,
    error,
    status
  });
  const closeGuard = buildConversationCloseGuard({ phase, pendingRequestId });

  useEffect(() => {
    if (!closeGuard.blocked || typeof window === "undefined") return undefined;
    const protectPendingMessage = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectPendingMessage);
    return () => window.removeEventListener("beforeunload", protectPendingMessage);
  }, [closeGuard.blocked]);

  const beginRequestGeneration = () => {
    requestGenerationRef.current += 1;
    return {
      requestGeneration: requestGenerationRef.current,
      requestIdentity: identity
    };
  };

  const requestGenerationIsCurrent = ({ requestGeneration, requestIdentity }) => (
    isConversationRequestGenerationCurrent({
      requestGeneration,
      currentGeneration: requestGenerationRef.current,
      requestIdentity,
      currentIdentity: identityRef.current
    })
  );

  const load = async ({ refresh = false } = {}) => {
    const request = beginRequestGeneration();
    const reconcilingUnknownRequest = Boolean(
      refresh && String(pendingRequestId || "").trim()
    );
    setPhase(refresh && messages.length ? "refreshing" : "loading");
    setError("");
    setStatus("");
    try {
      const result = await loadQuotePortalConversation(access);
      if (!requestGenerationIsCurrent(request)) return;
      setMessages(result.messages);
      setReadOnly(result.readOnly);
      setReadOnlyReason(result.readOnlyReason);
      if (reconcilingUnknownRequest) {
        setPhase("send_error");
        setError("Conversation refreshed, but the prior message request still needs an exact retry to confirm its receipt.");
      } else {
        setPhase("ready");
        if (refresh) setStatus("Conversation refreshed.");
      }
    } catch (loadError) {
      if (!requestGenerationIsCurrent(request)) return;
      setPhase(reconcilingUnknownRequest
        ? "send_error"
        : refresh && messages.length
          ? "refresh_error"
          : "load_error");
      setError(friendlyConversationError(loadError, "Unable to load this quote conversation."));
    }
  };

  const openConversation = () => {
    setOpen(true);
    void load();
  };

  const closeConversation = () => {
    if (closeGuard.blocked) return;
    requestGenerationRef.current += 1;
    setOpen(false);
    setPhase("closed");
    setError("");
    setStatus("");
    if (typeof onClose === "function") onClose();
  };

  const updateBody = (nextBody) => {
    if (closeGuard.blocked) return;
    setBody(nextBody);
    if (phase === "send_error") {
      setPendingRequestId("");
      setError("");
      setSendMode("recovery");
      setPhase("ready");
    } else if (phase === "success") {
      setSendMode("idle");
      setPhase("ready");
    }
    setStatus("");
  };

  const send = async () => {
    const normalizedBody = body.trim();
    if (!normalizedBody || readOnly) return;
    const request = beginRequestGeneration();
    const clientRequestId = pendingRequestId || buildPortalConversationClientRequestId();
    setSendMode(pendingRequestId ? "reconcile" : "submit");
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
      if (!requestGenerationIsCurrent(request)) return;
      setMessages((current) => mergeConversationMessages(current, [result.message]));
      setReadOnly(result.readOnly);
      setReadOnlyReason(result.readOnlyReason);
      setBody("");
      setPendingRequestId("");
      setPhase("success");
      setStatus(result.idempotent
        ? "The existing message request was reconciled. The conversation receipt is current."
        : "Message recorded in this quote conversation.");
    } catch (sendError) {
      if (!requestGenerationIsCurrent(request)) return;
      if (isDefinitiveConversationSendError(sendError)) {
        setPendingRequestId("");
      }
      setPhase("send_error");
      setError(friendlyConversationError(sendError, "The message request did not return a server receipt."));
    }
  };

  useEffect(() => {
    requestGenerationRef.current += 1;
    setMessages([]);
    setBody("");
    setPendingRequestId("");
    setSendMode("idle");
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
          <button
            type="button"
            className="ghost compact"
            onClick={closeConversation}
            disabled={closeGuard.blocked}
            title={closeGuard.message}
          >
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
                  disabled={phase === "sending" || closeGuard.blocked}
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
                  {mutationPresentation.actionLabel}
                </button>
              </div>
            </div>
          )}
          {!readOnly && (
            <QuoteConversationMutationStatus presentation={mutationPresentation} showReady />
          )}
          {phase === "refresh_error" && <p className="error-note" role="alert">{error}</p>}
          {status && phase !== "success" && <p className="source-note" role="status">{status}</p>}
        </>
      )}
    </section>
  );
}
