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

async function readPersistedOpportunityState(page) {
  return page.evaluate(() => ({
    quotes: localStorage.getItem("quoteWizard.quotes"),
    history: localStorage.getItem("quoteWizard.quoteHistory")
  }));
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

async function expectFeaturedClientSummaryLayout(featured, viewportWidth) {
  const layout = await featured.evaluate((root) => {
    const part = (name) => root.querySelector(`[data-client-summary-part="${name}"]`);
    const box = (element) => {
      const rect = element?.getBoundingClientRect();
      return rect ? {
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
        height: rect.height
      } : null;
    };
    const identity = part("identity");
    const contact = part("contact");
    const status = part("status");
    const action = part("action");
    const image = part("image");
    const contactValue = contact?.querySelector("dd");
    return {
      domOrder: [...root.querySelectorAll("[data-client-summary-part]")]
        .map((element) => element.dataset.clientSummaryPart),
      actionCount: root.querySelectorAll(".ambient-client__primary").length,
      root: box(root),
      identity: box(identity),
      contact: box(contact),
      status: box(status),
      action: box(action),
      image: box(image),
      imageVisible: image ? getComputedStyle(image).display !== "none" : false,
      contactOverflowPx: contactValue
        ? Math.max(0, contactValue.scrollWidth - contactValue.clientWidth)
        : Number.POSITIVE_INFINITY
    };
  });

  expect(layout.domOrder).toEqual(["identity", "contact", "status", "action", "image"]);
  expect(layout.actionCount).toBe(1);
  expect(layout.action.height).toBeGreaterThanOrEqual(44);
  expect(layout.contactOverflowPx).toBeLessThanOrEqual(1);

  if (viewportWidth <= 760) {
    expect(layout.identity.bottom).toBeLessThanOrEqual(layout.contact.top + 1);
    expect(layout.contact.bottom).toBeLessThanOrEqual(layout.status.top + 1);
    expect(layout.status.bottom).toBeLessThanOrEqual(layout.action.top + 1);
    expect(layout.action.bottom).toBeLessThanOrEqual(layout.image.top + 1);
    expect(layout.action.width).toBeGreaterThanOrEqual(layout.root.width - 1);
    expect(layout.imageVisible).toBe(true);
    return;
  }

  expect(layout.identity.right).toBeLessThanOrEqual(layout.action.left - 1);
  expect(layout.contact.top).toBeGreaterThanOrEqual(
    Math.max(layout.identity.bottom, layout.action.bottom) - 1
  );
  expect(layout.imageVisible).toBe(false);
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
        name: "Relationships, in context.",
        level: 1,
        exact: true
      });
      await expect(directoryHeading).toBeVisible({ timeout: 30_000 });
      await expect(directoryHeading).toBeFocused();
      await expect(directory).toHaveAttribute("data-surface-contract-id", "ambient-clients-list");
      const persistedBeforeBrowse = await readPersistedOpportunityState(page);
      await directory.getByPlaceholder("Search clients")
        .fill(CLIENT_QUOTE.customer.email);
      await directory.getByRole("button", { name: "Search", exact: true }).click();
      const relationshipRows = directory.locator(
        ".ambient-clients__featured, .ambient-clients__relationship-row"
      );
      const exactRelationship = directory.locator(`[data-client-id="${CLIENT_ID}"]`);
      await expect(relationshipRows).toHaveCount(1);
      await expect(exactRelationship).toContainText("Maya Bennett");
      await expect(exactRelationship).toContainText("Autumn Benefit Dinner");
      await expect(exactRelationship).toContainText("maya.bennett@example.test");
      await expect(exactRelationship).toContainText("Upcoming event on file");
      await expect(page.locator(".customer-directory-table")).toHaveCount(0);
      await expect(directory.locator(".ambient-clients__metrics")).toHaveCount(0);

      const primaryCounts = await relationshipRows.evaluateAll((rows) => (
        rows.map((row) => row.querySelectorAll(".ambient-client__primary").length)
      ));
      expect(primaryCounts).toEqual([1]);
      const reviewClient = exactRelationship.getByRole("button", { name: /Review client/u });
      await expect(reviewClient).toHaveCount(1);
      await expectFeaturedClientSummaryLayout(exactRelationship, viewport.width);
      expect(await readPersistedOpportunityState(page)).toEqual(persistedBeforeBrowse);

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

      await reviewClient.click();
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
      expect(await readPersistedOpportunityState(page)).toEqual(persistedBeforeBrowse);

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
