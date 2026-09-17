import React, { useEffect, useMemo, useState } from "react";
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
  const [mode, setMode] = useState("current");
  useEffect(() => {
    window.inventoryTask4Harness = { setMode };
    return () => { delete window.inventoryTask4Harness; };
  }, []);
  const read = useMemo(() => {
    if (mode === "loading") return { state: "loading", model: null, error: "" };
    if (mode === "error") return { state: "unavailable", model: null, error: "Inventory fixture unavailable." };
    if (mode === "empty") return { state: "current", model: { ...model, ingredients: [] }, error: "" };
    return { state: "current", model, error: "" };
  }, [mode]);
  return (
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
          plan: null,
          source: {
            eligible: true,
            allocationFingerprint: "a".repeat(64),
            shortageFingerprint: "b".repeat(64),
            sourceFingerprint: "c".repeat(64),
            shortages: [{ ingredientId: "chicken", locationId: "main-kitchen", baseUnitId: "lb", shortageQuantity: "5" }]
          }
        }),
        applyPlan: async () => { throw new Error("Fixture does not submit authority commands."); }
      }}
      mobileCaptureProps={{ organizationId: ORG, userId: "e2e-admin", role: "admin", browserEnabled: true, tenantEnabled: true, submitCommand: async () => { throw new Error("Fixture does not submit authority commands."); } }}
      onRetry={() => setMode("current")}
      onSubmit={() => {}}
      onReconcile={() => {}}
      onReset={() => {}}
    />
  );
}

createRoot(document.getElementById("root")).render(<Harness />);
