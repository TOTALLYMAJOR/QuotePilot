import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const FLAG_VALUES = ["1", "true", "yes", "on"];
const ENABLED = FLAG_VALUES.includes(
  String(process.env.VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED || "").trim().toLowerCase()
) && FLAG_VALUES.includes(
  String(process.env.VITE_AMBIENT_UI_ENABLED || "").trim().toLowerCase()
);

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 1000 }
];

async function seedCommittedEvent(page) {
  await page.addInitScript(() => {
    localStorage.setItem("quoteWizard.quotes", JSON.stringify([{
      id: "uxr004-event",
      organizationId: "e2e-org",
      quoteNumber: "Q-UXR-004",
      status: "booked",
      activeVersionId: "version-uxr004-3",
      latestVersionNumber: 3,
      createdAtISO: "2026-08-20T14:00:00.000Z",
      updatedAtISO: "2026-09-07T18:00:00.000Z",
      customer: { name: "Maya Bennett", email: "maya@example.test" },
      event: {
        name: "Bennett Garden Wedding",
        date: "2027-09-12",
        time: "18:00",
        hours: 5,
        venue: "Magnolia House",
        venueAddress: "24 Garden Lane",
        guests: 96,
        style: "Plated",
        servers: 5,
        chefs: 2,
        bartenders: 1
      },
      selection: {
        packageId: "garden-dinner",
        packageName: "Garden Dinner",
        menuItems: ["herb-chicken"],
        menuItemNames: ["Herb chicken"],
        addons: [],
        rentals: ["chairs"],
        rentalQuantities: { chairs: 96 }
      },
      totals: { total: 12840, deposit: 3852 },
      payment: {
        depositStatus: "paid",
        depositConfirmedAtISO: "2026-08-26T17:00:00.000Z",
        finalBalance: {
          amountCents: 898800,
          status: "paid",
          confirmedAtISO: "2026-09-01T16:00:00.000Z"
        }
      },
      acceptanceReceipt: {
        receiptId: "acceptance-uxr004",
        quoteRevisionId: "version-uxr004-3",
        acceptedAtISO: "2026-08-25T15:30:00.000Z"
      },
      lifecycle: {
        acceptedAtISO: "2026-08-25T15:30:00.000Z",
        bookedAtISO: "2026-08-26T16:00:00.000Z"
      },
      booking: {
        staffLead: "Jordan Lee",
        contractNumber: "C-UXR-004",
        bookedAtISO: "2026-08-26T16:00:00.000Z",
        productionChecklist: [{
          id: "event-brief",
          completed: true,
          completedAtISO: "2026-09-07T17:30:00.000Z",
          completedByEmail: "ops@example.test"
        }]
      }
    }]));
  });
}

async function openWorkspace(page, path) {
  await page.goto("/app");
  const setup = page.getByRole("heading", { name: "Bring Your Catalog to Life" });
  const shell = page.locator(".site-header");
  await expect(setup.or(shell)).toBeVisible({ timeout: 30_000 });
  if (await setup.isVisible()) {
    await page.getByRole("button", { name: "Explore the workspace" }).click();
  }
  await expect(shell).toBeVisible({ timeout: 30_000 });
  if (path !== "/app") {
    await page.evaluate((destination) => {
      window.history.pushState(null, "", destination);
      window.dispatchEvent(new Event("quotepilot:locationchange"));
    }, path);
  }
}

async function expectResponsiveContract(page) {
  const metrics = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    smallActions: [...document.querySelectorAll("main button")]
      .filter((button) => {
        const box = button.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.height < 44;
      })
      .map((button) => ({ label: button.textContent?.trim(), height: button.getBoundingClientRect().height }))
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewport + 1);
  expect(metrics.smallActions).toEqual([]);
}

test.describe("QP-UXR-004 commitment-to-execution loop", () => {
  test.skip(!ENABLED, "The commitment-to-execution contract runs with the Ambient customer workspace enabled.");

  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px preserves commitment, coordination, evidence boundary, and focus`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await seedCommittedEvent(page);
      await openWorkspace(page, "/app/events");

      const eventsHeading = page.getByRole("heading", { name: "Accepted and booked events", level: 1 });
      await expect(eventsHeading).toBeVisible();
      await expect(eventsHeading).toBeFocused();
      const row = page.getByRole("listitem").filter({ hasText: "Bennett Garden Wedding" });
      await expect(row).toContainText("Q-UXR-004");
      await expect(row).toContainText("$12,840.00");
      await expect(row).toContainText("Deposit paid");
      let results = await new AxeBuilder({ page }).include("main").analyze();
      expect(results.violations).toEqual([]);
      await page.screenshot({
        path: `output/playwright/commitment-execution-current/events-${viewport.width}.png`,
        fullPage: true
      });
      await row.getByRole("button", { name: "Event Focus" }).click();

      await expect(page).toHaveURL(/\/app\/events\/uxr004-event$/);
      const focusHeading = page.getByRole("heading", { name: "Bennett Garden Wedding", level: 1 });
      await expect(focusHeading).toBeFocused();
      const focus = page.locator('[data-execution-surface="event-focus"]');
      await expect(focus).toContainText("Current commitment");
      await expect(focus).toContainText("Saved total");
      await expect(focus).toContainText("The day as currently recorded");
      await expect(focus).toContainText("Version 3");
      await expect(focus).toContainText("24 Garden Lane");
      results = await new AxeBuilder({ page }).include("main").analyze();
      expect(results.violations).toEqual([]);
      await page.screenshot({
        path: `output/playwright/commitment-execution-current/event-focus-${viewport.width}.png`,
        fullPage: true
      });
      await focus.getByRole("button", { name: "Enter Control Room" }).click();

      await expect(page).toHaveURL(/\/app\/events\/uxr004-event\/live$/);
      const controlHeading = page.getByRole("heading", { name: "Bennett Garden Wedding", level: 1 });
      await expect(controlHeading).toBeFocused();
      const control = page.locator('[data-execution-surface="control-room"]');
      await expect(control).toContainText("Planning view only");
      await expect(control).toContainText("Planned sequence");
      await expect(control).toContainText("Recorded checklist");
      await expect(control).toContainText("Live actuals are not recorded");
      await expect(control.getByLabel("Next valid action")).toContainText("Open exact event in Schedule");
      await expect(control).toContainText("Operational staffing coverage is unavailable");
      await expect(control).toContainText("Kitchen BEO freshness is unavailable");
      await expectResponsiveContract(page);

      results = await new AxeBuilder({ page }).include("main").analyze();
      expect(results.violations).toEqual([]);
      await page.screenshot({
        path: `output/playwright/commitment-execution-current/control-room-${viewport.width}.png`,
        fullPage: true
      });

      await control.getByRole("button", { name: "Open exact event in Schedule" }).click();
      await expect(page).toHaveURL(/\/app\/operations$/);
      const exactScheduleEvent = page.locator('[data-schedule-event-id="uxr004-event"]');
      await expect(exactScheduleEvent).toBeFocused();
      await expect.poll(async () => exactScheduleEvent.evaluate((element) => {
        const target = element.getBoundingClientRect();
        const nav = document.querySelector(".ambient-primary-navigation");
        const navRect = nav?.getBoundingClientRect();
        const navTop = navRect && navRect.height > 0 && navRect.top > window.innerHeight / 2
          ? navRect.top
          : window.innerHeight;
        return target.bottom > 0 && target.top < navTop - 1;
      })).toBe(true);
      await page.goBack();
      await expect(page).toHaveURL(/\/app\/events\/uxr004-event\/live$/);

      await page.getByRole("button", { name: "Back to Event Focus" }).click();
      await expect(page).toHaveURL(/\/app\/events\/uxr004-event$/);
      await expect(page.getByRole("heading", { name: "Bennett Garden Wedding", level: 1 })).toBeFocused();

      await page.evaluate(() => {
        window.history.pushState(null, "", "/app/events/uxr004-event/replay");
        window.dispatchEvent(new Event("quotepilot:locationchange"));
      });
      const replay = page.locator('[data-execution-surface="replay"]');
      await expect(replay).toContainText("Execution replay is not established");
      await expect(replay.getByText("Supporting record evidence", { exact: true })).toBeVisible();
      await expect(replay).toContainText("not a complete or immutable execution chronology");
      await expectResponsiveContract(page);
    });
  }
});
