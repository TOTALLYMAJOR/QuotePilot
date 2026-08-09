import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import ShimmerReveal, { buildShimmerParticles } from "../ShimmerReveal";
import { commercialRevealTone } from "../CommercialChangeImpactPanel";
import { playShimmerChime } from "../shimmerChime";

function seededRandom(seed = 7) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

describe("ShimmerReveal", () => {
  test("renders nothing on static/server render so evidence markup is unchanged", () => {
    const markup = renderToStaticMarkup(
      <ShimmerReveal trigger={3} tone="positive" />
    );
    expect(markup).toBe("");
  });

  test("builds the requested particle field with sweep-ordered delays", () => {
    const particles = buildShimmerParticles(200, seededRandom());
    expect(particles).toHaveLength(200);
    for (const particle of particles) {
      expect(particle.left).toBeGreaterThanOrEqual(0);
      expect(particle.left).toBeLessThanOrEqual(100);
      expect(particle.delayMs).toBeGreaterThanOrEqual(0);
      expect(particle.durationMs).toBeGreaterThanOrEqual(300);
      expect(["dot", "streak"]).toContain(particle.kind);
      // Delay tracks horizontal position (plus bounded jitter), producing the
      // left-to-right wavefront rather than a random twinkle.
      expect(particle.delayMs).toBeLessThanOrEqual(particle.left * 4.2 + 140 + 1);
      expect(particle.delayMs).toBeGreaterThanOrEqual(particle.left * 4.2 - 1);
    }
    const kinds = new Set(particles.map((p) => p.kind));
    expect(kinds.has("dot")).toBe(true);
    expect(kinds.has("streak")).toBe(true);
  });

  test("particle count is clamped to a non-negative integer", () => {
    expect(buildShimmerParticles(0)).toHaveLength(0);
    expect(buildShimmerParticles(-5)).toHaveLength(0);
    expect(buildShimmerParticles(2.9, seededRandom())).toHaveLength(2);
  });
});

describe("commercialRevealTone", () => {
  function model(before, proposedAfter) {
    return { commercialValues: { authoritativeTotal: { before, proposedAfter } } };
  }

  test("classifies net-cash direction from the authoritative total", () => {
    expect(commercialRevealTone(model(1000, 1250))).toBe("positive");
    expect(commercialRevealTone(model(1000, 800))).toBe("negative");
    expect(commercialRevealTone(model(1000, 1000))).toBe("neutral");
  });

  test("falls back to neutral when totals are unavailable", () => {
    expect(commercialRevealTone(null)).toBe("neutral");
    expect(commercialRevealTone({})).toBe("neutral");
    expect(commercialRevealTone(model("n/a", 500))).toBe("neutral");
  });
});

describe("playShimmerChime", () => {
  test("fails silent (returns false) when Web Audio is unavailable", () => {
    expect(playShimmerChime("positive")).toBe(false);
  });
});
