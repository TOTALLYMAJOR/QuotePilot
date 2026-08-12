import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const AMBIENT_UI_ENABLED = ["1", "true", "yes", "on"].includes(
  String(process.env.VITE_AMBIENT_UI_ENABLED || "").trim().toLowerCase()
);
const AMBIENT_NOW_ENABLED = AMBIENT_UI_ENABLED && [
  process.env.VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED,
  process.env.VITE_PILOT_NOW_ENABLED
].every((value) => ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase()));
const LAZY_SURFACE_TIMEOUT_MS = 30_000;

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1440, height: 1000 }
];

async function seedAmbientOpportunity(page) {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("qp.workspaceSoundsEnabled", "false");
    localStorage.setItem("quoteWizard.quotes", JSON.stringify([{
      organizationId: "e2e-org",
      id: "ambient-a11y",
      quoteNumber: "Q-AMBIENT-A11Y",
      status: "draft",
      activeVersionId: "v0001",
      latestVersionNumber: 1,
      createdAtISO: "2026-08-11T12:00:00.000Z",
      updatedAtISO: "2026-08-11T12:00:00.000Z",
      customer: {
        name: "Maya Bennett",
        email: "maya@example.test",
        phone: "205-555-0184"
      },
      event: {
        name: "Autumn Benefit Dinner",
        date: "2026-09-19",
        time: "18:00",
        hours: 4,
        venue: "The Foundry Hall",
        venueAddress: "200 Foundry Way",
        style: "Plated",
        guests: 120,
        servers: 8,
        chefs: 3,
        bartenders: 0
      },
      selection: {
        eventTypeId: "wedding",
        packageId: "classic",
        packageName: "Classic",
        menuItems: ["wedding__meats__roasted-chicken"],
        menuItemNames: ["Roasted Chicken"],
        rentals: ["chairs"],
        addons: ["tea"],
        eventTemplateId: "custom"
      },
      totals: {
        total: 8400,
        deposit: 2520,
        serverLabor: 1200,
        chefLabor: 600,
        serviceFeePctApplied: 0.2,
        taxRateApplied: 0.1
      },
      lifecycle: { draftAtISO: "2026-08-11T12:00:00.000Z" }
    }]));
  });
}

async function openAmbientOpportunity(page) {
  await page.goto("/app/quotes/ambient-a11y");
  const surface = page.locator(".ambient-living-opportunity");
  await expect(surface).toBeVisible({ timeout: LAZY_SURFACE_TIMEOUT_MS });
  await expect(surface).toHaveAttribute("data-ambient-model", "pilot-slice-alpha-v1");
  return surface;
}

async function seedAmbientNowPriority(page) {
  await page.addInitScript(() => {
    const quotes = JSON.parse(localStorage.getItem("quoteWizard.quotes") || "[]");
    if (!quotes[0]) return;
    quotes[0].workflow = {
      ...(quotes[0].workflow || {}),
      followUp: { dueDate: "2026-08-10" }
    };
    localStorage.setItem("quoteWizard.quotes", JSON.stringify(quotes));
  });
}

test.describe("Ambient Intelligence accessibility contract", () => {
  test.skip(
    !AMBIENT_UI_ENABLED,
    "The Ambient Intelligence browser contract runs only when its default-off rollout flag is enabled."
  );

  test.beforeEach(async ({ page }) => {
    await seedAmbientOpportunity(page);
  });

  for (const viewport of VIEWPORTS) {
    test(`keeps the Ambient NOW briefing readable and operable at ${viewport.width}px`, async ({ page }) => {
      test.skip(!AMBIENT_NOW_ENABLED, "Ambient NOW accessibility requires both existing presentation gates.");
      await seedAmbientNowPriority(page);
      await page.setViewportSize(viewport);
      await page.goto("/app");

      const surface = page.locator(".ambient-now");
      await expect(surface).toBeVisible({ timeout: 30_000 });
      await expect(surface).toHaveAttribute("data-surface-contract-id", "ambient-now-briefing");
      await expect(surface.locator(".ambient-now-priority")).toHaveCount(1);
      expect(await surface.locator(".ambient-now-priority").count()).toBeLessThanOrEqual(3);
      await expect(surface.locator('[data-staff-evidence-presentation="compact"]')).toBeVisible();
      await expect(surface).toContainText("This view is partial; source details follow below.");

      const undersizedTargets = await surface.locator("button:visible, summary:visible").evaluateAll((controls) => (
        controls.map((control) => {
          const rect = control.getBoundingClientRect();
          return {
            label: control.getAttribute("aria-label") || control.textContent.trim(),
            width: rect.width,
            height: rect.height
          };
        }).filter(({ width, height }) => width < 44 || height < 44)
      ));
      expect(undersizedTargets).toEqual([]);
      expect(await page.evaluate(() => (
        document.documentElement.scrollWidth <= document.documentElement.clientWidth
      ))).toBe(true);
      expect(await surface.evaluate((root) => root.scrollWidth <= root.clientWidth)).toBe(true);

      const accessibility = await new AxeBuilder({ page })
        .include(".ambient-now")
        .analyze();
      expect(accessibility.violations).toEqual([]);

      const disclosure = surface.getByText("Read details", { exact: true });
      await disclosure.click();
      await expect(surface.getByText("Last complete read (device time)")).toBeVisible();
      const disclosedAccessibility = await new AxeBuilder({ page })
        .include(".ambient-now")
        .analyze();
      expect(disclosedAccessibility.violations).toEqual([]);
    });
  }

  for (const viewport of VIEWPORTS) {
    test(`earns its top layer and touch targets at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const surface = await openAmbientOpportunity(page);

      await expect(surface.getByRole("heading", { name: "Autumn Benefit Dinner" })).toBeVisible();
      await expect(surface.locator('[data-glance="state"]')).toContainText("Draft");
      await expect(surface.locator('[data-glance="risk"]')).toContainText("Staffing may need attention");
      await expect(surface.locator('[data-glance="next"]')).toContainText("Review draft");

      const comprehensionLayer = viewport.width <= 620
        ? surface.getByRole("region", { name: "Opportunity quick actions" })
        : surface.locator(".ambient-opportunity-glance");
      await expect(comprehensionLayer).toBeVisible();
      if (viewport.width <= 620) {
        await expect(comprehensionLayer.getByRole("heading", { name: "Autumn Benefit Dinner" })).toBeVisible();
        await expect(comprehensionLayer).toContainText(/State\s*Draft/u);
        await expect(comprehensionLayer).toContainText(/What matters\s*Staffing may need attention/u);
        await expect(comprehensionLayer).toContainText(/Next\s*Staffing may need attention/u);
        await expect(surface.locator(".ambient-opportunity-hero")).toBeHidden();
        await expect(surface.locator(".ambient-opportunity-glance")).toBeHidden();
      }

      const topLayer = await comprehensionLayer.evaluate((layer) => {
        const root = layer.closest(".ambient-living-opportunity");
        const rootRect = root.getBoundingClientRect();
        const layerRect = layer.getBoundingClientRect();
        return {
          height: layerRect.bottom - rootRect.top,
          viewportHeight: window.innerHeight
        };
      });
      expect(topLayer.height).toBeLessThanOrEqual(topLayer.viewportHeight);

      const undersizedTargets = await surface.locator("button:visible").evaluateAll((buttons) => (
        buttons.map((button) => {
          const rect = button.getBoundingClientRect();
          return {
            label: button.getAttribute("aria-label") || button.textContent.trim(),
            width: rect.width,
            height: rect.height
          };
        }).filter(({ width, height }) => width < 44 || height < 44)
      ));
      expect(undersizedTargets).toEqual([]);

      expect(await page.evaluate(() => (
        document.documentElement.scrollWidth <= document.documentElement.clientWidth
      ))).toBe(true);
      expect(await surface.evaluate((root) => root.scrollWidth <= root.clientWidth)).toBe(true);

      const accessibility = await new AxeBuilder({ page })
        .include(".ambient-living-opportunity")
        .analyze();
      expect(accessibility.violations).toEqual([]);
    });
  }

  test("preserves keyboard focus, causal text, and work when motion and sound are muted", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 1000 });
    const surface = await openAmbientOpportunity(page);

    const operationalTrigger = surface.getByRole("button", {
      name: "Show event, menu, staffing, and pricing"
    });
    await operationalTrigger.focus();
    await page.keyboard.press("Enter");
    const operational = surface.locator('[data-disclosure-layer="operational"]');
    await expect(operational).toBeVisible();
    await expect(operational).toBeFocused();
    await expect(surface.locator(".ambient-feedback-announcement"))
      .toContainText("item was added");
    expect(await operational.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");

    const supportingTrigger = surface.getByRole("button", { name: "Show more context" });
    await supportingTrigger.press("Enter");
    const supporting = surface.locator('[data-disclosure-layer="supporting"]');
    await expect(supporting).toBeFocused();
    await expect(supporting).toContainText("margin health is not inferred");

    const guestValue = surface.getByRole("button", { name: "Change Guest count scenario" });
    await guestValue.focus();
    await page.keyboard.press("Enter");
    const guestInput = surface.getByRole("spinbutton", { name: "Guest count scenario" });
    await expect(guestInput).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(guestValue).toBeFocused();

    const inspect = surface.getByRole("button", { name: "See connections" });
    await inspect.click();
    const dialog = page.getByRole("dialog", { name: "Guest count connections" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Why this is here");
    await expect(dialog).toContainText("What this affects");
    await expect(dialog).toContainText("If you do nothing");
    expect(await dialog.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");

    const dialogAccessibility = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .analyze();
    expect(dialogAccessibility.violations).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(inspect).toBeFocused();
    expect(await page.evaluate(() => localStorage.getItem("qp.workspaceSoundsEnabled"))).toBe("false");
  });

  test("ties a real disclosure action to causal dependent and next-action motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.setViewportSize({ width: 1440, height: 1000 });
    const surface = await openAmbientOpportunity(page);

    const disclosure = surface.getByRole("button", {
      name: "Show event, menu, staffing, and pricing"
    });
    await disclosure.evaluate((trigger) => {
      const root = trigger.closest(".ambient-living-opportunity");
      const observation = {
        activationAt: null,
        events: []
      };
      window.__ambientMotionObservation = observation;
      trigger.addEventListener("click", () => {
        observation.activationAt = performance.now();
      }, { capture: true, once: true });
      root.addEventListener("animationstart", (event) => {
        const dependent = event.target.matches?.("[data-ambient-feedback-dependent]");
        const nextAction = event.target.matches?.(".ambient-next-action");
        if (!dependent && !nextAction) return;
        observation.events.push({
          animationName: event.animationName,
          target: dependent ? "dependent" : "next-action",
          rootActive: root.classList.contains("ambient-feedback-event--active"),
          elapsedMs: observation.activationAt === null
            ? null
            : performance.now() - observation.activationAt
        });
      });
    });
    await disclosure.click();

    await page.waitForFunction(() => {
      const names = window.__ambientMotionObservation?.events.map((event) => event.animationName) || [];
      return names.includes("ambient-dependent-settle")
        && names.includes("ambient-next-action-replace");
    });
    const motionObservation = await page.evaluate(() => window.__ambientMotionObservation);
    expect(motionObservation.activationAt).not.toBeNull();
    expect(motionObservation.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        animationName: "ambient-dependent-settle",
        target: "dependent",
        rootActive: true
      }),
      expect.objectContaining({
        animationName: "ambient-next-action-replace",
        target: "next-action",
        rootActive: true
      })
    ]));
    await expect(surface.locator(".ambient-feedback-announcement"))
      .toContainText("item was added");
  });

  test("stages the staffing recommendation as visible unsaved editor work on mobile", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    const surface = await openAmbientOpportunity(page);

    const inspect = surface.getByRole("button", { name: "Review staffing" });
    await inspect.click();
    const dialog = page.getByRole("dialog", { name: "Staffing suggestion" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("8 servers · 3 chefs · 0 bartenders");
    await expect(dialog).toContainText("10 servers · 3 chefs · 0 bartenders");
    const sheetGeometry = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight
      };
    });
    expect(sheetGeometry).toMatchObject({
      left: 0,
      right: 390,
      viewportWidth: 390,
      viewportHeight: 844
    });
    expect(Math.abs(sheetGeometry.bottom - sheetGeometry.viewportHeight)).toBeLessThanOrEqual(4);
    const accessibility = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .analyze();
    expect(accessibility.violations).toEqual([]);

    await dialog.getByRole("button", { name: "Use recommendation" }).click();
    await expect(surface.locator('[data-intelligent-object="staffing"]'))
      .toHaveAttribute("data-scenario-state", "active");
    await dialog.getByRole("button", { name: "Stage staffing in editor" }).click();

    await expect(page.locator(".wizard-panel")).toBeVisible();
    await expect(page.locator(".workspace-save-state")).toHaveText("Unsaved changes");
    await expect(page.getByRole("spinbutton", { name: "Servers" })).toHaveValue("10");
    await expect(page.getByRole("spinbutton", { name: "Chefs" })).toHaveValue("3");
    await expect(page.getByRole("spinbutton", { name: "Bartenders" })).toHaveValue("0");
    await expect(page.locator(".source-note").filter({
      hasText: "Continue the active staffing recommendation"
    })).toBeVisible();
  });

  test("maps every enabled Alpha control and records an exact zero-dead-click route handoff", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const surface = await openAmbientOpportunity(page);
    await page.evaluate(() => {
      window.__ambientInteractionObservations = [];
      document.addEventListener("quotepilot:ambient-interaction", (event) => {
        window.__ambientInteractionObservations.push(event.detail);
      });
    });

    const unmapped = async () => surface.locator("button:visible:not(:disabled)").evaluateAll((buttons) => (
      buttons
        .filter((button) => !button.dataset.ambientActionId)
        .map((button) => button.getAttribute("aria-label") || button.textContent.trim())
    ));
    expect(await unmapped()).toEqual([]);

    await surface.getByRole("button", { name: "Why this?" }).click();
    await expect(page.getByRole("dialog", { name: "Why this recommendation appears" })).toBeVisible();
    expect(await unmapped()).toEqual([]);
    await page.getByRole("button", { name: "Close context" }).click();
    await expect(page.getByRole("dialog", { name: "Why this recommendation appears" })).toHaveCount(0);

    await surface.getByRole("button", { name: "Review draft" }).click();
    await expect(page.locator(".wizard-panel")).toBeVisible();

    const observations = await page.evaluate(() => window.__ambientInteractionObservations);
    const primaryReceipt = observations.find((item) => (
      item.phase === "acknowledge"
      && item.primary === true
      && item.resultKind === "pending"
    ));
    expect(primaryReceipt).toMatchObject({
      monitorAvailable: true,
      timedOut: false,
      monitor: {
        observedActionCount: 1,
        deadClickCount: 0,
        deadClickRate: 0
      }
    });
    expect(JSON.stringify(observations)).not.toContain("ambient-a11y");
    expect(JSON.stringify(observations)).not.toContain("Maya Bennett");
  });

  test("retains explicit controls and focus visibility in forced-colors mode", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await page.setViewportSize({ width: 768, height: 900 });
    const surface = await openAmbientOpportunity(page);
    expect(await page.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(true);

    const disclosure = surface.getByRole("button", {
      name: "Show event, menu, staffing, and pricing"
    });
    await disclosure.focus();
    const styles = await disclosure.evaluate((element) => {
      const style = getComputedStyle(element);
      return { borderStyle: style.borderTopStyle, outlineStyle: style.outlineStyle };
    });
    expect(styles.borderStyle).toBe("solid");
    expect(styles.outlineStyle).not.toBe("none");
  });
});
