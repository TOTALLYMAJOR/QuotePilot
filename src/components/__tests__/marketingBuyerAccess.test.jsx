import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import MarketingPage from "../MarketingPage";

const MARKETING_SOURCE = fs.readFileSync(
  new URL("../MarketingPage.jsx", import.meta.url),
  "utf8"
);

describe("marketing buyer-access rollout", () => {
  test("keeps public acquisition routes while buyer access is disabled by default", () => {
    const markup = renderToStaticMarkup(<MarketingPage />);

    expect(markup).toContain("Book a demo");
    expect(markup).toContain("Staff login");
    expect(markup).not.toContain("Try $1 test access");
    expect(markup).not.toContain('href="/start"');
  });

  test("keeps the gated buyer CTA explicitly test-only", () => {
    const match = MARKETING_SOURCE.match(
      /<a[^>]+href="\/start"[^>]*>([\s\S]*?)<\/a>/
    );
    expect(match).not.toBeNull();
    const label = match[1].replace(/\s+/g, " ").trim();
    expect(label).toBe("Try $1 test access");
    expect(label).not.toMatch(/buy|purchase|live charge/i);
  });
});
