import { useEffect, useRef } from "react";

const FOCUS_REFRESH_DEDUPLICATION_MS = 600;

export function useRefreshOnWindowFocus({ enabled = false, onRefresh } = {}) {
  const onRefreshRef = useRef(onRefresh);
  const lastRefreshAtRef = useRef(0);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof document === "undefined") {
      return undefined;
    }

    const refreshVisibleSnapshot = () => {
      if (document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - lastRefreshAtRef.current < FOCUS_REFRESH_DEDUPLICATION_MS) return;
      lastRefreshAtRef.current = now;
      onRefreshRef.current?.();
    };

    window.addEventListener("focus", refreshVisibleSnapshot);
    document.addEventListener("visibilitychange", refreshVisibleSnapshot);
    return () => {
      window.removeEventListener("focus", refreshVisibleSnapshot);
      document.removeEventListener("visibilitychange", refreshVisibleSnapshot);
    };
  }, [enabled]);
}
