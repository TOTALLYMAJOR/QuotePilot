import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const ingredientCore = require("../../../functions/inventoryIngredientCore.cjs");
const recipeCore = require("../../../functions/inventoryRecipeCore.cjs");

const ORG = "org-smith";
const NOW = "2026-09-09T05:00:00.000Z";
const ACTOR = { uid: "admin-1", email: "admin@example.test", role: "admin", organizationId: ORG };

function ingredient(ingredientId, baseUnitId = "lb", overrides = {}) {
  const planned = ingredientCore.planIngredient({
    organizationId: ORG,
    request: {
      kind: "upsert_ingredient",
      ingredientId,
      name: ingredientId === "chicken" ? "Chicken" : ingredientId === "pasta" ? "Pasta" : ingredientId,
      category: "Food",
      baseUnitId,
      active: true,
      expectedRevision: 0
    },
    actor: ACTOR,
    nowISO: NOW
  }).ingredient;
  return { ...planned, ...overrides };
}

function costState(ingredientId, {
  baseUnitId = "lb",
  basisQuantity = "40",
  totalCostMinor = 12_000,
  currency = "USD",
  availability = "available"
} = {}) {
  const common = {
    kind: "record_ingredient_cost",
    ingredientId,
    baseUnitId,
    availability,
    sourceLabel: "Recorded purchase",
    observedAtISO: "2026-09-08T12:00:00.000Z",
    note: "Exact observation",
    expectedCostRevision: 0
  };
  const request = availability === "available"
    ? { ...common, basisQuantity, totalCostMinor, currency }
    : common;
  return ingredientCore.planIngredientCostEvidence({
    organizationId: ORG,
    requestId: `cost-${ingredientId}-${availability}-${currency}`,
    request,
    ingredient: ingredient(ingredientId, baseUnitId),
    actor: ACTOR,
    nowISO: NOW
  }).nextCostState;
}

function standardLine(lineId, ingredientId, quantity, unitId = "lb", overrides = {}) {
  return {
    lineId,
    ingredientId,
    quantity,
    unitKind: "standard",
    quantityBasis: "as_purchased",
    usableYield: null,
    unitId,
    ...overrides
  };
}

function packLine(lineId, ingredientId, quantity, packConversionRevisionId, overrides = {}) {
  return {
    lineId,
    ingredientId,
    quantity,
    unitKind: "ingredient_pack",
    quantityBasis: "as_purchased",
    usableYield: null,
    packConversionRevisionId,
    ...overrides
  };
}

function recipe(lines = [
  standardLine("chicken-line", "chicken", "2"),
  standardLine("pasta-line", "pasta", "1")
], overrides = {}) {
  return recipeCore.createRecipeRevision({
    organizationId: ORG,
    menuItemId: "menu-chicken-pasta",
    revision: 1,
    priorRecipeRevisionId: "",
    outputYield: "10",
    outputUnitId: "portion",
    lines,
    publishedAtISO: NOW,
    ...overrides
  });
}

function anchorInputs() {
  return {
    recipeRevision: recipe(),
    ingredients: [ingredient("chicken"), ingredient("pasta")],
    costStates: [
      costState("chicken", { basisQuantity: "40", totalCostMinor: 12_000 }),
      costState("pasta", { basisQuantity: "30", totalCostMinor: 6_000 })
    ]
  };
}

describe("immutable recipe revisions", () => {
  test("binds a deterministic schema-v2 revision to a stable menu item and sorts lines", () => {
    const first = recipe([
      standardLine("pasta-line", "pasta", "1"),
      standardLine("chicken-line", "chicken", "2")
    ]);
    const second = recipe();

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      schemaVersion: 2,
      recipeVersion: "ingredient-recipe-revision-v2",
      menuItemId: "menu-chicken-pasta",
      revision: 1,
      validity: "valid"
    });
    expect(first.lines.map(({ ingredientId }) => ingredientId)).toEqual(["chicken", "pasta"]);
    expect(recipeCore.verifyRecipeRevision(first)).toBe(first);
  });

  test("requires an exact predecessor and preserves old revisions when a new one is created", () => {
    const first = recipe();
    const second = recipe([standardLine("chicken-line", "chicken", "3")], {
      revision: 2,
      priorRecipeRevisionId: first.recipeRevisionId
    });
    expect(second.recipeRevisionId).not.toBe(first.recipeRevisionId);
    expect(first.lines[0].quantity).toBe("2");
    expect(second.lines[0].quantity).toBe("3");
    expect(() => recipe([], { revision: 2, priorRecipeRevisionId: "wrong-revision" })).toThrow(/prior/i);
  });

  test("fails closed on duplicate line identities, oversized recipes, and digest tampering", () => {
    expect(() => recipe([
      standardLine("same", "chicken", "1"),
      standardLine("same", "pasta", "1")
    ])).toThrow(/unique/i);
    expect(() => recipe(Array.from({ length: 201 }, (_, index) =>
      standardLine(`line-${index}`, "chicken", "1")))).toThrow(/at most 200/i);

    const valid = recipe();
    expect(() => recipeCore.verifyRecipeRevision({ ...valid, outputYield: "12" })).toThrow(/digest/i);
    const { recipeDigest: _digest, ...body } = valid;
    const contradictory = { ...body, validity: "invalid" };
    expect(() => recipeCore.verifyRecipeRevision({
      ...contradictory,
      recipeDigest: ingredientCore.digest(contradictory, "ingredient recipe revision")
    })).toThrow(/internally inconsistent/i);
  });

  test("records missing yield, missing usable yield, and unsupported units as explicit invalid evidence", () => {
    const invalid = recipe([
      standardLine("usable", "chicken", "2", "lb", { quantityBasis: "usable" }),
      standardLine("mystery", "pasta", "1", "scoop")
    ], { outputYield: null });
    expect(invalid.validity).toBe("invalid");
    expect(invalid.definitionIssues.map(({ code }) => code)).toEqual([
      "missing_output_yield",
      "missing_usable_yield",
      "unsupported_unit"
    ]);
  });
});

describe("explicit unit and pack conversion", () => {
  test.each([
    ["8", "oz", "lb", { numerator: "500000", denominator: "1" }],
    ["1", "kg", "g", { numerator: "1000000000", denominator: "1" }],
    ["1", "dozen", "each", { numerator: "12000000", denominator: "1" }],
    ["1", "gal", "qt", { numerator: "4000000", denominator: "1" }]
  ])("converts %s %s to exact %s micros", (quantity, from, to, expected) => {
    const converted = recipeCore.convertStandardQuantity(
      recipeCore.rational(BigInt(ingredientCore.parseQuantityMicros(quantity))),
      from,
      to
    );
    expect(recipeCore.serializeRational(converted)).toEqual(expected);
  });

  test("does not infer cross-dimension conversions", () => {
    const result = recipeCore.calculateRecipeCost({
      recipeRevision: recipe([standardLine("volume-chicken", "chicken", "1", "l")]),
      ingredients: [ingredient("chicken", "lb")],
      costStates: [costState("chicken")]
    });
    expect(result.status).toBe("invalid");
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "unsupported_conversion" }));
    expect(result.ingredients).toEqual([]);
  });

  test("uses only a pinned ingredient-specific pack conversion", () => {
    const pack = recipeCore.createPackConversionRevision({
      organizationId: ORG,
      ingredientId: "chicken",
      packUnitId: "case",
      packLabel: "Case",
      revision: 1,
      baseUnitId: "lb",
      baseQuantity: "10",
      sourceLabel: "Operator declared case contents",
      publishedAtISO: NOW
    });
    const result = recipeCore.calculateRecipeCost({
      recipeRevision: recipe([packLine("case-line", "chicken", "1.5", pack.packConversionRevisionId)]),
      ingredients: [ingredient("chicken")],
      costStates: [costState("chicken")],
      packConversions: [pack]
    });
    expect(result.status).toBe("complete");
    expect(result.ingredients[0]).toMatchObject({
      requiredBaseQuantityMicros: { numerator: "15000000", denominator: "1" },
      exactCostMinor: { numerator: "4500", denominator: "1" },
      conversionProvenance: [expect.objectContaining({
        kind: "ingredient_pack",
        packConversionRevisionId: pack.packConversionRevisionId
      })]
    });
    expect(recipeCore.verifyPackConversionRevision(pack)).toBe(pack);
  });

  test("reports missing, incompatible, and tampered pack evidence rather than guessing contents", () => {
    const chickenPack = recipeCore.createPackConversionRevision({
      organizationId: ORG,
      ingredientId: "chicken",
      packUnitId: "case",
      packLabel: "Case",
      revision: 1,
      baseUnitId: "lb",
      baseQuantity: "10",
      sourceLabel: "Declared case",
      publishedAtISO: NOW
    });
    const line = packLine("case-line", "pasta", "1", chickenPack.packConversionRevisionId);
    const missing = recipeCore.calculateRecipeCost({
      recipeRevision: recipe([line]),
      ingredients: [ingredient("pasta")],
      costStates: [costState("pasta")]
    });
    expect(missing.issues).toContainEqual(expect.objectContaining({ code: "missing_pack_conversion" }));

    const incompatible = recipeCore.calculateRecipeCost({
      recipeRevision: recipe([line]),
      ingredients: [ingredient("pasta")],
      costStates: [costState("pasta")],
      packConversions: [chickenPack]
    });
    expect(incompatible.issues).toContainEqual(expect.objectContaining({ code: "incompatible_pack_conversion" }));

    expect(() => recipeCore.verifyPackConversionRevision({ ...chickenPack, baseQuantityMicros: 1 })).toThrow(/digest/i);
  });

  test("applies a declared usable yield and never assumes one", () => {
    const declared = recipeCore.calculateRecipeCost({
      recipeRevision: recipe([
        standardLine("usable", "chicken", "8", "lb", { quantityBasis: "usable", usableYield: "0.8" })
      ]),
      ingredients: [ingredient("chicken")],
      costStates: [costState("chicken")]
    });
    expect(declared.status).toBe("complete");
    expect(declared.ingredients[0].requiredBaseQuantityMicros).toEqual({ numerator: "10000000", denominator: "1" });
    expect(declared.projectedCostMinor).toBe(3000);

    const unknown = recipeCore.calculateRecipeCost({
      recipeRevision: recipe([
        standardLine("usable", "chicken", "8", "lb", { quantityBasis: "usable", usableYield: null })
      ]),
      ingredients: [ingredient("chicken")],
      costStates: [costState("chicken")]
    });
    expect(unknown.status).toBe("invalid");
    expect(unknown.issues).toContainEqual(expect.objectContaining({ code: "missing_usable_yield" }));
    expect(unknown).not.toHaveProperty("projectedCostMinor");
  });
});

describe("pure deterministic recipe costing", () => {
  test("calculates the owner fixture exactly without a rounded unit-cost intermediate", () => {
    const result = recipeCore.calculateRecipeCost(anchorInputs());
    expect(result.status).toBe("complete");
    expect(result.currency).toBe("USD");
    expect(result.projectedCostMinor).toBe(800);
    expect(result.exactKnownCostMinor).toEqual({ numerator: "800", denominator: "1" });
    expect(result.exactCostPerOutputUnitMinor).toEqual({ numerator: "80", denominator: "1" });
    expect(result.ingredients).toEqual([
      expect.objectContaining({ ingredientId: "chicken", exactCostMinor: { numerator: "600", denominator: "1" } }),
      expect.objectContaining({ ingredientId: "pasta", exactCostMinor: { numerator: "200", denominator: "1" } })
    ]);
    expect(result).not.toHaveProperty("sellingPriceMinor");
    expect(result).not.toHaveProperty("onHandMicros");
    expect(result).not.toHaveProperty("availableMicros");
  });

  test("aggregates shared ingredient lines before rounding", () => {
    const result = recipeCore.calculateRecipeCost({
      recipeRevision: recipe([
        standardLine("one", "salt", "1", "each"),
        standardLine("two", "salt", "1", "each"),
        standardLine("three", "salt", "1", "each")
      ]),
      ingredients: [ingredient("salt", "each")],
      costStates: [costState("salt", { baseUnitId: "each", basisQuantity: "3", totalCostMinor: 1 })]
    });
    expect(result.ingredients).toHaveLength(1);
    expect(result.ingredients[0].lineIds).toEqual(["one", "three", "two"]);
    expect(result.ingredients[0].exactCostMinor).toEqual({ numerator: "1", denominator: "1" });
    expect(result.projectedCostMinor).toBe(1);
  });

  test("carries fractional money exactly and rounds half-up only at the output boundary", () => {
    const result = recipeCore.calculateRecipeCost({
      recipeRevision: recipe([standardLine("half", "salt", "1", "each")]),
      ingredients: [ingredient("salt", "each")],
      costStates: [costState("salt", { baseUnitId: "each", basisQuantity: "2", totalCostMinor: 1 })]
    });
    expect(result.ingredients[0].exactCostMinor).toEqual({ numerator: "1", denominator: "2" });
    expect(result.exactKnownCostMinor).toEqual({ numerator: "1", denominator: "2" });
    expect(result.projectedCostMinor).toBe(1);
  });

  test("labels known money as partial and does not claim a complete projected cost", () => {
    const inputs = anchorInputs();
    const result = recipeCore.calculateRecipeCost({ ...inputs, costStates: [inputs.costStates[0]] });
    expect(result.status).toBe("partial");
    expect(result.knownCostMinor).toBe(600);
    expect(result.exactKnownCostMinor).toEqual({ numerator: "600", denominator: "1" });
    expect(result).not.toHaveProperty("projectedCostMinor");
    expect(result.coverage).toMatchObject({ expectedIngredientCount: 2, costedIngredientCount: 1, missingCostIngredientCount: 1 });
    expect(result.issues).toContainEqual({ code: "missing_cost", ingredientId: "pasta" });
  });

  test.each([
    "missing",
    "not_applicable",
    "not_yet_available",
    "blocked_by_integration",
    "contradictory",
    "schema_drift"
  ])(
    "keeps %s cost evidence unavailable instead of treating it as zero",
    (availability) => {
      const result = recipeCore.calculateRecipeCost({
        recipeRevision: recipe([standardLine("chicken-line", "chicken", "2")]),
        ingredients: [ingredient("chicken")],
        costStates: [costState("chicken", { availability })]
      });
      expect(result.status).toBe("unavailable");
      expect(result.issues).toContainEqual({ code: "cost_unavailable", ingredientId: "chicken", availability });
      expect(result).not.toHaveProperty("knownCostMinor");
      expect(result).not.toHaveProperty("projectedCostMinor");
    }
  );

  test("treats a recorded zero cost as available evidence, not unknown evidence", () => {
    const result = recipeCore.calculateRecipeCost({
      recipeRevision: recipe([standardLine("water-line", "water", "1", "l")]),
      ingredients: [ingredient("water", "l")],
      costStates: [costState("water", { baseUnitId: "l", basisQuantity: "10", totalCostMinor: 0 })]
    });
    expect(result.status).toBe("complete");
    expect(result.projectedCostMinor).toBe(0);
    expect(result.exactKnownCostMinor).toEqual({ numerator: "0", denominator: "1" });
  });

  test("keeps missing and invalid ingredient references explicit", () => {
    const missing = recipeCore.calculateRecipeCost({
      recipeRevision: recipe([standardLine("ghost-line", "ghost", "1")]),
      ingredients: [],
      costStates: []
    });
    expect(missing.status).toBe("invalid");
    expect(missing.issues).toContainEqual({ code: "missing_ingredient", ingredientId: "ghost", lineId: "ghost-line" });

    const crossTenant = ingredient("chicken");
    crossTenant.organizationId = "other-org";
    const invalid = recipeCore.calculateRecipeCost({
      recipeRevision: recipe([standardLine("chicken-line", "chicken", "1")]),
      ingredients: [crossTenant],
      costStates: []
    });
    expect(invalid.status).toBe("invalid");
    expect(invalid.issues).toContainEqual({ code: "invalid_ingredient", ingredientId: "chicken", lineId: "chicken-line" });
  });

  test("does not aggregate different currencies into invented money", () => {
    const inputs = anchorInputs();
    const result = recipeCore.calculateRecipeCost({
      ...inputs,
      costStates: [
        inputs.costStates[0],
        costState("pasta", { basisQuantity: "30", totalCostMinor: 6_000, currency: "CAD" })
      ]
    });
    expect(result.status).toBe("invalid");
    expect(result.issues).toContainEqual({ code: "currency_mismatch" });
    expect(result).not.toHaveProperty("knownCostMinor");
    expect(result).not.toHaveProperty("projectedCostMinor");
  });

  test("is deterministic across ingredient and cost input order", () => {
    const inputs = anchorInputs();
    const forward = recipeCore.calculateRecipeCost(inputs);
    const reverse = recipeCore.calculateRecipeCost({
      ...inputs,
      ingredients: [...inputs.ingredients].reverse(),
      costStates: [...inputs.costStates].reverse()
    });
    expect(reverse).toEqual(forward);
    expect(reverse.resultDigest).toBe(forward.resultDigest);
  });

  test("rejects duplicate evidence identities rather than depending on input order", () => {
    const inputs = anchorInputs();
    expect(() => recipeCore.calculateRecipeCost({
      ...inputs,
      ingredients: [inputs.ingredients[0], inputs.ingredients[0]]
    })).toThrow(/duplicate identity/i);
    expect(() => recipeCore.calculateRecipeCost({
      ...inputs,
      costStates: [inputs.costStates[0], inputs.costStates[0]]
    })).toThrow(/duplicate identity/i);
  });
});
