import { useEffect, useMemo, useState } from "react";
import { mergeConversationThreads, subscribeConversationInbox } from "../lib/conversationInbox";

function initialState(scopeKey = "") {
  return { scopeKey, status: "idle", liveQuotes: [], source: "", error: "", stale: false, bounded: false };
}

export function resolveScopedConversationInboxState(state = {}, organizationId = "") {
  const scopeKey = String(organizationId || "").trim().toLowerCase();
  return state?.scopeKey === scopeKey ? state : initialState(scopeKey);
}

export function filterConversationInboxSeedQuotes(seedQuotes = [], organizationId = "") {
  const scopeKey = String(organizationId || "").trim().toLowerCase();
  if (!scopeKey) return [];
  return seedQuotes.filter((quote) => (
    String(quote?.organizationId || "").trim().toLowerCase() === scopeKey
  ));
}

export function useConversationInbox({ enabled = true, organizationId = "", seedQuotes = [] } = {}) {
  const orgId = String(organizationId || "").trim().toLowerCase();
  const [state, setState] = useState(() => initialState(orgId));
  const [retryVersion, setRetryVersion] = useState(0);

  useEffect(() => {
    if (!enabled || !orgId) {
      setState(initialState(orgId));
      return undefined;
    }
    let active = true;
    let unsubscribe = () => {};
    setState((current) => ({
      ...resolveScopedConversationInboxState(current, orgId),
      scopeKey: orgId,
      status: current.scopeKey === orgId && current.status === "recovering" ? "recovering" : "connecting",
      error: ""
    }));
    try {
      unsubscribe = subscribeConversationInbox({
        organizationId: orgId,
        onData: (result) => {
          if (!active) return;
          setState({ scopeKey: orgId, status: "ready", liveQuotes: result.quotes, source: result.source, error: "", stale: result.stale, bounded: result.bounded });
        },
        onError: (error) => {
          if (!active) return;
          setState((current) => {
            const scoped = resolveScopedConversationInboxState(current, orgId);
            return {
              ...scoped,
              status: scoped.liveQuotes.length > 0 ? "stale" : "error",
              stale: true,
              error: error?.message || "Live conversation updates are temporarily unavailable."
            };
          });
        }
      });
    } catch (error) {
      setState((current) => {
        const scoped = resolveScopedConversationInboxState(current, orgId);
        return {
          ...scoped,
          status: scoped.liveQuotes.length > 0 ? "stale" : "error",
          stale: true,
          error: error?.message || "Live conversation updates are unavailable."
        };
      });
    }
    return () => {
      active = false;
      unsubscribe();
    };
  }, [enabled, orgId, retryVersion]);

  const scopedState = resolveScopedConversationInboxState(state, orgId);
  const scopedSeedQuotes = useMemo(
    () => filterConversationInboxSeedQuotes(seedQuotes, orgId),
    [seedQuotes, orgId]
  );
  const threads = useMemo(
    () => mergeConversationThreads(scopedSeedQuotes, scopedState.liveQuotes),
    [scopedSeedQuotes, scopedState.liveQuotes]
  );
  const retry = () => {
    setState((current) => ({
      ...resolveScopedConversationInboxState(current, orgId),
      scopeKey: orgId,
      status: "recovering",
      error: ""
    }));
    setRetryVersion((current) => current + 1);
  };

  const { scopeKey: _scopeKey, ...publicState } = scopedState;
  return { ...publicState, threads, retry };
}

export default useConversationInbox;
