import { useEffect, useMemo, useState } from "react";
import {
  STAFF_ROLES,
  createAvailabilityWindow,
  createQualification,
  createStaffRecordDraft,
  dispatchStaffInvitation,
  getStaffDirectory,
  previewStaffInvitation,
  saveStaffRecord,
  withStaffRole
} from "../lib/staffDirectoryClient";
import {
  buildStaffBriefing,
  buildStaffBriefingEmail,
  exportStaffBriefingSheet
} from "../lib/staffBriefingSheet";
import "./staffWorkspace.css";

const STAFF_ICON_DRAWINGS = Object.freeze({
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M7.5 3v4M16.5 3v4M3.5 9.5h17" /></>,
  chef: <><path d="M7 9.5c-2.8 0-3.5-4.2-.8-5.3A4.8 4.8 0 0 1 15 4a3.2 3.2 0 0 1 2 5.5" /><path d="M7 9.5h10l-1 10H8zM9.5 16h5" /></>,
  dollar: <><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5c-1-1.3-5.8-1.2-5.8 1.1 0 2.9 6.1 1.4 6.1 4.5 0 2.6-5 3-7 .8M12 5.5v13" /></>,
  download: <><path d="M12 3v12M7.5 10.5 12 15l4.5-4.5M4 19.5h16" /></>,
  envelope: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>,
  envelopeOpen: <><path d="m3 10 9-7 9 7v10H3zM3.5 10.5 12 16l8.5-5.5" /><path d="m4 19 6.2-5M20 19l-6.2-5" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></>,
  location: <><path d="M20 10c0 5.4-8 11-8 11S4 15.4 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
  bartender: <><path d="M4 5h16l-8 8zM12 13v7M8 20h8" /><path d="m7 8 10 0" /></>,
  note: <><path d="M5 3.5h11l3 3V20H5zM16 3.5V7h3M8 11h8M8 15h5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  printer: <><path d="M7 8V3.5h10V8M7 17H4V9h16v8h-3M7 14h10v6.5H7z" /><path d="M17 11h.01" /></>,
  star: <path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6-4.5-4.2 6.1-.7z" />,
  trash: <><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13M10 10v6M14 10v6" /></>,
  tray: <><path d="M4 16h16l-2 4H6zM6 16a6 6 0 0 1 12 0M12 7V5" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></>
});

function StaffIcon({ name, size = 20, weight = "regular", ...props }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={weight === "bold" ? 2.2 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      {...props}
    >
      {STAFF_ICON_DRAWINGS[name]}
    </svg>
  );
}

function staffIcon(name) {
  return function StaffRouteIcon(props) {
    return <StaffIcon name={name} {...props} />;
  };
}

const CalendarBlank = staffIcon("calendar");
const CookingPot = staffIcon("chef");
const CurrencyDollar = staffIcon("dollar");
const DownloadSimple = staffIcon("download");
const EnvelopeOpen = staffIcon("envelopeOpen");
const EnvelopeSimple = staffIcon("envelope");
const MagnifyingGlass = staffIcon("search");
const MapPin = staffIcon("location");
const Martini = staffIcon("bartender");
const NotePencil = staffIcon("note");
const Plus = staffIcon("plus");
const Printer = staffIcon("printer");
const StarFour = staffIcon("star");
const Trash = staffIcon("trash");
const Tray = staffIcon("tray");
const UserCircle = staffIcon("user");

const ROLE_ICONS = Object.freeze({
  lead: StarFour,
  server: Tray,
  chef: CookingPot,
  bartender: Martini
});

const ROLE_LABELS = Object.freeze({
  lead: "Event lead",
  server: "Server",
  chef: "Chef",
  bartender: "Bartender"
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeError(error, fallback) {
  return String(error?.message || fallback).replace(/^FirebaseError:\s*/iu, "").trim();
}

function currency(value, code = "USD") {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: code }).format(Number(value || 0));
  } catch {
    return `$${Number(value || 0).toFixed(2)}`;
  }
}

function localDateTime(iso) {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  const offset = parsed.getTimezoneOffset() * 60_000;
  return new Date(parsed.getTime() - offset).toISOString().slice(0, 16);
}

function exactISO(localValue) {
  if (!localValue) return "";
  const parsed = new Date(localValue);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function assignmentLabel(assignment) {
  const eventName = String(assignment?.event?.name || "Event").trim();
  const date = String(assignment?.event?.date || "Date pending").trim();
  return `${eventName} · ${date}`;
}

function dateLabel(value, options = {}) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Date not recorded";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: options.year ? "numeric" : undefined,
    weekday: options.weekday ? "short" : undefined
  }).format(parsed);
}

function timeRange(startValue, endValue) {
  const start = new Date(startValue);
  const end = new Date(endValue);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "Time not recorded";
  const formatter = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
  return `${formatter.format(start)}–${formatter.format(end)}`;
}

function activityTime(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Time not recorded";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(parsed);
}

function calendarDateKey(value = new Date()) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value)) return value;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function needsAttention(entry) {
  return Boolean(entry?.profile?.active) && (
    entry?.record?.contact?.emailStatus !== "verified"
    || !entry?.record?.contact?.emergencyContactPhone
    || Number(entry?.record?.compensation?.hourlyRate || 0) <= 0
    || !entry?.profile?.availabilityWindows?.length
  );
}

function qualificationPresentation(qualification) {
  const status = String(qualification?.status || "").trim().toLowerCase();
  if (["missing", "pending"].includes(status)) return { label: "Missing", tone: "warning" };
  const expiryMs = Date.parse(qualification?.expiresOn || "");
  if (status === "expired" || (Number.isFinite(expiryMs) && expiryMs < Date.now())) {
    return { label: "Expired", tone: "warning" };
  }
  if (Number.isFinite(expiryMs) && expiryMs - Date.now() <= 45 * 24 * 60 * 60 * 1000) {
    return { label: "Expiring", tone: "warning" };
  }
  return status === "current"
    ? { label: "Verified", tone: "good" }
    : { label: "Missing", tone: "warning" };
}

function initials(entry) {
  const name = String(entry?.record?.preferredName || entry?.profile?.displayName || "Staff").trim();
  return name.split(/\s+/u).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
}

function RoleIcons({ roles = [], interactive = false, onToggle = null }) {
  return (
    <span className={`staff-role-icons${interactive ? " is-interactive" : ""}`} aria-label="Staff roles">
      {STAFF_ROLES.map((role) => {
        const enabled = roles.includes(role);
        if (!interactive && !enabled) return null;
        const Icon = ROLE_ICONS[role];
        return interactive ? (
          <button
            key={role}
            type="button"
            className={enabled ? "is-selected" : ""}
            aria-label={`${enabled ? "Remove" : "Add"} ${ROLE_LABELS[role]} role`}
            aria-pressed={enabled}
            title={ROLE_LABELS[role]}
            onClick={() => onToggle?.(role, !enabled)}
          >
            <Icon size={20} weight={enabled ? "fill" : "regular"} aria-hidden="true" />
          </button>
        ) : (
          <span key={role} title={ROLE_LABELS[role]} aria-label={ROLE_LABELS[role]}>
            <Icon size={18} weight="duotone" aria-hidden="true" />
          </span>
        );
      })}
    </span>
  );
}

function Field({ label, children, hint = "", wide = false }) {
  return (
    <label className={`staff-field${wide ? " is-wide" : ""}`}>
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function Section({ icon: Icon, title, description, children, open = false }) {
  return (
    <details className="staff-record-section" open={open}>
      <summary>
        <Icon size={20} weight="duotone" aria-hidden="true" />
        <span><strong>{title}</strong><small>{description}</small></span>
      </summary>
      <div className="staff-record-section__body">{children}</div>
    </details>
  );
}

export default function StaffWorkspace({ organizationId = "", organizationName = "" }) {
  const [directory, setDirectory] = useState(null);
  const [state, setState] = useState({ status: "loading", message: "Bringing your team together…" });
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [draft, setDraft] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState("");
  const [invitationPreview, setInvitationPreview] = useState(null);
  const [invitationBusy, setInvitationBusy] = useState(false);
  const [rosterSearch, setRosterSearch] = useState("");
  const [rosterFilter, setRosterFilter] = useState("all");
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  const load = async ({ recovery = false } = {}) => {
    setState({ status: recovery ? "recovery" : "loading", message: recovery ? "Freshening up your team…" : "Bringing your team together…" });
    try {
      const result = await getStaffDirectory({ organizationId });
      setDirectory(result);
      const firstId = selectedStaffId || result.records[0]?.profile?.staffId || "";
      setSelectedStaffId(firstId);
      const selected = result.records.find((entry) => entry.profile.staffId === firstId) || null;
      setDraft(selected ? clone(selected) : null);
      setDirty(false);
      setState(result.storage === "firebase"
        ? { status: result.records.length ? "success" : "empty", message: result.records.length ? "Team profiles loaded." : "Ready to welcome your first teammate." }
        : result.storage === "local_fixture"
          ? { status: "context", message: "Your review roster is ready. Live Firebase staff data is unchanged." }
          : { status: "unavailable", message: "Connect your organization to start bringing the team together." });
    } catch (error) {
      setState({ status: "error", message: safeError(error, "Staff records could not be loaded.") });
    }
  };

  useEffect(() => {
    void load();
    // Loading is scoped to the exact active organization.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  const assignments = useMemo(() => (
    (() => {
      const ordered = (directory?.assignments || []).filter((item) => item.staffId === selectedStaffId)
        .sort((left, right) => String(left.eventWindow?.startAtISO || "").localeCompare(String(right.eventWindow?.startAtISO || "")));
      const nowMs = Date.now();
      const upcoming = ordered.filter((item) => Date.parse(item.eventWindow?.endAtISO || item.eventWindow?.startAtISO || item.event?.date || "") >= nowMs);
      return upcoming.length ? upcoming : ordered.reverse();
    })()
  ), [directory?.assignments, selectedStaffId]);
  const selectedAssignment = assignments.find((item) => item.assignmentId === selectedAssignmentId)
    || assignments[0]
    || null;

  useEffect(() => {
    setSelectedAssignmentId(assignments[0]?.assignmentId || "");
    setInvitationPreview(null);
  }, [selectedStaffId, assignments[0]?.assignmentId]);

  useEffect(() => {
    setInvitationPreview(null);
  }, [selectedAssignmentId, draft?.record?.revision]);

  const choose = (entry) => {
    if (dirty && !window.confirm("Discard the unsaved staff record changes?")) return;
    setSelectedStaffId(entry.profile.staffId);
    setDraft(clone(entry));
    setDirty(false);
    setMobileDetailOpen(true);
    setState((current) => ({ ...current, message: "Team profile open." }));
  };

  const addStaff = () => {
    if (dirty && !window.confirm("Discard the unsaved staff record changes?")) return;
    const staffId = `staff-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const entry = createStaffRecordDraft({ organizationId, staffId });
    setSelectedStaffId(staffId);
    setDraft(entry);
    setDirty(true);
    setState({ status: "editing", message: "Great—add their details and welcome them to the team." });
  };

  const patchProfile = (key, value) => {
    setDraft((current) => ({ ...current, profile: { ...current.profile, [key]: value } }));
    setDirty(true);
  };
  const patchRecord = (key, value) => {
    setDraft((current) => ({ ...current, record: { ...current.record, [key]: value } }));
    setDirty(true);
  };
  const patchGroup = (group, key, value) => {
    setDraft((current) => ({
      ...current,
      record: { ...current.record, [group]: { ...current.record[group], [key]: value } }
    }));
    setDirty(true);
  };

  const save = async () => {
    if (!draft?.profile?.displayName?.trim()) {
      setState({ status: "error", message: "Add a display name before saving this staff record." });
      return;
    }
    setState({ status: "saving", message: "Saving this teammate…" });
    try {
      const result = await saveStaffRecord(draft, { organizationId });
      const entry = clone(result.entry);
      setDirectory((current) => {
        const records = [...(current?.records || [])];
        const index = records.findIndex((item) => item.profile.staffId === entry.profile.staffId);
        if (index >= 0) records[index] = entry;
        else records.push(entry);
        records.sort((left, right) => left.profile.displayName.localeCompare(right.profile.displayName));
        return { ...current, records };
      });
      setDraft(entry);
      setDirty(false);
      setState({ status: "receipt", message: `${entry.profile.displayName} is saved. Their profile and private details were recorded separately.` });
    } catch (error) {
      setState({ status: "error", message: safeError(error, "The staff record could not be saved.") });
    }
  };

  const briefing = () => buildStaffBriefing({
    entry: draft,
    assignment: selectedAssignment,
    organizationName
  });
  const downloadSheet = () => {
    try {
      const result = exportStaffBriefingSheet(briefing());
      setState({ status: "context", message: `Downloaded ${result.filename}. Attach it if you use the default email app.` });
    } catch (error) {
      setState({ status: "error", message: safeError(error, "The staff briefing sheet could not be generated.") });
    }
  };
  const printSheet = () => {
    try {
      exportStaffBriefingSheet(briefing(), { output: "print" });
      setState({ status: "context", message: "Opened the current staff briefing in a printable PDF tab." });
    } catch (error) {
      setState({ status: "error", message: safeError(error, "The staff briefing print preview could not be opened.") });
    }
  };
  const openEmail = () => {
    try {
      const email = buildStaffBriefingEmail(briefing());
      window.location.assign(email.href);
      setState({
        status: "context",
        message: "Opened your default email app with the current briefing. This does not prove the email was sent or delivered. Attach the downloaded sheet if needed."
      });
    } catch (error) {
      setState({ status: "error", message: safeError(error, "The default email app could not be opened.") });
    }
  };

  const currentInvitation = useMemo(() => (
    (directory?.invitations || [])
      .filter((item) => item.staffId === selectedStaffId && item.assignmentId === selectedAssignment?.assignmentId)
      .sort((left, right) => String(right.updatedAtISO || "").localeCompare(String(left.updatedAtISO || "")))[0] || null
  ), [directory?.invitations, selectedAssignment?.assignmentId, selectedStaffId]);

  const previewInvitation = async () => {
    if (dirty) {
      setState({ status: "error", message: "Save the private staff record before previewing an invitation." });
      return;
    }
    setInvitationBusy(true);
    setState({ status: "pending", message: "Building the invitation from the exact confirmed assignment…" });
    try {
      const result = await previewStaffInvitation({ organizationId, entry: draft, assignment: selectedAssignment });
      setInvitationPreview(result);
      setState({ status: "preview", message: "Invitation preview is ready. Nothing has been sent." });
    } catch (error) {
      setState({ status: "error", message: safeError(error, "The staff invitation could not be previewed.") });
    } finally {
      setInvitationBusy(false);
    }
  };

  const dispatchInvitation = async () => {
    if (!invitationPreview) return;
    setInvitationBusy(true);
    setState({ status: "pending", message: "Sending this exact invitation to the private email on file…" });
    try {
      const result = await dispatchStaffInvitation({ previewResult: invitationPreview });
      setDirectory((current) => {
        const invitations = [...(current?.invitations || [])];
        const index = invitations.findIndex((item) => item.invitationId === result.invitation.invitationId);
        if (index >= 0) invitations[index] = result.invitation;
        else invitations.push(result.invitation);
        return { ...current, invitations };
      });
      setInvitationPreview(null);
      const invitationState = result.invitation.state;
      setState(invitationState === "provider_accepted"
        ? { status: "receipt", message: "The email provider accepted this invitation. Delivery and the staff response are still pending." }
        : invitationState === "outcome_ambiguous"
          ? { status: "recovery", message: "The provider outcome is uncertain. QuotePilot will not send another invitation automatically." }
          : { status: "error", message: "The provider did not accept this invitation. No delivery or acknowledgement is claimed." });
    } catch (error) {
      setState({ status: "error", message: safeError(error, "The staff invitation could not be dispatched.") });
    } finally {
      setInvitationBusy(false);
    }
  };

  const deliveryLabel = currentInvitation
    ? ({
        dispatching: "Dispatch pending",
        outcome_ambiguous: "Provider outcome uncertain",
        provider_accepted: "Provider accepted",
        delivered: "Delivered",
        bounced: "Bounced",
        complained: "Complaint received",
        definite_failure: "Not accepted by provider"
      }[currentInvitation.state] || "Delivery state unavailable")
    : "Not dispatched";
  const acknowledgementLabel = currentInvitation?.acknowledgement?.state === "accepted"
    ? "Accepted by staff"
    : currentInvitation?.acknowledgement?.state === "declined"
      ? "Declined by staff"
      : "Awaiting staff response";

  const records = directory?.records || [];
  const allAssignments = directory?.assignments || [];
  const currentDay = calendarDateKey();
  const activeCount = records.filter((entry) => entry.profile.active).length;
  const needsAttentionCount = records.filter(needsAttention).length;
  const availableCount = records.filter((entry) => (
    entry.profile.active
    && !needsAttention(entry)
    && entry.profile.availabilityWindows?.some((window) => window.state === "available")
  )).length;
  const assignedTodayCount = new Set(allAssignments
    .filter((assignment) => calendarDateKey(assignment.eventWindow?.startAtISO || assignment.event?.date || "") === currentDay)
    .map((assignment) => assignment.staffId)).size;
  const assignmentsForStaff = (staffId) => {
    const ordered = allAssignments
      .filter((assignment) => assignment.staffId === staffId)
      .sort((left, right) => String(left.eventWindow?.startAtISO || "").localeCompare(String(right.eventWindow?.startAtISO || "")));
    const nowMs = Date.now();
    const upcoming = ordered.filter((assignment) => Date.parse(assignment.eventWindow?.endAtISO || assignment.eventWindow?.startAtISO || assignment.event?.date || "") >= nowMs);
    return upcoming.length ? upcoming : ordered.reverse();
  };
  const operationalState = (entry) => {
    if (!entry.profile.active) return { key: "inactive", label: "Inactive", tone: "neutral" };
    if (needsAttention(entry)) return { key: "needs_attention", label: "Needs review", tone: "warning" };
    if (assignmentsForStaff(entry.profile.staffId).length) return { key: "assigned", label: "Assigned", tone: "assigned" };
    if (entry.profile.availabilityWindows?.some((window) => window.state === "available")) {
      return { key: "available", label: "Available", tone: "good" };
    }
    return { key: "unavailable", label: "Unavailable", tone: "neutral" };
  };
  const normalizedRosterSearch = rosterSearch.trim().toLowerCase();
  const visibleRecords = records.filter((entry) => {
    const searchable = [
      entry.profile.displayName,
      entry.record.preferredName,
      entry.record.contact.email,
      Array.isArray(entry.profile.capabilities) ? entry.profile.capabilities.join(" ") : ""
    ].join(" ").toLowerCase();
    const matchesSearch = !normalizedRosterSearch || searchable.includes(normalizedRosterSearch);
    const entryState = operationalState(entry).key;
    const matchesFilter = rosterFilter === "all"
      || rosterFilter === entryState;
    return matchesSearch && matchesFilter;
  });
  const selectedDisplayName = draft
    ? draft.record.preferredName || draft.profile.displayName || "New staff member"
    : "";
  const selectedRoles = draft?.profile?.capabilities || [];
  const contactVerified = draft?.record?.contact?.emailStatus === "verified";
  const emergencyReady = Boolean(draft?.record?.contact?.emergencyContactPhone);
  const hourlyRate = Number(draft?.record?.compensation?.hourlyRate || 0);
  const assignmentAccepted = currentInvitation?.acknowledgement?.state === "accepted";
  const availabilityWindows = draft?.profile?.availabilityWindows || [];
  const availabilityProvided = availabilityWindows.length > 0;
  const qualificationReady = Boolean(draft?.record?.qualifications?.length)
    && draft.record.qualifications.every((qualification) => !["expired", "pending"].includes(qualification.status));
  const readinessItems = draft ? [
    { label: "Contact information", value: contactVerified ? "Complete" : "Needs review", state: contactVerified ? "complete" : "warning" },
    { label: "Emergency contact", value: emergencyReady ? "Complete" : "Not provided", state: emergencyReady ? "complete" : "warning" },
    { label: "Rate configured", value: hourlyRate > 0 ? "Complete" : "Not configured", state: hourlyRate > 0 ? "complete" : "warning" },
    { label: "Availability provided", value: availabilityProvided ? "Complete" : "Not provided", state: availabilityProvided ? "complete" : "warning" },
    { label: "Qualifications", value: qualificationReady ? "Complete" : "Needs review", state: qualificationReady ? "complete" : "warning" },
    { label: "Acknowledgements", value: !selectedAssignment ? "Not applicable" : assignmentAccepted ? "Complete" : "Pending", state: !selectedAssignment ? "neutral" : assignmentAccepted ? "complete" : "warning" }
  ] : [];
  const selectedReadinessCompleteCount = readinessItems.filter((item) => item.state === "complete").length;
  const selectedReadinessTotal = readinessItems.length;
  const assignmentSteps = [
    ["Invited", Boolean(currentInvitation)],
    ["Accepted", assignmentAccepted],
    ["Briefed", currentInvitation?.state === "provider_accepted" || currentInvitation?.state === "delivered" || assignmentAccepted],
    ["Completed", selectedAssignment?.state === "completed"]
  ];
  const focusStaffDetails = () => {
    if (typeof document === "undefined") return;
    const behavior = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    const editor = document.getElementById("staff-detail-sections");
    if (editor) editor.open = true;
    editor?.scrollIntoView({ block: "start", behavior });
  };
  const preferredContactLabel = ({
    email: "Email",
    phone: "Phone",
    either: "Either"
  }[draft?.record?.contact?.preferredChannel] || "Email");
  const selectedOperationalState = draft ? operationalState(draft) : null;
  const selectedActivities = [
    currentInvitation?.acknowledgement?.respondedAtISO ? {
      event: currentInvitation.acknowledgement.state === "accepted" ? "Assignment acknowledged" : "Assignment response recorded",
      value: selectedAssignment?.event?.name || "Assigned event",
      at: currentInvitation.acknowledgement.respondedAtISO,
      source: "Staff portal"
    } : null,
    currentInvitation?.updatedAtISO ? {
      event: "Invitation status updated",
      value: deliveryLabel,
      at: currentInvitation.updatedAtISO,
      source: "Email provider"
    } : null
  ].filter(Boolean);
  return (
    <main className="container workspace-route-main staff-workspace" data-surface-purpose="clarify advance resolve reveal_context">
      <div className="staff-organization-bar">
        <strong>{organizationName || "Your catering team"}</strong>
        <div
          className={`staff-workspace__status is-${state.status}`}
          role={state.status === "error" ? "alert" : "status"}
          aria-live="polite"
          data-capability-state={state.status}
        >
          <span>{state.status === "success" ? "Team profiles are here" : state.message}</span>
          {["error", "unavailable"].includes(state.status) ? (
            <button type="button" className="ghost compact" onClick={() => void load({ recovery: true })}>Refresh the team</button>
          ) : null}
        </div>
      </div>

      <section className="staff-command-bar" aria-label="Staff operations summary">
        <div className="staff-command-bar__topline">
          <div className="staff-command-bar__copy">
            <p className="staff-kicker">Your event team</p>
            <h1>People</h1>
          </div>
          <dl className="staff-command-metrics" aria-label="Staff operating metrics">
            <div>
              <dt>Active</dt>
              <dd>{activeCount}</dd>
            </div>
            <div>
              <dt>Available</dt>
              <dd>{availableCount}</dd>
            </div>
            <div>
              <dt>Assigned today</dt>
              <dd>{assignedTodayCount}</dd>
            </div>
            <div className="is-attention">
              <dt>Next to complete</dt>
              <dd>{needsAttentionCount}</dd>
            </div>
          </dl>
        </div>
        <div className="staff-command-tools">
          <label className="staff-command-search">
            <MagnifyingGlass size={18} aria-hidden="true" />
            <span className="sr-only">Search staff</span>
            <input
              type="search"
              value={rosterSearch}
              placeholder="Find a teammate…"
              onChange={(event) => setRosterSearch(event.target.value)}
            />
          </label>
          <div className="staff-command-filters" role="group" aria-label="Staff roster filters">
            <span><span className="staff-ui-glyph" aria-hidden="true">≡</span> Filters</span>
            <button type="button" className={rosterFilter === "all" ? "is-selected" : ""} onClick={() => setRosterFilter("all")}>All</button>
            <button type="button" className={rosterFilter === "needs_attention" ? "is-selected" : ""} onClick={() => setRosterFilter("needs_attention")}>Next to complete</button>
            <button type="button" className={rosterFilter === "available" ? "is-selected" : ""} onClick={() => setRosterFilter("available")}>Available</button>
            <button type="button" className={rosterFilter === "assigned" ? "is-selected" : ""} onClick={() => setRosterFilter("assigned")}>Assigned</button>
          </div>
          <button type="button" className="staff-command-add" onClick={addStaff} disabled={state.status === "unavailable"}>
            <Plus size={18} aria-hidden="true" /> Welcome a teammate
          </button>
        </div>
      </section>

      <div className={`staff-workspace__layout${mobileDetailOpen ? " is-mobile-detail-open" : ""}`}>
        <aside className="staff-roster" aria-label="Staff roster">
          <header className="staff-workspace__header">
            <div>
              <p className="eyebrow">Roster</p>
              <h2>People</h2>
            </div>
            <strong>{visibleRecords.length} shown</strong>
          </header>
          {visibleRecords.length ? (
            <ul>
              {visibleRecords.map((entry) => {
                const entryAssignments = assignmentsForStaff(entry.profile.staffId);
                const nextAssignment = entryAssignments[0];
                const nextAvailability = entry.profile.availabilityWindows?.find((window) => window.state === "available");
                const entryState = operationalState(entry);
                const rate = Number(entry.record.compensation.hourlyRate || 0);
                return (
                  <li key={entry.profile.staffId}>
                    <button
                      type="button"
                      className={selectedStaffId === entry.profile.staffId ? "is-selected" : ""}
                      onClick={() => choose(entry)}
                      aria-current={selectedStaffId === entry.profile.staffId ? "true" : undefined}
                    >
                      <span className="staff-avatar">
                        {entry.record.photoUrl ? <img src={entry.record.photoUrl} alt="" /> : initials(entry)}
                      </span>
                      <span className="staff-roster__identity">
                        <span className="staff-roster__name-line">
                          <strong>{entry.record.preferredName || entry.profile.displayName}</strong>
                          <em data-tone={entryState.tone}>{entryState.label}</em>
                        </span>
                        <small>{entry.profile.capabilities.map((role) => ROLE_LABELS[role] || role).join(" · ") || "Role not set"}</small>
                        <small className={entryState.key === "needs_attention" ? "staff-roster__warning" : "staff-roster__meta"}>
                          {entryState.key === "needs_attention"
                            ? !entry.record.contact.emergencyContactPhone ? "Emergency contact not provided" : Number(entry.record.compensation.hourlyRate || 0) <= 0 ? "Rate not configured" : !entry.profile.availabilityWindows?.length ? "Availability not provided" : "Contact needs review"
                            : nextAssignment ? `${dateLabel(nextAssignment.eventWindow?.startAtISO || nextAssignment.event?.date)} · ${nextAssignment.event?.name || "Assigned event"}`
                              : nextAvailability ? `${dateLabel(nextAvailability.startAtISO)} · ${timeRange(nextAvailability.startAtISO, nextAvailability.endAtISO)}`
                                : "No upcoming availability"}
                        </small>
                      </span>
                      <span className="staff-roster__rate">
                        {rate > 0 ? <>{currency(rate, entry.record.compensation.currency)}<small>/hr</small></> : <small>Not set</small>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="staff-roster__empty">
              <UserCircle size={30} aria-hidden="true" />
              <p>{records.length ? "No teammates match this view yet." : "Your first teammate can start right here."}</p>
              <button type="button" className="ghost" onClick={addStaff}>Welcome the first person</button>
            </div>
          )}
        </aside>

        <section className="staff-record staff-detail-pane" aria-label="Selected staff record">
          {draft ? (
            <>
              <button type="button" className="staff-mobile-back" onClick={() => setMobileDetailOpen(false)}>
                <span className="staff-ui-glyph" aria-hidden="true">←</span> Back to staff
              </button>
              <header className="staff-record__identity">
                <span className="staff-avatar is-large">
                  {draft.record.photoUrl ? <img src={draft.record.photoUrl} alt="" /> : initials(draft)}
                </span>
                <div>
                  <p className="eyebrow">Team profile</p>
                  <h2>{selectedDisplayName}</h2>
                  <p className="staff-profile-subtitle">
                    {selectedRoles.map((role) => ROLE_LABELS[role] || role).join(" · ") || "Role not set"} · {draft.profile.active ? "Active" : "Inactive"}
                  </p>
                  <strong className="staff-primary-state" data-tone={selectedOperationalState?.tone}>{selectedOperationalState?.label}</strong>
                </div>
                <div className="staff-record__controls">
                  <div className="staff-profile-actions">
                    <button type="button" className="cta" disabled={!selectedAssignment || invitationBusy || dirty} onClick={() => void previewInvitation()}>
                      {selectedAssignment ? "Review assignment" : "Assign staff"}
                    </button>
                    <button type="button" className="ghost staff-more-button" aria-label="More staff actions" onClick={focusStaffDetails}><span className="staff-ui-glyph is-more" aria-hidden="true">•••</span></button>
                  </div>
                  <div className="staff-record__save">
                    <button type="button" className="ghost compact" onClick={() => void save()} disabled={!dirty || state.status === "saving"}>
                      {state.status === "saving" ? "Saving…" : dirty ? "Save changes" : "Saved"}
                    </button>
                    <small>{dirty ? "Unsaved changes" : `Record revision ${draft.record.revision || 0}`}</small>
                  </div>
                </div>
              </header>

              <nav className="staff-profile-tabs" aria-label="Staff profile sections">
                <a href="#staff-overview">Overview</a>
                <a href="#staff-next-assignment">Assignments</a>
                <a href="#staff-availability">Availability</a>
                <a href="#staff-compensation">Rates</a>
                <a href="#staff-qualifications">Qualifications</a>
                <a href="#staff-detail-sections">Notes</a>
              </nav>

              <section id="staff-overview" className="staff-operational-stack" aria-label="Staff overview">
                <article id="staff-next-assignment" className="staff-ops-panel staff-next-assignment">
                  <header><div><p className="eyebrow">Next assignment</p><h3>{selectedAssignment?.event?.name || "No event assigned yet"}</h3></div><CalendarBlank size={22} aria-hidden="true" /></header>
                  {selectedAssignment ? (
                    <>
                      <dl className="staff-assignment-facts">
                        <div><dt>Date</dt><dd>{dateLabel(selectedAssignment.eventWindow?.startAtISO || selectedAssignment.event?.date, { weekday: true, year: true })}</dd></div>
                        <div><dt>Time</dt><dd>{timeRange(selectedAssignment.eventWindow?.startAtISO, selectedAssignment.eventWindow?.endAtISO)}</dd></div>
                        <div><dt>Role</dt><dd>{ROLE_LABELS[selectedAssignment.role] || selectedAssignment.role || "Not recorded"}</dd></div>
                        <div><dt>Venue</dt><dd>{selectedAssignment.event?.venue || "Not recorded"}</dd></div>
                        <div><dt>Guests</dt><dd>{selectedAssignment.event?.guests || "Not recorded"}</dd></div>
                        <div><dt>Response</dt><dd>{acknowledgementLabel}</dd></div>
                      </dl>
                      <div className="staff-panel-action-row">
                        <button type="button" className="cta" disabled={invitationBusy || dirty} onClick={() => void previewInvitation()}>View assignment</button>
                        <span>{deliveryLabel}</span>
                      </div>
                    </>
                  ) : <p className="staff-honest-empty">No event assignment yet. Open an event staffing plan when the right one comes along.</p>}
                </article>

                <article id="staff-availability" className="staff-ops-panel">
                  <header><div><p className="eyebrow">Availability</p><h3>When they’re available</h3></div><button type="button" className="ghost compact" onClick={focusStaffDetails}>Edit availability</button></header>
                  {availabilityWindows.length ? (
                    <div className="staff-data-rows">
                      {availabilityWindows.map((window) => (
                        <div key={window.availabilityId} className="staff-data-row">
                          <strong>{dateLabel(window.startAtISO, { weekday: true })}</strong>
                          <span>{timeRange(window.startAtISO, window.endAtISO)}</span>
                          <em data-tone={window.state === "available" ? "good" : "neutral"}>{window.state === "available" ? "Available" : "Unavailable"}</em>
                        </div>
                      ))}
                    </div>
                  ) : <p className="staff-honest-empty is-warning">Add availability to make scheduling easier.</p>}
                </article>

                <div className="staff-ops-split">
                  <article id="staff-compensation" className="staff-ops-panel">
                    <header><div><p className="eyebrow">Compensation</p><h3>Rates</h3></div><CurrencyDollar size={21} aria-hidden="true" /></header>
                    <dl className="staff-key-values">
                      <div><dt>Standard hourly rate</dt><dd>{hourlyRate > 0 ? `${currency(hourlyRate, draft.record.compensation.currency)}/hr` : "Rate not configured"}</dd></div>
                      <div><dt>Event rate</dt><dd>{Number(draft.record.compensation.eventRate || 0) > 0 ? currency(draft.record.compensation.eventRate, draft.record.compensation.currency) : "Not configured"}</dd></div>
                      <div><dt>Payroll status</dt><dd>{draft.record.compensation.payrollStatus === "ready" ? "Ready for review" : draft.record.compensation.payrollStatus === "on_hold" ? "On hold" : "Not ready"}</dd></div>
                    </dl>
                    <button type="button" className="staff-text-action" onClick={focusStaffDetails}>Manage rates</button>
                  </article>

                  <article id="staff-qualifications" className="staff-ops-panel">
                    <header><div><p className="eyebrow">Qualifications</p><h3>Credentials</h3></div><StarFour size={21} aria-hidden="true" /></header>
                    {draft.record.qualifications.length ? (
                      <div className="staff-data-rows is-compact">
                        {draft.record.qualifications.map((qualification) => {
                          const presentation = qualificationPresentation(qualification);
                          return (
                            <div className="staff-data-row" key={qualification.qualificationId}>
                              <strong>{qualification.type || "Unnamed qualification"}</strong>
                              <span>{qualification.expiresOn ? `Expires ${dateLabel(qualification.expiresOn)}` : "No expiry recorded"}</span>
                              <em data-tone={presentation.tone}>{presentation.label}</em>
                            </div>
                          );
                        })}
                      </div>
                    ) : <p className="staff-honest-empty is-warning">No qualifications recorded.</p>}
                  </article>
                </div>

                <article className="staff-ops-panel staff-personal-details">
                  <header><div><p className="eyebrow">Personal details</p><h3>Contact record</h3></div><UserCircle size={21} aria-hidden="true" /></header>
                  <dl className="staff-key-values">
                    <div><dt>Phone</dt><dd>{draft.record.contact.phone || "Not provided"}</dd></div>
                    <div><dt>Email</dt><dd>{draft.record.contact.email || "Not provided"}</dd></div>
                    <div><dt>Emergency contact</dt><dd>{draft.record.contact.emergencyContactName && draft.record.contact.emergencyContactPhone ? `${draft.record.contact.emergencyContactName} · ${draft.record.contact.emergencyContactPhone}` : "Not provided"}</dd></div>
                    <div><dt>Preferred contact</dt><dd>{preferredContactLabel}</dd></div>
                  </dl>
                </article>
              </section>

              <details id="staff-detail-sections" className="staff-editor-disclosure">
                <summary><span><NotePencil size={19} aria-hidden="true" /> Edit full staff record</span><small>Contact, roles, scheduling, rates, travel, briefing, reliability, and private notes</small></summary>
                <div className="staff-editor-disclosure__body">

              <Section icon={UserCircle} title="Identity and contact" description="Private contact details and the image used in this workspace." open>
                <div className="staff-fields-grid">
                  <Field label="Display name"><input value={draft.profile.displayName} onChange={(event) => patchProfile("displayName", event.target.value)} /></Field>
                  <Field label="Preferred name"><input value={draft.record.preferredName} onChange={(event) => patchRecord("preferredName", event.target.value)} /></Field>
                  <Field label="Legal name"><input value={draft.record.legalName} onChange={(event) => patchRecord("legalName", event.target.value)} /></Field>
                  <Field label="Photo URL" hint="HTTPS image URL. The image is presentation only."><input type="url" value={draft.record.photoUrl} onChange={(event) => patchRecord("photoUrl", event.target.value)} /></Field>
                  <Field label="Email"><input type="email" value={draft.record.contact.email} onChange={(event) => patchGroup("contact", "email", event.target.value)} /></Field>
                  <Field label="Phone"><input type="tel" value={draft.record.contact.phone} onChange={(event) => patchGroup("contact", "phone", event.target.value)} /></Field>
                  <Field label="Preferred contact"><select value={draft.record.contact.preferredChannel} onChange={(event) => patchGroup("contact", "preferredChannel", event.target.value)}><option value="email">Email</option><option value="phone">Phone</option><option value="either">Either</option></select></Field>
                  <Field label="Email status"><select value={draft.record.contact.emailStatus} onChange={(event) => patchGroup("contact", "emailStatus", event.target.value)}><option value="unverified">Unverified</option><option value="verified">Verified</option><option value="bounced">Bounced</option><option value="disabled">Disabled</option></select></Field>
                  <Field label="Staff communications"><select value={draft.record.contact.communicationsEnabled ? "enabled" : "disabled"} onChange={(event) => patchGroup("contact", "communicationsEnabled", event.target.value === "enabled")}><option value="enabled">Enabled</option><option value="disabled">Disabled</option></select></Field>
                  <Field label="Contact last verified"><input type="datetime-local" value={localDateTime(draft.record.contact.lastVerifiedAtISO)} onChange={(event) => patchGroup("contact", "lastVerifiedAtISO", exactISO(event.target.value))} /></Field>
                  <Field label="Time zone"><input placeholder="America/Chicago" value={draft.record.contact.timeZone} onChange={(event) => patchGroup("contact", "timeZone", event.target.value)} /></Field>
                  <Field label="Emergency contact"><input value={draft.record.contact.emergencyContactName} onChange={(event) => patchGroup("contact", "emergencyContactName", event.target.value)} /></Field>
                  <Field label="Emergency phone"><input type="tel" value={draft.record.contact.emergencyContactPhone} onChange={(event) => patchGroup("contact", "emergencyContactPhone", event.target.value)} /></Field>
                  <Field label="Record state"><select value={draft.profile.active ? "active" : "inactive"} onChange={(event) => patchProfile("active", event.target.value === "active")}><option value="active">Active</option><option value="inactive">Inactive</option></select></Field>
                </div>
              </Section>

              <Section icon={StarFour} title="Roles and qualifications" description="Icons distinguish roles; proficiency and certifications establish the supporting detail.">
                <div className="staff-editor-role-picker">
                  <div><strong>Assignment roles</strong><small>Select every role this person can accept.</small></div>
                  <RoleIcons
                    roles={draft.profile.capabilities}
                    interactive
                    onToggle={(role, enabled) => {
                      setDraft((current) => withStaffRole(current, role, enabled));
                      setDirty(true);
                    }}
                  />
                </div>
                <div className="staff-role-detail-grid">
                  {draft.record.roleDetails.map((roleDetail, index) => {
                    const Icon = ROLE_ICONS[roleDetail.role];
                    return (
                      <div className="staff-role-detail" key={roleDetail.role}>
                        <Icon size={24} weight="duotone" aria-label={ROLE_LABELS[roleDetail.role]} />
                        <select aria-label={`${ROLE_LABELS[roleDetail.role]} proficiency`} value={roleDetail.proficiency} onChange={(event) => {
                          const next = clone(draft.record.roleDetails);
                          next[index].proficiency = event.target.value;
                          patchRecord("roleDetails", next);
                        }}><option value="learning">Learning</option><option value="capable">Capable</option><option value="experienced">Experienced</option><option value="lead">Lead</option></select>
                        <label><input type="checkbox" checked={roleDetail.preferred} onChange={(event) => { const next = clone(draft.record.roleDetails); next[index].preferred = event.target.checked; patchRecord("roleDetails", next); }} /> Preferred</label>
                        <label><input type="checkbox" checked={roleDetail.acceptsAssignments} onChange={(event) => { const next = clone(draft.record.roleDetails); next[index].acceptsAssignments = event.target.checked; patchRecord("roleDetails", next); }} /> Accepts assignments</label>
                      </div>
                    );
                  })}
                </div>
                <div className="staff-subsection-heading"><h3>Qualifications</h3><button type="button" className="ghost compact" onClick={() => patchRecord("qualifications", [...draft.record.qualifications, createQualification(draft.record.qualifications.length)])}><Plus size={16} aria-hidden="true" /> Add qualification</button></div>
                {draft.record.qualifications.map((qualification, index) => (
                  <div className="staff-qualification-card" key={qualification.qualificationId}>
                    <div className="staff-repeat-grid">
                      <input aria-label="Qualification type" placeholder="Certification or skill" value={qualification.type} onChange={(event) => { const next = clone(draft.record.qualifications); next[index].type = event.target.value; patchRecord("qualifications", next); }} />
                      <input aria-label="Qualification number" placeholder="Certificate number" value={qualification.number} onChange={(event) => { const next = clone(draft.record.qualifications); next[index].number = event.target.value; patchRecord("qualifications", next); }} />
                      <input aria-label="Qualification provider" placeholder="Provider" value={qualification.provider} onChange={(event) => { const next = clone(draft.record.qualifications); next[index].provider = event.target.value; patchRecord("qualifications", next); }} />
                      <input aria-label="Qualification expiry" type="date" value={qualification.expiresOn} onChange={(event) => { const next = clone(draft.record.qualifications); next[index].expiresOn = event.target.value; patchRecord("qualifications", next); }} />
                      <select aria-label="Qualification status" value={qualification.status} onChange={(event) => { const next = clone(draft.record.qualifications); next[index].status = event.target.value; patchRecord("qualifications", next); }}><option value="current">Current</option><option value="expiring">Expiring</option><option value="expired">Expired</option><option value="pending">Pending</option></select>
                      <button type="button" className="ghost compact" aria-label="Remove qualification" onClick={() => patchRecord("qualifications", draft.record.qualifications.filter((_, itemIndex) => itemIndex !== index))}><Trash size={16} aria-hidden="true" /></button>
                    </div>
                    <div className="staff-qualification-details">
                      <Field label="Issued"><input type="date" value={qualification.issuedOn} onChange={(event) => { const next = clone(draft.record.qualifications); next[index].issuedOn = event.target.value; patchRecord("qualifications", next); }} /></Field>
                      <Field label="Document URL" hint="HTTPS only"><input type="url" value={qualification.documentUrl} onChange={(event) => { const next = clone(draft.record.qualifications); next[index].documentUrl = event.target.value; patchRecord("qualifications", next); }} /></Field>
                      <Field label="Qualification notes" wide><textarea value={qualification.notes} onChange={(event) => { const next = clone(draft.record.qualifications); next[index].notes = event.target.value; patchRecord("qualifications", next); }} /></Field>
                    </div>
                  </div>
                ))}
              </Section>

              <Section icon={CalendarBlank} title="Availability and workload" description="Operator-recorded windows plus the limits used to surface scheduling concerns.">
                <div className="staff-fields-grid">
                  <Field label="Preferred hours"><input value={draft.record.scheduling.preferredHours} onChange={(event) => patchGroup("scheduling", "preferredHours", event.target.value)} /></Field>
                  <Field label="Maximum weekly hours"><input type="number" min="0" max="168" value={draft.record.scheduling.maxWeeklyHours} onChange={(event) => patchGroup("scheduling", "maxWeeklyHours", Number(event.target.value))} /></Field>
                  <Field label="Maximum consecutive days"><input type="number" min="0" max="31" value={draft.record.scheduling.maxConsecutiveDays} onChange={(event) => patchGroup("scheduling", "maxConsecutiveDays", Number(event.target.value))} /></Field>
                  <Field label="Minimum rest hours"><input type="number" min="0" max="72" value={draft.record.scheduling.minRestHours} onChange={(event) => patchGroup("scheduling", "minRestHours", Number(event.target.value))} /></Field>
                  <Field label="Recurring availability note" wide><textarea value={draft.record.scheduling.recurringAvailabilityNote} onChange={(event) => patchGroup("scheduling", "recurringAvailabilityNote", event.target.value)} /></Field>
                  <Field label="Time-off note" wide><textarea value={draft.record.scheduling.timeOffNote} onChange={(event) => patchGroup("scheduling", "timeOffNote", event.target.value)} /></Field>
                </div>
                <div className="staff-subsection-heading"><h3>Availability windows</h3><button type="button" className="ghost compact" onClick={() => patchProfile("availabilityWindows", [...draft.profile.availabilityWindows, createAvailabilityWindow(draft.profile.availabilityWindows.length)])}><Plus size={16} aria-hidden="true" /> Add window</button></div>
                {draft.profile.availabilityWindows.map((window, index) => (
                  <div className="staff-repeat-grid availability" key={window.availabilityId}>
                    <select aria-label="Availability state" value={window.state} onChange={(event) => { const next = clone(draft.profile.availabilityWindows); next[index].state = event.target.value; patchProfile("availabilityWindows", next); }}><option value="available">Available</option><option value="unavailable">Unavailable</option></select>
                    <input aria-label="Availability starts" type="datetime-local" value={localDateTime(window.startAtISO)} onChange={(event) => { const next = clone(draft.profile.availabilityWindows); next[index].startAtISO = exactISO(event.target.value); patchProfile("availabilityWindows", next); }} />
                    <input aria-label="Availability ends" type="datetime-local" value={localDateTime(window.endAtISO)} onChange={(event) => { const next = clone(draft.profile.availabilityWindows); next[index].endAtISO = exactISO(event.target.value); patchProfile("availabilityWindows", next); }} />
                    <button type="button" className="ghost compact" aria-label="Remove availability window" onClick={() => patchProfile("availabilityWindows", draft.profile.availabilityWindows.filter((_, itemIndex) => itemIndex !== index))}><Trash size={16} aria-hidden="true" /></button>
                  </div>
                ))}
              </Section>

              <Section icon={CurrencyDollar} title="Rates and payroll context" description="Administrative planning fields only; they do not prove payroll approval or payment.">
                <div className="staff-fields-grid">
                  <Field label="Pay type"><select value={draft.record.compensation.payType} onChange={(event) => patchGroup("compensation", "payType", event.target.value)}><option value="hourly">Hourly</option><option value="event">Per event</option><option value="mixed">Mixed</option></select></Field>
                  <Field label="Currency"><input maxLength="3" value={draft.record.compensation.currency} onChange={(event) => patchGroup("compensation", "currency", event.target.value.toUpperCase())} /></Field>
                  <Field label="Hourly rate"><input type="number" min="0" step="0.01" value={draft.record.compensation.hourlyRate} onChange={(event) => patchGroup("compensation", "hourlyRate", Number(event.target.value))} /></Field>
                  <Field label="Event rate"><input type="number" min="0" step="0.01" value={draft.record.compensation.eventRate} onChange={(event) => patchGroup("compensation", "eventRate", Number(event.target.value))} /></Field>
                  <Field label="Overtime rate"><input type="number" min="0" step="0.01" value={draft.record.compensation.overtimeRate} onChange={(event) => patchGroup("compensation", "overtimeRate", Number(event.target.value))} /></Field>
                  <Field label="Travel stipend"><input type="number" min="0" step="0.01" value={draft.record.compensation.travelStipend} onChange={(event) => patchGroup("compensation", "travelStipend", Number(event.target.value))} /></Field>
                  <Field label="Payroll readiness"><select value={draft.record.compensation.payrollStatus} onChange={(event) => patchGroup("compensation", "payrollStatus", event.target.value)}><option value="not_ready">Not ready</option><option value="ready">Ready for payroll review</option><option value="on_hold">On hold</option></select></Field>
                </div>
              </Section>

              <Section icon={MapPin} title="Travel and event defaults" description="Reusable arrival, reporting and briefing details for staff sheets.">
                <div className="staff-fields-grid">
                  <Field label="Home base"><input value={draft.record.travel.homeBase} onChange={(event) => patchGroup("travel", "homeBase", event.target.value)} /></Field>
                  <Field label="Maximum travel miles"><input type="number" min="0" value={draft.record.travel.maxDistanceMiles} onChange={(event) => patchGroup("travel", "maxDistanceMiles", Number(event.target.value))} /></Field>
                  <Field label="Transportation"><input value={draft.record.travel.transportation} onChange={(event) => patchGroup("travel", "transportation", event.target.value)} /></Field>
                  <Field label="Preferred areas" hint="Comma-separated"><input value={draft.record.travel.preferredAreas.join(", ")} onChange={(event) => patchGroup("travel", "preferredAreas", event.target.value.split(",").map((item) => item.trim()).filter(Boolean))} /></Field>
                  <Field label="Lodging"><select value={draft.record.travel.lodgingRequired ? "required" : "not_required"} onChange={(event) => patchGroup("travel", "lodgingRequired", event.target.value === "required")}><option value="not_required">Not normally required</option><option value="required">Usually required</option></select></Field>
                  <Field label="Department"><input value={draft.record.assignmentDefaults.department} onChange={(event) => patchGroup("assignmentDefaults", "department", event.target.value)} /></Field>
                  <Field label="Station"><input value={draft.record.assignmentDefaults.station} onChange={(event) => patchGroup("assignmentDefaults", "station", event.target.value)} /></Field>
                  <Field label="Reporting location"><input value={draft.record.assignmentDefaults.reportingLocation} onChange={(event) => patchGroup("assignmentDefaults", "reportingLocation", event.target.value)} /></Field>
                  <Field label="Supervisor staff ID"><input value={draft.record.assignmentDefaults.supervisorStaffId} onChange={(event) => patchGroup("assignmentDefaults", "supervisorStaffId", event.target.value)} /></Field>
                  <Field label="Arrival instructions" wide><textarea value={draft.record.assignmentDefaults.arrivalInstructions} onChange={(event) => patchGroup("assignmentDefaults", "arrivalInstructions", event.target.value)} /></Field>
                  <Field label="Uniform" wide><textarea value={draft.record.briefingDefaults.uniform} onChange={(event) => patchGroup("briefingDefaults", "uniform", event.target.value)} /></Field>
                  <Field label="Parking"><textarea value={draft.record.briefingDefaults.parking} onChange={(event) => patchGroup("briefingDefaults", "parking", event.target.value)} /></Field>
                  <Field label="Entrance"><textarea value={draft.record.briefingDefaults.entrance} onChange={(event) => patchGroup("briefingDefaults", "entrance", event.target.value)} /></Field>
                  <Field label="Meal policy"><textarea value={draft.record.briefingDefaults.mealPolicy} onChange={(event) => patchGroup("briefingDefaults", "mealPolicy", event.target.value)} /></Field>
                  <Field label="Responsibilities" wide><textarea value={draft.record.briefingDefaults.responsibilities} onChange={(event) => patchGroup("briefingDefaults", "responsibilities", event.target.value)} /></Field>
                </div>
              </Section>

              <Section icon={NotePencil} title="Reliability, attendance and notes" description="Controlled administrative context; counters do not independently prove payroll or event completion.">
                <div className="staff-fields-grid">
                  <Field label="Reliability state"><select value={draft.record.reliability.status} onChange={(event) => patchGroup("reliability", "status", event.target.value)}><option value="new">New</option><option value="steady">Steady</option><option value="preferred">Preferred</option><option value="review">Needs review</option></select></Field>
                  <Field label="Manager rating"><input type="number" min="0" max="5" value={draft.record.reliability.managerRating} onChange={(event) => patchGroup("reliability", "managerRating", Number(event.target.value))} /></Field>
                  <Field label="Completed assignments"><input type="number" min="0" value={draft.record.attendance.completedAssignments} onChange={(event) => patchGroup("attendance", "completedAssignments", Number(event.target.value))} /></Field>
                  <Field label="Late arrivals"><input type="number" min="0" value={draft.record.attendance.lateArrivals} onChange={(event) => patchGroup("attendance", "lateArrivals", Number(event.target.value))} /></Field>
                  <Field label="No-shows"><input type="number" min="0" value={draft.record.attendance.noShows} onChange={(event) => patchGroup("attendance", "noShows", Number(event.target.value))} /></Field>
                  <Field label="Cancellations"><input type="number" min="0" value={draft.record.attendance.cancellations} onChange={(event) => patchGroup("attendance", "cancellations", Number(event.target.value))} /></Field>
                  <Field label="Last assignment"><input type="datetime-local" value={localDateTime(draft.record.attendance.lastAssignmentAtISO)} onChange={(event) => patchGroup("attendance", "lastAssignmentAtISO", exactISO(event.target.value))} /></Field>
                  <Field label="Last response"><select value={draft.record.attendance.lastResponse} onChange={(event) => patchGroup("attendance", "lastResponse", event.target.value)}><option value="">No response recorded</option><option value="pending">Pending</option><option value="accepted">Accepted</option><option value="declined">Declined</option><option value="question">Question</option></select></Field>
                  <Field label="Last response time"><input type="datetime-local" value={localDateTime(draft.record.attendance.lastRespondedAtISO)} onChange={(event) => patchGroup("attendance", "lastRespondedAtISO", exactISO(event.target.value))} /></Field>
                  <Field label="Last decline reason" wide><textarea value={draft.record.attendance.lastDeclineReason} onChange={(event) => patchGroup("attendance", "lastDeclineReason", event.target.value)} /></Field>
                  <Field label="Reliability notes" wide><textarea value={draft.record.reliability.notes} onChange={(event) => patchGroup("reliability", "notes", event.target.value)} /></Field>
                  <Field label="Private staff notes" wide><textarea value={draft.record.privateNotes} onChange={(event) => patchRecord("privateNotes", event.target.value)} /></Field>
                </div>
              </Section>

              <Section icon={EnvelopeSimple} title="Staff briefing sheet" description="Pertinent event details for this person, ready to print, download or open in the default email app." open>
                {assignments.length ? (
                  <div className="staff-briefing-actions">
                    <Field label="Assigned event" wide>
                      <select value={selectedAssignment?.assignmentId || ""} onChange={(event) => setSelectedAssignmentId(event.target.value)}>
                        {assignments.map((assignment) => <option value={assignment.assignmentId} key={assignment.assignmentId}>{assignmentLabel(assignment)}</option>)}
                      </select>
                    </Field>
                    <div className="staff-briefing-preview">
                      <strong>{selectedAssignment?.event?.name || "Event"}</strong>
                      <span>{ROLE_LABELS[selectedAssignment?.role] || "Event team"} · {selectedAssignment?.event?.venue || "Venue pending"}</span>
                      <small>Exact plan revision {selectedAssignment?.planRevision}; quote revision {selectedAssignment?.quoteRevisionId}.</small>
                    </div>
                    <div className="staff-briefing-buttons">
                      <button type="button" className="ghost" onClick={printSheet}><Printer size={18} aria-hidden="true" /> Print sheet</button>
                      <button type="button" className="ghost" onClick={downloadSheet}><DownloadSimple size={18} aria-hidden="true" /> Download PDF</button>
                      <button type="button" className="cta" onClick={openEmail} disabled={!draft.record.contact.email || draft.record.contact.communicationsEnabled === false}><EnvelopeSimple size={18} aria-hidden="true" /> Open email app</button>
                    </div>
                    <p className="source-note">The email app receives the address, subject and briefing text. Browsers cannot safely attach the PDF automatically; download it first if you want to include the sheet.</p>

                    <div className="staff-invitation-rail" data-capability-state={currentInvitation?.acknowledgement?.state || currentInvitation?.state || (invitationPreview ? "preview" : "ready")}>
                      <div className="staff-subsection-heading">
                        <div><p className="eyebrow">Assignment invitation</p><h3>Preview, then send</h3></div>
                        <EnvelopeOpen size={24} weight="duotone" aria-hidden="true" />
                      </div>
                      <div className="staff-invitation-states" aria-label="Invitation evidence">
                        <div><span>Delivery</span><strong>{deliveryLabel}</strong></div>
                        <div><span>Acknowledgement</span><strong>{acknowledgementLabel}</strong></div>
                      </div>
                      {currentInvitation?.acknowledgement?.declineReason ? <p className="staff-invitation-reason"><strong>Staff note:</strong> {currentInvitation.acknowledgement.declineReason}</p> : null}
                      {invitationPreview ? (
                        <div className="staff-invitation-preview">
                          <p><strong>To:</strong> {invitationPreview.preview.recipient.email}</p>
                          <p><strong>Subject:</strong> {invitationPreview.preview.subject}</p>
                          <pre>{invitationPreview.preview.textWithoutResponseLink}</pre>
                          <p className="source-note">{invitationPreview.preview.doNothing}</p>
                          <div className="staff-briefing-buttons">
                            <button type="button" className="cta" disabled={invitationBusy} onClick={() => void dispatchInvitation()}><EnvelopeSimple size={18} aria-hidden="true" /> {invitationBusy ? "Sending…" : "Send invitation"}</button>
                            <button type="button" className="ghost" disabled={invitationBusy} onClick={() => setInvitationPreview(null)}>Keep unsent</button>
                          </div>
                        </div>
                      ) : !currentInvitation ? (
                        <button type="button" className="cta" disabled={invitationBusy || dirty || !selectedAssignment} onClick={() => void previewInvitation()}>
                          <EnvelopeOpen size={18} aria-hidden="true" /> {invitationBusy ? "Preparing…" : "Preview invitation"}
                        </button>
                      ) : null}
                      <p className="source-note">Provider acceptance, provider-reported delivery or bounce, and the staff member’s accept/decline response remain separate. A response does not change attendance, payroll, readiness, or the confirmed staffing plan.</p>
                    </div>
                  </div>
                ) : (
                  <div className="staff-briefing-empty">
                    <CalendarBlank size={28} aria-hidden="true" />
                    <div><strong>No event assignment yet</strong><p>Assign this teammate from a Living Opportunity when you are ready to create their event briefing.</p></div>
                  </div>
                )}
              </Section>
                </div>
              </details>
            </>
          ) : (
            <div className="staff-record__empty"><UserCircle size={34} aria-hidden="true" /><h2>Choose a teammate or welcome someone new</h2><p>Their profile and best next step will appear right here.</p></div>
          )}
        </section>

        {draft ? (
          <aside className="staff-evidence-rail" aria-label="Staff profile checklist and recent activity">
            {selectedReadinessCompleteCount < selectedReadinessTotal ? (
              <section className="staff-attention-callout">
                <span className="staff-ui-glyph is-warning" aria-hidden="true">!</span>
                <div>
                  <strong>{selectedReadinessTotal - selectedReadinessCompleteCount} quick detail{selectedReadinessTotal - selectedReadinessCompleteCount === 1 ? "" : "s"} left to complete</strong>
                  <p>Finish these details to make assignments easier.</p>
                </div>
              </section>
            ) : null}

            <section className="staff-rail-panel">
              <header><p className="eyebrow">Profile checklist</p><strong>{selectedReadinessCompleteCount} of {selectedReadinessTotal} complete</strong></header>
              <ul className="staff-readiness-ledger">
                {readinessItems.map((item) => (
                  <li key={item.label} data-state={item.state}>
                    {item.state === "complete" ? <span className="staff-ui-glyph is-complete" aria-hidden="true">✓</span> : item.state === "warning" ? <span className="staff-ui-glyph is-warning" aria-hidden="true">!</span> : <span className="staff-neutral-dot" />}
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </li>
                ))}
              </ul>
            </section>

            {selectedAssignment ? (
              <section className="staff-rail-panel">
                <header><p className="eyebrow">Assignment evidence</p><strong>{selectedAssignment.event?.name || "Event"}</strong></header>
                <ol className="staff-evidence-steps">
                  {assignmentSteps.map(([label, complete]) => (
                    <li key={label} data-complete={complete ? "true" : "false"}><span>{label}</span><strong>{complete ? "Recorded" : "Pending"}</strong></li>
                  ))}
                </ol>
              </section>
            ) : null}

            <section className="staff-rail-panel">
              <header><p className="eyebrow">Recent activity</p><strong>What changed</strong></header>
              {selectedActivities.length ? (
                <ol className="staff-activity-list">
                  {selectedActivities.map((activity) => (
                    <li key={`${activity.event}-${activity.at}`}>
                      <strong>{activity.event}</strong>
                      <span>{activity.value}</span>
                      <small>{activityTime(activity.at)} · {activity.source}</small>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="staff-honest-empty">A fresh start—team activity will appear here as work moves forward.</p>
              )}
            </section>
          </aside>
        ) : null}
      </div>
    </main>
  );
}
