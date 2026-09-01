// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEventTypes: vi.fn(),
  getQuoteHistory: vi.fn(),
  routeProps: null
}));

vi.stubEnv("VITE_AMBIENT_UI_ENABLED", "true");

vi.mock("../../lib/quoteStore", async () => ({
  ...(await vi.importActual("../../lib/quoteStore")),
  getQuoteHistory: mocks.getQuoteHistory
}));

vi.mock("../../lib/menuService", async () => ({
  ...(await vi.importActual("../../lib/menuService")),
  getEventTypes: mocks.getEventTypes
}));

vi.mock("../AmbientLivingOpportunityRoute", async () => {
  const ReactModule = await import("react");
  return {
    default: ReactModule.forwardRef(function QuickUpdatesRouteProbe(props, ref) {
      mocks.routeProps = props;
      return <main ref={ref} data-testid="quick-updates-route-probe" />;
    })
  };
});

const { QuoteHistoryView } = await import("../QuoteHistoryModal");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BASE_QUOTE = Object.freeze({
  id: "quote-alpha",
  organizationId: "org-alpha",
  quoteNumber: "Q-ALPHA",
  activeVersionId: "version-alpha",
  status: "draft",
  customer: Object.freeze({ name: "Maya Bennett", email: "maya@example.test" }),
  event: Object.freeze({
    name: "Autumn Benefit Dinner",
    date: "2026-09-19",
    time: "18:00",
    venue: "The Foundry Hall",
    guests: 120,
    style: "Plated"
  }),
  selection: Object.freeze({ packageName: "Classic", menuItemNames: Object.freeze([]) }),
  totals: Object.freeze({ total: 8400 }),
  updatedAtISO: "2026-08-30T20:00:00.000Z"
});

const REQUEST = Object.freeze({
  modelId: "quick-updates-request-v1",
  source: "quick_updates",
  scope: "event.service_style",
  quoteId: "quote-alpha",
  organizationId: "org-alpha",
  baseRevisionId: "version-alpha",
  patch: Object.freeze({ event: Object.freeze({ style: "Buffet" }) }),
  delta: Object.freeze([Object.freeze({
    fieldPath: "event.style",
    before: "Plated",
    after: "Buffet",
    beforeLabel: "Plated dinner",
    afterLabel: "Buffet"
  })])
});

function authoritativeQuote(overrides = {}) {
  return {
    ...BASE_QUOTE,
    activeVersionId: "version-beta",
    event: { ...BASE_QUOTE.event, style: "Buffet" },
    ...overrides
  };
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 25));
    await Promise.resolve();
  });
}

describe("QuoteHistory Quick Updates authority host", () => {
  let container;
  let root;

  beforeEach(() => {
    mocks.routeProps = null;
    mocks.getEventTypes.mockReset().mockResolvedValue([]);
    mocks.getQuoteHistory.mockReset().mockResolvedValue({ source: "firebase", quotes: [BASE_QUOTE] });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render(overrides = {}) {
    const props = {
      open: true,
      presentation: "embedded",
      organizationId: "org-alpha",
      focusQuoteId: "quote-alpha",
      currentUserRole: "admin",
      serviceStyles: ["Buffet", "Plated", "Stations", "Drop-off"],
      onClose: vi.fn(),
      onBackToQuotes: vi.fn(),
      onEditQuote: vi.fn(),
      onPreviewQuickUpdate: vi.fn().mockResolvedValue({ status: "ready", delta: REQUEST.delta }),
      onSaveQuickUpdate: vi.fn().mockResolvedValue({
        status: "persisted",
        receipt: {
          quoteId: "quote-alpha",
          organizationId: "org-alpha",
          activeVersionId: "version-beta"
        }
      }),
      onOpenQuickUpdatesLibrary: vi.fn(),
      onQuickUpdatesGuardChange: vi.fn(),
      ...overrides
    };
    act(() => root.render(<QuoteHistoryView {...props} />));
    await settle();
    expect(mocks.routeProps).not.toBeNull();
    return props;
  }

  test("threads host options and callbacks, then verifies the authoritative list reread before saved", async () => {
    const props = await render();
    expect(mocks.routeProps.serviceStyles).toEqual(props.serviceStyles);
    expect(mocks.routeProps.onOpenQuickUpdatesLibrary).toBe(props.onOpenQuickUpdatesLibrary);
    expect(mocks.routeProps.onQuickUpdatesGuardChange).toBe(props.onQuickUpdatesGuardChange);

    const preview = await mocks.routeProps.onPreviewQuickUpdate(REQUEST);
    expect(preview).toEqual({ status: "ready", delta: REQUEST.delta });
    expect(props.onPreviewQuickUpdate).toHaveBeenCalledWith(REQUEST);

    const refreshed = authoritativeQuote();
    mocks.getQuoteHistory.mockResolvedValueOnce({ source: "firebase", quotes: [refreshed] });
    const onPersisted = vi.fn();
    let result;
    await act(async () => {
      result = await mocks.routeProps.onSaveQuickUpdate(
        { ...REQUEST, preview: preview },
        { onPersisted }
      );
    });

    expect(props.onSaveQuickUpdate).toHaveBeenCalledWith({ ...REQUEST, preview });
    expect(props.onSaveQuickUpdate.mock.calls[0]).toHaveLength(1);
    expect(onPersisted).toHaveBeenCalledWith(expect.objectContaining({ activeVersionId: "version-beta" }));
    expect(mocks.getQuoteHistory).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      status: "saved",
      quote: refreshed,
      receipt: expect.objectContaining({ activeVersionId: "version-beta" })
    });
  });

  test("keeps contextual Library unavailable to sales while preserving Quick Updates edit authority", async () => {
    const props = await render({ currentUserRole: "sales" });

    expect(mocks.routeProps.onOpenQuickUpdatesLibrary).toBeUndefined();
    await expect(mocks.routeProps.onPreviewQuickUpdate(REQUEST)).resolves.toEqual({
      status: "ready",
      delta: REQUEST.delta
    });
    expect(props.onPreviewQuickUpdate).toHaveBeenCalledWith(REQUEST);
  });

  test("rejects cross-tenant or stale-revision requests before preview or save", async () => {
    const props = await render();
    const crossTenant = { ...REQUEST, organizationId: "org-other" };
    const staleRevision = { ...REQUEST, baseRevisionId: "version-old" };

    await expect(mocks.routeProps.onPreviewQuickUpdate(crossTenant)).resolves.toEqual(expect.objectContaining({
      status: "conflict"
    }));
    await expect(mocks.routeProps.onSaveQuickUpdate(staleRevision)).resolves.toEqual(expect.objectContaining({
      status: "conflict"
    }));
    expect(props.onPreviewQuickUpdate).not.toHaveBeenCalled();
    expect(props.onSaveQuickUpdate).not.toHaveBeenCalled();
  });

  test("does not accept updatedAt as a substitute for an authoritative quote version", async () => {
    const legacyQuote = {
      ...BASE_QUOTE,
      activeVersionId: "",
      versionMeta: null,
      updatedAtISO: "2026-08-30T20:00:00.000Z"
    };
    mocks.getQuoteHistory.mockResolvedValue({ source: "firebase", quotes: [legacyQuote] });
    const props = await render();

    await expect(mocks.routeProps.onPreviewQuickUpdate({
      ...REQUEST,
      baseRevisionId: legacyQuote.updatedAtISO
    })).resolves.toEqual(expect.objectContaining({ status: "conflict" }));
    expect(props.onPreviewQuickUpdate).not.toHaveBeenCalled();
  });

  test.each([
    ["wrong style", authoritativeQuote({ event: { ...BASE_QUOTE.event, style: "Stations" } })],
    ["wrong revision", authoritativeQuote({ activeVersionId: "version-gamma" })],
    ["wrong tenant", authoritativeQuote({ organizationId: "org-other" })]
  ])("returns uncertain rather than saved after a %s reread", async (_label, rereadQuote) => {
    const props = await render();
    mocks.getQuoteHistory.mockResolvedValueOnce({ source: "firebase", quotes: [rereadQuote] });

    const result = await mocks.routeProps.onSaveQuickUpdate(REQUEST, { onPersisted: vi.fn() });
    expect(props.onSaveQuickUpdate).toHaveBeenCalledOnce();
    expect(result).toEqual(expect.objectContaining({
      status: "uncertain",
      message: expect.stringContaining("did not confirm")
    }));
  });

  test("does not reread or claim success without a definitive persisted receipt", async () => {
    const props = await render({
      onSaveQuickUpdate: vi.fn().mockResolvedValue({
        status: "uncertain",
        message: "Provider result is uncertain."
      })
    });
    const onPersisted = vi.fn();

    const result = await mocks.routeProps.onSaveQuickUpdate(REQUEST, { onPersisted });
    expect(result).toEqual({ status: "uncertain", message: "Provider result is uncertain." });
    expect(onPersisted).not.toHaveBeenCalled();
    expect(mocks.getQuoteHistory).toHaveBeenCalledTimes(1);
    expect(props.onSaveQuickUpdate).toHaveBeenCalledWith(REQUEST);
  });

  test("rejects an App-level saved phase so Quote History cannot skip its authoritative reload", async () => {
    const props = await render({
      onSaveQuickUpdate: vi.fn().mockResolvedValue({
        status: "saved",
        quote: authoritativeQuote(),
        receipt: { activeVersionId: "version-beta" }
      })
    });
    const onPersisted = vi.fn();

    const result = await mocks.routeProps.onSaveQuickUpdate(REQUEST, { onPersisted });

    expect(result).toEqual(expect.objectContaining({
      status: "uncertain",
      message: expect.stringContaining("required persisted phase")
    }));
    expect(onPersisted).not.toHaveBeenCalled();
    expect(mocks.getQuoteHistory).toHaveBeenCalledTimes(1);
    expect(props.onSaveQuickUpdate).toHaveBeenCalledWith(REQUEST);
  });
});
