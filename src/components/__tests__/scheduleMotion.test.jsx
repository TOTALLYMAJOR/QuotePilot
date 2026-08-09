import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import EventScheduleModal, {
  EventScheduleView,
  getScheduleDropTone
} from "../EventScheduleModal";

describe("schedule drop tone classification", () => {
  test("classifies a conflict-free drop as positive (success family)", () => {
    expect(getScheduleDropTone([])).toBe("positive");
    expect(getScheduleDropTone()).toBe("positive");
  });

  test("classifies every conflict-checker reason as negative (danger family)", () => {
    expect(getScheduleDropTone(["time_overlap"])).toBe("negative");
    expect(getScheduleDropTone(["time_unknown"])).toBe("negative");
    expect(getScheduleDropTone(["capacity"])).toBe("negative");
    expect(getScheduleDropTone(["time_overlap", "capacity"])).toBe("negative");
  });

  test("ignores malformed or empty-ish inputs and stays positive", () => {
    expect(getScheduleDropTone(null)).toBe("positive");
    expect(getScheduleDropTone(undefined)).toBe("positive");
    expect(getScheduleDropTone("capacity")).toBe("positive");
    expect(getScheduleDropTone([false, "", null, undefined, 0])).toBe("positive");
  });

  test("returns only the two supported data-tone values", () => {
    const tones = new Set([
      getScheduleDropTone([]),
      getScheduleDropTone(["capacity"]),
      getScheduleDropTone(["time_overlap"])
    ]);
    tones.forEach((tone) => {
      expect(["positive", "negative"]).toContain(tone);
    });
  });
});

describe("schedule board drop-physics rendering", () => {
  test("embedded view still renders and carries no one-shot drop classes at rest", () => {
    const markup = renderToStaticMarkup(
      <EventScheduleView open onClose={() => {}} organizationId="org-a" />
    );

    expect(markup).toContain('role="region"');
    expect(markup).toContain('aria-labelledby="event-schedule-title"');
    // One-shot feedback classes must never appear in a static/initial render;
    // they only exist between a successful assignment persist and self-clear.
    expect(markup).not.toContain("drop-settle");
    expect(markup).not.toContain("lane-glow");
  });

  test("modal wrapper still renders its dialog contract", () => {
    const markup = renderToStaticMarkup(
      <EventScheduleModal open onClose={() => {}} organizationId="org-a" />
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).not.toContain("drop-settle");
    expect(markup).not.toContain("lane-glow");
  });
});
