const MESSAGING_MILESTONES = new Set([
  "route_usable",
  "inbox_visible",
  "thread_interactive",
  "thread_caught_up"
]);

function boundedCount(value) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? Math.min(count, 10_000) : 0;
}

export function messagingNow(runtime = globalThis) {
  const now = runtime?.performance?.now?.();
  return Number.isFinite(now) ? now : Date.now();
}

export function recordMessagingPerformanceMilestone({
  milestone = "",
  durationMs = 0,
  threadCount = 0,
  messageCount = 0
} = {}, runtime = globalThis) {
  const normalizedMilestone = String(milestone || "").trim().toLowerCase();
  if (!MESSAGING_MILESTONES.has(normalizedMilestone)) return null;
  const numericDuration = Number(durationMs);
  const duration = Number.isFinite(numericDuration)
    ? Math.max(0, Math.min(numericDuration, 300_000))
    : 0;
  const detail = Object.freeze({
    schemaVersion: 1,
    milestone: normalizedMilestone,
    durationMs: Math.round(duration * 10) / 10,
    threadCount: boundedCount(threadCount),
    messageCount: boundedCount(messageCount)
  });
  try {
    runtime?.performance?.measure?.(`quotepilot.messaging.${normalizedMilestone}`, {
      start: 0,
      duration: detail.durationMs,
      detail
    });
  } catch {
    // Performance entries are optional diagnostics; never interrupt messaging.
  }
  try {
    if (typeof runtime?.dispatchEvent === "function" && typeof runtime?.CustomEvent === "function") {
      runtime.dispatchEvent(new runtime.CustomEvent("quotepilot:messaging-performance", { detail }));
    }
  } catch {
    // The aggregate-only browser signal is best effort and carries no identity.
  }
  return detail;
}
