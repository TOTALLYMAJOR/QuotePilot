import fs from "node:fs";
import { describe, expect, test } from "vitest";

const APP_SOURCE = fs.readFileSync(new URL("../../App.jsx", import.meta.url), "utf8");
const LEGACY_APP_SOURCE = fs.readFileSync(new URL("../../LegacyApp.jsx", import.meta.url), "utf8");
const VITE_CONFIG_SOURCE = fs.readFileSync(new URL("../../../vite.config.js", import.meta.url), "utf8");
const WORKSPACE_ROUTE_SOURCE = fs.readFileSync(
  new URL("../../components/WorkspaceRoute.jsx", import.meta.url),
  "utf8"
);
const TRUE_VALUES = ["1", "true", "yes", "on"];
const GATES = [
  ["PILOT_NOW_REQUESTED", "VITE_PILOT_NOW_ENABLED"],
  ["PILOT_CREATE_ENABLED", "VITE_PILOT_CREATE_ENABLED"],
  ["PILOT_CHANGE_REQUESTS_ENABLED", "VITE_PILOT_CHANGE_REQUESTS_ENABLED"],
  ["PILOT_COMMAND_ENABLED", "VITE_PILOT_COMMAND_ENABLED"],
  ["AMBIENT_UI_ENABLED", "VITE_AMBIENT_UI_ENABLED"]
];

const CONDITIONAL_LAZY_SURFACES = [
  ["AmbientNowView", "AMBIENT_NOW_ENABLED"],
  ["NowView", "LEGACY_NOW_ENABLED"],
  ["AmbientGlobalPilotSurface", "AMBIENT_UI_ENABLED"],
  ["AmbientDraftIntentReview", "AMBIENT_UI_ENABLED"],
  ["AmbientPilotScenarioReview", "AMBIENT_PILOT_COMMANDS_ENABLED"],
  ["PilotCommandBar", "PILOT_COMMAND_ENABLED"]
];

function extractGateExpression(constantName) {
  const marker = `const ${constantName} = `;
  const start = APP_SOURCE.indexOf(marker);
  const end = APP_SOURCE.indexOf(";", start);

  expect(start, `${constantName} declaration`).toBeGreaterThanOrEqual(0);
  expect(end, `${constantName} terminator`).toBeGreaterThan(start);
  return APP_SOURCE.slice(start + marker.length, end);
}

function extractAcceptedValues(expression, envName) {
  const token = `import.meta.env.${envName}`;
  return [...expression.matchAll(new RegExp(`${token.replaceAll(".", "\\.")} === "([^"]+)"`, "g"))]
    .map((match) => match[1]);
}

describe("statically foldable Pilot build flags", () => {
  test("selects the Ambient or compatibility App at build time through one exact alias", () => {
    expect(VITE_CONFIG_SOURCE).toContain('import { defineConfig, loadEnv } from "vite";');
    expect(VITE_CONFIG_SOURCE).toContain('...loadEnv(mode, process.cwd(), "")');
    expect(VITE_CONFIG_SOURCE).toContain("...process.env");
    expect(VITE_CONFIG_SOURCE).toContain(
      "const activeApp = ambientGraphEnabled"
    );
    expect(VITE_CONFIG_SOURCE).toContain('new URL("./src/App.jsx", import.meta.url)');
    expect(VITE_CONFIG_SOURCE).toContain('new URL("./src/LegacyApp.jsx", import.meta.url)');
    expect(VITE_CONFIG_SOURCE).toContain('"quotepilot-active-app": activeApp');
    expect(WORKSPACE_ROUTE_SOURCE).toContain('import ActiveApp from "quotepilot-active-app";');
    expect(WORKSPACE_ROUTE_SOURCE).not.toMatch(/import\s+\w+\s+from\s+["']\.\.\/App["']/);
  });

  test.each(GATES)("%s uses only exact direct comparisons", (constantName, envName) => {
    const expression = extractGateExpression(constantName).replace(/\s+/g, " ");
    const token = `import.meta.env.${envName}`;

    expect(expression).toBe(TRUE_VALUES
      .map((value) => `${token} === "${value}"`)
      .join(" || "));
    expect(expression).not.toMatch(/String\(|\.includes\(|\.trim\(|\.toLowerCase\(/);
  });

  test.each(GATES)("%s stays off when absent or unrecognized", (constantName, envName) => {
    const expression = extractGateExpression(constantName);
    const acceptedValues = extractAcceptedValues(expression, envName);

    for (const value of [
      undefined,
      "",
      "0",
      "false",
      "no",
      "off",
      "TRUE",
      " true ",
      "unexpected"
    ]) {
      expect(acceptedValues.includes(value), String(value)).toBe(false);
    }
  });

  test.each(GATES)("%s enables for every supported true value", (constantName, envName) => {
    const expression = extractGateExpression(constantName);
    const acceptedValues = extractAcceptedValues(expression, envName);

    for (const value of TRUE_VALUES) {
      expect(acceptedValues.includes(value), value).toBe(true);
    }
  });

  test("offers model-assisted CREATE parsing only behind an explicit true browser gate", () => {
    for (const source of [APP_SOURCE, LEGACY_APP_SOURCE]) {
      expect(source).toContain(
        'const PILOT_MODEL_ENABLED = import.meta.env.VITE_PILOT_MODEL_ENABLED === "true";'
      );
      expect(source).toContain(
        "onModelParse={PILOT_MODEL_ENABLED ? parseIntentDraftWithModel : undefined}"
      );
    }
  });

  test.each(CONDITIONAL_LAZY_SURFACES)(
    "%s is imported only behind its default-off build gate",
    (componentName, gateName) => {
      expect(APP_SOURCE).not.toContain(`import ${componentName} from`);
      expect(APP_SOURCE).toContain(`const ${componentName} = ${gateName}\n  ? createRecoverableLazy(`);
      expect(APP_SOURCE).toContain(`() => import("./components/${componentName}")`);
    }
  );
});
