// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import CatalogReadNotice from "../CatalogReadNotice";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("CatalogReadNotice", () => {
  test("keeps the quote-builder recovery bounded to the catalog read", () => {
    const markup = renderToStaticMarkup(<CatalogReadNotice />);

    expect(markup).toContain("Library choices are temporarily unavailable.");
    expect(markup).toContain("keep recording event details");
    expect(markup).toContain("offers, menus, rentals, and pricing choices cannot be confirmed");
    expect(markup).toContain("The published Library remains unchanged");
    expect(markup).toContain("Nothing in this draft was saved or repriced");
    expect(markup).not.toContain("Firebase");
    expect(markup).not.toContain("Missing or insufficient permissions");
  });

  test("explains the blocking state without exposing provider implementation detail", () => {
    const markup = renderToStaticMarkup(
      <CatalogReadNotice canContinue={false} headingLevel={1} titleId="catalog-blocked" />
    );

    expect(markup).toContain('<h1 id="catalog-blocked">');
    expect(markup).toContain("Library is required to start this quote.");
    expect(markup).toContain("before quote creation can continue");
    expect(markup).toContain("no Library or quote record changed");
    expect(markup).not.toContain("keep recording event details");
  });

  test("offers one retry and reports its pending state", () => {
    const onRetry = vi.fn();

    act(() => {
      root.render(<CatalogReadNotice onRetry={onRetry} />);
    });
    const retry = container.querySelector("button");
    act(() => retry.click());
    expect(onRetry).toHaveBeenCalledTimes(1);

    act(() => {
      root.render(<CatalogReadNotice loading onRetry={onRetry} />);
    });
    expect(container.querySelector("button").disabled).toBe(true);
    expect(container.querySelector("button").textContent).toBe("Loading Library…");
  });

  test("keeps provider detail behind disclosure", () => {
    const markup = renderToStaticMarkup(
      <CatalogReadNotice technicalDetail="Firebase permission denied" />
    );
    expect(markup).toContain("Technical details");
    expect(markup).toContain("Firebase permission denied");
    expect(markup).not.toContain("<details open");
  });
});
