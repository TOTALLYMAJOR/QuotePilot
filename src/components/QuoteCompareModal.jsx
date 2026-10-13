import { useEffect, useMemo, useState } from "react";
import { calculateQuote, currency } from "../lib/quoteCalculator";
import { buildQuoteScenarios } from "../lib/quoteWorkflow";
import { buildMarginPresentation } from "./marginPresentation";
import { useModalDialog } from "../hooks/useModalDialog";
import AdaptiveChoiceField from "./AdaptiveChoiceField";

// Same default-off gate as every other margin surface; costs are tenant
// catalog data and margin never renders in any customer-facing projection.
const PILOT_MARGINS_ENABLED = ["1", "true", "yes", "on"].includes(
  String(import.meta.env.VITE_PILOT_MARGINS_ENABLED || "").trim().toLowerCase()
);

function marginPct(presentation) {
  return presentation?.available ? presentation.marginPct * 100 : null;
}

function cloneForm(form) {
  return {
    ...form,
    addons: Array.isArray(form?.addons) ? [...form.addons] : [],
    rentals: Array.isArray(form?.rentals) ? [...form.rentals] : [],
    menuItems: Array.isArray(form?.menuItems) ? [...form.menuItems] : []
  };
}

function buildChoiceSet(items, {
  currentValue = "",
  getValue = (item) => item?.id,
  getLabel = (item) => item?.name
} = {}) {
  const seenValues = new Set();
  const options = (Array.isArray(items) ? items : [])
    .map((item) => ({
      value: String(getValue(item) ?? "").trim(),
      label: String(getLabel(item) ?? "").trim()
    }))
    .filter((option) => {
      if (!option.value || !option.label || seenValues.has(option.value)) return false;
      seenValues.add(option.value);
      return true;
    });
  const selectedValue = String(currentValue || "").trim();
  const stale = Boolean(selectedValue && !options.some((option) => option.value === selectedValue));
  return {
    stale,
    options: stale && options.length > 0
      ? [{ value: selectedValue, label: `${selectedValue} (no longer available)`, disabled: true }, ...options]
      : options
  };
}

function ComparisonRow({ label, current, scenario, money = true }) {
  const delta = Number(scenario || 0) - Number(current || 0);
  const fmt = money ? currency : (value) => String(Math.round(Number(value || 0) * 100) / 100);
  const deltaLabel = `${delta >= 0 ? "+" : ""}${fmt(delta)}`;

  return (
    <tr>
      <td>{label}</td>
      <td>{fmt(current)}</td>
      <td>{fmt(scenario)}</td>
      <td className={delta > 0 ? "delta-up" : delta < 0 ? "delta-down" : ""}>{deltaLabel}</td>
    </tr>
  );
}

// Margin is fail-closed and can be unavailable on either side (recorded
// costs may not cover the scenario's selections even when they cover the
// current draft's), so this never assumes both percentages exist the way
// ComparisonRow's money/count rows can.
function MarginComparisonRow({ current, scenario }) {
  if (current === null && scenario === null) return null;
  const fmt = (value) => (value === null ? "Unavailable" : `${value.toFixed(1)}%`);
  const delta = current !== null && scenario !== null ? scenario - current : null;
  const deltaLabel = delta === null ? "—" : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} pts`;

  return (
    <tr>
      <td>Margin</td>
      <td>{fmt(current)}</td>
      <td>{fmt(scenario)}</td>
      <td className={delta > 0 ? "delta-up" : delta < 0 ? "delta-down" : ""}>{deltaLabel}</td>
    </tr>
  );
}

export default function QuoteCompareModal({
  open,
  onClose,
  form,
  setForm,
  catalog,
  settings,
  styles,
  primaryTotals,
  returnFocusRef = null
}) {
  const [compareForm, setCompareForm] = useState(() => cloneForm(form));
  const [scenarioId, setScenarioId] = useState("better");
  const seasonOptions = Array.isArray(settings?.seasonalProfiles) ? settings.seasonalProfiles : [];
  const taxRegionOptions = Array.isArray(settings?.taxRegions) ? settings.taxRegions : [];
  const scenarios = useMemo(
    () => buildQuoteScenarios(form, catalog),
    [form, catalog]
  );
  const scenarioResults = useMemo(
    () => scenarios.map((scenario) => {
      const scenarioTotals = calculateQuote(scenario.form, catalog, settings);
      return {
        ...scenario,
        totals: scenarioTotals,
        margin: PILOT_MARGINS_ENABLED
          ? marginPct(buildMarginPresentation({ form: scenario.form, totals: scenarioTotals, catalog, settings }))
          : null
      };
    }),
    [scenarios, catalog, settings]
  );

  useEffect(() => {
    if (open) {
      const initial = scenarios.find((item) => item.id === "better") || scenarios[0];
      setScenarioId(initial?.id || "custom");
      setCompareForm(cloneForm(initial?.form || form));
    }
  }, [open, form, scenarios]);

  const packageChoices = buildChoiceSet(catalog?.packages, {
    currentValue: compareForm.pkg,
    getLabel: (item) => `${item?.name || item?.id} - ${currency(item?.ppp)}/person`
  });
  const styleChoices = buildChoiceSet(styles, {
    currentValue: compareForm.style,
    getValue: (style) => style,
    getLabel: (style) => style
  });
  const taxRegionChoices = buildChoiceSet(taxRegionOptions, {
    currentValue: compareForm.taxRegion,
    getLabel: (region) => `${region?.name || region?.id} (${Math.round(Number(region?.rate || 0) * 1000) / 10}%)`
  });
  const seasonChoices = buildChoiceSet([
    { id: "auto", name: "Auto detect" },
    ...seasonOptions
  ], {
    currentValue: compareForm.seasonProfileId || "auto"
  });

  useEffect(() => {
    if (!open) return;
    setCompareForm((current) => {
      const patch = {};
      if (packageChoices.options.length === 1 && !packageChoices.stale && !String(current.pkg || "").trim()) {
        patch.pkg = packageChoices.options[0].value;
      }
      if (styleChoices.options.length === 1 && !styleChoices.stale && !String(current.style || "").trim()) {
        patch.style = styleChoices.options[0].value;
      }
      if (taxRegionChoices.options.length === 1 && !taxRegionChoices.stale && !String(current.taxRegion || "").trim()) {
        patch.taxRegion = taxRegionChoices.options[0].value;
      }
      return Object.keys(patch).length > 0 ? { ...current, ...patch } : current;
    });
  }, [
    open,
    packageChoices.options,
    packageChoices.stale,
    styleChoices.options,
    styleChoices.stale,
    taxRegionChoices.options,
    taxRegionChoices.stale
  ]);

  const compareTotals = useMemo(
    () => calculateQuote(compareForm, catalog, settings),
    [compareForm, catalog, settings]
  );
  const primaryMargin = useMemo(
    () => (PILOT_MARGINS_ENABLED
      ? marginPct(buildMarginPresentation({ form, totals: primaryTotals, catalog, settings }))
      : null),
    [form, primaryTotals, catalog, settings]
  );
  const compareMargin = useMemo(
    () => (PILOT_MARGINS_ENABLED
      ? marginPct(buildMarginPresentation({ form: compareForm, totals: compareTotals, catalog, settings }))
      : null),
    [compareForm, compareTotals, catalog, settings]
  );
  const { dialogRef } = useModalDialog({
    open,
    onRequestClose: onClose,
    returnFocusRef
  });

  if (!open) return null;

  const updateField = (field, value) => {
    setScenarioId("custom");
    setCompareForm((prev) => ({ ...prev, [field]: value }));
  };

  const toggleMulti = (field, id, checked) => {
    setScenarioId("custom");
    setCompareForm((prev) => {
      const next = new Set(prev[field] || []);
      if (checked) next.add(id);
      else next.delete(id);
      return {
        ...prev,
        [field]: [...next]
      };
    });
  };

  const selectScenario = (scenario) => {
    setScenarioId(scenario.id);
    setCompareForm(cloneForm(scenario.form));
  };

  const applyScenario = () => {
    setForm((prev) => ({
      ...prev,
      ...cloneForm(compareForm),
      eventTemplateId: "custom"
    }));
    onClose();
  };

  return (
    <div
      ref={dialogRef}
      className="modal-overlay"
      data-layout-overlap-allowed="true"
      role="dialog"
      aria-modal="true"
      aria-labelledby="scenario-compare-title"
      tabIndex={-1}
    >
      <div className="modal-card compare-card">
        <div className="modal-head">
          <h2 id="scenario-compare-title">Scenario Compare</h2>
          <button type="button" className="ghost" data-modal-initial-focus onClick={onClose}>Close</button>
        </div>

        <div className="scenario-presets" aria-label="Good better best quote scenarios">
          {scenarioResults.map((scenario) => {
            const delta = Number(scenario.totals.total || 0) - Number(primaryTotals.total || 0);
            return (
              <article
                key={scenario.id}
                className={`scenario-preset ${scenarioId === scenario.id ? "selected" : ""}`.trim()}
              >
                <div className="scenario-preset-head">
                  <span>{scenario.label}</span>
                  <strong>{currency(scenario.totals.total || 0)}</strong>
                </div>
                <p>{scenario.packageName}</p>
                <small>{scenario.description}</small>
                {PILOT_MARGINS_ENABLED && scenario.margin !== null && (
                  <small className="scenario-preset-margin">{scenario.margin.toFixed(1)}% margin</small>
                )}
                <button type="button" className="ghost compact" onClick={() => selectScenario(scenario)}>
                  {scenarioId === scenario.id ? "Selected" : `Compare ${scenario.label}`}
                </button>
                <em className={delta > 0 ? "delta-up" : delta < 0 ? "delta-down" : ""}>
                  {delta >= 0 ? "+" : ""}{currency(delta)} vs current
                </em>
              </article>
            );
          })}
        </div>

        <div className="compare-grid">
          <section className="compare-config">
            <h3>{scenarioId === "custom" ? "Custom Scenario" : `${scenarios.find((item) => item.id === scenarioId)?.label || "Alternative"} Scenario`}</h3>
            <div className="grid two-col">
              <label className="field">
                <span>Guests</span>
                <input
                  type="number"
                  min="1"
                  max="400"
                  value={compareForm.guests}
                  onChange={(e) => updateField("guests", Number(e.target.value))}
                />
              </label>
              <label className="field">
                <span>Hours</span>
                <input
                  type="number"
                  min="1"
                  max="12"
                  value={compareForm.hours}
                  onChange={(e) => updateField("hours", Number(e.target.value))}
                />
              </label>
              <label className="field">
                <span>Bartenders</span>
                <input
                  type="number"
                  min="0"
                  max="10"
                  value={compareForm.bartenders || 0}
                  onChange={(e) => updateField("bartenders", Number(e.target.value))}
                />
              </label>
              <AdaptiveChoiceField
                id="compare-package"
                label="Package"
                options={packageChoices.options}
                value={compareForm.pkg}
                onChange={(event) => updateField("pkg", event.target.value)}
                emptyReason={packageChoices.stale
                  ? `The scenario keeps package “${compareForm.pkg}”, but it is no longer available in the catalog.`
                  : "No active packages are available, so this scenario cannot be priced."}
                recoveryAction={{ label: "Return to quote", onClick: onClose }}
                fieldState={packageChoices.stale ? { evidence: "stale", editability: "draft" } : undefined}
                fieldStateDetails={packageChoices.stale ? {
                  reason: "Choose a current package before applying this scenario.",
                  recoveryAction: {
                    label: "Choose a current package",
                    onClick: () => document.getElementById("compare-package")?.focus()
                  }
                } : {}}
                singleChoiceDetail="This is the only package currently available for comparison."
                className="field"
              />
              <AdaptiveChoiceField
                id="compare-service-style"
                label="Service style"
                options={styleChoices.options}
                value={compareForm.style}
                onChange={(event) => updateField("style", event.target.value)}
                emptyReason={styleChoices.stale
                  ? `The scenario keeps service style “${compareForm.style}”, but it is no longer available.`
                  : "No service styles are available for this scenario."}
                recoveryAction={{ label: "Return to quote", onClick: onClose }}
                fieldState={styleChoices.stale ? { evidence: "stale", editability: "draft" } : undefined}
                fieldStateDetails={styleChoices.stale ? {
                  reason: "Choose a current service style before applying this scenario.",
                  recoveryAction: {
                    label: "Choose a current service style",
                    onClick: () => document.getElementById("compare-service-style")?.focus()
                  }
                } : {}}
                singleChoiceDetail="This is the only service style currently available for comparison."
                className="field"
              />
              <label className="field">
                <span>Miles (RT)</span>
                <input
                  type="number"
                  min="0"
                  value={compareForm.milesRT}
                  onChange={(e) => updateField("milesRT", Number(e.target.value))}
                />
              </label>
              <label className="field">
                <span>Payment method</span>
                <select value={compareForm.payMethod} onChange={(e) => updateField("payMethod", e.target.value)}>
                  <option value="card">Pay by Card</option>
                  <option value="ach">Pay by ACH/Check</option>
                </select>
              </label>
              <AdaptiveChoiceField
                id="compare-tax-region"
                label="Tax region"
                options={taxRegionChoices.options}
                value={compareForm.taxRegion || ""}
                onChange={(event) => updateField("taxRegion", event.target.value)}
                emptyReason={taxRegionChoices.stale
                  ? `The scenario keeps tax region “${compareForm.taxRegion}”, but it is no longer configured.`
                  : "No tax regions are configured, so authoritative tax cannot be compared."}
                recoveryAction={{ label: "Return to quote", onClick: onClose }}
                fieldState={taxRegionChoices.stale ? { evidence: "stale", editability: "draft" } : undefined}
                fieldStateDetails={taxRegionChoices.stale ? {
                  reason: "Choose a current tax region before applying this scenario.",
                  recoveryAction: {
                    label: "Choose a current tax region",
                    onClick: () => document.getElementById("compare-tax-region")?.focus()
                  }
                } : {}}
                singleChoiceDetail="This is the only tax region configured for comparison."
                className="field"
              />
              <AdaptiveChoiceField
                id="compare-season-profile"
                label="Season profile"
                options={seasonChoices.options}
                value={compareForm.seasonProfileId || "auto"}
                onChange={(event) => updateField("seasonProfileId", event.target.value)}
                emptyReason="No season profiles are available for this scenario."
                recoveryAction={{ label: "Return to quote", onClick: onClose }}
                fieldState={seasonChoices.stale ? { evidence: "stale", editability: "draft" } : undefined}
                fieldStateDetails={seasonChoices.stale ? {
                  reason: "Choose a current season profile or Auto detect before applying this scenario.",
                  recoveryAction: {
                    label: "Choose a current season profile",
                    onClick: () => document.getElementById("compare-season-profile")?.focus()
                  }
                } : {}}
                singleChoiceDetail="Auto detect is the only season choice currently available."
                className="field"
              />
            </div>

            <div className="compare-options">
              <div>
                <h4>Add-ons</h4>
                <div className="checklist">
                  {catalog.addons.map((item) => (
                    <label className="checkrow" key={item.id}>
                      <input
                        type="checkbox"
                        checked={compareForm.addons.includes(item.id)}
                        onChange={(e) => toggleMulti("addons", item.id, e.target.checked)}
                      />
                      <span>{item.name}</span>
                      <small>{item.type === "per_person" ? `${currency(item.price)}/person` : currency(item.price)}</small>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <h4>Rentals</h4>
                <div className="checklist">
                  {catalog.rentals.map((item) => (
                    <label className="checkrow" key={item.id}>
                      <input
                        type="checkbox"
                        checked={compareForm.rentals.includes(item.id)}
                        onChange={(e) => toggleMulti("rentals", item.id, e.target.checked)}
                      />
                      <span>{item.name}</span>
                      <small>{currency(item.price)} each</small>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="compare-results">
            <h3>Current vs Scenario</h3>
            <div className="history-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>Current</th>
                    <th>Scenario</th>
                    <th>Delta</th>
                  </tr>
                </thead>
                <tbody>
                  <ComparisonRow label="Base" current={primaryTotals.base} scenario={compareTotals.base} />
                  <ComparisonRow label="Add-ons" current={primaryTotals.addons} scenario={compareTotals.addons} />
                  <ComparisonRow label="Rentals" current={primaryTotals.rentals} scenario={compareTotals.rentals} />
                  <ComparisonRow label="Menu Items" current={primaryTotals.menu} scenario={compareTotals.menu} />
                  <ComparisonRow label="Labor" current={primaryTotals.labor} scenario={compareTotals.labor} />
                  <ComparisonRow label="Bartender Labor" current={primaryTotals.bartenderLabor} scenario={compareTotals.bartenderLabor} />
                  <ComparisonRow label="Travel" current={primaryTotals.travel} scenario={compareTotals.travel} />
                  <ComparisonRow label="Service Fee" current={primaryTotals.serviceFee} scenario={compareTotals.serviceFee} />
                  <ComparisonRow label="Tax" current={primaryTotals.tax} scenario={compareTotals.tax} />
                  <ComparisonRow label="Total" current={primaryTotals.total} scenario={compareTotals.total} />
                  <ComparisonRow label="Deposit" current={primaryTotals.deposit} scenario={compareTotals.deposit} />
                  <ComparisonRow label="Servers" current={primaryTotals.servers} scenario={compareTotals.servers} money={false} />
                  <ComparisonRow label="Chefs" current={primaryTotals.chefs} scenario={compareTotals.chefs} money={false} />
                  {PILOT_MARGINS_ENABLED && (
                    <MarginComparisonRow current={primaryMargin} scenario={compareMargin} />
                  )}
                </tbody>
              </table>
            </div>
            <p className="source-note">
              Scenario tax: {compareTotals.taxRegionName} ({Math.round(compareTotals.taxRateApplied * 1000) / 10}%)
            </p>
            <p className="source-note">
              Scenario season: {compareTotals.seasonProfileName}
            </p>
          </section>
        </div>

        <div className="modal-foot">
          <span className="source-note">Apply scenario to overwrite current selections.</span>
          <button type="button" className="cta" onClick={applyScenario}>
            Use {scenarioId === "custom" ? "Custom Scenario" : `${scenarios.find((item) => item.id === scenarioId)?.label || "Scenario"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
