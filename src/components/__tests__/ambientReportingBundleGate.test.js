import fs from "node:fs";
import { describe, expect, test } from "vitest";

const APP_SOURCE = fs.readFileSync(new URL("../../App.jsx", import.meta.url), "utf8");
const LEGACY_APP_SOURCE = fs.readFileSync(new URL("../../LegacyApp.jsx", import.meta.url), "utf8");
const REPORTING_SOURCE = fs.readFileSync(
  new URL("../ReportingDashboardModal.jsx", import.meta.url),
  "utf8"
);
const MESSAGING_SOURCE = fs.readFileSync(
  new URL("../MessagingStation.jsx", import.meta.url),
  "utf8"
);
const LEGACY_REPORTING_SOURCE = fs.readFileSync(
  new URL("../LegacyReportingDashboardModal.jsx", import.meta.url),
  "utf8"
);
const ACTIVE_SURFACE_SOURCES = [
  "EventScheduleModal.jsx",
  "SalesWorkflowModal.jsx",
  "ReportingDashboardModal.jsx",
  "WorkspaceShell.jsx",
  "MessagingStation.jsx"
].map((fileName) => [
  fileName,
  fs.readFileSync(new URL(`../${fileName}`, import.meta.url), "utf8")
]);

describe("Ambient reporting bundle boundary", () => {
  test("keeps Ambient surfaces unconditional in the active modules and selects legacy modules at the App boundary", () => {
    ACTIVE_SURFACE_SOURCES.forEach(([fileName, source]) => {
      expect(source, fileName).not.toContain("VITE_AMBIENT_UI_ENABLED");
    });
    expect(REPORTING_SOURCE).not.toContain('import ReportingAmbientMetrics from "./AmbientReportingMetrics"');
    expect(REPORTING_SOURCE).toContain(
      'const ReportingAmbientMetrics = lazy(() => import("./AmbientReportingMetrics"));'
    );
    expect(LEGACY_REPORTING_SOURCE).not.toContain("AmbientReportingMetrics");
    expect(APP_SOURCE).toMatch(
      /const ReportingDashboardView = createRecoverableLazy\([\s\S]*AMBIENT_UI_ENABLED[\s\S]*ReportingDashboardRoute[\s\S]*LegacyReportingDashboardRoute/
    );
    expect(APP_SOURCE).toContain('import ActiveWorkspaceShell from "quotepilot-active-workspace-shell"');
    expect(APP_SOURCE).toMatch(
      /const MessagingStation = createRecoverableLazy\([\s\S]*AMBIENT_UI_ENABLED[\s\S]*MessagingStation[\s\S]*LegacyMessagingStation/
    );
    expect(APP_SOURCE).toMatch(
      /const EventScheduleView = createRecoverableLazy\([\s\S]*AMBIENT_UI_ENABLED[\s\S]*EventScheduleRoute[\s\S]*LegacyEventScheduleRoute/
    );
    expect(APP_SOURCE).toMatch(
      /const SalesWorkflowView = createRecoverableLazy\([\s\S]*AMBIENT_UI_ENABLED[\s\S]*SalesWorkflowRoute[\s\S]*LegacySalesWorkflowRoute/
    );
    expect(MESSAGING_SOURCE).toContain(
      'import QuoteConversationPanel from "quotepilot-active-conversation-panel"'
    );
    expect(LEGACY_APP_SOURCE).toContain('import("./components/LegacyMessagingStation")');
    expect(LEGACY_APP_SOURCE).toContain('import("./components/LegacyEventScheduleModal")');
    expect(LEGACY_APP_SOURCE).toContain('import("./components/LegacyReportingDashboardModal")');
    expect(LEGACY_APP_SOURCE).toContain('import("./components/LegacySalesWorkflowModal")');
    expect(LEGACY_APP_SOURCE).not.toMatch(/(?:EventSchedule|ReportingDashboard|SalesWorkflow)Route/);
  });

  test("keeps Ambient timing observation behind the active App loader", () => {
    expect(APP_SOURCE).toContain("const loadAmbientProductAnalytics = AMBIENT_UI_ENABLED");
    expect(APP_SOURCE).toContain('? () => import("./lib/productAnalyticsAmbient")');
    expect(APP_SOURCE.match(/if \(typeof loadAmbientProductAnalytics === "function"\)/g))
      .toHaveLength(4);
    expect(APP_SOURCE.match(/analytics\.recordProductAnalyticsPricedDraftReceipt\(/g))
      .toHaveLength(2);
    expect(LEGACY_APP_SOURCE).not.toContain("productAnalyticsAmbient");
  });
});
