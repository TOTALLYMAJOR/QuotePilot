import { useEffect, useMemo, useRef, useState } from "react";
import "./inventoryRecipeEditor.css";

const COST_STATES = new Set(["complete", "partial", "stale", "unavailable", "invalid"]);
const OPERATION_STATES = new Set(["idle", "pending", "committed", "uncertain", "reconciliation", "rejected"]);

function text(value) {
  return String(value ?? "").trim();
}

function exactMenuItemId(menuItem) {
  return text(menuItem?.id || menuItem?.menuItemId);
}

function ingredientId(value) {
  return text(value?.ingredientId || value?.itemId || value?.id);
}

function normalizeUnitOptions(ingredient) {
  const options = [];
  const seen = new Set();
  const addStandard = (unitId) => {
    const id = text(unitId);
    const value = id ? `standard:${id}` : "";
    if (!id || seen.has(value)) return;
    seen.add(value);
    options.push({ value, label: id, unitKind: "standard", unitId: id });
  };
  addStandard(ingredient?.baseUnitId || ingredient?.baseUnit);
  (Array.isArray(ingredient?.supportedRecipeUnits) ? ingredient.supportedRecipeUnits : []).forEach((entry) => {
    if (typeof entry === "string") addStandard(entry);
    else if (entry?.unitKind === "ingredient_pack" && text(entry.packConversionRevisionId)) {
      const revisionId = text(entry.packConversionRevisionId);
      const value = `ingredient_pack:${revisionId}`;
      if (!seen.has(value)) {
        seen.add(value);
        options.push({ value, label: text(entry.label || entry.packLabel) || "Declared purchase pack", unitKind: "ingredient_pack", packConversionRevisionId: revisionId });
      }
    } else addStandard(entry?.unitId);
  });
  return options;
}

function normalizedIngredients(ingredients) {
  const seen = new Set();
  return (Array.isArray(ingredients) ? ingredients : [])
    .map((ingredient) => ({
      ...ingredient,
      ingredientId: ingredientId(ingredient),
      name: text(ingredient?.name) || "Unnamed ingredient",
      baseUnitId: text(ingredient?.baseUnitId || ingredient?.baseUnit),
      recipeUnitOptions: normalizeUnitOptions(ingredient)
    }))
    .filter((ingredient) => {
      if (!ingredient.ingredientId || seen.has(ingredient.ingredientId)) return false;
      seen.add(ingredient.ingredientId);
      return true;
    })
    .sort((left, right) => left.name.localeCompare(right.name) || left.ingredientId.localeCompare(right.ingredientId));
}

function draftFromRecipe(recipe, menuItemId) {
  const sourceLines = Array.isArray(recipe?.lines)
    ? recipe.lines
    : Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
  return {
    menuItemId,
    expectedRecipeRevision: Number.isInteger(recipe?.recipeRevision)
      ? recipe.recipeRevision
      : Number.isInteger(recipe?.revision) ? recipe.revision : 0,
    yield: {
      quantity: text(recipe?.outputYield ?? recipe?.yield?.quantity),
      unit: text(recipe?.outputUnitId || recipe?.yield?.unit || recipe?.yieldUnit) || "portion"
    },
    ingredients: sourceLines.map((line) => ({
      lineId: text(line?.lineId) || `line-${ingredientId(line)}`,
      ingredientId: ingredientId(line),
      quantity: text(line?.quantity),
      unitKind: text(line?.unitKind) || "standard",
      unitId: text(line?.unitId || line?.unit || line?.recipeUnit),
      packConversionRevisionId: text(line?.packConversionRevisionId),
      quantityBasis: text(line?.quantityBasis) || "as_purchased",
      usableYield: text(line?.usableYield)
    }))
  };
}

function fingerprint(value) {
  return JSON.stringify(value);
}

function projectionState(projection) {
  if (text(projection?.freshness).toLowerCase() === "stale") return "stale";
  const value = text(projection?.status || projection?.state || projection?.costState || projection?.coverageState || projection?.coverage?.state || projection?.cost?.status).toLowerCase();
  return COST_STATES.has(value) ? value : "unavailable";
}

function summaryCostDisplay(projection) {
  const unitCost = outputUnitCostDisplay(projection);
  if (unitCost) {
    return `${unitCost} / ${text(projection?.recipeDefinition?.outputUnitId) || "output unit"}`;
  }
  const batchCost = batchCostDisplay(projection);
  return batchCost ? `${batchCost} / recipe batch` : "";
}

function batchCostDisplay(projection) {
  return text(projection?.projectedIngredientCostDisplay);
}

function outputUnitCostDisplay(projection) {
  return text(projection?.costPerYieldUnitDisplay || projection?.costPerPortionDisplay);
}

function projectionIssueLabels(projection) {
  const issues = Array.isArray(projection?.issues)
    ? projection.issues
    : Array.isArray(projection?.cost?.issues) ? projection.cost.issues : [];
  return issues.map((issue) => text(issue?.message || issue?.label || issue?.code || issue).replaceAll("_", " ")).filter(Boolean);
}

function isPositiveDecimal(value) {
  const normalized = text(value);
  return /^\d+(?:\.\d+)?$/u.test(normalized) && !/^0+(?:\.0+)?$/u.test(normalized);
}

export function InventoryMenuCostSummary({ projections = [], sourceState = "unavailable", title = "Menu costing" }) {
  const rows = (Array.isArray(projections) ? projections : [])
    .filter((projection) => text(projection?.menuItemId))
    .sort((left, right) => (text(left?.menuItemName) || text(left?.menuItemId)).localeCompare(text(right?.menuItemName) || text(right?.menuItemId)))
    .slice(0, 12);
  if (!rows.length) return null;

  return (
    <section className="inventory-menu-cost-summary" aria-labelledby="inventory-menu-cost-summary-title" data-menu-cost-summary data-menu-cost-source-state={sourceState}>
      <div>
        <p className="inventory-recipe-editor__eyebrow">Ingredient intelligence</p>
        <h2 id="inventory-menu-cost-summary-title">{title}</h2>
        <p>Projected ingredient cost stays separate from selling price and stock availability.</p>
        {sourceState !== "current" && <p role="status">Retained menu-cost projections are for orientation only until the live source is current.</p>}
      </div>
      <ul aria-label="Current menu-item cost projections">
        {rows.map((projection) => {
          const state = projectionState(projection);
          const display = summaryCostDisplay(projection);
          return (
            <li key={projection.menuItemId} data-menu-cost-state={state}>
              <span>
                <strong>{text(projection.menuItemName) || projection.menuItemId}</strong>
                <small>{state === "complete" ? "Fully costed" : state === "partial" ? "Partially costed" : state}</small>
              </span>
              <span>{display ? `${state === "partial" ? "Partial · " : ""}${display}` : "Cost unavailable"}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CostEvidence({ projection, sourceState = "current" }) {
  if (!projection) {
    const capabilityState = sourceState === "loading" ? "loading"
      : sourceState === "current" ? "empty" : "error";
    return (
      <div className="inventory-recipe-editor__cost" data-menu-cost-state="unavailable" data-capability-state={capabilityState}>
        <strong>{sourceState === "loading" ? "Loading exact recipe evidence…" : "No current cost projection"}</strong>
        <span>{sourceState === "current"
          ? "Publish a valid recipe to create server-calculated ingredient cost intelligence."
          : "Current exact recipe evidence is required before this editor can authorize a revision."}</span>
      </div>
    );
  }
  const state = projectionState(projection);
  const capabilityState = state === "complete" ? "success"
    : state === "partial" ? "partial"
      : state === "stale" ? "stale" : "error";
  const batchDisplay = batchCostDisplay(projection);
  const unitDisplay = outputUnitCostDisplay(projection);
  const issues = projectionIssueLabels(projection);
  const costed = Number(projection?.coverage?.costedIngredients ?? projection?.coverage?.costedCount ?? projection?.cost?.coverage?.costedIngredientCount);
  const total = Number(projection?.coverage?.totalIngredients ?? projection?.coverage?.totalCount ?? projection?.cost?.coverage?.expectedIngredientCount);
  const coverage = Number.isInteger(costed) && Number.isInteger(total) ? `${costed}/${total} ingredients costed` : "";
  return (
    <div className="inventory-recipe-editor__cost" data-menu-cost-state={state} data-capability-state={capabilityState} role={state === "complete" ? undefined : "status"}>
      <span className="inventory-recipe-editor__state">{state}</span>
      <strong>{batchDisplay ? `${state === "partial" ? "Partial recipe ingredient cost · " : "Recipe ingredient cost · "}${batchDisplay}` : "Recipe ingredient cost unavailable"}</strong>
      {unitDisplay && <span>{unitDisplay} per {text(projection?.recipeDefinition?.outputUnitId) || "output unit"}</span>}
      {coverage && <span>{coverage}</span>}
      {text(projection?.yieldLabel) && <span>{projection.yieldLabel}</span>}
      {state === "stale" && <span>Recipe or ingredient evidence changed. Recalculation is pending.</span>}
      {issues.length > 0 && <ul>{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
    </div>
  );
}

function validateDraft(draft, knownIngredientIds) {
  const issues = [];
  if (!text(draft.menuItemId)) issues.push("A saved menu item is required.");
  if (!isPositiveDecimal(draft.yield.quantity)) {
    issues.push("Enter a positive recipe yield.");
  }
  if (!text(draft.yield.unit)) issues.push("Choose a yield unit.");
  if (!draft.ingredients.length) issues.push("Add at least one ingredient.");
  const seen = new Set();
  draft.ingredients.forEach((line, index) => {
    const id = text(line.ingredientId);
    if (!text(line.lineId)) issues.push(`Ingredient ${index + 1} needs a stable line identity.`);
    if (!id || !knownIngredientIds.has(id)) issues.push(`Ingredient ${index + 1} needs a current ingredient reference.`);
    if (id && seen.has(id)) issues.push("Combine duplicate ingredient lines before publishing.");
    seen.add(id);
    if (!isPositiveDecimal(line.quantity)) {
      issues.push(`Ingredient ${index + 1} needs a positive quantity.`);
    }
    if (line.unitKind === "ingredient_pack" ? !text(line.packConversionRevisionId) : !text(line.unitId)) {
      issues.push(`Ingredient ${index + 1} needs an explicit supported unit or declared pack conversion.`);
    }
    if (!new Set(["as_purchased", "usable"]).has(line.quantityBasis)) {
      issues.push(`Ingredient ${index + 1} needs an as-purchased or usable quantity basis.`);
    }
    if (line.quantityBasis === "usable" && (!isPositiveDecimal(line.usableYield) || Number(line.usableYield) > 1)) {
      issues.push(`Ingredient ${index + 1} needs a declared usable-yield ratio greater than 0 and no more than 1.`);
    }
  });
  return [...new Set(issues)];
}

export default function InventoryRecipeEditor({
  menuItem,
  ingredients = [],
  recipe = null,
  projection = null,
  expectedCatalogRevision = 0,
  ingredientSourceState = "unavailable",
  publishEligibility = { allowed: false, reason: "Recipe publication is unavailable." },
  onPublish,
  onReconcile,
  onReset,
  recipeSourceState = "current",
  onInteractionStateChange
}) {
  const menuItemId = exactMenuItemId(menuItem);
  const availableIngredients = useMemo(() => normalizedIngredients(ingredients), [ingredients]);
  const baseline = useMemo(() => draftFromRecipe(recipe, menuItemId), [menuItemId, recipe]);
  const baselineFingerprint = useMemo(() => fingerprint(baseline), [baseline]);
  const [draft, setDraft] = useState(baseline);
  const [operation, setOperation] = useState({ state: "idle", message: "" });
  const [baselineConflict, setBaselineConflict] = useState(false);
  const previousBaselineRef = useRef({ menuItemId, fingerprint: baselineFingerprint });

  useEffect(() => {
    const previous = previousBaselineRef.current;
    if (previous.menuItemId === menuItemId && previous.fingerprint === baselineFingerprint) return;
    const menuChanged = previous.menuItemId !== menuItemId;
    const unresolved = operation.state === "pending"
      || operation.state === "uncertain"
      || operation.state === "reconciliation"
      || (operation.state === "rejected" && Boolean(operation.attempt));
    const draftWasDirty = fingerprint(draft) !== previous.fingerprint;
    if (menuChanged) {
      setDraft(baseline);
      setOperation({ state: "idle", message: "" });
      setBaselineConflict(false);
    } else if (operation.state === "committed" || (!unresolved && !draftWasDirty)) {
      setDraft(baseline);
      setOperation((current) => current.state === "committed" ? { state: "idle", message: "" } : current);
      setBaselineConflict(false);
    } else {
      setBaselineConflict(true);
    }
    previousBaselineRef.current = { menuItemId, fingerprint: baselineFingerprint };
  }, [baselineFingerprint, menuItemId]);

  useEffect(() => {
    if (operation.state !== "committed" || !baselineConflict) return;
    setDraft(baseline);
    setBaselineConflict(false);
  }, [baseline, baselineConflict, operation.state]);

  const dirty = fingerprint(draft) !== baselineFingerprint;
  const recipeSourceCurrent = recipeSourceState === "current";
  const busy = operation.state === "pending" || operation.state === "uncertain" || operation.state === "reconciliation";
  const outcomeLocked = operation.state === "pending"
    || operation.state === "committed"
    || operation.state === "uncertain"
    || operation.state === "reconciliation"
    || (operation.state === "rejected" && Boolean(operation.attempt))
    || !recipeSourceCurrent
    || baselineConflict;
  const navigationLocked = dirty
    || busy
    || operation.state === "committed"
    || (operation.state === "rejected" && Boolean(operation.attempt))
    || baselineConflict;
  useEffect(() => {
    onInteractionStateChange?.({ dirty, busy, locked: navigationLocked });
  }, [busy, dirty, navigationLocked, onInteractionStateChange]);
  useEffect(() => () => onInteractionStateChange?.({ dirty: false, busy: false, locked: false }), [onInteractionStateChange]);

  const knownIngredientIds = useMemo(() => new Set(availableIngredients.map((item) => item.ingredientId)), [availableIngredients]);
  const issues = validateDraft(draft, knownIngredientIds);
  const sourceCurrent = ingredientSourceState === "current";
  const allowed = publishEligibility?.allowed === true
    && typeof onPublish === "function"
    && sourceCurrent
    && recipeSourceCurrent
    && !baselineConflict;
  const disabledReason = baselineConflict
    ? "A newer recipe revision arrived while this draft or request was unresolved. Keep the preserved values for review, then use the current recipe before publishing again."
    : !recipeSourceCurrent
    ? "Wait for the current exact menu recipe projection before publishing. Cached, pending, or unavailable evidence cannot authorize a revision."
    : !sourceCurrent
    ? "Reconnect current ingredient projections before publishing a recipe. Retained or pending data cannot authorize this change."
    : !publishEligibility?.allowed
      ? text(publishEligibility?.reason) || "Save and confirm this menu item before publishing its recipe."
      : typeof onPublish !== "function"
        ? "Recipe publication is not connected in this workspace."
        : issues[0] || "";

  const patchLine = (index, patch) => setDraft((current) => ({
    ...current,
    ingredients: current.ingredients.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line)
  }));
  const addLine = () => {
    const candidate = availableIngredients.find((ingredient) => !draft.ingredients.some((line) => line.ingredientId === ingredient.ingredientId));
    setDraft((current) => ({
      ...current,
      ingredients: [...current.ingredients, {
        lineId: candidate ? `line-${candidate.ingredientId}` : `line-${current.ingredients.length + 1}`,
        ingredientId: candidate?.ingredientId || "",
        quantity: "",
        unitKind: candidate?.recipeUnitOptions?.[0]?.unitKind || "standard",
        unitId: candidate?.recipeUnitOptions?.[0]?.unitId || "",
        packConversionRevisionId: candidate?.recipeUnitOptions?.[0]?.packConversionRevisionId || "",
        quantityBasis: "as_purchased",
        usableYield: ""
      }]
    }));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!allowed || issues.length || busy) return;
    setOperation({ state: "pending", message: "Publishing this exact recipe revision…" });
    try {
      const result = await onPublish({
        kind: "publish_menu_recipe",
        menuItemId,
        expectedCatalogRevision,
        expectedRecipeRevision: draft.expectedRecipeRevision,
        outputYield: text(draft.yield.quantity),
        outputUnitId: text(draft.yield.unit),
        lines: draft.ingredients.map((line) => ({
          lineId: text(line.lineId),
          ingredientId: text(line.ingredientId),
          quantity: text(line.quantity),
          unitKind: line.unitKind,
          ...(line.unitKind === "ingredient_pack"
            ? { packConversionRevisionId: text(line.packConversionRevisionId) }
            : { unitId: text(line.unitId) }),
          quantityBasis: line.quantityBasis,
          usableYield: line.quantityBasis === "usable" && text(line.usableYield) ? text(line.usableYield) : null
        }))
      });
      const state = OPERATION_STATES.has(text(result?.state)) ? text(result.state) : "committed";
      setOperation({ state, message: text(result?.message) || (state === "committed" ? "Recipe revision committed. Waiting for its current cost projection." : "Recipe outcome requires reconciliation."), attempt: result?.attempt || null });
    } catch (error) {
      const uncertain = error?.inventoryDefinitive === false || error?.definitive === false;
      setOperation({
        state: uncertain ? "uncertain" : "rejected",
        message: uncertain
          ? "The publish outcome is uncertain. Reconcile this request before retrying or changing it."
          : text(error?.message) || "Recipe publication was rejected. Review the evidence and try again.",
        attempt: error?.attempt || error?.inventoryAttempt || null
      });
    }
  };

  const reconcile = async () => {
    if (operation.state !== "uncertain" || typeof onReconcile !== "function") return;
    setOperation((current) => ({ ...current, state: "reconciliation", message: "Reconciling the exact recipe request…" }));
    try {
      const result = await onReconcile(operation.attempt);
      const state = OPERATION_STATES.has(text(result?.state)) ? text(result.state) : "committed";
      setOperation({ state, message: text(result?.message) || "Recipe revision committed. Waiting for its current cost projection.", attempt: result?.attempt || null });
    } catch (error) {
      const uncertain = error?.inventoryDefinitive === false || error?.definitive === false;
      setOperation({
        state: uncertain ? "uncertain" : "rejected",
        message: uncertain ? "The recipe request is still uncertain. Keep its exact identity and reconcile again." : text(error?.message) || "Recipe reconciliation was rejected.",
        attempt: error?.attempt || error?.inventoryAttempt || operation.attempt || null
      });
    }
  };

  const resetRejected = async () => {
    if (operation.state !== "rejected" || !operation.attempt || typeof onReset !== "function") return;
    try {
      const result = await onReset(operation.attempt);
      setOperation({ state: "idle", message: text(result?.message) || "Rejected request cleared. Review the recipe and publish a new request." });
    } catch (error) {
      setOperation((current) => ({ ...current, message: text(error?.message) || "The rejected recipe request could not be cleared." }));
    }
  };

  return (
    <section className="inventory-recipe-editor" aria-labelledby={`inventory-recipe-title-${menuItemId || "unavailable"}`} data-inventory-recipe-editor data-menu-item-id={menuItemId} data-recipe-definition-state={recipe ? "published" : "no_recipe"}>
      <header>
        <div>
          <p className="inventory-recipe-editor__eyebrow">Physical implications</p>
          <h3 id={`inventory-recipe-title-${menuItemId || "unavailable"}`}>Recipe &amp; ingredient cost</h3>
          <p>Define production inputs for this menu item. Selling price and manual catalog cost remain unchanged.</p>
        </div>
        <CostEvidence projection={projection} sourceState={recipeSourceState} />
      </header>

      <form onSubmit={submit} aria-label={`Recipe for ${text(menuItem?.name) || "menu item"}`}>
        <fieldset disabled={outcomeLocked}>
          <legend>Recipe yield</legend>
          <label>
            <span>Output quantity</span>
            <input inputMode="decimal" required value={draft.yield.quantity} onChange={(event) => setDraft((current) => ({ ...current, yield: { ...current.yield, quantity: event.target.value } }))} />
          </label>
          <label>
            <span>Output unit</span>
            <select value={draft.yield.unit} onChange={(event) => setDraft((current) => ({ ...current, yield: { ...current.yield, unit: event.target.value } }))}>
              {!new Set(["portion", "each"]).has(draft.yield.unit) && draft.yield.unit && <option value={draft.yield.unit}>{draft.yield.unit} (current)</option>}
              <option value="portion">portions</option>
              <option value="each">each</option>
            </select>
          </label>
        </fieldset>

        <div className="inventory-recipe-editor__lines">
          <div>
            <h4>Ingredients</h4>
            <button type="button" className="ghost compact" onClick={addLine} disabled={outcomeLocked || availableIngredients.length === 0 || draft.ingredients.length >= availableIngredients.length}>Add ingredient</button>
          </div>
          {draft.ingredients.length === 0 ? <p className="inventory-recipe-editor__empty">No ingredients assigned yet.</p> : (
            <ol>
              {draft.ingredients.map((line, index) => {
                const ingredient = availableIngredients.find((item) => item.ingredientId === line.ingredientId);
                const unitOptions = ingredient?.recipeUnitOptions || [];
                const selectedUnit = line.unitKind === "ingredient_pack"
                  ? `ingredient_pack:${line.packConversionRevisionId}`
                  : `standard:${line.unitId}`;
                return (
                  <li key={`${line.ingredientId || "new"}-${index}`}>
                    <label>
                      <span>Ingredient</span>
                      <select disabled={outcomeLocked} value={line.ingredientId} onChange={(event) => {
                        const next = availableIngredients.find((item) => item.ingredientId === event.target.value);
                        const unit = next?.recipeUnitOptions?.[0];
                        patchLine(index, {
                          lineId: `line-${event.target.value}`,
                          ingredientId: event.target.value,
                          unitKind: unit?.unitKind || "standard",
                          unitId: unit?.unitId || "",
                          packConversionRevisionId: unit?.packConversionRevisionId || ""
                        });
                      }}>
                        <option value="">Choose ingredient</option>
                        {availableIngredients.map((item) => <option key={item.ingredientId} value={item.ingredientId}>{item.name}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>Quantity</span>
                      <input disabled={outcomeLocked} inputMode="decimal" value={line.quantity} onChange={(event) => patchLine(index, { quantity: event.target.value })} />
                    </label>
                    <label>
                      <span>Unit</span>
                      <select disabled={outcomeLocked} value={selectedUnit} onChange={(event) => {
                        const unit = unitOptions.find((option) => option.value === event.target.value);
                        patchLine(index, {
                          unitKind: unit?.unitKind || "standard",
                          unitId: unit?.unitId || "",
                          packConversionRevisionId: unit?.packConversionRevisionId || ""
                        });
                      }}>
                        {!unitOptions.some((option) => option.value === selectedUnit) && selectedUnit !== "standard:" && <option value={selectedUnit}>{selectedUnit} (verify)</option>}
                        <option value="">Choose unit</option>
                        {unitOptions.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>Quantity basis</span>
                      <select disabled={outcomeLocked} value={line.quantityBasis} onChange={(event) => patchLine(index, { quantityBasis: event.target.value, usableYield: event.target.value === "usable" ? line.usableYield : "" })}>
                        <option value="as_purchased">As purchased</option>
                        <option value="usable">Usable quantity</option>
                      </select>
                    </label>
                    {line.quantityBasis === "usable" && <label>
                      <span>Usable-yield ratio</span>
                      <input disabled={outcomeLocked} inputMode="decimal" placeholder="Unknown, e.g. 0.8" value={line.usableYield} onChange={(event) => patchLine(index, { usableYield: event.target.value })} />
                    </label>}
                    <button type="button" className="ghost compact" disabled={outcomeLocked} onClick={() => setDraft((current) => ({ ...current, ingredients: current.ingredients.filter((_, lineIndex) => lineIndex !== index) }))}>Remove<span className="visually-hidden"> {ingredient?.name || `ingredient ${index + 1}`}</span></button>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        {issues.length > 0 && dirty && <div className="inventory-recipe-editor__issues" role="alert"><strong>Recipe needs attention</strong><ul>{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div>}
        {!allowed && <p className="inventory-recipe-editor__recovery" data-recipe-publish-disabled data-capability-state="recovery">{disabledReason}</p>}
        {operation.state !== "idle" && <p
          className="inventory-recipe-editor__operation"
          role="status"
          data-recipe-operation-state={operation.state}
          data-capability-state={operation.state === "pending" ? "submitting"
            : operation.state === "committed" ? "success"
              : operation.state === "uncertain" ? "uncertain"
                : operation.state === "reconciliation" ? "reconciliation" : "error"}
        >{operation.message}</p>}
        {operation.state === "committed" && operation.attempt?.receipt && <p className="inventory-recipe-editor__receipt" data-capability-state="receipt">Server receipt retained for exact-request recovery.</p>}

        <div className="inventory-recipe-editor__actions" data-capability-state={operation.state === "idle" && allowed ? "ready" : undefined}>
          <button type="button" className="ghost" disabled={!dirty || outcomeLocked} onClick={() => { setDraft(baseline); setOperation({ state: "idle", message: "" }); }}>Discard recipe changes</button>
          {baselineConflict && <button type="button" className="ghost" onClick={() => {
            setDraft(baseline);
            setBaselineConflict(false);
            if (operation.state === "idle") setOperation({ state: "idle", message: "" });
          }}>Use current recipe</button>}
          {operation.state === "uncertain" && typeof onReconcile === "function" && <button type="button" className="cta" onClick={reconcile}>Reconcile exact request</button>}
          {operation.state === "rejected" && operation.attempt && typeof onReset === "function" && <button type="button" className="cta" onClick={resetRejected}>Review and retry</button>}
          <button type="submit" className="cta" disabled={!dirty || !allowed || issues.length > 0 || outcomeLocked}>{operation.state === "pending" ? "Publishing…" : recipe ? "Publish new recipe revision" : "Publish recipe"}</button>
        </div>
      </form>
    </section>
  );
}
