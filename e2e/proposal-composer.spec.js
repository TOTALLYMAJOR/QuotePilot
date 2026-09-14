import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Flag-on lane only (mirrors customer-centered-workspace.spec.js gating):
// the default e2e lane pins VITE_PROPOSAL_COMPOSER_ENABLED to "false" so the
// legacy wizard contract stays covered by quote-wizard.smoke.spec.js. Run
// this spec with:
//   VITE_PROPOSAL_COMPOSER_ENABLED=true npm run test:e2e -- e2e/proposal-composer.spec.js
const PROPOSAL_COMPOSER_ENABLED = ["1", "true", "yes", "on"].includes(
  String(process.env.VITE_PROPOSAL_COMPOSER_ENABLED || "").trim().toLowerCase()
);
const CAPTURE_SCENARIO_PROOF = ["1", "true", "yes", "on"].includes(
  String(process.env.CAPTURE_COMMERCIAL_SCENARIO_PROOF || "").trim().toLowerCase()
);
const SCENARIO_PROOF_DIRECTORY = "output/playwright/commercial-scenario-current";

test.skip(!PROPOSAL_COMPOSER_ENABLED, "Proposal Composer flag is off in this lane.");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto("/app/quotes/new");
  await expect(page.getByTestId("proposal-composer")).toBeVisible({ timeout: 30_000 });
});

async function openWorkbenchDomain(page, domain) {
  await page.getByTestId(`workbench-domain-${domain}`).click();
  await expect(page.getByTestId(`workbench-domain-${domain}`)).toHaveAttribute("aria-current", "step");
}

test("presents the composer as the builder surface with Quote Pulse", async ({ page }) => {
  await expect(page.locator(".wizard-panel")).toHaveCount(0);
  await expect(page.getByText("Current draft", { exact: false }).first()).toBeVisible();
  await expect(page.getByTestId("commercial-workbench-plan")).toBeVisible();
  await expect(page.getByTestId("pc-pulse")).toBeVisible();
  await expect(page.getByTestId("pc-pulse-total")).toBeVisible();
  await expect(page.getByTestId("pc-watching")).toBeVisible();
  const saveAction = page.getByTestId("pc-save");
  await expect(saveAction).toBeEnabled();
  await expect(saveAction).toHaveText(/Review \d+ blockers?/i);
  await saveAction.click();
  await expect(page.getByTestId("pc-save-readiness")).toBeFocused();
});

test("keeps quote-domain context attached across representative widths", async ({ page }) => {
  const plan = page.getByTestId("commercial-workbench-plan");
  const document = page.getByTestId("pc-document");

  for (const width of [1440, 1008, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(plan).toBeVisible();
    await expect(plan.getByRole("button")).toHaveCount(5);

    const [planBox, documentBox] = await Promise.all([
      plan.boundingBox(),
      document.boundingBox()
    ]);
    expect(planBox, `quote plan should render at ${width}px`).not.toBeNull();
    expect(documentBox, `proposal document should render at ${width}px`).not.toBeNull();

    if (width > 820) {
      expect(planBox.x + planBox.width).toBeLessThanOrEqual(documentBox.x);
      await expect(plan).toHaveCSS("position", "sticky");
    } else {
      expect(planBox.y + planBox.height).toBeLessThanOrEqual(documentBox.y);
      await expect(plan).toHaveCSS("position", "static");
    }
  }
});

test("inline guest edit shows consequences and staffing follows the house rule", async ({ page }) => {
  await page.getByRole("button", { name: "Change Guests" }).click();
  await page.getByLabel("Guests", { exact: true }).fill("80");
  await page.getByRole("button", { name: "Apply change" }).click();

  const consequences = page.getByTestId("pc-consequences");
  await expect(consequences).toBeVisible();
  await expect(consequences).toContainText("→ 80");
  await consequences.getByRole("button", { name: "Keep as quoted" }).click();
  await expect(consequences).toHaveCount(0);

  // Buffet at 80 guests: house rule is 1 server / 25 guests, minimum 2 → 4.
  await openWorkbenchDomain(page, "staffing");
  const recommendation = page.getByTestId("pc-staffing-recommendation");
  await expect(recommendation).toBeVisible();
  await expect(recommendation).toContainText("4 servers");
  await recommendation.getByRole("button", { name: /Use recommendation/ }).click();
  await expect(page.getByRole("button", { name: "Change Servers" })).toContainText("4 servers");
  await expect(recommendation).toHaveCount(0);

  await expect(page.getByTestId("pc-save")).toBeEnabled();
});

test("package choice reprices the pulse from the document", async ({ page }) => {
  await page.getByRole("button", { name: "Change Guests" }).click();
  await page.getByLabel("Guests", { exact: true }).fill("60");
  await page.getByRole("button", { name: "Apply change" }).click();
  await page.getByTestId("pc-consequences").getByRole("button", { name: "Keep as quoted" }).click();

  await openWorkbenchDomain(page, "experience");
  await page.getByRole("button", { name: /Change package or service style/ }).click();
  const editor = page.getByTestId("pc-experience-editor");
  await expect(editor).toBeVisible();
  const firstOption = editor.locator(".pc-option").first();
  await firstOption.click();

  const total = page.getByTestId("pc-pulse-total");
  await expect(total).not.toHaveText(/\$0\.00/);
  await openWorkbenchDomain(page, "commercials");
  await expect(page.getByTestId("pc-investment-total")).not.toHaveText(/\$0\.00/);
});

test("menu composing stays inside the proposal", async ({ page }) => {
  const eventType = page.getByLabel("Event type", { exact: true });
  await eventType.selectOption({ index: 1 });

  await openWorkbenchDomain(page, "experience");
  await page.getByTestId("pc-edit-menu").click();
  const menuEditor = page.getByTestId("pc-menu-editor");
  await expect(menuEditor).toBeVisible();
  const firstChoice = menuEditor.locator(".pc-choice input[type='checkbox']").first();
  await firstChoice.check();

  await expect(page.locator(".pc-menu-list li").first()).toBeVisible();
});

test("guided mode reaches the wizard and returns", async ({ page }) => {
  await page.getByTestId("pc-guided-mode").click();
  await expect(page.locator(".wizard-panel")).toBeVisible();
  await expect(page.getByText("Creating this quote")).toBeVisible();
  await expect(page.getByTestId("proposal-composer")).toHaveCount(0);

  await page.getByRole("button", { name: "Composer view" }).click();
  await expect(page.getByTestId("proposal-composer")).toBeVisible();
  await expect(page.locator(".wizard-panel")).toHaveCount(0);
});

test("collapses to the mobile pulse flow at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("pc-pulse")).toBeHidden();
  await expect(page.getByRole("button", { name: /Review quote/ })).toBeVisible();
  await page.getByRole("button", { name: /Review quote/ }).click();
  await expect(page.getByTestId("pc-pulse")).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByTestId("pc-pulse")).toBeHidden();
});

test("keeps the client email editor clear of the mobile review bar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 300 });
  await openWorkbenchDomain(page, "customer");
  await page.getByRole("button", { name: "Change Email", exact: true }).click();

  await expect(page.getByRole("button", { name: /Review quote/ })).toBeHidden();

  const editorControls = [
    page.getByLabel("Email", { exact: true }),
    page.getByRole("button", { name: "Apply change", exact: true }),
    page.getByRole("button", { name: "Cancel", exact: true })
  ];
  for (const control of editorControls) {
    const box = await control.boundingBox();
    expect(box, "email editor control should have a rendered box").not.toBeNull();
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(300);
  }
});

async function commitInline(page, label, value) {
  await page.getByRole("button", { name: `Change ${label}`, exact: true }).click();
  await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole("button", { name: "Apply change" }).click();
}

test("staffing rate overrides reprice the quote from the staffing section", async ({ page }) => {
  await commitInline(page, "Guests", "60");
  await page.getByTestId("pc-consequences").getByRole("button", { name: "Keep as quoted" }).click();
  await openWorkbenchDomain(page, "staffing");
  await page.getByTestId("pc-staffing-recommendation")
    .getByRole("button", { name: /Use recommendation/ }).click();

  const strip = page.getByTestId("pc-rate-strip");
  await expect(strip).toContainText("Servers at");
  await expect(strip).toContainText("house rate");

  const totalBefore = await page.getByTestId("pc-pulse-total").textContent();
  await page.getByTestId("pc-adjust-rates").click();
  await page.getByLabel("Server rate override ($/hr)", { exact: true }).fill("60");

  await expect(strip).toContainText("quote override");
  await expect(page.getByTestId("pc-pulse-total")).not.toHaveText(totalBefore);
});

test("editing a saved quote surfaces the change-impact preview in the composer", async ({ page }) => {
  test.setTimeout(180_000);
  await page.getByLabel("Event type", { exact: true }).selectOption({ index: 1 });
  await commitInline(page, "Event name", "Composer Impact Quote");
  await commitInline(page, "Date", "2027-09-12");
  await commitInline(page, "Guests", "60");
  await page.getByTestId("pc-consequences").getByRole("button", { name: "Keep as quoted" }).click();
  await commitInline(page, "Venue", "Impact Hall");
  await openWorkbenchDomain(page, "customer");
  await commitInline(page, "Client name", "Impact Client");
  await commitInline(page, "Email", "impact@example.test");

  await openWorkbenchDomain(page, "experience");
  await page.getByTestId("pc-edit-menu").click();
  await page.getByTestId("pc-menu-editor")
    .locator(".pc-choice input[type='checkbox']").first().check();

  await page.getByTestId("pc-save").click();

  await expect(page.getByRole("heading", { name: /Composer Impact Quote/ })).toBeVisible();
  const allOpportunities = page.getByRole("button", { name: "All opportunities", exact: true });
  if (await allOpportunities.isVisible().catch(() => false)) {
    await allOpportunities.click();
  } else {
    await page.getByRole("button", { name: "Quotes", exact: true }).click();
  }
  const quoteRow = page.locator(".history-table-wrap tbody tr").filter({
    hasText: "Impact Client"
  }).first();
  await expect(quoteRow).toBeVisible();
  await quoteRow.getByRole("button", { name: "Edit" }).click();

  await expect(page.getByTestId("proposal-composer")).toBeVisible();
  await expect(page.getByText(/Editing quote/i).first()).toBeVisible();

  const impact = page.locator('[data-capability-id="cwf-15b-commercial-change-impact-preview"]');
  await expect(impact).toBeVisible();
  await expect(impact).toContainText("Understand the change before it becomes the next truth");
  await expect(impact).toContainText("browser-local mode");

  const twin = page.locator('[data-capability-id="commercial-scenario-workbench"]');
  const fulfillment = page.locator('[data-capability-id="living-commercial-twin-fulfillment"]');
  await expect(twin).toHaveCount(1);
  await expect(twin).toBeVisible();
  await expect(twin).toHaveAttribute("data-authority", "session-only-non-authoritative");
  await expect(twin.getByRole("heading", { name: "Composer Impact Quote" })).toBeVisible();
  await expect(twin.locator('[data-scenario-comparison="all"]')).toBeAttached();
  await expect(twin.locator('[data-scenario-comparison="selected"]')).toBeAttached();
  await expect(twin.locator('[data-scenario-column="current"]').first()).toHaveAttribute("data-evidence-state", "saved");
  await expect(fulfillment).toHaveCount(1);
  await expect(fulfillment).toBeVisible();
  await expect(fulfillment).toHaveAttribute("data-authority", "presentation-only");
  await expect(fulfillment.getByText("Can we support this change?", { exact: true })).toBeVisible();
  await expect(fulfillment.getByText(/Margin unavailable/)).toBeVisible();
  await expect(fulfillment).not.toContainText("Supplier B");
  await expect(twin).not.toContainText(/Living Commercial Twin|governed|projection|evidence|authority|revision|read model|Not verified|Unverifiable|Updating|digest|generation|boundary|source/i);

  await twin.locator("#csw-guest-count").fill("80");
  await expect(twin.getByRole("tab", { name: /Scenario A/ })).toBeVisible();
  await twin.getByRole("button", { name: "Duplicate scenario" }).click();
  await expect(twin.getByRole("tab", { name: /Scenario B/ })).toBeVisible();
  await expect(twin.locator('[data-scenario-comparison="all"] th[scope="col"]')).toHaveCount(3);

  if (CAPTURE_SCENARIO_PROOF) mkdirSync(SCENARIO_PROOF_DIRECTORY, { recursive: true });
  for (const { width, height } of [
    { width: 1440, height: 1000 },
    { width: 1008, height: 900 },
    { width: 768, height: 900 },
    { width: 390, height: 844 }
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => document.fonts.ready);
    await expect(twin).toBeVisible();
    await expect(twin.locator("details[open]")).toHaveCount(0);
    if (width === 390) {
      const mobileHeader = await twin.locator(".csw-header").boundingBox();
      expect(mobileHeader, "commercial decision header should render at mobile").not.toBeNull();
      expect(mobileHeader.height).toBeLessThan(380);
    }
    expect(await page.evaluate(() => (
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    ))).toBeLessThanOrEqual(1);
    const undersized = await twin.locator("button:visible:not([disabled]), input:visible:not([disabled])").evaluateAll((controls) => (
      controls.filter((control) => {
        const rect = control.getBoundingClientRect();
        return rect.width < 44 || rect.height < 44;
      }).map((control) => control.getAttribute("aria-label") || control.textContent?.trim() || control.tagName)
    ));
    expect(undersized).toEqual([]);
    const accessibility = await new AxeBuilder({ page }).include('[data-capability-id="commercial-scenario-workbench"]').analyze();
    expect(accessibility.violations).toEqual([]);
    if (CAPTURE_SCENARIO_PROOF) {
      await twin.evaluate((element) => element.scrollIntoView({ block: "start" }));
      await page.evaluate(() => {
        const siteHeader = document.querySelector(".site-header");
        const headerBox = siteHeader?.getBoundingClientRect();
        const topOcclusion = headerBox && headerBox.width > window.innerWidth * 0.6
          ? headerBox.height
          : 0;
        window.scrollBy(0, -(topOcclusion + 16));
      });
      await page.screenshot({
        path: `${SCENARIO_PROOF_DIRECTORY}/route-local-review-${width}.png`,
        animations: "disabled",
        caret: "hide"
      });
      await twin.screenshot({
        path: `${SCENARIO_PROOF_DIRECTORY}/surface-local-review-${width}.png`,
        animations: "disabled",
        caret: "hide",
        style: ".site-header, .pc-mobile-bar { visibility: hidden !important; }"
      });
    }
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  const watching = page.getByTestId("pc-watching");
  await expect(watching).toContainText("Saved-quote impact");
  await watching.getByRole("button", { name: /change impact|impact preview/ }).click();
});

test("recent activity records this session's changes behind its toggle", async ({ page }) => {
  await commitInline(page, "Guests", "50");
  await page.getByTestId("pc-consequences").getByRole("button", { name: "Keep as quoted" }).click();
  await commitInline(page, "Event name", "Activity Gala");

  await page.getByTestId("pc-activity-toggle").click();
  const log = page.getByTestId("pc-activity");
  await expect(log).toBeVisible();
  await expect(log).toContainText("Guests → 50");
  await expect(log).toContainText("Event name → Activity Gala");

  await page.getByTestId("pc-activity-toggle").click();
  await expect(log).toHaveCount(0);
});

test("recovers an unsaved draft after the tab is lost", async ({ page }) => {
  await commitInline(page, "Event name", "Recovered Gala");
  // Wait for the debounced local snapshot to land.
  await expect.poll(async () => page.evaluate(() => (
    Object.keys(localStorage).some((key) => key.includes("draft-recovery"))
  )), { timeout: 5000 }).toBe(true);

  // A fresh page in the same context shares localStorage but skips this
  // spec's storage-clearing init script — a stand-in for a reopened tab.
  const rescue = await page.context().newPage();
  await rescue.goto("/app");
  const banner = rescue.getByTestId("draft-recovery-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Unsaved draft found");
  await banner.getByRole("button", { name: "Resume draft" }).click();
  await expect(rescue.getByRole("heading", { name: "Recovered Gala" })).toBeVisible();
  await expect(banner).toHaveCount(0);
  await rescue.close();
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`composer meets color-contrast checks at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const results = await new AxeBuilder({ page })
      .include(".proposal-composer")
      .withRules(["color-contrast"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
}
