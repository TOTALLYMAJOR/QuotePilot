import { useEffect, useRef, useState } from "react";
import StatusChip from "./StatusChip";
import { STATUS_FAMILY } from "../lib/statusSemantics";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const percentFormatter = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});

const INCLUSION_GROUPS = [
  {
    id: "menu",
    field: "includedMenuItemIds",
    modelKey: "menuItems",
    label: "Menu items",
    singularLabel: "menu item",
    pickerEmptyLabel: "Choose a menu event type to browse menu items.",
    searchLabel: "Search menu items",
    triggerLabel: "Add menu items"
  },
  {
    id: "addons",
    field: "includedAddonIds",
    modelKey: "addons",
    label: "Add-ons",
    singularLabel: "add-on",
    pickerEmptyLabel: "No active add-ons are available.",
    searchLabel: "Search add-ons",
    triggerLabel: "Add add-ons"
  },
  {
    id: "rentals",
    field: "includedRentalIds",
    modelKey: "rentals",
    label: "Rentals",
    singularLabel: "rental",
    pickerEmptyLabel: "No active rentals are available.",
    searchLabel: "Search rentals",
    triggerLabel: "Add rentals"
  }
];

function text(value) {
  return String(value ?? "").trim();
}

function normalizeIdList(value) {
  return (Array.isArray(value) ? value : []).map((entry) => text(entry));
}

function normalizePackageForComparison(packageRecord = null) {
  if (!packageRecord) return null;
  return {
    id: text(packageRecord.id),
    name: text(packageRecord.name),
    ppp: Number(packageRecord.ppp || 0),
    costPpp: packageRecord.costPpp === "" || packageRecord.costPpp === undefined
      ? null
      : packageRecord.costPpp,
    active: packageRecord.active !== false,
    includedMenuItemIds: normalizeIdList(packageRecord.includedMenuItemIds),
    includedAddonIds: normalizeIdList(packageRecord.includedAddonIds),
    includedRentalIds: normalizeIdList(packageRecord.includedRentalIds)
  };
}

export function isPackageWorkspaceRowDirty(savedPackage = null, draftPackage = null) {
  return JSON.stringify(normalizePackageForComparison(savedPackage))
    !== JSON.stringify(normalizePackageForComparison(draftPackage));
}

function formatCurrency(value, fallback = "Unavailable") {
  if (value === null || value === undefined || value === "") return fallback;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return fallback;
  return currencyFormatter.format(amount);
}

function formatPercent(value, fallback = "Unavailable") {
  if (value === null || value === undefined || value === "") return fallback;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return fallback;
  return percentFormatter.format(amount);
}

function countLabel(count, singularLabel, pluralLabel = `${singularLabel}s`) {
  return `${count} ${count === 1 ? singularLabel : pluralLabel}`;
}

function packageReadinessPresentation(readiness) {
  if (readiness === "ready") {
    return { family: STATUS_FAMILY.CONFIRMED, label: "Ready" };
  }
  if (readiness === "needs_review") {
    return { family: STATUS_FAMILY.PENDING, label: "Needs review" };
  }
  return { family: STATUS_FAMILY.BLOCKED, label: "Incomplete" };
}

function packageLifecyclePresentation(packageModel) {
  if (packageModel?.active === true) {
    return { family: STATUS_FAMILY.CONFIRMED, label: "Active" };
  }
  return { family: STATUS_FAMILY.ARCHIVED, label: "Draft only" };
}

function referencePresentation(reference = {}) {
  if (reference.status === "ok") {
    return { family: STATUS_FAMILY.CONFIRMED, label: "Included" };
  }
  if (reference.status === "inactive") {
    return { family: STATUS_FAMILY.PENDING, label: "Inactive" };
  }
  if (reference.status === "missing") {
    return { family: STATUS_FAMILY.BLOCKED, label: "Missing" };
  }
  return { family: STATUS_FAMILY.BLOCKED, label: "Invalid" };
}

function findPackageById(packages = [], packageId = "") {
  const id = text(packageId);
  return (Array.isArray(packages) ? packages : []).find((item) => text(item?.id) === id) || null;
}

function findPackageIndex(packages = [], packageId = "") {
  const id = text(packageId);
  return (Array.isArray(packages) ? packages : []).findIndex((item) => text(item?.id) === id);
}

function optionMatchesQuery(option, query) {
  if (!query) return true;
  const haystack = `${text(option?.name)} ${text(option?.id)} ${text(option?.categoryName)} ${text(option?.categoryId)}`.toLowerCase();
  return haystack.includes(query);
}

function pricingTypeLabel(value) {
  const normalized = text(value).toLowerCase();
  if (normalized === "per_person") return "Per person";
  if (normalized === "per_item") return "Per item";
  if (normalized === "per_event") return "Per event";
  return "";
}

function optionCategoryLabel(option, group, menuCategoryLookup) {
  if (group.id === "menu") {
    const categoryId = text(option?.categoryId);
    return text(option?.categoryName)
      || text(menuCategoryLookup.get(categoryId))
      || categoryId
      || "Other menu items";
  }
  return text(option?.categoryName)
    || text(option?.category)
    || pricingTypeLabel(option?.pricingType || option?.type)
    || group.label;
}

function uniqueIds(value) {
  return [...new Set(normalizeIdList(value).filter(Boolean))].slice(0, 100);
}

function describeReference(reference = {}) {
  if (reference.issue === "blank") return "Blank inclusion";
  return text(reference.label) || text(reference.id) || "Unnamed inclusion";
}

export default function PackageWorkspace({
  workspace,
  draftCatalog,
  savedCatalog,
  selectedPackageId,
  onSelectPackage,
  onAddPackage,
  onDeletePackage,
  onRevertPackage,
  onPatchPackageField,
  onReplacePackageInclusionIds,
  menuItems,
  menuEventTypes,
  menuCategories = [],
  selectedEventType,
  onSelectEventType,
  menuLoading,
  marginsEnabled,
  packageDeletionSummary = { available: true, eventTemplateCount: 0, ruleCount: 0 }
}) {
  const [expandedGroupId, setExpandedGroupId] = useState("");
  const [searchByGroup, setSearchByGroup] = useState({});
  const [categoryByGroup, setCategoryByGroup] = useState({});
  const [pickerSelections, setPickerSelections] = useState({});
  const [pickerStatus, setPickerStatus] = useState("");
  const [activationNotice, setActivationNotice] = useState("");
  const [actionsOpen, setActionsOpen] = useState(false);
  const [deleteReviewOpen, setDeleteReviewOpen] = useState(false);
  const rootRef = useRef(null);
  const selectedPackageModel = workspace?.selectedPackage || null;
  const selectedPackageRecord = findPackageById(draftCatalog?.packages, selectedPackageId);
  const selectedPackageIndex = findPackageIndex(draftCatalog?.packages, selectedPackageId);
  const savedPackageRecord = findPackageById(savedCatalog?.packages, selectedPackageId);
  const selectedPackageDirty = isPackageWorkspaceRowDirty(savedPackageRecord, selectedPackageRecord);

  useEffect(() => {
    setExpandedGroupId("");
    setSearchByGroup({});
    setCategoryByGroup({});
    setPickerSelections({});
    setPickerStatus("");
    setActivationNotice("");
    setActionsOpen(false);
    setDeleteReviewOpen(false);
  }, [selectedPackageId]);

  useEffect(() => {
    if (!expandedGroupId || typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      rootRef.current
        ?.querySelector(`[data-package-picker="${expandedGroupId}"] input[type="search"]`)
        ?.focus({ preventScroll: true });
    });
  }, [expandedGroupId]);

  useEffect(() => {
    const activationBlockIsResolved = selectedPackageModel?.readiness === "ready"
      || selectedPackageRecord?.active !== false;
    if (activationBlockIsResolved && activationNotice.startsWith("Activation is blocked")) {
      setActivationNotice("");
    }
  }, [activationNotice, selectedPackageModel?.readiness, selectedPackageRecord?.active]);

  const focusField = (selector, afterFocus) => {
    if (typeof afterFocus === "function") {
      afterFocus();
    }
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      const target = rootRef.current?.querySelector(selector);
      target?.focus?.({ preventScroll: true });
      target?.scrollIntoView?.({ block: "nearest", behavior: "auto" });
    });
  };

  const handleReasonAction = (reason = {}) => {
    if (reason?.targetSection === "includes") {
      const priorityGroup = INCLUSION_GROUPS.find((group) => (
        (selectedPackageModel?.referenceHealth?.[group.modelKey] || []).some((reference) => reference.status !== "ok")
      )) || INCLUSION_GROUPS[0];
      openPicker(priorityGroup);
      return;
    }
    if (reason?.targetField === "name") {
      focusField('[data-package-field="name"]');
      return;
    }
    if (reason?.targetField === "ppp") {
      focusField('[data-package-field="ppp"]');
      return;
    }
    if (reason?.targetField === "costPpp") {
      focusField('[data-package-field="costPpp"]');
      return;
    }
    focusField('[data-package-field="name"]');
  };

  const selectPackage = (packageId) => {
    const id = text(packageId);
    if (!id || id === selectedPackageId) return;
    onSelectPackage(id);
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      rootRef.current?.querySelector("[data-package-workspace-heading]")?.focus({ preventScroll: true });
    });
  };

  const openPicker = (group) => {
    setPickerSelections((current) => ({
      ...current,
      [group.id]: uniqueIds(selectedPackageRecord?.[group.field])
    }));
    setSearchByGroup((current) => ({ ...current, [group.id]: "" }));
    setCategoryByGroup((current) => ({ ...current, [group.id]: "" }));
    setPickerStatus("");
    setExpandedGroupId(group.id);
  };

  const closePicker = (groupId, { restoreFocus = true } = {}) => {
    setExpandedGroupId("");
    if (!restoreFocus || typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      rootRef.current?.querySelector(`[data-package-group-toggle="${groupId}"]`)?.focus({ preventScroll: true });
    });
  };

  const handlePickerKeyDown = (event, groupId) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closePicker(groupId);
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...event.currentTarget.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter((element) => element.getClientRects().length > 0);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const removeReference = (field, reference) => {
    const currentIds = [...(Array.isArray(selectedPackageRecord?.[field]) ? selectedPackageRecord[field] : [])];
    const targetId = text(reference?.id);
    const nextIds = [...currentIds];
    if (targetId) {
      const filtered = nextIds.filter((entry) => text(entry) !== targetId);
      onReplacePackageInclusionIds(selectedPackageId, field, filtered);
      return;
    }
    const blankIndex = nextIds.findIndex((entry) => text(entry) === "");
    if (blankIndex >= 0) {
      nextIds.splice(blankIndex, 1);
      onReplacePackageInclusionIds(selectedPackageId, field, nextIds);
    }
  };

  const togglePickerSelection = (groupId, itemId, checked) => {
    const id = text(itemId);
    if (!id) return;
    setPickerSelections((current) => {
      const nextIds = new Set(uniqueIds(current[groupId]));
      if (checked) nextIds.add(id);
      else nextIds.delete(id);
      return { ...current, [groupId]: [...nextIds].slice(0, 100) };
    });
  };

  const applyPickerSelection = (group) => {
    const nextIds = uniqueIds(pickerSelections[group.id]);
    onReplacePackageInclusionIds(selectedPackageId, group.field, nextIds);
    setPickerStatus(`${group.label}: ${countLabel(nextIds.length, group.singularLabel)} staged in this package draft.`);
    closePicker(group.id);
  };

  const handleActiveChange = (nextActive) => {
    if (nextActive && selectedPackageModel?.readiness !== "ready") {
      const firstReason = selectedPackageModel?.reasons?.[0];
      setActivationNotice(
        `Activation is blocked until this package is ready. ${firstReason?.title || "Review the package health items first."}`
      );
      if (typeof window !== "undefined") {
        window.requestAnimationFrame(() => {
          rootRef.current?.querySelector("[data-package-health]")?.focus({ preventScroll: true });
        });
      }
      return;
    }
    setActivationNotice(nextActive
      ? "This package is staged to become available in Quote Builder after the catalog is saved."
      : "This package is staged as draft-only after the catalog is saved.");
    onPatchPackageField(selectedPackageId, "active", nextActive);
  };

  if (!workspace || workspace.packageIds.length === 0) {
    return (
      <section className="admin-section package-workspace-section">
        <div className="admin-section-head package-workspace-head">
          <div>
            <h3>Packages</h3>
            <p className="source-note">
              Define what each package promises, what it includes at $0 when selected, and whether it is commercially ready before sales uses it.
            </p>
          </div>
          <button type="button" className="ghost" onClick={onAddPackage}>Add</button>
        </div>
        <div className="package-workspace-empty">
          <h4>No packages yet</h4>
          <p>Create your first package to define a customer-facing promise, record its price, and choose what Quote Builder may include at no added charge.</p>
          <button type="button" className="cta" onClick={onAddPackage}>Add first package</button>
        </div>
      </section>
    );
  }

  const readiness = packageReadinessPresentation(selectedPackageModel?.readiness);
  const lifecycle = packageLifecyclePresentation(selectedPackageModel?.package);
  const commercialSummary = selectedPackageModel?.commercialSummary || {};
  const contributionLabel = commercialSummary.contributionPerPerson === null
    ? "Unavailable"
    : formatCurrency(commercialSummary.contributionPerPerson);
  const selectedCountLabel = countLabel(
    commercialSummary.includedCounts?.total || 0,
    "included item"
  );
  const renderHealthContent = (headingId) => (
    <div className="package-workspace-card package-workspace-health-card" data-package-health tabIndex="-1">
      <div className="package-workspace-card-head">
        <div>
          <p className="package-workspace-kicker">Package health</p>
          <h4 id={headingId}>Next action</h4>
        </div>
        <StatusChip family={readiness.family} label={readiness.label} />
      </div>
      {selectedPackageModel?.nextAction ? (
        <button
          type="button"
          className="cta package-workspace-next-action"
          onClick={() => handleReasonAction(selectedPackageModel.nextAction)}
        >
          {selectedPackageModel.nextAction.label}
        </button>
      ) : (
        <p className="package-workspace-health-clear">This package is ready for quoting on the current catalog revision.</p>
      )}
      {selectedPackageModel?.reasons?.length > 0 && (
        <ol className="package-workspace-reason-list">
          {selectedPackageModel.reasons.map((reason) => (
            <li key={reason.code}>
              <div>
                <strong>{reason.title}</strong>
                <p>{reason.detail}</p>
              </div>
              <button type="button" className="ghost" onClick={() => handleReasonAction(reason)}>
                {reason.actionLabel}
              </button>
            </li>
          ))}
        </ol>
      )}
      <dl className="package-workspace-evidence-list">
        <div>
          <dt>Catalog revision</dt>
          <dd>{selectedPackageModel?.evidence?.catalogRevision ?? "Unavailable"}</dd>
        </div>
        <div>
          <dt>Pricing confirmation</dt>
          <dd>{selectedPackageModel?.evidence?.pricingConfirmationCurrent ? "Current" : "Needs confirmation"}</dd>
        </div>
        <div>
          <dt>Selected at $0</dt>
          <dd>Yes, when sales explicitly chooses an included item.</dd>
        </div>
      </dl>
    </div>
  );

  return (
    <section ref={rootRef} className="admin-section package-workspace-section" data-package-workspace="true">
      <div className="admin-section-head package-workspace-head">
        <div>
          <h3>Packages</h3>
          <p className="source-note">
            Review one package at a time, keep current inclusions visible before edit controls, and save the whole catalog only when this draft is ready.
          </p>
        </div>
        <div className="package-workspace-head-actions">
          {selectedPackageDirty && (
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setActivationNotice("");
                setPickerStatus("");
                setExpandedGroupId("");
                onRevertPackage(selectedPackageId);
              }}
            >Revert this package</button>
          )}
          <div className="package-workspace-actions-menu">
            <button
              type="button"
              className="ghost"
              aria-haspopup="menu"
              aria-expanded={actionsOpen}
              onClick={() => setActionsOpen((current) => !current)}
            >Package actions</button>
            {actionsOpen && (
              <div
                className="package-workspace-actions-popover"
                role="menu"
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setActionsOpen(false);
                  }
                }}
              >
                <button
                  type="button"
                  role="menuitem"
                  className="ghost danger"
                  onClick={() => {
                    setActionsOpen(false);
                    setDeleteReviewOpen(true);
                  }}
                >Delete package…</button>
              </div>
            )}
          </div>
          <button type="button" className="ghost" onClick={onAddPackage}>Add package</button>
        </div>
      </div>

      {deleteReviewOpen && (
        <section
          className="package-workspace-delete-review"
          role="alertdialog"
          aria-labelledby="package-delete-review-title"
          aria-describedby="package-delete-review-description"
        >
          <div>
            <p className="package-workspace-kicker">Destructive catalog change</p>
            <h4 id="package-delete-review-title">Delete {selectedPackageModel?.package?.displayName || "this package"}?</h4>
            <p id="package-delete-review-description">
              {packageDeletionSummary.available === false
                ? "Dependency review is unavailable until the Event Templates draft is valid. Nothing has been deleted."
                : `${countLabel(packageDeletionSummary.eventTemplateCount || 0, "event template")} and ${countLabel(packageDeletionSummary.ruleCount || 0, "recommendation rule")} currently reference this package. Saving will remove those catalog references; existing saved quotes stay unchanged.`}
            </p>
          </div>
          <div className="package-workspace-delete-actions">
            <button type="button" className="ghost" onClick={() => setDeleteReviewOpen(false)}>Keep package</button>
            <button
              type="button"
              className="ghost danger"
              disabled={packageDeletionSummary.available === false}
              onClick={() => {
                setDeleteReviewOpen(false);
                onDeletePackage(selectedPackageId);
              }}
            >Delete from draft</button>
          </div>
        </section>
      )}

      <div className="package-workspace-shell">
        <aside className="package-workspace-nav" aria-label="Package list">
          <div className="package-workspace-nav-head">
            <strong>{countLabel(workspace.packageIds.length, "package")}</strong>
            <span>{workspace.packages.filter((entry) => entry.readiness === "ready").length} ready</span>
          </div>
          <label className="package-workspace-mobile-switcher">
            <span>Choose package</span>
            <select
              aria-label="Choose package"
              value={selectedPackageId}
              onChange={(event) => selectPackage(event.target.value)}
            >
              {workspace.packages.map((entry) => (
                <option key={entry.package.id} value={entry.package.id}>
                  {entry.package.displayName} · {packageReadinessPresentation(entry.readiness).label}
                </option>
              ))}
            </select>
          </label>
          <ul className="package-workspace-nav-list">
            {workspace.packages.map((entry) => {
              const entryReadiness = packageReadinessPresentation(entry.readiness);
              const entryActive = packageLifecyclePresentation(entry.package);
              const marginLabel = entry.commercialSummary.marginPct === null
                ? "Margin unavailable"
                : `${formatPercent(entry.commercialSummary.marginPct)} margin`;
              return (
                <li key={entry.package.id}>
                  <button
                    type="button"
                    className={`package-workspace-nav-item${entry.package.id === selectedPackageId ? " selected" : ""}`}
                    data-package-id={entry.package.id}
                    aria-pressed={entry.package.id === selectedPackageId}
                    onClick={() => selectPackage(entry.package.id)}
                  >
                    <div className="package-workspace-nav-item-top">
                      <strong>{entry.package.displayName}</strong>
                      <StatusChip family={entryReadiness.family} label={entryReadiness.label} />
                    </div>
                    <div className="package-workspace-nav-item-facts">
                      <span>{formatCurrency(entry.package.pricePerPerson)}</span>
                      <span>{marginLabel}</span>
                      <span>{countLabel(entry.commercialSummary.includedCounts.total || 0, "inclusion")}</span>
                    </div>
                    <div className="package-workspace-nav-item-bottom">
                      <small>{entry.package.id}</small>
                      <StatusChip family={entryActive.family} label={entryActive.label} />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <div className="package-workspace-main">
          <section className="package-workspace-card package-workspace-overview" aria-labelledby="package-workspace-overview-heading">
            <div className="package-workspace-card-head">
              <div>
                <p className="package-workspace-kicker">Customer promise</p>
                <h4
                  id="package-workspace-overview-heading"
                  data-package-workspace-heading
                  tabIndex="-1"
                >{selectedPackageModel?.package?.displayName}</h4>
              </div>
              <div className="package-workspace-chip-row">
                <StatusChip family={readiness.family} label={readiness.label} />
                <StatusChip family={lifecycle.family} label={lifecycle.label} />
              </div>
            </div>
            <div className="package-workspace-overview-grid">
              <label>
                <span>Customer-facing package name</span>
                <input
                  data-package-field="name"
                  aria-label="Customer-facing package name"
                  value={selectedPackageRecord?.name || ""}
                  onChange={(event) => onPatchPackageField(selectedPackageId, "name", event.target.value)}
                />
              </label>
              <label>
                <span>Package ID</span>
                <input aria-label="Package ID" value={selectedPackageRecord?.id || ""} disabled />
              </label>
              <label>
                <span>Price per person</span>
                <input
                  data-package-field="ppp"
                  aria-label="Price per person"
                  type="number"
                  min="0"
                  step="0.01"
                  value={selectedPackageRecord?.ppp ?? 0}
                  onChange={(event) => onPatchPackageField(selectedPackageId, "ppp", Number(event.target.value))}
                />
              </label>
              <label>
                <span>Cost per person</span>
                <input
                  data-package-field="costPpp"
                  aria-label="Cost per person"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={marginsEnabled ? "Not recorded" : "Record when known"}
                  value={selectedPackageRecord?.costPpp ?? ""}
                  onChange={(event) => onPatchPackageField(
                    selectedPackageId,
                    "costPpp",
                    event.target.value === "" ? null : Number(event.target.value)
                  )}
                />
              </label>
              <label className="admin-inline-toggle package-workspace-active-toggle">
                <span>Available in Quote Builder</span>
                <input
                  type="checkbox"
                  aria-label={`Package ${selectedPackageIndex + 1} active`}
                  checked={selectedPackageRecord?.active !== false}
                  onChange={(event) => handleActiveChange(event.target.checked)}
                />
              </label>
            </div>
            {activationNotice && (
              <p className="package-workspace-activation-notice" role="status">{activationNotice}</p>
            )}
            <div className="package-workspace-summary-grid" aria-label="Package economics">
              <article>
                <span>Price</span>
                <strong>{formatCurrency(commercialSummary.pricePerPerson, "$0.00")}</strong>
                <small>Per guest</small>
              </article>
              <article>
                <span>Recorded cost</span>
                <strong>{commercialSummary.costPerPerson === null ? "Not recorded" : formatCurrency(commercialSummary.costPerPerson)}</strong>
                <small>{commercialSummary.costPerPerson === null ? "Add cost evidence to unlock margin." : "Per guest"}</small>
              </article>
              <article>
                <span>Contribution</span>
                <strong>{contributionLabel}</strong>
                <small>{commercialSummary.contributionPerPerson === null ? "Requires price and cost." : "Price minus cost"}</small>
              </article>
              <article>
                <span>Margin</span>
                <strong>{formatPercent(commercialSummary.marginPct)}</strong>
                <small>{commercialSummary.marginPct === null ? "Unavailable until price and cost are both valid." : "Commercial evidence only"}</small>
              </article>
            </div>
          </section>

          <details className="package-workspace-health-mobile">
            <summary>Package health · {readiness.label}</summary>
            {renderHealthContent("package-workspace-health-mobile-heading")}
          </details>

          <section className="package-workspace-card package-workspace-composition" aria-labelledby="package-workspace-composition-heading">
            <div className="package-workspace-card-head">
              <div>
                <p className="package-workspace-kicker">Composition</p>
                <h4 id="package-workspace-composition-heading">{selectedCountLabel}</h4>
              </div>
              <p className="package-workspace-quote-rule">
                Quote Builder never auto-selects these items. When an estimator picks one, QuotePilot prices it at $0 inside this package.
              </p>
            </div>

            <label className="admin-package-menu-filter package-workspace-menu-filter">
              <span>Menu item filter for add actions</span>
              <small>This only narrows the menu choices below. It does not decide where the package can be sold or what Quote Builder allows.</small>
              <select
                aria-label="Menu item filter for package inclusions"
                data-package-field="eventTypeFilter"
                value={selectedEventType}
                onChange={(event) => onSelectEventType(event.target.value)}
                disabled={menuLoading}
              >
                <option value="">Choose event type</option>
                {menuEventTypes.map((eventType) => (
                  <option key={eventType.id} value={eventType.id}>{eventType.name}</option>
                ))}
              </select>
            </label>

            <div className="package-workspace-group-grid">
              {INCLUSION_GROUPS.map((group) => {
                const selectedReferences = selectedPackageModel?.referenceHealth?.[group.modelKey] || [];
                const selectedIds = new Set(normalizeIdList(selectedPackageRecord?.[group.field]));
                const pendingIds = new Set(uniqueIds(
                  pickerSelections[group.id] === undefined
                    ? selectedPackageRecord?.[group.field]
                    : pickerSelections[group.id]
                ));
                const baseOptions = group.id === "menu"
                  ? (Array.isArray(menuItems) ? menuItems : [])
                  : (Array.isArray(draftCatalog?.[group.id]) ? draftCatalog[group.id] : []);
                const availableOptions = baseOptions.filter((option) => (
                  option?.active !== false || selectedIds.has(text(option?.id))
                ));
                const menuCategoryLookup = new Map(
                  (Array.isArray(menuCategories) ? menuCategories : []).map((category) => [
                    text(category?.id),
                    text(category?.name) || text(category?.id)
                  ])
                );
                const categories = [...new Set(availableOptions.map((option) => (
                  optionCategoryLabel(option, group, menuCategoryLookup)
                )))].filter(Boolean).sort((left, right) => left.localeCompare(right));
                const query = text(searchByGroup[group.id]).toLowerCase();
                const selectedCategory = text(categoryByGroup[group.id]);
                const filteredOptions = availableOptions.filter((option) => (
                  optionMatchesQuery(option, query)
                  && (!selectedCategory || optionCategoryLabel(option, group, menuCategoryLookup) === selectedCategory)
                ));
                const referenceIssues = selectedReferences.filter((reference) => reference.status !== "ok");
                return (
                  <article key={group.id} className="package-workspace-group-card">
                    <div className="package-workspace-group-head">
                      <div>
                        <h5>{group.label}</h5>
                        <p>
                          {selectedReferences.length === 0
                            ? `No ${group.label.toLowerCase()} are currently included.`
                            : countLabel(selectedReferences.length, group.singularLabel)}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="ghost"
                        data-package-group-toggle={group.id}
                        aria-expanded={expandedGroupId === group.id}
                        aria-controls={`package-picker-${group.id}`}
                        onClick={() => expandedGroupId === group.id ? closePicker(group.id) : openPicker(group)}
                      >
                        {expandedGroupId === group.id ? "Close selector" : group.triggerLabel}
                      </button>
                    </div>
                    {referenceIssues.length > 0 && (
                      <p className="package-workspace-group-warning">
                        {countLabel(referenceIssues.length, "selected issue")} {referenceIssues.length === 1 ? "needs" : "need"} attention before this package can quote cleanly.
                      </p>
                    )}
                    <ul className="package-workspace-selection-list">
                      {selectedReferences.length === 0 ? (
                        <li className="empty">Nothing selected yet.</li>
                      ) : selectedReferences.map((reference, index) => {
                        const presentation = referencePresentation(reference);
                        return (
                          <li key={`${group.id}-${reference.id || "blank"}-${index}`}>
                            <div>
                              <strong>{describeReference(reference)}</strong>
                              <small>{reference.status === "ok" ? "Selected at $0 when chosen in Quote Builder." : reference.issue === "inactive" ? "Record still exists but is inactive." : "Resolve or remove this reference."}</small>
                            </div>
                            <div className="package-workspace-selection-actions">
                              <StatusChip family={presentation.family} label={presentation.label} />
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => removeReference(group.field, reference)}
                              >Remove</button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>

                    {expandedGroupId === group.id && (
                      <>
                        <div
                          className="package-workspace-drawer-backdrop"
                          aria-hidden="true"
                          onClick={() => closePicker(group.id)}
                        />
                        <div
                          id={`package-picker-${group.id}`}
                          className="package-workspace-drawer on"
                          data-package-picker={group.id}
                          role="dialog"
                          aria-modal="true"
                          aria-labelledby={`package-picker-${group.id}-title`}
                          onKeyDown={(event) => handlePickerKeyDown(event, group.id)}
                        >
                          <div className="package-workspace-picker-head">
                            <div>
                              <p className="package-workspace-kicker">Package composition</p>
                              <h6 id={`package-picker-${group.id}-title`}>Choose {group.label.toLowerCase()}</h6>
                            </div>
                            <button type="button" className="ghost" onClick={() => closePicker(group.id)}>Close</button>
                          </div>
                          <div className="package-workspace-picker-filters">
                            <label className="package-workspace-search">
                              <span>{group.searchLabel}</span>
                              <input
                                type="search"
                                aria-label={group.searchLabel}
                                value={searchByGroup[group.id] || ""}
                                onChange={(event) => setSearchByGroup((current) => ({
                                  ...current,
                                  [group.id]: event.target.value
                                }))}
                                placeholder={`Search ${group.label.toLowerCase()}`}
                              />
                            </label>
                            <label className="package-workspace-search">
                              <span>Category</span>
                              <select
                                aria-label={`Filter ${group.label.toLowerCase()} by category`}
                                value={categoryByGroup[group.id] || ""}
                                onChange={(event) => setCategoryByGroup((current) => ({
                                  ...current,
                                  [group.id]: event.target.value
                                }))}
                              >
                                <option value="">All categories</option>
                                {categories.map((category) => (
                                  <option key={category} value={category}>{category}</option>
                                ))}
                              </select>
                            </label>
                          </div>
                          <p className="package-workspace-picker-count" role="status">
                            {countLabel(pendingIds.size, "selection")} in this package
                          </p>
                          <div className="package-workspace-option-list">
                            {filteredOptions.length === 0 ? (
                              <p className="package-workspace-picker-empty">
                                {availableOptions.length === 0 ? group.pickerEmptyLabel : "No matching records. Clear the search or category filter to continue."}
                              </p>
                            ) : filteredOptions.map((option) => {
                              const optionId = text(option?.id);
                              const checked = pendingIds.has(optionId);
                              return (
                                <label key={optionId} className="package-workspace-option">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    disabled={!checked && pendingIds.size >= 100}
                                    onChange={(event) => togglePickerSelection(group.id, optionId, event.target.checked)}
                                  />
                                  <span>
                                    <strong>{text(option?.name) || optionId}</strong>
                                    <small>
                                      {option?.active === false
                                        ? "Inactive record; unselect it before applying if it should be removed."
                                        : `${optionCategoryLabel(option, group, menuCategoryLookup)} · ${optionId}`}
                                    </small>
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                          <div className="package-workspace-picker-actions">
                            <button type="button" className="ghost" onClick={() => closePicker(group.id)}>Cancel</button>
                            <button type="button" className="cta" onClick={() => applyPickerSelection(group)}>
                              Apply {countLabel(pendingIds.size, "selection")}
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </article>
                );
              })}
            </div>
            {pickerStatus && <p className="package-workspace-picker-status" role="status">{pickerStatus}</p>}
          </section>

          <section className="package-workspace-card package-workspace-quote-behavior" aria-labelledby="package-workspace-quote-behavior-heading">
            <div className="package-workspace-card-head">
              <div>
                <p className="package-workspace-kicker">Quote Builder behavior</p>
                <h4 id="package-workspace-quote-behavior-heading">What sales will see</h4>
              </div>
            </div>
            <div className="package-workspace-behavior-grid">
              <article>
                <strong>Selections stay optional</strong>
                <p>{selectedPackageModel?.quoteBehaviorSummary?.description}</p>
              </article>
              <article>
                <strong>Catalog pricing receipt</strong>
                <p>
                  {selectedPackageModel?.evidence?.pricingConfirmationCurrent
                    ? "Catalog pricing is confirmed at the current revision."
                    : "Catalog pricing is not yet confirmed at the current revision."}
                </p>
              </article>
            </div>
          </section>
        </div>

        <aside className="package-workspace-health package-workspace-health-desktop" aria-labelledby="package-workspace-health-heading">
          {renderHealthContent("package-workspace-health-heading")}
        </aside>
      </div>
    </section>
  );
}
