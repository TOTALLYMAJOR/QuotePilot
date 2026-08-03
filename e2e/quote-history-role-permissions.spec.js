import { expect, test } from "@playwright/test";

async function fillRequiredQuoteFields(page) {
  const eventDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await page.getByLabel(/Event date/i).fill(eventDate);
  await page.getByLabel(/Start time/i).fill("18:00");
  await page.getByRole("spinbutton", { name: /Event hours/i }).fill("4");
  await page.getByRole("spinbutton", { name: /Guests \(max 400\)/i }).fill("72");
  await page.getByRole("textbox", { name: /Event name/i }).fill("Sales Role Review");
  await page.getByRole("textbox", { name: /Venue/i }).first().fill("Birmingham Civic Hall");
  await page.getByRole("textbox", { name: /Venue address/i }).fill("123 Event Way, Birmingham, AL");
  await page.getByRole("textbox", { name: /Your name/i }).fill("Sales Staff");
  await page.getByRole("textbox", { name: /Phone/i }).fill("205-555-0184");
  await page.getByRole("textbox", { name: /Email/i }).fill("client@example.com");
}

async function advanceToSave(page) {
  for (let step = 0; step < 6; step += 1) {
    const packageTier = page.getByLabel("Package tier");
    if (await packageTier.count()) {
      await packageTier.selectOption("premium");
    }

    const depositLink = page.getByLabel("Deposit payment link (optional)");
    if (await depositLink.count()) {
      await depositLink.fill("https://checkout.stripe.com/c/pay/cs_test_sales_review");
    }

    const saveButton = page.getByRole("button", { name: "Save & Submit" });
    if (await saveButton.count()) {
      await expect(saveButton).toBeVisible();
      await saveButton.click();
      return;
    }

    await page.getByRole("button", { name: "Next" }).click();
  }

  throw new Error("Unable to reach Save & Submit");
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
});

test("sales quote history preserves proposal actions and hides payment and booking authority controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app");
  await expect(page.getByText("Role: sales")).toBeVisible();

  await fillRequiredQuoteFields(page);
  await advanceToSave(page);
  await expect(page.getByText(/Quote .* saved to/i)).toBeVisible();

  const historyHeading = page.getByRole("heading", { name: "Quote History" });
  await expect(historyHeading).toBeVisible();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog).toContainText("Sales can prepare proposal artifacts");

  const row = dialog.locator(".history-table-wrap tbody tr").filter({
    has: page.getByRole("button", { name: "Copy Email" })
  }).first();
  await expect(row).toBeVisible();

  await expect(row.getByRole("button", { name: "Edit" })).toBeVisible();
  await expect(row.getByRole("button", { name: "Duplicate" })).toBeVisible();
  await expect(row.getByRole("button", { name: "PDF" })).toBeVisible();
  await expect(row.getByRole("button", { name: "Send Quote Email" })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Copy Email" })).toBeVisible();
  await expect(row.getByRole("button", { name: "Copy Portal" })).toBeVisible();

  await expect(row.getByRole("button", { name: "Copy Pay Link" })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Create Stripe Link" })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Send Pay Request" })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Convert" })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Rotate Portal" })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Delete" })).toHaveCount(0);
  await expect(row.getByRole("combobox")).toHaveCount(0);

  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(hasHorizontalOverflow).toBe(false);
});
