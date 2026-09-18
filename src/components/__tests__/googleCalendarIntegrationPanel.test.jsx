// @vitest-environment jsdom
import React, { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const api = vi.hoisted(() => ({
  getStatus: vi.fn(),
  start: vi.fn(),
  apply: vi.fn(),
  disconnect: vi.fn(),
  createRequestId: vi.fn(),
  definitive: vi.fn(),
  readPending: vi.fn(),
  reset: vi.fn(),
  clear: vi.fn()
}));

vi.mock("../../lib/googleCalendarClient", () => ({
  getGoogleCalendarStatus: api.getStatus,
  startGoogleCalendarConnection: api.start,
  applyGoogleCalendarEventCommand: api.apply,
  disconnectGoogleCalendar: api.disconnect,
  createGoogleCalendarRequestId: api.createRequestId,
  isDefinitiveGoogleCalendarError: api.definitive,
  readPendingGoogleCalendarMutation: api.readPending,
  resetDefinitiveGoogleCalendarMutation: api.reset,
  clearResolvedGoogleCalendarMutation: api.clear
}));

import GoogleCalendarIntegrationPanel, {
  resolveGoogleCalendarPanelState
} from "../GoogleCalendarIntegrationPanel";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const boundary = "One-way, operator-requested projection of one accepted or booked QuotePilot event into an explicitly connected Google Calendar. Provider acceptance is not customer acceptance, event readiness, staffing, inventory, BEO, checklist, payment, or delivery evidence.";

function calendarStatus({
  connection = {},
  sync = {},
  configuration = {},
  includeSync = true,
  externalCopies = [],
  externalCopiesTruncated = false
} = {}) {
  const canDisconnect = connection.canDisconnect ?? true;
  return {
    schemaVersion: "google-calendar-public-status-v1",
    configuration: { enabled: true, configured: true, cleanupAvailable: canDisconnect, ...configuration },
    connection: {
      state: "active",
      connectionRevision: 2,
      configurationGeneration: 3,
      calendarLabel: "Operations",
      reasonCode: "",
      canDisconnect,
      authorizationExpiresAtISO: "",
      ...connection
    },
    sync: includeSync ? {
      state: "not_synced",
      syncRevision: 0,
      connectionGeneration: 0,
      sourceVersionId: "",
      activeSourceVersionId: "version-a",
      reasonCode: "",
      recoveryAction: "",
      lastVerifiedAtISO: "",
      operationId: "",
      providerEventUrl: "",
      ...sync
    } : null,
    externalCopies,
    externalCopiesTruncated,
    evidenceBoundary: boundary
  };
}

const BASE_EVENT_PROPS = Object.freeze({
  mode: "event",
  organizationId: "org-a",
  quoteId: "quote-a",
  sourceVersionId: "version-a",
  role: "admin",
  source: "firebase",
  enabled: true,
  eventStatus: "booked"
});

let container;
let root;

beforeEach(() => {
  vi.clearAllMocks();
  api.createRequestId.mockReturnValue("google_calendar_request_00000000-0000-4000-8000-000000000001");
  api.definitive.mockReturnValue(false);
  api.readPending.mockReturnValue(null);
  api.reset.mockReturnValue(true);
  api.clear.mockReturnValue(true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function mount(props = {}, initial = calendarStatus()) {
  api.getStatus.mockResolvedValueOnce({ ok: true, status: initial });
  await act(async () => {
    root.render(<GoogleCalendarIntegrationPanel {...BASE_EVENT_PROPS} {...props} />);
  });
}

async function click(selector) {
  const element = container.querySelector(selector);
  expect(element).not.toBeNull();
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  return element;
}

function action(name) {
  return `[data-capability-action="${name}"]`;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("GoogleCalendarIntegrationPanel", () => {
  test("emits every canonical read and in-flight mutation marker", async () => {
    const loading = deferred();
    api.getStatus.mockReturnValueOnce(loading.promise);
    await act(async () => {
      root.render(<GoogleCalendarIntegrationPanel {...BASE_EVENT_PROPS} />);
    });
    expect(container.querySelector('[data-capability-channel="read"][data-capability-state="loading"]')).not.toBeNull();
    expect(container.innerHTML).toContain('data-capability-state="loading"');
    await act(async () => loading.resolve({ ok: true, status: calendarStatus() }));
    expect(container.querySelector('[data-capability-channel="read"][data-capability-state="success"]')).not.toBeNull();
    expect(container.querySelector('[data-capability-channel="mutation"][data-capability-state="ready"]')).not.toBeNull();
    expect(container.innerHTML).toContain('data-capability-state="success"');
    expect(container.innerHTML).toContain('data-capability-state="ready"');

    api.getStatus.mockResolvedValueOnce({ ok: true, status: calendarStatus({
      configuration: { enabled: false, configured: false, cleanupAvailable: false },
      connection: { state: "disabled", configurationGeneration: 0, canDisconnect: false }
    }) });
    await act(async () => {
      root.render(<GoogleCalendarIntegrationPanel {...BASE_EVENT_PROPS} organizationId="org-empty" />);
    });
    expect(container.querySelector('[data-capability-channel="read"][data-capability-state="empty"]')).not.toBeNull();
    expect(container.innerHTML).toContain('data-capability-state="empty"');

    api.getStatus.mockRejectedValueOnce(new Error("Status read failed."));
    await act(async () => {
      root.render(<GoogleCalendarIntegrationPanel {...BASE_EVENT_PROPS} organizationId="org-error" />);
    });
    expect(container.querySelector('[data-capability-channel="read"][data-capability-state="error"]')).not.toBeNull();
    expect(container.innerHTML).toContain('data-capability-state="error"');

    const recovering = deferred();
    api.getStatus.mockReturnValueOnce(recovering.promise);
    act(() => {
      container.querySelector(action("refresh-google-calendar-status"))
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector('[data-capability-channel="read"][data-capability-state="recovery"]')).not.toBeNull();
    expect(container.querySelector('[data-capability-channel="mutation"][data-capability-state="recovery"]')).not.toBeNull();
    expect(container.innerHTML).toContain('data-capability-state="recovery"');
    await act(async () => recovering.resolve({ ok: true, status: calendarStatus() }));

    api.getStatus.mockResolvedValueOnce({ ok: true, status: calendarStatus({
      includeSync: false,
      connection: { state: "unconfigured", connectionRevision: 0, configurationGeneration: 0, calendarLabel: "" }
    }) });
    await act(async () => {
      root.render(<GoogleCalendarIntegrationPanel
        {...BASE_EVENT_PROPS}
        organizationId="org-submit"
        mode="connection"
        quoteId=""
        sourceVersionId=""
        openAuthorization={() => ({})}
      />);
    });
    const submitting = deferred();
    api.start.mockReturnValueOnce(submitting.promise);
    act(() => {
      container.querySelector(action("connect-google-calendar"))
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector('[data-capability-channel="mutation"][data-capability-state="submitting"]')).not.toBeNull();
    expect(container.innerHTML).toContain('data-capability-state="submitting"');
    await act(async () => submitting.resolve({
      ok: true,
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=opaque",
      expiresAtISO: "2026-09-13T12:10:00.000Z",
      connectionRevision: 1
    }));

    api.getStatus.mockResolvedValueOnce({ ok: true, status: calendarStatus({
      sync: {
        state: "outcome_uncertain",
        operationId: `calendar_operation_${"a".repeat(48)}`
      }
    }) });
    await act(async () => {
      root.render(<GoogleCalendarIntegrationPanel {...BASE_EVENT_PROPS} organizationId="org-reconcile" />);
    });
    const reconciling = deferred();
    api.apply.mockReturnValueOnce(reconciling.promise);
    act(() => {
      container.querySelector(action("reconcile-google-calendar-event"))
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector('[data-capability-channel="mutation"][data-capability-state="reconciliation"]')).not.toBeNull();
    expect(container.innerHTML).toContain('data-capability-state="reconciliation"');
    await act(async () => reconciling.resolve({ ok: true, status: calendarStatus({
      sync: {
        state: "synced",
        syncRevision: 1,
        sourceVersionId: "version-a",
        lastVerifiedAtISO: "2026-09-13T12:00:00.000Z"
      }
    }) }));
  });

  test("maps the bounded event states without turning provider status into readiness", () => {
    const current = calendarStatus({
      sync: {
        state: "synced",
        sourceVersionId: "version-a",
        lastVerifiedAtISO: "2026-09-13T12:00:00.000Z"
      }
    });
    expect(resolveGoogleCalendarPanelState({
      mode: "event",
      status: current,
      sourceVersionId: "version-a"
    })).toBe("current");
    expect(resolveGoogleCalendarPanelState({
      mode: "event",
      status: calendarStatus({ sync: { state: "update_required" } }),
      sourceVersionId: "version-a"
    })).toBe("update_required");
    expect(resolveGoogleCalendarPanelState({
      mode: "event",
      status: calendarStatus({ sync: { state: "provider_drift" } }),
      sourceVersionId: "version-a"
    })).toBe("provider_drift");
    expect(resolveGoogleCalendarPanelState({
      mode: "event",
      status: calendarStatus({ connection: { state: "reconnect_required" } }),
      sourceVersionId: "version-a"
    })).toBe("reconnect_required");
    expect(resolveGoogleCalendarPanelState({
      mode: "event",
      status: calendarStatus({ sync: { state: "outcome_uncertain" } }),
      sourceVersionId: "version-a"
    })).toBe("uncertain");
  });

  test("keeps ineligible and disconnected states explicit without a local fallback", async () => {
    const markup = renderToStaticMarkup(<GoogleCalendarIntegrationPanel
      {...BASE_EVENT_PROPS}
      source="local"
    />);
    expect(markup).toContain('data-capability-state="recovery"');
    expect(markup).toContain("requires a connected workspace");

    const onOpenIntegrations = vi.fn();
    await mount({ onOpenIntegrations }, calendarStatus({
      connection: { state: "reconnect_required" }
    }));
    expect(container.textContent).toContain("must be reconnected");
    expect(container.querySelector(action("open-google-calendar-integrations"))).not.toBeNull();
    await click(action("open-google-calendar-integrations"));
    expect(onOpenIntegrations).toHaveBeenCalledTimes(1);
  });

  test("starts one deliberate Google authorization and states that connecting adds no event", async () => {
    const openAuthorization = vi.fn(() => ({}));
    const disconnected = calendarStatus({
      includeSync: false,
      connection: {
        state: "unconfigured",
        connectionRevision: 0,
        configurationGeneration: 0,
        calendarLabel: ""
      }
    });
    await mount({
      mode: "connection",
      quoteId: "",
      sourceVersionId: "",
      eventStatus: "",
      openAuthorization
    }, disconnected);
    api.start.mockResolvedValueOnce({
      ok: true,
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=opaque",
      expiresAtISO: "2026-09-13T12:10:00.000Z",
      connectionRevision: 1
    });

    await click(action("connect-google-calendar"));
    expect(api.start).toHaveBeenCalledWith({
      organizationId: "org-a",
      requestId: expect.stringMatching(/^google_calendar_request_/u),
      expectedConnectionRevision: 0
    });
    expect(openAuthorization).toHaveBeenCalledWith(
      "https://accounts.google.com/o/oauth2/v2/auth?state=opaque"
    );
    expect(container.textContent).toContain("No event was added");
    expect(container.querySelector('[data-capability-channel="mutation"][data-capability-state="receipt"]')).not.toBeNull();
    expect(container.querySelector(action("refresh-google-calendar-status")).textContent)
      .toContain("Check Google connection");
  });

  test("recovers an expired retained grant without opening a second authorization", async () => {
    const openAuthorization = vi.fn(() => ({}));
    await mount({
      mode: "connection",
      quoteId: "",
      sourceVersionId: "",
      eventStatus: "",
      openAuthorization
    }, calendarStatus({
      includeSync: false,
      connection: {
        state: "authorizing",
        connectionRevision: 4,
        configurationGeneration: 0,
        calendarLabel: "",
        reasonCode: "authorization_in_progress",
        canDisconnect: false,
        authorizationExpiresAtISO: "2000-01-01T00:00:00.000Z"
      }
    }));
    expect(container.textContent).toContain("authorization window expired");
    api.start.mockResolvedValueOnce({
      ok: true,
      recovered: true,
      status: calendarStatus({
        includeSync: false,
        connection: {
          state: "active",
          connectionRevision: 5,
          configurationGeneration: 1,
          reasonCode: "",
          authorizationExpiresAtISO: ""
        }
      })
    });

    await click(action("connect-google-calendar"));
    expect(api.start).toHaveBeenCalledWith(expect.objectContaining({
      expectedConnectionRevision: 4
    }));
    expect(openAuthorization).not.toHaveBeenCalled();
    expect(container.textContent).toContain("previously verified Google authorization is now connected");
  });

  test("publishes only the exact selected revision and renders a focused receipt", async () => {
    await mount();
    const synced = calendarStatus({
      sync: {
        state: "synced",
        syncRevision: 1,
        sourceVersionId: "version-a",
        lastVerifiedAtISO: "2026-09-13T12:00:00.000Z",
        providerEventUrl: "https://calendar.google.com/calendar/event?eid=YWJjZGVmZ2hp"
      }
    });
    api.apply.mockResolvedValueOnce({ ok: true, status: synced });

    await click(action("publish-google-calendar-event"));
    expect(api.apply).toHaveBeenCalledWith({
      organizationId: "org-a",
      quoteId: "quote-a",
      requestId: expect.stringMatching(/^google_calendar_request_/u),
      expectedSyncRevision: 0,
      expectedConnectionGeneration: 3,
      command: "sync",
      expectedSourceVersionId: "version-a"
    });
    expect(JSON.stringify(api.apply.mock.calls[0][0])).not.toMatch(
      /customer|staff|diet|price|payment|note|beo|checklist/iu
    );
    const receipt = container.querySelector('[data-capability-channel="mutation"][data-capability-state="receipt"] p');
    expect(receipt.textContent).toContain("accepted and verified this exact saved event revision");
    expect(container.innerHTML).toContain('data-capability-state="receipt"');
    expect(document.activeElement).toBe(receipt);
    expect(container.querySelector(action("open-google-calendar-copy"))).not.toBeNull();
    expect(container.textContent).toContain("does not establish event readiness");
  });

  test("labels removal as removing the Google copy and never canceling the QuotePilot event", async () => {
    const current = calendarStatus({
      sync: {
        state: "synced",
        syncRevision: 1,
        sourceVersionId: "version-a",
        lastVerifiedAtISO: "2026-09-13T12:00:00.000Z"
      }
    });
    await mount({}, current);
    api.apply.mockResolvedValueOnce({ ok: true, status: calendarStatus({
      sync: {
        state: "canceled",
        syncRevision: 2,
        sourceVersionId: "version-a"
      }
    }) });
    await click(action("remove-google-calendar-copy"));
    expect(api.apply).toHaveBeenCalledWith(expect.objectContaining({
      command: "cancel",
      expectedBoundSourceVersionId: "version-a"
    }));
    expect(container.textContent).toContain("QuotePilot event was not canceled");
    expect(container.textContent).not.toContain("Cancel event");
  });

  test("preserves an uncertain action and reconciles the exact operation instead of retrying", async () => {
    await mount();
    api.apply.mockRejectedValueOnce(Object.assign(new Error("The outcome is unknown."), {
      uncertain: true
    }));
    await click(action("publish-google-calendar-event"));
    expect(container.querySelector('[data-capability-channel="mutation"][data-capability-state="uncertain"]')).not.toBeNull();
    expect(container.innerHTML).toContain('data-capability-state="uncertain"');
    expect(container.textContent).toContain("The outcome is unknown");

    const unresolved = calendarStatus({
      sync: {
        state: "outcome_uncertain",
        operationId: `calendar_operation_${"a".repeat(48)}`,
        reasonCode: "provider_network_error",
        recoveryAction: "reconcile_exact_operation"
      }
    });
    const reconciled = calendarStatus({
      sync: {
        state: "synced",
        syncRevision: 1,
        sourceVersionId: "version-a",
        lastVerifiedAtISO: "2026-09-13T12:00:00.000Z"
      }
    });
    api.getStatus.mockResolvedValueOnce({ ok: true, status: unresolved });
    api.apply.mockResolvedValueOnce({ ok: true, status: reconciled });
    await click(action("reconcile-google-calendar-event"));
    expect(api.apply).toHaveBeenCalledTimes(2);
    expect(api.apply.mock.calls[1][0]).toMatchObject({
      command: "reconcile",
      expectedOperationId: `calendar_operation_${"a".repeat(48)}`
    });
    expect(api.clear).toHaveBeenCalledWith({ organizationId: "org-a", quoteId: "quote-a" });
    expect(container.textContent).toContain("original operation was checked");
  });

  test("uses partial state for a mismatched selected revision and keeps controls mobile-sized", async () => {
    await mount({}, calendarStatus({
      sync: {
        state: "synced",
        sourceVersionId: "version-b",
        activeSourceVersionId: "version-b",
        lastVerifiedAtISO: "2026-09-13T12:00:00.000Z"
      }
    }));
    expect(container.querySelector('[data-capability-channel="read"][data-capability-state="partial"]')).not.toBeNull();
    expect(container.innerHTML).toContain('data-capability-state="partial"');
    expect(container.textContent).toContain("does not match the selected saved event revision");
    expect(container.querySelector(action("publish-google-calendar-event"))).toBeNull();
    const refresh = container.querySelector(action("refresh-google-calendar-status"));
    expect(refresh.style.minHeight).toBe("44px");
    expect(refresh.style.flex).toContain("1 1 14rem");
  });

  test("retains the last verified status as stale when refresh fails", async () => {
    await mount({}, calendarStatus({
      sync: {
        state: "synced",
        syncRevision: 1,
        sourceVersionId: "version-a",
        lastVerifiedAtISO: "2026-09-13T12:00:00.000Z"
      }
    }));
    api.definitive.mockReturnValueOnce(true);
    api.apply.mockRejectedValueOnce(new Error("Google rejected the removal request."));
    await click(action("remove-google-calendar-copy"));
    api.getStatus.mockRejectedValueOnce(new Error("Calendar status refresh failed."));
    await click(action("refresh-google-calendar-status"));
    expect(container.querySelector(
      '[data-capability-channel="read"][data-capability-state="stale"]'
    )).not.toBeNull();
    expect(container.innerHTML).toContain('data-capability-state="stale"');
    expect(container.textContent).toContain("Calendar status refresh failed");
    expect(container.textContent).toContain("Up to date on Google Calendar");
  });

  test("discloses the narrow one-way payload and excludes operational or commercial data", async () => {
    await mount();
    const details = container.querySelector("details");
    expect(details.textContent).toContain("What Google Calendar receives");
    expect(details.textContent).toContain("no attendees");
    expect(details.textContent).toContain("customer or staff contact details");
    expect(details.textContent).toContain("menu, dietary information, pricing, payments, operational notes, BEO, or checklist");
    expect(details.textContent).toContain("do not update the quote");
  });

  test("keeps sales review-only and gives administrators deliberate cleanup for retained copies", async () => {
    await mount({ role: "sales" }, calendarStatus({
      sync: {
        state: "synced",
        syncRevision: 1,
        sourceVersionId: "version-a",
        lastVerifiedAtISO: "2026-09-13T12:00:00.000Z"
      }
    }));
    expect(container.textContent).toContain("An administrator must publish, update, reconcile, or remove");
    expect(container.querySelector(action("remove-google-calendar-copy"))).toBeNull();

    const retained = {
      quoteId: "quote-retained",
      label: "Catering event · Q-1042",
      state: "synced",
      syncRevision: 4,
      sourceVersionId: "version-retained",
      operationId: "",
      recoveryAction: "",
      providerEventUrl: "https://calendar.google.com/calendar/event?eid=cmV0YWluZWQ"
    };
    api.getStatus.mockResolvedValueOnce({ ok: true, status: calendarStatus({
      includeSync: false,
      externalCopies: [retained]
    }) });
    await act(async () => {
      root.render(<GoogleCalendarIntegrationPanel
        {...BASE_EVENT_PROPS}
        mode="connection"
        quoteId=""
        sourceVersionId=""
        eventStatus=""
        organizationId="org-retained"
      />);
    });
    expect(container.textContent).toContain("Existing Google event copies (1)");
    const remove = container.querySelector(action("remove-google-calendar-copy"));
    expect(remove).not.toBeNull();
    expect(remove.style.minHeight).toBe("44px");

    api.apply.mockResolvedValueOnce({ ok: true, status: calendarStatus({
      sync: {
        state: "canceled",
        syncRevision: 5,
        sourceVersionId: "version-retained"
      }
    }) });
    api.getStatus.mockResolvedValueOnce({ ok: true, status: calendarStatus({ includeSync: false }) });
    await click(action("remove-google-calendar-copy"));
    expect(api.apply).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-retained",
      quoteId: "quote-retained",
      command: "cancel",
      expectedSyncRevision: 4,
      expectedBoundSourceVersionId: "version-retained"
    }));
    expect(container.textContent).toContain("QuotePilot event was not canceled");
  });

  test("blocks disconnect for a truncated retained-copy read and makes provider drift actionable", async () => {
    const drift = {
      quoteId: "quote-drift",
      label: "Changed reception",
      state: "provider_drift",
      syncRevision: 6,
      sourceVersionId: "version-drift",
      operationId: `calendar_operation_${"b".repeat(48)}`,
      recoveryAction: "reconcile_exact_operation",
      providerEventUrl: "https://calendar.google.com/calendar/event?eid=ZHJpZnQtZXZlbnQ"
    };
    await mount({
      mode: "connection",
      quoteId: "",
      sourceVersionId: "",
      eventStatus: ""
    }, calendarStatus({
      includeSync: false,
      externalCopies: [drift],
      externalCopiesTruncated: true
    }));

    expect(container.querySelector(action("disconnect-google-calendar"))).toBeNull();
    expect(container.textContent).toContain("Existing Google event copies (1+)");
    expect(container.textContent).toContain("shows at most 50 copies in one read");
    expect(container.textContent).toContain("blocks disconnect until a complete read reports none");
    expect(container.querySelector(action("open-google-calendar-copy")).getAttribute("href"))
      .toBe(drift.providerEventUrl);
    const reconcile = container.querySelector(action("reconcile-google-calendar-event"));
    expect(reconcile.textContent).toContain("Recheck changed Google copy");

    api.apply.mockResolvedValueOnce({ ok: true, status: calendarStatus({
      sync: {
        state: "provider_drift",
        syncRevision: 7,
        sourceVersionId: "version-drift",
        activeSourceVersionId: "version-drift",
        operationId: `calendar_operation_${"c".repeat(48)}`,
        reasonCode: "provider_owned_fields_mismatch",
        recoveryAction: "reconcile_exact_operation"
      }
    }) });
    api.getStatus.mockResolvedValueOnce({ ok: true, status: calendarStatus({
      includeSync: false,
      externalCopies: [drift],
      externalCopiesTruncated: false
    }) });
    await click(action("reconcile-google-calendar-event"));
    expect(api.apply).toHaveBeenCalledWith(expect.objectContaining({
      quoteId: "quote-drift",
      command: "reconcile",
      expectedOperationId: drift.operationId
    }));
    expect(api.apply).not.toHaveBeenCalledWith(expect.objectContaining({
      quoteId: "quote-drift",
      command: "cancel"
    }));
  });

  test("does not fall back to blind removal when an exact retained-copy check is unavailable", async () => {
    await mount({
      mode: "connection",
      quoteId: "",
      sourceVersionId: "",
      eventStatus: ""
    }, calendarStatus({
      includeSync: false,
      externalCopies: [{
        quoteId: "quote-missing-operation",
        label: "Older connection copy",
        state: "provider_drift",
        syncRevision: 3,
        sourceVersionId: "version-older",
        operationId: "",
        recoveryAction: "reconcile_exact_operation",
        providerEventUrl: ""
      }]
    }));

    const unavailable = container.querySelector(action("reconcile-google-calendar-event"));
    expect(unavailable).not.toBeNull();
    expect(unavailable.disabled).toBe(true);
    expect(unavailable.textContent).toContain("Exact check unavailable");
    await click(action("reconcile-google-calendar-event"));
    expect(api.apply).not.toHaveBeenCalled();
  });

  test("reconciles provider drift for the selected event without overwriting it", async () => {
    const driftOperationId = `calendar_operation_${"d".repeat(48)}`;
    await mount({}, calendarStatus({
      sync: {
        state: "provider_drift",
        syncRevision: 4,
        sourceVersionId: "version-a",
        operationId: driftOperationId,
        reasonCode: "provider_owned_fields_mismatch",
        recoveryAction: "reconcile_exact_operation",
        providerEventUrl: "https://calendar.google.com/calendar/event?eid=ZHJpZnQ"
      }
    }));
    const reconcile = container.querySelector(action("reconcile-google-calendar-event"));
    expect(reconcile.textContent).toContain("Recheck changed Google copy");
    expect(container.textContent).toContain("QuotePilot did not overwrite it");

    api.apply.mockResolvedValueOnce({ ok: true, status: calendarStatus({
      sync: {
        state: "provider_drift",
        syncRevision: 5,
        sourceVersionId: "version-a",
        operationId: `calendar_operation_${"e".repeat(48)}`,
        reasonCode: "provider_owned_fields_mismatch",
        recoveryAction: "reconcile_exact_operation",
        providerEventUrl: "https://calendar.google.com/calendar/event?eid=ZHJpZnQ"
      }
    }) });
    await click(action("reconcile-google-calendar-event"));
    expect(api.apply).toHaveBeenCalledWith(expect.objectContaining({
      quoteId: "quote-a",
      command: "reconcile",
      expectedOperationId: driftOperationId
    }));
    expect(container.textContent).toContain("still differs");
  });

  test("keeps an uncertain disconnect visible and retries the identical retained request", async () => {
    await mount({
      mode: "connection",
      quoteId: "",
      sourceVersionId: "",
      eventStatus: ""
    }, calendarStatus({ includeSync: false }));
    const originalRequest = {
      organizationId: "org-a",
      requestId: "google_calendar_request_00000000-0000-4000-8000-000000000001",
      expectedConnectionRevision: 2
    };
    const uncertainStatus = calendarStatus({
      includeSync: false,
      connection: {
        state: "reconnect_required",
        connectionRevision: 3,
        reasonCode: "revocation_outcome_uncertain",
        canDisconnect: true
      }
    });
    const uncertain = Object.assign(new Error(
      "Google did not confirm whether authorization was revoked. New Calendar updates are blocked; retry only this original disconnect request."
    ), { uncertain: true, status: uncertainStatus });
    api.disconnect.mockRejectedValueOnce(uncertain);
    await click(action("disconnect-google-calendar"));

    expect(container.querySelector('[data-capability-channel="mutation"][data-capability-state="uncertain"]')).not.toBeNull();
    expect(container.textContent).toContain("did not confirm whether authorization was revoked");
    expect(container.querySelector(action("disconnect-google-calendar"))).toBeNull();
    expect(container.querySelector(action("retry-google-calendar-disconnect"))).not.toBeNull();

    api.readPending.mockReturnValueOnce({
      operation: "disconnect",
      request: originalRequest,
      definitive: false
    });
    api.disconnect.mockResolvedValueOnce({ ok: true, status: calendarStatus({
      includeSync: false,
      connection: {
        state: "revoked",
        connectionRevision: 4,
        calendarLabel: "",
        reasonCode: "authorization_revoked",
        canDisconnect: false
      }
    }) });
    await click(action("retry-google-calendar-disconnect"));
    expect(api.disconnect).toHaveBeenCalledTimes(2);
    expect(api.disconnect.mock.calls[0][0]).toEqual(originalRequest);
    expect(api.disconnect.mock.calls[1][0]).toEqual(originalRequest);
    expect(api.createRequestId).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("authorization is revoked");
  });

  test("lets an administrator revoke rejected stored credentials while naming retained copies", async () => {
    await mount({
      mode: "connection",
      quoteId: "",
      sourceVersionId: "",
      eventStatus: ""
    }, calendarStatus({
      includeSync: false,
      connection: {
        state: "reconnect_required",
        connectionRevision: 6,
        reasonCode: "provider_credentials_rejected",
        canDisconnect: true
      },
      externalCopies: [{
        quoteId: "quote-retained",
        label: "Retained event",
        state: "synced",
        syncRevision: 2,
        sourceVersionId: "version-retained",
        operationId: "",
        recoveryAction: "",
        providerEventUrl: ""
      }]
    }));
    expect(container.textContent).toContain("Disconnect the retained authorization");
    expect(container.querySelector(action("connect-google-calendar"))).toBeNull();
    expect(container.querySelector(action("disconnect-google-calendar"))).not.toBeNull();

    api.disconnect.mockResolvedValueOnce({ ok: true, status: calendarStatus({
      includeSync: false,
      connection: {
        state: "revoked",
        connectionRevision: 8,
        calendarLabel: "",
        reasonCode: "rejected_grant_revoked_external_copies_retained",
        canDisconnect: false
      },
      externalCopies: [{
        quoteId: "quote-retained",
        label: "Retained event",
        state: "synced",
        syncRevision: 2,
        sourceVersionId: "version-retained",
        operationId: "",
        recoveryAction: "",
        providerEventUrl: ""
      }]
    }) });
    await click(action("disconnect-google-calendar"));
    expect(api.disconnect).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-a",
      expectedConnectionRevision: 6
    }));
    expect(container.textContent).toContain("Prior event copies remain listed");
  });

  test("keeps stored-authorization cleanup available after Calendar publishing is disabled", async () => {
    await mount({
      mode: "connection",
      quoteId: "",
      sourceVersionId: "",
      eventStatus: ""
    }, calendarStatus({
      includeSync: false,
      configuration: { enabled: false, configured: false, cleanupAvailable: true },
      connection: {
        state: "disabled",
        connectionRevision: 9,
        canDisconnect: true
      },
      externalCopies: [{
        quoteId: "quote-retained-disabled",
        label: "Retained disabled event",
        state: "synced",
        syncRevision: 2,
        sourceVersionId: "version-retained-disabled",
        operationId: "",
        recoveryAction: "remove_external_copy",
        providerEventUrl: ""
      }]
    }));
    expect(container.textContent).toContain("publishing is disabled");
    expect(container.querySelector(action("disconnect-google-calendar"))).not.toBeNull();

    api.disconnect.mockResolvedValueOnce({ ok: true, status: calendarStatus({
      includeSync: false,
      configuration: { enabled: false, configured: false, cleanupAvailable: false },
      connection: {
        state: "disabled",
        connectionRevision: 11,
        calendarLabel: "",
        reasonCode: "disabled_grant_revoked_external_copies_retained",
        canDisconnect: false
      },
      externalCopies: [{
        quoteId: "quote-retained-disabled",
        label: "Retained disabled event",
        state: "synced",
        syncRevision: 2,
        sourceVersionId: "version-retained-disabled",
        operationId: "",
        recoveryAction: "remove_external_copy",
        providerEventUrl: ""
      }]
    }) });
    await click(action("disconnect-google-calendar"));
    expect(api.disconnect).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-a",
      expectedConnectionRevision: 9
    }));
    expect(container.textContent).toContain("publishing remains disabled");
    expect(container.textContent).toContain("Prior event copies remain listed");
  });

  test("does not present an uncertain OAuth token exchange as a successful connection", async () => {
    await mount({
      mode: "connection",
      quoteId: "",
      sourceVersionId: "",
      eventStatus: ""
    }, calendarStatus({
      includeSync: false,
      connection: {
        state: "unconfigured",
        connectionRevision: 4,
        configurationGeneration: 0,
        calendarLabel: "",
        reasonCode: "authorization_exchange_outcome_uncertain",
        canDisconnect: false
      }
    }));
    expect(container.textContent).toContain("authorization exchange result is unknown");
    expect(container.querySelector(action("connect-google-calendar"))).not.toBeNull();
    api.start.mockResolvedValueOnce({
      ok: true,
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=reviewed",
      expiresAtISO: "2026-09-13T12:10:00.000Z",
      connectionRevision: 5
    });
    await click(action("connect-google-calendar"));
    expect(api.start).toHaveBeenCalledWith(expect.objectContaining({
      acknowledgeUnknownExchange: true,
      expectedConnectionRevision: 4
    }));
  });

  test("offers a fenced disconnect retry after reload when no browser request receipt remains", async () => {
    api.readPending.mockReturnValue(null);
    await mount({
      mode: "connection",
      quoteId: "",
      sourceVersionId: "",
      eventStatus: ""
    }, calendarStatus({
      includeSync: false,
      connection: {
        state: "reconnect_required",
        connectionRevision: 7,
        reasonCode: "revocation_outcome_uncertain",
        canDisconnect: true
      }
    }));
    api.disconnect.mockResolvedValueOnce({ ok: true, status: calendarStatus({
      includeSync: false,
      connection: {
        state: "revoked",
        connectionRevision: 9,
        calendarLabel: "",
        reasonCode: "authorization_revoked",
        canDisconnect: false
      }
    }) });
    await click(action("retry-google-calendar-disconnect"));
    expect(api.disconnect).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-a",
      expectedConnectionRevision: 7
    }));
  });
});
