import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  OperationalStaffingRuntimeError,
  assertOperationalStaffingAuthorityEnabled,
  buildOperationalStaffingSnapshotEnvelope,
  buildSnapshotScheduleFenceRefs,
  dedupeScheduleFenceAssignments,
  deriveCanonicalOperationalStaffingEvidence,
  emptyScheduleFence,
  wallTimeToExactISO
} = require("../../../functions/operationalStaffingRuntime.js");

const ORGANIZATION_ID = "org-staffing-runtime";
const QUOTE_ID = "quote-staffing-runtime";
const VERSION_ID = "v0014";

function version(event = {}) {
  return {
    versionId: VERSION_ID,
    organizationId: ORGANIZATION_ID,
    quoteId: QUOTE_ID,
    snapshot: {
      id: QUOTE_ID,
      organizationId: ORGANIZATION_ID,
      activeVersionId: VERSION_ID,
      event: {
        date: "2026-08-18",
        time: "17:00",
        hours: 6,
        servers: 2,
        chefs: 1,
        bartenders: 1,
        ...event
      }
    }
  };
}

function canonical(overrides = {}) {
  return deriveCanonicalOperationalStaffingEvidence({
    organizationId: ORGANIZATION_ID,
    quoteId: QUOTE_ID,
    activeQuoteRevisionId: VERSION_ID,
    version: version(),
    settings: { businessTimeZone: "America/Chicago" },
    ...overrides
  });
}

describe("operational staffing authority enablement", () => {
  test("requires both the global and exact tenant authority gates", () => {
    expect(() => assertOperationalStaffingAuthorityEnabled("false", {
      operationalStaffingAuthorityEnabled: true
    })).toThrowError(OperationalStaffingRuntimeError);
    expect(() => assertOperationalStaffingAuthorityEnabled("true", {})).toThrowError(
      /disabled/u
    );
    expect(assertOperationalStaffingAuthorityEnabled("TRUE", {
      operationalStaffingAuthorityEnabled: true
    })).toEqual({ enabled: true, globalEnabled: true, tenantEnabled: true });
  });
});

describe("canonical IANA event evidence", () => {
  test("converts a unique tenant wall time and derives only immutable commercial counts", () => {
    expect(canonical()).toEqual({
      activeQuoteRevisionId: VERSION_ID,
      canonicalEventWindow: {
        startAtISO: "2026-08-18T22:00:00.000Z",
        endAtISO: "2026-08-19T04:00:00.000Z"
      },
      canonicalRequirements: {
        lead: 0,
        server: 2,
        chef: 1,
        bartender: 1
      }
    });
  });

  test("fails closed for nonexistent and ambiguous daylight-saving wall times", () => {
    expect(() => wallTimeToExactISO({
      date: "2026-03-08",
      time: "02:30",
      timeZone: "America/Chicago"
    })).toThrowError(/does not exist/u);
    expect(() => wallTimeToExactISO({
      date: "2026-11-01",
      time: "01:30",
      timeZone: "America/Chicago"
    })).toThrowError(/ambiguous/u);
  });

  test.each([
    ["invalid IANA zone", { settings: { businessTimeZone: "Mars/Olympus" } }],
    ["mismatched immutable revision", { version: version(), activeQuoteRevisionId: "v0015" }],
    ["invalid quoted count", { version: version({ servers: 1.5 }) }],
    ["missing duration", { version: version({ hours: 0 }) }]
  ])("rejects %s", (_label, overrides) => {
    expect(() => canonical(overrides)).toThrowError(OperationalStaffingRuntimeError);
  });
});

describe("bounded fence and snapshot projections", () => {
  test("builds deterministic staff/day refs and reports truncation explicitly", () => {
    const result = buildSnapshotScheduleFenceRefs({
      organizationId: ORGANIZATION_ID,
      eventWindow: canonical().canonicalEventWindow,
      profiles: [{ staffId: "staff-one" }, { staffId: "staff-two" }],
      maximum: 2
    });
    expect(result.refs).toHaveLength(2);
    expect(result.totalCount).toBe(4);
    expect(result.truncated).toBe(true);
    expect(result.refs.every((item) => /^osf_[a-f0-9]{48}$/u.test(item.fenceId))).toBe(true);
  });

  test("unions canonical candidate fences with old current-plan window fences", () => {
    const candidateWindow = canonical().canonicalEventWindow;
    const oldWindow = {
      startAtISO: "2026-08-10T22:00:00.000Z",
      endAtISO: "2026-08-11T02:00:00.000Z"
    };
    const result = buildSnapshotScheduleFenceRefs({
      organizationId: ORGANIZATION_ID,
      eventWindow: candidateWindow,
      profiles: [{ staffId: "staff-one" }],
      currentPlan: {
        eventWindow: oldWindow,
        assignments: [{ staffId: "staff-one" }]
      }
    });
    expect(new Set(result.refs.map((item) => item.utcDate))).toEqual(new Set([
      "2026-08-10",
      "2026-08-11",
      "2026-08-18",
      "2026-08-19"
    ]));
    expect(result.truncated).toBe(false);
  });

  test("creates complete revision-zero missing-fence evidence", () => {
    const ref = buildSnapshotScheduleFenceRefs({
      organizationId: ORGANIZATION_ID,
      eventWindow: canonical().canonicalEventWindow,
      profiles: [{ staffId: "staff-one" }]
    }).refs[0];
    expect(emptyScheduleFence(ref)).toMatchObject({
      organizationId: ORGANIZATION_ID,
      staffId: "staff-one",
      revision: 0,
      assignments: [],
      assignmentsTruncated: false
    });
  });

  test("strips internal overlap fields and rejects disagreeing fence projections", () => {
    const fenceRef = buildSnapshotScheduleFenceRefs({
      organizationId: ORGANIZATION_ID,
      eventWindow: {
        startAtISO: "2026-08-18T20:00:00.000Z",
        endAtISO: "2026-08-18T21:00:00.000Z"
      },
      profiles: [{ staffId: "staff-one" }]
    }).refs[0];
    const fence = (assignments) => ({
      ...emptyScheduleFence(fenceRef),
      assignments
    });
    const assignment = {
      organizationId: ORGANIZATION_ID,
      assignmentId: "assignment-one",
      quoteId: "quote-peer",
      quoteRevisionId: "v0002",
      planRevision: 1,
      staffId: "staff-one",
      role: "server",
      state: "operator_confirmed",
      eventWindow: {
        startAtISO: "2026-08-18T20:00:00.000Z",
        endAtISO: "2026-08-18T21:00:00.000Z"
      },
      startMs: 123,
      endMs: 456
    };
    expect(dedupeScheduleFenceAssignments([
      fence([assignment]),
      fence([assignment])
    ])).toEqual([{ ...assignment, startMs: undefined, endMs: undefined }].map((item) => {
      delete item.startMs;
      delete item.endMs;
      return item;
    }));
    expect(() => dedupeScheduleFenceAssignments([
      fence([assignment]),
      fence([{ ...assignment, role: "chef" }])
    ])).toThrowError(/disagree/u);
  });

  test("returns the strict server snapshot envelope including first-apply authority", () => {
    const evidence = canonical();
    const ref = buildSnapshotScheduleFenceRefs({
      organizationId: ORGANIZATION_ID,
      eventWindow: evidence.canonicalEventWindow,
      profiles: [{ staffId: "staff-one" }]
    }).refs[0];
    const profile = {
      organizationId: ORGANIZATION_ID,
      staffId: "staff-one",
      displayName: "Avery R.",
      active: true,
      capabilities: ["server"],
      revision: 1,
      availabilityWindows: [],
      availabilityTruncated: false
    };
    expect(buildOperationalStaffingSnapshotEnvelope({
      organizationId: ORGANIZATION_ID,
      quoteId: QUOTE_ID,
      observedAtISO: "2026-08-11T20:00:00.000Z",
      canonicalEvidence: evidence,
      profiles: [profile],
      profilesTruncated: false,
      fences: [emptyScheduleFence(ref)],
      scheduleFencesTruncated: false,
      currentPlan: null
    })).toMatchObject({
      ok: true,
      storage: "firebase",
      authorityVersion: "operational-staffing-authority-v1",
      organizationId: ORGANIZATION_ID,
      quoteId: QUOTE_ID,
      activeQuoteRevisionId: VERSION_ID,
      canonicalEventWindow: evidence.canonicalEventWindow,
      canonicalRequirements: evidence.canonicalRequirements,
      state: "empty",
      reasonCodes: ["staffing_plan_not_recorded"],
      profilesTruncated: false,
      scheduleFencesTruncated: false,
      snapshot: null
    });
  });

  test("keeps quote-revision staleness dominant while preserving truncation reasons", () => {
    const evidence = canonical();
    const envelope = buildOperationalStaffingSnapshotEnvelope({
      organizationId: ORGANIZATION_ID,
      quoteId: QUOTE_ID,
      observedAtISO: "2026-08-11T20:00:00.000Z",
      canonicalEvidence: evidence,
      profiles: [],
      profilesTruncated: true,
      fences: [],
      scheduleFencesTruncated: true,
      currentPlan: {
        organizationId: ORGANIZATION_ID,
        quoteId: QUOTE_ID,
        quoteRevisionId: "v0013",
        revision: 1,
        eventWindow: evidence.canonicalEventWindow,
        requirements: {
          byRole: { lead: 0, server: 0, chef: 0, bartender: 0 }
        },
        assignments: [],
        state: "not_required"
      }
    });
    expect(envelope.state).toBe("stale");
    expect(envelope.reasonCodes).toEqual([
      "staffing_plan_quote_revision_stale",
      "staff_profiles_truncated",
      "schedule_fences_truncated"
    ]);
  });
});
