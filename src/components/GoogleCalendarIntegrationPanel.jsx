import { useEffect, useLayoutEffect, useRef, useState } from "react";
import StatusChip from "./StatusChip";
import {
  applyGoogleCalendarEventCommand,
  clearResolvedGoogleCalendarMutation,
  createGoogleCalendarRequestId,
  disconnectGoogleCalendar,
  getGoogleCalendarStatus,
  isDefinitiveGoogleCalendarError,
  readPendingGoogleCalendarMutation,
  resetDefinitiveGoogleCalendarMutation,
  startGoogleCalendarConnection
} from "../lib/googleCalendarClient";

const LOCKED_MUTATION_STATES = new Set(["submitting", "uncertain", "reconciliation"]);
const UNRESOLVED_SYNC_STATES = new Set([
  "queued", "dispatching", "outcome_uncertain", "cancel_queued"
]);

const CHIP = Object.freeze({
  loading: Object.freeze({ family: "pending", label: "Checking status" }),
  unconfigured: Object.freeze({ family: "info", label: "Not connected" }),
  current: Object.freeze({ family: "confirmed", label: "Up to date" }),
  update_required: Object.freeze({ family: "action", label: "Update needed" }),
  provider_drift: Object.freeze({ family: "blocked", label: "Review Google copy" }),
  reconnect_required: Object.freeze({ family: "blocked", label: "Reconnect needed" }),
  uncertain: Object.freeze({ family: "blocked", label: "Outcome unknown" }),
  error: Object.freeze({ family: "failed", label: "Status unavailable" })
});

function exactMode(value) {
  return value === "event" ? "event" : "connection";
}

function externalCleanupIncomplete(status) {
  return Boolean(status?.externalCopiesTruncated || status?.externalCopies?.length);
}

function authorizationExpired(status) {
  const expiresAt = Date.parse(status?.connection?.authorizationExpiresAtISO || "");
  return status?.connection?.state === "authorizing"
    && Number.isFinite(expiresAt)
    && expiresAt <= Date.now();
}

function publicState(status, mode, sourceVersionId) {
  if (!status) return "loading";
  if (!status.configuration.enabled || !status.configuration.configured) return "unconfigured";
  if (status.connection.state !== "active") {
    return ["unconfigured", "disabled"].includes(status.connection.state)
      ? "unconfigured"
      : "reconnect_required";
  }
  if (mode === "connection") {
    return externalCleanupIncomplete(status) ? "update_required" : "current";
  }
  const sync = status.sync;
  if (!sync || sync.activeSourceVersionId !== sourceVersionId) return "provider_drift";
  if (UNRESOLVED_SYNC_STATES.has(sync.state)) return "uncertain";
  if (sync.state === "synced") return "current";
  if (sync.state === "update_required") return "update_required";
  if (sync.state === "provider_drift") return "provider_drift";
  if (sync.state === "blocked_connection") return "reconnect_required";
  return "unconfigured";
}

export function resolveGoogleCalendarPanelState({
  mode = "connection",
  status = null,
  sourceVersionId = "",
  mutationState = "ready",
  readState = "ready"
} = {}) {
  if (readState === "loading" || readState === "recovery") return "loading";
  if (readState === "error") return "error";
  if (mutationState === "uncertain" || mutationState === "reconciliation") return "uncertain";
  return publicState(status, exactMode(mode), sourceVersionId);
}

function formatRecordedAt(value) {
  if (!value) return "No verified update time recorded";
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  } catch {
    return "Verified update time unavailable";
  }
}

function connectionCopy(status) {
  if (!status.configuration.enabled && status.configuration.cleanupAvailable) {
    return "Google Calendar publishing is disabled, but stored Google access remains. Revoke that access now; existing Google event copies will remain listed as external records.";
  }
  if (!status.configuration.enabled || !status.configuration.configured) {
    return "Google Calendar is not configured for this QuotePilot environment. QuotePilot events remain unchanged.";
  }
  const label = status.connection.calendarLabel || "the selected Google calendar";
  if (["revocation_outcome_uncertain", "unactivated_grant_revocation_uncertain"]
    .includes(status.connection.reasonCode)) {
    return "Google did not confirm whether authorization was revoked. New Calendar updates are blocked; retry disconnect before reconnecting.";
  }
  if (status.connection.reasonCode === "unactivated_grant_requires_revocation") {
    return "The prior authorization reached Google but did not pass owned-calendar verification. Revoke this unactivated access before reconnecting.";
  }
  if (status.connection.reasonCode === "authorization_exchange_outcome_uncertain") {
    return status.connection.canDisconnect
      ? "Google's authorization exchange result is unknown. Review QuotePilot access in the Google account, then disconnect the retained access before reconnecting."
      : "Google's authorization exchange result is unknown. Review QuotePilot access in the Google account before starting another connection attempt.";
  }
  if (status.connection.reasonCode === "provider_credentials_rejected") {
    return "Google rejected the stored Calendar access. Disconnect the retained authorization, then reconnect deliberately.";
  }
  if (status.connection.state === "active" && externalCleanupIncomplete(status)) {
    return `Connected to ${label}. Remove the retained Google event copies before disconnecting this connection.`;
  }
  if (authorizationExpired(status)) {
    return "The prior Google authorization window expired. Recover that exact attempt before starting or replacing any provider work.";
  }
  return {
    active: `Connected to ${label}. Events are added only when an operator chooses to publish an exact event.`,
    authorizing: "Google authorization is waiting to be completed. Connecting alone does not add an event.",
    reconnect_required: "Google Calendar access needs renewal. QuotePilot events remain unchanged, and updates will not publish until access is renewed.",
    revoked: "Google Calendar access was revoked. QuotePilot events remain unchanged.",
    disabled: "Google Calendar is disabled. QuotePilot events remain unchanged.",
    unconfigured: "Google Calendar is not connected. Connecting alone does not add an event."
  }[status.connection.state];
}

function eventCopy(status, sourceVersionId) {
  if (!status.configuration.enabled || !status.configuration.configured) {
    return "Google Calendar is not available yet. This event remains only in QuotePilot.";
  }
  if (status.connection.state !== "active") {
    return "Google Calendar must be reconnected before this event can be published. The QuotePilot event is unchanged.";
  }
  const sync = status.sync;
  if (!sync || sync.activeSourceVersionId !== sourceVersionId) {
    return "This Calendar status does not match the selected saved event revision. Refresh before publishing anything.";
  }
  return {
    not_synced: "Not on Google Calendar. Publishing sends only the event name, time, location, quote reference, and no-attendee update setting.",
    queued: "The original Google Calendar update is queued. Do not publish it again; check that exact operation.",
    dispatching: "The original Google Calendar update is in progress. Do not publish it again; check that exact operation.",
    outcome_uncertain: "The original Google Calendar result is unknown. Do not add or update it again; check that exact operation.",
    synced: "Up to date on Google Calendar for this exact saved event revision. This does not establish event readiness.",
    update_required: "QuotePilot changed after the last verified Calendar update. Google still has the older event revision.",
    cancel_queued: "Removal of the Google Calendar copy is still unresolved. Do not repeat it; check that exact operation.",
    canceled: "No QuotePilot-owned Google Calendar copy is currently recorded for this event.",
    provider_drift: "The Google event changed outside QuotePilot. QuotePilot did not overwrite it.",
    blocked_connection: "The Google Calendar connection is unavailable. This event remains unchanged in QuotePilot.",
    definite_failure: "Google Calendar definitively rejected the last request. The QuotePilot event is unchanged."
  }[sync.state] || "Google Calendar status needs review before this event can be published.";
}

function outcomeCopy(mutation, mode) {
  if (mutation.message) return mutation.message;
  if (mutation.state === "submitting") {
    return mode === "connection"
      ? "Waiting for the exact Google Calendar connection response."
      : "Sending this exact saved event revision to Google Calendar. Do not repeat the action.";
  }
  if (mutation.state === "reconciliation") {
    return "Checking the original Google Calendar operation. This does not create a second event update.";
  }
  return "";
}

function mutationMessageForStatus(command, status) {
  if (command === "sync") {
    if (status.sync?.state === "synced") {
      return "Google Calendar accepted and verified this exact saved event revision.";
    }
    return "The event request was recorded. Its provider outcome still needs review.";
  }
  if (command === "cancel") {
    return status.sync?.state === "canceled"
      ? "Google Calendar confirms that its QuotePilot-owned copy is no longer present. The QuotePilot event was not canceled."
      : "The removal request was recorded. Its provider outcome still needs review.";
  }
  if (status.sync?.state === "provider_drift") {
    return "The original operation was checked. The Google event still differs, and QuotePilot did not overwrite it.";
  }
  if (status.sync?.state === "synced") {
    return "The original operation was checked and this exact saved event revision is now verified on Google Calendar.";
  }
  if (status.sync?.state === "canceled") {
    return "The original removal was checked. No QuotePilot-owned Google Calendar copy is recorded.";
  }
  return "The original Calendar operation was checked. Review the current status before taking another action.";
}

export default function GoogleCalendarIntegrationPanel(props) {
  const identity = JSON.stringify([
    exactMode(props.mode),
    props.organizationId,
    props.quoteId,
    props.sourceVersionId,
    props.role,
    props.source,
    props.enabled,
    props.eventStatus
  ]);
  return <GoogleCalendarPanel key={identity} {...props} mode={exactMode(props.mode)} />;
}

function GoogleCalendarPanel({
  mode,
  organizationId,
  quoteId = "",
  sourceVersionId = "",
  source = "firebase",
  enabled = true,
  role = "admin",
  eventStatus = "booked",
  onOpenIntegrations,
  onChanged,
  openAuthorization = (url) => window.open(url, "_blank", "noopener,noreferrer")
}) {
  const isEvent = mode === "event";
  const eligible = enabled === true
    && source === "firebase"
    && Boolean(organizationId)
    && (isEvent
      ? Boolean(quoteId && sourceVersionId)
        && ["accepted", "booked"].includes(String(eventStatus).toLowerCase())
        && ["admin", "sales"].includes(role)
      : role === "admin");
  const scope = isEvent ? { organizationId, quoteId } : { organizationId };
  const [initialPending] = useState(() => eligible
    ? readPendingGoogleCalendarMutation(scope)
    : null);
  const [read, setRead] = useState({ state: "loading", status: null, error: "" });
  const [mutation, setMutation] = useState(() => initialPending
    ? {
        state: initialPending.definitive ? "error" : "uncertain",
        command: initialPending.operation || initialPending.request?.command || "",
        message: "The original Google Calendar request still needs review.",
        authorizationUrl: ""
      }
    : { state: "ready", command: "", message: "", authorizationUrl: "" });
  const mounted = useRef(true);
  const sequence = useRef(0);
  const inFlight = useRef(false);
  const outcomeRef = useRef(null);
  const priorMutationState = useRef("ready");

  const busy = ["submitting", "reconciliation", "recovery"].includes(mutation.state);
  const locked = LOCKED_MUTATION_STATES.has(mutation.state);
  const status = read.status;
  const sourceMismatch = isEvent && status?.sync
    && status.sync.activeSourceVersionId !== sourceVersionId;
  const readSurfaceState = read.state === "ready"
    ? sourceMismatch ? "partial" : "success"
    : read.state === "partial" && status
      ? "stale"
      : read.state;
  const panelState = resolveGoogleCalendarPanelState({
    mode,
    status,
    sourceVersionId,
    mutationState: mutation.state,
    readState: read.state
  });

  useLayoutEffect(() => {
    if (priorMutationState.current !== mutation.state
      && ["receipt", "error", "uncertain", "recovery"].includes(mutation.state)) {
      outcomeRef.current?.focus();
    }
    priorMutationState.current = mutation.state;
  }, [mutation.state]);

  async function refresh({ recovery = false } = {}) {
    if (!eligible || inFlight.current) return null;
    const token = ++sequence.current;
    if (recovery) {
      setMutation((current) => ({
        ...current,
        state: "recovery",
        message: "Refreshing server-owned Google Calendar status."
      }));
    }
    setRead((current) => ({ ...current, state: recovery ? "recovery" : "loading", error: "" }));
    try {
      const result = await getGoogleCalendarStatus(scope);
      if (!mounted.current || token !== sequence.current) return null;
      setRead({
        state: result.status.configuration.enabled ? "ready" : "empty",
        status: result.status,
        error: ""
      });
      if (recovery) {
        setMutation({ state: "ready", command: "", message: "", authorizationUrl: "" });
      }
      return result.status;
    } catch (error) {
      if (!mounted.current || token !== sequence.current) return null;
      setRead((current) => ({
        ...current,
        state: current.status ? "partial" : "error",
        error: error.message
      }));
      if (recovery) {
        setMutation({
          state: "error",
          command: "",
          message: error.message,
          authorizationUrl: ""
        });
      }
      return null;
    }
  }

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      sequence.current += 1;
    };
  }, []);

  function applyStatus(nextStatus) {
    setRead({
      state: nextStatus.configuration.enabled ? "ready" : "empty",
      status: nextStatus,
      error: ""
    });
  }

  function notifyChanged(result) {
    try {
      onChanged?.(result);
    } catch {
      // Presentation callbacks cannot invalidate a verified server response.
    }
  }

  async function runConnection(command) {
    if (!status || inFlight.current || locked) return;
    const revocationOnlyRecovery = [
      "provider_credentials_rejected",
      "revocation_outcome_uncertain",
      "unactivated_grant_requires_revocation",
      "unactivated_grant_revocation_uncertain"
    ].includes(status.connection.reasonCode);
    const disabledCleanup = !status.configuration.enabled
      && status.configuration.cleanupAvailable;
    if (command === "disconnect"
      && ((externalCleanupIncomplete(status) && !revocationOnlyRecovery && !disabledCleanup)
        || status.connection.canDisconnect !== true)) {
      setMutation({
        state: "error",
        command,
        message: externalCleanupIncomplete(status)
          ? "Remove every retained Google event copy and refresh the bounded list before disconnecting."
          : "No current Google authorization is available to disconnect.",
        authorizationUrl: ""
      });
      return;
    }
    inFlight.current = true;
    setMutation({ state: "submitting", command, message: "", authorizationUrl: "" });
    try {
      if (command === "disconnect") {
        const result = await disconnectGoogleCalendar({
          organizationId,
          requestId: createGoogleCalendarRequestId(),
          expectedConnectionRevision: status.connection.connectionRevision
        });
        if (!mounted.current) return;
        applyStatus(result.status);
        setMutation({
          state: "receipt",
          command,
          message: result.status.connection.reasonCode
            === "unactivated_grant_revoked_external_copies_retained"
            ? "The unverified replacement grant was revoked. Prior Google event copies remain listed for recovery after a valid reconnection."
            : result.status.connection.reasonCode
              === "rejected_grant_revoked_external_copies_retained"
              ? "The rejected Google authorization was revoked. Prior event copies remain listed for recovery after reconnecting."
              : result.status.connection.reasonCode
                === "disabled_grant_revoked_external_copies_retained"
                ? "Stored Google access was revoked while Calendar publishing remains disabled. Prior event copies remain listed as external records."
              : "Google Calendar authorization is revoked. Future event updates are stopped.",
          authorizationUrl: ""
        });
        notifyChanged(result);
        return;
      }
      const result = await startGoogleCalendarConnection({
        organizationId,
        requestId: createGoogleCalendarRequestId(),
        expectedConnectionRevision: status.connection.connectionRevision,
        ...(status.connection.reasonCode === "authorization_exchange_outcome_uncertain"
          ? { acknowledgeUnknownExchange: true }
          : {})
      });
      if (!mounted.current) return;
      if (result.recovered) {
        applyStatus(result.status);
        setMutation({
          state: "receipt",
          command,
          message: result.status.connection.state === "active"
            ? "The previously verified Google authorization is now connected. No event was added."
            : result.status.connection.reasonCode === "unactivated_grant_requires_revocation"
              ? "The prior unverified grant was recovered safely. Revoke it before reconnecting; older Google event copies remain unchanged."
              : "The prior authorization exchange is still unknown. Review Google access before starting another connection.",
          authorizationUrl: ""
        });
        notifyChanged(result);
        return;
      }
      let opened = false;
      try {
        opened = openAuthorization(result.authorizationUrl) !== null;
      } catch {
        opened = false;
      }
      setMutation({
        state: opened ? "receipt" : "recovery",
        command,
        message: opened
          ? "Google authorization opened in a new tab. No event was added. Return here and check the connection after approving access."
          : "The Google authorization page did not open. Continue with the verified Google link; no event has been added.",
        authorizationUrl: opened ? "" : result.authorizationUrl
      });
      notifyChanged(result);
    } catch (error) {
      if (!mounted.current) return;
      if (error?.status) applyStatus(error.status);
      setMutation({
        state: isDefinitiveGoogleCalendarError(error) ? "error" : "uncertain",
        command,
        message: error.message,
        authorizationUrl: ""
      });
    } finally {
      inFlight.current = false;
    }
  }

  async function runEvent(command, currentStatus = status) {
    if (!currentStatus?.sync || inFlight.current
      || (locked && command !== "reconcile") || sourceMismatch) return;
    const sync = currentStatus.sync;
    const request = {
      organizationId,
      quoteId,
      requestId: createGoogleCalendarRequestId(),
      expectedSyncRevision: sync.syncRevision,
      expectedConnectionGeneration: currentStatus.connection.configurationGeneration,
      command
    };
    if (command === "sync") request.expectedSourceVersionId = sourceVersionId;
    if (command === "cancel") request.expectedBoundSourceVersionId = sync.sourceVersionId;
    if (command === "reconcile") request.expectedOperationId = sync.operationId;
    inFlight.current = true;
    setMutation({
      state: command === "reconcile" ? "reconciliation" : "submitting",
      command,
      message: "",
      authorizationUrl: ""
    });
    try {
      const result = await applyGoogleCalendarEventCommand(request);
      if (!mounted.current) return;
      applyStatus(result.status);
      const unresolved = UNRESOLVED_SYNC_STATES.has(result.status.sync?.state);
      setMutation({
        state: unresolved
          ? result.status.sync.state === "outcome_uncertain" ? "uncertain" : "submitting"
          : "receipt",
        command,
        message: mutationMessageForStatus(command, result.status),
        authorizationUrl: ""
      });
      notifyChanged(result);
    } catch (error) {
      if (!mounted.current) return;
      if (error?.status) applyStatus(error.status);
      setMutation({
        state: isDefinitiveGoogleCalendarError(error) ? "error" : "uncertain",
        command,
        message: error.message,
        authorizationUrl: ""
      });
    } finally {
      inFlight.current = false;
    }
  }

  async function runRetainedCopy(copy) {
    if (isEvent || role !== "admin" || !status || inFlight.current || locked) return;
    const requiresExactReconciliation = copy.recoveryAction === "reconcile_exact_operation";
    if (requiresExactReconciliation && !copy.operationId) return;
    const command = requiresExactReconciliation ? "reconcile" : "cancel";
    const request = {
      organizationId,
      quoteId: copy.quoteId,
      requestId: createGoogleCalendarRequestId(),
      expectedSyncRevision: copy.syncRevision,
      expectedConnectionGeneration: status.connection.configurationGeneration,
      command,
      ...(command === "reconcile"
        ? { expectedOperationId: copy.operationId }
        : { expectedBoundSourceVersionId: copy.sourceVersionId })
    };
    inFlight.current = true;
    setMutation({
      state: command === "reconcile" ? "reconciliation" : "submitting",
      command,
      message: "",
      authorizationUrl: ""
    });
    try {
      const result = await applyGoogleCalendarEventCommand(request);
      if (!mounted.current) return;
      const refreshed = await getGoogleCalendarStatus({ organizationId });
      if (!mounted.current) return;
      applyStatus(refreshed.status);
      setMutation({
        state: "receipt",
        command,
        message: result.status.sync?.state === "canceled"
          ? "Google confirms that the selected external copy is absent. The QuotePilot event was not canceled."
          : "The selected external copy was checked. Review its current state before another action.",
        authorizationUrl: ""
      });
      notifyChanged(result);
    } catch (error) {
      if (!mounted.current) return;
      if (error?.status) applyStatus(error.status);
      setMutation({
        state: isDefinitiveGoogleCalendarError(error) ? "error" : "uncertain",
        command,
        message: error.message,
        authorizationUrl: ""
      });
    } finally {
      inFlight.current = false;
    }
  }

  async function recoverDefinitive() {
    resetDefinitiveGoogleCalendarMutation(scope);
    await refresh({ recovery: true });
  }

  async function retryOriginalDisconnect() {
    const pending = readPendingGoogleCalendarMutation(scope);
    if (isEvent || pending?.operation !== "disconnect" || inFlight.current) {
      await refresh({ recovery: true });
      return;
    }
    inFlight.current = true;
    setMutation({
      state: "reconciliation",
      command: "disconnect",
      message: "Retrying the exact original disconnect request. No new request identity was created.",
      authorizationUrl: ""
    });
    try {
      const result = await disconnectGoogleCalendar(pending.request);
      if (!mounted.current) return;
      applyStatus(result.status);
      setMutation({
        state: "receipt",
        command: "disconnect",
        message: result.status.connection.reasonCode
          === "unactivated_grant_revoked_external_copies_retained"
          ? "The unverified replacement grant was revoked. Prior Google event copies remain listed for recovery after a valid reconnection."
          : result.status.connection.reasonCode
            === "rejected_grant_revoked_external_copies_retained"
            ? "The rejected Google authorization was revoked. Prior event copies remain listed for recovery after reconnecting."
            : result.status.connection.reasonCode
              === "disabled_grant_revoked_external_copies_retained"
              ? "Stored Google access was revoked while Calendar publishing remains disabled. Prior event copies remain listed as external records."
            : "Google Calendar authorization is revoked. Future event updates are stopped.",
        authorizationUrl: ""
      });
      notifyChanged(result);
    } catch (error) {
      if (!mounted.current) return;
      if (error?.status) applyStatus(error.status);
      setMutation({
        state: isDefinitiveGoogleCalendarError(error) ? "error" : "uncertain",
        command: "disconnect",
        message: error.message,
        authorizationUrl: ""
      });
    } finally {
      inFlight.current = false;
    }
  }

  async function reconcileOriginal() {
    if (!isEvent) {
      const pending = readPendingGoogleCalendarMutation(scope);
      const nextStatus = await refresh({ recovery: true });
      if (!pending || !nextStatus) return;
      const revisionAdvanced = nextStatus.connection.connectionRevision
        > pending.request.expectedConnectionRevision;
      const expectedStateReached = pending.operation === "connect"
        ? ["authorizing", "active"].includes(nextStatus.connection.state)
        : pending.operation === "disconnect"
          ? nextStatus.connection.state !== "active"
          : false;
      if (revisionAdvanced && expectedStateReached) {
        clearResolvedGoogleCalendarMutation(scope);
        setMutation({
          state: "receipt",
          command: pending.operation,
          message: pending.operation === "connect"
            ? "The original connection request is recorded. Complete Google authorization if it is still waiting."
            : "The original disconnect request is recorded. Future Google Calendar updates are stopped.",
          authorizationUrl: ""
        });
      } else {
        setMutation({
          state: "uncertain",
          command: pending.operation || "",
          message: "The original connection request is still unresolved. Do not submit another one.",
          authorizationUrl: ""
        });
      }
      return;
    }
    let currentStatus = status;
    if (!currentStatus?.sync?.operationId) {
      setMutation({
        state: "reconciliation",
        command: mutation.command,
        message: "",
        authorizationUrl: ""
      });
      currentStatus = await refresh();
    }
    if (currentStatus?.sync?.operationId) {
      clearResolvedGoogleCalendarMutation(scope);
      await runEvent("reconcile", currentStatus);
      return;
    }
    setMutation({
      state: "uncertain",
      command: mutation.command,
      message: "The original event update is still unresolved. Do not publish it again.",
      authorizationUrl: ""
    });
  }

  if (!eligible) {
    return <section
      className="admin-section"
      aria-label="Google Calendar"
      data-capability-id="google-calendar-integration"
      data-capability-mode={mode}
      data-capability-channel="read"
      data-capability-state="recovery"
    >
      <h3>Google Calendar</h3>
      <p className="source-note">
        {isEvent
          ? "Google Calendar requires a connected workspace, an exact accepted or booked event revision, and authorized staff access."
          : "Only an administrator in a connected workspace can manage Google Calendar access."}
      </p>
    </section>;
  }

  let action = null;
  if (read.state === "loading") {
    action = { label: "Checking Calendar status…", disabled: true };
  } else if (read.state === "error" || read.state === "partial" || sourceMismatch) {
    action = { label: "Refresh Calendar status", run: () => refresh({ recovery: true }) };
  } else if (mutation.state === "uncertain") {
    action = !isEvent && mutation.command === "disconnect"
      ? { label: "Retry original disconnect", run: retryOriginalDisconnect }
      : { label: "Check original Calendar action", run: reconcileOriginal };
  } else if (mutation.state === "error") {
    action = { label: "Review current Calendar status", run: recoverDefinitive };
  } else if (mutation.authorizationUrl) {
    action = { label: "Continue to Google", href: mutation.authorizationUrl };
  } else if (busy) {
    action = { label: mutation.state === "reconciliation" ? "Checking original action…" : "Calendar action in progress…", disabled: true };
  } else if (!isEvent && status) {
    action = mutation.state === "receipt" && mutation.command === "connect"
      ? { label: "Check Google connection", run: () => refresh({ recovery: true }) }
      : !status.configuration.enabled && status.configuration.cleanupAvailable
        ? { label: "Revoke stored Google access", run: () => runConnection("disconnect") }
      : status.connection.reasonCode === "authorization_exchange_outcome_uncertain"
      ? status.connection.canDisconnect
        ? { label: "Disconnect stored Google access", run: () => runConnection("disconnect") }
        : { label: "I reviewed Google access — retry connection", run: () => runConnection("connect") }
      : ["revocation_outcome_uncertain", "unactivated_grant_revocation_uncertain"]
        .includes(status.connection.reasonCode)
        && status.connection.canDisconnect
        ? { label: "Retry Google disconnect", run: () => runConnection("disconnect") }
      : status.connection.reasonCode === "unactivated_grant_requires_revocation"
        && status.connection.canDisconnect
        ? { label: "Revoke unverified Google access", run: () => runConnection("disconnect") }
      : status.connection.reasonCode === "provider_credentials_rejected"
        && status.connection.canDisconnect
        ? { label: "Disconnect rejected Google access", run: () => runConnection("disconnect") }
      : status.connection.state === "active"
        ? externalCleanupIncomplete(status)
          ? { label: "Refresh retained copies", run: () => refresh({ recovery: true }) }
          : status.connection.canDisconnect
            ? { label: "Disconnect Google Calendar", run: () => runConnection("disconnect") }
            : { label: "Refresh Calendar status", run: () => refresh({ recovery: true }) }
      : status.connection.state === "authorizing"
        ? authorizationExpired(status)
          ? { label: "Recover expired Google authorization", run: () => runConnection("connect") }
          : { label: "Check Google connection", run: () => refresh({ recovery: true }) }
        : status.configuration.enabled && status.configuration.configured
          ? { label: status.connection.state === "reconnect_required" ? "Reconnect Google Calendar" : "Connect Google Calendar", run: () => runConnection("connect") }
          : { label: "Check Calendar setup", run: () => refresh({ recovery: true }) };
  } else if (isEvent && status) {
    const sync = status.sync;
    if (role !== "admin") {
      action = null;
    } else if (status.connection.state !== "active") {
      action = onOpenIntegrations
        ? { label: "Open Integrations", run: onOpenIntegrations }
        : { label: "Refresh Calendar status", run: () => refresh({ recovery: true }) };
    } else if (UNRESOLVED_SYNC_STATES.has(sync.state) || sync.state === "provider_drift") {
      action = sync.operationId
        ? { label: sync.state === "provider_drift" ? "Recheck changed Google copy" : "Check original Calendar action", run: () => runEvent("reconcile") }
        : { label: "Refresh Calendar status", run: () => refresh({ recovery: true }) };
    } else if (sync.state === "synced") {
      action = { label: "Remove Google Calendar copy", run: () => runEvent("cancel") };
    } else if (sync.state === "update_required") {
      action = { label: "Update Google Calendar", run: () => runEvent("sync") };
    } else {
      action = { label: sync.state === "definite_failure" ? "Try Calendar update again" : "Add to Google Calendar", run: () => runEvent("sync") };
    }
  }

  const visibleCopy = status
    ? isEvent ? eventCopy(status, sourceVersionId) : connectionCopy(status)
    : "Checking server-owned Google Calendar status.";
  const outcome = outcomeCopy(mutation, mode);
  const chip = panelState === "update_required" && !isEvent
    ? { family: "action", label: "Cleanup required" }
    : CHIP[panelState] || CHIP.error;

  return <section
    className="admin-section"
    aria-labelledby={`google-calendar-${mode}-title`}
    aria-busy={busy}
    data-capability-id="google-calendar-integration"
    data-capability-mode={mode}
    data-google-calendar-state={panelState}
    style={{ minWidth: 0, overflowWrap: "anywhere" }}
  >
    <div
      className="admin-section-head"
      data-layout-audit-group={`google-calendar-${mode}-heading`}
      style={{ alignItems: "start", gap: "0.75rem", flexWrap: "wrap" }}
    >
      <div style={{ flex: "1 1 15rem", minWidth: 0 }}>
        <p className="eyebrow">{isEvent ? "Event calendar copy" : "Admin-only connection"}</p>
        <h3 id={`google-calendar-${mode}-title`}>Google Calendar</h3>
      </div>
      <StatusChip {...chip} />
    </div>

    <div
      data-capability-id="google-calendar-integration"
      data-capability-channel="read"
      data-capability-state={readSurfaceState}
    >
      <p role="status">{visibleCopy}</p>
      {read.error && <p role="alert" className="error-note">{read.error}</p>}
      {isEvent && role !== "admin" && status && <p className="source-note">
        You can review this Calendar state. An administrator must publish, update, reconcile, or remove the external copy.
      </p>}
    </div>

    <div
      data-capability-id="google-calendar-integration"
      data-capability-channel="mutation"
      data-capability-state={mutation.state}
    >
      {outcome && <p
        ref={outcomeRef}
        tabIndex={-1}
        role={mutation.state === "error" ? "alert" : "status"}
        className={mutation.state === "error" || mutation.state === "uncertain" ? "warning-note" : "source-note"}
        data-layout-audit-surface="workspace-feedback"
      >{outcome}</p>}
    </div>

    {action && <div
      data-layout-audit-group={`google-calendar-${mode}-action`}
      style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}
    >
      {action.href
        ? <a
            className="ghost button-link"
            href={action.href}
            target="_blank"
            rel="noopener noreferrer"
            data-capability-action="continue-google-calendar-authorization"
            style={{ minHeight: 44, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "1 1 14rem" }}
          >{action.label}</a>
        : <button
            type="button"
            className={isEvent && ["not_synced", "canceled", "update_required", "definite_failure"].includes(status?.sync?.state) ? "cta" : "ghost"}
            disabled={action.disabled === true}
            onClick={() => action.run?.()}
            data-capability-action={
              action.label.startsWith("Add") ? "publish-google-calendar-event"
                : action.label.startsWith("Update") ? "publish-google-calendar-event"
                  : action.label.startsWith("Remove") ? "remove-google-calendar-copy"
                    : action.label.startsWith("Connect") || action.label.startsWith("Reconnect") ? "connect-google-calendar"
                      : action.label.startsWith("Recover expired") ? "connect-google-calendar"
                      : action.label.startsWith("I reviewed Google access") ? "connect-google-calendar"
                      : action.label.startsWith("Disconnect") || action.label.startsWith("Revoke stored") ? "disconnect-google-calendar"
                        : action.label.startsWith("Retry original disconnect") ? "retry-google-calendar-disconnect"
                          : action.label.startsWith("Retry Google disconnect") ? "retry-google-calendar-disconnect"
                        : action.label.startsWith("Open") ? "open-google-calendar-integrations"
                          : action.label.startsWith("Check original") || action.label.startsWith("Recheck") ? "reconcile-google-calendar-event"
                            : "refresh-google-calendar-status"
            }
            style={{ minHeight: 44, flex: "1 1 14rem" }}
          >{action.label}</button>}
    </div>}

    {isEvent && status?.sync?.providerEventUrl && <p style={{ marginTop: "0.75rem" }}>
      <a
        href={status.sync.providerEventUrl}
        target="_blank"
        rel="noopener noreferrer"
        data-capability-action="open-google-calendar-copy"
      >Open verified Google Calendar copy</a>
    </p>}

    {!isEvent && externalCleanupIncomplete(status) && <details
      className="staff-evidence-disclosure"
      style={{ marginTop: "0.75rem" }}
      open={status.externalCopies.some((copy) => [
        "queued", "dispatching", "outcome_uncertain", "cancel_queued", "provider_drift"
      ].includes(copy.state))}
    >
      <summary>Existing Google event copies ({status.externalCopies.length}{status.externalCopiesTruncated ? "+" : ""})</summary>
      <p className="source-note">
        Disconnect remains blocked until every retained copy is removed and a complete refresh reports none. Each removal changes only the Google copy, never the QuotePilot event.
      </p>
      {status.externalCopiesTruncated && <p className="warning-note" role="status">
        QuotePilot shows at most 50 copies in one read. Additional copies may remain outside this list; remove the visible copies, then refresh for the next bounded set.
      </p>}
      <div style={{ display: "grid", gap: "0.75rem" }}>
        {status.externalCopies.map((copy) => {
          const unresolved = copy.recoveryAction === "reconcile_exact_operation";
          const actionUnavailable = unresolved && !copy.operationId;
          return <div
            key={copy.quoteId}
            className="status-strip"
            style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem" }}
          >
            <span style={{ flex: "1 1 14rem", minWidth: 0 }}>
              <strong>{copy.label}</strong><br />
              <small>{copy.state.replaceAll("_", " ")}</small>
            </span>
            <div style={{ display: "flex", flex: "1 1 14rem", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
            {copy.providerEventUrl && <a
              href={copy.providerEventUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-capability-action="open-google-calendar-copy"
            >Review in Google Calendar</a>}
            <button
              type="button"
              className="ghost"
              onClick={() => runRetainedCopy(copy)}
              disabled={busy || locked || actionUnavailable}
              style={{ minHeight: 44 }}
              data-capability-action={unresolved
                ? "reconcile-google-calendar-event"
                : "remove-google-calendar-copy"}
            >{actionUnavailable
              ? "Exact check unavailable"
              : copy.state === "provider_drift"
              ? "Recheck changed Google copy"
              : unresolved ? "Check original action" : "Remove Google copy"}</button>
            </div>
          </div>;
        })}
      </div>
    </details>}

    <details className="staff-evidence-disclosure" style={{ marginTop: "0.75rem" }}>
      <summary>What Google Calendar receives</summary>
      <p className="source-note">
        QuotePilot sends only the saved event name, start and end time, venue, quote reference,
        and a private QuotePilot ownership marker. It sends no attendees, customer or staff contact
        details, menu, dietary information, pricing, payments, operational notes, BEO, or checklist.
      </p>
      {isEvent && status?.sync?.lastVerifiedAtISO && <p className="source-note">
        Last verified: {formatRecordedAt(status.sync.lastVerifiedAtISO)}.
      </p>}
      <p className="source-note">
        Google Calendar is a one-way operational copy. Changes there do not update the quote,
        staffing, inventory, BEO, checklist, customer agreement, price, or payment state.
      </p>
      {!isEvent && status?.connection.state === "active" && <p className="source-note">
        QuotePilot does not bulk-remove Google events. It lists at most 50 retained copies per read and blocks disconnect until a complete read reports none. Removing copies is deliberate and one event at a time.
      </p>}
      {!isEvent && ["revocation_outcome_uncertain", "unactivated_grant_revocation_uncertain"]
        .includes(status?.connection.reasonCode) && <p className="source-note">
        An uncertain revocation blocks new updates but does not prove that Google removed access. This browser reuses the retained disconnect identity when available; otherwise the server fences a new retry against the current uncertain state.
      </p>}
      {!isEvent && status?.connection.reasonCode === "authorization_exchange_outcome_uncertain" && <p className="source-note">
        <a href="https://myaccount.google.com/connections" target="_blank" rel="noopener noreferrer">
          Review third-party access in your Google account
        </a>, then use the acknowledgement action above. QuotePilot cannot determine whether Google issued the prior grant.
      </p>}
    </details>
  </section>;
}
