import { beforeEach, expect, test, vi } from "vitest";

const transport = vi.hoisted(() => ({ callable: vi.fn(), call: vi.fn() }));
const firebaseState = vi.hoisted(() => ({ ready: true, functions: {} }));
vi.mock("firebase/functions", () => ({ httpsCallable: transport.callable }));
vi.mock("../firebase", () => ({
  get cloudFunctions() { return firebaseState.functions; },
  get firebaseReady() { return firebaseState.ready; }
}));

import * as client from "../googleCalendarClient";

const boundary = client.GOOGLE_CALENDAR_EVIDENCE_BOUNDARY;
const operationId = `calendar_operation_${"a".repeat(48)}`;

function status({
  quote = false,
  connection = {},
  sync = {},
  configuration = {},
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
    sync: quote ? {
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

const envelope = (value) => ({ ok: true, status: value });

beforeEach(() => {
  vi.clearAllMocks();
  firebaseState.ready = true;
  firebaseState.functions = {};
  transport.callable.mockReturnValue(transport.call);
});

test("reads an exact frozen organization or event status without local authority", async () => {
  transport.call.mockResolvedValueOnce({ data: envelope(status()) });
  const connection = await client.getGoogleCalendarStatus({ organizationId: "org-a" });
  expect(transport.callable).toHaveBeenCalledWith(
    firebaseState.functions,
    "getGoogleCalendarStatus"
  );
  expect(transport.call).toHaveBeenCalledWith({ organizationId: "org-a" });
  expect(connection.status.sync).toBeNull();
  expect(Object.isFrozen(connection.status.connection)).toBe(true);

  transport.call.mockResolvedValueOnce({ data: envelope(status({ quote: true })) });
  const event = await client.getGoogleCalendarStatus({
    organizationId: "org-a",
    quoteId: "quote-a"
  });
  expect(event.status.sync).toMatchObject({
    state: "not_synced",
    activeSourceVersionId: "version-a"
  });

  transport.call.mockResolvedValueOnce({ data: envelope(status({
    externalCopies: [{
      quoteId: "quote-retained",
      label: "Catering event · Q-1042",
      state: "synced",
      syncRevision: 4,
      sourceVersionId: "version-retained",
      operationId: "",
      recoveryAction: "",
      providerEventUrl: "https://calendar.google.com/calendar/event?eid=cmV0YWluZWQ"
    }]
  })) });
  const retained = await client.getGoogleCalendarStatus({ organizationId: "org-a" });
  expect(retained.status.externalCopies).toEqual([expect.objectContaining({
    quoteId: "quote-retained",
    sourceVersionId: "version-retained",
    state: "synced"
  })]);
  expect(Object.isFrozen(retained.status.externalCopies[0])).toBe(true);
});

test("fails closed on unknown fields, contradictory evidence, and unsafe provider links", async () => {
  const missingTruncation = status();
  delete missingTruncation.externalCopiesTruncated;
  const malformed = [
    missingTruncation,
    { ...status(), privateRefreshToken: "secret" },
    status({ externalCopiesTruncated: "false" }),
    status({ connection: { state: "active", configurationGeneration: 0 } }),
    status({ configuration: { enabled: false, configured: true } }),
    status({ quote: true, sync: { state: "outcome_uncertain", operationId: "" } }),
    status({
      quote: true,
      sync: {
        providerEventUrl: "https://evil.example/calendar/event?eid=YWJjZGVmZ2g"
      }
    }),
    status({
      externalCopies: [{
        quoteId: "quote-unsafe-copy",
        label: "Catering event",
        state: "synced",
        syncRevision: 1,
        sourceVersionId: "version-copy",
        operationId: "",
        recoveryAction: "",
        providerEventUrl: "https://evil.example/calendar/event?eid=YWJjZGVmZ2g"
      }]
    })
  ];
  for (const value of malformed) {
    transport.call.mockResolvedValueOnce({ data: envelope(value) });
    await expect(client.getGoogleCalendarStatus(
      value.sync === null
        ? { organizationId: "org-a" }
        : { organizationId: "org-a", quoteId: "quote-a" }
    )).rejects.toMatchObject({ code: "invalid-server-response" });
  }
});

test("starts authorization only from the exact Google OAuth host and validates its response", async () => {
  const requestId = "google_calendar_request_00000000-0000-4000-8000-000000000001";
  transport.call.mockResolvedValueOnce({ data: {
    ok: true,
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?client_id=client&state=opaque",
    expiresAtISO: "2026-09-13T12:10:00.000Z",
    connectionRevision: 3
  } });
  const result = await client.startGoogleCalendarConnection({
    organizationId: "org-oauth",
    requestId,
    expectedConnectionRevision: 2
  });
  expect(transport.callable).toHaveBeenCalledWith(
    firebaseState.functions,
    "startGoogleCalendarConnection"
  );
  expect(result.authorizationUrl).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/u);
  expect(result.recovered).toBe(false);
  expect(client.readPendingGoogleCalendarMutation({ organizationId: "org-oauth" })).toBeNull();

  transport.call.mockResolvedValueOnce({ data: {
    ok: true,
    recovered: true,
    status: status({ connection: { connectionRevision: 5 } })
  } });
  const recovered = await client.startGoogleCalendarConnection({
    organizationId: "org-oauth-recovered",
    requestId,
    expectedConnectionRevision: 4
  });
  expect(recovered).toMatchObject({
    recovered: true,
    status: { connection: { state: "active", connectionRevision: 5 } }
  });
  expect(recovered.authorizationUrl).toBeUndefined();

  transport.call.mockResolvedValueOnce({ data: {
    ok: true,
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?client_id=client&state=reviewed",
    expiresAtISO: "2026-09-13T12:10:00.000Z",
    connectionRevision: 5
  } });
  await client.startGoogleCalendarConnection({
    organizationId: "org-oauth-reviewed",
    requestId,
    expectedConnectionRevision: 4,
    acknowledgeUnknownExchange: true
  });
  expect(transport.call).toHaveBeenLastCalledWith(expect.objectContaining({
    acknowledgeUnknownExchange: true
  }));
  expect(() => client.disconnectGoogleCalendar({
    organizationId: "org-oauth-reviewed",
    requestId,
    expectedConnectionRevision: 4,
    acknowledgeUnknownExchange: true
  })).toThrow(expect.objectContaining({ code: "invalid-argument" }));

  transport.call.mockResolvedValueOnce({ data: {
    ok: true,
    authorizationUrl: "https://accounts.google.com.evil.example/o/oauth2/v2/auth?state=opaque",
    expiresAtISO: "2026-09-13T12:10:00.000Z",
    connectionRevision: 3
  } });
  await expect(client.startGoogleCalendarConnection({
    organizationId: "org-unsafe-oauth",
    requestId,
    expectedConnectionRevision: 2
  })).rejects.toMatchObject({ code: "invalid-server-response", uncertain: true });
});

test("sends exact sync and removal commands and rejects a foreign revision response", async () => {
  const requestId = "google_calendar_request_00000000-0000-4000-8000-000000000002";
  const synced = status({
    quote: true,
    sync: {
      state: "synced",
      syncRevision: 1,
      sourceVersionId: "version-a",
      lastVerifiedAtISO: "2026-09-13T12:00:00.000Z",
      providerEventUrl: "https://calendar.google.com/calendar/event?eid=YWJjZGVmZ2hp"
    }
  });
  transport.call.mockResolvedValueOnce({ data: envelope(synced) });
  await client.syncGoogleCalendarEvent({
    organizationId: "org-a",
    quoteId: "quote-sync",
    requestId,
    expectedSyncRevision: 0,
    expectedConnectionGeneration: 3,
    expectedSourceVersionId: "version-a"
  });
  expect(transport.callable).toHaveBeenCalledWith(
    firebaseState.functions,
    "applyGoogleCalendarEventCommand"
  );
  expect(transport.call).toHaveBeenCalledWith(expect.objectContaining({
    command: "sync",
    expectedSourceVersionId: "version-a"
  }));

  transport.call.mockResolvedValueOnce({ data: envelope(status({
    quote: true,
    sync: {
      state: "canceled",
      syncRevision: 2,
      sourceVersionId: "version-a"
    }
  })) });
  await client.cancelGoogleCalendarEvent({
    organizationId: "org-a",
    quoteId: "quote-cancel",
    requestId,
    expectedSyncRevision: 1,
    expectedConnectionGeneration: 3,
    expectedBoundSourceVersionId: "version-a"
  });
  expect(transport.call).toHaveBeenLastCalledWith(expect.objectContaining({
    command: "cancel",
    expectedBoundSourceVersionId: "version-a"
  }));

  transport.call.mockResolvedValueOnce({ data: envelope(status({
    quote: true,
    sync: {
      state: "synced",
      syncRevision: 1,
      sourceVersionId: "version-foreign",
      activeSourceVersionId: "version-foreign",
      lastVerifiedAtISO: "2026-09-13T12:00:00.000Z"
    }
  })) });
  await expect(client.syncGoogleCalendarEvent({
    organizationId: "org-a",
    quoteId: "quote-foreign",
    requestId,
    expectedSyncRevision: 0,
    expectedConnectionGeneration: 3,
    expectedSourceVersionId: "version-a"
  })).rejects.toMatchObject({ code: "invalid-server-response", uncertain: true });
});

test("retains an uncertain event request and allows only exact reconciliation", async () => {
  const input = {
    organizationId: "org-a",
    quoteId: "quote-uncertain",
    requestId: "google_calendar_request_00000000-0000-4000-8000-000000000003",
    expectedSyncRevision: 0,
    expectedConnectionGeneration: 3,
    expectedSourceVersionId: "version-a"
  };
  transport.call.mockRejectedValueOnce(Object.assign(new Error("timeout"), {
    code: "functions/unavailable"
  }));
  await expect(client.syncGoogleCalendarEvent(input)).rejects.toMatchObject({
    uncertain: true
  });
  expect(client.readPendingGoogleCalendarMutation(input)).toMatchObject({
    operation: "sync",
    definitive: false,
    request: { requestId: input.requestId, command: "sync" }
  });
  await expect(client.syncGoogleCalendarEvent({
    ...input,
    requestId: "google_calendar_request_00000000-0000-4000-8000-000000000004"
  })).rejects.toMatchObject({ code: "calendar-mutation-blocked" });
  expect(transport.call).toHaveBeenCalledTimes(1);

  transport.call.mockResolvedValueOnce({ data: envelope(status({
    quote: true,
    sync: {
      state: "synced",
      syncRevision: 1,
      sourceVersionId: "version-a",
      lastVerifiedAtISO: "2026-09-13T12:00:00.000Z"
    }
  })) });
  await client.reconcileGoogleCalendarEvent({
    organizationId: input.organizationId,
    quoteId: input.quoteId,
    requestId: "google_calendar_request_00000000-0000-4000-8000-000000000005",
    expectedSyncRevision: 0,
    expectedConnectionGeneration: 3,
    expectedOperationId: operationId
  });
  expect(client.readPendingGoogleCalendarMutation(input)).toBeNull();
});

test("disconnect requires an exact non-active status and missing Firebase never becomes authority", async () => {
  const input = {
    organizationId: "org-disconnect",
    requestId: "google_calendar_request_00000000-0000-4000-8000-000000000006",
    expectedConnectionRevision: 2
  };
  transport.call.mockResolvedValueOnce({ data: envelope(status({
    connection: {
      state: "revoked",
      connectionRevision: 3,
      configurationGeneration: 3,
      calendarLabel: "",
      reasonCode: "authorization_revoked",
      canDisconnect: false
    }
  })) });
  const result = await client.disconnectGoogleCalendar(input);
  expect(result.status.connection.state).toBe("revoked");
  expect(transport.callable).toHaveBeenCalledWith(
    firebaseState.functions,
    "disconnectGoogleCalendar"
  );

  firebaseState.ready = false;
  await expect(client.getGoogleCalendarStatus({ organizationId: "org-offline" }))
    .rejects.toMatchObject({ code: "unavailable" });
  expect(transport.callable).toHaveBeenCalledTimes(1);
});

test("retains an uncertain disconnect and retries only its original request identity", async () => {
  const input = {
    organizationId: "org-disconnect-uncertain",
    requestId: "google_calendar_request_00000000-0000-4000-8000-000000000007",
    expectedConnectionRevision: 2
  };
  const uncertainStatus = status({
    connection: {
      state: "reconnect_required",
      connectionRevision: 3,
      configurationGeneration: 3,
      reasonCode: "revocation_outcome_uncertain",
      canDisconnect: true
    }
  });
  transport.call.mockResolvedValueOnce({ data: envelope(uncertainStatus) });
  const uncertain = await client.disconnectGoogleCalendar(input).catch((error) => error);
  expect(uncertain).toMatchObject({
    code: "calendar-disconnect-uncertain",
    uncertain: true,
    status: { connection: { reasonCode: "revocation_outcome_uncertain" } }
  });
  expect(client.readPendingGoogleCalendarMutation(input)).toMatchObject({
    operation: "disconnect",
    definitive: false,
    request: input
  });

  transport.call.mockResolvedValueOnce({ data: envelope(status({
    connection: {
      state: "revoked",
      connectionRevision: 4,
      configurationGeneration: 3,
      calendarLabel: "",
      reasonCode: "authorization_revoked",
      canDisconnect: false
    }
  })) });
  const retried = await client.disconnectGoogleCalendar(input);
  expect(transport.call).toHaveBeenLastCalledWith(input);
  expect(retried.status.connection.state).toBe("revoked");
  expect(client.readPendingGoogleCalendarMutation(input)).toBeNull();
});

test("does not accept a disconnected receipt while retained copies are still incomplete", async () => {
  const input = {
    organizationId: "org-disconnect-incomplete",
    requestId: "google_calendar_request_00000000-0000-4000-8000-000000000008",
    expectedConnectionRevision: 2
  };
  transport.call.mockResolvedValueOnce({ data: envelope(status({
    connection: {
      state: "revoked",
      connectionRevision: 3,
      configurationGeneration: 3,
      calendarLabel: "",
      reasonCode: "authorization_revoked",
      canDisconnect: false
    },
    externalCopiesTruncated: true
  })) });
  await expect(client.disconnectGoogleCalendar(input)).rejects.toMatchObject({
    code: "invalid-server-response",
    uncertain: true
  });
});

test("accepts an explicit rejected-grant revocation while retaining named event copies", async () => {
  const input = {
    organizationId: "org-disconnect-rejected",
    requestId: "google_calendar_request_00000000-0000-4000-8000-000000000009",
    expectedConnectionRevision: 4
  };
  transport.call.mockResolvedValueOnce({ data: envelope(status({
    connection: {
      state: "revoked",
      connectionRevision: 6,
      configurationGeneration: 3,
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
      recoveryAction: "remove_external_copy",
      providerEventUrl: ""
    }]
  })) });
  const result = await client.disconnectGoogleCalendar(input);
  expect(result.status.connection.reasonCode)
    .toBe("rejected_grant_revoked_external_copies_retained");
  expect(result.status.externalCopies).toHaveLength(1);
});

test("accepts credential cleanup while publishing is disabled and retains external copies", async () => {
  const input = {
    organizationId: "org-disconnect-disabled",
    requestId: "google_calendar_request_00000000-0000-4000-8000-000000000010",
    expectedConnectionRevision: 4
  };
  transport.call.mockResolvedValueOnce({ data: envelope(status({
    configuration: { enabled: false, configured: false, cleanupAvailable: false },
    connection: {
      state: "disabled",
      connectionRevision: 6,
      configurationGeneration: 3,
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
  })) });
  const result = await client.disconnectGoogleCalendar(input);
  expect(result.status.connection.reasonCode)
    .toBe("disabled_grant_revoked_external_copies_retained");
  expect(result.status.configuration.cleanupAvailable).toBe(false);
  expect(result.status.externalCopies).toHaveLength(1);
});
