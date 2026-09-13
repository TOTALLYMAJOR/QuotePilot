// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exportKitchenBeo: vi.fn(),
  getEventTypes: vi.fn(),
  getQuoteHistory: vi.fn(),
  downloadKitchenBeoArtifact: vi.fn(),
  generateKitchenBeo: vi.fn(),
  getKitchenBeoArtifactStatus: vi.fn(),
  isDefinitiveKitchenBeoError: vi.fn(),
  readPendingKitchenBeoAttempt: vi.fn(),
  resetDefinitiveKitchenBeoAttempt: vi.fn()
}));

vi.mock("../../lib/quoteStore", async () => ({
  ...(await vi.importActual("../../lib/quoteStore")),
  getQuoteHistory: mocks.getQuoteHistory
}));

vi.mock("../../lib/menuService", async () => ({
  ...(await vi.importActual("../../lib/menuService")),
  getEventTypes: mocks.getEventTypes
}));

vi.mock("../../lib/kitchenBeoClient", () => ({
  downloadKitchenBeoArtifact: mocks.downloadKitchenBeoArtifact,
  generateKitchenBeo: mocks.generateKitchenBeo,
  getKitchenBeoArtifactStatus: mocks.getKitchenBeoArtifactStatus,
  isDefinitiveKitchenBeoError: mocks.isDefinitiveKitchenBeoError,
  readPendingKitchenBeoAttempt: mocks.readPendingKitchenBeoAttempt,
  resetDefinitiveKitchenBeoAttempt: mocks.resetDefinitiveKitchenBeoAttempt
}));

vi.mock("../../lib/beoExport", () => ({
  exportKitchenBeo: mocks.exportKitchenBeo
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
    date: "2026-10-12",
    time: "12:00",
    guests: 125
  }),
  selection: Object.freeze({ eventTypeId: "corporate" }),
  totals: Object.freeze({ total: 12480, deposit: 3120 }),
  payment: Object.freeze({ depositStatus: "unpaid" }),
  booking: Object.freeze({ confirmationStatus: "pending" }),
  createdAtISO: "2026-08-09T15:00:00.000Z",
  updatedAtISO: "2026-08-09T15:00:00.000Z",
  expiresAtISO: "2026-10-08T15:00:00.000Z"
});

const STATUS = Object.freeze({
  schemaVersion: "kitchen-beo-artifact-status-v1",
  authority: "server_derived",
  state: "CURRENT",
  observedAtISO: "2026-08-09T17:00:00.000Z",
  reasonCodes: Object.freeze(["trusted_receipt_matches_canonical_source"]),
  currentDependencyFingerprint: "a".repeat(64),
  receiptId: `beo_${"b".repeat(48)}`,
  receiptDependencyFingerprint: "a".repeat(64),
  commercialSourceRevisionId: "v0001",
  unresolvedInvalidationIds: Object.freeze([]),
  receiptHistory: Object.freeze({
    schemaVersion: 1,
    authority: "server_projection",
    state: "COMPLETE",
    bounds: Object.freeze({ limit: 10, returnedCount: 1, truncated: false }),
    reasonCodes: Object.freeze(["receipt_history_complete"]),
    receipts: Object.freeze([Object.freeze({
      receiptId: `beo_${"b".repeat(48)}`,
      requestId: `beo_request_${"c".repeat(32)}`,
      commercialSourceRevisionId: "v0001",
      dependencyFingerprint: "a".repeat(64),
      generatedAtISO: "2026-08-09T17:00:00.000Z",
      filename: "Q-0042-kitchen-beo.pdf",
      artifactByteLength: 12,
      generatedBy: Object.freeze({ email: "sales@example.test", role: "sales" }),
      current: true
    })])
  })
});

let container;
let root;

async function settle() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 5));
    await Promise.resolve();
  });
}

function mount(props = {}) {
  act(() => {
    root.render(
      <QuoteHistoryView
        open
        presentation="embedded"
        organizationId="org-one"
        currentUserUid="sales-one"
        currentUserRole="sales"
        focusQuoteId="quote-42"
        onClose={() => {}}
        {...props}
      />
    );
  });
}

beforeEach(() => {
  mocks.exportKitchenBeo.mockReset().mockResolvedValue(undefined);
  mocks.getEventTypes.mockReset().mockResolvedValue([]);
  mocks.getQuoteHistory.mockReset();
  mocks.downloadKitchenBeoArtifact.mockReset();
  mocks.generateKitchenBeo.mockReset();
  mocks.getKitchenBeoArtifactStatus.mockReset().mockResolvedValue(STATUS);
  mocks.isDefinitiveKitchenBeoError.mockReset().mockReturnValue(false);
  mocks.readPendingKitchenBeoAttempt.mockReset().mockReturnValue(null);
  mocks.resetDefinitiveKitchenBeoAttempt.mockReset().mockReturnValue(false);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Quote History Kitchen BEO integration", () => {
  test("opens server freshness/generation for a canonical Firebase quote and never calls browser export", async () => {
    mocks.getQuoteHistory.mockResolvedValue({ source: "firebase", quotes: [QUOTE] });
    mount();
    await settle();

    const openButton = container.querySelector('[data-capability-action="open-kitchen-beo"]');
    expect(openButton).not.toBeNull();
    expect(openButton.getAttribute("data-beo-authority")).toBe("server_authoritative");
    expect(openButton.textContent).toBe("Kitchen BEO status");
    expect(container.querySelector('[data-capability-action="export-local-kitchen-beo"]')).toBeNull();

    act(() => openButton.click());
    expect(container.querySelector('[role="dialog"][aria-labelledby*="kitchen-beo-panel-title"]')).not.toBeNull();
    await settle();
    expect(mocks.getKitchenBeoArtifactStatus).toHaveBeenCalledWith({
      organizationId: "org-one",
      quoteId: "quote-42"
    });
    expect(container.querySelector('[data-beo-freshness-state="CURRENT"]')).not.toBeNull();
    expect(mocks.exportKitchenBeo).not.toHaveBeenCalled();
  });

  test("keeps local fallback visibly non-authoritative before and after browser export", async () => {
    mocks.getQuoteHistory.mockResolvedValue({ source: "local", quotes: [QUOTE] });
    mount();
    await settle();

    expect(container.querySelector('[data-beo-local-boundary="no-server-receipt"]')?.textContent)
      .toContain("no server generation receipt");
    const localButton = container.querySelector('[data-capability-action="export-local-kitchen-beo"]');
    expect(localButton).not.toBeNull();
    expect(localButton.getAttribute("data-beo-authority")).toBe("local_non_authoritative");
    expect(localButton.textContent).toBe("Local BEO — no receipt");
    expect(container.querySelector('[data-capability-action="open-kitchen-beo"]')).toBeNull();

    await act(async () => {
      localButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.exportKitchenBeo).toHaveBeenCalledWith(QUOTE, { output: "save" });
    expect(container.textContent).toContain("It has no server generation receipt or freshness status");
    expect(container.querySelector('[role="dialog"][aria-labelledby*="kitchen-beo-panel-title"]')).toBeNull();
    expect(mocks.getKitchenBeoArtifactStatus).not.toHaveBeenCalled();
  });

  test("Escape closes the nested Kitchen BEO dialog without closing modal Quote History", async () => {
    const onClose = vi.fn();
    mocks.getQuoteHistory.mockResolvedValue({ source: "firebase", quotes: [QUOTE] });
    mount({ onClose });
    await settle();
    act(() => container.querySelector('[data-capability-action="open-kitchen-beo"]').click());
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);

    act(() => document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true
    })));
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
  });
});
