const RING_RADIUS = 26;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

// Presentation-only readiness ring: the existing proposal-completeness score
// worn as one motion. The score is supplied by the caller; nothing is read,
// estimated, or claimed here.
export default function ReadinessRing({ score = 0, label = "Proposal readiness", sublabel = "" }) {
  const numeric = Number(score);
  const clamped = Number.isFinite(numeric) ? Math.max(0, Math.min(100, Math.round(numeric))) : 0;
  const offset = RING_CIRCUMFERENCE * (1 - clamped / 100);
  return (
    <div
      className="readiness-ring"
      role="img"
      aria-label={`${label}: ${clamped}%`}
      data-complete={clamped === 100 ? "true" : "false"}
    >
      <svg viewBox="0 0 64 64" width="76" height="76" focusable="false" aria-hidden="true">
        <circle className="readiness-ring-track" cx="32" cy="32" r={RING_RADIUS} />
        <circle
          className="readiness-ring-arc"
          cx="32"
          cy="32"
          r={RING_RADIUS}
          strokeDasharray={RING_CIRCUMFERENCE.toFixed(2)}
          strokeDashoffset={offset.toFixed(2)}
          transform="rotate(-90 32 32)"
        />
      </svg>
      <div className="readiness-ring-value" aria-hidden="true">
        <strong>{clamped}%</strong>
        {sublabel ? <small>{sublabel}</small> : null}
      </div>
    </div>
  );
}
