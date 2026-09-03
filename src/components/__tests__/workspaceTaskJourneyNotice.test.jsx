import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import WorkspaceTaskJourneyNotice, {
  buildWorkspaceTaskJourneyPresentation
} from "../WorkspaceTaskJourneyNotice";

const JOURNEY = Object.freeze({
  taskId: "review-now-priority:follow-up:quote-42",
  phase: "in_progress",
  contextState: "ready",
  destination: "workflow",
  intentId: "review_follow_up"
});

describe("WorkspaceTaskJourneyNotice", () => {
  test("keeps exact context readiness separate from task completion", () => {
    const presentation = buildWorkspaceTaskJourneyPresentation(JOURNEY, "workflow");

    expect(presentation).toMatchObject({
      taskLabel: "Follow-up",
      phaseLabel: "In progress",
      atDestination: true,
      canContinue: false
    });
    expect(presentation.context).toContain("requires authoritative confirmation");

    const markup = renderToStaticMarkup(
      <WorkspaceTaskJourneyNotice journey={JOURNEY} currentRouteId="workflow" />
    );
    expect(markup).toContain('data-workspace-task-state="in_progress"');
    expect(markup).toContain('data-workspace-task-context="ready"');
    expect(markup).toContain("In progress");
    expect(markup).not.toContain("Completed");
  });

  test("offers a 44px-capable continuation away from the exact destination", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceTaskJourneyNotice
        journey={{ ...JOURNEY, contextState: "locating" }}
        currentRouteId="home"
        onContinue={vi.fn()}
        onStopTracking={vi.fn()}
      />
    );

    expect(markup).toContain('role="region"');
    expect(markup).toContain('aria-label="Current task: Follow-up, In progress"');
    expect(markup).not.toContain("aria-live");
    expect(markup).toContain(">Continue</button>");
    expect(markup).toContain(">Stop tracking</button>");
    expect(markup).toContain("No business record has changed");
  });

  test("uses distinct uncertain language and hides cancelled tracking", () => {
    const uncertain = renderToStaticMarkup(
      <WorkspaceTaskJourneyNotice
        journey={{ ...JOURNEY, phase: "uncertain", contextState: "recovery" }}
        currentRouteId="home"
        onContinue={vi.fn()}
        onStopTracking={vi.fn()}
      />
    );
    const cancelled = renderToStaticMarkup(
      <WorkspaceTaskJourneyNotice
        journey={{ ...JOURNEY, phase: "cancelled" }}
        currentRouteId="home"
      />
    );

    expect(uncertain).toContain("Needs confirmation");
    expect(uncertain).toContain('data-workspace-task-state="uncertain"');
    expect(uncertain).toContain('aria-label="Current task: Follow-up, Needs confirmation"');
    expect(uncertain).toContain("Outcome not confirmed");
    expect(uncertain).toContain(">Stop tracking</button>");
    expect(uncertain).not.toContain(">Continue</button>");
    expect(uncertain).not.toContain("authoritative same-workspace readback");
    expect(uncertain).not.toContain("Completed");
    expect(cancelled).toBe("");
  });

  test("offers exact-context recovery at the destination without claiming completion", () => {
    const presentation = buildWorkspaceTaskJourneyPresentation({
      ...JOURNEY,
      contextState: "recovery"
    }, "workflow");

    expect(presentation).toMatchObject({
      atDestination: true,
      canContinue: true,
      phaseLabel: "In progress"
    });
    expect(presentation.context).toContain("No substitute opened");
  });

  test("shows a confirmed outcome independently of its last route context", () => {
    const resolvedJourney = {
      ...JOURNEY,
      phase: "resolved",
      contextState: "locating"
    };
    const presentation = buildWorkspaceTaskJourneyPresentation(resolvedJourney, "home");

    expect(presentation).toMatchObject({
      phaseLabel: "Completed",
      canContinue: false,
      canStopTracking: false
    });
    expect(presentation.context).toContain("authoritative same-workspace readback");

    const markup = renderToStaticMarkup(
      <WorkspaceTaskJourneyNotice
        journey={resolvedJourney}
        currentRouteId="home"
        onContinue={vi.fn()}
        onStopTracking={vi.fn()}
      />
    );
    expect(markup).toContain('data-workspace-task-state="resolved"');
    expect(markup).toContain('aria-label="Current task: Follow-up, Completed"');
    expect(markup).toContain("authoritative same-workspace readback");
    expect(markup).not.toContain("receipt");
    expect(markup).not.toContain(">Continue</button>");
    expect(markup).not.toContain(">Stop tracking</button>");
  });
});
