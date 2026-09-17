// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
vi.hoisted(() => { vi.stubEnv("VITE_EVENT_OPERATING_SPINE_ENABLED", "true"); });
vi.mock("../QuoteAttendancePanel", () => ({ default: function AttendancePanel(props) {
  return <section data-testid="native-attendance" data-source-version={props.sourceVersionId} data-acceptance-receipt={props.acceptanceReceiptId}>Recorded final guest count</section>;
} }));
import AmbientLivingOpportunity from "../AmbientLivingOpportunity";
import { AmbientContextProvider } from "../../context/AmbientContext";
import { scheduleQuoteCompletionDestinationFocus } from "../../lib/quoteCompletionDestination";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const QUOTE = Object.freeze({
  id: "quote-alpha",
  organizationId: "org-alpha",
  quoteNumber: "Q-ALPHA",
  activeVersionId: "version-alpha",
  status: "draft",
  customer: Object.freeze({ name: "Maya Bennett", email: "maya@example.test" }),
  event: Object.freeze({
    name: "Autumn Benefit Dinner",
    date: "2026-09-19",
    time: "18:00",
    venue: "The Foundry Hall",
    style: "Plated",
    guests: 120,
    servers: 8,
    chefs: 3
  }),
  selection: Object.freeze({
    packageId: "classic",
    packageName: "Classic",
    packageInclusions: Object.freeze({
      menuItems: Object.freeze([
        Object.freeze({ id: "salad", name: "Garden salad" })
      ]),
      addons: Object.freeze([
        Object.freeze({ id: "tea", name: "Tea service" })
      ]),
      rentals: Object.freeze([
        Object.freeze({ id: "chairs", name: "Dining chairs" })
      ])
    }),
    menuItems: Object.freeze(["salad", "chicken"]),
    menuItemsSnapshot: Object.freeze([
      Object.freeze({
        id: "salad",
        name: "Garden salad",
        quantity: 2,
        includedInPackage: true
      }),
      Object.freeze({
        id: "chicken",
        name: "Herb chicken",
        quantity: 3,
        includedInPackage: false
      })
    ]),
    menuItemNames: Object.freeze(["Garden salad", "Herb chicken"]),
    menuItemQuantities: Object.freeze({ salad: 2, chicken: 3 }),
    rentals: Object.freeze(["chairs"]),
    addons: Object.freeze(["tea"]),
    addonQuantities: Object.freeze({ tea: 120 }),
    rentalQuantities: Object.freeze({ chairs: 15 }),
    addonSnapshots: Object.freeze([
      Object.freeze({ id: "tea", name: "Tea service", pricingType: "per_person", quantity: 120, price: 3 })
    ]),
    rentalSnapshots: Object.freeze([
      Object.freeze({ id: "chairs", name: "Dining chairs", pricingType: "per_item", quantity: 15, price: 8 })
    ])
  }),
  totals: Object.freeze({ total: 8400 })
});

const PACKAGE_MENU_CATALOG_EVIDENCE = Object.freeze({
  organizationId: "org-alpha",
  sourceLabel: "Exact tenant catalog",
  catalogRevision: 12,
  freshness: Object.freeze({
    state: "fresh",
    observedAtISO: "2026-08-11T18:01:00.000Z"
  }),
  packages: Object.freeze([
    Object.freeze({
      id: "classic",
      name: "Classic",
      active: true,
      includedMenuItemIds: Object.freeze(["salad", "chicken"]),
      includedAddonIds: Object.freeze(["tea"]),
      includedRentalIds: Object.freeze(["chairs"])
    }),
    Object.freeze({
      id: "premium",
      name: "Premium",
      active: true,
      includedMenuItemIds: Object.freeze(["salad", "chicken", "salmon"]),
      includedAddonIds: Object.freeze(["tea"]),
      includedRentalIds: Object.freeze(["chairs"])
    })
  ]),
  addons: Object.freeze([
    Object.freeze({
      id: "tea",
      name: "Tea service",
      pricingType: "per_person",
      price: 3,
      staffRole: "server",
      active: true
    })
  ]),
  rentals: Object.freeze([
    Object.freeze({
      id: "chairs",
      name: "Dining chairs",
      pricingType: "per_item",
      price: 8,
      qtyPerGuests: 1,
      active: true
    })
  ]),
  upsellRules: Object.freeze([]),
  menuSections: Object.freeze([
    Object.freeze({
      id: "entrees",
      name: "Entrees",
      items: Object.freeze([
        Object.freeze({ id: "salad", name: "Garden salad", active: true }),
        Object.freeze({ id: "chicken", name: "Herb chicken", active: true }),
        Object.freeze({ id: "salmon", name: "Salmon", active: true })
      ])
    })
  ])
});

const CONTEXT = Object.freeze({
  organizationId: "org-alpha",
  role: "sales",
  route: "/app/quotes/quote-alpha",
  activeOpportunityId: "quote-alpha",
  selectedObject: Object.freeze({
    id: "quote-alpha",
    type: "opportunity",
    label: "Autumn Benefit Dinner"
  }),
  revision: "version-alpha",
  sourceFreshness: Object.freeze({
    state: "unknown",
    reason: "The bounded loader does not expose an observation timestamp."
  }),
  pendingPreview: null
});

let container;
let root;

function mount(props = {}, context = CONTEXT) {
  act(() => {
    root.render(
      <AmbientContextProvider value={context}>
        <AmbientLivingOpportunity
          quote={QUOTE}
          source="local"
          ordinaryEditAllowed
          conversationAvailable
          packageMenuCatalogEvidence={PACKAGE_MENU_CATALOG_EVIDENCE}
          onBackToQuotes={() => {}}
          onEditQuote={() => {}}
          onOpenWorkflow={() => {}}
          onOpenConversation={() => {}}
          {...props}
        />
      </AmbientContextProvider>
    );
  });
}

function button(name) {
  return [...container.querySelectorAll("button")].find((item) => (
    item.textContent.replace(/\s+/g, " ").trim().includes(name)
  ));
}

function pointerEvent(type, { clientX, clientY, pointerId = 1 }) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientX: { value: clientX },
    clientY: { value: clientY },
    pointerId: { value: pointerId },
    pointerType: { value: "touch" }
  });
  return event;
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    await Promise.resolve();
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("AmbientLivingOpportunity", () => {
  test("hands an accepted opportunity to the exact Calendar event without mutating it", () => {
    const onOpenCalendar = vi.fn();
    mount({
      quote: { ...QUOTE, status: "booked" },
      onOpenCalendar
    });

    const calendarAction = button("Open Calendar");
    expect(calendarAction).toBeTruthy();
    expect(calendarAction.dataset.exactEventId).toBe("quote-alpha");
    act(() => calendarAction.click());

    expect(onOpenCalendar).toHaveBeenCalledWith("quote-alpha", {
      actionId: "open-opportunity-calendar:quote-alpha"
    });
  });

  test("resolves only an exact canonical Living Opportunity arrival after focusing its object", async () => {
    const onArrivalResolution = vi.fn();
    mount({
      arrivalContext: {
        modelId: "workspace-arrival-contract-v1",
        destination: "opportunity",
        surfaceId: "living-opportunity",
        focusConsumerState: "supported",
        object: { id: "quote-alpha", type: "opportunity", label: "Opportunity" },
        intentId: "review_opportunity",
        focus: { quoteId: "quote-alpha" }
      },
      onArrivalResolution
    });
    await settle();

    expect(onArrivalResolution).toHaveBeenCalledWith({ status: "resolved" });
    expect(document.activeElement).toBe(
      container.querySelector('[data-quote-id="quote-alpha"]')
    );
  });

  test("recovers without substitution when Living Opportunity arrival identity differs", async () => {
    const onArrivalResolution = vi.fn();
    mount({
      arrivalContext: {
        modelId: "workspace-arrival-contract-v1",
        destination: "opportunity",
        surfaceId: "living-opportunity",
        focusConsumerState: "supported",
        object: { id: "quote-other", type: "opportunity", label: "Opportunity" },
        intentId: "review_opportunity",
        focus: { quoteId: "quote-other" }
      },
      onArrivalResolution
    });
    await settle();

    expect(onArrivalResolution).toHaveBeenCalledWith(expect.objectContaining({
      status: "recovery",
      reason: expect.stringMatching(/does not match/i),
      consequence: expect.stringMatching(/no alternate opportunity/i)
    }));
    expect(document.activeElement).not.toBe(
      container.querySelector('[data-quote-id="quote-alpha"]')
    );
  });

  test("makes identity, state, risk, and exact next action visible in the top layer", () => {
    mount();

    const surface = container.querySelector('[data-ambient-model="pilot-slice-alpha-v1"]');
    expect(surface).not.toBeNull();
    expect(surface.dataset.surfacePurpose).toContain("clarify");
    expect(surface.dataset.ambientRole).toBe("sales");
    expect(container.querySelector("h1")?.textContent).toBe("Autumn Benefit Dinner");
    expect(container.textContent).toContain("Event duration needs review");
    expect(container.textContent).toContain("Review draft");
    expect(container.textContent).toContain("Event duration needs review. Reviewing the draft is the clearest available next step.");
    expect(container.textContent).toContain("Proposal completeness only");
    const commercialHealth = container.querySelector('[data-momentum-domain="commercial_health"]');
    expect(commercialHealth).not.toBeNull();
    expect(commercialHealth.textContent).toContain("Pricing and margin");
    expect(commercialHealth.textContent).toContain("Not enough detail");
    expect(commercialHealth.textContent).not.toContain("$8,400.00");
    expect(container.textContent).not.toContain("More actions");
    expect(container.textContent).not.toMatch(/72% readiness/i);
    const desktopHero = container.querySelector(".ambient-v16-opportunity__desktop");
    expect(desktopHero.querySelector('img[src="/images/quote-workspace-wedding-table-v1.webp"]')).not.toBeNull();
    expect(desktopHero.textContent).toContain("Sep 19 · Event");
    expect(desktopHero.textContent).toContain("The Foundry Hall");
    expect(desktopHero.textContent).toContain("120 guests");
    expect(container.querySelector(".ambient-v16-opportunity__event-summary")?.textContent)
      .toContain("Plated · 2 saved items");
  });

  test("keeps the primary CTA task-specific when authoritative staffing state is the next concern", () => {
    mount({
      quote: {
        ...QUOTE,
        customer: { ...QUOTE.customer, phone: "205-555-0123" },
        event: { ...QUOTE.event, hours: 6 }
      }
    });

    const mobile = container.querySelector(".ambient-v16-opportunity__mobile");
    expect(mobile.textContent).toContain("Staffing may need attention");
    const nextAction = mobile.querySelector(".ambient-mobile-remote__next button");
    expect(nextAction?.dataset.ambientActionId).toBe("inspect-staffing");
    expect(nextAction?.textContent).toContain("Review staffing");
  });

  test("opens the role-safe Quick Updates host without mutating the selected opportunity", async () => {
    const onPreviewQuickUpdate = vi.fn();
    const onSaveQuickUpdate = vi.fn();
    const before = structuredClone(QUOTE);
    mount({
      serviceStyles: ["Buffet", "Plated", "Stations", "Drop-off"],
      onPreviewQuickUpdate,
      onSaveQuickUpdate
    });

    const contextBar = container.querySelector('[data-testid="quick-updates-context-bar"]');
    const trigger = contextBar?.querySelector(
      '[data-ambient-action-id="open-quick-updates"]'
    );
    const mobileTrigger = container.querySelector(
      '.ambient-mobile-remote [data-ambient-action-id="open-quick-updates"]'
    );
    expect(contextBar).not.toBeNull();
    expect(contextBar.getAttribute("role")).toBe("region");
    expect(contextBar.getAttribute("aria-label")).toBe(
      "Autumn Benefit Dinner opportunity actions"
    );
    expect(trigger).not.toBeNull();
    expect(mobileTrigger).not.toBeNull();
    expect(contextBar.contains(trigger)).toBe(true);
    expect(trigger.closest(".ambient-title-line")).toBeNull();
    expect(container.querySelectorAll(
      '.ambient-title-line [data-ambient-action-id="open-quick-updates"]'
    )).toHaveLength(0);
    expect(trigger.dataset.ambientActionId).toBe("open-quick-updates");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.getAttribute("aria-controls")).toBeTruthy();
    act(() => trigger.click());
    await settle();

    const dialog = document.querySelector('.qup-drawer[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog.id).toBe(trigger.getAttribute("aria-controls"));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(container.getAttribute("aria-hidden")).toBe("true");
    expect(container.hasAttribute("inert")).toBe(true);
    expect(dialog.textContent).toContain("Autumn Benefit Dinner");
    expect(dialog.textContent).toContain("Service style");
    expect(dialog.textContent).not.toContain("Courses");
    expect(onPreviewQuickUpdate).not.toHaveBeenCalled();
    expect(onSaveQuickUpdate).not.toHaveBeenCalled();
    expect(QUOTE).toEqual(before);

    act(() => dialog.querySelector('[aria-label="Close Quick Updates"]').click());
    await settle();
    expect(document.querySelector('.qup-drawer[role="dialog"]')).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(container.hasAttribute("aria-hidden")).toBe(false);
    expect(container.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  test("hides Quick Updates when a saved opportunity has no authoritative version identity", () => {
    mount({
      quote: {
        ...QUOTE,
        activeVersionId: "",
        versionMeta: null,
        updatedAtISO: "2026-08-30T20:00:00.000Z"
      },
      serviceStyles: ["Buffet", "Plated", "Stations", "Drop-off"],
      onPreviewQuickUpdate: vi.fn(),
      onSaveQuickUpdate: vi.fn()
    });

    expect(container.querySelector('[data-testid="quick-updates-context-bar"]')).not.toBeNull();
    expect(container.querySelectorAll(
      '[data-ambient-action-id="open-quick-updates"]'
    )).toHaveLength(0);
  });

  test("provides an in-flow mobile remote with exact object and next-action controls", async () => {
    const onEditQuote = vi.fn();
    mount({ onEditQuote });

    const remote = container.querySelector('[data-layout-audit-surface="ambient-mobile-opportunity-remote"]');
    expect(remote).not.toBeNull();
    expect(remote.dataset.surfacePurpose).toContain("advance");
    expect(remote.textContent).toContain("Autumn Benefit Dinner");
    expect(remote.textContent).toContain("Event duration needs review");
    expect(remote.querySelector('img[src="/images/quote-workspace-wedding-table-v1.webp"]')).not.toBeNull();
    expect(remote.textContent).toContain("The Foundry Hall");
    expect(remote.textContent).toContain("120 guests");
    expect(remote.textContent).toContain("6:00 PM");
    expect(remote.textContent).toContain("Plated · 2 saved items");
    expect(remote.textContent).toContain("8 servers · 3 chefs");

    const remoteButtons = [...remote.querySelectorAll("button")];
    expect(remoteButtons.every((item) => item.disabled || Boolean(item.dataset.ambientActionId))).toBe(true);
    const eventButton = remote.querySelector('[aria-label="Event"]');
    const menuButton = remote.querySelector('[data-ambient-action-id="inspect-menu"]');
    const staffingButton = remote.querySelector('[data-ambient-action-id="inspect-staffing"]');
    const pricingButton = remote.querySelector('[data-ambient-action-id="inspect-pricing"]');
    const proposalButton = remote.querySelector('[data-ambient-action-id="inspect-proposal"]');
    const nextButton = remote.querySelector('[data-ambient-action-id="open-priced-draft"]');
    expect([eventButton, menuButton, staffingButton, pricingButton, proposalButton, nextButton]
      .every(Boolean)).toBe(true);
    expect(nextButton.textContent).toContain("Review draft");

    act(() => eventButton.click());
    expect(container.querySelector('#ambient-mobile-event-details')).not.toBeNull();
    expect(container.querySelector('#ambient-operational-facts')).toBeNull();
    expect(container.textContent).toContain("Event details shown");

    act(() => menuButton.click());
    const menuDialog = container.querySelector('[role="dialog"]');
    expect(menuDialog?.textContent).toContain("Menu details");
    expect(menuDialog?.closest(".ambient-context-surface")?.classList)
      .toContain("ambient-context-surface--arrival-disclosure");
    expect(menuDialog?.querySelector('[data-context-arrival-duplicate="reason"]')?.textContent)
      .toContain("Why this matters");
    act(() => container.querySelector('[aria-label="Close context"]').click());
    await settle();

    act(() => staffingButton.click());
    const staffingDialog = container.querySelector('[role="dialog"]');
    expect(staffingDialog?.textContent).toContain("Staffing suggestion");
    expect(staffingDialog?.closest(".ambient-context-surface")?.classList)
      .toContain("ambient-context-surface--arrival-disclosure");
    act(() => container.querySelector('[aria-label="Close context"]').click());
    await settle();

    act(() => pricingButton.click());
    const pricingDialog = container.querySelector('[role="dialog"]');
    expect(pricingDialog?.textContent).toContain("Pricing details");
    expect(pricingDialog?.closest(".ambient-context-surface")?.classList)
      .toContain("ambient-context-surface--arrival-disclosure");
    expect(pricingDialog?.querySelector('[data-context-arrival-duplicate="reason"]')?.textContent)
      .toContain("Why this is here");
    act(() => container.querySelector('[aria-label="Close context"]').click());
    await settle();

    act(() => proposalButton.click());
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("Proposal details");
    act(() => container.querySelector('[aria-label="Close context"]').click());
    await settle();

    act(() => nextButton.click());
    expect(onEditQuote).toHaveBeenCalledTimes(1);
  });

  test("opens exact staffing context from the ranked primary action and restores focus", async () => {
    mount({
      quote: {
        ...QUOTE,
        customer: { ...QUOTE.customer, phone: "" },
        event: { ...QUOTE.event, hours: 5 }
      }
    });

    expect(container.textContent).toContain("Staffing may need attention");
    expect(container.textContent).toContain(
      "Staffing may need attention. Reviewing staffing is the clearest available next step."
    );
    const primary = button("Review staffing");
    expect(primary).toBeTruthy();

    act(() => primary.click());
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Staffing suggestion");
    expect(dialog?.textContent).toContain("2 additional servers");

    act(() => dialog.querySelector('[aria-label="Close context"]').click());
    await settle();
    expect(document.activeElement).toBe(primary);
  });

  test("relays a global Pilot request into the exact populated opportunity context and restores its trigger", async () => {
    const onGlobalPilotResolution = vi.fn();
    const externalTrigger = document.createElement("button");
    externalTrigger.textContent = "Global Pilot";
    document.body.appendChild(externalTrigger);
    const globalPilotReturnFocusRef = { current: externalTrigger };
    externalTrigger.focus();

    mount({
      globalPilotRequest: { id: "pilot-request-1", opportunityId: QUOTE.id },
      globalPilotReturnFocusRef,
      onGlobalPilotResolution
    });
    await settle();

    const dialog = container.querySelector('.ambient-pilot-context-surface [role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain("Why this recommendation appears");
    expect(dialog.textContent).toContain("Autumn Benefit Dinner");
    expect(dialog.textContent).toContain("Why this is recommended");
    expect(onGlobalPilotResolution).toHaveBeenCalledWith({
      requestId: "pilot-request-1",
      status: "opened",
      reason: ""
    });

    act(() => dialog.querySelector('[aria-label="Close context"]').click());
    await settle();
    expect(document.activeElement).toBe(externalTrigger);
    externalTrigger.remove();
  });

  test("rejects a stale global Pilot opportunity instead of opening substituted guidance", async () => {
    const onGlobalPilotResolution = vi.fn();
    mount({
      globalPilotRequest: { id: "pilot-request-stale", opportunityId: "another-quote" },
      onGlobalPilotResolution
    });
    await settle();

    expect(container.querySelector('.ambient-pilot-context-surface [role="dialog"]')).toBeNull();
    expect(onGlobalPilotResolution).toHaveBeenCalledWith({
      requestId: "pilot-request-stale",
      status: "recovery",
      reason: expect.stringMatching(/does not match/i)
    });
  });

  test("opens populated guest context with dependencies and do-nothing evidence", () => {
    mount();

    act(() => button("See connections").click());

    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain("Guest count connections");
    expect(dialog.textContent).toContain("Price and scope");
    expect(dialog.textContent).toContain("Why this recommendation");
    expect(dialog.textContent).toContain("If you do nothing");
    expect(dialog.textContent).toContain("Confidence: high");
    expect(dialog.closest(".ambient-context-surface")?.classList)
      .toContain("ambient-context-surface--arrival-disclosure");
    expect(dialog.textContent).toContain("Saved priced count");
    expect(dialog.textContent).toContain("Separate attendance evidence not recorded");
    expect(dialog.textContent).toContain("does not confirm attendance");
    expect(dialog.querySelector('[data-context-arrival-duplicate="reason"]')?.textContent)
      .toContain("Why this recommendation");
    expect(container.textContent).toContain("Guest count context opened");
  });

  test("shows planning and exact final-count timing evidence and opens only its exact Workflow task", () => {
    const onOpenWorkflow = vi.fn(() => ({ status: "pending" }));
    const quote = Object.freeze({
      ...QUOTE,
      event: Object.freeze({
        ...QUOTE.event,
        attendance: Object.freeze({
          schemaVersion: 1,
          planning: Object.freeze({
            kind: "approximate",
            value: 120,
            min: 100,
            max: 140,
            sourceType: "customer_inquiry",
            sourceReferenceId: "inquiry-001",
            observedAtISO: "2026-08-11T11:45:00.000Z",
            recordedByUid: "staff-alpha"
          }),
          confirmation: Object.freeze({
            state: "requested",
            requestedAtISO: "2026-09-01T15:00:00.000Z",
            dueDate: "2026-09-12",
            submittedCount: null,
            sourceType: "",
            sourceReferenceId: "",
            submittedAtISO: "",
            submittedByRole: "",
            appliedRevisionId: "",
            commercialChangeReceiptId: ""
          }),
          commercialBasis: Object.freeze({
            source: "planning",
            sourceReferenceId: "inquiry-001",
            appliedRevisionId: ""
          })
        })
      })
    });
    const decisionDebtSnapshot = Object.freeze({
      snapshot: Object.freeze({
        items: Object.freeze([Object.freeze({
          id: "debt-final-count-001",
          decisionType: "guest_count",
          resolutionState: "open",
          lockDate: "2026-09-12",
          daysUntilLock: 4
        })])
      })
    });

    mount({ quote, decisionDebtSnapshot, onOpenWorkflow });
    act(() => button("See connections").click());

    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog.textContent).toContain("Saved priced count");
    expect(dialog.textContent).toContain("Planning estimate: about 120 guests (100–140)");
    expect(dialog.textContent).toContain("Customer inquiry · Aug 11, 2026");
    expect(dialog.textContent).toContain("Final count due Sep 12, 2026");
    expect(dialog.textContent).toContain("4 days remain until the final guest-count lock date");
    expect(dialog.querySelector('[data-attendance-dimension="commercial-basis"]')).toBeTruthy();
    expect(dialog.querySelector('[data-attendance-dimension="best-evidence"]')).toBeTruthy();
    expect(dialog.querySelector('[data-attendance-dimension="decision-timing"]')).toBeTruthy();

    act(() => button("Review final-count task").click());

    expect(onOpenWorkflow).toHaveBeenCalledWith({
      quoteId: "quote-alpha",
      attentionType: "decision_debt",
      requestId: "debt-final-count-001"
    }, expect.objectContaining({
      arrivalContext: expect.objectContaining({ surfaceId: "workflow" })
    }));
  });

  test("keeps the exact priced count visible when added attendance evidence is malformed", () => {
    mount({
      quote: {
        ...QUOTE,
        event: {
          ...QUOTE.event,
          attendance: { schemaVersion: 99 }
        }
      }
    });

    act(() => button("See connections").click());

    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog.textContent).toContain("Saved priced count");
    expect(dialog.textContent).toContain("120 guests");
    expect(dialog.textContent).toContain("Attendance evidence needs review");
    expect(dialog.textContent).not.toContain("Final count applied");
  });

  test("uses only exact-source closeout attendance and keeps staffing tied to the priced revision", async () => {
    const receiptId = `closeout_attendance_${"a".repeat(48)}`;
    mount({
      quote: {
        ...QUOTE,
        status: "booked",
        acceptanceReceipt: { receiptId: "accept-alpha" },
        workflow: {
          postEventCloseout: {
            sourceVersionId: "version-alpha",
            acceptanceReceiptId: "accept-alpha",
            actualAttendance: {
              schemaVersion: 1,
              revision: 1,
              count: 116,
              sourceType: "staff_observed",
              note: "Lead server confirmed the final served headcount.",
              sourceReferenceId: receiptId,
              recordedAtISO: "2026-09-27T15:30:00.000Z",
              recordedBy: { email: "owner@example.test", role: "admin" },
              lastReceiptId: receiptId
            }
          }
        }
      }
    });

    act(() => button("See connections").click());
    let dialog = container.querySelector('[role="dialog"]');
    expect(dialog.textContent).toContain("Actual attendance: 116 guests");
    expect(dialog.textContent).toContain(receiptId);
    act(() => dialog.querySelector('[aria-label="Close context"]').click());
    await settle();

    act(() => button("Review staffing").click());
    dialog = container.querySelector('[role="dialog"]');
    expect(dialog.textContent).toContain("Attendance basis");
    expect(dialog.textContent).toContain("Saved priced count 120 · revision version-alpha");
    expect(dialog.textContent).toContain("Actual attendance 116 was recorded after service");
    expect(dialog.textContent).toContain("does not rewrite this staffing plan");
  });

  test("opens populated five-domain Money evidence and restores its exact trigger", async () => {
    mount();

    const trigger = button("Review payments");
    expect(trigger).not.toBeUndefined();
    act(() => trigger.click());

    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain("Payments and balance");
    expect([...dialog.querySelectorAll("[data-money-stage]")]).toHaveLength(5);
    expect(dialog.textContent).toContain("Deposit policy");
    expect(dialog.textContent).toContain("Provider-confirmed deposit");
    expect(dialog.textContent).toContain("Balance request");
    expect(dialog.textContent).toContain("Final settlement");
    expect(dialog.textContent).toContain("If nothing changes");
    expect(dialog.textContent).toContain("What you can do next");
    expect(container.textContent).toContain("Payment details ready");

    act(() => container.querySelector('[aria-label="Close context"]').click());
    await settle();

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(container.textContent).toContain("Payment details closed");
  });

  test("hands payment review to the existing quote workspace when the host provides it", () => {
    const onOpenLegacyWorkspace = vi.fn(() => ({ status: "pending" }));
    mount({ onOpenLegacyWorkspace });

    act(() => button("Review payments").click());

    const dialog = container.querySelector('[role="dialog"]');
    const handoff = [...dialog.querySelectorAll("button")]
      .find((item) => item.textContent.replace(/\s+/g, " ").trim().includes("Open quote workspace"));
    expect(handoff).not.toBeUndefined();
    expect(handoff.dataset.ambientActionId).toBe("open-governed-payment-controls");

    act(() => handoff.click());

    expect(onOpenLegacyWorkspace).toHaveBeenCalledOnce();
    expect(onOpenLegacyWorkspace.mock.calls[0][0]).toMatchObject({
      object: {
        id: "money",
        type: "commercial-evidence",
        label: "Money"
      },
      reason: expect.stringContaining("deposit, balance-request, reconciliation, and settlement")
    });
  });

  test("mounts exact Proposal evidence, restores focus, and routes only to governed controls", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-13T10:42:00.000Z"));
    const proposalQuote = Object.freeze({
      ...QUOTE,
      updatedAtISO: "2026-08-12T10:42:00.000Z",
      customer: Object.freeze({
        name: "Maya Bennett",
        email: "maya@example.test",
        phone: "205-555-0142"
      }),
      event: Object.freeze({
        ...QUOTE.event,
        hours: 6
      }),
      totals: Object.freeze({
        subtotal: 7_800,
        tax: 600,
        total: 8_400,
        deposit: 2_520
      }),
      pricing: Object.freeze({
        authority: "server_authoritative",
        calculatedAt: "2026-08-12T10:41:30.000Z",
        grandTotal: 8_400
      }),
      portalKey: "proposal-living-opportunity-key-000001",
      portalIssuedAtISO: "2026-08-12T10:42:00.000Z",
      portalExpiresAtISO: "2026-09-11T10:42:00.000Z",
      workflow: Object.freeze({ quoteDelivery: Object.freeze({}) })
    });
    const context = {
      ...CONTEXT,
      role: "admin",
      sourceFreshness: {
        state: "fresh",
        observedAt: "2026-08-12T10:42:01.000Z"
      }
    };
    const onOpenLegacyWorkspace = vi.fn(() => ({ status: "opened" }));
    const before = structuredClone(proposalQuote);
    mount({
      quote: proposalQuote,
      source: "firebase",
      onOpenLegacyWorkspace
    }, context);

    const row = container.querySelector('[data-intelligent-object="proposal"]');
    const trigger = button("Review proposal");
    expect(row).not.toBeNull();
    expect(row.dataset.proposalState).toBe("current");
    expect(row.textContent).toContain("100% proposal completeness");
    expect(row.textContent).toContain("current details");
    expect(trigger.dataset.ambientActionId).toBe("inspect-proposal");

    act(() => trigger.click());
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(dialog.textContent).toContain("Proposal details");
    expect(dialog.textContent).toContain("What the customer sees");
    expect(dialog.textContent).toContain("Proposal completeness");
    expect(dialog.textContent).toContain("What each status is based on");
    expect(dialog.querySelectorAll("[data-proposal-action]")).toHaveLength(4);
    expect(button("Send current proposal")).toBeUndefined();
    expect(button("Open proposal controls")).not.toBeUndefined();
    expect(container.textContent).toContain("Proposal details ready");

    act(() => container.querySelector('[aria-label="Close context"]').click());
    await settle();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(container.textContent).toContain("Proposal details closed");

    act(() => trigger.click());
    act(() => button("Open proposal controls").click());
    expect(onOpenLegacyWorkspace).toHaveBeenCalledOnce();
    expect(onOpenLegacyWorkspace.mock.calls[0][0]).toMatchObject({
      object: {
        id: "proposal",
        type: "customer-decision-artifact",
        label: "Proposal"
      },
      reason: expect.stringContaining("Prepare proposal, Send proposal, Replace customer link, or Review delivery"),
      consequence: expect.stringContaining("independently recheck role, exact revision")
    });
    expect(proposalQuote).toEqual(before);
  });

  test("routes proposal completeness gaps to the existing editor without staging or saving", () => {
    const onEditQuote = vi.fn(() => ({ status: "opened" }));
    const before = structuredClone(QUOTE);
    mount({ onEditQuote });

    act(() => button("Review proposal").click());
    expect(container.querySelector('[role="dialog"]')?.textContent)
      .toContain("Proposal completeness");
    const review = button("Review proposal gaps in editor");
    expect(review).not.toBeUndefined();
    expect(button("Send current proposal")).toBeUndefined();

    act(() => review.click());
    expect(onEditQuote).toHaveBeenCalledOnce();
    expect(onEditQuote.mock.calls[0][0]).toBe(QUOTE);
    expect(onEditQuote.mock.calls[0][1]).toMatchObject({
      arrivalContext: {
        object: {
          id: "proposal",
          type: "customer-decision-artifact",
          label: "Proposal",
          opportunityId: "quote-alpha"
        },
        reason: expect.stringContaining("exact proposal completeness"),
        consequence: expect.stringContaining("Nothing is repriced, saved, published, sent, rotated, or recovered"),
        nextResolution: expect.stringContaining("Save only through the existing authoritative quote workflow")
      },
      draftPatch: null
    });
    expect(QUOTE).toEqual(before);
  });

  test("routes the quote-completion proposal gap through the existing exact editor handoff", async () => {
    const exactField = document.createElement("button");
    exactField.type = "button";
    exactField.dataset.ambientActionId = "pc-edit-hours";
    document.body.append(exactField);
    const onEditQuote = vi.fn((_quote, options) => {
      scheduleQuoteCompletionDestinationFocus(options.quoteCompletionDestination, {
        root: document
      });
      return { status: "opened" };
    });
    mount({
      onEditQuote,
      quoteCompletionCommandPathEnabled: true,
      quoteActionController: {
        actionState: {
          state: { versionSaved: true, providerAccepted: false },
          actions: {
            send_quote: {
              id: "send_quote",
              label: "Send proposal",
              visible: true,
              enabled: true
            }
          },
          primaryAction: {
            id: "send_quote",
            label: "Send proposal",
            visible: true,
            enabled: true
          }
        }
      }
    });
    const command = container.querySelector('[data-capability-id="quote-completion-command-path"]');

    expect(command?.dataset.capabilityState).toBe("blocked");
    await act(async () => command.querySelector("button").click());

    expect(onEditQuote).toHaveBeenCalledOnce();
    expect(onEditQuote.mock.calls[0][0]).toBe(QUOTE);
    expect(onEditQuote.mock.calls[0][1]).toMatchObject({
      arrivalContext: {
        object: {
          id: "proposal",
          type: "customer-decision-artifact",
          opportunityId: "quote-alpha"
        },
        reason: expect.stringContaining("exact proposal completeness"),
        consequence: expect.stringContaining("Nothing is repriced, saved, published, sent, rotated, or recovered"),
        nextResolution: expect.stringContaining("Save only through the existing authoritative quote workflow")
      },
      draftPatch: null,
      quoteCompletionDestination: {
        surfaceId: "proposal-composer",
        step: 1,
        selector: '[data-ambient-action-id="pc-edit-hours"]',
        activate: true
      }
    });
    expect(onEditQuote.mock.calls[0][1].arrivalContext).not.toHaveProperty("kind");
    await settle();
    expect(document.activeElement).toBe(exactField);
    expect(command.dataset.commandState).toBe("success");
    exactField.remove();
  });

  test("routes a sendable quote-completion action through the exact governed proposal-controls handoff", async () => {
    const quote = Object.freeze({
      ...QUOTE,
      updatedAtISO: "2026-08-12T10:42:00.000Z",
      customer: Object.freeze({
        ...QUOTE.customer,
        phone: "205-555-0142"
      }),
      event: Object.freeze({
        ...QUOTE.event,
        hours: 6
      }),
      totals: Object.freeze({
        subtotal: 7_800,
        tax: 600,
        total: 8_400,
        deposit: 2_520
      }),
      pricing: Object.freeze({
        authority: "server_authoritative",
        calculatedAt: "2026-08-12T10:41:30.000Z",
        grandTotal: 8_400
      }),
      portalKey: "proposal-living-opportunity-key-000001",
      portalIssuedAtISO: "2026-08-12T10:42:00.000Z",
      portalExpiresAtISO: "2027-09-11T10:42:00.000Z",
      workflow: Object.freeze({ quoteDelivery: Object.freeze({}) })
    });
    const onOpenLegacyWorkspace = vi.fn(() => ({ status: "opened" }));
    mount({
      quote,
      source: "firebase",
      onOpenLegacyWorkspace,
      quoteCompletionCommandPathEnabled: true,
      quoteActionController: {
        actionState: {
          state: { versionSaved: true, providerAccepted: false },
          actions: {
            send_quote: {
              id: "send_quote",
              label: "Send proposal",
              visible: true,
              enabled: true
            }
          },
          primaryAction: {
            id: "send_quote",
            label: "Send proposal",
            visible: true,
            enabled: true
          }
        }
      }
    }, {
      ...CONTEXT,
      role: "admin",
      sourceFreshness: { state: "fresh", observedAt: "2026-08-12T10:42:01.000Z" }
    });
    const command = container.querySelector('[data-capability-id="quote-completion-command-path"]');

    expect(command?.dataset.capabilityState).toBe("sendable");
    await act(async () => command.querySelector("button").click());

    expect(onOpenLegacyWorkspace).toHaveBeenCalledOnce();
    expect(onOpenLegacyWorkspace.mock.calls[0][0]).toMatchObject({
      object: { id: "proposal", type: "customer-decision-artifact", label: "Proposal" },
      reason: expect.stringContaining("Prepare proposal, Send proposal, Replace customer link, or Review delivery"),
      consequence: expect.stringContaining("independently recheck role, exact revision"),
      nextResolution: expect.stringContaining("Choose Prepare, Send, Replace customer link, or Review delivery"),
      quoteCompletionDestination: {
        surfaceId: "quote-administration",
        actionId: "send_quote",
        quoteId: quote.id
      }
    });
    expect(command.dataset.commandState).toBe("success");
  });

  test("presents a missing phone as recommended contact detail without proposal-blocking language", () => {
    const onEditQuote = vi.fn(() => ({ status: "opened" }));
    const quote = {
      ...QUOTE,
      customer: { ...QUOTE.customer, phone: "" },
      event: { ...QUOTE.event, hours: 6, servers: 10, chefs: 3 }
    };
    mount({ quote, onEditQuote });

    act(() => button("Review proposal").click());
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain("100% of the required proposal details are complete");
    expect(dialog.textContent).toContain("Required details ready");
    expect(dialog.textContent).toContain("Recommended contact detail");
    expect(dialog.textContent).toContain("not required to prepare or send this proposal");
    expect(dialog.querySelector('[data-proposal-gap="customer-phone"]')).toBeNull();
    expect(dialog.querySelector('[data-proposal-recommendation="customer-phone"]')).not.toBeNull();

    const review = button("Review recommended contact in editor");
    expect(review).not.toBeUndefined();
    act(() => review.click());

    expect(onEditQuote).toHaveBeenCalledOnce();
    expect(onEditQuote.mock.calls[0][1]).toMatchObject({
      arrivalContext: {
        reason: expect.stringContaining("recommended contact"),
        nextResolution: expect.stringContaining("leave the proposal ready without it")
      },
      draftPatch: null
    });
  });

  test("opens exact Conversation evidence, keeps overlays exclusive, restores focus, and routes without mutation", async () => {
    const conversationQuote = {
      ...QUOTE,
      updatedAtISO: "2026-08-12T18:00:00.000Z",
      lifecycle: {
        sentAtISO: "2026-08-12T17:00:00.000Z",
        viewedAtISO: "2026-08-12T17:10:00.000Z"
      },
      workflow: {
        quoteDelivery: {
          state: "provider_accepted",
          revisionId: "version-alpha@2026-08-12T16:59:00.000Z",
          providerMessageId: "provider-message-alpha",
          providerAcceptedAtISO: "2026-08-12T17:00:01.000Z"
        }
      },
      conversationSummary: {
        messageCount: 2,
        latestMessageId: "message-customer-alpha",
        latestMessageAtISO: "2026-08-12T17:20:00.000Z",
        latestActorType: "customer"
      }
    };
    const context = {
      ...CONTEXT,
      sourceFreshness: {
        state: "fresh",
        observedAt: "2026-08-12T18:00:01.000Z"
      }
    };
    const onOpenConversation = vi.fn(() => ({ status: "opened" }));
    const before = structuredClone(conversationQuote);
    mount({
      quote: conversationQuote,
      source: "firebase",
      onOpenConversation
    }, context);

    const row = container.querySelector('[data-intelligent-object="conversation"]');
    const trigger = button("Review conversation");
    expect(row).not.toBeNull();
    expect(row.dataset.conversationState).toBe("attention");
    expect(row.dataset.conversationAvailability).toBe("available");
    expect(row.textContent).toContain("Review latest customer reply");
    expect(trigger.dataset.ambientActionId).toBe("inspect-conversation");

    act(() => button("Review payments").click());
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    act(() => trigger.click());

    const dialog = container.querySelector('[role="dialog"]');
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(dialog.textContent).toContain("Conversation details");
    expect(dialog.textContent).toContain("Recorded conversation activity");
    expect(dialog.querySelectorAll("[data-conversation-evidence]")).toHaveLength(5);
    expect(dialog.querySelector('[data-conversation-evidence="provider-delivered"]')?.dataset.conversationEvidenceState)
      .toBe("provider_accepted_only");
    expect(dialog.querySelector('[data-conversation-evidence="portal-viewed"]')?.dataset.conversationEvidenceState)
      .toBe("recorded_view");
    expect(dialog.querySelector('[data-conversation-evidence="replied"]')?.dataset.conversationEvidenceState)
      .toBe("latest_customer_reply");
    expect(dialog.textContent).toContain("No supported inference");
    expect(container.textContent).toContain("Conversation details ready");
    expect(button("Send message")).toBeUndefined();
    expect(button("Mark read")).toBeUndefined();

    act(() => button("Review latest customer reply").click());
    expect(onOpenConversation).toHaveBeenCalledOnce();
    expect(onOpenConversation.mock.calls[0][0]).toBe("quote-alpha");
    expect(onOpenConversation.mock.calls[0][1]).toMatchObject({
      arrivalContext: {
        surfaceId: "conversation",
        object: {
          id: "quote-alpha",
          type: "customer-communication-evidence",
          label: "Conversation"
        },
        reason: expect.stringContaining("latest exact conversation message is customer-authored"),
        consequence: expect.stringContaining("does not acknowledge, resolve, or answer"),
        nextResolution: expect.stringContaining("Open this quote’s conversation"),
        target: {
          quoteId: "quote-alpha",
          messageId: "message-customer-alpha"
        }
      }
    });
    expect(conversationQuote).toEqual(before);

    act(() => container.querySelector('[aria-label="Close context"]').click());
    await settle();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(container.textContent).toContain("Conversation details closed");
  });

  test("routes an exact customer change request only into the existing Workflow controls", () => {
    const conversationQuote = {
      ...QUOTE,
      updatedAtISO: "2026-08-12T18:00:00.000Z",
      portalDecision: {
        decision: "changes_requested",
        requestId: "request-conversation-alpha",
        submittedAtISO: "2026-08-12T17:30:00.000Z",
        message: "Please move dinner to 7 PM."
      }
    };
    const context = {
      ...CONTEXT,
      sourceFreshness: { state: "fresh", observedAt: "2026-08-12T18:00:01.000Z" }
    };
    const onOpenWorkflow = vi.fn(() => ({ status: "opened" }));
    const before = structuredClone(conversationQuote);
    mount({
      quote: conversationQuote,
      source: "firebase",
      conversationAvailable: false,
      onOpenWorkflow
    }, context);

    act(() => button("Review conversation").click());
    const resolution = button("Review customer change request");
    expect(resolution).not.toBeUndefined();
    act(() => resolution.click());

    expect(onOpenWorkflow).toHaveBeenCalledOnce();
    expect(onOpenWorkflow.mock.calls[0][0]).toMatchObject({
      kind: "route",
      surfaceId: "workflow",
      quoteId: "quote-alpha",
      attentionType: "change_request",
      requestId: "request-conversation-alpha"
    });
    expect(onOpenWorkflow.mock.calls[0][1]).toMatchObject({
      arrivalContext: {
        surfaceId: "workflow",
        object: {
          id: "quote-alpha",
          type: "customer-communication-evidence",
          label: "Conversation"
        },
        reason: expect.stringContaining("customer portal request is open"),
        consequence: expect.stringContaining("explicit draft action and trusted save"),
        nextResolution: expect.stringContaining("Open the task to review it"),
        target: {
          quoteId: "quote-alpha",
          attentionType: "change_request",
          requestId: "request-conversation-alpha"
        }
      }
    });
    expect(conversationQuote).toEqual(before);
  });

  test("routes a recorded follow-up into its canonical exact Workflow item", () => {
    const conversationQuote = {
      ...QUOTE,
      updatedAtISO: "2026-08-12T18:00:00.000Z",
      workflow: {
        followUp: {
          stage: "awaiting_response",
          dueDate: "2026-08-11",
          completed: false
        }
      }
    };
    const context = {
      ...CONTEXT,
      sourceFreshness: { state: "fresh", observedAt: "2026-08-12T18:00:01.000Z" }
    };
    const onOpenWorkflow = vi.fn(() => ({ status: "opened" }));
    mount({
      quote: conversationQuote,
      source: "firebase",
      conversationAvailable: false,
      onOpenWorkflow
    }, context);

    act(() => button("Review conversation").click());
    act(() => button("Review opportunity follow-up").click());

    expect(onOpenWorkflow).toHaveBeenCalledOnce();
    expect(onOpenWorkflow.mock.calls[0][0]).toMatchObject({
      kind: "route",
      surfaceId: "workflow",
      quoteId: "quote-alpha",
      attentionType: "follow_up",
      requestId: "follow-up:quote-alpha"
    });
    expect(onOpenWorkflow.mock.calls[0][1]).toMatchObject({
      arrivalContext: {
        surfaceId: "workflow",
        target: {
          quoteId: "quote-alpha",
          attentionType: "follow_up",
          requestId: "follow-up:quote-alpha"
        }
      }
    });
  });

  test("does not offer a substitute Workflow item for a change request without an exact identity", () => {
    const conversationQuote = {
      ...QUOTE,
      updatedAtISO: "2026-08-12T18:00:00.000Z",
      portalDecision: {
        decision: "changes_requested",
        submittedAtISO: "2026-08-12T17:30:00.000Z",
        message: "Please move dinner to 7 PM."
      }
    };
    const context = {
      ...CONTEXT,
      sourceFreshness: { state: "fresh", observedAt: "2026-08-12T18:00:01.000Z" }
    };
    const onOpenWorkflow = vi.fn();
    mount({
      quote: conversationQuote,
      source: "firebase",
      conversationAvailable: false,
      onOpenWorkflow
    }, context);

    act(() => button("Review conversation").click());

    expect(button("Review customer change request")).toBeUndefined();
    expect(container.textContent).toContain("no exact request identity");
    expect(onOpenWorkflow).not.toHaveBeenCalled();
  });

  test("exposes package and menu as inspectable intelligent objects with populated judgment context", () => {
    mount();

    const packageRow = container.querySelector('[data-intelligent-object="package"]');
    const menuRow = container.querySelector('[data-intelligent-object="menu"]');
    expect(packageRow).not.toBeNull();
    expect(packageRow.textContent).toContain("Classic");
    expect(packageRow.textContent).toContain("Review package");
    expect(menuRow).not.toBeNull();
    expect(menuRow.textContent).toContain("2 saved items");
    expect(menuRow.textContent).toContain("Review menu");

    act(() => button("Review package").click());
    let dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain("Package details");
    expect(dialog.textContent).toContain("What this connects to");
    expect(dialog.textContent).toContain("Why this matters");
    expect(dialog.textContent).toContain("If you do nothing");
    expect(dialog.textContent).toContain("Confidence: high");
    expect(dialog.textContent).toContain("Sources:");
    expect(dialog.closest(".ambient-context-surface")?.classList)
      .toContain("ambient-context-surface--arrival-disclosure");
    expect(dialog.querySelector('[data-context-arrival-duplicate="reason"]')?.textContent)
      .toContain("Why this matters");

    act(() => container.querySelector('[aria-label="Close context"]').click());
    act(() => button("Review menu").click());
    dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain("Menu details");
    expect(dialog.textContent).toContain("What this connects to");
    expect(dialog.textContent).toContain("Why this matters");
    expect(dialog.textContent).toContain("If you do nothing");
    expect(dialog.textContent).toContain("Confidence: high");
    expect(dialog.textContent).toContain("Sources:");
    expect(dialog.closest(".ambient-context-surface")?.classList)
      .toContain("ambient-context-surface--arrival-disclosure");
    expect(dialog.querySelector('[data-context-arrival-duplicate="reason"]')?.textContent)
      .toContain("Why this matters");
  });

  test("explores a reversible selection scenario with exact context and undo without mutating the quote", async () => {
    const beforeQuote = structuredClone(QUOTE);
    mount();

    const row = container.querySelector('[data-intelligent-object="event-selections"]');
    expect(row).not.toBeNull();
    expect(row.textContent).toContain("2 saved selections across 2 groups");
    expect(row.textContent).toContain("Review selections");

    act(() => button("Review selections").click());
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain("Selection details");
    expect(dialog.textContent).toContain("Rentals");
    expect(dialog.textContent).toContain("Services");
    expect(dialog.textContent).toContain("Dining chairs");
    expect(dialog.textContent).toContain("Tea service");
    expect(dialog.textContent).toContain("What this connects to");
    expect(dialog.textContent).toContain("If you do nothing");
    expect(dialog.textContent).toContain("Confidence: high");
    expect(dialog.textContent).toContain("Sources:");
    expect(dialog.closest(".ambient-context-surface")?.classList)
      .toContain("ambient-context-surface--arrival-disclosure");
    expect(container.textContent).toContain("Selection details ready");

    const rentalCard = dialog.querySelector('[data-selection-kind="rental"]');
    expect(rentalCard.dataset.currentQuantity).toBe("15");
    const increase = dialog.querySelector('[aria-label="Increase Dining chairs preview quantity"]');
    act(() => increase.click());

    expect(rentalCard.dataset.currentQuantity).toBe("16");
    expect(rentalCard.dataset.scenarioState).toBe("changed");
    expect(container.querySelector('[data-result-kind="preview"]')?.textContent)
      .toContain("Dining chairs preview quantity is 16");
    expect(container.querySelector('[data-ambient-undo-count="1"]')).not.toBeNull();
    const undo = container.querySelector('[aria-label="Undo Dining chairs unsaved preview changed"]');
    expect(undo).not.toBeNull();
    act(() => undo.click());
    await settle();

    expect(rentalCard.dataset.currentQuantity).toBe("15");
    expect(rentalCard.dataset.scenarioState).toBe("saved");
    expect(container.textContent).toContain("Previous Dining chairs scenario restored");
    expect(QUOTE).toEqual(beforeQuote);
  });

  test("hands an exact package replacement intent and normalized catalog context to the editor without mutation", () => {
    const onEditQuote = vi.fn(() => ({ status: "opened" }));
    const beforeQuote = structuredClone(QUOTE);
    const beforeEvidence = structuredClone(PACKAGE_MENU_CATALOG_EVIDENCE);
    mount({ onEditQuote });

    act(() => button("Review package").click());
    const replacement = [...container.querySelectorAll(
      'button[data-ambient-action-id="replace-package-in-draft"]'
    )].find((item) => item.textContent.includes("Premium"));
    expect(replacement).toBeDefined();
    act(() => replacement.click());

    expect(onEditQuote).toHaveBeenCalledOnce();
    const [selectedQuote, options] = onEditQuote.mock.calls[0];
    expect(selectedQuote).toBe(QUOTE);
    expect(options).toMatchObject({
      arrivalContext: {
        object: {
          id: "package",
          opportunityId: "quote-alpha"
        },
        consequence: expect.stringContaining("No package, price, availability, or saved version changes")
      },
      draftIntent: {
        ok: true,
        schemaVersion: "ambient-package-menu-draft-intent-v1",
        kind: "replace_package",
        actionId: "replace-package-in-draft",
        authority: "draft_only",
        commit: false,
        baseContext: {
          quoteId: "quote-alpha",
          organizationId: "org-alpha",
          baseRevisionId: "version-alpha",
          catalogRevision: 12
        },
        before: { packageId: "classic" },
        proposed: { packageId: "premium", packageName: "Premium" },
        consequencePreviewRequired: true,
        requiresOutcomeNamedSave: true
      },
      ambientCatalogContext: {
        state: "current",
        organizationId: "org-alpha",
        sourceLabel: "Exact tenant catalog",
        catalogRevision: 12,
        freshness: {
          state: "fresh",
          observedAt: "2026-08-11T18:01:00.000Z"
        }
      }
    });
    expect(QUOTE).toEqual(beforeQuote);
    expect(PACKAGE_MENU_CATALOG_EVIDENCE).toEqual(beforeEvidence);
  });

  test("hands an exact menu replacement intent to the editor without mutating saved quantity or order", () => {
    const onEditQuote = vi.fn(() => ({ status: "opened" }));
    const beforeQuote = structuredClone(QUOTE);
    mount({ onEditQuote });

    act(() => button("Review menu").click());
    const replacement = [...container.querySelectorAll(
      'button[data-ambient-action-id="replace-menu-item-in-draft"]'
    )].find((item) => item.textContent.includes("Salmon"));
    expect(replacement).toBeDefined();
    act(() => replacement.click());

    expect(onEditQuote).toHaveBeenCalledOnce();
    const [selectedQuote, options] = onEditQuote.mock.calls[0];
    expect(selectedQuote).toBe(QUOTE);
    expect(options).toMatchObject({
      draftIntent: {
        ok: true,
        schemaVersion: "ambient-package-menu-draft-intent-v1",
        kind: "replace_menu_item",
        actionId: "replace-menu-item-in-draft",
        authority: "draft_only",
        commit: false,
        before: {
          itemId: "salad",
          orderIndex: 0,
          quantity: 2
        },
        proposed: {
          itemId: "salmon",
          orderIndex: 0,
          quantity: 2,
          quantityPolicy: "preserve_explicit_saved_quantity"
        },
        consequencePreviewRequired: true,
        requiresOutcomeNamedSave: true
      },
      ambientCatalogContext: {
        state: "current",
        organizationId: "org-alpha",
        catalogRevision: 12
      }
    });
    expect(QUOTE.selection.menuItems).toEqual(["salad", "chicken"]);
    expect(QUOTE.selection.menuItemQuantities).toEqual({ salad: 2, chicken: 3 });
    expect(QUOTE).toEqual(beforeQuote);
  });

  test("uses a real selector only when several saved menu items can be replacement sources", () => {
    mount();

    act(() => button("Review menu").click());

    const field = container.querySelector('[data-adaptive-choice-mode="select"]');
    const selector = field?.querySelector("select");
    expect(field).not.toBeNull();
    expect(selector?.value).toBe("salad");
    expect([...selector.querySelectorAll("option")].map((option) => option.value)).toEqual([
      "",
      "salad",
      "chicken"
    ]);
  });

  test("presents one saved menu replacement source as confirmed read-only context", () => {
    const singleMenuQuote = {
      ...QUOTE,
      selection: {
        ...QUOTE.selection,
        menuItems: ["salad"],
        menuItemsSnapshot: [QUOTE.selection.menuItemsSnapshot[0]],
        menuItemNames: ["Garden salad"],
        menuItemQuantities: { salad: 2 }
      }
    };
    mount({ quote: singleMenuQuote });

    act(() => button("Review menu").click());

    const field = container.querySelector('[data-adaptive-choice-mode="single"]');
    expect(field).not.toBeNull();
    expect(field.querySelector("select")).toBeNull();
    expect(field.querySelector('[data-adaptive-choice-value="salad"]')?.textContent)
      .toContain("Garden salad");
    expect(field.textContent).toContain("only saved menu item");
    expect(field.textContent).toContain("Read-only");
  });

  test("explains and recovers when no exact saved menu item can be a replacement source", async () => {
    const onOpenLegacyWorkspace = vi.fn(async () => {
      throw new Error("Quote workspace route failed.");
    });
    const emptyMenuQuote = {
      ...QUOTE,
      selection: {
        ...QUOTE.selection,
        menuItems: [],
        menuItemsSnapshot: [],
        menuItemNames: [],
        menuItemQuantities: {}
      }
    };
    mount({ quote: emptyMenuQuote, onOpenLegacyWorkspace });

    act(() => container.querySelector('[data-intelligent-object="menu"] button').click());

    const field = container.querySelector('[data-menu-replacement-source-state="unavailable"]');
    expect(field).not.toBeNull();
    expect(field.dataset.adaptiveChoiceMode).toBe("empty");
    expect(field.querySelector("select")).toBeNull();
    expect(field.textContent).toContain("Unavailable");
    expect(field.textContent).toContain("does not record a menu selection");
    const recovery = field.querySelector("button");
    expect(recovery?.dataset.ambientActionId)
      .toBe("open-full-opportunity-controls");

    await act(async () => {
      recovery.click();
      await Promise.resolve();
    });
    await settle();

    expect(onOpenLegacyWorkspace).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-result-kind="recovery"]')?.textContent)
      .toContain("Quote workspace route failed.");
    expect(container.textContent).toContain("Full opportunity controls were not opened");
  });

  test("offers visible keyboard-equivalent menu moves and hands the exact reorder intent to the editor", () => {
    const onEditQuote = vi.fn(() => ({ status: "opened" }));
    const beforeQuote = structuredClone(QUOTE);
    mount({ onEditQuote });

    act(() => button("Review menu").click());
    const moveLater = button("Move later");
    const moveEarlier = button("Move earlier");
    expect(moveLater).not.toBeUndefined();
    expect(moveEarlier).not.toBeUndefined();
    expect(moveLater.dataset.ambientActionId).toBe("reorder-menu-in-draft");
    expect(moveEarlier.dataset.ambientActionId).toBe("reorder-menu-in-draft");
    act(() => moveLater.click());

    expect(onEditQuote).toHaveBeenCalledOnce();
    const [selectedQuote, options] = onEditQuote.mock.calls[0];
    expect(selectedQuote).toBe(QUOTE);
    expect(options).toMatchObject({
      draftIntent: {
        ok: true,
        schemaVersion: "ambient-package-menu-draft-intent-v1",
        kind: "reorder_menu",
        actionId: "reorder-menu-in-draft",
        authority: "draft_only",
        commit: false,
        itemId: "salad",
        fromIndex: 0,
        toIndex: 1,
        beforeOrder: ["salad", "chicken"],
        proposedOrder: ["chicken", "salad"],
        interaction: "keyboard",
        consequencePreviewRequired: true,
        requiresOutcomeNamedSave: true
      },
      ambientCatalogContext: {
        state: "current",
        organizationId: "org-alpha",
        catalogRevision: 12
      }
    });
    expect(QUOTE.selection.menuItems).toEqual(["salad", "chicken"]);
    expect(QUOTE).toEqual(beforeQuote);
  });

  test("routes a touch Menu swipe through the same unsaved reorder review", () => {
    const onEditQuote = vi.fn(() => ({ status: "opened" }));
    const beforeQuote = structuredClone(QUOTE);
    mount({ onEditQuote });

    act(() => button("Review menu").click());
    const firstItem = container.querySelector('[data-menu-item-id]');
    expect(firstItem).not.toBeNull();
    expect(firstItem.dataset.gestureAlternative).toBe("visible-move-buttons");
    expect(firstItem.dataset.keyboardAlternative).toBe("native-move-buttons");
    act(() => {
      firstItem.dispatchEvent(pointerEvent("pointerdown", { clientX: 20, clientY: 20 }));
      firstItem.dispatchEvent(pointerEvent("pointerup", { clientX: 90, clientY: 22 }));
    });

    expect(onEditQuote).toHaveBeenCalledOnce();
    expect(onEditQuote.mock.calls[0][1]).toMatchObject({
      draftIntent: {
        kind: "reorder_menu",
        authority: "draft_only",
        commit: false,
        fromIndex: 0,
        toIndex: 1,
        beforeOrder: ["salad", "chicken"],
        proposedOrder: ["chicken", "salad"],
        interaction: "pointer"
      }
    });
    expect(QUOTE).toEqual(beforeQuote);
  });

  test("keeps stale package and menu evidence inspectable while withholding draft choices", () => {
    const staleEvidence = {
      ...PACKAGE_MENU_CATALOG_EVIDENCE,
      freshness: {
        state: "stale",
        observedAtISO: "2026-08-10T18:01:00.000Z",
        reason: "The operator catalog may have changed."
      }
    };
    mount({ packageMenuCatalogEvidence: staleEvidence });

    expect(button("Review package")).not.toBeUndefined();
    expect(button("Review menu")).not.toBeUndefined();
    act(() => button("Review package").click());
    let dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain("Package details");
    expect(container.querySelector(
      'button[data-ambient-action-id="replace-package-in-draft"]'
    )).toBeNull();

    act(() => container.querySelector('[aria-label="Close context"]').click());
    act(() => button("Review menu").click());
    dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain("Menu details");
    expect(container.querySelector(
      'button[data-ambient-action-id="replace-menu-item-in-draft"]'
    )).toBeNull();
    expect(container.querySelector(
      'button[data-ambient-action-id="reorder-menu-in-draft"]'
    )).toBeNull();
    expect(button("Move later")).toBeUndefined();
    expect(button("Move earlier")).toBeUndefined();
  });

  test("reveals operational facts before deeper supporting evidence", () => {
    mount();

    expect(container.querySelector('[data-disclosure-layer="operational"]')).toBeNull();
    expect(container.querySelector('[data-disclosure-layer="supporting"]')).toBeNull();

    act(() => button("About this opportunity").click());

    const operational = container.querySelector('[data-disclosure-layer="operational"]');
    expect(operational).not.toBeNull();
    expect(operational.dataset.surfacePurpose).toContain("reveal_context");
    expect(operational.textContent).toContain("The Foundry Hall");
    expect(operational.textContent).toContain("11 quoted staff");
    expect(container.textContent).toContain("Opportunity details revealed");
    expect(container.querySelector(".ambient-feedback-announcement")?.textContent)
      .toContain("item was added");
    expect(container.querySelector(".ambient-living-opportunity")?.classList)
      .toContain("ambient-feedback-event--active");
    expect(container.querySelector("[data-ambient-feedback-dependent]")).not.toBeNull();
    expect(document.activeElement).toBe(operational);
    expect(container.querySelector('[data-disclosure-layer="supporting"]')).toBeNull();

    act(() => button("Show more context").click());

    const supporting = container.querySelector('[data-disclosure-layer="supporting"]');
    expect(supporting).not.toBeNull();
    expect(supporting.dataset.surfacePurpose).toContain("clarify");
    expect(supporting.textContent).toContain("Margin");
    expect(supporting.textContent).toContain("Unavailable");
    expect(supporting.textContent).toContain("No recorded activity");
    expect(container.textContent).toContain("More context shown");
    expect(document.activeElement).toBe(supporting);
  });

  test("stages a reversible guest scenario into the existing priced editor with arrival context", async () => {
    const onEditQuote = vi.fn();
    mount({ onEditQuote });

    act(() => container.querySelector('[aria-label="Change Guest count scenario"]').click());
    const input = container.querySelector('input[type="number"]');
    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      ).set;
      valueSetter.call(input, "150");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => button("Apply change").click());
    await settle();

    expect(container.textContent).toContain("Staffing suggestion updated for 150 guests");
    expect(container.textContent).toContain("Guest scenario changed to 150");
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("150 guests");

    act(() => button("Stage 150 guests in editor").click());

    expect(onEditQuote).toHaveBeenCalledOnce();
    const [stagedQuote, options] = onEditQuote.mock.calls[0];
    expect(stagedQuote).toBe(QUOTE);
    expect(QUOTE.event.guests).toBe(120);
    expect(options.draftPatch).toEqual({
      source: "ambient-guest-scenario-v1",
      baseRevisionId: "version-alpha",
      event: { guests: 150 }
    });
    expect(options.arrivalContext).toMatchObject({
      object: { id: QUOTE.id, type: "opportunity", label: QUOTE.event.name },
      reason: "Continue the active guest-count preview in the exact quote editor.",
      consequence: expect.stringContaining("Live pricing remains a preview"),
      nextResolution: expect.stringContaining("Review the live price")
    });
  });

  test("recovers instead of staging a guest draft against an invented revision", async () => {
    const onEditQuote = vi.fn();
    const quoteWithoutRevision = Object.freeze({
      ...QUOTE,
      activeVersionId: undefined
    });
    mount({ quote: quoteWithoutRevision, onEditQuote });

    act(() => container.querySelector('[aria-label="Change Guest count scenario"]').click());
    const input = container.querySelector('input[type="number"]');
    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      ).set;
      valueSetter.call(input, "150");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => button("Apply change").click());
    await settle();
    act(() => button("Stage 150 guests in editor").click());

    expect(onEditQuote).not.toHaveBeenCalled();
    expect(container.querySelector('[data-result-kind="recovery"]')?.textContent)
      .toContain("Refresh the quote before editing");
    expect(container.textContent).toContain("Refresh the opportunity");
    expect(container.textContent).not.toContain("saved-record-revision-unavailable");
  });

  test("uses, stages, and reverses deterministic staffing without mutating the saved quote", async () => {
    const onEditQuote = vi.fn(() => ({ status: "opened" }));
    mount({ onEditQuote });

    act(() => button("Review staffing").click());
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog.closest(".ambient-context-surface")?.classList)
      .toContain("ambient-context-surface--arrival-disclosure");
    expect(dialog.querySelector('[data-context-arrival-duplicate="reason"]')?.textContent)
      .toContain("Why this recommendation");
    expect(dialog.textContent).toContain("Staffing suggestion");
    expect(dialog.textContent).toContain("8 servers · 3 chefs · 0 bartenders");
    expect(dialog.textContent).toContain("10 servers · 3 chefs · 0 bartenders");
    expect(dialog.textContent).toContain("Why this recommendation");
    expect(dialog.textContent).toContain("If you do nothing");
    expect(dialog.textContent).toContain("does not prove staff availability");

    act(() => button("Use recommendation").click());
    expect(container.textContent).toContain("Staffing scenario updated to 10 servers · 3 chefs · 0 bartenders");
    expect(container.querySelector('[data-intelligent-object="staffing"]')?.dataset.scenarioState)
      .toBe("active");

    act(() => button("Stage staffing in editor").click());
    expect(onEditQuote).toHaveBeenCalledOnce();
    const [stagedQuote, options] = onEditQuote.mock.calls[0];
    expect(stagedQuote).toBe(QUOTE);
    expect(options.draftPatch).toEqual({
      source: "ambient-staffing-recommendation-v1",
      baseRevisionId: "version-alpha",
      event: { servers: 10, chefs: 3, bartenders: 0 }
    });
    expect(options.arrivalContext).toMatchObject({
      reason: "Continue the active staffing recommendation in the exact quote editor.",
      consequence: expect.stringContaining("Labor pricing remains a preview")
    });
    expect(QUOTE.event.servers).toBe(8);

    await act(async () => {
      container.querySelector('[aria-label^="Undo Staffing recommendation used"]')?.click();
      await Promise.resolve();
    });
    expect(container.querySelector('[data-intelligent-object="staffing"]')?.dataset.scenarioState)
      .toBe("saved");
    expect(container.textContent).toContain("Previous staffing scenario restored");
  });

  test("marks a chosen staffing recommendation stale when its guest-count basis changes", async () => {
    mount();

    act(() => button("Review staffing").click());
    act(() => button("Use recommendation").click());
    act(() => container.querySelector('[aria-label="Close context"]').click());

    act(() => container.querySelector('[aria-label="Change Guest count scenario"]').click());
    const input = container.querySelector('input[type="number"]');
    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      ).set;
      valueSetter.call(input, "150");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => button("Apply change").click());
    await settle();

    const staffingRow = container.querySelector('[data-intelligent-object="staffing"]');
    expect(staffingRow.dataset.scenarioState).toBe("stale");
    expect(staffingRow.textContent).toContain("Refresh required");
    act(() => container.querySelector('[aria-label="Close context"]').click());
    act(() => button("Review staffing").click());
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("Refresh recommendation");
    expect(button("Stage staffing in editor")).toBeUndefined();
  });

  test("replaces a cancelled editor handoff with truthful recovery instead of ready feedback", async () => {
    const onEditQuote = vi.fn(() => ({
      status: "cancelled",
      reason: "Unsaved quote work was preserved.",
      consequence: "No route changed and no quote was modified.",
      nextResolution: "Save or discard the current draft, then try again."
    }));
    mount({ onEditQuote });

    await act(async () => {
      button("Review draft").click();
      await Promise.resolve();
    });

    expect(onEditQuote).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Priced editor was not opened");
    expect(container.textContent).toContain("No route changed and no quote was modified");
    expect(container.querySelector("[data-result-kind='recovery']")).not.toBeNull();
    expect(container.querySelector("[data-feedback-kind='warning']")).not.toBeNull();
    expect(container.querySelector("[data-feedback-kind='ready']")).toBeNull();
  });

  test("registers every enabled Alpha button and records a zero-dead-click primary handoff", () => {
    const observations = [];
    mount({ onEditQuote: vi.fn(() => ({ status: "opened" })) });
    const surface = container.querySelector(".ambient-living-opportunity");
    surface.addEventListener("quotepilot:ambient-interaction", (event) => {
      observations.push(event.detail);
    });

    const unmappedButtons = () => [...surface.querySelectorAll("button:not(:disabled)")]
      .filter((item) => !item.dataset.ambientActionId)
      .map((item) => item.getAttribute("aria-label") || item.textContent.trim());

    expect(unmappedButtons()).toEqual([]);

    act(() => button("See connections").click());
    expect(unmappedButtons()).toEqual([]);
    act(() => container.querySelector('[aria-label="Close context"]').click());
    expect(container.textContent).toContain("Guest-count context closed");

    act(() => button("Review draft").click());

    expect(surface.dataset.ambientAuditPhase).toBe("acknowledge");
    expect(surface.dataset.ambientPrimaryAssessments).toBe("1");
    expect(surface.dataset.ambientPrimaryDeadClicks).toBe("0");
    expect(surface.dataset.ambientPrimaryDeadClickRate).toBe("0");
    expect(observations.some((item) => (
      item.phase === "acknowledge"
      && item.primary === true
      && item.resultKind === "pending"
      && item.monitor.deadClickRate === 0
    ))).toBe(true);
    expect(JSON.stringify(observations)).not.toContain(QUOTE.id);
    expect(JSON.stringify(observations)).not.toContain(QUOTE.customer.name);
  });

  test("turns invalid and unchanged guest submissions into explicit recovery or resolution", async () => {
    mount();

    act(() => container.querySelector('[aria-label="Change Guest count scenario"]').click());
    let input = container.querySelector('input[type="number"]');
    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      ).set;
      valueSetter.call(input, "0");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      button("Apply change").click();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Enter 1 to 400 guests");
    expect(container.querySelector('[data-result-kind="recovery"]')?.textContent)
      .toContain("Enter 1 to 400 guests");

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      ).set;
      valueSetter.call(input, "120");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      button("Apply change").click();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-result-kind="resolved"]')?.textContent)
      .toContain("Guest scenario remains at 120");
    expect(container.querySelector('[aria-label="Change Guest count scenario"]')).not.toBeNull();
  });
});


test.each(["accepted", "booked"])("eligible %s count review replaces no-action cue and returns focus to its exact trigger", async (status) => {
  const onEditQuote = vi.fn();
  mount({ quote: { ...QUOTE, status, acceptanceReceipt: { receiptId: "accept-alpha" } }, source: "firebase", ordinaryEditAllowed: false, attendanceEnabled: true, principalId: "sales-alpha", onEditQuote, onOpenWorkflow: undefined });
  const next = container.querySelector('.ambient-mobile-remote__next button');
  expect(next.textContent).toContain("Review final guest count");
  expect(container.querySelector('.ambient-mobile-remote__next').textContent).not.toContain("No role-safe action");
  expect(next.dataset.ambientActionId).toBe("inspect-guest-count");
  act(() => { next.focus(); next.click(); });
  await settle();
  const panel = container.querySelector('[data-testid="native-attendance"]');
  expect(panel.dataset.sourceVersion).toBe("version-alpha");
  expect(panel.dataset.acceptanceReceipt).toBe("accept-alpha");
  expect(container.querySelector('.attendance-supporting-context').open).toBe(false);
  expect(onEditQuote).not.toHaveBeenCalled();
  expect(container.querySelector(".ambient-action-acknowledgement").textContent).toContain("The saved quote stays unchanged");
  expect(container.querySelector(".ambient-action-acknowledgement").textContent).not.toContain("Try another guest count");
  act(() => container.querySelector('[aria-label="Close context"]').click());
  await settle();
  expect(document.activeElement).toBe(next);
});

test.each([
  ["disabled", { attendanceEnabled: false }],
  ["local", { source: "local" }],
  ["unaccepted", { quote: { ...QUOTE, status: "draft" } }],
  ["missing source receipt", { quote: { ...QUOTE, status: "booked" } }],
  ["foreign organization", { quote: { ...QUOTE, organizationId: "other-org", status: "booked", acceptanceReceipt: { receiptId: "accept-alpha" } } }]
])("does not offer native final-count work for %s scope", (_name, overrides) => {
  mount({ quote: { ...QUOTE, status: "booked", acceptanceReceipt: { receiptId: "accept-alpha" } }, source: "firebase", ordinaryEditAllowed: false, attendanceEnabled: true, principalId: "sales-alpha", ...overrides });
  expect([...container.querySelectorAll('button')].some(node => node.textContent.includes("Review final guest count"))).toBe(false);
});


test("keeps final-count work unavailable to non-staff roles", () => {
  mount({ quote: { ...QUOTE, status: "booked", acceptanceReceipt: { receiptId: "accept-alpha" } }, source: "firebase", ordinaryEditAllowed: false, attendanceEnabled: true, principalId: "finance-alpha" }, { ...CONTEXT, role: "finance" });
  expect([...container.querySelectorAll('button')].some(node => node.textContent.includes("Review final guest count"))).toBe(false);
});
