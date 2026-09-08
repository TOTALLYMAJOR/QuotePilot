import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const enabled = ["1", "true", "yes", "on"].includes(String(process.env.VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED || "").toLowerCase())
  && ["1", "true", "yes", "on"].includes(String(process.env.VITE_AMBIENT_UI_ENABLED || "").toLowerCase());

const widths = [390, 768, 1440];

async function openPreflight(page) {
  await page.addInitScript(() => {
    const shared = {
      organizationId: "e2e-org",
      status: "booked",
      event: { date: "2027-09-12", time: "18:00", hours: 5, venue: "Magnolia House", guests: 96 },
      payment: { depositStatus: "paid", finalBalance: { status: "unpaid" } },
      booking: { productionChecklist: [{ id: "guest-count", completed: false }] }
    };
    localStorage.setItem("quoteWizard.quotes", JSON.stringify([
      {
        ...shared,
        id: "preflight-event",
        quoteNumber: "Q-PREFLIGHT",
        activeVersionId: "revision-5",
        acceptanceReceipt: { receiptId: "acceptance-4", quoteRevisionId: "revision-4", acceptedAtISO: "2026-09-01T12:00:00.000Z" },
        customer: { name: "Maya Bennett" },
        event: { ...shared.event, name: "Bennett Garden Wedding" }
      },
      {
        ...shared,
        id: "conflicting-event",
        quoteNumber: "Q-CONFLICT",
        activeVersionId: "revision-1",
        acceptanceReceipt: { receiptId: "acceptance-1", quoteRevisionId: "revision-1", acceptedAtISO: "2026-09-01T13:00:00.000Z" },
        customer: { name: "Second Client" },
        event: { ...shared.event, name: "Overlapping Dinner" }
      }
    ]));
  });
  await page.goto("/app");
  const setup = page.getByRole("heading", { name: "Bring Your Catalog to Life" });
  const shell = page.locator(".site-header");
  await expect(setup.or(shell)).toBeVisible({ timeout: 30_000 });
  if (await setup.isVisible()) await page.getByRole("button", { name: "Explore the workspace" }).click();
  await page.evaluate(() => {
    window.history.pushState(null, "", "/app/events/preflight-event/live");
    window.dispatchEvent(new Event("quotepilot:locationchange"));
  });
}

test.describe("QP-UXR-005 Event Preflight", () => {
  test.skip(!enabled, "Event Preflight requires the Ambient customer workspace.");

  for (const width of widths) {
    test(`${width}px separates satisfied, attention, and unavailable truth`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await openPreflight(page);

      const panel = page.locator("[data-event-preflight]");
      await expect(panel).toHaveAttribute("data-event-preflight", "attention");
      await expect(panel.getByRole("heading", { name: "Ready / satisfied facts" })).toBeVisible();
      await expect(panel.getByRole("heading", { name: "Needs attention" })).toBeVisible();
      await expect(panel.getByRole("heading", { name: "Unknown / unavailable" })).toBeVisible();
      await expect(panel).toContainText("Current revision is not the accepted revision");
      await expect(panel).toContainText("A schedule conflict is recorded");
      await expect(panel).toContainText("Inventory and equipment availability are not governed here");
      await expect(panel).toContainText("Actual attendance is not governed here");
      await expect(panel).toContainText("Kitchen BEO freshness is unavailable");
      await expect(panel).not.toContainText(/\d+%/);
      const next = page.getByLabel("Next valid action");
      await expect(next).toContainText("Open commercial truth");
      expect(await next.evaluate((node) => Boolean(
        node.compareDocumentPosition(document.querySelector(".execution-control-grid"))
          & Node.DOCUMENT_POSITION_FOLLOWING
      ))).toBe(true);

      const metrics = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth
      }));
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewport + 1);
      expect((await new AxeBuilder({ page }).include("main").analyze()).violations).toEqual([]);
      await page.screenshot({
        path: `output/playwright/event-preflight-current/preflight-${width}.png`,
        fullPage: true
      });
    });
  }
});
