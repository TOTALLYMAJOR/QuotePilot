import { useEffect, useMemo, useState } from "react";
import { CheckCircle, Clock, MapPin, WarningCircle, XCircle } from "./ProductIcons";
import {
  getPublicStaffInvitation,
  respondToPublicStaffInvitation
} from "../lib/staffInvitationClient";
import ProductBrandLockup from "./ProductBrandLockup";
import "./staffInvitationResponsePage.css";

function safeError(error, fallback) {
  return String(error?.message || fallback).replace(/^FirebaseError:\s*/iu, "").trim();
}

function invitationToken() {
  return String(new URLSearchParams(window.location.search).get("staffing") || "").trim();
}

export default function StaffInvitationResponsePage() {
  const token = useMemo(invitationToken, []);
  const [result, setResult] = useState(null);
  const [state, setState] = useState({ status: "loading", message: "Loading your assignment invitation…" });
  const [declining, setDeclining] = useState(false);
  const [declineReason, setDeclineReason] = useState("");

  const load = async () => {
    setState({ status: "loading", message: "Loading your assignment invitation…" });
    try {
      const next = await getPublicStaffInvitation(token);
      setResult(next);
      const acknowledged = next.invitation.acknowledgement?.state;
      setState(acknowledged && acknowledged !== "pending"
        ? { status: "resolved", message: `This invitation was ${acknowledged}.` }
        : next.expired
          ? { status: "expired", message: "This invitation has expired. Contact the event coordinator for a current invitation." }
          : { status: "ready", message: "Review the assignment and choose your response." });
    } catch (error) {
      setState({ status: "error", message: safeError(error, "This invitation could not be loaded.") });
    }
  };

  useEffect(() => { void load(); }, []);

  const respond = async (decision) => {
    setState({ status: "pending", message: `Recording your ${decision === "accepted" ? "acceptance" : "decline"}…` });
    try {
      const receipt = await respondToPublicStaffInvitation(token, decision, declineReason);
      setResult((current) => ({
        ...current,
        canRespond: false,
        invitation: { ...current.invitation, acknowledgement: receipt.acknowledgement }
      }));
      setState({
        status: "resolved",
        message: decision === "accepted"
          ? "Your acceptance is recorded. The event team can now see your response."
          : "Your decline is recorded. The event team can now see your response."
      });
      setDeclining(false);
    } catch (error) {
      setState({ status: "error", message: safeError(error, "Your response could not be recorded.") });
    }
  };

  const assignment = result?.assignment || {};
  const event = assignment.event || {};
  const acknowledgement = result?.invitation?.acknowledgement?.state || "pending";
  return (
    <main className="staff-invitation-page">
      <header><ProductBrandLockup /></header>
      <section className="staff-invitation-card" data-capability-state={state.status}>
        <p className="eyebrow">Staff assignment</p>
        <h1>{event.name || "Event invitation"}</h1>
        <p className={`staff-invitation-status is-${state.status}`} role={state.status === "error" ? "alert" : "status"} aria-live="polite">
          {state.status === "resolved" ? <CheckCircle size={21} weight="fill" aria-hidden="true" /> : state.status === "error" || state.status === "expired" ? <WarningCircle size={21} weight="fill" aria-hidden="true" /> : <Clock size={21} aria-hidden="true" />}
          {state.message}
        </p>

        {result ? (
          <>
            <div className="staff-invitation-facts">
              <div><span>Date</span><strong>{event.date || "Date pending"}</strong></div>
              <div><span>Time</span><strong>{event.time || "Time pending"}</strong></div>
              <div><span>Role</span><strong>{assignment.role || result.invitation.role}</strong></div>
              <div><span>Venue</span><strong>{event.venue || "Venue pending"}</strong></div>
            </div>
            {event.venueAddress ? <p className="staff-invitation-location"><MapPin size={18} aria-hidden="true" /> {event.venueAddress}</p> : null}

            {result.canRespond && acknowledgement === "pending" ? (
              <div className="staff-invitation-actions">
                <button type="button" className="cta" onClick={() => void respond("accepted")} disabled={state.status === "pending"}>
                  <CheckCircle size={19} aria-hidden="true" /> Accept assignment
                </button>
                <button type="button" className="ghost" onClick={() => setDeclining(true)} disabled={state.status === "pending"}>
                  <XCircle size={19} aria-hidden="true" /> Decline assignment
                </button>
              </div>
            ) : null}

            {declining && result.canRespond ? (
              <div className="staff-invitation-decline">
                <label>Optional note<textarea value={declineReason} maxLength={500} onChange={(event) => setDeclineReason(event.target.value)} placeholder="Share anything the coordinator should know." /></label>
                <div><button type="button" className="danger" onClick={() => void respond("declined")} disabled={state.status === "pending"}>Confirm decline</button><button type="button" className="ghost" onClick={() => setDeclining(false)}>Keep reviewing</button></div>
              </div>
            ) : null}

            <p className="staff-invitation-boundary">Your response applies only to this invitation. It does not record attendance, hours, payroll, event completion, or operational readiness.</p>
          </>
        ) : null}
      </section>
    </main>
  );
}
