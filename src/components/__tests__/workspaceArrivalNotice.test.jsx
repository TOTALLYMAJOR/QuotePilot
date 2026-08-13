import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildWorkspaceArrivalNoticePresentation,
  WorkspaceArrivalNotice
} from "../WorkspaceSurfaceBoundary";

const CONTEXT = Object.freeze({
  surfaceId: "workflow",
  object: { id: "request-7", label: "Workflow item" },
  reason: "A recorded customer request was selected for staff review.",
  consequence: "The request remains unresolved; navigation does not stage or save a quote change.",
  nextResolution: "Review the focused request and choose a response available to your role."
});

describe("Workspace exact-arrival notice", () => {
  test("never says ready while destination consumption remains pending", () => {
    const presentation = buildWorkspaceArrivalNoticePresentation(CONTEXT, { status: "pending" });
    expect(presentation).toMatchObject({
      status: "pending",
      title: "Finding Workflow item"
    });
    expect(presentation.title).not.toMatch(/ready/iu);

    const markup = renderToStaticMarkup(
      <WorkspaceArrivalNotice context={CONTEXT} resolution={{ status: "pending" }} />
    );
    expect(markup).toContain('data-arrival-state="pending"');
    expect(markup).toContain("it will not substitute another item");
    expect(markup).not.toContain("Workflow item ready");
  });

  test("says ready only after exact destination focus is resolved", () => {
    const presentation = buildWorkspaceArrivalNoticePresentation(CONTEXT, {
      status: "resolved",
      itemId: "request-7"
    });
    expect(presentation).toMatchObject({
      status: "resolved",
      title: "Workflow item ready"
    });
  });

  test("keeps object, reason, consequence, and next resolution in contextual recovery", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceArrivalNotice
        context={CONTEXT}
        resolution={{
          status: "recovery",
          reason: "The exact Workflow item is no longer present.",
          consequence: "No alternate item was selected.",
          nextResolution: "Return to the opportunity and review its current next action."
        }}
      />
    );
    expect(markup).toContain('data-arrival-state="recovery"');
    expect(markup).toContain("Workflow item unavailable");
    expect(markup).toContain("The exact Workflow item is no longer present.");
    expect(markup).toContain("No alternate item was selected.");
    expect(markup).toContain("Next step:</b> Return to the opportunity");
  });

  test("renders a safe recovery without trusting a rejected arrival contract", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceArrivalNotice
        context={null}
        fallbackSurfaceId="conversation"
        resolution={{
          status: "recovery",
          reason: "The arrival contract was altered or does not match its canonical semantic text.",
          consequence: "No workspace arrival state was accepted.",
          nextResolution: "Keep the current object open and use a supported exact-context action."
        }}
      />
    );
    expect(markup).toContain('data-arrival-surface="conversation"');
    expect(markup).toContain('data-arrival-state="recovery"');
    expect(markup).toContain("requested item unavailable");
    expect(markup).toContain("arrival contract was altered");
    expect(markup).not.toContain("requested item ready");
  });
});
