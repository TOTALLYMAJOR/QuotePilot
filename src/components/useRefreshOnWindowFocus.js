import { useEffect, useRef } from "react";

// Presentation-only browser listener; the owning view supplies its existing read.
// Browsers commonly emit both events when returning to one visible tab.
const RETURN_EVENT_DEDUPLICATION_MS = 600;

export function useRefreshOnWindowFocus({ enabled = false, onRefresh } = {}) {
  const callbackRef = useRef(onRefresh);
  const lastRefreshAtRef = useRef(-Infinity);
  callbackRef.current = onRefresh;

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof document === "undefined") return undefined;
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - lastRefreshAtRef.current < RETURN_EVENT_DEDUPLICATION_MS) return;
      lastRefreshAtRef.current = now;
      callbackRef.current?.();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [enabled]);
}
