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

const CHOICE_COMPONENT_TYPES = [
  { id: "menu_item", label: "Menu items" },
  { id: "addon", label: "Services and add-ons" },
  { id: "rental", label: "Rentals" }
];

function text(value) {
  return String(value ?? "").trim();
}

function normalizeIdList(value) {
  return (Array.isArray(value) ? value : []).map((entry) => text(entry));
}

function normalizeChoiceGroups(value) {
  return (Array.isArray(value) ? value : []).map((group) => ({
    id: text(group?.id),
    label: text(group?.label || group?.name),
    componentType: text(group?.componentType || group?.type).toLowerCase(),
    componentIds: normalizeIdList(group?.componentIds),
    minChoices: Number(group?.minChoices ?? (group?.required === true ? 1 : 0)),
    maxChoices: Number(group?.maxChoices ?? (Array.isArray(group?.componentIds) ? group.componentIds.length : 0))
  }));
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
    includedRentalIds: normalizeIdList(packageRecord.includedRentalIds),
    choiceGroups: normalizeChoiceGroups(packageRecord.choiceGroups),
    quantityPolicyRefs: normalizeIdList(packageRecord.quantityPolicyRefs),
    ruleRefs: normalizeIdList(packageRecord.ruleRefs),
    offerVersion: text(packageRecord.offerVersion),
    verticalType: text(packageRecord.verticalType)
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
  if (text(reference.name)) return text(reference.name);
  if (reference.status === "missing") {
    if (reference.kind === "menu_item") return "Unavailable menu item";
    if (reference.kind === "addon") return "Unavailable service or add-on";
    if (reference.kind === "rental") return "Unavailable rental";
    return "Unavailable inclusion";
  }
  if (reference.status !== "ok") return "Invalid inclusion";
  return text(reference.label) || "Unnamed inclusion";
}

function uniqueRecordsById(records = []) {
  const seen = new Set();
  return (Array.isArray(records) ? records : []).filter((record) => {
    const id = text(record?.id);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function allMenuChoices(menuItems = [], catalog = {}) {
  const storedItems = (Array.isArray(catalog?.settings?.menuSections)
    ? catalog.settings.menuSections
    : []).flatMap((section) => (Array.isArray(section?.items) ? section.items : []));
  return uniqueRecordsById([...(Array.isArray(menuItems) ? menuItems : []), ...storedItems]);
}

function choiceComponentLabel(componentType = "") {
  return CHOICE_COMPONENT_TYPES.find((entry) => entry.id === componentType)?.label || "Unsupported component type";
}

function ruleDisplayName(rule = {}, index = 0) {
  return text(rule?.label)
    || text(rule?.name)
    || text(rule?.reason)
    || `${text(rule?.type) || "Configuration"} rule ${index + 1}`;
}

function ruleTypeLabel(rule = {}) {
  const type = text(rule?.type).toLowerCase();
  if (type === "requirement") return "Requirement";
  if (type === "recommendation") return "Recommendation";
  if (type === "exclusion") return "Exclusion";
  if (type === "validation") return "Validation";
  return "Configuration rule";
}

function templateOfferId(template = {}) {
  return text(template?.pkg || template?.offerRef);
}

function choiceGroupPresentation(group = {}, options = []) {
  const optionMap = new Map(options.map((option) => [text(option?.id), option]));
  const rawComponentIds = normalizeIdList(group?.componentIds);
  const componentIds = rawComponentIds.filter(Boolean);
  const blankCount = rawComponentIds.length - componentIds.length;
  const duplicateCount = componentIds.length - new Set(componentIds).size;
  const minChoices = Number(group?.minChoices ?? (group?.required === true ? 1 : 0));
  const maxChoices = Number(group?.maxChoices ?? componentIds.length);
  const missingCount = componentIds.filter((id) => !optionMap.has(id)).length;
  const inactiveCount = componentIds.filter((id) => optionMap.get(id)?.active === false).length;
  const boundsInvalid = !Number.isSafeInteger(minChoices)
    || !Number.isSafeInteger(maxChoices)
    || minChoices < 0
    || maxChoices < minChoices
    || maxChoices > componentIds.length;
  const supportedType = CHOICE_COMPONENT_TYPES.some((entry) => (
    entry.id === text(group?.componentType || group?.type).toLowerCase()
  ));
  const attentionCount = [
    text(group?.label || group?.name) ? 0 : 1,
    text(group?.id) ? 0 : 1,
    supportedType ? 0 : 1,
    componentIds.length > 0 ? 0 : 1,
    boundsInvalid ? 1 : 0,
    blankCount,
    duplicateCount,
    missingCount,
    inactiveCount
  ].reduce((total, count) => total + count, 0);
  return {
    componentIds,
    minChoices,
    maxChoices,
    missingCount,
    inactiveCount,
    boundsInvalid,
    blankCount,
    duplicateCount,
    supportedType,
    attentionCount
  };
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
  const choiceGroups = Array.isArray(selectedPackageRecord?.choiceGroups)
    ? selectedPackageRecord.choiceGroups
    : [];
  const configurationRules = Array.isArray(draftCatalog?.settings?.configurationRules)
    ? draftCatalog.settings.configurationRules
    : [];
  const linkedRuleIds = uniqueIds(selectedPackageRecord?.ruleRefs);
  const configurationRuleMap = new Map(configurationRules.map((rule) => [text(rule?.id), rule]));
  const missingRuleIds = linkedRuleIds.filter((ruleId) => !configurationRuleMap.has(ruleId));
  const usedByTemplates = (Array.isArray(draftCatalog?.settings?.eventTemplates)
    ? draftCatalog.settings.eventTemplates
    : []).filter((template) => templateOfferId(template) === selectedPackageId);
  const usedByRecommendations = (Array.isArray(draftCatalog?.settings?.upsellRules)
    ? draftCatalog.settings.upsellRules
    : []).filter((rule) => (
    rule?.kind === "package" && text(rule?.targetId) === selectedPackageId
  ));

  const choiceOptionsForType = (componentType) => {
    if (componentType === "menu_item") return allMenuChoices(menuItems, draftCatalog);
    if (componentType === "addon") return uniqueRecordsById(draftCatalog?.addons || []);
    if (componentType === "rental") return uniqueRecordsById(draftCatalog?.rentals || []);
    return [];
  };
  const nestedAttentionForPackage = (packageRecord = {}) => {
    const groups = Array.isArray(packageRecord?.choiceGroups) ? packageRecord.choiceGroups : [];
    const groupIds = groups.map((group) => text(group?.id)).filter(Boolean);
    const duplicateGroupIds = groupIds.length - new Set(groupIds).size;
    const choiceIssues = groups.reduce((total, group) => {
      const componentType = text(group?.componentType || group?.type).toLowerCase();
      return total + choiceGroupPresentation(group, choiceOptionsForType(componentType)).attentionCount;
    }, duplicateGroupIds);
    const unavailableRules = uniqueIds(packageRecord?.ruleRefs)
      .filter((ruleId) => !configurationRuleMap.has(ruleId)).length;
    return choiceIssues + unavailableRules;
  };
  const choicePresentations = choiceGroups.map((group) => choiceGroupPresentation(
    group,
    choiceOptionsForType(text(group?.componentType || group?.type).toLowerCase())
  ));
  const choiceGroupIds = choiceGroups.map((group) => text(group?.id)).filter(Boolean);
  const duplicateChoiceGroupIdCount = choiceGroupIds.length - new Set(choiceGroupIds).size;
  const choiceAttentionCount = choicePresentations.reduce((total, presentation) => (
    total + presentation.attentionCount
  ), duplicateChoiceGroupIdCount);

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
    if (activationBlockIsResolved && activationNotice.startsWith("This offer cannot be made available")) {
      setActivationNotice("");
    }
  }, [activationNotice, selectedPackageModel?.readiness, selectedPackageRecord?.active]);

  const revealSection = (sectionId) => {
    const section = rootRef.current?.querySelector(`[data-package-section="${sectionId}"]`);
    if (section?.tagName === "DETAILS") section.open = true;
  };

  const focusField = (selector, afterFocus) => {
    if (typeof afterFocus === "function") {
      afterFocus();
    }
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      const target = rootRef.current?.querySelector(selector);
      const disclosure = target?.closest?.("details");
      if (disclosure && !disclosure.open) {
        disclosure.open = true;
      }
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
    if (reason?.targetSection === "choices") {
      revealSection("choices");
      focusField('[data-package-section="choices"] > summary');
      return;
    }
    if (reason?.targetSection === "rules") {
      revealSection("rules");
      focusField('[data-package-section="rules"] > summary');
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
    revealSection("included");
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
    setPickerStatus(`${group.label}: ${countLabel(nextIds.length, group.singularLabel)} staged in this offer draft.`);
    closePicker(group.id);
  };

  const handleActiveChange = (nextActive) => {
    if (nextActive && selectedPackageModel?.readiness !== "ready") {
      const firstReason = selectedPackageModel?.reasons?.[0];
      setActivationNotice(
        `This offer cannot be made available yet. ${firstReason?.title || "Complete the required offer details first."}`
      );
      if (typeof window !== "undefined") {
        window.requestAnimationFrame(() => {
          rootRef.current?.querySelector("[data-package-health]")?.focus({ preventScroll: true });
        });
      }
      return;
    }
    setActivationNotice(nextActive
      ? "This offer will become available for quoting when the catalog draft is saved."
      : "This offer will remain draft-only when the catalog draft is saved.");
    onPatchPackageField(selectedPackageId, "active", nextActive);
  };

  if (!workspace || workspace.packageIds.length === 0) {
    return (
      <section className="admin-section package-workspace-section">
        <div className="admin-section-head package-workspace-head">
          <div>
            <p className="package-workspace-kicker">Offers</p>
            <h3>Build the packages customers can choose.</h3>
            <p className="source-note">
              An offer is a reusable catering package with a customer-facing name, price, availability, and included choices.
            </p>
          </div>
          <button type="button" className="ghost" onClick={onAddPackage}>Add offer</button>
        </div>
        <div className="package-workspace-empty">
          <h4>No offers yet</h4>
          <p>Create the first catering package, then choose its price, availability, and included menu or service choices.</p>
          <button type="button" className="cta" onClick={onAddPackage}>Add first offer</button>
        </div>
      </section>
    );
  }

  const readiness = packageReadinessPresentation(selectedPackageModel?.readiness);
  const nestedAttentionAction = choiceAttentionCount > 0
    ? {
        label: "Review customer choices",
        detail: "One or more choice groups have missing details, unavailable items, or selection limits that need correction.",
        targetSection: "choices"
      }
    : missingRuleIds.length > 0
      ? {
          label: "Review linked rules",
          detail: "One or more linked selling rules are no longer available in the current Library.",
          targetSection: "rules"
        }
      : null;
  const nextDecision = selectedPackageModel?.nextAction || nestedAttentionAction;
  const overallReadiness = selectedPackageModel?.readiness === "ready" && nestedAttentionAction
    ? { family: STATUS_FAMILY.PENDING, label: "Needs review" }
    : readiness;
  const lifecycle = packageLifecyclePresentation(selectedPackageModel?.package);
  const commercialSummary = selectedPackageModel?.commercialSummary || {};
  const contributionLabel = commercialSummary.contributionPerPerson === null
    ? "Unavailable"
    : formatCurrency(commercialSummary.contributionPerPerson);
  const selectedCountLabel = countLabel(
    commercialSummary.includedCounts?.total || 0,
    "included item"
  );
  const renderNextAction = (headingId) => (
    <section className="package-workspace-next" data-package-health tabIndex="-1" aria-labelledby={headingId}>
      <div className="package-workspace-card-head">
        <div>
          <p className="package-workspace-kicker">Next decision</p>
          <h5 id={headingId}>
            {nextDecision
              ? nextDecision.label
              : "Ready for quoting"}
          </h5>
          <p>
            {nextDecision
              ? nextDecision.detail || selectedPackageModel?.reasons?.[0]?.detail
              : "This offer is ready for sales to use on the current catalog."}
          </p>
        </div>
        <StatusChip family={overallReadiness.family} label={overallReadiness.label} />
      </div>
      {nextDecision && (
        <button
          type="button"
          className="cta package-workspace-next-action"
          onClick={() => handleReasonAction(nextDecision)}
        >
          {nextDecision.label}
        </button>
      )}
    </section>
  );
  const renderReadinessDetails = () => (
    <div className="package-workspace-readiness-details">
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
    </div>
  );

  return (
    <section ref={rootRef} className="admin-section package-workspace-section" data-package-workspace="true">
      <div className="admin-section-head package-workspace-head">
        <div>
          <p className="package-workspace-kicker">Offers</p>
          <h3>Customer-ready catering packages</h3>
          <p className="source-note">
            Shape one offer at a time. Its price, included choices, and availability are saved with the rest of the Library.
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
            >Revert this offer</button>
          )}
          <div className="package-workspace-actions-menu">
            <button
              type="button"
              className="ghost"
              aria-haspopup="menu"
              aria-expanded={actionsOpen}
              onClick={() => setActionsOpen((current) => !current)}
            >Offer actions</button>
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
                >Delete offer…</button>
              </div>
            )}
          </div>
          <button type="button" className="ghost" onClick={onAddPackage}>Add offer</button>
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
            <h4 id="package-delete-review-title">Delete {text(selectedPackageRecord?.name) || `unnamed offer ${selectedPackageIndex + 1}`}?</h4>
            <p id="package-delete-review-description">
              {packageDeletionSummary.available === false
                ? "Dependency review is unavailable until the Event Templates draft is valid. Nothing has been deleted."
                : `${countLabel(packageDeletionSummary.eventTemplateCount || 0, "event template")} and ${countLabel(packageDeletionSummary.ruleCount || 0, "recommendation rule")} currently use this offer. When saved, they will stop using it; existing saved quotes stay unchanged.`}
            </p>
          </div>
          <div className="package-workspace-delete-actions">
            <button type="button" className="ghost" onClick={() => setDeleteReviewOpen(false)}>Keep offer</button>
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
        <aside className="package-workspace-nav" aria-label="Offer list">
          <div className="package-workspace-nav-head">
            <strong>{countLabel(workspace.packageIds.length, "offer")}</strong>
            <span>{workspace.packages.filter((entry) => (
              entry.readiness === "ready"
              && nestedAttentionForPackage(findPackageById(draftCatalog?.packages, entry.package.id)) === 0
            )).length} ready</span>
          </div>
          <label className="package-workspace-mobile-switcher">
            <span>Choose offer</span>
            <select
              aria-label="Choose offer"
              value={selectedPackageId}
              onChange={(event) => selectPackage(event.target.value)}
            >
              {workspace.packages.map((entry, entryIndex) => {
                const entryNestedAttention = nestedAttentionForPackage(
                  findPackageById(draftCatalog?.packages, entry.package.id)
                );
                const entryReadiness = entry.readiness === "ready" && entryNestedAttention > 0
                  ? "Needs review"
                  : packageReadinessPresentation(entry.readiness).label;
                return (
                  <option key={entry.package.id} value={entry.package.id}>
                    {text(entry.package.name) || `Unnamed offer ${entryIndex + 1}`} · {entryReadiness}
                  </option>
                );
              })}
            </select>
          </label>
          <ul className="package-workspace-nav-list">
            {workspace.packages.map((entry, entryIndex) => {
              const entryReadiness = packageReadinessPresentation(entry.readiness);
              const entryNestedAttention = nestedAttentionForPackage(
                findPackageById(draftCatalog?.packages, entry.package.id)
              );
              const entryOverallReadiness = entry.readiness === "ready" && entryNestedAttention > 0
                ? { family: STATUS_FAMILY.PENDING, label: "Needs review" }
                : entryReadiness;
              const entryActive = packageLifecyclePresentation(entry.package);
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
                      <strong>{text(entry.package.name) || `Unnamed offer ${entryIndex + 1}`}</strong>
                      <StatusChip family={entryOverallReadiness.family} label={entryOverallReadiness.label} />
                    </div>
                    <div className="package-workspace-nav-item-facts">
                      <span>{formatCurrency(entry.package.pricePerPerson)}</span>
                      <span>{countLabel(entry.commercialSummary.includedCounts.total || 0, "inclusion")}</span>
                    </div>
                    <div className="package-workspace-nav-item-bottom">
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
                <p className="package-workspace-kicker">Selected offer</p>
                <h4
                  id="package-workspace-overview-heading"
                  data-package-workspace-heading
                  tabIndex="-1"
                >{text(selectedPackageRecord?.name) || `Unnamed offer ${selectedPackageIndex + 1}`}</h4>
              </div>
              <div className="package-workspace-chip-row">
                <StatusChip family={overallReadiness.family} label={overallReadiness.label} />
                <StatusChip family={lifecycle.family} label={lifecycle.label} />
              </div>
            </div>
            <div className="package-workspace-summary-grid package-workspace-primary-summary" aria-label="Offer commercial summary">
              <article>
                <span>Selling price</span>
                <strong>{formatCurrency(commercialSummary.pricePerPerson, "$0.00")}</strong>
                <small>Per guest</small>
              </article>
              <article>
                <span>Availability</span>
                <strong>{selectedPackageRecord?.active !== false ? "Available" : "Draft only"}</strong>
                <small>{selectedPackageRecord?.active !== false ? "Sales can choose this offer." : "Hidden from new quotes after save."}</small>
              </article>
              <article>
                <span>Included</span>
                <strong>{selectedCountLabel}</strong>
                <small>Charged through the offer when selected</small>
              </article>
              <article>
                <span>Margin</span>
                <strong>{formatPercent(commercialSummary.marginPct)}</strong>
                <small>{commercialSummary.marginPct === null ? "Record cost evidence to calculate it." : `${contributionLabel} contribution per guest`}</small>
              </article>
            </div>
            {renderNextAction("package-workspace-next-heading")}
            {activationNotice && (
              <p className="package-workspace-activation-notice" role="status">{activationNotice}</p>
            )}
          </section>

          <details
            className="package-workspace-disclosure package-workspace-object-section package-workspace-section-basics"
            data-package-section="basics"
          >
            <summary>
              <span>
                <strong>Basics</strong>
                <small>Name and quoting availability</small>
              </span>
              {!text(selectedPackageRecord?.name) && (
                <StatusChip family={STATUS_FAMILY.BLOCKED} label="Needs attention" />
              )}
            </summary>
            <div className="package-workspace-disclosure-body">
              <div className="package-workspace-overview-grid">
                <label>
                  <span>Customer-facing offer name</span>
                  <input
                    data-package-field="name"
                    aria-label="Customer-facing offer name"
                    value={selectedPackageRecord?.name || ""}
                    onChange={(event) => onPatchPackageField(selectedPackageId, "name", event.target.value)}
                  />
                </label>
                <label className="admin-inline-toggle package-workspace-active-toggle">
                  <span>Available for quoting</span>
                  <input
                    type="checkbox"
                    aria-label={`Offer ${selectedPackageIndex + 1} active`}
                    checked={selectedPackageRecord?.active !== false}
                    onChange={(event) => handleActiveChange(event.target.checked)}
                  />
                </label>
              </div>
              <p className="source-note">
                Availability changes only in this catalog draft. Existing saved quotes keep their recorded offer.
              </p>
            </div>
          </details>

          <details
            className="package-workspace-disclosure package-workspace-object-section package-workspace-section-included"
            data-package-section="included"
          >
            <summary>
              <span>
                <strong>Included</strong>
                <small>{selectedCountLabel} available through this offer</small>
              </span>
              {(selectedPackageModel?.referenceHealth?.counts?.blocking > 0
                || selectedPackageModel?.referenceHealth?.counts?.review > 0) && (
                <StatusChip family={STATUS_FAMILY.PENDING} label="Needs attention" />
              )}
            </summary>
            <div className="package-workspace-disclosure-body package-workspace-composition" aria-labelledby="package-workspace-composition-heading">
              <div className="package-workspace-card-head">
                <div>
                  <p className="package-workspace-kicker">Included with this offer</p>
                  <h4 id="package-workspace-composition-heading">Fixed inclusions</h4>
                </div>
                <p className="package-workspace-quote-rule">
                  These items remain choices in a quote. When selected, their price is already included in this offer.
                </p>
              </div>

            <label className="admin-package-menu-filter package-workspace-menu-filter">
              <span>Menu item filter for add actions</span>
              <small>This only narrows the available menu choices below. It does not change where the offer can be used.</small>
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
                        {countLabel(referenceIssues.length, "selected issue")} {referenceIssues.length === 1 ? "needs" : "need"} attention before this offer can be quoted cleanly.
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
                              <small>{reference.status === "ok" ? "Included in the offer when chosen in a quote." : reference.issue === "inactive" ? "This choice still exists but is unavailable." : "Resolve or remove this choice."}</small>
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
                              <p className="package-workspace-kicker">Offer contents</p>
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
                            {countLabel(pendingIds.size, "selection")} in this offer
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
                                    <strong>{text(option?.name) || "Unnamed catalog item"}</strong>
                                    <small>
                                      {option?.active === false
                                        ? "Inactive record; unselect it before applying if it should be removed."
                                        : optionCategoryLabel(option, group, menuCategoryLookup)}
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
            </div>
          </details>

          {choiceGroups.length > 0 && (
            <details
              className="package-workspace-disclosure package-workspace-object-section package-workspace-section-choices"
              data-package-section="choices"
            >
            <summary>
              <span>
                <strong>Choices</strong>
                <small>
                  {choiceGroups.length === 0
                    ? "No bounded customer choices"
                    : countLabel(choiceGroups.length, "customer choice group")}
                </small>
              </span>
              {choiceAttentionCount > 0 && (
                <StatusChip family={STATUS_FAMILY.PENDING} label={countLabel(choiceAttentionCount, "issue")} />
              )}
            </summary>
            <div className="package-workspace-disclosure-body">
              <div className="package-workspace-card-head">
                <div>
                  <p className="package-workspace-kicker">Customer choices</p>
                  <h4>What customers must choose</h4>
                </div>
              </div>
              <p className="package-workspace-quote-rule">
                These recorded limits belong to the current offer. They are shown here without creating another choice or pricing authority.
              </p>
              <div className="package-workspace-group-grid package-workspace-choice-groups">
                  {choiceGroups.map((group, groupIndex) => {
                    const componentType = text(group?.componentType || group?.type).toLowerCase();
                    const options = choiceOptionsForType(componentType);
                    const optionMap = new Map(options.map((option) => [text(option?.id), option]));
                    const presentation = choicePresentations[groupIndex];
                    return (
                      <article
                        key={text(group?.id) || `choice-group-${groupIndex}`}
                        className="package-workspace-group-card package-workspace-choice-group"
                        data-package-choice-group={groupIndex}
                      >
                        <div className="package-workspace-group-head">
                          <div>
                            <h5>{text(group?.label || group?.name) || `Customer choice ${groupIndex + 1}`}</h5>
                            <p>
                              {choiceComponentLabel(componentType)} · choose {presentation.minChoices}–{presentation.maxChoices} from {countLabel(presentation.componentIds.length, "available item")}
                            </p>
                          </div>
                          <StatusChip
                            family={presentation.attentionCount > 0 ? STATUS_FAMILY.PENDING : STATUS_FAMILY.CONFIRMED}
                            label={presentation.attentionCount > 0 ? "Needs attention" : "Recorded"}
                          />
                        </div>
                        {presentation.attentionCount > 0 && (
                          <p className="package-workspace-group-warning">
                            This choice needs attention before the offer can be published cleanly.
                          </p>
                        )}
                        <div className="package-workspace-behavior-grid package-workspace-choice-facts">
                          <article>
                            <strong>Selection limit</strong>
                            <p>Choose at least {presentation.minChoices} and no more than {presentation.maxChoices}.</p>
                          </article>
                          <article>
                            <strong>Choice type</strong>
                            <p>{choiceComponentLabel(componentType)}</p>
                          </article>
                        </div>
                        <div className="package-workspace-choice-selection">
                          <div className="package-workspace-group-head">
                            <div>
                              <h5>Available choices</h5>
                              <p>{countLabel(presentation.componentIds.length, "catalog item")}</p>
                            </div>
                          </div>
                          <ul className="package-workspace-selection-list">
                            {presentation.componentIds.length === 0 ? (
                              <li className="empty">No choices selected yet.</li>
                            ) : presentation.componentIds.map((componentId, componentIndex) => {
                              const option = optionMap.get(componentId);
                              const optionStatus = option?.active === false ? "inactive" : option ? "ok" : "missing";
                              const optionPresentation = referencePresentation({ status: optionStatus });
                              return (
                                <li key={`${componentId}-${componentIndex}`}>
                                  <div>
                                    <strong>{text(option?.name) || `Unavailable ${choiceComponentLabel(componentType).toLowerCase().replace(/s$/u, "")}`}</strong>
                                    <small>{optionStatus === "ok" ? "Available in this customer choice." : "Remove or replace this unavailable catalog item."}</small>
                                  </div>
                                  <StatusChip family={optionPresentation.family} label={optionPresentation.label} />
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            </details>
          )}

          {linkedRuleIds.length > 0 && (
            <details
              className="package-workspace-disclosure package-workspace-object-section package-workspace-section-rules"
              data-package-section="rules"
            >
              <summary>
                <span>
                  <strong>Rules</strong>
                  <small>{countLabel(linkedRuleIds.length, "linked rule")}</small>
                </span>
                {missingRuleIds.length > 0 && (
                  <StatusChip family={STATUS_FAMILY.PENDING} label={countLabel(missingRuleIds.length, "issue")} />
                )}
              </summary>
              <div className="package-workspace-disclosure-body">
                <p className="package-workspace-quote-rule">
                  These are the selling-rule relationships recorded on this offer. Rule logic and availability remain managed in the Library’s Rules workspace.
                </p>
                {missingRuleIds.length > 0 && (
                  <p className="package-workspace-group-warning">
                    {countLabel(missingRuleIds.length, "linked rule")} cannot be found in the current Library and needs review before publishing.
                  </p>
                )}
                <ul className="package-workspace-selection-list package-workspace-rule-list">
                  {linkedRuleIds.map((ruleId, index) => {
                    const rule = configurationRuleMap.get(ruleId);
                    return (
                      <li key={ruleId || `configuration-rule-${index}`} className="package-workspace-rule-row">
                        <div>
                          <strong>{rule ? ruleDisplayName(rule, index) : "Unavailable linked rule"}</strong>
                          <small>{rule ? `${ruleTypeLabel(rule)} · ${rule?.enabled === false ? "Disabled" : "Enabled"}` : "The recorded rule is not present in the current Library."}</small>
                        </div>
                        <StatusChip
                          family={rule ? (rule.enabled === false ? STATUS_FAMILY.ARCHIVED : STATUS_FAMILY.CONFIRMED) : STATUS_FAMILY.BLOCKED}
                          label={rule ? (rule.enabled === false ? "Disabled" : "Linked") : "Missing"}
                        />
                      </li>
                    );
                  })}
                </ul>
              </div>
            </details>
          )}

          <details
            className="package-workspace-disclosure package-workspace-object-section package-workspace-section-pricing"
            data-package-section="pricing"
          >
            <summary>
              <span>
                <strong>Pricing</strong>
                <small>
                  {commercialSummary.marginPct === null
                    ? "Record cost evidence to see margin"
                    : `${formatPercent(commercialSummary.marginPct)} margin`}
                </small>
              </span>
              <StatusChip family={readiness.family} label={readiness.label} />
            </summary>
            <div className="package-workspace-disclosure-body">
              <div className="package-workspace-overview-grid package-workspace-pricing-fields">
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
                <label className="package-workspace-cost-field">
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
              </div>
              <div className="package-workspace-summary-grid" aria-label="Offer economics">
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
              {renderReadinessDetails()}
            </div>
          </details>

          <details
            className="package-workspace-disclosure package-workspace-object-section package-workspace-section-usage"
            data-package-section="usage"
          >
            <summary>
              <span>
                <strong>Usage</strong>
                <small>
                  {countLabel(usedByTemplates.length, "template")} · {countLabel(usedByRecommendations.length, "recommendation")}
                </small>
              </span>
            </summary>
            <div className="package-workspace-disclosure-body">
              <div className="package-workspace-behavior-grid">
                <article>
                  <strong>How quotes use this offer</strong>
                  <p>{selectedPackageModel?.quoteBehaviorSummary?.description}</p>
                </article>
                <article>
                  <strong>Starting points</strong>
                  <p>{usedByTemplates.length === 0
                    ? "No event template currently starts with this offer."
                    : `${countLabel(usedByTemplates.length, "event template")} currently starts with this offer.`}</p>
                </article>
              </div>
              {usedByTemplates.length > 0 && (
                <ul className="package-workspace-selection-list package-workspace-usage-list">
                  {usedByTemplates.map((template, index) => (
                    <li key={text(template?.id) || `offer-template-${index}`}>
                      <div>
                        <strong>{text(template?.name) || `Event template ${index + 1}`}</strong>
                        <small>Starts new quotes with this offer.</small>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>

          <details
            className="package-workspace-disclosure package-workspace-object-section package-workspace-section-advanced"
            data-package-section="advanced"
          >
            <summary>
              <span>
                <strong>Advanced details</strong>
                <small>Revision, record references, and pricing confirmation</small>
              </span>
            </summary>
            <div className="package-workspace-disclosure-body">
              <dl className="package-workspace-evidence-list">
                <div>
                  <dt>Offer record ID</dt>
                  <dd>{selectedPackageRecord?.id || "Unavailable"}</dd>
                </div>
                <div>
                  <dt>Catalog revision</dt>
                  <dd>{selectedPackageModel?.evidence?.catalogRevision ?? "Unavailable"}</dd>
                </div>
                <div>
                  <dt>Included-choice pricing</dt>
                  <dd>Included when sales chooses an item.</dd>
                </div>
                <div>
                  <dt>Offer format</dt>
                  <dd>{text(selectedPackageRecord?.offerVersion) || "Legacy package compatibility"}</dd>
                </div>
                <div>
                  <dt>Business type</dt>
                  <dd>{text(selectedPackageRecord?.verticalType) || "Catering"}</dd>
                </div>
                <div>
                  <dt>Pricing confirmation</dt>
                  <dd>
                    {selectedPackageModel?.evidence?.pricingConfirmationCurrent
                      ? "Current for this catalog revision"
                      : "Needs confirmation at the current catalog revision"}
                  </dd>
                </div>
                {uniqueIds(selectedPackageRecord?.quantityPolicyRefs).length > 0 && (
                  <div>
                    <dt>Quantity policy references</dt>
                    <dd>{uniqueIds(selectedPackageRecord?.quantityPolicyRefs).join(", ")}</dd>
                  </div>
                )}
                {linkedRuleIds.length > 0 && (
                  <div>
                    <dt>Rule references</dt>
                    <dd>{linkedRuleIds.join(", ")}</dd>
                  </div>
                )}
              </dl>
            </div>
          </details>
        </div>
      </div>
    </section>
  );
}
