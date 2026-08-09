import { createRequire } from "node:module";
import { describe, expect, test, vi } from "vitest";

const require = createRequire(import.meta.url);
const core = require("../../../functions/revenueAutopilot.js");
const templatesApi = require("../../../functions/revenueAutopilotTemplates.js");
const {
  REVENUE_AUTOPILOT_AUTHORITY_PROOF_BOUNDARIES,
  RevenueAutopilotAuthorityError,
  buildRevenueAutopilotConversationEvidence,
  buildRevenueAutopilotMaterializationInput,
  buildRevenueAutopilotRecipientKey,
  hashRevenueAutopilotUnsubscribeToken,
  normalizeRevenueAutopilotEmailControls,
  normalizeRevenueAutopilotStaffAcknowledgementRequest,
  normalizeRevenueAutopilotTemplateSet,
  normalizeRevenueAutopilotTenantPolicy,
  planRevenueAutopilotAdminConfiguration,
  planRevenueAutopilotEmailControlUpdate,
  planRevenueAutopilotMaterializationFromCanonical,
  planRevenueAutopilotStaffAcknowledgementReceipt,
  projectRevenueAutopilotAuthorityForStaff,
  verifyRevenueAutopilotUnsubscribeToken
} = require("../../../functions/revenueAutopilotAuthority.js");

const ORGANIZATION_ID = "org_demo";
const CUSTOMER_ID = "customer_henderson";
const QUOTE_ID = "quote_1001";
const VERSION_ID = "v0004";
const PORTAL_ISSUED_AT = "2026-08-09T14:00:00.000Z";
const REVISION_ID = `${VERSION_ID}@${PORTAL_ISSUED_AT}`;
const PROVIDER_ACCEPTED_AT = "2026-08-09T14:00:10.000Z";
const NOW = "2026-08-09T15:00:00.000Z";
const SECRET = "authority-test-secret-that-is-longer-than-thirty-two-bytes";

function template(kind, version = "v1") {
  if (kind === "quote_follow_up") {
    return {
      templateId: "quote-follow-up",
      version,
      kind,
      subject: "A quick note about {{quote_number}}",
      text: "Hi {{customer_name}}, {{business_name}} sent {{quote_number}}. Review {{portal_url}}. Stop {{unsubscribe_url}}.",
      html: "<p>Hi {{customer_name}}, {{business_name}} sent {{quote_number}}.</p><p><a href=\"{{portal_url}}\">Review</a> <a href=\"{{unsubscribe_url}}\">Stop</a></p>"
    };
  }
  if (kind === "deposit_reminder") {
    return {
      templateId: "deposit-reminder",
      version,
      kind,
      subject: "Deposit for {{quote_number}}",
      text: "Hi {{customer_name}}, {{business_name}} needs {{deposit_amount}} for {{quote_number}}. Pay {{portal_url}}. Stop {{unsubscribe_url}}.",
      html: "<p>Hi {{customer_name}}, {{business_name}} needs {{deposit_amount}} for {{quote_number}}.</p><p><a href=\"{{portal_url}}\">Pay</a> <a href=\"{{unsubscribe_url}}\">Stop</a></p>"
    };
  }
  if (kind === "post_event_review_request") {
    return {
      templateId: "post-event-review-request",
      version,
      kind,
      subject: "Thank you from {{business_name}}",
      text: "Hi {{customer_name}}, thank you for trusting {{business_name}} with your {{event_date}} event. Review us at {{review_url}}. Stop {{unsubscribe_url}}.",
      html: "<p>Hi {{customer_name}},</p><p>Thank you for trusting {{business_name}} with your {{event_date}} event.</p><p><a href=\"{{review_url}}\">Review us</a> <a href=\"{{unsubscribe_url}}\">Stop</a></p>"
    };
  }
  return {
    templateId: "final-balance-reminder",
    version,
    kind,
    subject: "Final balance for {{quote_number}}",
    text: "Hi {{customer_name}}, {{business_name}} needs {{final_balance_amount}} for {{event_date}} on {{quote_number}}. Pay {{portal_url}}. Stop {{unsubscribe_url}}.",
    html: "<p>Hi {{customer_name}}, {{business_name}} needs {{final_balance_amount}} for {{event_date}} on {{quote_number}}.</p><p><a href=\"{{portal_url}}\">Pay</a> <a href=\"{{unsubscribe_url}}\">Stop</a></p>"
  };
}

function templateSet(version = "v1") {
  return {
    quote_follow_up: template("quote_follow_up", version),
    deposit_reminder: template("deposit_reminder", version),
    final_balance_reminder: template("final_balance_reminder", version)
  };
}

function templateSetWithPostEvent(version = "v1") {
  return {
    ...templateSet(version),
    post_event_review_request: template("post_event_review_request", version)
  };
}

function kindPolicy() {
  return {
    quote_follow_up: { enabled: true, dayOffsets: [2, 5] },
    deposit_reminder: { enabled: true, dayOffsets: [1, 3] },
    final_balance_reminder: { enabled: true, dayOffsets: [14, 7, 3] },
    unread_customer_reply: { enabled: true }
  };
}

function kindPolicyWithPostEvent(enabled = true) {
  return {
    ...kindPolicy(),
    post_event_review_request: { enabled }
  };
}

function configurationRequest(overrides = {}) {
  return {
    organizationId: ORGANIZATION_ID,
    requestId: "configure-1",
    expectedRevision: 0,
    enabled: true,
    timeZone: "America/Chicago",
    quietHours: { enabled: false, start: "21:00", end: "08:00" },
    maxAttempts: 3,
    kinds: kindPolicy(),
    templates: templateSet(),
    ...overrides
  };
}

function admin(overrides = {}) {
  return { uid: "admin-1", role: "admin", organizationId: ORGANIZATION_ID, ...overrides };
}

function configuredPolicy() {
  return planRevenueAutopilotAdminConfiguration({
    request: configurationRequest(),
    currentPolicy: null,
    actor: admin(),
    nowISO: NOW
  }).policy;
}

function configuredPostEventPolicy() {
  return planRevenueAutopilotAdminConfiguration({
    request: configurationRequest({
      kinds: kindPolicyWithPostEvent(),
      templates: templateSetWithPostEvent(),
      reviewRequestUrl: "https://reviews.example.test/tenant/henderson"
    }),
    currentPolicy: null,
    actor: admin(),
    nowISO: NOW
  }).policy;
}

function customer(overrides = {}) {
  return {
    id: CUSTOMER_ID,
    organizationId: ORGANIZATION_ID,
    normalizedEmail: "alex@henderson.example",
    ...overrides
  };
}

function configuredControls() {
  return planRevenueAutopilotEmailControlUpdate({
    request: {
      organizationId: ORGANIZATION_ID,
      customerId: CUSTOMER_ID,
      requestId: "controls-1",
      expectedRevision: 0,
      consentState: "granted",
      subscriptionState: "subscribed"
    },
    currentControls: null,
    customer: customer(),
    actor: admin(),
    nowISO: "2026-08-09T14:30:00.000Z",
    secret: SECRET
  }).controls;
}

function quoteFor(state, stateAtISO, overrides = {}) {
  return {
    id: QUOTE_ID,
    organizationId: ORGANIZATION_ID,
    customerId: CUSTOMER_ID,
    activeVersionId: VERSION_ID,
    status: state,
    event: { date: "2026-09-01" },
    lifecycle: {
      sentAtISO: PROVIDER_ACCEPTED_AT,
      ...(state === "viewed" ? { viewedAtISO: stateAtISO } : {}),
      ...(["accepted", "booked"].includes(state)
        ? { acceptedAtISO: "2026-08-10T16:00:00.000Z" }
        : {}),
      ...(state === "booked" ? { bookedAtISO: stateAtISO } : {}),
      ...(state === "declined" ? { declinedAtISO: stateAtISO } : {})
    },
    workflow: {
      quoteDelivery: {
        state: "provider_accepted",
        revisionId: REVISION_ID,
        portalIssuedAtISO: PORTAL_ISSUED_AT,
        providerAcceptedAtISO: PROVIDER_ACCEPTED_AT,
        providerMessageId: "provider-message-1"
      }
    },
    ...overrides
  };
}

function portalFor(state, stateAtISO, overrides = {}) {
  return {
    source: "customer_portal_projection",
    organizationId: ORGANIZATION_ID,
    quoteId: QUOTE_ID,
    revisionId: REVISION_ID,
    portalIssuedAtISO: PORTAL_ISSUED_AT,
    state,
    stateAtISO,
    ...(["accepted", "booked"].includes(state)
      ? { acceptedAtISO: "2026-08-10T16:00:00.000Z" }
      : {}),
    ...overrides
  };
}

function acceptance(overrides = {}) {
  return {
    source: "proposal_acceptance_receipt",
    organizationId: ORGANIZATION_ID,
    quoteId: QUOTE_ID,
    quoteRevisionId: REVISION_ID,
    receiptId: "acceptance-receipt-1",
    acceptedAtISO: "2026-08-10T16:00:00.000Z",
    ...overrides
  };
}

function deposit(state = "unpaid", overrides = {}) {
  return {
    source: "verified_provider_webhooks",
    organizationId: ORGANIZATION_ID,
    quoteId: QUOTE_ID,
    bounded: true,
    observedAtISO: NOW,
    state,
    ...(state === "unpaid" ? {} : {
      signatureVerified: true,
      processingState: "processed",
      providerReference: "stripe-session-deposit-1",
      processedAtISO: "2026-08-11T16:05:00.000Z"
    }),
    ...overrides
  };
}

function finalBalance(state = "unpaid", overrides = {}) {
  return {
    source: "canonical_payment_ledger",
    organizationId: ORGANIZATION_ID,
    quoteId: QUOTE_ID,
    operationId: "final-operation-1",
    observedAtISO: NOW,
    state,
    ...(["paid", "refunded"].includes(state) ? {
      providerReference: "stripe-session-final-1",
      providerSettledAtISO: "2026-08-20T16:00:00.000Z"
    } : {}),
    ...overrides
  };
}

function deliveryAuthority() {
  const controls = configuredControls();
  return {
    policy: configuredPolicy(),
    emailControls: controls,
    provider: {
      organizationId: ORGANIZATION_ID,
      evidenceId: "provider-evidence-1",
      providerId: "resend",
      configurationId: "provider-config-1",
      state: "configured",
      evaluatedAtISO: NOW,
      apiKey: "must-not-project"
    },
    suppression: {
      organizationId: ORGANIZATION_ID,
      customerId: CUSTOMER_ID,
      recipientKey: controls.recipientKey,
      evidenceId: "suppression-evidence-1",
      state: "clear",
      evaluatedAtISO: NOW,
      providerReference: "must-not-project"
    },
    global: { enabled: true, sendsEnabled: true },
    existingJobs: []
  };
}

function completedPostEventCloseout(overrides = {}) {
  const reviewedAtISO = "2026-09-08T14:30:00.000Z";
  const reviewItems = Object.fromEntries([
    "internal_closeout",
    "thank_you",
    "review_request",
    "operational_follow_up"
  ].map((code) => [code, {
    state: "reviewed",
    reviewedAtISO,
    reviewedBy: { uid: "sales-1", email: "sales@example.com", role: "sales" },
    lastActionReceiptId: `receipt-${code}`
  }]));
  return {
    schemaVersion: 1,
    closeoutId: "closeout_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    organizationId: ORGANIZATION_ID,
    quoteId: QUOTE_ID,
    customerId: CUSTOMER_ID,
    sourceVersionId: VERSION_ID,
    acceptanceReceiptId: "acceptance-receipt-1",
    sourceAcceptedAtISO: "2026-08-10T16:00:00.000Z",
    sourcePortalIssuedAtISO: PORTAL_ISSUED_AT,
    sourceBookedAtISO: "2026-08-12T16:00:00.000Z",
    eventDate: "2026-09-01",
    dueDate: "2026-09-08",
    policy: {
      version: 1,
      state: "configured",
      source: "organization_settings",
      timeZone: "America/Chicago",
      dueBoundary: "tenant_calendar_date",
      offsetDays: 7,
      blockedReason: ""
    },
    state: "completed",
    reviewItems,
    completedAtISO: reviewedAtISO,
    completedBy: { uid: "sales-1", email: "sales@example.com", role: "sales" },
    createdAtISO: "2026-08-12T16:00:00.000Z",
    updatedAtISO: reviewedAtISO,
    ...overrides
  };
}

function pendingPostEventCloseout(overrides = {}) {
  const completed = completedPostEventCloseout();
  return {
    ...completed,
    state: "pending",
    reviewItems: Object.fromEntries(Object.keys(completed.reviewItems).map((code) => [code, {
      state: "pending",
      reviewedAtISO: "",
      reviewedBy: null,
      lastActionReceiptId: ""
    }])),
    completedAtISO: "",
    completedBy: null,
    updatedAtISO: "2026-09-08T14:45:00.000Z",
    ...overrides
  };
}

describe("Revenue Autopilot authority configuration", () => {
  test("normalizes missing and legacy tenant records to an immutable dormant policy", () => {
    const missing = normalizeRevenueAutopilotTenantPolicy(null);
    const legacy = normalizeRevenueAutopilotTenantPolicy({
      organizationId: ORGANIZATION_ID,
      automationEnabled: true,
      followUpsEnabled: true
    });

    expect(missing).toMatchObject({
      authorityState: "unconfigured",
      enabled: false,
      revision: 0
    });
    expect(Object.values(missing.kinds).every((lane) => lane.enabled === false)).toBe(true);
    expect(legacy).toMatchObject({
      organizationId: ORGANIZATION_ID,
      authorityState: "legacy_blocked",
      enabled: false
    });
    expect(Object.isFrozen(legacy.kinds)).toBe(true);
  });

  test("requires exactly one strict compiled template for every outbound kind", () => {
    const compiled = normalizeRevenueAutopilotTemplateSet(templateSet());

    expect(Object.keys(compiled).sort()).toEqual([
      "deposit_reminder",
      "final_balance_reminder",
      "quote_follow_up"
    ]);
    expect(compiled.quote_follow_up.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(() => normalizeRevenueAutopilotTemplateSet({
      quote_follow_up: template("quote_follow_up"),
      deposit_reminder: template("deposit_reminder")
    })).toThrowError(/exactly three/i);
    expect(() => normalizeRevenueAutopilotTemplateSet([
      template("quote_follow_up"),
      template("quote_follow_up", "v2"),
      template("final_balance_reminder")
    ])).toThrowError(/duplicated/i);
    expect(() => normalizeRevenueAutopilotTemplateSet({
      ...templateSet(),
      quote_follow_up: { ...template("quote_follow_up"), html: "<script>alert(1)</script>" }
    })).toThrowError(/unsupported active content/i);
  });

  test("keeps the new post-event lane dormant for legacy policy forms and requires its own template when enabled", () => {
    const legacyCompatible = configuredPolicy();
    const enabled = configuredPostEventPolicy();

    expect(legacyCompatible.kinds.post_event_review_request).toEqual({ enabled: false });
    expect(legacyCompatible.templates).not.toHaveProperty("post_event_review_request");
    expect(enabled.kinds.post_event_review_request).toEqual({ enabled: true });
    expect(enabled.reviewRequestUrl).toBe("https://reviews.example.test/tenant/henderson");
    expect(enabled.templates.post_event_review_request).toEqual(expect.objectContaining({
      kind: "post_event_review_request",
      templateId: "post-event-review-request"
    }));
    expect(() => planRevenueAutopilotAdminConfiguration({
      request: configurationRequest({
        kinds: kindPolicyWithPostEvent(),
        templates: templateSet(),
        reviewRequestUrl: "https://reviews.example.test/tenant/henderson"
      }),
      currentPolicy: null,
      actor: admin(),
      nowISO: NOW
    })).toThrowError(/post-event review email.*template/i);
    expect(() => planRevenueAutopilotAdminConfiguration({
      request: configurationRequest({
        kinds: kindPolicyWithPostEvent(),
        templates: templateSetWithPostEvent(),
        reviewRequestUrl: ""
      }),
      currentPolicy: null,
      actor: admin(),
      nowISO: NOW
    })).toThrowError(/valid HTTPS review URL/i);
    expect(() => planRevenueAutopilotAdminConfiguration({
      request: configurationRequest({
        kinds: kindPolicyWithPostEvent(),
        templates: templateSetWithPostEvent(),
        reviewRequestUrl: "http://localhost:8080/review#forged"
      }),
      currentPolicy: null,
      actor: admin(),
      nowISO: NOW
    })).toThrowError(/public HTTPS review URL/i);
  });

  test("plans an admin-only same-tenant revision-safe policy mutation and exact replay", () => {
    const first = planRevenueAutopilotAdminConfiguration({
      request: configurationRequest(),
      currentPolicy: null,
      actor: admin(),
      nowISO: NOW
    });
    const replay = planRevenueAutopilotAdminConfiguration({
      request: configurationRequest(),
      currentPolicy: first.policy,
      actor: admin(),
      nowISO: "2026-08-09T16:00:00.000Z"
    });

    expect(first).toMatchObject({ idempotent: false, policy: {
      authorityState: "configured",
      revision: 1,
      enabled: true,
      configuredBy: "admin-1",
      configuredAtISO: NOW
    } });
    expect(replay.idempotent).toBe(true);
    expect(replay.policy).toEqual(first.policy);
  });

  test("rejects browser actor/time/provider/payment authority, cross-tenant actors, and revision collisions", () => {
    expect(() => planRevenueAutopilotAdminConfiguration({
      request: configurationRequest({ actor: admin() }),
      currentPolicy: null,
      actor: admin(),
      nowISO: NOW
    })).toThrowError(/browser-authority fields.*actor/i);
    expect(() => planRevenueAutopilotAdminConfiguration({
      request: configurationRequest({ providerId: "resend" }),
      currentPolicy: null,
      actor: admin(),
      nowISO: NOW
    })).toThrowError(/providerId/i);
    expect(() => planRevenueAutopilotAdminConfiguration({
      request: configurationRequest(),
      currentPolicy: null,
      actor: admin({ organizationId: "org_other" }),
      nowISO: NOW
    })).toThrowError(/outside the requested organization/i);
    expect(() => planRevenueAutopilotAdminConfiguration({
      request: configurationRequest({ expectedRevision: 4 }),
      currentPolicy: null,
      actor: admin(),
      nowISO: NOW
    })).toThrowError(/changed after/i);
  });

  test("rejects reused request IDs with changed intent and template-version content collisions", () => {
    const first = planRevenueAutopilotAdminConfiguration({
      request: configurationRequest(),
      currentPolicy: null,
      actor: admin(),
      nowISO: NOW
    });
    expect(() => planRevenueAutopilotAdminConfiguration({
      request: configurationRequest({ enabled: false }),
      currentPolicy: first.policy,
      actor: admin(),
      nowISO: NOW
    })).toThrowError(/reused with different content/i);

    const changed = templateSet();
    changed.quote_follow_up = {
      ...changed.quote_follow_up,
      subject: "Changed subject for {{quote_number}}"
    };
    expect(() => planRevenueAutopilotAdminConfiguration({
      request: configurationRequest({
        requestId: "configure-2",
        expectedRevision: 1,
        templates: changed
      }),
      currentPolicy: first.policy,
      actor: admin(),
      nowISO: NOW
    })).toThrowError(/without a new template version/i);
  });
});

describe("Revenue Autopilot recipient authority", () => {
  test("derives scoped opaque recipient keys and unsubscribe hashes without persisting raw values", () => {
    const recipientKey = buildRevenueAutopilotRecipientKey({
      organizationId: ORGANIZATION_ID,
      customerId: CUSTOMER_ID,
      normalizedEmail: "Alex@Henderson.Example",
      secret: SECRET
    });
    const token = "A".repeat(43);
    const storedHash = hashRevenueAutopilotUnsubscribeToken({
      token,
      organizationId: ORGANIZATION_ID,
      customerId: CUSTOMER_ID,
      secret: SECRET
    });

    expect(recipientKey).toMatch(/^rar_[a-f0-9]{64}$/);
    expect(recipientKey).not.toContain("henderson");
    expect(storedHash).toMatch(/^rau_[a-f0-9]{64}$/);
    expect(storedHash).not.toContain(token);
    expect(verifyRevenueAutopilotUnsubscribeToken({
      token,
      storedHash,
      organizationId: ORGANIZATION_ID,
      customerId: CUSTOMER_ID,
      secret: SECRET
    })).toBe(true);
    expect(verifyRevenueAutopilotUnsubscribeToken({
      token,
      storedHash,
      organizationId: "org_other",
      customerId: CUSTOMER_ID,
      secret: SECRET
    })).toBe(false);
  });

  test("plans explicit admin consent/subscription controls with server-owned actor and time", () => {
    const result = planRevenueAutopilotEmailControlUpdate({
      request: {
        organizationId: ORGANIZATION_ID,
        customerId: CUSTOMER_ID,
        requestId: "controls-1",
        expectedRevision: 0,
        consentState: "granted",
        subscriptionState: "subscribed"
      },
      currentControls: null,
      customer: customer(),
      actor: admin(),
      nowISO: NOW,
      secret: SECRET
    });

    expect(result).toMatchObject({ idempotent: false, controls: {
      organizationId: ORGANIZATION_ID,
      customerId: CUSTOMER_ID,
      authorityState: "configured",
      revision: 1,
      consent: { state: "granted", recordedAtISO: NOW },
      subscription: { state: "subscribed", recordedAtISO: NOW }
    } });
    expect(result.receipt.recordedBy).toBe("admin-1");
    expect(result.controls).not.toHaveProperty("normalizedEmail");
  });

  test("keeps missing controls blocked and rejects browser timestamps, contradictory consent, and collisions", () => {
    const dormant = normalizeRevenueAutopilotEmailControls(null, {
      organizationId: ORGANIZATION_ID,
      customerId: CUSTOMER_ID
    });
    expect(dormant).toMatchObject({
      authorityState: "unconfigured",
      consent: { state: "unknown" },
      subscription: { state: "unknown" }
    });
    expect(normalizeRevenueAutopilotEmailControls(dormant, {
      organizationId: ORGANIZATION_ID,
      customerId: CUSTOMER_ID
    })).toEqual(dormant);
    const baseRequest = {
      organizationId: ORGANIZATION_ID,
      customerId: CUSTOMER_ID,
      requestId: "controls-2",
      expectedRevision: 0,
      consentState: "granted",
      subscriptionState: "subscribed"
    };
    expect(() => planRevenueAutopilotEmailControlUpdate({
      request: { ...baseRequest, recordedAtISO: NOW },
      customer: customer(),
      actor: admin(),
      nowISO: NOW,
      secret: SECRET
    })).toThrowError(/recordedAtISO/i);
    expect(() => planRevenueAutopilotEmailControlUpdate({
      request: { ...baseRequest, consentState: "revoked" },
      customer: customer(),
      actor: admin(),
      nowISO: NOW,
      secret: SECRET
    })).toThrowError(/cannot remain subscribed/i);
    expect(() => planRevenueAutopilotEmailControlUpdate({
      request: baseRequest,
      customer: customer({ organizationId: "org_other" }),
      actor: admin(),
      nowISO: NOW,
      secret: SECRET
    })).toThrowError(/outside the requested/i);
  });

  test("fails closed when an email change would silently migrate existing consent", () => {
    expect(() => planRevenueAutopilotEmailControlUpdate({
      request: {
        organizationId: ORGANIZATION_ID,
        customerId: CUSTOMER_ID,
        requestId: "controls-email-change",
        expectedRevision: 1,
        consentState: "granted",
        subscriptionState: "subscribed"
      },
      currentControls: configuredControls(),
      customer: customer({ normalizedEmail: "new-address@henderson.example" }),
      actor: admin(),
      nowISO: NOW,
      secret: SECRET
    })).toThrowError(/cannot be silently migrated/i);
  });

  test("treats email-control retries as idempotent and rejects request-id collisions", () => {
    const controls = configuredControls();
    const request = {
      organizationId: ORGANIZATION_ID,
      customerId: CUSTOMER_ID,
      requestId: "controls-1",
      expectedRevision: 0,
      consentState: "granted",
      subscriptionState: "subscribed"
    };
    const replay = planRevenueAutopilotEmailControlUpdate({
      request,
      currentControls: controls,
      customer: customer(),
      actor: admin(),
      nowISO: NOW,
      secret: SECRET
    });
    expect(replay.idempotent).toBe(true);

    expect(() => planRevenueAutopilotEmailControlUpdate({
      request: { ...request, consentState: "revoked", subscriptionState: "unsubscribed" },
      currentControls: controls,
      customer: customer(),
      actor: admin(),
      nowISO: NOW,
      secret: SECRET
    })).toThrowError(/reused with different content/i);
  });

  test("projects only bounded staff-safe policy and control state with explicit proof boundaries", () => {
    const authority = deliveryAuthority();
    const projection = projectRevenueAutopilotAuthorityForStaff({
      organizationId: ORGANIZATION_ID,
      policy: authority.policy,
      controls: authority.emailControls,
      provider: authority.provider,
      suppression: authority.suppression,
      observedAtISO: NOW
    });
    const serialized = JSON.stringify(projection);

    expect(projection.proofBoundaries).toEqual(REVENUE_AUTOPILOT_AUTHORITY_PROOF_BOUNDARIES);
    expect(projection.provider).toEqual({ configured: true, evaluatedAtISO: NOW });
    expect(projection.policy.templates.quote_follow_up).toEqual(expect.objectContaining({
      templateId: "quote-follow-up",
      version: "v1"
    }));
    for (const privateValue of [
      "alex@henderson.example",
      authority.emailControls.recipientKey,
      "must-not-project",
      "provider-config-1",
      "apiKey",
      "rau_"
    ]) {
      expect(serialized.toLowerCase()).not.toContain(privateValue.toLowerCase());
    }
  });
});

describe("canonical quote-to-core materialization authority", () => {
  test("keeps unconfigured provider evidence bounded so independent global gates remain explainable", () => {
    const authority = deliveryAuthority();
    const result = planRevenueAutopilotMaterializationFromCanonical({
      request: {
        organizationId: ORGANIZATION_ID,
        quoteId: QUOTE_ID,
        kind: "quote_follow_up"
      },
      canonical: {
        quote: quoteFor("sent", PROVIDER_ACCEPTED_AT),
        portal: portalFor("sent", PROVIDER_ACCEPTED_AT)
      },
      ...authority,
      provider: {
        ...authority.provider,
        providerId: "none",
        configurationId: "",
        state: "unconfigured"
      },
      global: { enabled: true, sendsEnabled: false }
    }, { nowISO: NOW, coreApi: core, templatesApi });

    expect(result.plan.state).toBe("blocked");
    expect(result.plan.gate.reasons.map((reason) => reason.code)).toEqual(
      expect.arrayContaining([
        "global_sends_disabled",
        "provider_configuration_missing"
      ])
    );
  });

  test.each([
    {
      kind: "quote_follow_up",
      state: "sent",
      stateAtISO: PROVIDER_ACCEPTED_AT,
      canonicalExtras: {},
      expectedScope: REVISION_ID,
      expectedOccurrences: ["anchor_plus_2", "anchor_plus_5"]
    },
    {
      kind: "deposit_reminder",
      state: "accepted",
      stateAtISO: "2026-08-10T16:00:00.000Z",
      canonicalExtras: { acceptance: acceptance(), deposit: deposit("unpaid") },
      expectedScope: REVISION_ID,
      expectedOccurrences: ["anchor_plus_1", "anchor_plus_3"]
    },
    {
      kind: "final_balance_reminder",
      state: "booked",
      stateAtISO: "2026-08-12T16:00:00.000Z",
      canonicalExtras: {
        acceptance: acceptance(),
        deposit: deposit("paid"),
        finalBalance: finalBalance("unpaid")
      },
      expectedScope: `revision:${REVISION_ID};payment:final-operation-1`,
      expectedOccurrences: ["event_minus_14", "event_minus_7", "event_minus_3"]
    }
  ])("maps exact $kind server evidence through the injected core", ({
    kind,
    state,
    stateAtISO,
    canonicalExtras,
    expectedScope,
    expectedOccurrences
  }) => {
    const authority = deliveryAuthority();
    const coreApi = {
      ...core,
      buildRevenueAutopilotOccurrences: vi.fn(core.buildRevenueAutopilotOccurrences),
      buildRevenueAutopilotScopeKey: vi.fn(core.buildRevenueAutopilotScopeKey),
      planRevenueAutopilotMaterialization: vi.fn(core.planRevenueAutopilotMaterialization)
    };
    const result = planRevenueAutopilotMaterializationFromCanonical({
      request: { organizationId: ORGANIZATION_ID, quoteId: QUOTE_ID, kind },
      canonical: {
        quote: quoteFor(state, stateAtISO),
        portal: portalFor(state, stateAtISO),
        ...canonicalExtras
      },
      ...authority
    }, { nowISO: NOW, coreApi, templatesApi });

    expect(coreApi.buildRevenueAutopilotOccurrences).toHaveBeenCalledTimes(1);
    expect(coreApi.buildRevenueAutopilotScopeKey).toHaveBeenCalledTimes(1);
    expect(coreApi.planRevenueAutopilotMaterialization).toHaveBeenCalledWith(result.input);
    expect(result.input.scopeKey).toBe(expectedScope);
    expect(result.input.occurrences.map((entry) => entry.occurrenceKey)).toEqual(expectedOccurrences);
    expect(result.input.template).toEqual(expect.objectContaining({
      templateId: template(kind).templateId,
      fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/)
    }));
    expect(result.plan.state).toBe("ready");
  });

  test("materializes one due post-event thank-you/review occurrence from the exact completed closeout", () => {
    const authority = {
      ...deliveryAuthority(),
      policy: configuredPostEventPolicy()
    };
    const result = planRevenueAutopilotMaterializationFromCanonical({
      request: {
        organizationId: ORGANIZATION_ID,
        quoteId: QUOTE_ID,
        kind: "post_event_review_request"
      },
      canonical: {
        quote: quoteFor("booked", "2026-08-12T16:00:00.000Z"),
        portal: portalFor("booked", "2026-08-12T16:00:00.000Z"),
        acceptance: acceptance(),
        postEventCloseout: completedPostEventCloseout()
      },
      ...authority
    }, { nowISO: "2026-09-08T15:00:00.000Z", coreApi: core, templatesApi });

    expect(result.input).toMatchObject({
      kind: "post_event_review_request",
      scopeKey: `revision:${REVISION_ID};closeout:closeout_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`,
      stopScope: {
        revisionId: REVISION_ID,
        closeoutId: "closeout_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      },
      evidence: {
        postEventCloseout: {
          source: "post_event_closeout_authority",
          state: "completed",
          dueDate: "2026-09-08"
        }
      }
    });
    expect(result.input.occurrences).toEqual([{
      occurrenceKey: "closeout_closeout_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      dueTenantDate: "2026-09-08",
      recordedDueTenantDate: "2026-09-08",
      completedTenantDate: "2026-09-08",
      closeoutId: "closeout_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }]);
    expect(result.plan).toMatchObject({ state: "ready" });
    expect(result.plan.create).toHaveLength(1);
  });

  test("self-stops a pending post-event occurrence and never rematerializes the stopped closeout", () => {
    const authority = {
      ...deliveryAuthority(),
      policy: configuredPostEventPolicy()
    };
    const canonical = {
      quote: quoteFor("booked", "2026-08-12T16:00:00.000Z"),
      portal: portalFor("booked", "2026-08-12T16:00:00.000Z"),
      acceptance: acceptance(),
      postEventCloseout: completedPostEventCloseout()
    };
    const first = planRevenueAutopilotMaterializationFromCanonical({
      request: {
        organizationId: ORGANIZATION_ID,
        quoteId: QUOTE_ID,
        kind: "post_event_review_request"
      },
      canonical,
      ...authority
    }, { nowISO: "2026-09-08T15:00:00.000Z" });
    const active = first.plan.create[0];
    const stopped = planRevenueAutopilotMaterializationFromCanonical({
      request: {
        organizationId: ORGANIZATION_ID,
        quoteId: QUOTE_ID,
        kind: "post_event_review_request"
      },
      canonical: { ...canonical, postEventCloseout: pendingPostEventCloseout() },
      ...authority,
      existingJobs: [active]
    }, { nowISO: "2026-09-08T15:00:00.000Z" });

    expect(stopped.plan).toMatchObject({
      state: "stopped",
      create: [],
      updates: [{
        jobId: active.jobId,
        state: "stopped",
        outcomeReason: "post_event_closeout_not_completed"
      }]
    });
    const terminal = { ...active, ...stopped.plan.updates[0] };
    const recompleted = planRevenueAutopilotMaterializationFromCanonical({
      request: {
        organizationId: ORGANIZATION_ID,
        quoteId: QUOTE_ID,
        kind: "post_event_review_request"
      },
      canonical,
      ...authority,
      existingJobs: [terminal]
    }, { nowISO: "2026-09-08T15:01:00.000Z" });

    expect(recompleted.plan.create).toEqual([]);
    expect(recompleted.plan.keep).toEqual([expect.objectContaining({
      jobId: active.jobId,
      state: "stopped"
    })]);
  });

  test("rejects stale, cross-tenant, future-dated, or contradictory closeout authority", () => {
    const authority = {
      ...deliveryAuthority(),
      policy: configuredPostEventPolicy()
    };
    const build = (postEventCloseout) => buildRevenueAutopilotMaterializationInput({
      request: {
        organizationId: ORGANIZATION_ID,
        quoteId: QUOTE_ID,
        kind: "post_event_review_request"
      },
      canonical: {
        quote: quoteFor("booked", "2026-08-12T16:00:00.000Z"),
        portal: portalFor("booked", "2026-08-12T16:00:00.000Z"),
        acceptance: acceptance(),
        postEventCloseout
      },
      ...authority
    }, { nowISO: "2026-09-08T15:00:00.000Z" });

    expect(() => build(completedPostEventCloseout({ organizationId: "org_other" })))
      .toThrowError(/outside|no longer matches/i);
    expect(() => build(completedPostEventCloseout({ dueDate: "2026-09-09" })))
      .toThrowError(/no longer matches/i);
    expect(() => build(completedPostEventCloseout({ updatedAtISO: "2026-09-09T15:00:00.000Z" })))
      .toThrowError(/future-dated/i);
    expect(() => build(completedPostEventCloseout({
      reviewItems: pendingPostEventCloseout().reviewItems
    }))).toThrowError(/completed.*incomplete/i);
  });

  test("never accepts client evidence, provider, payment, actor, or timestamps in the request envelope", () => {
    const authority = deliveryAuthority();
    expect(() => buildRevenueAutopilotMaterializationInput({
      request: {
        organizationId: ORGANIZATION_ID,
        quoteId: QUOTE_ID,
        kind: "quote_follow_up",
        nowISO: NOW,
        provider: { state: "configured" },
        payment: { state: "paid" }
      },
      canonical: {
        quote: quoteFor("sent", PROVIDER_ACCEPTED_AT),
        portal: portalFor("sent", PROVIDER_ACCEPTED_AT)
      },
      ...authority
    }, { nowISO: NOW })).toThrowError(/browser-authority fields/i);
  });

  test("rejects future-dated recipient, provider, or suppression evidence", () => {
    const authority = deliveryAuthority();
    expect(() => buildRevenueAutopilotMaterializationInput({
      request: { organizationId: ORGANIZATION_ID, quoteId: QUOTE_ID, kind: "quote_follow_up" },
      canonical: {
        quote: quoteFor("sent", PROVIDER_ACCEPTED_AT),
        portal: portalFor("sent", PROVIDER_ACCEPTED_AT)
      },
      ...authority,
      provider: { ...authority.provider, evaluatedAtISO: "2026-08-10T15:00:00.000Z" }
    }, { nowISO: NOW })).toThrowError(/cannot be future-dated/i);
  });

  test("fails closed on missing customer identity, cross-tenant evidence, and stale portal revisions", () => {
    const authority = deliveryAuthority();
    const base = {
      request: { organizationId: ORGANIZATION_ID, quoteId: QUOTE_ID, kind: "quote_follow_up" },
      canonical: {
        quote: quoteFor("sent", PROVIDER_ACCEPTED_AT),
        portal: portalFor("sent", PROVIDER_ACCEPTED_AT)
      },
      ...authority
    };
    expect(() => buildRevenueAutopilotMaterializationInput({
      ...base,
      canonical: { ...base.canonical, quote: quoteFor("sent", PROVIDER_ACCEPTED_AT, { customerId: "" }) }
    }, { nowISO: NOW })).toThrow(RevenueAutopilotAuthorityError);
    expect(() => buildRevenueAutopilotMaterializationInput({
      ...base,
      canonical: { ...base.canonical, portal: portalFor("sent", PROVIDER_ACCEPTED_AT, { organizationId: "org_other" }) }
    }, { nowISO: NOW })).toThrowError(/outside|bound|organization/i);
    expect(() => buildRevenueAutopilotMaterializationInput({
      ...base,
      canonical: { ...base.canonical, portal: portalFor("sent", PROVIDER_ACCEPTED_AT, { revisionId: "v0003" }) }
    }, { nowISO: NOW })).toThrowError(/exact active quote revision/i);
  });

  test("binds payment evidence to exact acceptance and final-operation scope", () => {
    const authority = deliveryAuthority();
    const base = {
      request: { organizationId: ORGANIZATION_ID, quoteId: QUOTE_ID, kind: "final_balance_reminder" },
      canonical: {
        quote: quoteFor("booked", "2026-08-12T16:00:00.000Z"),
        portal: portalFor("booked", "2026-08-12T16:00:00.000Z"),
        acceptance: acceptance(),
        deposit: deposit("paid"),
        finalBalance: finalBalance("unpaid")
      },
      ...authority
    };
    expect(() => buildRevenueAutopilotMaterializationInput({
      ...base,
      canonical: { ...base.canonical, acceptance: acceptance({ quoteRevisionId: "v0003" }) }
    }, { nowISO: NOW })).toThrowError(/does not match the exact portal revision/i);
    expect(() => buildRevenueAutopilotMaterializationInput({
      ...base,
      canonical: { ...base.canonical, finalBalance: finalBalance("unpaid", { organizationId: "org_other" }) }
    }, { nowISO: NOW })).toThrowError(/outside this quote scope/i);

    const input = buildRevenueAutopilotMaterializationInput(base, { nowISO: NOW });
    expect(input.stopScope.paymentOperationId).toBe("final-operation-1");
    expect(input.evidence.deposit).toMatchObject({
      source: "verified_provider_webhooks",
      signatureVerified: true,
      state: "paid"
    });
    expect(input.evidence.finalBalance).toMatchObject({
      source: "canonical_payment_ledger",
      operationId: "final-operation-1",
      state: "unpaid"
    });
  });
});

describe("exact quote-conversation staff acknowledgement authority", () => {
  function conversationFixture(actorType = "customer") {
    const latestMessageAtISO = "2026-08-09T14:45:00.000Z";
    const messageId = "message-9";
    return {
      quote: quoteFor("sent", PROVIDER_ACCEPTED_AT, {
        conversationSummary: { latestMessageId: messageId, latestMessageAtISO, latestActorType: actorType }
      }),
      conversationState: {
        organizationId: ORGANIZATION_ID,
        quoteId: QUOTE_ID,
        latestMessageId: messageId,
        latestMessageAtISO,
        latestActorType: actorType
      },
      latestMessage: {
        id: messageId,
        organizationId: ORGANIZATION_ID,
        quoteId: QUOTE_ID,
        createdAtISO: latestMessageAtISO,
        actorType,
        body: "private customer message"
      }
    };
  }

  test("normalizes only the exact browser intent and writes server actor/time evidence", () => {
    expect(() => normalizeRevenueAutopilotStaffAcknowledgementRequest({
      organizationId: ORGANIZATION_ID,
      quoteId: QUOTE_ID,
      messageId: "message-9",
      requestId: "read-1",
      acknowledgedAtISO: NOW
    })).toThrowError(/acknowledgedAtISO/i);

    const facts = conversationFixture();
    const planned = planRevenueAutopilotStaffAcknowledgementReceipt({
      request: {
        organizationId: ORGANIZATION_ID,
        quoteId: QUOTE_ID,
        messageId: "message-9",
        requestId: "read-1"
      },
      ...facts,
      actor: { uid: "sales-1", role: "sales", organizationId: ORGANIZATION_ID },
      nowISO: NOW
    });

    expect(planned).toMatchObject({ idempotent: false, receipt: {
      source: "server_staff_acknowledgement_receipt",
      latestMessageId: "message-9",
      acknowledgedAtISO: NOW,
      acknowledgedBy: "sales-1",
      acknowledgedByRole: "sales"
    } });
    expect(planned.receipt).not.toHaveProperty("body");
  });

  test("builds the exact core conversation shape and resolves only with a covering receipt", () => {
    const facts = conversationFixture();
    const unread = buildRevenueAutopilotConversationEvidence(facts);
    const planned = planRevenueAutopilotStaffAcknowledgementReceipt({
      request: {
        organizationId: ORGANIZATION_ID,
        quoteId: QUOTE_ID,
        messageId: "message-9",
        requestId: "read-1"
      },
      ...facts,
      actor: { uid: "sales-1", role: "sales", organizationId: ORGANIZATION_ID },
      nowISO: NOW
    });
    const acknowledged = buildRevenueAutopilotConversationEvidence({
      ...facts,
      staffAcknowledgementReceipt: planned.receipt
    });

    expect(unread.staffAcknowledged).toEqual({});
    expect(core.evaluateRevenueAutopilotStopEvidence({
      kind: "unread_customer_reply",
      scope: { organizationId: ORGANIZATION_ID, quoteId: QUOTE_ID, messageId: "message-9" },
      evidence: { conversation: unread }
    }).state).toBe("eligible");
    expect(core.evaluateRevenueAutopilotStopEvidence({
      kind: "unread_customer_reply",
      scope: { organizationId: ORGANIZATION_ID, quoteId: QUOTE_ID, messageId: "message-9" },
      evidence: { conversation: acknowledged }
    }).state).toBe("stopped");
  });

  test("rejects cross-tenant, stale-message, latest-staff, and stale-acknowledgement claims", () => {
    const facts = conversationFixture();
    const request = {
      organizationId: ORGANIZATION_ID,
      quoteId: QUOTE_ID,
      messageId: "message-9",
      requestId: "read-1"
    };
    expect(() => planRevenueAutopilotStaffAcknowledgementReceipt({
      request,
      ...facts,
      actor: { uid: "sales-1", role: "sales", organizationId: "org_other" },
      nowISO: NOW
    })).toThrowError(/cannot acknowledge/i);
    expect(() => planRevenueAutopilotStaffAcknowledgementReceipt({
      request: { ...request, messageId: "message-8" },
      ...facts,
      actor: { uid: "sales-1", role: "sales", organizationId: ORGANIZATION_ID },
      nowISO: NOW
    })).toThrowError(/changed or conflicts/i);
    expect(() => planRevenueAutopilotStaffAcknowledgementReceipt({
      request,
      ...conversationFixture("staff"),
      actor: { uid: "sales-1", role: "sales", organizationId: ORGANIZATION_ID },
      nowISO: NOW
    })).toThrowError(/only valid.*customer/i);
    expect(() => buildRevenueAutopilotConversationEvidence({
      ...facts,
      staffAcknowledgementReceipt: {
        organizationId: ORGANIZATION_ID,
        quoteId: QUOTE_ID,
        latestMessageId: "message-8",
        latestMessageAtISO: "2026-08-09T14:30:00.000Z",
        acknowledgedAtISO: NOW
      }
    })).toThrowError(/stale or outside/i);
  });
});

describe("authority proof boundary", () => {
  test("stays pure and contains no provider, Firebase, environment, or network mutation seam", async () => {
    const source = await import("../../../functions/revenueAutopilotAuthority.js?raw");
    const text = String(source.default || source);

    expect(text).not.toMatch(/firebase-admin|onCall\s*\(|fetch\s*\(|process\.env|\.send\s*\(/);
    expect(text).not.toMatch(/collection\s*\(|runTransaction\s*\(|setDoc\s*\(|updateDoc\s*\(/);
    expect(REVENUE_AUTOPILOT_AUTHORITY_PROOF_BOUNDARIES.join(" ")).toMatch(
      /does not establish accounting revenue/i
    );
  });
});
