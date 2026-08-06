import fs from "node:fs";
import { describe, expect, test } from "vitest";

const appSource = fs.readFileSync(new URL("../../App.jsx", import.meta.url), "utf8");
const wizardSource = fs.readFileSync(new URL("../../components/WizardSteps.jsx", import.meta.url), "utf8");

describe("workspace interaction recovery wiring", () => {
  test("blocked workspace and catalog states expose executing recovery actions", () => {
    expect(appSource).toContain('onClick={handleRetryTenantResolution}');
    expect(appSource).toContain('href="https://mbmapps.com/contact"');
    expect(appSource).toContain('onClick={handleRefreshAccess}');
    expect(appSource).toContain("await authSession.refreshAccess()");
    expect(appSource).toContain('onClick={catalog.reload}>Retry Catalog');
    expect(appSource).toContain("Refresh Catalog Setup");
  });

  test("availability blocks expose schedule context and a correction path", () => {
    expect(appSource).toContain('className="warning-note availability-recovery"');
    expect(appSource).toContain('onClick={handleCorrectAvailability}');
    expect(appSource).toContain('onClick={() => setScheduleOpen(true)}');
    expect(appSource).toContain("Edit Date, Time, or Venue");
  });

  test("both event-hour controls store the same bounded value they display", () => {
    expect(wizardSource.match(/value=\{normalizeEventHours\(form\.hours\)\}/g)).toHaveLength(2);
    expect(wizardSource.match(/updateField\("hours", normalizeEventHours\(e\.target\.value\)\)/g)).toHaveLength(2);
  });

  test("menu selection is a focused prerequisite for advancing and saving", () => {
    expect(appSource).toContain("if (step === 2 && selectedMenuItemCount < 1)");
    expect(appSource).toContain("showMissingMenuSelection({ moveToMenuStep: true })");
    expect(appSource).toContain("Choose at least one menu item before continuing.");
    expect(appSource).toContain('ref={menuSelectionValidationRef}');
  });
});
