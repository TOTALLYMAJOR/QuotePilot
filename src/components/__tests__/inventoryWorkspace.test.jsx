// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { DEFAULT_FEATURE_FLAGS } from "../../data/mockCatalog";
import InventoryWorkspace, {
  EventSupplyActionPlanPanel,
  InventoryMobileCapturePanel,
  InventoryWorkspaceView,
  buildInventoryExceptionCards
} from "../InventoryWorkspace";

const ORGANIZATION_ID = "org-inventory-workspace";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container;
let root;

function attempt(state = "ready", overrides = {}) {
  return { state, error: "", requestId: "", receipt: null, confirmation: null, ...overrides };
}

function attempts(overrides = {}) {
  return {
    location: attempt(),
    ingredient: attempt(),
    stock: attempt(),
    receiving: attempt(),
    cost: attempt(),
    conversion: attempt(),
    ...overrides
  };
}

function projectionModel(overrides = {}) {
  return {
    schemaVersion: 2,
    organizationId: ORGANIZATION_ID,
    workspace: {
      organizationId: ORGANIZATION_ID,
      locations: [{ locationId: "main-kitchen", name: "Main kitchen", active: true, revision: 1 }]
    },
    ingredients: [{
      organizationId: ORGANIZATION_ID,
      ingredientId: "chicken",
      name: "Chicken",
      nameSortKey: "chicken",
      category: "Protein",
      baseUnitId: "lb",
      dimension: "mass",
      active: true,
      ingredientRevision: 1,
      stock: {
        state: "recorded",
        availability: "current",
        revision: 1,
        onHandMicros: 40_000_000,
        quantity: "40",
        allocationRevision: 1,
        committedMicros: 25_000_000,
        committedQuantity: "25",
        availableToAllocateMicros: 15_000_000,
        availableToAllocateQuantity: "15",
        unit: "lb",
        locationId: "main-kitchen",
        lastMovementId: `imv_${"a".repeat(48)}`
      },
      cost: {
        state: "not_recorded",
        availability: "not_yet_available",
        revision: 0,
        sourceLabel: "",
        observedAtISO: "",
        lastCostEvidenceId: ""
      },
      packConversions: [],
      locationId: "main-kitchen",
      locationName: "Main kitchen"
    }],
    sources: {
      workspace: { state: "current", fromCache: false, hasPendingWrites: false },
      ingredients: { state: "current", fromCache: false, hasPendingWrites: false }
    },
    freshness: "current",
    bounded: false,
    ...overrides
  };
}

const ADMIN_ACCESS = Object.freeze({
  organizationId: ORGANIZATION_ID,
  role: "admin",
  readEnabled: true,
  mutationEnabled: true,
  reason: ""
});

function viewMarkup({ model = projectionModel(), readState = "current", attemptOverrides = {}, access = ADMIN_ACCESS } = {}) {
  return renderToStaticMarkup(
    <InventoryWorkspaceView
      access={access}
      read={{ state: readState, model, error: "" }}
      attempts={attempts(attemptOverrides)}
      exceptionWorkspaceEnabled
      onRetry={() => {}}
      onSubmit={() => {}}
      onReconcile={() => {}}
      onReset={() => {}}
    />
  );
}

function setInput(input, value) {
  const descriptor = Object.getOwnPropertyDescriptor(
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : input instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype,
    "value"
  );
  descriptor.set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function openPackEditor() {
  const trigger = [...container.querySelectorAll("button")]
    .find((button) => button.textContent === "Declare or revise pack");
  await act(async () => trigger.click());
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("InventoryWorkspace ingredient evidence presentation", () => {
  test("prioritizes shortage, stale count, missing cost, conversion, and contention exceptions", () => {
    const ingredient = {
      ...projectionModel().ingredients[0],
      updatedAtISO: "2026-09-01T00:00:00.000Z",
      packConversions: [],
      stock: {
        ...projectionModel().ingredients[0].stock,
        onHandMicros: 25_000_000,
        quantity: "25",
        committedMicros: 25_000_000,
        committedQuantity: "25",
        availableToAllocateMicros: 0,
        availableToAllocateQuantity: "0"
      }
    };
    expect(buildInventoryExceptionCards([ingredient], { now: Date.parse("2026-09-17T00:00:00.000Z") })
      .map((card) => card.kind)).toEqual([
      "shortage", "stale_count", "missing_cost", "missing_conversion", "contention"
    ]);
  });

  test("leads with exception cards and keeps the seven-axis ledger under disclosure", () => {
    const html = viewMarkup();
    expect(html).toContain('data-capability-id="inventory-exception-workspace"');
    expect(html.indexOf("Inventory exceptions")).toBeLessThan(html.indexOf("Seven-axis inventory ledger"));
    expect(html).toContain('<summary>Seven-axis inventory ledger</summary>');
    expect(html).toContain('data-inventory-axis="physical"');
    expect(html).toContain('data-inventory-axis="committed"');
    expect(html).toContain('data-inventory-axis="available"');
    expect(html).toContain('data-inventory-axis="cost"');
  });

  test("keeps the pre-Task-4 ledger expanded when the exception gate is off", () => {
    const html = renderToStaticMarkup(
      <InventoryWorkspaceView
        access={ADMIN_ACCESS}
        read={{ state: "current", model: projectionModel(), error: "" }}
        attempts={attempts()}
        exceptionWorkspaceEnabled={false}
        onRetry={() => {}}
        onSubmit={() => {}}
        onReconcile={() => {}}
        onReset={() => {}}
      />
    );
    expect(html).not.toContain("Seven-axis inventory ledger");
    expect(html).toContain('aria-labelledby="inventory-list-title"');
    expect(html).toContain("Physical on hand");
  });

  test("keeps physical stock and purchase-cost evidence as separate axes", () => {
    const html = viewMarkup();
    expect(html).toContain("40 lb");
    expect(html).toContain("25 lb");
    expect(html).toContain("15 lb");
    expect(html).toContain("Cost not recorded");
    expect(html).toContain('data-inventory-axis="stock"');
    expect(html).toContain('data-inventory-axis="cost"');
    expect(html).toContain("A valid stock record does not wait for cost");
    expect(html).not.toContain("Inventory ready");
    expect(html).not.toContain("recipe");
    expect(html).not.toContain("equipment");
    expect(html).not.toContain("reservation");
  });

  test("shows cached and pending snapshots as unconfirmed and disables mutations", () => {
    for (const freshness of ["cached", "pending"]) {
      const model = projectionModel({
        freshness,
        sources: {
          workspace: { state: freshness, fromCache: freshness === "cached", hasPendingWrites: freshness === "pending" },
          ingredients: { state: "current", fromCache: false, hasPendingWrites: false }
        }
      });
      const html = viewMarkup({ model, readState: freshness });
      expect(html).toContain('data-capability-state="stale"');
      expect(html).toContain(`data-inventory-freshness="${freshness}"`);
      expect(html).toContain("not confirmed current");
      expect(html).not.toContain("Server-confirmed projections.");
    }
  });

  test("uses an authorized empty workspace as a recoverable location setup step", () => {
    const model = projectionModel({ workspace: null, ingredients: [] });
    const html = viewMarkup({ model });
    expect(html).toContain("No ingredients recorded");
    expect(html).toContain("Create a stock location");
    expect(html).not.toContain("Add ingredient</button>");
  });

  test("denies the entire route surface when App-owned authority props are closed", () => {
    const html = viewMarkup({ access: { readEnabled: false, mutationEnabled: false, reason: "Inventory is not enabled for this organization." }, readState: "unavailable" });
    expect(html).toContain('data-capability-state="recovery"');
    expect(html).toContain("Authority gates are closed");
    expect(html).not.toContain('aria-label="Add ingredient"');
    expect(html.match(/<main/g)).toHaveLength(1);
  });

  test("renders stock and cost mutation attempts independently", () => {
    const html = viewMarkup({
      attemptOverrides: {
        stock: attempt("uncertain", { requestId: `inventory_request_${"b".repeat(32)}`, error: "Stock outcome unknown." }),
        cost: attempt("committed", { receipt: { recordedAtISO: "2026-09-09T05:00:00.000Z" } })
      }
    });
    expect(html).toContain('data-inventory-axis="stock"');
    expect(html).toContain("Stock outcome unknown.");
    expect(html).toContain('data-inventory-axis="cost"');
    expect(html).toContain("Cost evidence is confirmed in the current projection");
  });

  test("keeps receiving at receipt until the current stock projection confirms it", () => {
    const receipt = viewMarkup({
      attemptOverrides: {
        receiving: attempt("receipt", { receipt: { receiptId: `iar_${"7".repeat(48)}` } })
      }
    });
    expect(receipt).toContain('data-inventory-axis="receiving" data-capability-state="receipt"');
    expect(receipt).toContain("Waiting for the server-confirmed receiving projection");

    const confirmed = viewMarkup({
      attemptOverrides: {
        receiving: attempt("committed", { receipt: { recordedAtISO: "2026-09-09T05:00:00.000Z" } })
      }
    });
    expect(confirmed).toContain("Receiving evidence is confirmed in the current projection");
  });

  test("shows declared purchase packs with their exact conversion provenance", () => {
    const ingredient = {
      ...projectionModel().ingredients[0],
      packConversions: [{
        packUnitId: "case-40lb",
        packLabel: "40 lb case",
        baseUnitId: "lb",
        baseQuantity: "40",
        sourceLabel: "Supplier specification",
        revision: 2,
        packConversionRevisionId: `ipc_${"a".repeat(48)}`
      }]
    };
    const html = viewMarkup({ model: projectionModel({ ingredients: [ingredient] }) });
    expect(html).toContain("40 lb case");
    expect(html).toContain("1 case-40lb = 40 lb");
    expect(html).toContain("Supplier specification · revision 2");
  });

  test("renders purchase-pack receipt, confirmation, uncertainty, and recovery states", () => {
    const receipt = viewMarkup({
      attemptOverrides: {
        conversion: attempt("receipt", {
          targetId: "chicken",
          receipt: { receiptId: `iar_${"b".repeat(48)}` }
        })
      }
    });
    expect(receipt).toContain("Receipt recorded. Waiting for the server-confirmed purchase-pack projection");

    const confirmed = viewMarkup({
      attemptOverrides: {
        conversion: attempt("committed", {
          targetId: "chicken",
          receipt: { recordedAtISO: "2026-09-09T05:00:00.000Z" }
        })
      }
    });
    expect(confirmed).toContain("Purchase pack is confirmed in the current projection");

    const uncertain = viewMarkup({
      attemptOverrides: {
        conversion: attempt("uncertain", {
          targetId: "chicken",
          requestId: `inventory_request_${"c".repeat(32)}`,
          error: "Purchase-pack outcome is not verified."
        })
      }
    });
    expect(uncertain).toContain('data-capability-state="uncertain"');
    expect(uncertain).toContain("Purchase-pack outcome is not verified.");
    expect(uncertain).toContain("Check exact request");
  });

  test("exposes canonical read-state locators without promoting cached or pending evidence", () => {
    expect(viewMarkup({ readState: "loading" }))
      .toContain('data-capability-state="loading"');
    expect(viewMarkup({ model: projectionModel({ ingredients: [] }) }))
      .toContain('data-capability-state="empty"');
    expect(viewMarkup())
      .toContain('data-capability-state="success"');
    expect(viewMarkup({ readState: "stale" }))
      .toContain('data-capability-state="stale"');
    expect(viewMarkup({ model: projectionModel({ bounded: true }) }))
      .toContain('data-capability-state="partial"');
    expect(viewMarkup({ model: null, readState: "unavailable" }))
      .toContain('data-capability-state="error"');
    expect(viewMarkup({ access: { readEnabled: false, mutationEnabled: false, reason: "Closed." } }))
      .toContain('data-capability-state="recovery"');
  });

  test("exposes canonical mutation and recovery locators on each independent axis", () => {
    expect(viewMarkup({ attemptOverrides: { stock: attempt("ready") } }))
      .toContain('data-capability-state="ready"');
    expect(viewMarkup({ attemptOverrides: { stock: attempt("submitting") } }))
      .toContain('data-capability-state="submitting"');
    expect(viewMarkup({ attemptOverrides: { stock: attempt("uncertain", { requestId: `inventory_request_${"e".repeat(32)}`, error: "Review required." }) } }))
      .toContain('data-capability-state="uncertain"');
    expect(viewMarkup({ attemptOverrides: { stock: attempt("reconciliation") } }))
      .toContain('data-capability-state="reconciliation"');
    expect(viewMarkup({ attemptOverrides: { stock: attempt("receipt") } }))
      .toContain('data-capability-state="receipt"');
    expect(viewMarkup({ attemptOverrides: { stock: attempt("committed") } }))
      .toContain('data-inventory-axis="stock" data-capability-state="committed"');
    const rejected = viewMarkup({ attemptOverrides: { stock: attempt("error", { requestId: `inventory_request_${"f".repeat(32)}`, error: "Review required." }) } });
    expect(rejected).toContain('data-capability-state="error"');
    expect(rejected).toContain('class="ghost" type="button" data-capability-state="recovery"');
  });
});

describe("Task 4 inventory action surfaces", () => {
  test("keeps all three Task 4 capability gates default off", () => {
    expect(DEFAULT_FEATURE_FLAGS).toMatchObject({
      inventoryExceptionWorkspace: false,
      eventSupplyActionPlan: false,
      inventoryMobileCapture: false
    });
  });

  test("loads an accepted event and requires an explicit internal-plan approval command", async () => {
    const getPlan = vi.fn().mockResolvedValue({
      resolution: "not_started",
      stale: false,
      plan: {
        status: "draft",
        planRevision: 1,
        edits: [{
          ingredientId: "chicken",
          locationId: "main-kitchen",
          baseUnitId: "lb",
          shortageQuantity: "5",
          supplierId: "supplier-1",
          supplierLabel: "Reviewed supplier",
          purchaseQuantity: "5",
          estimatedCostMinor: null,
          note: "",
          conditions: [],
          policyFingerprint: "d".repeat(64),
          offerFingerprint: "e".repeat(64)
        }]
      },
      source: {
        eligible: true,
        allocationFingerprint: "a".repeat(64),
        shortageFingerprint: "b".repeat(64),
        sourceFingerprint: "c".repeat(64),
        shortages: [{ ingredientId: "chicken", locationId: "main-kitchen", baseUnitId: "lb", shortageQuantity: "5" }]
      }
    });
    const applyPlan = vi.fn().mockResolvedValue({ status: "approved", resolution: "unresolved", planRevision: 2, receipt: { receiptId: "receipt" } });
    await act(async () => {
      root.render(
        <EventSupplyActionPlanPanel
          enabled
          organizationId={ORGANIZATION_ID}
          role="admin"
          events={[{ id: "quote-1", quoteNumber: "QP-101", status: "accepted", event: { name: "Dinner" } }]}
          getPlan={getPlan}
          applyPlan={applyPlan}
        />
      );
    });
    const eventSelect = container.querySelector('select[aria-label="Event supply plan"]');
    await act(async () => setInput(eventSelect, "quote-1"));
    expect(getPlan).toHaveBeenCalledWith(expect.objectContaining({ quoteId: "quote-1" }));
    expect(container.textContent).toContain("Chicken");
    expect(container.textContent).toContain("Internal plan only");
    const approve = container.querySelector('button[data-supply-command="approve"]');
    expect(approve.disabled).toBe(true);
    await act(async () => container.querySelector(".inventory-approval-check input").click());
    expect(approve.disabled).toBe(false);
    await act(async () => approve.click());
    expect(applyPlan).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORGANIZATION_ID,
      quoteId: "quote-1",
      role: "admin",
      command: expect.objectContaining({
        kind: "approve",
        confirmation: "approve_internal_supply_plan",
        expectedPlanRevision: 1
      })
    }));
  });

  test("rebases a stale plan against refreshed shortage fingerprints and current shortage rows", async () => {
    const getPlan = vi.fn().mockResolvedValue({
      resolution: "stale",
      stale: true,
      plan: {
        status: "draft",
        planRevision: 3,
        edits: [{
          ingredientId: "old-ingredient", locationId: "main-kitchen", baseUnitId: "lb", shortageQuantity: "2",
          supplierId: "old-supplier", supplierLabel: "Old supplier", purchaseQuantity: "2", estimatedCostMinor: null,
          note: "", conditions: [], policyFingerprint: "d".repeat(64), offerFingerprint: "e".repeat(64)
        }]
      },
      source: {
        eligible: true,
        allocationFingerprint: "1".repeat(64),
        shortageFingerprint: "2".repeat(64),
        sourceFingerprint: "3".repeat(64),
        shortages: [{ ingredientId: "current-chicken", locationId: "main-kitchen", baseUnitId: "lb", shortageQuantity: "5" }]
      }
    });
    const applyPlan = vi.fn().mockResolvedValue({ receipt: { receiptId: "receipt" } });
    await act(async () => root.render(
      <EventSupplyActionPlanPanel
        enabled organizationId={ORGANIZATION_ID} role="admin"
        events={[{ id: "quote-stale", status: "accepted" }]}
        getPlan={getPlan} applyPlan={applyPlan}
      />
    ));
    await act(async () => setInput(container.querySelector('select[aria-label="Event supply plan"]'), "quote-stale"));
    expect(container.textContent).toContain("Current chicken");
    expect(container.textContent).not.toContain("Old ingredient");
    const fields = container.querySelectorAll(".inventory-supply-edit input");
    await act(async () => {
      setInput(fields[0], "supplier-current");
      setInput(fields[1], "Current supplier");
      const evidence = container.querySelector(".inventory-supply-edit details");
      evidence.open = true;
      setInput(container.querySelector('input[maxlength="64"]'), "a".repeat(64));
      setInput(container.querySelectorAll('input[maxlength="64"]')[1], "b".repeat(64));
    });
    const rebase = container.querySelector('button[data-supply-command="rebase"]');
    expect(rebase).not.toBeNull();
    await act(async () => rebase.click());
    expect(applyPlan).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.objectContaining({
        kind: "rebase",
        expectedPlanRevision: 3,
        expectedSourceFingerprint: "3".repeat(64),
        edits: [expect.objectContaining({ ingredientId: "current-chicken", shortageQuantity: "5" })]
      })
    }));
  });

  test("invalidates approval confirmation when saved plan values change", async () => {
    const getPlan = vi.fn().mockResolvedValue({
      resolution: "unresolved",
      stale: false,
      plan: {
        status: "draft", planRevision: 1,
        edits: [{
          ingredientId: "chicken", locationId: "main-kitchen", baseUnitId: "lb", shortageQuantity: "5",
          supplierId: "supplier-1", supplierLabel: "Saved supplier", purchaseQuantity: "5", estimatedCostMinor: null,
          note: "", conditions: [], policyFingerprint: "d".repeat(64), offerFingerprint: "e".repeat(64)
        }]
      },
      source: {
        eligible: true, allocationFingerprint: "a".repeat(64), shortageFingerprint: "b".repeat(64), sourceFingerprint: "c".repeat(64),
        shortages: [{ ingredientId: "chicken", locationId: "main-kitchen", baseUnitId: "lb", shortageQuantity: "5" }]
      }
    });
    await act(async () => root.render(
      <EventSupplyActionPlanPanel enabled organizationId={ORGANIZATION_ID} role="admin"
        events={[{ id: "quote-dirty", status: "accepted" }]} getPlan={getPlan} applyPlan={vi.fn()} />
    ));
    await act(async () => setInput(container.querySelector('select[aria-label="Event supply plan"]'), "quote-dirty"));
    const approval = container.querySelector(".inventory-approval-check input");
    const approve = container.querySelector('button[data-supply-command="approve"]');
    await act(async () => approval.click());
    expect(approve.disabled).toBe(false);
    await act(async () => setInput(container.querySelector(".inventory-supply-edit input"), "supplier-2"));
    expect(approval.checked).toBe(false);
    expect(approval.disabled).toBe(true);
    expect(approve.disabled).toBe(true);
    expect(container.textContent).toContain("Save this reviewed change before approval");
  });

  test("generation-fences supply reads and resets state when organization changes", async () => {
    const first = deferred();
    const getPlan = vi.fn().mockImplementation(({ organizationId }) => (
      organizationId === "org-old" ? first.promise : Promise.resolve({ resolution: "not_started", stale: false, plan: null, source: { eligible: true, shortages: [], allocationFingerprint: "a".repeat(64), shortageFingerprint: "b".repeat(64), sourceFingerprint: "c".repeat(64) } })
    ));
    const events = [{ id: "quote-1", status: "accepted" }];
    await act(async () => root.render(<EventSupplyActionPlanPanel enabled organizationId="org-old" role="admin" events={events} getPlan={getPlan} applyPlan={vi.fn()} />));
    await act(async () => setInput(container.querySelector('select[aria-label="Event supply plan"]'), "quote-1"));
    await act(async () => root.render(<EventSupplyActionPlanPanel enabled organizationId="org-new" role="admin" events={events} getPlan={getPlan} applyPlan={vi.fn()} />));
    first.resolve({ resolution: "stale", stale: true, plan: null, source: { eligible: true, shortages: [{ ingredientId: "wrong-org", locationId: "main-kitchen", baseUnitId: "lb", shortageQuantity: "1" }], allocationFingerprint: "1".repeat(64), shortageFingerprint: "2".repeat(64), sourceFingerprint: "3".repeat(64) } });
    await act(async () => first.promise);
    expect(container.querySelector('select[aria-label="Event supply plan"]').value).toBe("");
    expect(container.textContent).not.toContain("Wrong org");
  });

  test("keeps manual shelf search available when BarcodeDetector is absent", async () => {
    const previous = globalThis.BarcodeDetector;
    delete globalThis.BarcodeDetector;
    await act(async () => {
      root.render(
        <InventoryMobileCapturePanel
          enabled
          organizationId={ORGANIZATION_ID}
          userId="admin-user"
          locations={[{ locationId: "main-kitchen", name: "Main kitchen" }]}
          ingredients={projectionModel().ingredients}
          submitCommand={vi.fn()}
          draftService={{
            create: vi.fn(), update: vi.fn(), list: vi.fn().mockResolvedValue([]), discard: vi.fn(), submit: vi.fn()
          }}
        />
      );
    });
    expect(container.querySelector('input[type="search"][aria-label="Search shelf ingredients"]')).not.toBeNull();
    expect(container.textContent).toContain("Manual search is always available");
    expect(container.textContent).not.toContain("Scan barcode");
    globalThis.BarcodeDetector = previous;
  });

  test("filters shelf search to the exact selected location and fences late scope reads", async () => {
    const oldScope = deferred();
    const draftService = {
      create: vi.fn(), update: vi.fn(), discard: vi.fn(), submit: vi.fn(),
      list: vi.fn(({ userId }) => userId === "old-user" ? oldScope.promise : Promise.resolve([]))
    };
    const locations = [{ locationId: "main-kitchen", name: "Main kitchen" }, { locationId: "pantry", name: "Pantry" }];
    await act(async () => root.render(
      <InventoryMobileCapturePanel enabled organizationId={ORGANIZATION_ID} userId="old-user" locations={locations}
        ingredients={projectionModel().ingredients} draftService={draftService} />
    ));
    await act(async () => root.render(
      <InventoryMobileCapturePanel enabled organizationId={ORGANIZATION_ID} userId="new-user" locations={locations}
        ingredients={projectionModel().ingredients} draftService={draftService} />
    ));
    oldScope.resolve([{ draftId: "wrong-scope", lines: [{ ingredientName: "Wrong scope" }] }]);
    await act(async () => oldScope.promise);
    expect(container.textContent).not.toContain("Wrong scope");
    await act(async () => setInput(container.querySelector(".inventory-mobile-capture select"), "pantry"));
    expect(container.textContent).not.toContain("Current revision 1");
  });

  test("persists simultaneous same-scope saves for independent ingredients from one panel", async () => {
    const firstCreate = deferred();
    const secondCreate = deferred();
    const created = {
      draftId: "active-shelf-count",
      draftRevision: 1,
      status: "draft",
      lines: []
    };
    let stored = created;
    const draftService = {
      create: vi.fn()
        .mockImplementationOnce(() => firstCreate.promise)
        .mockImplementationOnce(() => secondCreate.promise),
      list: vi.fn()
        .mockResolvedValueOnce([])
        .mockImplementation(() => Promise.resolve([stored])),
      update: vi.fn(async ({ line }) => {
        stored = {
          ...stored,
          draftRevision: stored.draftRevision + 1,
          lines: [...stored.lines.filter((entry) => entry.ingredientId !== line.ingredientId), line]
        };
        return structuredClone(stored);
      }),
      discard: vi.fn(),
      submit: vi.fn()
    };
    const chicken = projectionModel().ingredients[0];
    const rice = {
      ...chicken,
      ingredientId: "rice",
      name: "Rice",
      nameSortKey: "rice",
      stock: { ...chicken.stock, revision: 2, onHandMicros: 18_000_000, quantity: "18" }
    };
    await act(async () => root.render(
      <InventoryMobileCapturePanel enabled organizationId={ORGANIZATION_ID} userId="admin-user"
        locations={[{ locationId: "main-kitchen", name: "Main kitchen" }]}
        ingredients={[chicken, rice]} draftService={draftService} />
    ));
    const countInputs = [...container.querySelectorAll('.inventory-capture-row input[inputmode="decimal"]')];
    const saveButtons = [...container.querySelectorAll(".inventory-capture-row button")];
    await act(async () => {
      setInput(countInputs[0], "24");
      setInput(countInputs[1], "16");
      saveButtons[0].click();
      saveButtons[1].click();
    });
    await vi.waitFor(() => expect(draftService.create).toHaveBeenCalledTimes(2));
    await act(async () => {
      firstCreate.resolve(created);
      secondCreate.reject(Object.assign(new Error("exists"), { code: "already-exists" }));
      await Promise.allSettled([firstCreate.promise, secondCreate.promise]);
    });
    await vi.waitFor(() => expect(draftService.update).toHaveBeenCalledTimes(2));
    expect(container.querySelector('[data-capture-line-state="draft"]').parentElement.textContent).toContain("Chicken");
    expect(container.querySelector('[data-capture-line-state="draft"]').parentElement.textContent).toContain("Rice");
  });

  test("fences ordinary shelf edits while the same ingredient request is unresolved", async () => {
    const line = {
      lineId: "count-chicken",
      lineRevision: 2,
      ingredientId: "chicken",
      ingredientName: "Chicken",
      baseUnitId: "lb",
      countedQuantity: "24",
      note: "Shelf walk",
      occurredAtISO: "2026-09-17T14:00:00.000Z",
      expectedStockRevision: 1,
      requestId: `inventory_request_${"6".repeat(32)}`,
      command: {
        kind: "record_stock_count",
        ingredientId: "chicken",
        locationId: "main-kitchen",
        baseUnitId: "lb",
        countedQuantity: "24",
        occurredAtISO: "2026-09-17T14:00:00.000Z",
        note: "Shelf walk",
        expectedStockRevision: 1
      },
      state: "uncertain",
      inFlight: false,
      error: "The exact outcome is not verified."
    };
    const draftService = {
      create: vi.fn(), update: vi.fn(), discard: vi.fn(), submit: vi.fn(),
      list: vi.fn().mockResolvedValue([{ draftId: "shelf-1", draftRevision: 3, status: "partial", lines: [line] }])
    };
    await act(async () => root.render(
      <InventoryMobileCapturePanel enabled organizationId={ORGANIZATION_ID} userId="admin-user"
        locations={[{ locationId: "main-kitchen", name: "Main kitchen" }]}
        ingredients={projectionModel().ingredients} draftService={draftService} />
    ));
    const row = container.querySelector(".inventory-capture-row");
    expect(row.querySelector('input[inputmode="decimal"]').disabled).toBe(true);
    expect(row.querySelector("button").disabled).toBe(true);
    expect(row.textContent).toContain("Resolve the saved request before replacing this count");
    expect(container.textContent).toContain("Check exact request");
  });

  test("decodes barcode files through an ImageBitmap and closes it", async () => {
    const previousDetector = globalThis.BarcodeDetector;
    const previousBitmap = globalThis.createImageBitmap;
    const bitmap = { close: vi.fn() };
    const detect = vi.fn().mockResolvedValue([{ rawValue: "chicken" }]);
    globalThis.createImageBitmap = vi.fn().mockResolvedValue(bitmap);
    globalThis.BarcodeDetector = class { detect(value) { return detect(value); } };
    await act(async () => root.render(
      <InventoryMobileCapturePanel enabled organizationId={ORGANIZATION_ID} userId="admin-user"
        locations={[{ locationId: "main-kitchen", name: "Main kitchen" }]} ingredients={projectionModel().ingredients}
        draftService={{ create: vi.fn(), update: vi.fn(), list: vi.fn().mockResolvedValue([]), discard: vi.fn(), submit: vi.fn() }} />
    ));
    const fileInput = container.querySelector('input[aria-label="Barcode image"]');
    const file = new File(["barcode"], "barcode.png", { type: "image/png" });
    Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });
    await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })));
    expect(globalThis.createImageBitmap).toHaveBeenCalledWith(file);
    expect(detect).toHaveBeenCalledWith(bitmap);
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    globalThis.BarcodeDetector = previousDetector;
    globalThis.createImageBitmap = previousBitmap;
  });

  test("submits each clean mobile count through the existing gated stock-count command", async () => {
    const draft = {
      draftId: "shelf-1",
      draftRevision: 1,
      status: "draft",
      lines: [{
        lineId: "count-chicken",
        ingredientId: "chicken",
        ingredientName: "Chicken",
        baseUnitId: "lb",
        countedQuantity: "37.5",
        note: "Shelf walk",
        occurredAtISO: "2026-09-17T14:00:00.000Z",
        expectedStockRevision: 1,
        requestId: `inventory_request_${"1".repeat(32)}`,
        command: {
          kind: "record_stock_count",
          ingredientId: "chicken",
          locationId: "main-kitchen",
          baseUnitId: "lb",
          countedQuantity: "37.5",
          occurredAtISO: "2026-09-17T14:00:00.000Z",
          note: "Shelf walk",
          expectedStockRevision: 1
        },
        state: "draft"
      }]
    };
    const submitCommand = vi.fn().mockResolvedValue({ receipt: { receiptId: "inventory-receipt" } });
    const draftService = {
      create: vi.fn(),
      update: vi.fn(),
      list: vi.fn().mockResolvedValue([draft]),
      discard: vi.fn(),
      submit: vi.fn(async ({ submitLine }) => {
        await submitLine({
          requestId: `inventory_request_${"1".repeat(32)}`,
          command: {
            kind: "record_stock_count",
            ingredientId: "chicken",
            locationId: "main-kitchen",
            baseUnitId: "lb",
            countedQuantity: "37.5",
            occurredAtISO: "2026-09-17T14:00:00.000Z",
            note: "Shelf walk",
            expectedStockRevision: 1
          }
        });
        return { ...draft, status: "submitted", lines: [{ ...draft.lines[0], state: "submitted", receiptId: "inventory-receipt" }] };
      })
    };
    await act(async () => {
      root.render(
        <InventoryMobileCapturePanel
          enabled
          organizationId={ORGANIZATION_ID}
          userId="admin-user"
          role="admin"
          browserEnabled
          tenantEnabled
          locations={[{ locationId: "main-kitchen", name: "Main kitchen" }]}
          ingredients={projectionModel().ingredients}
          submitCommand={submitCommand}
          draftService={draftService}
        />
      );
    });
    const submitButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "Submit clean counts");
    await act(async () => submitButton.click());
    expect(submitCommand).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORGANIZATION_ID,
      role: "admin",
      browserEnabled: true,
      tenantEnabled: true,
      command: expect.objectContaining({ kind: "record_stock_count", expectedStockRevision: 1 })
    }));
  });

  test("resets a definitive stock-count attempt before rebasing the retained line", async () => {
    const requestId = `inventory_request_${"7".repeat(32)}`;
    const line = {
      lineId: "count-chicken",
      lineRevision: 2,
      ingredientId: "chicken",
      ingredientName: "Chicken",
      baseUnitId: "lb",
      countedQuantity: "24",
      note: "Shelf walk",
      occurredAtISO: "2026-09-17T14:00:00.000Z",
      expectedStockRevision: 0,
      requestId,
      command: {
        kind: "record_stock_count",
        ingredientId: "chicken",
        locationId: "main-kitchen",
        baseUnitId: "lb",
        countedQuantity: "24",
        occurredAtISO: "2026-09-17T14:00:00.000Z",
        note: "Shelf walk",
        expectedStockRevision: 0
      },
      state: "error",
      definitive: true,
      error: "The command was rejected."
    };
    const draft = { draftId: "shelf-1", draftRevision: 2, status: "partial", lines: [line] };
    const resetCommand = vi.fn().mockReturnValue(true);
    const draftService = {
      create: vi.fn(),
      list: vi.fn().mockResolvedValue([draft]),
      discard: vi.fn(),
      submit: vi.fn(),
      update: vi.fn(async ({ line: replacement }) => ({ ...draft, draftRevision: 3, status: "draft", lines: [replacement] }))
    };
    await act(async () => root.render(
      <InventoryMobileCapturePanel enabled organizationId={ORGANIZATION_ID} userId="admin-user" role="admin"
        browserEnabled tenantEnabled locations={[{ locationId: "main-kitchen", name: "Main kitchen" }]}
        ingredients={projectionModel().ingredients} resetCommand={resetCommand} draftService={draftService} />
    ));
    await act(async () => [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Review against current revision").click());
    expect(resetCommand).toHaveBeenCalledWith(expect.objectContaining({ organizationId: ORGANIZATION_ID, requestId }));
    expect(draftService.update).toHaveBeenCalledWith(expect.objectContaining({
      expectedDraftRevision: 2,
      expectedLineRevision: 2,
      resolution: "reset",
      line: expect.objectContaining({
        requestId: expect.not.stringMatching(requestId),
        state: "draft",
        definitive: false,
        expectedStockRevision: 1,
        command: expect.objectContaining({ locationId: "main-kitchen", baseUnitId: "lb", expectedStockRevision: 1 })
      })
    }));
  });
});

describe("InventoryWorkspace operator commands", () => {
  test("emits the exact flat ingredient command", async () => {
    const onSubmit = vi.fn();
    await act(async () => {
      root.render(
        <InventoryWorkspaceView
          access={ADMIN_ACCESS}
          read={{ state: "current", model: projectionModel(), error: "" }}
          attempts={attempts()}
          onRetry={() => {}}
          onSubmit={onSubmit}
          onReconcile={() => {}}
          onReset={() => {}}
        />
      );
    });
    const form = container.querySelector('form[aria-label="Add ingredient"]');
    const [id, name, category] = form.querySelectorAll("input");
    await act(async () => {
      setInput(id, "pasta");
      setInput(name, "Pasta");
      setInput(category, "Dry goods");
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(onSubmit).toHaveBeenCalledWith("ingredient", {
      kind: "upsert_ingredient",
      ingredientId: "pasta",
      name: "Pasta",
      category: "Dry goods",
      baseUnitId: "lb",
      active: true,
      expectedRevision: 0
    });
  });

  test("does not let a cost submission lock the independent stock form", async () => {
    await act(async () => {
      root.render(
        <InventoryWorkspaceView
          access={ADMIN_ACCESS}
          read={{ state: "current", model: projectionModel(), error: "" }}
          attempts={attempts({ cost: attempt("submitting") })}
          onRetry={() => {}}
          onSubmit={() => {}}
          onReconcile={() => {}}
          onReset={() => {}}
        />
      );
    });
    const stockForm = container.querySelector('form[aria-label="Record opening stock"]');
    const costForm = container.querySelector('form[aria-label="Record purchase cost"]');
    expect([...costForm.elements].every((entry) => !["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(entry.tagName) || entry.disabled)).toBe(true);
    expect(stockForm.querySelector("select").disabled).toBe(false);
    expect(stockForm.querySelector('input[inputmode="decimal"]').disabled).toBe(false);
  });

  test("emits exact receiving evidence without changing allocation authority", async () => {
    const onSubmit = vi.fn();
    await act(async () => {
      root.render(
        <InventoryWorkspaceView
          access={ADMIN_ACCESS}
          read={{ state: "current", model: projectionModel(), error: "" }}
          attempts={attempts()}
          onRetry={() => {}}
          onSubmit={onSubmit}
          onReconcile={() => {}}
          onReset={() => {}}
        />
      );
    });
    const form = container.querySelector('form[aria-label="Receive ingredient stock"]');
    const quantity = form.querySelector('input[inputmode="decimal"]');
    const occurredAt = form.querySelector('input[type="datetime-local"]');
    const source = [...form.querySelectorAll("input")].find((entry) => entry.placeholder === "Vendor receipt 1842");
    const [totalCost, currency] = [...form.querySelectorAll('input[inputmode="decimal"], input[maxlength="3"]')]
      .filter((entry) => entry !== quantity);
    await act(async () => {
      setInput(quantity, "10");
      setInput(occurredAt, "2026-09-09T05:00");
      setInput(source, "Vendor receipt 1842");
      setInput(totalCost, "30.00");
      setInput(currency, "USD");
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(onSubmit).toHaveBeenCalledWith("receiving", {
      kind: "receive_stock",
      ingredientId: "chicken",
      locationId: "main-kitchen",
      quantity: "10",
      baseUnitId: "lb",
      occurredAtISO: new Date("2026-09-09T05:00").toISOString(),
      sourceLabel: "Vendor receipt 1842",
      note: "",
      expectedStockRevision: 1,
      expectedCostRevision: 0,
      cost: { availability: "available", totalCostMinor: 3000, currency: "USD" }
    });
    expect(form.textContent).toContain("does not create or release an event allocation");
    expect(form.querySelector('input[readonly]').value).toBe("Main kitchen");
  });

  test("publishes an exact purchase-pack conversion with projection-derived revision", async () => {
    const onSubmit = vi.fn();
    const ingredient = {
      ...projectionModel().ingredients[0],
      packConversions: [{
        packUnitId: "case-40lb",
        packLabel: "Old case label",
        baseUnitId: "lb",
        baseQuantity: "38",
        sourceLabel: "Prior supplier sheet",
        revision: 2,
        packConversionRevisionId: `ipc_${"a".repeat(48)}`
      }]
    };
    await act(async () => {
      root.render(
        <InventoryWorkspaceView
          access={ADMIN_ACCESS}
          read={{ state: "current", model: projectionModel({ ingredients: [ingredient] }), error: "" }}
          attempts={attempts()}
          onRetry={() => {}}
          onSubmit={onSubmit}
          onReconcile={() => {}}
          onReset={() => {}}
        />
      );
    });
    await openPackEditor();
    expect(container.querySelector('button[aria-controls="inventory-pack-editor-0"]').getAttribute("aria-expanded")).toBe("true");
    const form = container.querySelector('form[data-inventory-command="publish_pack_conversion"]');
    const [reference, label, quantity, source] = form.querySelectorAll("input");
    await act(async () => {
      setInput(reference, "case-40lb");
      setInput(label, "40 lb case");
      setInput(quantity, "40.000001");
      setInput(source, "Current supplier specification");
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(onSubmit).toHaveBeenCalledWith("conversion", {
      kind: "publish_pack_conversion",
      ingredientId: "chicken",
      packUnitId: "case-40lb",
      packLabel: "40 lb case",
      baseUnitId: "lb",
      baseQuantity: "40.000001",
      sourceLabel: "Current supplier specification",
      expectedRevision: 2
    });
    expect(form.textContent).toContain("Publishing creates revision 3");
  });

  test("rejects ambiguous or non-canonical purchase-pack quantities before mutation", async () => {
    const onSubmit = vi.fn();
    await act(async () => {
      root.render(
        <InventoryWorkspaceView
          access={ADMIN_ACCESS}
          read={{ state: "current", model: projectionModel(), error: "" }}
          attempts={attempts()}
          onRetry={() => {}}
          onSubmit={onSubmit}
          onReconcile={() => {}}
          onReset={() => {}}
        />
      );
    });
    await openPackEditor();
    const form = container.querySelector('form[data-inventory-command="publish_pack_conversion"]');
    const [reference, label, quantity, source] = form.querySelectorAll("input");
    await act(async () => {
      setInput(reference, "case-40lb");
      setInput(label, "40 lb case");
      setInput(source, "Supplier specification");
      setInput(quantity, "1e3");
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(container.textContent).toContain("no more than six decimal places");

    await act(async () => {
      setInput(quantity, "0.000000");
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]').textContent).toContain("positive quantity");
  });

  test("keeps stock and cost controls available while a pack declaration is pending", async () => {
    await act(async () => {
      root.render(
        <InventoryWorkspaceView
          access={ADMIN_ACCESS}
          read={{ state: "current", model: projectionModel(), error: "" }}
          attempts={attempts({ conversion: attempt("submitting", { targetId: "chicken" }) })}
          onRetry={() => {}}
          onSubmit={() => {}}
          onReconcile={() => {}}
          onReset={() => {}}
        />
      );
    });
    expect(container.querySelector('form[aria-label="Record opening stock"] input[inputmode="decimal"]').disabled).toBe(false);
    expect(container.querySelector('form[aria-label="Record purchase cost"] select').disabled).toBe(false);
    expect(container.querySelector('form[data-inventory-command="publish_pack_conversion"] input').disabled).toBe(true);
  });

  test("routes uncertain purchase-pack recovery to the exact conversion attempt", async () => {
    const onReconcile = vi.fn();
    await act(async () => {
      root.render(
        <InventoryWorkspaceView
          access={ADMIN_ACCESS}
          read={{ state: "current", model: projectionModel(), error: "" }}
          attempts={attempts({
            conversion: attempt("uncertain", {
              targetId: "chicken",
              requestId: `inventory_request_${"d".repeat(32)}`,
              error: "Outcome unknown."
            })
          })}
          onRetry={() => {}}
          onSubmit={() => {}}
          onReconcile={onReconcile}
          onReset={() => {}}
        />
      );
    });
    await act(async () => {
      [...container.querySelectorAll('[data-inventory-axis="conversion"] button')]
        .find((button) => button.textContent === "Check exact request")
        .click();
    });
    expect(onReconcile).toHaveBeenCalledWith("conversion");
  });
});

describe("InventoryWorkspace subscription lifecycle", () => {
  test("holds a pack command pending until its exact projection confirms the receipt", async () => {
    let subscription;
    let resolveCommand;
    const submitCommand = vi.fn(() => new Promise((resolve) => { resolveCommand = resolve; }));
    const subscribeProjections = vi.fn((input) => {
      subscription = input;
      return vi.fn();
    });
    await act(async () => {
      root.render(
        <InventoryWorkspace
          organizationId={ORGANIZATION_ID}
          role="admin"
          browserEnabled
          tenantEnabled
          subscribeProjections={subscribeProjections}
          submitCommand={submitCommand}
          pendingCommands={() => []}
        />
      );
    });
    await act(async () => subscription.onData(projectionModel()));
    await openPackEditor();

    const form = container.querySelector('form[data-inventory-command="publish_pack_conversion"]');
    const [reference, label, quantity, source] = form.querySelectorAll("input");
    await act(async () => {
      setInput(reference, "case-40lb");
      setInput(label, "40 lb case");
      setInput(quantity, "40");
      setInput(source, "Supplier specification");
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(container.textContent).toContain("Publishing purchase pack…");

    const receipt = {
      schemaVersion: 2,
      organizationId: ORGANIZATION_ID,
      receiptId: `iar_${"e".repeat(48)}`,
      requestId: submitCommand.mock.calls[0][0].requestId,
      commandKind: "publish_pack_conversion",
      recordedAtISO: "2026-09-09T06:00:00.000Z"
    };
    const confirmation = {
      ingredientId: "chicken",
      packUnitId: "case-40lb",
      packConversionRevisionId: `ipc_${"a".repeat(48)}`,
      revision: 1
    };
    await act(async () => resolveCommand({ receipt, confirmation }));
    expect(container.textContent).toContain("Waiting for the server-confirmed purchase-pack projection");

    const ingredient = {
      ...projectionModel().ingredients[0],
      packConversions: [{
        packUnitId: "case-40lb",
        packLabel: "40 lb case",
        baseUnitId: "lb",
        baseQuantity: "40",
        sourceLabel: "Supplier specification",
        revision: 1,
        packConversionRevisionId: confirmation.packConversionRevisionId
      }]
    };
    await act(async () => subscription.onData(projectionModel({ ingredients: [ingredient] })));
    expect(container.textContent).toContain("Purchase pack is confirmed in the current projection");
  });

  test("restores and reconciles the exact unresolved pack request", async () => {
    let subscription;
    let resolveReconcile;
    const reconcileCommand = vi.fn(() => new Promise((resolve) => { resolveReconcile = resolve; }));
    const requestId = `inventory_request_${"1".repeat(32)}`;
    const subscribeProjections = vi.fn((input) => {
      subscription = input;
      return vi.fn();
    });
    await act(async () => {
      root.render(
        <InventoryWorkspace
          organizationId={ORGANIZATION_ID}
          role="admin"
          browserEnabled
          tenantEnabled
          subscribeProjections={subscribeProjections}
          reconcileCommand={reconcileCommand}
          pendingCommands={() => [{
            requestId,
            commandKind: "publish_pack_conversion",
            targetId: "chicken",
            definitive: false,
            state: "uncertain",
            error: "The original outcome is not verified."
          }]}
        />
      );
    });
    await act(async () => subscription.onData(projectionModel()));
    expect(container.textContent).toContain("The original outcome is not verified.");

    const recovery = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Check exact request");
    await act(async () => recovery.click());
    expect(reconcileCommand).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORGANIZATION_ID,
      requestId
    }));
    expect(container.textContent).toContain("Checking the exact original purchase pack request");

    await act(async () => resolveReconcile({
      receipt: {
        organizationId: ORGANIZATION_ID,
        commandKind: "publish_pack_conversion",
        recordedAtISO: "2026-09-09T06:00:00.000Z"
      },
      confirmation: {
        ingredientId: "chicken",
        packConversionRevisionId: `ipc_${"b".repeat(48)}`,
        revision: 1
      }
    }));
    expect(container.textContent).toContain("Waiting for the server-confirmed purchase-pack projection");
  });

  test("invalidates late callbacks when the active organization changes", async () => {
    const subscriptions = [];
    const subscribeProjections = vi.fn((input) => {
      subscriptions.push(input);
      return vi.fn();
    });
    const common = {
      role: "admin",
      browserEnabled: true,
      tenantEnabled: true,
      subscribeProjections,
      pendingCommands: () => [],
      submitCommand: vi.fn(),
      reconcileCommand: vi.fn(),
      resetCommand: vi.fn()
    };
    await act(async () => {
      root.render(<InventoryWorkspace organizationId="org-a" {...common} />);
    });
    await act(async () => {
      root.render(<InventoryWorkspace organizationId="org-b" {...common} />);
    });
    expect(subscriptions).toHaveLength(2);

    await act(async () => {
      subscriptions[0].onData({ ...projectionModel(), organizationId: "org-a", ingredients: [{ ...projectionModel().ingredients[0], name: "Late chicken" }] });
    });
    expect(container.textContent).not.toContain("Late chicken");

    await act(async () => {
      subscriptions[1].onData({ ...projectionModel(), organizationId: "org-b", ingredients: [{ ...projectionModel().ingredients[0], ingredientId: "pasta", name: "Pasta" }] });
    });
    expect(container.textContent).toContain("Pasta");
  });

  test("ignores a late receiving response after the organization changes", async () => {
    const subscriptions = [];
    let resolveReceive;
    const submitCommand = vi.fn(() => new Promise((resolve) => { resolveReceive = resolve; }));
    const subscribeProjections = vi.fn((input) => {
      subscriptions.push(input);
      return vi.fn();
    });
    const common = {
      role: "admin",
      browserEnabled: true,
      tenantEnabled: true,
      subscribeProjections,
      submitCommand,
      pendingCommands: () => []
    };
    await act(async () => root.render(<InventoryWorkspace organizationId="org-a" {...common} />));
    await act(async () => subscriptions[0].onData({ ...projectionModel(), organizationId: "org-a" }));
    const form = container.querySelector('form[aria-label="Receive ingredient stock"]');
    const quantity = form.querySelector('input[inputmode="decimal"]');
    const occurredAt = form.querySelector('input[type="datetime-local"]');
    const source = [...form.querySelectorAll("input")].find((entry) => entry.placeholder === "Vendor receipt 1842");
    const totalCost = [...form.querySelectorAll('input[inputmode="decimal"]')].find((entry) => entry !== quantity);
    await act(async () => {
      setInput(quantity, "10");
      setInput(occurredAt, "2026-09-09T05:00");
      setInput(source, "Vendor receipt 1842");
      setInput(totalCost, "30.00");
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(container.textContent).toContain("Recording receiving evidence");

    await act(async () => root.render(<InventoryWorkspace organizationId="org-b" {...common} />));
    await act(async () => resolveReceive({
      receipt: { receiptId: `iar_${"8".repeat(48)}` },
      confirmation: { ingredientId: "chicken", stockRevision: 2 }
    }));
    expect(container.textContent).not.toContain("Waiting for the server-confirmed receiving projection");
  });

  test("never attaches a listener for sales or closed feature gates", async () => {
    const subscribeProjections = vi.fn();
    await act(async () => {
      root.render(
        <InventoryWorkspace
          organizationId={ORGANIZATION_ID}
          role="sales"
          browserEnabled
          tenantEnabled
          subscribeProjections={subscribeProjections}
          pendingCommands={() => []}
        />
      );
    });
    expect(subscribeProjections).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Authority gates are closed");
  });
});
