import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const ENABLED = ["1", "true", "yes", "on"].includes(
  String(process.env.VITE_PROPOSAL_COMPOSER_ENABLED || "").trim().toLowerCase()
);

test.skip(!ENABLED, "Commercial Workbench requires the Proposal Composer graph.");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto("/app");
  await expect(page.getByTestId("proposal-composer")).toBeVisible();
});

async function openDomain(page, domain) {
  const trigger = page.getByTestId(`workbench-domain-${domain}`);
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-current", "step");
}

async function commitInline(page, label, value) {
  await page.getByRole("button", { name: `Change ${label}`, exact: true }).click();
  await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole("button", { name: "Apply change", exact: true }).click();
}

test("keeps one proposal object while switching among five presentation domains", async ({ page }) => {
  const plan = page.getByTestId("commercial-workbench-plan");
  await expect(plan).toBeVisible();
  for (const domain of ["event", "customer", "experience", "staffing", "commercials"]) {
    await expect(page.getByTestId(`workbench-domain-${domain}`)).toBeVisible();
  }

  await expect(page.getByTestId("workbench-domain-event")).toHaveAttribute("aria-current", "step");
  await expect(page.getByRole("button", { name: "Change Guests" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Change Client name" })).toBeHidden();

  await page.getByTestId("workbench-domain-customer").click();
  await expect(page.getByRole("button", { name: "Change Client name" })).toBeVisible();
  await page.getByRole("button", { name: "Change Client name" }).click();
  await page.getByLabel("Client name", { exact: true }).fill("Shared Draft Client");
  await page.getByRole("button", { name: "Apply change" }).click();

  await page.getByTestId("pc-guided-mode").click();
  await expect(page.locator(".wizard-panel")).toBeVisible();
  await expect(page.getByLabel(/Your name/i)).toHaveValue("Shared Draft Client");
  await page.getByRole("button", { name: "Composer view" }).click();
  await page.getByTestId("workbench-domain-customer").click();
  await expect(page.getByRole("button", { name: "Change Client name" })).toContainText("Shared Draft Client");
});

test("composes package, Menu, rentals, and enhancements inside Experience", async ({ page }) => {
  await page.getByTestId("workbench-domain-experience").click();
  await expect(page.getByRole("button", { name: /Change package or service style/ })).toBeVisible();
  await expect(page.getByTestId("pc-edit-menu")).toBeVisible();
  await expect(page.getByRole("button", { name: /Review rentals/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Add enhancement/ })).toBeVisible();
});

test("preserves Event and Menu work across domain switches and returns focus when Menu closes", async ({ page }) => {
  await commitInline(page, "Event name", "Continuity Dinner");
  await page.getByLabel("Event type", { exact: true }).selectOption({ index: 1 });

  await openDomain(page, "experience");
  const menuToggle = page.getByTestId("pc-edit-menu");
  await menuToggle.click();
  const menuEditor = page.getByTestId("pc-menu-editor");
  const firstChoice = menuEditor.locator(".pc-choice input[type='checkbox']").first();
  await firstChoice.check();
  const selectedName = await menuEditor.locator(".pc-choice-copy strong").first().textContent();

  await openDomain(page, "customer");
  await openDomain(page, "event");
  await expect(page.getByRole("button", { name: "Change Event name", exact: true }))
    .toContainText("Continuity Dinner");

  await openDomain(page, "experience");
  await expect(page.locator(".pc-menu-list")).toContainText(String(selectedName || "").trim());
  await menuToggle.click();
  await expect(menuEditor).toBeVisible();
  await expect(menuEditor.locator(".pc-choice input[type='checkbox']").first()).toBeChecked();
  await menuToggle.click();
  await expect(menuEditor).toHaveCount(0);
  await expect(menuToggle).toBeFocused();
  await expect(page.getByTestId("workbench-domain-experience")).toHaveAttribute("aria-current", "step");
});

test("keeps validation and canonical pricing attached to Event and Customer edits", async ({ page }) => {
  const total = page.getByTestId("pc-pulse-total");
  const totalBefore = await total.textContent();

  await commitInline(page, "Guests", "80");
  await expect(page.getByTestId("pc-consequences")).toContainText(/Total/);
  await expect(total).not.toHaveText(String(totalBefore || ""));
  await page.getByTestId("pc-consequences").getByRole("button", { name: "Undo guest change" }).click();
  await expect(total).toHaveText(String(totalBefore || ""));

  await openDomain(page, "customer");
  await page.getByRole("button", { name: "Change Email", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill("invalid-email");
  await page.getByRole("button", { name: "Apply change", exact: true }).click();
  await expect(page.getByText("Enter a valid email address.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
});

test("keeps recommendations explicit and preserves Rentals and Enhancements", async ({ page }) => {
  await commitInline(page, "Guests", "80");
  await page.getByTestId("pc-consequences").getByRole("button", { name: "Keep as quoted" }).click();

  await openDomain(page, "staffing");
  const recommendation = page.getByTestId("pc-staffing-recommendation");
  await expect(recommendation).toBeVisible();
  const servers = page.getByRole("button", { name: "Change Servers", exact: true });
  await expect(servers).toContainText("0 servers");
  await expect(recommendation).toContainText("Recommended");
  await expect(servers).toContainText("0 servers");

  await openDomain(page, "experience");
  const rentalsToggle = page.getByRole("button", { name: /Review rentals/ });
  await rentalsToggle.click();
  const rentalChoice = page.locator('[data-workbench-panel="experience"] .pc-choice input[type="checkbox"]').last();
  await rentalChoice.check();
  await expect(page.locator(".pc-rental-list")).toBeVisible();

  const enhancementsToggle = page.getByRole("button", { name: /Add enhancement/ });
  await enhancementsToggle.click();
  const enhancementChoice = page.locator(".pc-section").filter({ hasText: "Enhancements" })
    .locator(".pc-choice input[type='checkbox']").first();
  await enhancementChoice.click();
  await expect(page.locator(".pc-enhancement-list")).toBeVisible();
});

test("keeps Commercial truth and client preview attached to the proposal", async ({ page }) => {
  const truth = page.getByTestId("pc-pulse");
  await expect(truth).toHaveAttribute("data-commercial-truth", "true");
  await expect(truth).toContainText("Commercial truth");
  await expect(truth.getByTestId("pc-pulse-total")).toBeVisible();
  await expect(truth.getByTestId("commercial-truth-blockers")).toBeVisible();
  await truth.getByRole("button", { name: "Preview client view" }).click();
  await expect(page.getByTestId("pc-client-preview")).toBeVisible();
  await expect(page.getByTestId("pc-client-preview")).not.toContainText(/margin|blocker|staff-only/i);
});

test("labels unsaved Preview honestly, restores focus, and keeps advanced pricing collapsed", async ({ page }) => {
  await openDomain(page, "commercials");
  const advanced = page.locator("details.pc-advanced");
  await expect(advanced).not.toHaveAttribute("open", "");
  await advanced.locator("summary").click();
  await expect(advanced).toHaveAttribute("open", "");
  await expect(page.getByLabel("Tax region", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Season profile", { exact: true })).toBeVisible();

  const previewTrigger = page.locator(".pc-header-actions")
    .getByRole("button", { name: "Preview client view", exact: true });
  await previewTrigger.click();
  const preview = page.getByTestId("pc-client-preview");
  await expect(preview).toContainText("Draft preview");
  await expect(preview.getByRole("button", { name: "Close preview", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  await expect(previewTrigger).toBeFocused();
});

test("keeps scenario inspection isolated until the operator explicitly applies it", async ({ page }) => {
  const compareTrigger = page.locator(".pc-header-actions")
    .getByRole("button", { name: "Compare scenarios", exact: true });
  const guests = page.getByRole("button", { name: "Change Guests", exact: true });
  const originalGuests = await guests.textContent();

  await compareTrigger.click();
  const dialog = page.getByRole("dialog", { name: "Scenario Compare", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  await dialog.getByLabel("Guests", { exact: true }).fill("125");
  await expect(guests).toHaveText(String(originalGuests || ""));
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(compareTrigger).toBeFocused();
  await expect(guests).toHaveText(String(originalGuests || ""));

  await compareTrigger.click();
  await dialog.getByLabel("Guests", { exact: true }).fill("75");
  await dialog.getByRole("button", { name: "Use Custom Scenario", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(guests).toContainText("75");
});

test("keeps exact blockers on both save controls without creating a saved-success claim", async ({ page }) => {
  await commitInline(page, "Event name", "Blocked Draft Continuity");
  const pulseSave = page.getByTestId("pc-save");
  const headerSave = page.getByTestId("pc-save-header");
  const label = String(await pulseSave.textContent());
  const expectedCount = Number(label.match(/Review (\d+) blocker/)?.[1] || 0);
  expect(expectedCount).toBeGreaterThan(0);
  await expect(headerSave).toHaveText(label);

  await pulseSave.click();
  const readiness = page.getByTestId("pc-save-readiness");
  await expect(readiness).toBeFocused();
  await expect(readiness.getByTestId("pc-save-blocker")).toHaveCount(expectedCount);
  await expect(readiness).toContainText(/email/i);
  await expect(page.locator(".pc-save-state")).toHaveText("Unsaved changes");

  await headerSave.click();
  await expect(readiness.getByTestId("pc-save-blocker")).toHaveCount(expectedCount);
  await expect(page.getByRole("heading", { name: "Blocked Draft Continuity", exact: true })).toBeVisible();
  await expect(page.getByText(/Editing quote/i)).toHaveCount(0);
  await expect(page.locator(".pc-save-state")).toHaveAttribute("data-state", "dirty");
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1440, height: 1000 }
]) {
  test(`preserves the Workbench hierarchy at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await expect(page.getByTestId("commercial-workbench-plan")).toBeVisible();
    await expect(page.getByTestId("commercial-workbench-object")).toBeVisible();
    if (viewport.width <= 1080) {
      await expect(page.getByTestId("pc-pulse")).toBeHidden();
      await page.getByRole("button", { name: /Review quote/ }).click();
      await expect(page.getByTestId("pc-pulse")).toBeVisible();
    } else {
      await expect(page.getByTestId("pc-pulse")).toBeVisible();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1))
      .toBe(true);
    const axe = await new AxeBuilder({ page }).include(".proposal-composer").analyze();
    expect(axe.violations.filter((violation) => ["serious", "critical"].includes(violation.impact)))
      .toEqual([]);
  });
}
