import { createRequire } from "node:module";
import { describe, expect, test, vi } from "vitest";

const require = createRequire(import.meta.url);
const calendar = require("../../../functions/googleCalendarIntegration.js");

const organizationId = "org-one";
const quoteId = "quote-one";
const sourceVersionId = "version-one";
const portalIssuedAtISO = "2026-09-12T15:00:00.000Z";
const quote = {
  id: quoteId,
  organizationId,
  status: "booked",
  activeVersionId: sourceVersionId,
  quoteNumber: "QP-1042",
  portalIssuedAtISO
};
const sourceVersion = {
  versionId: sourceVersionId,
  organizationId,
  quoteId,
  snapshot: {
    id: quoteId,
    organizationId,
    quoteNumber: "QP-1042",
    customer: { name: "Taylor Foods", email: "private@example.test" },
    event: {
      name: "Annual dinner",
      date: "2026-09-15",
      time: "17:30",
      hours: 4.5,
      venue: "River Hall",
      venueAddress: "10 Main Street",
      dietaryRestrictions: "Private dietary details",
      servers: 9,
      chefs: 3
    },
    totals: { total: 12_000 },
    notes: "Internal note",
    beo: { status: "ready" },
    productionChecklist: ["Private task"]
  }
};
const acceptanceReceipt = {
  receiptId: "accepted-one",
  organizationId,
  quoteId,
  quoteRevisionId: `${sourceVersionId}@${portalIssuedAtISO}`,
  acceptedAtISO: "2026-09-12T16:00:00.000Z"
};
const projectionInput = (overrides = {}) => ({
  organizationId,
  quoteId,
  sourceVersionId,
  quote,
  sourceVersion,
  acceptanceReceipt,
  tenantTimeZone: "America/Chicago",
  calendarBindingId: "calendar-binding-one",
  ...overrides
});
const syncRequest = (overrides = {}) => ({
  organizationId,
  quoteId,
  requestId: "calendar-sync-request-0001",
  expectedSyncRevision: 0,
  expectedConnectionGeneration: 1,
  command: "sync",
  expectedSourceVersionId: sourceVersionId,
  ...overrides
});

describe("Google Calendar integration authority", () => {
  test("publishes a frozen narrow policy", () => {
    expect(calendar.GOOGLE_CALENDAR_POLICY).toMatchObject({
      schemaVersion: "google-calendar-integration-v1",
      provider: "google_calendar",
      maximumEventHours: 72,
      scopes: [
        "https://www.googleapis.com/auth/calendar.events.owned"
      ]
    });
    expect(calendar.GOOGLE_CALENDAR_POLICY_DIGEST).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(calendar.GOOGLE_CALENDAR_POLICY)).toBe(true);
    expect(Object.isFrozen(calendar.GOOGLE_CALENDAR_POLICY.scopes)).toBe(true);
  });

  test("strictly normalizes bounded sync, cancel, and reconciliation commands", () => {
    const sync = calendar.normalizeSyncCommand(syncRequest());
    expect(sync).toEqual(syncRequest());
    expect(Object.isFrozen(sync)).toBe(true);
    const { expectedSourceVersionId: _sourceForCancel, ...cancelBase } = syncRequest();
    expect(calendar.normalizeSyncCommand({
      ...cancelBase,
      command: "cancel",
      expectedBoundSourceVersionId: sourceVersionId
    })).toMatchObject({ command: "cancel", expectedBoundSourceVersionId: sourceVersionId });
    const { expectedSourceVersionId: _sourceForReconcile, ...reconcileBase } = syncRequest();
    expect(calendar.normalizeSyncCommand({
      ...reconcileBase,
      command: "reconcile",
      expectedOperationId: "calendar_operation_" + "a".repeat(48)
    })).toMatchObject({ command: "reconcile" });
    expect(() => calendar.normalizeSyncCommand({ ...syncRequest(), extra: true })).toThrow(/unsupported fields/);
    expect(() => calendar.normalizeSyncCommand({ ...syncRequest(), requestId: "short" })).toThrow(/20 to 160/);
    expect(() => calendar.normalizeSyncCommand({ ...syncRequest(), expectedSyncRevision: -1 })).toThrow(/bounded/);
    expect(calendar.calendarOperationIdFor(syncRequest())).toMatch(/^calendar_operation_[a-f0-9]{48}$/);
  });

  test("builds a deterministic accepted-event projection without restricted business content", () => {
    const first = calendar.buildCanonicalEventProjection(projectionInput());
    const repeated = calendar.buildCanonicalEventProjection(projectionInput());
    expect(first).toEqual(repeated);
    expect(first.eventId).toMatch(/^[a-v0-9]{5,1024}$/);
    expect(first.payloadSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first).toMatchObject({
      organizationId,
      quoteId,
      sourceVersionId,
      acceptanceReceiptId: "accepted-one",
      durationMinutes: 270,
      sendUpdates: "none"
    });
    expect(first.providerEvent).toMatchObject({
      id: first.eventId,
      summary: "Annual dinner",
      description: "QuotePilot event QP-1042",
      location: "River Hall — 10 Main Street",
      start: { dateTime: "2026-09-15T22:30:00.000Z", timeZone: "America/Chicago" },
      end: { dateTime: "2026-09-16T03:00:00.000Z", timeZone: "America/Chicago" },
      transparency: "opaque",
      extendedProperties: { private: { qp_owner: "quotepilot" } }
    });
    const serialized = JSON.stringify(first.providerEvent);
    for (const privateValue of [
      "Taylor Foods", "private@example.test", "Private dietary details", "12000", "servers",
      "chefs", "Internal note", "ready", "Private task"
    ]) expect(serialized).not.toContain(privateValue);
    expect(first.providerEvent).not.toHaveProperty("attendees");
    expect(Object.isFrozen(first.providerEvent.extendedProperties.private)).toBe(true);
  });

  test("keeps one provider event identity across accepted source revisions", () => {
    const first = calendar.buildCanonicalEventProjection(projectionInput());
    const revisionTwo = {
      ...sourceVersion,
      versionId: "version-two",
      snapshot: { ...sourceVersion.snapshot, event: { ...sourceVersion.snapshot.event, hours: 5 } }
    };
    const second = calendar.buildCanonicalEventProjection(projectionInput({
      sourceVersionId: "version-two",
      quote: { ...quote, activeVersionId: "version-two" },
      sourceVersion: revisionTwo,
      acceptanceReceipt: { ...acceptanceReceipt, quoteRevisionId: "version-two" }
    }));
    expect(second.eventId).toBe(first.eventId);
    expect(second.payloadSha256).not.toBe(first.payloadSha256);
    expect(second.providerEvent.extendedProperties.private.qp_source_hash)
      .not.toBe(first.providerEvent.extendedProperties.private.qp_source_hash);
    expect(calendar.buildCanonicalEventProjection(projectionInput({
      calendarBindingId: "reconnected-binding"
    })).eventId).toBe(first.eventId);
  });

  test("fails closed without exact active acceptance and complete scheduling facts", () => {
    expect(() => calendar.buildCanonicalEventProjection(projectionInput({
      sourceVersion: {
        ...sourceVersion,
        snapshot: {
          ...sourceVersion.snapshot,
          event: { ...sourceVersion.snapshot.event, venue: "", venueAddress: "" }
        }
      }
    }))).toThrow(/Calendar location is required/);
    expect(() => calendar.buildCanonicalEventProjection(projectionInput({
      quote: { ...quote, status: "draft" }
    }))).toThrow(/accepted or booked/);
    expect(() => calendar.buildCanonicalEventProjection(projectionInput({
      quote: { ...quote, activeVersionId: "another-version" }
    }))).toThrow(/accepted or booked/);
    expect(() => calendar.buildCanonicalEventProjection(projectionInput({
      acceptanceReceipt: { ...acceptanceReceipt, quoteRevisionId: "another-version" }
    }))).toThrow(/acceptance evidence/);
    expect(() => calendar.buildCanonicalEventProjection(projectionInput({
      sourceVersion: {
        ...sourceVersion,
        snapshot: { ...sourceVersion.snapshot, event: { ...sourceVersion.snapshot.event, time: "" } }
      }
    }))).toThrow(/start time/);
    expect(() => calendar.buildCanonicalEventProjection(projectionInput({ tenantTimeZone: "Mars/Olympus" })))
      .toThrow(/IANA/);
  });

  test("rejects nonexistent and ambiguous tenant-local clock times instead of guessing", () => {
    expect(() => calendar.resolveTenantLocalInstant("2026-03-08", "02:30", "America/Chicago"))
      .toThrow(/does not exist/);
    expect(() => calendar.resolveTenantLocalInstant("2026-11-01", "01:30", "America/Chicago"))
      .toThrow(/ambiguous/);
  });

  test("signs OAuth state with expiry and exact actor, tenant, request, and redirect binding", () => {
    const signingSecret = Buffer.alloc(32, 7);
    const args = {
      organizationId,
      actorUid: "admin-one",
      requestId: "calendar-oauth-request-001",
      redirectUri: "https://us-central1-example.cloudfunctions.net/googleCalendarOAuthCallback",
      nowISO: "2026-09-13T10:00:00.000Z",
      signingSecret,
      randomBytes: () => Buffer.alloc(24, 3)
    };
    const created = calendar.createOAuthState(args);
    expect(created.stateId).toMatch(/^calendar_oauth_state_[a-f0-9]{48}$/);
    expect(created.expiresAtISO).toBe("2026-09-13T10:10:00.000Z");
    expect(created.state).not.toContain(organizationId);
    expect(created.state).not.toContain("admin-one");
    const verified = calendar.verifyOAuthState(created.state, args);
    expect(verified.stateId).toBe(created.stateId);
    expect(Object.isFrozen(verified.claims)).toBe(true);
    expect(() => calendar.verifyOAuthState(`${created.state.slice(0, -1)}x`, args)).toThrow(/signature|state/);
    expect(() => calendar.verifyOAuthState(created.state, { ...args, actorUid: "admin-two" })).toThrow(/another request/);
    expect(() => calendar.verifyOAuthState(created.state, {
      ...args,
      nowISO: "2026-09-13T10:11:00.000Z"
    })).toThrow(/expired/);
  });

  test("encrypts refresh tokens with AES-256-GCM and tenant/actor/key-version AAD", () => {
    const encryptionKey = Buffer.alloc(32, 11);
    const input = {
      refreshToken: "refresh-token-value",
      organizationId,
      actorUid: "admin-one",
      keyVersion: "key-v1",
      encryptionKey,
      randomBytes: () => Buffer.alloc(12, 4)
    };
    const envelope = calendar.encryptRefreshToken(input);
    expect(envelope).toMatchObject({
      schemaVersion: 1,
      algorithm: "A256GCM",
      keyVersion: "key-v1"
    });
    expect(JSON.stringify(envelope)).not.toContain("refresh-token-value");
    expect(calendar.decryptRefreshToken({
      envelope,
      organizationId,
      actorUid: "admin-one",
      encryptionKey
    })).toBe("refresh-token-value");
    expect(() => calendar.decryptRefreshToken({
      envelope,
      organizationId: "org-two",
      actorUid: "admin-one",
      encryptionKey
    })).toThrow(/binding/);
    const tampered = { ...envelope, ciphertext: Buffer.from("tampered").toString("base64") };
    expect(() => calendar.decryptRefreshToken({
      envelope: tampered,
      organizationId,
      actorUid: "admin-one",
      encryptionKey
    })).toThrow(/authentication/);
    expect(() => calendar.encryptRefreshToken({ ...input, encryptionKey: Buffer.alloc(31) }))
      .toThrow(/256-bit/);
  });

  test.each([
    [
      { state: "pending" },
      {},
      "replace_pending"
    ],
    [
      { state: "pending" },
      { tokenEnvelope: { ciphertext: "retained" } },
      "restore_prior"
    ],
    [
      { state: "exchanging" },
      {},
      "record_exchange_uncertain"
    ],
    [
      { state: "token_issued", tokenEnvelope: { ciphertext: "issued" }, ownershipVerified: true },
      {},
      "activate_verified_grant"
    ],
    [
      { state: "token_issued", tokenEnvelope: { ciphertext: "issued" }, ownershipVerified: false },
      {},
      "revoke_unverified_grant"
    ]
  ])("plans an explicit expired OAuth recovery transition %#", (attempt, connectionPatch, action) => {
    expect(calendar.planExpiredOAuthRecovery({
      connection: {
        state: "authorizing",
        pendingExpiresAtISO: "2026-09-13T12:00:00.000Z",
        ...connectionPatch
      },
      attempt,
      nowISO: "2026-09-13T12:01:00.000Z"
    })).toEqual({ action });
  });

  test("does not recover a live OAuth window and fails closed on an unbound issued token", () => {
    expect(calendar.planExpiredOAuthRecovery({
      connection: {
        state: "authorizing",
        pendingExpiresAtISO: "2026-09-13T12:02:00.000Z"
      },
      attempt: { state: "exchanging" },
      nowISO: "2026-09-13T12:01:00.000Z"
    })).toEqual({ action: "none" });
    expect(calendar.planExpiredOAuthRecovery({
      connection: {
        state: "authorizing",
        pendingExpiresAtISO: "2026-09-13T12:00:00.000Z",
        mutationLeaseExpiresAtISO: "2026-09-13T12:02:00.000Z"
      },
      attempt: {
        state: "exchanging",
        exchangeLeaseExpiresAtISO: "2026-09-13T12:02:00.000Z"
      },
      nowISO: "2026-09-13T12:01:00.000Z"
    })).toEqual({ action: "none" });
    expect(calendar.planExpiredOAuthRecovery({
      connection: {
        state: "authorizing",
        pendingExpiresAtISO: "2026-09-13T12:00:00.000Z",
        mutationLeaseExpiresAtISO: "2026-09-13T12:02:00.000Z"
      },
      attempt: {
        state: "exchanging",
        exchangeLeaseExpiresAtISO: "2026-09-13T12:02:00.000Z"
      },
      nowISO: "2026-09-13T12:03:00.000Z"
    })).toEqual({ action: "record_exchange_uncertain" });
    expect(() => calendar.planExpiredOAuthRecovery({
      connection: {
        state: "authorizing",
        pendingExpiresAtISO: "2026-09-13T12:00:00.000Z"
      },
      attempt: { state: "token_issued", ownershipVerified: true },
      nowISO: "2026-09-13T12:01:00.000Z"
    })).toThrow(/no safe recovery transition/i);
  });

  test.each([
    [{ operation: "insert", httpStatus: 201, hasExpectedEventId: true, hasEtag: true }, "provider_accepted", false],
    [{ operation: "insert", httpStatus: 201, hasExpectedEventId: false, hasEtag: true }, "outcome_uncertain", true],
    [{ operation: "insert", httpStatus: 401 }, "reconnect_required", false],
    [{ operation: "insert", httpStatus: 409 }, "outcome_uncertain", true],
    [{ operation: "update", httpStatus: 412 }, "provider_drift", true],
    [{ operation: "update", httpStatus: 429 }, "outcome_uncertain", true],
    [{ operation: "update", httpStatus: 503 }, "outcome_uncertain", true],
    [{ operation: "cancel", httpStatus: 410 }, "provider_absent", false],
    [{ operation: "update", httpStatus: 400, providerReason: "timeRangeEmpty" }, "definite_failure", false]
  ])("classifies provider evidence %#", (input, state, reconcileRequired) => {
    expect(calendar.classifyProviderResponse(input)).toMatchObject({ state, reconcileRequired });
  });

  test("executes one injected provider request without leaking credentials or raw errors", async () => {
    const providerEvent = calendar.buildCanonicalEventProjection(projectionInput()).providerEvent;
    const fetchImpl = vi.fn(async () => ({
      status: 201,
      headers: { get: () => "" },
      json: async () => ({
        ...providerEvent,
        id: providerEvent.id,
        etag: '"etag-one"',
        updated: "2026-09-13T10:30:00.000Z",
        htmlLink: "https://calendar.google.com/calendar/event?eid=safe",
        providerDebug: "provider response detail"
      })
    }));
    const result = await calendar.executeProviderRequest({
      fetchImpl,
      accessToken: "access-token-secret",
      calendarId: "primary",
      operation: "insert",
      eventId: providerEvent.id,
      providerEvent
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toContain("/calendars/primary/events?sendUpdates=none");
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toBe("Bearer access-token-secret");
    expect(JSON.parse(options.body)).not.toHaveProperty("attendees");
    expect(result).toEqual({
      outcome: {
        state: "provider_accepted",
        reasonCode: "provider_event_verified",
        retrySafe: false,
        reconcileRequired: false
      },
      provider: {
        eventId: providerEvent.id,
        etag: '"etag-one"',
        ownedFieldsSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        htmlLink: "https://calendar.google.com/calendar/event?eid=safe",
        updatedAtISO: "2026-09-13T10:30:00.000Z"
      }
    });
    expect(JSON.stringify(result)).not.toContain("access-token-secret");
    expect(JSON.stringify(result)).not.toContain("provider response detail");
    expect(calendar.safeGoogleCalendarHtmlLink(
      "https://calendar.google.com/calendar/event?eid=safe&authuser=private"
    )).toBe("");
    expect(calendar.safeGoogleCalendarHtmlLink(
      "https://www.google.com/calendar/settings?eid=safe"
    )).toBe("");
  });

  test("treats transport failure as uncertain and never retries internally", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("secret provider failure"); });
    const result = await calendar.executeProviderRequest({
      fetchImpl,
      accessToken: "access-token-secret",
      calendarId: "primary",
      operation: "reconcile",
      eventId: calendar.calendarEventIdFor({ organizationId, quoteId, calendarBindingId: "binding" })
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.outcome).toMatchObject({
      state: "outcome_uncertain",
      reasonCode: "provider_network_error",
      reconcileRequired: true
    });
    expect(result.provider).toEqual({
      eventId: "",
      etag: "",
      ownedFieldsSha256: "",
      htmlLink: "",
      updatedAtISO: ""
    });
    expect(JSON.stringify(result)).not.toContain("secret provider failure");
  });

  test("uses etag fencing for updates", async () => {
    const providerEvent = calendar.buildCanonicalEventProjection(projectionInput()).providerEvent;
    const fetchImpl = vi.fn(async () => ({
      status: 412,
      headers: { get: () => "" },
      json: async () => ({ error: { errors: [{ reason: "conditionNotMet" }] } })
    }));
    const result = await calendar.executeProviderRequest({
      fetchImpl,
      accessToken: "access-token-secret",
      calendarId: "primary",
      operation: "update",
      eventId: providerEvent.id,
      providerEvent,
      etag: '"etag-prior"'
    });
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({
      method: "PATCH",
      headers: { "If-Match": '"etag-prior"' }
    });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).not.toHaveProperty("id");
    expect(result.outcome).toMatchObject({ state: "provider_drift", reasonCode: "provider_etag_conflict" });
  });

  test("uses etag fencing when removing the external copy", async () => {
    const eventId = calendar.calendarEventIdFor({ organizationId, quoteId, calendarBindingId: "binding" });
    const fetchImpl = vi.fn(async () => ({
      status: 204,
      headers: { get: () => "" },
      json: async () => null
    }));
    const result = await calendar.executeProviderRequest({
      fetchImpl,
      accessToken: "access-token-secret",
      calendarId: "primary",
      operation: "cancel",
      eventId,
      etag: '"etag-current"'
    });
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({
      method: "DELETE",
      headers: { "If-Match": '"etag-current"' }
    });
    expect(result.outcome.state).toBe("provider_absent");
  });

  test("projects staff-safe status and makes active-revision drift explicit", () => {
    const projection = calendar.projectStaffStatus({
      connection: {
        state: "active",
        connectionRevision: 2,
        configurationGeneration: 3,
        calendarLabel: "Operations",
        calendarId: "private@example.test",
        encryptedRefreshToken: "secret",
        googleSubject: "private-subject"
      },
      sync: {
        state: "synced",
        syncRevision: 4,
        connectionGeneration: 3,
        sourceVersionId: "version-one",
        providerEventId: "private-provider-id",
        providerEtag: "private-etag",
        rawError: "private-error",
        lastVerifiedAtISO: "2026-09-13T10:30:00.000Z"
      },
      activeSourceVersionId: "version-two"
    });
    expect(projection).toMatchObject({
      connection: { state: "active", connectionRevision: 2, configurationGeneration: 3 },
      sync: {
        state: "update_required",
        syncRevision: 4,
        connectionGeneration: 3,
        sourceVersionId: "version-one",
        activeSourceVersionId: "version-two",
        reasonCode: "quote_revision_changed",
        recoveryAction: "sync_current_revision"
      }
    });
    for (const privateValue of [
      "private@example.test", "secret", "private-subject", "private-provider-id",
      "private-etag", "private-error"
    ]) expect(JSON.stringify(projection)).not.toContain(privateValue);
    expect(Object.isFrozen(projection.sync)).toBe(true);
  });

  test("fails visible when provider evidence belongs to an earlier connection generation", () => {
    const projection = calendar.projectStaffStatus({
      connection: {
        state: "active",
        connectionRevision: 5,
        configurationGeneration: 4,
        calendarLabel: "New operations calendar"
      },
      sync: {
        state: "synced",
        syncRevision: 7,
        connectionGeneration: 3,
        sourceVersionId: "version-two",
        reasonCode: "provider_event_verified",
        lastVerifiedAtISO: "2026-09-13T10:30:00.000Z"
      },
      activeSourceVersionId: "version-two"
    });
    expect(projection).toMatchObject({
      connection: { state: "active", configurationGeneration: 4 },
      sync: {
        state: "provider_drift",
        syncRevision: 7,
        connectionGeneration: 3,
        sourceVersionId: "version-two",
        activeSourceVersionId: "version-two",
        reasonCode: "calendar_connection_generation_changed",
        recoveryAction: "reconcile_exact_operation"
      }
    });
  });

  test("does not resurrect a verified canceled copy after connection generation changes", () => {
    const projection = calendar.projectStaffStatus({
      connection: {
        state: "active",
        connectionRevision: 8,
        configurationGeneration: 5,
        calendarLabel: "Operations"
      },
      sync: {
        state: "canceled",
        syncRevision: 9,
        connectionGeneration: 4,
        sourceVersionId: "version-two",
        reasonCode: "provider_event_already_absent",
        lastVerifiedAtISO: "2026-09-13T10:30:00.000Z"
      },
      activeSourceVersionId: "version-two"
    });
    expect(projection.sync).toMatchObject({
      state: "canceled",
      connectionGeneration: 4,
      reasonCode: "provider_event_already_absent"
    });
  });
});
