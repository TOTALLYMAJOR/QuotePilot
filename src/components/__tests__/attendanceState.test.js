import { describe, expect, test } from "vitest";
import {
  ATTENDANCE_SCHEMA_VERSION,
  ATTENDANCE_STATE_MODEL,
  AttendanceStateError,
  deriveAttendanceState
} from "../attendanceState";

const ISO = "2026-08-28T10:25:12.000Z";

function planning(overrides = {}) {
  return {
    kind: "exact",
    value: 120,
    min: null,
    max: null,
    sourceType: "staff_intake",
    sourceReferenceId: "intake-120",
    observedAtISO: ISO,
    recordedByUid: "staff-a",
    ...overrides
  };
}

function confirmation(overrides = {}) {
  return {
    state: "not_requested",
    requestedAtISO: "",
    dueDate: "",
    submittedCount: null,
    sourceType: "",
    sourceReferenceId: "",
    submittedAtISO: "",
    submittedByRole: "",
    appliedRevisionId: "",
    commercialChangeReceiptId: "",
    ...overrides
  };
}

function commercialBasis(overrides = {}) {
  return {
    source: "planning",
    sourceReferenceId: "intake-120",
    appliedRevisionId: "revision-1",
    ...overrides
  };
}

function attendance(overrides = {}) {
  return {
    schemaVersion: ATTENDANCE_SCHEMA_VERSION,
    planning: planning(),
    confirmation: confirmation(),
    commercialBasis: commercialBasis(),
    ...overrides
  };
}

function quote(overrides = {}) {
  return {
    id: "quote-a",
    activeVersionId: "revision-1",
    event: {
      guests: 120,
      attendance: attendance()
    },
    ...overrides
  };
}

function expectError(callback, code, message) {
  try {
    callback();
    throw new Error("Expected AttendanceStateError");
  } catch (error) {
    expect(error).toBeInstanceOf(AttendanceStateError);
    expect(error.code).toBe(code);
    expect(error.message).toContain(message);
  }
}

describe("attendance-state-v1", () => {
  test("derives an honest frozen legacy commercial basis without inventing confirmation", () => {
    const source = {
      id: "legacy-quote",
      activeVersionId: "legacy-revision",
      event: { guests: 120 }
    };
    const before = structuredClone(source);

    const result = deriveAttendanceState({ quote: source });

    expect(result).toMatchObject({
      modelId: ATTENDANCE_STATE_MODEL,
      commercialBasis: {
        count: 120,
        currentRevisionId: "legacy-revision",
        source: "legacy"
      },
      planning: {
        kind: "exact",
        value: 120,
        sourceType: "legacy"
      },
      confirmation: { state: "unknown" },
      derived: {
        id: "PRICED_ASSUMPTION",
        nextActionId: "review_priced_assumption"
      },
      boundaries: {
        commercialCountSource: "quote.event.guests",
        mutatesQuote: false,
        provesSourceBackedSubmission: false,
        provesCustomerSubmittedCount: false,
        provesAppliedFinalCount: false,
        provesPricingChangeApplied: false,
        provesOperationalReadiness: false,
        provesPaymentOrProviderOutcome: false
      }
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.planning)).toBe(true);
    expect(source).toEqual(before);
  });

  test("returns UNKNOWN for a legacy quote with no valid count", () => {
    const result = deriveAttendanceState({ quote: { id: "quote-empty", event: {} } });

    expect(result.commercialBasis.count).toBeNull();
    expect(result.planning).toMatchObject({ kind: "unknown", value: null });
    expect(result.confirmation.state).toBe("unknown");
    expect(result.derived).toEqual({
      id: "UNKNOWN",
      label: "Guest count is not recorded",
      nextActionId: "record_guest_count"
    });
  });

  test("preserves a ranged planning fact while event.guests remains the exact basis", () => {
    const result = deriveAttendanceState({
      quote: quote({
        event: {
          guests: 120,
          attendance: attendance({
            planning: planning({
              kind: "range",
              value: 120,
              min: 110,
              max: 130,
              sourceType: "customer_inquiry",
              sourceReferenceId: "inquiry-a"
            }),
            commercialBasis: commercialBasis({
              sourceReferenceId: "inquiry-a"
            })
          })
        }
      })
    });

    expect(result.planning).toMatchObject({
      kind: "range",
      value: 120,
      min: 110,
      max: 130
    });
    expect(result.commercialBasis.count).toBe(120);
    expect(result.derived.id).toBe("PRICED_ASSUMPTION");
  });

  test("represents a planning estimate before an exact commercial basis is selected", () => {
    const result = deriveAttendanceState({
      quote: quote({
        event: {
          guests: null,
          attendance: attendance({
            planning: planning({
              kind: "approximate",
              value: 120,
              min: 108,
              max: 132,
              sourceType: "customer_inquiry",
              sourceReferenceId: "inquiry-approx"
            }),
            commercialBasis: commercialBasis({
              source: "none",
              sourceReferenceId: "",
              appliedRevisionId: ""
            })
          })
        }
      })
    });

    expect(result.commercialBasis.count).toBeNull();
    expect(result.planning.kind).toBe("approximate");
    expect(result.derived).toEqual({
      id: "PLANNING_ESTIMATE",
      label: "Planning estimate recorded",
      nextActionId: "choose_commercial_count"
    });
  });

  test("uses an open guest-count Decision Debt item only as due-state evidence", () => {
    const result = deriveAttendanceState({
      quote: quote(),
      decisionDebtSnapshot: {
        snapshot: {
          items: [{
            id: "debt-guest-count",
            decisionType: "guest_count",
            resolutionState: "unresolved",
            lockDate: "2026-08-28",
            daysUntilLock: 0
          }]
        }
      }
    });

    expect(result.decisionDebt).toMatchObject({
      state: "due_or_overdue",
      id: "debt-guest-count",
      lockDate: "2026-08-28"
    });
    expect(result.derived).toEqual({
      id: "CONFIRMATION_DUE",
      label: "Final count is due",
      nextActionId: "review_final_count_decision"
    });
    expect(result.boundaries.provesSourceBackedSubmission).toBe(false);
    expect(result.boundaries.provesAppliedFinalCount).toBe(false);
  });

  test("marks incomplete Decision Debt evidence unknown instead of promoting it", () => {
    const result = deriveAttendanceState({
      quote: quote(),
      decisionDebtSnapshot: {
        items: [{
          id: "debt-guest-count",
          decisionType: "guest_count",
          resolutionState: "unresolved",
          lockDate: "",
          daysUntilLock: null
        }]
      }
    });

    expect(result.decisionDebt).toMatchObject({
      state: "unknown",
      reason: "Guest-count decision timing evidence is incomplete."
    });
    expect(result.derived.id).toBe("PRICED_ASSUMPTION");
  });

  test("keeps a requested confirmation separate from Decision Debt timing evidence", () => {
    const result = deriveAttendanceState({
      quote: quote({
        event: {
          guests: 120,
          attendance: attendance({
            confirmation: confirmation({
              state: "requested",
              requestedAtISO: ISO,
              dueDate: "2026-09-04"
            })
          })
        }
      }),
      decisionDebtSnapshot: {
        items: [{
          id: "debt-scheduled",
          decisionType: "guest_count",
          resolutionState: "unresolved",
          lockDate: "2026-09-04",
          daysUntilLock: 7
        }]
      }
    });

    expect(result.confirmation.state).toBe("requested");
    expect(result.decisionDebt.state).toBe("scheduled");
    expect(result.derived).toEqual({
      id: "CONFIRMATION_DUE",
      label: "Final count is scheduled",
      nextActionId: "review_final_count_decision"
    });
  });

  test("distinguishes a matching received response from an applied final count", () => {
    const result = deriveAttendanceState({
      quote: quote({
        event: {
          guests: 120,
          attendance: attendance({
            confirmation: confirmation({
              state: "received",
              requestedAtISO: ISO,
              dueDate: "2026-09-04",
              submittedCount: 120,
              sourceType: "customer_portal",
              sourceReferenceId: "response-120",
              submittedAtISO: ISO,
              submittedByRole: "customer"
            })
          })
        }
      })
    });

    expect(result.derived).toEqual({
      id: "CONFIRMATION_RECEIVED",
      label: "Matching count received",
      nextActionId: "review_confirmation"
    });
    expect(result.boundaries.provesSourceBackedSubmission).toBe(true);
    expect(result.boundaries.provesCustomerSubmittedCount).toBe(true);
    expect(result.boundaries.provesAppliedFinalCount).toBe(false);
    expect(result.boundaries.provesPricingChangeApplied).toBe(false);
  });

  test("requires commercial review when a received count differs from event.guests", () => {
    const result = deriveAttendanceState({
      quote: quote({
        event: {
          guests: 120,
          attendance: attendance({
            confirmation: confirmation({
              state: "received",
              requestedAtISO: ISO,
              dueDate: "2026-09-04",
              submittedCount: 135,
              sourceType: "customer_portal",
              sourceReferenceId: "response-135",
              submittedAtISO: ISO,
              submittedByRole: "customer"
            })
          })
        }
      })
    });

    expect(result.commercialBasis.count).toBe(120);
    expect(result.confirmation.submittedCount).toBe(135);
    expect(result.derived).toEqual({
      id: "CHANGE_REVIEW_REQUIRED",
      label: "Guest-count change needs review",
      nextActionId: "review_count_change"
    });
  });

  test("recognizes FINAL_APPLIED only from matching revision and receipt evidence", () => {
    const result = deriveAttendanceState({
      quote: quote({
        activeVersionId: "revision-2",
        event: {
          guests: 135,
          attendance: attendance({
            planning: planning({ value: 120 }),
            confirmation: confirmation({
              state: "applied",
              requestedAtISO: ISO,
              dueDate: "2026-09-04",
              submittedCount: 135,
              sourceType: "customer_portal",
              sourceReferenceId: "response-135",
              submittedAtISO: ISO,
              submittedByRole: "customer",
              appliedRevisionId: "revision-2",
              commercialChangeReceiptId: "apply-receipt-135"
            }),
            commercialBasis: commercialBasis({
              source: "confirmation",
              sourceReferenceId: "response-135",
              appliedRevisionId: "revision-2"
            })
          })
        }
      })
    });

    expect(result.derived).toEqual({
      id: "FINAL_APPLIED",
      label: "Final count applied",
      nextActionId: "review_dependencies"
    });
    expect(result.boundaries.provesSourceBackedSubmission).toBe(true);
    expect(result.boundaries.provesCustomerSubmittedCount).toBe(true);
    expect(result.boundaries.provesAppliedFinalCount).toBe(true);
    expect(result.boundaries.provesPricingChangeApplied).toBe(true);
    expect(result.boundaries.provesOperationalReadiness).toBe(false);
  });

  test("rejects applied evidence bound to a different source response", () => {
    expectError(() => deriveAttendanceState({
      quote: quote({
        activeVersionId: "revision-2",
        event: {
          guests: 135,
          attendance: attendance({
            confirmation: confirmation({
              state: "applied",
              submittedCount: 135,
              sourceType: "customer_portal",
              sourceReferenceId: "response-135",
              submittedAtISO: ISO,
              submittedByRole: "customer",
              appliedRevisionId: "revision-2",
              commercialChangeReceiptId: "apply-receipt-135"
            }),
            commercialBasis: commercialBasis({
              source: "confirmation",
              sourceReferenceId: "different-response",
              appliedRevisionId: "revision-2"
            })
          })
        }
      })
    }), "failed-precondition", "same revision and source");
  });

  test("rejects applied evidence bound to a stale quote revision", () => {
    expectError(() => deriveAttendanceState({
      quote: quote({
        activeVersionId: "revision-3",
        event: {
          guests: 135,
          attendance: attendance({
            confirmation: confirmation({
              state: "applied",
              submittedCount: 135,
              sourceType: "customer_portal",
              sourceReferenceId: "response-135",
              submittedAtISO: ISO,
              submittedByRole: "customer",
              appliedRevisionId: "revision-2",
              commercialChangeReceiptId: "apply-receipt-135"
            }),
            commercialBasis: commercialBasis({
              source: "confirmation",
              sourceReferenceId: "response-135",
              appliedRevisionId: "revision-2"
            })
          })
        }
      })
    }), "failed-precondition", "exact current revision");
  });

  test("rejects an applied response that does not match event.guests", () => {
    expectError(() => deriveAttendanceState({
      quote: quote({
        event: {
          guests: 120,
          attendance: attendance({
            confirmation: confirmation({
              state: "applied",
              submittedCount: 135,
              sourceType: "customer_portal",
              sourceReferenceId: "response-135",
              submittedAtISO: ISO,
              submittedByRole: "customer",
              appliedRevisionId: "revision-2",
              commercialChangeReceiptId: "apply-receipt-135"
            }),
            commercialBasis: commercialBasis({
              source: "confirmation",
              sourceReferenceId: "response-135",
              appliedRevisionId: "revision-2"
            })
          })
        }
      })
    }), "failed-precondition", "match the exact current commercial pricing basis");
  });

  test("keeps actual attendance separate and never promotes operational or payment proof", () => {
    const result = deriveAttendanceState({
      quote: quote(),
      actualAttendance: {
        count: 116,
        recordedAtISO: ISO,
        sourceReferenceId: "closeout-116"
      }
    });

    expect(result.actual).toEqual({
      count: 116,
      recordedAtISO: ISO,
      sourceReferenceId: "closeout-116"
    });
    expect(result.commercialBasis.count).toBe(120);
    expect(result.derived.id).toBe("ACTUAL_RECORDED");
    expect(result.boundaries.provesOperationalReadiness).toBe(false);
    expect(result.boundaries.provesPaymentOrProviderOutcome).toBe(false);
  });

  test.each([
    [
      "unsupported schema",
      () => quote({
        event: {
          guests: 120,
          attendance: attendance({ schemaVersion: 2 })
        }
      }),
      "failed-precondition",
      "Unsupported attendance schema version"
    ],
    [
      "unknown extra field",
      () => quote({
        event: {
          guests: 120,
          attendance: { ...attendance(), status: "final" }
        }
      }),
      "invalid-argument",
      "unsupported or missing fields"
    ],
    [
      "malformed range",
      () => quote({
        event: {
          guests: 120,
          attendance: attendance({
            planning: planning({ kind: "range", min: 130, max: 110 })
          })
        }
      }),
      "failed-precondition",
      "distinct bounds containing the reviewed value"
    ],
    [
      "received without source",
      () => quote({
        event: {
          guests: 120,
          attendance: attendance({
            confirmation: confirmation({
              state: "received",
              submittedCount: 120,
              submittedAtISO: ISO,
              submittedByRole: "customer"
            })
          })
        }
      }),
      "failed-precondition",
      "complete source-backed submission evidence"
    ],
    [
      "confirmation basis before apply",
      () => quote({
        event: {
          guests: 120,
          attendance: attendance({
            commercialBasis: commercialBasis({
              source: "confirmation",
              sourceReferenceId: "response-120"
            })
          })
        }
      }),
      "failed-precondition",
      "requires an applied confirmation"
    ],
    [
      "missing basis with a saved count",
      () => quote({
        event: {
          guests: 120,
          attendance: attendance({
            commercialBasis: commercialBasis({
              source: "none",
              sourceReferenceId: "",
              appliedRevisionId: ""
            })
          })
        }
      }),
      "failed-precondition",
      "cannot carry a saved count"
    ]
  ])("rejects malformed future attendance evidence: %s", (_label, makeQuote, code, message) => {
    expectError(
      () => deriveAttendanceState({ quote: makeQuote() }),
      code,
      message
    );
  });
});


test("approximate evidence permits no invented bounds but rejects partial bounds", () => {
  const result = deriveAttendanceState({ quote: quote({ event: { guests: 120, attendance: attendance({ planning: planning({ kind: "approximate", min: null, max: null }) }) } }) });
  expect(result.planning).toMatchObject({ kind: "approximate", value: 120, min: null, max: null });
  expect(() => deriveAttendanceState({ quote: quote({ event: { guests: 120, attendance: attendance({ planning: planning({ kind: "approximate", min: 110, max: null }) }) } }) })).toThrow(AttendanceStateError);
});
