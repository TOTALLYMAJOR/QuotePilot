import { useEffect, useMemo, useState } from "react";
import {
  CalendarBlank,
  CookingPot,
  CurrencyDollar,
  DownloadSimple,
  EnvelopeOpen,
  EnvelopeSimple,
  MagnifyingGlass,
  MapPin,
  Martini,
  NotePencil,
  Plus,
  Printer,
  StarFour,
  Trash,
  Tray,
  UserCircle
} from "@phosphor-icons/react";
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
  const [state, setState] = useState({ status: "loading", message: "Loading staff records…" });
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [draft, setDraft] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState("");
  const [invitationPreview, setInvitationPreview] = useState(null);
  const [invitationBusy, setInvitationBusy] = useState(false);
  const [rosterSearch, setRosterSearch] = useState("");
  const [rosterFilter, setRosterFilter] = useState("all");

  const load = async ({ recovery = false } = {}) => {
    setState({ status: recovery ? "recovery" : "loading", message: recovery ? "Refreshing staff records…" : "Loading staff records…" });
    try {
      const result = await getStaffDirectory({ organizationId });
      setDirectory(result);
      const firstId = selectedStaffId || result.records[0]?.profile?.staffId || "";
      setSelectedStaffId(firstId);
      const selected = result.records.find((entry) => entry.profile.staffId === firstId) || null;
      setDraft(selected ? clone(selected) : null);
      setDirty(false);
      setState(result.storage === "firebase"
        ? { status: result.records.length ? "success" : "empty", message: result.records.length ? "Staff records are current." : "No staff records yet." }
        : { status: "unavailable", message: "Connect to the organization workspace to manage authoritative staff records." });
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
    (directory?.assignments || []).filter((item) => item.staffId === selectedStaffId)
      .sort((left, right) => String(right.eventWindow?.startAtISO || "").localeCompare(String(left.eventWindow?.startAtISO || "")))
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
    setState((current) => ({ ...current, message: "Staff record opened." }));
  };

  const addStaff = () => {
    if (dirty && !window.confirm("Discard the unsaved staff record changes?")) return;
    const staffId = `staff-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const entry = createStaffRecordDraft({ organizationId, staffId });
    setSelectedStaffId(staffId);
    setDraft(entry);
    setDirty(true);
    setState({ status: "editing", message: "New staff record ready. Add the person’s details, then save." });
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
    setState({ status: "saving", message: "Saving the exact staff record…" });
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
      setState({ status: "receipt", message: `Saved ${entry.profile.displayName}. Profile and private-record receipts were recorded.` });
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
  const activeCount = records.filter((entry) => entry.profile.active).length;
  const needsAttentionCount = records.filter((entry) => (
    entry.profile.active
    && (
      entry.record.contact.emailStatus !== "verified"
      || !entry.record.contact.emergencyContactPhone
      || Number(entry.record.compensation.hourlyRate || 0) <= 0
    )
  )).length;
  const normalizedRosterSearch = rosterSearch.trim().toLowerCase();
  const visibleRecords = records.filter((entry) => {
    const searchable = [
      entry.profile.displayName,
      entry.record.preferredName,
      entry.record.contact.email,
      Array.isArray(entry.profile.capabilities) ? entry.profile.capabilities.join(" ") : ""
    ].join(" ").toLowerCase();
    const matchesSearch = !normalizedRosterSearch || searchable.includes(normalizedRosterSearch);
    const matchesFilter = rosterFilter === "all"
      || (rosterFilter === "active" && entry.profile.active)
      || (rosterFilter === "needs_attention" && (
        entry.profile.active
        && (
          entry.record.contact.emailStatus !== "verified"
          || !entry.record.contact.emergencyContactPhone
          || Number(entry.record.compensation.hourlyRate || 0) <= 0
        )
      ));
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
  const openAvailabilityCount = availabilityWindows.filter((window) => window.state === "available").length;
  const readinessItems = draft ? [
    ["Contact verified", contactVerified ? "Complete" : "Missing", contactVerified],
    ["Availability", openAvailabilityCount ? `${openAvailabilityCount} window${openAvailabilityCount === 1 ? "" : "s"}` : "Not set", openAvailabilityCount > 0],
    ["Rate", hourlyRate > 0 ? `${currency(hourlyRate, draft.record.compensation.currency)}/hr` : "Missing", hourlyRate > 0],
    ["Emergency contact", emergencyReady ? "Complete" : "Missing", emergencyReady]
  ] : [];
  const assignmentSteps = [
    ["Invited", Boolean(currentInvitation)],
    ["Accepted", assignmentAccepted],
    ["Briefed", currentInvitation?.state === "provider_accepted" || currentInvitation?.state === "delivered" || assignmentAccepted],
    ["Completed", selectedAssignment?.state === "completed"]
  ];
  const focusStaffDetails = () => {
    if (typeof document === "undefined") return;
    const behavior = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    document.getElementById("staff-detail-sections")?.scrollIntoView({ block: "start", behavior });
  };
  const preferredContactLabel = ({
    email: "Email",
    phone: "Phone",
    either: "Either"
  }[draft?.record?.contact?.preferredChannel] || "Email");
  return (
    <main className="container workspace-route-main staff-workspace" data-surface-purpose="clarify advance resolve reveal_context">
      <div className="staff-organization-bar">
        <strong>{organizationName || "Organization workspace"}</strong>
        <div
          className={`staff-workspace__status is-${state.status}`}
          role={state.status === "error" ? "alert" : "status"}
          aria-live="polite"
          data-capability-state={state.status}
        >
          <span>{state.status === "success" ? "Ready to plan an event" : state.message}</span>
          {["error", "unavailable"].includes(state.status) ? (
            <button type="button" className="ghost compact" onClick={() => void load({ recovery: true })}>Refresh staff records</button>
          ) : null}
        </div>
      </div>

      <div className="staff-workspace__layout">
        <aside className="staff-roster" aria-label="Staff roster">
          <header className="staff-workspace__header">
            <p className="eyebrow">Staff</p>
            <h1>People</h1>
            <p>{records.length} people · {assignments.length} active event{assignments.length === 1 ? "" : "s"}</p>
          </header>
          <label className="staff-roster__search">
            <MagnifyingGlass size={16} aria-hidden="true" />
            <span className="sr-only">Search staff</span>
            <input
              type="search"
              value={rosterSearch}
              placeholder="Search staff"
              onChange={(event) => setRosterSearch(event.target.value)}
            />
          </label>
          <div className="staff-roster__filters" role="group" aria-label="Staff roster filters">
            <button type="button" className={rosterFilter === "all" ? "is-selected" : ""} onClick={() => setRosterFilter("all")}>All {records.length}</button>
            <button type="button" className={rosterFilter === "active" ? "is-selected" : ""} onClick={() => setRosterFilter("active")}>Active {activeCount}</button>
            <button type="button" className={rosterFilter === "needs_attention" ? "is-selected" : ""} onClick={() => setRosterFilter("needs_attention")}>Needs attention {needsAttentionCount}</button>
          </div>
          <div className="staff-roster__summary">
            <strong>{visibleRecords.length} shown</strong>
            <span>{activeCount} active</span>
          </div>
          {visibleRecords.length ? (
            <ul>
              {visibleRecords.map((entry) => (
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
                      <strong>{entry.record.preferredName || entry.profile.displayName}</strong>
                      <small>{entry.profile.capabilities.map((role) => ROLE_LABELS[role] || role).join(" · ") || "Role not set"}</small>
                      <RoleIcons roles={entry.profile.capabilities} />
                    </span>
                    <span className="staff-roster__rate">
                      {currency(entry.record.compensation.hourlyRate, entry.record.compensation.currency)}<small>/hr</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="staff-roster__empty">
              <UserCircle size={30} aria-hidden="true" />
              <p>{records.length ? "No staff match this filter." : "No staff records yet."}</p>
              <button type="button" className="ghost" onClick={addStaff}>Add the first person</button>
            </div>
          )}
          <button type="button" className="staff-add-button" onClick={addStaff} disabled={state.status === "unavailable"}>
            <Plus size={18} aria-hidden="true" /> Add staff member
          </button>
        </aside>

        <section className="staff-record" aria-label="Selected staff record">
          {draft ? (
            <>
              <header className="staff-record__identity">
                <span className="staff-avatar is-large">
                  {draft.record.photoUrl ? <img src={draft.record.photoUrl} alt="" /> : initials(draft)}
                </span>
                <div>
                  <p className="eyebrow">Staff profile</p>
                  <h2>{selectedDisplayName}</h2>
                  <p className="staff-profile-subtitle">
                    {selectedRoles.map((role) => ROLE_LABELS[role] || role).join(" · ") || "Role not set"}
                  </p>
                  <div className="staff-profile-chips" aria-label="Profile status">
                    <span data-tone={draft.profile.active ? "good" : "neutral"}>{draft.profile.active ? "Active" : "Inactive"}</span>
                    <span data-tone={contactVerified ? "good" : "warning"}>{contactVerified ? "Verified" : "Contact needed"}</span>
                    <span data-tone={openAvailabilityCount > 0 ? "good" : "warning"}>
                      {openAvailabilityCount > 0 ? "Available" : "Availability needed"}
                    </span>
                  </div>
                  <RoleIcons
                    roles={draft.profile.capabilities}
                    interactive
                    onToggle={(role, enabled) => {
                      setDraft((current) => withStaffRole(current, role, enabled));
                      setDirty(true);
                    }}
                  />
                </div>
                <div className="staff-record__controls">
                  <div className="staff-profile-actions">
                    <button type="button" className="ghost" onClick={focusStaffDetails}>More</button>
                    <button type="button" className="cta" onClick={focusStaffDetails}>
                      Edit profile
                    </button>
                  </div>
                  <div className="staff-record__save">
                    <button type="button" className="ghost compact" onClick={() => void save()} disabled={!dirty || state.status === "saving"}>
                      {state.status === "saving" ? "Saving…" : dirty ? "Save changes" : "Saved"}
                    </button>
                    <small>{dirty ? "Unsaved changes" : `Record revision ${draft.record.revision || 0}`}</small>
                  </div>
                </div>
              </header>

              {selectedAssignment ? (
                <section className="staff-next-action" aria-label="Next best action">
                  <div>
                    <p className="eyebrow">Next best action</p>
                    <h3>{assignmentAccepted ? `Prepare ${selectedDisplayName}'s event briefing` : `Confirm ${selectedDisplayName}'s assignment`}</h3>
                    <p>
                      {selectedAssignment.event?.name || "Assigned event"} · {selectedAssignment.event?.date || "Date pending"} · {acknowledgementLabel}
                    </p>
                  </div>
                  <button type="button" className="cta" disabled={invitationBusy || dirty || !selectedAssignment} onClick={() => void previewInvitation()}>
                    {currentInvitation ? "Review assignment" : "Prepare assignment review"}
                  </button>
                </section>
              ) : null}

              <nav className="staff-profile-tabs" aria-label="Staff profile sections">
                {["Overview", "Availability", "Rates", "Qualifications", "Events", "Notes"].map((label) => (
                  <a key={label} href={label === "Overview" ? "#staff-overview" : "#staff-detail-sections"}>{label}</a>
                ))}
              </nav>

              <section id="staff-overview" className="staff-overview-grid" aria-label="Staff overview">
                <article className="staff-overview-card staff-contact-card">
                  <h3>Identity & contact</h3>
                  <p className="source-note">Primary contact details for this staff member.</p>
                  <div className="staff-contact-summary">
                    <span className="staff-avatar">{initials(draft)}</span>
                    <div>
                      <strong>{selectedDisplayName}</strong>
                      <span>{draft.record.contact.email || "No email on file"}</span>
                      <span>{draft.record.contact.phone || "No phone on file"}</span>
                    </div>
                  </div>
                  <dl className="staff-overview-facts">
                    <div><dt>Preferred contact</dt><dd>{preferredContactLabel}</dd></div>
                    <div><dt>Time zone</dt><dd>{draft.record.contact.timeZone || "Not set"}</dd></div>
                  </dl>
                </article>

                <article className="staff-overview-card">
                  <h3>Readiness</h3>
                  <p className="source-note">Operational checks before assignment.</p>
                  <ul className="staff-readiness-list">
                    {readinessItems.map(([label, value, complete]) => (
                      <li key={label} data-complete={complete ? "true" : "false"}>
                        <span>{label}</span>
                        <strong>{value}</strong>
                      </li>
                    ))}
                  </ul>
                </article>

                {selectedAssignment ? (
                  <article className="staff-overview-card staff-assignment-card">
                    <div>
                      <h3>Next assignment</h3>
                      <strong>{selectedAssignment.event?.name || "Event"}</strong>
                      <p className="source-note">{selectedAssignment.event?.date || "Date pending"} · {selectedAssignment.event?.venue || "Venue pending"}</p>
                    </div>
                    <div className="staff-assignment-state">
                      {currentInvitation?.state === "provider_accepted" ? "Provider accepted" : deliveryLabel}
                    </div>
                    <ol className="staff-assignment-progress">
                      {assignmentSteps.map(([label, complete]) => (
                        <li key={label} data-complete={complete ? "true" : "false"}>{label}</li>
                      ))}
                    </ol>
                  </article>
                ) : null}
              </section>

              <div id="staff-detail-sections">

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
                    <div><strong>No recorded event assignment</strong><p>Assign this person from a Living Opportunity before creating an event-specific briefing.</p></div>
                  </div>
                )}
              </Section>
              </div>
            </>
          ) : (
            <div className="staff-record__empty"><UserCircle size={34} aria-hidden="true" /><h2>Select or add a staff member</h2><p>The relevant record will open here with a clear next action.</p></div>
          )}
        </section>
      </div>
    </main>
  );
}
