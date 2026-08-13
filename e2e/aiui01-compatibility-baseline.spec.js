import { expect, test } from "@playwright/test";
import {
  AIUI01_ACKNOWLEDGEMENT_BUDGET_MS,
  AIUI01_PORTAL_PRECEDENCE,
  AIUI01_SHELL_ACTIONS,
  AIUI01_SURFACES,
  AIUI01_VIEWPORTS,
  getAiui01EnabledShellActions,
  getAiui01Surface,
  getAiui01SurfaceExpectation,
  resolveAiui01Flags
} from "../src/lib/aiui01CompatibilityBaseline.js";

const BASELINE_ENABLED = ["1", "true", "yes", "on"].includes(
  String(process.env.AIUI01_BASELINE_ENABLED || "").trim().toLowerCase()
);
const FLAGS = resolveAiui01Flags(process.env);
const EXPECTED_PROFILE = String(process.env.AIUI01_PROFILE || FLAGS.profileId).trim();
const HOST = "127.0.0.1";
const ADMIN_PORT = Number(process.env.PLAYWRIGHT_PORT || 4173);
const SALES_PORT = Number(process.env.PLAYWRIGHT_SALES_PORT || ADMIN_PORT + 3);
const PORTAL_TOKEN = "aiui01-portal-token-12345678901234567890";

function roleOrigin(role) {
  return `http://${HOST}:${role === "sales" ? SALES_PORT : ADMIN_PORT}`;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function routeUrl(role, path) {
  return `${roleOrigin(role)}${path}`;
}

function routeActions(role) {
  return getAiui01EnabledShellActions({ role, flags: FLAGS })
    .filter(({ classification }) => classification === "primary_route");
}

function expectedSurfaceProbe(surfaceId, role) {
  return getAiui01SurfaceExpectation(surfaceId, { role, flags: FLAGS });
}

async function installBaselineFixture(page) {
  await page.addInitScript(({ portalToken }) => {
    const createdAtISO = "2026-08-11T12:00:00.000Z";
    const sharedCustomer = {
      name: "AIUI Baseline Customer",
      email: "aiui01@example.test",
      phone: "205-555-0101",
      organization: "Baseline Events"
    };
    const quoteBase = {
      organizationId: "e2e-org",
      customerId: "aiui01-customer",
      activeVersionId: "v0001",
      latestVersionNumber: 1,
      createdAtISO,
      updatedAtISO: createdAtISO,
      customer: sharedCustomer,
      selection: {
        eventTypeId: "wedding",
        packageId: "classic",
        packageName: "Classic",
        menuItems: ["wedding__meats__roasted-chicken"],
        menuItemNames: ["Roasted Chicken"],
        addons: ["tea"],
        rentals: ["chairs"],
        eventTemplateId: "custom"
      },
      totals: {
        total: 8400,
        deposit: 2520,
        serverLabor: 1200,
        chefLabor: 600,
        serviceFee: 900,
        serviceFeePctApplied: 0.2,
        taxRateApplied: 0.1
      }
    };
    localStorage.setItem("qp.workspaceSoundsEnabled", "false");
    localStorage.setItem("quoteWizard.quotes", JSON.stringify([
      {
        ...quoteBase,
        id: "aiui01-quote",
        quoteNumber: "Q-AIUI-01",
        status: "draft",
        event: {
          name: "AIUI Compatibility Dinner",
          date: "2027-09-19",
          time: "18:00",
          hours: 4,
          venue: "Baseline Hall",
          venueAddress: "1 Baseline Way",
          style: "Plated",
          guests: 120,
          servers: 8,
          chefs: 3,
          bartenders: 0
        },
        portalDecision: {
          decision: "changes_requested",
          message: "Change to 130 guests and add one server.",
          requestId: "aiui01-change-request",
          submittedAtISO: createdAtISO
        },
        lifecycle: { draftAtISO: createdAtISO }
      },
      {
        ...quoteBase,
        id: "aiui01-portal-quote",
        quoteNumber: "Q-AIUI-PORTAL",
        status: "sent",
        portalKey: portalToken,
        portalIssuedAtISO: createdAtISO,
        portalExpiresAtISO: "2099-12-31T23:59:59.000Z",
        expiresAtISO: "2099-12-31T23:59:59.000Z",
        event: {
          name: "Portal Precedence Dinner",
          date: "2027-10-20",
          time: "18:00",
          hours: 4,
          venue: "Portal Hall",
          venueAddress: "2 Baseline Way",
          style: "Plated",
          guests: 90,
          servers: 7,
          chefs: 2,
          bartenders: 0
        },
        quoteMeta: {
          organizationName: "Northstar Events",
          brandName: "Northstar Catering",
          businessEmail: "events@northstar.test",
          businessPhone: "205-555-0100",
          brandPrimaryColor: "#8d611a",
          brandDarkAccentColor: "#5e3b08"
        },
        workflow: {
          quoteDelivery: {
            revisionId: `v0001@${createdAtISO}`,
            state: "provider_accepted",
            portalActivationState: "active",
            providerMessageId: "aiui01-provider-message",
            providerAcceptedAtISO: createdAtISO,
            portalKey: portalToken,
            portalIssuedAtISO: createdAtISO
          }
        },
        conversationSummary: {
          messageCount: 1,
          latestMessageId: "aiui01-message",
          latestMessageAtISO: createdAtISO,
          latestActorType: "customer"
        },
        lifecycle: { sentAtISO: createdAtISO }
      }
    ]));

    window.addEventListener("quotepilot:locationchange", () => {
      const pendingRaw = sessionStorage.getItem("aiui01.pending-route-action");
      if (!pendingRaw) return;
      const pending = JSON.parse(pendingRaw);
      const receipt = {
        actionId: pending.actionId,
        elapsedMs: performance.now() - pending.startedAt,
        pathname: window.location.pathname,
        search: window.location.search
      };
      const receipts = JSON.parse(sessionStorage.getItem("aiui01.route-receipts") || "[]");
      receipts.push(receipt);
      sessionStorage.setItem("aiui01.route-receipts", JSON.stringify(receipts));
      sessionStorage.removeItem("aiui01.pending-route-action");
    });
  }, { portalToken: PORTAL_TOKEN });
}

async function gotoRole(page, role, path) {
  await page.goto(routeUrl(role, path));
  await expect(page.locator(".site-header")).toBeVisible();
}

async function beginRouteObservation(control, actionId) {
  await control.evaluate((element, id) => {
    element.addEventListener("click", () => {
      sessionStorage.setItem("aiui01.pending-route-action", JSON.stringify({
        actionId: id,
        startedAt: performance.now()
      }));
    }, { capture: true, once: true });
  }, actionId);
}

async function beginContextObservation(control, actionId, selector) {
  await control.evaluate((element, { id, targetSelector }) => {
    element.addEventListener("click", () => {
      const startedAt = performance.now();
      const recordIfVisible = () => {
        const target = document.querySelector(targetSelector);
        if (!target) return false;
        const style = getComputedStyle(target);
        const rect = target.getBoundingClientRect();
        if (style.display === "none" || style.visibility === "hidden" || rect.width <= 0 || rect.height <= 0) {
          return false;
        }
        const receipts = JSON.parse(sessionStorage.getItem("aiui01.context-receipts") || "[]");
        receipts.push({ actionId: id, elapsedMs: performance.now() - startedAt, selector: targetSelector });
        sessionStorage.setItem("aiui01.context-receipts", JSON.stringify(receipts));
        return true;
      };
      if (recordIfVisible()) return;
      const observer = new MutationObserver(() => {
        if (recordIfVisible()) observer.disconnect();
      });
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    }, { capture: true, once: true });
  }, { id: actionId, targetSelector: selector });
}

async function readRouteReceipt(page, actionId) {
  await expect.poll(async () => page.evaluate((id) => {
    const receipts = JSON.parse(sessionStorage.getItem("aiui01.route-receipts") || "[]");
    return receipts.some((receipt) => receipt.actionId === id);
  }, actionId)).toBe(true);
  return page.evaluate((id) => {
    const receipts = JSON.parse(sessionStorage.getItem("aiui01.route-receipts") || "[]");
    return receipts.findLast((receipt) => receipt.actionId === id);
  }, actionId);
}

async function readContextReceipt(page, actionId) {
  await expect.poll(async () => page.evaluate((id) => {
    const receipts = JSON.parse(sessionStorage.getItem("aiui01.context-receipts") || "[]");
    return receipts.some((receipt) => receipt.actionId === id);
  }, actionId)).toBe(true);
  return page.evaluate((id) => {
    const receipts = JSON.parse(sessionStorage.getItem("aiui01.context-receipts") || "[]");
    return receipts.findLast((receipt) => receipt.actionId === id);
  }, actionId);
}

async function openOperationsMenu(page) {
  const header = page.locator(".site-header");
  const operations = header.getByRole("button", { name: "Operations", exact: true });
  if (await operations.isVisible()) {
    await operations.click();
    await expect(operations).toHaveAttribute("aria-expanded", "true");
    return header.getByRole("menu", { name: "Operations" });
  }
  const more = header.getByRole("button", { name: "More", exact: true });
  await expect(more).toBeVisible();
  await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  return header.getByRole("menu", { name: "More" });
}

async function findActionControl(page, action) {
  if (action.entry === "operations") {
    const menu = await openOperationsMenu(page);
    return menu.getByRole("menuitem", { name: action.label, exact: true });
  }
  const accessibleName = action.namePattern ? new RegExp(action.namePattern) : action.label;
  return page.locator(".site-header").getByRole("button", {
    name: accessibleName,
    exact: !action.namePattern
  });
}

async function resolveActivationMode(control) {
  try {
    await control.click({ trial: true, timeout: 750 });
    return "pointer";
  } catch {
    await control.focus();
    return "keyboard";
  }
}

async function expectNoDocumentOverflow(page) {
  const overflow = await page.evaluate(() => {
    const documentWidth = document.documentElement.clientWidth;
    const isContainedByHorizontalScrollBoundary = (element) => {
      for (let ancestor = element.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
        const overflowX = getComputedStyle(ancestor).overflowX;
        if (["auto", "scroll", "hidden", "clip"].includes(overflowX)
          && ancestor.scrollWidth > ancestor.clientWidth) return true;
      }
      return false;
    };
    const offenders = [...document.querySelectorAll("body *")]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return (rect.left < -1 || rect.right > documentWidth + 1)
          && !isContainedByHorizontalScrollBoundary(element);
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          selector: [
            element.tagName.toLowerCase(),
            element.id ? `#${element.id}` : "",
            ...[...element.classList].slice(0, 3).map((className) => `.${className}`)
          ].join(""),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width)
        };
      })
      .sort((a, b) => b.right - a.right)
      .slice(0, 10);
    return {
      clientWidth: documentWidth,
      scrollWidth: document.documentElement.scrollWidth,
      landmarks: [
        ".workspace-route-main",
        ".customer-directory",
        ".customer-directory-results-region",
        ".embedded-workspace-route",
        ".workspace-route-card"
      ].flatMap((selector) => [...document.querySelectorAll(selector)].map((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          selector,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          minWidth: style.minWidth,
          maxWidth: style.maxWidth,
          overflowX: style.overflowX
        };
      })),
      offenders
    };
  });
  const diagnostic = JSON.stringify(overflow, null, 2);
  expect(overflow.scrollWidth, diagnostic).toBe(overflow.clientWidth);
  expect(overflow.offenders, diagnostic).toEqual([]);
}

async function assertSurface(page, surfaceId, role) {
  const surface = getAiui01Surface(surfaceId);
  const expectation = expectedSurfaceProbe(surfaceId, role);
  await expect(page).toHaveURL(new RegExp(`${escapeRegex(surface.path)}(?:[?#]|$)`));
  await expect(page.locator(expectation.probe).first()).toBeVisible();
  await expectNoDocumentOverflow(page);
}

async function exerciseRouteAction(page, role, action) {
  const target = getAiui01Surface(action.targetSurfaceId);
  const legacyModalContext = !FLAGS.effective.workspace && action.legacyOutcome === "modal_context";
  const startPath = action.id === "home"
    ? "/app/quotes/new"
    : action.id === "new-quote"
      // Keep the action genuinely route-changing without probing a control
      // behind the intentionally modal legacy Quotes surface. Waiting on the
      // lazy modal and racing its overlay made pointer qualification dependent
      // on chunk timing rather than the shell action contract.
      ? FLAGS.effective.workspace
        ? "/app/quotes"
        : "/app/quotes/aiui01-quote/edit"
      : "/app";
  await gotoRole(page, role, startPath);
  const control = await findActionControl(page, action);
  await expect(control).toBeVisible();
  await expect(control).toBeEnabled();
  const activationMode = await resolveActivationMode(control);
  if (legacyModalContext) {
    await beginContextObservation(control, action.id, `.modal-loading-overlay, ${target.probes.default}`);
  } else {
    await beginRouteObservation(control, action.id);
  }
  const discardConfirmationHandler = action.id === "new-quote" && !FLAGS.effective.workspace
    ? (dialog) => dialog.accept()
    : null;
  if (discardConfirmationHandler) page.on("dialog", discardConfirmationHandler);
  if (activationMode === "pointer") await control.click();
  else await page.keyboard.press("Enter");
  if (legacyModalContext) {
    await expect(page.locator(target.probes.default).first()).toBeVisible();
    const receipt = await readContextReceipt(page, action.id);
    expect(receipt.elapsedMs).toBeLessThanOrEqual(AIUI01_ACKNOWLEDGEMENT_BUDGET_MS);
    await expect(page).toHaveURL(new RegExp(`${escapeRegex(startPath)}(?:[?#]|$)`));
    if (discardConfirmationHandler) page.off("dialog", discardConfirmationHandler);
    return { actionId: action.id, activationMode };
  }
  const receipt = await readRouteReceipt(page, action.id);
  if (discardConfirmationHandler) page.off("dialog", discardConfirmationHandler);
  expect(receipt).toMatchObject({ actionId: action.id, pathname: target.path });
  expect(receipt.elapsedMs).toBeLessThanOrEqual(AIUI01_ACKNOWLEDGEMENT_BUDGET_MS);
  await assertSurface(page, target.id, role);
  return { actionId: action.id, activationMode };
}

async function assertShellInventory(page, role) {
  await gotoRole(page, role, "/app");
  const header = page.locator(".site-header");
  const knownLabels = AIUI01_SHELL_ACTIONS.flatMap(({ label, responsiveAlias }) => (
    responsiveAlias ? [label, responsiveAlias] : [label]
  ));
  const topLevelLabels = await header.locator("button:visible:not(:disabled)").evaluateAll((buttons) => (
    buttons.map((button) => button.getAttribute("aria-label") || button.textContent.trim())
  ));
  for (const label of topLevelLabels) {
    expect(
      knownLabels.some((known) => label === known || label.startsWith(`${known},`)),
      `Unclassified enabled shell control: ${label}`
    ).toBe(true);
  }

  const menu = await openOperationsMenu(page);
  const menuLabels = await menu.getByRole("menuitem").allTextContents();
  for (const label of menuLabels.map((value) => value.trim())) {
    expect(
      AIUI01_SHELL_ACTIONS.some((action) => label === action.label || label.startsWith(`${action.label}:`)),
      `Unclassified enabled shell menu control: ${label}`
    ).toBe(true);
  }

  const enabledPrimaryLabels = routeActions(role)
    .filter(({ entry }) => entry === "operations")
    .map(({ label }) => label);
  for (const label of enabledPrimaryLabels) {
    await expect(menu.getByRole("menuitem", { name: label, exact: true })).toBeVisible();
  }
  if (role === "sales") {
    await expect(menu.getByRole("menuitem", { name: "Catalog Admin", exact: true })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: "Import Studio", exact: true })).toHaveCount(0);
  }
}

async function assertParameterizedSurfaces(page, role) {
  for (const surfaceId of ["customer-detail", "quote-detail", "quote-edit"]) {
    const surface = getAiui01Surface(surfaceId);
    const expectation = expectedSurfaceProbe(surfaceId, role);
    await page.goto(routeUrl(role, surface.path));
    await expect(page.locator(expectation.probe).first()).toBeVisible();
    await expectNoDocumentOverflow(page);
  }
}

async function assertLocalFallback(page, role) {
  await page.goto(routeUrl(role, "/app/quotes"));
  const quotes = page.locator(".history-card");
  await expect(quotes).toContainText("Source: Browser-local workspace");
  await expect(quotes.locator('[data-quote-id="aiui01-quote"]')).toBeVisible();
}

async function assertProfileVariants(page, role) {
  await page.goto(routeUrl(role, "/app"));
  await expect(page.locator(expectedSurfaceProbe("home", role).probe).first()).toBeVisible();

  await page.goto(routeUrl(role, "/app/quotes/aiui01-quote"));
  const detailProbe = expectedSurfaceProbe("quote-detail", role).probe;
  await expect(page.locator(detailProbe).first()).toBeVisible();
  await expect(page.locator(".ambient-living-opportunity"))
    .toHaveCount(FLAGS.effective.ambient ? 1 : 0);
  if (!FLAGS.effective.ambient) {
    await expect(page.locator('[data-decide-stack="decide-stack-v1"]'))
      .toHaveCount(FLAGS.effective.eventRoom ? 1 : 0);
  } else {
    await expect(page.getByRole("button", { name: "Open quote workspace" })).toHaveCount(0);
  }

  await page.goto(routeUrl(role, "/app/quotes/new"));
  await expect(page.locator('[data-create-intake="intent-extraction-v1"]'))
    .toHaveCount(FLAGS.effective.create ? 1 : 0);
  await expect(page.locator('[data-pilot-command="pilot-deterministic-command-v1"]'))
    .toHaveCount(FLAGS.effective.command ? 1 : 0);
}

test.describe("AIUI-01 compatibility and dead-click baseline", () => {
  test.skip(!BASELINE_ENABLED, "Run this focused matrix with AIUI01_BASELINE_ENABLED=true.");
  test.setTimeout(180_000);

  test.beforeEach(async ({ page }) => {
    expect(FLAGS.profileId).toBe(EXPECTED_PROFILE);
    await installBaselineFixture(page);
  });

  for (const viewport of AIUI01_VIEWPORTS) {
    test(`inventories staff surfaces and route acknowledgements at ${viewport.width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      const activationReceipts = [];

      for (const role of ["admin", "sales"]) {
        await assertShellInventory(page, role);
        for (const action of routeActions(role)) {
          activationReceipts.push({
            role,
            ...await exerciseRouteAction(page, role, action)
          });
        }
        await assertParameterizedSurfaces(page, role);
        await assertLocalFallback(page, role);
        await assertProfileVariants(page, role);
      }
      const keyboardFallbacks = activationReceipts.filter(({ activationMode }) => (
        activationMode === "keyboard"
      ));
      expect(keyboardFallbacks).toEqual([]);
      await testInfo.attach(`aiui01-${EXPECTED_PROFILE}-${viewport.width}-activation-baseline.json`, {
        body: Buffer.from(JSON.stringify({
          profileId: EXPECTED_PROFILE,
          viewport,
          activationReceipts
        }, null, 2)),
        contentType: "application/json"
      });
    });
  }

  test("gives the local portal fixture precedence at 390, 768, and 1440 without claiming Firebase token authority", async ({ page }) => {
    expect(AIUI01_PORTAL_PRECEDENCE.firebaseTokenAuthorityQualifiedHere).toBe(false);
    for (const viewport of AIUI01_VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.goto(`/app/catalog?portal=${encodeURIComponent(PORTAL_TOKEN)}`);
      await expect(page.getByRole("heading", { name: "Your proposal from Northstar Catering" })).toBeVisible();
      await expect(page.getByRole("heading", { name: /Portal Precedence Dinner/ })).toBeVisible();
      await expect(page.locator(".site-header")).toHaveCount(0);
      await expect(page.locator(".workspace-not-found")).toHaveCount(0);
      // The local fixture proves routing precedence only. Decision-room
      // questions require the connected conversation authority and must remain
      // absent even when their presentation flag is enabled.
      await expect(page.getByRole("button", { name: /Ask about this/i }))
        .toHaveCount(0);
      await expectNoDocumentOverflow(page);
    }
  });
});
