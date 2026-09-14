import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from "react";
import AdaptiveChoiceField from "./AdaptiveChoiceField";
import InlineValue from "./ambient/InlineValue";
import DigitRoll from "./DigitRoll";
import DeliveryProposal from "./DeliveryProposal";
import { currency } from "../lib/quoteCalculator";
import { normalizeBrandLogoUrl } from "../lib/brandLogoUrl";
import { normalizeProposalDocumentFontScale } from "../lib/proposalDocumentPreferences";
import { detectBreakdownValueChanges, MAX_EVENT_HOURS, MIN_EVENT_HOURS, normalizeEventHours } from "../lib/wizardUi";
import { buildMarginPresentation, marginRequiresExpandedEvidence } from "./marginPresentation";
import { playCue } from "./soundKit";
import {
  buildCompositionLine,
  buildCommercialWorkbenchModel,
  buildExperienceModel,
  buildExperienceSectionStatus,
  buildGuestChangeConsequences,
  buildHeaderModel,
  buildInvestmentModel,
  buildMenuModel,
  buildPackageOptions,
  buildPulseValueMap,
  buildRentalSuggestionPatch,
  buildSectionCompleteness,
  buildStaffingRecommendation,
  buildStaffingRecommendationPatch,
  buildStyleOptions,
  buildWatchingList,
  formatEventDateLong,
  impactPhrase,
  previewPatchImpact
} from "./proposalComposerPresentation";
import "./proposalComposer.css";

const LivingCommercialTwin = lazy(() => import("./LivingCommercialTwin"));

// Margin stays behind the same default-off gate LiveBreakdown uses; the
// composer never introduces a wider margin surface than the wizard had.
const PILOT_MARGINS_ENABLED = ["1", "true", "yes", "on"].includes(
  String(import.meta.env.VITE_PILOT_MARGINS_ENABLED || "").trim().toLowerCase()
);

const FLASH_CLEAR_MS = 620;
const ACTIVITY_LOG_LIMIT = 30;

const ACTIVITY_FIELD_LABELS = {
  eventTypeId: "Event type",
  eventName: "Event name",
  date: "Date",
  time: "Start time",
  hours: "Duration",
  guests: "Guests",
  venue: "Venue",
  venueAddress: "Venue address",
  dietaryRestrictions: "Dietary notes",
  name: "Client name",
  clientOrg: "Organization",
  phone: "Phone",
  email: "Email",
  servers: "Servers",
  chefs: "Chefs",
  bartenders: "Bartenders",
  pkg: "Package",
  style: "Service style",
  taxRegion: "Tax region",
  seasonProfileId: "Season profile",
  milesRT: "Travel miles",
  payMethod: "Payment method",
  eventTemplateId: "Event template",
  serverRateOverride: "Server rate override",
  serverRateMixCsv: "Server rate mix",
  chefRateOverride: "Chef rate override",
  chefRateMixCsv: "Chef rate mix",
  bartenderRateOverride: "Bartender rate override"
};

function activityValue(value) {
  const text = String(value ?? "").trim();
  if (!text) return "cleared";
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

function brandInitials(value) {
  const initials = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return initials || "QP";
}

function clampInt(draft, min, max) {
  const parsed = Math.round(Number(draft));
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, parsed));
}

function requireCount(min, max, noun) {
  return (draft) => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
      return `Enter ${noun} between ${min} and ${max}.`;
    }
    return "";
  };
}

function SectionHeading({ id, eyebrow, title, complete, status = null }) {
  const resolvedStatus = status || (complete ? {
    id: "complete",
    label: "✓ Complete",
    ariaLabel: `${eyebrow} section complete`
  } : null);
  return (
    <header className="pc-section-head">
      <h2 className="pc-eyebrow" id={id}>{eyebrow}</h2>
      <div className="pc-section-title-row">
        {title ? <h3 className="pc-section-title">{title}</h3> : null}
        {resolvedStatus ? (
          <span
            className="pc-section-status"
            data-state={resolvedStatus.id}
            aria-label={resolvedStatus.ariaLabel}
          >
            {resolvedStatus.label}
          </span>
        ) : null}
      </div>
    </header>
  );
}

function PcSelect({ label, value, onChange, children, hint }) {
  const id = useId();
  return (
    <div className="pc-select">
      <label className="pc-field-label" htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
      {hint ? <small className="pc-field-hint">{hint}</small> : null}
    </div>
  );
}

function buildChoiceSet(items, {
  currentValue = "",
  getValue = (item) => item?.id,
  getLabel = (item) => item?.name
} = {}) {
  const seenValues = new Set();
  const options = (Array.isArray(items) ? items : [])
    .map((item) => ({
      value: String(getValue(item) ?? "").trim(),
      label: String(getLabel(item) ?? "").trim()
    }))
    .filter((option) => {
      if (!option.value || !option.label || seenValues.has(option.value)) return false;
      seenValues.add(option.value);
      return true;
    });
  const selectedValue = String(currentValue || "").trim();
  const stale = Boolean(selectedValue && !options.some((option) => option.value === selectedValue));
  return {
    stale,
    options: stale && options.length > 0
      ? [{ value: selectedValue, label: `${selectedValue} (no longer available)`, disabled: true }, ...options]
      : options
  };
}

function PcQuietInput({ label, value, onChange, hint, type = "text", inputMode, placeholder }) {
  const id = useId();
  return (
    <div className="pc-quiet-field">
      <label className="pc-field-label" htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        inputMode={inputMode}
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint ? <small className="pc-field-hint">{hint}</small> : null}
    </div>
  );
}

function ImpactTag({ delta }) {
  if (delta === null || delta === undefined) return null;
  const phrase = impactPhrase(delta);
  const tone = !Number.isFinite(delta) || Math.abs(delta) < 0.005
    ? "neutral"
    : delta > 0
      ? "add"
      : "reduce";
  return <em className="pc-impact" data-tone={tone}>{phrase}</em>;
}

function ClientPreviewDialog({
  open,
  onClose,
  form,
  totals,
  experience,
  menu,
  settings = {},
  documentFontPreference
}) {
  const closeRef = useRef(null);
  const restoreRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    restoreRef.current = document.activeElement;
    closeRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      if (restoreRef.current && typeof restoreRef.current.focus === "function") {
        restoreRef.current.focus();
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  const guests = Math.max(0, Math.round(Number(form.guests) || 0));
  const brandName = String(settings.brandName || settings.organizationName || "Your catering team").trim()
    || "Your catering team";
  const brandTagline = String(settings.brandTagline || "").trim();
  const brandLogoUrl = normalizeBrandLogoUrl(settings.brandLogoUrl);
  const proposalIntroTitle = String(settings.proposalIntroTitle || "").trim();
  const proposalIntroMessage = String(settings.proposalIntroMessage || "").trim();
  const proposalClosingMessage = String(settings.proposalClosingMessage || "").trim();
  const fontPreference = documentFontPreference || normalizeProposalDocumentFontScale(settings.documentFontScale);
  const included = [
    "Menu",
    (Number(form.servers) || 0) + (Number(form.chefs) || 0) > 0 ? "Staffing" : null,
    (Number(form.bartenders) || 0) > 0 ? "Bartending" : null,
    (form.rentals || []).length ? "Rentals" : null,
    "Coordination"
  ].filter(Boolean);

  return (
    <div className="pc-preview-scrim" onClick={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <article
        className="pc-preview-dialog"
        style={{ "--pc-preview-font-scale": String(fontPreference.scale) }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pc-preview-title"
        data-testid="pc-client-preview"
      >
        <header className="pc-preview-head">
          <p className="pc-eyebrow">Client view</p>
          <button ref={closeRef} type="button" className="pc-ghost" onClick={onClose}>
            Close preview
          </button>
        </header>
        <div className="pc-preview-sheet">
          <div className="pc-preview-brandline">
            <span className="pc-brand-mark" data-logo-state={brandLogoUrl ? "image" : "monogram"}>
              {brandLogoUrl ? <img src={brandLogoUrl} alt={`${brandName} logo`} /> : brandInitials(brandName)}
            </span>
            <span>
              <strong>{brandName}</strong>
              <small>{brandTagline || `${fontPreference.label} proposal text`}</small>
            </span>
          </div>
          <h2 className="pc-preview-title" id="pc-preview-title">
            {String(form.eventName || "Your event").trim() || "Your event"}
          </h2>
          <p className="pc-preview-meta">
            {[formatEventDateLong(form.date), String(form.venue || "").trim()]
              .filter(Boolean)
              .join(" · ") || "Date and venue to be confirmed"}
          </p>
          {proposalIntroTitle ? <p className="pc-eyebrow">{proposalIntroTitle}</p> : null}
          {proposalIntroMessage ? <p className="pc-preview-copy">{proposalIntroMessage}</p> : null}
          <hr className="pc-rule" />
          <p className="pc-eyebrow">Your experience</p>
          <h3 className="pc-preview-sub">{experience.title}</h3>
          <p className="pc-preview-copy">{experience.blurb}</p>
          {guests > 0 ? <p className="pc-preview-copy">Prepared for {guests} guests.</p> : null}
          {menu.groups.length ? (
            <div className="pc-preview-menu">
              {menu.groups.map((group) => (
                <div key={group.id}>
                  <p className="pc-preview-group">{group.name}</p>
                  <ul>
                    {group.items.map((item) => <li key={item.id}>{item.name}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          ) : null}
          <hr className="pc-rule" />
          <p className="pc-eyebrow">Investment</p>
          <p className="pc-preview-total">{currency(totals.total)}</p>
          <p className="pc-preview-copy">Deposit {currency(totals.deposit)}</p>
          <hr className="pc-rule" />
          <p className="pc-eyebrow">Included</p>
          <ul className="pc-preview-included">
            {included.map((item) => <li key={item}>{item}</li>)}
          </ul>
          {proposalClosingMessage ? (
            <>
              <hr className="pc-rule" />
              <p className="pc-eyebrow">Closing note</p>
              <p className="pc-preview-copy">{proposalClosingMessage}</p>
            </>
          ) : null}
        </div>
        <p className="pc-preview-note">
          Draft preview. The final proposal is generated when this quote is saved and sent.
        </p>
      </article>
    </div>
  );
}

export function buildDraftSaveBlockers({
  form = {},
  totals = {},
  catalogLoading = false,
  selectedMenuItemCount = 0,
  quoteEditUnavailable = false,
  pilotScenarioReviewPending = false,
  draftIntentReviewPending = false,
  changeImpactReviewRequired = false,
  changeImpactAuthorizationRequired = false
} = {}) {
  const blockers = [];
  const add = (id, message) => blockers.push({ id, message });
  const email = String(form.email || "").trim();

  if (catalogLoading) {
    add("catalog-loading", "Wait for the current catalog to finish loading.");
  }
  if (quoteEditUnavailable) {
    add("quote-edit-loading", "Reload the saved quote before editing or saving it.");
  }
  if (pilotScenarioReviewPending) {
    add("pilot-scenario-review", "Resolve the pending Pilot scenario review.");
  }
  if (draftIntentReviewPending) {
    add("draft-intent-review", "Resolve the pending Package or Menu review.");
  }
  if (changeImpactReviewRequired) {
    add("change-impact-review", "Build and review a current Change Impact simulation.");
  } else if (changeImpactAuthorizationRequired) {
    add("change-impact-authorization", "Authorize and apply governed dependencies from Change Impact.");
  }
  if (Math.max(0, Number(totals.guests) || 0) <= 0) {
    add("guest-count", "Set a guest count above zero.");
  }
  if (!String(form.name || "").trim()) {
    add("client-name", "Add the client name.");
  }
  if (!email) {
    add("client-email", "Add the client email.");
  } else if (!/^\S+@\S+\.\S+$/.test(email)) {
    add("client-email-format", "Correct the client email format.");
  }
  if (!String(form.eventTypeId || "").trim()) {
    add("event-type", "Choose an event type.");
  }
  if (!String(form.date || "").trim()) {
    add("event-date", "Add the event date.");
  }
  if (!String(form.eventName || "").trim()) {
    add("event-name", "Add the event name.");
  }
  if (!String(form.venue || "").trim()) {
    add("venue", "Add the venue.");
  }
  if (Math.max(0, Number(selectedMenuItemCount) || 0) < 1) {
    add("menu-selection", "Select at least one menu item.");
  }

  return blockers;
}

export function buildSaveActionModel({
  saveBlockers = [],
  saveLabel = "Save draft",
  saveDisabled = false
} = {}) {
  const blockerCount = Array.isArray(saveBlockers)
    ? saveBlockers.filter((blocker) => blocker && String(blocker.message || "").trim()).length
    : 0;
  return blockerCount > 0
    ? {
        mode: "review",
        label: `Review ${blockerCount} blocker${blockerCount === 1 ? "" : "s"}`,
        disabled: false
      }
    : { mode: "save", label: saveLabel, disabled: Boolean(saveDisabled) };
}

export default function ProposalComposer({
  form,
  totals,
  catalog,
  settings,
  menuSections = [],
  menuLoading = false,
  menuError = "",
  packageIncludedMenuItemIds = [],
  eventTypes = [],
  eventTemplates = [],
  readiness = null,
  editingQuote = null,
  touchedFields = {},
  quoteDirty = false,
  saving = false,
  saveLabel = "Save draft",
  saveDisabled = false,
  saveDisabledReason = "",
  saveBlockers = [],
  saveMessage = "",
  compareEnabled = false,
  catalogLoading = false,
  onFieldChange,
  onSelectionTouched,
  onPatchForm,
  onTemplateChange,
  onEventTypeChange,
  onSaveQuote,
  onOpenCompare,
  onGuidedMode,
  reviewSurfaces = null,
  statusNotes = null,
  changeImpactSurface = null,
  livingCommercialTwin = null,
  deliveryPlanningEvidence = null,
  deliveryPlanningOperatorId = "",
  onDeliveryPlanningHandoff = null,
  impactWatch = null,
  isAdmin = false,
  onOpenCatalogPricing = null
}) {
  const [menuEditorOpen, setMenuEditorOpen] = useState(false);
  const [ratesEditorOpen, setRatesEditorOpen] = useState(false);
  const [menuQuery, setMenuQuery] = useState("");
  const [openMenuGroups, setOpenMenuGroups] = useState(() => new Set());
  const [marginDetailOpen, setMarginDetailOpen] = useState(false);
  const [experienceEditorOpen, setExperienceEditorOpen] = useState(false);
  const [rentalEditorOpen, setRentalEditorOpen] = useState(false);
  const [enhancementEditorOpen, setEnhancementEditorOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [activeDomain, setActiveDomain] = useState("event");
  const [pulseOpen, setPulseOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [guestAnchor, setGuestAnchor] = useState(null);
  const [flashKeys, setFlashKeys] = useState(() => new Set());
  const [liveNote, setLiveNote] = useState("");
  // Session-only running log of the changes made to this draft — a working
  // memory for the operator, not a record; saved history stays in versions.
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityLog, setActivityLog] = useState([]);
  const activityIdRef = useRef(0);
  const saveReadinessRef = useRef(null);
  const pendingSaveReviewFocusRef = useRef(false);

  const eventTypeChoices = buildChoiceSet(eventTypes, {
    currentValue: form.eventTypeId
  });
  const templateChoices = buildChoiceSet([
    { id: "custom", name: "Custom" },
    ...(eventTemplates || [])
  ], {
    currentValue: form.eventTemplateId || "custom"
  });
  const taxRegionChoices = buildChoiceSet(settings?.taxRegions, {
    currentValue: form.taxRegion,
    getLabel: (region) => `${region?.name || region?.id} (${Math.round(Number(region?.rate || 0) * 1000) / 10}%)`
  });
  const seasonChoices = buildChoiceSet([
    { id: "auto", name: "Auto detect" },
    ...(settings?.seasonalProfiles || [])
  ], {
    currentValue: form.seasonProfileId || "auto"
  });
  const setupRecoveryAction = typeof onOpenCatalogPricing === "function"
    ? { label: "Open Library setup", onClick: onOpenCatalogPricing }
    : { label: "Review guided setup", onClick: onGuidedMode };

  useEffect(() => {
    if (
      eventTypeChoices.options.length === 1
      && !eventTypeChoices.stale
      && String(form.eventTypeId || "") !== eventTypeChoices.options[0].value
    ) {
      onEventTypeChange(eventTypeChoices.options[0].value);
    }
    if (
      taxRegionChoices.options.length === 1
      && !taxRegionChoices.stale
      && String(form.taxRegion || "") !== taxRegionChoices.options[0].value
    ) {
      onFieldChange("taxRegion", taxRegionChoices.options[0].value);
    }
  }, [
    eventTypeChoices.options,
    eventTypeChoices.stale,
    form.eventTypeId,
    form.taxRegion,
    onEventTypeChange,
    onFieldChange,
    taxRegionChoices.options,
    taxRegionChoices.stale
  ]);

  const currentSaveBlockers = Array.isArray(saveBlockers)
    ? saveBlockers.filter((blocker) => blocker && String(blocker.message || "").trim())
    : [];
  const saveReadinessState = saving
    ? "saving"
    : currentSaveBlockers.length
      ? "blocked"
      : "ready";
  const saveReadinessTitle = saving
    ? "Save in progress"
    : currentSaveBlockers.length
      ? `Draft needs attention · ${currentSaveBlockers.length}`
      : "Ready for save checks";
  const saveReadinessDetail = saving
    ? "QuotePilot is verifying availability and server authority."
    : currentSaveBlockers.length
      ? "Resolve these known requirements before this draft can be saved."
      : "Known draft requirements are complete. Saving still verifies availability and server authority.";
  const saveAction = buildSaveActionModel({
    saveBlockers: currentSaveBlockers,
    saveLabel,
    saveDisabled
  });

  const logActivity = (label) => {
    activityIdRef.current += 1;
    const entry = {
      id: activityIdRef.current,
      at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      label
    };
    setActivityLog((current) => [entry, ...current].slice(0, ACTIVITY_LOG_LIMIT));
  };

  const requestSave = () => {
    setPulseOpen(true);
    if (saveAction.mode === "review") {
      pendingSaveReviewFocusRef.current = true;
      return;
    }
    onSaveQuote?.();
  };

  useEffect(() => {
    if (!pulseOpen || !pendingSaveReviewFocusRef.current) return;
    pendingSaveReviewFocusRef.current = false;
    const frame = window.requestAnimationFrame(() => saveReadinessRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [pulseOpen]);

  const header = buildHeaderModel({ form, editingQuote, quoteDirty, saving });
  const completeness = useMemo(
    () => buildSectionCompleteness({ form, totals, catalog }),
    [form, totals, catalog]
  );
  const experienceSectionStatus = useMemo(
    () => buildExperienceSectionStatus({
      complete: completeness.experience,
      saved: Boolean(editingQuote?.id),
      packageReviewed: Boolean(touchedFields?.pkg),
      styleReviewed: Boolean(touchedFields?.style)
    }),
    [completeness.experience, editingQuote?.id, touchedFields?.pkg, touchedFields?.style]
  );
  const staffing = useMemo(() => buildStaffingRecommendation(form), [form]);
  const workbench = useMemo(
    () => buildCommercialWorkbenchModel({
      form,
      totals,
      catalog,
      completeness,
      blockers: currentSaveBlockers,
      staffing
    }),
    [form, totals, catalog, completeness, currentSaveBlockers, staffing]
  );
  const watching = useMemo(
    () => buildWatchingList({ form, totals, readiness, staffing }),
    [form, totals, readiness, staffing]
  );
  const investment = useMemo(
    () => buildInvestmentModel({ form, totals, catalog, settings }),
    [form, totals, catalog, settings]
  );
  const composition = useMemo(
    () => buildCompositionLine({ form, totals, catalog }),
    [form, totals, catalog]
  );
  const experience = useMemo(
    () => buildExperienceModel({ form, catalog }),
    [form, catalog]
  );
  const menu = useMemo(
    () => buildMenuModel({ form, menuSections, packageIncludedIds: packageIncludedMenuItemIds }),
    [form, menuSections, packageIncludedMenuItemIds]
  );
  const margin = useMemo(
    () => (PILOT_MARGINS_ENABLED ? buildMarginPresentation({ form, totals, catalog, settings }) : null),
    [form, totals, catalog, settings]
  );
  const packageOptions = useMemo(
    () => (experienceEditorOpen
      ? buildPackageOptions({ form, catalog, settings, totals })
      : []),
    [experienceEditorOpen, form, catalog, settings, totals]
  );
  const styleOptions = useMemo(
    () => (experienceEditorOpen
      ? buildStyleOptions({ form, catalog, settings, totals })
      : []),
    [experienceEditorOpen, form, catalog, settings, totals]
  );

  const consequences = useMemo(
    () => (guestAnchor
      ? buildGuestChangeConsequences({
          previousForm: guestAnchor.form,
          previousTotals: guestAnchor.totals,
          form,
          totals,
          catalog
        })
      : null),
    [guestAnchor, form, totals, catalog]
  );

  // A reverted guest count leaves nothing to explain — drop the card.
  useEffect(() => {
    if (guestAnchor && !consequences) setGuestAnchor(null);
  }, [guestAnchor, consequences]);

  // Flash exactly the money rows whose values moved, then let the warm
  // highlight fade (CSS handles reduced motion by not animating at all).
  const pulseValues = buildPulseValueMap(totals);
  const previousPulseRef = useRef(pulseValues);
  const flashTimerRef = useRef(null);
  useEffect(() => {
    const changes = detectBreakdownValueChanges(previousPulseRef.current, pulseValues);
    previousPulseRef.current = pulseValues;
    const changedKeys = Object.keys(changes);
    if (!changedKeys.length) return undefined;
    setFlashKeys(new Set(changedKeys));
    if (changes.total !== undefined) {
      setLiveNote(`Quote total updated to ${currency(pulseValues.total)}.`);
    }
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlashKeys(new Set()), FLASH_CLEAR_MS);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totals]);
  useEffect(() => () => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
  }, []);

  const flashAttr = (key) => (flashKeys.has(key) ? "on" : undefined);

  const openDomain = (domainId) => {
    setActiveDomain(domainId);
    if (domainId !== "experience") {
      setExperienceEditorOpen(false);
      setMenuEditorOpen(false);
      setRentalEditorOpen(false);
      setEnhancementEditorOpen(false);
    }
    window.requestAnimationFrame?.(() => {
      document.querySelector(`[data-workbench-panel="${domainId}"]`)?.focus({ preventScroll: true });
    });
  };

  const commitField = (field) => (value) => {
    onFieldChange(field, value);
    logActivity(`${ACTIVITY_FIELD_LABELS[field] || field} → ${activityValue(value)}`);
  };

  const commitGuests = (next) => {
    if (Number(next) !== Number(form.guests)) {
      setGuestAnchor({ form, totals });
    }
    onFieldChange("guests", next);
    logActivity(`Guests → ${activityValue(next)}`);
  };

  const applyConsequenceFollowUps = () => {
    if (!consequences) return;
    const staffingPatch = buildStaffingRecommendationPatch(form);
    if (staffingPatch) {
      Object.entries(staffingPatch).forEach(([field, value]) => onFieldChange(field, value));
    }
    const rentalPatch = buildRentalSuggestionPatch(form, consequences.rentalSuggestions);
    if (rentalPatch) {
      onSelectionTouched("rentalQuantities");
      onPatchForm(rentalPatch);
    }
    logActivity("Applied staffing & rental follow-ups");
    setGuestAnchor(null);
  };

  const undoGuestChange = () => {
    if (!consequences) return;
    onFieldChange("guests", consequences.from);
    logActivity(`Undid guest change (back to ${consequences.from})`);
    setGuestAnchor(null);
  };

  const applyStaffingRecommendation = () => {
    const patch = buildStaffingRecommendationPatch(form);
    if (!patch) return;
    Object.entries(patch).forEach(([field, value]) => onFieldChange(field, value));
    logActivity("Applied the staffing recommendation");
  };

  const toggleCatalogSelection = (field, quantityField, itemId, itemName = "") => {
    onSelectionTouched(field, itemId);
    const selected = new Set((form[field] || []).map(String));
    const id = String(itemId);
    // Same cue contract as the wizard: a quiet tick on explicit selection
    // only, never on removal, gated by the operator's sound preference.
    if (!selected.has(id)) playCue("tick");
    const nextIds = selected.has(id)
      ? (form[field] || []).filter((entry) => String(entry) !== id)
      : [...(form[field] || []), itemId];
    const nextQuantities = { ...(form[quantityField] || {}) };
    if (selected.has(id)) delete nextQuantities[id];
    onPatchForm({ [field]: nextIds, [quantityField]: nextQuantities });
    logActivity(`${selected.has(id) ? "Removed" : "Added"} ${itemName || id}`);
  };

  const setSelectionQuantity = (field, quantityField, itemId, rawValue, itemName = "") => {
    onSelectionTouched(quantityField, itemId);
    const parsed = Math.max(1, Math.round(Number(rawValue) || 1));
    onPatchForm({
      [quantityField]: { ...(form[quantityField] || {}), [itemId]: parsed }
    });
    logActivity(`${itemName || itemId} quantity → ${parsed}`);
  };

  const selectedAddonIds = (form.addons || []).map(String);
  const selectedAddonEntries = useMemo(
    () => selectedAddonIds
      .map((id) => {
        const item = (catalog.addons || []).find((entry) => String(entry?.id) === id);
        if (!item) return null;
        const removal = previewPatchImpact({
          form,
          catalog,
          settings,
          totals,
          patch: {
            addons: (form.addons || []).filter((entry) => String(entry) !== id)
          }
        });
        return {
          id,
          name: item.name || id,
          contribution: removal.delta === null ? null : Math.round(-removal.delta * 100) / 100
        };
      })
      .filter(Boolean),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form.addons, form.addonQuantities, totals, catalog, settings]
  );

  const availableAddons = useMemo(
    () => (enhancementEditorOpen
      ? (catalog.addons || [])
          .filter((item) => item?.active !== false && !selectedAddonIds.includes(String(item?.id)))
          .map((item) => {
            const addition = previewPatchImpact({
              form,
              catalog,
              settings,
              totals,
              patch: { addons: [...(form.addons || []), item.id] }
            });
            return { id: String(item.id), name: item.name || String(item.id), delta: addition.delta };
          })
      : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enhancementEditorOpen, form.addons, totals, catalog, settings]
  );

  const rentalRows = useMemo(
    () => (form.rentals || []).map((id) => {
      const item = (catalog.rentals || []).find((entry) => String(entry?.id) === String(id));
      if (!item) return null;
      const explicit = Number((form.rentalQuantities || {})[id]);
      const auto = typeof item.qtyRule === "function"
        ? item.qtyRule(Math.max(0, Number(form.guests) || 0))
        : null;
      return {
        id: String(id),
        name: item.name || String(id),
        quantity: Number.isFinite(explicit) && explicit > 0 ? Math.round(explicit) : auto,
        autoQuantity: !(Number.isFinite(explicit) && explicit > 0)
      };
    }).filter(Boolean),
    [form.rentals, form.rentalQuantities, form.guests, catalog.rentals]
  );

  const availableRentals = useMemo(
    () => (rentalEditorOpen
      ? (catalog.rentals || [])
          .filter((item) => item?.active !== false
            && !(form.rentals || []).map(String).includes(String(item?.id)))
          .map((item) => ({ id: String(item.id), name: item.name || String(item.id) }))
      : []),
    [rentalEditorOpen, form.rentals, catalog.rentals]
  );

  const menuEditorSections = useMemo(() => {
    if (!menuEditorOpen) return [];
    const query = menuQuery.trim().toLowerCase();
    return (menuSections || [])
      .map((section) => {
        const items = (section?.items || [])
          .filter((item) => !query || String(item?.name || "").toLowerCase().includes(query))
          .map((item) => {
            const id = String(item.id);
            const selected = (form.menuItems || []).map(String).includes(id);
            const impact = previewPatchImpact({
              form,
              catalog,
              settings,
              totals,
              patch: {
                menuItems: selected
                  ? (form.menuItems || []).filter((entry) => String(entry) !== id)
                  : [...(form.menuItems || []), item.id]
              }
            });
            return {
              id,
              name: item.name || id,
              selected,
              delta: impact.delta === null ? null : (selected ? impact.delta : impact.delta)
            };
          });
        return items.length
          ? { id: String(section.id ?? section.name), name: section.name || "Menu", items }
          : null;
      })
      .filter(Boolean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuEditorOpen, menuQuery, menuSections, form.menuItems, totals, catalog, settings]);

  const guests = Math.max(0, Math.round(Number(form.guests) || 0));
  const eventTypeName = (eventTypes || []).find(
    (item) => String(item?.id) === String(form.eventTypeId)
  )?.name || "";
  const documentFontPreference = normalizeProposalDocumentFontScale(settings?.documentFontScale);
  const brandName = String(settings?.brandName || settings?.organizationName || "Your catering team").trim()
    || "Your catering team";
  const brandLogoUrl = normalizeBrandLogoUrl(settings?.brandLogoUrl);
  const proposalIntroTitle = String(settings?.proposalIntroTitle || "").trim();
  const proposalIntroMessage = String(settings?.proposalIntroMessage || "").trim();
  const proposalClosingMessage = String(settings?.proposalClosingMessage || "").trim();
  const selectedTemplate = (eventTemplates || []).find(
    (template) => String(template?.id || "") === String(form.eventTemplateId || "")
  );
  const templateLabel = selectedTemplate?.name
    || (String(form.eventTemplateId || "").trim() && String(form.eventTemplateId || "").trim() !== "custom"
      ? String(form.eventTemplateId || "").trim()
      : "Custom");
  const proposalPolishItems = [
    {
      id: "brand-logo",
      label: "Logo",
      detail: brandLogoUrl ? "Defined" : "Monogram fallback",
      state: brandLogoUrl ? "ready" : "watch"
    },
    {
      id: "brand-name",
      label: "Brand",
      detail: brandName,
      state: brandName === "Your catering team" ? "watch" : "ready"
    },
    {
      id: "font-scale",
      label: "Font",
      detail: documentFontPreference.label,
      state: "ready"
    },
    {
      id: "template",
      label: "Template",
      detail: templateLabel,
      state: templateLabel === "Custom" ? "watch" : "ready"
    },
    {
      id: "client-contact",
      label: "Client",
      detail: String(form.email || "").trim() ? "Email ready" : "Needs email",
      state: String(form.email || "").trim() ? "ready" : "risk"
    },
    {
      id: "event-details",
      label: "Event",
      detail: String(form.date || "").trim() && String(form.venue || "").trim() ? "Date and venue set" : "Needs date or venue",
      state: String(form.date || "").trim() && String(form.venue || "").trim() ? "ready" : "watch"
    },
    {
      id: "menu",
      label: "Menu",
      detail: menu.empty ? "No dishes selected" : `${menu.groups.reduce((sum, group) => sum + group.items.length, 0)} dishes`,
      state: menu.empty ? "risk" : "ready"
    },
    {
      id: "staffing",
      label: "Staffing",
      detail: (Number(form.servers) || 0) + (Number(form.chefs) || 0) + (Number(form.bartenders) || 0) > 0
        ? "Team shown"
        : "No staff listed",
      state: (Number(form.servers) || 0) + (Number(form.chefs) || 0) + (Number(form.bartenders) || 0) > 0
        ? "ready"
        : "watch"
    },
    {
      id: "enhancements",
      label: "Enhancements",
      detail: selectedAddonEntries.length ? `${selectedAddonEntries.length} add-ons` : "None selected",
      state: "ready"
    },
    {
      id: "rentals",
      label: "Rentals",
      detail: rentalRows.length ? `${rentalRows.length} rentals` : "None selected",
      state: "ready"
    },
    {
      id: "terms",
      label: "Terms",
      detail: settings?.depositNotice ? "Deposit note set" : `${Math.max(1, Number(settings?.quoteValidityDays || 30))} day validity`,
      state: "ready"
    },
    {
      id: "save-health",
      label: "Save",
      detail: saveReadinessTitle,
      state: saveReadinessState === "blocked" ? "risk" : "ready"
    }
  ];
  const proposalPolishReadyCount = proposalPolishItems.filter((item) => item.state === "ready").length;
  const marginNeedsAttention = marginRequiresExpandedEvidence(margin);
  useEffect(() => {
    setMarginDetailOpen(marginNeedsAttention);
  }, [marginNeedsAttention]);

  const pulseBody = (
    <>
      <div className="pc-pulse-money">
        <p className="pc-pulse-total" data-testid="pc-pulse-total" data-pc-flash={flashAttr("total")}>
          <DigitRoll value={currency(investment.total)} />
        </p>
        {investment.perGuest !== null ? (
          <p className="pc-pulse-perguest">{currency(investment.perGuest)} / guest</p>
        ) : null}
        <dl className="pc-pulse-facts">
          <div data-pc-flash={flashAttr("deposit")}>
            <dt>{investment.depositLabel}</dt>
            <dd>{currency(investment.deposit)}</dd>
          </div>
          {margin?.available ? (
            <div>
              <dt>Margin</dt>
              <dd>{(margin.marginPct * 100).toFixed(1)}%</dd>
            </div>
          ) : null}
        </dl>
        {margin && !margin.available ? (
          <p className="pc-pulse-note">{margin.note}</p>
        ) : null}
        {margin?.available && margin.targetNote ? (
          <p className="pc-pulse-note">{margin.targetNote}</p>
        ) : null}
      </div>

      {workbench.blockerTargets.length ? (
        <div className="pc-pulse-block pc-truth-blockers" data-testid="commercial-truth-blockers">
          <p className="pc-eyebrow">Actionable blockers</p>
          <ul>
            {workbench.blockerTargets.map((blocker) => (
              <li key={blocker.id || blocker.message}>
                <button type="button" onClick={() => openDomain(blocker.domainId)}>
                  <span>{blocker.message}</span>
                  <small>Review {workbench.domains.find((domain) => domain.id === blocker.domainId)?.label}</small>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {consequences ? (
        <div className="pc-pulse-block" data-testid="commercial-truth-consequence">
          <p className="pc-eyebrow">Current consequence</p>
          <p>
            Guests changed from {consequences.from || "—"} to {consequences.to}; the total moved by{" "}
            <ImpactTag delta={consequences.totalDelta} />.
          </p>
          <button type="button" className="pc-watch-link" onClick={() => openDomain("event")}>Review guest change</button>
        </div>
      ) : null}

      {composition.length ? (
        <div className="pc-pulse-block">
          <p className="pc-eyebrow">Composition</p>
          <ul className="pc-pulse-composition">
            {composition.map((part) => <li key={part}>{part}</li>)}
          </ul>
        </div>
      ) : null}

      <div className="pc-pulse-block">
        <p className="pc-eyebrow">Watching</p>
        <ul className="pc-watching" data-testid="pc-watching">
          {watching.map((item) => (
            <li key={item.id} data-state={item.state}>
              <span className="pc-watch-dot" aria-hidden="true" />
              <span className="pc-watch-copy">
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </span>
            </li>
          ))}
          {impactWatch ? (
            <li data-state={impactWatch.available && impactWatch.previewed ? "ok" : "watch"}>
              <span className="pc-watch-dot" aria-hidden="true" />
              <span className="pc-watch-copy">
                <strong>Saved-quote impact</strong>
                <small>
                  {!impactWatch.available
                    ? "Unavailable in browser-local mode"
                    : impactWatch.previewed
                      ? "Preview ready below"
                      : "Not previewed yet"}
                </small>
                <button
                  type="button"
                  className="pc-watch-link"
                  onClick={() => {
                    const reduce = typeof window !== "undefined"
                      && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
                    document
                      .querySelector('[data-capability-id="cwf-15b-commercial-change-impact-preview"]')
                      ?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
                  }}
                >
                  {impactWatch.previewed ? "View impact preview" : "Review change impact"}
                </button>
              </span>
            </li>
          ) : null}
        </ul>
      </div>

      <div className="pc-pulse-block pc-proposal-polish" data-testid="pc-proposal-polish">
        <div className="pc-pulse-block-head">
          <p className="pc-eyebrow">Proposal polish</p>
          <small>{proposalPolishReadyCount}/{proposalPolishItems.length} ready</small>
        </div>
        <ul>
          {proposalPolishItems.map((item) => (
            <li key={item.id} data-state={item.state}>
              <span>{item.label}</span>
              <strong>{item.detail}</strong>
            </li>
          ))}
        </ul>
      </div>

      {margin ? (
        <details
          className="pc-pulse-block pc-margin-cost"
          data-testid="pc-margin-cost"
          data-state={!margin.available ? "unavailable" : marginNeedsAttention ? "attention" : "ready"}
          open={marginDetailOpen}
          onToggle={(event) => setMarginDetailOpen(event.currentTarget.open)}
        >
          <summary className="pc-pulse-block-head">
            <p className="pc-eyebrow">Cost &amp; margin</p>
            <small>{marginNeedsAttention ? "Review · Staff-only" : "Healthy · Staff-only"}</small>
          </summary>
          <div className="pc-margin-detail">
            {margin.available ? (
              <>
                <dl>
                  <div>
                    <dt>Revenue scope</dt>
                    <dd>{currency(margin.revenue)}</dd>
                  </div>
                  <div>
                    <dt>Recorded cost</dt>
                    <dd>{currency(margin.cost)}</dd>
                  </div>
                  <div>
                    <dt>Margin</dt>
                    <dd>{(margin.marginPct * 100).toFixed(1)}%</dd>
                  </div>
                  <div>
                    <dt>Target</dt>
                    <dd>{margin.target === null || margin.target === undefined ? "Not set" : `${Math.round(margin.target * 100)}%`}</dd>
                  </div>
                </dl>
                <p>{margin.targetNote || margin.note}</p>
              </>
            ) : (
              <>
                <p>{margin.note}</p>
                {margin.missing?.length ? (
                  <ul className="pc-margin-missing">
                    {margin.missing.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                ) : null}
              </>
            )}
          </div>
        </details>
      ) : null}

      <div className="pc-pulse-block pc-draft-activity">
        <p className="pc-eyebrow">Draft activity</p>
        <div
          className="pc-save-readiness"
          data-state={saveReadinessState}
          data-testid="pc-save-readiness"
          ref={saveReadinessRef}
          tabIndex={-1}
        >
          <div className="pc-save-readiness-summary">
            <span className="pc-save-readiness-dot" aria-hidden="true" />
            <span>
              <strong>{saveReadinessTitle}</strong>
              <small>{saveReadinessDetail}</small>
            </span>
          </div>
          {currentSaveBlockers.length ? (
            <ul className="pc-save-blockers" aria-label="Reasons this draft cannot be saved yet">
              {currentSaveBlockers.map((blocker) => (
                <li key={blocker.id || blocker.message} data-testid="pc-save-blocker">
                  {blocker.message}
                </li>
              ))}
            </ul>
          ) : null}
          {String(saveMessage || "").trim() ? (
            <div className="pc-draft-notice" data-testid="pc-draft-notice">
              <strong>Latest draft notice</strong>
              <span>{saveMessage}</span>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className="pc-section-action pc-activity-toggle"
          aria-expanded={activityOpen}
          onClick={() => setActivityOpen((open) => !open)}
          data-testid="pc-activity-toggle"
        >
          {activityOpen
            ? "Hide recent activity"
            : `Recent activity${activityLog.length ? ` · ${activityLog.length}` : ""}`}
        </button>
        {activityOpen ? (
          activityLog.length ? (
            <ol className="pc-activity" data-testid="pc-activity">
              {activityLog.map((entry) => (
                <li key={entry.id}>
                  <time>{entry.at}</time>
                  <span>{entry.label}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="pc-muted">Changes you make to this draft will appear here.</p>
          )
        ) : null}
      </div>

      <div className="pc-pulse-actions">
        <button type="button" className="pc-ghost" onClick={() => setPreviewOpen(true)}>
          Preview client view
        </button>
        <button
          type="button"
          className="pc-cta"
          onClick={requestSave}
          disabled={saveAction.disabled}
          title={saveAction.disabled && saveDisabledReason ? saveDisabledReason : undefined}
          data-testid="pc-save"
        >
          {saveAction.label}
        </button>
        {compareEnabled ? (
          <button
            type="button"
            className="pc-ghost"
            onClick={onOpenCompare}
            disabled={catalogLoading || !String(form.pkg || "").trim()}
          >
            Compare scenarios
          </button>
        ) : null}
      </div>
    </>
  );

  return (
    <div className="proposal-composer" data-testid="proposal-composer">
      <p className="visually-hidden" role="status">{liveNote}</p>

      <header className="pc-header">
        <div className="pc-header-copy">
          <p className="pc-eyebrow">{header.eyebrow}</p>
          <h1 className="pc-title">{header.title}</h1>
          {header.metaParts.length ? (
            <p className="pc-header-meta">{header.metaParts.join(" · ")}</p>
          ) : null}
        </div>
        <div className="pc-header-side">
          <div className="pc-brand-strip" data-logo-state={brandLogoUrl ? "image" : "monogram"}>
            <span className="pc-brand-mark">
              {brandLogoUrl ? <img src={brandLogoUrl} alt={`${brandName} logo`} /> : brandInitials(brandName)}
            </span>
            <span>
              <strong>{brandName}</strong>
              <small>{documentFontPreference.label} proposal text</small>
            </span>
          </div>
          <p className="pc-save-state" data-state={header.saveState.id} role="status">
            {header.saveState.label}
          </p>
          <div className="pc-header-actions">
            <button
              type="button"
              className="pc-cta pc-compact"
              onClick={requestSave}
              disabled={saveAction.disabled}
              title={saveAction.disabled && saveDisabledReason ? saveDisabledReason : undefined}
              data-testid="pc-save-header"
            >
              {saveAction.label}
            </button>
            <button type="button" className="pc-ghost" onClick={() => setPreviewOpen(true)}>
              Preview client view
            </button>
            {compareEnabled ? (
              <button
                type="button"
                className="pc-ghost"
                onClick={onOpenCompare}
                disabled={catalogLoading || !String(form.pkg || "").trim()}
              >
                Compare scenarios
              </button>
            ) : null}
            <button type="button" className="pc-ghost" onClick={onGuidedMode} data-testid="pc-guided-mode">
              Guided mode
            </button>
          </div>
        </div>
      </header>

      {livingCommercialTwin ? (
        <Suspense fallback={<div className="pc-surface-note">Preparing scenario intelligence…</div>}>
          <LivingCommercialTwin {...livingCommercialTwin} />
        </Suspense>
      ) : null}

      <DeliveryProposal
        form={form}
        catalog={catalog}
        settings={settings}
        editingQuote={editingQuote}
        staffingEvidence={deliveryPlanningEvidence?.staffing || null}
        inventoryEvidence={deliveryPlanningEvidence?.inventory || null}
        operatorId={deliveryPlanningOperatorId}
        onHandoff={onDeliveryPlanningHandoff}
      />

      <div className="pc-columns">
        <nav className="pc-quote-plan" aria-label="Quote plan" data-testid="commercial-workbench-plan">
          <div className="pc-quote-plan-head">
            <p className="pc-eyebrow">Quote plan</p>
            <span>{workbench.domains.filter((domain) => domain.status === "complete").length}/5 ready</span>
          </div>
          <ol>
            {workbench.domains.map((domain, index) => (
              <li key={domain.id} data-state={domain.status}>
                <button
                  type="button"
                  aria-current={activeDomain === domain.id ? "step" : undefined}
                  onClick={() => openDomain(domain.id)}
                  data-testid={`workbench-domain-${domain.id}`}
                  data-workbench-domain-status={domain.status}
                >
                  <span className="pc-domain-index" aria-hidden="true">{index + 1}</span>
                  <span className="pc-domain-copy">
                    <strong>{domain.label}</strong>
                    <small>{domain.summary}</small>
                  </span>
                  <span className="pc-domain-state">
                    {domain.blockerCount > 0
                      ? `${domain.blockerCount} blocker${domain.blockerCount === 1 ? "" : "s"}`
                      : domain.status === "complete"
                        ? "Ready"
                        : domain.status === "attention"
                          ? "Review"
                          : "In progress"}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <div className="pc-document" data-testid="pc-document">
          {reviewSurfaces}

          {!livingCommercialTwin && consequences ? (
            <aside className="pc-consequences" aria-label="Guest count consequences" data-testid="pc-consequences">
              <p className="pc-eyebrow">Guests {consequences.from || "—"} → {consequences.to}</p>
              <div className="pc-consequence-grid">
                <div>
                  <strong>Total</strong>
                  <span>
                    {currency(consequences.totalBefore)} → {currency(consequences.totalAfter)}
                    {" "}<ImpactTag delta={consequences.totalDelta} />
                  </span>
                </div>
                {consequences.staffing ? (
                  <div>
                    <strong>Staffing</strong>
                    <span>
                      House ratio now calls for {consequences.staffing.requiredServers} server{consequences.staffing.requiredServers === 1 ? "" : "s"}
                      {consequences.staffing.requiredChefs > 0
                        ? ` and ${consequences.staffing.requiredChefs} chef${consequences.staffing.requiredChefs === 1 ? "" : "s"}`
                        : ""}
                    </span>
                  </div>
                ) : null}
                {consequences.rentalSuggestions.map((suggestion) => (
                  <div key={suggestion.id}>
                    <strong>{suggestion.name}</strong>
                    <span>{suggestion.currentQty} → {suggestion.suggestedQty} suggested</span>
                  </div>
                ))}
              </div>
              <div className="pc-consequence-actions">
                {consequences.hasFollowUps ? (
                  <button type="button" className="pc-cta pc-compact" onClick={applyConsequenceFollowUps}>
                    Apply staffing &amp; rentals
                  </button>
                ) : null}
                <button type="button" className="pc-ghost pc-compact" onClick={() => setGuestAnchor(null)}>
                  Keep as quoted
                </button>
                <button type="button" className="pc-ghost pc-compact" onClick={undoGuestChange}>
                  Undo guest change
                </button>
              </div>
            </aside>
          ) : null}

          <article
            className="pc-sheet"
            aria-label="Living proposal document"
            data-active-domain={activeDomain}
            data-testid="commercial-workbench-object"
          >
            {proposalIntroTitle || proposalIntroMessage ? (
              <section className="pc-proposal-note" aria-label="Proposal introduction">
                {proposalIntroTitle ? <p className="pc-eyebrow">{proposalIntroTitle}</p> : null}
                {proposalIntroMessage ? <p className="pc-proposal-note-copy">{proposalIntroMessage}</p> : null}
              </section>
            ) : null}
            <section className="pc-section" aria-labelledby="pc-sec-event" data-workbench-panel="event" tabIndex={-1}>
              <SectionHeading id="pc-sec-event" eyebrow="Event" complete={completeness.event} />
              <p className="pc-domain-summary" data-testid="pc-event-summary">
                {workbench.domains.find((domain) => domain.id === "event")?.summary}
              </p>
              <div className="pc-inline-grid">
                <InlineValue
                  className="pc-inline"
                  label="Event name"
                  value={form.eventName}
                  onCommit={commitField("eventName")}
                  validate={(draft) => (String(draft || "").trim() ? "" : "Enter the event name.")}
                  editActionId="pc-edit-event-name"
                />
                <div className="pc-inline pc-inline-static">
                  <AdaptiveChoiceField
                    id="proposal-event-type"
                    label="Event type"
                    options={eventTypeChoices.options}
                    value={form.eventTypeId || ""}
                    onChange={(event) => onEventTypeChange(event.target.value)}
                    placeholder="Choose event type"
                    emptyReason={eventTypeChoices.stale
                      ? `The saved event type “${form.eventTypeId}” is no longer available. The draft value is preserved until setup is repaired.`
                      : "No event types are available for this workspace."}
                    recoveryAction={setupRecoveryAction}
                    fieldState={eventTypeChoices.stale ? { evidence: "stale", editability: "draft" } : undefined}
                    fieldStateDetails={eventTypeChoices.stale ? {
                      reason: "This draft references an event type outside the current workspace set.",
                      recoveryAction: {
                        label: "Choose a current event type",
                        onClick: () => document.getElementById("proposal-event-type")?.focus()
                      }
                    } : {}}
                    singleChoiceDetail="This is the only event type currently available to this workspace."
                    className="pc-select"
                  />
                </div>
                <InlineValue
                  className="pc-inline"
                  label="Date"
                  value={form.date}
                  displayValue={formatEventDateLong(form.date) || "Not set"}
                  inputType="date"
                  onCommit={commitField("date")}
                  editActionId="pc-edit-date"
                />
                <InlineValue
                  className="pc-inline"
                  label="Start time"
                  value={form.time}
                  displayValue={form.time || "Not set"}
                  inputType="time"
                  onCommit={commitField("time")}
                  editActionId="pc-edit-time"
                />
                <InlineValue
                  className="pc-inline"
                  label="Duration (hours)"
                  value={form.hours}
                  displayValue={`${Number(form.hours) || MIN_EVENT_HOURS} hours`}
                  inputType="number"
                  inputMode="numeric"
                  editorProps={{ min: MIN_EVENT_HOURS, max: MAX_EVENT_HOURS, step: 1 }}
                  parseValue={(draft) => normalizeEventHours(draft)}
                  onCommit={commitField("hours")}
                  editActionId="pc-edit-hours"
                />
                <InlineValue
                  className="pc-inline"
                  label="Guests"
                  value={form.guests}
                  displayValue={guests > 0 ? String(guests) : "Not set"}
                  inputType="number"
                  inputMode="numeric"
                  editorProps={{ min: 0, max: 400, step: 1 }}
                  validate={requireCount(0, 400, "a guest count")}
                  parseValue={(draft) => clampInt(draft, 0, 400)}
                  onCommit={commitGuests}
                  editActionId="pc-edit-guests"
                />
                <InlineValue
                  className="pc-inline"
                  label="Venue"
                  value={form.venue}
                  onCommit={commitField("venue")}
                  validate={(draft) => (String(draft || "").trim() ? "" : "Enter the event venue.")}
                  editActionId="pc-edit-venue"
                />
                <InlineValue
                  className="pc-inline"
                  label="Venue address"
                  value={form.venueAddress}
                  onCommit={commitField("venueAddress")}
                  editActionId="pc-edit-venue-address"
                />
              </div>
              <label className="pc-quiet-field pc-dietary">
                <span className="pc-field-label">Dietary notes</span>
                <textarea
                  rows={2}
                  value={form.dietaryRestrictions || ""}
                  placeholder="Allergies, vegetarian requests, kosher/halal notes…"
                  onChange={(event) => onFieldChange("dietaryRestrictions", event.target.value)}
                />
              </label>
            </section>

            <section className="pc-section" aria-labelledby="pc-sec-client" data-workbench-panel="customer" tabIndex={-1}>
              <SectionHeading id="pc-sec-client" eyebrow="Client" complete={completeness.client} />
              <div className="pc-inline-grid">
                <InlineValue
                  className="pc-inline"
                  label="Client name"
                  value={form.name}
                  onCommit={commitField("name")}
                  validate={(draft) => (String(draft || "").trim() ? "" : "Enter the client name.")}
                  editActionId="pc-edit-client-name"
                />
                <InlineValue
                  className="pc-inline"
                  label="Organization"
                  value={form.clientOrg}
                  onCommit={commitField("clientOrg")}
                  editActionId="pc-edit-client-org"
                />
                <InlineValue
                  className="pc-inline"
                  label="Phone"
                  value={form.phone}
                  inputType="tel"
                  onCommit={commitField("phone")}
                  editActionId="pc-edit-client-phone"
                />
                <InlineValue
                  className="pc-inline"
                  label="Email"
                  value={form.email}
                  inputType="email"
                  validate={(draft) => {
                    const text = String(draft || "").trim();
                    if (!text) return "Enter the client email.";
                    return /^\S+@\S+\.\S+$/.test(text) ? "" : "Enter a valid email address.";
                  }}
                  onCommit={commitField("email")}
                  editActionId="pc-edit-client-email"
                />
              </div>
            </section>

            <section className="pc-section" aria-labelledby="pc-sec-experience" data-workbench-panel="experience" tabIndex={-1}>
              <SectionHeading id="pc-sec-experience" eyebrow="Experience" status={experienceSectionStatus} />
              <h3 className="pc-experience-title">{experience.title}</h3>
              <p className="pc-experience-blurb">{experience.blurb}</p>
              {experience.facts.length ? (
                <ul className="pc-fact-row">
                  {experience.facts.map((fact) => <li key={fact}>{fact}</li>)}
                </ul>
              ) : null}
              <button
                type="button"
                className="pc-section-action"
                aria-expanded={experienceEditorOpen}
                onClick={() => setExperienceEditorOpen((open) => !open)}
              >
                {experienceEditorOpen ? "Close package options" : "Change package or service style →"}
              </button>
              {experienceEditorOpen ? (
                <div className="pc-editor" data-testid="pc-experience-editor">
                  <p className="pc-field-label">Package</p>
                  <div className="pc-option-grid">
                    {packageOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className="pc-option"
                        aria-pressed={option.selected}
                        onClick={() => {
                          if (option.selected) return;
                          onSelectionTouched("pkg");
                          onFieldChange("pkg", option.id);
                          logActivity(`Package → ${option.name}`);
                        }}
                      >
                        <strong>{option.name}</strong>
                        <span>{currency(option.ppp)} / guest</span>
                        {option.selected
                          ? <em className="pc-impact" data-tone="neutral">Current package</em>
                          : <ImpactTag delta={option.delta} />}
                      </button>
                    ))}
                  </div>
                  <p className="pc-field-label">Service style</p>
                  <div className="pc-option-grid">
                    {styleOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className="pc-option"
                        aria-pressed={option.selected}
                        onClick={() => {
                          if (option.selected) return;
                          onFieldChange("style", option.id);
                          logActivity(`Service style → ${option.name}`);
                        }}
                      >
                        <strong>{option.name}</strong>
                        {option.selected
                          ? <em className="pc-impact" data-tone="neutral">Current style</em>
                          : <ImpactTag delta={option.delta} />}
                      </button>
                    ))}
                  </div>
                  <p className="pc-editor-note">
                    Draft preview only. Saving still re-prices against the approved catalog.
                    {isAdmin && typeof onOpenCatalogPricing === "function" ? (
                      <>
                        {" "}Package and item prices come from the catalog —{" "}
                        <button type="button" className="pc-watch-link" onClick={onOpenCatalogPricing}>
                          edit catalog pricing
                        </button>.
                      </>
                    ) : null}
                  </p>
                </div>
              ) : null}
            </section>

            <section className="pc-section" aria-labelledby="pc-sec-menu" data-workbench-panel="experience">
              <SectionHeading id="pc-sec-menu" eyebrow="Menu" complete={completeness.menu} />
              {menuLoading ? <p className="pc-muted">Loading the menu for this event type…</p> : null}
              {menuError ? <p className="pc-error" role="alert">{menuError}</p> : null}
              {!menuLoading && menu.empty ? (
                <p className="pc-muted">
                  No menu selections yet{eventTypeName ? ` for ${eventTypeName}` : ""}. Compose the menu to
                  bring the proposal to life.
                </p>
              ) : null}
              {menu.groups.map((group) => (
                <div className="pc-menu-group" key={group.id}>
                  <p className="pc-menu-course">{group.name}</p>
                  <ul className="pc-menu-list">
                    {group.items.map((item) => (
                      <li key={item.id}>
                        <span>{item.name}</span>
                        <small>
                          {item.includedInPackage ? "Included in package" : currency(item.price)}
                          {item.quantity ? ` · ×${item.quantity}` : ""}
                        </small>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <button
                type="button"
                className="pc-section-action"
                aria-expanded={menuEditorOpen}
                onClick={() => {
                  if (!menuEditorOpen) {
                    const selectedIds = new Set((form.menuItems || []).map(String));
                    const initialGroups = (menuSections || [])
                      .filter((section, index) => index === 0 || (section?.items || [])
                        .some((item) => selectedIds.has(String(item?.id))))
                      .map((section) => String(section?.id ?? section?.name));
                    setOpenMenuGroups(new Set(initialGroups));
                  }
                  setMenuEditorOpen((open) => !open);
                }}
                data-testid="pc-edit-menu"
              >
                {menuEditorOpen ? "Close menu editor" : "Edit menu →"}
              </button>
              {menuEditorOpen ? (
                <div className="pc-editor" data-testid="pc-menu-editor">
                  <label className="pc-quiet-field pc-menu-search">
                    <span className="pc-field-label">Search menu</span>
                    <input
                      type="search"
                      value={menuQuery}
                      placeholder="Find a dish…"
                      onChange={(event) => setMenuQuery(event.target.value)}
                    />
                  </label>
                  {menuEditorSections.length === 0 ? (
                    <p className="pc-muted">No menu items match “{menuQuery}”.</p>
                  ) : null}
                  {isAdmin && typeof onOpenCatalogPricing === "function" ? (
                    <p className="pc-editor-note">
                      Dish prices come from the catalog —{" "}
                      <button type="button" className="pc-watch-link" onClick={onOpenCatalogPricing}>
                        edit catalog pricing
                      </button>.
                    </p>
                  ) : null}
                  {menuEditorSections.map((section) => {
                    const forcedOpen = Boolean(menuQuery.trim());
                    const sectionOpen = forcedOpen || openMenuGroups.has(section.id);
                    const selectedCount = section.items.filter((item) => item.selected).length;
                    return (
                      <details
                        key={section.id}
                        className="pc-editor-group pc-menu-editor-group"
                        open={sectionOpen}
                        onToggle={(event) => {
                          const isOpen = event.currentTarget.open;
                          if (forcedOpen) return;
                          setOpenMenuGroups((current) => {
                            if (isOpen === current.has(section.id)) return current;
                            const next = new Set(current);
                            if (isOpen) next.add(section.id);
                            else next.delete(section.id);
                            return next;
                          });
                        }}
                      >
                        <summary>
                          <span>{section.name}</span>
                          <small>
                            {selectedCount > 0 ? `${selectedCount} selected · ` : ""}{section.items.length} option{section.items.length === 1 ? "" : "s"}
                          </small>
                        </summary>
                        <ul className="pc-choice-list">
                          {section.items.map((item) => (
                            <li key={item.id}>
                              <label className="pc-choice">
                                <input
                                  type="checkbox"
                                  checked={item.selected}
                                  onChange={() => toggleCatalogSelection("menuItems", "menuItemQuantities", item.id, item.name)}
                                />
                                <span className="pc-choice-copy">
                                  <strong>{item.name}</strong>
                                  <ImpactTag delta={item.delta} />
                                </span>
                              </label>
                              {item.selected ? (
                                <input
                                  className="pc-qty"
                                  type="number"
                                  min={1}
                                  aria-label={`${item.name} quantity`}
                                  value={Number((form.menuItemQuantities || {})[item.id]) > 0
                                    ? Math.round(Number(form.menuItemQuantities[item.id]))
                                    : ""}
                                  placeholder="auto"
                                  onChange={(event) => setSelectionQuantity("menuItems", "menuItemQuantities", item.id, event.target.value, item.name)}
                                />
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </details>
                    );
                  })}
                </div>
              ) : null}
            </section>

            <section className="pc-section" aria-labelledby="pc-sec-staffing" data-workbench-panel="staffing" tabIndex={-1}>
              <SectionHeading id="pc-sec-staffing" eyebrow="Staffing" complete={completeness.staffing} />
              <div className="pc-inline-grid pc-inline-grid-tight">
                <InlineValue
                  className="pc-inline"
                  label="Servers"
                  value={form.servers}
                  displayValue={`${Number(form.servers) || 0} server${Number(form.servers) === 1 ? "" : "s"}`}
                  inputType="number"
                  inputMode="numeric"
                  editorProps={{ min: 0, max: 30, step: 1 }}
                  validate={requireCount(0, 30, "servers")}
                  parseValue={(draft) => clampInt(draft, 0, 30)}
                  onCommit={commitField("servers")}
                  editActionId="pc-edit-servers"
                />
                <InlineValue
                  className="pc-inline"
                  label="Chefs"
                  value={form.chefs}
                  displayValue={`${Number(form.chefs) || 0} chef${Number(form.chefs) === 1 ? "" : "s"}`}
                  inputType="number"
                  inputMode="numeric"
                  editorProps={{ min: 0, max: 20, step: 1 }}
                  validate={requireCount(0, 20, "chefs")}
                  parseValue={(draft) => clampInt(draft, 0, 20)}
                  onCommit={commitField("chefs")}
                  editActionId="pc-edit-chefs"
                />
                <InlineValue
                  className="pc-inline"
                  label="Bartenders"
                  value={form.bartenders}
                  displayValue={`${Number(form.bartenders) || 0} bartender${Number(form.bartenders) === 1 ? "" : "s"}`}
                  inputType="number"
                  inputMode="numeric"
                  editorProps={{ min: 0, max: 20, step: 1 }}
                  validate={requireCount(0, 20, "bartenders")}
                  parseValue={(draft) => clampInt(draft, 0, 20)}
                  onCommit={commitField("bartenders")}
                  editActionId="pc-edit-bartenders"
                />
              </div>
              {settings.staffingLaborEnabled !== false ? (
                <>
                  <ul className="pc-rate-strip" data-testid="pc-rate-strip">
                    {[
                      { label: "Servers", count: form.servers, rate: totals.serverRateApplied, overridden: Boolean(String(form.serverRateOverride || "").trim() || String(form.serverRateMixCsv || "").trim()), mixed: Boolean(String(form.serverRateMixCsv || "").trim()) },
                      { label: "Chefs", count: form.chefs, rate: totals.chefRateApplied, overridden: Boolean(String(form.chefRateOverride || "").trim() || String(form.chefRateMixCsv || "").trim()), mixed: Boolean(String(form.chefRateMixCsv || "").trim()) },
                      { label: "Bartenders", count: form.bartenders, rate: totals.bartenderRateApplied, overridden: Boolean(String(form.bartenderRateOverride || "").trim()), mixed: false }
                    ].map((role) => {
                      const rate = Number(role.rate);
                      if (!(Number(role.count) > 0) || !Number.isFinite(rate)) return null;
                      const unit = totals.staffingChargeMode === "per_event_per_staff" ? "per event" : "per hour";
                      return (
                        <li key={role.label}>
                          {role.label} at {role.mixed ? "mixed rates" : `${currency(rate)} ${unit}`}
                          <em>{role.overridden ? "quote override" : "house rate"}</em>
                        </li>
                      );
                    })}
                  </ul>
                  <button
                    type="button"
                    className="pc-section-action"
                    aria-expanded={ratesEditorOpen}
                    onClick={() => setRatesEditorOpen((open) => !open)}
                    data-testid="pc-adjust-rates"
                  >
                    {ratesEditorOpen ? "Close staffing rates" : "Adjust staffing rates →"}
                  </button>
                  {ratesEditorOpen ? (
                    <div className="pc-editor" data-testid="pc-rates-editor">
                      <div className="pc-advanced-grid">
                        <PcQuietInput
                          label="Server rate override ($/hr)"
                          type="number"
                          inputMode="decimal"
                          value={form.serverRateOverride}
                          onChange={(value) => onFieldChange("serverRateOverride", value)}
                          hint="Blank uses the approved house rate"
                        />
                        <PcQuietInput
                          label="Server rate mix (CSV)"
                          value={form.serverRateMixCsv}
                          onChange={(value) => onFieldChange("serverRateMixCsv", value)}
                          hint="One rate per server, e.g. 25,25,32"
                        />
                        <PcQuietInput
                          label="Chef rate override ($/hr)"
                          type="number"
                          inputMode="decimal"
                          value={form.chefRateOverride}
                          onChange={(value) => onFieldChange("chefRateOverride", value)}
                        />
                        <PcQuietInput
                          label="Chef rate mix (CSV)"
                          value={form.chefRateMixCsv}
                          onChange={(value) => onFieldChange("chefRateMixCsv", value)}
                        />
                        <PcQuietInput
                          label="Bartender rate override ($/hr)"
                          type="number"
                          inputMode="decimal"
                          value={form.bartenderRateOverride}
                          onChange={(value) => onFieldChange("bartenderRateOverride", value)}
                        />
                      </div>
                      <p className="pc-editor-note">
                        Overrides live on this quote only and reprice the staffing line as you type.
                        Approved admin pricing stays the default everywhere else.
                      </p>
                    </div>
                  ) : null}
                </>
              ) : null}
              {staffing.available && !staffing.meetsRule ? (
                <aside className="pc-recommendation" data-testid="pc-staffing-recommendation">
                  <p className="pc-eyebrow">Recommended</p>
                  <p className="pc-recommendation-line">
                    {staffing.requiredServers} server{staffing.requiredServers === 1 ? "" : "s"}
                    {staffing.requiredChefs > 0
                      ? ` · ${staffing.requiredChefs} chef${staffing.requiredChefs === 1 ? "" : "s"}`
                      : ""}
                  </p>
                  <p className="pc-recommendation-basis">Based on {staffing.basis.join(" · ")}</p>
                  <button type="button" className="pc-section-action" onClick={applyStaffingRecommendation}>
                    Use recommendation →
                  </button>
                </aside>
              ) : null}
            </section>

            <section className="pc-section" aria-labelledby="pc-sec-rentals" data-workbench-panel="experience">
              <SectionHeading id="pc-sec-rentals" eyebrow="Rentals" complete={null} />
              {rentalRows.length ? (
                <ul className="pc-rental-list">
                  {rentalRows.map((row) => (
                    <li key={row.id}>
                      <span>{row.quantity !== null ? `${row.quantity} ` : ""}{row.name}</span>
                      <small>{row.autoQuantity ? "Quantity follows guest count" : "Set quantity"}</small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="pc-muted">No rentals on this proposal.</p>
              )}
              <button
                type="button"
                className="pc-section-action"
                aria-expanded={rentalEditorOpen}
                onClick={() => setRentalEditorOpen((open) => !open)}
              >
                {rentalEditorOpen ? "Close rentals" : "Review rentals →"}
              </button>
              {rentalEditorOpen ? (
                <div className="pc-editor">
                  <ul className="pc-choice-list">
                    {rentalRows.map((row) => (
                      <li key={row.id}>
                        <label className="pc-choice">
                          <input
                            type="checkbox"
                            checked
                            onChange={() => toggleCatalogSelection("rentals", "rentalQuantities", row.id, row.name)}
                          />
                          <span className="pc-choice-copy"><strong>{row.name}</strong></span>
                        </label>
                        <input
                          className="pc-qty"
                          type="number"
                          min={1}
                          aria-label={`${row.name} quantity`}
                          value={row.autoQuantity ? "" : row.quantity}
                          placeholder={row.quantity !== null ? `auto ${row.quantity}` : "auto"}
                          onChange={(event) => setSelectionQuantity("rentals", "rentalQuantities", row.id, event.target.value, row.name)}
                        />
                      </li>
                    ))}
                    {availableRentals.map((item) => (
                      <li key={item.id}>
                        <label className="pc-choice">
                          <input
                            type="checkbox"
                            checked={false}
                            onChange={() => toggleCatalogSelection("rentals", "rentalQuantities", item.id, item.name)}
                          />
                          <span className="pc-choice-copy"><strong>{item.name}</strong></span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>

            <section className="pc-section" aria-labelledby="pc-sec-enhancements" data-workbench-panel="experience">
              <SectionHeading id="pc-sec-enhancements" eyebrow="Enhancements" complete={null} />
              {selectedAddonEntries.length ? (
                <ul className="pc-enhancement-list">
                  {selectedAddonEntries.map((entry) => (
                    <li key={entry.id}>
                      <span>{entry.name}</span>
                      <span className="pc-enhancement-side">
                        {entry.contribution !== null ? (
                          <em className="pc-impact" data-tone={entry.contribution > 0 ? "add" : "neutral"}>
                            {entry.contribution > 0 ? `+${currency(entry.contribution)}` : "Included"}
                          </em>
                        ) : null}
                        <button
                          type="button"
                          className="pc-remove"
                          onClick={() => toggleCatalogSelection("addons", "addonQuantities", entry.id, entry.name)}
                        >
                          Remove
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="pc-muted">No enhancements yet — optional upgrades appear here with their price.</p>
              )}
              <button
                type="button"
                className="pc-section-action"
                aria-expanded={enhancementEditorOpen}
                onClick={() => setEnhancementEditorOpen((open) => !open)}
              >
                {enhancementEditorOpen ? "Close enhancements" : "+ Add enhancement"}
              </button>
              {enhancementEditorOpen ? (
                <div className="pc-editor">
                  {availableAddons.length === 0 ? (
                    <p className="pc-muted">Every available enhancement is already on this proposal.</p>
                  ) : (
                    <ul className="pc-choice-list">
                      {availableAddons.map((item) => (
                        <li key={item.id}>
                          <label className="pc-choice">
                            <input
                              type="checkbox"
                              checked={false}
                              onChange={() => toggleCatalogSelection("addons", "addonQuantities", item.id, item.name)}
                            />
                            <span className="pc-choice-copy">
                              <strong>{item.name}</strong>
                              <ImpactTag delta={item.delta} />
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </section>

            <section className="pc-section pc-section-investment" aria-labelledby="pc-sec-investment" data-workbench-panel="commercials" tabIndex={-1}>
              <SectionHeading id="pc-sec-investment" eyebrow="Investment" complete={completeness.investment} />
              <div className="pc-investment-lede">
                <p className="pc-investment-total" data-pc-flash={flashAttr("total")} data-testid="pc-investment-total">
                  <DigitRoll value={currency(investment.total)} />
                </p>
                <div className="pc-investment-side">
                  {investment.perGuest !== null ? (
                    <p><span>Per guest</span><strong>{currency(investment.perGuest)}</strong></p>
                  ) : null}
                  <p data-pc-flash={flashAttr("deposit")}>
                    <span>{investment.depositLabel}</span>
                    <strong>{currency(investment.deposit)}</strong>
                  </p>
                </div>
              </div>
              <dl className="pc-investment-rows">
                {investment.rows.map((row) => (
                  <div key={row.id} data-pc-flash={flashAttr(row.id)}>
                    <dt>{row.label}</dt>
                    <dd>{currency(row.amount)}</dd>
                  </div>
                ))}
              </dl>
              <details
                className="pc-advanced"
                open={advancedOpen}
                onToggle={(event) => setAdvancedOpen(event.target.open)}
              >
                <summary>Advanced pricing</summary>
                <div className="pc-advanced-grid">
                  <AdaptiveChoiceField
                    id="proposal-event-template"
                    label="Event template"
                    options={templateChoices.options}
                    value={form.eventTemplateId || "custom"}
                    onChange={(event) => onTemplateChange(event.target.value)}
                    emptyReason="No proposal templates are available for this workspace."
                    recoveryAction={setupRecoveryAction}
                    fieldState={templateChoices.stale ? { evidence: "stale", editability: "draft" } : undefined}
                    fieldStateDetails={templateChoices.stale ? {
                      reason: "The draft keeps its historical template identity until you choose a current template or Custom.",
                      recoveryAction: {
                        label: "Choose a current template",
                        onClick: () => document.getElementById("proposal-event-template")?.focus()
                      }
                    } : {}}
                    singleChoiceDetail="Custom is the only proposal template currently available."
                    className="pc-select"
                  />
                  <AdaptiveChoiceField
                    id="proposal-tax-region"
                    label="Tax region"
                    options={taxRegionChoices.options}
                    value={form.taxRegion || ""}
                    onChange={(event) => onFieldChange("taxRegion", event.target.value)}
                    emptyReason={taxRegionChoices.stale
                      ? `The saved tax region “${form.taxRegion}” is no longer available. The draft value is preserved and pricing remains blocked.`
                      : "No tax regions are configured, so authoritative tax cannot be calculated."}
                    recoveryAction={setupRecoveryAction}
                    fieldState={taxRegionChoices.stale ? { evidence: "stale", editability: "draft" } : undefined}
                    fieldStateDetails={taxRegionChoices.stale ? {
                      reason: "This tax region is outside the current workspace configuration.",
                      recoveryAction: {
                        label: "Choose a current tax region",
                        onClick: () => document.getElementById("proposal-tax-region")?.focus()
                      }
                    } : {}}
                    singleChoiceDetail="This is the only tax region configured for this workspace."
                    className="pc-select"
                  />
                  <AdaptiveChoiceField
                    id="proposal-season-profile"
                    label="Season profile"
                    options={seasonChoices.options}
                    value={form.seasonProfileId || "auto"}
                    onChange={(event) => onFieldChange("seasonProfileId", event.target.value)}
                    emptyReason="No season profiles are available for this workspace."
                    recoveryAction={setupRecoveryAction}
                    fieldState={seasonChoices.stale ? { evidence: "stale", editability: "draft" } : undefined}
                    fieldStateDetails={seasonChoices.stale ? {
                      reason: "The draft keeps its historical season profile until you choose a current profile or Auto detect.",
                      recoveryAction: {
                        label: "Choose a current season profile",
                        onClick: () => document.getElementById("proposal-season-profile")?.focus()
                      }
                    } : {}}
                    singleChoiceDetail="Auto detect is the only season choice currently available."
                    className="pc-select"
                  />
                  <PcQuietInput
                    label="Travel (round-trip miles)"
                    type="number"
                    inputMode="numeric"
                    value={form.milesRT}
                    onChange={(value) => onFieldChange("milesRT", Math.max(0, Number(value) || 0))}
                  />
                  <PcSelect
                    label="Payment method"
                    value={form.payMethod || "card"}
                    onChange={(value) => onFieldChange("payMethod", value)}
                  >
                    <option value="card">Pay by card</option>
                    <option value="ach">Pay by ACH / check</option>
                  </PcSelect>
                  <label className="pc-quiet-field pc-checkbox">
                    <input
                      type="checkbox"
                      checked={form.includeDisposables !== false}
                      onChange={(event) => onFieldChange("includeDisposables", event.target.checked)}
                    />
                    <span className="pc-field-label">Show disposables on quote</span>
                  </label>
                </div>
                <p className="pc-editor-note">
                  Quote validity: {Math.max(1, Number(settings.quoteValidityDays || 30))} days. Staffing
                  rate overrides live in the Staffing section; approved admin pricing stays the default.
                </p>
              </details>
            </section>
            {proposalClosingMessage ? (
              <section className="pc-proposal-note pc-proposal-note-closing" aria-label="Proposal closing message">
                <p className="pc-eyebrow">Closing note</p>
                <p className="pc-proposal-note-copy">{proposalClosingMessage}</p>
              </section>
            ) : null}
          </article>

          {changeImpactSurface}
          {statusNotes}
        </div>

        <aside
          className={`pc-pulse${pulseOpen ? " is-open" : ""}`}
          aria-label="Quote Pulse"
          data-testid="pc-pulse"
          data-commercial-truth="true"
        >
          <div className="pc-pulse-head">
            <p className="pc-eyebrow">Commercial truth</p>
            <button type="button" className="pc-ghost pc-pulse-close" onClick={() => setPulseOpen(false)}>
              Close
            </button>
          </div>
          {pulseBody}
        </aside>
        {pulseOpen ? (
          <button
            type="button"
            className="pc-pulse-scrim"
            aria-label="Close Quote Pulse"
            onClick={() => setPulseOpen(false)}
          />
        ) : null}
      </div>

      <div className="pc-mobile-bar">
        <p className="pc-mobile-total">
          <DigitRoll value={currency(investment.total)} />
          {investment.perGuest !== null ? <small>{currency(investment.perGuest)} / guest</small> : null}
        </p>
        <button type="button" className="pc-cta pc-compact" onClick={() => setPulseOpen(true)}>
          Review quote →
        </button>
      </div>

      <ClientPreviewDialog
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        form={form}
        totals={totals}
        experience={experience}
        menu={menu}
        settings={settings}
        documentFontPreference={documentFontPreference}
      />
    </div>
  );
}
