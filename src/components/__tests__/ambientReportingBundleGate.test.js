import fs from "node:fs";
import { describe, expect, test } from "vitest";

const APP_SOURCE = fs.readFileSync(new URL("../../App.jsx", import.meta.url), "utf8");
const REPORTING_SOURCE = fs.readFileSync(
  new URL("../ReportingDashboardModal.jsx", import.meta.url),
  "utf8"
);

describe("Ambient reporting bundle boundary", () => {
  test("loads the reporting measures only behind the statically foldable Ambient gate", () => {
    expect(REPORTING_SOURCE).not.toContain('import ReportingAmbientMetrics from "./AmbientReportingMetrics"');
    expect(REPORTING_SOURCE).toContain("const ReportingAmbientMetrics = AMBIENT_UI_ENABLED\n  ? lazy(");
    expect(REPORTING_SOURCE).toContain('import("./AmbientReportingMetrics")');
    expect(REPORTING_SOURCE).toContain("{ReportingAmbientMetrics && (");
  });

  test("compiles Ambient timing observation to no-ops outside the static gate", () => {
    expect(APP_SOURCE).toContain("if (AMBIENT_UI_ENABLED) recordProductAnalyticsFirstIntent();");
    expect(APP_SOURCE.match(/if \(AMBIENT_UI_ENABLED\) \{\s+recordProductAnalyticsPricedDraftReceipt\(/g))
      .toHaveLength(2);
    expect(APP_SOURCE).not.toContain("loadAmbientProductAnalytics");
  });
});
