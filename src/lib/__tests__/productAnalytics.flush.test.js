import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const provider = vi.hoisted(() => ({
  call: vi.fn(),
  httpsCallable: vi.fn()
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: provider.httpsCallable
}));

vi.mock("../firebase", () => ({
  cloudFunctions: {},
  firebaseReady: true
}));

import {
  PRODUCT_ANALYTICS_STORAGE_KEYS,
  flushProductAnalyticsEvents
} from "../productAnalyticsCore";

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value))
  };
}

describe("product analytics concurrent flush recovery", () => {
  beforeEach(() => {
    const localStorage = storage();
    const sessionStorage = storage();
    vi.stubGlobal("window", { localStorage, sessionStorage });
    localStorage.setItem(PRODUCT_ANALYTICS_STORAGE_KEYS.QUEUE_KEY, JSON.stringify([{
      organizationId: "org-one",
      eventName: "wizard_started",
      sessionId: "session-one",
      sequence: 1,
      mode: "edit",
      occurredAtISO: "2026-10-11T00:00:00.000Z"
    }]));
    provider.httpsCallable.mockReturnValue(provider.call);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  test("contains one rejected provider attempt for every concurrent caller", async () => {
    let rejectProvider;
    provider.call.mockReturnValue(new Promise((_resolve, reject) => {
      rejectProvider = reject;
    }));

    const first = flushProductAnalyticsEvents();
    const second = flushProductAnalyticsEvents();
    rejectProvider(Object.assign(new Error("provider unavailable"), { code: "functions/internal" }));

    await expect(Promise.all([first, second])).resolves.toEqual([
      { sent: 0, queued: 1 },
      { sent: 0, queued: 1 }
    ]);
    expect(provider.call).toHaveBeenCalledTimes(1);
  });
});
