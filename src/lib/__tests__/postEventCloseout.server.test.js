import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  POST_EVENT_CLOSEOUT_OFFSET_DAYS,
  POST_EVENT_CLOSEOUT_REVIEW_ITEM_CODES,
  PostEventCloseoutError,
  addCalendarDaysDateOnly,
  assertPostEventCloseoutMatchesSource,
  buildPostEventCloseoutId,
  buildPostEventCloseoutPolicySnapshot,
  buildPostEventCloseoutRecord,
  calendarDateAtISO,
  derivePostEventCloseoutState,
  normalizeIanaTimeZone,
  normalizePostEventCloseoutActionRequest,
  normalizePostEventCloseoutPolicyRefreshRequest,
  planPostEventCloseoutAction,
  planPostEventCloseoutPolicyRefresh,
  resolvePostEventCloseoutSource
} = require("../../../functions/postEventCloseout.js");

const ORGANIZATION_ID = "org-one";
const QUOTE_ID = "quote-booked";
const CUSTOMER_ID = "customer-henderson";
const SOURCE_VERSION_ID = "v0003";
const ACCEPTANCE_RECEIPT_ID = "acceptance-1234567890";
const EVENT_DATE = "2026-08-08";
const ACCEPTED_AT_ISO = "2026-05-10T18:30:00.000Z";
const PORTAL_ISSUED_AT_ISO = "2026-05-01T14:00:00.000Z";
const BOOKED_AT_ISO = "2026-05-12T16:15:00.000Z";
const CREATED_AT_ISO = "2026-05-12T16:15:05.000Z";
const ACTOR = Object.freeze({
  uid: "staff-admin-1",
  email: "owner@example.test",
  role: "admin"
});

function sourceFixture() {
  const revisionId = `${SOURCE_VERSION_ID}@${PORTAL_ISSUED_AT_ISO}`;
  const proposalSnapshot = {
    schemaVersion: 2,
    organizationId: ORGANIZATION_ID,
    quoteId: QUOTE_ID,
    revisionId,
    portalIssuedAtISO: PORTAL_ISSUED_AT_ISO,
    quoteNumber: "Q-1003",
    totalsMinor: { total: 1200000, deposit: 300000 }
  };
  const snapshotSha256 = createHash("sha256")
    .update(JSON.stringify(proposalSnapshot))
    .digest("hex");
  const snapshot = {
    id: QUOTE_ID,
    organizationId: ORGANIZATION_ID,
    customerId: CUSTOMER_ID,
    customer: {
      name: "Henderson Group",
      email: "events@henderson.test"
    },
    event: {
      name: "Corporate picnic",
      date: EVENT_DATE
    },
    pricing: { authority: "server_authoritative" }
  };
  return {
    quote: {
      id: QUOTE_ID,
      organizationId: ORGANIZATION_ID,
      customerId: CUSTOMER_ID,
      status: "booked",
      activeVersionId: SOURCE_VERSION_ID,
      event: { name: "Corporate picnic", date: EVENT_DATE },
      booking: { bookedAtISO: BOOKED_AT_ISO, contractNumber: "C-260512-00001" },
      lifecycle: { bookedAtISO: BOOKED_AT_ISO },
      acceptanceReceipt: {
        receiptId: ACCEPTANCE_RECEIPT_ID,
        acceptedAtISO: ACCEPTED_AT_ISO,
        portalIssuedAtISO: PORTAL_ISSUED_AT_ISO,
        quoteRevisionId: revisionId,
        snapshotSha256
      }
    },
    version: {
      versionId: SOURCE_VERSION_ID,
      quoteId: QUOTE_ID,
      organizationId: ORGANIZATION_ID,
      customerId: CUSTOMER_ID,
      snapshot
    },
    receiptDocument: {
      receiptId: ACCEPTANCE_RECEIPT_ID,
      organizationId: ORGANIZATION_ID,
      quoteId: QUOTE_ID,
      acceptedAtISO: ACCEPTED_AT_ISO,
      portalIssuedAtISO: PORTAL_ISSUED_AT_ISO,
      quoteRevisionId: revisionId,
      snapshotSha256,
      proposalSnapshot
    }
  };
}

function resolveSource(fixture = sourceFixture()) {
  return resolvePostEventCloseoutSource({
    organizationId: ORGANIZATION_ID,
    quoteId: QUOTE_ID,
    sourceQuote: fixture.quote,
    sourceVersion: fixture.version,
    acceptanceReceiptDocument: fixture.receiptDocument
  });
}

function recordFixture(settings = { businessTimeZone: "America/Chicago" }) {
  const fixture = sourceFixture();
  return {
    source: resolveSource(fixture),
    record: buildPostEventCloseoutRecord({
      organizationId: ORGANIZATION_ID,
      quoteId: QUOTE_ID,
      sourceQuote: fixture.quote,
      sourceVersion: fixture.version,
      acceptanceReceiptDocument: fixture.receiptDocument,
      settings,
      actor: ACTOR,
      nowISO: CREATED_AT_ISO
    })
  };
}

function requestFor(record, overrides = {}) {
  return {
    organizationId: ORGANIZATION_ID,
    quoteId: QUOTE_ID,
    closeoutId: record.closeoutId,
    itemCode: "internal_closeout",
    action: "review",
    requestId: "closeout-review-request-0001",
    note: "Internal event notes reviewed.",
    ...overrides
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

describe("post-event closeout identity and calendar policy", () => {
  test("derives one deterministic closeout id from exact commercial source identity", () => {
    const source = resolveSource();
    const closeoutId = buildPostEventCloseoutId(source);

    expect(closeoutId).toMatch(/^closeout_[a-f0-9]{48}$/);
    expect(buildPostEventCloseoutId(source)).toBe(closeoutId);
    expect(buildPostEventCloseoutId({
      ...source,
      sourceVersionId: "v0004"
    })).not.toBe(closeoutId);
    expect(buildPostEventCloseoutId({
      ...source,
      acceptanceReceiptId: "acceptance-0987654321"
    })).not.toBe(closeoutId);
  });

  test.each([
    ["2024-02-22", "2024-02-29"],
    ["2024-02-23", "2024-03-01"],
    ["2023-02-23", "2023-03-02"],
    ["2026-12-28", "2027-01-04"]
  ])("adds seven calendar days without local-time or leap-year drift: %s", (eventDate, dueDate) => {
    expect(addCalendarDaysDateOnly(eventDate)).toBe(dueDate);
  });

  test("rejects impossible dates and non-integral offsets", () => {
    expect(() => addCalendarDaysDateOnly("2026-02-30")).toThrow(/valid calendar date/i);
    expect(() => addCalendarDaysDateOnly("2026-08-08", 1.5)).toThrow(/integer/i);
  });

  test("normalizes a valid IANA tenant time zone into an immutable policy snapshot", () => {
    const policy = buildPostEventCloseoutPolicySnapshot({
      businessTimeZone: "America/Chicago"
    });

    expect(policy).toEqual({
      version: 1,
      state: "configured",
      source: "organization_settings",
      timeZone: "America/Chicago",
      dueBoundary: "tenant_calendar_date",
      offsetDays: POST_EVENT_CLOSEOUT_OFFSET_DAYS,
      blockedReason: ""
    });
    expect(Object.isFrozen(policy)).toBe(true);
    expect(normalizeIanaTimeZone("Mars/Olympus")).toBe("");
  });

  test.each([{}, { businessTimeZone: "" }, { businessTimeZone: "Mars/Olympus" }])(
    "fails closed to blocked_configuration for missing or invalid tenant policy: %j",
    (settings) => {
      expect(buildPostEventCloseoutPolicySnapshot(settings)).toMatchObject({
        state: "blocked_configuration",
        timeZone: "",
        blockedReason: "tenant_time_zone_missing_or_invalid"
      });
    }
  );

  test("evaluates the same instant against the recorded tenant calendar", () => {
    expect(calendarDateAtISO("2026-08-15T02:30:00.000Z", "America/Chicago"))
      .toBe("2026-08-14");
    expect(calendarDateAtISO("2026-08-15T02:30:00.000Z", "Asia/Tokyo"))
      .toBe("2026-08-15");
  });
});

describe("post-event closeout exact source and record", () => {
  test("resolves only the booked quote, acceptance receipt, and immutable accepted version", () => {
    expect(resolveSource()).toEqual({
      organizationId: ORGANIZATION_ID,
      quoteId: QUOTE_ID,
      customerId: CUSTOMER_ID,
      sourceVersionId: SOURCE_VERSION_ID,
      acceptanceReceiptId: ACCEPTANCE_RECEIPT_ID,
      acceptedAtISO: ACCEPTED_AT_ISO,
      portalIssuedAtISO: PORTAL_ISSUED_AT_ISO,
      bookedAtISO: BOOKED_AT_ISO,
      eventDate: EVENT_DATE
    });
  });

  test("accepts the legacy direct acceptance revision only when the exact version still matches", () => {
    const fixture = sourceFixture();
    fixture.quote.acceptanceReceipt.quoteRevisionId = SOURCE_VERSION_ID;
    fixture.receiptDocument.quoteRevisionId = SOURCE_VERSION_ID;
    fixture.receiptDocument.proposalSnapshot.revisionId = SOURCE_VERSION_ID;
    fixture.receiptDocument.snapshotSha256 = createHash("sha256")
      .update(JSON.stringify(fixture.receiptDocument.proposalSnapshot))
      .digest("hex");
    fixture.quote.acceptanceReceipt.snapshotSha256 = fixture.receiptDocument.snapshotSha256;
    expect(resolveSource(fixture).sourceVersionId).toBe(SOURCE_VERSION_ID);
  });

  test.each([
    ["cross-tenant quote", (fixture) => { fixture.quote.organizationId = "org-two"; }, "permission-denied"],
    ["quote is not booked", (fixture) => { fixture.quote.status = "accepted"; }, "failed-precondition"],
    ["customer identity changed", (fixture) => { fixture.version.customerId = "customer-other"; }, "failed-precondition"],
    ["active accepted version changed", (fixture) => { fixture.quote.activeVersionId = "v0004"; }, "failed-precondition"],
    ["acceptance revision changed", (fixture) => { fixture.quote.acceptanceReceipt.quoteRevisionId = "v0002"; }, "failed-precondition"],
    ["private receipt hash changed", (fixture) => { fixture.receiptDocument.snapshotSha256 = "f".repeat(64); }, "failed-precondition"],
    ["private proposal snapshot changed", (fixture) => { fixture.receiptDocument.proposalSnapshot.totalsMinor.total += 1; }, "failed-precondition"],
    ["immutable event changed", (fixture) => { fixture.version.snapshot.event.date = "2026-08-09"; }, "failed-precondition"],
    ["synthetic immutable source", (fixture) => { fixture.version.legacySynthetic = true; }, "failed-precondition"]
  ])("fails closed when the %s", (_label, mutate, expectedCode) => {
    const fixture = sourceFixture();
    mutate(fixture);
    expect(() => resolveSource(fixture)).toThrowError(expect.objectContaining({
      code: expectedCode
    }));
  });

  test("builds a future-due pending record with all four review decisions", () => {
    const { record, source } = recordFixture();

    expect(record).toMatchObject({
      schemaVersion: 1,
      closeoutId: buildPostEventCloseoutId(source),
      organizationId: ORGANIZATION_ID,
      quoteId: QUOTE_ID,
      customerId: CUSTOMER_ID,
      sourceVersionId: SOURCE_VERSION_ID,
      acceptanceReceiptId: ACCEPTANCE_RECEIPT_ID,
      eventDate: EVENT_DATE,
      dueDate: "2026-08-15",
      state: "pending",
      completedAtISO: "",
      completedBy: null,
      createdAtISO: CREATED_AT_ISO,
      updatedAtISO: CREATED_AT_ISO
    });
    expect(Object.keys(record.reviewItems)).toEqual(POST_EVENT_CLOSEOUT_REVIEW_ITEM_CODES);
    expect(Object.values(record.reviewItems).every((item) => item.state === "pending")).toBe(true);
    expect(assertPostEventCloseoutMatchesSource(record, source)).toBe(true);
  });

  test("creates a visible blocked_configuration record without inventing UTC policy", () => {
    const { record } = recordFixture({ businessTimeZone: "Not/AZone" });

    expect(record.state).toBe("blocked_configuration");
    expect(record.policy).toMatchObject({
      state: "blocked_configuration",
      timeZone: "",
      blockedReason: "tenant_time_zone_missing_or_invalid"
    });
    expect(record.dueDate).toBe("2026-08-15");
  });

  test("rolls pending decisions to completed only when every item has review evidence", () => {
    const { record } = recordFixture();
    const reviewItems = clone(record.reviewItems);
    reviewItems.internal_closeout = {
      state: "reviewed",
      reviewedAtISO: "2026-08-15T15:00:00.000Z",
      reviewedBy: ACTOR,
      lastActionReceiptId: "closeout_action_first"
    };
    expect(derivePostEventCloseoutState({ reviewItems, policy: record.policy })).toBe("pending");

    POST_EVENT_CLOSEOUT_REVIEW_ITEM_CODES.forEach((code, index) => {
      reviewItems[code] = {
        state: "reviewed",
        reviewedAtISO: `2026-08-15T15:0${index}:00.000Z`,
        reviewedBy: ACTOR,
        lastActionReceiptId: `closeout_action_${code}`
      };
    });
    expect(derivePostEventCloseoutState({ reviewItems, policy: record.policy })).toBe("completed");
    expect(derivePostEventCloseoutState({
      reviewItems,
      policy: { state: "blocked_configuration" }
    })).toBe("blocked_configuration");
  });

  test("detects a source-bound record that has drifted", () => {
    const { record, source } = recordFixture();
    expect(() => assertPostEventCloseoutMatchesSource({
      ...record,
      sourceVersionId: "v0004"
    }, source)).toThrowError(expect.objectContaining({ code: "failed-precondition" }));
  });
});

describe("post-event closeout action and receipt planning", () => {
  test("normalizes only a bounded review/reopen request and derives its receipt identity", () => {
    const { record } = recordFixture();
    const normalized = normalizePostEventCloseoutActionRequest({
      ...requestFor(record),
      customerEmail: "must-not-be-trusted@example.test",
      eventDate: "2035-01-01"
    });

    expect(normalized).toMatchObject({
      organizationId: ORGANIZATION_ID,
      quoteId: QUOTE_ID,
      closeoutId: record.closeoutId,
      itemCode: "internal_closeout",
      action: "review",
      targetState: "reviewed",
      requestId: "closeout-review-request-0001"
    });
    expect(normalized.receiptId).toMatch(/^closeout_action_[a-f0-9]{48}$/);
    expect(normalizePostEventCloseoutActionRequest(requestFor(record)).receiptId)
      .toBe(normalized.receiptId);
  });

  test.each([
    [{ itemCode: "send_thank_you" }, /review item/i],
    [{ action: "send" }, /review or reopen/i],
    [{ requestId: "too-short" }, /requestId/i],
    [{ requestId: "operator@example.test" }, /requestId/i],
    [{ note: "x".repeat(801) }, /800 characters/i]
  ])("rejects unsafe action input %j", (override, expectedMessage) => {
    const { record } = recordFixture();
    expect(() => normalizePostEventCloseoutActionRequest(requestFor(record, override)))
      .toThrow(expectedMessage);
  });

  test("refuses review before the tenant-local due date and while policy is blocked", () => {
    const configured = recordFixture();
    expect(() => planPostEventCloseoutAction({
      request: requestFor(configured.record),
      record: configured.record,
      source: configured.source,
      actor: ACTOR,
      nowISO: "2026-08-15T02:30:00.000Z"
    })).toThrow(/scheduled for 2026-08-15/i);

    const blocked = recordFixture({ businessTimeZone: "" });
    expect(() => planPostEventCloseoutAction({
      request: requestFor(blocked.record),
      record: blocked.record,
      source: blocked.source,
      actor: ACTOR,
      nowISO: "2026-08-16T15:00:00.000Z"
    })).toThrow(/business time zone/i);
  });

  test("plans an internal review mutation and an independently stored receipt", () => {
    const { record, source } = recordFixture();
    const plan = planPostEventCloseoutAction({
      request: requestFor(record),
      record,
      source,
      actor: ACTOR,
      nowISO: "2026-08-15T15:00:00.000Z"
    });

    expect(plan.kind).toBe("apply");
    expect(plan.idempotent).toBe(false);
    expect(plan.nextRecord.reviewItems.internal_closeout).toMatchObject({
      state: "reviewed",
      reviewedAtISO: "2026-08-15T15:00:00.000Z",
      reviewedBy: ACTOR,
      lastActionReceiptId: plan.receipt.receiptId
    });
    expect(plan.nextRecord.state).toBe("pending");
    expect(plan.receipt).toMatchObject({
      receiptId: plan.request.receiptId,
      priorItemState: "pending",
      resultItemState: "reviewed",
      priorCloseoutState: "pending",
      resultCloseoutState: "pending",
      applied: true,
      recordedBy: ACTOR
    });
    expect(JSON.stringify(plan.receipt)).not.toContain("sent");
    expect(JSON.stringify(plan.receipt)).not.toContain("delivered");
  });

  test("rolls the fourth reviewed item into exact completion evidence", () => {
    const { record: initialRecord, source } = recordFixture();
    let record = initialRecord;
    let finalPlan = null;

    POST_EVENT_CLOSEOUT_REVIEW_ITEM_CODES.forEach((itemCode, index) => {
      finalPlan = planPostEventCloseoutAction({
        request: requestFor(record, {
          itemCode,
          requestId: `closeout-review-request-000${index + 1}`,
          note: `Reviewed ${itemCode}.`
        }),
        record,
        source,
        actor: ACTOR,
        nowISO: `2026-08-15T15:0${index}:00.000Z`
      });
      record = finalPlan.nextRecord;
    });

    expect(record.state).toBe("completed");
    expect(record.completedAtISO).toBe("2026-08-15T15:03:00.000Z");
    expect(record.completedBy).toEqual(ACTOR);
    expect(finalPlan.receipt.resultCloseoutState).toBe("completed");
  });

  test("reopens a completed item with audit evidence and clears record completion", () => {
    const { record: initialRecord, source } = recordFixture();
    let record = initialRecord;
    POST_EVENT_CLOSEOUT_REVIEW_ITEM_CODES.forEach((itemCode, index) => {
      record = planPostEventCloseoutAction({
        request: requestFor(record, {
          itemCode,
          requestId: `closeout-complete-request-00${index + 1}`,
          note: "Reviewed."
        }),
        record,
        source,
        actor: ACTOR,
        nowISO: `2026-08-15T16:0${index}:00.000Z`
      }).nextRecord;
    });

    const reopened = planPostEventCloseoutAction({
      request: requestFor(record, {
        itemCode: "review_request",
        action: "reopen",
        requestId: "closeout-reopen-request-0001",
        note: "Eligibility needs another review."
      }),
      record,
      source,
      actor: ACTOR,
      nowISO: "2026-08-15T17:00:00.000Z"
    });

    expect(reopened.nextRecord.state).toBe("pending");
    expect(reopened.nextRecord.completedAtISO).toBe("");
    expect(reopened.nextRecord.completedBy).toBeNull();
    expect(reopened.nextRecord.reviewItems.review_request).toMatchObject({
      state: "pending",
      reviewedAtISO: "",
      reviewedBy: null,
      lastActionReceiptId: reopened.receipt.receiptId
    });
  });

  test("creates a no-op receipt when the requested state already exists", () => {
    const { record, source } = recordFixture();
    const plan = planPostEventCloseoutAction({
      request: requestFor(record, {
        action: "reopen",
        requestId: "closeout-noop-request-00001",
        note: "Confirm pending state."
      }),
      record,
      source,
      actor: ACTOR,
      nowISO: "2026-08-15T15:00:00.000Z"
    });

    expect(plan.kind).toBe("noop");
    expect(plan.nextRecord).toBeNull();
    expect(plan.receipt).toMatchObject({
      applied: false,
      priorItemState: "pending",
      resultItemState: "pending"
    });
  });

  test("reconciles an exact retry without planning a second mutation", () => {
    const { record, source } = recordFixture();
    const first = planPostEventCloseoutAction({
      request: requestFor(record),
      record,
      source,
      actor: ACTOR,
      nowISO: "2026-08-15T15:00:00.000Z"
    });
    const retry = planPostEventCloseoutAction({
      request: requestFor(record),
      existingReceipt: first.receipt
    });

    expect(retry).toMatchObject({
      kind: "reconcile",
      idempotent: true,
      nextRecord: null,
      receipt: first.receipt
    });
  });

  test("refuses a receipt identity collision instead of applying or reconciling it", () => {
    const { record, source } = recordFixture();
    const first = planPostEventCloseoutAction({
      request: requestFor(record),
      record,
      source,
      actor: ACTOR,
      nowISO: "2026-08-15T15:00:00.000Z"
    });

    expect(() => planPostEventCloseoutAction({
      request: requestFor(record),
      existingReceipt: {
        ...first.receipt,
        itemCode: "thank_you"
      }
    })).toThrowError(expect.objectContaining({ code: "already-exists" }));
  });

  test("refuses to act when the record no longer matches the resolved exact source", () => {
    const { record, source } = recordFixture();
    expect(() => planPostEventCloseoutAction({
      request: requestFor(record),
      record: { ...record, acceptanceReceiptId: "acceptance-other-12345" },
      source,
      actor: ACTOR,
      nowISO: "2026-08-15T15:00:00.000Z"
    })).toThrowError(expect.objectContaining({ code: "failed-precondition" }));
  });

  test("recovers blocked tenant configuration without reviewing any closeout item", () => {
    const { record, source } = recordFixture({ businessTimeZone: "" });
    const request = normalizePostEventCloseoutPolicyRefreshRequest({
      organizationId: ORGANIZATION_ID,
      quoteId: QUOTE_ID,
      closeoutId: record.closeoutId,
      requestId: "closeout-configuration-request-0001"
    });

    expect(() => planPostEventCloseoutPolicyRefresh({
      request,
      record,
      source,
      settings: {},
      actor: ACTOR,
      nowISO: "2026-08-14T15:00:00.000Z"
    })).toThrowError(expect.objectContaining({ code: "failed-precondition" }));

    const plan = planPostEventCloseoutPolicyRefresh({
      request,
      record,
      source,
      settings: { businessTimeZone: "America/Chicago" },
      actor: ACTOR,
      nowISO: "2026-08-14T15:00:00.000Z"
    });
    expect(plan).toMatchObject({
      kind: "apply",
      idempotent: false,
      nextRecord: {
        state: "pending",
        policy: { state: "configured", timeZone: "America/Chicago" }
      },
      receipt: {
        action: "refresh_configuration",
        priorPolicyState: "blocked_configuration",
        resultPolicyState: "configured",
        applied: true
      }
    });
    expect(plan.nextRecord.reviewItems).toEqual(record.reviewItems);

    expect(planPostEventCloseoutPolicyRefresh({
      request,
      record,
      source,
      settings: { businessTimeZone: "America/Chicago" },
      actor: ACTOR,
      nowISO: "2026-08-14T15:01:00.000Z",
      existingReceipt: plan.receipt
    })).toMatchObject({
      kind: "reconcile",
      idempotent: true,
      nextRecord: null,
      receipt: plan.receipt
    });
  });

  test("uses typed closeout errors suitable for callable translation", () => {
    expect(() => buildPostEventCloseoutId({
      organizationId: ORGANIZATION_ID,
      quoteId: "operator@example.test",
      sourceVersionId: SOURCE_VERSION_ID,
      acceptanceReceiptId: ACCEPTANCE_RECEIPT_ID
    })).toThrowError(expect.objectContaining({
      name: "PostEventCloseoutError",
      code: "invalid-argument"
    }));
    expect(new PostEventCloseoutError("aborted", "example")).toMatchObject({
      name: "PostEventCloseoutError",
      code: "aborted",
      message: "example"
    });
  });
});
