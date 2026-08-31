import { describe, expect, test } from "vitest";

import {
  createWorkspaceArrivalHandoff,
  parseWorkspaceArrivalHandoff,
  WORKSPACE_ARRIVAL_CONTRACT_MODEL
} from "../workspaceArrivalContract";

function locationFor(handoff, overrides = {}) {
  const url = new URL(handoff.navigation.path, "https://quotepilot.local");
  return {
    pathname: url.pathname,
    search: url.search,
    hash: "",
    state: handoff.navigation.state,
    ...overrides
  };
}

function mutableState(handoff) {
  return JSON.parse(JSON.stringify(handoff.navigation.state));
}

function workflowInput(overrides = {}) {
  return {
    destination: "workflow",
    object: { id: "request-7", type: "workflow-item" },
    focus: {
      quoteId: "quote-42",
      attentionType: "change_request",
      requestId: "request-7"
    },
    intentId: "review_customer_request",
    ...overrides
  };
}

function opportunityInput(overrides = {}) {
  return {
    destination: "opportunity",
    object: { id: "quote-42", type: "opportunity" },
    focus: { quoteId: "quote-42" },
    intentId: "review_opportunity",
    ...overrides
  };
}

function administrationInput(overrides = {}) {
  return {
    destination: "administration",
    object: { id: "quote-42", type: "payment-evidence" },
    focus: { quoteId: "quote-42" },
    intentId: "review_payment_controls",
    ...overrides
  };
}

function clientInput(overrides = {}) {
  return {
    destination: "client",
    object: { id: "client-42", type: "client" },
    focus: { customerId: "client-42" },
    intentId: "review_client",
    ...overrides
  };
}

function libraryInput(overrides = {}) {
  return {
    destination: "library",
    object: { id: "organization-42", type: "organization-library" },
    focus: { sectionId: "overview" },
    intentId: "browse_library",
    ...overrides
  };
}

describe("workspace exact-arrival handoff", () => {
  test("builds and parses a canonical exact Client handoff", () => {
    const handoff = createWorkspaceArrivalHandoff(clientInput());

    expect(handoff).toMatchObject({
      ok: true,
      contract: {
        destination: "client",
        routeId: "customer-detail",
        surfaceId: "client-overview",
        focusTransport: "state_only",
        focusConsumerState: "supported",
        arrivalState: "focus_supported",
        object: { id: "client-42", type: "client", label: "Client" },
        intentId: "review_client",
        reasonId: "exact_client_selected",
        consequenceId: "client_record_remains_unchanged",
        intendedResolutionId: "review_client_relationship",
        focus: { customerId: "client-42" }
      },
      navigation: {
        path: "/app/customers/client-42",
        primaryActionReady: true
      }
    });
    expect(handoff.contract.consequence).toMatch(/changes no client, quote, conversation, payment, booking, or provider evidence/i);
    expect(parseWorkspaceArrivalHandoff(locationFor(handoff))).toEqual(handoff);
  });

  test("rejects mismatched, sensitive, and copied Client arrival context", () => {
    const mismatched = createWorkspaceArrivalHandoff(clientInput({
      focus: { customerId: "client-other" }
    }));
    const email = createWorkspaceArrivalHandoff(clientInput({
      object: { id: "client@example.test", type: "client" },
      focus: { customerId: "client@example.test" }
    }));
    const handoff = createWorkspaceArrivalHandoff(clientInput());

    expect(mismatched).toMatchObject({ ok: false, recovery: { code: "unsupported_combination" } });
    expect(email).toMatchObject({ ok: false, recovery: { code: "unsafe_identifier" } });
    expect(parseWorkspaceArrivalHandoff(locationFor(handoff, {
      pathname: "/app/customers/client-other"
    }))).toMatchObject({ ok: false, recovery: { code: "route_mismatch" } });
  });

  test("builds and parses supported state-only Library arrivals", () => {
    const browse = createWorkspaceArrivalHandoff(libraryInput());
    const contextualBrowse = createWorkspaceArrivalHandoff(libraryInput({
      focus: { sectionId: "overview", quoteId: "quote-42" }
    }));
    const section = createWorkspaceArrivalHandoff(libraryInput({
      object: { id: "templates", type: "library-section" },
      focus: { sectionId: "templates" },
      intentId: "review_library_section"
    }));
    const template = createWorkspaceArrivalHandoff(libraryInput({
      object: { id: "template-7", type: "event-template" },
      focus: { sectionId: "templates", recordId: "template-7" },
      intentId: "edit_event_template"
    }));

    expect(browse).toMatchObject({
      ok: true,
      contract: {
        destination: "library",
        routeId: "catalog",
        surfaceId: "ambient-library",
        focusTransport: "state_only",
        focusConsumerState: "supported",
        arrivalState: "focus_supported",
        object: {
          id: "organization-42",
          type: "organization-library",
          label: "Organization Library"
        },
        intentId: "browse_library",
        reasonId: "organization_library_selected",
        consequenceId: "library_remains_unchanged",
        intendedResolutionId: "browse_organization_library",
        focus: { sectionId: "overview" }
      },
      navigation: {
        path: "/app/catalog",
        primaryActionReady: true
      }
    });
    expect(section).toMatchObject({
      ok: true,
      contract: {
        object: { id: "templates", type: "library-section", label: "Library section" },
        intentId: "review_library_section",
        focus: { sectionId: "templates" }
      }
    });
    expect(contextualBrowse).toMatchObject({
      ok: true,
      contract: {
        destination: "library",
        focus: { sectionId: "overview", quoteId: "quote-42" }
      }
    });
    expect(template).toMatchObject({
      ok: true,
      contract: {
        object: { id: "template-7", type: "event-template", label: "Event template" },
        intentId: "edit_event_template",
        focus: { sectionId: "templates", recordId: "template-7" }
      }
    });
    expect([browse, contextualBrowse, section, template].map((handoff) => (
      parseWorkspaceArrivalHandoff(locationFor(handoff))
    ))).toEqual([browse, contextualBrowse, section, template]);
  });

  test("rejects mismatched Library intents, focus identities, and copied routes", () => {
    const wrongIntentObject = createWorkspaceArrivalHandoff(libraryInput({
      object: { id: "templates", type: "library-section" }
    }));
    const mismatchedSection = createWorkspaceArrivalHandoff(libraryInput({
      object: { id: "templates", type: "library-section" },
      focus: { sectionId: "packages" },
      intentId: "review_library_section"
    }));
    const missingRecord = createWorkspaceArrivalHandoff(libraryInput({
      object: { id: "template-7", type: "event-template" },
      focus: { sectionId: "templates" },
      intentId: "edit_event_template"
    }));
    const mismatchedRecord = createWorkspaceArrivalHandoff(libraryInput({
      object: { id: "template-7", type: "event-template" },
      focus: { sectionId: "templates", recordId: "template-other" },
      intentId: "edit_event_template"
    }));
    const browse = createWorkspaceArrivalHandoff(libraryInput());

    expect([wrongIntentObject, mismatchedSection, missingRecord, mismatchedRecord]
      .map((result) => result.recovery.code))
      .toEqual([
        "unsupported_combination",
        "unsupported_combination",
        "unsupported_combination",
        "unsupported_combination"
      ]);
    expect(parseWorkspaceArrivalHandoff(locationFor(browse, {
      pathname: "/app/imports"
    }))).toMatchObject({ ok: false, recovery: { code: "route_mismatch" } });
    expect(parseWorkspaceArrivalHandoff(locationFor(browse, {
      search: "?sectionId=overview"
    }))).toMatchObject({ ok: false, recovery: { code: "query_mismatch" } });
  });

  test("builds and parses a canonical exact Living Opportunity handoff", () => {
    const handoff = createWorkspaceArrivalHandoff(opportunityInput());

    expect(handoff).toMatchObject({
      ok: true,
      contract: {
        modelId: WORKSPACE_ARRIVAL_CONTRACT_MODEL,
        destination: "opportunity",
        routeId: "quote-detail",
        surfaceId: "living-opportunity",
        focusTransport: "state_only",
        focusConsumerState: "supported",
        arrivalState: "focus_supported",
        object: {
          id: "quote-42",
          type: "opportunity",
          label: "Opportunity"
        },
        intentId: "review_opportunity",
        reasonId: "exact_opportunity_selected",
        consequenceId: "opportunity_remains_unchanged",
        intendedResolutionId: "review_living_opportunity",
        focus: { quoteId: "quote-42" }
      },
      navigation: {
        path: "/app/quotes/quote-42",
        primaryActionReady: true
      }
    });
    expect(handoff.contract.consequence).toMatch(/changes no quote, pricing, customer, or operational evidence/i);
    expect(parseWorkspaceArrivalHandoff(locationFor(handoff))).toEqual(handoff);
  });

  test("builds quote-scoped Payment and Proposal administration arrivals", () => {
    const payment = createWorkspaceArrivalHandoff(administrationInput());
    const proposal = createWorkspaceArrivalHandoff(administrationInput({
      object: { id: "quote-42", type: "customer-decision-artifact" },
      intentId: "review_proposal_controls"
    }));

    expect(payment).toMatchObject({
      ok: true,
      contract: {
        destination: "administration",
        routeId: "quote-list",
        surfaceId: "quote-administration",
        object: { id: "quote-42", type: "payment-evidence", label: "Payment" },
        intentId: "review_payment_controls",
        focus: { quoteId: "quote-42" }
      },
      navigation: { path: "/app/quotes", primaryActionReady: true }
    });
    expect(proposal).toMatchObject({
      ok: true,
      contract: {
        object: { id: "quote-42", type: "customer-decision-artifact", label: "Proposal" },
        intentId: "review_proposal_controls"
      }
    });
    expect(parseWorkspaceArrivalHandoff(locationFor(payment))).toEqual(payment);
    expect(parseWorkspaceArrivalHandoff(locationFor(proposal))).toEqual(proposal);
  });

  test("rejects substituted administration records, objects, and routes", () => {
    const wrongQuote = createWorkspaceArrivalHandoff(administrationInput({
      object: { id: "quote-other", type: "payment-evidence" }
    }));
    const wrongIntent = createWorkspaceArrivalHandoff(administrationInput({
      object: { id: "quote-42", type: "customer-decision-artifact" }
    }));
    const payment = createWorkspaceArrivalHandoff(administrationInput());

    expect(wrongQuote).toMatchObject({ ok: false, recovery: { code: "unsupported_combination" } });
    expect(wrongIntent).toMatchObject({ ok: false, recovery: { code: "unsupported_combination" } });
    expect(parseWorkspaceArrivalHandoff(locationFor(payment, {
      pathname: "/app/quotes/quote-42"
    }))).toMatchObject({ ok: false, recovery: { code: "route_mismatch" } });
  });

  test("uses canonical proposal-gap semantics without carrying caller-authored prose", () => {
    const handoff = createWorkspaceArrivalHandoff(opportunityInput({
      intentId: "review_proposal_gap"
    }));

    expect(handoff).toMatchObject({
      ok: true,
      contract: {
        reasonId: "recorded_proposal_gap_selected",
        reason: "A recorded proposal gap was selected for review.",
        consequenceId: "proposal_gap_remains_open",
        intendedResolutionId: "review_proposal_gap_in_opportunity"
      },
      navigation: { path: "/app/quotes/quote-42", primaryActionReady: true }
    });
    expect(handoff.contract.consequence).toMatch(/does not stage, save, or send anything/i);
    expect(parseWorkspaceArrivalHandoff(locationFor(handoff))).toEqual(handoff);
  });

  test("rejects non-opportunity objects, mismatched quote focus, and copied opportunity state", () => {
    const unsupportedObject = createWorkspaceArrivalHandoff(opportunityInput({
      object: { id: "quote-42", type: "workflow-item" }
    }));
    const mismatchedFocus = createWorkspaceArrivalHandoff(opportunityInput({
      focus: { quoteId: "quote-other" }
    }));
    const extraFocus = createWorkspaceArrivalHandoff(opportunityInput({
      focus: { quoteId: "quote-42", requestId: "request-7" }
    }));
    const handoff = createWorkspaceArrivalHandoff(opportunityInput());

    expect(unsupportedObject).toMatchObject({
      ok: false,
      recovery: { code: "unsupported_object" }
    });
    expect(mismatchedFocus).toMatchObject({
      ok: false,
      recovery: { code: "unsupported_combination" }
    });
    expect(extraFocus).toMatchObject({
      ok: false,
      recovery: { code: "invalid_input" }
    });
    expect(parseWorkspaceArrivalHandoff(locationFor(handoff, {
      pathname: "/app/quotes/quote-other"
    }))).toMatchObject({ ok: false, recovery: { code: "route_mismatch" } });
    expect(parseWorkspaceArrivalHandoff(locationFor(handoff, {
      pathname: "/app/quotes/quote-42/edit"
    }))).toMatchObject({ ok: false, recovery: { code: "route_mismatch" } });
  });

  test("builds and parses a canonical exact Workflow handoff", () => {
    const handoff = createWorkspaceArrivalHandoff(workflowInput());

    expect(handoff).toMatchObject({
      ok: true,
      contract: {
        modelId: WORKSPACE_ARRIVAL_CONTRACT_MODEL,
        destination: "workflow",
        routeId: "workflow",
        surfaceId: "workflow",
        focusTransport: "query_and_state",
        focusConsumerState: "supported",
        arrivalState: "focus_supported",
        object: {
          id: "request-7",
          type: "workflow-item",
          label: "Workflow item"
        },
        intentId: "review_customer_request",
        reasonId: "recorded_customer_request_selected",
        consequenceId: "customer_request_remains_unresolved",
        intendedResolutionId: "review_customer_request_evidence"
      },
      navigation: {
        path: "/app/workflow?quoteId=quote-42&attentionType=change_request&requestId=request-7",
        primaryActionReady: true
      }
    });
    expect(handoff.contract.nextResolution).toBe(handoff.contract.intendedResolution);
    expect(Object.isFrozen(handoff)).toBe(true);
    expect(Object.isFrozen(handoff.navigation.state.ambientArrival.focus)).toBe(true);

    const parsed = parseWorkspaceArrivalHandoff(locationFor(handoff));
    expect(parsed).toEqual(handoff);
    expect(Object.isFrozen(parsed.contract.object)).toBe(true);
  });

  test("maps approval to an exact Workflow approval focus without executing it", () => {
    const handoff = createWorkspaceArrivalHandoff({
      destination: "approval",
      object: { id: "approval-9", type: "approval" },
      focus: { quoteId: "quote-42", requestId: "approval-9" },
      intentId: "review_approval"
    });

    expect(handoff.ok).toBe(true);
    expect(handoff.navigation.path).toBe(
      "/app/workflow?quoteId=quote-42&attentionType=approval&requestId=approval-9"
    );
    expect(handoff.contract).toMatchObject({
      destination: "approval",
      routeId: "workflow",
      surfaceId: "workflow",
      consequenceId: "approval_remains_pending",
      focus: {
        quoteId: "quote-42",
        attentionType: "approval",
        requestId: "approval-9"
      }
    });
    expect(handoff.contract.consequence).toMatch(/does not approve, reject, or execute/i);
    expect(parseWorkspaceArrivalHandoff(locationFor(handoff))).toEqual(handoff);
  });

  test.each([
    ["follow_up", "follow-up:quote-42"],
    ["post_event_closeout", "post-event-closeout:quote-42:blocked-source"]
  ])("accepts the canonical %s attention-item identity as a focus token", (attentionType, focusId) => {
    const handoff = createWorkspaceArrivalHandoff({
      destination: "workflow",
      object: { id: focusId, type: "workflow-item" },
      focus: { quoteId: "quote-42", attentionType, requestId: focusId },
      intentId: "review_follow_up"
    });

    expect(handoff).toMatchObject({
      ok: true,
      contract: {
        object: { id: focusId, type: "workflow-item" },
        focus: { quoteId: "quote-42", attentionType, requestId: focusId },
        consequenceId: "follow_up_remains_open"
      },
      navigation: { primaryActionReady: true }
    });
    expect(parseWorkspaceArrivalHandoff(locationFor(handoff))).toEqual(handoff);
  });

  test("uses calm decision-review wording without changing the Decision Debt intent contract", () => {
    const handoff = createWorkspaceArrivalHandoff({
      destination: "workflow",
      object: { id: "decision-42", type: "workflow-item" },
      focus: {
        quoteId: "quote-42",
        attentionType: "decision_debt",
        requestId: "decision-42"
      },
      intentId: "review_decision_debt"
    });

    expect(handoff).toMatchObject({
      ok: true,
      contract: {
        reasonId: "recorded_decision_debt_selected",
        reason: "A recorded quote decision was selected for review.",
        consequenceId: "decision_debt_remains_open",
        consequence: "The recorded decision remains open; navigation does not acknowledge or resolve it."
      }
    });
  });

  test("carries an exact customer reply in private history state while the URL identifies only its thread", () => {
    const handoff = createWorkspaceArrivalHandoff({
      destination: "messages",
      object: { id: "message-customer-7", type: "customer-communication-evidence" },
      focus: { quoteId: "quote-42", messageId: "message-customer-7" },
      intentId: "review_customer_reply"
    });

    expect(handoff.ok).toBe(true);
    expect(handoff.navigation).toMatchObject({
      path: "/app/messages?quoteId=quote-42",
      primaryActionReady: true
    });
    expect(handoff.contract).toMatchObject({
      surfaceId: "conversation",
      focusTransport: "query_and_state",
      focus: { quoteId: "quote-42", messageId: "message-customer-7" },
      reasonId: "customer_reply_thread_selected"
    });
    expect(handoff.navigation.path).not.toContain("message-customer-7");
    expect(handoff.navigation.state.ambientArrival.focus.messageId).toBe("message-customer-7");
    expect(handoff.contract.consequence).toMatch(/sends nothing and marks nothing read/i);
    expect(parseWorkspaceArrivalHandoff(locationFor(handoff))).toEqual(handoff);
  });

  test("preserves general conversation arrival without manufacturing a message focus", () => {
    const handoff = createWorkspaceArrivalHandoff({
      destination: "messages",
      object: { id: "quote-42", type: "opportunity" },
      focus: { quoteId: "quote-42" },
      intentId: "review_conversation"
    });

    expect(handoff).toMatchObject({
      ok: true,
      contract: {
        focus: { quoteId: "quote-42" },
        consequenceId: "conversation_remains_unchanged"
      },
      navigation: { path: "/app/messages?quoteId=quote-42" }
    });
    expect(handoff.contract.focus).not.toHaveProperty("messageId");
    expect(parseWorkspaceArrivalHandoff(locationFor(handoff))).toEqual(handoff);
  });

  test("preserves an exact quote-scoped Conversation object on a general thread arrival", () => {
    const handoff = createWorkspaceArrivalHandoff({
      destination: "messages",
      object: { id: "quote-42", type: "customer-communication-evidence" },
      focus: { quoteId: "quote-42" },
      intentId: "review_conversation"
    });

    expect(handoff).toMatchObject({
      ok: true,
      contract: {
        object: {
          id: "quote-42",
          type: "customer-communication-evidence",
          label: "Conversation"
        },
        focus: { quoteId: "quote-42" }
      }
    });
    expect(parseWorkspaceArrivalHandoff(locationFor(handoff))).toEqual(handoff);
  });

  test("requires a bounded exact reply identity and matching communication object", () => {
    const missingMessage = createWorkspaceArrivalHandoff({
      destination: "messages",
      object: { id: "message-customer-7", type: "customer-communication-evidence" },
      focus: { quoteId: "quote-42" },
      intentId: "review_customer_reply"
    });
    const mismatchedObject = createWorkspaceArrivalHandoff({
      destination: "messages",
      object: { id: "message-other", type: "customer-communication-evidence" },
      focus: { quoteId: "quote-42", messageId: "message-customer-7" },
      intentId: "review_customer_reply"
    });
    const unsafeMessage = createWorkspaceArrivalHandoff({
      destination: "messages",
      object: { id: "message/customer/7", type: "customer-communication-evidence" },
      focus: { quoteId: "quote-42", messageId: "message/customer/7" },
      intentId: "review_customer_reply"
    });
    const messageOnGeneralArrival = createWorkspaceArrivalHandoff({
      destination: "messages",
      object: { id: "quote-42", type: "opportunity" },
      focus: { quoteId: "quote-42", messageId: "message-customer-7" },
      intentId: "review_conversation"
    });

    expect(missingMessage).toMatchObject({ ok: false, recovery: { code: "unsafe_identifier" } });
    expect(mismatchedObject).toMatchObject({ ok: false, recovery: { code: "unsupported_combination" } });
    expect(unsafeMessage).toMatchObject({ ok: false, recovery: { code: "unsafe_identifier" } });
    expect(messageOnGeneralArrival).toMatchObject({ ok: false, recovery: { code: "invalid_input" } });
  });

  test("makes exact Schedule opportunity focus primary-ready while keeping staffing unsupported", () => {
    const schedule = createWorkspaceArrivalHandoff({
      destination: "schedule",
      object: { id: "quote-42", type: "opportunity" },
      focus: { quoteId: "quote-42" },
      intentId: "review_event_schedule"
    });
    const reportingWithoutSignal = createWorkspaceArrivalHandoff({
      destination: "reporting",
      object: { id: "pipeline-summary", type: "report-signal" },
      focus: { reportScope: "pipeline" },
      intentId: "review_pipeline_report"
    });

    expect(schedule).toMatchObject({
      ok: true,
      navigation: { path: "/app/schedule", primaryActionReady: true },
      contract: {
        focusTransport: "state_only",
        focusConsumerState: "supported",
        arrivalState: "focus_supported"
      }
    });
    expect(parseWorkspaceArrivalHandoff(locationFor(schedule))).toEqual(schedule);

    const staffing = createWorkspaceArrivalHandoff({
      destination: "schedule",
      object: { id: "staffing", type: "intelligent-object" },
      focus: { quoteId: "quote-42" },
      intentId: "review_staffing_schedule"
    });
    expect(staffing).toMatchObject({
      ok: true,
      navigation: { primaryActionReady: false },
      contract: {
        focusConsumerState: "pending",
        arrivalState: "context_carried_consumer_pending"
      }
    });
    expect(staffing.contract.consequence).toMatch(/cannot verify authoritative operational staffing/i);

    const mismatchedScheduleItem = createWorkspaceArrivalHandoff({
      destination: "schedule",
      object: { id: "quote-other", type: "schedule-item" },
      focus: { quoteId: "quote-42" },
      intentId: "review_schedule_conflict"
    });
    expect(mismatchedScheduleItem).toMatchObject({
      ok: false,
      recovery: { code: "unsupported_combination" }
    });

    expect(reportingWithoutSignal).toMatchObject({
      ok: true,
      navigation: { path: "/app/reporting", primaryActionReady: true },
      contract: {
        focusTransport: "state_only",
        focusConsumerState: "supported",
        arrivalState: "focus_supported",
        focus: {
          reportScope: "pipeline",
          quoteId: "",
          reportSignal: "pipeline-summary"
        }
      }
    });
    expect(parseWorkspaceArrivalHandoff(locationFor(reportingWithoutSignal)))
      .toEqual(reportingWithoutSignal);

    const legacyStateWithoutSignal = mutableState(reportingWithoutSignal);
    delete legacyStateWithoutSignal.ambientArrival.focus.reportSignal;
    expect(parseWorkspaceArrivalHandoff(locationFor(reportingWithoutSignal, {
      state: legacyStateWithoutSignal
    }))).toEqual(reportingWithoutSignal);

    const reportingWithSignal = createWorkspaceArrivalHandoff({
      destination: "reporting",
      object: { id: "pipeline-summary", type: "report-signal" },
      focus: { reportScope: "pipeline", reportSignal: "pipeline-summary" },
      intentId: "review_pipeline_report"
    });
    expect(reportingWithSignal).toMatchObject({
      ok: true,
      navigation: { primaryActionReady: true },
      contract: {
        focus: {
          reportScope: "pipeline",
          quoteId: "",
          reportSignal: "pipeline-summary"
        }
      }
    });
    expect(parseWorkspaceArrivalHandoff(locationFor(reportingWithSignal)))
      .toEqual(reportingWithSignal);

    const unsupportedReportingObject = createWorkspaceArrivalHandoff({
      destination: "reporting",
      object: { id: "commercial-4", type: "commercial-evidence" },
      focus: { reportScope: "pipeline", reportSignal: "pipeline-summary" },
      intentId: "review_pipeline_report"
    });
    expect(unsupportedReportingObject).toMatchObject({
      ok: true,
      navigation: { primaryActionReady: false },
      contract: {
        focusConsumerState: "pending",
        arrivalState: "context_carried_consumer_pending"
      }
    });

    const arbitrarySignal = createWorkspaceArrivalHandoff({
      destination: "reporting",
      object: { id: "margin-signal-4", type: "report-signal" },
      focus: { reportScope: "pipeline", reportSignal: "arbitrary-signal" },
      intentId: "review_pipeline_report"
    });
    expect(arbitrarySignal).toMatchObject({
      ok: false,
      recovery: { code: "unsupported_combination" }
    });
  });

  test("requires supported destination, object, intent, focus, and object-id combinations", () => {
    const cases = [
      createWorkspaceArrivalHandoff(workflowInput({ destination: "generic-page" })),
      createWorkspaceArrivalHandoff(workflowInput({
        destination: "messages",
        object: { id: "request-7", type: "workflow-item" },
        focus: { quoteId: "quote-42" },
        intentId: "review_conversation"
      })),
      createWorkspaceArrivalHandoff(workflowInput({ intentId: "not-an-intent" })),
      createWorkspaceArrivalHandoff(workflowInput({
        focus: {
          quoteId: "quote-42",
          attentionType: "follow_up",
          requestId: "request-7"
        }
      })),
      createWorkspaceArrivalHandoff({
        destination: "schedule",
        object: { id: "quote-other", type: "opportunity" },
        focus: { quoteId: "quote-42" },
        intentId: "review_event_schedule"
      }),
      createWorkspaceArrivalHandoff({
        destination: "reporting",
        object: { id: "signal-1", type: "report-signal" },
        focus: { reportScope: "operations" },
        intentId: "review_pipeline_report"
      })
    ];

    expect(cases.map((result) => result.ok)).toEqual([false, false, false, false, false, false]);
    expect(cases.map((result) => result.recovery.code)).toEqual([
      "unsupported_destination",
      "unsupported_object",
      "unsupported_intent",
      "unsupported_combination",
      "unsupported_combination",
      "unsupported_combination"
    ]);
  });

  test("rejects email-like, secret-like, path-bearing, or caller-authored display content", () => {
    const email = createWorkspaceArrivalHandoff(workflowInput({
      focus: {
        quoteId: "client@example.com",
        attentionType: "change_request",
        requestId: "request-7"
      }
    }));
    const secret = createWorkspaceArrivalHandoff(workflowInput({
      focus: {
        quoteId: "sk-live-secretvalue",
        attentionType: "change_request",
        requestId: "request-7"
      }
    }));
    const path = createWorkspaceArrivalHandoff(workflowInput({
      object: { id: "request/7", type: "workflow-item" }
    }));
    const prose = createWorkspaceArrivalHandoff({
      ...workflowInput(),
      reason: "Customer private details",
      object: {
        id: "request-7",
        type: "workflow-item",
        label: "Smith Wedding"
      }
    });

    expect([email, secret, path].map((result) => result.recovery.code))
      .toEqual(["unsafe_identifier", "unsafe_identifier", "unsafe_identifier"]);
    expect(prose).toMatchObject({ ok: false, recovery: { code: "invalid_input" } });
    expect(JSON.stringify(createWorkspaceArrivalHandoff(workflowInput())))
      .not.toContain("Smith Wedding");
  });

  test("rejects portal queries, route mismatch, focus mismatch, and extra query data", () => {
    const handoff = createWorkspaceArrivalHandoff(workflowInput());
    const state = handoff.navigation.state;

    expect(parseWorkspaceArrivalHandoff(locationFor(handoff, {
      search: "?portal=portal-token"
    }))).toMatchObject({ ok: false, recovery: { code: "portal_context" } });
    expect(parseWorkspaceArrivalHandoff(locationFor(handoff, {
      pathname: "/app/messages"
    }))).toMatchObject({ ok: false, recovery: { code: "route_mismatch" } });
    expect(parseWorkspaceArrivalHandoff({
      pathname: "/app/workflow",
      search: "?quoteId=quote-other&attentionType=change_request&requestId=request-7",
      hash: "",
      state
    })).toMatchObject({ ok: false, recovery: { code: "query_mismatch" } });
    expect(parseWorkspaceArrivalHandoff(locationFor(handoff, {
      search: `${new URL(handoff.navigation.path, "https://quotepilot.local").search}&customerName=Private`
    }))).toMatchObject({ ok: false, recovery: { code: "query_mismatch" } });
  });

  test("rejects extra state, altered canonical text, and state copied to another semantic route", () => {
    const handoff = createWorkspaceArrivalHandoff(workflowInput());
    const extraState = {
      ...mutableState(handoff),
      customerMessage: "Private message content"
    };
    const alteredState = mutableState(handoff);
    alteredState.ambientArrival.reason = "A caller-authored reason.";

    expect(parseWorkspaceArrivalHandoff(locationFor(handoff, { state: extraState })))
      .toMatchObject({ ok: false, recovery: { code: "unexpected_state" } });
    expect(parseWorkspaceArrivalHandoff(locationFor(handoff, { state: alteredState })))
      .toMatchObject({ ok: false, recovery: { code: "contract_mismatch" } });

    const messages = createWorkspaceArrivalHandoff({
      destination: "messages",
      object: { id: "quote-42", type: "opportunity" },
      focus: { quoteId: "quote-42" },
      intentId: "review_conversation"
    });
    expect(parseWorkspaceArrivalHandoff(locationFor(messages, {
      state: handoff.navigation.state
    }))).toMatchObject({ ok: false, recovery: { code: "route_mismatch" } });
  });

  test("bounds serialized state and rejects cyclic or malformed caller data without throwing", () => {
    const handoff = createWorkspaceArrivalHandoff(workflowInput());
    const oversized = {
      ambientArrival: {
        ...mutableState(handoff).ambientArrival,
        padding: "x".repeat(5000)
      }
    };
    const cyclic = { ambientArrival: {} };
    cyclic.ambientArrival.self = cyclic;

    const oversizedResult = parseWorkspaceArrivalHandoff(locationFor(handoff, { state: oversized }));
    expect(oversizedResult).toMatchObject({ ok: false, recovery: { code: "oversized_state" } });
    expect(Object.isFrozen(oversizedResult.recovery)).toBe(true);

    expect(() => parseWorkspaceArrivalHandoff(locationFor(handoff, { state: cyclic }))).not.toThrow();
    expect(parseWorkspaceArrivalHandoff(locationFor(handoff, { state: cyclic })))
      .toMatchObject({ ok: false, recovery: { code: "unexpected_state" } });
    expect(() => createWorkspaceArrivalHandoff(null)).not.toThrow();
    expect(createWorkspaceArrivalHandoff(null)).toMatchObject({
      ok: false,
      recovery: { code: "invalid_input" }
    });
  });

  test("rejects hashes and duplicate focus parameters instead of accepting hidden context", () => {
    const handoff = createWorkspaceArrivalHandoff(workflowInput());
    const url = new URL(handoff.navigation.path, "https://quotepilot.local");

    expect(parseWorkspaceArrivalHandoff(locationFor(handoff, { hash: "#private" })))
      .toMatchObject({ ok: false, recovery: { code: "query_mismatch" } });
    expect(parseWorkspaceArrivalHandoff(locationFor(handoff, {
      search: `${url.search}&quoteId=quote-42`
    }))).toMatchObject({ ok: false, recovery: { code: "query_mismatch" } });
  });
});
