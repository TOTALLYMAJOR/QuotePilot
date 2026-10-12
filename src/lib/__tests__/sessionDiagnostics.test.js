import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

function createStorageMock() {
  const store = {};
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setItem(key, value) {
      store[key] = String(value);
    },
    removeItem(key) {
      delete store[key];
    },
    clear() {
      Object.keys(store).forEach((key) => delete store[key]);
    },
    snapshot() {
      return { ...store };
    }
  };
}

function stubBrowserGlobals() {
  const localStorage = createStorageMock();
  const addEventListener = vi.fn();
  vi.stubGlobal("window", {
    localStorage,
    location: {
      href: "http://localhost:4173/app?portal=portal-token-123&email=buyer@example.com#customer",
      origin: "http://localhost:4173",
      pathname: "/app"
    },
    innerWidth: 1440,
    innerHeight: 900,
    addEventListener
  });
  vi.stubGlobal("document", {
    referrer: "http://localhost/referrer?token=secret-token&email=staff@example.com"
  });
  vi.stubGlobal("navigator", {
    userAgent: "vitest-agent",
    language: "en-US"
  });
  return { localStorage, addEventListener };
}

describe("sessionDiagnostics", () => {
  beforeEach(() => {
    vi.resetModules();
    stubBrowserGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("initializes session diagnostics and records session start", async () => {
    const diagnostics = await import("../sessionDiagnostics");

    diagnostics.initSessionDiagnostics({ appVersion: "0.1.0-test" });
    const snapshot = diagnostics.readSessionDiagnostics();

    expect(snapshot.session.appVersion).toBe("0.1.0-test");
    expect(snapshot.session.sessionId).not.toBe("");
    expect(snapshot.session.pageUrl).toBe("http://localhost:4173/app");
    expect(snapshot.session.referrer).toBe("http://localhost/referrer");
    expect(snapshot.summary.total).toBeGreaterThanOrEqual(1);
    expect(snapshot.events[0].type).toBe("session.start");
  });

  test("records errors with redacted context and user session details", async () => {
    const { localStorage } = stubBrowserGlobals();
    const diagnostics = await import("../sessionDiagnostics");

    diagnostics.initSessionDiagnostics({ appVersion: "0.1.0-test" });
    diagnostics.setDiagnosticsUserContext({
      uid: "abc-123",
      email: "staff@example.com",
      role: "admin",
      authenticated: true
    });
    diagnostics.recordDiagnosticError(new Error("Quote save failed for staff@example.com using sk-test-secret"), {
      surface: "app",
      action: "submit-quote",
      customerEmail: "buyer@example.com",
      phone: "312-555-0199",
      callbackUrl: "https://quotepilot.test/portal?token=secret-token#receipt"
    });

    const snapshot = diagnostics.readSessionDiagnostics();
    const secondRead = diagnostics.readSessionDiagnostics();
    const top = snapshot.events[0];
    expect(snapshot.session.user.uid).toMatch(/^hash:/);
    expect(snapshot.session.user.uid).not.toContain("abc-123");
    expect(secondRead.session.user.uid).toBe(snapshot.session.user.uid);
    expect(secondRead.session.user.emailHash).toBe(snapshot.session.user.emailHash);
    expect(secondRead.events[0].error.stack).toBe(top.error.stack);
    expect(snapshot.session.user.email).toBe("[redacted]");
    expect(snapshot.session.user.emailHash).toMatch(/^hash:/);
    expect(top.level).toBe("error");
    expect(top.message).toContain("Quote save failed");
    expect(top.message).not.toContain("staff@example.com");
    expect(top.message).not.toContain("sk-test-secret");
    expect(top.context.surface).toBe("app");
    expect(top.context.customerEmail).toBe("[redacted]");
    expect(top.context.phone).toBe("[redacted]");
    expect(top.context.callbackUrl).toBe("https://quotepilot.test/portal");
    expect(top.error.stack).toMatch(/^hash:/);
    expect(snapshot.summary.errors).toBeGreaterThanOrEqual(1);

    const persisted = JSON.stringify(localStorage.snapshot());
    expect(persisted).not.toContain("staff@example.com");
    expect(persisted).not.toContain("buyer@example.com");
    expect(persisted).not.toContain("312-555-0199");
    expect(persisted).not.toContain("sk-test-secret");
    expect(persisted).not.toContain("portal-token-123");
  });

  test("clears captured events while keeping session metadata", async () => {
    const diagnostics = await import("../sessionDiagnostics");

    diagnostics.initSessionDiagnostics({ appVersion: "0.1.0-test" });
    diagnostics.recordDiagnosticEvent({
      level: "warning",
      type: "catalog.load",
      message: "Catalog fallback used"
    });

    let snapshot = diagnostics.readSessionDiagnostics();
    expect(snapshot.summary.total).toBeGreaterThan(0);

    diagnostics.clearSessionDiagnostics();
    snapshot = diagnostics.readSessionDiagnostics();
    expect(snapshot.summary.total).toBe(0);
    expect(snapshot.session.sessionId).not.toBe("");
  });

  test("redacts nested keys and array entries before persisting diagnostic context", async () => {
    const diagnostics = await import("../sessionDiagnostics");
    diagnostics.recordDiagnosticEvent({ type: "nested", context: {
      detail: { password: "NESTED_PRIVATE", rows: [{ token: "ARRAY_PRIVATE", count: 2 }], ok: true }
    } });
    const context = diagnostics.readSessionDiagnostics().events[0].context;
    expect(JSON.parse(context.detail)).toEqual({ password: "[redacted]", rows: [{ token: "[redacted]", count: 2 }], ok: true });
    expect(JSON.stringify(window.localStorage.snapshot())).not.toMatch(/NESTED_PRIVATE|ARRAY_PRIVATE/);
  });

  test("caps sparse array indexes before serialization", async () => {
    const diagnostics = await import("../sessionDiagnostics");
    const sparse = [];
    sparse[10000] = "outside-bound";
    diagnostics.recordDiagnosticEvent({ type: "sparse", context: { sparse } });
    expect(diagnostics.readSessionDiagnostics().events[0].context.sparse).toBe("[]");
  });

  test("bounds recursive diagnostics without invoking custom serialization or leaking failed values", async () => {
    const diagnostics = await import("../sessionDiagnostics");
    const circular = { status: "ready", password: "CIRCULAR_PRIVATE" };
    circular.self = circular;
    const hostile = { toJSON() { throw new Error("SERIALIZER_PRIVATE"); }, toString() { return "STRING_PRIVATE"; } };
    Object.defineProperty(hostile, "value", { enumerable: true, get() { throw new Error("GETTER_PRIVATE"); } });
    let deep = { password: "DEEP_PRIVATE" };
    for (let i = 0; i < 100; i += 1) deep = { child: deep };
    expect(() => diagnostics.recordDiagnosticEvent({ type: "bounded", context: { circular, hostile, deep, invalidDate: new Date(NaN), number: 3, flag: false } })).not.toThrow();
    const snapshot = diagnostics.readSessionDiagnostics();
    expect(snapshot.events[0].context).toMatchObject({ number: 3, flag: false });
    expect(snapshot.events[0].context.circular).toContain("ready");
    expect(JSON.stringify(window.localStorage.snapshot())).not.toMatch(/CIRCULAR_PRIVATE|SERIALIZER_PRIVATE|STRING_PRIVATE|GETTER_PRIVATE|DEEP_PRIVATE/);
  });
});
