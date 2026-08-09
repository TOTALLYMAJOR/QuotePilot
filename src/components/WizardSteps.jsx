import { useState } from "react";
import { currency, serviceChargeLabel } from "../lib/quoteCalculator";
import {
  clampCount,
  isPastEventDateISO,
  MAX_EVENT_HOURS,
  MIN_EVENT_HOURS,
  normalizeEventHours,
  resolveQuoteValidThroughISO
} from "../lib/wizardUi";

function joinClassNames(...parts) {
  return parts.filter(Boolean).join(" ");
}

function Field({ label, children, error = "", warning = "", hint = "", required = false, className = "" }) {
  return (
    <label className={joinClassNames("field", className, error && "field-error")}>
      <span>
        {label}
        {required && <em className="field-required" aria-hidden="true">*</em>}
      </span>
      {children}
      {error && <small className="field-error-note">{error}</small>}
      {!error && warning && <small className="field-warning-note" role="status">{warning}</small>}
      {!error && !warning && hint && <small className="field-hint">{hint}</small>}
    </label>
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

function StepperNumberInput({
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
          onClick={() => onChange(Math.max(min, safeValue - 1))}
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
          onChange={(e) => onChange(clampCount(e.target.value, min, max))}
          onBlur={onBlur}
          aria-invalid={Boolean(error)}
        />
        <button
          type="button"
          className="ghost compact"
          onClick={() => onChange(Math.min(max, safeValue + 1))}
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
          <Field label="Event type" error={getError("eventTypeId")} required>
            <select
              value={form.eventTypeId || ""}
              onChange={(e) => (typeof onEventTypeChange === "function"
                ? onEventTypeChange(e.target.value)
                : updateField("eventTypeId", e.target.value))}
              onBlur={() => markBlur("eventTypeId")}
              aria-invalid={Boolean(getError("eventTypeId"))}
            >
              <option value="">
                {eventTypes.length ? "Select event type" : "No event types available"}
              </option>
              {eventTypes.map((eventType) => (
                <option key={eventType.id} value={eventType.id}>{eventType.name}</option>
              ))}
            </select>
          </Field>
          <TemplateDefaultsBanner
            notice={templateNotice}
            onClearDefaults={onClearTemplateDefaults}
            onDismiss={onDismissTemplateNotice}
          />
          <Field
            label="Event date"
            error={getError("date")}
            warning={isPastEventDateISO(form.date)
              ? "This date is in the past — double-check it before sending the quote."
              : ""}
            required
          >
            <input
              type="date"
              value={form.date}
              onChange={(e) => updateField("date", e.target.value)}
              onBlur={() => markBlur("date")}
              aria-invalid={Boolean(getError("date"))}
            />
          </Field>
          <Field label="Start time">
            <input
              type="time"
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
              value={form.venue}
              onChange={(e) => updateField("venue", e.target.value)}
              onBlur={() => markBlur("venue")}
              aria-invalid={Boolean(getError("venue"))}
            />
          </Field>
          <Field label="Venue address">
            <input
              type="text"
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
          <Field label="Event template">
            <select
              value={form.eventTemplateId || "custom"}
              onChange={(e) => onTemplateChange(e.target.value)}
              onBlur={() => markBlur("eventTemplateId")}
            >
              <option value="custom">Custom</option>
              {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
            </select>
          </Field>
          <Field label="Service style">
            <select
              value={form.style}
              onChange={(e) => updateField("style", e.target.value)}
              onBlur={() => markBlur("style")}
            >
              {styles.map((style) => <option key={style} value={style}>{style}</option>)}
            </select>
          </Field>
          <Field label="Tax region">
            <select
              value={form.taxRegion || ""}
              onChange={(e) => updateField("taxRegion", e.target.value)}
              onBlur={() => markBlur("taxRegion")}
            >
              {taxRegions.map((region) => (
                <option key={region.id} value={region.id}>
                  {region.name} ({Math.round(Number(region.rate || 0) * 1000) / 10}%)
                </option>
              ))}
            </select>
          </Field>
          <Field label="Season profile">
            <select
              value={form.seasonProfileId || "auto"}
              onChange={(e) => updateField("seasonProfileId", e.target.value)}
              onBlur={() => markBlur("seasonProfileId")}
            >
              <option value="auto">Auto detect</option>
              {seasonProfiles.map((season) => <option key={season.id} value={season.id}>{season.name}</option>)}
            </select>
          </Field>
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

export function StepMenu({
  form,
  setForm,
  menuSections,
  menuLoading = false,
  menuError = "",
  eventTypeLabel = "",
  isAdmin = false,
  onRetry,
  onOpenCatalogMenu,
  onSelectionTouched,
  packageIncludedMenuItemIds = []
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

  const toggleMenuItem = (item, checked) => {
    const itemId = String(item?.id || "").trim();
    if (!itemId) return;
    const pricingType = resolvePricingType(item);
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

  const patchMenuQuantity = (itemId, value) => {
    const quantity = Math.max(1, Math.round(Number(value || 1)));
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
        <div className="menu-library">
          <h4>Customized Cuisine Menu</h4>
          <p className="source-note">Select menu items to include in this quote proposal.</p>
          <div className="menu-grid">
            {resolvedMenuSections.map((section) => (
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
                  {(section.items || []).map((item) => (
                    <label className="checkrow checkrow-quantity" key={item.id}>
                      <input
                        type="checkbox"
                        checked={form.menuItems.includes(item.id)}
                        onChange={(e) => toggleMenuItem(item, e.target.checked)}
                      />
                      <span>{item.name}</span>
                      <small>{includedMenuItemIds.has(item.id) ? "Included at no added charge — select to add" : pricingLabel(item)}</small>
                      {resolvePricingType(item) === "per_item" && form.menuItems.includes(item.id) && (
                        <input
                          className="qty-input"
                          type="number"
                          min="1"
                          step="1"
                          value={Math.max(1, Number(menuQuantities[item.id] || 1))}
                          onChange={(e) => patchMenuQuantity(item.id, e.target.value)}
                        />
                      )}
                    </label>
                  ))}
                </div>
              </section>
            ))}
          </div>
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
  onAddonSelection
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
  const selectedPackage = activePackages.find((item) => item.id === form.pkg) || activePackages[0] || {};
  const includedAddonIds = new Set(selectedPackage.includedAddonIds || []);
  const includedRentalIds = new Set(selectedPackage.includedRentalIds || []);
  const menuItemsById = new Map(
    (catalog.settings?.menuSections || []).flatMap((section) => section.items || [])
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

  const toggle = (key, quantityKey, item, checked, fallbackQty = 1) => {
    const id = String(item?.id || "").trim();
    if (!id) return;
    const pricingType = resolvePricingType(item, key === "rentals" ? "per_item" : "per_event");
    const quantityEnabled = key === "addons"
      ? addonSupportsQuantity(item, pricingType)
      : pricingType === "per_item";
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

  const patchQuantity = (quantityKey, id, value, touchedFieldName) => {
    const quantity = Math.max(1, Math.round(Number(value || 1)));
    if (typeof onSelectionTouched === "function") onSelectionTouched(touchedFieldName, id);
    setForm((f) => ({
      ...f,
      [quantityKey]: {
        ...(f[quantityKey] || {}),
        [id]: quantity
      }
    }));
  };

  return (
    <div className="grid two-col">
      <TemplateDefaultsBanner
        notice={templateNotice}
        onClearDefaults={onClearTemplateDefaults}
        onDismiss={onDismissTemplateNotice}
      />
      <Field label="Package tier">
        <select
          value={form.pkg}
          onChange={(e) => {
            if (typeof onSelectionTouched === "function") onSelectionTouched("pkg");
            setForm((f) => ({ ...f, pkg: e.target.value }));
          }}
        >
          {activePackages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} - {currency(p.ppp)}/person{packageInclusionCount(p) ? ` · ${packageInclusionCount(p)} select-to-add choices included` : ""}
            </option>
          ))}
        </select>
      </Field>
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

      <div>
        <h4>Add-ons</h4>
        <p className="source-note">Per-item (and configured unit-based) add-ons support quantity edits.</p>
        <div className="checklist">
          {activeAddons.length === 0 && <p className="source-note">No active add-ons are available.</p>}
          {activeAddons.map((item) => {
            const pricingType = resolvePricingType(item, "per_person");
            const quantityEnabled = addonSupportsQuantity(item, pricingType);
            const selected = form.addons.includes(item.id);
            return (
              <label className="checkrow checkrow-quantity" key={item.id}>
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={(e) => toggle("addons", "addonQuantities", item, e.target.checked, 1)}
                />
                <span>{item.name}</span>
                <small>{includedAddonIds.has(item.id) ? "Included at no added charge — select to add" : pricingLabel(item, "per_person")}</small>
                {quantityEnabled && selected && (
                  <input
                    className="qty-input"
                    type="number"
                    min="1"
                    step="1"
                    value={Math.max(1, Number(form.addonQuantities?.[item.id] || 1))}
                    onChange={(e) => patchQuantity("addonQuantities", item.id, e.target.value, "addons")}
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
            return (
              <label className="checkrow checkrow-quantity" key={item.id}>
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={(e) => toggle("rentals", "rentalQuantities", item, e.target.checked, fallbackQty)}
                />
                <span>{item.name}</span>
                <small>{includedRentalIds.has(item.id) ? "Included at no added charge — select to add" : pricingLabel(item, "per_item")}</small>
                {pricingType === "per_item" && selected && (
                  <input
                    className="qty-input"
                    type="number"
                    min="1"
                    step="1"
                    value={Math.max(1, Number(form.rentalQuantities?.[item.id] || fallbackQty))}
                    onChange={(e) => patchQuantity("rentalQuantities", item.id, e.target.value, "rentals")}
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
          <p className="source-note">AI assist is currently disabled in Optional Modules.</p>
        )}
        {aiAssistEnabled && !guidedSellingEnabled && (
          <p className="source-note">Guided selling is currently disabled in Catalog Admin.</p>
        )}
        {aiAssistEnabled && guidedSellingEnabled && recommendations.length === 0 && (
          <p className="source-note">No rule matches this quote yet. Increase guests/hours or adjust rule triggers.</p>
        )}
        {aiAssistEnabled && guidedSellingEnabled && recommendations.length > 0 && (
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
        )}
      </div>
    </div>
  );
}

export function StepReview({ form, totals, settings, readiness = null }) {
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
  const allInPerGuest = totals.guests > 0 ? totals.total / totals.guests : 0;
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
  const validThroughLabel = new Date(
    `${resolveQuoteValidThroughISO(validityDays)}T12:00:00`
  ).toLocaleDateString();
  const businessContact = [
    settings.businessAddress,
    settings.businessPhone,
    settings.businessEmail
  ].filter(Boolean).join("  •  ");

  return (
    <div className="review">
      {readiness && (
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
          <p><strong># of Guests:</strong> {totals.guests || 0}</p>
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
        {totals.guests > 0 && (
          <p className="quote-per-guest-note">
            {currency(allInPerGuest)} per guest all-in — includes staffing, travel, service charge, and tax.
          </p>
        )}

        <div className="quote-sheet-bottom">
          <p><strong>Quote prepared by:</strong> {settings.quotePreparedBy || "-"}</p>
          <p><strong>Quote is valid for {validityDays} days — through {validThroughLabel}.</strong></p>
        </div>
        <p className="quote-acceptance">To accept quote, please sign and return to {settings.acceptanceEmail || settings.businessEmail || "-"}</p>
        <p className="quote-deposit-tag"><strong>{settings.depositNotice || "30% deposit is required to lock in your date."}</strong></p>
        {businessContact && <p className="quote-contact-strip">{businessContact}</p>}
      </article>

      <div className="summary-total">
        <p>Deposit ({Math.round(settings.depositPct * 100)}%): <strong>{currency(totals.deposit)}</strong></p>
        {totals.guests > 0 && (
          <p>All-in per guest: <strong>{currency(allInPerGuest)}</strong></p>
        )}
      </div>
    </div>
  );
}
