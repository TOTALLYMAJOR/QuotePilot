import { useEffect, useMemo, useRef, useState } from "react";
import {
  PORTAL_CONVERSATION_BODY_MAX_LENGTH,
  buildPortalConversationClientRequestId,
  loadQuotePortalConversation,
  sendQuotePortalConversationMessage
} from "../lib/portalConversationClient";
import {
  isConversationSignalNewer,
  subscribeToConversationSignal
} from "../lib/conversationSignalClient";
import { auth } from "../lib/firebase";

const pendingConversationAttempts = new Map();
const MAX_PENDING_CONVERSATION_ATTEMPTS = 25;
let pendingConversationUnloadTarget = null;

function protectPendingConversationAttempt(event) {
  event.preventDefault();
  event.returnValue = "";
}

function browserUnloadTarget() {
  return typeof window !== "undefined" ? window : null;
}

export function syncConversationPendingAttemptUnloadGuard(
  requestedTarget = browserUnloadTarget()
) {
  const hasPendingAttempts = pendingConversationAttempts.size > 0;
  if (!hasPendingAttempts) {
    pendingConversationUnloadTarget?.removeEventListener(
      "beforeunload",
      protectPendingConversationAttempt
    );
    pendingConversationUnloadTarget = null;
    return { active: false, pendingCount: 0 };
  }

  const target = requestedTarget && typeof requestedTarget.addEventListener === "function"
    && typeof requestedTarget.removeEventListener === "function"
    ? requestedTarget
    : pendingConversationUnloadTarget;
  if (!target) {
    return { active: false, pendingCount: pendingConversationAttempts.size };
  }
  if (pendingConversationUnloadTarget !== target) {
    pendingConversationUnloadTarget?.removeEventListener(
      "beforeunload",
      protectPendingConversationAttempt
    );
    target.addEventListener("beforeunload", protectPendingConversationAttempt);
    pendingConversationUnloadTarget = target;
  }
  return { active: true, pendingCount: pendingConversationAttempts.size };
}

function accessIdentity(access = {}, authenticatedUid = "") {
  const accessMode = String(access?.accessMode || "").trim();
  return [
    accessMode,
    access?.organizationId,
    access?.quoteId,
    access?.portalKey,
    accessMode === "staff" ? authenticatedUid : ""
  ].map((value) => String(value || "").trim()).join(":");
}

function normalizePendingAttemptIdentity(value) {
  return String(value || "").trim();
}

function normalizePendingAttemptBody(value) {
  return String(value ?? "").trim();
}

export function readConversationPendingAttempt(identity = "") {
  const key = normalizePendingAttemptIdentity(identity);
  const attempt = key ? pendingConversationAttempts.get(key) : null;
  return attempt ? { ...attempt } : null;
}

export function beginConversationPendingAttempt({
  identity = "",
  body = "",
  clientRequestId = "",
  createRequestId = buildPortalConversationClientRequestId
} = {}) {
  const key = normalizePendingAttemptIdentity(identity);
  const normalizedBody = normalizePendingAttemptBody(body);
  if (!key || !normalizedBody || typeof createRequestId !== "function") {
    throw new Error("Conversation identity and message are required for a safe send attempt.");
  }
  const restored = pendingConversationAttempts.get(key) || null;
  if (!restored && pendingConversationAttempts.size >= MAX_PENDING_CONVERSATION_ATTEMPTS) {
    throw new Error(
      "Reconcile an unresolved conversation request before starting another message."
    );
  }
  const requestId = String(
    clientRequestId || restored?.clientRequestId || createRequestId()
  ).trim();
  if (!requestId) {
    throw new Error("A safe message retry id is required.");
  }
  if (
    restored
    && restored.clientRequestId === requestId
    && restored.body !== normalizedBody
  ) {
    throw new Error("The unresolved message must be retried unchanged with its original request identity.");
  }
  const attempt = {
    clientRequestId: requestId,
    body: normalizedBody,
    error: restored?.error || "",
    resetAllowed: restored?.resetAllowed === true
  };
  pendingConversationAttempts.delete(key);
  pendingConversationAttempts.set(key, attempt);
  syncConversationPendingAttemptUnloadGuard();
  return {
    ...attempt,
    sendMode: restored || clientRequestId ? "reconcile" : "submit"
  };
}

export function markConversationPendingAttemptError({
  identity = "",
  clientRequestId = "",
  error = "",
  resetAllowed = false
} = {}) {
  const key = normalizePendingAttemptIdentity(identity);
  const requestId = String(clientRequestId || "").trim();
  const current = key ? pendingConversationAttempts.get(key) : null;
  if (!current || current.clientRequestId !== requestId) return false;
  pendingConversationAttempts.set(key, {
    ...current,
    error: String(error || "").trim(),
    resetAllowed: resetAllowed === true
  });
  syncConversationPendingAttemptUnloadGuard();
  return true;
}

export function clearConversationPendingAttempt({
  identity = "",
  clientRequestId = "",
  resolution = ""
} = {}) {
  if (!["receipt", "safe_reset"].includes(String(resolution || "").trim())) {
    return false;
  }
  const key = normalizePendingAttemptIdentity(identity);
  const requestId = String(clientRequestId || "").trim();
  const current = key ? pendingConversationAttempts.get(key) : null;
  if (!current || current.clientRequestId !== requestId) return false;
  pendingConversationAttempts.delete(key);
  syncConversationPendingAttemptUnloadGuard();
  return true;
}

function friendlyConversationError(error, fallback) {
  const message = String(error?.message || fallback || "Conversation is temporarily unavailable.")
    .replace(/^FirebaseError:\s*/i, "")
    .trim();
  return message || fallback;
}

const DEFINITIVE_CONVERSATION_ERROR_CODES = new Set([
  "already-exists",
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
  const protectsUnload = phase === "sending" || hasPendingRequest;
  return {
    blocked: false,
    protectsUnload,
    message: protectsUnload
      ? "The unresolved request will be kept for exact reconciliation when this conversation is reopened."
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

export function buildConversationSignalBaseline(messages = []) {
  const ordered = mergeConversationMessages([], messages);
  const latest = ordered[ordered.length - 1] || null;
  return {
    messageCount: ordered.length,
    latestMessageId: String(latest?.messageId || "").trim(),
    latestMessageAtISO: String(latest?.createdAtISO || "").trim()
  };
}

export function shouldReloadConversationForSignal({
  open = false,
  phase = "closed",
  pendingRequestId = "",
  signal = null,
  loadedSignal = null
} = {}) {
  if (!open || !signal || String(pendingRequestId || "").trim()) return false;
  if (["closed", "loading", "refreshing", "sending"].includes(phase)) return false;
  return isConversationSignalNewer(signal, loadedSignal || {});
}

export function buildConversationSyncPresentation({
  state = "paused",
  mutationPending = false
} = {}) {
  if (mutationPending) {
    return {
      state: "paused",
      label: "Updates paused",
      detail: "Automatic refresh is paused while this message request resolves."
    };
  }
  if (state === "catching_up") {
    return {
      state,
      label: "Catching up",
      detail: "Connecting to the selected conversation update signal."
    };
  }
  if (state === "live") {
    return {
      state,
      label: "Live updates",
      detail: "A server-confirmed signal will refresh this conversation when a newer message is recorded."
    };
  }
  if (state === "stale") {
    return {
      state,
      label: "May be stale",
      detail: "Only cached or incomplete update metadata is available. Refresh for the authoritative conversation."
    };
  }
  return {
    state: "paused",
    label: "Updates paused",
    detail: "Automatic conversation updates are unavailable. Manual refresh remains available."
  };
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
  if (phase === "send_error" && hasPendingRequest && sendMode === "safe_reset") {
    return {
      state: "error",
      actionLabel: "Reset rejected attempt",
      title: "Message request was rejected.",
      detail: "The server returned a definitive rejection. Explicitly reset this request identity before editing or starting another attempt.",
      error: normalizedError
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
      detail: "The definitively rejected request identity was explicitly cleared. Review the message before starting a new request.",
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

function QuoteConversationPanelInstance({
  access,
  authenticatedUid = "",
  title = "Quote conversation",
  defaultOpen = false,
  onClose = null,
  presentation = "panel",
  showCloseAction = true
}) {
  const identity = useMemo(() => accessIdentity(access, authenticatedUid), [
    access?.accessMode,
    access?.organizationId,
    access?.quoteId,
    access?.portalKey,
    authenticatedUid
  ]);
  const initialPendingAttempt = readConversationPendingAttempt(identity);
  const [open, setOpen] = useState(defaultOpen);
  const [phase, setPhase] = useState(
    defaultOpen ? "loading" : initialPendingAttempt ? "send_error" : "closed"
  );
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState(initialPendingAttempt?.body || "");
  const [pendingRequestId, setPendingRequestId] = useState(
    initialPendingAttempt?.clientRequestId || ""
  );
  const [sendMode, setSendMode] = useState(
    initialPendingAttempt?.resetAllowed
      ? "safe_reset"
      : initialPendingAttempt ? "reconcile" : "idle"
  );
  const [error, setError] = useState(initialPendingAttempt?.error || "");
  const [status, setStatus] = useState("");
  const [readOnly, setReadOnly] = useState(false);
  const [readOnlyReason, setReadOnlyReason] = useState("");
  const [syncState, setSyncState] = useState(defaultOpen ? "catching_up" : "paused");
  const [signalVersion, setSignalVersion] = useState(0);
  const requestGenerationRef = useRef(0);
  const loadInFlightRef = useRef(false);
  const latestLoadedSignalRef = useRef(buildConversationSignalBaseline([]));
  const queuedSignalRef = useRef(null);
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
  const syncPresentation = buildConversationSyncPresentation({
    state: syncState,
    mutationPending: phase === "sending" || Boolean(pendingRequestId)
  });
  const normalizedPresentation = presentation === "station" ? "station" : "panel";

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

  const load = async ({
    refresh = false,
    pendingAttempt = null,
    signalRefresh = false
  } = {}) => {
    const request = beginRequestGeneration();
    loadInFlightRef.current = true;
    const unresolvedAttempt = pendingAttempt || readConversationPendingAttempt(identity);
    const unresolvedRequestId = String(
      unresolvedAttempt?.clientRequestId || pendingRequestId || ""
    ).trim();
    const reconcilingUnknownRequest = Boolean(unresolvedRequestId);
    setPhase(refresh && messages.length ? "refreshing" : "loading");
    setError("");
    setStatus("");
    try {
      const result = await loadQuotePortalConversation(access);
      if (!requestGenerationIsCurrent(request)) return;
      latestLoadedSignalRef.current = buildConversationSignalBaseline(result.messages);
      setMessages(result.messages);
      setReadOnly(result.readOnly);
      setReadOnlyReason(result.readOnlyReason);
      if (reconcilingUnknownRequest) {
        setBody(unresolvedAttempt?.body || body);
        setPendingRequestId(unresolvedRequestId);
        setSendMode(unresolvedAttempt?.resetAllowed ? "safe_reset" : "reconcile");
        setPhase("send_error");
        setError(
          unresolvedAttempt?.error
          || "Conversation refreshed, but the prior message request still needs an exact retry to confirm its receipt."
        );
      } else {
        setPhase("ready");
        if (refresh) {
          setStatus(signalRefresh ? "Conversation updated." : "Conversation refreshed.");
        }
      }
    } catch (loadError) {
      if (!requestGenerationIsCurrent(request)) return;
      if (signalRefresh) setSyncState("stale");
      setPhase(reconcilingUnknownRequest
        ? "send_error"
        : refresh && messages.length
          ? "refresh_error"
          : "load_error");
      setError(friendlyConversationError(loadError, "Unable to load this quote conversation."));
    } finally {
      if (requestGenerationIsCurrent(request)) loadInFlightRef.current = false;
    }
  };

  const openConversation = () => {
    const pendingAttempt = readConversationPendingAttempt(identity);
    if (pendingAttempt) {
      setBody(pendingAttempt.body);
      setPendingRequestId(pendingAttempt.clientRequestId);
      setSendMode(pendingAttempt.resetAllowed ? "safe_reset" : "reconcile");
      setError(pendingAttempt.error);
    }
    setSyncState("catching_up");
    setOpen(true);
    void load({ pendingAttempt });
  };

  const closeConversation = () => {
    requestGenerationRef.current += 1;
    setOpen(false);
    setPhase("closed");
    setStatus("");
    setSyncState("paused");
    if (typeof onClose === "function") onClose();
  };

  const updateBody = (nextBody) => {
    if (pendingRequestId) return;
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
    let attempt = null;
    try {
      attempt = beginConversationPendingAttempt({
        identity,
        body: normalizedBody,
        clientRequestId: pendingRequestId
      });
    } catch (attemptError) {
      if (!requestGenerationIsCurrent(request)) return;
      setPhase("send_error");
      setError(friendlyConversationError(attemptError, "The message request could not start safely."));
      return;
    }
    const clientRequestId = attempt.clientRequestId;
    setSendMode(attempt.sendMode);
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
      clearConversationPendingAttempt({
        identity,
        clientRequestId,
        resolution: "receipt"
      });
      setMessages((current) => {
        const nextMessages = mergeConversationMessages(current, [result.message]);
        latestLoadedSignalRef.current = buildConversationSignalBaseline(nextMessages);
        return nextMessages;
      });
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
      const definitive = isDefinitiveConversationSendError(sendError);
      const nextError = friendlyConversationError(
        sendError,
        "The message request did not return a server receipt."
      );
      markConversationPendingAttemptError({
        identity,
        clientRequestId,
        error: nextError,
        resetAllowed: definitive
      });
      setSendMode(definitive ? "safe_reset" : "reconcile");
      setPhase("send_error");
      setError(nextError);
    }
  };

  const resetRejectedAttempt = () => {
    if (
      sendMode !== "safe_reset"
      || !clearConversationPendingAttempt({
        identity,
        clientRequestId: pendingRequestId,
        resolution: "safe_reset"
      })
    ) return;
    setPendingRequestId("");
    setSendMode("recovery");
    setPhase("ready");
    setError("");
    setStatus("Rejected message attempt reset. Review the message before retrying.");
  };

  useEffect(() => {
    requestGenerationRef.current += 1;
    const pendingAttempt = readConversationPendingAttempt(identity);
    latestLoadedSignalRef.current = buildConversationSignalBaseline([]);
    queuedSignalRef.current = null;
    loadInFlightRef.current = false;
    setSignalVersion(0);
    setMessages([]);
    setBody(pendingAttempt?.body || "");
    setPendingRequestId(pendingAttempt?.clientRequestId || "");
    setSendMode(
      pendingAttempt?.resetAllowed ? "safe_reset" : pendingAttempt ? "reconcile" : "idle"
    );
    setError(pendingAttempt?.error || "");
    setStatus("");
    setReadOnly(false);
    setReadOnlyReason("");
    setSyncState(defaultOpen ? "catching_up" : "paused");
    if (defaultOpen) {
      setOpen(true);
      void load({ pendingAttempt });
    } else {
      setOpen(false);
      setPhase(pendingAttempt ? "send_error" : "closed");
    }
    return () => {
      requestGenerationRef.current += 1;
    };
    // The normalized access identity is the boundary that requires a reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, defaultOpen]);

  useEffect(() => {
    if (!open || !identity) {
      setSyncState("paused");
      return undefined;
    }

    const subscribedIdentity = identity;
    setSyncState("catching_up");
    try {
      return subscribeToConversationSignal(access, {
        onSignal: (signal) => {
          if (identityRef.current !== subscribedIdentity) return;
          if (!signal.documentExists) {
            setSyncState("paused");
            return;
          }
          const serverConfirmed = signal.metadata?.fromCache !== true
            && signal.metadata?.hasPendingWrites !== true;
          setSyncState(serverConfirmed ? "live" : "stale");
          if (serverConfirmed && isConversationSignalNewer(signal, latestLoadedSignalRef.current)) {
            queuedSignalRef.current = signal;
            setSignalVersion((current) => current + 1);
          }
        },
        onError: () => {
          if (identityRef.current === subscribedIdentity) setSyncState("paused");
        }
      });
    } catch {
      setSyncState("paused");
      return undefined;
    }
    // The normalized access identity is the subscription authority boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, open]);

  useEffect(() => {
    const signal = queuedSignalRef.current;
    if (!signal) return;
    if (!isConversationSignalNewer(signal, latestLoadedSignalRef.current)) {
      queuedSignalRef.current = null;
      return;
    }
    if (loadInFlightRef.current) return;
    if (!shouldReloadConversationForSignal({
      open,
      phase,
      pendingRequestId,
      signal,
      loadedSignal: latestLoadedSignalRef.current
    })) return;
    queuedSignalRef.current = null;
    void load({ refresh: true, signalRefresh: true });
    // Signal changes and request state deliberately gate a single background reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signalVersion, phase, pendingRequestId, open, identity]);

  if (!open) {
    return (
      <section
        className="quote-conversation-launch"
        data-conversation-presentation={normalizedPresentation}
      >
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
  const canSafelyReset = phase === "send_error"
    && Boolean(pendingRequestId)
    && sendMode === "safe_reset";
  const canSend = !readOnly && body.trim().length > 0 && !busy && !canSafelyReset;
  return (
    <section
      className="quote-conversation"
      aria-busy={busy}
      aria-labelledby="quote-conversation-title"
      data-conversation-presentation={normalizedPresentation}
    >
      <header className="quote-conversation-head">
        <div>
          <p className="eyebrow">Quote messages</p>
          <h3 id="quote-conversation-title">{title}</h3>
          <p
            className="source-note"
            role="status"
            data-conversation-sync-state={syncPresentation.state}
            title={syncPresentation.detail}
          >
            {syncPresentation.label}
          </p>
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
          {showCloseAction && (
            <button
              type="button"
              className="ghost compact"
              onClick={closeConversation}
              disabled={closeGuard.blocked}
              title={closeGuard.message}
            >
              Close conversation
            </button>
          )}
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
          <div
            className="quote-conversation-messages"
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
            aria-atomic="false"
          >
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
                  disabled={phase === "sending" || Boolean(pendingRequestId)}
                  onChange={(event) => updateBody(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canSend) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                  placeholder="Ask a question or share an update"
                />
              </label>
              <div className="quote-conversation-compose-footer">
                <small>
                  {body.length}/{PORTAL_CONVERSATION_BODY_MAX_LENGTH} · Ctrl/⌘ + Enter to send
                </small>
                {canSafelyReset ? (
                  <button type="button" className="ghost" onClick={resetRejectedAttempt}>
                    {mutationPresentation.actionLabel}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="cta"
                    onClick={() => void send()}
                    disabled={!canSend}
                    aria-busy={phase === "sending"}
                  >
                    {mutationPresentation.actionLabel}
                  </button>
                )}
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

export default function QuoteConversationPanel(props) {
  const authenticatedUid = String(auth?.currentUser?.uid || "").trim();
  const identity = accessIdentity(props?.access, authenticatedUid);
  return (
    <QuoteConversationPanelInstance
      key={identity}
      {...props}
      authenticatedUid={authenticatedUid}
    />
  );
}
