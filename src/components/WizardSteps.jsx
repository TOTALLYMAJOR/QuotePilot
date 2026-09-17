import { useEffect, useState } from "react";
import { calculateQuote, currency, serviceChargeLabel } from "../lib/quoteCalculator";
import { MAX_EVENT_HOURS, MIN_EVENT_HOURS, normalizeEventHours } from "../lib/wizardUi";
import AdaptiveChoiceField from "./AdaptiveChoiceField";
import DecisionCard from "./DecisionCard";
import FieldStateIndicator from "./FieldStateIndicator";
import QuoteCompletionCommandPath from "./QuoteCompletionCommandPath";
import { buildQuoteCompletionProjection } from "../lib/quoteCompletionProjection";
import { buildGuidedSellingCards } from "./guidedSellingPresentation";
import { playCue } from "./soundKit";
import "./wizardMotion.css";

// Default-off presentation gate for the pilot guided-selling decide cards.
// Absent or unrecognized values keep it off; apply and autopilot semantics
// are unchanged, so it never widens data access or authority.
const PILOT_GUIDED_SELLING_ENABLED = ["1", "true", "yes", "on"].includes(
  String(import.meta.env.VITE_PILOT_GUIDED_SELLING_ENABLED || "").trim().toLowerCase()
);

function joinClassNames(...parts) {
  return parts.filter(Boolean).join(" ");
}

function stableSelectionIds(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

// What-if sweeps (one calculateQuote per catalog item / package) are cached
// against the immutable `form` object plus the identity of the other pricing
// inputs, so re-renders that don't change pricing (menu search keystrokes,
// unrelated app state) never repeat the sweep. A WeakMap keyed by the form
// keeps this hook-free — these step components are also invoked as plain
// functions by the element-tree tests — and leak-free across drafts.
const whatIfSweepCache = new WeakMap();

function computeOncePerForm(form, bucket, deps, compute) {
  if (!form || typeof form !== "object") return compute();
  let buckets = whatIfSweepCache.get(form);
  if (!buckets) {
    buckets = new Map();
    whatIfSweepCache.set(form, buckets);
  }
  const cached = buckets.get(bucket);
  if (
    cached
    && cached.deps.length === deps.length
    && cached.deps.every((dep, index) => dep === deps[index])
  ) {
    return cached.value;
  }
  const value = compute();
  buckets.set(bucket, { deps, value });
  return value;
}

function previewTotalDelta({ form, catalog, settings, totals, patch }) {
  if (!catalog || !settings || !totals || !patch) return null;
  try {
    const nextTotals = calculateQuote({ ...form, ...patch }, catalog, settings);
    const delta = Number(nextTotals.total || 0) - Number(totals.total || 0);
    return Number.isFinite(delta) ? Math.round(delta * 100) / 100 : null;
  } catch {
    return null;
  }
}

function impactLabel(delta, { selected = false } = {}) {
  if (delta === null || delta === undefined) return "Draft impact updates in the live breakdown";
  if (Math.abs(delta) < 0.005) return "No added charge in this package";
  if (selected) return `Currently adds ${currency(Math.abs(delta))} to the draft total`;
  return `${delta > 0 ? "Adds" : "Reduces by"} ${currency(Math.abs(delta))} in the draft preview`;
}

function PackageComparison({
  form,
  setForm,
  catalog,
  settings,
  totals,
  activePackages,
  packageInclusionCount,
  onSelectionTouched
}) {
  // One full-quote preview per package, cached per form so unrelated
  // re-renders never repeat the per-package calculateQuote sweep.
  const packagePreviews = computeOncePerForm(form, "packages", [catalog, settings, totals], () => (
    activePackages.map((pkg) => {
      let preview = null;
      try {
        preview = calculateQuote({ ...form, pkg: pkg.id }, catalog, settings);
      } catch {
        preview = null;
      }
      const delta = preview && totals
        ? Math.round((Number(preview.total || 0) - Number(totals.total || 0)) * 100) / 100
        : null;
      return { pkg, preview, delta };
    })
  ));

  if (!activePackages.length) return null;

  return (
    <section className="package-comparison" aria-labelledby="package-comparison-title">
      <div className="package-comparison-head">
        <div>
          <span>Compare the fit</span>
          <h4 id="package-comparison-title">Package choices</h4>
        </div>
        <p>Full-quote draft previews include the current guest count and selections.</p>
      </div>
      <div className="package-choice-grid">
        {packagePreviews.map(({ pkg, preview, delta }) => {
          const selected = pkg.id === form.pkg;
          return (
            <button
              key={pkg.id}
              type="button"
              className={joinClassNames("package-choice", selected && "is-selected")}
              aria-pressed={selected}
              onClick={() => {
                if (selected) return;
                if (typeof onSelectionTouched === "function") onSelectionTouched("pkg");
                setForm((current) => ({ ...current, pkg: pkg.id }));
              }}
            >
              <span className="package-choice-state">{selected ? "Current package" : "Compare"}</span>
              <strong>{pkg.name}</strong>
              <span>{currency(pkg.ppp)}/person</span>
              <small>{packageInclusionCount(pkg)} included choice{packageInclusionCount(pkg) === 1 ? "" : "s"}</small>
              <em>
                {preview
                  ? `${currency(preview.total)} draft total${delta && !selected ? ` · ${delta > 0 ? "+" : "−"}${currency(Math.abs(delta))}` : ""}`
                  : "Preview unavailable"}
              </em>
            </button>
          );
        })}
      </div>
      <p className="package-preview-boundary">Draft preview only. Saving still re-prices against the current approved catalog.</p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Selection micro-motion (one-shot classes; CSS lives in wizardMotion.css).
// The classes are applied imperatively from user-event handlers only, so
// static renders (and markup snapshots) never contain them, and programmatic
// form updates (template application etc.) never trigger motion or sound.

const SELECTION_SETTLE_CLASS = "selection-settle";
const QTY_PULSE_CLASS = "qty-pulse";
// Cleanup fallbacks land comfortably after the CSS animations finish
// (settle runs --motion-base ~240ms, the wink 2x that; pulse ~240ms).
const SELECTION_SETTLE_CLEANUP_MS = 700;
const QTY_PULSE_CLEANUP_MS = 450;

function prefersReducedMotion() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

// Pending cleanup timers per element/class so rapid re-triggers restart cleanly.
const oneShotMotionTimers = new WeakMap();

// One-shot motion: adds `className` to `el`, restarting its keyframes if the
// class is already present (remove -> forced reflow -> add), then removes it
// after `cleanupMs`. Returns true only when the class was applied.
export function runOneShotMotionClass(el, className, cleanupMs = SELECTION_SETTLE_CLEANUP_MS) {
  if (!el || !el.classList) return false;
  if (prefersReducedMotion()) return false;
  const timers = oneShotMotionTimers.get(el) || {};
  if (timers[className]) clearTimeout(timers[className]);
  el.classList.remove(className);
  // Reading offsetWidth forces a reflow so re-adding the class restarts the keyframes.
  void el.offsetWidth;
  el.classList.add(className);
  timers[className] = setTimeout(() => {
    el.classList.remove(className);
    const pending = oneShotMotionTimers.get(el);
    if (pending) delete pending[className];
  }, cleanupMs);
  oneShotMotionTimers.set(el, timers);
  return true;
}

function closestFromEvent(event, selector) {
  const node = event?.currentTarget || event?.target;
  if (!node || typeof node.closest !== "function") return null;
  return node.closest(selector);
}

function settleSelectionCard(event) {
  return runOneShotMotionClass(
    closestFromEvent(event, ".checkrow"),
    SELECTION_SETTLE_CLASS,
    SELECTION_SETTLE_CLEANUP_MS
  );
}

function pulseQuantityControl(event, selector) {
  return runOneShotMotionClass(
    closestFromEvent(event, selector),
    QTY_PULSE_CLASS,
    QTY_PULSE_CLEANUP_MS
  );
}

function Field({ label, children, error = "", hint = "", required = false, className = "" }) {
  return (
    <label className={joinClassNames("field", className, error && "field-error")}> 
      <span>
        {label}
        {required && <em className="field-required" aria-hidden="true">*</em>}
      </span>
      {children}
      {error && <small className="field-error-note">{error}</small>}
      {!error && hint && <small className="field-hint">{hint}</small>}
    </label>
  );
}

function ChoiceStateField({
  choiceField,
  label,
  required = false,
  valueLabel = "",
  state,
  reason = "",
  provenance = "",
  supportingDetail = "",
  recoveryAction
}) {
  return (
    <div className="field" data-choice-field={choiceField}>
      <span>
        {label}
        {required && <em className="field-required" aria-hidden="true">*</em>}
      </span>
      {valueLabel ? (
        <strong className="adaptive-choice-field__single-value" data-choice-static-value="true">
          {valueLabel}
        </strong>
      ) : null}
      <FieldStateIndicator
        state={state}
        label={`${label} state`}
        reason={reason}
        provenance={provenance}
        supportingDetail={supportingDetail}
        recoveryAction={recoveryAction}
      />
    </div>
  );
}

function AccordionGroup({
  id,
  title,
  description,
  open,
  onToggle,
  children,
  optional = false,
  collapsedHint = "",
  attention = false
}) {
  return (
    <section className={joinClassNames("accordion-group", open && "open", attention && "has-attention")}>
      <button
        type="button"
        className="accordion-trigger"
        onClick={() => onToggle(id)}
        aria-expanded={open}
        aria-controls={`accordion-panel-${id}`}
      >
        <span>
          <strong>{title}</strong>
          {description && <small>{description}</small>}
        </span>
        <em>{open ? "Hide" : "Show"}</em>
      </button>
      {!open && optional && collapsedHint && (
        <p className="accordion-collapsed-helper">{collapsedHint}</p>
      )}
      {open && (
        <div id={`accordion-panel-${id}`} className="accordion-panel">
          {children}
        </div>
      )}
    </section>
  );
}

export function StepperNumberInput({
  label,
  min,
  max,
  value,
  onChange,
  onBlur,
  error = "",
  hint = "",
  required = false
}) {
  const safeValue = Number.isFinite(Number(value)) ? Number(value) : 0;
  const decrementDisabled = safeValue <= min;
  const incrementDisabled = safeValue >= max;

  return (
    <Field label={label} error={error} hint={hint} required={required} className="field-stepper">
      <div className="stepper-input">
        <button
          type="button"
          className="ghost compact"
          onClick={(e) => {
            pulseQuantityControl(e, ".stepper-input");
            onChange(Math.max(min, safeValue - 1));
          }}
          disabled={decrementDisabled}
          aria-label={`Decrease ${label}`}
        >
          -
        </button>
        <input
          type="number"
          min={min}
          max={max}
          value={safeValue}
          aria-label={label}
          onChange={(e) => {
            pulseQuantityControl(e, ".stepper-input");
            onChange(Number(e.target.value || 0));
          }}
          onBlur={onBlur}
          aria-invalid={Boolean(error)}
        />
        <button
          type="button"
          className="ghost compact"
          onClick={(e) => {
            pulseQuantityControl(e, ".stepper-input");
            onChange(Math.min(max, safeValue + 1));
          }}
          disabled={incrementDisabled}
          aria-label={`Increase ${label}`}
        >
          +
        </button>
      </div>
    </Field>
  );
}

// Discloses what an auto-applied event template set (audit #17), rendered
// under the step-1 event type field and again at the top of step 3.
function TemplateDefaultsBanner({ notice, onClearDefaults, onDismiss }) {
  if (!notice) return null;

  return (
    <div className="template-defaults-banner" role="status">
      <p>{notice.summary}</p>
      <div className="template-defaults-banner-actions">
        <button type="button" className="ghost compact" onClick={onClearDefaults}>
          Clear defaults
        </button>
        <button
          type="button"
          className="template-defaults-dismiss"
          onClick={onDismiss}
          aria-label="Dismiss defaults notice"
        >
          ×
        </button>
      </div>
    </div>
  );
}

export function StepEvent({
  form,
  setForm,
  styles,
  settings,
  onTemplateChange,
  eventTypes = [],
  onEventTypeChange,
  onFieldChange,
  onFieldBlur,
  touchedFields = {},
  fieldErrors = {},
  showValidation = false,
  templateNotice = null,
  onClearTemplateDefaults,
  onDismissTemplateNotice
}) {
  const templates = Array.isArray(settings?.eventTemplates) ? settings.eventTemplates : [];
  const taxRegions = Array.isArray(settings?.taxRegions) ? settings.taxRegions : [];
  const seasonProfiles = Array.isArray(settings?.seasonalProfiles) ? settings.seasonalProfiles : [];
  const templateOptions = [
    { value: "custom", label: "Custom" },
    ...templates.map((template) => ({
      value: String(template.id),
      label: template.name || String(template.id)
    }))
  ];
  const styleOptions = (Array.isArray(styles) ? styles : [])
    .filter((style) => String(style || "").trim())
    .map((style) => ({ value: String(style), label: String(style) }));
  const taxRegionOptions = taxRegions
    .filter((region) => String(region?.id || "").trim())
    .map((region) => ({
      value: String(region.id),
      label: `${region.name || region.id} (${Math.round(Number(region.rate || 0) * 1000) / 10}%)`
    }));
  const seasonOptions = [
    { value: "auto", label: "Auto detect" },
    ...seasonProfiles
      .filter((season) => String(season?.id || "").trim())
      .map((season) => ({ value: String(season.id), label: season.name || String(season.id) }))
  ];
  const [openGroups, setOpenGroups] = useState({
    core: true,
    contact: true,
    advancedPricing: false
  });

  const staffingChargeMode = String(settings?.staffingChargeMode || "per_hour").trim().toLowerCase();
  const staffingChargeModeLabel = staffingChargeMode === "per_event_per_staff"
    ? "Per event x staff count"
    : "Per hour x staff count";
  const hasStaffingRateValues = [
    form.serverRateOverride,
    form.serverRateMixCsv,
    form.chefRateOverride,
    form.chefRateMixCsv,
    form.bartenderRateOverride
  ].some((value) => String(value ?? "").trim() !== "");

  const toggleGroup = (groupId) => {
    setOpenGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const markBlur = (field) => {
    if (typeof onFieldBlur === "function") onFieldBlur(field);
  };

  const getError = (field) => {
    if (!fieldErrors?.[field]) return "";
    if (showValidation || touchedFields?.[field]) return fieldErrors[field];
    return "";
  };

  const updateField = (field, value) => {
    if (typeof onFieldChange === "function") {
      onFieldChange(field, value);
      return;
    }
    setForm((prev) => ({ ...prev, [field]: value }));
  };
  const eventTypeChoices = (Array.isArray(eventTypes) ? eventTypes : [])
    .filter((eventType) => String(eventType?.id || "").trim());
  const onlyEventType = eventTypeChoices.length === 1 ? eventTypeChoices[0] : null;
  const currentEventTypeId = String(form.eventTypeId || "").trim();
  const currentEventTypeIsAvailable = eventTypeChoices.some(
    (eventType) => String(eventType.id) === currentEventTypeId
  );

  useEffect(() => {
    const onlyEventTypeId = String(onlyEventType?.id || "").trim();
    if (!onlyEventTypeId || currentEventTypeId) return;
    if (typeof onEventTypeChange === "function") {
      onEventTypeChange(onlyEventTypeId);
      return;
    }
    if (typeof onFieldChange === "function") {
      onFieldChange("eventTypeId", onlyEventTypeId);
      return;
    }
    setForm((prev) => ({ ...prev, eventTypeId: onlyEventTypeId }));
  }, [currentEventTypeId, onlyEventType?.id, onEventTypeChange, onFieldChange, setForm]);

  const chooseEventType = (eventTypeId) => {
    if (typeof onEventTypeChange === "function") {
      onEventTypeChange(eventTypeId);
      return;
    }
    updateField("eventTypeId", eventTypeId);
  };

  return (
    <div className="event-step-layout">
      <AccordionGroup
        id="core"
        title="Core Event Basics"
        description="Required details used to unlock the guided flow"
        open={openGroups.core}
        onToggle={toggleGroup}
      >
        <div className="grid two-col">
          {eventTypeChoices.length === 0 ? (
            <ChoiceStateField
              choiceField="event-type"
              label="Event type"
              required
              valueLabel={currentEventTypeId}
              state={{ availability: currentEventTypeId ? "unknown" : "not_provided" }}
              supportingDetail={currentEventTypeId
                ? "The saved event type is not in the current Library. An administrator must publish a current event type before this quote can continue."
                : "No event types are published for this organization. An administrator must add one in Library before this quote can continue."}
            />
          ) : onlyEventType && !currentEventTypeId ? (
            <ChoiceStateField
              choiceField="event-type"
              label="Event type"
              required
              valueLabel={onlyEventType.name || onlyEventType.id}
              state={{ origin: "defaulted" }}
              provenance="The only published event type"
              supportingDetail="Applying this event type to the quote."
            />
          ) : onlyEventType && currentEventTypeIsAvailable ? (
            <div data-choice-field="event-type" onBlur={() => markBlur("eventTypeId")}>
              <AdaptiveChoiceField
                label="Event type"
                required
                options={[{ value: onlyEventType.id, label: onlyEventType.name || onlyEventType.id }]}
                value={currentEventTypeId}
              />
            </div>
          ) : onlyEventType ? (
            <ChoiceStateField
              choiceField="event-type"
              label="Event type"
              required
              valueLabel={currentEventTypeId}
              state={{ evidence: "stale" }}
              reason="The previously selected event type is no longer in the current Library."
              recoveryAction={{
                label: `Use ${onlyEventType.name || onlyEventType.id}`,
                onClick: () => chooseEventType(String(onlyEventType.id))
              }}
            />
          ) : (
            <Field label="Event type" error={getError("eventTypeId")} required>
              <select
                data-choice-control="event-type"
                value={currentEventTypeIsAvailable ? currentEventTypeId : ""}
                onChange={(event) => chooseEventType(event.target.value)}
                onBlur={() => markBlur("eventTypeId")}
                aria-invalid={Boolean(getError("eventTypeId") || (currentEventTypeId && !currentEventTypeIsAvailable))}
              >
                <option value="">Select event type</option>
                {eventTypeChoices.map((eventType) => (
                  <option key={eventType.id} value={eventType.id}>{eventType.name}</option>
                ))}
              </select>
            </Field>
          )}
          <TemplateDefaultsBanner
            notice={templateNotice}
            onClearDefaults={onClearTemplateDefaults}
            onDismiss={onDismissTemplateNotice}
          />
          <Field label="Event date" error={getError("date")} required>
            <input
              type="date"
              data-ambient-field="date"
              value={form.date}
              onChange={(e) => updateField("date", e.target.value)}
              onBlur={() => markBlur("date")}
              aria-invalid={Boolean(getError("date"))}
            />
          </Field>
          <Field label="Start time">
            <input
              type="time"
              data-ambient-field="time"
              value={form.time}
              onChange={(e) => updateField("time", e.target.value)}
              onBlur={() => markBlur("time")}
            />
          </Field>
          <Field label="Event hours" error={getError("hours")}>
            <div className="hours-control">
              <div className="hours-meta">
                <input
                  type="number"
                  data-ambient-field="hours"
                  min={MIN_EVENT_HOURS}
                  max={MAX_EVENT_HOURS}
                  value={normalizeEventHours(form.hours)}
                  aria-label="Event hours"
                  onChange={(e) => updateField("hours", normalizeEventHours(e.target.value))}
                  onBlur={() => markBlur("hours")}
                />
                <output>{normalizeEventHours(form.hours)} hrs</output>
              </div>
              <input
                type="range"
                min={MIN_EVENT_HOURS}
                max={MAX_EVENT_HOURS}
                value={normalizeEventHours(form.hours)}
                aria-label="Event hours slider"
                onChange={(e) => updateField("hours", normalizeEventHours(e.target.value))}
              />
            </div>
          </Field>

          <fieldset className="wizard-fieldset">
            <legend>Attendance &amp; staffing</legend>
            <div className="grid two-col">
              <StepperNumberInput
                label="Guests (max 400)"
                min={0}
                max={400}
                value={Math.max(0, Number(form.guests || 0))}
                onChange={(value) => updateField("guests", value)}
                onBlur={() => markBlur("guests")}
                error={getError("guests")}
                required
              />

              <StepperNumberInput
                label="Servers"
                min={0}
                max={30}
                value={Math.max(0, Number(form.servers || 0))}
                onChange={(value) => updateField("servers", value)}
                onBlur={() => markBlur("servers")}
              />

              <StepperNumberInput
                label="Chefs"
                min={0}
                max={20}
                value={Math.max(0, Number(form.chefs || 0))}
                onChange={(value) => updateField("chefs", value)}
                onBlur={() => markBlur("chefs")}
              />

              <StepperNumberInput
                label="Bartenders"
                min={0}
                max={20}
                value={Math.max(0, Number(form.bartenders || 0))}
                onChange={(value) => updateField("bartenders", value)}
                onBlur={() => markBlur("bartenders")}
              />
            </div>
          </fieldset>

          <Field label="Event name" error={getError("eventName")} required>
            <input
              type="text"
              value={form.eventName}
              onChange={(e) => updateField("eventName", e.target.value)}
              onBlur={() => markBlur("eventName")}
              aria-invalid={Boolean(getError("eventName"))}
            />
          </Field>
          <Field label="Venue" error={getError("venue")} required>
            <input
              type="text"
              data-ambient-field="venue"
              value={form.venue}
              onChange={(e) => updateField("venue", e.target.value)}
              onBlur={() => markBlur("venue")}
              aria-invalid={Boolean(getError("venue"))}
            />
          </Field>
          <Field label="Venue address">
            <input
              type="text"
              data-ambient-field="venueAddress"
              value={form.venueAddress || ""}
              onChange={(e) => updateField("venueAddress", e.target.value)}
              onBlur={() => markBlur("venueAddress")}
            />
          </Field>
          <Field label="Dietary Restrictions" className="quote-sheet-meta-wide">
            <textarea
              value={form.dietaryRestrictions || ""}
              onChange={(e) => updateField("dietaryRestrictions", e.target.value)}
              onBlur={() => markBlur("dietaryRestrictions")}
              placeholder="Allergies, no-pork/no-shellfish, vegetarian requests, kosher/halal notes, etc."
            />
          </Field>
        </div>
      </AccordionGroup>

      <AccordionGroup
        id="contact"
        title="Client Contact"
        description="Required contact details for proposal delivery"
        open={openGroups.contact}
        onToggle={toggleGroup}
      >
        <div className="grid two-col">
          <Field label="Your name" error={getError("name")} required>
            <input
              type="text"
              value={form.name}
              onChange={(e) => updateField("name", e.target.value)}
              onBlur={() => markBlur("name")}
              aria-invalid={Boolean(getError("name"))}
            />
          </Field>
          <Field label="Client / Organization">
            <input
              type="text"
              value={form.clientOrg}
              onChange={(e) => updateField("clientOrg", e.target.value)}
              onBlur={() => markBlur("clientOrg")}
            />
          </Field>
          <Field label="Phone">
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => updateField("phone", e.target.value)}
              onBlur={() => markBlur("phone")}
            />
          </Field>
          <Field label="Email" error={getError("email")} required>
            <input
              type="email"
              value={form.email}
              onChange={(e) => updateField("email", e.target.value)}
              onBlur={() => markBlur("email")}
              aria-invalid={Boolean(getError("email"))}
            />
          </Field>
        </div>
      </AccordionGroup>

      <AccordionGroup
        id="advancedPricing"
        title="Advanced Pricing Overrides"
        description={hasStaffingRateValues
          ? "Staffing rate values are set — open to review"
          : "Optional templates, seasonality, tax, and staffing rates"}
        optional
        collapsedHint={hasStaffingRateValues
          ? "Staffing rate values are set on this quote. Show this section to review them before sending."
          : "Leave closed to use approved admin pricing and automatic defaults."}
        attention={hasStaffingRateValues}
        open={openGroups.advancedPricing}
        onToggle={toggleGroup}
      >
        <div className="grid two-col">
          <div data-choice-field="event-template" onBlur={() => markBlur("eventTemplateId")}>
            <AdaptiveChoiceField
              label="Event template"
              options={templateOptions}
              value={form.eventTemplateId || "custom"}
              onChange={(event) => onTemplateChange(event.target.value)}
              singleChoiceDetail="Custom is the only available starting point; no event templates have been published."
            />
          </div>
          {styleOptions.length > 0 ? (
            <div data-choice-field="service-style" onBlur={() => markBlur("style")}>
              <AdaptiveChoiceField
                label="Service style"
                options={styleOptions}
                value={form.style || styleOptions[0].value}
                onChange={(event) => updateField("style", event.target.value)}
              />
            </div>
          ) : (
            <ChoiceStateField
              choiceField="service-style"
              label="Service style"
              valueLabel={form.style}
              state={{ availability: "not_provided" }}
              supportingDetail="An administrator must restore a service style before this override can be changed."
            />
          )}
          {taxRegionOptions.length > 0 ? (
            <div data-choice-field="tax-region" onBlur={() => markBlur("taxRegion")}>
              <AdaptiveChoiceField
                label="Tax region"
                options={taxRegionOptions}
                value={form.taxRegion || taxRegionOptions[0].value}
                onChange={(event) => updateField("taxRegion", event.target.value)}
              />
            </div>
          ) : (
            <ChoiceStateField
              choiceField="tax-region"
              label="Tax region"
              state={{ availability: "not_provided" }}
              supportingDetail="No tax region has been configured. The quote keeps the current pricing default until an administrator adds one."
            />
          )}
          <div data-choice-field="season-profile" onBlur={() => markBlur("seasonProfileId")}>
            <AdaptiveChoiceField
              label="Season profile"
              options={seasonOptions}
              value={form.seasonProfileId || "auto"}
              onChange={(event) => updateField("seasonProfileId", event.target.value)}
              singleChoiceDetail="Automatic date-based pricing is the only available behavior; no seasonal profiles have been published."
            />
          </div>
          <Field label="Show disposables on quote">
            <select
              value={form.includeDisposables === false ? "no" : "yes"}
              onChange={(e) => updateField("includeDisposables", e.target.value === "yes")}
              onBlur={() => markBlur("includeDisposables")}
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </Field>
          <fieldset className="wizard-fieldset">
            <legend>Staffing pricing</legend>
            <p className="field-hint">
              Leave these values blank to use approved admin rates. Saved quotes may carry rate values forward, so review them before sending.
            </p>
            <div className="grid two-col">
              <Field label="Server rate override (optional)">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.serverRateOverride ?? ""}
                  onChange={(e) => updateField("serverRateOverride", e.target.value)}
                  onBlur={() => markBlur("serverRateOverride")}
                  placeholder={`Default from admin (${staffingChargeModeLabel})`}
                />
              </Field>

              <Field
                label="Server rates (optional, one per server)"
                hint="Applied in order to each server count; remaining servers use Server rate override/default."
              >
                <input
                  type="text"
                  value={String(form.serverRateMixCsv || "")}
                  onChange={(e) => updateField("serverRateMixCsv", String(e.target.value || "").slice(0, 300))}
                  onBlur={() => markBlur("serverRateMixCsv")}
                  placeholder="25, 30, 30, 35"
                />
              </Field>

              <Field label="Chef rate override (optional)">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.chefRateOverride ?? ""}
                  onChange={(e) => updateField("chefRateOverride", e.target.value)}
                  onBlur={() => markBlur("chefRateOverride")}
                  placeholder={`Default from admin (${staffingChargeModeLabel})`}
                />
              </Field>

              <Field
                label="Chef rates (optional, one per chef)"
                hint="Applied in order to each chef count; remaining chefs use Chef rate override/default."
              >
                <input
                  type="text"
                  value={String(form.chefRateMixCsv || "")}
                  onChange={(e) => updateField("chefRateMixCsv", String(e.target.value || "").slice(0, 300))}
                  onBlur={() => markBlur("chefRateMixCsv")}
                  placeholder="45, 50, 55"
                />
              </Field>

              <Field label="Bartender rate override (optional)">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.bartenderRateOverride ?? ""}
                  onChange={(e) => updateField("bartenderRateOverride", e.target.value)}
                  onBlur={() => markBlur("bartenderRateOverride")}
                  placeholder={`Default from admin (${staffingChargeModeLabel})`}
                />
              </Field>
            </div>
          </fieldset>
        </div>
      </AccordionGroup>

    </div>
  );
}

export function StepMenu(props) {
  const [menuQuery, setMenuQuery] = useState("");
  const [selectedOnly, setSelectedOnly] = useState(false);
  return (
    <StepMenuContent
      {...props}
      menuQuery={menuQuery}
      onMenuQueryChange={setMenuQuery}
      selectedOnly={selectedOnly}
      onSelectedOnlyChange={setSelectedOnly}
    />
  );
}

export function StepMenuContent({
  form,
  setForm,
  menuSections,
  catalog = null,
  pricingSettings = null,
  totals = null,
  menuLoading = false,
  menuError = "",
  eventTypeLabel = "",
  isAdmin = false,
  onRetry,
  onOpenCatalogMenu,
  onSelectionTouched,
  packageIncludedMenuItemIds = [],
  menuQuery = "",
  onMenuQueryChange = () => {},
  selectedOnly = false,
  onSelectedOnlyChange = () => {}
}) {
  const resolvedMenuSections = Array.isArray(menuSections) ? menuSections : [];
  const includedMenuItemIds = new Set(
    (Array.isArray(packageIncludedMenuItemIds) ? packageIncludedMenuItemIds : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean)
  );
  const resolvePricingType = (item) => {
    const raw = String(item?.pricingType || item?.type || "").trim().toLowerCase();
    if (raw === "per_person" || raw === "per_item" || raw === "per_event") return raw;
    return "per_event";
  };
  const pricingLabel = (item) => {
    const pricingType = resolvePricingType(item);
    if (pricingType === "per_person") return `${currency(item.price)}/person`;
    if (pricingType === "per_item") return `${currency(item.price)}/item`;
    return currency(item.price);
  };
  const menuQuantities = form.menuItemQuantities || {};
  const allMenuItems = resolvedMenuSections.flatMap((section) => (
    (section.items || []).map((item) => ({ ...item, sectionId: section.id, sectionName: section.name }))
  ));
  const selectedMenuIds = new Set(stableSelectionIds(form.menuItems));
  const selectedMenuItems = allMenuItems.filter((item) => selectedMenuIds.has(item.id));
  const normalizedMenuQuery = String(menuQuery || "").trim().toLowerCase();
  const filteredMenuSections = resolvedMenuSections.map((section) => ({
    ...section,
    items: (section.items || []).filter((item) => {
      if (selectedOnly && !selectedMenuIds.has(item.id)) return false;
      if (!normalizedMenuQuery) return true;
      return `${item.name || ""} ${section.name || ""}`.toLowerCase().includes(normalizedMenuQuery);
    })
  })).filter((section) => section.items.length > 0);

  // Per-item what-if deltas cached per form so search/filter keystrokes
  // (component-local state) re-render this list without re-running a full
  // calculateQuote per visible item.
  const menuItemImpactById = computeOncePerForm(form, "menu", [catalog, pricingSettings, totals], () => {
    const impacts = new Map();
    if (!catalog || !pricingSettings || !totals) return impacts;
    const selectedIds = new Set(stableSelectionIds(form.menuItems));
    resolvedMenuSections
      .flatMap((section) => section.items || [])
      .forEach((item) => {
        const selected = selectedIds.has(item.id);
        const nextMenuItems = selected
          ? stableSelectionIds(form.menuItems).filter((id) => id !== item.id)
          : [...stableSelectionIds(form.menuItems), item.id];
        const nextQuantities = { ...(form.menuItemQuantities || {}) };
        if (!selected && resolvePricingType(item) === "per_item") nextQuantities[item.id] = 1;
        if (selected) delete nextQuantities[item.id];
        impacts.set(item.id, previewTotalDelta({
          form,
          catalog,
          settings: pricingSettings,
          totals,
          patch: { menuItems: nextMenuItems, menuItemQuantities: nextQuantities }
        }));
      });
    return impacts;
  });

  const menuItemImpact = (item) => (
    menuItemImpactById.has(item.id) ? menuItemImpactById.get(item.id) : null
  );

  const toggleMenuItem = (item, checked, event = null) => {
    const itemId = String(item?.id || "").trim();
    if (!itemId) return;
    const pricingType = resolvePricingType(item);
    if (checked) {
      // Explicit user selection only: this handler is reached solely from the
      // checkbox change event, never from programmatic form updates.
      settleSelectionCard(event);
      playCue("tick");
    }
    if (typeof onSelectionTouched === "function") onSelectionTouched("menuItems", itemId);
    setForm((f) => {
      const nextSelected = new Set(Array.isArray(f.menuItems) ? f.menuItems : []);
      const nextQuantities = { ...(f.menuItemQuantities || {}) };
      if (checked) {
        nextSelected.add(itemId);
        if (pricingType === "per_item") {
          nextQuantities[itemId] = Math.max(1, Number(nextQuantities[itemId] || 1));
        }
      } else {
        nextSelected.delete(itemId);
        delete nextQuantities[itemId];
      }
      return {
        ...f,
        menuItems: [...nextSelected],
        menuItemQuantities: nextQuantities
      };
    });
  };

  const patchMenuQuantity = (itemId, value, event = null) => {
    const quantity = Math.max(1, Math.round(Number(value || 1)));
    pulseQuantityControl(event, ".checkrow");
    if (typeof onSelectionTouched === "function") onSelectionTouched("menuItems", itemId);
    setForm((f) => ({
      ...f,
      menuItemQuantities: {
        ...(f.menuItemQuantities || {}),
        [itemId]: quantity
      }
    }));
  };

  if (menuLoading) {
    return (
      <div className="menu-library menu-state" aria-busy="true" role="status">
        <h4>Customized Cuisine Menu</h4>
        <span className="sr-only">Loading menu for {eventTypeLabel || "the selected event type"}.</span>
        <div className="menu-skeleton" aria-hidden="true">
          {[1, 2, 3].map((row) => (
            <div className="menu-skeleton-row" key={row}>
              <span />
              <span />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (menuError) {
    return (
      <div className="menu-library menu-state" role="alert">
        <h4>Menu unavailable</h4>
        <p>We couldn't load the menu for {eventTypeLabel || "this event type"}.</p>
        <button type="button" className="ghost" onClick={onRetry}>Retry</button>
      </div>
    );
  }

  if (resolvedMenuSections.length === 0) {
    return (
      <div className="menu-library menu-state">
        <h4>Customized Cuisine Menu</h4>
        {eventTypeLabel ? (
          <>
            <p>No menu items are configured for {eventTypeLabel} yet.</p>
            {isAdmin ? (
              <button type="button" className="ghost" onClick={onOpenCatalogMenu}>Add menu items</button>
            ) : (
              <p className="source-note">Ask your admin to add menu items.</p>
            )}
          </>
        ) : (
          <p className="source-note">Choose an event type to load its menu.</p>
        )}
      </div>
    );
  }

  return (
    <div className="grid two-col">
      {resolvedMenuSections.length > 0 && (
        <div className="menu-library" data-ambient-field="menuItems" tabIndex={-1}>
          <div className="menu-library-head">
            <div>
              <span>Shape the experience</span>
              <h4>Build the menu</h4>
              <p className="source-note">Find choices quickly, then keep the selected menu visible while you refine it.</p>
            </div>
            <div className="menu-selection-measure" aria-live="polite">
              <strong>{selectedMenuItems.length}</strong>
              <span>selected</span>
              {totals && <small>{currency(totals.menu)} in menu additions</small>}
            </div>
          </div>

          <div className="menu-toolbar">
            <label className="menu-search">
              <span>Search menu</span>
              <input
                type="search"
                value={menuQuery}
                onChange={(event) => onMenuQueryChange(event.target.value)}
                placeholder="Search by item or category"
              />
            </label>
            <button
              type="button"
              className="ghost menu-selected-filter"
              aria-pressed={selectedOnly}
              onClick={() => onSelectedOnlyChange(!selectedOnly)}
            >
              {selectedOnly ? "Show all choices" : `Show selected (${selectedMenuItems.length})`}
            </button>
          </div>

          <section className="menu-selection-tray" aria-labelledby="menu-selection-tray-title">
            <div>
              <h5 id="menu-selection-tray-title">Your menu so far</h5>
              <p>{selectedMenuItems.length ? "Remove a choice here or keep exploring below." : "Choose at least one item to build the proposal menu."}</p>
            </div>
            {selectedMenuItems.length > 0 && (
              <ul>
                {selectedMenuItems.map((item) => (
                  <li key={item.id}>
                    <span>{item.name}</span>
                    <button type="button" onClick={() => toggleMenuItem(item, false)} aria-label={`Remove ${item.name} from menu`}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="menu-grid">
            {filteredMenuSections.map((section) => (
              <section className="menu-category" key={section.id}>
                <div className="menu-category-head">
                  <strong>{section.name}</strong>
                  <small>
                    {
                      (section.items || []).filter((item) => form.menuItems.includes(item.id)).length
                    }/{(section.items || []).length}
                  </small>
                </div>
                <div className="checklist">
                  {(section.items || []).map((item) => {
                    const selected = selectedMenuIds.has(item.id);
                    const impact = menuItemImpact(item);
                    return (
                    <label className={joinClassNames("checkrow", "checkrow-choice", selected && "is-selected")} key={item.id}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(e) => toggleMenuItem(item, e.target.checked, e)}
                      />
                      <span className="selection-item-copy">
                        <strong>{item.name}</strong>
                        <small>{includedMenuItemIds.has(item.id) ? "Included in the current package" : pricingLabel(item)}</small>
                        <em>{impactLabel(selected ? (impact === null ? null : -impact) : impact, { selected })}</em>
                      </span>
                      {resolvePricingType(item) === "per_item" && selected && (
                        <input
                          className="qty-input"
                          type="number"
                          min="1"
                          step="1"
                          value={Math.max(1, Number(menuQuantities[item.id] || 1))}
                          onChange={(e) => patchMenuQuantity(item.id, e.target.value, e)}
                        />
                      )}
                    </label>
                  );})}
                </div>
              </section>
            ))}
            {filteredMenuSections.length === 0 && (
              <div className="menu-no-results" role="status">
                <strong>No menu choices match this view.</strong>
                <p>Clear the search or show all choices to keep building.</p>
              </div>
            )}
          </div>
          <p className="package-preview-boundary">
            {includedMenuItemIds.size > 0 && "Included at no added charge — select to add. "}
            Visible impacts use the current draft calculator. The trusted save remains the pricing authority.
          </p>
        </div>
      )}
    </div>
  );
}

export function StepServices({
  form,
  setForm,
  catalog,
  recommendations,
  onApplyRecommendation,
  guidedSellingEnabled: guidedSellingEnabledProp,
  aiAssistEnabled: aiAssistEnabledProp,
  aiAutopilotEnabled: aiAutopilotEnabledProp,
  onSelectionTouched,
  templateNotice = null,
  onClearTemplateDefaults,
  onDismissTemplateNotice,
  onAddonSelection,
  totals = null,
  pricingSettings = null,
  pilotGuidedSelling = PILOT_GUIDED_SELLING_ENABLED
}) {
  const guidedSellingEnabled =
    guidedSellingEnabledProp !== undefined
      ? guidedSellingEnabledProp !== false
      : catalog.settings?.guidedSellingEnabled !== false;
  const aiAssistEnabled = aiAssistEnabledProp !== false;
  const aiAutopilotEnabled = aiAssistEnabled && aiAutopilotEnabledProp === true;
  const activePackages = catalog.packages.filter((item) => item?.active !== false);
  const activeAddons = catalog.addons.filter((item) => item?.active !== false);
  const activeRentals = catalog.rentals.filter((item) => item?.active !== false);
  const currentPackageId = String(form.pkg || "").trim();
  const selectedPackageMatch = activePackages.find((item) => item.id === currentPackageId);
  const selectedPackage = selectedPackageMatch || (!currentPackageId ? activePackages[0] : null) || {};
  const onlyPackage = activePackages.length === 1 ? activePackages[0] : null;
  const includedAddonIds = new Set(selectedPackage.includedAddonIds || []);
  const includedRentalIds = new Set(selectedPackage.includedRentalIds || []);
  const menuItemsById = new Map(
    ((pricingSettings?.menuSections || catalog.settings?.menuSections) || []).flatMap((section) => section.items || [])
      .map((item) => [item.id, item])
  );
  const packageInclusionLabels = [
    ...(selectedPackage.includedMenuItemIds || []).map((id) => menuItemsById.get(id)?.name || id),
    ...(selectedPackage.includedAddonIds || []).map((id) => activeAddons.find((item) => item.id === id)?.name || id),
    ...(selectedPackage.includedRentalIds || []).map((id) => activeRentals.find((item) => item.id === id)?.name || id)
  ];
  const packageInclusionCount = (pkg) => [
    ...(pkg?.includedMenuItemIds || []),
    ...(pkg?.includedAddonIds || []),
    ...(pkg?.includedRentalIds || [])
  ].length;
  const selectedMenuItems = stableSelectionIds(form.menuItems)
    .map((id) => menuItemsById.get(id))
    .filter(Boolean);
  const selectedAddons = activeAddons.filter((item) => stableSelectionIds(form.addons).includes(item.id));
  const selectedRentals = activeRentals.filter((item) => stableSelectionIds(form.rentals).includes(item.id));

  const resolvePricingType = (item, fallback = "per_event") => {
    const raw = String(item?.pricingType || item?.type || "").trim().toLowerCase();
    if (raw === "per_person" || raw === "per_item" || raw === "per_event") return raw;
    return fallback;
  };

  const resolveAddonStaffRole = (item) => {
    const hasExplicitField = item && Object.prototype.hasOwnProperty.call(item, "staffRole");
    const explicit = String(item?.staffRole || "").trim().toLowerCase();
    if (explicit === "server" || explicit === "chef" || explicit === "bartender") return explicit;
    if (hasExplicitField) return "";
    const source = `${String(item?.id || "")} ${String(item?.name || "")}`.trim().toLowerCase();
    if (!source) return "";
    if (source.includes("bartender") || source.includes("bar tender")) return "bartender";
    if (source.includes("chef")) return "chef";
    if (source.includes("server") || source.includes("event staff")) return "server";
    return "";
  };

  const addonSupportsQuantity = (item, pricingType) =>
    pricingType === "per_item" || (pricingType === "per_event" && Boolean(resolveAddonStaffRole(item)));

  const pricingLabel = (item, fallback = "per_event") => {
    const pricingType = resolvePricingType(item, fallback);
    if (pricingType === "per_person") return `${currency(item.price)}/person`;
    if (pricingType === "per_item") return `${currency(item.price)}/item`;
    if (addonSupportsQuantity(item, pricingType)) return `${currency(item.price)}/unit`;
    return currency(item.price);
  };

  const toggle = (key, quantityKey, item, checked, fallbackQty = 1, event = null) => {
    const id = String(item?.id || "").trim();
    if (!id) return;
    const pricingType = resolvePricingType(item, key === "rentals" ? "per_item" : "per_event");
    const quantityEnabled = key === "addons"
      ? addonSupportsQuantity(item, pricingType)
      : pricingType === "per_item";
    if (checked) {
      // Explicit user selection only: this handler is reached solely from the
      // checkbox change event, never from programmatic form updates.
      settleSelectionCard(event);
      playCue("tick");
    }
    if (typeof onSelectionTouched === "function") onSelectionTouched(key, id);
    if (key === "addons" && typeof onAddonSelection === "function") {
      onAddonSelection(id, checked);
    }
    setForm((f) => {
      const set = new Set(Array.isArray(f[key]) ? f[key] : []);
      const quantityMap = { ...(f[quantityKey] || {}) };
      if (checked) {
        set.add(id);
        if (quantityEnabled) {
          quantityMap[id] = Math.max(1, Number(quantityMap[id] || fallbackQty || 1));
        }
      } else {
        set.delete(id);
        delete quantityMap[id];
      }
      return {
        ...f,
        [key]: [...set],
        [quantityKey]: quantityMap
      };
    });
  };

  const patchQuantity = (quantityKey, id, value, touchedFieldName, event = null) => {
    const quantity = Math.max(1, Math.round(Number(value || 1)));
    pulseQuantityControl(event, ".checkrow");
    if (typeof onSelectionTouched === "function") onSelectionTouched(touchedFieldName, id);
    setForm((f) => ({
      ...f,
      [quantityKey]: {
        ...(f[quantityKey] || {}),
        [id]: quantity
      }
    }));
  };

  // Toggle deltas for every catalog add-on/rental, cached per form so
  // unrelated re-renders never repeat the per-item calculateQuote sweep.
  const selectionImpactByKey = computeOncePerForm(form, "services", [catalog, pricingSettings, totals], () => {
    const computeImpact = (key, quantityKey, item, fallbackQty) => {
      if (!pricingSettings || !totals) return null;
      const selectedIds = stableSelectionIds(form[key]);
      const selected = selectedIds.includes(item.id);
      const nextIds = selected
        ? selectedIds.filter((id) => id !== item.id)
        : [...selectedIds, item.id];
      const nextQuantities = { ...(form[quantityKey] || {}) };
      if (selected) delete nextQuantities[item.id];
      else nextQuantities[item.id] = Math.max(1, Number(nextQuantities[item.id] || fallbackQty || 1));
      return previewTotalDelta({
        form,
        catalog,
        settings: pricingSettings,
        totals,
        patch: { [key]: nextIds, [quantityKey]: nextQuantities }
      });
    };
    const addons = new Map();
    (catalog.addons || []).forEach((item) => {
      addons.set(item.id, computeImpact("addons", "addonQuantities", item, 1));
    });
    const rentals = new Map();
    (catalog.rentals || []).forEach((item) => {
      const fallbackQty = typeof item.qtyRule === "function"
        ? item.qtyRule(Math.max(0, Number(form.guests || 0)))
        : 1;
      rentals.set(item.id, computeImpact("rentals", "rentalQuantities", item, fallbackQty));
    });
    return { addons, rentals };
  });

  const selectionImpact = (key, quantityKey, item) => {
    const impacts = key === "rentals" ? selectionImpactByKey.rentals : selectionImpactByKey.addons;
    return impacts.has(item.id) ? impacts.get(item.id) : null;
  };

  const removeMenuItem = (item) => {
    if (typeof onSelectionTouched === "function") onSelectionTouched("menuItems", item.id);
    setForm((current) => {
      const quantities = { ...(current.menuItemQuantities || {}) };
      delete quantities[item.id];
      return {
        ...current,
        menuItems: stableSelectionIds(current.menuItems).filter((id) => id !== item.id),
        menuItemQuantities: quantities
      };
    });
  };

  return (
    <div className="grid two-col">
      <TemplateDefaultsBanner
        notice={templateNotice}
        onClearDefaults={onClearTemplateDefaults}
        onDismiss={onDismissTemplateNotice}
      />
      {activePackages.length === 0 ? (
        <ChoiceStateField
          choiceField="package-tier"
          label="Package tier"
          valueLabel={currentPackageId}
          state={{ availability: currentPackageId ? "unknown" : "not_provided" }}
          supportingDetail={currentPackageId
            ? "The saved package is not active in the current Library. An administrator must publish a current offer before this quote can continue."
            : "No active offers are published for this organization. An administrator must add one in Library before this quote can continue."}
        />
      ) : onlyPackage && !currentPackageId ? (
        <ChoiceStateField
          choiceField="package-tier"
          label="Package tier"
          valueLabel={`${onlyPackage.name} · ${currency(onlyPackage.ppp)}/person`}
          state={{ origin: "suggested" }}
          provenance="The only active Library offer"
          supportingDetail="This is the only available offer. Confirm it to add it to the quote draft."
          recoveryAction={{
            label: `Use ${onlyPackage.name}`,
            onClick: () => {
              if (typeof onSelectionTouched === "function") onSelectionTouched("pkg");
              setForm((current) => ({ ...current, pkg: onlyPackage.id }));
            }
          }}
        />
      ) : onlyPackage && selectedPackageMatch ? (
        <div data-choice-field="package-tier">
          <AdaptiveChoiceField
            label="Package tier"
            options={[{
              value: onlyPackage.id,
              label: `${onlyPackage.name} · ${currency(onlyPackage.ppp)}/person${packageInclusionCount(onlyPackage) ? ` · ${packageInclusionCount(onlyPackage)} select-to-add choices included` : ""}`
            }]}
            value={currentPackageId}
          />
        </div>
      ) : onlyPackage ? (
        <ChoiceStateField
          choiceField="package-tier"
          label="Package tier"
          valueLabel={currentPackageId}
          state={{ evidence: "stale" }}
          reason="The previously selected package is no longer active in the current Library."
          recoveryAction={{
            label: `Use ${onlyPackage.name}`,
            onClick: () => {
              if (typeof onSelectionTouched === "function") onSelectionTouched("pkg");
              setForm((current) => ({ ...current, pkg: onlyPackage.id }));
            }
          }}
        />
      ) : (
        <Field label="Package tier">
          <select
            data-ambient-field="pkg"
            data-choice-control="package-tier"
            value={selectedPackageMatch ? currentPackageId : ""}
            onChange={(event) => {
              if (typeof onSelectionTouched === "function") onSelectionTouched("pkg");
              setForm((current) => ({ ...current, pkg: event.target.value }));
            }}
          >
            <option value="">Select package</option>
            {activePackages.map((pkg) => (
              <option key={pkg.id} value={pkg.id}>
                {pkg.name} - {currency(pkg.ppp)}/person{packageInclusionCount(pkg) ? ` · ${packageInclusionCount(pkg)} select-to-add choices included` : ""}
              </option>
            ))}
          </select>
        </Field>
      )}
      {activePackages.length > 1 ? (
        <PackageComparison
          form={form}
          setForm={setForm}
          catalog={catalog}
          settings={pricingSettings || catalog.settings || {}}
          totals={totals}
          activePackages={activePackages}
          packageInclusionCount={packageInclusionCount}
          onSelectionTouched={onSelectionTouched}
        />
      ) : null}
      {packageInclusionLabels.length > 0 && (
        <div className="package-inclusion-summary" role="status">
          <strong>Available at no added charge with {selectedPackage.name || "this package"}</strong>
          <ul>{packageInclusionLabels.map((label, index) => <li key={`${label}-${index}`}>{label}</li>)}</ul>
          <small>Included at no added charge — select to add. Unselected items will not appear in the quote.</small>
        </div>
      )}
      <Field label="Travel (round trip miles)">
        <input
          type="number"
          min="0"
          value={form.milesRT}
          onChange={(e) => {
            if (typeof onSelectionTouched === "function") onSelectionTouched("milesRT");
            setForm((f) => ({ ...f, milesRT: Number(e.target.value) }));
          }}
        />
      </Field>

      <section className="bundle-workbench" aria-labelledby="bundle-workbench-title">
        <div className="bundle-workbench-head">
          <div>
            <span>One clear picture</span>
            <h4 id="bundle-workbench-title">Your bundle</h4>
          </div>
          {totals && (
            <div>
              <small>Current draft total</small>
              <strong>{currency(totals.total)}</strong>
            </div>
          )}
        </div>
        <dl className="bundle-measures">
          <div><dt>Package</dt><dd>{selectedPackage.name || "Not selected"}{totals ? ` · ${currency(totals.base)}` : ""}</dd></div>
          <div><dt>Menu</dt><dd>{selectedMenuItems.length} selected{totals ? ` · ${currency(totals.menu)}` : ""}</dd></div>
          <div><dt>Add-ons</dt><dd>{selectedAddons.length} selected{totals ? ` · ${currency(totals.addons)}` : ""}</dd></div>
          <div><dt>Rentals</dt><dd>{selectedRentals.length} selected{totals ? ` · ${currency(totals.rentals)}` : ""}</dd></div>
        </dl>
        {(selectedMenuItems.length > 0 || selectedAddons.length > 0 || selectedRentals.length > 0) && (
          <div className="bundle-selection-groups">
            {selectedMenuItems.length > 0 && (
              <div><strong>Menu</strong>{selectedMenuItems.map((item) => <button type="button" key={item.id} onClick={() => removeMenuItem(item)} aria-label={`Remove ${item.name} from bundle`}>{item.name}<span>Remove</span></button>)}</div>
            )}
            {selectedAddons.length > 0 && (
              <div><strong>Add-ons</strong>{selectedAddons.map((item) => <button type="button" key={item.id} onClick={() => toggle("addons", "addonQuantities", item, false)} aria-label={`Remove ${item.name} from bundle`}>{item.name}<span>Remove</span></button>)}</div>
            )}
            {selectedRentals.length > 0 && (
              <div><strong>Rentals</strong>{selectedRentals.map((item) => <button type="button" key={item.id} onClick={() => toggle("rentals", "rentalQuantities", item, false)} aria-label={`Remove ${item.name} from bundle`}>{item.name}<span>Remove</span></button>)}</div>
            )}
          </div>
        )}
        <p>Every selection stays reversible here. Saving still runs the trusted catalog and pricing checks.</p>
      </section>

      <div>
        <h4>Add-ons</h4>
        <p className="source-note">Per-item (and configured unit-based) add-ons support quantity edits.</p>
        <div className="checklist">
          {activeAddons.length === 0 && <p className="source-note">No active add-ons are available.</p>}
          {activeAddons.map((item) => {
            const pricingType = resolvePricingType(item, "per_person");
            const quantityEnabled = addonSupportsQuantity(item, pricingType);
            const selected = form.addons.includes(item.id);
            const rawImpact = selectionImpact("addons", "addonQuantities", item);
            const impact = selected && rawImpact !== null ? -rawImpact : rawImpact;
            return (
              <label className={joinClassNames("checkrow", "checkrow-choice", selected && "is-selected")} key={item.id}>
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={(e) => toggle("addons", "addonQuantities", item, e.target.checked, 1, e)}
                />
                <span className="selection-item-copy">
                  <strong>{item.name}</strong>
                  <small>{includedAddonIds.has(item.id) ? "Included in the current package" : pricingLabel(item, "per_person")}</small>
                  <em>{impactLabel(impact, { selected })}</em>
                </span>
                {quantityEnabled && selected && (
                  <input
                    className="qty-input"
                    type="number"
                    min="1"
                    step="1"
                    value={Math.max(1, Number(form.addonQuantities?.[item.id] || 1))}
                    onChange={(e) => patchQuantity("addonQuantities", item.id, e.target.value, "addons", e)}
                  />
                )}
              </label>
            );
          })}
        </div>
      </div>

      <div>
        <h4>Rentals</h4>
        <div className="checklist">
          {activeRentals.length === 0 && <p className="source-note">No active rentals are available.</p>}
          {activeRentals.map((item) => {
            const pricingType = resolvePricingType(item, "per_item");
            const selected = form.rentals.includes(item.id);
            const fallbackQty = typeof item.qtyRule === "function"
              ? item.qtyRule(Math.max(0, Number(form.guests || 0)))
              : 1;
            const rawImpact = selectionImpact("rentals", "rentalQuantities", item, fallbackQty);
            const impact = selected && rawImpact !== null ? -rawImpact : rawImpact;
            return (
              <label className={joinClassNames("checkrow", "checkrow-choice", selected && "is-selected")} key={item.id}>
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={(e) => toggle("rentals", "rentalQuantities", item, e.target.checked, fallbackQty, e)}
                />
                <span className="selection-item-copy">
                  <strong>{item.name}</strong>
                  <small>{includedRentalIds.has(item.id) ? "Included in the current package" : pricingLabel(item, "per_item")}</small>
                  <em>{impactLabel(impact, { selected })}</em>
                </span>
                {pricingType === "per_item" && selected && (
                  <input
                    className="qty-input"
                    type="number"
                    min="1"
                    step="1"
                    value={Math.max(1, Number(form.rentalQuantities?.[item.id] || fallbackQty))}
                    onChange={(e) => patchQuantity("rentalQuantities", item.id, e.target.value, "rentals", e)}
                  />
                )}
              </label>
            );
          })}
        </div>
      </div>

      <div className="recommendation-panel">
        <h4>Recommended Upgrades</h4>
        {!aiAssistEnabled && (
          <p className="source-note">AI assist is currently disabled in Workspace Features.</p>
        )}
        {aiAssistEnabled && !guidedSellingEnabled && (
          <p className="source-note">Guided selling is currently disabled in Catalog Admin.</p>
        )}
        {aiAssistEnabled && guidedSellingEnabled && recommendations.length === 0 && (
          <p className="source-note">No rule matches this quote yet. Increase guests/hours or adjust rule triggers.</p>
        )}
        {aiAssistEnabled && guidedSellingEnabled && recommendations.length > 0 && (
          pilotGuidedSelling ? (() => {
            const guided = buildGuidedSellingCards({ recommendations, aiAutopilotEnabled });
            return (
              <div className="now-stream" data-guided-selling={guided.modelId}>
                {guided.cards.map((card) => (
                  <DecisionCard
                    key={card.id}
                    signal={card.signal}
                    family={card.family}
                    label={card.label}
                    title={card.title}
                    meta={card.meta}
                    sentence={card.sentence}
                    basis={card.basis}
                    impact={card.impact}
                    why={card.why}
                    actions={[card.action]}
                    onAction={() => onApplyRecommendation(card.recommendation)}
                  />
                ))}
                <p className="source-note">{guided.boundsNote}</p>
              </div>
            );
          })() : (
            <div className="recommendation-list">
              {recommendations.map((item) => (
                <article className="recommendation-card" key={item.key}>
                  <div>
                    <strong>{item.label}</strong>
                    <p>{item.reason}</p>
                    <small>{item.impact}</small>
                  </div>
                  <button
                    type="button"
                    className="ghost compact"
                    onClick={() => onApplyRecommendation(item)}
                    disabled={aiAutopilotEnabled}
                  >
                    {aiAutopilotEnabled ? "Auto" : "Apply"}
                  </button>
                </article>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}

export function StepReview({
  form,
  totals,
  settings,
  readiness = null,
  quoteCompletionCommandPathEnabled = false,
  quoteCompletionSaveBlockers = [],
  onQuoteCompletionAction = null
}) {
  const quoteDate = new Date().toLocaleDateString();
  const eventDateLabel = form.date ? new Date(`${form.date}T12:00:00`).toLocaleDateString() : "-";
  const eventTimeLabel = form.time ? new Date(`2000-01-01T${form.time}`).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "-";
  const menuLookup = new Map(
    (settings.menuSections || []).flatMap((section) =>
      (section.items || []).map((item) => [item.id, item.name])
    )
  );
  const menuNames = (form.menuItems || []).map((id) => menuLookup.get(id)).filter(Boolean);
  const effectivePerPerson = totals.guests > 0 ? totals.base / totals.guests : 0;
  const staffingOnly = Math.max(0, totals.labor - totals.bartenderLabor);
  const staffingLaborEnabled = totals.staffingLaborEnabled !== false;
  const staffTeamLabel = [
    ["server", totals.servers],
    ["chef", totals.chefs],
    ["bartender", totals.bartenders]
  ]
    .map(([role, count]) => [role, Math.max(0, Number(count || 0))])
    .filter(([, count]) => count > 0)
    .map(([role, count]) => `${count} ${role}${count === 1 ? "" : "s"}`)
    .join(" · ");
  const validityDays = Math.max(1, Number(settings.quoteValidityDays || 30));
  const businessContact = [
    settings.businessAddress,
    settings.businessPhone,
    settings.businessEmail
  ].filter(Boolean).join("  •  ");
  const quoteCompletion = buildQuoteCompletionProjection({
    quote: form,
    readiness,
    saveBlockers: quoteCompletionSaveBlockers,
    draftDirty: true,
    saveRevisionLabel: "Continue to save review",
    saveRevisionDestination: {
      surfaceId: "quote-wizard",
      step: 5,
      actionId: "review_before_save"
    }
  });

  return (
    <div className="review">
      {quoteCompletionCommandPathEnabled ? (
        <QuoteCompletionCommandPath
          enabled
          projection={quoteCompletion}
          onAction={(action) => onQuoteCompletionAction?.(action) || {
            state: "recovery",
            message: action.reason
          }}
          surface="review"
        />
      ) : readiness && (
        <section className={`readiness-panel readiness-${readiness.status?.id || "review"}`}>
          <div className="readiness-head">
            <div>
              <span>Proposal readiness</span>
              <strong>{readiness.score}%</strong>
            </div>
            <em>{readiness.status?.label || "Review"}</em>
          </div>
          <progress max="100" value={readiness.score}>{readiness.score}%</progress>
          {readiness.gaps?.length > 0 && (
            <div className="readiness-gaps">
              {readiness.gaps.map((item) => <span key={item.id}>{item.label}</span>)}
            </div>
          )}
        </section>
      )}
      <article className="quote-sheet">
        <h2>Catering Quote</h2>

        <div className="quote-sheet-meta">
          <p><strong>Quote Date:</strong> {quoteDate}</p>
          <p className="quote-sheet-meta-wide">
            <strong>Responsible Party / Client:</strong> {form.name || "-"}
            {form.clientOrg ? ` / ${form.clientOrg}` : ""}
          </p>
          <p><strong>Phone #:</strong> {form.phone || "-"}</p>
          <p><strong>Email Address:</strong> {form.email || "-"}</p>
          <p><strong># of Guests:</strong> {form.guests || 0}</p>
          <p><strong>Time of Event:</strong> {eventTimeLabel}</p>
          <p><strong>Name of Event:</strong> {form.eventName || "-"}</p>
          <p><strong>Date of Event:</strong> {eventDateLabel}</p>
          <p className="quote-sheet-meta-wide"><strong>Event Location:</strong> {form.venue || "-"}</p>
          <p className="quote-sheet-meta-wide"><strong>Venue Address:</strong> {form.venueAddress || "-"}</p>
          <p className="quote-sheet-meta-wide"><strong>Dietary Restrictions:</strong> {form.dietaryRestrictions || "-"}</p>
        </div>

        <section className="quote-sheet-menu">
          <h3>Menu</h3>
          <p>{menuNames.join(", ") || "-"}</p>
        </section>

        <section className="quote-sheet-charges">
          <div className="quote-charge"><span>Per Person: {currency(effectivePerPerson)} x ({totals.guests})</span><strong>{currency(totals.base)}</strong></div>
          <div className="quote-charge"><span>Tax: ({Math.round(totals.taxRateApplied * 1000) / 10}%)</span><strong>{currency(totals.tax)}</strong></div>
          {staffingLaborEnabled && <div className="quote-charge"><span>Staffing</span><strong>{currency(staffingOnly)}</strong></div>}
          <div className="quote-charge"><span>Travel Fee</span><strong>{currency(totals.travel)}</strong></div>
          {staffingLaborEnabled && <div className="quote-charge"><span>Bartender</span><strong>{currency(totals.bartenderLabor)}</strong></div>}
          {staffingLaborEnabled && staffTeamLabel && (
            <div className="quote-charge quote-charge-wide">
              <span>Staffing team</span>
              <strong>{staffTeamLabel}</strong>
            </div>
          )}
          <div className="quote-charge"><span>{serviceChargeLabel(totals.serviceFeePctApplied)}</span><strong>{currency(totals.serviceFee)}</strong></div>
          {(totals.addons > 0 || totals.rentals > 0 || totals.menu > 0) && (
            <div className="quote-charge quote-charge-wide">
              <span>Add-ons/Rentals/Menu</span>
              <strong>{currency(totals.addons + totals.rentals + totals.menu)}</strong>
            </div>
          )}
        </section>

        {form.includeDisposables !== false && (
          <p className="quote-center-note"><strong>{settings.disposablesNote || "All disposables are included in this quote."}</strong></p>
        )}
        <p className="quote-total-line">TOTAL: <strong>{currency(totals.total)}</strong></p>

        <div className="quote-sheet-bottom">
          <p><strong>Quote prepared by:</strong> {settings.quotePreparedBy || "-"}</p>
          <p><strong>Quote is valid for {validityDays} days.</strong></p>
        </div>
        <p className="quote-acceptance">To accept quote, please sign and return to {settings.acceptanceEmail || settings.businessEmail || "-"}</p>
        <p className="quote-deposit-tag"><strong>{settings.depositNotice || "30% deposit is required to lock in your date."}</strong></p>
        {businessContact && <p className="quote-contact-strip">{businessContact}</p>}
      </article>

      <div className="summary-total">
        <p>Deposit ({Math.round(settings.depositPct * 100)}%): <strong>{currency(totals.deposit)}</strong></p>
      </div>
    </div>
  );
}
