import { useEffect, useMemo, useRef, useState } from "react";
import AdaptiveChoiceField from "./AdaptiveChoiceField";
import EventRunOfShowPanel from "./EventRunOfShowPanel";
import FieldStateIndicator from "./FieldStateIndicator";
import StatusChip from "./StatusChip";
import {
  buildKitchenCheckpoints,
  buildProductionChecklist,
  formatCheckpointTime,
  formatMinutesToTimeInput,
  parseTimeToMinutes
} from "../lib/quoteWorkflow";
import {
  getQuoteHistory,
  updateQuoteBookingAssignment,
  updateQuoteKitchenCheckpoints,
  updateQuoteProductionChecklist
} from "../lib/quoteStore";
import {
  classifyBookingConfirmation,
  classifyQuoteStatus
} from "../lib/statusSemantics";
import { useModalDialog } from "../hooks/useModalDialog";
import {
  formatWorkspaceInteger,
  formatWorkspaceMoney,
  formatWorkspaceSource,
  formatWorkspaceText,
  hasWorkspaceNumber
} from "../lib/workspacePresentation";
import { buildEventRunOfShowReadModel } from "../lib/eventRunOfShow";
import "./scheduleMotion.css";

export const EVENT_SCHEDULE_QUOTE_LIMIT = 500;

const STATUS_SET = new Set(["accepted", "booked"]);
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const EMPTY_DAY_CONFLICT = { total: 0, overlap: 0, unknown: 0, capacity: 0 };

function toIsoDate(value) {
  const dt = value instanceof Date ? new Date(value) : new Date(`${String(value || "").trim()}T12:00:00`);
  if (Number.isNaN(dt.getTime())) return "";
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseIsoDate(value) {
  const dt = new Date(`${String(value || "").trim()}T12:00:00`);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function addDays(date, amount) {
  const dt = new Date(date);
  dt.setDate(dt.getDate() + amount);
  return dt;
}

function addMonths(date, amount) {
  const dt = new Date(date);
  dt.setMonth(dt.getMonth() + amount);
  return dt;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 12, 0, 0, 0);
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 12, 0, 0, 0);
}

function startOfWeek(date) {
  return addDays(date, -date.getDay());
}

function endOfWeek(date) {
  return addDays(startOfWeek(date), 6);
}

function sameMonth(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export function formatScheduleDayLabel(isoDate) {
  const dt = parseIsoDate(isoDate);
  if (!dt) return "-";
  return dt.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" });
}

export function getScheduleSourceLabel({ loading = false, source = "" } = {}) {
  return loading && !source ? "Loading tenant records" : formatWorkspaceSource(source);
}

function scheduleEventDetailId(value) {
  const id = String(value || "").trim().replace(/[^A-Za-z0-9_-]+/g, "-");
  return `schedule-event-detail-${id || "event"}`;
}

function monthRangeLabel(anchorDate) {
  return anchorDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function weekRangeLabel(anchorDate) {
  const start = startOfWeek(anchorDate);
  const end = endOfWeek(anchorDate);
  const startLabel = start.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const endLabel = end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `${startLabel} - ${endLabel}`;
}

function countByStatus(events) {
  return events.reduce(
    (acc, item) => {
      if (item.status === "booked") acc.booked += 1;
      if (item.status === "accepted") acc.accepted += 1;
      return acc;
    },
    { booked: 0, accepted: 0 }
  );
}

function normalizeVenueKey(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toTimeWindow(time, hours) {
  const start = parseTimeToMinutes(time);
  const durationMin = Math.round(toNumber(hours, 0) * 60);
  if (start === null || durationMin <= 0) return null;
  return {
    start,
    end: start + durationMin
  };
}

function windowsOverlap(a, b) {
  if (!a || !b) return false;
  return a.start < b.end && b.start < a.end;
}

function normalizeStaffLeads(input) {
  const source = Array.isArray(input) ? input : [];
  const seen = new Set();
  const leads = source
    .map((item) => String(item || "").trim())
    .filter((item) => Boolean(item) && !seen.has(item))
    .map((item) => {
      seen.add(item);
      return item;
    });
  return leads;
}

export function StaffLeadChoiceField({ staffLeads, value, disabled, onChange, onRecover }) {
  const current = String(value || "").trim();
  const currentIsAvailable = staffLeads.includes(current);
  const options = [
    ...(!currentIsAvailable && current ? [{ value: current, label: `${current} · saved lead no longer available`, disabled: true }] : []),
    ...staffLeads.map((lead) => ({ value: lead, label: lead }))
  ];

  if (!staffLeads.length && !current) {
    return (
      <AdaptiveChoiceField
        className="schedule-assignment-field"
        label="Staff lead"
        options={[]}
        emptyState="unavailable"
        emptyReason="No current staff leads are available for assignment."
        recoveryAction={{ label: "Refresh schedule", onClick: onRecover }}
      />
    );
  }
  if (!staffLeads.length) {
    return (
      <div className="schedule-assignment-field" data-adaptive-choice-mode="stale">
        <span className="adaptive-choice-field__label">Staff lead</span>
        <strong className="adaptive-choice-field__single-value">{current}</strong>
        <FieldStateIndicator
          state={disabled ? { editability: "protected" } : { evidence: "stale" }}
          label="Staff lead state"
          reason={disabled ? "Staff assignment is temporarily locked." : "This saved lead is no longer in the current team choices."}
          supportingDetail="The saved lead remains visible until an operator resolves it."
          recoveryAction={disabled ? undefined : { label: "Clear unavailable lead", onClick: () => onChange("") }}
        />
      </div>
    );
  }
  if (staffLeads.length === 1 && !current) {
    return (
      <div className="schedule-assignment-field" data-adaptive-choice-mode="suggested">
        <span className="adaptive-choice-field__label">Staff lead</span>
        <strong className="adaptive-choice-field__single-value">{staffLeads[0]}</strong>
        <FieldStateIndicator
          state={disabled ? { editability: "protected" } : { origin: "suggested" }}
          label="Staff lead state"
          provenance={disabled ? "" : "The only current staff lead choice"}
          supportingDetail={disabled ? "Staff assignment is temporarily locked." : "Confirm this lead before changing the saved assignment."}
          recoveryAction={disabled ? undefined : { label: `Assign ${staffLeads[0]}`, onClick: () => onChange(staffLeads[0]) }}
        />
      </div>
    );
  }
  const stale = Boolean(current && !currentIsAvailable);
  return (
    <div className="schedule-assignment-choice">
      <AdaptiveChoiceField
        className="schedule-assignment-field"
        label="Staff lead"
        options={options}
        value={current}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        placeholder="Choose a staff lead"
        singleChoiceDetail="This is the only current lead and the saved assignment."
        fieldState={stale ? (disabled ? { editability: "protected" } : { evidence: "stale" }) : undefined}
        fieldStateDetails={stale ? {
          reason: disabled ? "Staff assignment is temporarily locked." : "This saved lead is no longer in the current team choices.",
          supportingDetail: "The saved lead remains visible until an operator resolves it.",
          recoveryAction: disabled ? undefined : { label: "Clear unavailable lead", onClick: () => onChange("") }
        } : {}}
      />
      {current && currentIsAvailable && !disabled ? <button type="button" className="ghost compact" onClick={() => onChange("")}>Clear lead</button> : null}
    </div>
  );
}

function addReason(reasonMap, quoteId, reason) {
  const next = reasonMap.get(quoteId) || new Set();
  next.add(reason);
  reasonMap.set(quoteId, next);
}

function summarizeDayConflicts(events, reasonMap) {
  const next = new Map();
  events.forEach((item) => {
    const reasons = reasonMap.get(item.id);
    if (!reasons || reasons.size === 0) return;
    const day = String(item.date || "").trim();
    if (!day) return;
    const summary = next.get(day) || { total: 0, overlap: 0, unknown: 0, capacity: 0 };
    summary.total += 1;
    if (reasons.has("time_overlap")) summary.overlap += 1;
    if (reasons.has("time_unknown")) summary.unknown += 1;
    if (reasons.has("capacity")) summary.capacity += 1;
    next.set(day, summary);
  });
  return next;
}

function buildConflictInsights(events, capacityLimit) {
  const grouped = new Map();
  const reasonsById = new Map();
  const maxCapacity = Math.max(1, toNumber(capacityLimit, 400));

  events.forEach((item) => {
    const date = String(item.date || "").trim();
    if (!date) return;
    const venueKey = normalizeVenueKey(item.venue) || "__no_venue__";
    const key = `${date}::${venueKey}`;
    const bucket = grouped.get(key) || [];
    bucket.push(item);
    grouped.set(key, bucket);
  });

  grouped.forEach((group) => {
    const windows = new Map(
      group.map((item) => [item.id, toTimeWindow(item.time, item.hours)])
    );
    const hasUnknownWindow = group.some((item) => !windows.get(item.id));

    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const a = group[i];
        const b = group[j];
        const windowA = windows.get(a.id);
        const windowB = windows.get(b.id);
        if (windowA && windowB) {
          if (windowsOverlap(windowA, windowB)) {
            addReason(reasonsById, a.id, "time_overlap");
            addReason(reasonsById, b.id, "time_overlap");
          }
        } else {
          addReason(reasonsById, a.id, "time_unknown");
          addReason(reasonsById, b.id, "time_unknown");
        }
      }
    }

    if (hasUnknownWindow) {
      const totalLoad = group.reduce((sum, item) => sum + Math.max(0, toNumber(item.guests, 0)), 0);
      if (totalLoad > maxCapacity) {
        group.forEach((item) => addReason(reasonsById, item.id, "capacity"));
      }
      return;
    }

    group.forEach((item, idx) => {
      const itemWindow = windows.get(item.id);
      if (!itemWindow) return;
      let concurrentLoad = Math.max(0, toNumber(item.guests, 0));
      group.forEach((other, otherIdx) => {
        if (idx === otherIdx) return;
        const otherWindow = windows.get(other.id);
        if (windowsOverlap(itemWindow, otherWindow)) {
          concurrentLoad += Math.max(0, toNumber(other.guests, 0));
        }
      });
      if (concurrentLoad > maxCapacity) {
        addReason(reasonsById, item.id, "capacity");
      }
    });
  });

  return {
    reasonsById,
    dayConflicts: summarizeDayConflicts(events, reasonsById),
    maxCapacity
  };
}

// Drop physics: one-shot settle-bounce + tone-tinted lane glow after a staff
// assignment persists. Backstop timeout (animationend clears earlier).
const DROP_FEEDBACK_CLEAR_MS = 900;

function prefersReducedMotion() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

// Pure tone classification for drop feedback: reuses the blast-radius color
// language — success (green family) when the conflict checker is clear,
// danger (red family) when it flags a clash.
export function getScheduleDropTone(conflictReasons = []) {
  const reasons = Array.isArray(conflictReasons) ? conflictReasons.filter(Boolean) : [];
  return reasons.length > 0 ? "negative" : "positive";
}

function reasonLabel(reason) {
  if (reason === "capacity") return "Capacity risk";
  if (reason === "time_overlap") return "Time overlap";
  if (reason === "time_unknown") return "Unknown time overlap";
  return "Conflict";
}

function shortDateTimeLabel(iso) {
  const dt = new Date(iso || "");
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function confirmationLabel(event) {
  const status = String(event.confirmationStatus || "pending");
  if (status === "confirmed") {
    const stamp = shortDateTimeLabel(event.confirmedAtISO || event.confirmationSentAtISO);
    return stamp ? `Confirmed ${stamp}` : "Confirmed";
  }
  if (status === "sent") {
    const stamp = shortDateTimeLabel(event.confirmationSentAtISO);
    return stamp ? `Confirmation sent ${stamp}` : "Confirmation sent";
  }
  if (status === "cancelled") return "Confirmation cancelled";
  return "Confirmation pending";
}

export function getScheduleStatusPresentation(event = {}) {
  return {
    quote: classifyQuoteStatus(event.status),
    bookingConfirmation: classifyBookingConfirmation(event.confirmationStatus)
  };
}

export function getScheduleCalendarCountLabels(counts = {}) {
  const booked = Math.max(0, Number(counts.booked) || 0);
  const accepted = Math.max(0, Number(counts.accepted) || 0);
  return {
    booked: booked > 0 ? `${booked} booked` : "",
    accepted: accepted > 0 ? `${accepted} accepted` : ""
  };
}

export function buildScheduledEvents(quotes = []) {
  return (Array.isArray(quotes) ? quotes : [])
    .filter((quote) => STATUS_SET.has(String(quote?.status || "")))
    .map((quote) => ({
      id: quote.id,
      quoteNumber: String(quote.quoteNumber || "").trim(),
      status: String(quote.status || ""),
      date: String(quote.event?.date || ""),
      time: String(quote.event?.time || ""),
      hours: Number(quote.event?.hours || 0),
      eventName: String(quote.event?.name || "").trim(),
      venue: String(quote.event?.venue || "").trim(),
      dietaryRestrictions: String(quote.event?.dietaryRestrictions || "").trim(),
      customer: String(quote.customer?.name || quote.customer?.email || "").trim(),
      guests: quote.event?.guests ?? null,
      total: quote.totals?.total ?? null,
      staffLead: String(quote.booking?.staffLead || "").trim(),
      kitchenCheckpointOverrides: Array.isArray(quote.booking?.kitchenCheckpoints)
        ? quote.booking.kitchenCheckpoints
        : [],
      productionChecklist: buildProductionChecklist(quote),
      contractNumber: String(quote.booking?.contractNumber || "").trim(),
      confirmationStatus: String(quote.booking?.confirmationStatus || "pending").trim(),
      confirmationSentAtISO: String(quote.booking?.confirmationSentAtISO || ""),
      confirmedAtISO: String(quote.booking?.confirmedAtISO || "")
    }))
    .filter((item) => parseIsoDate(item.date))
    .sort((a, b) => {
      const dateCmp = a.date.localeCompare(b.date);
      if (dateCmp !== 0) return dateCmp;
      const timeCmp = String(a.time || "").localeCompare(String(b.time || ""));
      if (timeCmp !== 0) return timeCmp;
      return String(a.quoteNumber || "").localeCompare(String(b.quoteNumber || ""));
    });
}

export function ScheduleEventFacts({ item = {} }) {
  const guestsRecorded = hasWorkspaceNumber(item.guests);
  return (
    <>
      <p>{formatWorkspaceText(item.eventName, { emptyLabel: "Untitled event" })}</p>
      <p>
        {formatWorkspaceText(item.time, { emptyLabel: "Time not set" })}
        {" • "}{formatWorkspaceText(item.venue, { emptyLabel: "Venue not set" })}
      </p>
      <p>
        {formatWorkspaceText(item.customer, { emptyLabel: "Customer not recorded" })}
        {" • "}{formatWorkspaceInteger(item.guests, { emptyLabel: "Guest count not set" })}
        {guestsRecorded ? " guests" : ""}
      </p>
      <p>Dietary restrictions: {formatWorkspaceText(item.dietaryRestrictions, { emptyLabel: "None recorded" })}</p>
      <p>Total: {formatWorkspaceMoney(item.total)}</p>
      <p>Contract: {formatWorkspaceText(item.contractNumber, { emptyLabel: "Pending conversion" })}</p>
    </>
  );
}

export function EventScheduleView({
  open,
  onClose,
  presentation = "embedded",
  organizationId = "",
  staffLeads = [],
  capacityLimit = 400,
  currentUserEmail = "",
  returnFocusRef = null
}) {
  const embedded = presentation === "embedded";
  const todayIso = toIsoDate(new Date());
  const routeHeadingRef = useRef(null);
  const loadGenerationRef = useRef(0);
  const [state, setState] = useState({
    loading: true,
    error: "",
    source: "",
    quotes: [],
    truncated: false,
    organizationId: ""
  });
  const [viewMode, setViewMode] = useState("month");
  const [anchorIso, setAnchorIso] = useState(todayIso);
  const [selectedIso, setSelectedIso] = useState(todayIso);
  const [feedback, setFeedback] = useState("");
  const [assigningId, setAssigningId] = useState("");
  const [savingCheckpointId, setSavingCheckpointId] = useState("");
  const [savingChecklistId, setSavingChecklistId] = useState("");
  const [dropLaneKey, setDropLaneKey] = useState("");
  const [dropFeedback, setDropFeedback] = useState(null);
  const dropRunRef = useRef(0);

  const load = async () => {
    const readOrganizationId = String(organizationId || "").trim();
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    setState((prev) => (
      prev.organizationId === readOrganizationId
        ? { ...prev, loading: true, error: "" }
        : {
          loading: true,
          error: "",
          source: "",
          quotes: [],
          truncated: false,
          organizationId: readOrganizationId
        }
    ));
    try {
      const result = await getQuoteHistory({
        organizationId: readOrganizationId,
        limitCount: EVENT_SCHEDULE_QUOTE_LIMIT
      });
      if (loadGenerationRef.current !== generation) return;
      setState({
        loading: false,
        error: "",
        source: result.source,
        quotes: result.quotes,
        truncated: result.truncated === true,
        organizationId: readOrganizationId
      });
    } catch (err) {
      if (loadGenerationRef.current !== generation) return;
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err?.message || "Failed to load schedule data."
      }));
    }
  };

  useEffect(() => {
    if (!open) return;
    setFeedback("");
    setDropLaneKey("");
    setDropFeedback(null);
    load();
    return () => {
      loadGenerationRef.current += 1;
    };
  }, [open, organizationId]);

  // Backstop clear so the one-shot drop-settle / lane-glow classes always
  // come off and a repeat drop can re-fire them.
  useEffect(() => {
    if (!dropFeedback || typeof window === "undefined") return undefined;
    const timer = window.setTimeout(() => {
      setDropFeedback((prev) => (prev && prev.runId === dropFeedback.runId ? null : prev));
    }, DROP_FEEDBACK_CLEAR_MS);
    return () => window.clearTimeout(timer);
  }, [dropFeedback]);

  const anchorDate = parseIsoDate(anchorIso) || parseIsoDate(todayIso) || new Date();

  const scheduledEvents = useMemo(
    () => buildScheduledEvents(state.quotes),
    [state.quotes]
  );

  const eventsByDate = useMemo(() => {
    const next = new Map();
    scheduledEvents.forEach((item) => {
      const bucket = next.get(item.date) || [];
      bucket.push(item);
      next.set(item.date, bucket);
    });
    return next;
  }, [scheduledEvents]);

  const { reasonsById, dayConflicts, maxCapacity } = useMemo(
    () => buildConflictInsights(scheduledEvents, capacityLimit),
    [scheduledEvents, capacityLimit]
  );

  const selectedEvents = useMemo(
    () =>
      (eventsByDate.get(selectedIso) || []).map((item) => ({
        ...item,
        conflictReasons: Array.from(reasonsById.get(item.id) || []),
        kitchenCheckpoints: buildKitchenCheckpoints(item)
      })),
    [eventsByDate, selectedIso, reasonsById]
  );
  const selectedCounts = countByStatus(selectedEvents);
  const selectedDayConflicts = dayConflicts.get(selectedIso) || EMPTY_DAY_CONFLICT;
  const selectedDayRunOfShow = useMemo(
    () => buildEventRunOfShowReadModel({
      quotes: state.quotes.filter((quote) => String(quote?.event?.date || "").trim() === selectedIso),
      source: state.source,
      upstreamTruncated: state.truncated,
      upstreamLimit: EVENT_SCHEDULE_QUOTE_LIMIT
    }),
    [selectedIso, state.quotes, state.source, state.truncated]
  );

  const availableStaffLeads = useMemo(() => normalizeStaffLeads(staffLeads), [staffLeads]);
  const resolvedStaffLeads = useMemo(() => {
    const base = availableStaffLeads;
    const seen = new Set(base);
    const next = [...base];
    scheduledEvents.forEach((event) => {
      const lead = String(event.staffLead || "").trim();
      if (lead && !seen.has(lead)) {
        seen.add(lead);
        next.push(lead);
      }
    });
    return next;
  }, [availableStaffLeads, scheduledEvents]);

  const laneDefinitions = useMemo(
    () => [
      { id: "", label: "Unassigned", available: true },
      ...resolvedStaffLeads.map((lead) => ({ id: lead, label: lead, available: availableStaffLeads.includes(lead) }))
    ],
    [availableStaffLeads, resolvedStaffLeads]
  );

  const laneEvents = useMemo(() => {
    const next = new Map(laneDefinitions.map((lane) => [lane.id, []]));
    selectedEvents.forEach((event) => {
      const key = next.has(event.staffLead) ? event.staffLead : "";
      const bucket = next.get(key) || [];
      bucket.push(event);
      next.set(key, bucket);
    });
    return next;
  }, [laneDefinitions, selectedEvents]);

  const monthCells = useMemo(() => {
    const monthStart = startOfMonth(anchorDate);
    const monthEnd = endOfMonth(anchorDate);
    const gridStart = startOfWeek(monthStart);
    const gridEnd = endOfWeek(monthEnd);

    const cells = [];
    for (let cursor = new Date(gridStart); cursor <= gridEnd; cursor = addDays(cursor, 1)) {
      const iso = toIsoDate(cursor);
      const events = eventsByDate.get(iso) || [];
      const counts = countByStatus(events);
      cells.push({
        iso,
        date: new Date(cursor),
        inMonth: sameMonth(cursor, monthStart),
        counts,
        conflicts: dayConflicts.get(iso) || EMPTY_DAY_CONFLICT
      });
    }
    return cells;
  }, [anchorDate, eventsByDate, dayConflicts]);

  const weekDays = useMemo(() => {
    const start = startOfWeek(anchorDate);
    return Array.from({ length: 7 }, (_, idx) => {
      const dt = addDays(start, idx);
      const iso = toIsoDate(dt);
      const events = (eventsByDate.get(iso) || []).map((event) => ({
        ...event,
        conflictReasons: Array.from(reasonsById.get(event.id) || [])
      }));
      return {
        iso,
        date: dt,
        events,
        conflicts: dayConflicts.get(iso) || EMPTY_DAY_CONFLICT
      };
    });
  }, [anchorDate, eventsByDate, reasonsById, dayConflicts]);

  const shift = (amount) => {
    const next = viewMode === "month" ? addMonths(anchorDate, amount) : addDays(anchorDate, amount * 7);
    setAnchorIso(toIsoDate(next));
  };

  const jumpToToday = () => {
    setAnchorIso(todayIso);
    setSelectedIso(todayIso);
  };

  const handleAssignStaff = async (quoteId, staffLead) => {
    const id = String(quoteId || "").trim();
    if (!id) return;
    const nextLead = String(staffLead || "").trim();
    const assignedAtISO = new Date().toISOString();
    const snapshot = state.quotes;

    setAssigningId(id);
    setDropLaneKey("");
    setFeedback("");
    setState((prev) => ({
      ...prev,
      error: "",
      quotes: prev.quotes.map((quote) => {
        if (quote.id !== id) return quote;
        return {
          ...quote,
          booking: {
            ...(quote.booking || {}),
            staffLead: nextLead,
            staffAssignedAtISO: assignedAtISO
          }
        };
      })
    }));

    try {
      await updateQuoteBookingAssignment({ quoteId: id, staffLead: nextLead });
      setFeedback(nextLead ? `Assigned ${nextLead}.` : "Cleared staff assignment.");
      // Drop physics: settle-bounce the moved card and glow the receiving
      // lane, tinted by the conflict check result. Staff assignment does not
      // feed the conflict checker, so the current reasons stay accurate for
      // the post-move arrangement. Skipped entirely under reduced motion.
      if (!prefersReducedMotion()) {
        dropRunRef.current += 1;
        setDropFeedback({
          quoteId: id,
          laneKey: nextLead || "__unassigned__",
          tone: getScheduleDropTone(Array.from(reasonsById.get(id) || [])),
          runId: dropRunRef.current
        });
      }
    } catch (err) {
      setState((prev) => ({
        ...prev,
        quotes: snapshot,
        error: err?.message || "Failed to update staff assignment."
      }));
    } finally {
      setAssigningId("");
    }
  };

  const toCheckpointOverrides = (checkpoints = []) =>
    checkpoints.map((item) => ({
      id: item.id,
      label: String(item.label || "").trim().slice(0, 80),
      minuteOffset: Math.round(toNumber(item.minuteOffset, 0))
    }));

  const handleCheckpointFieldChange = (quoteId, checkpointId, field, value) => {
    const id = String(quoteId || "").trim();
    if (!id) return;
    const targetCheckpointId = String(checkpointId || "").trim();
    if (!targetCheckpointId) return;

    setState((prev) => ({
      ...prev,
      quotes: prev.quotes.map((quote) => {
        if (quote.id !== id) return quote;
        const startMinutes = parseTimeToMinutes(quote.event?.time);
        if (startMinutes === null) return quote;

        const current = buildKitchenCheckpoints({
          time: quote.event?.time,
          hours: quote.event?.hours,
          kitchenCheckpointOverrides: quote.booking?.kitchenCheckpoints
        });
        if (!current.length) return quote;

        const next = current.map((checkpoint) => {
          if (checkpoint.id !== targetCheckpointId) return checkpoint;
          if (field === "label") {
            return {
              ...checkpoint,
              label: String(value || "").slice(0, 80)
            };
          }
          const parsedMinutes = parseTimeToMinutes(value);
          if (parsedMinutes === null) return checkpoint;
          const minuteOffset = parsedMinutes - startMinutes;
          return {
            ...checkpoint,
            minute: parsedMinutes,
            minuteOffset,
            timeLabel: formatCheckpointTime(parsedMinutes),
            timeValue: formatMinutesToTimeInput(parsedMinutes)
          };
        });

        return {
          ...quote,
          booking: {
            ...(quote.booking || {}),
            kitchenCheckpoints: toCheckpointOverrides(next)
          }
        };
      })
    }));
  };

  const persistKitchenCheckpoints = async (quoteId, checkpoints, successMessage = "Kitchen checkpoints saved.") => {
    const id = String(quoteId || "").trim();
    if (!id) return;
    setSavingCheckpointId(id);
    setFeedback("");
    try {
      await updateQuoteKitchenCheckpoints({
        quoteId: id,
        checkpoints
      });
      setFeedback(successMessage);
      return true;
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err?.message || "Failed to save kitchen checkpoints."
      }));
      return false;
    } finally {
      setSavingCheckpointId("");
    }
  };

  const handleSaveCheckpoints = async (quoteId) => {
    const quote = state.quotes.find((item) => item.id === quoteId);
    if (!quote) return;
    const current = buildKitchenCheckpoints({
      time: quote.event?.time,
      hours: quote.event?.hours,
      kitchenCheckpointOverrides: quote.booking?.kitchenCheckpoints
    });
    await persistKitchenCheckpoints(quoteId, toCheckpointOverrides(current));
  };

  const handleResetCheckpoints = async (quoteId) => {
    const quote = state.quotes.find((item) => item.id === quoteId);
    if (!quote) return;
    const previousOverrides = Array.isArray(quote.booking?.kitchenCheckpoints)
      ? quote.booking.kitchenCheckpoints
      : [];
    const defaults = buildKitchenCheckpoints({
      time: quote.event?.time,
      hours: quote.event?.hours,
      kitchenCheckpointOverrides: []
    });
    const nextOverrides = toCheckpointOverrides(defaults);

    setState((prev) => ({
      ...prev,
      quotes: prev.quotes.map((item) => {
        if (item.id !== quoteId) return item;
        return {
          ...item,
          booking: {
            ...(item.booking || {}),
            kitchenCheckpoints: nextOverrides
          }
        };
      })
    }));
    const saved = await persistKitchenCheckpoints(
      quoteId,
      nextOverrides,
      "Kitchen checkpoints reset to defaults."
    );
    if (!saved) {
      setState((prev) => ({
        ...prev,
        quotes: prev.quotes.map((item) => {
          if (item.id !== quoteId) return item;
          return {
            ...item,
            booking: {
              ...(item.booking || {}),
              kitchenCheckpoints: previousOverrides
            }
          };
        })
      }));
    }
  };

  const handleProductionChecklistToggle = async (quoteId, checklistItemId, completed) => {
    const id = String(quoteId || "").trim();
    const itemId = String(checklistItemId || "").trim();
    if (!id || !itemId) return;
    const quote = state.quotes.find((item) => item.id === id);
    if (!quote) return;

    const snapshot = state.quotes;
    const nowISO = new Date().toISOString();
    const nextChecklist = buildProductionChecklist(quote).items.map((item) => {
      if (item.id !== itemId) return item;
      return {
        ...item,
        completed,
        completedAtISO: completed ? item.completedAtISO || nowISO : "",
        completedByEmail: completed ? item.completedByEmail || currentUserEmail : ""
      };
    });

    setSavingChecklistId(id);
    setFeedback("");
    setState((prev) => ({
      ...prev,
      error: "",
      quotes: prev.quotes.map((item) => (
        item.id === id
          ? {
            ...item,
            booking: {
              ...(item.booking || {}),
              productionChecklist: nextChecklist
            }
          }
          : item
      ))
    }));

    try {
      await updateQuoteProductionChecklist({
        quoteId: id,
        checklist: nextChecklist,
        actorEmail: currentUserEmail
      });
      setFeedback(`Production checklist updated for ${quote.quoteNumber || id}.`);
    } catch (err) {
      setState((prev) => ({
        ...prev,
        quotes: snapshot,
        error: err?.message || "Failed to save production checklist."
      }));
    } finally {
      setSavingChecklistId("");
    }
  };

  const handleDragStart = (event, quoteId) => {
    if (assigningId) return;
    event.dataTransfer.setData("text/plain", quoteId);
    event.dataTransfer.effectAllowed = "move";
  };

  const handleDropOnLane = (event, laneId) => {
    event.preventDefault();
    if (assigningId) return;
    const quoteId = event.dataTransfer.getData("text/plain");
    if (!quoteId) return;
    handleAssignStaff(quoteId, laneId);
  };

  const closeBlocked = Boolean(assigningId || savingCheckpointId || savingChecklistId);
  const handleClose = () => {
    if (closeBlocked) {
      setFeedback("Wait for the current schedule update to finish before closing.");
      return;
    }
    onClose();
  };
  const { dialogRef } = useModalDialog({
    open: Boolean(open && !embedded),
    onRequestClose: handleClose,
    canClose: !closeBlocked,
    onCloseBlocked: () => setFeedback("Wait for the current schedule update to finish before closing."),
    returnFocusRef
  });

  useEffect(() => {
    if (!open || !embedded || typeof window === "undefined") return undefined;
    const frame = window.requestAnimationFrame(() => {
      routeHeadingRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [embedded, open]);

  if (!open) return null;

  return (
    <div
      className={embedded ? "container workspace-route-main embedded-workspace-route" : "modal-overlay"}
      role={embedded ? "region" : "dialog"}
      aria-modal={embedded ? undefined : "true"}
      aria-labelledby="event-schedule-title"
    >
      <div
        ref={dialogRef}
        className={`modal-card schedule-card${embedded ? " workspace-route-card" : ""}`}
        tabIndex={-1}
      >
        <div className="modal-head">
          <h2
            id="event-schedule-title"
            ref={routeHeadingRef}
            tabIndex={embedded ? -1 : undefined}
          >
            Event Schedule
          </h2>
          <div className="right-actions">
            <button type="button" className="ghost" onClick={load} disabled={state.loading}>
              {state.loading ? "Refreshing..." : "Refresh"}
            </button>
            <button
              type="button"
              className="ghost"
              data-modal-initial-focus={embedded ? undefined : true}
              onClick={handleClose}
              disabled={closeBlocked}
            >
              {embedded ? "Back to Home" : "Close"}
            </button>
          </div>
        </div>

        <p className="source-note">
          Source: {getScheduleSourceLabel(state)}
        </p>
        <p className="source-note">Capacity threshold: {maxCapacity} guests per venue/time window.</p>
        {state.error && <p className="error-note">{state.error}</p>}
        {feedback && <p className="source-note">{feedback}</p>}

        <div className="schedule-toolbar">
          <div className="right-actions">
            <button type="button" className="ghost compact" onClick={() => shift(-1)}>Prev</button>
            <button type="button" className="ghost compact" onClick={() => shift(1)}>Next</button>
            <button type="button" className="ghost compact" onClick={jumpToToday}>Today</button>
          </div>
          <strong className="schedule-range">
            {viewMode === "month" ? monthRangeLabel(anchorDate) : weekRangeLabel(anchorDate)}
          </strong>
          <div className="right-actions">
            <button
              type="button"
              className={viewMode === "month" ? "cta compact" : "ghost compact"}
              onClick={() => setViewMode("month")}
            >
              Month
            </button>
            <button
              type="button"
              className={viewMode === "week" ? "cta compact" : "ghost compact"}
              onClick={() => setViewMode("week")}
            >
              Week
            </button>
          </div>
        </div>

        <div className="schedule-layout">
          <section className="schedule-grid-panel">
            {viewMode === "month" ? (
              <>
                <div className="schedule-weekday-row">
                  {WEEKDAY_SHORT.map((label) => (
                    <span key={label}>{label}</span>
                  ))}
                </div>
                <div className="schedule-month-grid">
                  {monthCells.map((cell) => {
                    const isSelected = cell.iso === selectedIso;
                    const countLabels = getScheduleCalendarCountLabels(cell.counts);
                    const className = [
                      "schedule-day-cell",
                      cell.inMonth ? "in-month" : "out-month",
                      isSelected ? "selected" : "",
                      cell.counts.booked > 0 ? "has-booked" : "",
                      cell.counts.accepted > 0 ? "has-accepted" : "",
                      cell.conflicts.total > 0 ? "has-conflict" : "",
                      cell.conflicts.capacity > 0 ? "has-capacity" : ""
                    ]
                      .filter(Boolean)
                      .join(" ");
                    return (
                      <button
                        key={cell.iso}
                        type="button"
                        className={className}
                        onClick={() => {
                          setSelectedIso(cell.iso);
                          if (!cell.inMonth) setAnchorIso(cell.iso);
                        }}
                      >
                        <span className="schedule-day-num">{cell.date.getDate()}</span>
                        <div className="schedule-day-badges">
                          {countLabels.booked && <small className="booked">{countLabels.booked}</small>}
                          {countLabels.accepted && <small className="accepted">{countLabels.accepted}</small>}
                          {cell.conflicts.total > 0 && <small className="conflict">{cell.conflicts.total} risk</small>}
                          {cell.conflicts.capacity > 0 && <small className="capacity">{cell.conflicts.capacity} cap</small>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="schedule-week-grid">
                {weekDays.map((day) => {
                  const isSelected = day.iso === selectedIso;
                  return (
                    <article key={day.iso} className={`schedule-week-day ${isSelected ? "selected" : ""}`}>
                      <button
                        type="button"
                        className="schedule-week-head"
                        onClick={() => setSelectedIso(day.iso)}
                      >
                        <strong>{WEEKDAY_SHORT[day.date.getDay()]}</strong>
                        <span>{day.date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                      </button>
                      <div className="schedule-week-events">
                        {day.events.length === 0 && <p className="muted">No events</p>}
                        {day.events.map((item) => (
                          <div
                            key={item.id}
                            className={[
                              "schedule-mini-event",
                              item.status,
                              item.conflictReasons.length ? "has-conflict" : "",
                              item.conflictReasons.includes("capacity") ? "has-capacity" : ""
                            ]
                              .filter(Boolean)
                              .join(" ")}
                          >
                            <strong>{item.time || "TBD"}</strong>
                            <span>{formatWorkspaceText(item.quoteNumber, { emptyLabel: "Quote number pending" })}</span>
                            {item.conflictReasons.length > 0 && (
                              <small>{item.conflictReasons.includes("capacity") ? "capacity risk" : "time conflict"}</small>
                            )}
                          </div>
                        ))}
                        {day.conflicts.total > 0 && (
                          <p className="warning-note schedule-day-risk-note">
                            {day.conflicts.total} conflict event(s)
                          </p>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <aside className="schedule-day-panel">
            <h3>{formatScheduleDayLabel(selectedIso)}</h3>
            <p className="source-note">
              Booked: {selectedCounts.booked} • Accepted: {selectedCounts.accepted}
            </p>
            {selectedDayConflicts.total > 0 && (
              <p className="warning-note">
                Conflict flags: {selectedDayConflicts.total}
                {selectedDayConflicts.overlap > 0 ? ` • overlap ${selectedDayConflicts.overlap}` : ""}
                {selectedDayConflicts.unknown > 0 ? ` • unknown ${selectedDayConflicts.unknown}` : ""}
                {selectedDayConflicts.capacity > 0 ? ` • capacity ${selectedDayConflicts.capacity}` : ""}
              </p>
            )}
            <EventRunOfShowPanel
              model={selectedDayRunOfShow}
              selectedDateLabel={formatScheduleDayLabel(selectedIso)}
              loading={state.loading}
              error={state.error}
              onRetry={load}
            />
            {selectedEvents.length > 0 && (
              <>
                <div className="schedule-event-list">
                  {selectedEvents.map((item) => {
                    const { quote: quoteStatus, bookingConfirmation } = getScheduleStatusPresentation(item);
                    return (
                      <article
                        key={item.id}
                        id={scheduleEventDetailId(item.id)}
                        tabIndex={-1}
                        className={[
                          "schedule-event-card",
                          item.status,
                          item.conflictReasons.length ? "has-conflict" : "",
                          item.conflictReasons.includes("capacity") ? "has-capacity" : ""
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        <header>
                          <strong>{formatWorkspaceText(item.quoteNumber, { emptyLabel: "Quote number pending" })}</strong>
                        </header>
                        <div className="right-actions" aria-label="Quote and booking confirmation status">
                          <StatusChip family={quoteStatus.family} label={`Quote: ${quoteStatus.label}`} />
                          <StatusChip
                            family={bookingConfirmation.family}
                            label={`Booking confirmation: ${bookingConfirmation.label}`}
                          />
                        </div>
                      <ScheduleEventFacts item={item} />
                      <p
                        className={[
                          "schedule-confirmation-note",
                          item.confirmationStatus === "confirmed" ? "confirmed" : "",
                          item.confirmationStatus === "cancelled" ? "cancelled" : ""
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        {confirmationLabel(item)}
                      </p>
                      <StaffLeadChoiceField
                        staffLeads={availableStaffLeads}
                        value={item.staffLead}
                        disabled={Boolean(assigningId)}
                        onChange={(lead) => handleAssignStaff(item.id, lead)}
                        onRecover={() => void load()}
                      />
                      {item.conflictReasons.length > 0 && (
                        <p className="schedule-conflict-note">
                          {item.conflictReasons.map((reason) => reasonLabel(reason)).join(" • ")}
                        </p>
                      )}
                      <div className="schedule-production-checklist">
                        <div className="schedule-production-head">
                          <strong>Production checklist controls</strong>
                          <span>
                            {item.productionChecklist.completed}/{item.productionChecklist.total}
                          </span>
                        </div>
                        <progress
                          max={item.productionChecklist.total}
                          value={item.productionChecklist.completed}
                        >
                          {item.productionChecklist.percent}%
                        </progress>
                        <div className="schedule-production-items">
                          {item.productionChecklist.items.map((checklistItem) => (
                            <label key={`${item.id}-${checklistItem.id}`}>
                              <input
                                type="checkbox"
                                checked={checklistItem.completed}
                                onChange={(event) => handleProductionChecklistToggle(
                                  item.id,
                                  checklistItem.id,
                                  event.target.checked
                                )}
                                disabled={savingChecklistId === item.id}
                              />
                              <span>{checklistItem.label}</span>
                              <small>{checklistItem.group}</small>
                            </label>
                          ))}
                        </div>
                      </div>
                      {item.kitchenCheckpoints.length > 0 ? (
                        <div className="schedule-checkpoints">
                          <strong>Kitchen checkpoint controls</strong>
                          <div className="schedule-checkpoint-list">
                            {item.kitchenCheckpoints.map((checkpoint) => (
                              <div key={`${item.id}-${checkpoint.id}`} className="schedule-checkpoint-item">
                                <input
                                  type="text"
                                  value={checkpoint.label}
                                  maxLength={80}
                                  onChange={(event) =>
                                    handleCheckpointFieldChange(item.id, checkpoint.id, "label", event.target.value)}
                                  disabled={savingCheckpointId === item.id}
                                  aria-label={`${checkpoint.id} label`}
                                />
                                <input
                                  type="time"
                                  value={checkpoint.timeValue}
                                  onChange={(event) =>
                                    handleCheckpointFieldChange(item.id, checkpoint.id, "time", event.target.value)}
                                  disabled={savingCheckpointId === item.id}
                                  aria-label={`${checkpoint.id} time`}
                                />
                                <em>{checkpoint.timeLabel}</em>
                              </div>
                            ))}
                          </div>
                          <div className="schedule-checkpoint-actions">
                            <button
                              type="button"
                              className="ghost compact"
                              onClick={() => handleSaveCheckpoints(item.id)}
                              disabled={savingCheckpointId === item.id}
                            >
                              {savingCheckpointId === item.id ? "Saving..." : "Save checkpoints"}
                            </button>
                            <button
                              type="button"
                              className="ghost compact"
                              onClick={() => handleResetCheckpoints(item.id)}
                              disabled={savingCheckpointId === item.id}
                            >
                              Reset defaults
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="schedule-checkpoint-hint">
                          Add an event start time to generate kitchen checkpoints.
                        </p>
                      )}
                      </article>
                    );
                  })}
                </div>

                <section className="schedule-staff-board">
                  <div className="schedule-staff-head">
                    <h4>Staffing Board</h4>
                    <p className="source-note">Drag events into a lane to assign staff lead.</p>
                  </div>
                  <div className="schedule-staff-lanes">
                    {laneDefinitions.map((lane) => {
                      const laneKey = lane.id || "__unassigned__";
                      const laneItems = laneEvents.get(lane.id) || [];
                      const laneGlow = dropFeedback && dropFeedback.laneKey === laneKey
                        ? dropFeedback
                        : null;
                      const laneClass = [
                        "schedule-staff-lane",
                        lane.id ? "assigned" : "unassigned",
                        lane.available ? "" : "is-stale",
                        dropLaneKey === laneKey ? "drop-target" : "",
                        laneGlow ? "lane-glow" : ""
                      ]
                        .filter(Boolean)
                        .join(" ");
                      return (
                        <div
                          key={laneGlow ? `${laneKey}-glow-${laneGlow.runId}` : laneKey}
                          className={laneClass}
                          data-tone={laneGlow ? laneGlow.tone : undefined}
                          data-lead-availability={lane.available ? "available" : "stale"}
                          onAnimationEnd={laneGlow
                            ? (event) => {
                              if (event.animationName !== "schedule-lane-glow") return;
                              setDropFeedback((prev) => (
                                prev && prev.runId === laneGlow.runId ? null : prev
                              ));
                            }
                            : undefined}
                          onDragOver={(event) => {
                            if (!lane.available) return;
                            event.preventDefault();
                            if (!assigningId) {
                              setDropLaneKey(laneKey);
                              event.dataTransfer.dropEffect = "move";
                            }
                          }}
                          onDragLeave={() => setDropLaneKey((prev) => (prev === laneKey ? "" : prev))}
                          onDrop={lane.available ? (event) => handleDropOnLane(event, lane.id) : undefined}
                        >
                          <header>
                            <strong>{lane.label}</strong>
                            <span>{laneItems.length}</span>
                          </header>
                          <div className="schedule-staff-items">
                            {laneItems.length === 0 && <p className="muted">{lane.available ? "Drop events here" : "Saved lead unavailable"}</p>}
                            {laneItems.map((item) => {
                              const settle = dropFeedback && dropFeedback.quoteId === item.id
                                ? dropFeedback
                                : null;
                              return (
                              <button
                                key={settle ? `${item.id}-drop-${settle.runId}` : item.id}
                                type="button"
                                className={[
                                  "schedule-staff-card",
                                  item.status,
                                  item.conflictReasons.length ? "has-conflict" : "",
                                  item.conflictReasons.includes("capacity") ? "has-capacity" : "",
                                  settle ? "drop-settle" : ""
                                ]
                                  .filter(Boolean)
                                  .join(" ")}
                                draggable={!assigningId}
                                onDragStart={(event) => handleDragStart(event, item.id)}
                                disabled={Boolean(assigningId)}
                                onClick={() => {
                                  const detail = document.getElementById(scheduleEventDetailId(item.id));
                                  detail?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                                  detail?.focus({ preventScroll: true });
                                }}
                                aria-label={`Focus event details for ${formatWorkspaceText(item.quoteNumber, { emptyLabel: "quote number pending" })}`}
                              >
                                <strong>{formatWorkspaceText(item.quoteNumber, { emptyLabel: "Quote number pending" })}</strong>
                                <span>
                                  {formatWorkspaceText(item.time, { emptyLabel: "Time not set" })}
                                  {" • "}{formatWorkspaceInteger(item.guests, { emptyLabel: "Guest count not set" })}
                                  {hasWorkspaceNumber(item.guests) ? " guests" : ""}
                                </span>
                                {item.conflictReasons.length > 0 && (
                                  <small>
                                    {item.conflictReasons.includes("capacity") ? "capacity risk" : "time conflict"}
                                  </small>
                                )}
                              </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              </>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

export default function EventScheduleModal(props) {
  return <EventScheduleView {...props} presentation="modal" />;
}
