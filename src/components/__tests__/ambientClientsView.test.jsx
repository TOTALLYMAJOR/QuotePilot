// @vitest-environment jsdom
import React, { act } from "react";
import { readFileSync } from "node:fs";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  AmbientClientRelationship,
  AmbientClientsDirectory
} from "../AmbientClientsView";
import { createAmbientAction } from "../../lib/ambientContracts";
import { createWorkspaceArrivalHandoff } from "../../lib/workspaceArrivalContract";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CLIENT_ID = "client-ambient-42";
const QUOTE_ID = "quote-ambient-42";

const DIRECTORY_BOUNDARY = {
  sourceLabel: "Firestore client records",
  sourceBoundary: "This page shows the clients available in the current organization.",
  loadedAtISO: "2026-08-12T14:59:00.000Z",
  messages: ["Only clients in the current organization are shown."]
};

const DIRECTORY_CALLBACKS = {
  onRefresh: () => {},
  onStartOpportunity: () => {}
};

function directoryRow(index, overrides = {}) {
  return {
    customerId: `client-${index}`,
    identity: {
      name: `Client ${index}`,
      company: `Company ${index}`,
      email: `client-${index}@example.com`,
      phone: "512-555-0101"
    },
    latest: {
      quoteNumber: `QP-${index}`,
      eventName: `Event ${index}`,
      eventDate: "2026-09-20"
    },
    ...overrides
  };
}

function directoryModel(overrides = {}) {
  return {
    state: "success",
    loading: false,
    rows: [directoryRow(1)],
    boundary: DIRECTORY_BOUNDARY,
    surfaceContract: {
      id: "ambient-clients-directory",
      purposes: ["clarify", "advance", "reveal_context"]
    },
    ...overrides
  };
}

function primaryRelationshipAction() {
  return createAmbientAction({
    id: "review-client-reply",
    outcomeLabel: "Review client reply",
    purpose: "resolve",
    roles: ["sales"],
    authorityLevel: "presentation",
    previewPolicy: "none",
    executionTarget: {
      kind: "route",
      targetId: QUOTE_ID,
      surfaceId: "conversation"
    },
    receiptType: "none",
    reversibility: { kind: "none" },
    arrivalContract: {
      object: { id: CLIENT_ID, type: "client", label: "Jordan Lee" },
      reason: "A recorded client reply needs review.",
      consequence: "Opening the exact conversation sends nothing and marks no message read.",
      nextResolutionIds: ["review-client-reply"]
    },
    primary: true,
    enabled: true
  });
}

function relationshipModel(overrides = {}) {
  return {
    state: "attention",
    client: {
      customerId: CLIENT_ID,
      name: "Jordan Lee",
      company: "Lee Foundation",
      email: "jordan@example.com",
      phone: "512-555-0142"
    },
    summary: {
      activeOpportunityLabel: "2 active opportunities",
      attentionLabel: "1 client reply needs review",
      nextEvent: { date: "2026-09-20" }
    },
    activeOpportunities: [{
      quoteId: QUOTE_ID,
      quoteNumber: "QP-2042",
      eventName: "Foundation dinner",
      eventDate: "2026-09-20",
      status: "viewed"
    }],
    conversations: [],
    primaryAction: primaryRelationshipAction(),
    primaryTarget: { destination: "conversation", quoteId: QUOTE_ID },
    boundary: {
      sourceLabel: "Firestore client relationship",
      sourceBoundary: "This view summarizes the client information and linked quotes currently available."
    },
    surfaceContract: {
      id: "ambient-client-relationship",
      purposes: ["clarify", "advance", "resolve", "reveal_context"]
    },
    ...overrides
  };
}

function arrivalContextFor(customerId = CLIENT_ID) {
  const handoff = createWorkspaceArrivalHandoff({
    destination: "client",
    object: { id: customerId, type: "client" },
    focus: { customerId },
    intentId: "review_client"
  });
  if (!handoff.ok) throw new Error(handoff.recovery.code);
  return handoff.contract;
}

let container;
let root;
let originalRequestAnimationFrame;
let originalCancelAnimationFrame;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  originalRequestAnimationFrame = window.requestAnimationFrame;
  originalCancelAnimationFrame = window.cancelAnimationFrame;
  window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(Date.now()), 0);
  window.cancelAnimationFrame = (handle) => window.clearTimeout(handle);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.requestAnimationFrame = originalRequestAnimationFrame;
  window.cancelAnimationFrame = originalCancelAnimationFrame;
});

function mount(node) {
  act(() => root.render(node));
}

async function settleFrame() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 10));
  });
}

describe("AmbientClientsView", () => {
  test("keeps the Ambient Clients data host independent from the legacy directory table", () => {
    const source = readFileSync("src/components/AmbientCustomerDirectoryView.jsx", "utf8");

    expect(source).toContain("AmbientClientsDirectoryHost");
    expect(source).toContain("getCustomerDirectoryPage");
    expect(source).not.toContain("CustomerDirectoryPresentation");
    expect(source).not.toContain("customer-directory-table");
  });

  test("renders truthful loading, meaningful empty, and populated directory states", () => {
    const loading = renderToStaticMarkup(
      <AmbientClientsDirectory
        model={directoryModel({ state: "loading", loading: true, rows: [] })}
      />
    );
    const empty = renderToStaticMarkup(
      <AmbientClientsDirectory
        model={directoryModel({ state: "empty", rows: [] })}
        {...DIRECTORY_CALLBACKS}
      />
    );
    const success = renderToStaticMarkup(
      <AmbientClientsDirectory model={directoryModel()} {...DIRECTORY_CALLBACKS} />
    );
    const parsedLoading = document.createElement("div");
    parsedLoading.innerHTML = loading;

    expect(loading).toContain('data-ambient-clients-state="loading"');
    expect(loading).toContain("Gathering your clients");
    expect(loading).toContain("Freshening up…");
    expect(loading).not.toContain("Your first client story starts here");
    expect(parsedLoading.querySelector('[data-ambient-action-id="refresh-clients"]').disabled).toBe(true);
    expect(parsedLoading.querySelector('[data-ambient-action-id="start-client-opportunity"]').disabled).toBe(true);

    expect(empty).toContain('data-ambient-clients-state="empty"');
    expect(empty).toContain("Your first client story starts here");
    expect(empty).toContain("Start an opportunity");

    expect(success).toContain('data-ambient-clients-state="success"');
    expect(success).toContain("Client 1");
    expect(success).toContain("Event 1");
    expect(success).toContain("Firestore client records");
    expect(`${loading}${empty}${success}`).not.toMatch(/bounded read|completed client read/iu);
  });

  test("renders exactly one outcome-named primary action for every populated client row", () => {
    const markup = renderToStaticMarkup(
      <AmbientClientsDirectory
        model={directoryModel({ rows: [directoryRow(1), directoryRow(2)] })}
        {...DIRECTORY_CALLBACKS}
      />
    );
    const parsed = document.createElement("div");
    parsed.innerHTML = markup;
    const rows = [...parsed.querySelectorAll("[data-client-id]")];

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const primaryActions = row.querySelectorAll(".ambient-client__primary");
      expect(primaryActions).toHaveLength(1);
      expect(primaryActions[0].textContent).toContain("Review client");
      expect(primaryActions[0].getAttribute("data-ambient-action-id"))
        .toMatch(/^review-client:/u);
    }
  });

  test("renders operational metrics and filters the bounded page without inventing relationship evidence", () => {
    mount(
      <AmbientClientsDirectory
        model={directoryModel({
          rows: [
            directoryRow(1),
            directoryRow(2, {
              identity: {
                name: "Contact Gap Client",
                company: "",
                email: "contact-gap@example.com",
                phone: ""
              },
              latest: { quoteNumber: "", eventName: "", eventDate: "2099-06-12" }
            })
          ]
        })}
        {...DIRECTORY_CALLBACKS}
      />
    );

    const metrics = Object.fromEntries([...container.querySelectorAll(".ambient-clients__metrics > div")]
      .map((metric) => [metric.querySelector("dt").textContent, metric.querySelector("dd").textContent]));
    expect(metrics).toEqual({
      "Clients shown": "2",
      "With linked work": "1",
      "Upcoming events": "2",
      "Contact details to add": "1"
    });
    expect(container.querySelectorAll("[data-client-id]")).toHaveLength(2);
    expect(container.textContent).toContain("Add contact");
    expect(container.textContent).toContain("No opportunity yet");

    act(() => Array.from(container.querySelectorAll(".ambient-clients__filters button"))
      .find((button) => button.textContent === "Contact to add")
      .click());
    expect(container.querySelectorAll("[data-client-id]")).toHaveLength(1);
    expect(container.textContent).toContain("Contact Gap Client");
    expect(container.textContent).not.toContain("Client 1");

    act(() => Array.from(container.querySelectorAll(".ambient-clients__filters button"))
      .find((button) => button.textContent === "Upcoming events")
      .click());
    expect(container.querySelectorAll("[data-client-id]")).toHaveLength(2);
    expect(container.textContent).toContain("Client 1");
    expect(container.textContent).toContain("Contact Gap Client");
  });

  test("acknowledges a client selection in context during the same activation that requests navigation", () => {
    const onOpenClient = vi.fn(() => ({ status: "pending" }));
    mount(
      <AmbientClientsDirectory
        model={directoryModel({ rows: [directoryRow(42, { customerId: CLIENT_ID })] })}
        currentUserRole="sales"
        onOpenClient={onOpenClient}
        {...DIRECTORY_CALLBACKS}
      />
    );

    const action = container.querySelector(`[data-client-id="${CLIENT_ID}"] .ambient-client__primary`);
    act(() => action.click());

    const acknowledgement = container.querySelector(".ambient-clients__acknowledgement");
    expect(acknowledgement).not.toBeNull();
    expect(acknowledgement.getAttribute("data-result-kind")).toBe("pending");
    expect(acknowledgement.textContent).toContain("Opening");
    expect(acknowledgement.textContent)
      .toContain("relationship context already in view");
    expect(onOpenClient).toHaveBeenCalledWith({
      customerId: CLIENT_ID,
      actionId: `review-client:${CLIENT_ID}`,
      object: { id: CLIENT_ID, type: "client", label: "Client" },
      reason: "You selected this client from the current list.",
      consequence: "Opening the client overview changes no client, quote, conversation, payment, booking, or provider evidence.",
      nextResolutionId: "review-client-relationship"
    });
  });

  test("makes relationship identity, state, risk, and the next action understandable at the top layer", () => {
    const markup = renderToStaticMarkup(
      <AmbientClientRelationship model={relationshipModel()} currentUserRole="sales" />
    );
    const parsed = document.createElement("div");
    parsed.innerHTML = markup;
    const overview = parsed.querySelector("[data-client-overview-state]");
    const primary = overview.querySelector(".ambient-client-overview__primary");

    expect(overview.getAttribute("data-client-overview-state")).toBe("attention");
    expect(overview.querySelector("h1").textContent).toBe("Jordan Lee");
    expect(overview.textContent).toContain("2 active opportunities");
    expect(overview.textContent).toContain("1 client reply needs review");
    expect(overview.textContent).toContain("Sep 20, 2026");
    expect(overview.textContent).toContain("Suggested next step");
    expect(primary.textContent).toContain("Review client reply");
    expect(overview.textContent).toContain("A recorded client reply needs review.");
    expect(overview.textContent).not.toMatch(/bounded read|non-terminal|read context/iu);
  });

  test("resolves only an exact client arrival and focuses its relationship heading", async () => {
    const onArrivalResolution = vi.fn();
    mount(
      <AmbientClientRelationship
        model={relationshipModel()}
        arrivalContext={arrivalContextFor()}
        arrivalAttempted
        onArrivalResolution={onArrivalResolution}
      />
    );
    await settleFrame();

    const heading = container.querySelector("#ambient-client-overview-title");
    expect(document.activeElement).toBe(heading);
    expect(onArrivalResolution).toHaveBeenLastCalledWith({ status: "resolved" });
    expect(onArrivalResolution).not.toHaveBeenCalledWith(expect.objectContaining({
      status: "recovery"
    }));
  });

  test("recovers from a mismatched exact arrival without substituting the loaded client", () => {
    const onArrivalResolution = vi.fn();
    mount(
      <AmbientClientRelationship
        model={relationshipModel()}
        arrivalContext={arrivalContextFor("different-client")}
        arrivalAttempted
        onArrivalResolution={onArrivalResolution}
      />
    );

    expect(onArrivalResolution).toHaveBeenLastCalledWith({
      status: "recovery",
      reason: "The loaded client does not match the exact requested client.",
      consequence: "No alternate client was substituted and no record changed.",
      nextResolution: "Return to Clients and choose the intended client again."
    });
    expect(onArrivalResolution).not.toHaveBeenCalledWith(expect.objectContaining({
      status: "resolved"
    }));
    expect(container.querySelector("[data-client-id]").getAttribute("data-client-id")).toBe(CLIENT_ID);
  });

  test("does not infer customer activity when the quote-scoped conversation summary is unavailable", () => {
    const markup = renderToStaticMarkup(
      <AmbientClientRelationship
        model={relationshipModel({
          state: "success",
          summary: {
            activeOpportunityLabel: "0 active opportunities",
            attentionLabel: "0 needing review",
            nextEvent: null
          },
          activeOpportunities: [],
          primaryAction: null,
          primaryTarget: null,
          caughtUp: true,
          conversations: [{
            quoteId: QUOTE_ID,
            quoteNumber: "QP-2042",
            summaryAvailable: false,
            messageCount: 88,
            latestMessageAtISO: "2026-08-12T15:00:00.000Z"
          }]
        })}
      />
    );

    expect(markup).toContain("Conversation details are not available here. Open the conversation to see its current messages.");
    expect(markup).not.toContain("88 recorded messages");
    expect(markup).not.toContain("Aug 12, 2026");
    expect(markup).not.toMatch(/viewed|replied|engaged|interested/iu);
  });

  test("keeps an exact customer-reply identity in the conversation handoff", () => {
    const messageId = "message-ambient-42";
    const onOpenConversation = vi.fn(() => ({ status: "pending" }));
    const action = createAmbientAction({
      id: `review-client-reply:${messageId}`,
      outcomeLabel: "Review customer reply",
      purpose: "resolve",
      roles: ["sales"],
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: { kind: "route", targetId: messageId, surfaceId: "conversation" },
      receiptType: "none",
      reversibility: { kind: "none" },
      arrivalContract: {
        object: { id: messageId, type: "customer-communication-evidence", label: "Customer reply" },
        reason: "An exact open customer reply is linked to this client.",
        consequence: "Opening it sends nothing and marks nothing read.",
        nextResolutionIds: ["review-exact-customer-reply"]
      },
      primary: true,
      enabled: true
    });
    const target = {
      kind: "messages",
      quoteId: QUOTE_ID,
      requestId: "request-ambient-42",
      messageId
    };
    mount(
      <AmbientClientRelationship
        model={relationshipModel({ primaryAction: action, primaryTarget: target })}
        currentUserRole="sales"
        onOpenConversation={onOpenConversation}
      />
    );

    act(() => container.querySelector(".ambient-client-overview__primary").click());

    expect(onOpenConversation).toHaveBeenCalledWith(QUOTE_ID, {
      arrivalContext: {
        object: action.arrivalContract.object,
        target
      }
    });
  });
});
