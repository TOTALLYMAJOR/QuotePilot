import { expect, test } from "@playwright/test";

const STAFF_EMAIL = process.env.E2E_FIREBASE_EMAIL || "e2e-admin@local.test";
const STAFF_PASSWORD = process.env.E2E_FIREBASE_PASSWORD || "Passw0rd!";

async function signInAsStaff(page) {
  await page.goto("/app");
  const signInHeading = page.getByRole("heading", { name: "Staff Sign In" });
  if (await signInHeading.count()) {
    await expect(signInHeading).toBeVisible();
    await page.getByLabel(/^Email$/i).fill(STAFF_EMAIL);
    await page.getByLabel(/^Password$/i).fill(STAFF_PASSWORD);
    await page.locator(".auth-actions").getByRole("button", { name: "Sign In" }).click();
  }
  await expect(page.getByRole("button", { name: "Get Instant Quote" })).toBeVisible({ timeout: 45_000 });
}

async function fillRequiredQuoteFields(page) {
  const eventType = page.getByLabel(/Event type/i);
  const optionCount = await eventType.locator("option").count();
  if (optionCount > 1) {
    await eventType.selectOption({ index: 1 });
  }

  await page.getByLabel(/Event date/i).fill("2026-09-12");
  await page.getByLabel(/Start time/i).fill("19:00");
  await page.getByRole("spinbutton", { name: /Event hours/i }).fill("5");
  await page.getByRole("spinbutton", { name: /Guests \(max 400\)/i }).fill("96");
  await page.getByRole("textbox", { name: /Event name/i }).fill("Authoritative Pricing E2E");
  await page.getByRole("textbox", { name: /Venue/i }).first().fill("Birmingham Authority Hall");
  await page.getByRole("textbox", { name: /Venue address/i }).fill("500 Authority Ave, Birmingham, AL");
  await page.getByRole("textbox", { name: /Your name/i }).fill("E2E Admin");
  await page.getByRole("textbox", { name: /Phone/i }).fill("205-555-0196");
  await page.getByRole("textbox", { name: /Email/i }).fill("client@example.com");
}

async function advanceToSave(page, saveLabel = "Save & Submit") {
  for (let i = 0; i < 6; i += 1) {
    const saveButton = page.getByRole("button", { name: saveLabel });
    if (await saveButton.count()) {
      await expect(saveButton).toBeVisible();
      await saveButton.click();
      return;
    }

    const nextButton = page.getByRole("button", { name: "Next" });
    if (!(await nextButton.count())) break;
    await nextButton.click();
  }

  throw new Error(`Unable to reach ${saveLabel}`);
}

test("firebase authoritative pricing callable is required for save flow", async ({ page }) => {
  test.setTimeout(120_000);
  await signInAsStaff(page);
  await fillRequiredQuoteFields(page);
  await advanceToSave(page, "Save & Submit");

  const historyHeading = page.getByRole("heading", { name: "Quote History" });
  if (!(await historyHeading.isVisible())) {
    await page.getByRole("button", { name: "Quote History" }).click();
  }
  await expect(historyHeading).toBeVisible({ timeout: 45_000 });

  const rows = page.locator(".history-table-wrap tbody tr").filter({
    has: page.getByRole("button", { name: "Copy Email" })
  });
  const refreshButton = page.getByRole("button", { name: "Refresh" });
  await expect.poll(async () => {
    if (await refreshButton.isVisible() && await refreshButton.isEnabled()) {
      await refreshButton.click();
    }
    return await rows.filter({ hasText: "96" }).count();
  }, { timeout: 90_000 }).toBeGreaterThan(0);

  await expect(page.getByText(/Failed to calculate authoritative quote pricing/i)).toHaveCount(0);
});
