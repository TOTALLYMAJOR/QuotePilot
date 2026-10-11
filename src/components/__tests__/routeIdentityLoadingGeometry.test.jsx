import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import AmbientNowView from "../AmbientNowView";
import { EventScheduleView } from "../EventScheduleModal";
import NowView from "../NowView";
import {
  WorkspaceRouteLoading,
  WorkspaceSectionLoading
} from "../WorkspaceSurfaceBoundary";

function extractPendingSurface(markup, attribute) {
  const match = markup.match(new RegExp(`<[^>]+${attribute}[^>]*>[\\s\\S]*?<\\/[^>]+>`));
  return match?.[0] || "";
}

describe("routed workspace identity", () => {
  test("gives both Now presentations one programmatic page heading", () => {
    const classic = renderToStaticMarkup(<NowView />);
    const ambient = renderToStaticMarkup(<AmbientNowView />);

    expect(classic).toContain('<h1 id="now-heading"');
    expect(classic).not.toContain('<h2 id="now-heading"');
    expect(ambient).toContain('<h1 id="now-heading"');
    expect(ambient).not.toContain('<h2 id="now-heading"');
  });

  test("uses a main and h1 for routed Operations while preserving modal dialog semantics", () => {
    const routed = renderToStaticMarkup(
      <EventScheduleView open presentation="embedded" surfaceTitle="Operations" />
    );
    const modal = renderToStaticMarkup(
      <EventScheduleView open presentation="modal" surfaceTitle="Schedule" />
    );

    expect(routed).toContain('<main class="container workspace-route-main embedded-workspace-route"');
    expect(routed).toContain('<h1 id="event-schedule-title"');
    expect(routed).not.toContain('role="dialog"');
    expect(modal).toContain('role="dialog"');
    expect(modal).toContain('<h2 id="event-schedule-title"');
    expect(modal).not.toContain('<main');
  });
});

describe("workspace loading geometry", () => {
  test("keeps a route-shaped, status-only fallback without active controls", () => {
    const markup = renderToStaticMarkup(<WorkspaceRouteLoading surfaceName="Operations" />);

    expect(markup).toContain('data-workspace-route-loading="true"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('data-workspace-loading-slot="primary"');
    expect(markup).toContain('data-workspace-loading-slot="supplemental"');
    expect(markup).not.toMatch(/<(?:button|a|input|select|textarea)\b/);
    expect(markup).not.toContain('tabindex="0"');
  });

  test("reserves bounded section rows while exposing only the pending label", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceSectionLoading label="Loading events…" rows={3} />
    );
    const pendingSurface = extractPendingSurface(markup, "data-workspace-section-loading");

    expect(pendingSurface).toContain('role="status"');
    expect(pendingSurface).toContain('aria-busy="true"');
    expect(pendingSurface).toContain("Loading events…");
    expect(markup.match(/data-workspace-loading-row="true"/g)).toHaveLength(3);
    expect(pendingSurface).not.toMatch(/<(?:button|a|input|select|textarea)\b/);
    expect(pendingSurface).not.toContain('tabindex="0"');
  });
});
