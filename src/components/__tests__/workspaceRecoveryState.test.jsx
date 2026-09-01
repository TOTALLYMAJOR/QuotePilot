import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import WorkspaceRecoveryState from "../WorkspaceRecoveryState";

describe("WorkspaceRecoveryState", () => {
  test("keeps recovery context attached to one named action group", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceRecoveryState
        eyebrow="Events unavailable"
        title="We couldn’t load event records."
        description="No event status changed."
        titleId="events-unavailable"
        actionGroupLabel="Event recovery actions"
      >
        <button type="button">Try again</button>
        <button type="button">Review opportunities</button>
      </WorkspaceRecoveryState>
    );

    expect(markup).toContain('aria-labelledby="events-unavailable"');
    expect(markup).toContain('role="group"');
    expect(markup).toContain('aria-label="Event recovery actions"');
    expect(markup).toContain('data-layout-audit-group="events-unavailable-actions"');
    expect(markup).toContain("No event status changed.");
  });

  test("does not render an empty action group", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceRecoveryState
        eyebrow="Event not found"
        title="This event isn’t in the current view."
        description="No other event opened in its place."
        titleId="event-not-found"
      />
    );

    expect(markup).not.toContain("workspace-recovery-state__actions");
    expect(markup).not.toContain('role="group"');
  });
});
