import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React, { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { CommercialSearchPaletteContent } from "../CommercialSearchPalette";

function searchState(status, overrides = {}) {
  return {
    status,
    source: "firebase",
    results: [],
    reads: {
      customers: { status: "success", source: "firebase", truncated: false },
      quotes: { status: "success", source: "firebase", truncated: false }
    },
    partialReasons: [],
    truncated: false,
    ...overrides
  };
}

function renderPalette({ query = "henderson", state, ...props } = {}) {
  return renderToStaticMarkup(
    <CommercialSearchPaletteContent
      query={query}
      state={state || searchState("success")}
      {...props}
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

describe("commercial search palette presentation", () => {
  test("exposes the source and bounded loading state", () => {
    const markup = renderPalette({ state: searchState("loading", {
      source: "",
      reads: {
        customers: { status: "not-requested", source: "", truncated: false },
        quotes: { status: "not-requested", source: "", truncated: false }
      }
    }) });

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('data-capability-state="loading"');
    expect(markup).toContain('data-capability-state="source"');
    expect(markup).toContain("Searching bounded staff records...");
    expect(markup).toContain("latest 50 quote records");
  });

  test("distinguishes instructional and completed empty states", () => {
    const instructional = renderPalette({ query: "", state: searchState("empty") });
    const completed = renderPalette({ query: "henderson", state: searchState("empty") });

    expect(instructional).toContain('data-capability-state="empty"');
    expect(instructional).toContain("Type at least 2 characters to search.");
    expect(completed).toContain("No customer or recent quote matches were found");
    expect(completed).not.toContain('role="alert"');
  });

  test("renders safe customer and quote actions in the success state", () => {
    const onSelectResult = vi.fn();
    const results = [
      {
        kind: "customer",
        id: "customer-opaque-1",
        title: "Henderson Foods",
        detail: "Henderson Group · events@henderson.test"
      },
      {
        kind: "quote",
        id: "quote-opaque-1",
        title: "QP-1042",
        detail: "Henderson Foods · Corporate picnic"
      }
    ];
    const markup = renderPalette({ state: searchState("success", { results }) });
    const tree = CommercialSearchPaletteContent({
      query: "henderson",
      state: searchState("success", { results }),
      onSelectResult
    });
    const quoteButton = findElement(tree, (element) => (
      element.type === "button" && elementText(element).includes("QP-1042")
    ));

    expect(markup).toContain('data-capability-state="success"');
    expect(markup).toContain("Henderson Foods");
    expect(markup).toContain("QP-1042");
    expect(markup).not.toContain("href=");
    expect(quoteButton).not.toBeNull();
    quoteButton.props.onClick();
    expect(onSelectResult).toHaveBeenCalledWith(results[1]);
  });

  test("keeps partial results actionable and exposes retry", () => {
    const onRetry = vi.fn();
    const state = searchState("partial", {
      results: [{ kind: "quote", id: "quote-1", title: "QP-1", detail: "Picnic" }],
      reads: {
        customers: { status: "error", source: "", truncated: false },
        quotes: { status: "success", source: "firebase", truncated: false }
      },
      partialReasons: ["customer-read-unavailable"]
    });
    const markup = renderPalette({ state });
    const tree = CommercialSearchPaletteContent({ query: "picnic", state, onRetry });
    const retryButton = findElement(tree, (element) => (
      element.type === "button" && element.props["data-capability-state"] === "recovery"
    ));

    expect(markup).toContain('data-capability-state="partial"');
    expect(markup).toContain("One search source is unavailable");
    expect(markup).toContain("QP-1");
    expect(markup).toContain('data-capability-state="recovery"');
    retryButton.props.onClick();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  test("exposes a bounded error without leaking underlying read details", () => {
    const markup = renderPalette({ state: searchState("error", {
      source: "",
      reads: {
        customers: { status: "error", source: "", truncated: false },
        quotes: { status: "error", source: "", truncated: false }
      }
    }) });

    expect(markup).toContain('data-capability-state="error"');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("could not read either bounded source");
    expect(markup).toContain('data-capability-state="recovery"');
  });

  test("uses the shared focus trap and explicit return-focus contract", () => {
    const componentSource = readFileSync(
      fileURLToPath(new URL("../CommercialSearchPalette.jsx", import.meta.url)),
      "utf8"
    );
    const appSource = readFileSync(
      fileURLToPath(new URL("../../App.jsx", import.meta.url)),
      "utf8"
    );
    const legacyAppSource = readFileSync(
      fileURLToPath(new URL("../../LegacyApp.jsx", import.meta.url)),
      "utf8"
    );
    const shellSource = readFileSync(
      fileURLToPath(new URL("../../lib/commercialSearchShell.js", import.meta.url)),
      "utf8"
    );
    expect(componentSource).toContain("useModalDialog({");
    expect(componentSource).toContain("initialFocusRef: inputRef");
    expect(componentSource).toContain("returnFocusRef");
    expect(componentSource).toContain("autoComplete=\"off\"");
    expect(componentSource).not.toMatch(/localStorage|sessionStorage|URLSearchParams|pushState|replaceState/);
    expect(appSource).toContain(
      "onOpenCustomer={(customerId) => navigateWorkspace(buildCustomerPath(customerId))}"
    );
    expect(appSource).toContain(
      "onOpenQuote={(quoteId) => navigateWorkspace(buildQuotePath(quoteId))}"
    );
    expect(appSource).not.toMatch(/build(?:Customer|Quote)Path\(query\)/);
    expect(appSource).toContain("const CommercialSearchPalette = createRecoverableLazy(");
    expect(appSource).toContain("enabled: CUSTOMER_CENTERED_WORKSPACE_ENABLED");
    expect(appSource).toContain("component={CommercialSearchPalette}");
    expect(appSource).not.toContain(
      'import CommercialSearchPalette from "./components/CommercialSearchPalette"'
    );
    expect(legacyAppSource).toContain("const CommercialSearchPalette = createRecoverableLazy(");
    expect(legacyAppSource).toContain("component={CommercialSearchPalette}");
    expect(shellSource).not.toMatch(/customerWorkspace|quoteStore|firebase|localStorage|sessionStorage/);
  });
});
