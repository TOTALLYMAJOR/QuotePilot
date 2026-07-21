import { expect, test } from "@playwright/test";

function parseMoney(text) {
  const normalized = String(text || "").replace(/[^0-9.-]/g, "");
  return Number(normalized || 0);
}

function historyDialogMessage(page, textPattern) {
  return page.getByRole("dialog").getByText(textPattern).first();
}

async function fillRequiredQuoteFields(page, {
  guests = 72,
  eventName = "E2E Launch Dinner",
  venue = "Birmingham Civic Hall",
  date = "2026-06-14"
} = {}) {
  const eventType = page.getByLabel(/Event type/i);
  if (await eventType.count()) {
    const optionCount = await eventType.locator("option").count();
    if (optionCount > 1) {
      await eventType.selectOption({ index: 1 });
    }
  }

  await page.getByLabel(/Event date/i).fill(date);
  await page.getByLabel(/Start time/i).fill("18:00");
  await page.getByRole("spinbutton", { name: /Event hours/i }).fill("4");
  await page.getByRole("spinbutton", { name: /Guests \(max 400\)/i }).fill(String(guests));
  await page.getByRole("textbox", { name: /Event name/i }).fill(eventName);
  await page.getByRole("textbox", { name: /Venue/i }).first().fill(venue);
  await page.getByRole("textbox", { name: /Venue address/i }).fill("123 Event Way, Birmingham, AL");
  await page.getByRole("textbox", { name: /Your name/i }).fill("E2E Staff");
  await page.getByRole("textbox", { name: /Phone/i }).fill("205-555-0184");
  await page.getByRole("textbox", { name: /Email/i }).fill("client@example.com");
}

async function advanceToSaveButton(page, saveButtonLabel) {
  for (let step = 0; step < 6; step += 1) {
    const packageTier = page.getByLabel("Package tier");
    if (await packageTier.count()) {
      await packageTier.selectOption("premium");
    }
    const travelMiles = page.getByLabel("Travel (round trip miles)");
    if (await travelMiles.count()) {
      await travelMiles.fill("28");
    }
    const depositLink = page.getByLabel("Deposit payment link (optional)");
    if (await depositLink.count()) {
      await depositLink.fill("https://pay.example.com/e2e-deposit");
    }

    const saveButton = page.getByRole("button", { name: saveButtonLabel });
    if (await saveButton.count()) {
      await expect(saveButton).toBeVisible();
      await saveButton.click();
      return;
    }

    const nextButton = page.getByRole("button", { name: "Next" });
    if (!(await nextButton.count())) {
      break;
    }
    await nextButton.click();
  }
  throw new Error(`Unable to reach save button: ${saveButtonLabel}`);
}

async function createQuoteToHistory(page, { guests = 72, eventName, venue, date } = {}) {
  await fillRequiredQuoteFields(page, { guests, eventName, venue, date });
  await advanceToSaveButton(page, "Save & Submit");

  const historyHeading = page.getByRole("heading", { name: "Quote History" });
  if (!(await historyHeading.isVisible())) {
    await page.getByRole("button", { name: "Quote History" }).click();
  }
  await expect(historyHeading).toBeVisible();
}

function quoteRows(page) {
  return page.locator(".history-table-wrap tbody tr").filter({
    has: page.getByRole("button", { name: "Copy Email" })
  });
}

async function setQuoteStatus(row, status) {
  const statusSelect = row.locator("select").first();
  await statusSelect.selectOption(status);
  await expect(statusSelect).toHaveValue(status);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto("/app");
  await expect(page.getByRole("button", { name: "Get Instant Quote" })).toBeVisible();
});

test("step 1 soft-lock keeps next disabled until required fields are complete", async ({ page }) => {
  const nextButton = page.getByRole("button", { name: "Next" });
  await expect(nextButton).toBeDisabled();
  await expect(page.getByText(/Missing required fields/i)).toBeVisible();

  await fillRequiredQuoteFields(page, { guests: 58, eventName: "E2E Soft Lock", venue: "Guidance Hall" });
  await expect(nextButton).toBeEnabled();
});

test("staffing overrides only show bartender rate fields when bartenders are above zero", async ({ page }) => {
  const staffingToggle = page.getByRole("button", { name: /Staffing Overrides/i });
  await staffingToggle.click();
  await expect(page.getByText(/Set bartenders above 0/i)).toBeVisible();
  await expect(page.getByLabel(/Bartender rate type/i)).toHaveCount(0);

  await page.getByRole("button", { name: /Increase Bartenders/i }).click();
  await page.getByRole("button", { name: /Increase Bartenders/i }).click();
  await expect(page.getByLabel(/Bartender rate type/i)).toBeVisible();
});

test("hero CTA remains available and returns workflow focus to step 1", async ({ page }) => {
  await fillRequiredQuoteFields(page, { guests: 64, eventName: "E2E Hero CTA", venue: "CTA Ballroom" });
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Customized Cuisine Menu")).toBeVisible();

  await page.getByRole("button", { name: "Get Instant Quote" }).click();
  await expect(page.getByText("Core Event Basics")).toBeVisible();
  await expect(page.getByRole("button", { name: "Next" })).toBeVisible();
});

test("live breakdown shows transient change cues when quote inputs update", async ({ page }) => {
  await fillRequiredQuoteFields(page, { guests: 52, eventName: "E2E Breakdown", venue: "Delta Center" });

  await page.getByRole("spinbutton", { name: /Guests \(max 400\)/i }).fill("96");
  const totalRow = page.locator('[data-row-key="total"]');
  await expect(totalRow).toHaveAttribute("data-changed", "true");
  await expect(totalRow.locator(".row-delta")).toBeVisible();
});

test("good better best scenarios can be compared and applied", async ({ page }) => {
  await fillRequiredQuoteFields(page, {
    guests: 96,
    eventName: "E2E Scenario Gala",
    venue: "Scenario Hall"
  });
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Compare Scenario" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Good", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Better", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Best", { exact: true })).toBeVisible();

  await dialog.getByRole("button", { name: "Compare Best" }).click();
  await dialog.getByRole("button", { name: "Use Best" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByLabel("Package tier")).toHaveValue("deluxe");
});

test("new quote flow allows edits before save and persists in history", async ({ page }) => {
  await fillRequiredQuoteFields(page, { guests: 60, eventName: "E2E Quote A", venue: "Hall A" });
  await page.getByRole("button", { name: "Next" }).click();

  const totalLocator = page.locator(".hero-card dd").first();
  const beforeTotal = parseMoney(await totalLocator.innerText());

  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("spinbutton", { name: /Guests \(max 400\)/i }).fill("110");
  await page.getByRole("button", { name: "Next" }).click();

  const afterTotal = parseMoney(await totalLocator.innerText());
  expect(afterTotal).toBeGreaterThan(beforeTotal);

  await advanceToSaveButton(page, "Save & Submit");

  await expect(page.getByText(/Quote .* saved to/i)).toBeVisible();
  const firstQuoteRow = page.locator(".history-table-wrap tbody tr").filter({
    has: page.getByRole("button", { name: "Copy Email" })
  }).first();
  await expect(firstQuoteRow).toContainText("E2E Staff");
  await expect(firstQuoteRow).toContainText("110");
});

test("quote history supports export and send actions", async ({ page }) => {
  await createQuoteToHistory(page, { guests: 84 });

  const firstQuoteRow = page.locator(".history-table-wrap tbody tr").filter({
    has: page.getByRole("button", { name: "Copy Email" })
  }).first();
  await expect(firstQuoteRow).toBeVisible();

  await firstQuoteRow.getByRole("button", { name: "Copy Email" }).click();
  await expect(historyDialogMessage(page, /Email copied/i)).toBeVisible();
  await expect(firstQuoteRow.getByRole("combobox").first()).toHaveValue("sent");

  const downloadPromise = page.waitForEvent("download");
  await firstQuoteRow.getByRole("button", { name: "PDF" }).click();
  const pdfDownload = await downloadPromise;
  expect(pdfDownload.suggestedFilename()).toMatch(/\.pdf$/i);

  await firstQuoteRow.getByRole("button", { name: "Copy Pay Link" }).click();
  await expect(historyDialogMessage(page, /Deposit link copied/i)).toBeVisible();
});

test("sales workflow persists a follow-up plan", async ({ page }) => {
  await createQuoteToHistory(page, {
    guests: 78,
    eventName: "E2E Follow-up Dinner",
    venue: "Follow-up Hall"
  });
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Sales Workflow" }).click();

  const workflow = page.getByRole("dialog");
  await expect(workflow.getByRole("heading", { name: "Sales Workflow" })).toBeVisible();
  await workflow.getByLabel("Due date").fill("2026-06-10");
  await workflow.getByLabel("Note").fill("Confirm final menu after tasting.");
  await workflow.getByRole("button", { name: "Save Follow-up" }).click();
  await expect(workflow.getByText(/Follow-up saved for/i)).toBeVisible();

  await workflow.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Sales Workflow" }).click();
  await expect(page.getByRole("dialog").getByLabel("Due date")).toHaveValue("2026-06-10");
  await expect(page.getByRole("dialog").getByLabel("Note")).toHaveValue("Confirm final menu after tasting.");
});

test("portal decision center records a customer change request", async ({ page }) => {
  await createQuoteToHistory(page, {
    guests: 88,
    eventName: "E2E Portal Decision",
    venue: "Decision Hall"
  });
  const portalKey = await page.evaluate(() => {
    const quotes = JSON.parse(localStorage.getItem("quoteWizard.quotes") || "[]");
    return quotes[0]?.portalKey || "";
  });
  expect(portalKey).toBeTruthy();

  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Customer Portal" }).click();
  await expect(page.getByRole("heading", { name: "Proposal Decision Center" })).toBeVisible();
  await page.getByPlaceholder("Paste your quote key").fill(portalKey);
  await page.getByRole("button", { name: "Open Proposal" }).click();
  await expect(page.getByRole("heading", {
    name: "E2E Portal Decision on June 14, 2026"
  })).toBeVisible();
  await page.getByRole("button", { name: "Request Changes" }).click();
  await page.getByLabel("Requested changes").fill("Please replace the entree with a vegetarian option.");
  await page.getByRole("button", { name: "Submit Decision" }).click();
  await expect(page.getByText("Changes requested", { exact: true })).toBeVisible();
  await expect(page.getByText(/current proposal remains unaccepted/i)).toBeVisible();
});

test("accepted event production checklist persists completion", async ({ page }) => {
  const now = new Date();
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("-");
  await createQuoteToHistory(page, {
    guests: 74,
    eventName: "E2E Production Event",
    venue: "Production Hall",
    date: today
  });

  const row = quoteRows(page).first();
  await setQuoteStatus(row, "sent");
  await setQuoteStatus(row, "accepted");
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Schedule" }).click();

  const schedule = page.getByRole("dialog");
  await expect(schedule.getByText("E2E Production Event")).toBeVisible();
  const eventBrief = schedule.getByLabel("Event brief reviewed");
  await eventBrief.check();
  await expect(schedule.getByText(/Production checklist updated for/i)).toBeVisible();

  await schedule.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Schedule" }).click();
  await expect(page.getByRole("dialog").getByLabel("Event brief reviewed")).toBeChecked();
});

test("create then edit keeps one quote row and reflects updated fields", async ({ page }) => {
  await createQuoteToHistory(page, { guests: 70 });

  const quoteRows = page.locator(".history-table-wrap tbody tr").filter({
    has: page.getByRole("button", { name: "Copy Email" })
  });
  await expect(quoteRows).toHaveCount(1);
  await expect(quoteRows.first()).toContainText("70");

  await quoteRows.first().getByRole("button", { name: "Edit" }).click();
  await expect(page.getByText(/Editing quote/i)).toBeVisible();

  await page.getByRole("spinbutton", { name: /Guests \(max 400\)/i }).fill("95");
  await advanceToSaveButton(page, "Save Changes");

  await expect(page.getByText(/updated in/i)).toBeVisible();
  await expect(quoteRows).toHaveCount(1);
  await expect(quoteRows.first()).toContainText("95");
});

test("accepted quote can be converted and confirmation lifecycle is trackable", async ({ page }) => {
  await createQuoteToHistory(page, {
    guests: 68,
    eventName: "E2E Booking Lifecycle",
    venue: "Lifecycle Ballroom"
  });

  const row = quoteRows(page).first();
  await expect(row).toBeVisible();

  await setQuoteStatus(row, "sent");
  await setQuoteStatus(row, "accepted");

  await row.getByRole("button", { name: "Convert" }).click();
  await expect(historyDialogMessage(page, /Converted .* to contract/i)).toBeVisible();
  await expect(row.locator("select").first()).toHaveValue("booked");

  const confirmationSelect = row.locator("td").nth(10).locator("select");
  await expect(confirmationSelect).toHaveValue("pending");

  await confirmationSelect.selectOption("sent");
  await expect(confirmationSelect).toHaveValue("sent");
  await expect(historyDialogMessage(page, /Confirmation marked sent/i)).toBeVisible();

  await row.getByRole("button", { name: "Confirm" }).click();
  await expect(confirmationSelect).toHaveValue("confirmed");
  await expect(historyDialogMessage(page, /Confirmation marked confirmed/i)).toBeVisible();
  await expect(row.getByRole("button", { name: "Confirm" })).toHaveCount(0);
});

test("conversion is blocked when another quote is already booked for same venue/date", async ({ page }) => {
  await createQuoteToHistory(page, {
    guests: 75,
    eventName: "E2E Contract Baseline",
    venue: "Conflict Pavilion"
  });

  const baselineRow = quoteRows(page).first();
  await expect(baselineRow).toBeVisible();

  await setQuoteStatus(baselineRow, "sent");
  await setQuoteStatus(baselineRow, "accepted");
  await baselineRow.getByRole("button", { name: "Convert" }).click();
  await expect(historyDialogMessage(page, /Converted .* to contract/i)).toBeVisible();
  await expect(baselineRow.locator("select").first()).toHaveValue("booked");

  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Get Instant Quote" }).click();

  await fillRequiredQuoteFields(page, {
    guests: 92,
    eventName: "E2E Contract Conflict",
    venue: "Conflict Pavilion"
  });
  await advanceToSaveButton(page, "Save & Submit");
  await expect(page.getByText(/Availability conflict: this date\/venue is already booked/i)).toBeVisible();

  const historyHeading = page.getByRole("heading", { name: "Quote History" });
  if (!(await historyHeading.isVisible())) {
    await page.getByRole("button", { name: "Quote History" }).click();
  }
  await expect(historyHeading).toBeVisible();

  const conflictRows = quoteRows(page);
  await expect(conflictRows).toHaveCount(1);
  await expect(conflictRows.first().locator("select").first()).toHaveValue("booked");
});
