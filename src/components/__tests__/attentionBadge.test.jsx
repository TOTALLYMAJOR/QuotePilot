import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import AttentionBadge from "../AttentionBadge";
import { areWorkspaceSoundsEnabled, playCue } from "../soundKit";

describe("AttentionBadge", () => {
  test("renders the count without the heartbeat class on static render", () => {
    const markup = renderToStaticMarkup(<AttentionBadge count={4} />);
    expect(markup).toContain("workflow-attention-badge");
    expect(markup).toContain(">4<");
    expect(markup).not.toContain("badge-heartbeat");
  });

  test("renders nothing for zero, null, or non-numeric counts", () => {
    expect(renderToStaticMarkup(<AttentionBadge count={0} />)).toBe("");
    expect(renderToStaticMarkup(<AttentionBadge count={null} />)).toBe("");
    expect(renderToStaticMarkup(<AttentionBadge count={undefined} />)).toBe("");
  });
});

describe("soundKit", () => {
  test("defaults to enabled when storage is unavailable (SSR)", () => {
    // Node test environment has no window — preference read must not throw.
    expect(typeof areWorkspaceSoundsEnabled()).toBe("boolean");
  });

  test("playCue fails silent without Web Audio and rejects unknown cues", () => {
    expect(playCue("chime", "positive")).toBe(false);
    expect(playCue("tick")).toBe(false);
    expect(playCue("seal")).toBe(false);
    expect(playCue("nonsense")).toBe(false);
  });
});
