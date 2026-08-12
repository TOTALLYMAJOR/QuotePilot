import { useCallback, useEffect, useRef } from "react";

export function useWorkspaceRouteHeadingFocus(enabled = true) {
  const headingRef = useRef(null);
  const enabledRef = useRef(enabled);
  const focusOwnerRef = useRef(null);
  const focusOwnershipActiveRef = useRef(false);
  const focusFrameRef = useRef(0);

  enabledRef.current = enabled;

  const cancelFocusFrame = useCallback(() => {
    if (!focusFrameRef.current || typeof window === "undefined") return;
    window.cancelAnimationFrame(focusFrameRef.current);
    focusFrameRef.current = 0;
  }, []);

  const focusHeadingIfStillOwned = useCallback(() => {
    if (
      !enabledRef.current
      || !focusOwnershipActiveRef.current
      || typeof window === "undefined"
      || typeof document === "undefined"
    ) return;

    cancelFocusFrame();
    focusFrameRef.current = window.requestAnimationFrame(() => {
      focusFrameRef.current = 0;
      const heading = headingRef.current;
      if (!(heading instanceof HTMLElement) || !heading.isConnected) return;

      const activeElement = document.activeElement;
      const routeStillOwnsFocus = activeElement === focusOwnerRef.current
        || activeElement === document.body
        || activeElement === document.documentElement;
      if (!routeStillOwnsFocus) return;

      heading.focus({ preventScroll: true });
    });
  }, [cancelFocusFrame]);

  const attachHeadingRef = useCallback((heading) => {
    headingRef.current = heading;
    attachHeadingRef.current = heading;
    if (heading) focusHeadingIfStillOwned();
  }, [focusHeadingIfStillOwned]);

  // Preserve the useful RefObject-shaped `.current` escape hatch while using a
  // callback ref so a heading that arrives through a nested lazy boundary can
  // announce that it is finally mounted.
  attachHeadingRef.current = headingRef.current;

  useEffect(() => {
    if (
      !enabled
      || typeof window === "undefined"
      || typeof document === "undefined"
    ) {
      focusOwnershipActiveRef.current = false;
      cancelFocusFrame();
      return undefined;
    }

    focusOwnerRef.current = document.activeElement;
    focusOwnershipActiveRef.current = true;
    focusHeadingIfStillOwned();

    const handleFocusIn = (event) => {
      if (
        event.target === focusOwnerRef.current
        || event.target === headingRef.current
      ) return;
      focusOwnershipActiveRef.current = false;
      cancelFocusFrame();
    };
    document.addEventListener("focusin", handleFocusIn);

    return () => {
      focusOwnershipActiveRef.current = false;
      cancelFocusFrame();
      document.removeEventListener("focusin", handleFocusIn);
    };
  }, [cancelFocusFrame, enabled, focusHeadingIfStillOwned]);

  return attachHeadingRef;
}
