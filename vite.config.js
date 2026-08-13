import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const COMMERCIAL_DEPENDENCY_GRAPH_CORE = fileURLToPath(
  new URL("./src/lib/commercialDependencyGraphCore.cjs", import.meta.url)
);

function environmentFlagEnabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

export default defineConfig(({ mode }) => {
  const buildEnvironment = {
    ...loadEnv(mode, process.cwd(), ""),
    ...process.env
  };
  // Unit tests import active modules directly and exercise both flag states
  // with `vi.stubEnv`; keep that graph concrete in test mode. Production and
  // local builds remain selected exclusively by their resolved Ambient flag.
  const ambientGraphEnabled = mode === "test"
    || environmentFlagEnabled(buildEnvironment.VITE_AMBIENT_UI_ENABLED);
  const appCheckGraphEnabled = buildEnvironment.VITE_FIREBASE_APP_CHECK_ENABLED === "true";
  const activeFirebaseAppCheck = appCheckGraphEnabled
    ? fileURLToPath(new URL("./src/lib/firebaseAppCheckEnabled.js", import.meta.url))
    : fileURLToPath(new URL("./src/lib/firebaseAppCheckDisabled.js", import.meta.url));
  const activeApp = ambientGraphEnabled
    ? fileURLToPath(new URL("./src/App.jsx", import.meta.url))
    : fileURLToPath(new URL("./src/LegacyApp.jsx", import.meta.url));
  const activeWorkspaceShell = ambientGraphEnabled
    ? fileURLToPath(new URL("./src/components/WorkspaceShell.jsx", import.meta.url))
    : fileURLToPath(new URL("./src/components/LegacyWorkspaceShell.jsx", import.meta.url));
  const activeCustomerPortalView = ambientGraphEnabled
    ? fileURLToPath(new URL("./src/components/CustomerPortalView.jsx", import.meta.url))
    : fileURLToPath(new URL("./src/components/LegacyCustomerPortalView.jsx", import.meta.url));
  const activeQuoteConversationPanel = ambientGraphEnabled
    ? fileURLToPath(new URL("./src/components/QuoteConversationPanel.jsx", import.meta.url))
    : fileURLToPath(new URL("./src/components/LegacyQuoteConversationPanel.jsx", import.meta.url));
  const activeProductAnalytics = ambientGraphEnabled
    ? fileURLToPath(new URL("./src/lib/productAnalyticsCore.js", import.meta.url))
    : fileURLToPath(new URL("./src/lib/productAnalyticsLegacy.js", import.meta.url));
  const activeCustomerWorkspaceView = ambientGraphEnabled
    ? fileURLToPath(new URL("./src/components/CustomerWorkspaceView.jsx", import.meta.url))
    : fileURLToPath(new URL("./src/components/LegacyCustomerWorkspaceView.jsx", import.meta.url));
  const activeWorkspaceNotFound = ambientGraphEnabled
    ? fileURLToPath(new URL("./src/components/WorkspaceNotFound.jsx", import.meta.url))
    : fileURLToPath(new URL("./src/components/LegacyWorkspaceNotFound.jsx", import.meta.url));
  const activeNowView = ambientGraphEnabled
    ? fileURLToPath(new URL("./src/components/NowView.jsx", import.meta.url))
    : fileURLToPath(new URL("./src/components/LegacyNowView.jsx", import.meta.url));
  const activeCommandCenterHome = ambientGraphEnabled
    ? fileURLToPath(new URL("./src/components/CommandCenterHome.jsx", import.meta.url))
    : fileURLToPath(new URL("./src/components/LegacyCommandCenterHome.jsx", import.meta.url));
  const activeCustomerDirectoryView = ambientGraphEnabled
    ? fileURLToPath(new URL("./src/components/CustomerDirectoryView.jsx", import.meta.url))
    : fileURLToPath(new URL("./src/components/LegacyCustomerDirectoryView.jsx", import.meta.url));
  const activeStaffEvidenceRail = ambientGraphEnabled
    ? fileURLToPath(new URL("./src/components/StaffEvidenceRail.jsx", import.meta.url))
    : fileURLToPath(new URL("./src/components/LegacyStaffEvidenceRail.jsx", import.meta.url));
  const activeLegacyHome = environmentFlagEnabled(buildEnvironment.VITE_PILOT_NOW_ENABLED)
    ? fileURLToPath(new URL("./src/components/LegacyNowView.jsx", import.meta.url))
    : activeCommandCenterHome;
  return ({
  envDir: ".",
  publicDir: "public",
  plugins: [react()],
  resolve: {
    alias: {
      "commercial-dependency-graph-core": COMMERCIAL_DEPENDENCY_GRAPH_CORE,
      "quotepilot-active-firebase-app-check": activeFirebaseAppCheck,
      "quotepilot-active-app": activeApp,
      "quotepilot-active-workspace-shell": activeWorkspaceShell,
      "quotepilot-active-customer-portal": activeCustomerPortalView,
      "quotepilot-active-conversation-panel": activeQuoteConversationPanel,
      "quotepilot-active-product-analytics": activeProductAnalytics,
      "quotepilot-active-customer-workspace": activeCustomerWorkspaceView,
      "quotepilot-active-workspace-not-found": activeWorkspaceNotFound,
      "quotepilot-active-now-view": activeNowView,
      "quotepilot-active-command-center-home": activeCommandCenterHome,
      "quotepilot-active-customer-directory": activeCustomerDirectoryView,
      "quotepilot-active-staff-evidence": activeStaffEvidenceRail,
      "quotepilot-active-legacy-home": activeLegacyHome
    }
  },
  optimizeDeps: {
    include: ["commercial-dependency-graph-core"]
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, "/");
          if (normalizedId.includes("/node_modules/@firebase/") || normalizedId.includes("/node_modules/firebase/")) {
            return "vendor-firebase";
          }
          if (
            normalizedId.includes("/node_modules/react/") ||
            normalizedId.includes("/node_modules/react-dom/") ||
            normalizedId.includes("/node_modules/scheduler/")
          ) {
            return "vendor-react";
          }
          if (normalizedId.endsWith("/src/lib/quoteStore.js")) {
            return "workspace-quote-store";
          }
          if (normalizedId.endsWith("/src/components/ambientLivingOpportunityPresentation.js")) {
            return "ambient-opportunity-model";
          }
          if (
            normalizedId.endsWith("/src/components/WizardSteps.jsx")
            || normalizedId.endsWith("/src/lib/wizardUi.js")
          ) {
            return "quote-builder-ui";
          }
          return undefined;
        }
      }
    }
  },
  test: {
    include: ["src/**/*.{test,spec}.{js,jsx,mjs,cjs,ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**", "dist/**"]
  }
  });
});
