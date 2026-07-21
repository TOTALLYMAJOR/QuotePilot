import { useEffect, useMemo, useState } from "react";
import { calculateQuote, currency } from "../lib/quoteCalculator";
import { buildQuoteScenarios } from "../lib/quoteWorkflow";

function cloneForm(form) {
  return {
    ...form,
    addons: Array.isArray(form?.addons) ? [...form.addons] : [],
    rentals: Array.isArray(form?.rentals) ? [...form.rentals] : [],
    menuItems: Array.isArray(form?.menuItems) ? [...form.menuItems] : []
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

export default function QuoteCompareModal({
  open,
  onClose,
  form,
  setForm,
  catalog,
  settings,
  styles,
  primaryTotals
}) {
  const [compareForm, setCompareForm] = useState(() => cloneForm(form));
  const [scenarioId, setScenarioId] = useState("better");
  const scenarios = useMemo(
    () => buildQuoteScenarios(form, catalog),
    [form, catalog]
  );
  const scenarioResults = useMemo(
    () => scenarios.map((scenario) => ({
      ...scenario,
      totals: calculateQuote(scenario.form, catalog, settings)
    })),
    [scenarios, catalog, settings]
  );

  useEffect(() => {
    if (open) {
      const initial = scenarios.find((item) => item.id === "better") || scenarios[0];
      setScenarioId(initial?.id || "custom");
      setCompareForm(cloneForm(initial?.form || form));
    }
  }, [open, form, scenarios]);

  const compareTotals = useMemo(
    () => calculateQuote(compareForm, catalog, settings),
    [compareForm, catalog, settings]
  );

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

  const seasonOptions = Array.isArray(settings?.seasonalProfiles) ? settings.seasonalProfiles : [];
  const taxRegionOptions = Array.isArray(settings?.taxRegions) ? settings.taxRegions : [];

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-card compare-card">
        <div className="modal-head">
          <h2>Scenario Compare</h2>
          <button type="button" className="ghost" onClick={onClose}>Close</button>
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
              <label className="field">
                <span>Package</span>
                <select value={compareForm.pkg} onChange={(e) => updateField("pkg", e.target.value)}>
                  {catalog.packages.map((item) => (
                    <option key={item.id} value={item.id}>{item.name} - {currency(item.ppp)}/person</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Service style</span>
                <select value={compareForm.style} onChange={(e) => updateField("style", e.target.value)}>
                  {styles.map((style) => <option key={style} value={style}>{style}</option>)}
                </select>
              </label>
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
              <label className="field">
                <span>Tax region</span>
                <select value={compareForm.taxRegion || ""} onChange={(e) => updateField("taxRegion", e.target.value)}>
                  {taxRegionOptions.map((region) => (
                    <option key={region.id} value={region.id}>
                      {region.name} ({Math.round(Number(region.rate || 0) * 1000) / 10}%)
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Season profile</span>
                <select
                  value={compareForm.seasonProfileId || "auto"}
                  onChange={(e) => updateField("seasonProfileId", e.target.value)}
                >
                  <option value="auto">Auto detect</option>
                  {seasonOptions.map((season) => (
                    <option key={season.id} value={season.id}>{season.name}</option>
                  ))}
                </select>
              </label>
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
