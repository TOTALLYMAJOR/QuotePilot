import fs from "node:fs";
import { describe, expect, test } from "vitest";

const APP_SOURCE = fs.readFileSync(new URL("../../App.jsx", import.meta.url), "utf8");
const QUOTE_HISTORY_SOURCE = fs.readFileSync(
  new URL("../../components/QuoteHistoryModal.jsx", import.meta.url),
  "utf8"
);
const EVENT_PLANNING_SOURCE = fs.readFileSync(
  new URL("../../components/LiveOperationsPlanningViews.jsx", import.meta.url),
  "utf8"
);

describe("Calendar capability integration", () => {
  test("gates the canonical Operations route and contextual arrivals with eventSchedule", () => {
    expect(APP_SOURCE).toMatch(
      /CUSTOMER_CENTERED_WORKSPACE_ENABLED\s*&& eventScheduleEnabled\s*&& resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS\.OPERATIONS/
    );
    expect(APP_SOURCE).toMatch(/onOperations: eventScheduleEnabled\s*\?/);
    expect(APP_SOURCE).toMatch(/onOpenCalendar=\{eventScheduleEnabled\s*\?/);
    expect(APP_SOURCE).toMatch(/onOpenOperations=\{eventScheduleEnabled\s*\?/);
    expect(QUOTE_HISTORY_SOURCE).toContain(
      'onOpenCalendar={scheduleAvailable && typeof onOpenSchedule === "function"'
    );
    expect(EVENT_PLANNING_SOURCE).toContain(
      'typeof onOpenOperations === "function"'
    );
  });

  test("keeps Reporting and Calendar as independent tenant capabilities", () => {
    expect(APP_SOURCE).toMatch(/onOpenReporting=\{dashboardEnabled\s*\?/);
    expect(APP_SOURCE).toContain("enabled: eventScheduleEnabled");
    expect(APP_SOURCE).toContain("enabled: dashboardEnabled");
  });
});
