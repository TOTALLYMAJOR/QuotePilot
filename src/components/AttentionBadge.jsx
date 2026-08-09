import { useEffect, useRef, useState } from "react";

// Workflow attention count badge with a one-shot heartbeat: when the count
// INCREASES, the badge does a single scale-pulse and emits an expanding ring.
// Decreases and initial mount stay silent — looping or over-firing badges get
// tuned out, so the pulse is reserved for "new work arrived".
export default function AttentionBadge({ count }) {
  const [pulseRun, setPulseRun] = useState(0);
  const previousCountRef = useRef(null);

  useEffect(() => {
    const previous = previousCountRef.current;
    previousCountRef.current = count;
    if (typeof count !== "number" || count <= 0) return;
    if (previous === null || count <= previous) return;
    setPulseRun((run) => run + 1);
  }, [count]);

  if (typeof count !== "number" || count <= 0) return null;

  return (
    <span
      key={pulseRun}
      className={`workflow-attention-badge${pulseRun > 0 ? " badge-heartbeat" : ""}`}
      aria-hidden="true"
    >
      {count}
    </span>
  );
}
