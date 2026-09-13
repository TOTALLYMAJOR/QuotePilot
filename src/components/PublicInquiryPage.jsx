import { useEffect, useMemo, useRef, useState } from "react";
import {
  clearInquiryRecovery,
  createInquiryRecoveryEnvelope,
  getPublishedInquiryShowcase,
  recordPublicInquiryFormStarted,
  resolveInquirySubmission,
  retainInquiryRecovery,
  submitPublicInquiry
} from "../lib/inquiryShowcaseClient";
import "./publicInquiryPage.css";

const EMPTY_FIELDS = Object.freeze({
  name: "", email: "", phone: "", organization: "", eventType: "",
  eventDate: "", estimatedGuests: "", location: "", notes: "", serviceResponseConsent: false
});
const DEFAULT_API = Object.freeze({ getPublishedInquiryShowcase, recordPublicInquiryFormStarted, submitPublicInquiry, resolveInquirySubmission });

function routeSlug() {
  if (typeof window === "undefined") return "";
  return decodeURIComponent(window.location.pathname.replace(/^\/inquire\//u, "").replace(/\/+$/u, ""));
}

function validate(fields) {
  const errors = [];
  if (!fields.name.trim()) errors.push(["name", "Enter your name."]);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(fields.email.trim())) errors.push(["email", "Enter a valid email address."]);
  if (!fields.eventType.trim()) errors.push(["eventType", "Describe the type of event."]);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(fields.eventDate)) errors.push(["eventDate", "Choose the event date you are considering."]);
  if (!Number.isInteger(Number(fields.estimatedGuests)) || Number(fields.estimatedGuests) < 1) errors.push(["estimatedGuests", "Enter an estimated guest count."]);
  if (!fields.location.trim()) errors.push(["location", "Enter the event location or area."]);
  if (!fields.serviceResponseConsent) errors.push(["serviceResponseConsent", "Consent is required so the team can respond about this request."]);
  return errors;
}

function FieldError({ errors, name }) {
  const message = errors.find(([field]) => field === name)?.[1];
  return message ? <span className="inquiry-field-error" id={`${name}-error`}>{message}</span> : null;
}

function TurnstileControl({ siteKey, onToken }) {
  const containerRef = useRef(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!siteKey || !containerRef.current) return undefined;
    let cancelled = false;
    const render = () => {
      if (cancelled || !window.turnstile || !containerRef.current) return;
      window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        action: "public_inquiry_submit",
        callback: onToken,
        "expired-callback": () => onToken(""),
        "error-callback": () => { onToken(""); setFailed(true); }
      });
    };
    if (window.turnstile) render();
    else {
      const existing = document.querySelector('script[data-inquiry-turnstile="true"]');
      const script = existing || document.createElement("script");
      if (!existing) {
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true; script.defer = true; script.dataset.inquiryTurnstile = "true";
        document.head.appendChild(script);
      }
      script.addEventListener("load", render, { once: true });
    }
    return () => { cancelled = true; };
  }, [onToken, siteKey]);
  if (!siteKey) return <p className="inquiry-verification-unavailable" role="alert">Request verification is not configured. Please contact the event team directly.</p>;
  return <><div ref={containerRef} className="inquiry-turnstile" aria-label="Request verification" />{failed && <p className="inquiry-verification-unavailable" role="alert">Request verification did not load. Refresh the page or contact the event team directly.</p>}</>;
}

export default function PublicInquiryPage({
  slug = routeSlug(),
  api = DEFAULT_API,
  enabled = import.meta.env.VITE_INQUIRY_SHOWCASE_ENABLED === "true",
  turnstileSiteKey = import.meta.env.VITE_INQUIRY_TURNSTILE_SITE_KEY || ""
}) {
  const [loadState, setLoadState] = useState("loading");
  const [showcase, setShowcase] = useState(null);
  const [fields, setFields] = useState(EMPTY_FIELDS);
  const [preferences, setPreferences] = useState([]);
  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState([]);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [submission, setSubmission] = useState({ state: "idle", message: "", receiptId: "" });
  const errorRef = useRef(null);
  const headingRef = useRef(null);
  const formStartedRef = useRef(false);

  useEffect(() => {
    const robots = document.createElement("meta");
    robots.name = "robots"; robots.content = "noindex,nofollow"; robots.dataset.inquiryRobots = "true";
    document.head.appendChild(robots);
    let active = true;
    if (!enabled) {
      setSubmission({ state: "error", message: "This inquiry page is not available.", receiptId: "" });
      setLoadState("unavailable");
      return () => { active = false; robots.remove(); };
    }
    api.getPublishedInquiryShowcase({ slug }).then((result) => {
      if (!active) return;
      setShowcase(result.showcase); setLoadState("ready");
    }).catch((error) => {
      if (!active) return;
      setSubmission({ state: "error", message: error.message, receiptId: "" }); setLoadState("unavailable");
    });
    return () => { active = false; robots.remove(); };
  }, [api, enabled, slug]);

  useEffect(() => { headingRef.current?.focus(); }, [step, submission.state]);
  const selected = useMemo(() => (showcase?.entries || []).filter((entry) => preferences.includes(entry.entryId)), [preferences, showcase]);
  const markFormStarted = () => {
    if (formStartedRef.current || !showcase?.publicationVersionId) return;
    formStartedRef.current = true;
    Promise.resolve(api.recordPublicInquiryFormStarted?.({
      slug,
      publicationVersionId: showcase.publicationVersionId
    })).catch(() => {});
  };
  const setField = (name, value) => {
    markFormStarted();
    setFields((current) => ({ ...current, [name]: value }));
  };
  const proceedToPreferences = () => {
    const next = validate(fields).filter(([name]) => !["serviceResponseConsent"].includes(name));
    setErrors(next);
    if (next.length) { requestAnimationFrame(() => errorRef.current?.focus()); return; }
    setStep(2);
  };
  const proceedToReview = () => {
    const next = validate(fields); setErrors(next);
    if (next.length) { requestAnimationFrame(() => errorRef.current?.focus()); return; }
    setStep(3);
  };
  const submit = async () => {
    if (!turnstileToken) { setSubmission({ state: "error", message: "Complete request verification before submitting.", receiptId: "" }); return; }
    const envelope = createInquiryRecoveryEnvelope(slug); retainInquiryRecovery(envelope);
    setSubmission({ state: "submitting", message: "Recording your inquiry…", receiptId: "" });
    const request = { ...envelope, publicationVersionId: showcase.publicationVersionId, fields: { ...fields, estimatedGuests: Number(fields.estimatedGuests) }, preferenceRefs: preferences.map((entryId) => ({ entryId })), turnstileToken };
    let timeout;
    try {
      const result = await Promise.race([
        api.submitPublicInquiry(request),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(Object.assign(new Error("Submission outcome is uncertain."), { code: "deadline-exceeded" })), 20_000); })
      ]);
      clearTimeout(timeout); clearInquiryRecovery(envelope);
      setSubmission({ state: "received", message: result.message, receiptId: result.receiptId });
    } catch (error) {
      clearTimeout(timeout);
      if (["deadline-exceeded", "unavailable", "unknown"].includes(error.code)) {
        setSubmission({ state: "uncertain", message: "The network response was interrupted. Checking the original request before you try again…", receiptId: "" });
        try {
          const result = await api.resolveInquirySubmission(envelope);
          clearInquiryRecovery(envelope);
          setSubmission({ state: "received", message: result.message, receiptId: result.receiptId });
        } catch {
          setSubmission({ state: "uncertain", message: "We could not confirm the original outcome. Keep this page open and use Check original request before submitting again.", receiptId: "", envelope });
        }
      } else if (error.code === "aborted") {
        setSubmission({ state: "stale", message: error.message, receiptId: "" });
      } else setSubmission({ state: "error", message: error.message, receiptId: "" });
    }
  };
  const checkOriginal = async () => {
    if (!submission.envelope) return;
    setSubmission((current) => ({ ...current, state: "submitting", message: "Checking the original request…" }));
    try {
      const result = await api.resolveInquirySubmission(submission.envelope);
      clearInquiryRecovery(submission.envelope);
      setSubmission({ state: "received", message: result.message, receiptId: result.receiptId });
    } catch (error) { setSubmission((current) => ({ ...current, state: "uncertain", message: error.message })); }
  };
  const refreshStalePublication = async () => {
    setSubmission({ state: "submitting", message: "Refreshing the inquiry page…", receiptId: "" });
    try {
      const result = await api.getPublishedInquiryShowcase({ slug });
      const currentEntryIds = new Set((result.showcase.entries || []).map((entry) => entry.entryId));
      setPreferences((current) => current.filter((entryId) => currentEntryIds.has(entryId)));
      setShowcase(result.showcase);
      setStep(3);
      setSubmission({ state: "stale_review", message: "The page was refreshed. Review the updated request before sending it.", receiptId: "" });
    } catch (error) {
      setSubmission({ state: "error", message: error.message, receiptId: "" });
    }
  };

  if (loadState === "loading") return <main className="public-inquiry public-inquiry--state" data-capability-state="loading"><p role="status">Loading inquiry page…</p></main>;
  if (loadState === "unavailable") return <main className="public-inquiry public-inquiry--state" data-capability-state="error"><h1>Inquiry page unavailable</h1><p>{submission.message}</p></main>;
  if (submission.state === "received") return (
    <main className="public-inquiry public-inquiry--receipt" data-inquiry-state="received" data-capability-state="receipt">
      <p className="public-inquiry__eyebrow">Request received</p><h1 tabIndex={-1} ref={headingRef}>Thank you, {fields.name}.</h1>
      <p>{submission.message}</p><p>The event team will review your preferences and contact details. Nothing has been reserved, priced, or booked.</p>
      <dl><div><dt>Receipt</dt><dd>{submission.receiptId}</dd></div><div><dt>Event date considered</dt><dd>{fields.eventDate}</dd></div></dl>
    </main>
  );

  return (
    <main className="public-inquiry" style={{ "--inquiry-brand": showcase.branding?.primaryColor || "#8b5e34" }} data-inquiry-step={step} data-inquiry-state={submission.state} data-capability-state={submission.state === "submitting" ? "submitting" : submission.state === "uncertain" ? "uncertain" : submission.state === "stale" ? "stale" : submission.state === "stale_review" ? "partial" : submission.state === "error" ? "recovery" : step === 3 ? "ready" : "success"}>
      <header className="public-inquiry__header">
        <div className="public-inquiry__brand">{showcase.branding?.logoUrl && <img src={showcase.branding.logoUrl} alt="" />}<span>{showcase.branding?.name || "Event team"}</span></div>
        <p className="public-inquiry__eyebrow">Event inquiry · Step {step} of 3</p>
        <h1 ref={headingRef} tabIndex={-1}>{showcase.pageTitle}</h1><p>{showcase.introduction}</p>
        <p className="public-inquiry__boundary">Share what you are considering. This does not show pricing or confirm availability, allergen safety, a reservation, proposal, or booking.</p>
      </header>

      {errors.length > 0 && <div className="public-inquiry__errors" role="alert" tabIndex={-1} ref={errorRef}><strong>Review the highlighted details.</strong><ul>{errors.map(([name, message]) => <li key={name}><a href={`#${name}`}>{message}</a></li>)}</ul></div>}
      {["error", "uncertain", "stale", "stale_review", "submitting"].includes(submission.state) && <div className={`public-inquiry__notice public-inquiry__notice--${submission.state}`} role={submission.state === "error" ? "alert" : "status"}><p>{submission.message}</p>{submission.state === "uncertain" && submission.envelope && <button type="button" onClick={checkOriginal}>Check original request</button>}{submission.state === "stale" && <button type="button" onClick={refreshStalePublication}>Refresh and review</button>}</div>}

      {step === 1 && <form className="public-inquiry__panel" onSubmit={(event) => { event.preventDefault(); proceedToPreferences(); }} noValidate>
        <fieldset><legend>About you</legend><div className="public-inquiry__grid">
          <label htmlFor="name">Name <span aria-hidden="true">*</span><input id="name" autoComplete="name" value={fields.name} onChange={(e) => setField("name", e.target.value)} aria-invalid={errors.some(([f]) => f === "name")} aria-describedby="name-error" /><FieldError errors={errors} name="name" /></label>
          <label htmlFor="email">Email <span aria-hidden="true">*</span><input id="email" type="email" autoComplete="email" value={fields.email} onChange={(e) => setField("email", e.target.value)} aria-invalid={errors.some(([f]) => f === "email")} aria-describedby="email-error" /><FieldError errors={errors} name="email" /></label>
          <label htmlFor="phone">Phone <span>Optional</span><input id="phone" type="tel" autoComplete="tel" value={fields.phone} onChange={(e) => setField("phone", e.target.value)} /></label>
          <label htmlFor="organization">Organization <span>Optional</span><input id="organization" autoComplete="organization" value={fields.organization} onChange={(e) => setField("organization", e.target.value)} /></label>
        </div></fieldset>
        <fieldset><legend>About the event</legend><div className="public-inquiry__grid">
          <label htmlFor="eventType">Event type <span aria-hidden="true">*</span><input id="eventType" value={fields.eventType} onChange={(e) => setField("eventType", e.target.value)} placeholder="Wedding reception, team dinner…" aria-invalid={errors.some(([f]) => f === "eventType")} aria-describedby="eventType-error" /><FieldError errors={errors} name="eventType" /></label>
          <label htmlFor="eventDate">Date you are considering <span aria-hidden="true">*</span><input id="eventDate" type="date" value={fields.eventDate} onChange={(e) => setField("eventDate", e.target.value)} aria-invalid={errors.some(([f]) => f === "eventDate")} aria-describedby="eventDate-error" /><FieldError errors={errors} name="eventDate" /></label>
          <label htmlFor="estimatedGuests">Estimated guests <span aria-hidden="true">*</span><input id="estimatedGuests" type="number" min="1" max="100000" inputMode="numeric" value={fields.estimatedGuests} onChange={(e) => setField("estimatedGuests", e.target.value)} aria-invalid={errors.some(([f]) => f === "estimatedGuests")} aria-describedby="estimatedGuests-error" /><FieldError errors={errors} name="estimatedGuests" /></label>
          <label htmlFor="location">Location or area <span aria-hidden="true">*</span><input id="location" value={fields.location} onChange={(e) => setField("location", e.target.value)} aria-invalid={errors.some(([f]) => f === "location")} aria-describedby="location-error" /><FieldError errors={errors} name="location" /></label>
        </div><label htmlFor="notes">Anything else the team should consider? <span>Optional</span><textarea id="notes" maxLength="1600" value={fields.notes} onChange={(e) => setField("notes", e.target.value)} /></label></fieldset>
        <div className="public-inquiry__actions"><button type="submit">Choose preferences <span aria-hidden="true">→</span></button></div>
      </form>}

      {step === 2 && <section className="public-inquiry__panel" aria-labelledby="preference-title"><p className="public-inquiry__eyebrow">Curated ideas</p><h2 id="preference-title">What feels right for your event?</h2><p>Choose any ideas you would like the team to consider. These are preferences, not confirmed scope or availability.</p>
        <div className="public-inquiry__cards">{showcase.entries.map((entry) => <label key={entry.entryId} className="inquiry-preference" data-selected={preferences.includes(entry.entryId)}>{entry.imageUrl && <img src={entry.imageUrl} alt="" loading="lazy" />}<input type="checkbox" checked={preferences.includes(entry.entryId)} onChange={() => setPreferences((current) => current.includes(entry.entryId) ? current.filter((id) => id !== entry.entryId) : [...current, entry.entryId])} /><span>{entry.featuredLabel && <small>{entry.featuredLabel}</small>}<strong>{entry.publicTitle}</strong><span>{entry.shortDescription}</span></span></label>)}</div>
        <label className="public-inquiry__consent" htmlFor="serviceResponseConsent"><input id="serviceResponseConsent" type="checkbox" checked={fields.serviceResponseConsent} onChange={(e) => setField("serviceResponseConsent", e.target.checked)} aria-invalid={errors.some(([f]) => f === "serviceResponseConsent")} aria-describedby="serviceResponseConsent-error" /><span>I agree that {showcase.branding?.name || "the event team"} may contact me to respond to this event inquiry. This is service-response consent, not marketing consent.</span></label><FieldError errors={errors} name="serviceResponseConsent" />
        <div className="public-inquiry__actions"><button type="button" className="secondary" onClick={() => setStep(1)}>Back</button><button type="button" onClick={proceedToReview}>Review request <span aria-hidden="true">→</span></button></div>
      </section>}

      {step === 3 && <section className="public-inquiry__panel public-inquiry__review" aria-labelledby="review-title"><p className="public-inquiry__eyebrow">Exact review</p><h2 id="review-title">Review what the team will receive.</h2>
        <dl><div><dt>Contact</dt><dd>{fields.name}<br />{fields.email}{fields.phone && <><br />{fields.phone}</>}{fields.organization && <><br />{fields.organization}</>}</dd></div><div><dt>Event</dt><dd>{fields.eventType}<br />{fields.eventDate} · about {fields.estimatedGuests} guests<br />{fields.location}</dd></div><div><dt>Preferences</dt><dd>{selected.length ? selected.map((entry) => entry.publicTitle).join(", ") : "No curated preferences selected"}</dd></div><div><dt>Notes</dt><dd>{fields.notes || "No additional notes"}</dd></div><div><dt>Service-response consent</dt><dd>{fields.serviceResponseConsent ? "Agreed" : "Not agreed"}</dd></div></dl>
        <p className="public-inquiry__privacy">Your contact and event details are used to respond to this inquiry. Unconverted inquiry content is retained for 90 days. Submitting does not subscribe you to marketing.</p>
        <TurnstileControl siteKey={turnstileSiteKey} onToken={setTurnstileToken} />
        <div className="public-inquiry__actions"><button type="button" className="secondary" disabled={submission.state === "submitting"} onClick={() => setStep(2)}>Back</button><button type="button" disabled={submission.state === "submitting" || !turnstileToken} onClick={submit}>{submission.state === "submitting" ? "Recording…" : "Send inquiry"}</button></div>
      </section>}
      <footer><p>{showcase.responsePromise || "The event team will review your request and follow up directly."}</p></footer>
    </main>
  );
}
