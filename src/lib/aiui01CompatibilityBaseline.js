import {
  buildCustomerPath,
  buildQuoteEditPath,
  buildQuotePath,
  WORKSPACE_PATHS,
  WORKSPACE_ROUTE_IDS
} from "./workspaceRoutes";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function flagEnabled(value) {
  return TRUE_VALUES.has(String(value ?? "").trim().toLowerCase());
}

export const AIUI01_BASELINE_ID = "aiui-01-compatibility-dead-click-v1";
export const AIUI01_ACKNOWLEDGEMENT_BUDGET_MS = 250;

export const AIUI01_VIEWPORTS = deepFreeze([
  { id: "phone", width: 390, height: 844 },
  { id: "tablet", width: 768, height: 900 },
  { id: "desktop", width: 1440, height: 1000 }
]);

export const AIUI01_ROLES = deepFreeze([
  {
    id: "admin",
    staff: true,
    routeAuthority: ["catalog", "imports", "staff"],
    quoteAuthority: ["proposal", "payment", "booking", "delete"],
    providerAuthority: "manage"
  },
  {
    id: "sales",
    staff: true,
    routeAuthority: [],
    quoteAuthority: ["proposal"],
    providerAuthority: "read_only"
  }
]);

export const AIUI01_GATES = deepFreeze({
  workspace: "VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED",
  ambient: "VITE_AMBIENT_UI_ENABLED",
  operationalStaffing: "VITE_OPERATIONAL_STAFFING_ENABLED",
  productionPilot: [
    "VITE_PILOT_NOW_ENABLED",
    "VITE_PILOT_EVENT_ROOM_ENABLED",
    "VITE_PILOT_GUIDED_SELLING_ENABLED",
    "VITE_PILOT_CREATE_ENABLED",
    "VITE_PILOT_CHANGE_REQUESTS_ENABLED",
    "VITE_PILOT_COMMAND_ENABLED",
    "VITE_PILOT_MARGINS_ENABLED",
    "VITE_PILOT_DECISION_ROOM_ENABLED"
  ],
  localOnlyPilot: ["VITE_PILOT_MEMORY_ENABLED"]
});

const ALL_GATES = [
  AIUI01_GATES.workspace,
  AIUI01_GATES.ambient,
  AIUI01_GATES.operationalStaffing,
  ...AIUI01_GATES.productionPilot,
  ...AIUI01_GATES.localOnlyPilot
];

function gateValues(enabled = []) {
  const enabledSet = new Set(enabled);
  return Object.fromEntries(ALL_GATES.map((gate) => [gate, enabledSet.has(gate)]));
}

export const AIUI01_FLAG_PROFILES = deepFreeze([
  {
    id: "legacy-rollback",
    intent: "Exact flag-off staff presentation and rollback floor.",
    gates: gateValues([]),
    browserQualification: "full"
  },
  {
    id: "workspace-only",
    intent: "Customer-centered shell with every Pilot and Ambient presentation gate off.",
    gates: gateValues([AIUI01_GATES.workspace]),
    browserQualification: "variants"
  },
  {
    id: "production-pilot",
    intent: "Reviewed production-bound Pilot presentation set with Ambient and Memory off.",
    gates: gateValues([AIUI01_GATES.workspace, ...AIUI01_GATES.productionPilot]),
    browserQualification: "variants"
  },
  {
    id: "ambient-alpha",
    intent: "Production Pilot compatibility set plus the separately default-off Ambient Alpha.",
    gates: gateValues([
      AIUI01_GATES.workspace,
      AIUI01_GATES.ambient,
      ...AIUI01_GATES.productionPilot
    ]),
    browserQualification: "full"
  },
  {
    id: "local-memory",
    intent: "Separate local-only Memory evaluation with CREATE enabled; not production-bound.",
    gates: gateValues([
      AIUI01_GATES.workspace,
      "VITE_PILOT_CREATE_ENABLED",
      "VITE_PILOT_MEMORY_ENABLED"
    ]),
    browserQualification: "component-program"
  }
]);

export function resolveAiui01Flags(environment = {}) {
  const raw = Object.fromEntries(ALL_GATES.map((gate) => [gate, flagEnabled(environment[gate])]));
  const effective = {
    workspace: raw[AIUI01_GATES.workspace],
    ambient: raw[AIUI01_GATES.ambient],
    operationalStaffing: raw[AIUI01_GATES.operationalStaffing],
    now: raw[AIUI01_GATES.workspace] && raw.VITE_PILOT_NOW_ENABLED,
    eventRoom: raw.VITE_PILOT_EVENT_ROOM_ENABLED,
    guidedSelling: raw.VITE_PILOT_GUIDED_SELLING_ENABLED,
    create: raw.VITE_PILOT_CREATE_ENABLED,
    memory: raw.VITE_PILOT_CREATE_ENABLED && raw.VITE_PILOT_MEMORY_ENABLED,
    changeRequests: raw.VITE_PILOT_CHANGE_REQUESTS_ENABLED,
    command: raw.VITE_PILOT_COMMAND_ENABLED,
    expandedPilotCommands: raw[AIUI01_GATES.ambient] && raw.VITE_PILOT_COMMAND_ENABLED,
    margins: raw.VITE_PILOT_MARGINS_ENABLED,
    decisionRoom: raw.VITE_PILOT_DECISION_ROOM_ENABLED,
    ambientDecisionRoom: raw[AIUI01_GATES.ambient] && raw.VITE_PILOT_DECISION_ROOM_ENABLED
  };
  const profile = AIUI01_FLAG_PROFILES.find((candidate) => (
    ALL_GATES.every((gate) => candidate.gates[gate] === raw[gate])
  ));
  return deepFreeze({ raw, effective, profileId: profile?.id || "custom" });
}

const CUSTOMER_FIXTURE_ID = "aiui01-customer";
const QUOTE_FIXTURE_ID = "aiui01-quote";

export const AIUI01_SURFACES = deepFreeze([
  {
    id: "home",
    routeId: WORKSPACE_ROUTE_IDS.HOME,
    path: WORKSPACE_PATHS.home,
    roles: ["admin", "sales"],
    requiresWorkspace: false,
    probes: { legacy: ".wizard-panel", workspace: ".command-center", now: ".now-surface" }
  },
  {
    id: "customers",
    routeId: WORKSPACE_ROUTE_IDS.CUSTOMER_LIST,
    path: WORKSPACE_PATHS.customers,
    roles: ["admin", "sales"],
    requiresWorkspace: true,
    probes: { default: ".customer-directory" }
  },
  {
    id: "customer-detail",
    routeId: WORKSPACE_ROUTE_IDS.CUSTOMER_DETAIL,
    path: buildCustomerPath(CUSTOMER_FIXTURE_ID),
    roles: ["admin", "sales"],
    requiresWorkspace: true,
    probes: { default: ".customer-workspace" }
  },
  {
    id: "quotes",
    routeId: WORKSPACE_ROUTE_IDS.QUOTE_LIST,
    path: WORKSPACE_PATHS.quotes,
    roles: ["admin", "sales"],
    requiresWorkspace: false,
    probes: { default: "#quote-history-title" }
  },
  {
    id: "quote-new",
    routeId: WORKSPACE_ROUTE_IDS.QUOTE_NEW,
    path: WORKSPACE_PATHS.quoteNew,
    roles: ["admin", "sales"],
    requiresWorkspace: false,
    probes: { default: ".wizard-panel" }
  },
  {
    id: "quote-detail",
    routeId: WORKSPACE_ROUTE_IDS.QUOTE_DETAIL,
    path: buildQuotePath(QUOTE_FIXTURE_ID),
    roles: ["admin", "sales"],
    requiresWorkspace: false,
    probes: {
      legacyRoute: "#quote-history-title",
      workspace: ".event-workspace",
      ambient: ".ambient-living-opportunity"
    }
  },
  {
    id: "quote-edit",
    routeId: WORKSPACE_ROUTE_IDS.QUOTE_EDIT,
    path: buildQuoteEditPath(QUOTE_FIXTURE_ID),
    roles: ["admin", "sales"],
    requiresWorkspace: false,
    probes: { default: ".wizard-panel" }
  },
  {
    id: "messages",
    routeId: WORKSPACE_ROUTE_IDS.MESSAGING,
    path: WORKSPACE_PATHS.messaging,
    roles: ["admin", "sales"],
    requiresWorkspace: true,
    probes: { default: ".messaging-station" }
  },
  {
    id: "staff",
    routeId: WORKSPACE_ROUTE_IDS.STAFF,
    path: WORKSPACE_PATHS.staff,
    roles: ["admin"],
    requiresWorkspace: true,
    requiresOperationalStaffing: true,
    probes: { default: ".staff-workspace" }
  },
  {
    id: "workflow",
    routeId: WORKSPACE_ROUTE_IDS.WORKFLOW,
    path: WORKSPACE_PATHS.workflow,
    roles: ["admin", "sales"],
    requiresWorkspace: false,
    probes: { default: "#sales-workflow-title" }
  },
  {
    id: "schedule",
    routeId: WORKSPACE_ROUTE_IDS.SCHEDULE,
    path: WORKSPACE_PATHS.schedule,
    roles: ["admin", "sales"],
    requiresWorkspace: false,
    probes: { default: "#event-schedule-title" }
  },
  {
    id: "reporting",
    routeId: WORKSPACE_ROUTE_IDS.REPORTING,
    path: WORKSPACE_PATHS.reporting,
    roles: ["admin", "sales"],
    requiresWorkspace: false,
    probes: { default: "#reporting-dashboard-title" }
  },
  {
    id: "catalog",
    routeId: WORKSPACE_ROUTE_IDS.CATALOG,
    path: WORKSPACE_PATHS.catalog,
    roles: ["admin"],
    requiresWorkspace: false,
    probes: { default: "#catalog-admin-title" }
  },
  {
    id: "imports",
    routeId: WORKSPACE_ROUTE_IDS.IMPORTS,
    path: WORKSPACE_PATHS.imports,
    roles: ["admin"],
    requiresWorkspace: false,
    probes: { default: "#import-studio-title" }
  },
  {
    id: "integrations",
    routeId: WORKSPACE_ROUTE_IDS.INTEGRATIONS,
    path: WORKSPACE_PATHS.integrations,
    roles: ["admin", "sales"],
    requiresWorkspace: false,
    probes: { default: "#integration-ops-title" }
  },
  {
    id: "diagnostics",
    routeId: WORKSPACE_ROUTE_IDS.DIAGNOSTICS,
    path: WORKSPACE_PATHS.diagnostics,
    roles: ["admin", "sales"],
    requiresWorkspace: false,
    probes: { default: "#session-diagnostics-title" }
  }
]);

export const AIUI01_SHELL_ACTIONS = deepFreeze([
  { id: "home", label: "Home", classification: "primary_route", targetSurfaceId: "home", roles: ["admin", "sales"], requiresWorkspace: true, entry: "header" },
  { id: "customers", label: "Customers", classification: "primary_route", targetSurfaceId: "customers", roles: ["admin", "sales"], requiresWorkspace: true, entry: "header" },
  { id: "search", label: "Search", classification: "primary_context", targetSurfaceId: "commercial-search", roles: ["admin", "sales"], requiresWorkspace: true, entry: "header" },
  { id: "new-quote", label: "New quote", classification: "primary_route", targetSurfaceId: "quote-new", roles: ["admin", "sales"], requiresWorkspace: false, entry: "header" },
  { id: "quotes", label: "Quotes", classification: "primary_route", targetSurfaceId: "quotes", roles: ["admin", "sales"], requiresWorkspace: false, entry: "header" },
  { id: "messages", label: "Messages", classification: "primary_route", targetSurfaceId: "messages", roles: ["admin", "sales"], requiresWorkspace: true, entry: "header" },
  { id: "staff", label: "Staff", classification: "primary_route", targetSurfaceId: "staff", roles: ["admin"], requiresWorkspace: true, requiresOperationalStaffing: true, entry: "operations" },
  { id: "workflow", label: "Workflow", namePattern: "^Workflow(?:,|$)", classification: "primary_route", targetSurfaceId: "workflow", roles: ["admin", "sales"], requiresWorkspace: false, entry: "header" },
  { id: "schedule", label: "Event Schedule", classification: "primary_route", targetSurfaceId: "schedule", roles: ["admin", "sales"], requiresWorkspace: false, entry: "operations", legacyOutcome: "modal_context" },
  { id: "reporting", label: "Reporting Dashboard", classification: "primary_route", targetSurfaceId: "reporting", roles: ["admin", "sales"], requiresWorkspace: false, entry: "operations", legacyOutcome: "modal_context" },
  { id: "integrations", label: "Integrations Ops", classification: "primary_route", targetSurfaceId: "integrations", roles: ["admin", "sales"], requiresWorkspace: false, entry: "operations", legacyOutcome: "modal_context" },
  { id: "imports", label: "Import Studio", classification: "primary_route", targetSurfaceId: "imports", roles: ["admin"], requiresWorkspace: false, entry: "operations", legacyOutcome: "modal_context" },
  { id: "catalog", label: "Catalog Admin", classification: "primary_route", targetSurfaceId: "catalog", roles: ["admin"], requiresWorkspace: false, entry: "operations", legacyOutcome: "modal_context" },
  { id: "diagnostics", label: "Session Diagnostics", classification: "primary_route", targetSurfaceId: "diagnostics", roles: ["admin", "sales"], requiresWorkspace: false, entry: "operations", legacyOutcome: "modal_context" },
  { id: "operations-menu", label: "Operations", classification: "launcher", roles: ["admin", "sales"], responsiveAlias: "More" },
  { id: "account-menu", label: "Account", classification: "utility", roles: ["admin", "sales"], responsiveAlias: "More" },
  { id: "customer-portal", label: "Customer Portal", classification: "utility", roles: ["admin", "sales"] },
  { id: "sounds", label: "Sounds", classification: "preference", roles: ["admin", "sales"] },
  { id: "sign-out", label: "Sign Out", classification: "security", roles: ["admin", "sales"] }
]);

export const AIUI01_EVENT_WORKSPACE_PARITY = deepFreeze([
  { id: "back-to-quotes", legacy: "enabled", ambient: "enabled", parity: "covered" },
  { id: "ordinary-edit", legacy: "role-and-state-gated", ambient: "contextual-next-action", parity: "partial" },
  { id: "more-quote-actions", legacy: "enabled", ambient: "not-host-bound", parity: "gap" },
  { id: "workflow", legacy: "contextual-next-action", ambient: "contextual-next-action", parity: "covered" },
  { id: "schedule", legacy: "feature-gated", ambient: "not-host-bound", parity: "gap" },
  { id: "sold-rentals", legacy: "enabled", ambient: "read-only-disclosure", parity: "partial" },
  { id: "production-beo", legacy: "source-and-role-gated", ambient: "not-host-bound", parity: "gap" },
  { id: "customer-360", legacy: "customer-id-gated", ambient: "not-host-bound", parity: "gap" },
  { id: "download-pdf", legacy: "role-and-state-gated", ambient: "not-host-bound", parity: "gap" },
  { id: "conversation", legacy: "firebase-portal-gated", ambient: "contextual-when-available", parity: "partial" },
  { id: "full-opportunity-controls", legacy: "not-applicable", ambient: "component-optional-host-absent", parity: "gap" }
]);

export const AIUI01_DATA_MODES = deepFreeze([
  {
    id: "browser-local-fallback",
    firebaseConfigured: false,
    authMode: "e2e-bypass-only",
    catalogMode: "VITE_ALLOW_LOCAL_CATALOG_FALLBACK=true",
    quoteMode: "browser-local",
    browserQualifiedHere: true,
    authorityClaim: "presentation-and-local-storage-only"
  },
  {
    id: "firebase-emulator",
    firebaseConfigured: true,
    authMode: "firebase-auth-emulator",
    catalogMode: "tenant-firestore",
    quoteMode: "tenant-firestore-and-callables",
    browserQualifiedHere: false,
    authorityClaim: "separate-lane-evidence-only",
    evidenceProgramId: "firebase-auth-rules"
  }
]);

export const AIUI01_PORTAL_PRECEDENCE = deepFreeze({
  paths: [
    "/",
    WORKSPACE_PATHS.home,
    WORKSPACE_PATHS.quoteNew,
    buildQuotePath(QUOTE_FIXTURE_ID),
    WORKSPACE_PATHS.staff,
    WORKSPACE_PATHS.catalog,
    "/start",
    "/app/not-a-route"
  ],
  localBrowserFixture: true,
  firebaseTokenAuthorityQualifiedHere: false,
  firebaseEvidenceProgramId: "firebase-auth-rules",
  claim: "A non-empty portal query selects the customer portal before public or staff routing; local rendering is not Firebase token-authority evidence."
});

export const AIUI01_EVIDENCE_PROGRAMS = deepFreeze([
  {
    id: "aiui01-focused-unit",
    kind: "unit",
    command: "npx vitest run src/lib/__tests__/aiui01CompatibilityBaseline.test.js",
    files: ["src/lib/__tests__/aiui01CompatibilityBaseline.test.js"]
  },
  {
    id: "aiui01-focused-browser",
    kind: "local-browser",
    command: "AIUI01_BASELINE_ENABLED=true bash scripts/run-playwright.sh test e2e/aiui01-compatibility-baseline.spec.js --project=chromium-admin --workers=1",
    files: ["e2e/aiui01-compatibility-baseline.spec.js"]
  },
  {
    id: "workspace-routes",
    kind: "existing-local-browser",
    command: "VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED=true npm run test:e2e",
    files: ["e2e/customer-centered-workspace.spec.js", "src/lib/__tests__/workspaceRoutes.test.js"]
  },
  {
    id: "sales-role",
    kind: "existing-local-browser",
    command: "npm run test:e2e",
    files: ["e2e/quote-history-role-permissions.spec.js"]
  },
  {
    id: "ambient-actions",
    kind: "existing-local-browser-and-unit",
    command: "VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED=true VITE_AMBIENT_UI_ENABLED=true npm run test:e2e",
    files: [
      "e2e/ambient-intelligence-accessibility.spec.js",
      "src/components/__tests__/ambientLivingOpportunity.test.jsx",
      "src/components/__tests__/ambientLivingOpportunityContracts.test.js"
    ]
  },
  {
    id: "pilot-components",
    kind: "existing-unit",
    command: "npm run test:unit",
    files: [
      "src/components/__tests__/stepServicesGuidedDecisions.test.jsx",
      "src/components/__tests__/createIntake.test.jsx",
      "src/components/__tests__/createIntakeEventShapeMemory.flagOn.test.jsx",
      "src/components/__tests__/customerPortalAskAbout.flagOn.test.jsx"
    ]
  },
  {
    id: "firebase-auth-rules",
    kind: "separate-firebase-emulator-browser",
    command: "npm run test:e2e:firebase",
    files: ["e2e/firebase-auth-rules.smoke.spec.js"],
    claims: ["real-emulator-auth", "tenant-firestore", "exact-portal-token", "staff-customer-conversation"]
  },
  {
    id: "firebase-authoritative-pricing",
    kind: "separate-firebase-emulator-browser",
    command: "npm run test:e2e:firebase:authoritative",
    files: ["e2e/firebase-authoritative-pricing.smoke.spec.js"],
    claims: ["callable-authoritative-save", "portal-not-activated-by-browser"]
  }
]);

export const AIUI01_SCOPE_LIMITS = deepFreeze([
  "The focused browser baseline measures current route-entry primary actions; mutations inside complex workspaces remain owned by their dedicated unit, browser, rules, and emulator programs.",
  "Local portal rendering proves routing precedence only. Exact Firebase token authorization stays in the separate firebase-auth-rules lane.",
  "Ambient Event Workspace parity remains open where the host has no full-controls handoff; this baseline records those gaps and does not close AIUI-01.",
  "Operational Staffing is represented only when its independent presentation gate is enabled; backend and tenant authority remain separately qualified.",
  "No hosted deployment, production data, provider behavior, timed human comprehension, or human acceptance is established."
]);

export function getAiui01Surface(surfaceId) {
  return AIUI01_SURFACES.find((surface) => surface.id === surfaceId) || null;
}

export function getAiui01SurfaceExpectation(surfaceId, { role = "sales", flags = {} } = {}) {
  const surface = getAiui01Surface(surfaceId);
  if (!surface) throw new TypeError(`Unknown AIUI-01 surface: ${String(surfaceId || "")}`);
  const resolvedFlags = flags?.effective ? flags : resolveAiui01Flags(flags);
  const authorized = surface.roles.includes(role);
  const available = authorized
    && (!surface.requiresWorkspace || resolvedFlags.effective.workspace)
    && (!surface.requiresOperationalStaffing || resolvedFlags.effective.operationalStaffing);
  let probe = surface.probes.default || "";
  if (surface.id === "home") {
    probe = resolvedFlags.effective.workspace
      ? resolvedFlags.effective.now ? surface.probes.now : surface.probes.workspace
      : surface.probes.legacy;
  }
  if (surface.id === "quote-detail") {
    probe = !resolvedFlags.effective.workspace
      ? surface.probes.legacyRoute
      : resolvedFlags.effective.ambient
        ? surface.probes.ambient
        : surface.probes.workspace;
  }
  return deepFreeze({
    surfaceId,
    role,
    available,
    outcome: available ? "surface" : "not-found",
    probe: available ? probe : ".workspace-not-found"
  });
}

export function getAiui01EnabledShellActions({ role = "sales", flags = {} } = {}) {
  const resolvedFlags = flags?.effective ? flags : resolveAiui01Flags(flags);
  return AIUI01_SHELL_ACTIONS.filter((action) => (
    action.roles.includes(role)
    && (!action.requiresWorkspace || resolvedFlags.effective.workspace)
    && (!action.requiresOperationalStaffing || resolvedFlags.effective.operationalStaffing)
  ));
}

export const AIUI01_COMPATIBILITY_BASELINE = deepFreeze({
  id: AIUI01_BASELINE_ID,
  acknowledgementBudgetMs: AIUI01_ACKNOWLEDGEMENT_BUDGET_MS,
  viewports: AIUI01_VIEWPORTS,
  roles: AIUI01_ROLES,
  gates: AIUI01_GATES,
  flagProfiles: AIUI01_FLAG_PROFILES,
  surfaces: AIUI01_SURFACES,
  shellActions: AIUI01_SHELL_ACTIONS,
  eventWorkspaceParity: AIUI01_EVENT_WORKSPACE_PARITY,
  dataModes: AIUI01_DATA_MODES,
  portalPrecedence: AIUI01_PORTAL_PRECEDENCE,
  evidencePrograms: AIUI01_EVIDENCE_PROGRAMS,
  scopeLimits: AIUI01_SCOPE_LIMITS
});
