import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import ReadinessRing from "../ReadinessRing";

describe("ReadinessRing", () => {
  test("announces the score and label accessibly and shows the value", () => {
    const markup = renderToStaticMarkup(
      <ReadinessRing score={85} label="Proposal readiness" sublabel="Final review" />
    );
    expect(markup).toContain('aria-label="Proposal readiness: 85%"');
    expect(markup).toContain("85%");
    expect(markup).toContain("Final review");
    expect(markup).toContain('data-complete="false"');
  });

  test("marks completion at exactly 100", () => {
    const markup = renderToStaticMarkup(<ReadinessRing score={100} />);
    expect(markup).toContain('data-complete="true"');
    expect(markup).toContain('stroke-dashoffset="0.00"');
  });

  test("clamps out-of-range and non-numeric scores instead of rendering them", () => {
    expect(renderToStaticMarkup(<ReadinessRing score={150} />)).toContain('aria-label="Proposal readiness: 100%"');
    expect(renderToStaticMarkup(<ReadinessRing score={-20} />)).toContain('aria-label="Proposal readiness: 0%"');
    expect(renderToStaticMarkup(<ReadinessRing score="not-a-number" />)).toContain('aria-label="Proposal readiness: 0%"');
  });
});
