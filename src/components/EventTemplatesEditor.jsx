import { useEffect, useId, useMemo, useRef, useState } from "react";
import AdaptiveChoiceField from "./AdaptiveChoiceField";
import FieldStateIndicator from "./FieldStateIndicator";
import { Plus, TrashSimple, WarningCircle } from "./ProductIcons";
import "./eventTemplatesEditor.css";

const COMMON_EVENT_STYLES = Object.freeze([
  "Buffet",
  "Cocktail",
  "Drop-off",
  "Family style",
  "Plated",
  "Stations"
]);

function text(value = "") {
  return String(value ?? "").trim();
}

const TEMPLATE_FIELD_LABELS = Object.freeze({
  pkg: "starting offer",
  eventTypeId: "event type",
  style: "service style",
  hours: "event hours",
  addons: "included services",
  rentals: "included rentals",
  menuItems: "included menu items",
  servers: "servers",
  chefs: "chefs",
  bartenders: "bartenders",
  milesRT: "travel distance",
  payMethod: "payment method",
  taxRegion: "tax region",
  seasonProfileId: "seasonal pricing profile",
  staffingRateTypeId: "staffing rate policy",
  bartenderRateTypeId: "bartender rate policy",
  id: "stable identity",
  name: "template name",
  summary: "starting point summary"
});

function templateFieldLabel(field) {
  return TEMPLATE_FIELD_LABELS[text(field)] || "template";
}

function uniqueRecords(records = []) {
  const seen = new Set();
  return (Array.isArray(records) ? records : [])
    .map((record) => {
      const id = text(record?.id);
      if (!id || seen.has(id)) return null;
      seen.add(id);
      return {
        ...record,
        id,
        name: text(record?.name || record?.label || record?.title) || id,
        eventTypeId: text(record?.eventTypeId),
        active: record?.active !== false
      };
    })
    .filter(Boolean);
}

export function flattenEventTemplateMenuItems(menuItems = [], menuSections = []) {
  const nested = (Array.isArray(menuSections) ? menuSections : []).flatMap((section) => {
    const sectionItems = Array.isArray(section?.items)
      ? section.items
      : Array.isArray(section?.menuItems)
        ? section.menuItems
        : [];
    return sectionItems.map((item) => ({
      ...item,
      eventTypeId: text(item?.eventTypeId) || text(section?.eventTypeId),
      sectionName: text(section?.name || section?.label)
    }));
  });
  const records = new Map();
  [...nested, ...(Array.isArray(menuItems) ? menuItems : [])].forEach((record) => {
    const id = text(record?.id);
    if (!id) return;
    const current = records.get(id) || {};
    records.set(id, {
      ...current,
      ...record,
      id,
      name: text(record?.name || record?.label || record?.title || current?.name) || id,
      eventTypeId: text(record?.eventTypeId) || text(current?.eventTypeId),
      active: record?.active !== false
    });
  });
  return [...records.values()];
}

export function nextEventTemplateId(templates = []) {
  const ids = new Set((Array.isArray(templates) ? templates : []).map((template) => text(template?.id)));
  let index = 1;
  while (ids.has(`template-${index}`)) index += 1;
  return `template-${index}`;
}

function dependencyWarnings(ids, records, { kind, label, inventoryComplete = true }) {
  const lookup = new Map(records.map((record) => [record.id, record]));
  const warnings = [];
  (Array.isArray(ids) ? ids : []).forEach((idValue) => {
    const id = text(idValue);
    const record = lookup.get(id);
    if (!record) {
      if (!inventoryComplete) return;
      warnings.push({
        code: `missing-${kind}`,
        dependencyId: id,
        message: `${label} ${id || "with no ID"} is not available in this catalog.`
      });
      return;
    }
    if (record.active === false) {
      warnings.push({
        code: `inactive-${kind}`,
        dependencyId: id,
        message: `${record.name} is inactive and will not be offered as a current choice.`
      });
    }
  });
  return warnings;
}

export function buildEventTemplateWarnings(template = {}, {
  eventTypes = [],
  packages = [],
  addons = [],
  rentals = [],
  menuItems = [],
  menuInventoryComplete = false,
  duplicateIds = new Set()
} = {}) {
  const warnings = [];
  const templateId = text(template?.id);
  const packageId = text(template?.pkg);
  const eventTypeId = text(template?.eventTypeId) || templateId;
  const packageRecords = uniqueRecords(packages);
  const eventTypeRecords = uniqueRecords(eventTypes);
  const addonRecords = uniqueRecords(addons);
  const rentalRecords = uniqueRecords(rentals);
  const menuItemRecords = uniqueRecords(menuItems);

  if (!templateId) {
    warnings.push({ code: "missing-template-id", message: "This template needs a stable ID before it can be used." });
  } else if (duplicateIds.has(templateId)) {
    warnings.push({ code: "duplicate-template-id", message: `Template ID ${templateId} is used more than once.` });
  }
  if (!text(template?.name)) {
    warnings.push({ code: "missing-template-name", message: "Name this starting point so staff can recognize it." });
  }

  const selectedEventType = eventTypeRecords.find((record) => record.id === eventTypeId);
  if (!eventTypeId) {
    warnings.push({ code: "missing-event-type", message: "Choose the event type this template starts." });
  } else if (!selectedEventType) {
    warnings.push({ code: "missing-event-type", message: `Event type ${eventTypeId} is not available.` });
  } else if (selectedEventType.active === false) {
    warnings.push({ code: "inactive-event-type", message: `${selectedEventType.name} is inactive.` });
  }

  const selectedPackage = packageRecords.find((record) => record.id === packageId);
  if (!packageId) {
    warnings.push({ code: "missing-package", message: "Choose the offer this template starts with." });
  } else if (!selectedPackage) {
    warnings.push({ code: "missing-package", message: `Offer ${packageId} is not available.` });
  } else if (selectedPackage.active === false) {
    warnings.push({ code: "inactive-package", message: `${selectedPackage.name} is inactive.` });
  }

  warnings.push(...dependencyWarnings(template?.addons, addonRecords, {
    kind: "addon",
    label: "Add-on"
  }));
  warnings.push(...dependencyWarnings(template?.rentals, rentalRecords, {
    kind: "rental",
    label: "Rental"
  }));
  warnings.push(...dependencyWarnings(template?.menuItems, menuItemRecords, {
    kind: "menu-item",
    label: "Menu item",
    inventoryComplete: menuInventoryComplete
  }));

  const menuLookup = new Map(menuItemRecords.map((record) => [record.id, record]));
  (Array.isArray(template?.menuItems) ? template.menuItems : []).forEach((idValue) => {
    const record = menuLookup.get(text(idValue));
    if (record?.eventTypeId && eventTypeId && record.eventTypeId !== eventTypeId) {
      warnings.push({
        code: "cross-event-menu-item",
        dependencyId: record.id,
        message: `${record.name} belongs to another event type.`
      });
    }
  });

  return warnings;
}

function includeUnavailableChoice(records, selectedId, label) {
  const id = text(selectedId);
  if (!id || records.some((record) => record.id === id)) return records;
  return [{ id, name: `Unavailable ${label}: ${id}`, active: false, unavailable: true }, ...records];
}

function TemplateChoiceField({
  templateId,
  field,
  label,
  records,
  currentId,
  placeholder,
  disabled,
  onSelect,
  registerTarget
}) {
  const choices = includeUnavailableChoice(records, currentId, label.toLowerCase());
  const activeChoices = records.filter((record) => record.active !== false);
  const currentChoice = choices.find((record) => record.id === currentId);
  const registerField = (node) => registerTarget(templateId, field, node);

  if (activeChoices.length > 1) {
    return (
      <label>
        {label}
        <select
          value={currentId}
          onChange={(event) => onSelect(event.target.value)}
          disabled={disabled}
          data-template-field={field}
          ref={registerField}
        >
          <option value="">{placeholder}</option>
          {choices.map((record) => (
            <option
              key={record.id}
              value={record.id}
              disabled={record.active === false && record.id !== currentId}
            >
              {record.name}{record.active === false && !record.unavailable ? " (inactive)" : ""}
            </option>
          ))}
        </select>
      </label>
    );
  }

  const onlyChoice = activeChoices[0];
  if (onlyChoice && currentId === onlyChoice.id) {
    return (
      <div
        data-template-field={field}
        tabIndex={-1}
        ref={registerField}
      >
        <AdaptiveChoiceField
          label={label}
          options={[{ value: onlyChoice.id, label: onlyChoice.name }]}
          value={currentId}
          disabled={disabled}
          singleChoiceDetail="This is the only active Library choice."
        />
      </div>
    );
  }

  const suggestedChoice = onlyChoice && !currentId;
  const staleChoice = Boolean(currentId);
  const visibleValue = currentChoice?.name || onlyChoice?.name || "No current choice";
  const canRecover = !disabled && typeof onSelect === "function";
  const recoveryAction = canRecover && (onlyChoice || staleChoice)
    ? {
        label: onlyChoice ? `Use ${onlyChoice.name}` : `Remove unavailable ${label.toLowerCase()}`,
        onClick: () => onSelect(onlyChoice?.id || "")
      }
    : undefined;
  const state = disabled
    ? { editability: "protected" }
    : staleChoice
      ? { evidence: "stale" }
      : suggestedChoice
        ? { origin: "suggested" }
        : { availability: "not_provided" };
  const reason = staleChoice && canRecover
    ? `The saved ${label.toLowerCase()} is no longer an active Library choice.`
    : "";
  const provenance = suggestedChoice && !disabled ? "The only active Library choice" : "";
  const supportingDetail = disabled
    ? `This ${label.toLowerCase()} cannot be changed while Library edits are protected.`
    : staleChoice
      ? `The saved value is preserved until you ${onlyChoice ? "replace" : "remove"} it.`
      : suggestedChoice
        ? `Confirm ${onlyChoice.name} to add it to this template draft.`
        : `No active ${label.toLowerCase()} choices are available. Activate one elsewhere in Library, then return to this template.`;

  return (
    <div
      data-template-field={field}
      tabIndex={-1}
      ref={registerField}
    >
      <span className="adaptive-choice-field__label">{label}</span>
      <strong className="adaptive-choice-field__single-value">{visibleValue}</strong>
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

function DependencyPicker({
  templateId,
  kind,
  label,
  records,
  selectedIds,
  eventTypeId = "",
  inventoryComplete = true,
  disabled,
  onChange,
  registerTarget
}) {
  const selected = new Set((Array.isArray(selectedIds) ? selectedIds : []).map(text));
  const unavailable = [...selected]
    .filter((id) => !records.some((record) => record.id === id))
    .map((id) => inventoryComplete
      ? { id, name: `Unavailable: ${id}`, active: false, unavailable: true }
      : { id, name: `Saved reference: ${id}`, active: true, notLoaded: true });
  const visibleRecords = [...unavailable, ...records].filter((record) => (
    kind !== "menuItems"
    || !eventTypeId
    || !record.eventTypeId
    || record.eventTypeId === eventTypeId
    || selected.has(record.id)
  ));

  const toggle = (id, checked) => {
    const next = checked
      ? [...selected, id]
      : [...selected].filter((selectedId) => selectedId !== id);
    onChange([...new Set(next)]);
  };

  return (
    <fieldset
      className="event-templates-editor__dependencies"
      data-template-field={kind}
      data-inventory-complete={inventoryComplete ? "true" : "false"}
      ref={(node) => registerTarget(templateId, kind, node)}
      tabIndex={-1}
    >
      <legend>{label}</legend>
      {visibleRecords.length ? (
        <div className="event-templates-editor__option-list">
          {visibleRecords.map((record) => (
            <label
              key={record.id}
              className="event-templates-editor__check"
              data-template-dependency-kind={kind}
              data-template-dependency-id={record.id}
              data-unavailable={record.unavailable ? "true" : undefined}
              data-not-loaded={record.notLoaded ? "true" : undefined}
            >
              <input
                type="checkbox"
                checked={selected.has(record.id)}
                disabled={disabled || (record.active === false && !selected.has(record.id))}
                onChange={(event) => toggle(record.id, event.target.checked)}
              />
              <span>
                {record.name}
                {record.active === false && !record.unavailable ? " (inactive)" : ""}
              </span>
            </label>
          ))}
        </div>
      ) : (
        <p className="event-templates-editor__empty-note">
          {inventoryComplete
            ? `No ${label.toLowerCase()} are available for this event type.`
            : `No ${label.toLowerCase()} are loaded for this event type.`}
        </p>
      )}
      {!inventoryComplete && (
        <p className="event-templates-editor__scope-note" data-template-inventory-boundary="partial">
          Only the currently loaded menu choices appear here. Saved references are preserved; compare them with current menu records before saving.
        </p>
      )}
    </fieldset>
  );
}

function templateSummary(template, lookups) {
  const packageName = lookups.packages.get(text(template?.pkg))?.name || "No offer";
  const eventTypeId = text(template?.eventTypeId) || text(template?.id);
  const eventTypeName = lookups.eventTypes.get(eventTypeId)?.name || "Event type needs review";
  return `${eventTypeName} · ${packageName} · ${Number(template?.hours || 0) || 0} hours`;
}

function selectionCountLabel(value, singular, plural = `${singular}s`) {
  const count = Array.isArray(value) ? value.filter((item) => text(item)).length : 0;
  return count === 0 ? `No ${plural}` : `${count} ${count === 1 ? singular : plural}`;
}

function staffingResourceSummary(template = {}) {
  const staff = [
    ["servers", "server", "servers"],
    ["chefs", "chef", "chefs"],
    ["bartenders", "bartender", "bartenders"]
  ].flatMap(([field, singular, plural]) => {
    if (!Object.prototype.hasOwnProperty.call(template, field)) return [];
    const count = Math.max(0, Number(template[field] || 0));
    return count > 0 ? [`${count} ${count === 1 ? singular : plural}`] : [];
  });
  const miles = Object.prototype.hasOwnProperty.call(template, "milesRT")
    ? Math.max(0, Number(template.milesRT || 0))
    : null;
  if (miles > 0) staff.push(`${miles} round-trip miles`);
  const policyCount = ["staffingRateTypeId", "bartenderRateTypeId"]
    .filter((field) => text(template?.[field])).length;
  if (policyCount > 0) staff.push(`${policyCount} ${policyCount === 1 ? "rate policy" : "rate policies"}`);
  return staff.length ? staff.join(" · ") : "Set for each quote";
}

function pricingPolicyDefaultsSummary(template = {}) {
  const defaults = [];
  if (Object.prototype.hasOwnProperty.call(template, "payMethod")) {
    const paymentMethod = text(template.payMethod);
    defaults.push(paymentMethod === "ach" ? "Bank transfer" : paymentMethod === "card" ? "Card" : paymentMethod || "Payment open");
  }
  if (text(template?.taxRegion)) defaults.push(`Tax: ${text(template.taxRegion)}`);
  if (text(template?.seasonProfileId)) defaults.push(`Season: ${text(template.seasonProfileId)}`);
  return defaults.length ? defaults.join(" · ") : "Set for each quote";
}

export function buildEventTemplateObjectPresentation(template = {}, {
  eventTypes = [],
  packages = [],
  warnings = [],
  menuInventoryComplete = false
} = {}) {
  const eventTypeId = text(template?.eventTypeId) || text(template?.id);
  const eventType = uniqueRecords(eventTypes).find((record) => record.id === eventTypeId);
  const offer = uniqueRecords(packages).find((record) => record.id === text(template?.pkg));
  const warningCount = Array.isArray(warnings) ? warnings.length : 0;
  const completeness = warningCount > 0
    ? {
        state: "attention",
        label: `${warningCount} ${warningCount === 1 ? "detail needs" : "details need"} attention`,
        detail: "Resolve the open details before relying on this starting point."
      }
    : menuInventoryComplete
      ? {
          state: "ready",
          label: "Ready to use",
          detail: "Every linked choice in the current Library is available."
        }
      : {
          state: "check",
          label: "Menu check remains",
          detail: "Saved menu choices are preserved until the complete Menu is available to compare."
        };

  return {
    identity: {
      id: text(template?.id),
      name: text(template?.name) || "Untitled starting point"
    },
    completeness,
    groups: {
      startingOffer: offer?.name || (text(template?.pkg) ? "Offer needs attention" : "No offer selected"),
      eventContext: [
        eventType?.name || "Event type needs attention",
        text(template?.style) || "Service style open",
        Number(template?.hours || 0) > 0 ? `${Number(template.hours)} hours` : "Timing open"
      ].join(" · "),
      preselectedComponents: selectionCountLabel(template?.menuItems, "menu item"),
      serviceRentalDefaults: [
        selectionCountLabel(template?.addons, "service"),
        selectionCountLabel(template?.rentals, "rental")
      ].join(" · "),
      staffingResources: staffingResourceSummary(template),
      pricingPolicyDefaults: pricingPolicyDefaultsSummary(template),
      remainsOpen: completeness.label,
      advanced: text(template?.templateVersion || template?.verticalType || template?.provenance?.source)
        ? "Identity and source recorded"
        : "Stable identity"
    }
  };
}

function duplicateTemplateIds(templates) {
  const counts = new Map();
  templates.forEach((template) => {
    const id = text(template?.id);
    if (id) counts.set(id, (counts.get(id) || 0) + 1);
  });
  return new Set([...counts].filter(([, count]) => count > 1).map(([id]) => id));
}

export function EventTemplatesEditor({
  templates = [],
  eventTypes = [],
  packages = [],
  addons = [],
  rentals = [],
  menuItems = [],
  menuSections = [],
  menuInventoryComplete = false,
  onChange,
  focusRequest = null,
  onFocusResolution,
  disabled = false
}) {
  const headingId = useId();
  const styleListId = useId();
  const rootRef = useRef(null);
  const targetRefs = useRef(new Map());
  const handledFocusKeyRef = useRef("");
  const pendingMutationFocusRef = useRef(null);
  const templateList = Array.isArray(templates) ? templates : [];
  const eventTypeRecords = useMemo(() => uniqueRecords(eventTypes), [eventTypes]);
  const packageRecords = useMemo(() => uniqueRecords(packages), [packages]);
  const addonRecords = useMemo(() => uniqueRecords(addons), [addons]);
  const rentalRecords = useMemo(() => uniqueRecords(rentals), [rentals]);
  const menuItemRecords = useMemo(
    () => flattenEventTemplateMenuItems(menuItems, menuSections),
    [menuItems, menuSections]
  );
  const duplicateIds = useMemo(() => duplicateTemplateIds(templateList), [templateList]);
  const [expandedIds, setExpandedIds] = useState(() => new Set(templateList.slice(0, 1).map((item) => text(item?.id))));
  const styles = useMemo(() => [...new Set([
    ...COMMON_EVENT_STYLES,
    ...templateList.map((template) => text(template?.style)).filter(Boolean)
  ])].sort(), [templateList]);
  const lookups = useMemo(() => ({
    eventTypes: new Map(eventTypeRecords.map((record) => [record.id, record])),
    packages: new Map(packageRecords.map((record) => [record.id, record]))
  }), [eventTypeRecords, packageRecords]);

  const registerTarget = (templateId, field, node) => {
    const key = `${templateId}:${field}`;
    if (node) targetRefs.current.set(key, node);
    else targetRefs.current.delete(key);
  };

  const emitChange = (nextTemplates, meta) => {
    if (disabled || typeof onChange !== "function") return;
    onChange(nextTemplates, meta);
  };

  const patchTemplate = (index, patch, field) => {
    const current = templateList[index] || {};
    const next = templateList.map((template, templateIndex) => (
      templateIndex === index ? { ...template, ...patch, id: current.id } : template
    ));
    emitChange(next, { type: "edit", templateId: text(current.id), field });
  };

  const addTemplate = () => {
    if (templateList.length >= 100) return;
    const id = nextEventTemplateId(templateList);
    const nextTemplate = {
      id,
      name: "New template",
      style: "Buffet",
      hours: 4,
      pkg: packageRecords.find((record) => record.active !== false)?.id || "",
      eventTypeId: eventTypeRecords.find((record) => record.active !== false)?.id || "",
      addons: [],
      rentals: [],
      menuItems: [],
      milesRT: 0,
      payMethod: "card",
      taxRegion: "",
      seasonProfileId: "auto"
    };
    setExpandedIds((current) => new Set(current).add(id));
    if (typeof onChange === "function") {
      pendingMutationFocusRef.current = { templateId: id, field: "name" };
    }
    emitChange([...templateList, nextTemplate], { type: "add", templateId: id, field: "name" });
  };

  const removeTemplate = (index) => {
    const templateId = text(templateList[index]?.id);
    const nextTemplates = templateList.filter((_, templateIndex) => templateIndex !== index);
    if (typeof onChange === "function") {
      const adjacentTemplate = nextTemplates[index] || nextTemplates[index - 1];
      pendingMutationFocusRef.current = adjacentTemplate
        ? { templateId: text(adjacentTemplate.id), field: "summary", removedTemplateId: templateId }
        : { templateId: "", field: "add", removedTemplateId: templateId };
    }
    emitChange(nextTemplates, {
      type: "remove",
      templateId
    });
  };

  const toggleExpanded = (templateId) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(templateId)) next.delete(templateId);
      else next.add(templateId);
      return next;
    });
  };

  useEffect(() => {
    const pending = pendingMutationFocusRef.current;
    if (!pending) return undefined;
    if (pending.removedTemplateId
      && templateList.some((template) => text(template?.id) === pending.removedTemplateId)) {
      return undefined;
    }
    const target = targetRefs.current.get(`${pending.templateId}:${pending.field}`);
    if (!target) return undefined;

    const frame = window.requestAnimationFrame(() => {
      target.focus?.({ preventScroll: true });
      target.scrollIntoView?.({ block: "nearest", behavior: "auto" });
      pendingMutationFocusRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [templateList]);

  useEffect(() => {
    const requestId = text(focusRequest?.id || focusRequest?.requestId);
    if (!requestId) return undefined;
    const templateId = text(focusRequest?.templateId);
    const field = text(focusRequest?.field) || (templateId ? "summary" : "add");
    const focusKey = `${requestId}:${templateId}:${field}`;
    if (handledFocusKeyRef.current === focusKey) return undefined;

    const exists = !templateId || templateList.some((template) => text(template?.id) === templateId);
    if (!exists) {
      handledFocusKeyRef.current = focusKey;
      onFocusResolution?.({
        requestId,
        status: "recovery",
        result: "recovery",
        object: { type: "event-template", id: templateId },
        reason: "The requested event template is not available in the current catalog.",
        consequence: "No template field was changed.",
        nextResolutions: ["Review available templates"]
      });
      return undefined;
    }

    if (templateId) {
      setExpandedIds((current) => new Set(current).add(templateId));
    }
    const frame = window.requestAnimationFrame(() => {
      const requestedTarget = targetRefs.current.get(`${templateId}:${field}`);
      const fallbackField = templateId ? "summary" : "add";
      const target = requestedTarget
        || targetRefs.current.get(`${templateId}:${fallbackField}`)
        || rootRef.current;
      const actualField = requestedTarget ? field : fallbackField;
      const disclosure = target?.closest?.("details");
      if (disclosure) disclosure.open = true;
      target?.focus?.({ preventScroll: true });
      target?.scrollIntoView?.({ block: "nearest", behavior: "auto" });
      handledFocusKeyRef.current = focusKey;
      onFocusResolution?.({
        requestId,
        status: "focused",
        result: "context",
        object: templateId
          ? { type: "event-template", id: templateId, field: actualField }
          : { type: "event-template-collection", id: "event-templates", field: "add" },
        reason: requestedTarget
          ? text(focusRequest?.reason) || "Opened the exact event template control requested."
          : `The requested ${templateFieldLabel(field)} control is unavailable; opened the ${templateFieldLabel(actualField)} instead.`,
        consequence: "Changes remain a draft until the catalog is saved.",
        nextResolutions: [templateId ? "Update the starting point" : "Add a template", "Save Library changes"]
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusRequest, onFocusResolution, templateList]);

  return (
    <section
      className="event-templates-editor"
      data-ambient-surface="event-templates-editor"
      data-disabled={disabled ? "true" : "false"}
      aria-labelledby={headingId}
      ref={rootRef}
    >
      <header className="event-templates-editor__head">
        <div>
          <p className="event-templates-editor__eyebrow">Templates</p>
          <h2 id={headingId}>Quote starting points</h2>
          <p>Start new quotes with a proven offer, service style, timing, and included components. Staff can still adjust every quote.</p>
        </div>
        <button
          type="button"
          className="event-templates-editor__add"
          data-template-action="add"
          onClick={addTemplate}
          disabled={disabled || templateList.length >= 100}
          ref={(node) => registerTarget("", "add", node)}
        >
          <Plus aria-hidden="true" weight="bold" />
          Add template
        </button>
      </header>

      {templateList.length >= 100 && (
        <p className="event-templates-editor__limit" role="status" data-template-state="limit-reached">
          This catalog has reached its 100-template limit. Remove an unused template before adding another.
        </p>
      )}

      <datalist id={styleListId}>
        {styles.map((style) => <option key={style} value={style} />)}
      </datalist>

      {templateList.length === 0 ? (
        <div className="event-templates-editor__empty" data-template-state="empty">
          <h3>No quote starting points yet</h3>
          <p>Add one to connect an event type with an offer and its usual components.</p>
          <button type="button" onClick={addTemplate} disabled={disabled} data-template-action="add-empty">
            <Plus aria-hidden="true" weight="bold" />
            Add the first template
          </button>
        </div>
      ) : (
        <ol className="event-templates-editor__list">
          {templateList.map((template, index) => {
            const templateId = text(template?.id);
            const panelId = `${headingId}-template-${index}`;
            const expanded = expandedIds.has(templateId);
            const warnings = buildEventTemplateWarnings(template, {
              eventTypes: eventTypeRecords,
              packages: packageRecords,
              addons: addonRecords,
              rentals: rentalRecords,
              menuItems: menuItemRecords,
              menuInventoryComplete,
              duplicateIds
            });
            const resolvedEventTypeId = text(template?.eventTypeId) || templateId;
            const presentation = buildEventTemplateObjectPresentation(template, {
              eventTypes: eventTypeRecords,
              packages: packageRecords,
              warnings,
              menuInventoryComplete
            });
            const supportedStaffingFields = [
              ["servers", "Servers"],
              ["chefs", "Chefs"],
              ["bartenders", "Bartenders"]
            ].filter(([field]) => Object.prototype.hasOwnProperty.call(template || {}, field));
            const supportedStaffingPolicyFields = [
              ["staffingRateTypeId", "Staffing rate policy"],
              ["bartenderRateTypeId", "Bartender rate policy"]
            ].filter(([field]) => Object.prototype.hasOwnProperty.call(template || {}, field));
            const supportedPricingPolicyFields = ["payMethod", "taxRegion", "seasonProfileId"]
              .filter((field) => Object.prototype.hasOwnProperty.call(template || {}, field));
            const provenanceEntries = [
              ["Template version", text(template?.templateVersion)],
              ["Business type", text(template?.verticalType)],
              ["Source", text(template?.provenance?.source)],
              ["Setup option", text(template?.provenance?.starterPackId || template?.starterPackId)]
            ].filter(([, value]) => value);

            return (
              <li
                key={`${templateId || "template"}-${index}`}
                className="event-templates-editor__item"
                data-template-id={templateId}
                data-library-record-kind="event-template"
                data-library-record-id={templateId}
                data-template-warning-count={warnings.length}
              >
                <div className="event-templates-editor__item-head">
                  <button
                    type="button"
                    className="event-templates-editor__summary"
                    data-template-action="toggle"
                    data-template-field="summary"
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    onClick={() => toggleExpanded(templateId)}
                    ref={(node) => registerTarget(templateId, "summary", node)}
                  >
                    <span className="event-templates-editor__index" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span>
                      <strong>{text(template?.name) || "Untitled template"}</strong>
                      <small>{templateSummary(template, lookups)}</small>
                    </span>
                  </button>
                  <span
                    className="event-templates-editor__warning-count"
                    data-template-completeness-summary={presentation.completeness.state}
                  >
                    {warnings.length > 0 && <WarningCircle aria-hidden="true" weight="fill" />}
                    {presentation.completeness.label}
                  </span>
                  <button
                    type="button"
                    className="event-templates-editor__remove"
                    data-template-action="remove"
                    data-template-field="remove"
                    aria-label={`Remove ${text(template?.name) || `template ${index + 1}`}`}
                    onClick={() => removeTemplate(index)}
                    disabled={disabled}
                    ref={(node) => registerTarget(templateId, "remove", node)}
                  >
                    <TrashSimple aria-hidden="true" />
                  </button>
                </div>

                <div id={panelId} className="event-templates-editor__panel" hidden={!expanded}>
                  <section
                    className="event-templates-editor__object-identity"
                    data-template-object-section="identity"
                    aria-label={`${presentation.identity.name} identity and completeness`}
                  >
                    <div className="event-templates-editor__identity-grid">
                      <label>
                        Template name
                        <input
                          type="text"
                          value={template?.name || ""}
                          onChange={(event) => patchTemplate(index, { name: event.target.value }, "name")}
                          disabled={disabled}
                          data-template-field="name"
                          ref={(node) => registerTarget(templateId, "name", node)}
                        />
                      </label>
                      <div
                        className="event-templates-editor__completeness"
                        data-template-completeness={presentation.completeness.state}
                      >
                        <span>Completeness</span>
                        <strong>{presentation.completeness.label}</strong>
                        <small>{presentation.completeness.detail}</small>
                      </div>
                    </div>
                  </section>

                  <div className="event-templates-editor__object-groups" data-template-group-flow="nested">
                    <details className="event-templates-editor__object-group" data-template-group="starting-offer">
                      <summary>
                        <span><strong>Starting Offer</strong><small>{presentation.groups.startingOffer}</small></span>
                      </summary>
                      <div className="event-templates-editor__object-group-body event-templates-editor__identity-grid">
                        <TemplateChoiceField
                          templateId={templateId}
                          field="pkg"
                          label="Starting offer"
                          records={packageRecords}
                          currentId={text(template?.pkg)}
                          placeholder="Choose an offer"
                          disabled={disabled}
                          onSelect={(value) => patchTemplate(index, { pkg: value }, "pkg")}
                          registerTarget={registerTarget}
                        />
                      </div>
                    </details>

                    <details className="event-templates-editor__object-group" data-template-group="event-context">
                      <summary>
                        <span><strong>Event context</strong><small>{presentation.groups.eventContext}</small></span>
                      </summary>
                      <div className="event-templates-editor__object-group-body event-templates-editor__identity-grid">
                        <TemplateChoiceField
                          templateId={templateId}
                          field="eventTypeId"
                          label="Event type"
                          records={eventTypeRecords}
                          currentId={resolvedEventTypeId}
                          placeholder="Choose an event type"
                          disabled={disabled}
                          onSelect={(value) => patchTemplate(index, { eventTypeId: value }, "eventTypeId")}
                          registerTarget={registerTarget}
                        />
                        <label>
                          Service style
                          <input
                            type="text"
                            value={template?.style || ""}
                            list={styleListId}
                            onChange={(event) => patchTemplate(index, { style: event.target.value }, "style")}
                            disabled={disabled}
                            data-template-field="style"
                            ref={(node) => registerTarget(templateId, "style", node)}
                          />
                        </label>
                        <label>
                          Event hours
                          <input
                            type="number"
                            min="1"
                            max="12"
                            step="0.5"
                            value={template?.hours ?? 4}
                            onChange={(event) => patchTemplate(index, { hours: Number(event.target.value) }, "hours")}
                            disabled={disabled}
                            data-template-field="hours"
                            ref={(node) => registerTarget(templateId, "hours", node)}
                          />
                        </label>
                      </div>
                    </details>

                    <details className="event-templates-editor__object-group" data-template-group="preselected-components">
                      <summary>
                        <span><strong>Preselected components</strong><small>{presentation.groups.preselectedComponents}</small></span>
                      </summary>
                      <div className="event-templates-editor__object-group-body event-templates-editor__dependency-grid event-templates-editor__dependency-grid--single">
                        <DependencyPicker
                          templateId={templateId}
                          kind="menuItems"
                          label="Included menu items"
                          records={menuItemRecords}
                          selectedIds={template?.menuItems}
                          eventTypeId={resolvedEventTypeId}
                          inventoryComplete={menuInventoryComplete}
                          disabled={disabled}
                          onChange={(menuItemsValue) => patchTemplate(index, { menuItems: menuItemsValue }, "menuItems")}
                          registerTarget={registerTarget}
                        />
                      </div>
                    </details>

                    <details className="event-templates-editor__object-group" data-template-group="service-rental-defaults">
                      <summary>
                        <span><strong>Service and rental defaults</strong><small>{presentation.groups.serviceRentalDefaults}</small></span>
                      </summary>
                      <div className="event-templates-editor__object-group-body event-templates-editor__dependency-grid event-templates-editor__dependency-grid--paired">
                        <DependencyPicker
                          templateId={templateId}
                          kind="addons"
                          label="Included add-ons"
                          records={addonRecords}
                          selectedIds={template?.addons}
                          disabled={disabled}
                          onChange={(addonsValue) => patchTemplate(index, { addons: addonsValue }, "addons")}
                          registerTarget={registerTarget}
                        />
                        <DependencyPicker
                          templateId={templateId}
                          kind="rentals"
                          label="Included rentals"
                          records={rentalRecords}
                          selectedIds={template?.rentals}
                          disabled={disabled}
                          onChange={(rentalsValue) => patchTemplate(index, { rentals: rentalsValue }, "rentals")}
                          registerTarget={registerTarget}
                        />
                      </div>
                    </details>

                    <details className="event-templates-editor__object-group" data-template-group="staffing-resource-defaults">
                      <summary>
                        <span><strong>Staffing and resource defaults</strong><small>{presentation.groups.staffingResources}</small></span>
                      </summary>
                      <div className="event-templates-editor__object-group-body event-templates-editor__identity-grid">
                        {supportedStaffingFields.map(([field, label]) => (
                          <label key={field}>
                            {label}
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={template?.[field] ?? 0}
                              onChange={(event) => patchTemplate(index, { [field]: Number(event.target.value) }, field)}
                              disabled={disabled}
                              data-template-field={field}
                              ref={(node) => registerTarget(templateId, field, node)}
                            />
                          </label>
                        ))}
                        {Object.prototype.hasOwnProperty.call(template || {}, "milesRT") && (
                          <label>
                            Round-trip travel miles
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={template?.milesRT ?? 0}
                              onChange={(event) => patchTemplate(index, { milesRT: Number(event.target.value) }, "milesRT")}
                              disabled={disabled}
                              data-template-field="milesRT"
                              ref={(node) => registerTarget(templateId, "milesRT", node)}
                            />
                          </label>
                        )}
                        {supportedStaffingPolicyFields.map(([field, label]) => (
                          <label key={field}>
                            {label}
                            <input
                              type="text"
                              value={template?.[field] || ""}
                              onChange={(event) => patchTemplate(index, { [field]: event.target.value }, field)}
                              disabled={disabled}
                              data-template-field={field}
                              ref={(node) => registerTarget(templateId, field, node)}
                            />
                          </label>
                        ))}
                        {supportedStaffingFields.length === 0
                          && supportedStaffingPolicyFields.length === 0
                          && !Object.prototype.hasOwnProperty.call(template || {}, "milesRT") && (
                            <p className="event-templates-editor__empty-note">Staffing and travel stay open for each quote.</p>
                          )}
                      </div>
                    </details>

                    <details className="event-templates-editor__object-group" data-template-group="pricing-policy-defaults">
                      <summary>
                        <span><strong>Pricing and policy defaults</strong><small>{presentation.groups.pricingPolicyDefaults}</small></span>
                      </summary>
                      <div className="event-templates-editor__object-group-body event-templates-editor__identity-grid">
                        {supportedPricingPolicyFields.includes("payMethod") && (
                          <label>
                            Preferred payment method
                            <select
                              value={text(template?.payMethod) || "card"}
                              onChange={(event) => patchTemplate(index, { payMethod: event.target.value }, "payMethod")}
                              disabled={disabled}
                              data-template-field="payMethod"
                              ref={(node) => registerTarget(templateId, "payMethod", node)}
                            >
                              <option value="card">Card</option>
                              <option value="ach">Bank transfer</option>
                            </select>
                          </label>
                        )}
                        {supportedPricingPolicyFields.includes("taxRegion") && (
                          <label>
                            Tax region
                            <input
                              type="text"
                              value={template?.taxRegion || ""}
                              onChange={(event) => patchTemplate(index, { taxRegion: event.target.value }, "taxRegion")}
                              disabled={disabled}
                              data-template-field="taxRegion"
                              ref={(node) => registerTarget(templateId, "taxRegion", node)}
                            />
                          </label>
                        )}
                        {supportedPricingPolicyFields.includes("seasonProfileId") && (
                          <label>
                            Seasonal pricing profile
                            <input
                              type="text"
                              value={template?.seasonProfileId || ""}
                              onChange={(event) => patchTemplate(index, { seasonProfileId: event.target.value }, "seasonProfileId")}
                              disabled={disabled}
                              data-template-field="seasonProfileId"
                              ref={(node) => registerTarget(templateId, "seasonProfileId", node)}
                            />
                          </label>
                        )}
                        {supportedPricingPolicyFields.length === 0 && (
                          <p className="event-templates-editor__empty-note">Pricing and payment choices stay open for each quote.</p>
                        )}
                      </div>
                    </details>

                    <details className="event-templates-editor__object-group" data-template-group="remains-open">
                      <summary>
                        <span><strong>What remains open</strong><small>{presentation.groups.remainsOpen}</small></span>
                      </summary>
                      <div className="event-templates-editor__object-group-body">
                        <div
                          className="event-templates-editor__warnings"
                          data-template-state={warnings.length ? "needs-attention" : menuInventoryComplete ? "ready" : "needs-check"}
                          aria-live="polite"
                        >
                          {warnings.length ? (
                            <>
                              <h4><WarningCircle aria-hidden="true" weight="fill" /> Resolve these details</h4>
                              <ul>
                                {warnings.map((warning, warningIndex) => (
                                  <li
                                    key={`${warning.code}-${warning.dependencyId || warningIndex}`}
                                    data-template-warning-code={warning.code}
                                  >
                                    {warning.message}
                                  </li>
                                ))}
                              </ul>
                            </>
                          ) : (
                            <p>{presentation.completeness.detail}</p>
                          )}
                        </div>
                      </div>
                    </details>

                    <details className="event-templates-editor__object-group event-templates-editor__object-group--advanced" data-template-group="advanced">
                      <summary>
                        <span><strong>Advanced identity and source</strong><small>{presentation.groups.advanced}</small></span>
                      </summary>
                      <div className="event-templates-editor__object-group-body">
                        <div className="event-templates-editor__identity-grid">
                          <label>
                            Stable ID
                            <input
                              type="text"
                              value={templateId}
                              readOnly
                              aria-readonly="true"
                              data-template-field="id"
                              ref={(node) => registerTarget(templateId, "id", node)}
                            />
                            <small>This identity stays fixed so saved quotes keep their reference.</small>
                          </label>
                        </div>
                        {provenanceEntries.length > 0 && (
                          <dl className="event-templates-editor__provenance">
                            {provenanceEntries.map(([label, value]) => (
                              <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
                            ))}
                          </dl>
                        )}
                      </div>
                    </details>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export default EventTemplatesEditor;
