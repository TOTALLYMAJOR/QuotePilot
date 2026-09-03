import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  AMBIENT_PRIMARY_WORKSPACE_NAVIGATION,
  WORKSPACE_ROUTE_IDS
} from "../src/lib/workspaceRoutes";

const REQUIRED_GATES = [
  process.env.VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED,
  process.env.VITE_AMBIENT_UI_ENABLED,
  process.env.VITE_PILOT_NOW_ENABLED,
  process.env.VITE_PILOT_COMMAND_ENABLED
].every((value) => ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase()));
const CAPTURE_PROOF = ["1", "true", "yes", "on"].includes(
  String(process.env.CAPTURE_AMBIENT_BROWSER_PROOF || "").trim().toLowerCase()
);
const PROOF_DIRECTORY = "output/playwright/ambient-intelligence-current";
const PORTAL_TOKEN = "workspace-layout-proof-portal-1234567890";
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1440, height: 1000 }
];

const AMBIENT_ROUTE_AUDITS = Object.freeze({
  [WORKSPACE_ROUTE_IDS.HOME]: Object.freeze({
    id: "now",
    heading: "Today, in clear view.",
    headingSelector: "#now-heading",
    initialFocusSelector: "#now-heading",
    focusReservePx: 0,
    surfaceSelector: '[data-surface-contract-id="ambient-now-briefing"]',
    registerSurface: true,
    groupRootSelector: ".ambient-now__masthead",
    groupSelectors: [".ambient-now__date", "#now-heading", ".ambient-now__intro"]
  }),
  [WORKSPACE_ROUTE_IDS.QUOTE_LIST]: Object.freeze({
    id: "opportunities-quotes",
    heading: "Every event, with its next move.",
    headingSelector: "#ambient-opportunities-heading",
    initialFocusSelector: "#ambient-opportunities-heading",
    surfaceSelector: '[data-surface-contract-id="ambient-opportunities-stream"]',
    registerSurface: true,
    groupRootSelector: ".ambient-opportunities__masthead > div",
    groupSelectors: [
      ".ambient-opportunity__reference",
      "#ambient-opportunities-heading",
      ":scope > p:last-child"
    ]
  }),
  [WORKSPACE_ROUTE_IDS.CUSTOMER_LIST]: Object.freeze({
    id: "clients-customers",
    heading: "Relationships, in context.",
    headingSelector: "#ambient-clients-title",
    initialFocusSelector: "#ambient-clients-title",
    surfaceSelector: '[data-surface-contract-id="ambient-clients-list"]',
    registerSurface: true,
    groupRootSelector: ".ambient-clients__populated-hero > div",
    groupSelectors: [
      ".ambient-clients__label",
      "#ambient-clients-title",
      ":scope > p:last-child"
    ]
  }),
  [WORKSPACE_ROUTE_IDS.CATALOG]: Object.freeze({
    id: "library-catalog",
    heading: "The choices behind every quote.",
    headingSelector: "#ambient-library-title",
    initialFocusSelector: "#ambient-library-title",
    focusReservePx: 0,
    surfaceSelector: '[data-surface-contract-id="ambient-library"]',
    registerSurface: true,
    groupRootSelector: ".ambient-library__masthead",
    groupSelectors: [
      ".ambient-library__breadcrumb",
      ".ambient-library__label",
      "#ambient-library-title",
      ":scope > p:last-child"
    ]
  })
});

const AMBIENT_ROUTES = AMBIENT_PRIMARY_WORKSPACE_NAVIGATION.map((destination) => {
  const audit = AMBIENT_ROUTE_AUDITS[destination.routeId];
  if (!audit) {
    throw new Error(`Missing layout audit contract for ${destination.routeId}.`);
  }
  return Object.freeze({
    ...audit,
    path: destination.path,
    navigationLabel: destination.label
  });
});

const ROUTES = [
  ...AMBIENT_ROUTES,
  {
    id: "messages",
    path: "/app/messages",
    heading: "Messages",
    headingSelector: "#messaging-station-title",
    initialFocusSelector: "#messaging-station-title",
    groupRootSelector: ".messaging-station-heading-copy",
    groupSelectors: ["#messaging-station-title", ":scope > p:last-child"]
  },
  {
    id: "clients-customer-360",
    path: "/app/customers/customer-layout-proof",
    heading: "Avery Bennett",
    headingSelector: "#ambient-client-overview-title",
    surfaceSelector: ".ambient-client-overview",
    groupRootSelector: ".ambient-client-overview__identity",
    groupSelectors: [
      ".ambient-client-overview__label",
      "#ambient-client-overview-title",
      ":scope > .ambient-client-overview__secondary"
    ]
  },
  {
    id: "living-opportunity",
    path: "/app/quotes/workspace-review-proof",
    heading: "Autumn Benefit Dinner",
    headingSelector: "#ambient-opportunity-title",
    surfaceSelector: ".ambient-living-opportunity",
    renderTimeoutMs: 30_000,
    groups: [
      {
        rootSelector: ".ambient-title-line",
        selectors: ["#ambient-opportunity-title", ".status-chip"]
      },
      {
        rootSelector: ".ambient-opportunity-hero",
        selectors: [".ambient-opportunity-identity", ".ambient-opportunity-total"]
      }
    ]
  },
  {
    id: "workflow",
    path: "/app/workflow",
    heading: "Workflow",
    headingSelector: "#sales-workflow-title",
    initialFocusSelector: "#sales-workflow-title",
    surfaceSelector: ".embedded-workspace-route[aria-labelledby=\"sales-workflow-title\"]",
    groupRootSelector: ".sales-workflow-card > .modal-head",
    groupSelectors: ["#sales-workflow-title", ".source-note", ".right-actions"]
  },
  {
    id: "schedule",
    path: "/app/schedule",
    heading: "Event Schedule",
    headingSelector: "#event-schedule-title",
    initialFocusSelector: "#event-schedule-title",
    surfaceSelector: ".embedded-workspace-route[aria-labelledby=\"event-schedule-title\"]",
    groupRootSelector: ".schedule-card > .modal-head",
    groupSelectors: ["#event-schedule-title", ".right-actions"]
  },
  {
    id: "reporting",
    path: "/app/reporting",
    heading: "Reporting Dashboard",
    headingSelector: "#reporting-dashboard-title",
    initialFocusSelector: "#reporting-dashboard-title",
    surfaceSelector: ".embedded-workspace-route[aria-labelledby=\"reporting-dashboard-title\"]",
    groupRootSelector: ".dashboard-card > .modal-head",
    groupSelectors: ["#reporting-dashboard-title", ".right-actions"]
  },
  {
    id: "imports",
    path: "/app/imports",
    heading: "Import Studio",
    headingSelector: "#import-studio-title",
    surfaceSelector: ".embedded-workspace-route[aria-labelledby=\"import-studio-title\"]",
    groupRootSelector: ".import-studio-head",
    groupSelectors: [
      ".import-studio-kicker",
      "#import-studio-title",
      ":scope > div > p:last-child",
      ":scope > .ghost"
    ]
  },
  {
    id: "integrations",
    path: "/app/integrations",
    heading: "Integrations Ops",
    headingSelector: "#integration-ops-title",
    initialFocusSelector: ".embedded-workspace-route[aria-labelledby=\"integration-ops-title\"]",
    surfaceSelector: ".embedded-workspace-route[aria-labelledby=\"integration-ops-title\"]",
    groupRootSelector: ".integration-card > .modal-head",
    groupSelectors: ["#integration-ops-title", ".right-actions"]
  },
  {
    id: "diagnostics",
    path: "/app/diagnostics",
    heading: "Session Diagnostics",
    headingSelector: "#session-diagnostics-title",
    initialFocusSelector: ".embedded-workspace-route[aria-labelledby=\"session-diagnostics-title\"]",
    surfaceSelector: ".embedded-workspace-route[aria-labelledby=\"session-diagnostics-title\"]",
    groupRootSelector: ".diagnostics-card > .modal-head",
    groupSelectors: ["#session-diagnostics-title", ".right-actions"]
  },
  {
    id: "customer-portal",
    path: `/app/catalog?portal=${encodeURIComponent(PORTAL_TOKEN)}`,
    heading: "Your proposal from Northstar Catering",
    headingSelector: ".portal-head h1",
    surfaceSelector: ".portal-shell",
    registerSurface: true,
    groups: [
      {
        rootSelector: ".portal-head",
        selectors: [".portal-brand-heading", ".portal-brand-contact"]
      },
      {
        rootSelector: ".portal-proposal-header",
        selectors: [":scope > div:first-child", ".portal-decision-receipt"]
      },
      {
        rootSelector: ".portal-content-grid",
        selectors: [":scope > section:nth-child(1)", ":scope > section:nth-child(2)"]
      },
      {
        rootSelector: ".portal-decision-options",
        selectors: [
          ":scope > button:nth-child(1)",
          ":scope > button:nth-child(2)",
          ":scope > button:nth-child(3)"
        ]
      }
    ]
  },
  {
    id: "not-found",
    path: "/app/not-a-workspace-route",
    heading: "Workspace page not found",
    headingSelector: "#workspace-not-found-title",
    surfaceSelector: ".workspace-not-found",
    groupRootSelector: ".workspace-not-found",
    groupSelectors: [".eyebrow", "#workspace-not-found-title", ".muted", ".cta"]
  }
];

const LIBRARY_TEMPLATE_EDITOR_ROUTE = {
  id: "library-template-editor",
  heading: "Event templates",
  headingSelector: ".event-templates-editor__head h2",
  focusSelector: "[data-library-record-kind=\"event-template\"][data-library-record-id=\"wedding\"] [data-template-action=\"toggle\"]",
  surfaceSelector: ".ambient-library--editing",
  groups: [
    {
      rootSelector: ".ambient-library__orientation",
      selectors: [":scope > .ambient-library__breadcrumb", ":scope > div"]
    },
    {
      rootSelector: ".ambient-library--editing",
      selectors: [
        ":scope > .ambient-library__orientation",
        ":scope > .ambient-library__acknowledgement",
        ":scope > .ambient-library__editor"
      ]
    },
    {
      rootSelector: ".admin-catalog-card > .modal-head",
      selectors: ["#catalog-admin-title", ".admin-save-actions"]
    },
    {
      rootSelector: ".event-templates-editor__head",
      selectors: [":scope > div", ":scope > .event-templates-editor__add"]
    },
    {
      rootSelector: "[data-library-record-kind=\"event-template\"][data-library-record-id=\"wedding\"] .event-templates-editor__item-head",
      selectors: [".event-templates-editor__summary", ".event-templates-editor__remove"]
    }
  ]
};

const DRAFT_REVIEW_ROUTE = {
  id: "quote-editor-package-review",
  heading: "Review package replacement",
  headingSelector: ".ambient-draft-review__header h2",
  focusSelector: "[data-draft-review-outcome=\"apply\"]",
  surfaceSelector: "[data-ambient-draft-intent-review=\"package_menu\"]",
  groups: [
    {
      rootSelector: ".ambient-draft-review__header",
      selectors: [":scope > div", ".ambient-draft-review__authority"]
    },
    {
      rootSelector: ".ambient-draft-review__comparison",
      selectors: [":scope > section:nth-child(1)", ":scope > section:nth-child(2)"]
    },
    {
      rootSelector: ".ambient-draft-review__evidence",
      selectors: [":scope > section:nth-child(1)", ":scope > section:nth-child(2)"]
    },
    {
      rootSelector: ".ambient-draft-review__actions",
      selectors: ["[data-draft-review-outcome=\"apply\"]", "[data-draft-review-outcome=\"keep\"]"]
    }
  ]
};

const PILOT_QUERY_ROUTE = {
  id: "pilot-price-explanation",
  heading: "How this draft price is composed",
  headingSelector: ".pilot-command-query h4",
  focusSelector: ".pilot-command-query h4",
  surfaceSelector: ".wizard-grid:not([hidden])",
  groups: [
    {
      rootSelector: ".pilot-command-query header",
      selectors: [".pilot-command-query-kicker", ":scope > h4", ":scope > p"]
    },
    {
      rootSelector: ".pilot-command-query-judgment",
      selectors: [":scope > p:nth-child(1)", ":scope > p:nth-child(2)"]
    },
    {
      rootSelector: ".pilot-command-actions",
      selectors: [":scope > button", ":scope > small"]
    }
  ]
};

const PILOT_SCENARIO_REVIEW_ROUTE = {
  id: "pilot-scenario-review",
  heading: "One explicit compromise under budget",
  headingSelector: ".ambient-pilot-scenario-review__header h2",
  focusSelector: "[data-pilot-scenario-review-action=\"apply\"]",
  surfaceSelector: ".ambient-pilot-scenario-review",
  groups: [
    {
      rootSelector: ".ambient-pilot-scenario-review__header",
      selectors: [":scope > div", ":scope > strong"]
    },
    {
      rootSelector: ".ambient-pilot-scenario-review__change-grid",
      selectors: [":scope > section:nth-child(1)", ":scope > section:nth-child(2)"]
    },
    {
      rootSelector: ".ambient-pilot-scenario-review__actions",
      selectors: [
        "[data-pilot-scenario-review-action=\"apply\"]",
        "[data-pilot-scenario-review-action=\"keep\"]"
      ]
    }
  ]
};

const SEED_QUOTE = {
  organizationId: "e2e-org",
  id: "workspace-layout-proof",
  quoteNumber: "Q-LAYOUT-PROOF",
  status: "sent",
  activeVersionId: "v0001",
  latestVersionNumber: 1,
  createdAtISO: "2026-08-11T12:00:00.000Z",
  updatedAtISO: "2026-08-11T18:00:00.000Z",
  portalKey: PORTAL_TOKEN,
  portalIssuedAtISO: "2026-08-11T18:00:00.000Z",
  portalExpiresAtISO: "2099-08-11T18:00:00.000Z",
  customer: { name: "Maya Bennett", email: "maya@example.test" },
  event: {
    name: "Autumn Benefit Dinner",
    date: "2026-09-19",
    time: "18:00",
    venue: "The Foundry Hall",
    guests: 120,
    servers: 8,
    chefs: 3,
    bartenders: 0
  },
  selection: {
    packageId: "classic",
    packageName: "Classic Dinner",
    menuItemNames: ["Garden Salad", "Herb Chicken"],
    addons: [],
    rentals: []
  },
  totals: { total: 8400, deposit: 2520 },
  payment: { status: "not_requested" },
  quoteMeta: {
    organizationName: "Northstar Events",
    brandName: "Northstar Catering",
    businessEmail: "events@northstar.test",
    businessPhone: "205-555-0100",
    brandPrimaryColor: "#8d611a",
    brandDarkAccentColor: "#5e3b08"
  },
  conversationSummary: {
    messageCount: 3,
    latestMessageId: "layout-message-3",
    latestMessageAtISO: "2026-08-11T18:30:00.000Z",
    latestActorType: "customer"
  },
  workflow: {
    quoteDelivery: {
      revisionId: "v0001@2026-08-11T18:00:00.000Z",
      state: "provider_accepted",
      portalActivationState: "active",
      providerMessageId: "provider-workspace-layout-proof",
      providerAcceptedAtISO: "2026-08-11T18:02:00.000Z",
      portalKey: PORTAL_TOKEN,
      portalIssuedAtISO: "2026-08-11T18:00:00.000Z"
    }
  }
};

const REVIEW_QUOTE = {
  organizationId: "e2e-org",
  id: "workspace-review-proof",
  customerId: "customer-layout-proof",
  quoteNumber: "Q-REVIEW-PROOF",
  status: "draft",
  activeVersionId: "v0007",
  latestVersionNumber: 7,
  createdAtISO: "2026-08-11T12:00:00.000Z",
  updatedAtISO: "2026-08-11T18:00:00.000Z",
  customer: {
    name: "Avery Bennett",
    email: "avery@example.test",
    phone: "205-555-0184",
    organization: "Bennett Foundation"
  },
  event: {
    name: "Autumn Benefit Dinner",
    date: "2026-09-19",
    time: "18:00",
    hours: 6,
    venue: "The Foundry Hall",
    venueAddress: "1200 East Fifth Street, Austin, TX",
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
    packageInclusions: {
      menuItems: [
        { id: "garden-salad", name: "Garden Salad" },
        { id: "herb-chicken", name: "Herb Chicken" }
      ],
      addons: [],
      rentals: []
    },
    menuItems: ["garden-salad", "herb-chicken"],
    menuItemsSnapshot: [
      { id: "garden-salad", name: "Garden Salad", quantity: 120, includedInPackage: true },
      { id: "herb-chicken", name: "Herb Chicken", quantity: 120, includedInPackage: true }
    ],
    menuItemNames: ["Garden Salad", "Herb Chicken"],
    menuItemQuantities: { "garden-salad": 120, "herb-chicken": 120 },
    addons: [],
    rentals: [],
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
  pricing: {
    authority: "server_authoritative",
    calculatedAt: "2026-08-11T18:00:00.000Z",
    inputs: { event: { guests: 120 } },
    lineItems: [
      { id: "classic", category: "package", total: 6000 },
      { id: "labor", category: "labor", total: 1800 }
    ],
    subtotal: 7800,
    grandTotal: 8400,
    deposit: { pct: 0.3, amount: 2520 },
    rulesSnapshot: { pricingSettingsVersion: 12 }
  },
  lifecycle: { draftAtISO: "2026-08-11T12:00:00.000Z" }
};

const LOCAL_CATALOG = {
  packages: [
    {
      id: "classic",
      name: "Classic",
      ppp: 50,
      costPpp: 31,
      active: true,
      includedMenuItemIds: ["garden-salad", "herb-chicken"]
    },
    {
      id: "focused",
      name: "Focused",
      ppp: 40,
      costPpp: 22,
      active: true,
      includedMenuItemIds: ["garden-salad", "herb-chicken"]
    },
    {
      id: "premium",
      name: "Premium",
      ppp: 62,
      costPpp: 38,
      active: true,
      includedMenuItemIds: ["garden-salad", "herb-chicken", "cedar-plank-salmon"]
    }
  ],
  addons: [],
  rentals: [],
  settings: {
    catalogRevision: 12,
    pricingSetupConfirmed: true,
    pricingConfirmation: {
      actorUid: "layout-proof-admin",
      actorEmail: "layout-proof-admin@example.test",
      confirmedAtISO: "2026-08-11T18:00:00.000Z",
      confirmedCatalogRevision: 12
    },
    eventTemplates: [{ id: "wedding", name: "Wedding" }],
    menuSections: [
      {
        id: "starters",
        name: "Starters",
        items: [
          { id: "garden-salad", name: "Garden Salad", pricingType: "per_person", price: 6, active: true },
          { id: "roasted-beet-salad", name: "Roasted Beet Salad", pricingType: "per_person", price: 7, active: true }
        ]
      },
      {
        id: "entrees",
        name: "Entrees",
        items: [
          { id: "herb-chicken", name: "Herb Chicken", pricingType: "per_person", price: 18, active: true },
          { id: "cedar-plank-salmon", name: "Cedar Plank Salmon", pricingType: "per_person", price: 24, active: true }
        ]
      }
    ]
  }
};

const LOCAL_MENU_CATALOG = {
  revision: 12,
  eventTypes: [{ id: "wedding", name: "Wedding" }],
  categories: LOCAL_CATALOG.settings.menuSections.map((section) => ({
    id: section.id,
    eventTypeId: "wedding",
    name: section.name
  })),
  items: LOCAL_CATALOG.settings.menuSections.flatMap((section) => (
    section.items.map((item) => ({
      ...item,
      eventTypeId: "wedding",
      categoryId: section.id,
      priceMinor: Math.round(item.price * 100)
    }))
  ))
};

async function seedWorkspace(page) {
  await page.addInitScript(({ catalog, menuCatalog, quotes }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("qp.workspaceSoundsEnabled", "false");
    localStorage.setItem("quoteWizard.quotes", JSON.stringify(quotes));
    localStorage.setItem("quoteWizard.catalog", JSON.stringify(catalog));
    localStorage.setItem("quoteWizard.catalog.e2e-org", JSON.stringify(catalog));
    localStorage.setItem("quoteWizard.menuCatalog.e2e-org", JSON.stringify(menuCatalog));
  }, {
    catalog: LOCAL_CATALOG,
    menuCatalog: LOCAL_MENU_CATALOG,
    quotes: [SEED_QUOTE, REVIEW_QUOTE]
  });
}

async function auditRouteGeometry(page, route) {
  return page.evaluate(async (definition) => {
    const { auditWorkspaceLayout, rectanglesIntersect } = await import("/src/lib/workspaceLayoutAudit.js");
    const heading = document.querySelector(definition.headingSelector);
    const surface = document.querySelector(definition.surfaceSelector || ".workspace-route-main");
    if (!heading || !surface) {
      return { setupError: `Missing layout surface or heading for ${definition.id}.` };
    }
    if (definition.registerSurface) {
      surface.setAttribute("data-layout-audit-surface", definition.id);
      surface.setAttribute("data-layout-audit-overflow", definition.id);
    }
    heading.setAttribute("data-layout-audit-heading", definition.id);

    const groupDefinitions = Array.isArray(definition.groups)
      ? definition.groups
      : [{
          rootSelector: definition.groupRootSelector,
          selectors: definition.groupSelectors
        }];
    const routeElements = [];
    for (const [groupIndex, group] of groupDefinitions.entries()) {
      const root = document.querySelector(group.rootSelector);
      if (!root) return { setupError: `Missing layout group ${groupIndex + 1} for ${definition.id}.` };
      const elements = group.selectors.map((selector) => root.querySelector(selector));
      if (elements.some((element) => !element)) {
        return { setupError: `Missing a declared layout peer for ${definition.id} group ${groupIndex + 1}.` };
      }
      elements.forEach((element) => {
        element.setAttribute("data-layout-audit-group", `e2e-${definition.id}-${groupIndex + 1}`);
        routeElements.push(element);
      });
    }

    const shellGroups = [
      [".site-header .nav", ":scope > *"],
      [".workspace-intro", ":scope > *"]
    ];
    shellGroups.forEach(([rootSelector, childSelector], shellIndex) => {
      const root = document.querySelector(rootSelector);
      if (!root) return;
      [...root.querySelectorAll(childSelector)].forEach((element) => {
        element.setAttribute("data-layout-audit-group", `e2e-shell-${shellIndex + 1}`);
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
    const reserve = Number.isFinite(definition.focusReservePx)
      ? Math.max(0, definition.focusReservePx)
      : 2;
    const headingRect = heading.getBoundingClientRect();
    const reservedHeadingRect = {
      left: headingRect.left - reserve,
      top: headingRect.top - reserve,
      right: headingRect.right + reserve,
      bottom: headingRect.bottom + reserve
    };
    const peerCollisions = routeElements
      .filter((element) => element !== heading && visible(element))
      .filter((element) => !element.matches("[data-layout-overlap-allowed='true']"))
      .filter((element) => !heading.contains(element) && !element.contains(heading))
      .filter((element) => rectanglesIntersect(reservedHeadingRect, element.getBoundingClientRect(), 1))
      .map((element) => String(element.textContent || element.tagName).replace(/\s+/gu, " ").trim().slice(0, 100));
    const audit = auditWorkspaceLayout(document, { tolerancePx: 1, focusReservePx: reserve });
    const focusTarget = document.querySelector(definition.focusSelector || definition.headingSelector);
    const visibleRouteElements = routeElements.filter(visible);
    return {
      setupError: "",
      activeFocus: document.activeElement === focusTarget,
      declaredPeerCount: routeElements.length,
      visibleDeclaredPeerCount: visibleRouteElements.length,
      peerCollisions,
      audit
    };
  }, route);
}

async function expectRouteGeometry(page, route) {
  const geometry = await auditRouteGeometry(page, route);
  expect(geometry.setupError).toBe("");
  expect(geometry.activeFocus).toBe(true);
  expect(geometry.declaredPeerCount).toBeGreaterThan(0);
  expect(geometry.visibleDeclaredPeerCount).toBeGreaterThan(0);
  expect(geometry.peerCollisions).toEqual([]);
  expect(geometry.audit).toMatchObject({
    modelId: "workspace-layout-audit-v1",
    containmentModelId: "workspace-control-containment-v1",
    passed: true,
    collisions: [],
    overflow: [],
    undeclaredOverlays: [],
    escapedControls: [],
    escapedFocusPaint: []
  });
  expect(geometry.audit.auditedHeadingCount).toBeGreaterThan(0);
  expect(geometry.audit.auditedGroupCount).toBeGreaterThan(0);
  expect(geometry.audit.auditedElementCount)
    .toBeGreaterThanOrEqual(geometry.visibleDeclaredPeerCount);
  expect(geometry.audit.focusPaintChecks.every((check) => check.contained)).toBe(true);
  expect(geometry.audit.documentOverflowPx).toBeLessThanOrEqual(1);
}

async function expectMessagesSurfaceContainment(page, { requireHeadingFocus = true } = {}) {
  const geometry = await page.evaluate((controlSelector) => {
    const station = document.querySelector(".messaging-station");
    const heading = station?.querySelector("#messaging-station-title");
    const subtitle = station?.querySelector(".messaging-station-heading-copy > p:last-child");
    if (!station || !heading || !subtitle) {
      return { setupError: "Messages heading or station surface is missing." };
    }
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none"
        && style.visibility !== "hidden"
        && Number(style.opacity || 1) > 0
        && rect.width > 0
        && rect.height > 0;
    };
    const stationRect = station.getBoundingClientRect();
    const headingRect = heading.getBoundingClientRect();
    const subtitleRect = subtitle.getBoundingClientRect();
    const focusPaintReservePx = 2;
    const headingFocusPaintContained = headingRect.left - focusPaintReservePx >= stationRect.left - 1
      && headingRect.top - focusPaintReservePx >= stationRect.top - 1
      && headingRect.right + focusPaintReservePx <= stationRect.right + 1
      && headingRect.bottom + focusPaintReservePx <= stationRect.bottom + 1
      && headingRect.left - focusPaintReservePx >= -1
      && headingRect.right + focusPaintReservePx <= document.documentElement.clientWidth + 1;
    const controls = [...station.querySelectorAll(controlSelector)].filter(visible);
    const escapingControls = controls
      .filter((control) => {
        const rect = control.getBoundingClientRect();
        return rect.left < stationRect.left - 1
          || rect.right > stationRect.right + 1
          || rect.left < -1
          || rect.right > document.documentElement.clientWidth + 1;
      })
      .map((control) => String(
        control.getAttribute("aria-label")
        || control.textContent
        || control.tagName
      ).replace(/\s+/gu, " ").trim().slice(0, 100));
    return {
      setupError: "",
      activeIsHeading: document.activeElement === heading,
      subtitleClearancePx: subtitleRect.top - headingRect.bottom - focusPaintReservePx,
      headingFocusPaintContained,
      stationOverflowPx: station.scrollWidth - station.clientWidth,
      documentOverflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      escapingControls
    };
  }, TRANSIENT_CONTROL_SELECTOR);
  expect(geometry.setupError).toBe("");
  if (requireHeadingFocus) expect(geometry.activeIsHeading).toBe(true);
  expect(geometry.subtitleClearancePx).toBeGreaterThanOrEqual(8);
  expect(geometry.headingFocusPaintContained).toBe(true);
  expect(geometry.stationOverflowPx).toBeLessThanOrEqual(1);
  expect(geometry.documentOverflowPx).toBeLessThanOrEqual(1);
  expect(geometry.escapingControls).toEqual([]);
}

async function expectFeedbackRailInFlow(page) {
  const result = await page.evaluate(async () => {
    const { rectanglesIntersect } = await import("/src/lib/workspaceLayoutAudit.js");
    const rail = document.querySelector('[data-layout-audit-surface="workspace-feedback"]');
    const activeRoute = document.querySelector(".wizard-grid:not([hidden])");
    if (!rail || !activeRoute) {
      return { setupError: "The visible feedback rail or active quote editor route is missing." };
    }
    const railStyle = getComputedStyle(rail);
    const railRect = rail.getBoundingClientRect();
    const routeRect = activeRoute.getBoundingClientRect();
    return {
      setupError: "",
      position: railStyle.position,
      intersectsRoute: rectanglesIntersect(railRect, routeRect, 1),
      railOverflowPx: rail.scrollWidth - rail.clientWidth,
      documentOverflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  });
  expect(result).toMatchObject({
    setupError: "",
    position: "static",
    intersectsRoute: false
  });
  expect(result.railOverflowPx).toBeLessThanOrEqual(1);
  expect(result.documentOverflowPx).toBeLessThanOrEqual(1);
}

const TRANSIENT_CONTROL_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

async function auditTransientSurfaceGeometry(page, definition) {
  return page.evaluate(async (surfaceDefinition) => {
    const {
      auditContainedTransientSurface,
      auditWorkspaceLayout
    } = await import("/src/lib/workspaceLayoutAudit.js");
    const surface = document.querySelector(surfaceDefinition.surfaceSelector);
    const trigger = surfaceDefinition.triggerSelector
      ? document.querySelector(surfaceDefinition.triggerSelector)
      : null;
    if (!surface) return { setupError: `Missing ${surfaceDefinition.id} transient surface.` };
    if (surfaceDefinition.triggerSelector && !trigger) {
      return { setupError: `Missing ${surfaceDefinition.id} transient trigger.` };
    }
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none"
        && style.visibility !== "hidden"
        && Number(style.opacity || 1) > 0
        && rect.width > 0
        && rect.height > 0;
    };
    const peerGroupCounts = [];
    for (const [groupIndex, group] of (surfaceDefinition.peerGroups || []).entries()) {
      const root = group.rootSelector ? surface.querySelector(group.rootSelector) : surface;
      if (!root) return { setupError: `Missing ${surfaceDefinition.id} peer group ${groupIndex + 1}.` };
      const peers = [...root.querySelectorAll(group.childSelector)].filter(visible);
      if (peers.length < 2) {
        return { setupError: `${surfaceDefinition.id} peer group ${groupIndex + 1} has fewer than two visible peers.` };
      }
      peers.forEach((element) => {
        element.setAttribute("data-layout-audit-group", `e2e-transient-${surfaceDefinition.id}-${groupIndex + 1}`);
      });
      peerGroupCounts.push(peers.length);
    }
    return {
      setupError: "",
      peerGroupCounts,
      contained: auditContainedTransientSurface(surface, {
        trigger,
        tolerancePx: 1,
        focusReservePx: 2,
        requireFocusWithin: true
      }),
      workspace: auditWorkspaceLayout(document, { tolerancePx: 1, focusReservePx: 2 })
    };
  }, definition);
}

async function expectContainedTransientGeometry(page, definition) {
  const surface = page.locator(definition.surfaceSelector);
  await expect(surface).toBeVisible();
  const controls = surface.locator(TRANSIENT_CONTROL_SELECTOR);
  const controlCount = await controls.count();
  expect(controlCount).toBeGreaterThan(0);
  let auditedVisibleControls = 0;
  let lastGeometry = null;
  for (let index = 0; index < controlCount; index += 1) {
    const control = controls.nth(index);
    if (!await control.isVisible()) continue;
    auditedVisibleControls += 1;
    if (definition.centerScrollableControls) {
      await control.evaluate((element) => element.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: "instant"
      }));
    } else {
      await control.scrollIntoViewIfNeeded();
    }
    await control.focus();
    await expect(control).toBeFocused();
    const geometry = await auditTransientSurfaceGeometry(page, definition);
    expect(geometry.setupError).toBe("");
    expect(geometry.peerGroupCounts.every((count) => count >= 2)).toBe(true);
    const containedExpectation = {
      modelId: "contained-transient-surface-audit-v1",
      declaration: definition.expectedDeclaration,
      surfaceWithinViewport: true,
      surfaceWithinClippingAncestors: true,
      verticalOverflowContained: true,
      focusIsInside: true,
      focusPainted: true,
      focusHorizontallyContained: true,
      focusVerticallyContainedWhenPainted: true,
      focusContained: true
    };
    expect(
      geometry.contained,
      `${definition.id} failed while ${geometry.contained.focusedControl || "no control"} held focus.`
    ).toMatchObject(definition.allowScrollEdgeClipping
      ? containedExpectation
      : { ...containedExpectation, passed: true, clippedControls: [] });
    if (definition.allowScrollEdgeClipping) {
      expect(geometry.contained.clippedControls.every((candidate) => (
        candidate.horizontallyContained === true
        && candidate.id !== geometry.contained.focusedControl
      ))).toBe(true);
    }
    expect(geometry.contained.horizontalOverflowPx).toBeLessThanOrEqual(1);
    expect(geometry.workspace).toMatchObject({
      modelId: "workspace-layout-audit-v1",
      containmentModelId: "workspace-control-containment-v1",
      passed: true,
      collisions: [],
      overflow: [],
      undeclaredOverlays: [],
      escapedControls: [],
      escapedFocusPaint: []
    });
    expect(geometry.workspace.documentOverflowPx).toBeLessThanOrEqual(1);
    lastGeometry = geometry;
  }
  expect(auditedVisibleControls).toBeGreaterThan(0);
  return lastGeometry;
}

async function captureTransientProof(page, fileName) {
  if (!CAPTURE_PROOF) return;
  mkdirSync(PROOF_DIRECTORY, { recursive: true });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
  });
  await page.screenshot({
    path: `${PROOF_DIRECTORY}/${fileName}`,
    animations: "disabled"
  });
}

async function openReviewQuoteEditorViaPackage(page) {
  await page.goto(`/app/quotes/${REVIEW_QUOTE.id}`);
  const opportunity = page.locator(".ambient-living-opportunity");
  await expect(opportunity).toBeVisible({ timeout: 30_000 });
  await opportunity.getByRole("button", { name: "Review package" }).click();
  const inspector = page.getByRole("dialog", { name: "Package details" });
  await expect(inspector).toBeVisible();
  await inspector.getByRole("button", { name: /Premium.*Review replacement in editor/iu }).click();
  await expect(page).toHaveURL(new RegExp(`/app/quotes/${REVIEW_QUOTE.id}/edit$`, "u"));
}

test.describe("Cross-app no-unintended-overlap gate", () => {
  test.skip(
    !REQUIRED_GATES,
    "The cross-app layout gate requires customer-centered, Ambient, and Pilot Now surfaces."
  );

  test.beforeEach(async ({ page }) => {
    await seedWorkspace(page);
  });

  test("Calm Four route coverage mirrors navigation and fails closed on selector drift", async ({ page }) => {
    expect(AMBIENT_ROUTES.map((route) => ({
      label: route.navigationLabel,
      path: route.path
    }))).toEqual(AMBIENT_PRIMARY_WORKSPACE_NAVIGATION.map((destination) => ({
      label: destination.label,
      path: destination.path
    })));

    const nowRoute = AMBIENT_ROUTES.find((route) => route.id === "now");
    await page.setViewportSize(VIEWPORTS[0]);
    await page.goto(nowRoute.path);
    await expect(page.locator(nowRoute.headingSelector)).toBeVisible();
    const geometry = await auditRouteGeometry(page, {
      ...nowRoute,
      groupSelectors: [...nowRoute.groupSelectors, "[data-deliberately-missing-layout-peer]"]
    });
    expect(geometry.setupError).toBe("Missing a declared layout peer for now group 1.");
  });

  for (const viewport of VIEWPORTS) {
    for (const route of ROUTES) {
      test(`${route.id} has no unintended overlap at ${viewport.width}px`, async ({ page }) => {
        await page.setViewportSize(viewport);
        if (route.id === "now") {
          await page.addInitScript(() => {
            const quotes = JSON.parse(localStorage.getItem("quoteWizard.quotes") || "[]");
            if (quotes[0]) {
              quotes[0].portalDecision = {
                decision: "changes_requested",
                requestId: "now-proof-request",
                submittedAtISO: "2026-08-11T19:00:00.000Z",
                message: "Could we add a vegetarian station?"
              };
            }
            if (quotes[1]) {
              quotes[1].workflow = {
                ...(quotes[1].workflow || {}),
                followUp: { dueDate: "2026-08-10" },
                approvalRequests: [{
                  id: "now-proof-approval",
                  state: "pending",
                  requestedAtISO: "2026-08-11T20:00:00.000Z"
                }]
              };
            }
            localStorage.setItem("quoteWizard.quotes", JSON.stringify(quotes));
          });
        }
        await page.goto(route.path);
        const routeDefinition = route.id === "living-opportunity" && viewport.width <= 620
          ? {
              ...route,
              headingSelector: "#ambient-mobile-opportunity-title",
              focusSelector: "#ambient-mobile-opportunity-title",
              groups: [
                {
                  rootSelector: ".ambient-mobile-remote__identity",
                  selectors: ["#ambient-mobile-opportunity-title", ".status-chip"]
                },
                {
                  rootSelector: ".ambient-mobile-remote__next",
                  selectors: [":scope > div", ":scope > button"]
                },
                {
                  rootSelector: ".ambient-mobile-remote__objects",
                  selectors: [":scope > button:nth-child(1)", ":scope > button:nth-child(2)", ":scope > button:nth-child(3)", ":scope > button:nth-child(4)"]
                }
              ]
            }
          : route;
        const heading = page.locator(routeDefinition.headingSelector);
        await expect(heading).toBeVisible({ timeout: routeDefinition.renderTimeoutMs || 10_000 });
        await expect(heading).toContainText(routeDefinition.heading);
        if (route.id === "opportunities-quotes") {
          await expect(page.locator('.embedded-workspace-route[role="region"]'))
            .toHaveAttribute("aria-labelledby", "ambient-opportunities-heading");
        }
        if (route.id === "customer-portal") {
          await expect(page.locator(".site-header")).toHaveCount(0);
          await expect(page.getByRole("group", { name: "Proposal decision" })).toBeVisible();
          // This exact-token local fixture proves portal projection and inline
          // decision containment only. Connected conversation authority is
          // intentionally unavailable in the local fallback.
          await expect(page.getByRole("button", { name: /Ask about this/iu })).toHaveCount(0);
        }
        if (routeDefinition.initialFocusSelector) {
          await expect(page.locator(routeDefinition.initialFocusSelector)).toBeFocused();
        }

        const focusTarget = page.locator(routeDefinition.focusSelector || routeDefinition.headingSelector);
        if (!routeDefinition.initialFocusSelector || routeDefinition.initialFocusSelector !== (routeDefinition.focusSelector || routeDefinition.headingSelector)) {
          await focusTarget.evaluate((element) => {
            element.setAttribute("tabindex", "-1");
            element.focus({ preventScroll: true });
          });
        }
        await expect(focusTarget).toBeFocused();

        await expectRouteGeometry(page, routeDefinition);

        if (route.id === "messages") {
          await expectMessagesSurfaceContainment(page);
          const thread = page.locator(".messaging-thread-row").first();
          await expect(thread).toBeVisible();
          await thread.click();
          await expect(page.locator(".messaging-thread")).toBeVisible();
          await expectMessagesSurfaceContainment(page, { requireHeadingFocus: false });
        }

        if (CAPTURE_PROOF && (
          viewport.width === 1440
          || route.id === "messages"
          || (route.id === "now" && viewport.width === 390)
        )) {
          mkdirSync(PROOF_DIRECTORY, { recursive: true });
          await page.evaluate(async () => {
            await document.fonts.ready;
            if (document.querySelector(".ambient-now")) document.activeElement?.blur();
            window.scrollTo({ top: 0, left: 0, behavior: "instant" });
            [...document.querySelectorAll("*")].forEach((element) => {
              if (element.scrollTop > 0) element.scrollTop = 0;
              if (element.scrollLeft > 0) element.scrollLeft = 0;
            });
            await new Promise((resolve) => window.requestAnimationFrame(resolve));
          });
          await page.screenshot({
            path: `${PROOF_DIRECTORY}/workspace-no-overlap-${route.id}-${viewport.width}.png`,
            animations: "disabled"
          });
          if (route.id === "now" && viewport.width === 390) {
            await page.locator("#ambient-now-priorities-title").scrollIntoViewIfNeeded();
            await captureTransientProof(page, "ambient-now-priorities-390.png");
          }
        }
      });
    }
  }

  for (const viewport of VIEWPORTS) {
    test(`Library template editor stays in flow with no unintended overlap at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/app/catalog");
      const library = page.locator(".ambient-library[data-surface-contract-id=\"ambient-library\"]");
      await expect(library).toBeVisible({ timeout: 30_000 });
      const template = library.locator(
        "[data-library-record-kind=\"event-template\"][data-library-record-id=\"wedding\"]"
      );
      await library.locator(".ambient-library__template-disclosure > summary").click();
      const trigger = template.getByRole("button", { name: "Review Wedding" });
      await expect(trigger).toBeVisible();
      await trigger.click();

      const editor = page.locator(LIBRARY_TEMPLATE_EDITOR_ROUTE.surfaceSelector);
      await expect(editor).toBeVisible();
      await expect(editor.locator(".ambient-library__editor > .embedded-workspace-route")).toBeVisible();
      await expect(editor.locator("[data-admin-tab-id=\"templates\"]")).toHaveClass(/active/u);
      await expect(editor.getByRole("heading", { name: LIBRARY_TEMPLATE_EDITOR_ROUTE.heading })).toBeVisible();
      await expect(editor.locator("[data-library-acknowledgement]")).toHaveAttribute("data-result-kind", "context");
      await expect(page.getByRole("dialog")).toHaveCount(0);

      const focusTarget = editor.locator(LIBRARY_TEMPLATE_EDITOR_ROUTE.focusSelector);
      await focusTarget.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        window.scrollTo({ top: Math.max(0, window.scrollY + rect.top - 96), behavior: "instant" });
        element.focus({ preventScroll: true });
      });
      await expect(focusTarget).toBeFocused();
      await expectRouteGeometry(page, LIBRARY_TEMPLATE_EDITOR_ROUTE);

      const flow = await editor.evaluate((element) => {
        const style = getComputedStyle(element);
        const nestedEditor = element.querySelector(".ambient-library__editor");
        return {
          position: style.position,
          editorPosition: nestedEditor ? getComputedStyle(nestedEditor).position : "missing",
          overflowX: element.scrollWidth - element.clientWidth,
          documentOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
        };
      });
      expect(flow).toMatchObject({ position: "static", editorPosition: "static" });
      expect(flow.overflowX).toBeLessThanOrEqual(1);
      expect(flow.documentOverflowX).toBeLessThanOrEqual(1);

      if (CAPTURE_PROOF && (viewport.width === 390 || viewport.width === 1440)) {
        await captureTransientProof(page, `workspace-no-overlap-library-template-editor-${viewport.width}.png`);
      }

      await editor.getByRole("button", { name: "Back to Library" }).click();
      await expect(library).toBeVisible();
      await expect(page.locator("#ambient-library-title")).toBeFocused();
    });
  }

  for (const viewport of VIEWPORTS) {
    test(`opened header menus stay contained and restore focus at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/app");
      await expect(page.locator("#now-heading")).toHaveText("Today, in clear view.", { timeout: 30_000 });
      if (viewport.width <= 640) {
        const trigger = page.getByRole("button", { name: "Workspace and tools", exact: true });
        await trigger.click();
        const dialog = page.getByRole("dialog", { name: "Workspace & tools" });
        await expect(dialog).toBeVisible();
        await expectContainedTransientGeometry(page, {
          id: "header-workspace-tools",
          surfaceSelector: ".workspace-tools-dialog",
          triggerSelector: ".workspace-tools-trigger[aria-expanded='true']",
          expectedDeclaration: "data-layout-overlap-allowed",
          allowScrollEdgeClipping: true,
          centerScrollableControls: true,
          peerGroups: [{
            rootSelector: ".workspace-tools-dialog__header",
            childSelector: ":scope > *"
          }]
        });
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(trigger).toBeFocused();
        return;
      }
      const menuNames = ["Operations"];
      for (const menuName of menuNames) {
        const trigger = page.getByRole("button", { name: menuName, exact: true });
        await trigger.click();
        const menu = page.getByRole("menu", { name: menuName });
        await expect(menu).toBeVisible();
        await expectContainedTransientGeometry(page, {
          id: `header-${menuName.toLowerCase()}`,
          surfaceSelector: `[role="menu"][aria-label="${menuName}"]`,
          triggerSelector: ".header-menu-trigger[aria-expanded='true']",
          expectedDeclaration: "aria-haspopup",
          peerGroups: [{ childSelector: ":scope > [role='menuitem']" }]
        });
        if (viewport.width === 1440 && menuName === "Operations") {
          await captureTransientProof(page, "workspace-no-overlap-header-operations-1440.png");
        }
        await page.keyboard.press("Escape");
        await expect(menu).toHaveCount(0);
        await expect(trigger).toBeFocused();
      }
    });

    test(`global Pilot context stays exact, contained, and focus-safe at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(`/app/quotes/${REVIEW_QUOTE.id}`);
      await expect(page.locator(".ambient-living-opportunity")).toBeVisible({ timeout: 30_000 });
      const trigger = page.getByRole("button", { name: "Workspace and tools", exact: true });
      await trigger.click();
      const tools = page.getByRole("dialog", { name: "Workspace & tools" });
      await expect(tools).toBeVisible();
      await tools.getByRole("button", { name: "Pilot", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Why this recommendation appears" });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("Autumn Benefit Dinner");
      await expectContainedTransientGeometry(page, {
        id: "global-pilot-context",
        surfaceSelector: ".ambient-pilot-context-surface .ambient-context-surface__dialog",
        triggerSelector: ".workspace-tools-trigger",
        expectedDeclaration: "data-layout-overlap-allowed",
        peerGroups: [
          { rootSelector: ".ambient-context-surface__header", childSelector: ":scope > *" }
        ]
      });
      if (CAPTURE_PROOF && viewport.width === 1440) {
        await captureTransientProof(page, "workspace-no-overlap-global-pilot-1440.png");
      }
      await dialog.getByRole("button", { name: "Close context" }).click();
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
    });

    test(`commercial search dialog stays contained with bounded results at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/app");
      const trigger = viewport.width <= 640
        ? page.getByRole("button", { name: "Workspace and tools", exact: true })
        : page.getByRole("button", { name: "Search", exact: true });
      if (viewport.width <= 640) {
        await trigger.click();
        const tools = page.getByRole("dialog", { name: "Workspace & tools" });
        await expect(tools).toBeVisible();
        await tools.getByRole("button", { name: "Search customers and opportunities", exact: true }).click();
      } else {
        await trigger.click();
      }
      const dialog = page.getByRole("dialog", { name: "Find a customer or quote" });
      await expect(dialog).toBeVisible();
      const input = dialog.getByRole("searchbox");
      await expect(input).toBeFocused();
      await input.fill("Avery");
      await expect(dialog.getByRole("button", { name: /Open quote/iu }).first()).toBeVisible({ timeout: 10_000 });
      await expectContainedTransientGeometry(page, {
        id: "commercial-search",
        surfaceSelector: ".commercial-search-card",
        triggerSelector: viewport.width <= 640
          ? ".workspace-tools-trigger"
          : ".commercial-search-trigger",
        expectedDeclaration: "data-layout-overlap-allowed",
        peerGroups: [
          { rootSelector: ".commercial-search-head", childSelector: ":scope > *" },
          { rootSelector: ".commercial-search-form", childSelector: ":scope > *" }
        ]
      });
      if (viewport.width === 1440) {
        await captureTransientProof(page, "workspace-no-overlap-commercial-search-1440.png");
      }
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
    });

    test(`package context surface stays contained and restores focus at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(`/app/quotes/${REVIEW_QUOTE.id}`);
      const opportunity = page.locator(".ambient-living-opportunity");
      await expect(opportunity).toBeVisible({ timeout: 30_000 });
      const trigger = opportunity.getByRole("button", { name: "Review package" });
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "Package details" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Close context" })).toBeFocused();
      await expectContainedTransientGeometry(page, {
        id: "package-context",
        surfaceSelector: ".ambient-context-surface__dialog",
        expectedDeclaration: "data-layout-overlap-allowed",
        allowScrollEdgeClipping: true,
        peerGroups: [
          { rootSelector: ".ambient-context-surface__header", childSelector: ":scope > *" }
        ]
      });
      if (viewport.width === 1440) {
        await captureTransientProof(page, "workspace-no-overlap-package-context-1440.png");
      }
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
    });

    test(`Money context surface stays contained and restores focus at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(`/app/quotes/${REVIEW_QUOTE.id}`);
      const opportunity = page.locator(".ambient-living-opportunity");
      await expect(opportunity).toBeVisible({ timeout: 30_000 });
      const trigger = opportunity.getByRole("button", { name: "Review payments" });
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "Payments and balance" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Close context" })).toBeFocused();
      await expect(dialog.locator("[data-money-stage]")).toHaveCount(5);
      await expectContainedTransientGeometry(page, {
        id: "money-context",
        surfaceSelector: ".ambient-context-surface__dialog",
        expectedDeclaration: "data-layout-overlap-allowed",
        peerGroups: [
          { rootSelector: ".ambient-context-surface__header", childSelector: ":scope > *" },
          { rootSelector: ".ambient-money-context__rail", childSelector: ":scope > li" }
        ]
      });
      if (viewport.width === 1440) {
        await captureTransientProof(page, "workspace-no-overlap-money-context-1440.png");
      }
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
    });

    test(`Proposal context surface stays contained and restores focus at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(`/app/quotes/${REVIEW_QUOTE.id}`);
      const opportunity = page.locator(".ambient-living-opportunity");
      await expect(opportunity).toBeVisible({ timeout: 30_000 });
      const trigger = opportunity.getByRole("button", { name: "Review proposal", exact: true });
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "Proposal details" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Close context" })).toBeFocused();
      await expect(dialog.locator("[data-proposal-evidence]")).toHaveCount(4);
      await expect(dialog.locator("[data-proposal-action]")).toHaveCount(4);
      await expectContainedTransientGeometry(page, {
        id: "proposal-context",
        surfaceSelector: ".ambient-context-surface__dialog",
        expectedDeclaration: "data-layout-overlap-allowed",
        peerGroups: [
          { rootSelector: ".ambient-context-surface__header", childSelector: ":scope > *" },
          { rootSelector: ".ambient-proposal-context__evidence-grid", childSelector: ":scope > article" }
        ]
      });
      if (viewport.width === 1440) {
        await captureTransientProof(page, "workspace-no-overlap-proposal-context-1440.png");
      }
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
    });

    test(`Conversation context surface stays contained and restores focus at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(`/app/quotes/${SEED_QUOTE.id}`);
      const opportunity = page.locator(".ambient-living-opportunity");
      await expect(opportunity).toBeVisible({ timeout: 30_000 });
      const trigger = opportunity.getByRole("button", { name: "Review conversation" });
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "Conversation details" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Close context" })).toBeFocused();
      await expect(dialog).toContainText("Autumn Benefit Dinner, Q-LAYOUT-PROOF");
      await expect(dialog).toContainText("Why this is here");
      await expect(dialog).toContainText("What this affects");
      const evidenceRails = dialog.locator("[data-conversation-evidence]");
      await expect(evidenceRails).toHaveCount(5);
      expect(await evidenceRails.evaluateAll((nodes) => (
        nodes.map((node) => node.getAttribute("data-conversation-evidence"))
      ))).toEqual([
        "sent",
        "provider-delivered",
        "portal-viewed",
        "replied",
        "inferred-engagement"
      ]);
      await expect(dialog.getByRole("button", { name: /send|mark(?: as)? read/iu })).toHaveCount(0);
      await expectContainedTransientGeometry(page, {
        id: "conversation-context",
        surfaceSelector: ".ambient-context-surface__dialog",
        expectedDeclaration: "data-layout-overlap-allowed",
        peerGroups: [
          { rootSelector: ".ambient-context-surface__header", childSelector: ":scope > *" },
          { rootSelector: ".ambient-conversation-context__evidence ol", childSelector: ":scope > li" }
        ]
      });
      if (viewport.width === 1440) {
        await captureTransientProof(page, "workspace-no-overlap-conversation-context-1440.png");
      }
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
    });

    test(`Pilot deterministic answer stays in flow with no unintended overlap at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(`/app/quotes/${REVIEW_QUOTE.id}/edit`);
      const command = page.locator('[data-pilot-command="pilot-deterministic-command-v1"]');
      await expect(command).toBeVisible({ timeout: 30_000 });
      await command.getByRole("textbox", { name: "Command for this draft" }).fill("Explain this price");
      await command.getByRole("button", { name: "Preview" }).click();
      const answer = command.locator('[data-pilot-query-kind="price_explanation"]');
      await expect(answer).toBeVisible();
      await expect(answer).toContainText("If you do nothing");
      const heading = answer.getByRole("heading", { name: PILOT_QUERY_ROUTE.heading });
      await heading.evaluate((element) => {
        element.setAttribute("tabindex", "-1");
        element.focus({ preventScroll: true });
      });
      await expect(heading).toBeFocused();
      await expectRouteGeometry(page, PILOT_QUERY_ROUTE);
      const flow = await answer.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          position: style.position,
          overflowX: element.scrollWidth - element.clientWidth,
          documentOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
        };
      });
      expect(flow).toMatchObject({ position: "static" });
      expect(flow.overflowX).toBeLessThanOrEqual(1);
      expect(flow.documentOverflowX).toBeLessThanOrEqual(1);
      if (viewport.width === 1440) {
        await captureTransientProof(page, "workspace-no-overlap-pilot-price-explanation-1440.png");
      }
    });

    test(`Pilot scenario review stays explicit and in flow at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(`/app/quotes/${REVIEW_QUOTE.id}/edit`);
      const command = page.locator('[data-pilot-command="pilot-deterministic-command-v1"]');
      await expect(command).toBeVisible({ timeout: 30_000 });
      await command.getByRole("textbox", { name: "Command for this draft" }).fill("get this under $9,000");
      await command.getByRole("button", { name: "Preview" }).click();
      const scenario = command.locator('[data-pilot-scenario-state="available"]');
      await expect(scenario).toBeVisible();
      await expect(scenario).toContainText("What changes in this option");
      await scenario.getByRole("button", { name: /Adopt in draft review/ }).first().click();

      const review = page.locator(PILOT_SCENARIO_REVIEW_ROUTE.surfaceSelector);
      await expect(review).toBeVisible();
      await expect(review).toHaveAttribute("data-ambient-pilot-scenario-review", "available");
      await expect(review).toContainText("Classic");
      await expect(review).toContainText("Focused");
      await expect(review).toContainText("What this option changes");
      await expect(review).toContainText("If you do nothing");
      await expect(review).toContainText("Draft only. Nothing changes until you save.");
      const apply = review.locator(PILOT_SCENARIO_REVIEW_ROUTE.focusSelector);
      await expect(apply).toBeFocused();
      await expectRouteGeometry(page, PILOT_SCENARIO_REVIEW_ROUTE);
      if (viewport.width === 1440) {
        await review.scrollIntoViewIfNeeded();
        await captureTransientProof(page, "ambient-pilot-scenario-review-pending-1440.png");
      }
      const beforeApply = await page.evaluate((quoteId) => {
        const quotes = JSON.parse(localStorage.getItem("quoteWizard.quotes") || "[]");
        return quotes.find((quote) => quote.id === quoteId)?.selection?.packageId || "";
      }, REVIEW_QUOTE.id);
      expect(beforeApply).toBe("classic");

      await apply.click();
      await expect(review).toHaveAttribute("data-review-state", "resolved");
      await expect(review.getByRole("status")).toContainText("reviewed option is now in your draft");
      await expect(page.locator('[data-ambient-field="pkg"]')).toHaveValue("focused");
      await page.getByRole("button", { name: /^Next:/ }).click();
      await page.getByRole("button", { name: /^Next:/ }).click();
      await expect(page.getByRole("button", { name: "Save Pilot scenario" })).toBeVisible();
      const afterApply = await page.evaluate((quoteId) => {
        const quotes = JSON.parse(localStorage.getItem("quoteWizard.quotes") || "[]");
        return quotes.find((quote) => quote.id === quoteId)?.selection?.packageId || "";
      }, REVIEW_QUOTE.id);
      expect(afterApply).toBe("classic");
      const flow = await review.evaluate((element) => ({
        position: getComputedStyle(element).position,
        overflowX: element.scrollWidth - element.clientWidth,
        documentOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
      }));
      expect(flow).toMatchObject({ position: "static" });
      expect(flow.overflowX).toBeLessThanOrEqual(1);
      expect(flow.documentOverflowX).toBeLessThanOrEqual(1);
      if (viewport.width === 1440) {
        await captureTransientProof(page, "workspace-no-overlap-pilot-scenario-review-1440.png");
      }
    });
  }

  for (const viewport of VIEWPORTS.filter(({ width }) => width <= 980)) {
    test(`mobile Live Breakdown is a contained intentional dialog at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openReviewQuoteEditorViaPackage(page);
      const mobileSummary = page.getByTestId("mobile-pricing-summary");
      await expect(mobileSummary).toBeVisible();
      const trigger = mobileSummary.getByRole("button", { name: "View breakdown" });
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "Live Breakdown" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
      await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
      await expect(page.locator(".site-header")).toHaveAttribute("inert", "");
      await expectContainedTransientGeometry(page, {
        id: "mobile-live-breakdown",
        surfaceSelector: "#live-breakdown",
        triggerSelector: "[aria-controls='live-breakdown'][aria-expanded='true']",
        expectedDeclaration: "aria-controls",
        peerGroups: [
          { rootSelector: ".breakdown-head", childSelector: ":scope > *" }
        ]
      });
      if (viewport.width === 390) {
        await captureTransientProof(page, "workspace-no-overlap-live-breakdown-390.png");
      }
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await expect(trigger).toBeFocused();
    });
  }

  for (const viewport of VIEWPORTS) {
    test(`quote editor Package review has no unintended overlap at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openReviewQuoteEditorViaPackage(page);
      const review = page.locator(DRAFT_REVIEW_ROUTE.surfaceSelector);
      await expect(review).toBeVisible();
      await expect(review).toHaveAttribute("data-ambient-draft-review-state", "pending_review");
      await expect(review.getByRole("heading", { name: DRAFT_REVIEW_ROUTE.heading })).toBeVisible();
      const apply = review.locator(DRAFT_REVIEW_ROUTE.focusSelector);
      await apply.focus();
      await expect(apply).toBeFocused();

      await expect(review).toContainText("Draft only. Nothing changes until you save.");
      await expectRouteGeometry(page, DRAFT_REVIEW_ROUTE);

      if (CAPTURE_PROOF && viewport.width === 1440) {
        mkdirSync(PROOF_DIRECTORY, { recursive: true });
        await review.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `${PROOF_DIRECTORY}/workspace-no-overlap-quote-editor-package-review-1440.png`,
          animations: "disabled"
        });
      }
    });
  }
});
