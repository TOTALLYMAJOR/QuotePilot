#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { loadFirebaseAdmin } from "./firebase-admin-modular.mjs";
import {
  buildRecipeLines,
  CREATIVE_MENU_ITEMS,
  MENU_TARGET,
  POPULATION_VERSION,
  REALISTIC_INGREDIENTS,
  REALISTIC_LOCATIONS,
  RECIPE_TARGET,
  populationSummary
} from "./realistic-catering-population-data.mjs";

const require = createRequire(import.meta.url);
const { createCatalogImportBatch } = require("../functions/catalogImportBatches.js");
const {
  COLLECTIONS,
  MENU_COST_PROJECTION_LIMIT,
  WORKSPACE_LIMIT,
  createInventoryAuthorityRuntime
} = require("../functions/inventoryAuthority.js");

const execFileAsync = promisify(execFile);
const ORGANIZATION_ID = "mm05366-sandbox";
const ALLOWED_PROJECTS = new Set(["quotepilot-staging-20260804", "tonicatering"]);
const FIXTURE_EVIDENCE_AT_ISO = "2026-09-10T09:00:00.000Z";
const IMPORT_BATCH_ID = "ragnakok-realistic-v1-menu-0001";
const BASELINE_SCRIPT = fileURLToPath(new URL("./seed-firestore-menu.mjs", import.meta.url));
const RECIPE_COST_SEED_SOURCES = new Set(["seed-script", "starter-catalog-pack"]);
const RECIPE_COST_SEED_MODEL = "ragnakok-recipe-cost-seed-v1";

class PopulationError extends Error {
  constructor(message) {
    super(message);
    this.name = "PopulationError";
  }
}

class RuntimeHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "HttpsError";
  }
}

function takeValue(argv, index, flag) {
  const value = String(argv[index + 1] || "").trim();
  if (!value || value.startsWith("--")) throw new PopulationError(`${flag} requires a value.`);
  return value;
}

export function parsePopulationArgs(argv = process.argv.slice(2)) {
  const values = new Map();
  const modes = new Set();
  const knownValues = new Set(["--project", "--organization", "--confirm"]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || "").trim();
    if (token === "--apply" || token === "--dry-run") {
      if (modes.has(token)) throw new PopulationError(`Duplicate argument: ${token}`);
      modes.add(token);
      continue;
    }
    if (!knownValues.has(token)) throw new PopulationError(`Unknown argument: ${token || "(empty)"}`);
    if (values.has(token)) throw new PopulationError(`Duplicate argument: ${token}`);
    values.set(token, takeValue(argv, index, token));
    index += 1;
  }
  if (modes.has("--apply") && modes.has("--dry-run")) {
    throw new PopulationError("Choose exactly one mode: --dry-run or --apply.");
  }
  const projectId = String(values.get("--project") || "").trim();
  const organizationId = String(values.get("--organization") || "").trim();
  const apply = modes.has("--apply");
  if (!ALLOWED_PROJECTS.has(projectId)) {
    throw new PopulationError(`Project must be one of: ${[...ALLOWED_PROJECTS].join(", ")}.`);
  }
  if (organizationId !== ORGANIZATION_ID) {
    throw new PopulationError(`Population is restricted to organization ${ORGANIZATION_ID}.`);
  }
  const expectedConfirmation = `POPULATE ${projectId} ${organizationId} ${POPULATION_VERSION}`;
  const confirmation = String(values.get("--confirm") || "").trim();
  if (!apply && confirmation) throw new PopulationError("--confirm is valid only with --apply.");
  if (apply && confirmation !== expectedConfirmation) {
    throw new PopulationError(`Apply requires --confirm "${expectedConfirmation}". The default mode is read-only.`);
  }
  return Object.freeze({ projectId, organizationId, apply, expectedConfirmation });
}

function normalizedName(value) {
  return String(value || "").trim().toLocaleLowerCase("en-US").replace(/\s+/gu, " ");
}

function activeOrganization(value = {}) {
  const status = String(value.status || "").trim().toLowerCase();
  return value.active !== false && value.archived !== true && (!status || status === "active");
}

function requestId(kind, identity) {
  const digest = createHash("sha256")
    .update(`${POPULATION_VERSION}\u0000${kind}\u0000${identity}`)
    .digest("hex")
    .slice(0, 40);
  return `rkp-${kind}-${digest}`;
}

function assertFixtureBounds() {
  const uniqueIngredientNames = new Set(REALISTIC_INGREDIENTS.map(({ name }) => normalizedName(name)));
  const uniqueMenuNames = new Set(CREATIVE_MENU_ITEMS.map(({ name }) => normalizedName(name)));
  if (uniqueIngredientNames.size !== REALISTIC_INGREDIENTS.length) {
    throw new PopulationError("The realistic ingredient fixture contains duplicate names.");
  }
  if (uniqueMenuNames.size !== CREATIVE_MENU_ITEMS.length) {
    throw new PopulationError("The creative menu fixture contains duplicate names.");
  }
  if (REALISTIC_INGREDIENTS.length > WORKSPACE_LIMIT) {
    throw new PopulationError(`The ingredient fixture exceeds the workspace limit of ${WORKSPACE_LIMIT}.`);
  }
  if (RECIPE_TARGET > MENU_COST_PROJECTION_LIMIT) {
    throw new PopulationError(`The recipe target exceeds the projection limit of ${MENU_COST_PROJECTION_LIMIT}.`);
  }
}

async function runBaselineSeed({ projectId, organizationId, apply }) {
  const args = [BASELINE_SCRIPT, "--project", projectId, "--organization", organizationId];
  if (apply) args.push("--apply", "--confirm", `SEED ${projectId} ${organizationId}`);
  const { stdout, stderr } = await execFileAsync(process.execPath, args, {
    cwd: path.dirname(BASELINE_SCRIPT),
    env: process.env,
    maxBuffer: 2_000_000
  });
  if (stderr.trim()) process.stderr.write(stderr);
  process.stdout.write(stdout);
  const menuLine = stdout.split("\n").find((line) => line.startsWith("menuItems ->")) || "";
  const match = menuLine.match(/total:(\d+) existing:(\d+).*wouldCreate:(\d+)/u);
  return Object.freeze({
    plannedMenuCreates: apply ? 0 : Number(match?.[3] || 0),
    baselineMenuTotal: Number(match?.[1] || 0)
  });
}

async function resolveActor({ db, auth, organizationId }) {
  const organizationRef = db.collection("organizations").doc(organizationId);
  const [organizationSnapshot, roleSnapshot] = await Promise.all([
    organizationRef.get(),
    db.collection("userRoles").where("organizationId", "==", organizationId).limit(25).get()
  ]);
  if (!organizationSnapshot.exists || !activeOrganization(organizationSnapshot.data() || {})) {
    throw new PopulationError(`Organization ${organizationId} is missing, inactive, or archived.`);
  }
  const organization = organizationSnapshot.data() || {};
  const ownerUid = String(organization.ownerUid || "").trim();
  const adminRoles = roleSnapshot.docs
    .map((snapshot) => ({ id: snapshot.id, ...(snapshot.data() || {}) }))
    .filter((role) => String(role.role || "").trim().toLowerCase() === "admin");
  const ownerRole = adminRoles.find((role) => role.id === ownerUid);
  const actorRole = ownerRole || (adminRoles.length === 1 ? adminRoles[0] : null);
  if (!actorRole) {
    throw new PopulationError("Population requires the canonical organization owner or one unambiguous organization admin.");
  }
  const email = String(actorRole.email || "").trim().toLowerCase();
  if (!email) throw new PopulationError("The canonical inventory actor has no role-bound email.");
  const authUser = await auth.getUser(actorRole.id);
  if (authUser.emailVerified !== true || String(authUser.email || "").trim().toLowerCase() !== email) {
    throw new PopulationError("The canonical inventory actor is not an exact verified Auth and role match.");
  }
  return Object.freeze({
    uid: actorRole.id,
    email,
    role: "admin",
    organizationId,
    principalOrganizationId: organizationId,
    organizationName: String(organization.name || organization.displayName || organizationId).trim()
  });
}

async function readState({ db, organizationId }) {
  const organizationRef = db.collection("organizations").doc(organizationId);
  const refs = {
    settings: organizationRef.collection("settings").doc("config"),
    eventTypes: organizationRef.collection("eventTypes"),
    menuCategories: organizationRef.collection("menuCategories"),
    menuItems: organizationRef.collection("menuItems"),
    locations: organizationRef.collection(COLLECTIONS.locations),
    ingredients: organizationRef.collection(COLLECTIONS.ingredients),
    stockStates: organizationRef.collection(COLLECTIONS.stockStates),
    costStates: organizationRef.collection(COLLECTIONS.costStates),
    recipeHeads: organizationRef.collection(COLLECTIONS.recipeHeads),
    menuCostProjections: organizationRef.collection(COLLECTIONS.menuCostProjections)
  };
  const [settings, eventTypes, menuCategories, menuItems, locations, ingredients, stockStates, costStates, recipeHeads, menuCostProjections] = await Promise.all([
    refs.settings.get(), refs.eventTypes.get(), refs.menuCategories.get(), refs.menuItems.get(), refs.locations.get(),
    refs.ingredients.get(), refs.stockStates.get(), refs.costStates.get(), refs.recipeHeads.get(), refs.menuCostProjections.get()
  ]);
  return {
    refs,
    settings: settings.exists ? settings.data() || {} : null,
    eventTypes,
    menuCategories,
    menuItems,
    locations,
    ingredients,
    stockStates,
    costStates,
    recipeHeads,
    menuCostProjections
  };
}

function projectedMenuCount(state, plannedBaselineCreates) {
  const names = new Set(state.menuItems.docs.map((snapshot) => normalizedName(snapshot.data()?.name)));
  const creativeCreates = CREATIVE_MENU_ITEMS.filter(({ name }) => !names.has(normalizedName(name))).length;
  return Object.freeze({
    current: state.menuItems.size,
    baselineCreates: plannedBaselineCreates,
    creativeCreates,
    projected: state.menuItems.size + plannedBaselineCreates + creativeCreates
  });
}

function assertDryRunReadiness({ state, menuProjection, apply }) {
  if (!state.settings) throw new PopulationError("Organization catalog settings are missing.");
  if (menuProjection.projected < MENU_TARGET) {
    throw new PopulationError(`Projected menu count ${menuProjection.projected} is below the required ${MENU_TARGET}.`);
  }
  const projectedIngredientCount = state.ingredients.size
    + REALISTIC_INGREDIENTS.filter(({ name }) => !new Set(state.ingredients.docs.map((snapshot) => normalizedName(snapshot.data()?.name))).has(normalizedName(name))).length;
  if (projectedIngredientCount > WORKSPACE_LIMIT) {
    throw new PopulationError(`Projected ingredient count ${projectedIngredientCount} exceeds the workspace limit ${WORKSPACE_LIMIT}.`);
  }
  if (apply && (state.eventTypes.empty || state.menuCategories.empty)) {
    throw new PopulationError("Baseline menu references are missing after catalog bootstrap.");
  }
  return projectedIngredientCount;
}

async function ensureTenantGate({ db, projectId, organizationId, state, apply }) {
  if (state.settings?.inventoryAuthorityEnabled === true) return false;
  if (projectId !== "quotepilot-staging-20260804") {
    throw new PopulationError("Production inventory authority is disabled. Use the dedicated main-branch tenant activation workflow before population.");
  }
  if (!apply) return true;
  await state.refs.settings.set({
    inventoryAuthorityEnabled: true,
    inventoryPopulationVersion: POPULATION_VERSION,
    inventoryPopulationEnabledAtISO: new Date().toISOString()
  }, { merge: true });
  const verified = await db.collection("organizations").doc(organizationId).collection("settings").doc("config").get();
  if (verified.data()?.inventoryAuthorityEnabled !== true) {
    throw new PopulationError("Staging inventory tenant gate did not verify after enablement.");
  }
  return true;
}

function runtimeFor({ db, FieldValue, actor, organizationId }) {
  return createInventoryAuthorityRuntime({
    db,
    FieldValue,
    HttpsError: RuntimeHttpsError,
    assertStaff: async () => actor,
    normalizeOrganizationId: (value) => String(value || "").trim(),
    isOrganizationRecordActive: activeOrganization,
    globalEnabled: (candidateOrganizationId) => candidateOrganizationId === organizationId,
    logger: console,
    now: () => new Date().toISOString()
  });
}

async function applyCommand(runtime, organizationId, kind, identity, command) {
  return runtime.applyInventoryCommand({
    schemaVersion: 2,
    organizationId,
    requestId: requestId(kind, identity),
    command
  }, {});
}

async function ensureLocations({ runtime, organizationId, state }) {
  const byId = new Map(state.locations.docs.map((snapshot) => [snapshot.id, snapshot.data() || {}]));
  for (const location of REALISTIC_LOCATIONS) {
    const current = byId.get(location.locationId);
    if (current) {
      if (current.name !== location.name || current.active !== true) {
        throw new PopulationError(`Location ${location.locationId} already exists with different authority data.`);
      }
      continue;
    }
    await applyCommand(runtime, organizationId, "location", location.locationId, {
      kind: "upsert_location",
      locationId: location.locationId,
      name: location.name,
      active: true,
      expectedRevision: 0
    });
  }
}

async function ensureIngredients({ runtime, organizationId, state }) {
  const byId = new Map(state.ingredients.docs.map((snapshot) => [snapshot.id, snapshot.data() || {}]));
  const byName = new Map(state.ingredients.docs.map((snapshot) => [normalizedName(snapshot.data()?.name), { id: snapshot.id, ...(snapshot.data() || {}) }]));
  const ingredientIdByKey = {};
  for (const ingredient of REALISTIC_INGREDIENTS) {
    const nameMatch = byName.get(normalizedName(ingredient.name));
    const idMatch = byId.get(ingredient.ingredientId);
    const current = nameMatch || (idMatch ? { id: ingredient.ingredientId, ...idMatch } : null);
    if (current) {
      if (current.name !== ingredient.name || current.baseUnitId !== ingredient.baseUnitId || current.active !== true) {
        throw new PopulationError(`Ingredient ${ingredient.name} already exists with incompatible authority data.`);
      }
      ingredientIdByKey[ingredient.ingredientKey] = current.id;
      continue;
    }
    await applyCommand(runtime, organizationId, "ingredient", ingredient.ingredientId, {
      kind: "upsert_ingredient",
      ingredientId: ingredient.ingredientId,
      name: ingredient.name,
      category: ingredient.category,
      baseUnitId: ingredient.baseUnitId,
      active: true,
      expectedRevision: 0
    });
    ingredientIdByKey[ingredient.ingredientKey] = ingredient.ingredientId;
  }
  return ingredientIdByKey;
}

async function ensureEvidence({ runtime, db, organizationId, ingredientIdByKey }) {
  const state = await readState({ db, organizationId });
  const costIngredientIds = new Set(state.costStates.docs.map((snapshot) => String(snapshot.data()?.ingredientId || "")));
  const stockKeys = new Set(state.stockStates.docs.map((snapshot) => {
    const value = snapshot.data() || {};
    return `${value.ingredientId}\u0000${value.locationId}`;
  }));
  for (const ingredient of REALISTIC_INGREDIENTS) {
    const ingredientId = ingredientIdByKey[ingredient.ingredientKey];
    if (!costIngredientIds.has(ingredientId)) {
      await applyCommand(runtime, organizationId, "cost", ingredientId, {
        kind: "record_ingredient_cost",
        ingredientId,
        baseUnitId: ingredient.baseUnitId,
        availability: "available",
        sourceLabel: `Projected ${POPULATION_VERSION} · ${ingredient.supplier}`,
        observedAtISO: FIXTURE_EVIDENCE_AT_ISO,
        note: "Synthetic founder-pilot planning basis; replace with observed purchase evidence before live use.",
        expectedCostRevision: 0,
        basisQuantity: ingredient.costBasisQuantity,
        totalCostMinor: ingredient.costTotalMinor,
        currency: ingredient.currency
      });
    }
    const stockKey = `${ingredientId}\u0000${ingredient.stockLocationId}`;
    if (!stockKeys.has(stockKey)) {
      await applyCommand(runtime, organizationId, "opening", `${ingredientId}:${ingredient.stockLocationId}`, {
        kind: "opening_balance",
        ingredientId,
        locationId: ingredient.stockLocationId,
        quantity: ingredient.openingQuantity,
        baseUnitId: ingredient.baseUnitId,
        occurredAtISO: FIXTURE_EVIDENCE_AT_ISO,
        note: "Synthetic founder-pilot opening projection; replace with a counted balance before live use.",
        expectedStockRevision: 0
      });
    }
  }
}

async function importCreativeMenu({ db, FieldValue, organizationId, actor, state }) {
  const expectedCatalogRevision = Math.max(0, Number(state.settings?.catalogRevision || 0));
  return createCatalogImportBatch({
    db,
    organizationId,
    organizationName: actor.organizationName,
    importType: "menuItems",
    fileName: `${POPULATION_VERSION}-creative-menu.json`,
    records: CREATIVE_MENU_ITEMS.map((record, index) => ({ rowNumber: index + 2, record })),
    importBatchId: IMPORT_BATCH_ID,
    expectedCatalogRevision,
    actorUid: actor.uid,
    actorEmail: actor.email,
    serverTimestamp: FieldValue.serverTimestamp,
    nowISO: new Date().toISOString()
  });
}

function selectRecipeCandidates(menuItems) {
  const creativeNames = new Set(CREATIVE_MENU_ITEMS.map(({ name }) => normalizedName(name)));
  const candidates = menuItems.docs
    .map((snapshot) => ({ id: snapshot.id, ...(snapshot.data() || {}) }))
    .filter((menuItem) => menuItem.active !== false)
    .sort((left, right) => {
      const leftCreative = creativeNames.has(normalizedName(left.name)) ? 0 : 1;
      const rightCreative = creativeNames.has(normalizedName(right.name)) ? 0 : 1;
      if (leftCreative !== rightCreative) return leftCreative - rightCreative;
      const leftAlfredo = normalizedName(left.name).includes("chicken alfredo") ? 0 : 1;
      const rightAlfredo = normalizedName(right.name).includes("chicken alfredo") ? 0 : 1;
      if (leftAlfredo !== rightAlfredo) return leftAlfredo - rightAlfredo;
      return String(left.name || "").localeCompare(String(right.name || "")) || left.id.localeCompare(right.id);
    });
  if (candidates.length < RECIPE_TARGET) {
    throw new PopulationError(`Only ${candidates.length} active menu items are available for ${RECIPE_TARGET} recipes.`);
  }
  return candidates.slice(0, RECIPE_TARGET);
}

export function planRecipeBackedMenuCostSeed({ menuItems = [], projections = [], organizationId = ORGANIZATION_ID } = {}) {
  const projectionByMenuItemId = new Map(
    projections.map((projection) => [String(projection?.menuItemId || projection?.id || "").trim(), projection])
  );
  const updates = [];
  const excluded = {
    alreadyCosted: 0,
    ineligibleSource: 0,
    inactive: 0,
    projectionUnavailable: 0
  };

  for (const menuItem of menuItems) {
    const menuItemId = String(menuItem?.id || "").trim();
    if (!menuItemId || menuItem?.active === false) {
      excluded.inactive += 1;
      continue;
    }
    if (typeof menuItem?.costMinor === "number" && Number.isSafeInteger(menuItem.costMinor) && menuItem.costMinor >= 0) {
      excluded.alreadyCosted += 1;
      continue;
    }
    if (!RECIPE_COST_SEED_SOURCES.has(String(menuItem?.source || "").trim())) {
      excluded.ineligibleSource += 1;
      continue;
    }
    const projection = projectionByMenuItemId.get(menuItemId);
    const projectedCostMinor = projection?.cost?.projectedCostMinor;
    const projectionEligible = projection?.organizationId === organizationId
      && projection?.menuItemId === menuItemId
      && projection?.status === "complete"
      && projection?.freshness === "current"
      && projection?.cost?.status === "complete"
      && projection?.cost?.currency === "USD"
      && Number.isSafeInteger(projectedCostMinor)
      && projectedCostMinor >= 0
      && String(projection?.cost?.resultDigest || "").trim();
    if (!projectionEligible) {
      excluded.projectionUnavailable += 1;
      continue;
    }
    updates.push(Object.freeze({
      menuItemId,
      costMinor: projectedCostMinor,
      projectionResultDigest: projection.cost.resultDigest,
      recipeRevisionId: String(projection.recipeRevisionId || projection.cost.recipeRevisionId || "").trim(),
      sourceDigest: String(projection.sourceDigest || "").trim()
    }));
  }

  return Object.freeze({
    model: RECIPE_COST_SEED_MODEL,
    eligibleCount: updates.length,
    updates: Object.freeze(updates),
    excluded: Object.freeze(excluded)
  });
}

function menuCostSeedPlanFromState(state, organizationId) {
  return planRecipeBackedMenuCostSeed({
    organizationId,
    menuItems: state.menuItems.docs.map((snapshot) => ({ id: snapshot.id, ...(snapshot.data() || {}) })),
    projections: state.menuCostProjections.docs.map((snapshot) => ({ id: snapshot.id, ...(snapshot.data() || {}) }))
  });
}

async function seedRecipeBackedMenuCosts({ db, organizationId, actor, state, apply }) {
  const initialPlan = menuCostSeedPlanFromState(state, organizationId);
  const expectedCatalogRevision = Math.max(0, Number(state.settings?.catalogRevision || 0));
  if (!apply || initialPlan.eligibleCount === 0) {
    return Object.freeze({
      model: initialPlan.model,
      plannedCount: initialPlan.eligibleCount,
      appliedCount: 0,
      catalogRevision: expectedCatalogRevision,
      excluded: initialPlan.excluded
    });
  }

  const organizationRef = db.collection("organizations").doc(organizationId);
  const settingsRef = organizationRef.collection("settings").doc("config");
  const nowISO = new Date().toISOString();
  let appliedCatalogRevision = expectedCatalogRevision;
  await db.runTransaction(async (tx) => {
    const menuRefs = initialPlan.updates.map((entry) => organizationRef.collection("menuItems").doc(entry.menuItemId));
    const projectionRefs = initialPlan.updates.map((entry) => organizationRef.collection(COLLECTIONS.menuCostProjections).doc(entry.menuItemId));
    const snapshots = await tx.getAll(settingsRef, ...menuRefs, ...projectionRefs);
    const settingsSnapshot = snapshots[0];
    const currentSettings = settingsSnapshot.data() || {};
    if (Number(currentSettings.catalogRevision || 0) !== expectedCatalogRevision) {
      throw new PopulationError("Catalog revision changed after the margin-cost dry run. Refresh and retry.");
    }
    const menuSnapshots = snapshots.slice(1, 1 + menuRefs.length);
    const projectionSnapshots = snapshots.slice(1 + menuRefs.length);
    const transactionPlan = planRecipeBackedMenuCostSeed({
      organizationId,
      menuItems: menuSnapshots.map((snapshot) => ({ id: snapshot.id, ...(snapshot.data() || {}) })),
      projections: projectionSnapshots.map((snapshot) => ({ id: snapshot.id, ...(snapshot.data() || {}) }))
    });
    if (transactionPlan.eligibleCount !== initialPlan.eligibleCount) {
      throw new PopulationError("Recipe-backed margin-cost evidence changed after planning. Refresh and retry.");
    }
    transactionPlan.updates.forEach((entry, index) => {
      const planned = initialPlan.updates[index];
      if (
        entry.menuItemId !== planned.menuItemId
        || entry.costMinor !== planned.costMinor
        || entry.projectionResultDigest !== planned.projectionResultDigest
      ) {
        throw new PopulationError("Recipe-backed margin-cost evidence changed after planning. Refresh and retry.");
      }
    });

    appliedCatalogRevision = expectedCatalogRevision + 1;
    transactionPlan.updates.forEach((entry, index) => {
      tx.update(menuRefs[index], {
        costMinor: entry.costMinor,
        fixtureCostEvidence: {
          model: RECIPE_COST_SEED_MODEL,
          classification: "synthetic_founder_pilot_projection",
          populationVersion: POPULATION_VERSION,
          projectionResultDigest: entry.projectionResultDigest,
          recipeRevisionId: entry.recipeRevisionId,
          sourceDigest: entry.sourceDigest,
          note: "Synthetic recipe-cost projection; replace with reviewed operating cost evidence before live use."
        },
        updatedAtISO: nowISO
      });
    });
    tx.set(settingsRef, {
      catalogRevision: appliedCatalogRevision,
      pricingSetupConfirmed: true,
      pricingConfirmation: {
        actorUid: actor.uid,
        actorEmail: actor.email,
        confirmedAtISO: nowISO,
        confirmedCatalogRevision: appliedCatalogRevision
      },
      pricingConfirmationReason: `Operator-authorized ${POPULATION_VERSION} recipe-cost fixture publication`,
      marginCostPopulationModel: RECIPE_COST_SEED_MODEL,
      marginCostPopulationUpdatedAtISO: nowISO,
      updatedAtISO: nowISO
    }, { merge: true });
  });

  const verifiedState = await readState({ db, organizationId });
  const remainingPlan = menuCostSeedPlanFromState(verifiedState, organizationId);
  if (remainingPlan.eligibleCount !== 0 || Number(verifiedState.settings?.catalogRevision || 0) !== appliedCatalogRevision) {
    throw new PopulationError("Recipe-backed margin-cost seed did not pass provider readback.");
  }
  return Object.freeze({
    model: initialPlan.model,
    plannedCount: initialPlan.eligibleCount,
    appliedCount: initialPlan.eligibleCount,
    catalogRevision: appliedCatalogRevision,
    excluded: remainingPlan.excluded
  });
}

async function ensureRecipes({ runtime, db, organizationId, ingredientIdByKey }) {
  const state = await readState({ db, organizationId });
  const catalogRevision = Math.max(0, Number(state.settings?.catalogRevision || 0));
  const existingHeads = new Map(state.recipeHeads.docs.map((snapshot) => [snapshot.id, snapshot.data() || {}]));
  for (const menuItem of selectRecipeCandidates(state.menuItems)) {
    if (existingHeads.has(menuItem.id)) continue;
    await applyCommand(runtime, organizationId, "recipe", `${catalogRevision}:${menuItem.id}`, {
      kind: "publish_menu_recipe",
      menuItemId: menuItem.id,
      expectedCatalogRevision: catalogRevision,
      expectedRecipeRevision: 0,
      outputYield: "1",
      outputUnitId: "each",
      lines: buildRecipeLines(menuItem, ingredientIdByKey)
    });
  }
}

function countsFromState(state) {
  return Object.freeze({
    menuItems: state.menuItems.size,
    locations: state.locations.size,
    ingredients: state.ingredients.size,
    stockStates: state.stockStates.size,
    costStates: state.costStates.size,
    recipeHeads: state.recipeHeads.size,
    menuCostProjections: state.menuCostProjections.size,
    catalogRevision: Math.max(0, Number(state.settings?.catalogRevision || 0)),
    pricingSetupConfirmed: state.settings?.pricingSetupConfirmed === true
  });
}

async function main() {
  assertFixtureBounds();
  const options = parsePopulationArgs();
  const baseline = await runBaselineSeed(options);
  const admin = loadFirebaseAdmin();
  if (!admin.getApps().length) admin.initializeApp({ projectId: options.projectId });
  const db = admin.getFirestore();
  const auth = admin.getAuth();
  const actor = await resolveActor({ db, auth, organizationId: options.organizationId });
  let state = await readState({ db, organizationId: options.organizationId });
  const menuProjection = projectedMenuCount(state, baseline.plannedMenuCreates);
  const projectedIngredientCount = assertDryRunReadiness({ state, menuProjection, apply: options.apply });
  const tenantGateChangePlanned = await ensureTenantGate({
    db,
    projectId: options.projectId,
    organizationId: options.organizationId,
    state,
    apply: options.apply
  });
  if (options.apply && tenantGateChangePlanned) {
    state = await readState({ db, organizationId: options.organizationId });
  }
  const plan = {
    mode: options.apply ? "apply" : "dry-run",
    projectId: options.projectId,
    organizationId: options.organizationId,
    fixture: populationSummary(),
    current: countsFromState(state),
    projected: {
      menuItems: menuProjection.projected,
      ingredients: projectedIngredientCount,
      recipes: Math.max(state.recipeHeads.size, RECIPE_TARGET)
    },
    tenantGateChangePlanned,
    marginCostSeed: await seedRecipeBackedMenuCosts({
      db,
      organizationId: options.organizationId,
      actor,
      state,
      apply: false
    }),
    evidenceClassification: "synthetic founder-pilot projection; not counted stock or supplier-confirmed cost",
    commercialConsequence: "menu import advances catalog revision and requires pricing review before authoritative quote saves"
  };
  console.log(JSON.stringify(plan, null, 2));
  if (!options.apply) {
    console.log(`Dry run complete. Apply with --apply --confirm "${options.expectedConfirmation}".`);
    return;
  }

  const runtime = runtimeFor({
    db,
    FieldValue: admin.FieldValue,
    actor,
    organizationId: options.organizationId
  });
  await ensureLocations({ runtime, organizationId: options.organizationId, state });
  state = await readState({ db, organizationId: options.organizationId });
  const ingredientIdByKey = await ensureIngredients({ runtime, organizationId: options.organizationId, state });
  await ensureEvidence({ runtime, db, organizationId: options.organizationId, ingredientIdByKey });
  state = await readState({ db, organizationId: options.organizationId });
  const importResult = await importCreativeMenu({
    db,
    FieldValue: admin.FieldValue,
    organizationId: options.organizationId,
    actor,
    state
  });
  await ensureRecipes({ runtime, db, organizationId: options.organizationId, ingredientIdByKey });
  state = await readState({ db, organizationId: options.organizationId });
  const marginCostSeed = await seedRecipeBackedMenuCosts({
    db,
    organizationId: options.organizationId,
    actor,
    state,
    apply: true
  });
  const verified = await readState({ db, organizationId: options.organizationId });
  const counts = countsFromState(verified);
  if (counts.menuItems < MENU_TARGET || counts.recipeHeads < RECIPE_TARGET) {
    throw new PopulationError("Population write completed without satisfying the requested menu and recipe floor.");
  }
  if (counts.ingredients > WORKSPACE_LIMIT || counts.menuCostProjections > MENU_COST_PROJECTION_LIMIT) {
    throw new PopulationError("Population write exceeded a bounded Inventory workspace limit.");
  }
  console.log(JSON.stringify({
    status: "verified",
    projectId: options.projectId,
    organizationId: options.organizationId,
    populationVersion: POPULATION_VERSION,
    catalogImport: {
      importBatchId: importResult.importBatchId,
      createdCount: importResult.createdCount,
      skippedCount: importResult.skippedCount,
      idempotentReplay: importResult.idempotentReplay === true
    },
    marginCostSeed,
    counts,
    pricingReviewRequired: counts.pricingSetupConfirmed !== true
  }, null, 2));
}

const isDirectExecution = Boolean(
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
);

if (isDirectExecution) {
  main().catch((error) => {
    console.error(`${error?.name || "Error"}: ${error?.message || error}`);
    process.exitCode = 1;
  });
}
