import { describe, expect, test } from "vitest";
import { deriveStaffMaturity } from "../staffMaturity";

function entry(overrides = {}) {
  return {
    profile: {
      staffId: "staff-taylor",
      displayName: "Taylor Smith",
      active: true,
      capabilities: ["server"],
      availabilityWindows: [],
      ...overrides.profile
    },
    record: {
      contact: {
        email: "",
        phone: "",
        communicationsEnabled: true,
        ...overrides.record?.contact
      },
      compensation: { hourlyRate: 0, eventRate: 0, ...overrides.record?.compensation },
      qualifications: overrides.record?.qualifications || [],
      scheduling: {},
      travel: {},
      assignmentDefaults: {},
      briefingDefaults: {},
      ...overrides.record
    }
  };
}

describe("deriveStaffMaturity", () => {
  test("treats name plus one role as a valid active roster member", () => {
    const result = deriveStaffMaturity(entry());
    expect(result).toMatchObject({
      authority: "derived_presentation_only",
      rosterIdentityValid: true,
      primaryState: "rostered",
      stages: {
        rostered: { state: "available", label: "Rostered" },
        contactable: { state: "not_yet_available", label: "Contact not recorded" },
        schedulable: { state: "not_yet_available", label: "Availability not recorded" },
        costAware: { state: "not_yet_available", label: "Rate not recorded" },
        credentialAware: { state: "not_yet_available", label: "Qualifications not recorded" }
      },
      contextAttention: []
    });
    expect(Object.isFrozen(result.stages)).toBe(true);
  });

  test("keeps optional omissions quiet until a decision actually needs them", () => {
    const ordinary = deriveStaffMaturity(entry());
    expect(ordinary.contextAttention).toEqual([]);

    const contextual = deriveStaffMaturity(entry(), {
      invitationRequested: true,
      laborCostRequested: true,
      availabilityRequired: true,
      requiredQualificationTypes: ["Food handler"]
    });
    expect(contextual.contextAttention.map((item) => item.code)).toEqual([
      "invitation_email_missing",
      "labor_rate_missing",
      "availability_missing",
      "required_qualification_missing"
    ]);
  });

  test("derives independent maturity stages from recorded evidence", () => {
    const result = deriveStaffMaturity(entry({
      profile: {
        availabilityWindows: [{
          state: "available",
          startAtISO: "2026-10-11T16:00:00.000Z",
          endAtISO: "2026-10-12T00:00:00.000Z"
        }]
      },
      record: {
        contact: { email: "taylor@example.com" },
        compensation: { hourlyRate: 24 },
        qualifications: [{ type: "Food handler", status: "current" }],
        briefingDefaults: { uniform: "Black service attire" }
      }
    }), {
      assignments: [{ staffId: "staff-taylor", assignmentId: "assignment-1" }],
      invitationRequested: true,
      laborCostRequested: true,
      availabilityRequired: true,
      requiredQualificationTypes: ["Food handler"]
    });
    expect(result.primaryState).toBe("assigned");
    expect(Object.values(result.stages).map((item) => item.state))
      .toEqual(["available", "available", "available", "available", "available", "available"]);
    expect(result.contextAttention).toEqual([]);
  });

  test("never leaks private staff values into its serialized projection", () => {
    const result = deriveStaffMaturity(entry({
      record: {
        contact: { email: "private@example.com", phone: "+1 555 0100" },
        privateNotes: "Sensitive manager note"
      }
    }));
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("private@example.com");
    expect(serialized).not.toContain("555 0100");
    expect(serialized).not.toContain("Sensitive manager note");
  });
});
