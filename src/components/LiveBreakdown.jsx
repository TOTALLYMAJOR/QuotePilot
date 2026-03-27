import { useEffect, useMemo, useRef, useState } from "react";
import { currency } from "../lib/quoteCalculator";
import { detectBreakdownValueChanges } from "../lib/wizardUi";

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
        <strong>{money(value)}</strong>
        {changed && (
          <small className={`row-delta ${directionClass}`.trim()}>
            {deltaPrefix} {money(Math.abs(delta))}
          </small>
        )}
      </dd>
    </div>
  );
}

export default function LiveBreakdown({ form, totals, settings, catalog }) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const effectTimersRef = useRef([]);
  const animationFrameRef = useRef(0);

  const resolvePricingType = (item, fallback = "per_event") => {
    const raw = String(item?.pricingType || item?.type || "").trim().toLowerCase();
    if (raw === "per_person" || raw === "per_item" || raw === "per_event") return raw;
    return fallback;
  };

  const selectedAddons = catalog.addons
    .filter((item) => form.addons.includes(item.id))
    .map((item) => {
      const pricingType = resolvePricingType(item, "per_person");
      const quantity = pricingType === "per_item" ? Math.max(1, Number(form.addonQuantities?.[item.id] || 1)) : null;
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
    <aside className="panel breakdown-panel" aria-live="polite">
      <div className="breakdown-head">
        <h3>Live Breakdown</h3>
        <p className="muted">Auto-updates as options change.</p>
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
          <h4>🍽 Menu</h4>
          <span>{money(displayValues.package + displayValues.menu + displayValues.addons + displayValues.rentals)}</span>
        </header>
        <dl className="breakdown-money-list">
          <BreakdownMoneyRow
            rowKey="package"
            label="Package"
            value={displayValues.package}
            changed={Boolean(rowEffects.package)}
            delta={rowEffects.package?.delta || 0}
          />
          <BreakdownMoneyRow
            rowKey="menu"
            label="Menu Items"
            value={displayValues.menu}
            changed={Boolean(rowEffects.menu)}
            delta={rowEffects.menu?.delta || 0}
          />
          <BreakdownMoneyRow
            rowKey="addons"
            label="Add-ons"
            value={displayValues.addons}
            changed={Boolean(rowEffects.addons)}
            delta={rowEffects.addons?.delta || 0}
          />
          <BreakdownMoneyRow
            rowKey="rentals"
            label="Rentals"
            value={displayValues.rentals}
            changed={Boolean(rowEffects.rentals)}
            delta={rowEffects.rentals?.delta || 0}
          />
        </dl>
      </section>

      <section className="breakdown-financial-block">
        <header>
          <h4>👨‍🍳 Staff</h4>
          <span>{money(displayValues.labor)}</span>
        </header>
        <dl className="breakdown-money-list">
          <BreakdownMoneyRow
            rowKey="labor"
            label="Labor"
            value={displayValues.labor}
            changed={Boolean(rowEffects.labor)}
            delta={rowEffects.labor?.delta || 0}
          />
          <BreakdownMoneyRow
            rowKey="bartenderLabor"
            label="Bartender Portion"
            value={displayValues.bartenderLabor}
            changed={Boolean(rowEffects.bartenderLabor)}
            delta={rowEffects.bartenderLabor?.delta || 0}
          />
        </dl>
        <p className="source-note">Staffing labor: {staffingLaborEnabled ? "Enabled" : "Disabled"}</p>
      </section>

      <section className="breakdown-financial-block">
        <header>
          <h4>🚚 Travel / Logistics</h4>
          <span>{money(displayValues.travel)}</span>
        </header>
        <dl className="breakdown-money-list">
          <BreakdownMoneyRow
            rowKey="travel"
            label={`Travel (${form.milesRT} mi)`}
            value={displayValues.travel}
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
            value={displayValues.subtotal}
            changed={Boolean(rowEffects.subtotal)}
            delta={rowEffects.subtotal?.delta || 0}
          />
          <BreakdownMoneyRow
            rowKey="serviceFee"
            label={`Service (${Math.round(totals.serviceFeePctApplied * 1000) / 10}%)`}
            value={displayValues.serviceFee}
            changed={Boolean(rowEffects.serviceFee)}
            delta={rowEffects.serviceFee?.delta || 0}
          />
          <BreakdownMoneyRow
            rowKey="tax"
            label={`Tax (${Math.round(totals.taxRateApplied * 1000) / 10}%)`}
            value={displayValues.tax}
            changed={Boolean(rowEffects.tax)}
            delta={rowEffects.tax?.delta || 0}
          />
          <BreakdownMoneyRow
            rowKey="total"
            label="Total"
            value={displayValues.total}
            changed={Boolean(rowEffects.total)}
            delta={rowEffects.total?.delta || 0}
            strong
          />
          <BreakdownMoneyRow
            rowKey="deposit"
            label={`Deposit (${Math.round(settings.depositPct * 100)}%)`}
            value={displayValues.deposit}
            changed={Boolean(rowEffects.deposit)}
            delta={rowEffects.deposit?.delta || 0}
            strong
          />
        </dl>
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
  );
}
