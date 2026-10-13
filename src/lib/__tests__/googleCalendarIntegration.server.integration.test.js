import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = process.cwd();
const functionsSource = fs.readFileSync(path.join(ROOT, "functions", "index.js"), "utf8");
const calendarSource = fs.readFileSync(
  path.join(ROOT, "functions", "googleCalendarIntegration.js"),
  "utf8"
);
const rulesSource = fs.readFileSync(path.join(ROOT, "firestore.rules"), "utf8");

describe("Google Calendar server integration boundary", () => {
  test("exports the complete provider flow behind one secret-bound runtime", () => {
    for (const exportName of [
      "getGoogleCalendarStatus",
      "startGoogleCalendarConnection",
      "googleCalendarOAuthCallback",
      "applyGoogleCalendarEventCommand",
      "disconnectGoogleCalendar"
    ]) {
      expect(functionsSource).toMatch(new RegExp(`exports\\.${exportName} = functions`));
    }
    for (const secretName of [
      "GOOGLE_CALENDAR_OAUTH_CLIENT_ID",
      "GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET",
      "GOOGLE_CALENDAR_OAUTH_STATE_SECRET",
      "GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY"
    ]) {
      expect(functionsSource).toContain(secretName);
    }
    expect(functionsSource).toContain("GOOGLE_CALENDAR_SECRET_BINDINGS");
    expect(functionsSource).toContain("GOOGLE_CALENDAR_INTEGRATION_ENABLED");
    expect(functionsSource).toContain("settings?.googleCalendarIntegrationEnabled !== true");
  });

  test("verifies immutable acceptance before projecting and preserves QuotePilot authority", () => {
    expect(functionsSource).toMatch(
      /quoteAttendance\.resolveAcceptedSource\([\s\S]*buildCanonicalEventProjection\(/
    );
    expect(functionsSource).toContain("The accepted event revision changed");
    expect(calendarSource).toContain("calendar.events.owned");
    expect(calendarSource).not.toContain("calendar.calendarlist.readonly");
    expect(calendarSource).toContain('sendUpdates: "none"');
    expect(calendarSource).not.toMatch(/attendees\s*:/u);
    expect(calendarSource).not.toMatch(/dietaryRestrictions\s*:/u);
    expect(calendarSource).not.toMatch(/staff(?:Name|Email|Assignments?)\s*:/u);
  });

  test("keeps OAuth, link, and operation records browser-private", () => {
    for (const collectionName of [
      "googleCalendarOAuthStates",
      "googleCalendarConnections",
      "googleCalendarEventLinks",
      "googleCalendarOperations"
    ]) {
      expect(rulesSource).toContain(collectionName);
    }
    expect(rulesSource).toMatch(
      /match \/googleCalendarOAuthStates\/\{stateId\}[\s\S]*allow read, create, update, delete: if false;/u
    );
    for (const collectionName of [
      "googleCalendarConnections",
      "googleCalendarEventLinks",
      "googleCalendarOperations"
    ]) {
      expect(rulesSource).toMatch(new RegExp(
        `match /organizations/\\{orgId\\}/${collectionName}/\\{[^}]+\\} \\{[\\s\\S]*?allow read, write: if false;`
      ));
    }
  });

  test("requires deliberate removal and reconciliation instead of inferring event cancellation", () => {
    expect(functionsSource).toContain('request.command === "cancel"');
    expect(functionsSource).toContain("provider_event_already_absent");
    expect(functionsSource).toContain("provider_owned_fields_changed");
    expect(functionsSource).toContain('resultState = "provider_drift"');
    expect(functionsSource).not.toMatch(
      /booking\??\.confirmationStatus[\s\S]{0,160}(?:cancel|DELETE)/u
    );
  });

  test("blocks blind publish or removal while a queued provider operation can still be reconciled", () => {
    expect(functionsSource).toContain(
      '["queued", "outcome_uncertain", "dispatching"].includes(link.state)'
    );
    expect(functionsSource).toContain(
      '"queued", "dispatching", "outcome_uncertain", "provider_drift", "blocked_connection"'
    );
    expect(functionsSource).toContain(
      "Reconcile the prior Calendar operation before removing its copy."
    );
  });

  test("leases each provider mutation and returns every exact operation replay without dispatch", () => {
    expect(functionsSource).toContain('mutationLeaseKind: "event"');
    expect(functionsSource).toContain('connection.mutationLeaseId !== operationId');
    expect(functionsSource).toContain("if (claim.replay)");
    expect(functionsSource).toContain('state: "dispatching"');
    expect(functionsSource).not.toMatch(/operationRef\.set\(\{\s*state: "dispatching"/u);
  });

  test("claims OAuth exchange before issuing a token and retains issued tokens for activation recovery", () => {
    expect(functionsSource).toContain('state: "exchanging"');
    expect(functionsSource).toContain('state: "token_issued"');
    expect(functionsSource).toContain("issuedTokenPersisted");
    expect(functionsSource).toContain("revokeGoogleCalendarToken");
    expect(functionsSource).toContain('currentAttempt.state !== "token_issued"');
    expect(functionsSource).toContain("ownershipVerified");
    expect(functionsSource).toContain("retainGoogleCalendarRevocationUncertainty");
    expect(functionsSource).toContain('"exchange_outcome_uncertain"');
    expect(functionsSource).toContain('supersededAttempt.state !== "pending"');
    expect(functionsSource).toContain(
      "The prior Google authorization may already have contacted Google."
    );
    expect(functionsSource).toContain('reasonCode: "authorization_expired"');
    expect(functionsSource).toContain("recoverExpiredGoogleCalendarAuthorization");
    expect(functionsSource).toContain("exchangeLeaseExpiresAtISO");
    expect(functionsSource).toContain("mutationLeaseExpiresAtISO: exchangeLeaseExpiresAtISO");
    expect(functionsSource).toContain("GOOGLE_CALENDAR_OAUTH_CALLBACK_TIMEOUT_SECONDS = 60");
    expect(functionsSource).toContain("GOOGLE_CALENDAR_OAUTH_EXCHANGE_LEASE_MS = 75_000");
    expect(functionsSource).toContain("ownsRecoveredUnknownExchange");
    expect(functionsSource).toContain('state: "exchange_outcome_uncertain"');
    expect(functionsSource).toContain('state: "revocation_required"');
    expect(functionsSource).toContain('reasonCode: "unactivated_grant_requires_revocation"');
  });

  test("fences disconnect and requires external-copy cleanup before token revocation", () => {
    const applySource = functionsSource.slice(
      functionsSource.indexOf("exports.applyGoogleCalendarEventCommand"),
      functionsSource.indexOf("exports.disconnectGoogleCalendar")
    );
    const disconnectSource = functionsSource.slice(
      functionsSource.indexOf("exports.disconnectGoogleCalendar"),
      functionsSource.indexOf("exports.getIntegrationSetupStatus")
    );
    expect(applySource).toContain("assertGoogleCalendarTenantEnabled(configuration, settings)");
    expect(applySource).not.toContain("configuration.cleanupConfigured !== true");
    expect(disconnectSource).toContain("configuration.cleanupConfigured !== true");
    expect(disconnectSource).not.toContain("assertGoogleCalendarTenantEnabled(configuration, settings)");
    expect(functionsSource).toContain('mutationLeaseKind: "disconnect"');
    expect(functionsSource).toContain('links.where("providerEventId", ">", "")');
    expect(functionsSource).toContain("Remove or reconcile every retained Google event copy before disconnecting.");
    expect(functionsSource).toContain('? "unactivated_grant_revocation_uncertain"');
    expect(functionsSource).toContain(': "revocation_outcome_uncertain"');
    expect(functionsSource).toContain("connection.tokenRevocationOnly === true");
    expect(functionsSource).toContain("retainedCopiesDisconnectReason");
    expect(functionsSource).toContain("rejected_grant_revoked_external_copies_retained");
    expect(functionsSource).toContain("disabled_grant_revoked_external_copies_retained");
    expect(functionsSource).toContain("configuration.cleanupConfigured !== true");
    expect(functionsSource).toContain('connection.state !== "reconnect_required"');
    expect(functionsSource).toContain("expiredSameDisconnectLease");
  });

  test("does not clear a retained copy merely because a later Calendar connection cannot find it", () => {
    expect(functionsSource).toContain("function googleCalendarExternalCopyProjection(docSnap, connection)");
    expect(functionsSource).toContain("const connectionGeneration = Number.isSafeInteger(connection?.configurationGeneration)");
    expect(functionsSource).toContain("const generationMismatch = connection?.state === \"active\"");
    expect(functionsSource).toContain("state: projectedState");
    expect(functionsSource).toContain("googleCalendarExternalCopyProjection(doc, connection)");
    expect(functionsSource).toContain("const linkConnectionGenerationChanged");
    expect(functionsSource).toContain("if (linkConnectionGenerationChanged)");
    expect(functionsSource).toContain("(!linkConnectionGenerationChanged && ![");
    expect(functionsSource).toContain(
      'resultState = connectionGenerationChanged ? "provider_drift" : "canceled"'
    );
    expect(functionsSource).toContain('reasonCode = connectionGenerationChanged\n            ? "previous_connection_event_unavailable"');
  });

  test("requires retained credentials to be revoked before a new authorization", () => {
    expect(functionsSource).toContain("Disconnect the current Google Calendar authorization before connecting another account.");
    expect(functionsSource).not.toContain("renewRejectedCredential");
    expect(functionsSource).not.toContain("currentCanRenew");
    expect(functionsSource).toContain("acknowledgeUnknownExchange");
  });

  test("records a declined OAuth callback and bounds every provider wait", () => {
    expect(functionsSource).toContain('oauthError === "access_denied"');
    expect(functionsSource).toContain("Google Calendar authorization was not approved.");
    expect(functionsSource).toContain('"authorization_declined"');
    expect(functionsSource).toContain("failureRecorded = true");
    expect(functionsSource.match(/signal: AbortSignal\.timeout\(10_000\)/g)?.length)
      .toBeGreaterThanOrEqual(4);
    expect(calendarSource).toContain("signal: AbortSignal.timeout(10_000)");
  });
});
