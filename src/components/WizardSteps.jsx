import { useState } from "react";
import { currency } from "../lib/quoteCalculator";

function joinClassNames(...parts) {
  return parts.filter(Boolean).join(" ");
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

function AccordionGroup({
  id,
  title,
  description,
  open,
  onToggle,
  children,
  optional = false,
  collapsedHint = ""
}) {
  return (
    <section className={joinClassNames("accordion-group", open && "open")}> 
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
          onChange={(e) => onChange(Number(e.target.value || 0))}
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
  showValidation = false
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
          <Field label="Event date" error={getError("date")} required>
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
                  min="1"
                  max="12"
                  value={Math.max(1, Number(form.hours || 1))}
                  aria-label="Event hours"
                  onChange={(e) => updateField("hours", Number(e.target.value || 0))}
                  onBlur={() => markBlur("hours")}
                />
                <output>{Math.max(1, Number(form.hours || 1))} hrs</output>
              </div>
              <input
                type="range"
                min="1"
                max="12"
                value={Math.max(1, Number(form.hours || 1))}
                aria-label="Event hours slider"
                onChange={(e) => updateField("hours", Number(e.target.value || 1))}
              />
            </div>
          </Field>

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
        description="Optional controls for templates, seasonality, and tax context"
        optional
        collapsedHint="Optional: use only when you need custom pricing context beyond core event details."
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
        </div>
      </AccordionGroup>

    </div>
  );
}

export function StepMenu({
  form,
  setForm,
  menuSections,
  selectedPackage = null,
  menuLoading = false,
  onSelectionTouched
}) {
  const resolvedMenuSections = Array.isArray(menuSections) ? menuSections : [];
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
  const includedMenuItemIds = new Set(Array.isArray(selectedPackage?.includedMenuItemIds) ? selectedPackage.includedMenuItemIds : []);

  const toggleMenuItem = (item, checked) => {
    const itemId = String(item?.id || "").trim();
    if (!itemId) return;
    const pricingType = resolvePricingType(item);
    if (typeof onSelectionTouched === "function") onSelectionTouched("menuItems");
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
    if (typeof onSelectionTouched === "function") onSelectionTouched("menuItems");
    setForm((f) => ({
      ...f,
      menuItemQuantities: {
        ...(f.menuItemQuantities || {}),
        [itemId]: quantity
      }
    }));
  };

  return (
    <div className="grid two-col">
      {resolvedMenuSections.length > 0 && (
        <div className="menu-library">
          <h4>Customized Cuisine Menu</h4>
          {menuLoading && <p className="source-note">Loading menu for selected event type...</p>}
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
                      <small>{includedMenuItemIds.has(item.id) ? "Included in package" : pricingLabel(item)}</small>
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
      {resolvedMenuSections.length === 0 && !menuLoading && (
        <div className="menu-library">
          <h4>Customized Cuisine Menu</h4>
          <p className="source-note">Select an event type to load menu categories and items.</p>
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
  onSelectionTouched
}) {
  const guidedSellingEnabled =
    guidedSellingEnabledProp !== undefined
      ? guidedSellingEnabledProp !== false
      : catalog.settings?.guidedSellingEnabled !== false;
  const aiAssistEnabled = aiAssistEnabledProp !== false;
  const aiAutopilotEnabled = aiAssistEnabled && aiAutopilotEnabledProp === true;
  const selectedPackage = catalog.packages.find((item) => item.id === form.pkg) || catalog.packages[0] || {};
  const includedAddonIds = new Set(Array.isArray(selectedPackage.includedAddonIds) ? selectedPackage.includedAddonIds : []);
  const includedRentalIds = new Set(Array.isArray(selectedPackage.includedRentalIds) ? selectedPackage.includedRentalIds : []);
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
    if (typeof onSelectionTouched === "function") onSelectionTouched(key);
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
    if (typeof onSelectionTouched === "function") onSelectionTouched(touchedFieldName);
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
      <Field label="Package tier">
        <select
          value={form.pkg}
          onChange={(e) => {
            if (typeof onSelectionTouched === "function") onSelectionTouched("pkg");
            setForm((f) => ({ ...f, pkg: e.target.value }));
          }}
        >
          {catalog.packages.map((p) => {
            const includedCount = (p.includedAddonIds?.length || 0) + (p.includedRentalIds?.length || 0) + (p.includedMenuItemIds?.length || 0);
            return <option key={p.id} value={p.id}>{p.name} - {currency(p.ppp)}/person{includedCount ? ` · ${includedCount} included` : ""}</option>;
          })}
        </select>
      </Field>
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
          {catalog.addons.map((item) => {
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
                <small>{includedAddonIds.has(item.id) ? "Included in package" : pricingLabel(item, "per_person")}</small>
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
          {catalog.rentals.map((item) => {
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
                <small>{includedRentalIds.has(item.id) ? "Included in package" : pricingLabel(item, "per_item")}</small>
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
  const staffingOnly = Math.max(0, totals.labor - totals.bartenderLabor);
  const staffingLaborEnabled = totals.staffingLaborEnabled !== false;
  const staffingChargeMode = String(totals.staffingChargeMode || "per_hour").trim().toLowerCase();
  const staffingChargeModeLabel = staffingChargeMode === "per_event_per_staff"
    ? "per event x staff count"
    : "per hour x staff count";
  const formatRateList = (rates, limit = 6) => {
    const safeRates = Array.isArray(rates)
      ? rates
        .map((rate) => Number(rate))
        .filter((rate) => Number.isFinite(rate) && rate >= 0)
      : [];
    if (!safeRates.length) return "";
    const labels = safeRates.map((rate) => currency(rate));
    if (labels.length <= limit) return labels.join(", ");
    return `${labels.slice(0, limit).join(", ")} (+${labels.length - limit} more)`;
  };
  const serverRatesApplied = Array.isArray(totals.serverRatesApplied)
    ? totals.serverRatesApplied
      .map((rate) => Number(rate))
      .filter((rate) => Number.isFinite(rate) && rate >= 0)
    : [];
  const chefRatesApplied = Array.isArray(totals.chefRatesApplied)
    ? totals.chefRatesApplied
      .map((rate) => Number(rate))
      .filter((rate) => Number.isFinite(rate) && rate >= 0)
    : [];
  const hasCustomServerMix = String(form.serverRateMixCsv || "").trim() !== ""
    || serverRatesApplied.some((rate) => Math.abs(rate - Number(totals.serverRateApplied || 0)) >= 0.01);
  const hasCustomChefMix = String(form.chefRateMixCsv || "").trim() !== ""
    || chefRatesApplied.some((rate) => Math.abs(rate - Number(totals.chefRateApplied || 0)) >= 0.01);
  const serverRatesLabel = serverRatesApplied.length
    ? formatRateList(serverRatesApplied)
    : `${currency(totals.serverRateApplied || 0)} x ${Math.max(0, Number(totals.servers || 0))}`;
  const chefRatesLabel = chefRatesApplied.length
    ? formatRateList(chefRatesApplied)
    : `${currency(totals.chefRateApplied || 0)} x ${Math.max(0, Number(totals.chefs || 0))}`;
  const validityDays = Math.max(1, Number(settings.quoteValidityDays || 30));
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
          {staffingLaborEnabled && (
            <div className="quote-charge quote-charge-wide">
              <span>Staff Count ({staffingChargeModeLabel})</span>
              <strong>
                S {Math.max(0, Number(totals.servers || 0))} / C {Math.max(0, Number(totals.chefs || 0))} / B {Math.max(0, Number(totals.bartenders || 0))}
              </strong>
            </div>
          )}
          {staffingLaborEnabled && hasCustomServerMix && Math.max(0, Number(totals.servers || 0)) > 0 && (
            <div className="quote-charge quote-charge-wide">
              <span>Server Rates (Applied)</span>
              <strong>{serverRatesLabel}</strong>
            </div>
          )}
          {staffingLaborEnabled && hasCustomChefMix && Math.max(0, Number(totals.chefs || 0)) > 0 && (
            <div className="quote-charge quote-charge-wide">
              <span>Chef Rates (Applied)</span>
              <strong>{chefRatesLabel}</strong>
            </div>
          )}
          {!staffingLaborEnabled && (
            <div className="quote-charge quote-charge-wide">
              <span>Staffing labor automation</span>
              <strong>Disabled</strong>
            </div>
          )}
          <div className="quote-charge"><span>Gratuity</span><strong>{currency(totals.serviceFee)}</strong></div>
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
        <p className="quote-signoff">Gratuity is never expected but is always appreciated!</p>
        <p className="quote-contact-strip">{businessContact || "-"}</p>
      </article>

      <div className="summary-total">
        <p>Deposit ({Math.round(settings.depositPct * 100)}%): <strong>{currency(totals.deposit)}</strong></p>
      </div>
    </div>
  );
}
