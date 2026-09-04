import { expect, test } from "@playwright/test";

async function fillRequiredQuoteFields(page) {
  const eventDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const eventType = page.getByLabel(/Event type/i);
  await expect(eventType).toBeVisible();
  await eventType.selectOption({ index: 1 });
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
    const firstMenuChoice = page.locator(
      ".wizard-panel .menu-library input[type='checkbox']:not(:checked)"
    ).first();
    if (await firstMenuChoice.count()) {
      await firstMenuChoice.check();
    }

    const packageTier = page.getByLabel("Package tier");
    if (await packageTier.count()) {
      await packageTier.selectOption("premium");
    }

    const depositLink = page.getByLabel("Deposit payment link (optional)");
    if (await depositLink.count()) {
      await depositLink.fill("https://checkout.stripe.com/c/pay/cs_test_sales_review");
    }

    const saveButton = page.getByRole("button", { name: "Save draft" });
    if (await saveButton.count()) {
      await expect(saveButton).toBeVisible();
      await saveButton.click();
      return;
    }

    await page.getByRole("button", { name: /^Next:/ }).click();
  }

  throw new Error("Unable to reach Save draft");
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
});

test("sales quote history preserves proposal actions and hides payment and booking authority controls", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/app");
  await page.getByRole("button", { name: "More" }).click();
  const moreMenu = page.getByRole("menu", { name: "More" });
  await expect(moreMenu).toContainText("sales");
  await page.keyboard.press("Escape");

  await fillRequiredQuoteFields(page);
  await advanceToSave(page);

  const workspace = page.getByTestId("quote-workspace");
  await expect(workspace).toBeVisible();
  await expect(page).toHaveURL(/\/app\/quotes\/[^/?#]+$/);
  await expect(workspace.getByRole("heading", { name: /Sales Role Review/ })).toBeVisible();
  await expect(workspace.getByText("Saved workspace", { exact: true })).toBeVisible();
  await expect(workspace.getByText("72 guests", { exact: true })).toBeVisible();
  const workspaceContainment = await workspace.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      left: rect.left,
      right: rect.right
    };
  });
  expect(workspaceContainment.documentWidth).toBeLessThanOrEqual(workspaceContainment.viewportWidth);
  expect(workspaceContainment.left).toBeGreaterThanOrEqual(-1);
  expect(workspaceContainment.right).toBeLessThanOrEqual(workspaceContainment.viewportWidth + 1);

  await workspace.getByRole("button", { name: "Back to opportunities" }).click();
  const historyHeading = page.getByRole("heading", { name: "Quotes" });
  await expect(historyHeading).toBeVisible();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog).toContainText("Sales can prepare proposal artifacts");

  const row = dialog.locator(".history-table-wrap tbody tr").filter({
    has: page.getByRole("button", { name: "Copy email text" })
  }).first();
  await expect(row).toBeVisible();

  await expect(row.getByRole("button", { name: "Edit draft" })).toBeVisible();
  const more = row.locator("details.configured-quote-more-actions");
  await more.locator("summary").click();
  await expect(row.getByRole("button", { name: "Create alternate draft" })).toBeVisible();
  await expect(row.getByRole("button", { name: "PDF" })).toBeVisible();
  await expect(row.getByRole("button", { name: "Send proposal" })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Copy email text" })).toBeVisible();
  await expect(row.getByRole("button", { name: "Copy customer link" })).toBeDisabled();
  await expect(row.getByRole("button", { name: "Copy customer link" })).toHaveAttribute(
    "title",
    "Customer portal sharing requires an active delivered status and valid future expiry."
  );

  await row.getByRole("button", { name: "Copy email text" }).click();
  await expect(dialog.getByText(/remains a draft/i).first()).toBeVisible();

  await expect(row.getByRole("button", { name: "Copy Pay Link" })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Create Stripe Link" })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Request deposit" })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Create contract" })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Renew customer link" })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Delete" })).toHaveCount(0);
  await expect(row.getByRole("combobox")).toHaveCount(0);

  const containment = await dialog.locator(".history-card").evaluate((card) => {
    const cardRect = card.getBoundingClientRect();
    return {
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      cardLeft: cardRect.left,
      cardRight: cardRect.right
    };
  });
  expect(containment.documentWidth).toBeLessThanOrEqual(containment.viewportWidth);
  expect(containment.cardLeft).toBeGreaterThanOrEqual(-1);
  expect(containment.cardRight).toBeLessThanOrEqual(containment.viewportWidth + 1);
});
