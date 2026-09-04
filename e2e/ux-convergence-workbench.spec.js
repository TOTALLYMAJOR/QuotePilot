import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const ENABLED = ["1", "true", "yes", "on"].includes(
  String(process.env.VITE_PROPOSAL_COMPOSER_ENABLED || "").trim().toLowerCase()
);
const MARGINS_ENABLED = ["1", "true", "yes", "on"].includes(
  String(process.env.VITE_PILOT_MARGINS_ENABLED || "").trim().toLowerCase()
);
const PILOT_ENABLED = ["1", "true", "yes", "on"].includes(
  String(process.env.VITE_PILOT_COMMAND_ENABLED || "").trim().toLowerCase()
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

async function completeSavableDraft(page) {
  await page.getByLabel("Event type", { exact: true }).selectOption({ index: 1 });
  await commitInline(page, "Event name", "Persistence Boundary Dinner");
  await commitInline(page, "Date", "2027-10-18");
  await commitInline(page, "Guests", "60");
  await page.getByTestId("pc-consequences").getByRole("button", { name: "Keep as quoted" }).click();
  await commitInline(page, "Venue", "Evidence Hall");
  await openDomain(page, "customer");
  await commitInline(page, "Client name", "Boundary Client");
  await commitInline(page, "Email", "boundary@example.test");
  await openDomain(page, "experience");
  await page.getByTestId("pc-edit-menu").click();
  await page.getByTestId("pc-menu-editor")
    .locator(".pc-choice input[type='checkbox']").first().check();
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
  const emailError = page.getByText("Enter a valid email address.", { exact: true });
  await expect(emailError).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toHaveAttribute("aria-describedby", await emailError.getAttribute("id"));
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

test("keeps service-style state shared and staffing changes on the canonical price", async ({ page }) => {
  await commitInline(page, "Guests", "80");
  await page.getByTestId("pc-consequences").getByRole("button", { name: "Keep as quoted" }).click();
  await openDomain(page, "experience");
  await page.getByRole("button", { name: /Change package or service style/ }).click();
  const styleOptions = page.getByTestId("pc-experience-editor").locator(".pc-option-grid").nth(1);
  const nextStyle = styleOptions.locator(".pc-option:not([aria-pressed='true'])").first();
  const nextStyleName = String(await nextStyle.locator("strong").textContent()).trim();
  await nextStyle.click();
  await expect(styleOptions.locator(".pc-option").filter({ hasText: nextStyleName }).first())
    .toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".pc-fact-row")).toContainText(nextStyleName);

  await page.getByTestId("pc-guided-mode").click();
  await expect(page.locator(".wizard-panel")).toBeVisible();
  await page.getByRole("button", { name: "Composer view" }).click();
  await openDomain(page, "experience");
  await expect(page.locator(".pc-fact-row")).toContainText(nextStyleName);

  await openDomain(page, "staffing");
  const totalBefore = await page.getByTestId("pc-pulse-total").textContent();
  const recommendation = page.getByTestId("pc-staffing-recommendation");
  await expect(recommendation).toBeVisible();
  await recommendation.getByRole("button", { name: /Use recommendation/ }).click();
  await expect(page.getByTestId("pc-pulse-total")).not.toHaveText(String(totalBefore || ""));
  await openDomain(page, "commercials");
  const staffingRow = page.locator(".pc-investment-rows > div").filter({ hasText: "Staffing" });
  await expect(staffingRow).toBeVisible();
  await expect(staffingRow).not.toContainText("$0.00");
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

test("keeps identity, active work, money, and attention in the first desktop viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const firstView = [
    page.getByRole("heading", { level: 1 }),
    page.getByTestId("workbench-domain-event"),
    page.getByTestId("pc-pulse-total"),
    page.locator(".pc-pulse-facts").getByText(/Deposit/),
    page.getByTestId("commercial-truth-blockers")
  ];

  for (const locator of firstView) {
    await expect(locator).toBeVisible();
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    expect(Number(box?.y) + Number(box?.height)).toBeLessThanOrEqual(1000);
  }
  await expect(page.getByTestId("workbench-domain-event")).toHaveAttribute("aria-current", "step");
});

test("gives a blank quote honest identity, readable Event context, and named regions", async ({ page }) => {
  await expect(page.getByRole("heading", { level: 1, name: "Untitled event", exact: true })).toBeVisible();
  await expect(page.getByTestId("pc-event-summary")).toContainText("need review");
  await expect(page.getByTestId("pc-event-summary")).not.toContainText(/undefined|null/i);
  await expect(page.getByRole("navigation", { name: "Quote plan" })).toBeVisible();
  await expect(page.getByRole("article", { name: "Living proposal document" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Quote Pulse" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Event", exact: true })).toBeVisible();
});

test("keeps a realistic Menu usable in normal flow at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Event type", { exact: true }).selectOption({ index: 1 });
  await openDomain(page, "experience");
  await page.getByTestId("pc-edit-menu").click();

  const editor = page.getByTestId("pc-menu-editor");
  const groups = editor.locator("details.pc-menu-editor-group");
  await expect(groups.first()).toBeVisible();
  expect(await groups.count()).toBeGreaterThan(2);
  const openBeforeSearch = await groups.evaluateAll((nodes) => nodes.filter((node) => node.open).length);
  expect(openBeforeSearch).toBeGreaterThan(0);
  expect(openBeforeSearch).toBeLessThan(await groups.count());

  const closedIndex = await groups.evaluateAll((nodes) => nodes.findIndex((node) => !node.open));
  expect(closedIndex).toBeGreaterThanOrEqual(0);
  const closedGroup = groups.nth(closedIndex);
  const closedSummary = closedGroup.locator("summary");
  const closedSummaryBox = await closedSummary.boundingBox();
  expect(Number(closedSummaryBox?.height)).toBeGreaterThanOrEqual(44);
  await closedSummary.click();
  await expect(closedGroup).toHaveAttribute("open", "");

  const firstDish = String(await editor.locator(".pc-choice-copy strong").first().textContent()).trim();
  await editor.getByLabel("Search menu", { exact: true }).fill(firstDish);
  await expect(groups.first()).toHaveAttribute("open", "");
  expect(await groups.evaluateAll((nodes) => nodes.every((node) => node.open))).toBe(true);

  const overflow = await editor.evaluate((node) => getComputedStyle(node).overflowY);
  expect(["visible", "clip"]).toContain(overflow);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1))
    .toBe(true);
});

test("keeps long identity text in bounds and exposes visible keyboard focus", async ({ page }) => {
  await commitInline(page, "Event name", "A Very Long Multi-Family Celebration Name That Must Wrap Without Colliding With Quote Actions Or Commercial Truth");
  const title = page.getByRole("heading", { level: 1 });
  expect(await title.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1))
    .toBe(true);

  await page.keyboard.press("Tab");
  const focusStyle = await page.locator(":focus").evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      visible: node.matches(":focus-visible"),
      width: style.outlineWidth,
      style: style.outlineStyle
    };
  });
  expect(focusStyle.visible).toBe(true);
  expect(Number.parseFloat(focusStyle.width)).toBeGreaterThanOrEqual(2);
  expect(focusStyle.style).not.toBe("none");
});

test("removes Workbench animation and transitions for reduced-motion users", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(page.getByTestId("proposal-composer")).toBeVisible();
  const motion = await page.getByTestId("workbench-domain-event").evaluate((node) => {
    const style = getComputedStyle(node);
    return { animation: style.animationName, transition: style.transitionDuration };
  });
  expect(motion.animation).toBe("none");
  expect(motion.transition.split(",").every((duration) => duration.trim() === "0s")).toBe(true);
});

test("keeps margin evidence behind its flag and expands unavailable evidence when enabled", async ({ page }) => {
  const margin = page.getByTestId("pc-margin-cost");
  if (!MARGINS_ENABLED) {
    await expect(margin).toHaveCount(0);
    return;
  }

  await commitInline(page, "Guests", "50");
  await expect(margin).toHaveAttribute("data-state", "unavailable");
  await expect(margin).toHaveAttribute("open", "");
  await expect(margin).toContainText("Margins unavailable");
  await expect(margin.locator("summary")).toContainText("Review · Staff-only");
});

test("keeps Pilot dormant until needed and subjects its draft change to ordinary blockers", async ({ page }) => {
  const pilot = page.locator(".pilot-command");
  await expect(pilot).toHaveCount(0);
  if (!PILOT_ENABLED) return;

  await commitInline(page, "Event name", "Pilot Review Dinner");
  await expect(pilot).toBeVisible();
  await pilot.getByLabel("Command for this draft", { exact: true }).fill("add another bartender");
  await pilot.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(pilot.locator(".pilot-command-preview")).toContainText("Nothing is saved yet");
  await openDomain(page, "staffing");
  await expect(page.getByRole("button", { name: "Change Bartenders", exact: true })).toContainText("0 bartenders");

  await pilot.getByRole("button", { name: "Apply to draft", exact: true }).click();
  await expect(page.getByRole("button", { name: "Change Bartenders", exact: true })).toContainText("1 bartender");
  await expect(page.getByTestId("pc-save")).toHaveText(/Review \d+ blockers?/i);
  await expect(page.locator(".pc-save-state")).toHaveAttribute("data-state", "dirty");
});

test("preserves the complete unsaved draft when local persistence fails", async ({ page }) => {
  await completeSavableDraft(page);
  await expect(page.getByTestId("pc-save")).toHaveText("Save draft");
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function failQuotePersistence(key, value) {
      if (key === "quoteWizard.quotes") throw new Error("Injected quote persistence failure.");
      return setItem.call(this, key, value);
    };
  });

  await page.getByTestId("pc-save").click();
  const notice = page.getByTestId("pc-draft-notice");
  await expect(notice).toContainText("Injected quote persistence failure.");
  await expect(page.getByRole("heading", { level: 1, name: "Persistence Boundary Dinner" })).toBeVisible();
  await expect(page.locator(".pc-save-state")).toHaveAttribute("data-state", "dirty");
  expect(await page.evaluate(() => localStorage.getItem("quoteWizard.quotes"))).toBeNull();

  await openDomain(page, "customer");
  await expect(page.getByRole("button", { name: "Change Client name", exact: true })).toContainText("Boundary Client");
  await openDomain(page, "experience");
  await expect(page.locator(".pc-menu-list")).toContainText("Assorted Meat Croissants");
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
