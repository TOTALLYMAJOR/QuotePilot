import { useCallback, useEffect, useRef } from "react";

function frame(callback) {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    return { kind: "frame", id: window.requestAnimationFrame(callback) };
  }
  return { kind: "timer", id: setTimeout(callback, 0) };
}

function cancelFrame(handle) {
  if (!handle) return;
  if (handle.kind === "frame") window.cancelAnimationFrame?.(handle.id);
  else clearTimeout(handle.id);
}

export function useDisclosureRefreshAnchor() {
  const snapshotsRef = useRef(new Map());
  const framesRef = useRef(new Map());

  const capture = useCallback((key, disclosure) => {
    const id = String(key || "").trim();
    if (!id || !disclosure?.isConnected || !disclosure.open) return;
    const activeElement = typeof document !== "undefined" ? document.activeElement : null;
    snapshotsRef.current.set(id, {
      disclosure,
      top: Number(disclosure.getBoundingClientRect?.().top || 0),
      activeElement: disclosure.contains(activeElement) ? activeElement : null,
      fallback: disclosure.querySelector?.("summary") || null
    });
  }, []);

  const restore = useCallback((key) => {
    const id = String(key || "").trim();
    const snapshot = snapshotsRef.current.get(id);
    if (!snapshot) return;
    cancelFrame(framesRef.current.get(id));
    framesRef.current.set(id, frame(() => {
      framesRef.current.delete(id);
      snapshotsRef.current.delete(id);
      const { disclosure, activeElement, fallback, top } = snapshot;
      if (!disclosure?.isConnected || !disclosure.open) return;
      const nextTop = Number(disclosure.getBoundingClientRect?.().top || 0);
      const delta = nextTop - top;
      if (Math.abs(delta) > 1 && typeof window?.scrollBy === "function") {
        window.scrollBy({ top: delta, left: 0, behavior: "auto" });
      }
      if (!activeElement || activeElement.isConnected) return;
      const current = typeof document !== "undefined" ? document.activeElement : null;
      if (current && current !== document.body) return;
      fallback?.focus?.({ preventScroll: true });
    }));
  }, []);

  useEffect(() => () => {
    framesRef.current.forEach(cancelFrame);
    framesRef.current.clear();
    snapshotsRef.current.clear();
  }, []);

  return { capture, restore };
}
