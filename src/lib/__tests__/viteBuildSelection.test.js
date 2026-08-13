import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fileEnvironment: {} }));

vi.mock("vite", () => ({
  defineConfig: (value) => value,
  loadEnv: vi.fn(() => mocks.fileEnvironment)
}));

vi.mock("@vitejs/plugin-react", () => ({
  default: () => ({ name: "react-test-plugin" })
}));

import createViteConfig from "../../../vite.config.js";

const ORIGINAL_AMBIENT = process.env.VITE_AMBIENT_UI_ENABLED;
const ORIGINAL_NOW = process.env.VITE_PILOT_NOW_ENABLED;

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function selectedFile(config, alias) {
  return String(config.resolve.alias[alias] || "").replaceAll("\\", "/");
}

describe("Vite build-selected compatibility graph", () => {
  beforeEach(() => {
    mocks.fileEnvironment = {};
    delete process.env.VITE_AMBIENT_UI_ENABLED;
    delete process.env.VITE_PILOT_NOW_ENABLED;
  });

  afterEach(() => {
    restoreEnvironment("VITE_AMBIENT_UI_ENABLED", ORIGINAL_AMBIENT);
    restoreEnvironment("VITE_PILOT_NOW_ENABLED", ORIGINAL_NOW);
  });

  test("honors mode-specific file flags for the Ambient App and NOW surface", () => {
    mocks.fileEnvironment = {
      VITE_AMBIENT_UI_ENABLED: "true",
      VITE_PILOT_NOW_ENABLED: "true"
    };

    const config = createViteConfig({ mode: "production" });

    expect(selectedFile(config, "quotepilot-active-app")).toMatch(/\/src\/App\.jsx$/);
    expect(selectedFile(config, "quotepilot-active-legacy-home"))
      .toMatch(/\/src\/components\/LegacyNowView\.jsx$/);
  });

  test("lets an explicit process profile override conflicting file flags", () => {
    mocks.fileEnvironment = {
      VITE_AMBIENT_UI_ENABLED: "true",
      VITE_PILOT_NOW_ENABLED: "true"
    };
    process.env.VITE_AMBIENT_UI_ENABLED = "false";
    process.env.VITE_PILOT_NOW_ENABLED = "false";

    const config = createViteConfig({ mode: "production" });

    expect(selectedFile(config, "quotepilot-active-app")).toMatch(/\/src\/LegacyApp\.jsx$/);
    expect(selectedFile(config, "quotepilot-active-legacy-home"))
      .toMatch(/\/src\/components\/LegacyCommandCenterHome\.jsx$/);
  });

  test("keeps direct component tests on the active graph while tests stub feature flags", () => {
    const config = createViteConfig({ mode: "test" });

    expect(selectedFile(config, "quotepilot-active-app")).toMatch(/\/src\/App\.jsx$/);
    expect(selectedFile(config, "quotepilot-active-workspace-shell"))
      .toMatch(/\/src\/components\/WorkspaceShell\.jsx$/);
    expect(selectedFile(config, "quotepilot-active-conversation-panel"))
      .toMatch(/\/src\/components\/QuoteConversationPanel\.jsx$/);
  });
});
