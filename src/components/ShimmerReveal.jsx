import { useEffect, useRef, useState } from "react";
import { playCue } from "./soundKit";

// ShimmerReveal paints a one-shot celebratory-but-subtle overlay on top of its
// positioned parent: a soft tinted wash, one diagonal light band, and a field
// of a couple hundred individually timed particles that sweep left-to-right.
// The accent color follows `tone` (positive / negative / neutral), so the same
// component can celebrate a gain or quietly flag a reduction.
//
// It renders nothing until `trigger` changes to a new truthy value, and cleans
// itself up after the run — so static/SSR renders (and tests using
// renderToStaticMarkup) never see it.

function prefersReducedMotion() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

// Pure so it can be unit-tested with a seeded random source.
export function buildShimmerParticles(count, random = Math.random) {
  const particles = [];
  const total = Math.max(0, Math.floor(count));
  for (let i = 0; i < total; i += 1) {
    const left = random() * 100;
    const streak = random() < 0.18;
    particles.push({
      id: i,
      left,
      top: random() * 100,
      // The sweep travels left→right in ~420ms; per-particle jitter keeps the
      // wavefront organic instead of mechanical.
      delayMs: Math.round(left * 4.2 + random() * 140),
      durationMs: Math.round(300 + random() * 320),
      driftX: Math.round((random() - 0.3) * 14),
      driftY: Math.round((random() - 0.65) * 18),
      scale: 0.6 + random() * 0.9,
      peak: 0.35 + random() * 0.5,
      kind: streak ? "streak" : "dot",
      tiltDeg: Math.round((random() - 0.5) * 40)
    });
  }
  return particles;
}

export default function ShimmerReveal({
  trigger = 0,
  tone = "neutral",
  particleCount = 200,
  sound = true,
  durationMs = 900
}) {
  const [run, setRun] = useState(null);
  const lastTriggerRef = useRef(0);

  useEffect(() => {
    if (!trigger || trigger === lastTriggerRef.current) return undefined;
    lastTriggerRef.current = trigger;
    const reduced = prefersReducedMotion();
    setRun({
      id: trigger,
      tone,
      reduced,
      particles: reduced ? [] : buildShimmerParticles(particleCount)
    });
    if (sound && !reduced) playCue("chime", tone);
    const timer = setTimeout(() => setRun(null), durationMs + 620);
    return () => clearTimeout(timer);
  }, [trigger, tone, particleCount, sound, durationMs]);

  if (!run) return null;

  return (
    <div
      className={`shimmer-reveal${run.reduced ? " shimmer-reveal-reduced" : ""}`}
      data-tone={run.tone}
      aria-hidden="true"
    >
      <span className="shimmer-reveal-wash" />
      {!run.reduced && <span className="shimmer-reveal-band" />}
      {run.particles.map((particle) => (
        <span
          key={particle.id}
          className="shimmer-reveal-particle"
          data-kind={particle.kind}
          style={{
            left: `${particle.left}%`,
            top: `${particle.top}%`,
            "--sr-delay": `${particle.delayMs}ms`,
            "--sr-duration": `${particle.durationMs}ms`,
            "--sr-drift-x": `${particle.driftX}px`,
            "--sr-drift-y": `${particle.driftY}px`,
            "--sr-scale": particle.scale,
            "--sr-peak": particle.peak,
            "--sr-tilt": `${particle.tiltDeg}deg`
          }}
        />
      ))}
    </div>
  );
}
