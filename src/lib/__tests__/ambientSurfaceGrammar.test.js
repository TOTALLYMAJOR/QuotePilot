import { describe, expect, it } from "vitest";
import {
  AMBIENT_SURFACE_GRAMMAR,
  inspectAmbientSurfaceGrammar
} from "../ambientSurfaceGrammar";

function surface(attributes = {}) {
  return {
    getAttribute(name) {
      return attributes[name] || "";
    }
  };
}

describe("Ambient surface grammar", () => {
  it("registers every primary Ambient route", () => {
    expect(AMBIENT_SURFACE_GRAMMAR.registeredRouteSurfaces).toEqual([
      "ambient-now",
      "ambient-opportunities",
      "ambient-clients",
      "ambient-client-relationship",
      "ambient-library",
      "living-opportunity"
    ]);
  });

  it("accepts purpose-bearing editorial surfaces", () => {
    const root = {
      querySelectorAll: () => [surface({
        "data-surface-contract-id": "ambient-now",
        "data-surface-purpose": "clarify advance",
        "data-surface-density": "editorial"
      })]
    };
    expect(inspectAmbientSurfaceGrammar(root)).toEqual({
      inspected: 1,
      violations: [],
      compliant: true
    });
  });

  it("reports missing contracts, purposes, and the wrong density", () => {
    const root = { querySelectorAll: () => [surface()] };
    const result = inspectAmbientSurfaceGrammar(root);
    expect(result.compliant).toBe(false);
    expect(result.violations.map(({ problem }) => problem)).toEqual([
      "missing-surface-contract",
      "missing-surface-purpose",
      "wrong-surface-density"
    ]);
  });
});
