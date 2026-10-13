import { useEffect, useState } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function readReducedMotionPreference() {
  return typeof window !== "undefined"
    && window.matchMedia?.(REDUCED_MOTION_QUERY)?.matches === true;
}

export default function useReducedMotionPreference() {
  const [reducedMotion, setReducedMotion] = useState(readReducedMotionPreference);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
    const updatePreference = (event) => setReducedMotion(event.matches === true);

    setReducedMotion(mediaQuery.matches === true);
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", updatePreference);
      return () => mediaQuery.removeEventListener("change", updatePreference);
    }
    mediaQuery.addListener?.(updatePreference);
    return () => mediaQuery.removeListener?.(updatePreference);
  }, []);

  return reducedMotion;
}
