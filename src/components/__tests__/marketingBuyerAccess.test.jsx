import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import MarketingPage from "../MarketingPage";

describe("marketing buyer-access rollout", () => {
  test("keeps public acquisition routes while buyer access is disabled by default", () => {
    const markup = renderToStaticMarkup(<MarketingPage />);

    expect(markup).toContain("Book a demo");
    expect(markup).toContain("Staff login");
    expect(markup).not.toContain("Try $1 test access");
    expect(markup).not.toContain('href="/start"');
  });
});
