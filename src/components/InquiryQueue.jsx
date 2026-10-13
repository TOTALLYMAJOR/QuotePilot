import { useCallback, useEffect, useMemo, useState } from "react";
import {
  acknowledgeInquiry,
  convertInquiryToQuoteDraft,
  dismissInquiry,
  getInquiryQueue,
  previewInquiryConversion
} from "../lib/inquiryShowcaseClient";
import "./publicInquiryPage.css";
const DEFAULT_API = Object.freeze({ getInquiryQueue, acknowledgeInquiry, previewInquiryConversion, convertInquiryToQuoteDraft, dismissInquiry });

function ageLabel(value) {
  const elapsed = Date.now() - Date.parse(value || "");
  if (!Number.isFinite(elapsed) || elapsed < 0) return "Age unavailable";
  const hours = Math.floor(elapsed / 3_600_000);
  return hours < 1 ? "Less than an hour old" : hours < 24 ? `${hours}h old` : `${Math.floor(hours / 24)}d old`;
}

function activeItems(values) { return (Array.isArray(values) ? values : []).filter((item) => item.active !== false); }

function quoteFormFrom(preview, catalog) {
  const settings = catalog?.settings || {};
  const packages = activeItems(catalog?.packages);
  const menu = activeItems(catalog?.menuItems);
  const requestedPackage = packages.find((item) => item.id === preview.prefill.packageId)?.id || "";
  const requestedMenu = preview.prefill.menuItems.filter((id) => menu.some((item) => item.id === id));
  return {
    ...preview.prefill,
    pkg: requestedPackage,
    menuItems: requestedMenu,
    addons: preview.prefill.addons.filter((id) => activeItems(catalog?.addons).some((item) => item.id === id)),
    rentals: preview.prefill.rentals.filter((id) => activeItems(catalog?.rentals).some((item) => item.id === id)),
    eventName: preview.prefill.eventName,
    date: preview.prefill.date,
    time: "12:00",
    venue: preview.prefill.venue,
    venueAddress: preview.prefill.venueAddress,
    guests: preview.prefill.guests,
    hours: 4,
    servers: 0,
    chefs: 0,
    bartenders: 0,
    dietaryRestrictions: "",
    style: "",
    taxRegion: settings.defaultTaxRegion || "",
    seasonProfileId: "auto",
    milesRT: 0,
    includeDisposables: true,
    payMethod: "card"
  };
}

function applyReferenceResolution(form, item, resolution) {
  if (!form) return form;
  const include = resolution === "use_current";
  if (item.referenceType === "offer") return { ...form, pkg: include ? item.referenceId : form.pkg === item.referenceId ? "" : form.pkg };
  if (item.referenceType === "template") return { ...form, eventTemplateId: include ? item.referenceId : form.eventTemplateId === item.referenceId ? "custom" : form.eventTemplateId };
  const field = item.referenceType === "addon" ? "addons" : item.referenceType === "rental" ? "rentals" : item.referenceType === "menu_item" ? "menuItems" : "";
  if (!field) return form;
  const values = (Array.isArray(form[field]) ? form[field] : []).filter((value) => value !== item.referenceId);
  return { ...form, [field]: include ? [...values, item.referenceId] : values };
}

export default function InquiryQueue({
  organizationId,
  catalog,
  enabled = import.meta.env.VITE_INQUIRY_SHOWCASE_ENABLED === "true",
  onQuoteCreated,
  api = DEFAULT_API
}) {
  const [state, setState] = useState({ loading: false, error: "", inquiries: [] });
  const [busy, setBusy] = useState("");
  const [preview, setPreview] = useState(null);
  const [quoteForm, setQuoteForm] = useState(null);
  const [resolutions, setResolutions] = useState({});
  const [identityChoice, setIdentityChoice] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    if (!enabled || !organizationId) return;
    setState((current) => ({ ...current, loading: true, error: "" }));
    try { const result = await api.getInquiryQueue({ organizationId }); setState({ loading: false, error: "", inquiries: result.inquiries || [] }); }
    catch (error) { setState((current) => ({ ...current, loading: false, error: error.message })); }
  }, [api, enabled, organizationId]);
  useEffect(() => { load(); }, [load]);
  const records = useMemo(() => state.inquiries, [state.inquiries]);
  const mutate = async (key, action) => {
    setBusy(key); setNotice("");
    try { const result = await action(); await load(); return result; }
    catch (error) { setNotice(error.message); return null; }
    finally { setBusy(""); }
  };
  const review = async (inquiry) => {
    setBusy(`review:${inquiry.inquiryId}`); setNotice("");
    try {
      const result = await api.previewInquiryConversion({ organizationId, inquiryId: inquiry.inquiryId });
      setPreview(result); setQuoteForm(quoteFormFrom(result, catalog)); setResolutions({}); setIdentityChoice("");
    } catch (error) { setNotice(error.message); }
    finally { setBusy(""); }
  };
  const convert = async () => {
    if (!preview || !quoteForm) return;
    const result = await mutate(`convert:${preview.inquiryId}`, () => api.convertInquiryToQuoteDraft({
      organizationId,
      inquiryId: preview.inquiryId,
      expectedInquiryRevision: preview.inquiryRevision,
      expectedCatalogRevision: preview.catalogRevision,
      conversionRequestId: `inq_convert_${crypto.randomUUID().replaceAll("-", "")}`,
      identityChoice,
      resolutions: preview.drift.filter((item) => item.requiresResolution).map((item) => ({ entryId: item.entryId, resolution: resolutions[item.entryId] || "" })),
      quoteForm
    }));
    if (result) { setPreview(null); setQuoteForm(null); setNotice(`Quote ${result.quoteNumber} was created with conversion receipt ${result.conversionReceiptId}.`); onQuoteCreated?.(result.id); }
  };
  if (!enabled) return null;
  return <section className="inquiry-queue" data-capability-id="inquiry-operations-queue" data-capability-state={state.error ? "error" : busy ? "submitting" : state.loading ? "loading" : preview ? "reconciliation" : records.length ? "success" : "empty"} aria-labelledby="inquiry-queue-title">
    <header><div><p className="inquiry-admin__eyebrow">Customer inquiries</p><h2 id="inquiry-queue-title">Requests waiting for one clear next action.</h2></div><button type="button" className="secondary" disabled={state.loading} onClick={load}>{state.loading ? "Checking…" : "Refresh"}</button></header>
    {state.error && <p role="alert" className="inquiry-admin__notice inquiry-admin__notice--error">{state.error}</p>}
    {notice && <p role="status" className="inquiry-admin__notice">{notice}</p>}
    {!state.loading && records.length === 0 && <p className="inquiry-queue__empty">No inquiries have been recorded.</p>}
    <ol>{records.map((inquiry) => <li key={inquiry.inquiryId} data-inquiry-state={inquiry.state}><article><div className="inquiry-queue__identity"><div><span>{inquiry.state}</span><h3>{inquiry.fields.eventType || "Event inquiry"}</h3><p>{inquiry.fields.name} · {inquiry.fields.eventDate} · about {inquiry.fields.estimatedGuests} guests</p></div><strong>{ageLabel(inquiry.submittedAtISO)}</strong></div><p className="inquiry-queue__location">{inquiry.fields.location}</p><p><strong>Assignment:</strong> {inquiry.assignment?.email || inquiry.assignment?.uid || (inquiry.state === "received" ? "Unassigned" : "Not recorded")}</p><p><strong>Preferences:</strong> {inquiry.preferences.length ? inquiry.preferences.map((item) => item.publicTitle).join(", ") : "None selected"}</p>{inquiry.notification?.state === "failed" && <p className="inquiry-queue__warning">The inquiry is safely recorded. Optional staff email notification failed.</p>}{["received", "acknowledged"].includes(inquiry.state) && <div className="inquiry-queue__actions">{inquiry.state === "received" ? <button type="button" disabled={Boolean(busy)} onClick={() => mutate(`ack:${inquiry.inquiryId}`, () => api.acknowledgeInquiry({ organizationId, inquiryId: inquiry.inquiryId, expectedRevision: inquiry.revision }))}>Acknowledge and assign to me</button> : <button type="button" disabled={Boolean(busy)} onClick={() => review(inquiry)}>{busy === `review:${inquiry.inquiryId}` ? "Reviewing…" : "Review conversion"}</button>}<button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => mutate(`dismiss:${inquiry.inquiryId}`, () => api.dismissInquiry({ organizationId, inquiryId: inquiry.inquiryId, expectedRevision: inquiry.revision, reason: "staff_dismissed" }))}>Dismiss</button></div>}</article></li>)}</ol>
    {preview && quoteForm && <section className="inquiry-conversion" aria-labelledby="inquiry-conversion-title"><header><div><p className="inquiry-admin__eyebrow">Read-only provenance review</p><h3 id="inquiry-conversion-title">Resolve the handoff before creating a quote.</h3></div><button type="button" className="secondary" onClick={() => setPreview(null)}>Close</button></header><p>Customer selections remain unconfirmed preferences. Current catalog authority will price the quote only after every required choice below is resolved.</p>
      <div className="inquiry-conversion__facts"><div><span>Inquiry revision</span><strong>{preview.inquiryRevision}</strong></div><div><span>Catalog revision</span><strong>{preview.catalogRevision}</strong></div><div><span>Identity</span><strong>{preview.identity.state === "existing_claim" ? "Existing email claim found" : "No email claim found"}</strong></div></div>
      <ul className="inquiry-conversion__drift">{preview.drift.map((item) => <li key={item.entryId} data-drift-state={item.state}><div><strong>{item.publicTitle}</strong><span>{item.referenceType} · {item.state}</span></div>{item.requiresResolution ? <select aria-label={`Resolution for ${item.publicTitle}`} value={resolutions[item.entryId] || ""} onChange={(event) => { const resolution = event.target.value; setResolutions((current) => ({ ...current, [item.entryId]: resolution })); setQuoteForm((current) => applyReferenceResolution(current, item, resolution)); }}><option value="">Resolve…</option>{item.state === "changed" && <option value="use_current">Use current catalog item</option>}<option value="remove">Remove from quote prefill</option></select> : <span>Current</span>}</li>)}</ul>
      <fieldset><legend>Customer identity choice</legend>{preview.identity.state === "existing_claim" ? <label><input type="radio" name="identity" value="use_existing" checked={identityChoice === "use_existing"} onChange={(event) => setIdentityChoice(event.target.value)} />Use the existing same-tenant customer identity ending in {preview.identity.customerId.slice(-8)}</label> : <label><input type="radio" name="identity" value="create_new" checked={identityChoice === "create_new"} onChange={(event) => setIdentityChoice(event.target.value)} />Create a new customer identity when the quote is created</label>}</fieldset>
      <div className="inquiry-conversion__form"><label>Offer<select value={quoteForm.pkg} onChange={(event) => setQuoteForm((current) => ({ ...current, pkg: event.target.value }))}><option value="">Choose authoritative offer</option>{activeItems(catalog?.packages).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Menu selections<select multiple value={quoteForm.menuItems} onChange={(event) => setQuoteForm((current) => ({ ...current, menuItems: Array.from(event.target.selectedOptions, (option) => option.value) }))}>{activeItems(catalog?.menuItems).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small>Use Ctrl/Cmd to select more than one.</small></label><label>Event time<input type="time" value={quoteForm.time} onChange={(event) => setQuoteForm((current) => ({ ...current, time: event.target.value }))} /></label><label>Service hours<input type="number" min="0" max="72" value={quoteForm.hours} onChange={(event) => setQuoteForm((current) => ({ ...current, hours: Number(event.target.value) }))} /></label><label className="inquiry-admin__wide">Dietary notes for staff review<textarea value={quoteForm.dietaryRestrictions} onChange={(event) => setQuoteForm((current) => ({ ...current, dietaryRestrictions: event.target.value }))} placeholder="Do not treat customer notes as confirmed allergen safety." /></label></div>
      <details><summary>Exact quote prefill</summary><dl>{Object.entries(quoteForm).filter(([, value]) => typeof value !== "object" || Array.isArray(value)).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{Array.isArray(value) ? value.join(", ") || "None" : String(value)}</dd></div>)}</dl></details>
      <div className="inquiry-queue__actions"><button type="button" disabled={Boolean(busy) || !identityChoice || !quoteForm.pkg || quoteForm.menuItems.length === 0 || preview.drift.some((item) => item.requiresResolution && !resolutions[item.entryId])} onClick={convert}>{busy.startsWith("convert:") ? "Creating quote…" : "Create authoritative quote draft"}</button></div>
    </section>}
  </section>;
}
