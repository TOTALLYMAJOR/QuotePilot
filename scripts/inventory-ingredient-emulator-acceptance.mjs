#!/usr/bin/env node

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { loadFirebaseAdmin } from "./firebase-admin-modular.mjs";

const projectId = String(process.env.GCLOUD_PROJECT || "").trim();
const authHost = String(process.env.FIREBASE_AUTH_EMULATOR_HOST || "").trim();
const firestoreHost = String(process.env.FIRESTORE_EMULATOR_HOST || "").trim();
const emulatorHubHost = String(process.env.FIREBASE_EMULATOR_HUB || "").trim();

function isLoopbackEndpoint(endpoint) {
  const raw = String(endpoint || "").trim();
  if (!raw || raw.includes("/")) return false;
  const hostname = raw.startsWith("[")
    ? raw.slice(1, raw.indexOf("]"))
    : raw.slice(0, raw.lastIndexOf(":"));
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

if (
  !projectId.startsWith("demo-")
  || !isLoopbackEndpoint(authHost)
  || !isLoopbackEndpoint(firestoreHost)
  || !isLoopbackEndpoint(emulatorHubHost)
  || String(process.env.INVENTORY_AUTHORITY_ENABLED).trim().toLowerCase() !== "true"
) {
  throw new Error(
    "Ingredient inventory acceptance is emulator-only and requires a demo-* project, loopback Auth/Firestore/Hub endpoints, and the global inventory gate."
  );
}

const emulatorResponse = await fetch(`http://${emulatorHubHost}/emulators`);
if (!emulatorResponse.ok) {
  throw new Error(`Unable to inspect Firebase emulator hub (${emulatorResponse.status}).`);
}
const emulators = await emulatorResponse.json();
const functionsHost = [emulators?.functions?.host, emulators?.functions?.port]
  .filter(Boolean)
  .join(":");
if (!isLoopbackEndpoint(functionsHost)) {
  throw new Error("A loopback Functions emulator is required for ingredient inventory acceptance.");
}

const admin = loadFirebaseAdmin();
if (!admin.getApps().length) admin.initializeApp({ projectId });
const auth = admin.getAuth();
const db = admin.getFirestore();

const REGION = "us-central1";
const ORGANIZATION_ID = "inventory-ingredient-emulator-org";
const ADMIN_EMAIL = "inventory-ingredient-admin@local.test";
const ADMIN_PASSWORD = `Qp-${randomBytes(24).toString("base64url")}-Aa1!`;
const EVIDENCE_TIME = "2026-09-09T04:00:00.000Z";
const emulatorAppCheckToken = [
  Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
  Buffer.from(JSON.stringify({ sub: "demo-inventory-ingredient-web" })).toString("base64url"),
  "emulator-only"
].join(".");

function comparable(value) {
  if (value === null || typeof value === "undefined") return value;
  if (typeof value?.toDate === "function") return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(comparable);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, comparable(value[key])])
    );
  }
  return value;
}

async function createAdminPrincipal() {
  const user = await auth.createUser({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    emailVerified: true
  });
  await Promise.all([
    db.collection("userRoles").doc(user.uid).set({
      role: "admin",
      organizationId: ORGANIZATION_ID,
      email: ADMIN_EMAIL,
      createdAt: admin.FieldValue.serverTimestamp(),
      updatedAt: admin.FieldValue.serverTimestamp()
    }),
    auth.setCustomUserClaims(user.uid, {
      role: "admin",
      organizationId: ORGANIZATION_ID,
      platformAdmin: false,
      claimsVersion: 1
    })
  ]);

  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        returnSecureToken: true
      })
    }
  );
  assert.equal(response.ok, true, "Auth emulator sign-in failed for the inventory admin.");
  const payload = await response.json();
  assert.ok(payload.idToken, "Auth emulator did not return an inventory admin ID token.");
  return { uid: user.uid, idToken: payload.idToken };
}

async function callInventory(principal, requestId, command) {
  const response = await fetch(
    `http://${functionsHost}/${projectId}/${REGION}/applyInventoryCommand`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:4174",
        Authorization: `Bearer ${principal.idToken}`,
        "X-Firebase-AppCheck": emulatorAppCheckToken
      },
      body: JSON.stringify({
        data: {
          schemaVersion: 2,
          organizationId: ORGANIZATION_ID,
          requestId,
          command
        }
      })
    }
  );
  const raw = await response.text();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error(`applyInventoryCommand returned non-JSON (${response.status}): ${raw.slice(0, 180)}`);
  }
  if (payload?.error) {
    const error = new Error(payload.error.message || "applyInventoryCommand failed.");
    error.status = String(payload.error.status || "");
    throw error;
  }
  return payload?.result || payload?.data || {};
}

async function callEventPreview(principal, data) {
  const response = await fetch(
    `http://${functionsHost}/${projectId}/${REGION}/previewEventInventory`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:4174",
        Authorization: `Bearer ${principal.idToken}`,
        "X-Firebase-AppCheck": emulatorAppCheckToken
      },
      body: JSON.stringify({ data })
    }
  );
  const raw = await response.text();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error(`previewEventInventory returned non-JSON (${response.status}): ${raw.slice(0, 180)}`);
  }
  if (payload?.error) {
    const error = new Error(payload.error.message || "previewEventInventory failed.");
    error.status = String(payload.error.status || "");
    throw error;
  }
  return payload?.result || payload?.data || {};
}

async function expectCallableError(action, status, messagePattern) {
  let caught;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `Expected callable status ${status}`);
  assert.equal(caught.status, status);
  if (messagePattern) assert.match(caught.message, messagePattern);
  return caught;
}

function locationCommand(locationId, name) {
  return {
    kind: "upsert_location",
    locationId,
    name,
    active: true,
    expectedRevision: 0
  };
}

function ingredientCommand(ingredientId, name) {
  return {
    kind: "upsert_ingredient",
    ingredientId,
    name,
    category: "Food",
    baseUnitId: "lb",
    active: true,
    expectedRevision: 0
  };
}

function openingCommand(ingredientId, quantity, note = "Verified opening count") {
  return {
    kind: "opening_balance",
    ingredientId,
    locationId: "main-kitchen",
    quantity,
    baseUnitId: "lb",
    occurredAtISO: EVIDENCE_TIME,
    note,
    expectedStockRevision: 0
  };
}

function recipeCommand() {
  return {
    kind: "publish_menu_recipe",
    menuItemId: "chicken-alfredo",
    expectedCatalogRevision: 1,
    expectedRecipeRevision: 0,
    outputYield: "10",
    outputUnitId: "portion",
    lines: [
      {
        lineId: "chicken-line",
        ingredientId: "chicken",
        quantity: "2",
        unitKind: "standard",
        unitId: "lb",
        quantityBasis: "as_purchased",
        usableYield: null
      },
      {
        lineId: "pasta-line",
        ingredientId: "pasta",
        quantity: "1",
        unitKind: "standard",
        unitId: "lb",
        quantityBasis: "as_purchased",
        usableYield: null
      }
    ]
  };
}

async function seedQuote(quoteId, { date, guests }) {
  const quoteRef = db.collection("organizations").doc(ORGANIZATION_ID)
    .collection("quotes").doc(quoteId);
  const snapshot = {
    id: quoteId,
    organizationId: ORGANIZATION_ID,
    activeVersionId: "v0001",
    event: { date, time: "17:00", guests },
    selection: {
      packageId: "dinner-package",
      packageInclusions: { menuItems: [] },
      menuItems: ["chicken-alfredo"],
      menuItemsSnapshot: [{ id: "chicken-alfredo", name: "Chicken Alfredo" }]
    }
  };
  await Promise.all([
    quoteRef.set({
      id: quoteId,
      organizationId: ORGANIZATION_ID,
      status: "accepted",
      activeVersionId: "v0001",
      versionMeta: { versionId: "v0001" }
    }),
    quoteRef.collection("versions").doc("v0001").set({
      versionId: "v0001",
      versionNumber: 1,
      quoteId,
      organizationId: ORGANIZATION_ID,
      snapshot
    })
  ]);
}

await Promise.all([
  db.collection("organizations").doc(ORGANIZATION_ID).set({
    name: "Ingredient Inventory Emulator Org",
    active: true,
    archived: false,
    status: "active"
  }),
  db.collection("organizations").doc(ORGANIZATION_ID)
    .collection("settings").doc("config").set({
      inventoryAuthorityEnabled: true,
      catalogRevision: 1,
      businessTimeZone: "America/Chicago"
    }),
  db.collection("organizations").doc(ORGANIZATION_ID)
    .collection("menuItems").doc("chicken-alfredo").set({
      eventTypeId: "dinner",
      categoryId: "entrees",
      name: "Chicken Alfredo",
      priceMinor: 1800,
      costMinor: null,
      pricingType: "per_person",
      type: "menu_item",
      active: true,
      createdAtISO: EVIDENCE_TIME
    }),
  db.collection("organizations").doc(ORGANIZATION_ID)
    .collection("quotes").doc("quote-alfredo").set({
      id: "quote-alfredo",
      organizationId: ORGANIZATION_ID,
      status: "accepted",
      activeVersionId: "v0001",
      versionMeta: { versionId: "v0001" }
    }),
  db.collection("organizations").doc(ORGANIZATION_ID)
    .collection("quotes").doc("quote-alfredo").collection("versions").doc("v0001").set({
      versionId: "v0001",
      versionNumber: 1,
      quoteId: "quote-alfredo",
      organizationId: ORGANIZATION_ID,
      snapshot: {
        id: "quote-alfredo",
        organizationId: ORGANIZATION_ID,
        activeVersionId: "v0001",
        event: { date: "2026-10-04", time: "17:00", guests: 100 },
        selection: {
          packageId: "dinner-package",
          packageInclusions: { menuItems: [] },
          menuItems: ["chicken-alfredo"],
          menuItemsSnapshot: [{ id: "chicken-alfredo", name: "Chicken Alfredo" }]
        }
      }
    }),
  seedQuote("quote-other-day", { date: "2026-10-11", guests: 125 }),
  seedQuote("quote-race-a", { date: "2026-10-18", guests: 150 }),
  seedQuote("quote-race-b", { date: "2026-10-25", guests: 150 })
]);
const principal = await createAdminPrincipal();

const locationResults = await Promise.all([
  callInventory(principal, "location-main-create-0001", locationCommand("main-kitchen", "Main kitchen")),
  callInventory(principal, "location-dry-create-0001", locationCommand("dry-storage", "Dry storage"))
]);
assert.equal(locationResults.every((result) => result.ok === true && result.idempotent === false), true);

const orgRef = db.collection("organizations").doc(ORGANIZATION_ID);
const [configurationSnapshot, workspaceSnapshot] = await Promise.all([
  orgRef.collection("inventoryAuthorityState").doc("ingredient-v2").get(),
  orgRef.collection("inventoryWorkspaceProjections").doc("current").get()
]);
assert.equal(configurationSnapshot.exists, true);
assert.equal(configurationSnapshot.data()?.locationCount, 2);
assert.equal(configurationSnapshot.data()?.ingredientCount, 0);
assert.equal(configurationSnapshot.data()?.revision, 2);
assert.equal(workspaceSnapshot.exists, true);
assert.equal(workspaceSnapshot.data()?.workspaceRevision, 2);
assert.deepEqual(
  workspaceSnapshot.data()?.locations?.map((location) => location.locationId).sort(),
  ["dry-storage", "main-kitchen"]
);

await callInventory(
  principal,
  "ingredient-chicken-create-0001",
  ingredientCommand("chicken", "Chicken breast")
);
const openingRequestId = "opening-chicken-create-0001";
const opening = openingCommand("chicken", "40");
const concurrentReplay = await Promise.all([
  callInventory(principal, openingRequestId, opening),
  callInventory(principal, openingRequestId, opening)
]);
assert.deepEqual(concurrentReplay.map((result) => result.idempotent).sort(), [false, true]);
assert.equal(concurrentReplay[0].receipt.receiptId, concurrentReplay[1].receipt.receiptId);
assert.equal(concurrentReplay.every((result) => result.result.onHandQuantity === "40"), true);

const chickenMovements = await orgRef.collection("inventoryMovements")
  .where("ingredientId", "==", "chicken").get();
assert.equal(chickenMovements.size, 1, "An exact opening-stock replay must not duplicate movement evidence.");
await expectCallableError(
  () => callInventory(
    principal,
    openingRequestId,
    openingCommand("chicken", "41", "Substituted opening count")
  ),
  "ALREADY_EXISTS",
  /different immutable ingredient inventory command/i
);
assert.equal((await orgRef.collection("inventoryMovements").where("ingredientId", "==", "chicken").get()).size, 1);

await callInventory(
  principal,
  "ingredient-pasta-create-0001",
  ingredientCommand("pasta", "Pasta")
);
await callInventory(
  principal,
  "opening-pasta-create-0001",
  openingCommand("pasta", "30", "Verified 30 lb pasta opening count")
);
await callInventory(
  principal,
  "ingredient-race-stock-create-0001",
  ingredientCommand("race-stock", "Concurrency fixture")
);
const competingOpenings = await Promise.allSettled([
  callInventory(principal, "opening-race-stock-a-0001", openingCommand("race-stock", "10", "Concurrent count A")),
  callInventory(principal, "opening-race-stock-b-0001", openingCommand("race-stock", "15", "Concurrent count B"))
]);
const winners = competingOpenings.filter((result) => result.status === "fulfilled");
const losers = competingOpenings.filter((result) => result.status === "rejected");
assert.equal(winners.length, 1, "Exactly one competing revision-zero opening command must commit.");
assert.equal(losers.length, 1, "Exactly one competing revision-zero opening command must fail closed.");
assert.equal(losers[0].reason?.status, "ALREADY_EXISTS");
const raceMovements = await orgRef.collection("inventoryMovements")
  .where("ingredientId", "==", "race-stock").get();
assert.equal(raceMovements.size, 1);
const raceStock = await orgRef.collection("inventoryStockStates")
  .where("ingredientId", "==", "race-stock").get();
assert.equal(raceStock.size, 1);
const winningQuantityMicros = winners[0].value.result.onHandMicros;
assert.equal(raceStock.docs[0].data()?.onHandMicros, winningQuantityMicros);
assert.ok([10_000_000, 15_000_000].includes(winningQuantityMicros));
assert.notEqual(raceStock.docs[0].data()?.onHandMicros, 25_000_000);

const chickenStockQueryBefore = await orgRef.collection("inventoryStockStates")
  .where("ingredientId", "==", "chicken").get();
assert.equal(chickenStockQueryBefore.size, 1);
const stockBeforeCost = comparable(chickenStockQueryBefore.docs[0].data());
const costResult = await callInventory(principal, "cost-chicken-create-0001", {
  kind: "record_ingredient_cost",
  ingredientId: "chicken",
  baseUnitId: "lb",
  availability: "available",
  sourceLabel: "Opening stock observation",
  observedAtISO: EVIDENCE_TIME,
  note: "40 lb counted with a total recorded cost of $120",
  expectedCostRevision: 0,
  basisQuantity: "40",
  totalCostMinor: 12000,
  currency: "USD"
});
assert.equal(costResult.result.availability, "available");
const chickenStockQueryAfter = await orgRef.collection("inventoryStockStates")
  .where("ingredientId", "==", "chicken").get();
assert.deepEqual(comparable(chickenStockQueryAfter.docs[0].data()), stockBeforeCost);
const chickenCostState = await orgRef.collection("inventoryCostStates")
  .where("ingredientId", "==", "chicken").get();
assert.equal(chickenCostState.size, 1);
assert.equal(chickenCostState.docs[0].data()?.basisQuantityMicros, 40_000_000);
assert.equal(chickenCostState.docs[0].data()?.totalCostMinor, 12000);
assert.equal(chickenCostState.docs[0].data()?.currency, "USD");
assert.equal(chickenStockQueryAfter.size, 1, "A cost command must not manufacture another stock state.");

await callInventory(principal, "cost-pasta-create-0001", {
  kind: "record_ingredient_cost",
  ingredientId: "pasta",
  baseUnitId: "lb",
  availability: "available",
  sourceLabel: "Opening pasta observation",
  observedAtISO: EVIDENCE_TIME,
  note: "30 lb purchase basis with a total recorded cost of $60",
  expectedCostRevision: 0,
  basisQuantity: "30",
  totalCostMinor: 6000,
  currency: "USD"
});

const recipeRequestId = "recipe-chicken-alfredo-create-0001";
const concurrentRecipeReplay = await Promise.all([
  callInventory(principal, recipeRequestId, recipeCommand()),
  callInventory(principal, recipeRequestId, recipeCommand())
]);
assert.deepEqual(concurrentRecipeReplay.map((result) => result.idempotent).sort(), [false, true]);
assert.equal(concurrentRecipeReplay[0].receipt.receiptId, concurrentRecipeReplay[1].receipt.receiptId);
const initialMenuCost = await orgRef.collection("inventoryMenuCostProjections").doc("chicken-alfredo").get();
assert.equal(initialMenuCost.exists, true);
assert.equal(initialMenuCost.data()?.freshness, "current");
assert.equal(initialMenuCost.data()?.status, "complete");
assert.equal(initialMenuCost.data()?.cost?.projectedCostMinor, 800);
assert.deepEqual(initialMenuCost.data()?.cost?.exactCostPerOutputUnitMinor, {
  numerator: "80",
  denominator: "1"
});
assert.equal((await orgRef.collection("inventoryRecipePolicies").get()).size, 1);
assert.equal((await orgRef.collection("inventoryRecipeDependencyIndex").doc("chicken").get()).data()?.menuItemIds?.[0], "chicken-alfredo");

const recipeRevisionId = concurrentRecipeReplay[0].result.recipeRevisionId;
function eventSelectionFor(quoteId, requiredOutputQuantity) {
  return {
  selectionId: `${quoteId}-chicken-alfredo`,
  menuItemId: "chicken-alfredo",
  recipeRevisionId,
  requiredOutputQuantity,
  outputUnitId: "portion",
  portionBasis: { kind: "explicit_output_quantity", evidenceId: "chicken-alfredo" },
  commercialProvenance: { kind: "direct", sourceId: "chicken-alfredo" }
  };
}
const eventSelection = eventSelectionFor("quote-alfredo", "100");

async function compileRequirement(quoteId, requiredOutputQuantity, requestId) {
  const selection = eventSelectionFor(quoteId, requiredOutputQuantity);
  const preview = await callEventPreview(principal, {
    schemaVersion: 2,
    organizationId: ORGANIZATION_ID,
    quoteId,
    quoteRevisionId: "v0001",
    requiredByBasis: { kind: "quote_event_start" },
    selections: [selection]
  });
  const result = await callInventory(principal, requestId, {
    kind: "compile_event_ingredient_demand",
    quoteId,
    quoteRevisionId: "v0001",
    requiredByBasis: { kind: "quote_event_start" },
    selections: [selection],
    expectedRequirementRevision: 0,
    expectedPreviewProjectionDigest: preview.projection.projectionDigest
  });
  return { preview, result };
}
const eventPreview = await callEventPreview(principal, {
  schemaVersion: 2,
  organizationId: ORGANIZATION_ID,
  quoteId: "quote-alfredo",
  quoteRevisionId: "v0001",
  requiredByBasis: { kind: "quote_event_start" },
  selections: [eventSelection]
});
assert.equal(eventPreview.preview, true);
assert.equal(eventPreview.projection.requiredByISO, "2026-10-04T22:00:00.000Z");
assert.equal(eventPreview.projection.projectedCostMinor, 8000);
assert.equal(eventPreview.projection.demandState, "complete");
assert.equal(eventPreview.projection.costState, "complete");
assert.equal(eventPreview.projection.availabilityState, "available");
const chickenDemand = eventPreview.projection.ingredients.find((row) => row.ingredientId === "chicken");
const pastaDemand = eventPreview.projection.ingredients.find((row) => row.ingredientId === "pasta");
assert.equal(chickenDemand.requiredQuantityMicros, 20_000_000);
assert.equal(chickenDemand.projectedCostMinor, 6000);
assert.equal(pastaDemand.requiredQuantityMicros, 10_000_000);
assert.equal(pastaDemand.projectedCostMinor, 2000);
assert.equal((await orgRef.collection("eventIngredientRequirementHeads").get()).size, 0,
  "Read-only event preview must not create requirement authority.");

const eventCommand = {
  kind: "compile_event_ingredient_demand",
  quoteId: "quote-alfredo",
  quoteRevisionId: "v0001",
  requiredByBasis: { kind: "quote_event_start" },
  selections: [eventSelection],
  expectedRequirementRevision: 0,
  expectedPreviewProjectionDigest: eventPreview.projection.projectionDigest
};
const eventRequestId = "event-demand-alfredo-create-0001";
const concurrentEventReplay = await Promise.all([
  callInventory(principal, eventRequestId, eventCommand),
  callInventory(principal, eventRequestId, eventCommand)
]);
assert.deepEqual(concurrentEventReplay.map((result) => result.idempotent).sort(), [false, true]);
assert.equal(concurrentEventReplay[0].receipt.receiptId, concurrentEventReplay[1].receipt.receiptId);
const savedEventProjection = await orgRef.collection("eventIngredientProjections").doc("quote-alfredo").get();
assert.equal(savedEventProjection.exists, true);
assert.equal(savedEventProjection.data()?.freshness, "as_recorded");
assert.equal(savedEventProjection.data()?.requirementRevision, 1);
assert.equal(savedEventProjection.data()?.projectedCostMinor, 8000);
assert.equal((await orgRef.collection("eventIngredientRequirements").doc("quote-alfredo")
  .collection("revisions").get()).size, 1);

const otherRequirement = await compileRequirement(
  "quote-other-day", "125", "event-demand-other-day-create-0001"
);
const allocateOtherCommand = {
  kind: "allocate_event_ingredients",
  quoteId: "quote-other-day",
  eventRequirementRevisionId: otherRequirement.result.result.eventRequirementRevisionId,
  locationId: "main-kitchen",
  expectedRequirementRevision: 1,
  expectedAllocationRevision: 0
};
const otherAllocation = await callInventory(
  principal, "allocate-other-day-create-0001", allocateOtherCommand
);
assert.equal(otherAllocation.result.state, "reserved");
assert.equal(otherAllocation.result.fullyAllocatedIngredientCount, 2);

const allocateAlfredoCommand = {
  kind: "allocate_event_ingredients",
  quoteId: "quote-alfredo",
  eventRequirementRevisionId: concurrentEventReplay[0].result.eventRequirementRevisionId,
  locationId: "main-kitchen",
  expectedRequirementRevision: 1,
  expectedAllocationRevision: 0
};
const allocationRequestId = "allocate-alfredo-create-0001";
const alfredoAllocation = await callInventory(principal, allocationRequestId, allocateAlfredoCommand);
assert.equal(alfredoAllocation.result.state, "shortage");
assert.equal(alfredoAllocation.result.shortageIngredientCount, 1);
const alfredoPlanRef = orgRef.collection("eventIngredientPlans").doc("quote-alfredo");
const alfredoPlan = (await alfredoPlanRef.get()).data();
const allocatedChicken = alfredoPlan?.ingredients?.find((row) => row.ingredientId === "chicken");
assert.equal(allocatedChicken?.requiredQuantityMicros, 20_000_000);
assert.equal(allocatedChicken?.allocatedQuantityMicros, 15_000_000);
assert.equal(allocatedChicken?.shortageQuantityMicros, 5_000_000);
assert.equal((await orgRef.collection("inventoryStockStates")
  .where("ingredientId", "==", "chicken").get()).docs[0].data()?.onHandMicros, 40_000_000,
"Allocating ingredients must not reduce physical on-hand stock.");
const chickenFence = (await orgRef.collection("inventoryAllocationFences")
  .where("ingredientId", "==", "chicken").get()).docs[0].data();
assert.equal(chickenFence?.committedMicros, 40_000_000,
  "Different event dates must contend on the same consumable-stock fence.");
const allocationReplay = await callInventory(principal, allocationRequestId, allocateAlfredoCommand);
assert.equal(allocationReplay.idempotent, true);
assert.equal(allocationReplay.receipt.receiptId, alfredoAllocation.receipt.receiptId);
await expectCallableError(
  () => callInventory(principal, allocationRequestId, {
    ...allocateAlfredoCommand,
    locationId: "dry-storage"
  }),
  "ALREADY_EXISTS",
  /different immutable ingredient inventory command/i
);
assert.equal((await alfredoPlanRef.collection("revisions").get()).size, 1);
const allocatedEventProjection = (await orgRef.collection("eventIngredientProjections")
  .doc("quote-alfredo").get()).data();
assert.equal(allocatedEventProjection?.allocation?.state, "shortage");
assert.equal(allocatedEventProjection?.allocation?.allocationRevision, 1);

const shortageReceivingRequest = {
  kind: "receive_stock",
  ingredientId: "chicken",
  locationId: "main-kitchen",
  quantity: "5",
  baseUnitId: "lb",
  occurredAtISO: "2026-09-09T04:15:00.000Z",
  sourceLabel: "Shortage recovery receiving observation",
  note: "5 lb received to recover the active shortage",
  expectedStockRevision: 1,
  expectedCostRevision: 1,
  cost: { availability: "available", totalCostMinor: 1800, currency: "USD" }
};
const shortageReceiving = await callInventory(
  principal, "receive-shortage-recovery-0001", shortageReceivingRequest
);
assert.equal(shortageReceiving.result.onHandMicros, 45_000_000);
assert.equal(shortageReceiving.result.costRevision, 1);
const toppedUpAllocation = await callInventory(principal, "allocate-alfredo-top-up-0002", {
  ...allocateAlfredoCommand,
  expectedAllocationRevision: 1
});
assert.equal(toppedUpAllocation.result.state, "reserved");
assert.equal(toppedUpAllocation.result.allocationRevision, 2);
assert.equal(toppedUpAllocation.result.shortageIngredientCount, 0);
const toppedUpPlan = (await alfredoPlanRef.get()).data();
assert.equal(toppedUpPlan?.ingredients?.find(
  (row) => row.ingredientId === "chicken"
)?.allocatedQuantityMicros, 20_000_000);
assert.equal((await orgRef.collection("inventoryAllocationFences")
  .where("ingredientId", "==", "chicken").get()).docs[0].data()?.committedMicros, 45_000_000);

const releaseAlfredo = await callInventory(principal, "release-alfredo-create-0001", {
  kind: "release_event_ingredients",
  quoteId: "quote-alfredo",
  expectedAllocationRevision: 2,
  reason: "Acceptance fixture release"
});
assert.equal(releaseAlfredo.result.state, "released");
assert.equal(releaseAlfredo.result.releasedIngredientCount, 2);
assert.equal(Object.hasOwn(releaseAlfredo.result, "releaseReason"), false);
assert.equal((await orgRef.collection("inventoryStockStates")
  .where("ingredientId", "==", "chicken").get()).docs[0].data()?.onHandMicros, 45_000_000,
"Release must not mutate physical stock.");
assert.equal((await orgRef.collection("inventoryAllocationFences")
  .where("ingredientId", "==", "chicken").get()).docs[0].data()?.committedMicros, 25_000_000);
assert.equal((await alfredoPlanRef.collection("revisions").get()).size, 3);
await expectCallableError(
  () => callInventory(principal, "release-alfredo-again-0002", {
    kind: "release_event_ingredients",
    quoteId: "quote-alfredo",
    expectedAllocationRevision: 3,
    reason: "A second release must fail"
  }),
  "FAILED_PRECONDITION",
  /already released/i
);

await callInventory(principal, "release-other-day-create-0001", {
  kind: "release_event_ingredients",
  quoteId: "quote-other-day",
  expectedAllocationRevision: 1,
  reason: "Clear stock before concurrency acceptance"
});
const [raceRequirementA, raceRequirementB] = await Promise.all([
  compileRequirement("quote-race-a", "150", "event-demand-race-a-create-0001"),
  compileRequirement("quote-race-b", "150", "event-demand-race-b-create-0001")
]);
const competingAllocations = await Promise.all([
  callInventory(principal, "allocate-race-a-create-0001", {
    kind: "allocate_event_ingredients",
    quoteId: "quote-race-a",
    eventRequirementRevisionId: raceRequirementA.result.result.eventRequirementRevisionId,
    locationId: "main-kitchen",
    expectedRequirementRevision: 1,
    expectedAllocationRevision: 0
  }),
  callInventory(principal, "allocate-race-b-create-0001", {
    kind: "allocate_event_ingredients",
    quoteId: "quote-race-b",
    eventRequirementRevisionId: raceRequirementB.result.result.eventRequirementRevisionId,
    locationId: "main-kitchen",
    expectedRequirementRevision: 1,
    expectedAllocationRevision: 0
  })
]);
const racePlans = await Promise.all(["quote-race-a", "quote-race-b"].map(async (quoteId) =>
  (await orgRef.collection("eventIngredientPlans").doc(quoteId).get()).data()));
const totalRaceChickenAllocation = racePlans.reduce((sum, plan) => sum
  + plan.ingredients.find((row) => row.ingredientId === "chicken").allocatedQuantityMicros, 0);
assert.equal(totalRaceChickenAllocation, 45_000_000,
  "Concurrent event allocations must never exceed shared physical chicken stock.");
assert.equal(competingAllocations.some((result) => result.result.state === "shortage"), true);
assert.equal((await orgRef.collection("inventoryAllocationFences")
  .where("ingredientId", "==", "chicken").get()).docs[0].data()?.committedMicros, 45_000_000);
await Promise.all(racePlans.map((plan) => callInventory(
  principal,
  `release-${plan.quoteId}-create-0001`,
  {
    kind: "release_event_ingredients",
    quoteId: plan.quoteId,
    expectedAllocationRevision: 1,
    reason: "Clear concurrent acceptance fixture"
  }
)));

const receivingRequest = {
  kind: "receive_stock",
  ingredientId: "chicken",
  locationId: "main-kitchen",
  quantity: "5",
  baseUnitId: "lb",
  occurredAtISO: "2026-09-09T04:30:00.000Z",
  sourceLabel: "Acceptance receiving observation",
  note: "5 lb received at a different observed cost",
  expectedStockRevision: 2,
  expectedCostRevision: 1,
  cost: { availability: "available", totalCostMinor: 2500, currency: "USD" }
};
const receivingResult = await callInventory(
  principal, "receive-chicken-create-0001", receivingRequest
);
assert.equal(receivingResult.result.onHandMicros, 50_000_000);
assert.equal(receivingResult.result.costRevision, 1,
  "A later receipt must not silently replace the established planning-cost basis.");
assert.equal(Object.hasOwn(receivingResult.result, "planningBasisAction"), false);
assert.equal(Object.hasOwn(receivingResult.result, "affectedMenuItemIds"), false);
const receivingReplay = await callInventory(principal, "receive-chicken-create-0001", receivingRequest);
assert.equal(receivingReplay.idempotent, true);
assert.equal((await orgRef.collection("inventoryMovements")
  .where("ingredientId", "==", "chicken").get()).size, 3);
assert.equal((await orgRef.collection("inventoryCostStates")
  .where("ingredientId", "==", "chicken").get()).docs[0].data()?.totalCostMinor, 12000);
const receivingEvidence = await orgRef.collection("inventoryCostEvidence")
  .doc(receivingResult.result.costEvidenceId).get();
assert.equal(receivingEvidence.data()?.planningBasisAction, "retained_existing");
assert.equal(receivingEvidence.data()?.totalCostMinor, 2500);

const changedChickenCost = await callInventory(principal, "cost-chicken-change-0002", {
  kind: "record_ingredient_cost",
  ingredientId: "chicken",
  baseUnitId: "lb",
  availability: "available",
  sourceLabel: "Current chicken purchase observation",
  observedAtISO: "2026-09-09T05:00:00.000Z",
  note: "40 lb purchase basis with a total recorded cost of $160",
  expectedCostRevision: 1,
  basisQuantity: "40",
  totalCostMinor: 16000,
  currency: "USD"
});
assert.deepEqual(changedChickenCost.result.affectedMenuItemIds, ["chicken-alfredo"]);
const changedMenuCost = await orgRef.collection("inventoryMenuCostProjections").doc("chicken-alfredo").get();
assert.equal(changedMenuCost.data()?.freshness, "current");
assert.equal(changedMenuCost.data()?.cost?.projectedCostMinor, 1000);
assert.deepEqual(changedMenuCost.data()?.cost?.exactCostPerOutputUnitMinor, {
  numerator: "100",
  denominator: "1"
});
const retainedEventProjection = await orgRef.collection("eventIngredientProjections").doc("quote-alfredo").get();
assert.equal(retainedEventProjection.data()?.freshness, "as_recorded");
assert.equal(retainedEventProjection.data()?.projectedCostMinor, 8000,
  "Recorded event evidence must remain pinned rather than silently claiming the new cost basis.");
const changedEventPreview = await callEventPreview(principal, {
  schemaVersion: 2,
  organizationId: ORGANIZATION_ID,
  quoteId: "quote-alfredo",
  quoteRevisionId: "v0001",
  requiredByBasis: { kind: "quote_event_start" },
  selections: [eventSelection]
});
assert.equal(changedEventPreview.projection.projectedCostMinor, 10000);
await assert.rejects(
  callInventory(principal, "event-demand-stale-preview-0001", {
    ...eventCommand,
    expectedRequirementRevision: 1
  }),
  (error) => error?.status === "ABORTED",
  "Recording must reject when its preview cost or stock digest is no longer authoritative."
);
assert.equal((await orgRef.collection("inventoryRecipePolicies").get()).size, 1,
  "An ingredient cost change must not rewrite immutable recipe history.");
assert.equal((await orgRef.collection("menuItems").doc("chicken-alfredo").get()).data()?.costMinor, null,
  "Derived ingredient cost must not overwrite the manual catalog cost field.");

console.log("Authoritative ingredient inventory emulator acceptance passed.");
console.log("- demo-only loopback safety, global gate, tenant gate, verified admin claims, and role authority were required");
console.log("- concurrent location creates preserved the shared configuration fence and bounded workspace projection");
console.log("- exact opening-stock replay was idempotent and request substitution failed closed with one immutable movement");
console.log("- competing revision-zero openings produced exactly one winner and never summed physical stock");
console.log("- recorded purchase cost advanced cost evidence without changing physical stock");
console.log("- concurrent recipe publication produced one immutable recipe and one idempotent replay");
console.log("- $8 per 10-portion recipe projected $0.80 per portion from bounded cost evidence");
console.log("- 100 explicit portions compiled to 20 lb chicken + 10 lb pasta and $80 projected ingredient cost");
console.log("- event preview wrote nothing; exact compile replay produced one immutable requirement and one realtime projection");
console.log("- a 25 lb allocation on another date left 15 lb available and forced a safe 15 lb allocation with a 5 lb shortage");
console.log("- concurrent allocations contended on shared ingredient-location fences and never exceeded physical stock");
console.log("- release removed commitment without changing physical stock and preserved immutable plan revisions");
console.log("- exact receiving replay produced one movement, while a later receipt cost stayed evidence instead of replacing planning cost");
console.log("- recorded event evidence remained historical while a new preview used changed cost, and stale-preview recording failed closed");
console.log("- a chicken cost change reprojected only its reverse-indexed menu dependency to $1.00 per portion");
console.log("- recipe costing did not require stock and never mutated the catalog selling or manual cost authority");
