import { useEffect, useRef } from "react";

export function useWorkspaceRouteHeadingFocus(enabled = true) {
  const headingRef = useRef(null);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return undefined;
    const frame = window.requestAnimationFrame(() => {
      headingRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [enabled]);

  return headingRef;
}
