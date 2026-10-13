import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { InventoryWorkspaceView } from "../src/components/InventoryWorkspace";
import "../src/styles.css";

const ORG = "e2e-inventory-org";
const movementId = `imv_${"a".repeat(48)}`;
const ingredient = {
  organizationId: ORG,
  ingredientId: "chicken",
  name: "Chicken",
  nameSortKey: "chicken",
  category: "Protein",
  baseUnitId: "lb",
  dimension: "mass",
  active: true,
  ingredientRevision: 1,
  updatedAtISO: "2026-08-01T12:00:00.000Z",
  stock: {
    state: "recorded",
    availability: "current",
    revision: 4,
    onHandMicros: 25_000_000,
    quantity: "25",
    allocationRevision: 2,
    committedMicros: 25_000_000,
    committedQuantity: "25",
    availableToAllocateMicros: 0,
    availableToAllocateQuantity: "0",
    unit: "lb",
    locationId: "main-kitchen",
    lastMovementId: movementId
  },
  cost: { state: "not_recorded", availability: "not_yet_available", revision: 0, sourceLabel: "", observedAtISO: "", lastCostEvidenceId: "" },
  packConversions: [],
  locationId: "main-kitchen",
  locationName: "Main kitchen"
};

const riceIngredient = {
  ...ingredient,
  ingredientId: "rice",
  name: "Rice",
  nameSortKey: "rice",
  category: "Dry goods",
  updatedAtISO: "2026-09-01T12:00:00.000Z",
  stock: {
    ...ingredient.stock,
    revision: 2,
    onHandMicros: 18_000_000,
    quantity: "18",
    committedMicros: 0,
    committedQuantity: "0",
    availableToAllocateMicros: 18_000_000,
    availableToAllocateQuantity: "18",
    lastMovementId: `imv_${"b".repeat(48)}`
  }
};

const model = {
  schemaVersion: 2,
  organizationId: ORG,
  workspace: { organizationId: ORG, locations: [{ locationId: "main-kitchen", name: "Main kitchen", active: true, revision: 1 }] },
  ingredients: [ingredient],
  sources: {
    workspace: { state: "current", fromCache: false, hasPendingWrites: false },
    ingredients: { state: "current", fromCache: false, hasPendingWrites: false }
  },
  freshness: "current",
  bounded: false
};

const attempts = Object.fromEntries(["location", "ingredient", "stock", "stock_count", "receiving", "cost", "conversion"].map((axis) => [axis, { state: "ready", error: "", requestId: "", receipt: null, confirmation: null }]));
const access = { organizationId: ORG, role: "admin", readEnabled: true, mutationEnabled: true, reason: "" };

function Harness() {
  const supplyPlan = useRef(null);
  const [mode, setMode] = useState("current");
  const [userId, setUserId] = useState("e2e-admin");
  const [riceRevision, setRiceRevision] = useState(2);
  useEffect(() => {
    window.inventoryTask4Harness = { setMode, setUserId, setRiceRevision };
    return () => { delete window.inventoryTask4Harness; };
  }, []);
  const currentModel = useMemo(() => ({
    ...model,
    ingredients: [ingredient, { ...riceIngredient, stock: { ...riceIngredient.stock, revision: riceRevision } }]
  }), [riceRevision]);
  const read = useMemo(() => {
    if (mode === "loading") return { state: "loading", model: null, error: "" };
    if (mode === "error") return { state: "unavailable", model: null, error: "Inventory fixture unavailable." };
    if (mode === "empty") return { state: "current", model: { ...currentModel, ingredients: [] }, error: "" };
    return { state: "current", model: currentModel, error: "" };
  }, [currentModel, mode]);
  return (
    <div data-e2e-authority="mock-server">
    <InventoryWorkspaceView
      access={access}
      read={read}
      attempts={attempts}
      exceptionWorkspaceEnabled
      eventSupplyActionPlanEnabled
      inventoryMobileCaptureEnabled
      supplyPlanProps={{
        organizationId: ORG,
        role: "admin",
        events: [{ id: "quote-accepted", quoteNumber: "QP-401", status: "accepted", event: { name: "Autumn dinner" } }],
        getPlan: async () => ({
          resolution: "not_started",
          stale: false,
          plan: supplyPlan.current,
          source: {
            eligible: true,
            allocationFingerprint: "a".repeat(64),
            shortageFingerprint: "b".repeat(64),
            sourceFingerprint: "c".repeat(64),
            shortages: [{ ingredientId: "chicken", locationId: "main-kitchen", baseUnitId: "lb", shortageQuantity: "5" }]
          }
        }),
        applyPlan: async ({ command }) => {
          supplyPlan.current = command.kind === "save_draft"
            ? { status: "draft", planRevision: (supplyPlan.current?.planRevision || 0) + 1, edits: command.edits }
            : { ...supplyPlan.current, status: "approved", planRevision: supplyPlan.current.planRevision + 1 };
          return { receipt: { receiptId: "mock-internal-supply-receipt" } };
        }
      }}
      mobileCaptureProps={{
        organizationId: ORG,
        userId,
        role: "admin",
        browserEnabled: true,
        tenantEnabled: true,
        submitCommand: async ({ requestId, command }) => ({
          receipt: { receiptId: `mock-${command.ingredientId}-${requestId.slice(-6)}` },
          confirmation: { stockRevision: command.expectedStockRevision + 1 }
        })
      }}
      onRetry={() => setMode("current")}
      onSubmit={() => {}}
      onReconcile={() => {}}
      onReset={() => {}}
    />
    </div>
  );
}

createRoot(document.getElementById("root")).render(<Harness />);
