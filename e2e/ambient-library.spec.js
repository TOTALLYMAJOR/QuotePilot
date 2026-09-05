import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  DEFAULT_ADDONS,
  DEFAULT_EVENT_TEMPLATES,
  DEFAULT_PACKAGES,
  DEFAULT_RENTALS,
  DEFAULT_SETTINGS
} from "../src/data/mockCatalog";

const AMBIENT_UI_ENABLED = ["1", "true", "yes", "on"].includes(
  String(process.env.VITE_AMBIENT_UI_ENABLED || "").trim().toLowerCase()
);
const CUSTOMER_CENTERED_WORKSPACE_ENABLED = ["1", "true", "yes", "on"].includes(
  String(process.env.VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED || "").trim().toLowerCase()
);
const CAPTURE_PROOF = ["1", "true", "yes", "on"].includes(
  String(process.env.CAPTURE_AMBIENT_BROWSER_PROOF || "").trim().toLowerCase()
);
const PROOF_DIRECTORY = "output/playwright/ambient-intelligence-current";
const LAZY_SURFACE_TIMEOUT_MS = 30_000;
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1440, height: 1000 }
];
const REFERENCE_VIEWPORT = { width: 1487, height: 1058 };

const CONFIGURATION_RULES = [
  {
    id: "large-event-staffing",
    name: "Large events need staffing",
    type: "requirement",
    conditions: [
      { path: "event.guests", operator: "gte", value: 150, forwardEvidence: "condition-preserve" },
      { path: "event.serviceStyle", operator: "eq", value: "Buffet" }
    ],
    effect: {
      operator: "require",
      target: "resources.servers",
      value: 4,
      forwardEvidence: "effect-preserve"
    },
    reason: "Large events need a minimum service team.",
    enabled: true,
    futurePolicy: { channel: "preserve" }
  },
  {
    id: "buffet-coffee-recommendation",
    name: "Buffets pair with coffee service",
    type: "recommendation",
    conditions: [{ path: "event.serviceStyle", operator: "eq", value: "Buffet" }],
    effect: {
      operator: "recommend",
      componentRef: { componentType: "addon", componentId: "coffee" }
    },
    reason: "Offer a practical beverage continuation for buffet service.",
    enabled: false
  }
];

const CATALOG = {
  packages: DEFAULT_PACKAGES.map((offer, index) => ({
    ...offer,
    active: true,
    costPpp: [11.5, 15.25, 20.75][index],
    includedAddonIds: index === 0 ? ["tea"] : index === 1 ? ["coffee"] : ["dessert", "coffee"],
    includedRentalIds: index === 2 ? ["linens"] : [],
    choiceGroups: index === 0 ? [{
      id: "beverage-service-choice",
      label: "Choose one beverage service",
      componentType: "addon",
      componentIds: ["tea", "coffee"],
      minChoices: 1,
      maxChoices: 1
    }] : [],
    ruleRefs: index === 0 ? ["large-event-staffing"] : []
  })),
  addons: DEFAULT_ADDONS,
  rentals: DEFAULT_RENTALS,
  settings: {
    ...DEFAULT_SETTINGS,
    catalogRevision: 12,
    pricingSetupConfirmed: true,
    pricingConfirmation: {
      actorUid: "ambient-library-admin",
      actorEmail: "ambient-library-admin@example.test",
      confirmedAtISO: "2026-08-12T15:00:00.000Z",
      confirmedCatalogRevision: 12
    },
    menuSections: [],
    eventTemplates: DEFAULT_EVENT_TEMPLATES.slice(0, 2),
    configurationRules: CONFIGURATION_RULES
  }
};

async function seedLibrary(page) {
  await page.addInitScript((catalog) => {
    localStorage.setItem("quoteWizard.catalog.e2e-org", JSON.stringify(catalog));
  }, CATALOG);
}

async function openAmbientLibrary(page) {
  await page.goto("/app/catalog");
  const title = page.locator("#ambient-library-title");
  await expect(title).toHaveText("The choices behind every quote.", {
    timeout: LAZY_SURFACE_TIMEOUT_MS
  });
  await expect(title).toBeFocused();
  await expect(page).toHaveURL(/\/app\/catalog$/u);
  await expect(page.locator(".ambient-library")).toHaveAttribute(
    "data-library-context",
    "standalone"
  );
  return title;
}

async function readPersistedCatalog(page) {
  return page.evaluate(() => localStorage.getItem("quoteWizard.catalog.e2e-org"));
}

async function beforeUnloadIsProtected(page) {
  return page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
}

async function beginLibraryAcknowledgementObservation(page, actionId) {
  await page.evaluate((requestedActionId) => {
    const action = document.querySelector(`[data-library-action-id="${requestedActionId}"]`);
    if (!action) throw new Error(`Library action ${requestedActionId} is not mounted.`);

    const observation = {
      actionId: requestedActionId,
      activationAt: null,
      acknowledgementAt: null,
      acknowledgementMs: null,
      resultKind: "",
      message: ""
    };
    window.__ambientLibraryAcknowledgementObservation = observation;

    const captureAcknowledgement = () => {
      const acknowledgement = document.querySelector("[data-library-acknowledgement]");
      if (!acknowledgement || observation.activationAt === null) return false;
      observation.acknowledgementAt = performance.now();
      observation.acknowledgementMs = observation.acknowledgementAt - observation.activationAt;
      observation.resultKind = acknowledgement.getAttribute("data-result-kind") || "";
      observation.message = acknowledgement.textContent || "";
      return true;
    };

    action.addEventListener("click", () => {
      observation.activationAt = performance.now();
    }, { capture: true, once: true });
    const observer = new MutationObserver(() => {
      if (!captureAcknowledgement()) return;
      observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  }, actionId);
}

async function layoutAudit(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const rect = (element) => {
      const value = element.getBoundingClientRect();
      return {
        left: value.left,
        top: value.top,
        right: value.right,
        bottom: value.bottom,
        width: value.width,
        height: value.height
      };
    };
    const overlap = (left, right) => (
      Math.min(left.right, right.right) - Math.max(left.left, right.left) > 1
      && Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > 1
    );
    const editing = Boolean(document.querySelector(".ambient-library--editing"));
    const requiredGroups = editing
      ? [
          ".ambient-library__orientation",
          ".ambient-library__editor .modal-head",
          ".ambient-library__editor .admin-tabs"
        ]
      : [
          ".ambient-library__masthead",
          ".ambient-library__workspace",
          '[data-library-section="catalog"] .ambient-library__row-list',
          '[data-library-section="components"] .ambient-library__row-list',
          '[data-library-section="templates"] .ambient-library__row-list'
        ];
    const optionalGroups = editing
      ? [".ambient-library__editor .admin-section-head"]
      : [
          ".ambient-library__usage",
          ".ambient-library__template-list"
        ];
    const collisions = [];
    let auditedGroupCount = 0;
    for (const selector of requiredGroups) {
      const root = document.querySelector(selector);
      if (!root) return { setupError: `Missing declared Library layout group ${selector}.` };
      if (!visible(root)) continue;
      auditedGroupCount += 1;
      const children = [...root.children].filter(visible);
      children.forEach((leftElement, leftIndex) => {
        children.slice(leftIndex + 1).forEach((rightElement) => {
          if (overlap(rect(leftElement), rect(rightElement))) {
            collisions.push({
              group: selector,
              left: leftElement.className || leftElement.tagName,
              right: rightElement.className || rightElement.tagName
            });
          }
        });
      });
    }
    optionalGroups.forEach((selector) => {
      const root = document.querySelector(selector);
      if (!root || !visible(root)) return;
      auditedGroupCount += 1;
      const children = [...root.children].filter(visible);
      children.forEach((leftElement, leftIndex) => {
        children.slice(leftIndex + 1).forEach((rightElement) => {
          if (overlap(rect(leftElement), rect(rightElement))) {
            collisions.push({
              group: selector,
              left: leftElement.className || leftElement.tagName,
              right: rightElement.className || rightElement.tagName
            });
          }
        });
      });
    });
    const controls = [...document.querySelectorAll(".ambient-library button:not([disabled]), .ambient-library input:not([disabled]), .ambient-library select:not([disabled])")]
      .filter(visible)
      .map((element) => {
        const pointerTarget = element.matches('input[type="checkbox"], input[type="radio"]')
          ? element.closest("label") || element
          : element;
        return {
          label: element.getAttribute("aria-label") || pointerTarget.textContent.trim() || element.name,
          width: rect(pointerTarget).width,
          height: rect(pointerTarget).height
        };
      });
    const globalUtility = document.querySelector('[data-ambient-utility="new-quote"]');
    const utilityCollisions = globalUtility && visible(globalUtility)
      ? [...document.querySelectorAll(".ambient-library button:not([disabled])")]
        .filter(visible)
        .filter((element) => overlap(rect(globalUtility), rect(element)))
        .map((element) => element.getAttribute("aria-label") || element.textContent.trim())
      : [];
    const surface = document.querySelector(".ambient-library");
    const workspace = document.querySelector(".ambient-library__workspace");
    const catalogColumn = document.querySelector(".ambient-library__catalog-column");
    const readinessRail = document.querySelector("[data-library-readiness-rail]");
    const catalogRect = catalogColumn ? rect(catalogColumn) : null;
    const readinessRect = readinessRail ? rect(readinessRail) : null;
    return {
      setupError: "",
      auditedGroupCount,
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      surfaceOverflow: surface ? surface.scrollWidth - surface.clientWidth : null,
      collisions,
      utilityCollisions,
      undersizedControls: controls.filter((control) => control.width < 44 || control.height < 44),
      workspaceGeometry: workspace && catalogRect && readinessRect ? {
        mode: window.innerWidth >= 981 ? "split" : "stack",
        catalogShare: catalogRect.width / (catalogRect.width + readinessRect.width),
        catalogRight: catalogRect.right,
        catalogBottom: catalogRect.bottom,
        readinessLeft: readinessRect.left,
        readinessTop: readinessRect.top
      } : null
    };
  });
}

test.describe("Ambient Library", () => {
  test.skip(
    !AMBIENT_UI_ENABLED || !CUSTOMER_CENTERED_WORKSPACE_ENABLED,
    "Requires the Ambient UI and customer-centered workspace presentation gates."
  );

  for (const viewport of VIEWPORTS) {
    test(`keeps standalone Library truthful, accessible, and overlap-safe at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await seedLibrary(page);
      await openAmbientLibrary(page);

      await expect(page.locator("#ambient-library-offers-title")).toHaveText("Sellable offers");
      await expect(page.locator('[data-library-section="catalog"]')).toBeVisible();
      await expect(page.locator('[data-library-section="components"]')).toBeVisible();
      await expect(page.locator('[data-library-section="templates"]')).toBeVisible();
      await expect(page.locator('[data-library-section="policy"]')).toBeVisible();
      await expect(page.locator("[data-library-readiness-rail]")).toBeVisible();
      const readinessRows = page.locator(".business-setup-center__attention [data-readiness-id]");
      const readinessIcons = readinessRows.locator("[data-readiness-icon]");
      expect(await readinessIcons.count()).toBe(await readinessRows.count());
      expect(await readinessIcons.evaluateAll((icons) => (
        icons.every((icon) => icon.getAttribute("aria-hidden") === "true")
      ))).toBe(true);
      await expect(page.locator('[data-library-record-kind="event-template"]')).toHaveCount(2);
      await expect(page.locator("#catalog-admin-title")).toHaveCount(0);
      await expect(page.locator(".ambient-library__usage")).toContainText("Available from opportunities");
      await expect(page.locator(".ambient-library__masthead")).toContainText("Define what you sell");
      await expect(page.locator("body")).not.toContainText("Every new quote");
      await expect(page.locator("body")).not.toContainText("Return to Rivera Wedding");

      const audit = await layoutAudit(page);
      expect(audit.setupError).toBe("");
      expect(audit.auditedGroupCount).toBeGreaterThanOrEqual(3);
      expect(audit.documentOverflow).toBeLessThanOrEqual(1);
      expect(audit.surfaceOverflow).toBeLessThanOrEqual(1);
      expect(audit.collisions).toEqual([]);
      expect(audit.utilityCollisions).toEqual([]);
      expect(audit.undersizedControls).toEqual([]);
      expect(audit.workspaceGeometry).not.toBeNull();
      if (viewport.width === 1440) {
        expect(audit.workspaceGeometry.mode).toBe("split");
        expect(audit.workspaceGeometry.catalogShare).toBeGreaterThanOrEqual(0.64);
        expect(audit.workspaceGeometry.catalogShare).toBeLessThanOrEqual(0.7);
        expect(audit.workspaceGeometry.readinessLeft).toBeGreaterThanOrEqual(audit.workspaceGeometry.catalogRight);
      } else {
        expect(audit.workspaceGeometry.mode).toBe("stack");
        expect(audit.workspaceGeometry.readinessTop).toBeGreaterThanOrEqual(audit.workspaceGeometry.catalogBottom);
      }

      const accessibility = await new AxeBuilder({ page }).analyze();
      expect(accessibility.violations).toEqual([]);

      if (CAPTURE_PROOF) {
        mkdirSync(PROOF_DIRECTORY, { recursive: true });
        await page.screenshot({
          path: `${PROOF_DIRECTORY}/ambient-library-${viewport.width}.png`,
          fullPage: true
        });
      }
    });
  }

  test("captures the selected desktop Library composition at the exact reference viewport", async ({ page }) => {
    await page.setViewportSize(REFERENCE_VIEWPORT);
    await seedLibrary(page);
    await openAmbientLibrary(page);

    expect(page.viewportSize()).toEqual(REFERENCE_VIEWPORT);
    await expect(page.locator(".ambient-library__workspace")).toBeVisible();
    const audit = await layoutAudit(page);
    expect(audit.setupError).toBe("");
    expect(audit.workspaceGeometry.mode).toBe("split");
    expect(audit.workspaceGeometry.catalogShare).toBeGreaterThanOrEqual(0.64);
    expect(audit.workspaceGeometry.catalogShare).toBeLessThanOrEqual(0.7);

    if (CAPTURE_PROOF) {
      mkdirSync(PROOF_DIRECTORY, { recursive: true });
      await page.screenshot({
        path: `${PROOF_DIRECTORY}/ambient-library-reference-1487x1058.png`,
        fullPage: false
      });
    }
  });

  test("opens the selected Offer editor without creating another catalog authority", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await seedLibrary(page);
    await openAmbientLibrary(page);

    await page.locator('[data-library-action-id="review-library-packages"]').click();
    await expect(page.locator('[data-admin-tab-id="packages"]')).toHaveClass(/active/u);
    await expect(page.locator("#catalog-admin-title")).toHaveText("Offers");
    await expect(page.locator(".ambient-library__orientation")).toHaveText(/Library\s*\/\s*Offers/u);
    const workspace = page.locator('[data-package-workspace="true"]');
    await expect(workspace).toBeVisible();
    await expect(workspace.getByRole("heading", { name: "Customer-ready catering packages" })).toBeVisible();
    await expect(workspace.locator(".package-workspace-shell > *")).toHaveCount(2);
    await expect(workspace.locator(".package-workspace-health-desktop")).toHaveCount(0);
    await expect(workspace.locator('.package-workspace-nav-item[aria-pressed="true"]')).toContainText("Classic");
    await expect(workspace.locator(".package-workspace-next")).toBeVisible();
    const disclosures = workspace.locator(".package-workspace-object-section");
    await expect(disclosures).toHaveCount(7);
    expect(await disclosures.evaluateAll((elements) => elements.map((element) => ({
      section: element.getAttribute("data-package-section"),
      open: element.open
    })))).toEqual([
      { section: "basics", open: false },
      { section: "included", open: false },
      { section: "choices", open: false },
      { section: "rules", open: false },
      { section: "pricing", open: false },
      { section: "usage", open: false },
      { section: "advanced", open: false }
    ]);
    const choices = workspace.locator('[data-package-section="choices"]');
    await choices.locator("summary").click();
    await expect(choices).toContainText("Choose one beverage service");
    await expect(choices).toContainText("Choose at least 1 and no more than 1");
    await expect(choices.locator("input, select, button")).toHaveCount(0);
    const rules = workspace.locator('[data-package-section="rules"]');
    await expect(rules.locator("input, select, button")).toHaveCount(0);

    if (CAPTURE_PROOF) {
      mkdirSync(PROOF_DIRECTORY, { recursive: true });
      await page.screenshot({
        path: `${PROOF_DIRECTORY}/nested-after-offer-1440.png`,
        fullPage: true
      });
    }

    await choices.locator("summary").click();
    const basics = workspace.locator('[data-package-section="basics"]');
    await basics.locator("summary").click();
    const name = workspace.getByLabel("Customer-facing offer name");
    await name.fill("Classic service");
    await basics.locator("summary").click();
    await workspace.locator('[data-package-section="pricing"] > summary').click();
    await expect(name).toHaveValue("Classic service");
    await expect(workspace.locator('[data-package-section="advanced"]')).toHaveJSProperty("open", false);

    const accessibility = await new AxeBuilder({ page })
      .include('[data-package-workspace="true"]')
      .analyze();
    expect(accessibility.violations).toEqual([]);
  });

  test("keeps the Offer object flow compact and intentional on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedLibrary(page);
    await openAmbientLibrary(page);

    await page.locator('[data-library-action-id="review-library-packages"]').click();
    const workspace = page.locator('[data-package-workspace="true"]');
    await expect(workspace.locator(".package-workspace-primary-summary")).toContainText("Selling price");
    await expect(workspace.locator(".package-workspace-mobile-switcher")).toBeVisible();
    expect(await workspace.locator(".package-workspace-object-section").evaluateAll(
      (elements) => elements.every((element) => element.open === false)
    )).toBe(true);

    const basics = workspace.locator('[data-package-section="basics"]');
    await basics.locator("summary").click();
    await expect(workspace.getByLabel("Customer-facing offer name")).toBeVisible();
    await basics.locator("summary").click();
    const included = workspace.locator('[data-package-section="included"]');
    await included.locator("summary").click();
    await expect(included.locator(".package-workspace-composition")).toBeVisible();
    expect(await page.evaluate(() => (
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    ))).toBeLessThanOrEqual(1);

    const accessibility = await new AxeBuilder({ page })
      .include('[data-package-workspace="true"]')
      .analyze();
    expect(accessibility.violations).toEqual([]);

    if (CAPTURE_PROOF) {
      mkdirSync(PROOF_DIRECTORY, { recursive: true });
      await page.screenshot({
        path: `${PROOF_DIRECTORY}/nested-after-offer-390.png`,
        fullPage: true
      });
    }
  });

  test("keeps Component objects compact while preserving usage and staged edits on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedLibrary(page);
    await openAmbientLibrary(page);

    await page.locator('[data-library-action-id="review-library-addons"]').click();
    await expect(page.locator('[data-admin-tab-id="addons"]')).toHaveClass(/active/u);
    const collection = page.locator('[data-commercial-component-collection="addons"]');
    const records = collection.locator('[data-commercial-component-kind="addon"]');
    await expect(records).toHaveCount(3);
    expect(await records.evaluateAll((elements) => elements.every((element) => element.open === false))).toBe(true);

    const tea = collection.locator('[data-commercial-component-id="tea"]');
    const teaSummary = tea.locator(":scope > summary");
    await expect(teaSummary).toContainText("Sweet Tea");
    await expect(teaSummary).toContainText("$1.50");
    await teaSummary.click();
    const usage = tea.locator('[data-commercial-component-group="usage"]');
    await expect(usage).toContainText("Classic");
    await expect(usage).toContainText("Corporate");
    await expect(usage).not.toContainText("beverage-service-choice");
    await expect(tea.locator('[data-commercial-component-group="technical"]')).toHaveJSProperty("open", false);

    const name = tea.getByLabel("Add-on 2 display name");
    await name.fill("House sweet tea");
    await teaSummary.click();
    const dessert = collection.locator('[data-commercial-component-id="dessert"]');
    await dessert.locator(":scope > summary").click();
    await dessert.locator(":scope > summary").click();
    await teaSummary.click();
    await expect(name).toHaveValue("House sweet tea");
    expect(await page.evaluate(() => (
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    ))).toBeLessThanOrEqual(1);

    const accessibility = await new AxeBuilder({ page })
      .include('[data-commercial-component-collection="addons"]')
      .analyze();
    expect(accessibility.violations).toEqual([]);

    if (CAPTURE_PROOF) {
      mkdirSync(PROOF_DIRECTORY, { recursive: true });
      await page.screenshot({
        path: `${PROOF_DIRECTORY}/nested-after-components-390.png`,
        fullPage: true
      });
    }
  });

  test("presents configured quote rules as a readable ledger before advanced source", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await seedLibrary(page);
    await openAmbientLibrary(page);

    await page.locator('[data-library-action-id="review-library-rules"]').click();
    await expect(page.locator('[data-admin-tab-id="rules"]')).toHaveClass(/active/u);
    const rules = page.locator('[data-commercial-library-section="rules"]');
    await expect(rules.locator("[data-configuration-rule-ledger]")).toBeVisible();
    await expect(rules.locator("[data-configuration-rule-id]")).toHaveCount(2);
    const staffingRule = rules.locator('[data-configuration-rule-id="large-event-staffing"]');
    const coffeeRule = rules.locator('[data-configuration-rule-id="buffet-coffee-recommendation"]');
    await expect(staffingRule)
      .toContainText("Guests is at least 150 AND Service style is Buffet");
    await expect(rules.locator('[data-configuration-rule-id="large-event-staffing"]'))
      .toContainText("Require Servers: 4");
    await expect(rules.locator('[data-configuration-rule-id="large-event-staffing"]'))
      .toContainText("Large events need a minimum service team.");
    await expect(rules.locator('[data-configuration-rule-id="large-event-staffing"] [data-rule-statement="why"]'))
      .toBeVisible();
    await expect(coffeeRule).toContainText("Recommend Coffee Station");
    await expect(coffeeRule).toContainText("Off");
    const advancedSource = rules.locator("details", { hasText: "Advanced rule source" });
    await expect(advancedSource).toHaveJSProperty("open", false);
    await expect(rules.locator("[data-configuration-rules-editor]")).toBeHidden();

    const staffingEditor = rules.locator('[data-configuration-rule-editor="0"]');
    const coffeeEditor = rules.locator('[data-configuration-rule-editor="1"]');
    await expect(staffingEditor).toHaveJSProperty("open", false);
    await expect(coffeeEditor).toHaveJSProperty("open", false);
    await staffingEditor.locator("summary").click();
    await expect(staffingEditor.getByLabel("Large events need staffing condition 1 path"))
      .toHaveValue("event.guests");
    await expect(staffingEditor.getByLabel("Large events need staffing condition 1 path"))
      .toContainText("Guests");
    await expect(staffingEditor.getByLabel("Large events need staffing condition 1 operator"))
      .toContainText("Is at least");

    const threshold = staffingEditor.getByLabel("Large events need staffing condition 1 value");
    const reason = staffingEditor.getByLabel("Large events need staffing reason");
    await threshold.fill("175");
    await reason.fill("Large buffet events need confirmed coverage.");
    await staffingEditor.locator("summary").click();
    await coffeeEditor.locator("summary").click();
    await coffeeEditor.locator("summary").click();
    await staffingEditor.locator("summary").click();
    await expect(threshold).toHaveValue("175");
    await expect(reason).toHaveValue("Large buffet events need confirmed coverage.");
    await expect(page.getByRole("button", { name: "Try saving again" })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Save draft now" })).toHaveCount(0);

    const audit = await layoutAudit(page);
    expect(audit.setupError).toBe("");
    expect(audit.utilityCollisions).toEqual([]);

    const accessibility = await new AxeBuilder({ page })
      .include('[data-commercial-library-section="rules"]')
      .analyze();
    expect(accessibility.violations).toEqual([]);

    if (CAPTURE_PROOF) {
      mkdirSync(PROOF_DIRECTORY, { recursive: true });
      await page.screenshot({
        path: `${PROOF_DIRECTORY}/nested-after-rules-1440.png`,
        fullPage: true
      });
    }

    await staffingEditor.locator("summary").click();
    await advancedSource.locator("summary").click();
    const preservedRules = JSON.parse(await rules.locator("[data-configuration-rules-editor]").inputValue());
    expect(preservedRules[0].conditions[0]).toMatchObject({
      path: "event.guests",
      operator: "gte",
      value: 175,
      forwardEvidence: "condition-preserve"
    });
    expect(preservedRules[0].effect).toMatchObject({
      operator: "require",
      target: "resources.servers",
      value: 4,
      forwardEvidence: "effect-preserve"
    });
    expect(preservedRules[0].reason).toBe("Large buffet events need confirmed coverage.");
    expect(preservedRules[0].futurePolicy).toEqual({ channel: "preserve" });
  });

  test("keeps structured Rules compact and state-safe on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedLibrary(page);
    await openAmbientLibrary(page);

    await page.locator('[data-library-action-id="review-library-rules"]').click();
    const rules = page.locator('[data-commercial-library-section="rules"]');
    const editors = rules.locator("[data-configuration-rule-editor]");
    const advancedSource = rules.locator("[data-configuration-rule-technical-source]");
    await expect(rules.locator("[data-configuration-rule-id]")).toHaveCount(2);
    expect(await editors.evaluateAll((elements) => elements.every((element) => element.open === false))).toBe(true);
    await expect(advancedSource).toHaveJSProperty("open", false);

    const staffingEditor = rules.locator('[data-configuration-rule-editor="0"]');
    const coffeeEditor = rules.locator('[data-configuration-rule-editor="1"]');
    await staffingEditor.locator("summary").click();
    const threshold = staffingEditor.getByLabel("Large events need staffing condition 1 value");
    await threshold.fill("165");
    await staffingEditor.locator("summary").click();
    await coffeeEditor.locator("summary").click();
    await coffeeEditor.locator("summary").click();
    await staffingEditor.locator("summary").click();
    await expect(threshold).toHaveValue("165");

    const audit = await layoutAudit(page);
    expect(audit.setupError).toBe("");
    expect(audit.documentOverflow).toBeLessThanOrEqual(1);
    expect(audit.surfaceOverflow).toBeLessThanOrEqual(1);
    expect(audit.collisions).toEqual([]);
    expect(audit.utilityCollisions).toEqual([]);
    expect(audit.undersizedControls).toEqual([]);
    const accessibility = await new AxeBuilder({ page })
      .include('[data-commercial-library-section="rules"]')
      .analyze();
    expect(accessibility.violations).toEqual([]);

    if (CAPTURE_PROOF) {
      mkdirSync(PROOF_DIRECTORY, { recursive: true });
      await page.screenshot({
        path: `${PROOF_DIRECTORY}/nested-after-rules-390.png`,
        fullPage: true
      });
    }
  });

  test("explains pricing authority before exposing detailed defaults", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await seedLibrary(page);
    await openAmbientLibrary(page);

    await page.locator('[data-library-action-id="review-library-pricing"]').click();
    await expect(page.locator('[data-admin-tab-id="pricing"]')).toHaveClass(/active/u);
    const pricing = page.locator('[data-commercial-library-section="pricing"]');
    await expect(pricing.getByRole("heading", { name: "Pricing readiness" })).toBeVisible();
    await expect(pricing.locator("[data-pricing-policy-summary]")).toBeVisible();
    await expect(pricing.locator('[data-pricing-explanation="quote-waterfall"]'))
      .toContainText(/no shared catalog or pricing changed|Draft edits do not affect active quote calculations/u);
    await expect(pricing).toContainText("Each quote keeps its own exact total and line-by-line price explanation");
    await expect(page.getByLabel("Pricing setup reviewed and approved")).toBeChecked();
    const policyGroups = page.locator("[data-pricing-policy-group]");
    await expect(policyGroups).toHaveCount(6);
    expect(await policyGroups.evaluateAll((elements) => elements.map((element) => ({
      group: element.getAttribute("data-pricing-policy-group"),
      open: element.tagName === "DETAILS" ? element.open : true
    })))).toEqual([
      { group: "base", open: true },
      { group: "adjustments-context", open: false },
      { group: "fees", open: false },
      { group: "tax", open: false },
      { group: "deposit", open: false },
      { group: "advanced", open: false }
    ]);

    const serverRate = page.getByLabel("Default server rate");
    await serverRate.fill("66");
    const adjustments = page.locator('[data-pricing-policy-group="adjustments-context"]');
    await adjustments.locator(":scope > summary").click();
    await adjustments.locator(":scope > summary").click();
    await expect(serverRate).toHaveValue("66");

    if (CAPTURE_PROOF) {
      mkdirSync(PROOF_DIRECTORY, { recursive: true });
      await page.screenshot({
        path: `${PROOF_DIRECTORY}/nested-after-pricing-1440.png`,
        fullPage: true
      });
    }
  });

  test("keeps advanced pricing policy compact and preserves a mobile nested edit", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedLibrary(page);
    await openAmbientLibrary(page);

    await page.locator('[data-library-action-id="review-library-pricing"]').click();
    const advanced = page.locator('[data-pricing-policy-group="advanced"]');
    await expect(advanced).toHaveJSProperty("open", false);
    await expect(advanced.locator("[data-pricing-policy-attention]"))
      .toContainText("Needs attention");
    await advanced.locator(":scope > summary").click();

    const nestedPolicies = advanced.locator("[data-pricing-policy-advanced-section]");
    await expect(nestedPolicies).toHaveCount(8);
    expect(await nestedPolicies.evaluateAll((elements) => (
      elements.every((element) => element.open === false)
    ))).toBe(true);
    await expect(advanced.getByLabel("Server cost rate")).toBeHidden();
    await expect(advanced.getByLabel("Retry limit")).toBeHidden();
    await expect(advanced.getByLabel("Business name")).toBeHidden();

    if (CAPTURE_PROOF) {
      mkdirSync(PROOF_DIRECTORY, { recursive: true });
      await page.screenshot({
        path: `${PROOF_DIRECTORY}/nested-after-pricing-390.png`,
        fullPage: true
      });
    }

    const margin = advanced.locator('[data-pricing-policy-advanced-section="margin"]');
    const brand = advanced.locator('[data-pricing-policy-advanced-section="brand"]');
    await margin.locator("summary").click();
    const serverCost = margin.getByLabel("Server cost rate");
    await serverCost.fill("28");
    await margin.locator("summary").click();
    await brand.locator("summary").click();
    await brand.locator("summary").click();
    await margin.locator("summary").click();
    await expect(serverCost).toHaveValue("28");

    if (CAPTURE_PROOF) {
      await page.screenshot({
        path: `${PROOF_DIRECTORY}/nested-after-pricing-margin-390.png`,
        fullPage: true
      });
    }

    expect(await page.evaluate(() => (
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    ))).toBeLessThanOrEqual(1);

    const accessibility = await new AxeBuilder({ page })
      .include('[data-pricing-policy-group="advanced"]')
      .analyze();
    expect(accessibility.violations).toEqual([]);
  });

  test("keeps Rules and Pricing hierarchy intact at tablet width", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await seedLibrary(page);
    await openAmbientLibrary(page);

    await page.locator('[data-library-action-id="review-library-rules"]').click();
    const rules = page.locator('[data-commercial-library-section="rules"]');
    await expect(rules.locator("[data-configuration-rule-id]")).toHaveCount(2);
    await expect(rules.locator("[data-configuration-rule-technical-source]")).toHaveJSProperty("open", false);
    let audit = await layoutAudit(page);
    expect(audit.documentOverflow).toBeLessThanOrEqual(1);
    expect(audit.utilityCollisions).toEqual([]);
    if (CAPTURE_PROOF) {
      await page.screenshot({ path: `${PROOF_DIRECTORY}/nested-after-rules-768.png`, fullPage: true });
    }

    await page.locator('[data-admin-tab-id="pricing"]').click();
    await expect(page.locator(".ambient-library__breadcrumb strong")).toHaveText("Pricing");
    await expect(page.locator("#catalog-admin-title")).toHaveText("Pricing");
    await expect(page.locator(".ambient-library--editing"))
      .toHaveAttribute("data-library-editor-section", "pricing");
    const pricingGroups = page.locator("[data-pricing-policy-group]");
    await expect(pricingGroups).toHaveCount(6);
    await expect(page.locator('[data-pricing-policy-group="advanced"]')).toHaveJSProperty("open", false);
    audit = await layoutAudit(page);
    expect(audit.documentOverflow).toBeLessThanOrEqual(1);
    expect(audit.utilityCollisions).toEqual([]);
    const accessibility = await new AxeBuilder({ page })
      .include(".ambient-library__editor")
      .analyze();
    expect(accessibility.violations).toEqual([]);
    if (CAPTURE_PROOF) {
      await page.screenshot({ path: `${PROOF_DIRECTORY}/nested-after-pricing-768.png`, fullPage: true });
    }
  });

  test("acknowledges a primary action within 250ms and opens its exact object", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await seedLibrary(page);
    await openAmbientLibrary(page);
    const persistedBeforeBrowse = await readPersistedCatalog(page);
    const action = page.locator(".ambient-library__next [data-library-action-id]");
    await expect(action).toHaveAttribute("data-library-action-id", "review-library-menu");

    await beginLibraryAcknowledgementObservation(page, "review-library-menu");
    await action.click();
    await expect(page.locator("[data-library-acknowledgement]")).toBeVisible();
    await page.waitForFunction(() => (
      window.__ambientLibraryAcknowledgementObservation?.acknowledgementAt !== null
    ));
    const observation = await page.evaluate(() => (
      window.__ambientLibraryAcknowledgementObservation
    ));
    expect(observation).toMatchObject({
      actionId: "review-library-menu",
      resultKind: "pending"
    });
    expect(observation.activationAt).not.toBeNull();
    expect(observation.acknowledgementMs).toBeGreaterThanOrEqual(0);
    expect(observation.acknowledgementMs).toBeLessThanOrEqual(250);
    expect(observation.message).toContain("Opening Menu");
    const menuTab = page.locator('[data-admin-tab-id="menu"]');
    await expect(menuTab).toHaveClass(/active/u);
    const acknowledgement = page.locator("[data-library-acknowledgement]");
    await expect(acknowledgement).toContainText("ready to use");
    await expect(acknowledgement).toBeFocused();
    expect(await readPersistedCatalog(page)).toBe(persistedBeforeBrowse);

    const audit = await layoutAudit(page);
    expect(audit.setupError).toBe("");
    expect(audit.auditedGroupCount).toBeGreaterThanOrEqual(3);
    expect(audit.documentOverflow).toBeLessThanOrEqual(1);
    expect(audit.surfaceOverflow).toBeLessThanOrEqual(1);
    expect(audit.collisions).toEqual([]);
    expect(audit.utilityCollisions).toEqual([]);
  });

  test("keeps a failed mobile menu draft until the operator explicitly discards it", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedLibrary(page);
    await openAmbientLibrary(page);

    await page.getByRole("button", { name: "Open menus" }).click();
    await expect(page.locator('[data-admin-tab-id="menu"]')).toHaveClass(/active/u);
    const editor = page.locator("#catalog-admin-title").locator("..").locator("..");
    const eventType = editor.getByRole("combobox", { name: "Event type", exact: true });
    await expect.poll(() => eventType.locator("option").count()).toBeGreaterThan(1);
    await eventType.selectOption({ index: 1 });
    const menuSection = editor.getByRole("combobox", { name: "Menu section", exact: true });
    await expect.poll(() => menuSection.locator("option").count()).toBeGreaterThan(1);
    await menuSection.selectOption({ index: 1 });

    const menuSectionDisclosure = editor.locator("details.admin-menu-disclosure")
      .filter({ hasText: "Manage menu sections" });
    if ((await menuSectionDisclosure.getAttribute("open")) === null) {
      await menuSectionDisclosure.locator("summary").click();
    }
    await editor.getByLabel("New menu section name").fill("Device buffer section");
    await editor.getByRole("button", { name: "Add Menu Section" }).click();
    await expect(menuSection.locator("option", { hasText: "Device buffer section" })).toHaveCount(1);
    await menuSection.selectOption({ index: 1 });

    const addItemDisclosure = editor.locator("details.admin-menu-add-item");
    if ((await addItemDisclosure.getAttribute("open")) === null) {
      await addItemDisclosure.locator("summary").click();
    }
    await editor.getByLabel("New menu item name").fill("Device buffer soup");
    await editor.getByLabel("New menu item price", { exact: true }).fill("12.34");
    await editor.getByRole("button", { name: "Add Item" }).click();
    await editor.getByLabel("Select Device buffer soup").check();
    await editor.getByLabel("Move selected items to menu section").selectOption({ label: "Device buffer section" });
    await editor.getByRole("button", { name: "Move selected" }).click();
    const draftStatus = editor.getByLabel("Library draft status");
    await expect(draftStatus.getByText("Library changes are waiting to save", { exact: true }))
      .toBeVisible({ timeout: 10_000 });
    await expect(draftStatus).toHaveAttribute("data-capability-state", "uncertain");
    await expect(draftStatus.getByText("No shared catalog or pricing changed.", { exact: false })).toBeVisible();
    await expect(editor.getByText("Changes waiting to save", { exact: true })).toBeVisible();
    await expect(editor.getByText("All changes saved", { exact: false })).toHaveCount(0);

    let closeDialogMessage = "";
    page.once("dialog", async (dialog) => {
      closeDialogMessage = dialog.message();
      await dialog.dismiss();
    });
    await editor.getByRole("button", { name: "Back to Library" }).click();
    expect(closeDialogMessage).toContain("Discard unsaved catalog, menu, and branding changes?");
    await expect(page.locator('[data-admin-tab-id="menu"]')).toHaveClass(/active/u);
    await expect(editor.getByText("Changes waiting to save", { exact: true })).toBeVisible();
    const menuBuilderAudit = await layoutAudit(page);
    expect(menuBuilderAudit.documentOverflow).toBeLessThanOrEqual(1);
    expect(menuBuilderAudit.surfaceOverflow).toBeLessThanOrEqual(1);
    expect(menuBuilderAudit.collisions).toEqual([]);
    const menuBuilderAccessibility = await new AxeBuilder({ page })
      .include(".admin-menu-builder")
      .analyze();
    expect(menuBuilderAccessibility.violations).toEqual([]);
    const draftBarAccessibility = await new AxeBuilder({ page })
      .include(".catalog-draft-state-bar")
      .analyze();
    expect(draftBarAccessibility.violations).toEqual([]);
    const stagedItem = await page.evaluate(() => {
      const key = Object.keys(localStorage)
        .find((candidate) => candidate.startsWith("quotepilot.catalog-setup-device-buffer.v1:"));
      const buffer = JSON.parse(localStorage.getItem(key) || "null");
      return buffer?.changes?.find((change) => change.payload?.name === "Device buffer soup") || null;
    });
    expect(stagedItem).toMatchObject({ intent: "create", payload: { priceMinor: 1234 } });
    if (CAPTURE_PROOF) {
      mkdirSync(PROOF_DIRECTORY, { recursive: true });
      await page.screenshot({
        path: `${PROOF_DIRECTORY}/ambient-library-recovery-390.png`,
        fullPage: true
      });
    }

    page.once("dialog", async (dialog) => dialog.accept());
    await editor.getByRole("button", { name: "Back to Library" }).click();
    await expect(page.getByRole("button", { name: "Open menus" })).toBeFocused();
  });

  test("opens the exact event template and restores Library orientation", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedLibrary(page);
    await openAmbientLibrary(page);
    const persistedBeforeBrowse = await readPersistedCatalog(page);
    await page.locator(".ambient-library__template-disclosure > summary").click();
    const wedding = page.locator('[data-library-record-kind="event-template"][data-library-record-id="wedding"]');
    const weddingAction = wedding.getByRole("button", { name: /Manage Wedding/u });
    await weddingAction.click();

    const exactRecord = page.locator('[data-library-record-kind="event-template"][data-library-record-id="wedding"]');
    await expect(exactRecord).toBeVisible();
    const summary = exactRecord.locator('[data-template-field="summary"]');
    await expect(summary).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator('[data-library-record-id="corporate"] [data-template-field="summary"]'))
      .toHaveAttribute("aria-expanded", "false");
    const templateGroups = exactRecord.locator("[data-template-group]");
    await expect(templateGroups).toHaveCount(8);
    expect(await templateGroups.evaluateAll((elements) => elements.map((element) => ({
      group: element.getAttribute("data-template-group"),
      open: element.open
    })))).toEqual([
      { group: "starting-offer", open: false },
      { group: "event-context", open: false },
      { group: "preselected-components", open: false },
      { group: "service-rental-defaults", open: false },
      { group: "staffing-resource-defaults", open: false },
      { group: "pricing-policy-defaults", open: false },
      { group: "remains-open", open: false },
      { group: "advanced", open: false }
    ]);
    await expect(exactRecord.locator('[data-template-field="id"]')).toBeHidden();
    const acknowledgement = page.locator("[data-library-acknowledgement]");
    await expect(acknowledgement).toContainText("requested template is ready");
    await expect(acknowledgement).toBeFocused();
    expect(await readPersistedCatalog(page)).toBe(persistedBeforeBrowse);

    const audit = await layoutAudit(page);
    expect(audit.setupError).toBe("");
    expect(audit.auditedGroupCount).toBeGreaterThanOrEqual(3);
    expect(audit.documentOverflow).toBeLessThanOrEqual(1);
    expect(audit.surfaceOverflow).toBeLessThanOrEqual(1);
    expect(audit.collisions).toEqual([]);
    expect(audit.utilityCollisions).toEqual([]);
    expect(audit.undersizedControls).toEqual([]);

    if (CAPTURE_PROOF) {
      mkdirSync(PROOF_DIRECTORY, { recursive: true });
      await page.screenshot({
        path: `${PROOF_DIRECTORY}/nested-after-template-390.png`,
        fullPage: true
      });
    }

    await page.getByRole("button", { name: "Back to Library" }).click();
    await expect(page.locator("#ambient-library-title")).toBeVisible();
    await expect(weddingAction).toBeFocused();
    await expect(page.locator("#catalog-admin-title")).toHaveCount(0);
  });

  test("guards unsaved template work and discards it only after explicit confirmation", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await seedLibrary(page);
    await openAmbientLibrary(page);
    const persistedBeforeDraft = await readPersistedCatalog(page);
    await page.locator(".ambient-library__template-disclosure > summary").click();
    const wedding = page.locator('[data-library-record-kind="event-template"][data-library-record-id="wedding"]');
    const weddingAction = wedding.getByRole("button", { name: /Manage Wedding/u });
    await weddingAction.click();
    const name = page.locator('[data-library-record-kind="event-template"][data-library-record-id="wedding"] [data-template-field="name"]');
    await name.fill("Wedding evening");
    const contextGroup = wedding.locator('[data-template-group="event-context"]');
    await contextGroup.locator("summary").click();
    const style = wedding.locator('[data-template-field="style"]');
    await style.fill("Family style");
    await contextGroup.locator("summary").click();
    const startingOfferGroup = wedding.locator('[data-template-group="starting-offer"]');
    await startingOfferGroup.locator("summary").click();
    await startingOfferGroup.locator("summary").click();
    await contextGroup.locator("summary").click();
    await expect(style).toHaveValue("Family style");

    if (CAPTURE_PROOF) {
      mkdirSync(PROOF_DIRECTORY, { recursive: true });
      await page.screenshot({
        path: `${PROOF_DIRECTORY}/nested-after-template-1440.png`,
        fullPage: true
      });
    }

    await expect.poll(() => beforeUnloadIsProtected(page)).toBe(true);
    expect(await readPersistedCatalog(page)).toBe(persistedBeforeDraft);

    const backToLibrary = page.getByRole("button", { name: "Back to Library" });
    let closeDialogMessage = "";
    page.once("dialog", async (dialog) => {
      closeDialogMessage = dialog.message();
      await dialog.dismiss();
    });
    await backToLibrary.click();
    expect(closeDialogMessage).toContain("Discard unsaved catalog, menu, and branding changes?");
    await expect(page).toHaveURL(/\/app\/catalog$/u);
    await expect(name).toHaveValue("Wedding evening");

    let navigationDialogMessage = "";
    page.once("dialog", async (dialog) => {
      navigationDialogMessage = dialog.message();
      await dialog.dismiss();
    });
    await page.locator('[data-ambient-orientation="now"]').click();
    expect(navigationDialogMessage).toContain("Discard unsaved catalog, menu, and branding changes?");
    await expect(page.locator("#catalog-admin-title")).toBeVisible();
    await expect(name).toHaveValue("Wedding evening");

    const acceptedDialogMessages = [];
    const acceptDiscard = async (dialog) => {
      acceptedDialogMessages.push(dialog.message());
      await dialog.accept();
    };
    page.on("dialog", acceptDiscard);
    await page.locator('[data-ambient-orientation="now"]').click();
    page.off("dialog", acceptDiscard);
    expect(acceptedDialogMessages.some((message) => (
      message.includes("Discard unsaved catalog, menu, and branding changes?")
    ))).toBe(true);
    await expect(page.locator("#ambient-library-title")).toHaveCount(0);
    await page.goBack();
    await expect(page.locator("#catalog-admin-title")).toBeVisible();
    await expect(page.locator('[data-library-record-id="wedding"] [data-template-field="name"]'))
      .toHaveValue("Wedding");
    expect(await readPersistedCatalog(page)).toBe(persistedBeforeDraft);

    const finalCloseDialogs = [];
    const acceptFinalClose = async (dialog) => {
      finalCloseDialogs.push(dialog.message());
      await dialog.accept();
    };
    page.on("dialog", acceptFinalClose);
    await backToLibrary.click();
    page.off("dialog", acceptFinalClose);
    expect(finalCloseDialogs.length).toBeGreaterThanOrEqual(1);
    expect(finalCloseDialogs.every((message) => (
      message.includes("Discard unsaved catalog, menu, and branding changes?")
    ))).toBe(true);
    await expect(page.locator("#ambient-library-title")).toBeVisible();
    await expect(weddingAction).toBeFocused();
    expect(await readPersistedCatalog(page)).toBe(persistedBeforeDraft);
    await expect.poll(() => beforeUnloadIsProtected(page)).toBe(false);
  });

  test("gives sales direct read-only Library readiness without an admin editor or duplicate main", async ({ page }) => {
    const salesPort = Number(process.env.PLAYWRIGHT_SALES_PORT || 4176);
    await page.setViewportSize({ width: 390, height: 844 });
    await seedLibrary(page);
    await page.goto(`http://127.0.0.1:${salesPort}/app/catalog`);
    await expect(page.locator("#ambient-library-title")).toHaveText("The choices behind every quote.", {
      timeout: LAZY_SURFACE_TIMEOUT_MS
    });
    await expect(page.locator("[data-library-readonly]")).toContainText("An administrator manages changes and publishing");
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.locator('[data-library-record-kind="catalog-section"] button')).toHaveCount(0);
    await expect(page.getByText("View only", { exact: true })).toHaveCount(0);
    await expect(page.locator("[data-library-readonly]")).toHaveCount(1);
    await expect(page.locator("body")).not.toContainText("Ask an administrator");
    await expect(page.locator("#catalog-admin-title")).toHaveCount(0);
    const audit = await layoutAudit(page);
    expect(audit.setupError).toBe("");
    expect(audit.documentOverflow).toBeLessThanOrEqual(1);
    expect(audit.surfaceOverflow).toBeLessThanOrEqual(1);
    expect(audit.collisions).toEqual([]);
    expect(audit.utilityCollisions).toEqual([]);
    expect(audit.undersizedControls).toEqual([]);
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);
    if (CAPTURE_PROOF) {
      mkdirSync(PROOF_DIRECTORY, { recursive: true });
      await page.screenshot({
        path: `${PROOF_DIRECTORY}/ambient-library-sales-readonly-390.png`,
        fullPage: true
      });
    }
  });
});
