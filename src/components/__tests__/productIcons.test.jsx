// @vitest-environment jsdom

import React, { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { ArrowRight, CheckCircle } from "../ProductIcons";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ProductIcons", () => {
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

  test("keeps the icon component contract accessible and ref-safe", () => {
    const iconRef = createRef();

    act(() => {
      root.render(
        <CheckCircle
          ref={iconRef}
          size={19}
          color="#137b6a"
          weight="fill"
          className="status-icon"
          aria-hidden="true"
        />
      );
    });

    const icon = container.querySelector("svg");
    expect(iconRef.current).toBe(icon);
    expect(icon.getAttribute("width")).toBe("19");
    expect(icon.getAttribute("height")).toBe("19");
    expect(icon.getAttribute("stroke")).toBe("#137b6a");
    expect(icon.getAttribute("stroke-width")).toBe("2.35");
    expect(icon.getAttribute("focusable")).toBe("false");
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(icon.classList.contains("status-icon")).toBe(true);
    expect(icon.querySelector("path")?.getAttribute("d")).toBeTruthy();
  });

  test("merges mirrored presentation with caller styles", () => {
    act(() => {
      root.render(<ArrowRight mirrored style={{ opacity: 0.75, transform: "translateX(1px)" }} />);
    });

    const icon = container.querySelector("svg");
    expect(icon.style.opacity).toBe("0.75");
    expect(icon.style.transform).toContain("translateX(1px)");
    expect(icon.style.transform).toContain("scaleX(-1)");
  });
});
