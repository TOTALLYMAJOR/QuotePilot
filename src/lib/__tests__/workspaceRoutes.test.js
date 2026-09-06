import { describe, expect, test } from "vitest";
import {
  ADMIN_WORKSPACE_NAVIGATION,
  AMBIENT_PRIMARY_WORKSPACE_NAVIGATION,
  buildEventLivePath,
  buildEventPath,
  buildEventReplayPath,
  buildCustomerPath,
  buildMessagingPath,
  buildPortalPath,
  buildQuoteEditPath,
  buildQuotePath,
  buildWorkflowPath,
  buildWorkspacePath,
  parseWorkspaceLocation,
  parseWorkspacePath,
  PRIMARY_WORKSPACE_NAVIGATION,
  WORKSPACE_PATHS,
  WORKSPACE_ROUTE_IDS
} from "../workspaceRoutes";

describe("workspace route parsing and construction", () => {
  test.each([
    ["/app", WORKSPACE_ROUTE_IDS.HOME, "first-release"],
    ["/app/clear-the-deck", WORKSPACE_ROUTE_IDS.CLEAR_DECK, "follow-on"],
    ["/app/customers", WORKSPACE_ROUTE_IDS.CUSTOMER_LIST, "first-release"],
    ["/app/staff", WORKSPACE_ROUTE_IDS.STAFF, "follow-on"],
    ["/app/quotes", WORKSPACE_ROUTE_IDS.QUOTE_LIST, "first-release"],
    ["/app/quotes/new", WORKSPACE_ROUTE_IDS.QUOTE_NEW, "first-release"],
    ["/app/events", WORKSPACE_ROUTE_IDS.EVENT_LIST, "follow-on"],
    ["/app/messages", WORKSPACE_ROUTE_IDS.MESSAGING, "first-release"],
    ["/app/workflow", WORKSPACE_ROUTE_IDS.WORKFLOW, "first-release"],
    ["/app/operations", WORKSPACE_ROUTE_IDS.OPERATIONS, "follow-on"],
    ["/app/schedule", WORKSPACE_ROUTE_IDS.SCHEDULE, "follow-on"],
    ["/app/reporting", WORKSPACE_ROUTE_IDS.REPORTING, "follow-on"],
    ["/app/catalog", WORKSPACE_ROUTE_IDS.CATALOG, "follow-on"],
    ["/app/imports", WORKSPACE_ROUTE_IDS.IMPORTS, "follow-on"],
    ["/app/integrations", WORKSPACE_ROUTE_IDS.INTEGRATIONS, "follow-on"],
    ["/app/diagnostics", WORKSPACE_ROUTE_IDS.DIAGNOSTICS, "follow-on"]
  ])("recognizes %s as %s", (pathname, routeId, delivery) => {
    expect(parseWorkspacePath(pathname)).toMatchObject({
      routeId,
      delivery,
      isKnown: true,
      isWorkspace: true
    });
  });

  test("redirects legacy /app/home to the canonical command-center route", () => {
    expect(parseWorkspacePath("/app/home/")).toMatchObject({
      routeId: WORKSPACE_ROUTE_IDS.HOME,
      canonicalPath: "/app",
      redirectTo: "/app"
    });
  });

  test("redirects client-language aliases to the canonical customer routes", () => {
    expect(parseWorkspacePath("/app/clients/")).toMatchObject({
      routeId: WORKSPACE_ROUTE_IDS.CUSTOMER_LIST,
      canonicalPath: "/app/customers",
      redirectTo: "/app/customers"
    });

    expect(parseWorkspacePath("/app/clients/customer%3A01_%28west%29")).toMatchObject({
      routeId: WORKSPACE_ROUTE_IDS.CUSTOMER_DETAIL,
      canonicalPath: "/app/customers/customer%3A01_%28west%29",
      redirectTo: "/app/customers/customer%3A01_%28west%29",
      params: { customerId: "customer:01_(west)" }
    });
  });

  test("builds and parses opaque customer and quote identifiers", () => {
    const customerPath = buildCustomerPath("customer:01_(west)");
    const quotePath = buildQuotePath("quote:01_(draft)");
    const editPath = buildQuoteEditPath("quote:01_(draft)");
    const eventPath = buildEventPath("quote:01_(draft)");
    const livePath = buildEventLivePath("quote:01_(draft)");
    const replayPath = buildEventReplayPath("quote:01_(draft)");

    expect(customerPath).toBe("/app/customers/customer%3A01_%28west%29");
    expect(quotePath).toBe("/app/quotes/quote%3A01_%28draft%29");
    expect(editPath).toBe("/app/quotes/quote%3A01_%28draft%29/edit");
    expect(eventPath).toBe("/app/events/quote%3A01_%28draft%29");
    expect(livePath).toBe("/app/events/quote%3A01_%28draft%29/live");
    expect(replayPath).toBe("/app/events/quote%3A01_%28draft%29/replay");
    expect(parseWorkspacePath(customerPath).params).toEqual({ customerId: "customer:01_(west)" });
    expect(parseWorkspacePath(quotePath).params).toEqual({ quoteId: "quote:01_(draft)" });
    expect(parseWorkspacePath(editPath)).toMatchObject({
      routeId: WORKSPACE_ROUTE_IDS.QUOTE_EDIT,
      params: { quoteId: "quote:01_(draft)" }
    });
    expect(parseWorkspacePath(eventPath)).toMatchObject({
      routeId: WORKSPACE_ROUTE_IDS.EVENT_DETAIL,
      params: { quoteId: "quote:01_(draft)" }
    });
    expect(parseWorkspacePath(livePath)).toMatchObject({
      routeId: WORKSPACE_ROUTE_IDS.EVENT_LIVE,
      params: { quoteId: "quote:01_(draft)" }
    });
    expect(parseWorkspacePath(replayPath)).toMatchObject({
      routeId: WORKSPACE_ROUTE_IDS.EVENT_REPLAY,
      params: { quoteId: "quote:01_(draft)" }
    });
  });

  test("does not allow an email address to become a customer route identifier", () => {
    expect(() => buildCustomerPath("customer@example.com")).toThrow(/must not be an email/i);
    expect(parseWorkspacePath("/app/customers/customer%40example.com")).toMatchObject({
      routeId: WORKSPACE_ROUTE_IDS.NOT_FOUND,
      isWorkspace: true
    });
    expect(parseWorkspacePath("/app/clients/customer%40example.com")).toMatchObject({
      routeId: WORKSPACE_ROUTE_IDS.NOT_FOUND,
      isWorkspace: true
    });
  });

  test("treats malformed, reserved, and extra-deep workspace paths as authenticated not-found routes", () => {
    for (const pathname of [
      "/app/customers/%E0%A4%A",
      "/app/clients/%E0%A4%A",
      "/app/quotes/new/edit",
      "/app/quotes/a/extra",
      "/app/unknown"
    ]) {
      expect(parseWorkspacePath(pathname), pathname).toMatchObject({
        routeId: WORKSPACE_ROUTE_IDS.NOT_FOUND,
        isKnown: false,
        isWorkspace: true
      });
    }
    expect(parseWorkspacePath("/system")).toMatchObject({
      routeId: WORKSPACE_ROUTE_IDS.OUTSIDE,
      isWorkspace: false
    });
  });

  test("builds every parameterized first-release route from its identity", () => {
    expect(buildWorkspacePath(WORKSPACE_ROUTE_IDS.CUSTOMER_DETAIL, { customerId: "c-1" }))
      .toBe("/app/customers/c-1");
    expect(buildWorkspacePath(WORKSPACE_ROUTE_IDS.STAFF)).toBe(WORKSPACE_PATHS.staff);
    expect(buildWorkspacePath(WORKSPACE_ROUTE_IDS.QUOTE_DETAIL, { quoteId: "q-1" }))
      .toBe("/app/quotes/q-1");
    expect(buildWorkspacePath(WORKSPACE_ROUTE_IDS.QUOTE_EDIT, { quoteId: "q-1" }))
      .toBe("/app/quotes/q-1/edit");
    expect(buildWorkspacePath(WORKSPACE_ROUTE_IDS.QUOTE_NEW)).toBe(WORKSPACE_PATHS.quoteNew);
    expect(buildWorkspacePath(WORKSPACE_ROUTE_IDS.CLEAR_DECK)).toBe(WORKSPACE_PATHS.clearDeck);
    expect(buildWorkspacePath(WORKSPACE_ROUTE_IDS.EVENT_DETAIL, { quoteId: "q-1" }))
      .toBe("/app/events/q-1");
    expect(buildWorkspacePath(WORKSPACE_ROUTE_IDS.EVENT_LIVE, { quoteId: "q-1" }))
      .toBe("/app/events/q-1/live");
    expect(buildWorkspacePath(WORKSPACE_ROUTE_IDS.EVENT_REPLAY, { quoteId: "q-1" }))
      .toBe("/app/events/q-1/replay");
    expect(buildWorkspacePath(WORKSPACE_ROUTE_IDS.MESSAGING, { quoteId: "q-1" }))
      .toBe("/app/messages?quoteId=q-1");
    expect(buildWorkspacePath(WORKSPACE_ROUTE_IDS.OPERATIONS)).toBe(WORKSPACE_PATHS.operations);
  });

  test("exposes the persistent primary navigation and separately scoped operational routes", () => {
    expect(AMBIENT_PRIMARY_WORKSPACE_NAVIGATION.map((item) => ({
      routeId: item.routeId,
      label: item.label,
      path: item.path,
      section: item.section,
      action: item.action,
      orientation: item.orientation,
      adminOnly: item.adminOnly === true
    }))).toEqual([
      {
        routeId: WORKSPACE_ROUTE_IDS.HOME,
        label: "Now",
        path: "/app",
        section: "home",
        action: "onHome",
        orientation: "now",
        adminOnly: false
      },
      {
        routeId: WORKSPACE_ROUTE_IDS.QUOTE_LIST,
        label: "Opportunities",
        path: "/app/quotes",
        section: "quotes",
        action: "onQuotes",
        orientation: "opportunities",
        adminOnly: false
      },
      {
        routeId: WORKSPACE_ROUTE_IDS.OPERATIONS,
        label: "Operations",
        path: "/app/operations",
        section: "operations",
        action: "onOperations",
        orientation: "operations",
        adminOnly: false
      },
      {
        routeId: WORKSPACE_ROUTE_IDS.CUSTOMER_LIST,
        label: "Clients",
        path: "/app/customers",
        section: "customers",
        action: "onCustomers",
        orientation: "clients",
        adminOnly: false
      },
      {
        routeId: WORKSPACE_ROUTE_IDS.CATALOG,
        label: "Library",
        path: "/app/catalog",
        section: "catalog",
        action: "onCatalog",
        orientation: "library",
        adminOnly: false
      }
    ]);
    expect(Object.isFrozen(AMBIENT_PRIMARY_WORKSPACE_NAVIGATION)).toBe(true);
    expect(AMBIENT_PRIMARY_WORKSPACE_NAVIGATION.every(Object.isFrozen)).toBe(true);
    expect(AMBIENT_PRIMARY_WORKSPACE_NAVIGATION.find((item) => item.routeId === WORKSPACE_ROUTE_IDS.OPERATIONS))
      .toMatchObject({ triggerRef: "operations", capability: "eventSchedule" });

    expect(PRIMARY_WORKSPACE_NAVIGATION.map((item) => item.label))
      .toEqual([
        "Now",
        "Clear the Deck",
        "Customers",
        "Staff",
        "Quotes",
        "Events",
        "Messages",
        "Workflow",
        "Operations",
        "Schedule"
      ]);
    expect(ADMIN_WORKSPACE_NAVIGATION.map((item) => item.label))
      .toEqual(["Reporting", "Catalog", "Imports", "Integrations", "Diagnostics"]);
  });
});

describe("workspace location precedence", () => {
  test("gives an exact non-empty portal query precedence on every pathname", () => {
    for (const pathname of ["/", "/app", "/app/quotes/q-1", "/app/not-a-route"]) {
      expect(parseWorkspaceLocation({ pathname, search: "?portal=token-123" }), pathname).toMatchObject({
        surface: "portal",
        routeId: WORKSPACE_ROUTE_IDS.PORTAL,
        portalToken: "token-123",
        canonicalPath: "/app?portal=token-123"
      });
    }
  });

  test("ignores an empty portal query and keeps the authenticated route", () => {
    expect(parseWorkspaceLocation({ pathname: "/app/quotes", search: "?portal=%20" })).toMatchObject({
      surface: "workspace",
      routeId: WORKSPACE_ROUTE_IDS.QUOTE_LIST
    });
  });

  test("generates canonical encoded portal links", () => {
    expect(buildPortalPath(" token/+value ")).toBe("/app?portal=token%2F%2Bvalue");
  });

  test("round-trips every shipped workflow focus type without customer or quote contents", () => {
    for (const attentionType of [
      "change_request",
      "follow_up",
      "approval",
      "post_event_closeout",
      "decision_debt",
      "unread_customer_reply",
      "anniversary_rebooking"
    ]) {
      const path = buildWorkflowPath({
        quoteId: "q-123",
        attentionType,
        requestId: "request:456"
      });
      expect(path).toBe(`/app/workflow?quoteId=q-123&attentionType=${attentionType}&requestId=request%3A456`);
      expect(parseWorkspaceLocation({ pathname: "/app/workflow", search: path.slice(path.indexOf("?")) }).workflowFocus)
        .toEqual({ quoteId: "q-123", attentionType, requestId: "request:456" });
    }
  });

  test("rejects an unsupported workflow focus type instead of reflecting it into the route", () => {
    expect(() => buildWorkflowPath({ quoteId: "q-123", attentionType: "customer_email" }))
      .toThrow(/not a supported workflow attention type/i);
  });

  test("round-trips an event conversation focus without reflecting malformed ids", () => {
    const path = buildMessagingPath({ quoteId: "quote:123" });
    expect(path).toBe("/app/messages?quoteId=quote%3A123");
    expect(parseWorkspaceLocation({ pathname: "/app/messages", search: "?quoteId=quote%3A123" }).messagingFocus)
      .toEqual({ quoteId: "quote:123" });
    expect(parseWorkspaceLocation({ pathname: "/app/messages", search: "?quoteId=bad%2Fid" }).messagingFocus)
      .toEqual({ quoteId: "" });
  });
});
