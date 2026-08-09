import { useCallback, useEffect, useRef, useState } from "react";
import { getQuoteHistory, getWorkflowAttentionSnapshot } from "../lib/quoteStore";
import { buildWorkflowAttentionSummary } from "../lib/quoteWorkflow";

const REFRESH_TTL_MS = 60_000;
const COMMAND_CENTER_HISTORY_LIMIT = 200;

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
      history: emptyReadState()
    },
    partial: false,
    stale: false,
    attentionSummary: null,
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

export function buildCommercialSnapshotResult({
  current = emptySnapshot(),
  attentionResult,
  historyResult,
  nowMs = Date.now()
} = {}) {
  const attentionRead = settledReadState(attentionResult);
  const historyRead = settledReadState(historyResult);
  const errors = [attentionRead.error, historyRead.error].filter(Boolean);
  const requestSucceeded = attentionResult.status === "fulfilled"
    && historyResult.status === "fulfilled";
  const partial = attentionResult.status !== historyResult.status;
  const successfulSources = [attentionRead.source, historyRead.source].filter(Boolean);
  const sourceSet = new Set(successfulSources);
  const source = sourceSet.size > 1
    ? "mixed"
    : successfulSources[0] || current.source;
  const loadedAt = requestSucceeded ? nowMs : current.loadedAt;
  const hasPriorCompleteRead = Number(current.loadedAt) > 0;
  const retainCompleteSnapshot = !requestSucceeded && hasPriorCompleteRead;

  return {
    loading: false,
    error: errors.join(" "),
    source: retainCompleteSnapshot ? current.source : source,
    reads: {
      attention: attentionRead,
      history: historyRead
    },
    partial,
    stale: !requestSucceeded && Number(current.loadedAt) > 0,
    attentionSummary: retainCompleteSnapshot
      ? current.attentionSummary
      : attentionResult.status === "fulfilled"
      ? buildWorkflowAttentionSummary(attentionResult.value.quotes)
      : current.attentionSummary,
    quotes: retainCompleteSnapshot
      ? current.quotes
      : historyResult.status === "fulfilled"
      ? historyResult.value.quotes
      : current.quotes,
    truncated: retainCompleteSnapshot
      ? current.truncated
      : historyResult.status === "fulfilled"
      ? historyResult.value.truncated === true
      : current.truncated,
    truncationKnown: retainCompleteSnapshot
      ? current.truncationKnown === true
      : historyResult.status === "fulfilled" || current.truncationKnown === true,
    loadedAt
  };
}

export function useCommercialWorkspaceSnapshot({
  enabled = true,
  includeHistory = true,
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
            history: loadingReadState()
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
        : Promise.resolve({ source: "", quotes: [], truncated: false })
    ]).then(([attentionResult, historyResult]) => {
      if (!generationRef.current.isCurrent(generation)) return;
      const nowMs = Date.now();
      setState((current) => {
        const next = buildCommercialSnapshotResult({
          current,
          attentionResult,
          historyResult,
          nowMs
        });
        if (next.loadedAt > 0) loadedAtRef.current = next.loadedAt;
        return next;
      });
    });

    return () => {
      generationRef.current.begin();
    };
  }, [enabled, includeHistory, normalizedOrganizationId, refreshToken]);

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
