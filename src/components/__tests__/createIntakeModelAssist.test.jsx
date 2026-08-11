// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import CreateIntake from "../CreateIntake";

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

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

async function renderIntake(onModelParse) {
  act(() => {
    root.render(
      <CreateIntake
        eventTypes={[{ id: "wedding", name: "Wedding" }]}
        styles={["Plated", "Buffet"]}
        onApplyDraft={() => {}}
        organizationId="org-model"
        onModelParse={onModelParse}
        initialText="Corporate dinner for 80 on 2027-09-12, plated."
      />
    );
  });
  await act(async () => { await Promise.resolve(); });
}

function clickModelAssist() {
  const button = [...container.querySelectorAll("button")]
    .find((b) => b.textContent.trim() === "Model assist" || b.textContent.trim() === "Asking the model...");
  act(() => { button.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });
}

async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

const FACT = { id: "model-guests-0", field: "guests", value: "80", displayValue: "80", confidence: "low", source: "model" };

describe("CreateIntake model assist read states", () => {
  test("shows loading while the model request is in flight", async () => {
    const gate = deferred();
    await renderIntake(() => gate.promise);
    clickModelAssist();
    await settle();
    expect(container.innerHTML).toContain('data-capability-state="loading"');
    act(() => gate.resolve({ ok: true, facts: [FACT], notes: [] }));
    await settle();
  });

  test("reports success with confirm-required model facts", async () => {
    await renderIntake(async () => ({ ok: true, facts: [FACT], notes: [] }));
    clickModelAssist();
    await settle();
    expect(container.innerHTML).toContain('data-capability-state="success"');
    expect(container.textContent).toContain("confirm each before it touches the draft");
  });

  test("reports partial when facts arrive alongside unparsed notes", async () => {
    await renderIntake(async () => ({ ok: true, facts: [FACT], notes: ["They want a live band."] }));
    clickModelAssist();
    await settle();
    expect(container.innerHTML).toContain('data-capability-state="partial"');
    expect(container.textContent).toContain("left for you to read");
  });

  test("reports empty when the model reads nothing usable", async () => {
    await renderIntake(async () => ({ ok: true, facts: [], notes: [] }));
    clickModelAssist();
    await settle();
    expect(container.innerHTML).toContain('data-capability-state="empty"');
    expect(container.textContent).toContain("deterministic\n              reading above is unchanged".replace(/\s+/g, " ").trim().split(" ")[0]);
  });

  test("reports a retryable provider failure as error", async () => {
    await renderIntake(async () => ({ ok: false, disabled: false, message: "The model parser is unreachable." }));
    clickModelAssist();
    await settle();
    expect(container.innerHTML).toContain('data-capability-state="error"');
    expect(container.textContent).toContain("Retry model assist");
  });

  test("reports the designed dormant outcome as recovery, keeping the deterministic floor", async () => {
    await renderIntake(async () => ({ ok: false, disabled: true, message: "The model-assisted intake lane is disabled." }));
    clickModelAssist();
    await settle();
    expect(container.innerHTML).toContain('data-capability-state="recovery"');
    expect(container.textContent).toContain("Typed structuring above keeps working");
  });

  test("renders no model affordance at all without an injected model lane", async () => {
    act(() => {
      root.render(
        <CreateIntake
          eventTypes={[]}
          styles={[]}
          onApplyDraft={() => {}}
          initialText="Dinner for 40."
        />
      );
    });
    await settle();
    expect(container.textContent).not.toContain("Model assist");
    expect(container.querySelector(".create-intake-model")).toBeNull();
  });
});
