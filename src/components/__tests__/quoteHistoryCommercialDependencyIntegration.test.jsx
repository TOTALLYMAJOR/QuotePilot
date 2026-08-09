// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEventTypes: vi.fn(),
  getQuoteHistory: vi.fn(),
  buildRequestId: vi.fn(),
  getDependencyState: vi.fn(),
  isDefinitive: vi.fn(),
  reconcile: vi.fn()
}));

vi.mock("../../lib/quoteStore", async () => ({
  ...(await vi.importActual("../../lib/quoteStore")),
  getQuoteHistory: mocks.getQuoteHistory
}));

vi.mock("../../lib/menuService", async () => ({
  ...(await vi.importActual("../../lib/menuService")),
  getEventTypes: mocks.getEventTypes
}));

vi.mock("../../lib/commercialChangeAuthorityClient", () => ({
  buildCommercialChangeRequestId: mocks.buildRequestId,
  getCommercialDependencyState: mocks.getDependencyState,
  isDefinitiveCommercialChangeError: mocks.isDefinitive,
  reconcileCommercialDependencyState: mocks.reconcile
}));

vi.mock("../QuoteDecisionDebtPanel", () => ({
  default: () => <section data-testid="decision-debt-placeholder" />
}));

import { QuoteHistoryView } from "../QuoteHistoryModal";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const QUOTE = Object.freeze({
  id: "quote-42",
  organizationId: "org-one",
  quoteNumber: "Q-0042",
  status: "draft",
  activeVersionId: "v0001",
  latestVersionNumber: 1,
  customer: Object.freeze({ name: "Henderson Foods", email: "ops@example.test" }),
  event: Object.freeze({
    name: "Company picnic",
    date: "2026-09-12",
    time: "12:00",
    guests: 125
  }),
  selection: Object.freeze({ eventTypeId: "corporate" }),
  totals: Object.freeze({ total: 12480, deposit: 3120 }),
  payment: Object.freeze({ depositStatus: "unpaid" }),
  booking: Object.freeze({ confirmationStatus: "pending" }),
  createdAtISO: "2026-08-09T15:00:00.000Z",
  updatedAtISO: "2026-08-09T15:00:00.000Z",
  expiresAtISO: "2026-09-08T15:00:00.000Z"
});

const EMPTY_DEPENDENCY_STATE = Object.freeze({
  schemaVersion: 1,
  authority: "server_projection",
  source: "firebase_server_projection",
  organizationId: "org-one",
  quoteId: "quote-42",
  customerId: "customer-one",
  eventDate: "2026-09-12",
  activeRevisionId: "v0001",
  observedAtISO: "2026-08-09T17:00:00.000Z",
  bounds: Object.freeze({
    invalidationLimit: 64,
    invalidationSetComplete: true,
    returnedCount: 0,
    truncated: false
  }),
  state: "NOT_GENERATED",
  safeToPublish: false,
  latestApplyReceiptId: "",
  totalInvalidationCount: 0,
  openInvalidationCount: 0,
  resolvedInvalidationCount: 0,
  invalidations: Object.freeze([]),
  reasonCodes: Object.freeze(["no_governed_change_applied"])
});

let container;
let root;

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 5));
  });
}

function mount(props = {}) {
  act(() => {
    root.render(
      <QuoteHistoryView
        open
        presentation="embedded"
        organizationId="org-one"
        currentUserRole="sales"
        focusQuoteId="quote-42"
        onClose={() => {}}
        {...props}
      />
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  mocks.getEventTypes.mockResolvedValue([]);
  mocks.getDependencyState.mockResolvedValue(EMPTY_DEPENDENCY_STATE);
  mocks.buildRequestId.mockReturnValue(`change_reconcile_${"a".repeat(32)}`);
  mocks.isDefinitive.mockReturnValue(false);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Quote History Commercial Dependency integration", () => {
  test("binds the focused Firebase quote to the same-tenant dependency surface", async () => {
    mocks.getQuoteHistory.mockResolvedValue({ source: "firebase", quotes: [QUOTE] });
    mount();
    await settle();

    const panel = container.querySelector(
      '[data-capability-id="cwf-15-commercial-dependency-state"]'
    );
    expect(panel).toBeTruthy();
    expect(panel.getAttribute("data-quote-id")).toBe("quote-42");
    expect(panel.querySelector('[data-capability-state="empty"]')).toBeFalsy();
    expect(panel.getAttribute("data-capability-state")).toBe("empty");
    expect(container.textContent).toContain("Dependency reconciliation · Q-0042");
    expect(mocks.getDependencyState).toHaveBeenCalledWith({
      organizationId: "org-one",
      quoteId: "quote-42"
    });
  });

  test("does not expose or read the staff authority surface for local or customer-role records", async () => {
    mocks.getQuoteHistory.mockResolvedValue({ source: "local", quotes: [QUOTE] });
    mount();
    await settle();

    expect(container.querySelector('[data-capability-id="cwf-15-commercial-dependency-state"]'))
      .toBeNull();
    expect(mocks.getDependencyState).not.toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.getQuoteHistory.mockResolvedValue({ source: "firebase", quotes: [QUOTE] });
    mount({ currentUserRole: "customer" });
    await settle();

    expect(container.querySelector('[data-capability-id="cwf-15-commercial-dependency-state"]'))
      .toBeNull();
    expect(mocks.getDependencyState).not.toHaveBeenCalled();
  });
});
