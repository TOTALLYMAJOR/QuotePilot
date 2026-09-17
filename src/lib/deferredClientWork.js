export const DEFERRED_CLIENT_WORK_TIMEOUT_MS = 500;

function defaultWindow() {
  return typeof window === "undefined" ? null : window;
}

/**
 * Yields secondary browser work until the browser has an idle slot when that
 * primitive exists. Browsers without requestIdleCallback keep today's eager
 * behavior rather than introducing a timer-only delay that could hide required
 * evidence on unsupported platforms.
 *
 * The callback owns no business authority. Cancelling it only prevents a stale
 * scope from starting an unnecessary read after the user moved elsewhere.
 */
export function scheduleDeferredClientWork(callback, {
  windowObject = defaultWindow(),
  timeoutMs = DEFERRED_CLIENT_WORK_TIMEOUT_MS
} = {}) {
  if (typeof callback !== "function") return () => {};

  let active = true;
  const run = () => {
    if (!active) return;
    active = false;
    callback();
  };

  if (typeof windowObject?.requestIdleCallback === "function") {
    const idleId = windowObject.requestIdleCallback(run, { timeout: timeoutMs });
    return () => {
      if (!active) return;
      active = false;
      windowObject.cancelIdleCallback?.(idleId);
    };
  }

  run();
  return () => {
    active = false;
  };
}

export default scheduleDeferredClientWork;
