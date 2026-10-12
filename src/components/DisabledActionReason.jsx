import { Children, Fragment, cloneElement, isValidElement, useId } from "react";
import "./disabledActionReason.css";

function normalizeId(value) {
  return String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function mergeAriaDescribedBy(...values) {
  return [...new Set(
    values
      .flatMap((value) => String(value || "").trim().split(/\s+/u))
      .filter(Boolean)
  )].join(" ") || undefined;
}

export default function DisabledActionReason({
  id = "",
  reason = "",
  className = "",
  grouped = false,
  children
}) {
  const generatedId = useId();
  const reasonText = String(reason || "").trim();
  const reasonId = normalizeId(id) || `disabled-action-${normalizeId(generatedId)}`;
  let associated = false;

  const controls = Children.map(children, (child) => {
    if (!reasonText || !isValidElement(child) || child.props.disabled !== true) return child;
    associated = true;
    return cloneElement(child, {
      "aria-describedby": mergeAriaDescribedBy(child.props["aria-describedby"], reasonId)
    });
  });

  const renderedControls = associated ? controls : children;
  const renderedReason = reasonText && associated ? (
    <small
      id={reasonId}
      className={`disabled-action-reason${className ? ` ${className}` : ""}`}
      data-disabled-action-reason="visible"
    >
      {reasonText}
    </small>
  ) : null;

  if (grouped) {
    return (
      <span className="disabled-action-reason-group">
        {renderedControls}
        {renderedReason}
      </span>
    );
  }

  if (!renderedReason) return <Fragment>{children}</Fragment>;

  return (
    <Fragment>
      {renderedControls}
      {renderedReason}
    </Fragment>
  );
}
