import { useEffect, useId, useMemo, useRef, useState } from "react";
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
    warnings.push({ code: "missing-package", message: "Choose the package this template starts with." });
  } else if (!selectedPackage) {
    warnings.push({ code: "missing-package", message: `Package ${packageId} is not available.` });
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
  const packageName = lookups.packages.get(text(template?.pkg))?.name || "No package";
  const eventTypeId = text(template?.eventTypeId) || text(template?.id);
  const eventTypeName = lookups.eventTypes.get(eventTypeId)?.name || "Event type needs review";
  return `${eventTypeName} · ${packageName} · ${Number(template?.hours || 0) || 0} hours`;
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
    emitChange([...templateList, nextTemplate], { type: "add", templateId: id, field: "name" });
  };

  const removeTemplate = (index) => {
    const templateId = text(templateList[index]?.id);
    emitChange(templateList.filter((_, templateIndex) => templateIndex !== index), {
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
      const target = targetRefs.current.get(`${templateId}:${field}`)
        || targetRefs.current.get(`${templateId}:summary`)
        || targetRefs.current.get(":add")
        || rootRef.current;
      target?.focus?.({ preventScroll: true });
      target?.scrollIntoView?.({ block: "nearest", behavior: "auto" });
      handledFocusKeyRef.current = focusKey;
      onFocusResolution?.({
        requestId,
        status: "focused",
        result: "context",
        object: templateId
          ? { type: "event-template", id: templateId, field }
          : { type: "event-template-collection", id: "event-templates", field: "add" },
        reason: text(focusRequest?.reason) || "Opened the exact event template control requested.",
        consequence: "Changes remain a draft until the catalog is saved.",
        nextResolutions: [templateId ? "Review or update the template" : "Add a template", "Save catalog changes"]
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
          <p className="event-templates-editor__eyebrow">Starting points</p>
          <h2 id={headingId}>Event templates</h2>
          <p>Set a thoughtful starting shape for each kind of event. Staff can still adjust every quote.</p>
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
          <h3>No event templates yet</h3>
          <p>Add one to give new quotes a useful, adjustable starting point.</p>
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
            const eventTypeChoices = includeUnavailableChoice(eventTypeRecords, resolvedEventTypeId, "event type");
            const packageChoices = includeUnavailableChoice(packageRecords, template?.pkg, "package");

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
                  {warnings.length > 0 && (
                    <span className="event-templates-editor__warning-count">
                      <WarningCircle aria-hidden="true" weight="fill" />
                      {warnings.length} {warnings.length === 1 ? "item" : "items"} to review
                    </span>
                  )}
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
                    <label>
                      Event type
                      <select
                        value={resolvedEventTypeId}
                        onChange={(event) => patchTemplate(index, { eventTypeId: event.target.value }, "eventTypeId")}
                        disabled={disabled}
                        data-template-field="eventTypeId"
                        ref={(node) => registerTarget(templateId, "eventTypeId", node)}
                      >
                        <option value="">Choose an event type</option>
                        {eventTypeChoices.map((record) => (
                          <option
                            key={record.id}
                            value={record.id}
                            disabled={record.active === false && record.id !== resolvedEventTypeId}
                          >
                            {record.name}{record.active === false && !record.unavailable ? " (inactive)" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Starting package
                      <select
                        value={text(template?.pkg)}
                        onChange={(event) => patchTemplate(index, { pkg: event.target.value }, "pkg")}
                        disabled={disabled}
                        data-template-field="pkg"
                        ref={(node) => registerTarget(templateId, "pkg", node)}
                      >
                        <option value="">Choose a package</option>
                        {packageChoices.map((record) => (
                          <option
                            key={record.id}
                            value={record.id}
                            disabled={record.active === false && record.id !== text(template?.pkg)}
                          >
                            {record.name}{record.active === false && !record.unavailable ? " (inactive)" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="event-templates-editor__dependency-grid">
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

                  <div
                    className="event-templates-editor__warnings"
                    data-template-state={warnings.length ? "needs-review" : "ready"}
                    aria-live="polite"
                  >
                    {warnings.length ? (
                      <>
                        <h4><WarningCircle aria-hidden="true" weight="fill" /> Review linked details</h4>
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
                      <p>
                        {menuInventoryComplete
                          ? "Everything selected here is available."
                          : "The loaded selections still line up. Saved menu choices are preserved and still need a current menu review."}
                      </p>
                    )}
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
