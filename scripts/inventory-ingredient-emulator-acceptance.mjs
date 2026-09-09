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
    })
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
const eventSelection = {
  selectionId: "chicken-alfredo",
  menuItemId: "chicken-alfredo",
  recipeRevisionId,
  requiredOutputQuantity: "100",
  outputUnitId: "portion",
  portionBasis: { kind: "explicit_output_quantity", evidenceId: "chicken-alfredo" },
  commercialProvenance: { kind: "direct", sourceId: "chicken-alfredo" }
};
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
console.log("- recorded event evidence remained historical while a new preview used changed cost, and stale-preview recording failed closed");
console.log("- a chicken cost change reprojected only its reverse-indexed menu dependency to $1.00 per portion");
console.log("- recipe costing did not require stock and never mutated the catalog selling or manual cost authority");
