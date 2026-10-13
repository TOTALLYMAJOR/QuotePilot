import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getInquiryShowcaseAdminState,
  pauseInquiryShowcase,
  publishInquiryShowcase,
  republishInquiryShowcaseVersion,
  saveInquiryShowcaseDraft
} from "../lib/inquiryShowcaseClient";
import "./publicInquiryPage.css";

const NEW_DRAFT = Object.freeze({ slug: "event-inquiry", pageTitle: "Tell us about your event", introduction: "Share the occasion you are planning and the experiences you would like us to consider.", responsePromise: "Our event team will review your request and follow up directly.", entries: [] });
const DEFAULT_API = Object.freeze({ getInquiryShowcaseAdminState, saveInquiryShowcaseDraft, publishInquiryShowcase, pauseInquiryShowcase, republishInquiryShowcaseVersion });

function cleanState(result) {
  return { ...result, state: result.state || {}, versions: result.versions || [], catalogReferences: result.catalogReferences || [] };
}

export default function InquiryShowcaseAdmin({
  organizationId,
  currentUserRole = "admin",
  enabled = import.meta.env.VITE_INQUIRY_SHOWCASE_ENABLED === "true",
  api = DEFAULT_API
}) {
  const [view, setView] = useState({ state: "loading", data: null, message: "" });
  const [draft, setDraft] = useState(NEW_DRAFT);
  const [tenantEnabled, setTenantEnabled] = useState(false);
  const [selectedRef, setSelectedRef] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(null);
  const load = useCallback(async () => {
    if (!enabled || !organizationId || currentUserRole !== "admin") return;
    setView((current) => ({ ...current, state: "loading" }));
    try {
      const result = cleanState(await api.getInquiryShowcaseAdminState({ organizationId }));
      setView({ state: "ready", data: result, message: "" });
      setDraft(result.state.draft || NEW_DRAFT); setTenantEnabled(result.state.tenantEnabled === true);
    } catch (error) { setView({ state: "error", data: null, message: error.message }); }
  }, [api, currentUserRole, enabled, organizationId]);
  useEffect(() => { load(); }, [load]);
  const availableRefs = useMemo(() => (view.data?.catalogReferences || []).filter((item) => item.active && item.customerSafe && !draft.entries.some((entry) => entry.referenceType === item.referenceType && entry.referenceId === item.referenceId)), [draft.entries, view.data]);
  const mutate = async (kind, action) => {
    setBusy(kind); setNotice(null);
    try { const result = await action(); setNotice({ kind: "success", message: kind === "save" ? "Draft saved. The published page was not changed." : `${kind === "pause" ? "Page paused" : "Publication recorded"}. Receipt ${result.receiptId || "saved"}.` }); await load(); }
    catch (error) { setNotice({ kind: "error", message: error.message }); }
    finally { setBusy(""); }
  };
  const addEntry = () => {
    const source = availableRefs.find((item) => `${item.referenceType}:${item.referenceId}` === selectedRef);
    if (!source) return;
    setDraft((current) => ({ ...current, entries: [...current.entries, { entryId: `entry_${crypto.randomUUID().replaceAll("-", "")}`, referenceType: source.referenceType, referenceId: source.referenceId, publicTitle: source.name, shortDescription: "", imageUrl: "", featuredLabel: "", displayOrder: current.entries.length, visible: true }] }));
    setSelectedRef("");
  };
  const moveEntry = (entryId, direction) => setDraft((current) => {
    const entries = [...current.entries];
    const index = entries.findIndex((item) => item.entryId === entryId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= entries.length) return current;
    [entries[index], entries[target]] = [entries[target], entries[index]];
    return { ...current, entries: entries.map((item, displayOrder) => ({ ...item, displayOrder })) };
  });
  if (currentUserRole !== "admin") return null;
  if (!enabled) return <section className="inquiry-admin inquiry-admin--disabled" data-capability-id="inquiry-showcase-admin" data-capability-state="recovery"><p className="inquiry-admin__eyebrow">Inquiry page</p><h2>Guided inquiry is gated off.</h2><p>Enable the global browser and server gates before an administrator can prepare a tenant publication. Nothing is published automatically.</p></section>;
  if (view.state === "loading") return <section className="inquiry-admin" data-capability-id="inquiry-showcase-admin" data-capability-state="loading"><p role="status">Loading Inquiry Showcase…</p></section>;
  if (view.state === "error") return <section className="inquiry-admin" data-capability-id="inquiry-showcase-admin" data-capability-state="error"><h2>Inquiry page unavailable</h2><p role="alert">{view.message}</p><button type="button" onClick={load}>Try again</button></section>;
  const publicationState = view.data.state.state || "draft";
  const publishedPath = view.data.state.activeSlug ? `/inquire/${view.data.state.activeSlug}` : "";
  return <section className="inquiry-admin" data-capability-id="inquiry-showcase-admin" data-capability-state={busy ? "submitting" : "ready"} data-inquiry-publication-state={publicationState} aria-labelledby="inquiry-admin-title">
    <header className="inquiry-admin__header"><div><p className="inquiry-admin__eyebrow">Library · Inquiry page</p><h2 id="inquiry-admin-title">Curate the choices customers can consider.</h2><p>This Showcase references the current Library. It owns presentation only—never price, inclusion, availability, staffing, cost, or rules.</p></div><span className={`inquiry-admin__state inquiry-admin__state--${publicationState}`}>{publicationState}</span></header>
    {notice && <div className={`inquiry-admin__notice inquiry-admin__notice--${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.message}</div>}
    {publicationState === "published" && publishedPath && <div className="inquiry-admin__notice" role="status"><strong>Customer link</strong><p>{publishedPath}</p><div className="inquiry-admin__actions"><a className="secondary" href={publishedPath} target="_blank" rel="noreferrer">Open published page</a><button type="button" className="secondary" onClick={async () => { try { const url = new URL(publishedPath, window.location.origin).toString(); await navigator.clipboard.writeText(url); setNotice({ kind: "success", message: "Customer inquiry link copied." }); } catch { setNotice({ kind: "error", message: "The link could not be copied. Open the published page and copy its address." }); } }}>Copy link</button></div></div>}
    <div className="inquiry-admin__fields"><label>Public slug<input value={draft.slug} onChange={(event) => setDraft((current) => ({ ...current, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/gu, "") }))} /><small>/inquire/{draft.slug || "…"}</small></label><label>Page title<input value={draft.pageTitle} maxLength="120" onChange={(event) => setDraft((current) => ({ ...current, pageTitle: event.target.value }))} /></label><label className="inquiry-admin__wide">Introduction<textarea value={draft.introduction} maxLength="600" onChange={(event) => setDraft((current) => ({ ...current, introduction: event.target.value }))} /></label><label className="inquiry-admin__wide">Response expectation<input value={draft.responsePromise} maxLength="180" onChange={(event) => setDraft((current) => ({ ...current, responsePromise: event.target.value }))} /></label></div>
    <label className="inquiry-admin__gate"><input type="checkbox" checked={tenantEnabled} onChange={(event) => setTenantEnabled(event.target.checked)} /><span><strong>Enable this tenant’s inquiry publication gate</strong><small>Saving this setting does not publish. Publish remains a separate receipted action.</small></span></label>
    <div className="inquiry-admin__add"><label>Library reference<select value={selectedRef} onChange={(event) => setSelectedRef(event.target.value)}><option value="">Choose an active customer-safe item</option>{availableRefs.map((item) => <option key={`${item.referenceType}:${item.referenceId}`} value={`${item.referenceType}:${item.referenceId}`}>{item.referenceType.replace("_", " ")} · {item.name}</option>)}</select></label><button type="button" onClick={addEntry} disabled={!selectedRef}>Add preference</button></div>
    <ol className="inquiry-admin__entries">{draft.entries.map((entry, index) => <li key={entry.entryId}><div className="inquiry-admin__entry-head"><span>{String(index + 1).padStart(2, "0")}</span><strong>{entry.referenceType.replace("_", " ")} · {entry.referenceId}</strong><div><button type="button" disabled={index === 0} onClick={() => moveEntry(entry.entryId, -1)}>Move up</button><button type="button" disabled={index === draft.entries.length - 1} onClick={() => moveEntry(entry.entryId, 1)}>Move down</button><button type="button" onClick={() => setDraft((current) => ({ ...current, entries: current.entries.filter((item) => item.entryId !== entry.entryId).map((item, displayOrder) => ({ ...item, displayOrder })) }))}>Remove</button></div></div><div className="inquiry-admin__entry-fields"><label>Public title<input value={entry.publicTitle} maxLength="120" onChange={(event) => setDraft((current) => ({ ...current, entries: current.entries.map((item) => item.entryId === entry.entryId ? { ...item, publicTitle: event.target.value } : item) }))} /></label><label>Featured label<input value={entry.featuredLabel} maxLength="48" onChange={(event) => setDraft((current) => ({ ...current, entries: current.entries.map((item) => item.entryId === entry.entryId ? { ...item, featuredLabel: event.target.value } : item) }))} /></label><label><span>Show on customer page</span><input type="checkbox" checked={entry.visible !== false} onChange={(event) => setDraft((current) => ({ ...current, entries: current.entries.map((item) => item.entryId === entry.entryId ? { ...item, visible: event.target.checked } : item) }))} /></label><label className="inquiry-admin__wide">Short description<textarea value={entry.shortDescription} maxLength="360" onChange={(event) => setDraft((current) => ({ ...current, entries: current.entries.map((item) => item.entryId === entry.entryId ? { ...item, shortDescription: event.target.value } : item) }))} /></label><label className="inquiry-admin__wide">HTTPS image URL<input type="url" value={entry.imageUrl} onChange={(event) => setDraft((current) => ({ ...current, entries: current.entries.map((item) => item.entryId === entry.entryId ? { ...item, imageUrl: event.target.value } : item) }))} /></label></div></li>)}</ol>
    {draft.entries.some((entry) => entry.visible !== false) && <details className="inquiry-admin__preview"><summary>Preview customer-safe projection</summary><div className="inquiry-admin__preview-cards">{draft.entries.filter((entry) => entry.visible !== false).map((entry) => <article key={entry.entryId}>{entry.imageUrl && <img src={entry.imageUrl} alt="" />}<small>{entry.featuredLabel}</small><h3>{entry.publicTitle}</h3><p>{entry.shortDescription || "No public description yet."}</p><span>Preference only</span></article>)}</div></details>}
    <div className="inquiry-admin__actions"><button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => mutate("save", () => api.saveInquiryShowcaseDraft({ organizationId, tenantEnabled, draft }))}>{busy === "save" ? "Saving…" : "Save draft"}</button>{publicationState === "published" && <button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => mutate("pause", () => api.pauseInquiryShowcase({ organizationId }))}>Pause page</button>}<button type="button" disabled={Boolean(busy) || !tenantEnabled || draft.entries.length === 0} onClick={() => mutate("publish", async () => { await api.saveInquiryShowcaseDraft({ organizationId, tenantEnabled, draft }); return api.publishInquiryShowcase({ organizationId }); })}>{busy === "publish" ? "Publishing…" : "Publish immutable version"}</button></div>
    {view.data.versions.length > 0 && <details className="inquiry-admin__history"><summary>Publication history ({view.data.versions.length})</summary><ol>{view.data.versions.map((version) => <li key={version.id}><div><strong>{version.id}</strong><span>{version.slug} · catalog revision {version.catalogRevision}</span><small>{version.publishedAtISO}</small></div><button type="button" disabled={Boolean(busy)} onClick={() => mutate("republish", () => api.republishInquiryShowcaseVersion({ organizationId, versionId: version.id }))}>Republish as new version</button></li>)}</ol></details>}
  </section>;
}
