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
