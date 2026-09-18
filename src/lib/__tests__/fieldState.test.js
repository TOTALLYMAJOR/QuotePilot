import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  FIELD_STATE_AXES,
  FIELD_STATE_DEFINITIONS,
  assertFieldState,
  buildFieldStatePresentation,
  getPrimaryFieldState,
  validateFieldState
} from "../fieldState";
import { validateFieldStateContract } from "../../../scripts/check-field-state-contract.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function readContract(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8"));
}

describe("field-state contract", () => {
  test("preserves every requested label across five independent axes", () => {
    expect(Object.keys(FIELD_STATE_AXES)).toEqual([
      "availability",
      "origin",
      "editability",
      "persistence",
      "evidence"
    ]);
    expect(Object.values(FIELD_STATE_DEFINITIONS).map(({ label }) => label).sort()).toEqual([
      "Blocked",
      "Confirmed",
      "Defaulted",
      "Draft",
      "Failed",
      "Historical/imported",
      "Not applicable",
      "Not provided",
      "Pending",
      "Prepopulated",
      "Protected",
      "Published",
      "Read-only",
      "Saved",
      "Saving",
      "Stale",
      "Suggested",
      "Unavailable",
      "Unknown"
    ]);
  });

  test("allows origin, editability, and evidence to coexist without collapsing them", () => {
    const state = {
      origin: "historical_imported",
      editability: "read_only",
      evidence: "stale"
    };
    const presentation = buildFieldStatePresentation(state, {
      reason: "The source was imported before the current catalog revision.",
      provenance: "Legacy catalog.csv, row 18",
      recoveryAction: { label: "Review current value", href: "/app/catalog" }
    });

    expect(presentation.primary.id).toBe("stale");
    expect(presentation.supporting.map(({ id }) => id)).toEqual([
      "read_only",
      "historical_imported"
    ]);
  });

  test("uses deterministic precedence and accepts only an active contextual override", () => {
    const state = { editability: "protected", persistence: "published", evidence: "confirmed" };
    expect(getPrimaryFieldState(state).id).toBe("published");
    expect(getPrimaryFieldState(state, { primaryState: "protected" }).id).toBe("protected");
    expect(() => getPrimaryFieldState(state, { primaryState: "failed" })).toThrow(
      "is not active"
    );
  });

  test("requires reason, provenance, and recovery where the contract calls for them", () => {
    const issues = validateFieldState({ origin: "prepopulated", editability: "blocked" });
    expect(issues.map(({ code }) => code)).toEqual([
      "provenance_required",
      "reason_required",
      "recovery_required"
    ]);

    expect(() => assertFieldState(
      { origin: "prepopulated", editability: "blocked" },
      {
        provenance: "Menu.pdf, page 4",
        reason: "Confirm whether the price is per guest.",
        recoveryAction: { label: "Review price", onClick: () => {} }
      }
    )).not.toThrow();
  });

  test("rejects a state on the wrong axis instead of silently normalizing it", () => {
    expect(validateFieldState({ availability: "saved" })[0]).toMatchObject({
      code: "invalid_state"
    });
    expect(validateFieldState({ evidence: "confirmed", evidnce: "failed" })[0]).toMatchObject({
      code: "invalid_state"
    });
  });

  test("keeps the runtime, canonical definitions, and registered markers aligned", () => {
    const contract = readContract("docs/field-state-contract.json");
    const registry = readContract("docs/field-state-surface-contracts.json");
    expect(validateFieldStateContract({ contract, registry, repoRoot: REPO_ROOT })).toEqual([]);
  });

  test("the deterministic checker rejects label and registry drift", () => {
    const contract = readContract("docs/field-state-contract.json");
    const registry = readContract("docs/field-state-surface-contracts.json");
    contract.axes.availability.states[0].label = "Maybe";
    registry.surfaces.find((surface) => surface.id === "adaptive-choice-field").modes = ["select"];

    expect(validateFieldStateContract({ contract, registry, repoRoot: REPO_ROOT })).toEqual(
      expect.arrayContaining([
        expect.stringContaining("19 canonical user-facing labels"),
        expect.stringContaining("empty, single, and select")
      ])
    );
  });

  test("the drift gate rejects a shared-primitive adopter removed from the registry", () => {
    const contract = readContract("docs/field-state-contract.json");
    const registry = readContract("docs/field-state-surface-contracts.json");
    registry.surfaces = registry.surfaces.filter(({ path: surfacePath }) => (
      surfacePath !== "src/components/WizardSteps.jsx"
    ));

    expect(validateFieldStateContract({ contract, registry, repoRoot: REPO_ROOT }))
      .toContain("Unregistered field-state adopter: src/components/WizardSteps.jsx.");
  });
});
