import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const REQUIRED_GATES = [
  process.env.VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED,
  process.env.VITE_AMBIENT_UI_ENABLED,
  process.env.VITE_PILOT_NOW_ENABLED
].every((value) => ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase()));
const CAPTURE = ["1", "true", "yes", "on"].includes(String(process.env.CAPTURE_AMBIENT_NOW || "").trim().toLowerCase());
const OUTPUT_DIR = resolve(process.cwd(), "output/playwright/ambient-now");
const QUOTES_KEY = "quoteWizard.quotes";
const HISTORY_KEY = "quoteWizard.quoteHistory";

function dateOnlyFromNow(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isoFromNow(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function fixtures() {
  const eventBase = {
    time: "17:30",
    hours: 5,
    venue: "The Glass House",
    venueAddress: "250 Garden Lane",
    style: "Plated",
    guests: 96,
    servers: 6,
    chefs: 2,
    bartenders: 1
  };
  return [
    {
      id: "rivera-wedding",
      organizationId: "e2e-org",
      customerId: "client-rivera",
      quoteNumber: "QP-RIVERA-250",
      status: "viewed",
      customer: { name: "Avery & Jordan Rivera", email: "rivera@example.test" },
      event: { ...eventBase, name: "Rivera Wedding", date: dateOnlyFromNow(12) },
      portalDecision: {
        decision: "changes_requested",
        message: "Could we swap the salmon for chicken?",
        requestId: "request-rivera-menu",
        submittedAtISO: isoFromNow(-3)
      },
      workflow: {
        followUp: { stage: "awaiting_response", dueDate: dateOnlyFromNow(-2), completed: false },
        approvalRequests: [{
          id: "approval-rivera-discount",
          action: "rotate_portal_link",
          state: "pending",
          requestedAtISO: isoFromNow(-2)
        }]
      },
      totals: { total: 9200, deposit: 2760 },
      payment: { depositStatus: "unpaid", finalBalance: { status: "not_due" } }
    },
    {
      id: "autumn-benefit",
      organizationId: "e2e-org",
      customerId: "client-bennett",
      quoteNumber: "QP-AUTUMN-410",
      status: "accepted",
      customer: { name: "Maya Bennett", email: "maya@example.test" },
      event: { ...eventBase, name: "Autumn Benefit Dinner", date: dateOnlyFromNow(5), time: "18:00", venue: "The Foundry Hall", guests: 120 },
      totals: { total: 11840, deposit: 3552 },
      payment: { depositStatus: "sent", finalBalance: { status: "not_due" } },
      lifecycle: { acceptedAtISO: isoFromNow(-8) }
    },
    {
      id: "chen-gala",
      organizationId: "e2e-org",
      customerId: "client-chen",
      quoteNumber: "QP-CHEN-104",
      status: "declined",
      customer: { name: "Lena Chen", email: "lena@example.test" },
      event: { ...eventBase, name: "Spring Gala", date: dateOnlyFromNow(-30), venue: "Museum Court" },
      workflow: {
        followUp: { completed: true, completedAtISO: isoFromNow(-2) }
      },
      lifecycle: { declinedAtISO: isoFromNow(-26) }
    }
  ];
}

async function seedWorkspace(page) {
  await page.addInitScript(({ quotes, quotesKey, historyKey }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("qp.workspaceSoundsEnabled", "false");
    localStorage.setItem(quotesKey, JSON.stringify(quotes));
    localStorage.setItem(historyKey, JSON.stringify([]));
  }, { quotes: fixtures(), quotesKey: QUOTES_KEY, historyKey: HISTORY_KEY });
}

async function gotoNow(page) {
  await page.goto("/app");
  const setupHeading = page.getByRole("heading", { name: "Bring Your Catalog to Life" });
  const workspaceHeader = page.locator(".site-header");
  await expect(setupHeading.or(workspaceHeader)).toBeVisible({ timeout: 30_000 });
  if (await setupHeading.isVisible()) {
    await page.getByRole("button", { name: "Explore the workspace" }).click();
  }
  await expect(page.locator(".ambient-now")).toBeVisible({ timeout: 30_000 });
}

async function expectNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll("body *")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { tag: element.tagName, className: String(element.className || ""), left: rect.left, right: rect.right, width: rect.width };
      })
      .filter((entry) => entry.right > document.documentElement.clientWidth + 1 || entry.left < -1)
      .sort((a, b) => b.right - a.right)
      .slice(0, 6)
  }));
  expect(dimensions.scrollWidth, JSON.stringify(dimensions.offenders, null, 2))
    .toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

async function capture(page, filename) {
  if (!CAPTURE) return;
  mkdirSync(OUTPUT_DIR, { recursive: true });
  await page.waitForTimeout(320);
  await page.screenshot({ path: resolve(OUTPUT_DIR, filename), animations: "disabled" });
}

test.describe("Ambient Now decision ledger", () => {
  test.skip(!REQUIRED_GATES, "Ambient Now requires the customer-centered workspace, Ambient UI, and Pilot Now gates.");

  test.beforeEach(async ({ page }) => {
    await seedWorkspace(page);
  });

  test("preserves ranked authority while presenting evidence-bounded urgency and quiet progress", async ({ page }) => {
    await page.setViewportSize({ width: 1487, height: 1058 });
    await gotoNow(page);

    const now = page.locator(".ambient-now");
    await expect(now.getByTestId("now-daily-brief")).toHaveText("One overdue follow-up needs you today.");
    await expect(now.locator('[data-now-urgency-count="1"]')).toBeVisible();
    await expect(now.locator('[data-now-waiting-count="2"]')).toBeVisible();
    await expect(now.locator(".ambient-now-priority")).toHaveCount(3);
    await expect(now.locator('[data-attention-position="1"]')).toContainText("Customer request");
    await expect(now.locator('[data-attention-position="2"]')).toContainText("Overdue follow-up");
    await expect(now.locator('[data-attention-position="3"]')).toContainText("Admin decision");
    await expect(now.locator(".ambient-now-priority__number")).toHaveCount(0);
    await expect(now.getByTestId("now-temporal-horizon").locator("li")).toHaveCount(7);
    await expect(now.getByText("Autumn Benefit Dinner", { exact: true }).first()).toBeVisible();
    await expect(now.getByText("Recently handled", { exact: true })).toBeVisible();
    await expect(now.getByText("Waiting on others", { exact: true })).toBeVisible();
    await expect(now.getByText("Deposit requested", { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const violations = await new AxeBuilder({ page })
      .include(".ambient-now")
      .analyze();
    expect(violations.violations.filter((violation) => ["serious", "critical"].includes(violation.impact))).toEqual([]);
    await capture(page, "ambient-now-reference-1487x1058.png");

    await now.getByRole("button", { name: "Review request for Rivera Wedding" }).click();
    await expect(page).toHaveURL(/\/app\/workflow\?quoteId=rivera-wedding&attentionType=change_request&requestId=request-rivera-menu$/u);
    const focusedRequest = page.locator('[data-attention-id^="change-request:rivera-wedding:"]');
    await expect(focusedRequest).toBeVisible();
    await expect(focusedRequest).toBeFocused();

    await page.getByRole("navigation", { name: "Primary workspace" })
      .getByRole("button", { name: "Now", exact: true }).click();
    await expect(page.locator(".ambient-now")).toBeVisible();
    await page.getByRole("button", { name: "Open Autumn Benefit Dinner in Calendar" }).click();
    await expect(page).toHaveURL(/\/app\/operations/u);
    await expect(page.getByTestId("operations-focused-event"))
      .toHaveAttribute("data-exact-event-id", "autumn-benefit");
  });

  test("keeps the same decision grammar at tablet and mobile widths", async ({ page }) => {
    for (const viewport of [
      { width: 768, height: 900, name: "768" },
      { width: 390, height: 844, name: "390" }
    ]) {
      await page.setViewportSize(viewport);
      await gotoNow(page);
      await expect(page.locator('[data-attention-position="1"]')).toBeVisible();
      await expect(page.getByTestId("now-temporal-horizon")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await capture(page, `ambient-now-${viewport.name}.png`);
    }
  });
});
