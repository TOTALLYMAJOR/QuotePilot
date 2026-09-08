import { useEffect, useMemo, useRef, useState } from "react";
import AdaptiveChoiceField from "./AdaptiveChoiceField";
import EventRunOfShowPanel from "./EventRunOfShowPanel";
import FieldStateIndicator from "./FieldStateIndicator";
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
const WEEK_TIMELINE_BASE_START_MINUTE = 10 * 60;
const WEEK_TIMELINE_BASE_END_MINUTE = 22 * 60;
const WEEK_TIMELINE_HOUR_HEIGHT = 52;

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

function stableWeekEventKey(item, fallbackIndex) {
  const event = item?.event || {};
  return [
    String(event.id || ""),
    String(event.quoteNumber || ""),
    String(event.eventName || ""),
    String(item?.startMinute ?? ""),
    String(item?.endMinute ?? ""),
    String(fallbackIndex)
  ].join("::");
}

function assignWeekCollisionLanes(items = []) {
  const sorted = items
    .map((item, index) => ({
      ...item,
      stableKey: stableWeekEventKey(item, index)
    }))
    .sort((left, right) => (
      left.startMinute - right.startMinute
      || left.endMinute - right.endMinute
      || left.stableKey.localeCompare(right.stableKey)
    ));
  const laidOut = [];
  let active = [];
  let group = [];
  let groupEnd = -Infinity;

  const finishGroup = () => {
    if (!group.length) return;
    const laneCount = Math.max(1, ...group.map((item) => item.laneIndex + 1));
    group.forEach((item) => {
      item.laneCount = laneCount;
    });
    laidOut.push(...group);
    group = [];
  };

  sorted.forEach((item) => {
    if (group.length > 0 && item.startMinute >= groupEnd) {
      finishGroup();
      active = [];
      groupEnd = -Infinity;
    }

    active = active.filter((activeItem) => activeItem.endMinute > item.startMinute);
    const occupiedLanes = new Set(active.map((activeItem) => activeItem.laneIndex));
    let laneIndex = 0;
    while (occupiedLanes.has(laneIndex)) laneIndex += 1;

    const next = { ...item, laneIndex, laneCount: 1 };
    active.push(next);
    group.push(next);
    groupEnd = Math.max(groupEnd, next.endMinute);
  });

  finishGroup();
  return laidOut.map(({ stableKey: _stableKey, ...item }) => item);
}

/**
 * Builds geometry for the Week presentation only. Event eligibility, conflict
 * evidence, selection, and persistence remain owned by the existing Calendar
 * projection and handlers.
 */
export function buildWeekTimelineModel(weekDays = []) {
  const sourceDays = Array.isArray(weekDays) ? weekDays : [];
  const preparedDays = sourceDays.map((day) => {
    const timed = [];
    const unplacedEvents = [];

    (Array.isArray(day?.events) ? day.events : []).forEach((event) => {
      const startMinute = parseTimeToMinutes(event?.time);
      const hours = Number(event?.hours);
      const durationMinutes = Number.isFinite(hours) && hours > 0
        ? Math.round(hours * 60)
        : 0;

      if (startMinute === null || durationMinutes <= 0) {
        unplacedEvents.push({
          event,
          reason: startMinute === null ? "time_unavailable" : "duration_unavailable"
        });
        return;
      }

      timed.push({
        event,
        startMinute,
        endMinute: startMinute + durationMinutes,
        visualEndMinute: Math.min(startMinute + durationMinutes, 1440),
        durationMinutes,
        continuesNextDay: startMinute + durationMinutes > 1440
      });
    });

    return {
      ...day,
      timedEvents: assignWeekCollisionLanes(timed),
      unplacedEvents
    };
  });

  const timedEvents = preparedDays.flatMap((day) => day.timedEvents);
  const earliestStart = timedEvents.length
    ? Math.min(...timedEvents.map((item) => item.startMinute))
    : WEEK_TIMELINE_BASE_START_MINUTE;
  const latestEnd = timedEvents.length
    ? Math.max(...timedEvents.map((item) => item.visualEndMinute))
    : WEEK_TIMELINE_BASE_END_MINUTE;
  const startMinute = Math.floor(
    Math.min(WEEK_TIMELINE_BASE_START_MINUTE, earliestStart) / 60
  ) * 60;
  const endMinute = Math.min(
    1440,
    Math.ceil(Math.max(WEEK_TIMELINE_BASE_END_MINUTE, latestEnd) / 60) * 60
  );
  const rangeMinutes = Math.max(60, endMinute - startMinute);
  const heightPx = (rangeMinutes / 60) * WEEK_TIMELINE_HOUR_HEIGHT;
  const ticks = [];
  for (let minute = startMinute; minute <= endMinute; minute += 60) {
    ticks.push({
      minute,
      label: formatTimelineHourLabel(minute),
      offsetPx: ((minute - startMinute) / 60) * WEEK_TIMELINE_HOUR_HEIGHT
    });
  }

  return {
    startMinute,
    endMinute,
    rangeMinutes,
    heightPx,
    ticks,
    days: preparedDays.map((day) => ({
      ...day,
      timedEvents: day.timedEvents.map((item) => ({
        ...item,
        topPx: ((item.startMinute - startMinute) / 60) * WEEK_TIMELINE_HOUR_HEIGHT,
        heightPx: ((item.visualEndMinute - item.startMinute) / 60) * WEEK_TIMELINE_HOUR_HEIGHT
      }))
    }))
  };
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
    ...(!currentIsAvailable && current ? [{
      value: current,
      label: `${current} · saved lead no longer available`,
      disabled: true
    }] : []),
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
      {current && currentIsAvailable && !disabled ? (
        <button type="button" className="ghost compact" onClick={() => onChange("")}>Clear lead</button>
      ) : null}
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

function addComparison(comparisonsById, source, peer, reason) {
  if (!source?.id || !peer?.id || source.id === peer.id) return;
  const peers = comparisonsById.get(source.id) || new Map();
  const comparison = peers.get(peer.id) || { peerId: peer.id, reasons: new Set() };
  comparison.reasons.add(reason);
  peers.set(peer.id, comparison);
  comparisonsById.set(source.id, peers);
}

function addComparisonPair(comparisonsById, a, b, reason) {
  addComparison(comparisonsById, a, b, reason);
  addComparison(comparisonsById, b, a, reason);
}

export function buildConflictInsights(events, capacityLimit) {
  const grouped = new Map();
  const reasonsById = new Map();
  const comparisonsById = new Map();
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
            addComparisonPair(comparisonsById, a, b, "time_overlap");
          }
        } else {
          addReason(reasonsById, a.id, "time_unknown");
          addReason(reasonsById, b.id, "time_unknown");
          addComparisonPair(comparisonsById, a, b, "time_unknown");
        }
      }
    }

    if (hasUnknownWindow) {
      const totalLoad = group.reduce((sum, item) => sum + Math.max(0, toNumber(item.guests, 0)), 0);
      if (totalLoad > maxCapacity) {
        group.forEach((item) => addReason(reasonsById, item.id, "capacity"));
        group.forEach((item, index) => {
          group.slice(index + 1).forEach((peer) => {
            addComparisonPair(comparisonsById, item, peer, "capacity");
          });
        });
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

    group.forEach((item, index) => {
      group.slice(index + 1).forEach((peer) => {
        const itemReasons = reasonsById.get(item.id) || new Set();
        const peerReasons = reasonsById.get(peer.id) || new Set();
        if (
          (itemReasons.has("capacity") || peerReasons.has("capacity"))
          && windowsOverlap(windows.get(item.id), windows.get(peer.id))
        ) {
          addComparisonPair(comparisonsById, item, peer, "capacity");
        }
      });
    });
  });

  return {
    reasonsById,
    dayConflicts: summarizeDayConflicts(events, reasonsById),
    maxCapacity,
    comparisonsById: new Map(
      Array.from(comparisonsById.entries()).map(([id, peers]) => [
        id,
        Array.from(peers.values()).map((comparison) => ({
          peerId: comparison.peerId,
          reasons: Array.from(comparison.reasons)
        }))
      ])
    )
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

function formatTimelineTimeLabel(value) {
  const minute = parseTimeToMinutes(value);
  if (minute === null) return "Time not set";
  return formatCheckpointTime(minute).replace(":00 ", " ");
}

function formatTimelineHourLabel(minute) {
  return formatCheckpointTime(minute)
    .replace(":00 ", " ")
    .replace(" (next day)", "");
}

function WeekTimeline({
  model,
  selectedIso,
  selectedEventId,
  onSelectDay,
  onSelectEvent
}) {
  const days = Array.isArray(model?.days) ? model.days : [];
  const hasUnplacedEvents = days.some((day) => day.unplacedEvents.length > 0);

  const eventClassName = (event) => [
    "schedule-mini-event",
    event.status,
    event.conflictReasons.length ? "has-conflict" : "",
    event.conflictReasons.includes("capacity") ? "has-capacity" : ""
  ].filter(Boolean).join(" ");
  const eventName = (event) => formatWorkspaceText(
    event.eventName || event.quoteNumber,
    { emptyLabel: "Untitled event" }
  );
  const eventAriaLabel = (day, event, timingLabel) => [
    formatScheduleDayLabel(day.iso),
    timingLabel,
    eventName(event),
    event.conflictReasons.length ? event.conflictReasons.map(reasonLabel).join(", ") : ""
  ].filter(Boolean).join(", ");

  return (
    <section
      className="schedule-week-timeline"
      aria-label="Week calendar"
      data-testid="operations-week-timeline"
    >
      <header className="schedule-week-timeline-head">
        <span className="schedule-week-axis-heading" aria-hidden="true">Time</span>
        <div className="schedule-week-day-headings">
          {days.map((day) => {
            const isSelected = day.iso === selectedIso;
            return (
              <button
                key={day.iso}
                id={`schedule-week-heading-${day.iso}`}
                type="button"
                className={`schedule-week-head ${isSelected ? "selected" : ""}`}
                aria-current={isSelected ? "date" : undefined}
                onClick={() => onSelectDay(day.iso, day.events[0]?.id)}
              >
                <strong>{WEEKDAY_SHORT[day.date.getDay()]}</strong>
                <span>{day.date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
              </button>
            );
          })}
        </div>
      </header>

      {hasUnplacedEvents ? (
        <section className="schedule-week-unplaced" aria-label="Events needing timing">
          <div className="schedule-week-unplaced-label">
            <strong>Timing needs review</strong>
            <span>Time or duration is not set</span>
          </div>
          <div className="schedule-week-unplaced-days">
            {days.map((day) => (
              <div key={day.iso} className="schedule-week-unplaced-day">
                {day.unplacedEvents.map(({ event, reason }) => {
                  const timingLabel = reason === "time_unavailable"
                    ? "Time not set"
                    : `${event.time} · Duration not set`;
                  return (
                    <button
                      key={event.id}
                      type="button"
                      className={`schedule-week-unplaced-event ${eventClassName(event)}`}
                      data-week-event-id={event.id}
                      aria-pressed={selectedEventId === event.id}
                      aria-label={eventAriaLabel(day, event, timingLabel)}
                      onClick={() => onSelectEvent(event)}
                    >
                      <strong>{timingLabel}</strong>
                      <span>{eventName(event)}</span>
                      {event.conflictReasons.length > 0 ? <small>At risk</small> : null}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="schedule-week-timeline-body">
        <div
          className="schedule-week-time-axis"
          data-testid="operations-week-time-axis"
          aria-hidden="true"
          style={{ height: `${model.heightPx}px` }}
        >
          {model.ticks.map((tick) => (
            <span
              key={tick.minute}
              data-time-minute={tick.minute}
              style={{ top: `${tick.offsetPx}px` }}
            >
              {tick.label}
            </span>
          ))}
        </div>
        <div className="schedule-week-time-columns" style={{ height: `${model.heightPx}px` }}>
          {days.map((day) => {
            const isSelected = day.iso === selectedIso;
            return (
              <article
                key={day.iso}
                className={`schedule-week-day schedule-week-time-column ${isSelected ? "selected" : ""}`}
                data-week-date={day.iso}
                aria-labelledby={`schedule-week-heading-${day.iso}`}
              >
                {day.timedEvents.map((item) => {
                  const event = item.event;
                  return (
                    <button
                      key={event.id}
                      type="button"
                      className={`schedule-week-event ${eventClassName(event)}`}
                      data-week-event-id={event.id}
                      data-start-minute={item.startMinute}
                      data-duration-minutes={item.durationMinutes}
                      data-collision-lane={item.laneIndex}
                      data-collision-lane-count={item.laneCount}
                      aria-pressed={selectedEventId === event.id}
                      aria-label={eventAriaLabel(
                        day,
                        event,
                        `${event.time}${item.continuesNextDay ? ", continues after midnight" : ""}`
                      )}
                      aria-controls={selectedEventId === event.id
                        ? scheduleEventDetailId(event.id)
                        : undefined}
                      onClick={() => onSelectEvent(event)}
                      style={{
                        "--event-top": `${item.topPx}px`,
                        "--event-height": `${item.heightPx}px`,
                        "--event-lane": item.laneIndex,
                        "--event-lanes": item.laneCount
                      }}
                    >
                      <strong>{formatTimelineTimeLabel(event.time)}</strong>
                      <span>{formatWorkspaceText(event.quoteNumber, { emptyLabel: eventName(event) })}</span>
                      {hasWorkspaceNumber(event.guests) ? (
                        <small>{formatWorkspaceInteger(event.guests)} guests</small>
                      ) : null}
                      {item.continuesNextDay ? (
                        <small className="schedule-week-event-continuation">Continues after midnight</small>
                      ) : null}
                      {event.conflictReasons.length > 0 ? (
                        <small title={event.conflictReasons.map(reasonLabel).join(" · ")}>At risk</small>
                      ) : null}
                    </button>
                  );
                })}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
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

export function ScheduleEventFacts({ item = {}, compact = false }) {
  const guestsRecorded = hasWorkspaceNumber(item.guests);
  return (
    <dl className="schedule-event-facts">
      {!compact ? (
        <div className="schedule-event-fact-wide">
          <dt>Event</dt>
          <dd>{formatWorkspaceText(item.eventName, { emptyLabel: "Untitled event" })}</dd>
        </div>
      ) : null}
      <div>
        <dt>Time</dt>
        <dd>{formatWorkspaceText(item.time, { emptyLabel: "Not set" })}</dd>
      </div>
      <div>
        <dt>Venue</dt>
        <dd>{formatWorkspaceText(item.venue, { emptyLabel: "Not set" })}</dd>
      </div>
      {!compact ? (
        <div>
          <dt>Client</dt>
          <dd>{formatWorkspaceText(item.customer, { emptyLabel: "Not recorded" })}</dd>
        </div>
      ) : null}
      <div>
        <dt>Guests</dt>
        <dd>
          {formatWorkspaceInteger(item.guests, { emptyLabel: "Not set" })}
          {guestsRecorded ? " guests" : ""}
        </dd>
      </div>
      {!compact ? (
        <div>
          <dt>Quote total</dt>
          <dd>{formatWorkspaceMoney(item.total)}</dd>
        </div>
      ) : null}
      {!compact ? (
        <div>
          <dt>Contract</dt>
          <dd>{formatWorkspaceText(item.contractNumber, { emptyLabel: "Pending" })}</dd>
        </div>
      ) : null}
      {!compact ? (
        <div className="schedule-event-fact-wide">
          <dt>Dietary notes</dt>
          <dd>{formatWorkspaceText(item.dietaryRestrictions, { emptyLabel: "None recorded" })}</dd>
        </div>
      ) : null}
    </dl>
  );
}

export function EventScheduleView({
  open,
  onClose,
  presentation = "embedded",
  surfaceTitle = "Event Schedule",
  surfaceEyebrow = "",
  organizationId = "",
  staffLeads = [],
  capacityLimit = 400,
  currentUserEmail = "",
  arrivalContext = null,
  onArrivalResolution = null,
  onOpenOpportunity = null,
  onOpenPeople = null,
  onOpenReporting = null,
  returnFocusRef = null
}) {
  const embedded = presentation === "embedded";
  const operationsMode = String(surfaceTitle || "").trim().toLowerCase() === "operations";
  const todayIso = toIsoDate(new Date());
  const routeHeadingRef = useRef(null);
  const loadGenerationRef = useRef(0);
  const arrivalReportRef = useRef("");
  const [state, setState] = useState({
    loading: true,
    error: "",
    source: "",
    quotes: [],
    stale: false,
    truncated: false,
    organizationId: ""
  });
  const [viewMode, setViewMode] = useState("month");
  const [anchorIso, setAnchorIso] = useState(todayIso);
  const [selectedIso, setSelectedIso] = useState(todayIso);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [feedback, setFeedback] = useState("");
  const [assigningId, setAssigningId] = useState("");
  const [savingCheckpointId, setSavingCheckpointId] = useState("");
  const [savingChecklistId, setSavingChecklistId] = useState("");
  const [dropLaneKey, setDropLaneKey] = useState("");
  const [dropFeedback, setDropFeedback] = useState(null);
  const dropRunRef = useRef(0);
  const arrivalFocus = arrivalContext?.focus || {};
  const exactArrivalActive = Boolean(
    open
    && arrivalContext?.surfaceId === "schedule"
    && arrivalContext?.destination === "schedule"
    && arrivalContext?.focusConsumerState === "supported"
    && ["review_event_schedule", "review_schedule_conflict"].includes(arrivalContext?.intentId)
    && String(arrivalFocus.quoteId || "").trim()
  );
  const unsupportedScheduleArrival = Boolean(
    open
    && arrivalContext?.surfaceId === "schedule"
    && !exactArrivalActive
  );
  const exactArrivalKey = arrivalContext?.surfaceId === "schedule"
    ? [
        arrivalContext.intentId,
        arrivalContext.object?.type,
        arrivalContext.object?.id,
        arrivalFocus.quoteId
      ].filter(Boolean).join(":")
    : "";

  const reportArrivalResolution = (resolution) => {
    if (
      arrivalContext?.surfaceId !== "schedule"
      || typeof onArrivalResolution !== "function"
    ) return;
    const next = {
      ...resolution,
      focus: { quoteId: String(arrivalFocus.quoteId || "").trim() },
      object: {
        id: String(arrivalContext.object?.id || "").trim(),
        type: String(arrivalContext.object?.type || "").trim()
      }
    };
    const signature = JSON.stringify(next);
    if (arrivalReportRef.current === signature) return;
    arrivalReportRef.current = signature;
    onArrivalResolution(next);
  };

  useEffect(() => {
    arrivalReportRef.current = "";
    if (exactArrivalActive || unsupportedScheduleArrival) {
      reportArrivalResolution({ status: "pending" });
    }
  }, [exactArrivalActive, exactArrivalKey, unsupportedScheduleArrival]);

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
          stale: false,
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
        stale: result.stale === true,
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

  const { reasonsById, dayConflicts, maxCapacity, comparisonsById } = useMemo(
    () => buildConflictInsights(scheduledEvents, capacityLimit),
    [scheduledEvents, capacityLimit]
  );

  useEffect(() => {
    if (!unsupportedScheduleArrival) return;
    if (arrivalContext?.intentId === "review_staffing_schedule") {
      reportArrivalResolution({
        status: "recovery",
        code: "authoritative_staffing_consumer_unavailable",
        reason: "Schedule has no exact consumer for the authoritative operational-staffing object.",
        consequence: "No event or legacy booking.staffLead value was substituted, and no staffing assignment changed.",
        nextResolution: "Return to the opportunity and keep the Staffing object open until its operational-staffing evidence is available."
      });
      return;
    }
    reportArrivalResolution({
      status: "recovery",
      code: "schedule_object_consumer_unavailable",
      reason: "This exact object type does not have a supported Schedule focus target.",
      consequence: "No nearby event or default schedule item was selected, and no schedule detail changed.",
      nextResolution: "Return to the originating object and choose an action with an exact Schedule consumer."
    });
  }, [exactArrivalKey, unsupportedScheduleArrival]);

  useEffect(() => {
    if (!exactArrivalActive) return undefined;
    const quoteId = String(arrivalFocus.quoteId || "").trim();
    if (state.loading || state.organizationId !== String(organizationId || "").trim()) {
      reportArrivalResolution({ status: "pending" });
      return undefined;
    }
    if (state.error) {
      reportArrivalResolution({
        status: "recovery",
        code: "schedule_evidence_unavailable",
        reason: "The exact schedule opportunity could not be verified because the current tenant schedule read failed.",
        consequence: "No alternate event was selected, and no schedule or assignment state changed.",
        nextResolution: "Refresh Schedule, then reopen the exact opportunity action if the read still fails."
      });
      return undefined;
    }
    if (state.stale) {
      reportArrivalResolution({
        status: "recovery",
        code: "schedule_evidence_stale",
        reason: "The exact opportunity appears only in stale Schedule evidence, so its current operational state cannot be verified.",
        consequence: "No event was presented as current, no alternate event was focused, and no schedule detail changed.",
        nextResolution: "Reconnect or refresh Schedule before reopening the exact opportunity action."
      });
      return undefined;
    }

    const quote = state.quotes.find((item) => String(item?.id || "") === quoteId) || null;
    if (!quote) {
      reportArrivalResolution({
        status: "recovery",
        code: state.truncated ? "schedule_snapshot_incomplete" : "schedule_opportunity_missing",
        reason: state.truncated
          ? "The exact opportunity is not present in this bounded Schedule snapshot, so its current schedule state cannot be verified."
          : "The exact opportunity is not present in the current tenant Schedule evidence.",
        consequence: "No nearby, first-listed, or same-day event was substituted, and no schedule detail changed.",
        nextResolution: "Refresh Schedule, or return to the originating opportunity and choose its current next action."
      });
      return undefined;
    }
    const scopedOrganizationId = String(organizationId || "").trim();
    if (!scopedOrganizationId || String(quote.organizationId || "").trim() !== scopedOrganizationId) {
      reportArrivalResolution({
        status: "recovery",
        code: "schedule_tenant_mismatch",
        reason: "The exact opportunity could not be matched to the active tenant Schedule scope.",
        consequence: "No cross-tenant or unscoped event was focused, and no schedule detail changed.",
        nextResolution: "Return to the active tenant opportunity and reopen its exact Schedule action."
      });
      return undefined;
    }
    if (!STATUS_SET.has(String(quote.status || ""))) {
      reportArrivalResolution({
        status: "recovery",
        code: "schedule_lifecycle_changed",
        reason: "The exact opportunity is no longer accepted or booked, so it is not part of the current operational Schedule.",
        consequence: "No other accepted or booked event was substituted, and navigation changed no lifecycle state.",
        nextResolution: "Return to the opportunity and review its current lifecycle and ranked next action."
      });
      return undefined;
    }
    const exactEvent = scheduledEvents.find((item) => item.id === quoteId) || null;
    if (!exactEvent || !parseIsoDate(exactEvent.date)) {
      reportArrivalResolution({
        status: "recovery",
        code: "schedule_date_unavailable",
        reason: "The exact accepted or booked opportunity has no valid event date to focus in Schedule.",
        consequence: "No same-day or neighboring event was substituted, and no event date changed.",
        nextResolution: "Return to the opportunity and record or correct its event date before reopening Schedule."
      });
      return undefined;
    }
    if (arrivalContext.intentId === "review_schedule_conflict") {
      if (state.truncated) {
        reportArrivalResolution({
          status: "recovery",
          code: "schedule_conflict_evidence_incomplete",
          reason: "The bounded Schedule snapshot is truncated, so the exact opportunity's conflict state may be incomplete.",
          consequence: "No conflict was presented as current and no alternate event was focused.",
          nextResolution: "Refresh a complete Schedule snapshot before reviewing this exact conflict."
        });
        return undefined;
      }
      if ((reasonsById.get(quoteId)?.size || 0) === 0) {
        reportArrivalResolution({
          status: "recovery",
          code: "schedule_conflict_stale",
          reason: "Current complete Schedule evidence no longer records a conflict for the exact opportunity.",
          consequence: "No different conflict or event was substituted, and the earlier signal was not treated as current.",
          nextResolution: "Return to the opportunity and review its newly ranked next action."
        });
        return undefined;
      }
    }
    if (selectedIso !== exactEvent.date || selectedEventId !== quoteId) {
      setSelectedIso(exactEvent.date);
      setAnchorIso(exactEvent.date);
      setSelectedEventId(quoteId);
      reportArrivalResolution({ status: "pending" });
      return undefined;
    }

    const target = Array.from(
      dialogRef.current?.querySelectorAll("[data-schedule-event-id]") || []
    ).find((element) => element.dataset.scheduleEventId === quoteId);
    target?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    target?.focus({ preventScroll: true });
    if (target && document.activeElement === target) {
      reportArrivalResolution({
        status: "resolved",
        itemId: quoteId,
        eventDate: exactEvent.date
      });
    } else {
      reportArrivalResolution({
        status: "recovery",
        code: "schedule_focus_failed",
        reason: "The exact opportunity was loaded, but its Schedule detail could not receive focus.",
        consequence: "No alternate event was focused, and no schedule or assignment state changed.",
        nextResolution: "Refresh Schedule, then reopen the exact opportunity action."
      });
    }
    return undefined;
  }, [
    arrivalContext?.intentId,
    arrivalFocus.quoteId,
    exactArrivalActive,
    organizationId,
    reasonsById,
    scheduledEvents,
    selectedEventId,
    selectedIso,
    state.error,
    state.loading,
    state.organizationId,
    state.quotes,
    state.stale,
    state.truncated
  ]);

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
  const selectedEvent = selectedEvents.find((item) => item.id === selectedEventId)
    || selectedEvents[0]
    || null;
  const selectedComparisons = useMemo(() => {
    if (!selectedEvent?.id) return [];
    const eventsById = new Map(scheduledEvents.map((item) => [item.id, item]));
    return (comparisonsById.get(selectedEvent.id) || [])
      .map((comparison) => ({
        ...comparison,
        peer: eventsById.get(comparison.peerId) || null
      }))
      .filter((comparison) => comparison.peer);
  }, [comparisonsById, scheduledEvents, selectedEvent?.id]);
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
        events: events.map((event) => ({
          ...event,
          conflictReasons: Array.from(reasonsById.get(event.id) || [])
        })),
        counts,
        conflicts: dayConflicts.get(iso) || EMPTY_DAY_CONFLICT
      });
    }
    return cells;
  }, [anchorDate, eventsByDate, reasonsById, dayConflicts]);

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

  const weekTimeline = useMemo(
    () => buildWeekTimelineModel(weekDays),
    [weekDays]
  );

  const mobileAgendaDays = useMemo(() => {
    const sourceDays = viewMode === "week"
      ? weekDays
      : monthCells.filter((cell) => cell.inMonth);
    return sourceDays.map((day) => {
      const events = (day.events || eventsByDate.get(day.iso) || []).map((event) => ({
        ...event,
        conflictReasons: Array.isArray(event.conflictReasons)
          ? event.conflictReasons
          : Array.from(reasonsById.get(event.id) || [])
      }));
      return {
        iso: day.iso,
        date: day.date,
        events,
        conflicts: day.conflicts || dayConflicts.get(day.iso) || EMPTY_DAY_CONFLICT
      };
    }).filter((day) => day.events.length > 0 || day.iso === selectedIso);
  }, [dayConflicts, eventsByDate, monthCells, reasonsById, selectedIso, viewMode, weekDays]);

  const visibleConflictEvents = useMemo(() => {
    const visibleDays = viewMode === "week"
      ? weekDays
      : monthCells.filter((cell) => cell.inMonth);
    const seen = new Set();
    return visibleDays.flatMap((day) => day.events || [])
      .filter((event) => {
        if (seen.has(event.id) || (reasonsById.get(event.id)?.size || 0) === 0) return false;
        seen.add(event.id);
        return true;
      });
  }, [monthCells, reasonsById, viewMode, weekDays]);

  const selectDay = (iso, eventId = "") => {
    const nextIso = String(iso || "").trim();
    if (!nextIso) return;
    setSelectedIso(nextIso);
    setSelectedEventId(String(eventId || "").trim());
  };

  const selectEvent = (event) => {
    if (!event?.id || !event?.date) return;
    setSelectedIso(event.date);
    setSelectedEventId(event.id);
  };

  const shift = (amount) => {
    const next = viewMode === "month" ? addMonths(anchorDate, amount) : addDays(anchorDate, amount * 7);
    setAnchorIso(toIsoDate(next));
  };

  const jumpToToday = () => {
    setAnchorIso(todayIso);
    selectDay(todayIso);
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
    if (!open || !embedded || exactArrivalActive || typeof window === "undefined") return undefined;
    const frame = window.requestAnimationFrame(() => {
      routeHeadingRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [embedded, exactArrivalActive, open]);

  const selectedStatusPresentation = selectedEvent
    ? getScheduleStatusPresentation(selectedEvent)
    : null;
  const selectedConflictLabel = selectedEvent?.conflictReasons?.length
    ? selectedEvent.conflictReasons.map((reason) => reasonLabel(reason)).join(" • ")
    : "";

  if (!open) return null;

  return (
    <div
      className={embedded ? "container workspace-route-main embedded-workspace-route" : "modal-overlay"}
      data-layout-overlap-allowed={embedded ? undefined : "true"}
      role={embedded ? "region" : "dialog"}
      aria-modal={embedded ? undefined : "true"}
      aria-labelledby="event-schedule-title"
      data-operations-mode={operationsMode ? "calendar-first" : undefined}
      data-testid={operationsMode ? "operations-calendar" : undefined}
    >
      <div
        ref={dialogRef}
        className={`modal-card schedule-card operations-workspace${embedded ? " workspace-route-card" : ""}`}
        data-calendar-view={viewMode}
        tabIndex={-1}
      >
        <header className="modal-head schedule-page-head">
          <div>
            {surfaceEyebrow ? <p className="eyebrow">{surfaceEyebrow}</p> : null}
            <h2
              id="event-schedule-title"
              ref={routeHeadingRef}
              tabIndex={embedded ? -1 : undefined}
            >
              {surfaceTitle}
            </h2>
            <p className="schedule-page-intro">Plan accepted and booked events from one shared calendar.</p>
          </div>
          <div className="schedule-page-actions">
            <details className="schedule-context-tools" data-testid="operations-tools">
              <summary>Tools</summary>
              <div className="schedule-context-tools-menu">
                {typeof onOpenPeople === "function" ? (
                  <button type="button" className="ghost compact" onClick={onOpenPeople}>People</button>
                ) : null}
                {typeof onOpenReporting === "function" ? (
                  <button type="button" className="ghost compact" onClick={onOpenReporting}>Reporting</button>
                ) : null}
                <button type="button" className="ghost compact" onClick={load} disabled={state.loading}>
                  {state.loading ? "Refreshing…" : "Refresh calendar"}
                </button>
              </div>
            </details>
            {!embedded ? (
              <button
                type="button"
                className="ghost"
                data-modal-initial-focus="true"
                onClick={handleClose}
                disabled={closeBlocked}
              >
                Close
              </button>
            ) : null}
          </div>
        </header>

        {state.error && (
          <div className="schedule-read-recovery" role="alert">
            <p className="error-note">{state.error}</p>
            <button type="button" className="ghost compact" onClick={load} disabled={state.loading}>
              Retry calendar
            </button>
          </div>
        )}
        {feedback && <p className="source-note schedule-feedback" role="status" aria-live="polite">{feedback}</p>}

        {visibleConflictEvents.length > 0 ? (
          <section className="schedule-attention-strip" aria-labelledby="schedule-attention-title">
            <div>
              <p className="eyebrow">Needs attention</p>
              <h3 id="schedule-attention-title">
                {visibleConflictEvents.length} event{visibleConflictEvents.length === 1 ? "" : "s"} need conflict review
              </h3>
              <p>Compare the affected records, then update the underlying opportunity that needs to change.</p>
            </div>
            {selectedEvent?.conflictReasons.length ? null : (
              <button
                type="button"
                className="cta compact"
                onClick={() => {
                  const firstConflict = visibleConflictEvents[0];
                  setAnchorIso(firstConflict.date);
                  selectEvent(firstConflict);
                }}
              >
                Review first conflict
              </button>
            )}
          </section>
        ) : null}

        <div className="schedule-toolbar" aria-label="Calendar controls">
          <div className="schedule-period-controls">
            <button type="button" className="ghost compact" onClick={() => shift(-1)}>Previous</button>
            <button type="button" className="ghost compact" onClick={jumpToToday}>Today</button>
            <button type="button" className="ghost compact" onClick={() => shift(1)}>Next</button>
          </div>
          <strong className="schedule-range">
            {viewMode === "month" ? monthRangeLabel(anchorDate) : weekRangeLabel(anchorDate)}
          </strong>
          <div className="schedule-view-switcher" role="group" aria-label="Calendar view">
            <button
              type="button"
              className={viewMode === "month" ? "cta compact" : "ghost compact"}
              aria-pressed={viewMode === "month"}
              onClick={() => {
                setViewMode("month");
                setAnchorIso(selectedIso);
              }}
            >
              Month
            </button>
            <button
              type="button"
              className={viewMode === "week" ? "cta compact" : "ghost compact"}
              aria-pressed={viewMode === "week"}
              onClick={() => {
                setViewMode("week");
                setAnchorIso(selectedIso);
              }}
            >
              Week
            </button>
          </div>
        </div>

        <div className="schedule-layout" data-view-mode={viewMode}>
          <section className="schedule-grid-panel" aria-label={`${viewMode} calendar`}>
            <section
              className="schedule-mobile-agenda"
              aria-label={`${viewMode} agenda`}
              data-testid="operations-mobile-agenda"
            >
              {mobileAgendaDays.length === 0 ? (
                <p className="muted">No accepted or booked events in this {viewMode}.</p>
              ) : mobileAgendaDays.map((day) => (
                <article key={day.iso} className="schedule-agenda-group" data-agenda-date={day.iso}>
                  <button
                    type="button"
                    className="schedule-agenda-day"
                    aria-current={day.iso === selectedIso ? "date" : undefined}
                    onClick={() => selectDay(day.iso, day.events[0]?.id)}
                  >
                    <strong>{formatScheduleDayLabel(day.iso)}</strong>
                    <span>{day.events.length} event{day.events.length === 1 ? "" : "s"}</span>
                  </button>
                  {day.events.length ? (
                    <ul>
                      {day.events.map((item) => (
                        <li key={item.id} data-exact-event-id={item.id}>
                          <button
                            type="button"
                            aria-pressed={selectedEvent?.id === item.id}
                            onClick={() => selectEvent(item)}
                          >
                            <span>
                              <strong>{item.time || "Time not set"}</strong>
                              <small>{formatWorkspaceText(item.eventName || item.quoteNumber, { emptyLabel: "Untitled event" })}</small>
                            </span>
                            {item.conflictReasons.length ? <em>{item.conflictReasons.map(reasonLabel).join(" · ")}</em> : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </article>
              ))}
            </section>

            <div
              className="schedule-desktop-calendar"
              data-testid={viewMode === "month" ? "operations-month-calendar" : undefined}
            >
              {viewMode === "month" ? (
                <>
                  <div className="schedule-weekday-row" aria-hidden="true">
                    {WEEKDAY_SHORT.map((label) => <span key={label}>{label}</span>)}
                  </div>
                  <div className="schedule-month-grid">
                    {monthCells.map((cell) => {
                      const isSelected = cell.iso === selectedIso;
                      const className = [
                        "schedule-day-cell",
                        cell.inMonth ? "in-month" : "out-month",
                        isSelected ? "selected" : "",
                        cell.counts.booked > 0 ? "has-booked" : "",
                        cell.counts.accepted > 0 ? "has-accepted" : "",
                        cell.conflicts.total > 0 ? "has-conflict" : "",
                        cell.conflicts.capacity > 0 ? "has-capacity" : ""
                      ].filter(Boolean).join(" ");
                      return (
                        <button
                          key={cell.iso}
                          type="button"
                          className={className}
                          aria-current={isSelected ? "date" : undefined}
                          onClick={() => {
                            selectDay(cell.iso, cell.events[0]?.id);
                            if (!cell.inMonth) setAnchorIso(cell.iso);
                          }}
                        >
                          <span className="schedule-day-num">{cell.date.getDate()}</span>
                          <span className="schedule-calendar-event-lines">
                            {cell.events.slice(0, 2).map((item) => (
                              <span key={item.id} className="schedule-calendar-event-line">
                                <strong>{item.time || "TBD"}</strong>
                                <span>{formatWorkspaceText(item.eventName || item.quoteNumber, { emptyLabel: "Untitled event" })}</span>
                              </span>
                            ))}
                            {cell.events.length > 2 ? <small>+{cell.events.length - 2} more</small> : null}
                          </span>
                          <span className="schedule-day-badges">
                            {cell.conflicts.total > 0 ? (
                              <small className="conflict">{cell.conflicts.total} at risk</small>
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                <WeekTimeline
                  model={weekTimeline}
                  selectedIso={selectedIso}
                  selectedEventId={selectedEvent?.id || ""}
                  onSelectDay={selectDay}
                  onSelectEvent={selectEvent}
                />
              )}
            </div>
          </section>

          <aside
            className="schedule-day-panel"
            data-selected-event-id={selectedEvent?.id || undefined}
            data-testid="operations-event-context"
            data-context-placement={viewMode === "month" ? "below-calendar" : "detail-rail"}
          >
            <div className="schedule-selection-context">
              <header className="schedule-day-summary">
                <div>
                  <p className="eyebrow">Selected day</p>
                  <h3>{formatScheduleDayLabel(selectedIso)}</h3>
                </div>
                <p aria-label={`${selectedCounts.booked} booked and ${selectedCounts.accepted} accepted`}>
                  {selectedEvents.length} event{selectedEvents.length === 1 ? "" : "s"}
                </p>
                {selectedDayConflicts.total > 0 ? (
                  <p className="schedule-day-conflict-summary">
                    {[
                      selectedDayConflicts.overlap > 0 ? "Time overlap" : "",
                      selectedDayConflicts.unknown > 0 ? "Missing event time" : "",
                      selectedDayConflicts.capacity > 0 ? "Capacity risk" : ""
                    ].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
              </header>

              {selectedEvents.length > 1 ? (
                <nav className="schedule-event-picker" aria-label="Events on selected day">
                  {selectedEvents.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="schedule-event-picker-item"
                      aria-current={selectedEvent?.id === item.id ? "true" : undefined}
                      onClick={() => selectEvent(item)}
                    >
                      <span>
                        <strong>{item.time || "Time not set"}</strong>
                        <small>{formatWorkspaceText(item.eventName || item.quoteNumber, { emptyLabel: "Untitled event" })}</small>
                      </span>
                      <em>{item.conflictReasons.length ? item.conflictReasons.map(reasonLabel).join(" · ") : item.status}</em>
                    </button>
                  ))}
                </nav>
              ) : null}
            </div>

            {!selectedEvent ? (
              <div className="schedule-empty-selection">
                <h4>No event selected</h4>
                <p className="muted">Choose a day with an accepted or booked event.</p>
                <details className="schedule-operational-disclosure">
                  <summary>
                    <span>Run of show</span>
                    <small>{state.loading ? "Loading" : "No events"}</small>
                  </summary>
                  <div className="schedule-disclosure-body">
                    <EventRunOfShowPanel
                      model={selectedDayRunOfShow}
                      selectedDateLabel={formatScheduleDayLabel(selectedIso)}
                      loading={state.loading}
                      error={state.error}
                      onRetry={load}
                    />
                  </div>
                </details>
              </div>
            ) : (
              <>
                <article
                  key={selectedEvent.id}
                  id={scheduleEventDetailId(selectedEvent.id)}
                  data-schedule-event-id={selectedEvent.id}
                  data-exact-event-id={selectedEvent.id}
                  data-testid="operations-focused-event"
                  tabIndex={-1}
                  className={[
                    "schedule-event-card",
                    "schedule-event-focus",
                    selectedEvent.status,
                    selectedEvent.conflictReasons.length ? "has-conflict" : "",
                    selectedEvent.conflictReasons.includes("capacity") ? "has-capacity" : ""
                  ].filter(Boolean).join(" ")}
                >
                  <header className="schedule-event-focus-head">
                    <div>
                      <p className="eyebrow">Focused event</p>
                      <h4>{formatWorkspaceText(selectedEvent.eventName || selectedEvent.quoteNumber, { emptyLabel: "Untitled event" })}</h4>
                    </div>
                    {typeof onOpenOpportunity === "function" ? (
                      <button
                        type="button"
                        className="cta compact"
                        onClick={() => onOpenOpportunity(selectedEvent.id)}
                        data-exact-event-id={selectedEvent.id}
                      >
                        Open opportunity
                      </button>
                    ) : null}
                  </header>
                  <ScheduleEventFacts item={selectedEvent} compact />
                  <details className="schedule-booking-details">
                    <summary>
                      <span>More event details</span>
                      <small>{selectedStatusPresentation.quote.label} · {selectedStatusPresentation.bookingConfirmation.label}</small>
                    </summary>
                    <dl>
                      <div>
                        <dt>Quote state</dt>
                        <dd>{selectedStatusPresentation.quote.label}</dd>
                      </div>
                      <div>
                        <dt>Booking confirmation</dt>
                        <dd>{selectedStatusPresentation.bookingConfirmation.label}</dd>
                      </div>
                      <div>
                        <dt>Client</dt>
                        <dd>{formatWorkspaceText(selectedEvent.customer, { emptyLabel: "Not recorded" })}</dd>
                      </div>
                      <div>
                        <dt>Dietary notes</dt>
                        <dd>{formatWorkspaceText(selectedEvent.dietaryRestrictions, { emptyLabel: "None recorded" })}</dd>
                      </div>
                      <div>
                        <dt>Quote total</dt>
                        <dd>{formatWorkspaceMoney(selectedEvent.total)}</dd>
                      </div>
                      <div>
                        <dt>Contract</dt>
                        <dd>{formatWorkspaceText(selectedEvent.contractNumber, { emptyLabel: "Pending" })}</dd>
                      </div>
                      <div>
                        <dt>Confirmation</dt>
                        <dd className={[
                          "schedule-confirmation-note",
                          selectedEvent.confirmationStatus === "confirmed" ? "confirmed" : "",
                          selectedEvent.confirmationStatus === "cancelled" ? "cancelled" : ""
                        ].filter(Boolean).join(" ")}
                        >
                          {confirmationLabel(selectedEvent)}
                        </dd>
                      </div>
                    </dl>
                  </details>

                  {selectedEvent.conflictReasons.length > 0 ? (
                    <section
                      className="schedule-conflict-workflow"
                      aria-labelledby={`schedule-conflict-${selectedEvent.id}`}
                      data-testid="operations-conflict-workflow"
                    >
                      <div className="schedule-conflict-workflow-head">
                        <div>
                          <p className="eyebrow">Conflict review</p>
                          <h5 id={`schedule-conflict-${selectedEvent.id}`}>{selectedConflictLabel}</h5>
                        </div>
                        <span>{selectedComparisons.length || 1} related event{selectedComparisons.length === 1 ? "" : "s"}</span>
                      </div>
                      <p className="schedule-conflict-consequence">
                        {selectedComparisons.length > 0
                          ? `${formatWorkspaceText(selectedEvent.quoteNumber, { emptyLabel: "This event" })} conflicts with ${selectedComparisons.map((comparison) => formatWorkspaceText(comparison.peer.quoteNumber, { emptyLabel: "a related event" })).join(", ")} in the current Calendar.`
                          : `The recorded guest count is above the current ${maxCapacity}-guest venue/time threshold.`}
                      </p>
                      {selectedComparisons.length > 0 && typeof onOpenOpportunity === "function" ? (
                        <div className="schedule-conflict-actions">
                          {selectedComparisons.map((comparison) => (
                            <button
                              key={comparison.peerId}
                              type="button"
                              className="ghost compact"
                              onClick={() => onOpenOpportunity(comparison.peer.id)}
                            >
                              Review {formatWorkspaceText(comparison.peer.quoteNumber, { emptyLabel: "related opportunity" })}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {selectedComparisons.length > 0 ? (
                        <details className="schedule-conflict-comparison-disclosure">
                          <summary>
                            <span>Compare event records</span>
                            <small>{selectedComparisons.length + 1} events</small>
                          </summary>
                          <div className="schedule-conflict-comparison-list">
                            {selectedComparisons.map((comparison) => (
                              <article key={comparison.peerId} className="schedule-conflict-comparison">
                                <div>
                                  <small>Current event</small>
                                  <strong>{formatWorkspaceText(selectedEvent.quoteNumber, { emptyLabel: "Quote pending" })}</strong>
                                  <span>{formatWorkspaceText(selectedEvent.time, { emptyLabel: "Time not set" })} · {formatWorkspaceInteger(selectedEvent.guests, { emptyLabel: "Guests not set" })} guests</span>
                                  <span>{formatWorkspaceText(selectedEvent.venue, { emptyLabel: "Venue not set" })}</span>
                                </div>
                                <div>
                                  <small>Compare with</small>
                                  <strong>{formatWorkspaceText(comparison.peer.quoteNumber, { emptyLabel: "Quote pending" })}</strong>
                                  <span>{formatWorkspaceText(comparison.peer.time, { emptyLabel: "Time not set" })} · {formatWorkspaceInteger(comparison.peer.guests, { emptyLabel: "Guests not set" })} guests</span>
                                  <span>{formatWorkspaceText(comparison.peer.venue, { emptyLabel: "Venue not set" })}</span>
                                </div>
                              </article>
                            ))}
                          </div>
                        </details>
                      ) : null}
                      <p className="schedule-conflict-guidance">
                        Resolve this by changing time, duration, venue, guest count, or lifecycle in the affected opportunity. Refreshing Calendar recomputes the conflict from those records.
                      </p>
                    </section>
                  ) : (
                    <p className="schedule-current-note">No time or capacity conflict is present for this event in the current Calendar read.</p>
                  )}
                </article>

                <section className="schedule-operational-disclosures" aria-label="Operational planning">
                  <details className="schedule-operational-disclosure">
                    <summary>
                      <span>Run of show</span>
                      <small>{selectedDayRunOfShow.events?.length || 0} event{selectedDayRunOfShow.events?.length === 1 ? "" : "s"}</small>
                    </summary>
                    <div className="schedule-disclosure-body">
                      <EventRunOfShowPanel
                        model={selectedDayRunOfShow}
                        selectedDateLabel={formatScheduleDayLabel(selectedIso)}
                        loading={state.loading}
                        error={state.error}
                        onRetry={load}
                      />
                    </div>
                  </details>

                  <details className="schedule-operational-disclosure">
                    <summary>
                      <span>Production</span>
                      <small>{selectedEvent.productionChecklist.completed}/{selectedEvent.productionChecklist.total} complete</small>
                    </summary>
                    <div className="schedule-disclosure-body schedule-production-checklist">
                      <progress
                        max={selectedEvent.productionChecklist.total}
                        value={selectedEvent.productionChecklist.completed}
                      >
                        {selectedEvent.productionChecklist.percent}%
                      </progress>
                      <div className="schedule-production-items">
                        {selectedEvent.productionChecklist.items.map((checklistItem) => (
                          <label key={`${selectedEvent.id}-${checklistItem.id}`}>
                            <input
                              type="checkbox"
                              checked={checklistItem.completed}
                              onChange={(event) => handleProductionChecklistToggle(
                                selectedEvent.id,
                                checklistItem.id,
                                event.target.checked
                              )}
                              disabled={savingChecklistId === selectedEvent.id}
                            />
                            <span>{checklistItem.label}</span>
                            <small>{checklistItem.group}</small>
                          </label>
                        ))}
                      </div>
                    </div>
                  </details>

                  <details className="schedule-operational-disclosure">
                    <summary>
                      <span>Kitchen timing</span>
                      <small>{selectedEvent.kitchenCheckpoints.length} checkpoint{selectedEvent.kitchenCheckpoints.length === 1 ? "" : "s"}</small>
                    </summary>
                    <div className="schedule-disclosure-body">
                      {selectedEvent.kitchenCheckpoints.length > 0 ? (
                        <div className="schedule-checkpoints">
                          <div className="schedule-checkpoint-list">
                            {selectedEvent.kitchenCheckpoints.map((checkpoint) => (
                              <div key={`${selectedEvent.id}-${checkpoint.id}`} className="schedule-checkpoint-item">
                                <input
                                  type="text"
                                  value={checkpoint.label}
                                  maxLength={80}
                                  onChange={(event) => handleCheckpointFieldChange(
                                    selectedEvent.id,
                                    checkpoint.id,
                                    "label",
                                    event.target.value
                                  )}
                                  disabled={savingCheckpointId === selectedEvent.id}
                                  aria-label={`${checkpoint.id} label`}
                                />
                                <input
                                  type="time"
                                  value={checkpoint.timeValue}
                                  onChange={(event) => handleCheckpointFieldChange(
                                    selectedEvent.id,
                                    checkpoint.id,
                                    "time",
                                    event.target.value
                                  )}
                                  disabled={savingCheckpointId === selectedEvent.id}
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
                              onClick={() => handleSaveCheckpoints(selectedEvent.id)}
                              disabled={savingCheckpointId === selectedEvent.id}
                            >
                              {savingCheckpointId === selectedEvent.id ? "Saving…" : "Save checkpoints"}
                            </button>
                            <button
                              type="button"
                              className="ghost compact"
                              onClick={() => handleResetCheckpoints(selectedEvent.id)}
                              disabled={savingCheckpointId === selectedEvent.id}
                            >
                              Reset defaults
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="schedule-checkpoint-hint">Add an event start time to generate kitchen checkpoints.</p>
                      )}
                    </div>
                  </details>

                  <details className="schedule-operational-disclosure">
                    <summary>
                      <span>Staffing</span>
                      <small>{selectedEvent.staffLead || "Unassigned"}</small>
                    </summary>
                    <div className="schedule-disclosure-body">
                      <StaffLeadChoiceField
                        staffLeads={availableStaffLeads}
                        value={selectedEvent.staffLead}
                        disabled={Boolean(assigningId)}
                        onChange={(lead) => handleAssignStaff(selectedEvent.id, lead)}
                        onRecover={() => void load()}
                      />
                      <section className="schedule-staff-board">
                        <div className="schedule-staff-head">
                          <h4>Staff leads for this day</h4>
                          <p className="source-note">Drag an event into a lane, or use its Staff lead field.</p>
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
                            ].filter(Boolean).join(" ");
                            return (
                              <div
                                key={laneGlow ? `${laneKey}-glow-${laneGlow.runId}` : laneKey}
                                className={laneClass}
                                data-tone={laneGlow ? laneGlow.tone : undefined}
                                data-lead-availability={lane.available ? "available" : "stale"}
                                onAnimationEnd={laneGlow ? (event) => {
                                  if (event.animationName !== "schedule-lane-glow") return;
                                  setDropFeedback((prev) => (
                                    prev && prev.runId === laneGlow.runId ? null : prev
                                  ));
                                } : undefined}
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
                                        ].filter(Boolean).join(" ")}
                                        draggable={!assigningId}
                                        onDragStart={(event) => handleDragStart(event, item.id)}
                                        disabled={Boolean(assigningId)}
                                        onClick={() => selectEvent(item)}
                                        aria-label={`Focus event details for ${formatWorkspaceText(item.quoteNumber, { emptyLabel: "quote number pending" })}`}
                                      >
                                        <strong>{formatWorkspaceText(item.quoteNumber, { emptyLabel: "Quote number pending" })}</strong>
                                        <span>
                                          {formatWorkspaceText(item.time, { emptyLabel: "Time not set" })}
                                          {" • "}{formatWorkspaceInteger(item.guests, { emptyLabel: "Guest count not set" })}
                                          {hasWorkspaceNumber(item.guests) ? " guests" : ""}
                                        </span>
                                        {item.conflictReasons.length > 0 ? (
                                          <small>{item.conflictReasons.map(reasonLabel).join(" · ")}</small>
                                        ) : null}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    </div>
                  </details>
                </section>
              </>
            )}
          </aside>
        </div>

        <details className="schedule-evidence-disclosure">
          <summary>About this calendar</summary>
          <div>
            <p>Calendar data: {getScheduleSourceLabel(state)}.</p>
            <p>Capacity alerts use the current {maxCapacity}-guest venue/time threshold.</p>
            <p>Conflict alerts are recalculated from accepted and booked event records; they are not manually resolved.</p>
          </div>
        </details>
      </div>
    </div>
  );
}

export default function EventScheduleModal(props) {
  return <EventScheduleView {...props} presentation="modal" />;
}
