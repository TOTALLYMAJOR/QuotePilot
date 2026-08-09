import { useCallback, useEffect, useRef, useState } from "react";
import { getQuoteHistory, getWorkflowAttentionSnapshot } from "../lib/quoteStore";
import { buildWorkflowAttentionSummary } from "../lib/quoteWorkflow";

const REFRESH_TTL_MS = 60_000;
const COMMAND_CENTER_HISTORY_LIMIT = 200;

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
    attentionSummary: null,
    quotes: [],
    truncated: false,
    loadedAt: 0
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
      : { ...current, loading: true, error: "" });
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

      const errors = [];
      const loadedAttentionSummary = attentionResult.status === "fulfilled"
        ? buildWorkflowAttentionSummary(attentionResult.value.quotes)
        : null;
      if (attentionResult.status === "rejected") {
        errors.push(attentionResult.reason?.message || "Failed to load workflow attention.");
      }
      if (historyResult.status === "rejected") {
        errors.push(historyResult.reason?.message || "Failed to load quote records.");
      }

      const requestSucceeded = attentionResult.status === "fulfilled"
        && historyResult.status === "fulfilled";
      const loadedAt = requestSucceeded ? Date.now() : loadedAtRef.current;
      if (requestSucceeded) loadedAtRef.current = loadedAt;
      setState((current) => ({
        loading: false,
        error: errors.join(" "),
        source: attentionResult.status === "fulfilled"
          ? attentionResult.value.source
          : historyResult.status === "fulfilled"
            ? historyResult.value.source
            : current.source,
        attentionSummary: attentionResult.status === "fulfilled"
          ? loadedAttentionSummary
          : current.attentionSummary,
        quotes: historyResult.status === "fulfilled"
          ? historyResult.value.quotes
          : current.quotes,
        truncated: historyResult.status === "fulfilled"
          ? historyResult.value.truncated === true
          : current.truncated,
        loadedAt: requestSucceeded ? loadedAt : current.loadedAt
      }));
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
