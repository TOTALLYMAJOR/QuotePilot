import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  OPERATIONAL_STAFFING_OPERATIONS,
  applyOperationalStaffingPlan,
  buildOperationalStaffingRequestId,
  configureOperationalStaffProfile,
  getOperationalStaffingSnapshot,
  isDefinitiveOperationalStaffingError,
  readPendingOperationalStaffingAttempt,
  resetDefinitiveOperationalStaffingAttempt
} from "../lib/operationalStaffingClient";
import "./operationalStaffingPanel.css";

export const OPERATIONAL_STAFFING_CAPABILITY_ID = "authoritative-operational-staffing";

const ROLES = Object.freeze(["lead", "server", "chef", "bartender"]);
const ROLE_LABELS = Object.freeze({
  lead: "lead",
  server: "server",
  chef: "chef",
  bartender: "bartender"
});
const READ_STATES = new Set(["loading", "empty", "success", "stale", "partial", "error", "recovery"]);
const MUTATION_STATES = new Set(["ready", "submitting", "uncertain", "reconciliation", "receipt", "error", "recovery"]);
const MAX_RETAINED_PANEL_COMMANDS = 20;
const unresolvedPanelCommands = new Map();

function retainUnresolvedPanelCommand(key, command) {
  unresolvedPanelCommands.delete(key);
  unresolvedPanelCommands.set(key, command);
  while (unresolvedPanelCommands.size > MAX_RETAINED_PANEL_COMMANDS) {
    const oldestKey = unresolvedPanelCommands.keys().next().value;
    unresolvedPanelCommands.delete(oldestKey);
  }
}

function text(value, maximum = 500) {
  return String(value ?? "").trim().slice(0, maximum);
}

function quoteIdOf(quote) {
  return text(quote?.id || quote?.quoteId, 256);
}

function roleLabel(role, count = 1) {
  const base = ROLE_LABELS[role] || role;
  return `${base}${count === 1 ? "" : "s"}`;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function localDateTimeValue(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function exactISOFromLocal(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function randomOpaqueId(prefix) {
  const random = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID().replaceAll("-", "")
    : `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.padEnd(32, "0").slice(0, 32);
  return `${prefix}_${random}`;
}

function safeError(error, fallback) {
  const message = text(error?.message, 500);
  return message || fallback;
}

function readStateForEnvelope(envelope) {
  if (envelope?.state === "stale") return "stale";
  if (envelope?.state === "partial") return "partial";
  if (envelope?.state === "empty") return "empty";
  return "success";
}

function CapabilityStateMarker({ state, channel, children }) {
  const common = {
    className: `operational-staffing-state operational-staffing-state--${state}`,
    "data-capability-id": OPERATIONAL_STAFFING_CAPABILITY_ID,
    "data-capability-channel": channel
  };
  switch (state) {
    case "loading": return <div {...common} data-capability-state="loading">{children}</div>;
    case "empty": return <div {...common} data-capability-state="empty">{children}</div>;
    case "success": return <div {...common} data-capability-state="success">{children}</div>;
    case "stale": return <div {...common} data-capability-state="stale">{children}</div>;
    case "partial": return <div {...common} data-capability-state="partial">{children}</div>;
    case "error": return <div {...common} data-capability-state="error">{children}</div>;
    case "recovery": return <div {...common} data-capability-state="recovery">{children}</div>;
    case "ready": return <div {...common} data-capability-state="ready">{children}</div>;
    case "submitting": return <div {...common} data-capability-state="submitting">{children}</div>;
    case "uncertain": return <div {...common} data-capability-state="uncertain">{children}</div>;
    case "reconciliation": return <div {...common} data-capability-state="reconciliation">{children}</div>;
    case "receipt": return <div {...common} data-capability-state="receipt">{children}</div>;
    default: return null;
  }
}

function recordedWindowCoverage(profile, eventWindow) {
  if (!profile?.active || !eventWindow?.startAtISO || !eventWindow?.endAtISO) return "unknown";
  const start = Date.parse(eventWindow.startAtISO);
  const end = Date.parse(eventWindow.endAtISO);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return "unknown";
  const windows = Array.isArray(profile.availabilityWindows) ? profile.availabilityWindows : [];
  if (windows.some((window) => (
    window.state === "unavailable"
    && Date.parse(window.startAtISO) < end
    && start < Date.parse(window.endAtISO)
  ))) return "not_recorded_clear";
  const available = windows
    .filter((window) => window.state === "available")
    .map((window) => ({ start: Date.parse(window.startAtISO), end: Date.parse(window.endAtISO) }))
    .filter((window) => Number.isFinite(window.start) && Number.isFinite(window.end) && window.end > start && window.start < end)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  let coveredUntil = start;
  for (const window of available) {
    if (window.start > coveredUntil) return "not_recorded_clear";
    coveredUntil = Math.max(coveredUntil, window.end);
    if (coveredUntil >= end) return "recorded_cover";
  }
  return "not_recorded_clear";
}

function initialProfileDraft(eventWindow) {
  return {
    staffId: "",
    expectedRevision: 0,
    displayName: "",
    active: true,
    capabilities: ["server"],
    availabilityWindows: eventWindow?.startAtISO && eventWindow?.endAtISO ? [{
      availabilityId: randomOpaqueId("availability"),
      source: "operator_recorded",
      state: "available",
      startAtISO: eventWindow.startAtISO,
      endAtISO: eventWindow.endAtISO
    }] : []
  };
}

function profileDraftFromProjection(profile) {
  return {
    staffId: profile.staffId,
    expectedRevision: profile.revision,
    displayName: profile.displayName,
    active: profile.active,
    capabilities: [...profile.capabilities],
    availabilityWindows: profile.availabilityWindows.map((window) => ({ ...window }))
  };
}

function buildAssignmentSlots(envelope) {
  if (!envelope) return [];
  const currentAssignments = Array.isArray(envelope.snapshot?.assignments)
    ? envelope.snapshot.assignments
    : [];
  const slots = [];
  ROLES.forEach((role) => {
    const required = Number(envelope.canonicalRequirements?.[role]) || 0;
    const recorded = currentAssignments.filter((assignment) => assignment.role === role);
    const count = role === "lead"
      ? Math.max(1, required, recorded.length)
      : Math.max(required, recorded.length);
    for (let index = 0; index < count; index += 1) {
      const assignment = recorded[index];
      slots.push({
        slotId: `${role}-${index + 1}`,
        roleSlotNumber: index + 1,
        assignmentId: assignment?.assignmentId || `staffing-${role}-${index + 1}`,
        staffId: assignment?.staffId || "",
        role,
        required: index < required
      });
    }
  });
  return slots;
}

function selectedAssignments(slots, profiles) {
  const profileById = new Map(profiles.map((profile) => [profile.staffId, profile]));
  return slots.filter((slot) => slot.staffId).map((slot) => {
    const profile = profileById.get(slot.staffId);
    return {
      assignmentId: slot.assignmentId,
      staffId: slot.staffId,
      role: slot.role,
      expectedStaffRevision: profile?.revision || 0,
      state: "operator_confirmed"
    };
  });
}

function relevantFenceInputs(envelope, assignments) {
  const staffIds = new Set(assignments.map((assignment) => assignment.staffId));
  (envelope?.snapshot?.assignments || []).forEach((assignment) => staffIds.add(assignment.staffId));
  return (envelope?.expectedScheduleFences || [])
    .filter((fence) => staffIds.has(fence.staffId))
    .map(({ fenceId, revision }) => ({ fenceId, revision }));
}

function profileWindowsValid(windows) {
  if (!Array.isArray(windows)) return false;
  const normalized = windows.map((window) => ({
    start: Date.parse(window.startAtISO),
    end: Date.parse(window.endAtISO)
  }));
  if (normalized.some((window) => !Number.isFinite(window.start) || !Number.isFinite(window.end) || window.start >= window.end)) {
    return false;
  }
  normalized.sort((left, right) => left.start - right.start || left.end - right.end);
  return normalized.every((window, index) => index === 0 || window.start >= normalized[index - 1].end);
}

function localRequirements(quote) {
  return {
    lead: 0,
    server: Math.max(0, Math.round(Number(quote?.event?.servers) || 0)),
    chef: Math.max(0, Math.round(Number(quote?.event?.chefs) || 0)),
    bartender: Math.max(0, Math.round(Number(quote?.event?.bartenders) || 0))
  };
}

export default function OperationalStaffingPanel({
  open = true,
  organizationId = "",
  quote = null,
  source = "local",
  role = "customer",
  available = false
}) {
  const id = useId().replaceAll(":", "");
  const statusRef = useRef(null);
  const readGenerationRef = useRef(0);
  const mountedRef = useRef(false);
  const quoteId = quoteIdOf(quote);
  const isConnectedStaff = source === "firebase" && available && ["admin", "sales"].includes(role);
  const canConfigureProfiles = isConnectedStaff && role === "admin";
  const canApplyPlan = isConnectedStaff && ["admin", "sales"].includes(role);
  const identity = `${text(organizationId, 256)}\u0000${quoteId}\u0000${source}\u0000${role}\u0000${available}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  // Keep in-flight identities inside the exact authority and presentation scope.
  // This memory-only cache is bounded and intentionally does not survive a reload.
  const pendingCacheKey = identity;
  const [read, setRead] = useState({ state: "loading", envelope: null, error: "" });
  const [slots, setSlots] = useState([]);
  const [profileDraft, setProfileDraft] = useState(null);
  const [mutation, setMutation] = useState({
    state: "ready",
    kind: "",
    command: null,
    receipt: null,
    error: "",
    idempotent: false
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = async ({ recovery = false } = {}) => {
    if (!open || !isConnectedStaff || !organizationId || !quoteId) return;
    const generation = ++readGenerationRef.current;
    const retained = read.envelope?.organizationId === organizationId
      && read.envelope?.quoteId === quoteId
      ? read.envelope
      : null;
    setRead({ state: recovery ? "recovery" : "loading", envelope: retained, error: "" });
    try {
      const envelope = await getOperationalStaffingSnapshot({ organizationId, quoteId });
      if (!mountedRef.current || generation !== readGenerationRef.current) return;
      setRead({ state: readStateForEnvelope(envelope), envelope, error: "" });
      setSlots(buildAssignmentSlots(envelope));
      const retainedCommand = unresolvedPanelCommands.get(pendingCacheKey) || null;
      const pending = retainedCommand || readPendingOperationalStaffingAttempt({
        operation: OPERATIONAL_STAFFING_OPERATIONS.APPLY_PLAN,
        organizationId,
        quoteId
      });
      if (pending) {
        setMutation({
          state: pending.definitive ? "error" : "uncertain",
          kind: pending.kind || "plan",
          command: { requestId: pending.requestId, ...pending.payload },
          receipt: null,
          error: pending.error,
          idempotent: false
        });
      }
    } catch (error) {
      if (!mountedRef.current || generation !== readGenerationRef.current) return;
      setRead({
        state: retained ? "stale" : "error",
        envelope: retained,
        error: safeError(error, "Staffing plan could not be loaded.")
      });
    }
  };

  useEffect(() => {
    readGenerationRef.current += 1;
    setProfileDraft(null);
    setMutation({ state: "ready", kind: "", command: null, receipt: null, error: "", idempotent: false });
    setSlots([]);
    setRead({ state: isConnectedStaff ? "loading" : "partial", envelope: null, error: "" });
    // Identity deliberately includes all authority and scope inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  useEffect(() => {
    if (!open) {
      readGenerationRef.current += 1;
      return;
    }
    if (isConnectedStaff && organizationId && quoteId) void load();
    // Reopening refreshes exact evidence without discarding a same-scope command.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, identity]);

  useEffect(() => {
    if (["uncertain", "error", "recovery", "receipt"].includes(mutation.state)) {
      statusRef.current?.focus();
    }
  }, [mutation.state]);

  const envelope = read.envelope;
  const profiles = envelope?.profiles || [];
  const assignments = useMemo(() => selectedAssignments(slots, profiles), [slots, profiles]);
  const selectedStaffIds = new Set(assignments.map((assignment) => assignment.staffId));
  const currentPlanRevision = envelope?.snapshot?.planRevision || 0;
  const readIsCurrentAndComplete = ["empty", "success"].includes(read.state);
  const busy = ["submitting", "reconciliation"].includes(mutation.state);
  const frozenByUncertainty = mutation.state === "uncertain";
  const missingRequiredSlots = slots.some((slot) => slot.required && !slot.staffId);
  const invalidSelectedProfile = assignments.some((assignment) => {
    const profile = profiles.find((item) => item.staffId === assignment.staffId);
    return !profile
      || !profile.active
      || !profile.capabilities.includes(assignment.role)
      || recordedWindowCoverage(profile, envelope?.canonicalEventWindow) !== "recorded_cover";
  });
  const fenceInputs = relevantFenceInputs(envelope, assignments);
  const selectedOrRemovedStaffIds = new Set([
    ...assignments.map((assignment) => assignment.staffId),
    ...(envelope?.snapshot?.assignments || []).map((assignment) => assignment.staffId)
  ]);
  const staffIdsWithFence = new Set((envelope?.expectedScheduleFences || []).map((fence) => fence.staffId));
  const missingFenceEvidence = [...selectedOrRemovedStaffIds].some((staffId) => !staffIdsWithFence.has(staffId));
  const applyDisabled = !canApplyPlan
    || !readIsCurrentAndComplete
    || busy
    || frozenByUncertainty
    || invalidSelectedProfile
    || missingFenceEvidence;

  const updateSlot = (slotId, staffId) => {
    if (busy || frozenByUncertainty) return;
    setSlots((current) => current.map((slot) => slot.slotId === slotId ? { ...slot, staffId } : slot));
    if (["receipt", "recovery", "error"].includes(mutation.state)) {
      setMutation({ state: "ready", kind: "", command: null, receipt: null, error: "", idempotent: false });
    }
  };

  const buildPlanCommand = () => ({
    requestId: buildOperationalStaffingRequestId(OPERATIONAL_STAFFING_OPERATIONS.APPLY_PLAN),
    organizationId,
    quoteId,
    expectedQuoteRevisionId: envelope.activeQuoteRevisionId,
    expectedPlanRevision: currentPlanRevision,
    eventWindow: envelope.canonicalEventWindow,
    requirements: envelope.canonicalRequirements,
    assignments,
    expectedScheduleFences: fenceInputs
  });

  const runPlanCommand = async (command, { reconciliation = false } = {}) => {
    const requestIdentity = identity;
    setMutation({
      state: reconciliation ? "reconciliation" : "submitting",
      kind: "plan",
      command,
      receipt: null,
      error: "",
      idempotent: false
    });
    try {
      const result = await applyOperationalStaffingPlan(command);
      unresolvedPanelCommands.delete(pendingCacheKey);
      if (!mountedRef.current || identityRef.current !== requestIdentity) return;
      setMutation({
        state: "receipt",
        kind: "plan",
        command,
        receipt: result.receipt,
        error: "",
        idempotent: result.idempotent
      });
      await load({ recovery: true });
    } catch (error) {
      const definitive = isDefinitiveOperationalStaffingError(error);
      retainUnresolvedPanelCommand(pendingCacheKey, {
        kind: "plan",
        requestId: command.requestId,
        payload: Object.fromEntries(Object.entries(command).filter(([key]) => key !== "requestId")),
        error: safeError(error, "QuotePilot could not confirm whether the staffing assignments were saved."),
        definitive
      });
      if (!mountedRef.current || identityRef.current !== requestIdentity) return;
      setMutation({
        state: definitive ? "error" : "uncertain",
        kind: "plan",
        command,
        receipt: null,
        error: safeError(error, "QuotePilot could not confirm whether the staffing assignments were saved."),
        idempotent: false
      });
    }
  };

  const applyPlan = () => {
    if (applyDisabled || !envelope) return;
    void runPlanCommand(buildPlanCommand());
  };

  const reconcile = () => {
    if (mutation.state !== "uncertain" || !mutation.command) return;
    if (mutation.kind === "plan") {
      void runPlanCommand(mutation.command, { reconciliation: true });
      return;
    }
    void runProfileCommand(mutation.command, { reconciliation: true });
  };

  const resetRejected = () => {
    if (mutation.state !== "error" || !mutation.command) return;
    const descriptor = mutation.kind === "profile"
      ? {
          operation: OPERATIONAL_STAFFING_OPERATIONS.CONFIGURE_PROFILE,
          organizationId,
          staffId: mutation.command.staffId,
          requestId: mutation.command.requestId
        }
      : {
          operation: OPERATIONAL_STAFFING_OPERATIONS.APPLY_PLAN,
          organizationId,
          quoteId,
          requestId: mutation.command.requestId
        };
    if (resetDefinitiveOperationalStaffingAttempt(descriptor)) {
      unresolvedPanelCommands.delete(pendingCacheKey);
      setMutation({
        state: "recovery",
        kind: "",
        command: null,
        receipt: null,
        error: "The failed save was cleared. Refresh the staffing plan, then review your changes before trying again.",
        idempotent: false
      });
    }
  };

  const openNewProfile = () => {
    if (!canConfigureProfiles || busy || frozenByUncertainty) return;
    setProfileDraft(initialProfileDraft(envelope?.canonicalEventWindow));
  };

  const editProfile = (profile) => {
    if (!canConfigureProfiles || busy || frozenByUncertainty) return;
    setProfileDraft(profileDraftFromProjection(profile));
  };

  const updateProfileWindow = (index, patch) => {
    setProfileDraft((current) => ({
      ...current,
      availabilityWindows: current.availabilityWindows.map((window, windowIndex) => (
        index === windowIndex ? { ...window, ...patch } : window
      ))
    }));
  };

  const profileCommandFromDraft = () => ({
    requestId: buildOperationalStaffingRequestId(OPERATIONAL_STAFFING_OPERATIONS.CONFIGURE_PROFILE),
    organizationId,
    staffId: profileDraft.staffId || randomOpaqueId("staff"),
    expectedRevision: profileDraft.expectedRevision,
    profile: {
      displayName: text(profileDraft.displayName, 80),
      active: profileDraft.active,
      capabilities: [...profileDraft.capabilities],
      availabilityWindows: profileDraft.availabilityWindows.map((window) => ({ ...window }))
    }
  });

  const runProfileCommand = async (command, { reconciliation = false } = {}) => {
    const requestIdentity = identity;
    setMutation({
      state: reconciliation ? "reconciliation" : "submitting",
      kind: "profile",
      command,
      receipt: null,
      error: "",
      idempotent: false
    });
    try {
      const result = await configureOperationalStaffProfile(command);
      unresolvedPanelCommands.delete(pendingCacheKey);
      if (!mountedRef.current || identityRef.current !== requestIdentity) return;
      setProfileDraft(null);
      setMutation({
        state: "receipt",
        kind: "profile",
        command,
        receipt: result.receipt,
        error: "",
        idempotent: result.idempotent
      });
      await load({ recovery: true });
    } catch (error) {
      const definitive = isDefinitiveOperationalStaffingError(error);
      retainUnresolvedPanelCommand(pendingCacheKey, {
        kind: "profile",
        requestId: command.requestId,
        payload: Object.fromEntries(Object.entries(command).filter(([key]) => key !== "requestId")),
        error: safeError(error, "QuotePilot could not confirm whether the team member was saved."),
        definitive
      });
      if (!mountedRef.current || identityRef.current !== requestIdentity) return;
      setMutation({
        state: definitive ? "error" : "uncertain",
        kind: "profile",
        command,
        receipt: null,
        error: safeError(error, "QuotePilot could not confirm whether the team member was saved."),
        idempotent: false
      });
    }
  };

  const submitProfile = (event) => {
    event.preventDefault();
    if (!profileDraft || !profileDraft.displayName.trim() || !profileDraft.capabilities.length) return;
    if (!profileWindowsValid(profileDraft.availabilityWindows)) return;
    void runProfileCommand(profileCommandFromDraft());
  };

  if (!open) return null;

  if (!isConnectedStaff) {
    const local = localRequirements(quote);
    return (
      <section
        className="operational-staffing-panel operational-staffing-panel--boundary"
        aria-labelledby={`${id}-title`}
        data-authority="local_draft"
      >
        <CapabilityStateMarker state="partial" channel="read">
          <p className="operational-staffing-eyebrow">Staffing plan</p>
          <h3 id={`${id}-title`}>Staffing assignments are unavailable here</h3>
          <p>
            This view can show quoted staffing only. It cannot confirm team availability,
            recorded assignments, scheduling conflicts, coverage, or a save receipt.
          </p>
          <dl className="operational-staffing-requirements" aria-label="Quoted staffing">
            {ROLES.filter((item) => item !== "lead").map((item) => (
              <div key={item}>
                <dt>{roleLabel(item, local[item])}</dt>
                <dd>{local[item]}</dd>
              </div>
            ))}
          </dl>
          <p className="operational-staffing-boundary-note">
            {source !== "firebase"
              ? "Reconnect to this organization's workspace before saving staffing assignments."
              : !available
                ? "This capability is not enabled in the current workspace."
                : "This role cannot access staffing details."}
          </p>
        </CapabilityStateMarker>
      </section>
    );
  }

  if (!organizationId || !quoteId) {
    return (
      <section className="operational-staffing-panel operational-staffing-panel--boundary" aria-labelledby={`${id}-title`}>
        <CapabilityStateMarker state="error" channel="read">
          <p className="operational-staffing-eyebrow">Staffing plan</p>
          <h3 id={`${id}-title`}>Choose an organization and opportunity to view staffing</h3>
          <p>An organization and opportunity are required before staffing details can be viewed or changed.</p>
        </CapabilityStateMarker>
      </section>
    );
  }

  const readCopy = {
    loading: ["Loading staffing plan", "No assignment or availability is assumed until this organization's staffing details load."],
    recovery: ["Refreshing staffing plan", "Existing details remain unconfirmed until the refresh finishes."],
    empty: ["No staffing assignments yet", "The quoted staffing is current. No assignments have been saved for this event."],
    success: ["Staffing plan is up to date", "These assignments were recorded for this quote revision and event time."],
    stale: ["Staffing plan needs a refresh", "These assignments belong to another quote revision, or the refresh failed. Refresh before relying on them or saving changes."],
    partial: ["Some staffing details are unavailable", "Team or scheduling details are incomplete, so staffing assignments cannot be saved yet."],
    error: ["Staffing plan unavailable", "QuotePilot could not confirm assignments, availability, coverage, or a save receipt."]
  }[READ_STATES.has(read.state) ? read.state : "error"];

  return (
    <section
      className="operational-staffing-panel"
      aria-labelledby={`${id}-title`}
      data-authority="server_authoritative"
    >
      <header className="operational-staffing-header">
        <div>
          <p className="operational-staffing-eyebrow">Staffing plan</p>
          <h3 id={`${id}-title`}>Who is covering this event?</h3>
        </div>
        <span className="operational-staffing-authority-chip">For this organization</span>
      </header>

      <CapabilityStateMarker state={read.state} channel="read">
        <div className="operational-staffing-state-copy" role={read.state === "error" ? "alert" : "status"} aria-live="polite">
          <strong>{readCopy[0]}</strong>
          <span>{read.error || readCopy[1]}</span>
        </div>
        {["stale", "partial", "error"].includes(read.state) ? (
          <button type="button" className="operational-staffing-secondary" onClick={() => void load({ recovery: true })}>
            Refresh staffing plan
          </button>
        ) : null}
      </CapabilityStateMarker>

      {envelope ? (
        <>
          <section className="operational-staffing-section" aria-labelledby={`${id}-requirements`}>
            <div className="operational-staffing-section-heading">
              <div>
                <p className="operational-staffing-eyebrow">Quoted staffing</p>
                <h4 id={`${id}-requirements`}>Roles included in this quote</h4>
              </div>
              <span>Saved quote version {envelope.activeQuoteRevisionId}</span>
            </div>
            <dl className="operational-staffing-requirements">
              {ROLES.map((item) => (
                <div key={item}>
                  <dt>{roleLabel(item, envelope.canonicalRequirements[item])}</dt>
                  <dd>{envelope.canonicalRequirements[item]}</dd>
                </div>
              ))}
            </dl>
            <p className="operational-staffing-boundary-note">
              Event time: {formatDateTime(envelope.canonicalEventWindow.startAtISO)}–{formatDateTime(envelope.canonicalEventWindow.endAtISO)}.
              These counts come from the saved quote and cannot be changed here.
            </p>
          </section>

          <section className="operational-staffing-section" aria-labelledby={`${id}-coverage`}>
            <div className="operational-staffing-section-heading">
              <div>
                <p className="operational-staffing-eyebrow">Still needed</p>
                <h4 id={`${id}-coverage`}>Assigned team and open roles</h4>
              </div>
              <span>{envelope.snapshot ? `Staffing plan version ${envelope.snapshot.planRevision}` : "No plan"}</span>
            </div>
            <div className="operational-staffing-coverage-grid">
              {ROLES.map((item) => {
                const confirmed = (envelope.snapshot?.assignments || []).filter((assignment) => assignment.role === item).length;
                const quoted = envelope.canonicalRequirements[item];
                return (
                  <div key={item} data-gap={Math.max(0, quoted - confirmed) > 0 ? "open" : "clear"}>
                    <strong>{roleLabel(item, quoted)}</strong>
                    <span>{confirmed} assigned of {quoted} quoted</span>
                    <small>{Math.max(0, quoted - confirmed)} still needed</small>
                  </div>
                );
              })}
            </div>
            <p className="operational-staffing-boundary-note">
              An assignment here means an authorized QuotePilot user recorded it. It does not confirm that the team member acknowledged it,
              will attend, is qualified, is paid, or that the event is ready.
            </p>
          </section>

          <section className="operational-staffing-section" aria-labelledby={`${id}-assignments`}>
            <div className="operational-staffing-section-heading">
              <div>
                <p className="operational-staffing-eyebrow">Staffing assignments</p>
                <h4 id={`${id}-assignments`}>Choose a person for each role</h4>
              </div>
            </div>
            {slots.length ? (
              <div className="operational-staffing-slots">
                {slots.map((slot, index) => (
                  <label key={slot.slotId} className="operational-staffing-slot">
                    <span>{slot.required ? `${roleLabel(slot.role)} ${slot.roleSlotNumber}` : "Optional event lead"}</span>
                    <select
                      aria-label={`${slot.required ? "Required" : "Optional"} ${roleLabel(slot.role)} assignment`}
                      value={slot.staffId}
                      disabled={!readIsCurrentAndComplete || busy || frozenByUncertainty}
                      onChange={(event) => updateSlot(slot.slotId, event.target.value)}
                    >
                      <option value="">{slot.required ? "Choose a team member" : "No lead assigned"}</option>
                      {profiles.filter((profile) => profile.active && profile.capabilities.includes(slot.role)).map((profile) => {
                        const coverage = recordedWindowCoverage(profile, envelope.canonicalEventWindow);
                        const chosenElsewhere = selectedStaffIds.has(profile.staffId) && profile.staffId !== slot.staffId;
                        return (
                          <option
                            key={profile.staffId}
                            value={profile.staffId}
                            disabled={chosenElsewhere || coverage !== "recorded_cover"}
                          >
                            {profile.displayName} · {coverage === "recorded_cover" ? "available for this event" : "not available for the full event"}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                ))}
              </div>
            ) : (
              <p className="operational-staffing-boundary-note">This quote has no required roles. You can still assign an optional event lead.</p>
            )}
            {missingRequiredSlots ? <p className="operational-staffing-warning">Roles left unfilled will stay visible under Still needed after you save.</p> : null}
            {invalidSelectedProfile ? <p className="operational-staffing-warning">Each selection needs an active profile, the right role, and recorded availability for the full event.</p> : null}
            {missingFenceEvidence ? <p className="operational-staffing-warning">Scheduling conflict information is incomplete for one or more affected team members. Refresh before saving.</p> : null}
            <button
              type="button"
              className="operational-staffing-primary"
              disabled={applyDisabled}
              onClick={applyPlan}
            >
              Save staffing assignments
            </button>
          </section>

          <section className="operational-staffing-section" aria-labelledby={`${id}-profiles`}>
            <div className="operational-staffing-section-heading">
              <div>
                <p className="operational-staffing-eyebrow">Team roster</p>
                <h4 id={`${id}-profiles`}>People and recorded availability</h4>
              </div>
              {canConfigureProfiles ? (
                <button type="button" className="operational-staffing-secondary" onClick={openNewProfile} disabled={busy || frozenByUncertainty}>
                  Add team member
                </button>
              ) : null}
            </div>
            {profiles.length ? (
              <ul className="operational-staffing-profiles">
                {profiles.map((profile) => {
                  const coverage = recordedWindowCoverage(profile, envelope.canonicalEventWindow);
                  return (
                    <li key={profile.staffId}>
                      <div>
                        <strong>{profile.displayName}</strong>
                        <span>{profile.active ? profile.capabilities.map((item) => roleLabel(item)).join(" · ") : "Inactive"}</span>
                        <small>
                          {coverage === "recorded_cover"
                            ? "Recorded availability covers this event."
                            : "Recorded availability does not cover this entire event."}
                          {" "}This does not mean the team member acknowledged the assignment.
                        </small>
                      </div>
                      {canConfigureProfiles ? (
                        <button type="button" className="operational-staffing-tertiary" onClick={() => editProfile(profile)} disabled={busy || frozenByUncertainty}>
                          Edit profile
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="operational-staffing-boundary-note">
                No team members were returned for this organization. {canConfigureProfiles ? "Add the first team member to begin assigning roles." : "An administrator must add team members before assignments can be saved."}
              </p>
            )}
          </section>

          {profileDraft && canConfigureProfiles ? (
            <form className="operational-staffing-profile-form" onSubmit={submitProfile} aria-labelledby={`${id}-profile-form`}>
              <div className="operational-staffing-section-heading">
                <div>
                  <p className="operational-staffing-eyebrow">Team roster</p>
                  <h4 id={`${id}-profile-form`}>{profileDraft.staffId ? "Edit team member" : "Add team member"}</h4>
                </div>
                <button type="button" className="operational-staffing-tertiary" onClick={() => setProfileDraft(null)}>Cancel</button>
              </div>
              <label>
                <span>Display name</span>
                <input
                  aria-label="Display name"
                  required
                  maxLength={80}
                  autoComplete="off"
                  value={profileDraft.displayName}
                  onChange={(event) => setProfileDraft((current) => ({ ...current, displayName: event.target.value }))}
                />
              </label>
              <fieldset>
                <legend>Roles this person can fill</legend>
                <div className="operational-staffing-capabilities">
                  {ROLES.map((item) => (
                    <label key={item}>
                      <input
                        type="checkbox"
                        checked={profileDraft.capabilities.includes(item)}
                        onChange={(event) => setProfileDraft((current) => ({
                          ...current,
                          capabilities: event.target.checked
                            ? [...new Set([...current.capabilities, item])]
                            : current.capabilities.filter((capability) => capability !== item)
                        }))}
                      />
                      <span>{roleLabel(item)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>Recorded availability</legend>
                <p className="operational-staffing-boundary-note">An authorized QuotePilot user entered these windows; they do not mean the team member acknowledged the assignment.</p>
                <div className="operational-staffing-windows">
                  {profileDraft.availabilityWindows.map((window, index) => (
                    <div key={window.availabilityId} className="operational-staffing-window">
                      <label>
                        <span>State</span>
                        <select value={window.state} onChange={(event) => updateProfileWindow(index, { state: event.target.value })}>
                          <option value="available">Available</option>
                          <option value="unavailable">Unavailable</option>
                        </select>
                      </label>
                      <label>
                        <span>Starts</span>
                        <input
                          type="datetime-local"
                          required
                          value={localDateTimeValue(window.startAtISO)}
                          onChange={(event) => updateProfileWindow(index, { startAtISO: exactISOFromLocal(event.target.value) })}
                        />
                      </label>
                      <label>
                        <span>Ends</span>
                        <input
                          type="datetime-local"
                          required
                          value={localDateTimeValue(window.endAtISO)}
                          onChange={(event) => updateProfileWindow(index, { endAtISO: exactISOFromLocal(event.target.value) })}
                        />
                      </label>
                      <button
                        type="button"
                        className="operational-staffing-tertiary"
                        onClick={() => setProfileDraft((current) => ({
                          ...current,
                          availabilityWindows: current.availabilityWindows.filter((_, windowIndex) => windowIndex !== index)
                        }))}
                      >
                        Remove window
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="operational-staffing-secondary"
                  onClick={() => setProfileDraft((current) => ({
                    ...current,
                    availabilityWindows: [...current.availabilityWindows, {
                      availabilityId: randomOpaqueId("availability"),
                      source: "operator_recorded",
                      state: "available",
                      startAtISO: "",
                      endAtISO: ""
                    }]
                  }))}
                >
                  Add availability window
                </button>
                {!profileWindowsValid(profileDraft.availabilityWindows) ? (
                  <p className="operational-staffing-warning">
                    Every availability window needs a valid start and end, and windows may not overlap.
                  </p>
                ) : null}
              </fieldset>
              <label className="operational-staffing-active-toggle">
                <input
                  type="checkbox"
                  checked={profileDraft.active}
                  onChange={(event) => setProfileDraft((current) => ({ ...current, active: event.target.checked }))}
                />
                <span>Profile is active for assignment</span>
              </label>
              <button
                type="submit"
                className="operational-staffing-primary"
                disabled={busy
                  || frozenByUncertainty
                  || !profileDraft.displayName.trim()
                  || !profileDraft.capabilities.length
                  || !profileWindowsValid(profileDraft.availabilityWindows)}
              >
                Save team member
              </button>
            </form>
          ) : null}

          <CapabilityStateMarker state={MUTATION_STATES.has(mutation.state) ? mutation.state : "ready"} channel="mutation">
            <div ref={statusRef} tabIndex={-1} className="operational-staffing-mutation" aria-live="polite">
              <strong>{({
                ready: "Staffing assignments are ready to review",
                submitting: "Saving staffing changes",
                uncertain: "We could not confirm whether the save finished",
                reconciliation: "Checking the previous save",
                receipt: "Staffing changes saved",
                error: "Staffing changes were not saved",
                recovery: "Ready to review and try again"
              })[mutation.state]}</strong>
              <span>
                {mutation.error || ({
                  ready: "Your selections are not saved yet. Choose Save staffing assignments when you are ready.",
                  submitting: "Controls stay locked while QuotePilot confirms this exact save.",
                  uncertain: "Check the previous save before making another change, so QuotePilot does not create a duplicate.",
                  reconciliation: "QuotePilot is checking the same save, not starting another one.",
                  receipt: "Save confirmed. This records the changes but does not mean team members acknowledged or will attend.",
                  error: "Nothing successful is assumed. Review the message before clearing this failed save.",
                  recovery: "Refresh the staffing plan or make a deliberate change before saving again."
                })[mutation.state]}
              </span>
              {mutation.receipt ? (
                <details>
                  <summary>Save reference</summary>
                  <code>
                    Receipt {mutation.receipt.receiptId} · request {mutation.receipt.requestId}
                    {mutation.idempotent ? " · matched the previous save" : ""}
                  </code>
                </details>
              ) : null}
              {mutation.state === "uncertain" ? (
                <button type="button" className="operational-staffing-primary" onClick={reconcile}>
                  Check previous save
                </button>
              ) : null}
              {mutation.state === "error" ? (
                <button type="button" className="operational-staffing-secondary" onClick={resetRejected}>
                  Try again
                </button>
              ) : null}
            </div>
          </CapabilityStateMarker>
        </>
      ) : null}
    </section>
  );
}
