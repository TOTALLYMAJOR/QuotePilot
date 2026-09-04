import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const ENABLED = [
  "VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED",
  "VITE_AMBIENT_UI_ENABLED",
  "VITE_PILOT_NOW_ENABLED",
  "VITE_OPERATIONAL_STAFFING_ENABLED"
]
  .every((name) => ["1", "true", "yes", "on"].includes(
    String(process.env[name] || "").trim().toLowerCase()
  ));

test.skip(!ENABLED, "Calendar-first Operations requires the Ambient workspace graph.");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("ux-convergence-operations-seeded") === "true") return;
    localStorage.clear();
    sessionStorage.clear();
    const now = new Date();
    const target = new Date(now);
    target.setDate(now.getDate() + 2);
    const year = target.getFullYear();
    const month = String(target.getMonth() + 1).padStart(2, "0");
    const day = String(target.getDate()).padStart(2, "0");
    const date = `${year}-${month}-${day}`;
    const quote = (id, quoteNumber, time, guests, status = "booked") => ({
      id,
      organizationId: "e2e-org",
      quoteNumber,
      status,
      activeVersionId: "v0001",
      customer: { name: `${quoteNumber} Client`, email: `${id}@example.test` },
      event: {
        name: `${quoteNumber} Dinner`,
        date,
        time,
        hours: 4,
        guests,
        venue: "Operations Hall",
        style: "Buffet",
        servers: 4,
        chefs: 1,
        bartenders: 0
      },
      selection: { packageId: "basic", menuItems: ["salad"] },
      totals: { total: 3200, deposit: 800 },
      booking: {
        confirmationStatus: status === "booked" ? "confirmed" : "pending",
        staffLead: id === "operations-event-a" ? "Event Lead" : ""
      }
    });
    localStorage.setItem("quoteWizard.quotes", JSON.stringify([
      quote("operations-event-a", "Q-OPS-1", "17:00", 260),
      quote("operations-event-b", "Q-OPS-2", "18:00", 220, "accepted")
    ]));
    localStorage.setItem("ux-convergence-operations-seeded", "true");
  });
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1440, height: 1000 }
]) {
  test(`renders the same Calendar authority at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto("/app/operations");

    const operations = page.getByTestId("operations-calendar");
    await expect(operations).toBeVisible();
    await expect(operations).toHaveAttribute("data-operations-mode", "calendar-first");
    await expect(operations.getByRole("heading", { name: "Operations", exact: true })).toBeVisible();
    await expect(operations.getByRole("button", { name: "Month", exact: true })).toBeVisible();
    await expect(operations.getByRole("button", { name: "Week", exact: true })).toBeVisible();

    if (viewport.width === 390) {
      await expect(operations.getByTestId("operations-mobile-agenda")).toBeVisible();
      await expect(operations.locator(".schedule-desktop-calendar")).toBeHidden();
      await expect(operations.locator("[data-exact-event-id='operations-event-a']").first()).toBeVisible();
    } else {
      await expect(operations.getByTestId("operations-mobile-agenda")).toBeHidden();
      await expect(operations.locator(".schedule-desktop-calendar")).toBeVisible();
    }

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1))
      .toBe(true);
    const axe = await new AxeBuilder({ page })
      .include("[data-testid='operations-calendar']")
      .analyze();
    expect(axe.violations.filter((violation) => ["serious", "critical"].includes(violation.impact)))
      .toEqual([]);

    const evidenceSha = String(process.env.UX_EVIDENCE_SHA || "working-tree").slice(0, 12);
    const screenshotPath = testInfo.outputPath(`operations-${viewport.width}-${evidenceSha}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await testInfo.attach(`Calendar-first Operations ${viewport.width}px at ${evidenceSha}`, {
      path: screenshotPath,
      contentType: "image/png"
    });
  });
}

test("preserves exact Now to Calendar and Calendar to Opportunity handoffs", async ({ page }) => {
  await page.goto("/app");
  const calendarHandoff = page.getByRole("button", { name: "Open in Calendar", exact: true }).first();
  await expect(calendarHandoff).toBeVisible();
  await calendarHandoff.click();

  await expect(page).toHaveURL(/\/app\/operations$/);
  const operations = page.getByTestId("operations-calendar");
  const exactEvent = operations.locator("article.schedule-event-card").filter({ hasText: "Q-OPS-1" });
  await expect(exactEvent).toBeVisible();
  await expect(exactEvent).toBeFocused();
  await exactEvent.getByRole("button", { name: "Open opportunity", exact: true }).click();

  await expect(page).toHaveURL(/\/app\/quotes\/operations-event-a$/);
  await expect(page.getByRole("heading", { name: /Q-OPS-1 Dinner/ })).toBeVisible();
});

test("keeps daily Operations concise and preserves secondary tool reachability", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/app/operations");

  const primary = page.getByRole("navigation", { name: "Primary workspace" });
  await expect(primary.getByRole("button")).toHaveText([
    "Now",
    "Opportunities",
    "Operations",
    "Clients",
    "Library"
  ]);
  const primaryOperations = primary.getByRole("button", { name: "Operations", exact: true });
  await expect(primaryOperations).toHaveAttribute("aria-current", "page");
  await expect(primaryOperations).not.toHaveAttribute("aria-haspopup", "menu");

  const header = page.locator("header.site-header");
  await expect(header.getByRole("button", { name: "Operations", exact: true })).toHaveCount(1);
  await expect(page.getByRole("menu", { name: "Operations", exact: true })).toHaveCount(0);

  await header.getByRole("button", { name: "Workspace and tools", exact: true }).click();
  const tools = page.getByRole("dialog", { name: "Workspace & tools", exact: true });
  const frequent = tools.locator('[data-workspace-tools-group="frequent"]');
  const daily = tools.locator('[data-workspace-tools-group="operations"]');
  await expect(frequent.getByRole("button")).toHaveText([
    "Search customers and opportunities",
    "Workflow",
    "Messages",
    "Pilot"
  ]);
  await expect(daily.getByRole("button")).toHaveText(["Operations", "Clear the Deck", "Staff"]);
  const administrationToggle = tools.getByRole("button", { name: "Show administration tools", exact: true });
  await expect(administrationToggle).toHaveAttribute(
    "aria-expanded",
    "false"
  );
  await administrationToggle.click();
  await expect(tools.locator("#workspace-tools-administration-actions").getByRole("button")).toHaveText([
    "Reporting Dashboard",
    "Integrations Ops",
    "Import Studio",
    "Session Diagnostics"
  ]);
});

test("shows conflict evidence and persists staffing and checklist work", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/operations");

  const operations = page.getByTestId("operations-calendar");
  await operations.locator('[data-exact-event-id="operations-event-a"] button').first().click();
  const event = operations.locator('article[data-schedule-event-id="operations-event-a"]');
  await expect(event).toBeVisible();
  await expect(event.locator(".schedule-conflict-note")).toContainText("Time overlap");
  await expect(event.locator(".schedule-conflict-note")).toContainText("Capacity risk");

  await event.getByLabel("Staff lead").selectOption("Kitchen Lead");
  await expect(operations.getByText("Assigned Kitchen Lead.", { exact: true })).toBeVisible();
  await event.getByRole("checkbox", { name: /^Event brief reviewed/ }).check();
  await expect(operations.getByText(/Production checklist updated for Q-OPS-1/)).toBeVisible();
  await expect(event.getByRole("checkbox", { name: /^Event brief reviewed/ })).toBeChecked();

  const stored = await page.evaluate(() => {
    const quotes = JSON.parse(localStorage.getItem("quoteWizard.quotes") || "[]");
    const quote = quotes.find((item) => item.id === "operations-event-a");
    return {
      staffLead: quote?.booking?.staffLead || "",
      eventBriefCompleted: quote?.booking?.productionChecklist?.find((item) => item.id === "event-brief")?.completed === true
    };
  });
  expect(stored).toEqual({ staffLead: "Kitchen Lead", eventBriefCompleted: true });

  await page.reload();
  await operations.locator('[data-exact-event-id="operations-event-a"] button').first().click();
  await expect(event.getByLabel("Staff lead")).toHaveValue("Kitchen Lead");
  await expect(event.getByRole("checkbox", { name: /^Event brief reviewed/ })).toBeChecked();
});

test("preserves exact direct Event Focus and browser history continuity", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/events/operations-event-a");
  const eventFocus = page.locator(".live-ops-panel");
  await expect(eventFocus.locator(".eyebrow").filter({ hasText: /^Event Focus$/ })).toBeVisible();
  await expect(eventFocus.getByRole("heading", { name: "Q-OPS-1 Dinner", exact: true })).toBeVisible();
  await expect(eventFocus.getByRole("region", { name: "Event basics", exact: true })).toBeVisible();

  await page.goto("/app/operations");
  const operations = page.getByTestId("operations-calendar");
  const targetDay = operations.getByTestId("operations-mobile-agenda")
    .locator('[data-exact-event-id="operations-event-a"]')
    .getByRole("button");
  await targetDay.click();
  const event = operations.locator('article[data-schedule-event-id="operations-event-a"]');
  await event.getByRole("button", { name: "Open opportunity", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/quotes\/operations-event-a$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/app\/operations$/);
  await expect(page.getByTestId("operations-calendar")).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/\/app\/quotes\/operations-event-a$/);
  await expect(page.getByRole("heading", { name: /Q-OPS-1 Dinner/ })).toBeVisible();
});

test("keeps the Schedule compatibility route on the same Calendar capability", async ({ page }) => {
  await page.goto("/app/schedule");
  await expect(page.getByRole("region", { name: "Event Schedule" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Event Schedule", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Month", exact: true })).toBeVisible();
});

test("promotes Operations into the five primary destinations without a duplicate menu", async ({ page }) => {
  await page.goto("/app/operations");
  const primary = page.getByRole("navigation", { name: "Primary workspace" });
  await expect(primary.getByRole("button")).toHaveCount(5);
  await expect(primary.getByRole("button").allTextContents()).resolves.toEqual([
    "Now",
    "Opportunities",
    "Operations",
    "Clients",
    "Library"
  ]);
  await expect(primary.getByRole("button", { name: "Operations", exact: true }))
    .toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("menu", { name: "Operations", exact: true })).toHaveCount(0);
});
