import StatusChip from "./StatusChip";
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
  complete: "Complete evidence",
  supported: "Supported",
  conditional: "Conditional",
  unverifiable: "Unverifiable",
  partial: "Partial evidence",
  loading: "Loading",
  stale: "Stale",
  missing: "Missing",
  not_applicable: "Not applicable",
  not_yet_available: "Not yet available",
  blocked_by_integration: "Blocked by integration",
  contradictory: "Contradictory",
  schema_drift: "Schema drift",
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

function rootChip({ fulfillment, updating, retained }) {
  if (retained) return { family: "action", label: "Retained · not current" };
  if (updating) return { family: "action", label: "Updating" };
  if (fulfillment?.state === "complete") return { family: "confirmed", label: "Complete evidence" };
  if (fulfillment?.state === "unavailable") return { family: "blocked", label: "Unavailable" };
  return { family: "action", label: "Partial evidence" };
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
  if (amountMinor === null) return "Not verified";
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
    return "Not verified";
  }
}

function formatMajorMoney(amount, currencyValue) {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "Not verified";
  const currency = /^[A-Z]{3}$/u.test(text(currencyValue).toUpperCase())
    ? text(currencyValue).toUpperCase()
    : null;
  if (!currency) return "Not verified";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  } catch {
    return "Not verified";
  }
}

function formatMicros(value, unitId = "") {
  const exact = exactCount(value);
  if (exact === null) return "Not verified";
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 6
  }).format(exact / 1_000_000);
  return `${formatted}${text(unitId) ? ` ${text(unitId)}` : ""}`;
}

function coverageValue(scenario) {
  if (!scenario || scenario.coverageState === "unknown") return "Not verified";
  const assigned = exactCount(scenario.totalAssigned);
  const required = exactCount(scenario.totalRequired);
  return assigned === null || required === null ? "Not verified" : `${assigned} / ${required}`;
}

function proposedCoverageValue(scenario) {
  const assigned = exactCount(scenario?.totalAssigned);
  const required = exactCount(scenario?.totalRequired);
  return assigned === null || required === null
    ? "Not verified"
    : `${assigned} current / ${required} required`;
}

function coverageCaption(scenario, domain) {
  if (!scenario || scenario.coverageState === "unknown") {
    return domain === "people" ? "No exact assignment conclusion" : "No exact stock conclusion";
  }
  if (["shortage", "gap", "attention"].includes(scenario.coverageState)) {
    const gap = exactCount(scenario.totalGap ?? scenario.shortageCount);
    if (gap === null) return `${domain === "people" ? "Coverage" : "Supply"} needs attention`;
    return `${gap} ${domain === "people" ? "role" : "ingredient"} gap${gap === 1 ? "" : "s"}`;
  }
  if (scenario.coverageState === "not_required") return "No roles required by the exact source";
  return domain === "people" ? "Required roles assigned" : "Declared demand covered";
}

function supplyCoverage(scenario) {
  if (scenario?.coverageState === "covered") return "Covered";
  if (scenario?.coverageState === "shortage") return "Shortage";
  return "Not verified";
}

function headroomValue(headroom) {
  if (stateOf(headroom) !== "available") return "Not verified";
  const safeIncrease = exactCount(headroom?.safeGuestIncrease);
  return safeIncrease === null ? "Not verified" : `+${pluralGuests(safeIncrease)}`;
}

function headroomCaption(headroom) {
  const state = stateOf(headroom);
  if (state !== "available") {
    return ({
      missing: "No exact boundary was supplied.",
      not_applicable: "No boundary applies to this scenario.",
      not_yet_available: "Boundary evidence has not been produced yet.",
      blocked_by_integration: "The boundary source is not connected.",
      contradictory: "Boundary sources disagree and need review.",
      schema_drift: "The boundary schema changed and needs review.",
      stale: "The last boundary is stale.",
      failed: "The boundary read failed.",
      unavailable: "A current declared boundary is unavailable."
    })[state] || "A current declared boundary is required.";
  }
  const nextAt = exactCount(headroom?.nextBoundary?.atGuestCount);
  const distance = exactCount(headroom?.guestsUntilBoundary);
  if (nextAt !== null && distance !== null) {
    return `Next step at ${nextAt} · ${pluralGuests(distance)} away`;
  }
  const safeThrough = exactCount(headroom?.safeThroughGuestCount);
  return safeThrough === null ? "Exact boundary supplied" : `Safe through ${safeThrough} guests`;
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
  ) || "Operational evidence";
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
  if (fulfillment?.limitingDomain === "supply") return `${resource || "Supply"} is the limiting constraint.`;
  if (fulfillment?.limitingDomain === "people") return `${resource || "People"} is the limiting constraint.`;
  return "Overall headroom is withheld until both independent boundaries are current.";
}

function revisionLabel(value, preferredKeys = []) {
  if (!value || typeof value !== "object") return text(value) || "Not supplied";
  const sources = [value, value.proposedAfter, value.before]
    .filter((entry) => entry && typeof entry === "object");
  for (const source of sources) {
    for (const key of preferredKeys) {
      const candidate = source[key];
      if (candidate !== null && candidate !== undefined && text(candidate)) return text(candidate);
    }
  }
  return "Not supplied";
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
      <span>{label} boundary</span>
      <strong>{headroomValue(headroom)}</strong>
      <small>{stateLabel(headroom, "Current")}</small>
    </div>
  );
}

function decisionHeadline(answer) {
  const guestCount = exactCount(answer?.guestCount);
  const guestLabel = guestCount === null ? "This scenario" : pluralGuests(guestCount);
  if (answer?.state === "supported") {
    return `${guestLabel} is supported by the current fulfillment evidence`;
  }
  if (answer?.state === "conditional") {
    return `${guestLabel} is conditionally supportable`;
  }
  return `${guestLabel} is not yet verifiable`;
}

function supplyDecisionCopy(answer) {
  const constraint = answer?.supplyConstraint;
  const shortage = exactCount(constraint?.shortageQuantityMicros);
  const ingredient = text(constraint?.ingredientLabel || constraint?.ingredientId) || "Ingredient";
  const shortageLabel = shortage === null
    ? "an unquantified amount"
    : formatMicros(shortage, constraint?.unitId);
  if (!constraint) return "No exact Supply constraint is present in this decision answer.";
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
  return `${guestCount === null ? "This scenario" : `At ${pluralGuests(guestCount)}`}, ${ingredient} is ${shortageLabel} short. Exact menu attribution is not available.`;
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
  return "A preferred resolution is not yet evidenced. Review Inventory.";
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
  return "The staffing effect is not yet verified.";
}

function beoDecisionCopy(beo) {
  if (["stale", "review_required"].includes(beo?.effect)) return "BEO review is required.";
  if (beo?.effect === "no_declared_dependency") return "No BEO dependency was declared.";
  return "The BEO review effect is not yet verified.";
}

function DecisionAnswer({ answer, retained, onOpenInventory, onOpenStaffing }) {
  if (!answer || typeof answer !== "object") return null;
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
            <p className="csw-kicker">Decision answer · retained evidence</p>
            <h5 id="fulfillment-decision-answer-title">Current answer withheld</h5>
          </div>
          <EvidenceState value="stale" />
        </header>
        <p className="fulfillment-intelligence__decision-boundary">
          The prior projection remains visible below for comparison, but its supplier, staffing, value, and document conclusions do not apply to the active scenario. Wait for the exact current result.
        </p>
      </section>
    );
  }
  const supplyConstraint = answer.supplyConstraint;
  const sourcing = answer.sourcingResolution || {};
  const commercialValue = answer.commercialValue || {};
  const commercialValueLabel = commercialValue.evidenceState === "available"
    ? formatMajorMoney(commercialValue.amount, commercialValue.currency)
    : "Not verified";
  const addedCostLabel = sourcing.evidenceState === "available"
    && exactCount(sourcing.addedCostMinor) !== null
    ? formatMoney({ amountMinor: sourcing.addedCostMinor, currency: sourcing.currency })
    : null;
  const conditions = Array.isArray(sourcing.conditions) ? sourcing.conditions.filter(Boolean) : [];

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
          <p className="csw-kicker">Decision answer · cross-authority synthesis</p>
          <h5 id="fulfillment-decision-answer-title">{decisionHeadline(answer)}</h5>
        </div>
        <EvidenceState value={answer.state === "supported" ? "available" : answer.state} availableLabel="Supported" />
      </header>
      <p className="fulfillment-intelligence__decision-boundary">
        Governed review only. This is not customer acceptance, booking, or event readiness.
      </p>

      <div className="fulfillment-intelligence__decision-grid">
        <article data-decision-clause="supply">
          <span>Supply constraint</span>
          <strong>{supplyDecisionCopy(answer)}</strong>
          {supplyConstraint ? (
            <small>Inventory remains short until received stock is recorded and the projection refreshes.</small>
          ) : null}
        </article>

        {supplyConstraint ? (
          <article data-decision-clause="sourcing" data-evidence-state={stateOf(sourcing)}>
            <span>Sourcing resolution</span>
            <strong>{sourcingDecisionCopy(sourcing)}</strong>
            {addedCostLabel ? <small>Recorded added cost: {addedCostLabel}.</small> : null}
            {conditions.length ? (
              <ul aria-label="Sourcing conditions">
                {conditions.map((condition, index) => <li key={`${condition}-${index}`}>{condition}</li>)}
              </ul>
            ) : null}
          </article>
        ) : null}

        <article data-decision-clause="commercial-value">
          <span>Commercial value</span>
          <strong>Proposed quote total: {commercialValueLabel}</strong>
          <small>Quoted value, not earned revenue or a guaranteed amount preserved.</small>
        </article>

        <article data-decision-clause="staffing">
          <span>Staffing effect</span>
          <strong>{staffingDecisionCopy(answer.staffing)}</strong>
          {answer?.staffing?.reviewEffect && ["stale", "review_required"].includes(answer.staffing.reviewEffect) ? (
            <small>A separate staffing review remains required.</small>
          ) : null}
        </article>

        <article data-decision-clause="beo">
          <span>BEO effect</span>
          <strong>{beoDecisionCopy(answer.beo)}</strong>
          {Array.isArray(answer?.beo?.dependentNodeIds) && answer.beo.dependentNodeIds.length ? (
            <small>{answer.beo.dependentNodeIds.length} governed document dependenc{answer.beo.dependentNodeIds.length === 1 ? "y" : "ies"} affected.</small>
          ) : null}
        </article>
      </div>

      <div className="fulfillment-intelligence__decision-actions">
        {supplyConstraint && typeof onOpenInventory === "function" ? (
          <button type="button" onClick={onOpenInventory}>Review Inventory resolution</button>
        ) : null}
        {typeof onOpenStaffing === "function" ? (
          <button type="button" onClick={onOpenStaffing}>Review Staffing evidence</button>
        ) : null}
      </div>
    </section>
  );
}

function RoleCoverage({ people }) {
  const rows = roleRows(people);
  if (!rows.length) {
    return <p className="fulfillment-intelligence__quiet">Role-level evidence is not available.</p>;
  }
  return (
    <details className="fulfillment-intelligence__details">
      <summary>Role coverage and backup evidence</summary>
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
      <h6>{shortages.length} proposed shortage{shortages.length === 1 ? "" : "s"}</h6>
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
          <p className="csw-kicker">Ordered constraint stack</p>
          <h5 id="fulfillment-constraint-stack-title">What governs next</h5>
        </div>
        <span>{ordered.length ? `${ordered.length} known` : "None declared"}</span>
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
                  <p>{text(constraint?.kind).replaceAll("_", " ") || "Review required"}</p>
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
        <p className="fulfillment-intelligence__quiet">No exact constraint is currently declared.</p>
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
      <h5>Why {constraint.resourceLabel} is limiting</h5>
      <p>
        {required !== null
          ? `Declared demand is ${formatMicros(required, constraint.unitId)}. `
          : "The exact inventory projection declares a shortage. "}
        {shortage !== null
          ? `The recorded shortfall is ${formatMicros(shortage, constraint.unitId)}.`
          : "The current evidence does not include a usable shortage quantity."}
      </p>
      {safeThrough !== null ? (
        <p>
          The declared evidence is safe through {safeThrough} guests
          {firstBoundary !== null ? `; the first failing boundary is ${firstBoundary}` : ""}.
        </p>
      ) : (
        <p>No exact clear-through guest boundary is available, so the workbench will not invent one.</p>
      )}
      <p>This read model does not reserve stock, choose a substitute, or create a purchase order.</p>
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
  const people = fulfillment?.sourceRevisions?.people || {};
  const supply = fulfillment?.sourceRevisions?.supply || {};
  const items = [
    ["Commercial", text(fulfillment?.identity?.quoteRevisionId) || "Not supplied"],
    ["Staffing plan", revisionLabel(people, ["planRevision", "authorityVersion", "quoteRevisionId"])],
    ["Staffing policy", people.staffingPolicySourceId && people.staffingPolicyRevision
      ? `${text(people.staffingPolicySourceId)} · revision ${people.staffingPolicyRevision}`
      : revisionLabel(people, ["staffingPolicySourceId", "staffingPolicyRevision"])],
    ["Supply current", revisionLabel(supply?.before, ["eventRequirementRevisionId", "projectionDigest", "sourceFingerprint"])],
    ["Supply working", revisionLabel(supply?.proposedAfter, ["eventRequirementRevisionId", "projectionDigest", "sourceFingerprint"])],
    ["Inventory boundary", revisionLabel(supply, ["inventoryHeadroomSourceRevisionId"])]
  ];
  return (
    <details className="fulfillment-intelligence__authority">
      <summary>Projection boundary and source revisions</summary>
      <p>{fulfillment?.boundary || "Commercial, Staffing, and Inventory remain separate authorities; Fulfillment is a rebuildable presentation-only read model."}</p>
      <dl>
        {items.map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
        ))}
      </dl>
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
      <header className="csw-rail-heading fulfillment-intelligence__header">
        <div>
          <p className="csw-kicker">Consequence rail · composed read model</p>
          <h4 id="fulfillment-intelligence-title">Fulfillment</h4>
          <p>Independent People and Supply authority. One rebuildable consequence view.</p>
        </div>
        <StatusChip {...rootChip({ fulfillment, updating, retained })} />
      </header>

      <DecisionAnswer
        answer={projection?.decisionAnswer}
        retained={retained}
        onOpenInventory={onOpenInventory}
        onOpenStaffing={onOpenStaffing}
      />

      <section
        className="fulfillment-intelligence__overall"
        data-domain="overall"
        data-evidence-state={stateOf(fulfillment.fulfillmentHeadroom)}
        aria-live="polite"
      >
        <header>
          <span>Overall guest-count headroom</span>
          <EvidenceState value={fulfillment.fulfillmentHeadroom} availableLabel="Current" />
        </header>
        <strong className="fulfillment-intelligence__primary">{overallValue(fulfillment)}</strong>
        <p>{limitingCaption(fulfillment)}</p>
        <div className="fulfillment-intelligence__boundary-grid" aria-label="Independent boundary quality">
          <BoundaryQuality label="People" headroom={people.staffingHeadroom} />
          <BoundaryQuality label="Supply" headroom={supply.inventoryHeadroom} />
        </div>
        <small>
          {stateOf(fulfillment.fulfillmentHeadroom) === "available"
            ? "The smaller current boundary governs. This projection reserves neither people nor stock."
            : "Missing or partial evidence is not a zero-capacity conclusion."}
        </small>
      </section>

      <div className="fulfillment-intelligence__domains">
        <section className="fulfillment-intelligence__domain" data-domain="people" data-limiting={fulfillment.limitingDomain === "people" || undefined}>
          <header>
            <div>
              <span>People</span>
              <h5>Staff coverage</h5>
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
              <span>People headroom</span>
              <strong>{headroomValue(people.staffingHeadroom)}</strong>
              <small>{headroomCaption(people.staffingHeadroom)}</small>
            </div>
            <div>
              <span>Resilience</span>
              <strong>{backupCount === null ? "Not verified" : `${backupCount} eligible`}</strong>
              <small>{evidenceDetail(people?.resilience?.evidenceState, "Eligible backup profiles", "backup capacity not verified")}</small>
            </div>
          </div>
          <RoleCoverage people={people} />
          <p className="fulfillment-intelligence__boundary-copy">{people.boundary}</p>
          <div className="fulfillment-intelligence__actions">
            {typeof onOpenStaffing === "function" ? (
              <button type="button" onClick={onOpenStaffing}>Review staffing in event</button>
            ) : null}
            {typeof onRefreshStaffing === "function"
              && ["stale", "unavailable"].includes(people.freshness) ? (
                <button type="button" onClick={onRefreshStaffing}>Refresh People evidence</button>
              ) : null}
          </div>
        </section>

        <section className="fulfillment-intelligence__domain" data-domain="supply" data-limiting={fulfillment.limitingDomain === "supply" || undefined}>
          <header>
            <div>
              <span>Supply</span>
              <h5>Ingredient coverage</h5>
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
              <span>Supply headroom</span>
              <strong>{headroomValue(supply.inventoryHeadroom)}</strong>
              <small>{headroomCaption(supply.inventoryHeadroom)}</small>
            </div>
            <div>
              <span>Projected cost</span>
              <strong>{formatMoney(supply?.proposed?.projectedCost)}</strong>
              <small>{evidenceDetail(supply?.proposed?.projectedCost?.state, "Exact proposed ingredient cost", "cost evidence is not usable")}</small>
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
                  ? "Open the exact causal evidence"
                  : `${formatMicros(constraint.shortageQuantityMicros, constraint.unitId)} short · See why`}
              </span>
            </button>
          ) : constraint ? (
            <p className="fulfillment-intelligence__quiet">{constraint.resourceLabel} is the first known constraint.</p>
          ) : (
            <p className="fulfillment-intelligence__quiet">No exact working-scenario Supply constraint is declared.</p>
          )}
          {constraintOpen ? (
            <ConstraintExplanation
              projection={projection}
              activeScenario={activeScenario}
              constraint={constraint}
              onUseSafeThrough={onUseSafeThrough}
            />
          ) : null}
          <p className="fulfillment-intelligence__boundary-copy">{supply.boundary}</p>
          {typeof onOpenInventory === "function" ? (
            <div className="fulfillment-intelligence__actions">
              <button type="button" onClick={onOpenInventory}>Review inventory evidence</button>
            </div>
          ) : null}
        </section>
      </div>

      <ConstraintStack constraints={fulfillment.constraints} />
      <SourceRevisions fulfillment={fulfillment} />
    </aside>
  );
}
