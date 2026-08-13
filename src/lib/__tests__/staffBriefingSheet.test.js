import { afterEach, describe, expect, test, vi } from "vitest";
import { buildDefaultEmailAppHandoff } from "../defaultEmailApp";
import {
  buildStaffBriefing,
  buildStaffBriefingEmail,
  exportStaffBriefingSheet
} from "../staffBriefingSheet";

afterEach(() => {
  vi.restoreAllMocks();
});

const entry = Object.freeze({
  profile: { staffId: "staff-1", displayName: "Avery Lane" },
  record: {
    preferredName: "Avery",
    contact: { email: "avery@example.com" },
    assignmentDefaults: {
      department: "Service",
      station: "Dining room",
      reportingLocation: "Loading entrance",
      arrivalInstructions: "Check in with Morgan."
    },
    briefingDefaults: {
      uniform: "Black shirt and trousers",
      parking: "South lot",
      entrance: "Loading entrance",
      mealPolicy: "Staff meal after service",
      responsibilities: "Dining room setup and plated service"
    }
  }
});

const assignment = Object.freeze({
  assignmentId: "assignment-1",
  staffId: "staff-1",
  role: "server",
  planRevision: 3,
  quoteId: "quote-1",
  quoteRevisionId: "quote-version-4",
  eventWindow: {
    startAtISO: "2026-08-18T20:00:00.000Z",
    endAtISO: "2026-08-19T03:00:00.000Z"
  },
  event: {
    name: "Smith Wedding",
    date: "2026-08-18",
    venue: "The Glass House",
    venueAddress: "Austin, TX",
    guests: 120,
    style: "Plated"
  },
  selection: { packageName: "Evening celebration", menuItemNames: ["Dinner service"] },
  coverage: { state: "covered", gaps: {} }
});

describe("staff briefing handoff", () => {
  test("binds the sheet to exact staffing and quote revisions with role-relevant details", () => {
    const briefing = buildStaffBriefing({ entry, assignment, organizationName: "Smith Catering" });
    expect(briefing).toMatchObject({
      recipientEmail: "avery@example.com",
      roleLabel: "Server",
      eventName: "Smith Wedding",
      assignmentRevision: 3,
      quoteRevisionId: "quote-version-4",
      reportingLocation: "Loading entrance"
    });
    expect(briefing.roleSpecific).toContainEqual(["Service style", "Plated"]);
    expect(briefing.boundary).toMatch(/does not prove sending, delivery, acknowledgement/i);
  });

  test("creates a prefilled default-email handoff without claiming delivery", () => {
    const email = buildStaffBriefingEmail(buildStaffBriefing({ entry, assignment }));
    expect(email.to).toBe("avery@example.com");
    expect(email.subject).toContain("Smith Wedding");
    expect(decodeURIComponent(email.href)).toContain("Please reply to confirm");
    expect(email.evidence).toBe("email_app_open_requested");
  });

  test("rejects missing or invalid recipients", () => {
    expect(() => buildDefaultEmailAppHandoff({ to: "not-an-email" })).toThrow(/valid email/i);
    expect(() => buildStaffBriefingEmail(buildStaffBriefing({
      entry: { ...entry, record: { ...entry.record, contact: { email: "" } } },
      assignment
    }))).toThrow(/email address/i);
  });

  test("opens the print sheet without noopener's false blocked-popup result", () => {
    const popup = { opener: {} };
    const openWindow = vi.fn(() => popup);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:staff-briefing");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    const result = exportStaffBriefingSheet(buildStaffBriefing({ entry, assignment }), {
      output: "print",
      openWindow
    });

    expect(openWindow).toHaveBeenCalledWith("blob:staff-briefing", "_blank");
    expect(popup.opener).toBeNull();
    expect(result).toMatchObject({ printPreviewOpened: true });
  });
});
