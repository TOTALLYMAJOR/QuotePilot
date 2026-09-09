import { useCallback, useEffect, useMemo, useState } from "react";
import {
  applyInventoryCommand,
  buildInventoryRequestId,
  getInventoryMenuCostBrowserAccess,
  reconcileInventoryCommand,
  resetDefinitiveInventoryCommand,
  subscribeToInventoryMenuCostProjection,
  subscribeToInventoryMenuCostProjections,
  subscribeToInventoryRecipeIngredients
} from "../lib/inventoryAuthorityClient";

function text(value) {
  return String(value ?? "").trim();
}

function errorWithAttempt(error, requestId) {
  const wrapped = new Error(text(error?.message) || "Inventory recipe publication failed.", { cause: error });
  wrapped.code = error?.code;
  wrapped.inventoryDefinitive = error?.inventoryDefinitive;
  wrapped.definitive = error?.definitive;
  wrapped.inventoryAttempt = { requestId };
  return wrapped;
}

export function useInventoryRecipeExtension({
  active = false,
  injected = null,
  organizationId,
  role,
  browserEnabled,
  tenantEnabled
}) {
  const access = useMemo(() => getInventoryMenuCostBrowserAccess({
    organizationId, role, browserEnabled, tenantEnabled
  }), [browserEnabled, organizationId, role, tenantEnabled]);
  const scope = useMemo(() => ({ organizationId, role, browserEnabled, tenantEnabled }), [
    browserEnabled, organizationId, role, tenantEnabled
  ]);
  const [activeMenuItemId, setActiveMenuItemId] = useState("");
  const [menuCosts, setMenuCosts] = useState({
    state: "unavailable", projections: [], byMenuItemId: {}, bounded: false
  });
  const [exactMenuCost, setExactMenuCost] = useState({
    menuItemId: "", state: "unavailable", exists: false, projection: null
  });
  const [ingredients, setIngredients] = useState({ state: "unavailable", items: [], bounded: false });

  useEffect(() => {
    if (injected || !active || !access.readEnabled) {
      setMenuCosts({ state: "unavailable", projections: [], byMenuItemId: {}, bounded: false });
      return undefined;
    }
    let listening = true;
    let unsubscribe = () => {};
    try {
      unsubscribe = subscribeToInventoryMenuCostProjections({
        ...scope,
        onData: (model) => listening && setMenuCosts({
          state: model.freshness,
          projections: model.projections,
          byMenuItemId: model.byMenuItemId,
          bounded: model.bounded === true
        }),
        onError: () => listening && setMenuCosts((current) => ({ ...current, state: "unavailable" }))
      });
    } catch {
      setMenuCosts({ state: "unavailable", projections: [], byMenuItemId: {}, bounded: false });
    }
    return () => {
      listening = false;
      unsubscribe();
    };
  }, [access.readEnabled, active, injected, scope]);

  useEffect(() => {
    if (injected || !active || !access.mutationEnabled) {
      setIngredients({ state: "unavailable", items: [], bounded: false });
      return undefined;
    }
    let listening = true;
    let unsubscribe = () => {};
    try {
      unsubscribe = subscribeToInventoryRecipeIngredients({
        ...scope,
        onData: (model) => listening && setIngredients({
          state: model.freshness,
          items: model.ingredients,
          bounded: model.bounded === true
        }),
        onError: () => listening && setIngredients((current) => ({ ...current, state: "unavailable" }))
      });
    } catch {
      setIngredients({ state: "unavailable", items: [], bounded: false });
    }
    return () => {
      listening = false;
      unsubscribe();
    };
  }, [access.mutationEnabled, active, injected, scope]);

  useEffect(() => {
    if (injected || !active || !access.readEnabled || !activeMenuItemId) {
      setExactMenuCost({ menuItemId: activeMenuItemId, state: "unavailable", exists: false, projection: null });
      return undefined;
    }
    let listening = true;
    let unsubscribe = () => {};
    setExactMenuCost({ menuItemId: activeMenuItemId, state: "loading", exists: false, projection: null });
    try {
      unsubscribe = subscribeToInventoryMenuCostProjection({
        ...scope,
        menuItemId: activeMenuItemId,
        onData: (model) => listening && setExactMenuCost({
          menuItemId: model.menuItemId,
          state: model.freshness,
          exists: model.exists === true,
          projection: model.projection
        }),
        onError: () => listening && setExactMenuCost((current) => ({ ...current, state: "unavailable" }))
      });
    } catch {
      setExactMenuCost({ menuItemId: activeMenuItemId, state: "unavailable", exists: false, projection: null });
    }
    return () => {
      listening = false;
      unsubscribe();
    };
  }, [access.readEnabled, active, activeMenuItemId, injected, scope]);

  const publishRecipe = useCallback(async (command) => {
    const requestId = buildInventoryRequestId();
    try {
      const result = await applyInventoryCommand({ ...scope, requestId, command });
      return {
        state: "committed",
        message: "Recipe revision committed with a current cost projection.",
        attempt: { requestId, receipt: result.receipt, confirmation: result.confirmation }
      };
    } catch (error) {
      throw errorWithAttempt(error, requestId);
    }
  }, [scope]);

  const reconcileRecipe = useCallback(async (attempt) => {
    const result = await reconcileInventoryCommand({ ...scope, requestId: attempt?.requestId });
    return {
      state: "committed",
      message: "The exact recipe request is committed and reconciled.",
      attempt: { requestId: attempt?.requestId, receipt: result.receipt, confirmation: result.confirmation }
    };
  }, [scope]);

  const resetRecipe = useCallback(async (attempt) => {
    const reset = resetDefinitiveInventoryCommand({ ...scope, requestId: attempt?.requestId });
    if (!reset) throw new Error("The rejected recipe request is no longer available to reset.");
    return { state: "idle", message: "Rejected request cleared. Review the recipe and publish a new request." };
  }, [scope]);

  const onActiveMenuItemChange = useCallback((menuItemId) => {
    setActiveMenuItemId(text(menuItemId));
  }, []);

  if (injected) return injected;

  const costsByMenuItemId = { ...menuCosts.byMenuItemId };
  if (activeMenuItemId) {
    if (exactMenuCost.menuItemId === activeMenuItemId && exactMenuCost.projection) {
      costsByMenuItemId[activeMenuItemId] = exactMenuCost.projection;
    } else {
      delete costsByMenuItemId[activeMenuItemId];
    }
  }
  return {
    enabled: access.readEnabled,
    ingredients: ingredients.items,
    ingredientSourceState: ingredients.state,
    ingredientProjectionBounded: ingredients.bounded,
    recipesByMenuItemId: Object.fromEntries(Object.entries(costsByMenuItemId)
      .map(([menuItemId, projection]) => [menuItemId, projection.recipeDefinition])),
    menuCostProjections: menuCosts.projections,
    menuCostProjectionsByMenuItemId: costsByMenuItemId,
    menuCostProjectionSourceState: menuCosts.state,
    menuCostProjectionBounded: menuCosts.bounded,
    activeMenuItemId,
    activeMenuCostProjectionState: exactMenuCost.menuItemId === activeMenuItemId
      ? exactMenuCost.state
      : "loading",
    onActiveMenuItemChange,
    publishRecipe: access.mutationEnabled ? publishRecipe : undefined,
    reconcileRecipe: access.mutationEnabled ? reconcileRecipe : undefined,
    resetRecipe: access.mutationEnabled ? resetRecipe : undefined
  };
}
