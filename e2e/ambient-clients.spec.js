import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

const REQUIRED_GATES = [
  process.env.VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED,
  process.env.VITE_AMBIENT_UI_ENABLED
].every((value) => ["1", "true", "yes", "on"].includes(
  String(value || "").trim().toLowerCase()
));
const CAPTURE_PROOF = ["1", "true", "yes", "on"].includes(
  String(process.env.CAPTURE_AMBIENT_BROWSER_PROOF || "").trim().toLowerCase()
);
const PROOF_DIRECTORY = "output/playwright/ambient-intelligence-current";
const CLIENT_ID = "ambient-client-maya";
const OPPORTUNITY_ID = "ambient-client-autumn-dinner";
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1440, height: 1000 }
];

const CLIENT_QUOTE = {
  organizationId: "e2e-org",
  id: OPPORTUNITY_ID,
  customerId: CLIENT_ID,
  quoteNumber: "QP-CLIENT-1042",
  status: "sent",
  activeVersionId: "v0002",
  latestVersionNumber: 2,
  createdAtISO: "2026-08-10T14:00:00.000Z",
  updatedAtISO: "2026-08-12T13:00:00.000Z",
  expiresAtISO: "2099-12-31T23:59:59.000Z",
  customer: {
    name: "Maya Bennett",
    email: "maya.bennett@example.test",
    phone: "205-555-0184",
    organization: "Bennett Foundation"
  },
  event: {
    name: "Autumn Benefit Dinner",
    date: "2026-10-19",
    time: "18:00",
    hours: 5,
    venue: "The Foundry Hall",
    guests: 120,
    servers: 8,
    chefs: 3,
    bartenders: 1
  },
  selection: {
    eventTypeId: "benefit",
    packageId: "classic",
    packageName: "Classic Dinner",
    menuItems: ["herb-chicken"],
    menuItemNames: ["Herb Chicken"],
    addons: [],
    rentals: []
  },
  totals: {
    subtotal: 7000,
    serviceFee: 1000,
    tax: 400,
    total: 8400,
    deposit: 2520
  },
  payment: {
    depositStatus: "unpaid",
    finalBalance: { status: "unpaid" }
  },
  portalDecision: {
    decision: "changes_requested",
    requestId: "ambient-client-request-1042",
    message: "Please review the updated arrival time.",
    submittedAtISO: "2026-08-12T12:45:00.000Z"
  },
  conversationSummary: {
    messageCount: 2,
    latestMessageId: "ambient-client-message-2",
    latestMessageAtISO: "2026-08-12T12:45:00.000Z",
    latestActorType: "customer"
  },
  lifecycle: {
    draftAtISO: "2026-08-10T14:00:00.000Z",
    sentAtISO: "2026-08-11T16:00:00.000Z"
  }
};

async function seedClient(page) {
  await page.addInitScript((quote) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("qp.workspaceSoundsEnabled", "false");
    localStorage.setItem("quoteWizard.quotes", JSON.stringify([quote]));
    localStorage.setItem("quoteWizard.quoteHistory", JSON.stringify([]));
  }, CLIENT_QUOTE);
}

async function gotoClientsWorkspace(page) {
  await page.goto("/app/customers");
  const setupHeading = page.getByRole("heading", { name: "Bring Your Catalog to Life" });
  const directory = page.locator(".ambient-clients");
  await expect(setupHeading.or(directory)).toBeVisible({ timeout: 30_000 });
  if (await setupHeading.isVisible()) {
    await page.getByRole("button", { name: "Explore the workspace" }).click();
    await expect(directory).toBeVisible({ timeout: 30_000 });
  }
}

async function expectFortyFourPixelTargets(surface) {
  const undersized = await surface.locator(
    "button:visible, input:visible, summary:visible"
  ).evaluateAll((controls) => controls.map((control) => {
    const rect = control.getBoundingClientRect();
    return {
      label: control.getAttribute("aria-label") || control.textContent.trim(),
      width: rect.width,
      height: rect.height
    };
  }).filter(({ width, height }) => width < 44 || height < 44));
  expect(undersized).toEqual([]);
}

async function expectContainedAmbientLayout(page, surfaceSelector, groupSelectors) {
  const result = await page.evaluate(async ({ selector, groups }) => {
    const { auditWorkspaceLayout } = await import("/src/lib/workspaceLayoutAudit.js");
    const surface = document.querySelector(selector);
    if (!surface) return { setupError: `Missing ${selector}.` };
    surface.setAttribute("data-layout-audit-surface", selector);
    surface.setAttribute("data-layout-audit-overflow", selector);
    groups.forEach((groupSelector, groupIndex) => {
      document.querySelectorAll(groupSelector).forEach((group, instanceIndex) => {
        [...group.children].forEach((child) => {
          child.setAttribute(
            "data-layout-audit-group",
            `ambient-client-${groupIndex + 1}-${instanceIndex + 1}`
          );
        });
      });
    });
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none"
        && style.visibility !== "hidden"
        && Number(style.opacity || 1) > 0
        && rect.width > 0
        && rect.height > 0;
    };
    return {
      setupError: "",
      visibleOverlayCount: [...document.querySelectorAll("[role='dialog'], .modal-overlay")]
        .filter(visible).length,
      surfaceOverflowPx: Math.max(0, surface.scrollWidth - surface.clientWidth),
      audit: auditWorkspaceLayout(document, { tolerancePx: 1, focusReservePx: 2 })
    };
  }, { selector: surfaceSelector, groups: groupSelectors });

  expect(result.setupError).toBe("");
  expect(result.visibleOverlayCount).toBe(0);
  expect(result.surfaceOverflowPx).toBeLessThanOrEqual(1);
  expect(result.audit).toMatchObject({
    modelId: "workspace-layout-audit-v1",
    containmentModelId: "workspace-control-containment-v1",
    passed: true,
    collisions: [],
    overflow: [],
    undeclaredOverlays: [],
    escapedControls: [],
    escapedFocusPaint: []
  });
  expect(result.audit.documentOverflowPx).toBeLessThanOrEqual(1);
}

async function capture(page, name) {
  if (!CAPTURE_PROOF) return;
  mkdirSync(PROOF_DIRECTORY, { recursive: true });
  await page.evaluate(async () => {
    await document.fonts.ready;
    document.activeElement?.blur();
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
  });
  await page.screenshot({
    path: `${PROOF_DIRECTORY}/${name}.png`,
    animations: "disabled",
    fullPage: true
  });
}

test.describe("Ambient Clients", () => {
  test.skip(
    !REQUIRED_GATES,
    "The Clients proof requires the customer-centered workspace and default-off Ambient gate."
  );

  test.beforeEach(async ({ page }) => {
    await seedClient(page);
  });

  for (const viewport of VIEWPORTS) {
    test(`keeps the client relationship light, exact, and evidence-safe at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await gotoClientsWorkspace(page);

      const directory = page.locator(".ambient-clients");
      const directoryHeading = directory.getByRole("heading", {
        name: "Clients",
        exact: true
      });
      await expect(directoryHeading).toBeVisible({ timeout: 30_000 });
      await expect(directoryHeading).toBeFocused();
      await expect(directory).toHaveAttribute("data-surface-contract-id", "ambient-clients-list");
      await directory.getByPlaceholder("Search clients by name or email…")
        .fill(CLIENT_QUOTE.customer.email);
      await directory.getByRole("button", { name: "Search", exact: true }).click();
      await expect(directory.locator(".ambient-client")).toHaveCount(1);
      await expect(directory.locator('[data-client-id="ambient-client-maya"]')).toContainText("Maya Bennett");
      await expect(page.locator(".customer-directory-table")).toHaveCount(0);

      const primaryCounts = await directory.locator(".ambient-client").evaluateAll((rows) => (
        rows.map((row) => row.querySelectorAll(".ambient-client__primary").length)
      ));
      expect(primaryCounts).toEqual([1]);
      await expect(directory.locator(".ambient-client__primary")).toHaveText(/Review client/u);

      await expectFortyFourPixelTargets(directory);
      expect(await page.evaluate(() => (
        document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
      ))).toBe(true);
      const directoryAccessibility = await new AxeBuilder({ page })
        .include(".ambient-clients")
        .analyze();
      expect(directoryAccessibility.violations).toEqual([]);
      await expectContainedAmbientLayout(page, ".ambient-clients", [
        ".ambient-clients__masthead",
        ".ambient-client"
      ]);
      await capture(page, `ambient-clients-directory-${viewport.width}`);

      await directory.locator(".ambient-client__primary").click();
      await expect(page).toHaveURL(new RegExp(`/app/customers/${CLIENT_ID}$`, "u"));

      const overview = page.locator(`[data-client-id="${CLIENT_ID}"].ambient-client-overview`);
      await expect(overview).toBeVisible({ timeout: 30_000 });
      await expect(overview).toHaveAttribute(
        "data-surface-contract-id",
        "ambient-client-relationship"
      );
      const clientHeading = overview.getByRole("heading", { name: "Maya Bennett", level: 1 });
      await expect(clientHeading).toBeVisible();
      await expect(clientHeading).toBeFocused();

      const arrival = page.locator('[data-arrival-surface="client-overview"]');
      await expect(arrival).toHaveAttribute("data-arrival-state", "resolved");
      await expect(arrival).toContainText("Client ready");
      await expect(arrival).toContainText("Next step:");

      await expect(overview.locator(".ambient-client-overview__identity")).toContainText("Maya Bennett");
      await expect(overview.locator(".ambient-client-overview__signals")).toContainText("Current work");
      await expect(overview.locator(".ambient-client-overview__signals")).toContainText("Needs review");
      await expect(overview.locator(".ambient-client-overview__next")).toContainText("Suggested next step");
      await expect(overview.locator(".ambient-client-overview__next")).toContainText("Review requested changes");

      const topLayer = await overview.evaluate((root) => {
        const summary = root.querySelector(".ambient-client-overview__summary");
        const rootRect = root.getBoundingClientRect();
        const summaryRect = summary.getBoundingClientRect();
        return {
          height: summaryRect.bottom - rootRect.top,
          viewportHeight: window.innerHeight
        };
      });
      expect(topLayer.height).toBeLessThanOrEqual(topLayer.viewportHeight);

      const conversation = overview.locator(".ambient-client-overview__conversations li");
      await expect(conversation).toHaveCount(1);
      await expect(conversation).toContainText("2 recorded messages");
      expect(await overview.innerText()).not.toMatch(/\bunread\b/iu);

      await expectFortyFourPixelTargets(overview);
      expect(await page.evaluate(() => (
        document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
      ))).toBe(true);
      const overviewAccessibility = await new AxeBuilder({ page })
        .include('[data-arrival-surface="client-overview"]')
        .include(".ambient-client-overview")
        .analyze();
      expect(overviewAccessibility.violations).toEqual([]);
      await expectContainedAmbientLayout(page, ".ambient-client-overview", [
        ".ambient-client-overview__identity",
        ".ambient-client-overview__summary",
        ".ambient-client-overview__opportunities li",
        ".ambient-client-overview__conversations li"
      ]);
      await capture(page, `ambient-client-overview-${viewport.width}`);
    });
  }
});
