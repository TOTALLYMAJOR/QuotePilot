import { useId, useMemo, useState } from "react";
import { compareImmutableQuoteVersions } from "../lib/quoteVersionComparison";
import {
  formatWorkspaceDate,
  formatWorkspaceDateTime,
  formatWorkspaceMoney,
  humanizeWorkspaceValue
} from "../lib/workspacePresentation";

function knownIdentity(identity = {}, key) {
  return identity?.[key]?.state === "known" ? identity[key].value : null;
}

function versionLabel(normalized = {}) {
  const versionNumber = knownIdentity(normalized.identity, "versionNumber");
  return versionNumber === null ? "Version not identified" : `Version ${versionNumber}`;
}

function displayKnownValue(value, valueType) {
  if (valueType === "money") return formatWorkspaceMoney(value);
  if (valueType === "date") return formatWorkspaceDate(value);
  if (valueType === "datetime") return formatWorkspaceDateTime(value);
  if (valueType === "boolean") return value ? "Yes" : "No";
  if (valueType === "number") {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
  }
  if (valueType === "items") {
    return value.length ? value.map((item) => item.label).join(", ") : "None recorded";
  }
  if (valueType === "quantities") {
    const entries = Object.entries(value);
    return entries.length
      ? entries.map(([id, quantity]) => `${id}: ${quantity}`).join(", ")
      : "None recorded";
  }
  if (valueType === "line_items") {
    return value.length
      ? value.map((item) => `${item.name} × ${item.quantity} (${formatWorkspaceMoney(item.total)})`).join("; ")
      : "None recorded";
  }
  return String(value);
}

function displayComparisonValue(value = {}, valueType = "text") {
  if (value.state === "unavailable") return "Source unavailable";
  if (value.state === "unknown") return "Not recorded";
  return displayKnownValue(value.value, valueType);
}

function comparisonState(comparison = {}) {
  if (comparison.comparisonState === "unavailable") return "error";
  if (comparison.comparisonState === "partial") return "partial";
  return "success";
}

export function QuoteVersionComparisonPresentation({
  comparison,
  regionId = "quote-version-comparison"
}) {
  if (!comparison) {
    return (
      <section className="quote-version-comparison" data-capability-state="empty">
        <p className="source-note">Two retained immutable versions are required for comparison.</p>
      </section>
    );
  }

  const state = comparisonState(comparison);
  const beforeCreatedAt = knownIdentity(comparison.before.identity, "createdAtISO");
  const afterCreatedAt = knownIdentity(comparison.after.identity, "createdAtISO");
  const visibleSections = comparison.sections.map((section) => ({
    ...section,
    fields: section.fields.filter((field) => field.comparison !== "unchanged")
  })).filter((section) => section.fields.length > 0);

  return (
    <section
      id={regionId}
      className="quote-version-comparison"
      aria-labelledby={`${regionId}-title`}
      data-capability-state={state}
    >
      <div className="workspace-route-head">
        <div>
          <p className="eyebrow">Immutable history</p>
          <h4 id={`${regionId}-title`}>Latest version comparison</h4>
        </div>
        <span className="source-note">
          {versionLabel(comparison.before)} → {versionLabel(comparison.after)}
        </span>
      </div>
      <p className="source-note">
        {beforeCreatedAt ? formatWorkspaceDateTime(beforeCreatedAt) : "Earlier save time unavailable"}
        {" → "}
        {afterCreatedAt ? formatWorkspaceDateTime(afterCreatedAt) : "Later save time unavailable"}
      </p>
      <p className="source-note">{comparison.evidenceBoundary}</p>

      {state === "error" && (
        <div className="error-note" role="alert">
          Comparison unavailable: {comparison.issues.map((issue) => humanizeWorkspaceValue(issue)).join(", ")}.
        </div>
      )}
      {state === "partial" && (
        <p className="warning-note" role="status" data-capability-state="partial">
          {comparison.summary.changedFieldCount} recorded changes; {comparison.summary.unknownFieldCount} fields cannot be compared because at least one version did not record a value.
        </p>
      )}
      {state === "success" && comparison.equivalence === "equivalent" && (
        <p className="source-note">No differences were found across the declared scope, schedule, pricing, and terms fields.</p>
      )}
      {state === "success" && comparison.equivalence === "different" && (
        <p className="source-note">{comparison.summary.changedFieldCount} declared field changes found.</p>
      )}

      {state !== "error" && visibleSections.length > 0 && (
        <div className="quote-version-comparison-sections">
          {visibleSections.map((section) => (
            <details key={section.id} open={section.state === "changed" || section.state === "changed_partial"}>
              <summary>{section.label} · {section.summary.changed} changed</summary>
              <dl>
                {section.fields.map((field) => (
                  <div key={field.id} data-comparison-state={field.comparison}>
                    <dt>{field.label}</dt>
                    <dd>
                      <span>Before: {displayComparisonValue(field.before, field.valueType)}</span>
                      <span>After: {displayComparisonValue(field.after, field.valueType)}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}

function compareLatestVersions(versions = []) {
  if (!Array.isArray(versions) || versions.length < 2) return null;
  const ordered = [...versions].sort((left, right) => (
    Number(left?.versionNumber || 0) - Number(right?.versionNumber || 0)
    || String(left?.createdAtISO || "").localeCompare(String(right?.createdAtISO || ""))
    || String(left?.id || left?.versionId || "").localeCompare(String(right?.id || right?.versionId || ""))
  ));
  return compareImmutableQuoteVersions(ordered.at(-2), ordered.at(-1));
}

export default function QuoteVersionComparison({ versions = [] }) {
  const [open, setOpen] = useState(false);
  const regionId = `${useId().replace(/:/g, "")}-quote-version-comparison`;
  const comparison = useMemo(
    () => (open ? compareLatestVersions(versions) : null),
    [open, versions]
  );

  if (versions.length < 2) return null;
  return (
    <div className="quote-version-comparison-disclosure">
      <button
        type="button"
        className="ghost compact"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? "Hide version comparison" : "Compare latest versions"}
      </button>
      {open && <QuoteVersionComparisonPresentation comparison={comparison} regionId={regionId} />}
    </div>
  );
}
