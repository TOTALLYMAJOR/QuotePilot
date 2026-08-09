import React, { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { CustomerDirectoryPresentation } from "../CustomerDirectoryView";
import { CustomerWorkspacePartialNotice } from "../CustomerWorkspaceView";

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
