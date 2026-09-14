import { CurrencyDollar, FileText, Package, UsersThree } from "./ProductIcons";
import "./fulfillmentIntelligence.css";

const ROLE_LABELS = Object.freeze({
  lead: "Leads",
  server: "Servers",
  chef: "Chefs",
  bartender: "Bartenders"
});

const EVIDENCE_STATE_LABELS = Object.freeze({
  available: "Available",
  current: "Current",
  complete: "Ready",
  supported: "Supported",
  conditional: "Conditional",
  unverifiable: "More information needed",
  partial: "Some details missing",
  loading: "Checking",
  stale: "Needs refresh",
  missing: "Unavailable",
  not_applicable: "Not needed",
  not_yet_available: "Still checking",
  blocked_by_integration: "Connection needs attention",
  contradictory: "Details conflict",
  schema_drift: "Update needed",
  failed: "Failed",
  error: "Failed",
  unavailable: "Unavailable",
  unknown: "Unknown"
});

function text(value) {
  return String(value ?? "").trim();
}

function exactCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function stateOf(value, fallback = "missing") {
  const state = typeof value === "string"
    ? text(value).toLowerCase()
    : text(value?.evidenceState || value?.state).toLowerCase();
  return state || fallback;
}

function stateLabel(value, availableLabel = "Available") {
  const state = stateOf(value);
  if (state === "available") return availableLabel;
  return EVIDENCE_STATE_LABELS[state] || "Unknown";
}

function capabilityState({ fulfillment, updating, retained }) {
  if (retained) return "stale";
  if (updating) return "loading";
  if (fulfillment?.state === "complete") return "success";
  return fulfillment?.state || "empty";
}

function pluralGuests(value) {
  return `${value} guest${value === 1 ? "" : "s"}`;
}

function formatMoney(value) {
  const amountMinor = exactCount(value?.amountMinor);
  if (amountMinor === null) return "Unavailable";
  const currency = /^[A-Z]{3}$/u.test(text(value?.currency).toUpperCase())
    ? text(value.currency).toUpperCase()
    : "USD";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2
    }).format(amountMinor / 100);
  } catch {
    return "Unavailable";
  }
}

function formatMajorMoney(amount, currencyValue) {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "Unavailable";
  const currency = /^[A-Z]{3}$/u.test(text(currencyValue).toUpperCase())
    ? text(currencyValue).toUpperCase()
    : null;
  if (!currency) return "Unavailable";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  } catch {
    return "Unavailable";
  }
}

function formatSignedMajorMoney(amount, currencyValue) {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "Impact unavailable";
  if (amount === 0) return "No change";
  return `${amount > 0 ? "+" : "−"}${formatMajorMoney(Math.abs(amount), currencyValue)}`;
}

function formatMicros(value, unitId = "") {
  const exact = exactCount(value);
  if (exact === null) return "Unavailable";
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 6
  }).format(exact / 1_000_000);
  return `${formatted}${text(unitId) ? ` ${text(unitId)}` : ""}`;
}

function coverageValue(scenario) {
  if (!scenario || scenario.coverageState === "unknown") return "Still checking";
  const assigned = exactCount(scenario.totalAssigned);
  const required = exactCount(scenario.totalRequired);
  return assigned === null || required === null ? "Still checking" : `${assigned} / ${required}`;
}

function proposedCoverageValue(scenario) {
  const assigned = exactCount(scenario?.totalAssigned);
  const required = exactCount(scenario?.totalRequired);
  return assigned === null || required === null
    ? "Still checking"
    : `${assigned} current / ${required} required`;
}

function coverageCaption(scenario, domain) {
  if (!scenario || scenario.coverageState === "unknown") {
    return domain === "people" ? "Staffing has not been checked" : "Stock has not been checked";
  }
  if (["shortage", "gap", "attention"].includes(scenario.coverageState)) {
    const gap = exactCount(scenario.totalGap ?? scenario.shortageCount);
    if (gap === null) return `${domain === "people" ? "Coverage" : "Supply"} needs attention`;
    return `${gap} ${domain === "people" ? "role" : "ingredient"} gap${gap === 1 ? "" : "s"}`;
  }
  if (scenario.coverageState === "not_required") return "No additional roles required";
  return domain === "people" ? "Required roles assigned" : "Required amount covered";
}

function supplyCoverage(scenario) {
  if (scenario?.coverageState === "covered") return "Covered";
  if (scenario?.coverageState === "shortage") return "Shortage";
  return "Still checking";
}

function headroomValue(headroom) {
  if (stateOf(headroom) !== "available") return "Unavailable";
  const safeIncrease = exactCount(headroom?.safeGuestIncrease);
  return safeIncrease === null ? "Unavailable" : `+${pluralGuests(safeIncrease)}`;
}

function headroomCaption(headroom) {
  const state = stateOf(headroom);
  if (state !== "available") {
    return ({
      missing: "Guest limit is not available.",
      not_applicable: "No guest limit applies.",
      not_yet_available: "Guest limit is still being checked.",
      blocked_by_integration: "Guest limit cannot be checked right now.",
      contradictory: "Guest limits conflict and need review.",
      schema_drift: "Guest limit needs an update.",
      stale: "Guest limit needs a refresh.",
      failed: "Guest limit could not be checked.",
      unavailable: "Guest limit is unavailable."
    })[state] || "A current guest limit is required.";
  }
  const nextAt = exactCount(headroom?.nextBoundary?.atGuestCount);
  const distance = exactCount(headroom?.guestsUntilBoundary);
  if (nextAt !== null && distance !== null) {
    return `Next change at ${nextAt} · ${pluralGuests(distance)} away`;
  }
  const safeThrough = exactCount(headroom?.safeThroughGuestCount);
  return safeThrough === null ? "Guest limit available" : `Covered through ${safeThrough} guests`;
}

function evidenceDetail(state, availableCopy, unknownCopy) {
  const normalized = stateOf(state);
  if (["available", "current"].includes(normalized)) return availableCopy;
  return `${stateLabel(normalized)} · ${unknownCopy}`;
}

function roleRows(people) {
  const current = people?.current?.byRole || {};
  const proposed = people?.proposed?.byRole || {};
  const backups = people?.resilience?.eligibleBackupCountByRole || {};
  return Object.keys(ROLE_LABELS).flatMap((role) => {
    const currentRequired = exactCount(current[role]?.required);
    const currentAssigned = exactCount(current[role]?.assigned);
    const proposedRequired = exactCount(proposed[role]?.required);
    const proposedAssigned = exactCount(proposed[role]?.assigned);
    const backupCount = exactCount(backups[role]);
    if ([currentRequired, currentAssigned, proposedRequired, proposedAssigned, backupCount]
      .every((value) => value === null)) return [];
    return [{
      role,
      label: ROLE_LABELS[role],
      currentRequired,
      currentAssigned,
      proposedRequired,
      proposedAssigned,
      backups: backupCount
    }];
  });
}

function shortageRows(supply) {
  const rows = Array.isArray(supply?.proposed?.shortages) ? supply.proposed.shortages : [];
  return rows.filter((row) => text(row?.resourceId || row?.resourceLabel));
}

function constraintResource(constraint) {
  return text(
    constraint?.resource?.resourceLabel
    || constraint?.resource?.resourceId
    || ROLE_LABELS[constraint?.role]
    || constraint?.role
    || constraint?.domain
  ) || "Item needing review";
}

function firstSupplyConstraint(projection) {
  const shortages = shortageRows(projection?.fulfillment?.supply);
  if (shortages[0]) {
    return {
      kind: "inventory_shortage",
      resourceId: text(shortages[0].resourceId),
      resourceLabel: text(shortages[0].resourceLabel || shortages[0].resourceId) || "Ingredient",
      shortageQuantityMicros: exactCount(shortages[0].shortageQuantityMicros),
      unitId: text(shortages[0].unitId)
    };
  }
  const constraints = Array.isArray(projection?.fulfillment?.constraints)
    ? projection.fulfillment.constraints
    : [];
  const supplyConstraint = constraints.find((constraint) => constraint?.domain === "supply");
  if (!supplyConstraint) return null;
  return {
    kind: text(supplyConstraint.kind) || "supply_constraint",
    resourceId: text(supplyConstraint.resource?.resourceId),
    resourceLabel: constraintResource(supplyConstraint),
    shortageQuantityMicros: exactCount(supplyConstraint.quantity),
    unitId: text(supplyConstraint.resource?.unitId)
  };
}

function shortageIngredient(projection, resourceId) {
  const ingredients = Array.isArray(projection?.consequences?.inventory?.ingredients)
    ? projection.consequences.inventory.ingredients
    : [];
  return ingredients.find((row) => text(row?.ingredientId) === text(resourceId)) || null;
}

function overallValue(fulfillment) {
  return headroomValue(fulfillment?.fulfillmentHeadroom);
}

function limitingCaption(fulfillment) {
  if (fulfillment?.limitingDomain === "multiple") {
    return "People and Supply reach the same first boundary.";
  }
  const resource = text(
    fulfillment?.limitingResource?.resourceLabel
    || fulfillment?.limitingResource?.resourceId
    || ROLE_LABELS[fulfillment?.limitingResource?.role]
    || fulfillment?.limitingResource?.role
  );
  if (fulfillment?.limitingDomain === "supply") return `${resource || "Supply"} sets the current limit.`;
  if (fulfillment?.limitingDomain === "people") return `${resource || "People"} sets the current limit.`;
  return "A guest limit is unavailable until both staffing and supply are current.";
}

function EvidenceState({ value, availableLabel = "Available" }) {
  const state = stateOf(value);
  return (
    <span className="fulfillment-intelligence__evidence-state" data-evidence-state={state}>
      {stateLabel(state, availableLabel)}
    </span>
  );
}

function BoundaryQuality({ label, headroom }) {
  return (
    <div className="fulfillment-intelligence__boundary-quality" data-boundary-state={stateOf(headroom)}>
      <span>{label} capacity</span>
      <strong>{headroomValue(headroom)}</strong>
      <small>{stateLabel(headroom, "Current")}</small>
    </div>
  );
}

function decisionHeadline(answer) {
  const guestCount = exactCount(answer?.guestCount);
  const guestLabel = guestCount === null ? "This scenario" : pluralGuests(guestCount);
  if (answer?.state === "supported") {
    return `${guestLabel} is supported by the current staffing and supply details`;
  }
  if (answer?.state === "conditional") {
    return `${guestLabel} is conditionally supportable`;
  }
  return `${guestLabel} cannot be confirmed yet`;
}

function supplyDecisionCopy(answer) {
  const constraint = answer?.supplyConstraint;
  const shortage = exactCount(constraint?.shortageQuantityMicros);
  const ingredient = text(constraint?.ingredientLabel || constraint?.ingredientId) || "Ingredient";
  const shortageLabel = shortage === null
    ? "an unquantified amount"
    : formatMicros(shortage, constraint?.unitId);
  if (!constraint) return "No supply issue is listed for this option.";
  const contributions = constraint?.causalityState === "available"
    && Array.isArray(constraint?.contributingMenuItems)
    ? constraint.contributingMenuItems.map((item) => text(item?.label)).filter(Boolean)
    : [];
  if (contributions.length === 1) {
    return `${contributions[0]} leaves ${ingredient} ${shortageLabel} short.`;
  }
  if (contributions.length > 1) {
    return `${contributions.join(", ")} together leave ${ingredient} ${shortageLabel} short.`;
  }
  const guestCount = exactCount(answer?.guestCount);
  return `${guestCount === null ? "This option" : `At ${pluralGuests(guestCount)}`}, ${ingredient} is ${shortageLabel} short. The menu item causing the shortage is not available.`;
}

function sourcingDecisionCopy(resolution) {
  if (resolution?.evidenceState === "available"
    && resolution?.selectionState === "unique_policy_match"
    && text(resolution?.supplierLabel)) {
    const coverageQuantity = exactCount(resolution?.coverageQuantityMicros);
    const purchaseQuantity = exactCount(resolution?.purchaseQuantityMicros);
    const coverageLabel = formatMicros(
      coverageQuantity,
      resolution?.unitId
    );
    const purchaseLabel = formatMicros(
      purchaseQuantity,
      resolution?.unitId
    );
    if (purchaseQuantity !== null && coverageQuantity !== null && purchaseQuantity !== coverageQuantity) {
      return `Policy-selected current option: purchase ${purchaseLabel} from ${text(resolution.supplierLabel)}; ${coverageLabel} covers this shortfall.`;
    }
    const quantity = purchaseQuantity === null ? coverageLabel : purchaseLabel;
    return `Policy-selected current option: purchase ${quantity} from ${text(resolution.supplierLabel)}.`;
  }
  if (resolution?.selectionState === "tie") {
    return "No unique sourcing resolution is established. Compare eligible sourcing options in Inventory.";
  }
  if (resolution?.selectionState === "policy_missing") {
    return "A current sourcing policy is required before an option can be selected.";
  }
  if (resolution?.selectionState === "no_eligible_offer") {
    return "No current eligible sourcing offer covers this shortfall.";
  }
  return "No preferred replacement has been selected. Review Inventory.";
}

function staffingDecisionCopy(staffing) {
  if (staffing?.effect === "current_assignments_cover_proposed_requirement") {
    return "Current assignments cover the proposed staffing requirement.";
  }
  if (staffing?.effect === "additional_assignments_required") {
    const gap = exactCount(staffing?.assignmentGap);
    return gap === null
      ? "Additional staffing assignments are required."
      : `${gap} additional staffing assignment${gap === 1 ? " is" : "s are"} required.`;
  }
  return "Still checking staffing.";
}

function beoDecisionCopy(beo) {
  if (["stale", "review_required"].includes(beo?.effect)) return "BEO review is required.";
  if (beo?.effect === "no_declared_dependency") return "No BEO update is listed.";
  return "BEO impact has not been checked.";
}

function staffingPrimary(answer, proposedPeople) {
  const deltas = Array.isArray(answer?.staffing?.requirementDeltaByRole)
    ? answer.staffing.requirementDeltaByRole
    : [];
  if (deltas.length) {
    for (const entry of deltas) {
      const role = text(entry?.role);
      const delta = exactCount(entry?.delta);
      if (delta !== null && delta > 0) {
        const label = ROLE_LABELS[role] || `${role}s`;
        return `+${delta} ${label.toLowerCase()} required`;
      }
    }
  }
  const gap = exactCount(answer?.staffing?.assignmentGap)
    ?? exactCount(proposedPeople?.totalGap);
  if (gap === 0) return "Current assignments are sufficient";
  if (gap !== null) return `${gap} additional assignment${gap === 1 ? "" : "s"} required`;
  return staffingDecisionCopy(answer?.staffing);
}

function DecisionAnswer({ answer, projection, updating, retained, onOpenInventory, onOpenStaffing }) {
  if (retained) {
    return (
      <section
        className="fulfillment-intelligence__decision"
        data-decision-state="stale"
        data-sourcing-state="withheld"
        aria-labelledby="fulfillment-decision-answer-title"
        aria-live="polite"
      >
        <header>
          <div>
            <p className="csw-kicker">Can we support this change?</p>
            <h4 id="fulfillment-decision-answer-title">Checking</h4>
          </div>
          <EvidenceState value="stale" />
        </header>
        <p className="fulfillment-intelligence__decision-boundary">
          The previous result does not apply to this option. Please wait for the updated price, staffing, supply, and BEO review.
        </p>
      </section>
    );
  }
  if (!answer || typeof answer !== "object") {
    return (
      <section
        className="fulfillment-intelligence__decision"
        data-decision-state={updating ? "updating" : "unverifiable"}
        aria-labelledby="fulfillment-decision-answer-title"
        aria-live="polite"
      >
        <header><div>
          <p className="csw-kicker">Can we support this change?</p>
          <h4 id="fulfillment-decision-answer-title">{updating ? "Checking" : "Not yet"}</h4>
          <p className="fulfillment-intelligence__decision-reason">
            {updating ? "Checking price, staffing, supply, and BEO impact." : "More information is needed before this change can be reviewed."}
          </p>
        </div></header>
      </section>
    );
  }
  const supplyConstraint = answer.supplyConstraint;
  const sourcing = answer.sourcingResolution || {};
  const commercialValue = answer.commercialValue || {};
  const commercialValueLabel = commercialValue.evidenceState === "available"
    ? formatMajorMoney(commercialValue.amount, commercialValue.currency)
    : "Unavailable";
  const addedCostLabel = sourcing.evidenceState === "available"
    && exactCount(sourcing.addedCostMinor) !== null
    ? formatMoney({ amountMinor: sourcing.addedCostMinor, currency: sourcing.currency })
    : null;
  const conditions = Array.isArray(sourcing.conditions) ? sourcing.conditions.filter(Boolean) : [];
  const commercial = projection?.consequences?.commercial || {};
  const proposedSupply = projection?.fulfillment?.supply?.proposed || {};
  const proposedPeople = projection?.fulfillment?.people?.proposed || {};
  const answerState = ["supported", "conditional"].includes(answer.state)
    ? answer.state
    : "unverifiable";
  const answerLabel = answerState === "supported"
    ? "Supported"
    : answerState === "conditional" ? "Conditional" : "Not yet";
  const commercialDelta = commercial.evidenceState === "available"
    ? formatSignedMajorMoney(commercial.total?.delta, commercial.currency)
    : "Impact unavailable";
  const shortage = answer.supplyConstraint;
  const supplyPrimary = shortage
    ? supplyDecisionCopy(answer)
    : proposedSupply.coverageState === "covered"
      ? "Required ingredients are covered"
      : "Still checking supply";

  return (
    <section
      className="fulfillment-intelligence__decision"
      data-decision-state={text(answer.state) || "unverifiable"}
      data-sourcing-state={text(sourcing.selectionState) || "none"}
      aria-labelledby="fulfillment-decision-answer-title"
      aria-live="polite"
    >
      <header>
        <div>
          <p className="csw-kicker">Can we support this change?</p>
          <h4 id="fulfillment-decision-answer-title">{answerLabel}</h4>
          <p className="fulfillment-intelligence__decision-reason">{decisionHeadline(answer)}</p>
        </div>
        <EvidenceState value={answer.state === "supported" ? "available" : answer.state} availableLabel="Supported" />
      </header>
      <p className="fulfillment-intelligence__decision-boundary">
        For planning only. The quote is not accepted or booked, and the event is not marked ready.
      </p>

      <div className="fulfillment-intelligence__decision-grid">
        <article
          data-decision-clause="commercial"
          data-value-state={commercial.evidenceState === "available" ? "available" : "unavailable"}
        >
          <div className="fulfillment-intelligence__clause-icon" aria-hidden="true"><CurrencyDollar size={22} /></div>
          <div><span>Commercial</span>
          <strong>{commercialDelta}</strong>
          <small>Proposed quote: {commercialValueLabel}</small>
          <small>Margin unavailable because costs are incomplete.</small></div>
        </article>

        <article data-decision-clause="staffing">
          <div className="fulfillment-intelligence__clause-icon" aria-hidden="true"><UsersThree size={22} /></div>
          <div><span>People</span>
          <strong>{staffingPrimary(answer, proposedPeople)}</strong>
          <small>{answer?.staffing?.assignmentGap === null || answer?.staffing?.assignmentGap === undefined
            ? "No staffing conclusion yet."
            : staffingDecisionCopy(answer.staffing)}</small>
          {answer?.staffing?.reviewEffect && ["stale", "review_required"].includes(answer.staffing.reviewEffect) ? (
            <small>Staffing needs review.</small>
          ) : null}</div>
        </article>

        <article data-decision-clause="supply" data-evidence-state={stateOf(sourcing)}>
          <div className="fulfillment-intelligence__clause-icon" aria-hidden="true"><Package size={22} /></div>
          <div><span>Supply</span>
          <strong>{supplyPrimary}</strong>
          {shortage ? <small>Stock remains short until the missing amount is received.</small> : null}
          {shortage ? <small>{sourcingDecisionCopy(sourcing)}</small> : null}
          {addedCostLabel ? <small>Recorded added cost: {addedCostLabel}.</small> : null}
          {conditions.length ? (
            <ul aria-label="Sourcing conditions">
              {conditions.map((condition, index) => <li key={`${condition}-${index}`}>{condition}</li>)}
            </ul>
          ) : null}</div>
        </article>

        <article data-decision-clause="execution">
          <div className="fulfillment-intelligence__clause-icon" aria-hidden="true"><FileText size={22} /></div>
          <div><span>Execution</span>
          <strong>{beoDecisionCopy(answer.beo)}</strong>
          {Array.isArray(answer?.beo?.dependentNodeIds) && answer.beo.dependentNodeIds.length ? (
            <small>{answer.beo.dependentNodeIds.length} BEO item{answer.beo.dependentNodeIds.length === 1 ? "" : "s"} affected.</small>
          ) : null}
          <small>Final count has not been checked for this change.</small></div>
        </article>
      </div>

      <div className="fulfillment-intelligence__decision-actions">
        {supplyConstraint && typeof onOpenInventory === "function" ? (
          <button type="button" onClick={onOpenInventory}>Open inventory</button>
        ) : null}
        {typeof onOpenStaffing === "function" ? (
          <button type="button" onClick={onOpenStaffing}>Open staffing</button>
        ) : null}
      </div>
    </section>
  );
}

function RoleCoverage({ people }) {
  const rows = roleRows(people);
  if (!rows.length) {
    return <p className="fulfillment-intelligence__quiet">Staffing by role is not available.</p>;
  }
  return (
    <details className="fulfillment-intelligence__details">
      <summary>Staffing by role and backups</summary>
      <table className="fulfillment-intelligence__role-table">
        <caption className="visually-hidden">Current and proposed staffing coverage by role</caption>
        <thead>
          <tr>
            <th scope="col">Role</th>
            <th scope="col">Current</th>
            <th scope="col">Proposed need</th>
            <th scope="col">Backups</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.role}>
              <th scope="row">{row.label}</th>
              <td data-label="Current">{row.currentAssigned ?? "—"} / {row.currentRequired ?? "—"}</td>
              <td data-label="Proposed need">{row.proposedAssigned ?? "—"} current / {row.proposedRequired ?? "—"} required</td>
              <td data-label="Backups">{row.backups ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function ShortageList({ supply }) {
  const shortages = shortageRows(supply);
  if (!shortages.length) return null;
  return (
    <div className="fulfillment-intelligence__shortage-block">
      <h5>{shortages.length} proposed shortage{shortages.length === 1 ? "" : "s"}</h5>
      <ul className="fulfillment-intelligence__shortages">
        {shortages.map((row, index) => (
          <li key={`${text(row.resourceId || row.resourceLabel)}-${index}`}>
            <strong>{text(row.resourceLabel || row.resourceId)}</strong>
            <span>{formatMicros(row.shortageQuantityMicros, row.unitId)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConstraintStack({ constraints }) {
  const ordered = Array.isArray(constraints) ? constraints : [];
  return (
    <section className="fulfillment-intelligence__constraint-stack" aria-labelledby="fulfillment-constraint-stack-title">
      <header>
        <div>
          <p className="csw-kicker">Priorities</p>
          <h4 id="fulfillment-constraint-stack-title">What needs attention first</h4>
        </div>
        <span>{ordered.length ? `${ordered.length} item${ordered.length === 1 ? "" : "s"}` : "Nothing listed"}</span>
      </header>
      {ordered.length ? (
        <ol className="fulfillment-intelligence__constraints">
          {ordered.map((constraint, index) => {
            const rank = exactCount(constraint?.rank) || index + 1;
            const quantity = exactCount(constraint?.quantity);
            const quantityLabel = quantity === null
              ? ""
              : constraint?.domain === "supply"
                ? formatMicros(quantity, constraint?.resource?.unitId)
                : String(quantity);
            const atGuestCount = exactCount(constraint?.atGuestCount);
            return (
              <li
                key={`${rank}-${constraint?.domain || "constraint"}-${constraint?.kind || index}-${constraintResource(constraint)}`}
                data-rank={rank}
                data-domain={constraint?.domain || "unknown"}
                data-severity={constraint?.severity || "informational"}
              >
                <span aria-hidden="true">{rank}</span>
                <div>
                  <strong>{constraintResource(constraint)}</strong>
                  <p>{constraint?.domain === "supply"
                    ? "Inventory shortage"
                    : constraint?.domain === "people" ? "Staffing gap" : "Review required"}</p>
                  {quantityLabel || atGuestCount !== null ? (
                    <small>
                      {[quantityLabel, atGuestCount !== null ? `at ${atGuestCount} guests` : ""]
                        .filter(Boolean).join(" · ")}
                    </small>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="fulfillment-intelligence__quiet">No current issue is listed.</p>
      )}
    </section>
  );
}

function ConstraintExplanation({
  projection,
  activeScenario,
  constraint,
  onUseSafeThrough
}) {
  if (!constraint) return null;
  const inventoryHeadroom = projection?.fulfillment?.supply?.inventoryHeadroom || {};
  const safeThrough = stateOf(inventoryHeadroom) === "available"
    ? exactCount(inventoryHeadroom.safeThroughGuestCount)
    : null;
  const firstBoundary = exactCount(inventoryHeadroom?.nextBoundary?.atGuestCount);
  const ingredient = shortageIngredient(projection, constraint.resourceId);
  const required = exactCount(ingredient?.requiredQuantityMicros?.proposedAfter);
  const shortage = exactCount(
    ingredient?.shortageQuantityMicros?.proposedAfter
    ?? constraint.shortageQuantityMicros
  );
  const activeGuestCount = exactCount(activeScenario?.guestCount);
  return (
    <div
      id="csw-constraint-explanation"
      className="csw-constraint-explanation fulfillment-intelligence__constraint-explanation"
      data-scenario-id={activeScenario?.scenarioId}
      data-scenario-generation={activeScenario?.generation}
    >
      <h4>Why {constraint.resourceLabel} is limiting</h4>
      <p>
        {required !== null
          ? `Required amount: ${formatMicros(required, constraint.unitId)}. `
          : "Inventory shows a shortage. "}
        {shortage !== null
          ? `The recorded shortfall is ${formatMicros(shortage, constraint.unitId)}.`
          : "The shortage amount is unavailable."}
      </p>
      {safeThrough !== null ? (
        <p>
          Stock is covered through {safeThrough} guests
          {firstBoundary !== null ? `; the first shortage appears at ${firstBoundary}` : ""}.
        </p>
      ) : (
        <p>A covered guest count is not available.</p>
      )}
      <p>This review does not reserve stock, choose a substitute, or create a purchase order.</p>
      {safeThrough !== null
        && safeThrough !== activeGuestCount
        && typeof onUseSafeThrough === "function" ? (
          <div className="csw-constraint-actions">
            <button type="button" onClick={() => onUseSafeThrough(safeThrough)}>
              Try {safeThrough} guests
            </button>
          </div>
        ) : null}
    </div>
  );
}

function SourceRevisions({ fulfillment }) {
  return (
    <details className="fulfillment-intelligence__authority">
      <summary>What this review can change</summary>
      <p>This comparison does not change the quote, assign staff, reserve stock, update the BEO, or contact the customer.</p>
    </details>
  );
}

/**
 * Layer 3 presenter for the Living Commercial Twin's deterministic Fulfillment
 * projection. It selects and formats already-projected fields only. All reads,
 * recomputation, persistence, and domain mutations remain caller-owned.
 */
export default function FulfillmentIntelligence({
  projection,
  activeScenario,
  updating = false,
  retained = false,
  constraintOpen = false,
  onToggleConstraint,
  onUseSafeThrough,
  onOpenStaffing,
  onOpenInventory,
  onRefreshStaffing
}) {
  const fulfillment = projection?.fulfillment || {};
  const people = fulfillment.people || {};
  const supply = fulfillment.supply || {};
  const constraint = firstSupplyConstraint(projection);
  const backupCount = exactCount(people?.resilience?.eligibleProfileCount);
  const state = capabilityState({ fulfillment, updating, retained });

  return (
    <aside
      className="csw-consequence-rail fulfillment-intelligence"
      data-capability-id="living-commercial-twin-fulfillment"
      data-capability-state={state}
      data-projection-state={fulfillment.state}
      data-constraint-state={fulfillment.constraintState}
      data-authority="presentation-only"
      aria-labelledby="fulfillment-intelligence-title"
      aria-busy={updating || undefined}
    >
      <h3 id="fulfillment-intelligence-title" className="visually-hidden">Change review</h3>

      <DecisionAnswer
        answer={projection?.decisionAnswer}
        projection={projection}
        updating={updating}
        retained={retained}
        onOpenInventory={onOpenInventory}
        onOpenStaffing={onOpenStaffing}
      />

      <details className="fulfillment-intelligence__evidence-shell">
        <summary>Why this answer</summary>
        <div className="fulfillment-intelligence__evidence-body">
          <section
            className="fulfillment-intelligence__overall"
            data-domain="overall"
            data-evidence-state={stateOf(fulfillment.fulfillmentHeadroom)}
            aria-live="polite"
          >
        <header>
          <span>Guest-count flexibility</span>
          <EvidenceState value={fulfillment.fulfillmentHeadroom} availableLabel="Current" />
        </header>
        <strong className="fulfillment-intelligence__primary">{overallValue(fulfillment)}</strong>
        <p>{limitingCaption(fulfillment)}</p>
        <div className="fulfillment-intelligence__boundary-grid" aria-label="Staffing and supply limits">
          <BoundaryQuality label="People" headroom={people.staffingHeadroom} />
          <BoundaryQuality label="Supply" headroom={supply.inventoryHeadroom} />
        </div>
        <small>
          {stateOf(fulfillment.fulfillmentHeadroom) === "available"
            ? "The smaller current limit applies. This review reserves neither people nor stock."
            : "Unavailable details do not mean there is no capacity."}
        </small>
          </section>

          <div className="fulfillment-intelligence__domains">
        <section className="fulfillment-intelligence__domain" data-domain="people" data-limiting={fulfillment.limitingDomain === "people" || undefined}>
          <header>
            <div>
              <span>People</span>
              <h4>Staff coverage</h4>
            </div>
            <EvidenceState value={people.evidenceState} availableLabel={people.completeness === "complete" ? "Current" : "Available · partial"} />
          </header>
          <div className="fulfillment-intelligence__measures">
            <div>
              <span>Current coverage</span>
              <strong>{coverageValue(people.current)}</strong>
              <small>{coverageCaption(people.current, "people")}</small>
            </div>
            <div>
              <span>Working need</span>
              <strong>{proposedCoverageValue(people.proposed)}</strong>
              <small>{people.proposed?.assignmentBasis === "proposed_event_window_not_evaluated"
                ? "Proposed timing changed; availability and conflicts still need review"
                : "Current confirmed assignments compared with the proposed requirement"}</small>
            </div>
            <div>
              <span>Additional guest capacity</span>
              <strong>{headroomValue(people.staffingHeadroom)}</strong>
              <small>{headroomCaption(people.staffingHeadroom)}</small>
            </div>
            <div>
              <span>Backups</span>
              <strong>{backupCount === null ? "Still checking" : `${backupCount} eligible`}</strong>
              <small>{evidenceDetail(people?.resilience?.evidenceState, "Eligible backups", "backup staffing is still checking")}</small>
            </div>
          </div>
          <RoleCoverage people={people} />
          <div className="fulfillment-intelligence__actions">
            {typeof onOpenStaffing === "function" ? (
              <button type="button" onClick={onOpenStaffing}>Review staffing in event</button>
            ) : null}
            {typeof onRefreshStaffing === "function"
              && ["stale", "unavailable"].includes(people.freshness) ? (
                <button type="button" onClick={onRefreshStaffing}>Refresh staffing</button>
              ) : null}
          </div>
        </section>

        <section className="fulfillment-intelligence__domain" data-domain="supply" data-limiting={fulfillment.limitingDomain === "supply" || undefined}>
          <header>
            <div>
              <span>Supply</span>
              <h4>Ingredient coverage</h4>
            </div>
            <EvidenceState value={supply.evidenceState} availableLabel={supply.completeness === "complete" ? "Current" : "Available · partial"} />
          </header>
          <div className="fulfillment-intelligence__measures">
            <div>
              <span>Current coverage</span>
              <strong>{supplyCoverage(supply.current)}</strong>
              <small>{coverageCaption(supply.current, "supply")}</small>
            </div>
            <div>
              <span>Working coverage</span>
              <strong>{supplyCoverage(supply.proposed)}</strong>
              <small>{coverageCaption(supply.proposed, "supply")}</small>
            </div>
            <div>
              <span>Additional guest capacity</span>
              <strong>{headroomValue(supply.inventoryHeadroom)}</strong>
              <small>{headroomCaption(supply.inventoryHeadroom)}</small>
            </div>
            <div>
              <span>Ingredient cost</span>
              <strong>{formatMoney(supply?.proposed?.projectedCost)}</strong>
              <small>{evidenceDetail(supply?.proposed?.projectedCost?.state, "Cost for this option", "ingredient cost is unavailable")}</small>
            </div>
          </div>
          <ShortageList supply={supply} />
          {constraint && typeof onToggleConstraint === "function" ? (
            <button
              type="button"
              className="csw-constraint-trigger"
              aria-expanded={Boolean(constraintOpen)}
              aria-controls="csw-constraint-explanation"
              onClick={onToggleConstraint}
            >
              <strong>{constraint.resourceLabel} is the first known constraint</strong>
              <span>
                {constraint.shortageQuantityMicros === null
                  ? "See the shortage details"
                  : `${formatMicros(constraint.shortageQuantityMicros, constraint.unitId)} short · See why`}
              </span>
            </button>
          ) : constraint ? (
            <p className="fulfillment-intelligence__quiet">{constraint.resourceLabel} is the first known constraint.</p>
          ) : (
            <p className="fulfillment-intelligence__quiet">No supply issue is listed for this option.</p>
          )}
          {constraintOpen ? (
            <ConstraintExplanation
              projection={projection}
              activeScenario={activeScenario}
              constraint={constraint}
              onUseSafeThrough={onUseSafeThrough}
            />
          ) : null}
          {typeof onOpenInventory === "function" ? (
            <div className="fulfillment-intelligence__actions">
              <button type="button" onClick={onOpenInventory}>Open inventory</button>
            </div>
          ) : null}
        </section>
          </div>

          <ConstraintStack constraints={fulfillment.constraints} />
          <SourceRevisions fulfillment={fulfillment} />
        </div>
      </details>
    </aside>
  );
}
