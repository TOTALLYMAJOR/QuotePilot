// Central cue router for workspace sounds. All UI audio flows through
// playCue() so the operator's persisted mute preference gates every cue in
// one place. Cues stay whisper-level garnish: failure to play is never an
// error, and no product state may depend on a cue firing.

import { playShimmerChime, playTick, playSeal } from "./shimmerChime";

const STORAGE_KEY = "qp.workspaceSoundsEnabled";

export function areWorkspaceSoundsEnabled() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function setWorkspaceSoundsEnabled(enabled) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // Storage unavailable (private mode etc.) — preference just won't persist.
  }
}

const CUES = Object.freeze({
  chime: (tone) => playShimmerChime(tone),
  tick: () => playTick(),
  seal: () => playSeal()
});

// Returns true only when a cue was actually scheduled.
export function playCue(cue, tone = "neutral") {
  if (!areWorkspaceSoundsEnabled()) return false;
  const run = CUES[cue];
  if (!run) return false;
  return run(tone);
}
