import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

const REQUIRED_GATES = [
  process.env.VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED,
  process.env.VITE_AMBIENT_UI_ENABLED
].every((value) => ["1", "true", "yes", "on"].includes(
  String(value || "").trim().toLowerCase()
));
const CAPTURE_PROOF = ["1", "true", "yes", "on"].includes(
  String(process.env.CAPTURE_AMBIENT_BROWSER_PROOF || "").trim().toLowerCase()
);
const PROOF_DIRECTORY = "output/playwright/ambient-intelligence-current";
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1440, height: 1000 }
];

const OPPORTUNITIES = [
  {
    organizationId: "e2e-org",
    id: "opportunity-autumn",
    quoteNumber: "QP-AUTUMN",
    status: "draft",
    activeVersionId: "v0002",
    latestVersionNumber: 2,
    createdAtISO: "2026-08-10T12:00:00.000Z",
    updatedAtISO: "2026-08-11T18:00:00.000Z",
    customer: {
      name: "Maya Bennett",
      email: "maya@example.test",
      phone: "205-555-0184"
    },
    event: {
      name: "Autumn Benefit Dinner",
      date: "2026-09-19",
      time: "18:00",
      hours: 6,
      venue: "The Foundry Hall",
      style: "Plated",
      guests: 120,
      servers: 8,
      chefs: 3,
      bartenders: 0
    },
    selection: {
      eventTypeId: "benefit",
      packageId: "classic",
      packageName: "Classic",
      menuItems: ["herb-chicken"],
      menuItemNames: ["Herb Chicken"]
    },
    totals: { total: 8400, deposit: 2520 },
    booking: { confirmationStatus: "pending" },
    payment: { depositStatus: "unpaid", finalBalance: { status: "unpaid" } },
    lifecycle: { draftAtISO: "2026-08-10T12:00:00.000Z" }
  },
  {
    organizationId: "e2e-org",
    id: "opportunity-garden",
    quoteNumber: "QP-GARDEN",
    status: "accepted",
    activeVersionId: "v0004",
    latestVersionNumber: 4,
    createdAtISO: "2026-08-09T12:00:00.000Z",
    updatedAtISO: "2026-08-11T16:00:00.000Z",
    customer: {
      name: "Jordan Lee",
      email: "jordan@example.test",
      phone: "205-555-0172"
    },
    event: {
      name: "Garden Wedding",
      date: "2026-10-04",
      time: "17:30",
      hours: 5,
      venue: "Cedar Garden",
      style: "Buffet",
      guests: 88,
      servers: 5,
      chefs: 2,
      bartenders: 1
    },
    selection: {
      eventTypeId: "wedding",
      packageId: "garden",
      packageName: "Garden",
      menuItems: ["roasted-salmon"],
      menuItemNames: ["Roasted Salmon"]
    },
    totals: { total: 6750, deposit: 2025 },
    booking: { confirmationStatus: "pending" },
    payment: { depositStatus: "sent", finalBalance: { status: "unpaid" } },
    lifecycle: {
      sentAtISO: "2026-08-10T13:00:00.000Z",
      acceptedAtISO: "2026-08-11T15:00:00.000Z"
    }
  }
];

async function seedOpportunities(page) {
  await page.addInitScript((quotes) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("qp.workspaceSoundsEnabled", "false");
    localStorage.setItem("quoteWizard.quotes", JSON.stringify(quotes));
  }, OPPORTUNITIES);
}

test.describe("Ambient Opportunities stream", () => {
  test.skip(
    !REQUIRED_GATES,
    "The Opportunities proof requires the customer-centered workspace and default-off Ambient gate."
  );

  test.beforeEach(async ({ page }) => {
    await seedOpportunities(page);
  });

  for (const viewport of VIEWPORTS) {
    test(`stays contextual, accessible, and exact at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/app/quotes");

      const stream = page.locator(".ambient-opportunities");
      await expect(stream).toBeVisible({ timeout: 30_000 });
      await expect(stream.getByRole("heading", {
        name: "Every event, with its next move.",
        exact: true
      })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Opportunities", exact: true })).toHaveCount(0);
      await expect(stream.getByRole("heading", { name: "Current opportunities", exact: true }))
        .toHaveCount(0);
      await expect(stream.locator(".ambient-opportunity")).toHaveCount(2);
      await expect(stream.locator(".ambient-opportunity__primary-action")).toHaveCount(2);
      await expect(page.getByText("Quote administration", { exact: true })).toBeVisible();
      await expect(page.locator(".history-table-wrap")).toBeHidden();

      const undersized = await page.locator(
        ".ambient-opportunities button:visible, .ambient-opportunities details summary:visible, .ambient-opportunities-administration > summary:visible"
      ).evaluateAll((controls) => controls.map((control) => {
        const rect = control.getBoundingClientRect();
        return {
          label: control.getAttribute("aria-label") || control.textContent.trim(),
          width: rect.width,
          height: rect.height
        };
      }).filter(({ width, height }) => width < 44 || height < 44));
      expect(undersized).toEqual([]);
      expect(await page.evaluate(() => (
        document.documentElement.scrollWidth <= document.documentElement.clientWidth
      ))).toBe(true);
      expect(await stream.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

      const accessibility = await new AxeBuilder({ page })
        .include(".ambient-opportunities")
        .include(".ambient-opportunities-administration")
        .analyze();
      expect(accessibility.violations).toEqual([]);

      if (CAPTURE_PROOF) {
        mkdirSync(PROOF_DIRECTORY, { recursive: true });
        await page.evaluate(async () => {
          await document.fonts.ready;
          document.activeElement?.blur();
          window.scrollTo({ top: 0, left: 0, behavior: "instant" });
          await new Promise((resolve) => window.requestAnimationFrame(resolve));
        });
        await page.screenshot({
          path: `${PROOF_DIRECTORY}/ambient-opportunities-${viewport.width}.png`,
          animations: "disabled",
          fullPage: true
        });
      }

      const firstOpportunity = stream.locator('[data-opportunity-id="opportunity-autumn"]');
      await firstOpportunity.locator(".ambient-opportunity__primary-action").click();
      await expect(page).toHaveURL(/\/app\/quotes\/opportunity-autumn$/u);
      const livingOpportunity = page.locator('[data-quote-id="opportunity-autumn"].ambient-living-opportunity');
      await expect(livingOpportunity).toBeVisible({ timeout: 30_000 });
      await expect(livingOpportunity).toBeFocused();
      await expect(page.locator('[data-arrival-surface="living-opportunity"]'))
        .toHaveAttribute("data-arrival-state", "resolved");
      await expect(page.locator('[data-arrival-surface="living-opportunity"]'))
        .toContainText("Next step:");
    });
  }
});
