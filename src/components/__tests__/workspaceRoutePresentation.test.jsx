import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { QuoteHistoryView } from "../QuoteHistoryModal";
import { SalesWorkflowView } from "../SalesWorkflowModal";

function renderHistory(presentation) {
  return renderToStaticMarkup(
    <QuoteHistoryView
      open
      presentation={presentation}
      organizationId="org-1"
      currentUserRole="admin"
      onClose={() => {}}
    />
  );
}

function renderWorkflow(presentation) {
  return renderToStaticMarkup(
    <SalesWorkflowView
      open
      presentation={presentation}
      organizationId="org-1"
      currentUserRole="admin"
      onClose={() => {}}
    />
  );
}

describe("workspace route presentation", () => {
  test("Quotes uses route return language and a focusable heading only when embedded", () => {
    const embedded = renderHistory("embedded");
    const modal = renderHistory("modal");

    expect(embedded).toContain('role="main"');
    expect(embedded).toContain('id="quote-history-title" class="workspace-route-heading" tabindex="-1"');
    expect(embedded).toContain("Back to Home");
    expect(embedded).not.toContain(">Close</button>");

    expect(modal).toContain('role="dialog"');
    expect(modal).toContain(">Close</button>");
    expect(modal).not.toContain("Back to Home");
  });

  test("Workflow uses route return language and a focusable heading only when embedded", () => {
    const embedded = renderWorkflow("embedded");
    const modal = renderWorkflow("modal");

    expect(embedded).toContain('role="region"');
    expect(embedded).toContain('id="sales-workflow-title" class="workspace-route-heading" tabindex="-1"');
    expect(embedded).toContain("Back to Home");
    expect(embedded).not.toContain(">Close</button>");

    expect(modal).toContain('role="dialog"');
    expect(modal).toContain(">Close</button>");
    expect(modal).not.toContain("Back to Home");
  });
});
