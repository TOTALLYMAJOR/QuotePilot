// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { InlineValue } from "../ambient";

function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}

describe("Ambient InlineValue", () => {
  let container;
  let root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    window.requestAnimationFrame = (callback) => {
      callback();
      return 1;
    };
    window.cancelAnimationFrame = () => {};
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  test("reads as content, activates directly, and restores focus after cancel", () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const triggerRef = React.createRef();
    act(() => root.render(
      <InlineValue
        ref={triggerRef}
        label="Guest count"
        value={120}
        onCommit={onCommit}
        onCancel={onCancel}
      />
    ));

    const trigger = container.querySelector(".ambient-inline-value__trigger");
    expect(triggerRef.current).toBe(trigger);
    expect(trigger.textContent).toContain("Guest count");
    expect(trigger.textContent).toContain("120");
    expect(trigger.getAttribute("aria-label")).toBe("Change Guest count");

    act(() => trigger.click());
    const input = container.querySelector("input");
    expect(triggerRef.current).toBeNull();
    expect(input.value).toBe("120");
    expect(document.activeElement).toBe(input);

    act(() => setInputValue(input, "135"));
    expect(onCommit).not.toHaveBeenCalled();
    act(() => input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));

    expect(onCancel).toHaveBeenCalledWith({ value: 120, draft: "135" });
    expect(container.querySelector("input")).toBeNull();
    expect(triggerRef.current).toBe(container.querySelector(".ambient-inline-value__trigger"));
    expect(document.activeElement).toBe(container.querySelector(".ambient-inline-value__trigger"));
  });

  test("commits only the staged parsed value through an outcome-named action", async () => {
    const onCommit = vi.fn(async () => true);
    act(() => root.render(
      <InlineValue
        label="Guest count"
        value={120}
        onCommit={onCommit}
        parseValue={(draft) => Number(draft)}
        commitLabel="Use 135 guests"
      />
    ));

    act(() => container.querySelector("button").click());
    const input = container.querySelector("input");
    act(() => setInputValue(input, "135"));
    expect(onCommit).not.toHaveBeenCalled();
    expect(container.querySelector('button[type="submit"]').textContent).toBe("Use 135 guests");

    await act(async () => {
      container.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(onCommit).toHaveBeenCalledWith(135, { previousValue: 120, draft: "135" });
    expect(container.querySelector("input")).toBeNull();
  });

  test("keeps invalid and rejected changes in context with recovery", async () => {
    const onCommit = vi.fn(async () => false);
    act(() => root.render(
      <InlineValue
        label="Guest count"
        value={120}
        onCommit={onCommit}
        validate={(draft) => Number(draft) < 1 ? "Guest count must be at least 1." : ""}
      />
    ));

    act(() => container.querySelector("button").click());
    act(() => setInputValue(container.querySelector("input"), "0"));
    await act(async () => container.querySelector('button[type="submit"]').click());
    expect(container.querySelector('[role="alert"]').textContent).toBe("Guest count must be at least 1.");
    expect(onCommit).not.toHaveBeenCalled();

    act(() => setInputValue(container.querySelector("input"), "150"));
    await act(async () => {
      container.querySelector('button[type="submit"]').click();
      await Promise.resolve();
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="alert"]').textContent).toContain("not applied");
    expect(container.querySelector("input")).not.toBeNull();
  });

  test("exposes stable action hooks for edit, validation, commit, and cancel", async () => {
    const onEditStart = vi.fn();
    const onValidationError = vi.fn();
    const onCommitStart = vi.fn(() => ({ token: "guest-commit" }));
    const onCommit = vi.fn(async () => true);
    act(() => root.render(
      <InlineValue
        label="Guest count"
        value={120}
        onCommit={onCommit}
        validate={(draft) => Number(draft) < 1 ? "Use a positive guest count." : ""}
        parseValue={Number}
        onEditStart={onEditStart}
        onValidationError={onValidationError}
        onCommitStart={onCommitStart}
        editActionId="open-guest-count-inline-edit"
        commitActionId="simulate-guest-count"
        cancelActionId="cancel-guest-count-inline-edit"
      />
    ));

    const edit = container.querySelector("button");
    expect(edit.dataset.ambientActionId).toBe("open-guest-count-inline-edit");
    act(() => edit.click());
    expect(onEditStart).toHaveBeenCalledOnce();
    expect(container.querySelector('button[type="submit"]').dataset.ambientActionId)
      .toBe("simulate-guest-count");
    expect(container.querySelector('.ambient-inline-value__cancel').dataset.ambientActionId)
      .toBe("cancel-guest-count-inline-edit");

    act(() => setInputValue(container.querySelector("input"), "0"));
    await act(async () => container.querySelector('button[type="submit"]').click());
    expect(onValidationError).toHaveBeenCalledWith({
      value: 120,
      draft: "0",
      message: "Use a positive guest count."
    });
    expect(onCommitStart).not.toHaveBeenCalled();

    act(() => setInputValue(container.querySelector("input"), "135"));
    await act(async () => {
      container.querySelector('button[type="submit"]').click();
      await Promise.resolve();
    });
    expect(onCommitStart).toHaveBeenCalledWith({ value: 120, draft: "135", nextValue: 135 });
    expect(onCommit).toHaveBeenCalledWith(135, {
      previousValue: 120,
      draft: "135",
      commitContext: { token: "guest-commit" }
    });
  });
});
