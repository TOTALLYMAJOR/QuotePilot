import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

const CAPTURE_PROOF = ["1", "true", "yes", "on"].includes(
  String(process.env.CAPTURE_STEWARD_BROWSER_PROOF || "").trim().toLowerCase()
);
const PROOF_DIRECTORY = "output/playwright/steward-workbench";
const QUOTE_ID = "steward-workbench-proof-quote";
const VIEWPORTS = [
  { label: "desktop", width: 1440, height: 1000 },
  { label: "mobile", width: 390, height: 844 }
];

const QUOTE = {
  id: QUOTE_ID,
  organizationId: "e2e-org",
  quoteNumber: "QP-STW-101",
  eventName: "Steward Review Dinner",
  customerName: "Review Customer",
  venue: "Garden Hall",
  eventDate: "2026-10-18",
  eventTime: "6:00 PM",
  guestCount: 120,
  status: "Draft",
  total: 14850,
  updatedAtISO: "2026-08-21T05:50:00.000Z",
  menuItems: [{
    id: "seasonal-supper",
    name: "Seasonal supper",
    category: "Dinner",
    quantity: 120,
    unitPrice: 75
  }],
  activity: [{
    id: "saved",
    label: "Quote saved",
    actor: "Owner",
    at: "2026-08-21T05:50:00.000Z"
  }]
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ quote }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("quoteWizard.quotes", JSON.stringify([quote]));
    localStorage.setItem("quoteWizard.quotes.e2e-org", JSON.stringify([quote]));
  }, { quote: QUOTE });
});

for (const viewport of VIEWPORTS) {
  test(`keeps Steward truthful and bounded at ${viewport.label} width`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(`/app/quote-workspace?quoteId=${QUOTE_ID}`);

    const workbench = page.locator('[data-capability-id="steward-difficult-question-workbench"]');
    await expect(workbench).toBeVisible();
    await expect(workbench).toHaveAttribute("data-steward-state", "provider_unavailable");
    await expect(workbench.getByRole("heading", { name: "Difficult Question Desk" })).toBeVisible();
    await expect(workbench.getByText("Steward is unavailable; quoting is not")).toBeVisible();
    await expect(workbench.getByRole("button", { name: "Steward handoff unavailable" })).toBeDisabled();
    await expect(workbench.getByRole("button", { name: "Open manual message" })).toBeEnabled();
    await expect(workbench.getByText("No changes made")).toBeVisible();

    const geometry = await workbench.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const buttons = [...element.querySelectorAll("button")].map((button) => {
        const buttonRect = button.getBoundingClientRect();
        return { width: buttonRect.width, height: buttonRect.height };
      });
      return {
        left: rect.left,
        right: rect.right,
        width: rect.width,
        viewportWidth: document.documentElement.clientWidth,
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        buttons
      };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.width).toBeGreaterThan(250);
    expect(geometry.documentOverflow).toBeLessThanOrEqual(1);
    expect(geometry.buttons.every((button) => button.width >= 44 && button.height >= 44)).toBe(true);

    if (CAPTURE_PROOF) {
      mkdirSync(PROOF_DIRECTORY, { recursive: true });
      await page.screenshot({
        path: `${PROOF_DIRECTORY}/steward-workbench-${viewport.width}x${viewport.height}.png`,
        fullPage: true
      });
    }
  });
}

test("keeps the ordinary message workflow available", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/app/quote-workspace?quoteId=${QUOTE_ID}`);
  const workbench = page.locator('[data-capability-id="steward-difficult-question-workbench"]');

  await workbench.getByRole("button", { name: "Open manual message" }).click();

  await expect(page).toHaveURL(new RegExp(`/app/messages\\?quoteId=${QUOTE_ID}`));
});
