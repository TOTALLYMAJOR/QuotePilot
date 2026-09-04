import { Children, Fragment, cloneElement, isValidElement } from "react";

const GROUP_ORDER = Object.freeze([
  "quote",
  "proposal",
  "communication",
  "payment",
  "booking",
  "operations",
  "access",
  "recovery",
  "administration",
  "other"
]);

const GROUP_LABELS = Object.freeze({
  quote: "Quote",
  proposal: "Proposal",
  communication: "Communication",
  payment: "Payment",
  booking: "Booking",
  operations: "Operations",
  access: "Customer access",
  recovery: "Recovery",
  administration: "Administration",
  other: "Other"
});

function flattenActionChildren(children) {
  const flattened = [];
  Children.forEach(children, (child) => {
    if (child === null || child === undefined || child === false) return;
    if (isValidElement(child) && child.type === Fragment) {
      flattened.push(...flattenActionChildren(child.props.children));
      return;
    }
    flattened.push(child);
  });
  return flattened;
}

function actionProp(element, name) {
  return isValidElement(element) ? element.props?.[name] : undefined;
}

function groupedSecondaryActions(items) {
  const groups = new Map();
  items.forEach((item) => {
    const requested = String(actionProp(item, "data-quote-action-group") || "other").trim();
    const group = GROUP_ORDER.includes(requested) ? requested : "other";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(item);
  });
  return GROUP_ORDER
    .filter((group) => groups.has(group))
    .map((group) => ({
      id: group,
      label: GROUP_LABELS[group],
      items: groups.get(group)
    }));
}

export default function ConfiguredQuoteActionRail({
  primaryActionId = "",
  primaryAction = null,
  actions = {},
  children
}) {
  const items = flattenActionChildren(children);
  const evidence = items.filter((item) => (
    actionProp(item, "data-quote-action-kind") === "evidence"
  ));
  const actionItems = items
    .filter((item) => actionProp(item, "data-quote-action-kind") !== "evidence")
    .map((item) => {
      const actionId = String(actionProp(item, "data-quote-action-id") || "").trim();
      const descriptor = actionId ? actions?.[actionId] : null;
      if (!actionId || !descriptor?.visible || !isValidElement(item)) return null;
      const enabled = descriptor.enabled === true && item.props?.disabled !== true;
      return cloneElement(item, {
        disabled: !enabled,
        "aria-disabled": !enabled || undefined,
        "data-quote-action-state": enabled ? "enabled" : "blocked",
        title: enabled
          ? descriptor.consequence || item.props?.title
          : descriptor.disabledReason || item.props?.title,
        ...(Object.prototype.hasOwnProperty.call(item.props || {}, "disabledReason")
          ? { disabledReason: enabled ? "" : descriptor.disabledReason }
          : {})
      });
    })
    .filter(Boolean);
  const normalizedPrimaryId = String(primaryActionId || "").trim();
  const primaryItems = normalizedPrimaryId
    ? actionItems.filter((item) => String(actionProp(item, "data-quote-action-id") || "").trim() === normalizedPrimaryId)
    : [];
  const secondaryItems = actionItems.filter((item) => (
    !primaryItems.includes(item)
  ));
  const secondaryGroups = groupedSecondaryActions(secondaryItems);
  const primaryMissing = Boolean(
    primaryAction?.visible
    && primaryItems.length === 0
  );

  return (
    <div
      className="configured-quote-action-rail"
      data-configured-quote-actions="v2"
      data-primary-action={normalizedPrimaryId || "none"}
      data-layout-audit-group="configured-quote-actions"
    >
      {evidence.length > 0 && (
        <div className="configured-quote-action-evidence" aria-label="Quote action evidence">
          {evidence}
        </div>
      )}

      {primaryItems.length > 0 && (
        <div className="configured-quote-primary-action" aria-label="Recommended next action">
          {primaryItems}
        </div>
      )}

      {primaryMissing && (
        <div className="configured-quote-primary-blocker" role="status">
          <strong>{primaryAction.label}</strong>
          <small>{primaryAction.disabledReason || "This next action is not available from the current surface."}</small>
        </div>
      )}

      {secondaryGroups.length > 0 && (
        <details className="configured-quote-more-actions">
          <summary>More</summary>
          <div className="configured-quote-more-groups">
            {secondaryGroups.map((group) => (
              <section className="configured-quote-action-group" key={group.id}>
                <strong>{group.label}</strong>
                <div className="row-actions">
                  {group.items}
                </div>
              </section>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
