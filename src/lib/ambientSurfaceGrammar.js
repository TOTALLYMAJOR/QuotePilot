export const AMBIENT_SURFACE_GRAMMAR_MODEL = "ambient-surface-grammar-v1";

export const AMBIENT_SURFACE_GRAMMAR = Object.freeze({
  modelId: AMBIENT_SURFACE_GRAMMAR_MODEL,
  density: "editorial",
  structuralRules: Object.freeze([
    "purpose-before-container",
    "open-layout-before-card",
    "hairline-before-permanent-border",
    "temporary-controls-before-toolbar",
    "one-primary-resolution-per-group"
  ]),
  registeredRouteSurfaces: Object.freeze([
    "ambient-now",
    "ambient-opportunities",
    "ambient-clients",
    "ambient-client-relationship",
    "ambient-library",
    "living-opportunity"
  ])
});

export function inspectAmbientSurfaceGrammar(root) {
  if (!root?.querySelectorAll) {
    return Object.freeze({ inspected: 0, violations: Object.freeze([]), compliant: true });
  }
  const surfaces = [...root.querySelectorAll(".ambient-purpose-surface")];
  const violations = surfaces.flatMap((surface) => {
    const contractId = String(surface.getAttribute("data-surface-contract-id") || "").trim();
    const purposes = String(surface.getAttribute("data-surface-purpose") || "").trim();
    const density = String(surface.getAttribute("data-surface-density") || "").trim();
    const problems = [];
    if (!contractId) problems.push("missing-surface-contract");
    if (!purposes) problems.push("missing-surface-purpose");
    if (density !== AMBIENT_SURFACE_GRAMMAR.density) problems.push("wrong-surface-density");
    return problems.map((problem) => Object.freeze({
      contractId: contractId || null,
      problem
    }));
  });
  return Object.freeze({
    inspected: surfaces.length,
    violations: Object.freeze(violations),
    compliant: violations.length === 0
  });
}
