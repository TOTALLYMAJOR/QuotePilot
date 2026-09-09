import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import viteConfigFactory from "../../../vite.config.js";

const LEGACY_APP_SOURCE = readFileSync(
  fileURLToPath(new URL("../../LegacyApp.jsx", import.meta.url)),
  "utf8"
);
const AMBIENT_APP_SOURCE = readFileSync(
  fileURLToPath(new URL("../../App.jsx", import.meta.url)),
  "utf8"
);

function selectedActiveApp(ambientValue) {
  const original = process.env.VITE_AMBIENT_UI_ENABLED;
  if (ambientValue === undefined) delete process.env.VITE_AMBIENT_UI_ENABLED;
  else process.env.VITE_AMBIENT_UI_ENABLED = ambientValue;

  try {
    const config = viteConfigFactory({ mode: "production" });
    return config.resolve.alias["quotepilot-active-app"];
  } finally {
    if (original === undefined) delete process.env.VITE_AMBIENT_UI_ENABLED;
    else process.env.VITE_AMBIENT_UI_ENABLED = original;
  }
}

describe("ingredient inventory production-route coverage", () => {
  test("wires the triple-gated inventory route into the default production graph", () => {
    expect(selectedActiveApp("false")).toMatch(/\/src\/LegacyApp\.jsx$/);
    expect(LEGACY_APP_SOURCE).toContain('import.meta.env.VITE_INVENTORY_AUTHORITY_ENABLED === "true"');
    expect(LEGACY_APP_SOURCE).toContain("CUSTOMER_CENTERED_WORKSPACE_ENABLED\n    && INVENTORY_AUTHORITY_UI_ENABLED");
    expect(LEGACY_APP_SOURCE).toContain("effectiveSettings.inventoryAuthorityEnabled === true");
    expect(LEGACY_APP_SOURCE).toContain('import("./components/InventoryWorkspace")');
    expect(LEGACY_APP_SOURCE).toContain("resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.INVENTORY && inventoryWorkspaceEnabled");
    expect(LEGACY_APP_SOURCE).toContain("navigateWorkspace(WORKSPACE_PATHS.inventory)");
    expect(LEGACY_APP_SOURCE).toContain('import { useInventoryRecipeExtension } from "./hooks/useInventoryRecipeExtension"');
    expect(LEGACY_APP_SOURCE).toContain("active: catalogRouteOpen || catalogModalOpen");
    expect(LEGACY_APP_SOURCE).toContain("inventoryRecipeExtension={inventoryRecipeExtension}");
    expect(LEGACY_APP_SOURCE).toContain("<InventoryMenuCostSummary");
    expect(LEGACY_APP_SOURCE).toContain('title="Menu ingredient cost"');
    expect(LEGACY_APP_SOURCE).toContain('useEventIngredientProjection({');
    expect(LEGACY_APP_SOURCE).toContain('data-capability-id="inventory-event-ingredient-consequence"');
    expect(LEGACY_APP_SOURCE).toContain('<EventIngredientProjectionPanel');
  });

  test("retains the same fail-closed route in the Ambient production graph", () => {
    expect(selectedActiveApp("true")).toMatch(/\/src\/App\.jsx$/);
    expect(AMBIENT_APP_SOURCE).toContain('import.meta.env.VITE_INVENTORY_AUTHORITY_ENABLED === "true"');
    expect(AMBIENT_APP_SOURCE).toContain("effectiveSettings.inventoryAuthorityEnabled === true");
    expect(AMBIENT_APP_SOURCE).toContain('import("./components/InventoryWorkspace")');
    expect(AMBIENT_APP_SOURCE).toContain("resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.INVENTORY && inventoryWorkspaceEnabled");
    expect(AMBIENT_APP_SOURCE).toContain("inventoryRecipeAccess");
    expect(AMBIENT_APP_SOURCE).toContain('useEventIngredientProjection({');
    expect(AMBIENT_APP_SOURCE).toContain('data-capability-id="inventory-event-ingredient-consequence"');
    expect(AMBIENT_APP_SOURCE).toContain('<EventIngredientProjectionPanel');
  });
});
