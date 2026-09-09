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

await Promise.all([
  db.collection("organizations").doc(ORGANIZATION_ID).set({
    name: "Ingredient Inventory Emulator Org",
    active: true,
    archived: false,
    status: "active"
  }),
  db.collection("organizations").doc(ORGANIZATION_ID)
    .collection("settings").doc("config").set({ inventoryAuthorityEnabled: true })
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
const competingOpenings = await Promise.allSettled([
  callInventory(principal, "opening-pasta-race-a-0001", openingCommand("pasta", "10", "Concurrent count A")),
  callInventory(principal, "opening-pasta-race-b-0001", openingCommand("pasta", "15", "Concurrent count B"))
]);
const winners = competingOpenings.filter((result) => result.status === "fulfilled");
const losers = competingOpenings.filter((result) => result.status === "rejected");
assert.equal(winners.length, 1, "Exactly one competing revision-zero opening command must commit.");
assert.equal(losers.length, 1, "Exactly one competing revision-zero opening command must fail closed.");
assert.equal(losers[0].reason?.status, "ALREADY_EXISTS");
const pastaMovements = await orgRef.collection("inventoryMovements")
  .where("ingredientId", "==", "pasta").get();
assert.equal(pastaMovements.size, 1);
const pastaStock = await orgRef.collection("inventoryStockStates")
  .where("ingredientId", "==", "pasta").get();
assert.equal(pastaStock.size, 1);
const winningQuantityMicros = winners[0].value.result.onHandMicros;
assert.equal(pastaStock.docs[0].data()?.onHandMicros, winningQuantityMicros);
assert.ok([10_000_000, 15_000_000].includes(winningQuantityMicros));
assert.notEqual(pastaStock.docs[0].data()?.onHandMicros, 25_000_000);

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

console.log("Authoritative ingredient inventory emulator acceptance passed.");
console.log("- demo-only loopback safety, global gate, tenant gate, verified admin claims, and role authority were required");
console.log("- concurrent location creates preserved the shared configuration fence and bounded workspace projection");
console.log("- exact opening-stock replay was idempotent and request substitution failed closed with one immutable movement");
console.log("- competing revision-zero openings produced exactly one winner and never summed physical stock");
console.log("- recorded purchase cost advanced cost evidence without changing physical stock");
