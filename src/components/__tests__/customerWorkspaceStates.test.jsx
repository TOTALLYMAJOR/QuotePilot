import React, { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { CustomerDirectoryPresentation } from "../CustomerDirectoryView";
import {
  CustomerEventsHeader,
  CustomerRelationshipBriefing,
  CustomerWorkspacePartialNotice,
  CustomerWorkspaceReadState,
  resolveCustomerWorkspaceTabKey
} from "../CustomerWorkspaceView";

const READY_DIRECTORY = {
  loading: false,
  error: "",
  source: "firebase",
  items: [],
  nextCursor: ""
};

function directoryMarkup(state) {
  return renderToStaticMarkup(
    <CustomerDirectoryPresentation
      state={state}
      searchDraft=""
      cursorHistoryLength={0}
      onSearchDraftChange={() => {}}
      onApplySearch={() => {}}
      onClear={() => {}}
      onRefresh={() => {}}
      onOpenCustomer={() => {}}
      onNewQuote={() => {}}
      onPreviousPage={() => {}}
      onNextPage={() => {}}
    />
  );
}

function elementText(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(elementText).join("");
  if (!isValidElement(node)) return "";
  return elementText(node.props.children);
}

function findElement(node, predicate) {
  if (isValidElement(node) && predicate(node)) return node;
  if (!isValidElement(node)) return null;
  const children = Array.isArray(node.props.children) ? node.props.children : [node.props.children];
  for (const child of children) {
    const match = findElement(child, predicate);
    if (match) return match;
  }
  return null;
}

describe("customer workspace executable presentation states", () => {
  test("renders the customer directory loading state before results resolve", () => {
    const markup = directoryMarkup({
      ...READY_DIRECTORY,
      loading: true,
      source: ""
    });

    expect(markup).toContain('role="status"');
    expect(markup).toContain('data-capability-state="loading"');
    expect(markup).toContain("Loading customers...");
    expect(markup).not.toContain("No customers match this directory view.");
    expect(markup).not.toContain("<table");
  });

  test("renders the customer directory empty state after a completed read", () => {
    const markup = directoryMarkup(READY_DIRECTORY);

    expect(markup).toContain("Source: Firestore staff records");
    expect(markup).toContain('data-capability-state="empty"');
    expect(markup).toContain("No customers match this directory view.");
    expect(markup).not.toContain('role="alert"');
    expect(markup).not.toContain("<table");
  });

  test("renders the customer directory success state with customer actions", () => {
    const markup = directoryMarkup({
      ...READY_DIRECTORY,
      items: [{
        id: "customer-opaque-1",
        name: "Ada Lovelace",
        company: "Analytical Events",
        email: "ada@example.test",
        phone: "555-0101",
        lastQuoteNumber: "Q-1001",
        lastEventName: "Launch dinner",
        lastEventDate: "2026-09-01"
      }]
    });

    expect(markup).toContain("<table");
    expect(markup).toContain('role="region"');
    expect(markup).toContain('aria-label="Customer directory results"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('data-capability-state="success"');
    expect(markup).toContain("Ada Lovelace");
    expect(markup).toContain("Q-1001");
    expect(markup).toContain("Open 360");
    expect(markup).not.toContain("No customers match this directory view.");
  });

  test("renders the Customer 360 partial state with its bounded-read limit", () => {
    const markup = renderToStaticMarkup(
      <CustomerWorkspacePartialNotice
        quotePageInfo={{ truncated: true, limit: 25 }}
        onOpenQuotes={() => {}}
      />
    );
    const completeMarkup = renderToStaticMarkup(
      <CustomerWorkspacePartialNotice
        quotePageInfo={{ truncated: false, limit: 25 }}
        onOpenQuotes={() => {}}
      />
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain('data-capability-state="partial"');
    expect(markup).toContain("partial view capped at 25 linked quotes");
    expect(markup).toContain("counts and money below are not complete");
    expect(markup).toContain("Open complete Quotes history");
    expect(completeMarkup).toBe("");
  });

  test("renders the customer directory error state without claiming empty results", () => {
    const markup = directoryMarkup({
      ...READY_DIRECTORY,
      error: "Customer directory is temporarily unavailable."
    });

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('data-capability-state="error"');
    expect(markup).toContain("Customer directory is temporarily unavailable.");
    expect(markup).not.toContain("No customers match this directory view.");
    expect(markup).not.toContain("<table");
  });

  test("retains a completed customer directory page with explicit stale read context", () => {
    const markup = directoryMarkup({
      ...READY_DIRECTORY,
      error: "Customer directory refresh failed.",
      stale: true,
      loadedAt: Date.parse("2026-08-09T12:00:00.000Z"),
      items: [{
        id: "customer-opaque-1",
        name: "Ada Lovelace",
        email: "ada@example.test"
      }]
    });

    expect(markup).toContain('data-capability-state="stale"');
    expect(markup).toContain("Customer directory read context");
    expect(markup).toContain("prior completed page remains visible");
    expect(markup).toContain("Ada Lovelace");
    expect(markup).not.toContain("No customers match this directory view.");
  });

  test("renders the bounded Customer 360 relationship briefing and exact next action", () => {
    const markup = renderToStaticMarkup(
      <CustomerRelationshipBriefing
        briefing={{
          activeQuoteCount: 2,
          displayedQuoteCount: 25,
          attentionCount: 1,
          nextEvent: {
            quoteId: "quote-2",
            eventName: "Board dinner",
            date: "2026-09-01"
          },
          latestActivity: {
            quoteId: "quote-1",
            label: "Proposal accepted",
            atISO: "2026-08-08T10:00:00.000Z"
          },
          nextAction: {
            kind: "workflow",
            label: "Review the customer change request",
            quoteId: "quote-1",
            attentionType: "change_request"
          },
          scope: { limit: 25, truncated: true }
        }}
        onOpenQuote={() => {}}
        onOpenWorkflow={() => {}}
      />
    );

    expect(markup).toContain('data-capability-state="partial"');
    expect(markup).toContain("What matters next");
    expect(markup).toContain("older linked quotes exist");
    expect(markup).toContain("Board dinner");
    expect(markup).toContain("Proposal accepted");
    expect(markup).toContain("Open in Workflow");
  });

  test("qualifies missing briefing milestones when the customer read is truncated", () => {
    const boundedMarkup = renderToStaticMarkup(
      <CustomerRelationshipBriefing
        briefing={{
          activeQuoteCount: 0,
          displayedQuoteCount: 25,
          attentionCount: 0,
          scope: { truncated: true }
        }}
      />
    );
    const completeMarkup = renderToStaticMarkup(
      <CustomerRelationshipBriefing
        briefing={{
          activeQuoteCount: 0,
          displayedQuoteCount: 0,
          attentionCount: 0,
          scope: { truncated: false }
        }}
      />
    );

    expect(boundedMarkup).toContain("No dated event in this bounded view");
    expect(boundedMarkup).toContain("No activity in this bounded view");
    expect(completeMarkup).toContain("No dated event recorded");
    expect(completeMarkup).toContain("No activity recorded");
  });

  test("exposes loading, error recovery, and completed-empty Customer 360 states with read context", () => {
    const retry = vi.fn();
    const loadingMarkup = renderToStaticMarkup(
      <CustomerWorkspaceReadState
        state="loading"
        organizationId="org-1"
        organizationName="Test Org"
      />
    );
    const errorTree = CustomerWorkspaceReadState({
      state: "error",
      organizationId: "org-1",
      organizationName: "Test Org",
      errorMessage: "Tenant read failed.",
      onRetry: retry
    });
    const errorMarkup = renderToStaticMarkup(errorTree);
    const retryButton = findElement(errorTree, (element) => (
      element.type === "button" && elementText(element) === "Retry"
    ));
    const emptyMarkup = renderToStaticMarkup(
      <CustomerWorkspaceReadState
        state="empty"
        organizationId="org-1"
        organizationName="Test Org"
        loadedAt={Date.parse("2026-08-09T12:00:00.000Z")}
      />
    );

    expect(loadingMarkup).toContain('data-capability-state="loading"');
    expect(loadingMarkup).toContain("Customer 360 read context");
    expect(errorMarkup).toContain('data-capability-state="error"');
    expect(errorMarkup).toContain('data-capability-state="recovery"');
    expect(errorMarkup).toContain("Tenant read failed.");
    retryButton.props.onClick();
    expect(retry).toHaveBeenCalledOnce();
    expect(emptyMarkup).toContain('data-capability-state="empty"');
    expect(emptyMarkup).toContain("Customer not found");
    expect(emptyMarkup).toContain("bounded tenant-scoped read completed");
  });

  test("maps Customer 360 tabs with wraparound keyboard behavior", () => {
    expect(resolveCustomerWorkspaceTabKey("overview", "ArrowRight")).toBe("quotes");
    expect(resolveCustomerWorkspaceTabKey("overview", "ArrowLeft")).toBe("conversations");
    expect(resolveCustomerWorkspaceTabKey("events", "Home")).toBe("overview");
    expect(resolveCustomerWorkspaceTabKey("events", "End")).toBe("conversations");
    expect(resolveCustomerWorkspaceTabKey("events", "Enter")).toBe("events");
  });

  test("does not offer a Schedule route when the feature is unavailable", () => {
    const disabledMarkup = renderToStaticMarkup(<CustomerEventsHeader scheduleAvailable={false} />);
    const enabledMarkup = renderToStaticMarkup(<CustomerEventsHeader scheduleAvailable onOpenSchedule={() => {}} />);

    expect(disabledMarkup).toContain("Schedule is not enabled for this organization.");
    expect(disabledMarkup).not.toContain("Open Schedule");
    expect(enabledMarkup).toContain("Open Schedule");
  });

  test("executes the customer directory recovery control after an error", () => {
    const onRefresh = vi.fn();
    const errorMarkup = directoryMarkup({
      ...READY_DIRECTORY,
      error: "Customer directory is temporarily unavailable."
    });
    const tree = CustomerDirectoryPresentation({
      state: {
        ...READY_DIRECTORY,
        error: "Customer directory is temporarily unavailable."
      },
      searchDraft: "",
      cursorHistoryLength: 0,
      onRefresh
    });
    const refreshButton = findElement(tree, (element) => (
      element.type === "button" && elementText(element) === "Refresh"
    ));

    expect(refreshButton).not.toBeNull();
    expect(errorMarkup).toContain('data-capability-state="recovery"');
    expect(directoryMarkup(READY_DIRECTORY)).not.toContain(
      'data-capability-state=' + '"recovery"'
    );
    expect(refreshButton.props["data-capability-state"]).toBe("recovery");
    refreshButton.props.onClick();
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});
