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

    const saveButton = page.getByRole("button", { name: "Save draft" });
    if (await saveButton.count()) {
      await expect(saveButton).toBeVisible();
      await saveButton.click();
      return;
    }

    await page.getByRole("button", { name: "Next" }).click();
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
  await expect(page.getByText(/Signed in as .+ · sales/)).toBeVisible();

  await fillRequiredQuoteFields(page);
  await advanceToSave(page);

  const historyHeading = page.getByRole("heading", { name: "Quote History" });
  await expect(historyHeading).toBeVisible();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog).toContainText("Sales can prepare proposal artifacts");
  const handoff = dialog.locator(".saved-quote-handoff");
  await expect(handoff).toContainText(/Saved as a draft/i);
  await expect(handoff).toContainText(/has not been sent/i);
  await expect(handoff).toBeFocused();
  await expect(handoff).toHaveAttribute("aria-describedby", "saved-quote-handoff-description");
  await expect(handoff.getByRole("button", { name: "Download draft PDF" })).toBeVisible();
  await expect(handoff.getByRole("button", { name: "Copy customer portal link" })).toHaveCount(0);
  await expect(handoff.getByRole("button", { name: "Send quote email" })).toHaveCount(0);
  await expect(handoff.getByRole("button", { name: "Set up email in Integrations" })).toHaveCount(0);
  await expect(handoff).toContainText(/Customer portal sharing requires an active delivered status/i);
  const requestApprovalButton = handoff.getByRole("button", { name: "Request approval to send" });
  await expect(requestApprovalButton).toBeVisible();
  await requestApprovalButton.click();
  await expect(dialog.getByText(
    /Approval requested\. An admin will see it in Sales Workflow\./i
  )).toBeVisible();

  const row = dialog.locator(".history-table-wrap tbody tr").filter({
    has: page.getByRole("button", { name: "Copy Email" })
  }).first();
  await expect(row).toBeVisible();

  await expect(row.getByRole("button", { name: "Edit" })).toBeVisible();
  await expect(row.getByRole("button", { name: "Duplicate" })).toBeVisible();
  await expect(row.getByRole("button", { name: "PDF" })).toBeVisible();
  await expect(row.getByRole("button", { name: "Send Quote Email" })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Copy Email" })).toBeVisible();
  await expect(row.getByRole("button", { name: "Copy Portal" })).toBeDisabled();
  await expect(row.getByRole("button", { name: "Copy Portal" })).toHaveAttribute(
    "title",
    "Customer portal sharing requires an active delivered status and valid future expiry."
  );

  await row.getByRole("button", { name: "Copy Email" }).click();
  await expect(dialog.getByRole("status")).toContainText(/remains a draft/i);

  await expect(row.getByRole("button", { name: "Copy Pay Link" })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Create Stripe Link" })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Send Pay Request" })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Convert" })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Rotate Portal" })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Delete" })).toHaveCount(0);
  await expect(row.getByRole("combobox")).toHaveCount(0);

  const containment = await dialog.locator(".history-card").evaluate((card) => {
    const cardRect = card.getBoundingClientRect();
    const handoffRect = card.querySelector(".saved-quote-handoff")?.getBoundingClientRect();
    const actionRect = card.querySelector(".saved-quote-handoff-actions button")?.getBoundingClientRect();
    return {
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      cardLeft: cardRect.left,
      cardRight: cardRect.right,
      handoffLeft: handoffRect?.left ?? -1,
      handoffRight: handoffRect?.right ?? -1,
      actionLeft: actionRect?.left ?? -1,
      actionRight: actionRect?.right ?? -1
    };
  });
  expect(containment.documentWidth).toBeLessThanOrEqual(containment.viewportWidth);
  expect(containment.cardLeft).toBeGreaterThanOrEqual(-1);
  expect(containment.cardRight).toBeLessThanOrEqual(containment.viewportWidth + 1);
  expect(containment.handoffLeft).toBeGreaterThanOrEqual(-1);
  expect(containment.handoffRight).toBeLessThanOrEqual(containment.viewportWidth + 1);
  expect(containment.actionLeft).toBeGreaterThanOrEqual(-1);
  expect(containment.actionRight).toBeLessThanOrEqual(containment.viewportWidth + 1);
});
