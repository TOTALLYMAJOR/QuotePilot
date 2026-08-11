import { useEffect, useMemo, useRef, useState } from "react";
import { currency, serviceChargeLabel } from "../lib/quoteCalculator";
import { detectBreakdownValueChanges } from "../lib/wizardUi";
import { buildPricingBand } from "./pricingBand";
import { buildMarginAdvisorCard, buildMarginPresentation } from "./marginPresentation";
import DigitRoll from "./DigitRoll";
import DecisionCard from "./DecisionCard";

// Default-off gate for the staff-only margin strip; costs are tenant catalog
// data and margin never renders in any customer-facing projection.
const PILOT_MARGINS_ENABLED = ["1", "true", "yes", "on"].includes(
  String(import.meta.env.VITE_PILOT_MARGINS_ENABLED || "").trim().toLowerCase()
);

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (event) => setReduced(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

function money(value) {
  return currency(Number(value || 0));
}

function BreakdownMoneyRow({ rowKey, label, value, delta = 0, changed = false, strong = false }) {
  const directionClass = delta > 0 ? "delta-up" : delta < 0 ? "delta-down" : "";
  const deltaPrefix = delta > 0 ? "+" : "-";
  return (
    <div
      className={`breakdown-money-row ${changed ? "changed" : ""} ${strong ? "strong" : ""}`.trim()}
      data-row-key={rowKey}
      data-changed={changed ? "true" : "false"}
    >
      <dt>{label}</dt>
      <dd>
        {/* Odometer digits roll on reprice; the row-flash (.changed) and
            delta chip below layer on top of it unchanged. */}
        <strong>
          <DigitRoll value={money(value)} />
        </strong>
        {changed && (
          <small className={`row-delta ${directionClass}`.trim()}>
            {deltaPrefix} {money(Math.abs(delta))}
          </small>
        )}
      </dd>
    </div>
  );
}

function BreakdownCountRow({ rowKey, label, value }) {
  return (
    <div
      className="breakdown-money-row breakdown-count-row"
      data-row-key={rowKey}
      data-changed="false"
    >
      <dt>{label}</dt>
      <dd>
        <strong>{Math.max(0, Number(value || 0))}</strong>
      </dd>
    </div>
  );
}

function BreakdownTextRow({ rowKey, label, value }) {
  return (
    <div
      className="breakdown-money-row breakdown-count-row"
      data-row-key={rowKey}
      data-changed="false"
    >
      <dt>{label}</dt>
      <dd>
        <strong>{value}</strong>
      </dd>
    </div>
  );
}

export default function LiveBreakdown({
  form,
  totals,
  settings,
  catalog,
  mobileExpanded = false,
  onMobileClose,
  guestBand = null
}) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const pricingBand = useMemo(
    () => buildPricingBand({ form, catalog, settings, band: guestBand }),
    [form, catalog, settings, guestBand]
  );
  const margin = useMemo(
    () => (PILOT_MARGINS_ENABLED ? buildMarginPresentation({ form, totals, catalog, settings }) : null),
    [form, totals, catalog, settings]
  );
  const marginAdvisorCard = useMemo(() => buildMarginAdvisorCard(margin), [margin]);
  const effectTimersRef = useRef([]);
  const animationFrameRef = useRef(0);

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

  const selectedAddons = catalog.addons
    .filter((item) => form.addons.includes(item.id))
    .map((item) => {
      const pricingType = resolvePricingType(item, "per_person");
      const quantity = addonSupportsQuantity(item, pricingType)
        ? Math.max(1, Number(form.addonQuantities?.[item.id] || 1))
        : null;
      return {
        id: item.id,
        name: item.name,
        label: quantity ? `${item.name} x${quantity}` : item.name
      };
    });

  const selectedRentals = catalog.rentals
    .filter((item) => form.rentals.includes(item.id))
    .map((item) => {
      const pricingType = resolvePricingType(item, "per_item");
      const fallbackQty = typeof item.qtyRule === "function" ? item.qtyRule(Math.max(0, Number(form.guests || 0))) : 1;
      const quantity = pricingType === "per_item" ? Math.max(1, Number(form.rentalQuantities?.[item.id] || fallbackQty)) : null;
      return {
        id: item.id,
        name: item.name,
        label: quantity ? `${item.name} x${quantity}` : item.name
      };
    });

  const menuLookup = new Map(
    (settings.menuSections || []).flatMap((section) =>
      (section.items || []).map((item) => [item.id, item])
    )
  );
  const selectedMenuItems = (form.menuItems || []).map((id) => {
    const item = menuLookup.get(id);
    const pricingType = resolvePricingType(item, "per_event");
    const quantity = pricingType === "per_item" ? Math.max(1, Number(form.menuItemQuantities?.[id] || 1)) : null;
    const name = item?.name || id;
    return {
      id,
      name,
      label: quantity ? `${name} x${quantity}` : name
    };
  });

  const staffingLaborEnabled = totals.staffingLaborEnabled !== false;
  const staffingChargeMode = String(totals.staffingChargeMode || "per_hour").trim().toLowerCase();
  const staffingChargeModeLabel = staffingChargeMode === "per_event_per_staff"
    ? "Per event x staff count"
    : "Per hour x staff count";
  const formatRateList = (rates, limit = 6) => {
    const safeRates = Array.isArray(rates)
      ? rates
        .map((rate) => Number(rate))
        .filter((rate) => Number.isFinite(rate) && rate >= 0)
      : [];
    if (!safeRates.length) return "";
    const labels = safeRates.map((rate) => money(rate));
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
    : `${money(totals.serverRateApplied)} x ${Math.max(0, Number(totals.servers || 0))}`;
  const chefRatesLabel = chefRatesApplied.length
    ? formatRateList(chefRatesApplied)
    : `${money(totals.chefRateApplied)} x ${Math.max(0, Number(totals.chefs || 0))}`;

  const valueTargets = useMemo(() => {
    const subtotal = totals.base + totals.addons + totals.rentals + totals.menu + totals.labor + totals.travel;
    return {
      package: totals.base,
      addons: totals.addons,
      rentals: totals.rentals,
      menu: totals.menu,
      labor: totals.labor,
      bartenderLabor: totals.bartenderLabor,
      travel: totals.travel,
      subtotal,
      serviceFee: totals.serviceFee,
      tax: totals.tax,
      total: totals.total,
      deposit: totals.deposit
    };
  }, [
    totals.addons,
    totals.base,
    totals.bartenderLabor,
    totals.deposit,
    totals.labor,
    totals.menu,
    totals.rentals,
    totals.serviceFee,
    totals.tax,
    totals.total,
    totals.travel
  ]);

  const [displayValues, setDisplayValues] = useState(valueTargets);
  const [rowEffects, setRowEffects] = useState({});
  const previousValuesRef = useRef(valueTargets);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      effectTimersRef.current.forEach((timerId) => clearTimeout(timerId));
      effectTimersRef.current = [];
    };
  }, []);

  useEffect(() => {
    const previousValues = previousValuesRef.current;
    const changes = detectBreakdownValueChanges(previousValues, valueTargets);
    const changedKeys = Object.keys(changes);
    previousValuesRef.current = valueTargets;

    if (!changedKeys.length) {
      setDisplayValues(valueTargets);
      return;
    }

    setRowEffects((prev) => {
      const next = { ...prev };
      changedKeys.forEach((key) => {
        next[key] = {
          delta: changes[key],
          tick: Date.now() + Math.random()
        };
      });
      return next;
    });

    if (prefersReducedMotion) {
      setDisplayValues(valueTargets);
    } else {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      const fromValues = { ...previousValues };
      const durationMs = 420;
      const startTime = typeof performance !== "undefined" ? performance.now() : Date.now();

      const frame = (now) => {
        const currentTime = typeof now === "number" ? now : Date.now();
        const elapsed = currentTime - startTime;
        const progress = Math.min(1, elapsed / durationMs);
        const eased = 1 - ((1 - progress) ** 3);

        const interpolated = Object.entries(valueTargets).reduce((acc, [key, target]) => {
          const from = Number(fromValues?.[key] || 0);
          const to = Number(target || 0);
          acc[key] = from + ((to - from) * eased);
          return acc;
        }, {});

        setDisplayValues(interpolated);
        if (progress < 1) {
          animationFrameRef.current = requestAnimationFrame(frame);
        } else {
          setDisplayValues(valueTargets);
          animationFrameRef.current = 0;
        }
      };

      animationFrameRef.current = requestAnimationFrame(frame);
    }

    const effectTimer = setTimeout(() => {
      setRowEffects((prev) => {
        const next = { ...prev };
        changedKeys.forEach((key) => {
          delete next[key];
        });
        return next;
      });
    }, 1450);

    effectTimersRef.current.push(effectTimer);
    return () => clearTimeout(effectTimer);
  }, [prefersReducedMotion, valueTargets]);

  return (
    <>
      <p
        className="visually-hidden"
        role="status"
        aria-atomic="true"
        data-pricing-live-status
      >
        Quote total {money(totals.total)}. Deposit {money(totals.deposit)}.
      </p>
      {mobileExpanded && (
        <div
          className="breakdown-mobile-scrim"
          aria-hidden="true"
          onClick={onMobileClose}
        />
      )}
      <aside
        id="live-breakdown"
        className={`panel breakdown-panel ${mobileExpanded ? "is-mobile-expanded" : ""}`.trim()}
        aria-labelledby="live-breakdown-heading"
        aria-describedby="live-breakdown-description"
        role={mobileExpanded ? "dialog" : undefined}
        aria-modal={mobileExpanded ? "true" : undefined}
        tabIndex="-1"
      >
        <div className="breakdown-head">
          <div>
            <h3 id="live-breakdown-heading">Live Breakdown</h3>
            <p className="muted" id="live-breakdown-description">Auto-updates as options change.</p>
          </div>
          <button
            type="button"
            className="ghost breakdown-mobile-close"
            onClick={onMobileClose}
          >
            Close
          </button>
        </div>

      <section className="breakdown-stat-grid">
        <article>
          <small>Guests</small>
          <strong>{totals.guests}</strong>
        </article>
        <article>
          <small>Package</small>
          <strong>{totals.selectedPkg?.name || "-"}</strong>
        </article>
        <article>
          <small>Tax Region</small>
          <strong>{totals.taxRegionName || "-"}</strong>
        </article>
        <article>
          <small>Season</small>
          <strong>{totals.seasonProfileName || "Standard"}</strong>
        </article>
      </section>

      <section className="breakdown-financial-block">
        <header>
          <h4>Menu</h4>
          <span>{money(displayValues.package + displayValues.menu + displayValues.addons + displayValues.rentals)}</span>
        </header>
        <dl className="breakdown-money-list">
          {/* Money rows feed the DigitRoll odometer the FINAL repriced value
              (valueTargets), not the frame-by-frame tweened displayValues —
              the odometer is the row animation and must roll exactly once
              per reprice. Section headers keep the counting tween. */}
          <BreakdownMoneyRow
            rowKey="package"
            label="Package"
            value={valueTargets.package}
            changed={Boolean(rowEffects.package)}
            delta={rowEffects.package?.delta || 0}
          />
          <BreakdownMoneyRow
            rowKey="menu"
            label="Menu Items"
            value={valueTargets.menu}
            changed={Boolean(rowEffects.menu)}
            delta={rowEffects.menu?.delta || 0}
          />
          <BreakdownMoneyRow
            rowKey="addons"
            label="Add-ons"
            value={valueTargets.addons}
            changed={Boolean(rowEffects.addons)}
            delta={rowEffects.addons?.delta || 0}
          />
          <BreakdownMoneyRow
            rowKey="rentals"
            label="Rentals"
            value={valueTargets.rentals}
            changed={Boolean(rowEffects.rentals)}
            delta={rowEffects.rentals?.delta || 0}
          />
        </dl>
      </section>

      <section className="breakdown-financial-block">
        <header>
          <h4>Staff</h4>
          <span>{money(displayValues.labor)}</span>
        </header>
        <dl className="breakdown-money-list">
          <BreakdownMoneyRow
            rowKey="labor"
            label="Labor"
            value={valueTargets.labor}
            changed={Boolean(rowEffects.labor)}
            delta={rowEffects.labor?.delta || 0}
          />
          <BreakdownMoneyRow
            rowKey="bartenderLabor"
            label="Bartender Portion"
            value={valueTargets.bartenderLabor}
            changed={Boolean(rowEffects.bartenderLabor)}
            delta={rowEffects.bartenderLabor?.delta || 0}
          />
          <BreakdownCountRow rowKey="serversCount" label="Servers (count)" value={totals.servers} />
          <BreakdownCountRow rowKey="chefsCount" label="Chefs (count)" value={totals.chefs} />
          <BreakdownCountRow rowKey="bartendersCount" label="Bartenders (count)" value={totals.bartenders} />
          {staffingLaborEnabled && hasCustomServerMix && Math.max(0, Number(totals.servers || 0)) > 0 && (
            <BreakdownTextRow rowKey="serverRatesApplied" label="Server Rates" value={serverRatesLabel} />
          )}
          {staffingLaborEnabled && hasCustomChefMix && Math.max(0, Number(totals.chefs || 0)) > 0 && (
            <BreakdownTextRow rowKey="chefRatesApplied" label="Chef Rates" value={chefRatesLabel} />
          )}
        </dl>
        <p className="source-note">
          Staffing labor: {staffingLaborEnabled ? "Enabled" : "Disabled"} • Charge mode: {staffingChargeModeLabel}
        </p>
      </section>

      <section className="breakdown-financial-block">
        <header>
          <h4>Travel / Logistics</h4>
          <span>{money(displayValues.travel)}</span>
        </header>
        <dl className="breakdown-money-list">
          <BreakdownMoneyRow
            rowKey="travel"
            label={`Travel (${form.milesRT} mi)`}
            value={valueTargets.travel}
            changed={Boolean(rowEffects.travel)}
            delta={rowEffects.travel?.delta || 0}
          />
        </dl>
      </section>

      <section className="breakdown-financial-block totals">
        <header>
          <h4>Totals</h4>
          <span>{money(displayValues.total)}</span>
        </header>
        <dl className="breakdown-money-list">
          <BreakdownMoneyRow
            rowKey="subtotal"
            label="Subtotal"
            value={valueTargets.subtotal}
            changed={Boolean(rowEffects.subtotal)}
            delta={rowEffects.subtotal?.delta || 0}
          />
          <BreakdownMoneyRow
            rowKey="serviceFee"
            label={serviceChargeLabel(totals.serviceFeePctApplied)}
            value={valueTargets.serviceFee}
            changed={Boolean(rowEffects.serviceFee)}
            delta={rowEffects.serviceFee?.delta || 0}
          />
          <BreakdownMoneyRow
            rowKey="tax"
            label={`Tax (${Math.round(totals.taxRateApplied * 1000) / 10}%)`}
            value={valueTargets.tax}
            changed={Boolean(rowEffects.tax)}
            delta={rowEffects.tax?.delta || 0}
          />
          <BreakdownMoneyRow
            rowKey="total"
            label="Total"
            value={valueTargets.total}
            changed={Boolean(rowEffects.total)}
            delta={rowEffects.total?.delta || 0}
            strong
          />
          <BreakdownMoneyRow
            rowKey="deposit"
            label={`Deposit (${Math.round(settings.depositPct * 100)}%)`}
            value={valueTargets.deposit}
            changed={Boolean(rowEffects.deposit)}
            delta={rowEffects.deposit?.delta || 0}
            strong
          />
        </dl>
        {pricingBand && (
          <div className="pricing-band" data-pricing-band={pricingBand.modelId}>
            <p className="pricing-band-figures">
              <span className="pricing-band-label">Estimated range</span>
              <strong>{money(pricingBand.lowTotal)} – {money(pricingBand.highTotal)}</strong>
            </p>
            <p className="pricing-band-figures">
              <span className="pricing-band-label">Deposit range</span>
              <strong>{money(pricingBand.lowDeposit)} – {money(pricingBand.highDeposit)}</strong>
            </p>
            {PILOT_MARGINS_ENABLED && pricingBand.margin && (
              <p className="pricing-band-figures">
                <span className="pricing-band-label">Margin range</span>
                <strong>
                  {/* Margin % does not necessarily move the same direction as
                      guest count (fixed costs amortize differently), so sort
                      for display rather than assuming low-guests -> low-%. */}
                  {(Math.min(pricingBand.margin.lowPct, pricingBand.margin.highPct) * 100).toFixed(1)}%
                  {" – "}
                  {(Math.max(pricingBand.margin.lowPct, pricingBand.margin.highPct) * 100).toFixed(1)}%
                </strong>
              </p>
            )}
            <p className="pricing-band-note">
              {pricingBand.note} Saving always prices the exact recorded count.
            </p>
          </div>
        )}
        {margin && (
          <div className="margin-strip" data-margin={margin.modelId} data-margin-available={margin.available ? "true" : "false"}>
            {margin.available ? (
              <>
                <p className="pricing-band-figures">
                  <span className="pricing-band-label">Margin</span>
                  <strong>{(margin.marginPct * 100).toFixed(1)}%</strong>
                </p>
                {margin.targetNote && !marginAdvisorCard && <p className="pricing-band-note margin-target">{margin.targetNote}</p>}
                <p className="pricing-band-note">{margin.note}</p>
              </>
            ) : (
              <p className="pricing-band-note">{margin.note}</p>
            )}
          </div>
        )}
        {marginAdvisorCard && (
          <div className="now-stream margin-advisor-stream">
            <DecisionCard {...marginAdvisorCard} />
          </div>
        )}
      </section>

      <section className="breakdown-selection-groups">
        <div>
          <strong>Selected Add-ons</strong>
          <p>{selectedAddons.map((item) => item.label).join(", ") || "-"}</p>
        </div>
        <div>
          <strong>Selected Rentals</strong>
          <p>{selectedRentals.map((item) => item.label).join(", ") || "-"}</p>
        </div>
        <div>
          <strong>Selected Menu Items</strong>
          <p>{selectedMenuItems.map((item) => item.label).join(", ") || "-"}</p>
        </div>
      </section>
      </aside>
    </>
  );
}
