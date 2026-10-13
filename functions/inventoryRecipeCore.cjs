"use strict";

const ingredientCore = require("./inventoryIngredientCore.cjs");

const RECIPE_SCHEMA_VERSION = 2;
const RECIPE_REVISION_VERSION = "ingredient-recipe-revision-v2";
const PACK_CONVERSION_VERSION = "ingredient-pack-conversion-v2";
const RECIPE_COST_VERSION = "ingredient-recipe-cost-v2";
const MAX_RECIPE_LINES = 200;
const MAX_PACK_CONVERSIONS = 200;
const ID_PATTERN = /^[^\s/?#\\\u0000]{1,180}$/u;
const CURRENCY_PATTERN = /^[A-Z]{3}$/u;

// Ratios are exact relative to the dimension's reference unit (each, gram, or
// millilitre). These constants are definitions, not inferred density or yield.
const STANDARD_UNIT_RATIOS = Object.freeze({
  each: Object.freeze({ dimension: "count", numerator: 1n, denominator: 1n }),
  dozen: Object.freeze({ dimension: "count", numerator: 12n, denominator: 1n }),
  g: Object.freeze({ dimension: "mass", numerator: 1n, denominator: 1n }),
  kg: Object.freeze({ dimension: "mass", numerator: 1000n, denominator: 1n }),
  oz: Object.freeze({ dimension: "mass", numerator: 45_359_237n, denominator: 1_600_000n }),
  lb: Object.freeze({ dimension: "mass", numerator: 45_359_237n, denominator: 100_000n }),
  ml: Object.freeze({ dimension: "volume", numerator: 1n, denominator: 1n }),
  l: Object.freeze({ dimension: "volume", numerator: 1000n, denominator: 1n }),
  fl_oz: Object.freeze({ dimension: "volume", numerator: 473_176_473n, denominator: 16_000_000n }),
  pt: Object.freeze({ dimension: "volume", numerator: 473_176_473n, denominator: 1_000_000n }),
  qt: Object.freeze({ dimension: "volume", numerator: 473_176_473n, denominator: 500_000n }),
  gal: Object.freeze({ dimension: "volume", numerator: 473_176_473n, denominator: 125_000n })
});

class InventoryRecipeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "InventoryRecipeError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new InventoryRecipeError(code, message, details);
}

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exact(value, keys, label, code = "invalid-argument") {
  if (!isRecord(value)
    || Object.keys(value).length !== keys.length
    || keys.some((key) => !Object.hasOwn(value, key))) {
    fail(code, `${label} contains missing or unsupported fields.`);
  }
}

function opaqueId(value, label) {
  if (typeof value !== "string" || value !== value.trim() || !ID_PATTERN.test(value)
    || value === "." || value === ".." || /^[^@\s]+@[^@\s]+$/u.test(value)) {
    fail("invalid-argument", `${label} must be a stable opaque identifier.`);
  }
  return value;
}

function cleanText(value, label, maximum, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || value !== value.trim()) {
    fail("invalid-argument", `${label} must be exact text.`);
  }
  const normalized = value.replace(/\s+/gu, " ");
  if ((!allowEmpty && !normalized) || normalized.length > maximum) {
    fail("invalid-argument", `${label} must be bounded${allowEmpty ? "" : " non-empty"} text.`);
  }
  return normalized;
}

function positiveRevision(value, label = "revision") {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000_000) {
    fail("invalid-argument", `${label} must be a bounded positive whole number.`);
  }
  return value;
}

function gcd(left, right) {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b) [a, b] = [b, a % b];
  return a || 1n;
}

function rational(numerator, denominator = 1n) {
  if (denominator === 0n) fail("invalid-argument", "A rational denominator cannot be zero.");
  let n = BigInt(numerator);
  let d = BigInt(denominator);
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const divisor = gcd(n, d);
  return Object.freeze({ numerator: n / divisor, denominator: d / divisor });
}

function addRational(left, right) {
  return rational(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator
  );
}

function multiplyRational(left, right) {
  return rational(left.numerator * right.numerator, left.denominator * right.denominator);
}

function divideRational(left, right) {
  if (right.numerator === 0n) fail("invalid-argument", "Cannot divide by zero.");
  return rational(left.numerator * right.denominator, left.denominator * right.numerator);
}

function serializeRational(value) {
  return Object.freeze({
    numerator: value.numerator.toString(),
    denominator: value.denominator.toString()
  });
}

function roundRationalHalfUp(value) {
  if (value.numerator < 0n) fail("data-loss", "Recipe money cannot be negative.");
  const rounded = (value.numerator * 2n + value.denominator) / (value.denominator * 2n);
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) fail("out-of-range", "Rounded recipe money exceeds the safe integer range.");
  return Number(rounded);
}

function quantityRational(value, label) {
  return rational(BigInt(ingredientCore.parseQuantityMicros(value, label)), 1n);
}

function yieldRational(value, label) {
  if (value === null) return null;
  const micros = ingredientCore.parseQuantityMicros(value, label);
  if (micros > ingredientCore.QUANTITY_SCALE) {
    fail("invalid-argument", `${label} cannot exceed 1.`);
  }
  return rational(BigInt(micros), BigInt(ingredientCore.QUANTITY_SCALE));
}

function recipeRevisionIdFor(organizationId, menuItemId, revision) {
  const identity = {
    organizationId: opaqueId(organizationId, "organizationId"),
    menuItemId: opaqueId(menuItemId, "menuItemId"),
    revision: positiveRevision(revision, "recipe revision")
  };
  return `irr_${ingredientCore.digest(identity, "ingredient recipe identity").slice(0, 48)}`;
}

function packConversionRevisionIdFor(organizationId, ingredientId, packUnitId, revision) {
  const identity = {
    organizationId: opaqueId(organizationId, "organizationId"),
    ingredientId: opaqueId(ingredientId, "ingredientId"),
    packUnitId: opaqueId(packUnitId, "packUnitId"),
    revision: positiveRevision(revision, "pack conversion revision")
  };
  return `ipc_${ingredientCore.digest(identity, "ingredient pack conversion identity").slice(0, 48)}`;
}

function createPackConversionRevision({
  organizationId,
  ingredientId,
  packUnitId,
  packLabel,
  revision,
  baseUnitId,
  baseQuantity,
  sourceLabel,
  publishedAtISO
}) {
  const orgId = opaqueId(organizationId, "organizationId");
  const itemId = opaqueId(ingredientId, "ingredientId");
  const unitId = opaqueId(packUnitId, "packUnitId");
  const packRevision = positiveRevision(revision, "pack conversion revision");
  const normalizedBaseUnitId = ingredientCore.baseUnitId(baseUnitId);
  const normalizedQuantity = ingredientCore.formatQuantityMicros(
    ingredientCore.parseQuantityMicros(baseQuantity, "baseQuantity")
  );
  const body = {
    authorityVersion: ingredientCore.INVENTORY_AUTHORITY_VERSION,
    schemaVersion: RECIPE_SCHEMA_VERSION,
    conversionVersion: PACK_CONVERSION_VERSION,
    organizationId: orgId,
    ingredientId: itemId,
    packConversionRevisionId: packConversionRevisionIdFor(orgId, itemId, unitId, packRevision),
    packUnitId: unitId,
    packLabel: cleanText(packLabel, "packLabel", 80),
    revision: packRevision,
    baseUnitId: normalizedBaseUnitId,
    baseQuantity: normalizedQuantity,
    baseQuantityMicros: ingredientCore.parseQuantityMicros(normalizedQuantity),
    sourceLabel: cleanText(sourceLabel, "sourceLabel", 120),
    publishedAtISO: ingredientCore.exactISO(publishedAtISO, "publishedAtISO")
  };
  return Object.freeze({ ...body, conversionDigest: ingredientCore.digest(body, "ingredient pack conversion") });
}

function verifyPackConversionRevision(value) {
  exact(value, [
    "authorityVersion", "schemaVersion", "conversionVersion", "organizationId", "ingredientId",
    "packConversionRevisionId", "packUnitId", "packLabel", "revision", "baseUnitId",
    "baseQuantity", "baseQuantityMicros", "sourceLabel", "publishedAtISO", "conversionDigest"
  ], "ingredient pack conversion", "data-loss");
  const { conversionDigest, ...body } = value;
  if (value.authorityVersion !== ingredientCore.INVENTORY_AUTHORITY_VERSION
    || value.schemaVersion !== RECIPE_SCHEMA_VERSION
    || value.conversionVersion !== PACK_CONVERSION_VERSION
    || conversionDigest !== ingredientCore.digest(body, "ingredient pack conversion")) {
    fail("data-loss", "Ingredient pack conversion schema or digest is inconsistent.");
  }
  const expected = createPackConversionRevision({
    organizationId: value.organizationId,
    ingredientId: value.ingredientId,
    packUnitId: value.packUnitId,
    packLabel: value.packLabel,
    revision: value.revision,
    baseUnitId: value.baseUnitId,
    baseQuantity: value.baseQuantity,
    sourceLabel: value.sourceLabel,
    publishedAtISO: value.publishedAtISO
  });
  if (ingredientCore.canonicalSerialize(expected, "pack conversion")
    !== ingredientCore.canonicalSerialize(value, "pack conversion")) {
    fail("data-loss", "Ingredient pack conversion is internally inconsistent.");
  }
  return value;
}

function normalizeRecipeLine(value) {
  if (!isRecord(value) || !["standard", "ingredient_pack"].includes(value.unitKind)) {
    fail("invalid-argument", "Recipe line unitKind is unsupported.");
  }
  const common = ["lineId", "ingredientId", "quantity", "unitKind", "quantityBasis", "usableYield"];
  exact(value, value.unitKind === "standard"
    ? [...common, "unitId"]
    : [...common, "packConversionRevisionId"], "recipe line");
  if (!["as_purchased", "usable"].includes(value.quantityBasis)) {
    fail("invalid-argument", "Recipe line quantityBasis is unsupported.");
  }
  if ((value.quantityBasis === "as_purchased" && value.usableYield !== null)
    || (value.quantityBasis === "usable" && value.usableYield !== null && typeof value.usableYield !== "string")) {
    fail("invalid-argument", "usableYield is allowed only as explicit evidence for usable-basis quantities.");
  }
  if (value.usableYield !== null) yieldRational(value.usableYield, "usableYield");
  const line = {
    lineId: opaqueId(value.lineId, "lineId"),
    ingredientId: opaqueId(value.ingredientId, "ingredientId"),
    quantity: ingredientCore.formatQuantityMicros(ingredientCore.parseQuantityMicros(value.quantity, "line quantity")),
    unitKind: value.unitKind,
    quantityBasis: value.quantityBasis,
    usableYield: value.usableYield === null
      ? null
      : ingredientCore.formatQuantityMicros(ingredientCore.parseQuantityMicros(value.usableYield, "usableYield"))
  };
  if (value.unitKind === "standard") line.unitId = opaqueId(value.unitId, "unitId");
  else line.packConversionRevisionId = opaqueId(value.packConversionRevisionId, "packConversionRevisionId");
  return Object.freeze(line);
}

function createRecipeRevision({
  organizationId,
  menuItemId,
  revision,
  priorRecipeRevisionId,
  outputYield,
  outputUnitId,
  lines,
  publishedAtISO
}) {
  const orgId = opaqueId(organizationId, "organizationId");
  const catalogMenuItemId = opaqueId(menuItemId, "menuItemId");
  const recipeRevision = positiveRevision(revision, "recipe revision");
  if (recipeRevision === 1) {
    if (priorRecipeRevisionId !== "") fail("invalid-argument", "The first recipe revision cannot name a prior revision.");
  } else {
    opaqueId(priorRecipeRevisionId, "priorRecipeRevisionId");
    const expectedPriorId = recipeRevisionIdFor(orgId, catalogMenuItemId, recipeRevision - 1);
    if (priorRecipeRevisionId !== expectedPriorId) {
      fail("invalid-argument", "Recipe revisions must name the exact immediately prior revision.");
    }
  }
  if (outputYield !== null && typeof outputYield !== "string") {
    fail("invalid-argument", "outputYield must be a canonical decimal string or explicit null.");
  }
  const normalizedYield = outputYield === null
    ? null
    : ingredientCore.formatQuantityMicros(ingredientCore.parseQuantityMicros(outputYield, "outputYield"));
  if (!Array.isArray(lines) || lines.length > MAX_RECIPE_LINES) {
    fail("invalid-argument", `Recipe lines must be a list of at most ${MAX_RECIPE_LINES}.`);
  }
  const normalizedLines = lines.map(normalizeRecipeLine).sort((left, right) =>
    left.ingredientId.localeCompare(right.ingredientId) || left.lineId.localeCompare(right.lineId));
  if (new Set(normalizedLines.map((line) => line.lineId)).size !== normalizedLines.length) {
    fail("invalid-argument", "Recipe line IDs must be unique within a revision.");
  }
  const definitionIssues = [];
  if (normalizedYield === null) definitionIssues.push(Object.freeze({ code: "missing_output_yield" }));
  if (!normalizedLines.length) definitionIssues.push(Object.freeze({ code: "empty_recipe" }));
  for (const line of normalizedLines) {
    if (line.quantityBasis === "usable" && line.usableYield === null) {
      definitionIssues.push(Object.freeze({ code: "missing_usable_yield", ingredientId: line.ingredientId, lineId: line.lineId }));
    }
    if (line.unitKind === "standard" && !Object.hasOwn(STANDARD_UNIT_RATIOS, line.unitId)) {
      definitionIssues.push(Object.freeze({ code: "unsupported_unit", ingredientId: line.ingredientId, lineId: line.lineId, unitId: line.unitId }));
    }
  }
  definitionIssues.sort(compareIssues);
  const body = {
    authorityVersion: ingredientCore.INVENTORY_AUTHORITY_VERSION,
    schemaVersion: RECIPE_SCHEMA_VERSION,
    recipeVersion: RECIPE_REVISION_VERSION,
    organizationId: orgId,
    menuItemId: catalogMenuItemId,
    recipeRevisionId: recipeRevisionIdFor(orgId, catalogMenuItemId, recipeRevision),
    revision: recipeRevision,
    priorRecipeRevisionId,
    outputYield: normalizedYield,
    outputUnitId: opaqueId(outputUnitId, "outputUnitId"),
    lines: Object.freeze(normalizedLines),
    validity: definitionIssues.length ? "invalid" : "valid",
    definitionIssues: Object.freeze(definitionIssues),
    publishedAtISO: ingredientCore.exactISO(publishedAtISO, "publishedAtISO")
  };
  return Object.freeze({ ...body, recipeDigest: ingredientCore.digest(body, "ingredient recipe revision") });
}

function verifyRecipeRevision(value) {
  exact(value, [
    "authorityVersion", "schemaVersion", "recipeVersion", "organizationId", "menuItemId",
    "recipeRevisionId", "revision", "priorRecipeRevisionId", "outputYield", "outputUnitId",
    "lines", "validity", "definitionIssues", "publishedAtISO", "recipeDigest"
  ], "ingredient recipe revision", "data-loss");
  const { recipeDigest, ...body } = value;
  if (value.authorityVersion !== ingredientCore.INVENTORY_AUTHORITY_VERSION
    || value.schemaVersion !== RECIPE_SCHEMA_VERSION
    || value.recipeVersion !== RECIPE_REVISION_VERSION
    || recipeDigest !== ingredientCore.digest(body, "ingredient recipe revision")) {
    fail("data-loss", "Ingredient recipe revision schema or digest is inconsistent.");
  }
  const expected = createRecipeRevision({
    organizationId: value.organizationId,
    menuItemId: value.menuItemId,
    revision: value.revision,
    priorRecipeRevisionId: value.priorRecipeRevisionId,
    outputYield: value.outputYield,
    outputUnitId: value.outputUnitId,
    lines: value.lines,
    publishedAtISO: value.publishedAtISO
  });
  if (ingredientCore.canonicalSerialize(expected, "recipe revision")
    !== ingredientCore.canonicalSerialize(value, "recipe revision")) {
    fail("data-loss", "Ingredient recipe revision is internally inconsistent.");
  }
  return value;
}

function compareIssues(left, right) {
  return String(left.code).localeCompare(String(right.code))
    || String(left.ingredientId || "").localeCompare(String(right.ingredientId || ""))
    || String(left.lineId || "").localeCompare(String(right.lineId || ""))
    || String(left.unitId || "").localeCompare(String(right.unitId || ""));
}

function indexExact(records, key, label, maximum) {
  if (!Array.isArray(records) || records.length > maximum) {
    fail("invalid-argument", `${label} must be a bounded list.`);
  }
  const result = new Map();
  for (const record of records) {
    const id = record?.[key];
    if (typeof id !== "string" || result.has(id)) fail("invalid-argument", `${label} contains a missing or duplicate identity.`);
    result.set(id, record);
  }
  return result;
}

function convertStandardQuantity(quantityMicros, fromUnitId, toUnitId) {
  const source = STANDARD_UNIT_RATIOS[fromUnitId];
  const target = STANDARD_UNIT_RATIOS[toUnitId];
  if (!source || !target) return null;
  if (source.dimension !== target.dimension) return null;
  return multiplyRational(quantityMicros, rational(
    source.numerator * target.denominator,
    source.denominator * target.numerator
  ));
}

function calculateRecipeCost({ recipeRevision, ingredients, costStates, packConversions = [] }) {
  verifyRecipeRevision(recipeRevision);
  const ingredientById = indexExact(ingredients, "ingredientId", "ingredients", MAX_RECIPE_LINES);
  const costByIngredientId = indexExact(costStates, "ingredientId", "costStates", MAX_RECIPE_LINES);
  const packById = indexExact(packConversions, "packConversionRevisionId", "packConversions", MAX_PACK_CONVERSIONS);
  const issues = [...recipeRevision.definitionIssues];
  const aggregateByIngredient = new Map();

  for (const line of recipeRevision.lines) {
    const ingredient = ingredientById.get(line.ingredientId);
    if (!ingredient) {
      issues.push({ code: "missing_ingredient", ingredientId: line.ingredientId, lineId: line.lineId });
      continue;
    }
    try {
      ingredientCore.verifyIngredient(ingredient, {
        organizationId: recipeRevision.organizationId,
        ingredientId: line.ingredientId
      });
    } catch {
      issues.push({ code: "invalid_ingredient", ingredientId: line.ingredientId, lineId: line.lineId });
      continue;
    }
    if (!ingredient.active) {
      issues.push({ code: "inactive_ingredient", ingredientId: line.ingredientId, lineId: line.lineId });
      continue;
    }

    let baseQuantity = null;
    let conversionProvenance = null;
    const lineQuantity = quantityRational(line.quantity, "line quantity");
    if (line.unitKind === "standard") {
      baseQuantity = convertStandardQuantity(lineQuantity, line.unitId, ingredient.baseUnitId);
      if (!baseQuantity) {
        issues.push({
          code: "unsupported_conversion",
          ingredientId: line.ingredientId,
          lineId: line.lineId,
          unitId: line.unitId,
          targetUnitId: ingredient.baseUnitId
        });
        continue;
      }
      conversionProvenance = {
        kind: line.unitId === ingredient.baseUnitId ? "identity" : "standard_same_dimension",
        fromUnitId: line.unitId,
        toUnitId: ingredient.baseUnitId
      };
    } else {
      const conversion = packById.get(line.packConversionRevisionId);
      if (!conversion) {
        issues.push({ code: "missing_pack_conversion", ingredientId: line.ingredientId, lineId: line.lineId });
        continue;
      }
      try {
        verifyPackConversionRevision(conversion);
      } catch {
        issues.push({ code: "invalid_pack_conversion", ingredientId: line.ingredientId, lineId: line.lineId });
        continue;
      }
      if (conversion.organizationId !== recipeRevision.organizationId
        || conversion.ingredientId !== line.ingredientId
        || conversion.baseUnitId !== ingredient.baseUnitId) {
        issues.push({ code: "incompatible_pack_conversion", ingredientId: line.ingredientId, lineId: line.lineId });
        continue;
      }
      baseQuantity = divideRational(
        multiplyRational(lineQuantity, rational(BigInt(conversion.baseQuantityMicros))),
        rational(BigInt(ingredientCore.QUANTITY_SCALE))
      );
      conversionProvenance = {
        kind: "ingredient_pack",
        packConversionRevisionId: conversion.packConversionRevisionId,
        conversionDigest: conversion.conversionDigest,
        toUnitId: ingredient.baseUnitId
      };
    }

    if (line.quantityBasis === "usable") {
      if (line.usableYield === null) continue;
      baseQuantity = divideRational(baseQuantity, yieldRational(line.usableYield, "usableYield"));
    }
    const current = aggregateByIngredient.get(line.ingredientId) || {
      ingredient,
      requiredBaseQuantityMicros: rational(0n),
      lineIds: [],
      conversionProvenance: []
    };
    current.requiredBaseQuantityMicros = addRational(current.requiredBaseQuantityMicros, baseQuantity);
    current.lineIds.push(line.lineId);
    current.conversionProvenance.push(Object.freeze(conversionProvenance));
    aggregateByIngredient.set(line.ingredientId, current);
  }

  const rows = [];
  let exactKnownCost = rational(0n);
  let costedIngredientCount = 0;
  let missingCostIngredientCount = 0;
  const currencies = new Set();
  for (const ingredientId of [...aggregateByIngredient.keys()].sort()) {
    const aggregate = aggregateByIngredient.get(ingredientId);
    const row = {
      ingredientId,
      ingredientRevision: aggregate.ingredient.revision,
      baseUnitId: aggregate.ingredient.baseUnitId,
      requiredBaseQuantityMicros: serializeRational(aggregate.requiredBaseQuantityMicros),
      lineIds: Object.freeze([...aggregate.lineIds].sort()),
      conversionProvenance: Object.freeze([...aggregate.conversionProvenance].sort((left, right) =>
        ingredientCore.canonicalSerialize(left, "conversion").localeCompare(ingredientCore.canonicalSerialize(right, "conversion"))))
    };
    const costState = costByIngredientId.get(ingredientId);
    if (!costState) {
      row.costAvailability = "missing";
      missingCostIngredientCount += 1;
      issues.push({ code: "missing_cost", ingredientId });
    } else {
      try {
        ingredientCore.verifyCostState(costState, {
          organizationId: recipeRevision.organizationId,
          ingredientId
        });
      } catch {
        row.costAvailability = "invalid";
        issues.push({ code: "invalid_cost_evidence", ingredientId });
      }
      if (!row.costAvailability && costState.baseUnitId !== aggregate.ingredient.baseUnitId) {
        row.costAvailability = "invalid";
        issues.push({ code: "cost_unit_mismatch", ingredientId });
      }
      if (!row.costAvailability && costState.availability !== "available") {
        row.costAvailability = costState.availability;
        row.costRevision = costState.revision;
        row.costEvidenceId = costState.lastCostEvidenceId;
        missingCostIngredientCount += 1;
        issues.push({ code: "cost_unavailable", ingredientId, availability: costState.availability });
      }
      if (!row.costAvailability) {
        const exactCost = multiplyRational(
          aggregate.requiredBaseQuantityMicros,
          rational(BigInt(costState.totalCostMinor), BigInt(costState.basisQuantityMicros))
        );
        row.costAvailability = "available";
        row.costRevision = costState.revision;
        row.costEvidenceId = costState.lastCostEvidenceId;
        row.currency = costState.currency;
        row.exactCostMinor = serializeRational(exactCost);
        exactKnownCost = addRational(exactKnownCost, exactCost);
        costedIngredientCount += 1;
        currencies.add(costState.currency);
      }
    }
    rows.push(Object.freeze(row));
  }
  if (currencies.size > 1) issues.push({ code: "currency_mismatch" });
  issues.sort(compareIssues);

  const invalidIssueCodes = new Set([
    "missing_output_yield", "empty_recipe", "missing_usable_yield", "unsupported_unit",
    "missing_ingredient", "invalid_ingredient", "inactive_ingredient", "unsupported_conversion",
    "missing_pack_conversion", "invalid_pack_conversion", "incompatible_pack_conversion",
    "invalid_cost_evidence", "cost_unit_mismatch", "currency_mismatch"
  ]);
  const invalid = issues.some((issue) => invalidIssueCodes.has(issue.code));
  const expectedIngredientCount = new Set(recipeRevision.lines.map((line) => line.ingredientId)).size;
  let status;
  if (invalid) status = "invalid";
  else if (costedIngredientCount === expectedIngredientCount) status = "complete";
  else if (costedIngredientCount > 0) status = "partial";
  else status = "unavailable";

  const result = {
    authorityVersion: ingredientCore.INVENTORY_AUTHORITY_VERSION,
    schemaVersion: RECIPE_SCHEMA_VERSION,
    costingVersion: RECIPE_COST_VERSION,
    organizationId: recipeRevision.organizationId,
    menuItemId: recipeRevision.menuItemId,
    recipeRevisionId: recipeRevision.recipeRevisionId,
    recipeDigest: recipeRevision.recipeDigest,
    status,
    outputYield: recipeRevision.outputYield,
    outputUnitId: recipeRevision.outputUnitId,
    ingredients: Object.freeze(rows),
    coverage: Object.freeze({
      expectedIngredientCount,
      normalizedIngredientCount: rows.length,
      costedIngredientCount,
      missingCostIngredientCount
    }),
    issues: Object.freeze(issues.map((issue) => Object.freeze(issue)))
  };
  if (costedIngredientCount > 0 && currencies.size === 1) {
    result.currency = [...currencies][0];
    result.exactKnownCostMinor = serializeRational(exactKnownCost);
    result.knownCostMinor = roundRationalHalfUp(exactKnownCost);
    if (status === "complete") {
      result.projectedCostMinor = result.knownCostMinor;
      const outputYieldMicros = quantityRational(recipeRevision.outputYield, "outputYield");
      result.exactCostPerOutputUnitMinor = serializeRational(divideRational(
        exactKnownCost,
        divideRational(outputYieldMicros, rational(BigInt(ingredientCore.QUANTITY_SCALE)))
      ));
    }
  }
  return Object.freeze({
    ...result,
    resultDigest: ingredientCore.digest(result, "ingredient recipe cost")
  });
}

module.exports = {
  MAX_PACK_CONVERSIONS,
  MAX_RECIPE_LINES,
  PACK_CONVERSION_VERSION,
  RECIPE_COST_VERSION,
  RECIPE_REVISION_VERSION,
  RECIPE_SCHEMA_VERSION,
  STANDARD_UNIT_RATIOS,
  InventoryRecipeError,
  addRational,
  calculateRecipeCost,
  convertStandardQuantity,
  createPackConversionRevision,
  createRecipeRevision,
  divideRational,
  multiplyRational,
  packConversionRevisionIdFor,
  rational,
  recipeRevisionIdFor,
  roundRationalHalfUp,
  serializeRational,
  verifyPackConversionRevision,
  verifyRecipeRevision
};
