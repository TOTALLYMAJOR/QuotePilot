import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const DECISION_ROOM_ENABLED = ["1", "true", "yes", "on"].includes(
  String(process.env.VITE_PILOT_DECISION_ROOM_ENABLED || "").trim().toLowerCase()
) && ["1", "true", "yes", "on"].includes(
  String(process.env.VITE_AMBIENT_UI_ENABLED || "").trim().toLowerCase()
);
const CAPTURE_PROOF = ["1", "true", "yes", "on"].includes(
  String(process.env.CAPTURE_AMBIENT_BROWSER_PROOF || "").trim().toLowerCase()
);
const PROOF_DIRECTORY = "output/playwright/ambient-intelligence-current";
const PORTAL_KEY = "ambient-decision-room-portal-1234567890";
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1440, height: 1000 },
  { width: 1487, height: 1058, exactSourceViewport: true }
];

const PORTAL_QUOTE = {
  id: "ambient-decision-room-quote",
  organizationId: "e2e-org",
  quoteNumber: "Q-ROOM-1042",
  status: "sent",
  activeVersionId: "v0012",
  latestVersionNumber: 12,
  portalKey: PORTAL_KEY,
  portalIssuedAtISO: "2026-08-12T15:00:00.000Z",
  portalExpiresAtISO: "2099-09-11T15:00:00.000Z",
  createdAtISO: "2026-08-12T14:00:00.000Z",
  updatedAtISO: "2026-08-12T15:00:00.000Z",
  expiresAtISO: "2099-09-11T15:00:00.000Z",
  customer: {
    name: "Maya Bennett",
    email: "maya@example.test"
  },
  event: {
    name: "Autumn Benefit Dinner",
    date: "2026-09-19",
    time: "18:00",
    hours: 6,
    venue: "The Foundry Hall",
    venueAddress: "1200 East Fifth Street, Austin, Texas",
    guests: 120,
    style: "Plated",
    dietaryRestrictions: "Vegetarian and gluten-aware choices requested."
  },
  selection: {
    packageName: "Gathered Table Dinner with Seasonal Service",
    packageInclusions: {
      menuItems: [{ id: "salad", name: "Garden Salad" }],
      addons: [],
      rentals: []
    },
    menuItemNames: ["Garden Salad", "Herb Chicken", "Roasted Vegetable Plate"],
    addonSnapshots: [],
    rentalSnapshots: []
  },
  totals: {
    base: 5760,
    menu: 780,
    labor: 960,
    travel: 150,
    serviceFee: 1530,
    serviceFeePctApplied: 0.2,
    tax: 757.35,
    total: 9937.35,
    deposit: 2981.21
  },
  payment: {
    depositStatus: "unpaid",
    depositLink: ""
  },
  quoteMeta: {
    organizationName: "Northstar Events",
    brandName: "Northstar Catering",
    businessEmail: "events@northstar.test",
    businessPhone: "205-555-0100",
    brandPrimaryColor: "#8d611a",
    brandAccentColor: "#d8c398",
    brandDarkAccentColor: "#5e3b08",
    brandBackgroundStart: "#f7f4ee",
    brandBackgroundMid: "#efebe3",
    brandBackgroundEnd: "#e8e1d6",
    portalTermsText: "Your date is held only after the catering team confirms the booking and the required deposit is recorded. Menu choices close seven days before the event. Accessibility requests can be shared with the team at any time; they do not change this proposal automatically."
  },
  decidableOptionsProjection: [
    { itemType: "addon", name: "Premium Bar", price: 15, pricingType: "per_person" },
    { itemType: "rental", name: "Soft Linen Collection", price: 9, pricingType: "per_item" }
  ],
  workflow: {
    quoteDelivery: {
      revisionId: "v0012@2026-08-12T15:00:00.000Z",
      state: "local",
      portalActivationState: "active",
      portalKey: PORTAL_KEY,
      portalIssuedAtISO: "2026-08-12T15:00:00.000Z"
    }
  }
};

async function seedDecisionRoom(page) {
  // The portal authority caps token lifetime from issuance, even when a fixture
  // declares a distant expiry. Keep this historical issuance within its window.
  await page.clock.setFixedTime(new Date("2026-08-13T12:00:00.000Z"));
  await page.addInitScript((quote) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("qp.workspaceSoundsEnabled", "false");
    localStorage.setItem("quoteWizard.quotes", JSON.stringify([quote]));
  }, PORTAL_QUOTE);
}

async function decisionRoomAudit(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      if (!element) return false;
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
    const overlaps = (left, right) => (
      Math.min(left.right, right.right) - Math.max(left.left, right.left) > 1
      && Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > 1
    );
    const collisions = [];
    const groups = [
      ".portal-head",
      ".portal-proposal-header",
      ".portal-section-heading",
      ".portal-decidable-card",
      ".portal-decision-options",
      ".portal-signature-summary"
    ];
    groups.forEach((selector) => {
      document.querySelectorAll(selector).forEach((root, rootIndex) => {
        if (!visible(root)) return;
        const children = [...root.children].filter(visible);
        children.forEach((leftElement, leftIndex) => {
          children.slice(leftIndex + 1).forEach((rightElement) => {
            if (overlaps(rect(leftElement), rect(rightElement))) {
              collisions.push({
                group: `${selector}:${rootIndex}`,
                left: leftElement.className || leftElement.tagName,
                right: rightElement.className || rightElement.tagName
              });
            }
          });
        });
      });
    });

    const surface = document.querySelector(".portal-decision-room");
    const controls = [...surface.querySelectorAll("button:not([disabled]), input:not([disabled]), textarea:not([disabled])")]
      .filter(visible)
      .map((element) => {
        const target = element.matches('input[type="checkbox"]')
          ? element.closest("label") || element
          : element;
        return {
          label: element.getAttribute("aria-label") || target.textContent.trim() || element.name,
          width: rect(target).width,
          height: rect(target).height
        };
      });
    const clipped = [...surface.querySelectorAll("h1, h2, h3, h4, p, button, dt, dd")]
      .filter(visible)
      .filter((element) => element.scrollWidth - element.clientWidth > 1)
      .map((element) => element.textContent.trim().slice(0, 80));

    return {
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      surfaceOverflow: surface.scrollWidth - surface.clientWidth,
      collisions,
      clipped,
      undersizedControls: controls.filter(({ width, height }) => width < 44 || height < 44)
    };
  });
}

test.describe("Customer decision room", () => {
  test.skip(!DECISION_ROOM_ENABLED, "Requires the decision-room presentation gate.");

  for (const viewport of VIEWPORTS) {
    test(`is calm, complete, and overlap-safe at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await seedDecisionRoom(page);
      await page.goto(`/app?portal=${encodeURIComponent(PORTAL_KEY)}`);

      await expect(page.locator('[data-portal-presentation="event-story"]')).toBeVisible();
      await expect(page.getByRole("heading", { name: "Your proposal from Northstar Catering" })).toBeVisible();
      await expect(page.getByRole("heading", { name: /Autumn Benefit Dinner/ })).toBeVisible();
      await expect(page.getByText("Prepared for Maya Bennett")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Your event" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Your proposal total" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Planning assumptions" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Terms from your catering team" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Optional additions" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Your response" })).toBeVisible();
      await expect(page.getByRole("group", { name: "Proposal decision" })).toBeVisible();
      await expect(page.locator(".site-header")).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText("Facts that move");
      await expect(page.locator("body")).not.toContainText("drafts a change request");
      await expect(page.locator(".portal-price-breakdown")).toHaveJSProperty("open", false);
      await expect(page.locator('[data-portal-block="assumptions"] details')).toHaveJSProperty("open", false);
      await expect(page.locator('[data-portal-block="terms"] details')).toHaveJSProperty("open", false);

      const composition = await page.evaluate(() => {
        const box = (selector) => {
          const bounds = document.querySelector(selector).getBoundingClientRect();
          return {
            left: bounds.left,
            top: bounds.top,
            right: bounds.right,
            bottom: bounds.bottom,
            height: bounds.height
          };
        };
        const title = document.querySelector(".portal-event-title");
        const titleStyle = getComputedStyle(title);
        return {
          proposal: box('[data-portal-region="proposal-story"]'),
          commercial: box('[data-portal-region="commercial-summary"]'),
          decision: box('[data-portal-region="decision-workspace"]'),
          options: box('[data-portal-block="options"]'),
          assumptions: box('[data-portal-block="assumptions"]'),
          titleHeight: title.getBoundingClientRect().height,
          titleLineHeight: Number.parseFloat(titleStyle.lineHeight)
        };
      });

      if (viewport.width > 820) {
        expect(composition.proposal.right).toBeLessThanOrEqual(composition.commercial.left + 1);
        expect(Math.abs(composition.commercial.left - composition.decision.left)).toBeLessThanOrEqual(1);
        expect(composition.decision.top).toBeGreaterThan(composition.commercial.top);
        expect(composition.decision.top).toBeLessThan(composition.proposal.bottom);
        expect(composition.titleHeight).toBeLessThanOrEqual(composition.titleLineHeight * 1.15);
      } else {
        expect(composition.proposal.top).toBeLessThan(composition.commercial.top);
        expect(composition.commercial.top).toBeLessThan(composition.decision.top);
        expect(composition.decision.top).toBeLessThan(composition.options.top);
        expect(composition.options.top).toBeLessThan(composition.assumptions.top);
      }

      const sectionOrder = await page.locator("[data-portal-block]").evaluateAll((blocks) => (
        blocks.map((block) => block.getAttribute("data-portal-block"))
      ));
      expect(sectionOrder).toEqual([
        "event-details",
        "package-and-menu",
        "pricing",
        "assumptions",
        "terms",
        "options"
      ]);

      const audit = await decisionRoomAudit(page);
      expect(audit.documentOverflow).toBeLessThanOrEqual(1);
      expect(audit.surfaceOverflow).toBeLessThanOrEqual(1);
      expect(audit.collisions).toEqual([]);
      expect(audit.clipped).toEqual([]);
      expect(audit.undersizedControls).toEqual([]);

      const accessibility = await new AxeBuilder({ page }).analyze();
      expect(accessibility.violations).toEqual([]);

      if (CAPTURE_PROOF) {
        mkdirSync(PROOF_DIRECTORY, { recursive: true });
        await page.screenshot({
          path: `${PROOF_DIRECTORY}/customer-decision-room-${viewport.width}.png`,
          fullPage: !viewport.exactSourceViewport
        });
      }
    });
  }

  test("stages, discards, and reverses an option request without changing the proposal", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedDecisionRoom(page);
    await page.goto(`/app?portal=${encodeURIComponent(PORTAL_KEY)}`);

    const before = await page.evaluate(() => {
      const [quote] = JSON.parse(localStorage.getItem("quoteWizard.quotes") || "[]");
      return { selection: quote.selection, totals: quote.totals, revision: quote.activeVersionId };
    });
    const option = page.getByRole("button", { name: "Add Premium Bar to request" });
    await option.click();
    const selectedOption = page.getByRole("button", { name: "Remove Premium Bar from request" });
    await expect(selectedOption).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-option-draft-outcome="added"]')).toContainText(
      "Premium Bar is in your request"
    );
    await expect(page.getByRole("button", { name: "Ask for changes" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".portal-decision-panel textarea")).toHaveValue("Please add Premium Bar.");

    const staged = await page.evaluate(() => {
      const [quote] = JSON.parse(localStorage.getItem("quoteWizard.quotes") || "[]");
      return { selection: quote.selection, totals: quote.totals, revision: quote.activeVersionId };
    });
    expect(staged).toEqual(before);

    await page.getByRole("button", { name: "Accept proposal" }).click();
    await expect(page.getByRole("button", { name: "Add Premium Bar to request" }))
      .toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".portal-decision-panel textarea"))
      .toHaveValue("");
    await expect(page.locator('[data-option-draft-outcome="discarded"]')).toContainText(
      "optional addition was removed"
    );

    await page.getByRole("button", { name: "Add Premium Bar to request" }).click();
    const reversibleOption = page.getByRole("button", { name: "Remove Premium Bar from request" });
    await reversibleOption.click();
    await expect(page.getByRole("button", { name: "Add Premium Bar to request" }))
      .toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".portal-decision-panel textarea")).toHaveValue("");
    await expect(page.locator('[data-option-draft-outcome="removed"]')).toContainText(
      "No proposal details changed"
    );
  });
});
