import { useCallback, useEffect, useRef, useState } from "react";
import { getQuoteHistory, getWorkflowAttentionSnapshot } from "../lib/quoteStore";
import {
  buildWorkflowAttentionSummary,
  mergeUnreadReplyAttention
} from "../lib/quoteWorkflow";
import {
  mergeAnniversaryRebookingAttention,
  resolveAnniversaryAttentionCalendar
} from "../lib/anniversaryRebookingAttention";

const REFRESH_TTL_MS = 60_000;
const COMMAND_CENTER_HISTORY_LIMIT = 200;
const COMMAND_CENTER_UNREAD_REPLY_LIMIT = 50;

function emptyReadState() {
  return { status: "idle", source: "", error: "" };
}

function loadingReadState() {
  return { status: "loading", source: "", error: "" };
}

export function createSnapshotRequestGeneration() {
  let current = 0;
  return {
    begin() {
      current += 1;
      return current;
    },
    isCurrent(generation) {
      return generation === current;
    }
  };
}

function emptySnapshot({ loading = false } = {}) {
  return {
    loading,
    error: "",
    source: "",
    reads: {
      attention: emptyReadState(),
      history: emptyReadState(),
      unreadReplies: emptyReadState(),
      decisionDebt: emptyReadState()
    },
    partial: false,
    stale: false,
    attentionSummary: null,
    decisionDebtItems: [],
    decisionDebtBounds: { truncated: false, known: false },
    quotes: [],
    truncated: false,
    truncationKnown: false,
    loadedAt: 0
  };
}

function settledReadState(result) {
  if (result.status === "fulfilled") {
    return {
      status: "success",
      source: String(result.value?.source || "").trim(),
      error: ""
    };
  }
  return {
    status: "error",
    source: "",
    error: result.reason?.message || "Read failed."
  };
}

function emptyUnreadReplyRead({ boundsKnown = false } = {}) {
  return {
    source: "",
    attention: [],
    bounds: { complete: true, truncated: false, known: boundsKnown }
  };
}

function emptyDecisionDebtRead({ boundsKnown = false } = {}) {
  return {
    source: "",
    items: [],
    bounds: { truncated: false, known: boundsKnown }
  };
}

function sourceFamily(value) {
  const source = String(value || "").trim().toLowerCase();
  if (source.startsWith("firebase")) return "firebase";
  return source;
}

async function readUnreadReplyAttention(organizationId) {
  const { getRevenueAutopilotOperations } = await import("../lib/revenueAutopilotClient");
  return getRevenueAutopilotOperations({
    organizationId,
    jobLimit: 1,
    attentionLimit: COMMAND_CENTER_UNREAD_REPLY_LIMIT
  });
}

async function readDecisionDebtAttention(organizationId) {
  const { getDecisionDebtSnapshot } = await import("../lib/decisionDebtClient");
  const result = await getDecisionDebtSnapshot({ organizationId, limit: 100 });
  return {
    source: "firebase_server_projection",
    items: result.snapshot.items,
    bounds: { ...result.snapshot.bounds, known: true }
  };
}

export function buildCommercialSnapshotResult({
  current = emptySnapshot(),
  attentionResult,
  historyResult,
  unreadReplyResult = { status: "fulfilled", value: emptyUnreadReplyRead() },
  decisionDebtResult = { status: "fulfilled", value: emptyDecisionDebtRead() },
  includeDecisionDebt = false,
  tenantTimeZone = "",
  nowMs = Date.now()
} = {}) {
  const attentionRead = settledReadState(attentionResult);
  const historyRead = settledReadState(historyResult);
  const unreadRepliesRead = settledReadState(unreadReplyResult);
  const decisionDebtRead = settledReadState(decisionDebtResult);
  const readResults = [
    attentionResult,
    historyResult,
    unreadReplyResult,
    ...(includeDecisionDebt ? [decisionDebtResult] : [])
  ];
  const errors = [
    attentionRead.error,
    historyRead.error,
    unreadRepliesRead.error,
    ...(includeDecisionDebt ? [decisionDebtRead.error] : [])
  ].filter(Boolean);
  const requestSucceeded = readResults.every((result) => result.status === "fulfilled");
  const partial = !requestSucceeded
    && readResults.some((result) => result.status === "fulfilled");
  const successfulSources = [
    attentionRead.source,
    historyRead.source,
    unreadRepliesRead.source,
    ...(includeDecisionDebt ? [decisionDebtRead.source] : [])
  ]
    .map(sourceFamily)
    .filter(Boolean);
  const sourceSet = new Set(successfulSources);
  const source = sourceSet.size > 1
    ? "mixed"
    : successfulSources[0] || current.source;
  const currentLoadedAt = Number.isFinite(Number(current.loadedAt))
    ? Math.max(0, Number(current.loadedAt))
    : 0;
  const observedAt = Number.isFinite(Number(nowMs)) ? Math.max(0, Number(nowMs)) : 0;
  const loadedAt = requestSucceeded
    ? Math.max(observedAt, currentLoadedAt + 1)
    : currentLoadedAt;
  const hasPriorCompleteRead = Number(current.loadedAt) > 0;
  const retainCompleteSnapshot = !requestSucceeded && hasPriorCompleteRead;
  const freshQuotes = historyResult.status === "fulfilled"
    ? historyResult.value.quotes
    : attentionResult.status === "fulfilled"
      ? attentionResult.value.quotes
      : current.quotes;
  const quoteAttentionSummary = attentionResult.status === "fulfilled"
    ? buildWorkflowAttentionSummary(attentionResult.value.quotes)
    : current.attentionSummary || buildWorkflowAttentionSummary([]);
  const anniversaryAttentionSummary = historyResult.status === "fulfilled"
    ? mergeAnniversaryRebookingAttention(quoteAttentionSummary, {
        quotes: freshQuotes,
        calendarContext: resolveAnniversaryAttentionCalendar({
          instant: new Date(nowMs),
          tenantTimeZone
        }),
        sourceLimit: COMMAND_CENTER_HISTORY_LIMIT,
        sourceTruncated: historyResult.value?.truncated === true
      })
    : quoteAttentionSummary;
  const freshAttentionSummary = unreadReplyResult.status === "fulfilled"
    ? mergeUnreadReplyAttention(anniversaryAttentionSummary, {
        attention: unreadReplyResult.value?.attention,
        quotes: freshQuotes
      })
    : anniversaryAttentionSummary;
  const freshHistoryTruncated = historyResult.status === "fulfilled"
    ? historyResult.value.truncated === true
    : false;
  const freshUnreadReplyCount = unreadReplyResult.status === "fulfilled"
    && Array.isArray(unreadReplyResult.value?.attention)
    ? unreadReplyResult.value.attention.length
    : 0;
  const freshUnreadReplyTotal = Number(unreadReplyResult.value?.bounds?.totalAttention);
  const freshUnreadRepliesTruncated = unreadReplyResult.status === "fulfilled"
    && Number.isSafeInteger(freshUnreadReplyTotal)
    && freshUnreadReplyTotal > freshUnreadReplyCount;
  const freshUnreadReplyBoundsKnown = unreadReplyResult.status === "fulfilled"
    && unreadReplyResult.value?.bounds?.known !== false;
  const freshDecisionDebtItems = decisionDebtResult.status === "fulfilled"
    && Array.isArray(decisionDebtResult.value?.items)
    ? decisionDebtResult.value.items
    : [];
  const freshDecisionDebtTruncated = decisionDebtResult.status === "fulfilled"
    && decisionDebtResult.value?.bounds?.truncated === true;
  const freshDecisionDebtBoundsKnown = decisionDebtResult.status === "fulfilled"
    && decisionDebtResult.value?.bounds?.known === true;

  return {
    loading: false,
    error: errors.join(" "),
    source: retainCompleteSnapshot ? current.source : source,
    reads: {
      attention: attentionRead,
      history: historyRead,
      unreadReplies: unreadRepliesRead,
      ...(includeDecisionDebt ? { decisionDebt: decisionDebtRead } : {})
    },
    partial,
    stale: !requestSucceeded && Number(current.loadedAt) > 0,
    attentionSummary: retainCompleteSnapshot
      ? current.attentionSummary
      : freshAttentionSummary,
    decisionDebtItems: retainCompleteSnapshot
      ? current.decisionDebtItems || []
      : freshDecisionDebtItems,
    decisionDebtBounds: retainCompleteSnapshot
      ? current.decisionDebtBounds || { truncated: false, known: false }
      : {
          truncated: freshDecisionDebtTruncated,
          known: freshDecisionDebtBoundsKnown
        },
    quotes: retainCompleteSnapshot
      ? current.quotes
      : historyResult.status === "fulfilled"
      ? historyResult.value.quotes
      : current.quotes,
    truncated: retainCompleteSnapshot
      ? current.truncated
      : freshHistoryTruncated || freshUnreadRepliesTruncated || freshDecisionDebtTruncated,
    truncationKnown: retainCompleteSnapshot
      ? current.truncationKnown === true
      : historyResult.status === "fulfilled"
        || freshUnreadReplyBoundsKnown
        || freshDecisionDebtBoundsKnown
        || current.truncationKnown === true,
    loadedAt
  };
}

export function useCommercialWorkspaceSnapshot({
  enabled = true,
  includeHistory = true,
  includeRevenueAttention = includeHistory,
  includeDecisionDebt = false,
  tenantTimeZone = "",
  organizationId = ""
} = {}) {
  const normalizedOrganizationId = String(organizationId || "").trim();
  const [state, setState] = useState(() => emptySnapshot({
    loading: Boolean(enabled && normalizedOrganizationId)
  }));
  const [refreshToken, setRefreshToken] = useState(0);
  const generationRef = useRef(createSnapshotRequestGeneration());
  const loadedAtRef = useRef(0);
  const scopeRef = useRef("");

  const refresh = useCallback(({ force = false } = {}) => {
    if (!force && loadedAtRef.current > 0 && Date.now() - loadedAtRef.current < REFRESH_TTL_MS) {
      return;
    }
    setRefreshToken((value) => value + 1);
  }, []);

  useEffect(() => {
    const generation = generationRef.current.begin();
    if (!enabled || !normalizedOrganizationId) {
      scopeRef.current = "";
      loadedAtRef.current = 0;
      setState(emptySnapshot());
      return undefined;
    }

    const scopeChanged = scopeRef.current !== normalizedOrganizationId;
    scopeRef.current = normalizedOrganizationId;
    if (scopeChanged) loadedAtRef.current = 0;
    setState((current) => scopeChanged
      ? emptySnapshot({ loading: true })
      : {
          ...current,
          loading: true,
          error: "",
          reads: {
            attention: loadingReadState(),
            history: loadingReadState(),
            unreadReplies: loadingReadState(),
            decisionDebt: includeDecisionDebt ? loadingReadState() : emptyReadState()
          },
          partial: false,
          stale: false
        });
    Promise.allSettled([
      getWorkflowAttentionSnapshot({ organizationId: normalizedOrganizationId }),
      includeHistory
        ? getQuoteHistory({
            organizationId: normalizedOrganizationId,
            limitCount: COMMAND_CENTER_HISTORY_LIMIT
          })
        : Promise.resolve({ source: "", quotes: [], truncated: false }),
      includeRevenueAttention
        ? readUnreadReplyAttention(normalizedOrganizationId)
        : Promise.resolve(emptyUnreadReplyRead()),
      includeDecisionDebt
        ? readDecisionDebtAttention(normalizedOrganizationId)
        : Promise.resolve(emptyDecisionDebtRead())
    ]).then(([attentionResult, historyResult, unreadReplyResult, decisionDebtResult]) => {
      if (!generationRef.current.isCurrent(generation)) return;
      const nowMs = Date.now();
      setState((current) => {
        const next = buildCommercialSnapshotResult({
          current,
          attentionResult,
          historyResult,
          unreadReplyResult,
          decisionDebtResult,
          includeDecisionDebt,
          tenantTimeZone,
          nowMs
        });
        if (next.loadedAt > 0) loadedAtRef.current = next.loadedAt;
        return next;
      });
    });

    return () => {
      generationRef.current.begin();
    };
  }, [
    enabled,
    includeHistory,
    includeRevenueAttention,
    includeDecisionDebt,
    normalizedOrganizationId,
    refreshToken,
    tenantTimeZone
  ]);

  useEffect(() => {
    if (!enabled || !normalizedOrganizationId || typeof window === "undefined") return undefined;
    const requestRefresh = () => refresh();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") requestRefresh();
    };
    const handleStorage = (event) => {
      if (event.key === "quoteWizard.quotes") refresh({ force: true });
    };
    let midnightTimer = 0;
    const scheduleMidnightRefresh = () => {
      const now = new Date();
      const nextMidnight = new Date(now);
      nextMidnight.setHours(24, 0, 0, 100);
      midnightTimer = window.setTimeout(() => {
        refresh({ force: true });
        scheduleMidnightRefresh();
      }, Math.max(1_000, nextMidnight.getTime() - now.getTime()));
    };
    scheduleMidnightRefresh();
    window.addEventListener("focus", requestRefresh);
    window.addEventListener("storage", handleStorage);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearTimeout(midnightTimer);
      window.removeEventListener("focus", requestRefresh);
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [enabled, normalizedOrganizationId, refresh]);

  return { ...state, refresh };
}
