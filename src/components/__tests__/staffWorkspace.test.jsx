// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  getStaffDirectory: vi.fn(),
  saveStaffRecord: vi.fn(),
  previewStaffInvitation: vi.fn(),
  dispatchStaffInvitation: vi.fn()
}));

vi.mock("../../lib/staffDirectoryClient", async (importOriginal) => ({
  ...(await importOriginal()),
  getStaffDirectory: clientMocks.getStaffDirectory,
  saveStaffRecord: clientMocks.saveStaffRecord,
  previewStaffInvitation: clientMocks.previewStaffInvitation,
  dispatchStaffInvitation: clientMocks.dispatchStaffInvitation
}));

import StaffWorkspace from "../StaffWorkspace";
import { createStaffRecordDraft } from "../../lib/staffDirectoryClient";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function fixture() {
  const entry = createStaffRecordDraft({
    organizationId: "org-alpha",
    staffId: "staff-avery",
    displayName: "Avery Lane",
    capabilities: ["server"]
  });
  entry.record.preferredName = "Avery";
  entry.record.contact.email = "avery@example.com";
  entry.record.contact.emailStatus = "verified";
  entry.record.revision = 1;
  entry.record.compensation.hourlyRate = 27.5;
  return {
    ok: true,
    storage: "firebase",
    authorityVersion: "staff-directory-authority-v1",
    organizationId: "org-alpha",
    records: [entry],
    assignments: [{
      assignmentId: "assignment-1",
      staffId: "staff-avery",
      role: "server",
      state: "operator_confirmed",
      quoteId: "quote-1",
      quoteRevisionId: "version-2",
      planRevision: 3,
      eventWindow: {
        startAtISO: "2026-08-18T20:00:00.000Z",
        endAtISO: "2026-08-19T03:00:00.000Z"
      },
      event: { name: "Smith Wedding", date: "2026-08-18", venue: "The Glass House", guests: 120 },
      selection: { packageName: "Evening celebration", menuItemNames: ["Dinner service"] },
      coverage: { state: "covered", gaps: {} }
    }],
    invitations: []
  };
}

describe("StaffWorkspace", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    clientMocks.getStaffDirectory.mockResolvedValue(fixture());
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  test("opens the exact private staff record with role-safe briefing outcomes", async () => {
    await act(async () => {
      root.render(<StaffWorkspace organizationId="org-alpha" organizationName="Smith Catering" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(clientMocks.getStaffDirectory).toHaveBeenCalledWith({ organizationId: "org-alpha" });
    expect(container.querySelector('[data-capability-state="success"]')).not.toBeNull();
    expect(container.querySelector(".staff-command-bar h1")?.textContent).toBe("People");
    expect(container.textContent).toContain("Your event team");
    expect(container.textContent).toContain("Avery");
    expect(container.textContent).toContain("People");
    expect(container.textContent).toContain("Assigned today");
    expect(container.textContent).toContain("Next to complete");
    expect(container.querySelector(".staff-readiness-ledger")).not.toBeNull();
    expect(container.querySelector('input[placeholder="Find a teammate…"]')).not.toBeNull();
    expect(container.textContent).toContain("Next assignment");
    expect(container.textContent).toContain("Personal details");
    expect(container.textContent).toContain("Profile checklist");
    expect(container.textContent).toContain("Add availability to make scheduling easier");
    expect(container.textContent).toContain("A fresh start—team activity will appear here");
    expect(container.textContent).toContain("$27.50");
    expect(container.querySelector('[aria-label="Server"]')).not.toBeNull();
    expect(container.querySelector('svg[data-icon-weight="fill"]')?.getAttribute("stroke-width")).toBe("2.2");
    expect(container.textContent).toContain("Smith Wedding");
    expect(Array.from(container.querySelectorAll("button")).map((button) => button.textContent.trim()))
      .toEqual(expect.arrayContaining(["Review assignment", "View assignment", "Print sheet", "Download PDF", "Open email app", "Preview invitation"]));
    expect(container.querySelectorAll(".staff-roster li > button")).toHaveLength(1);
    expect(container.querySelector(".staff-evidence-rail")).not.toBeNull();
    expect(container.querySelector(".staff-editor-disclosure")?.hasAttribute("open")).toBe(false);
    expect(container.textContent).toContain("Not dispatched");
    expect(container.textContent).toContain("Awaiting staff response");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  test("requires preview before manual dispatch and separates provider acceptance from acknowledgement", async () => {
    const previewResult = {
      payload: {
        organizationId: "org-alpha",
        quoteId: "quote-1",
        staffId: "staff-avery",
        assignmentId: "assignment-1",
        expectedQuoteRevisionId: "version-2",
        expectedPlanRevision: 3,
        expectedRecordRevision: 1
      },
      dispatchRequestId: "staff-invitation:test-request-0001",
      preview: {
        invitationId: "sti_alpha",
        previewDigest: "a".repeat(64),
        recipient: { name: "Avery", email: "avery@example.com" },
        event: { name: "Smith Wedding", date: "2026-08-18", venue: "The Glass House" },
        role: "server",
        subject: "Smith Wedding staff invitation",
        textWithoutResponseLink: "Hi Avery, review this exact server assignment.",
        consequence: "Dispatch sends one invitation for this exact confirmed assignment.",
        doNothing: "Nothing is sent and the confirmed staffing plan remains unchanged."
      }
    };
    clientMocks.previewStaffInvitation.mockResolvedValue(previewResult);
    clientMocks.dispatchStaffInvitation.mockResolvedValue({
      ok: true,
      invitation: {
        invitationId: "sti_alpha",
        staffId: "staff-avery",
        assignmentId: "assignment-1",
        state: "provider_accepted",
        acknowledgement: { state: "pending", respondedAtISO: "", declineReason: "" }
      }
    });
    await act(async () => {
      root.render(<StaffWorkspace organizationId="org-alpha" organizationName="Smith Catering" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const previewButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent.includes("Preview invitation"));
    await act(async () => {
      previewButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(clientMocks.previewStaffInvitation).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-alpha",
      assignment: expect.objectContaining({ assignmentId: "assignment-1" })
    }));
    expect(clientMocks.dispatchStaffInvitation).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Nothing has been sent");
    expect(container.textContent).toContain("avery@example.com");

    const sendButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent.includes("Send invitation"));
    await act(async () => {
      sendButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(clientMocks.dispatchStaffInvitation).toHaveBeenCalledWith({ previewResult });
    expect(container.textContent).toContain("Provider accepted");
    expect(container.textContent).toContain("Awaiting staff response");
    expect(container.textContent).not.toContain("Delivered by provider");
  });

  test("returns a contextual unavailable state when no authoritative backend is connected", async () => {
    clientMocks.getStaffDirectory.mockResolvedValue({
      ...fixture(),
      ok: false,
      storage: "local",
      records: [],
      assignments: []
    });
    await act(async () => {
      root.render(<StaffWorkspace organizationId="org-alpha" organizationName="Smith Catering" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-capability-state="unavailable"]')).not.toBeNull();
    expect(container.textContent).toMatch(/connect your organization to start bringing the team together/i);
    expect(Array.from(container.querySelectorAll("button")).some((button) => button.textContent.includes("Refresh the team"))).toBe(true);
  });

  test("renders inactive and incomplete records without invented operational values", async () => {
    const inactive = createStaffRecordDraft({
      organizationId: "org-alpha",
      staffId: "staff-long-name",
      displayName: "Alexandria Montgomery-Washington",
      capabilities: ["bartender"]
    });
    inactive.profile.active = false;
    inactive.record.preferredName = "Alexandria Montgomery-Washington";
    inactive.record.compensation.hourlyRate = 0;
    clientMocks.getStaffDirectory.mockResolvedValue({
      ...fixture(),
      records: [inactive],
      assignments: [],
      invitations: []
    });

    await act(async () => {
      root.render(<StaffWorkspace organizationId="org-alpha" organizationName="Smith Catering" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Inactive");
    expect(container.textContent).toContain("Rate not configured");
    expect(container.textContent).toContain("Add availability to make scheduling easier");
    expect(container.textContent).toContain("No event assigned yet");
    expect(container.textContent).not.toContain("$0.00/hr");
  });

  test("marks loading and load failure without leaving a stale staff surface", async () => {
    let rejectLoad;
    clientMocks.getStaffDirectory.mockImplementation(() => new Promise((resolve, reject) => {
      rejectLoad = reject;
    }));

    act(() => {
      root.render(<StaffWorkspace organizationId="org-alpha" organizationName="Smith Catering" />);
    });
    expect(container.querySelector('[data-capability-state="loading"]')).not.toBeNull();

    await act(async () => {
      rejectLoad(new Error("Directory permission denied."));
      await Promise.resolve();
    });
    expect(container.querySelector('[data-capability-state="error"]')).not.toBeNull();
    expect(container.textContent).toContain("Directory permission denied.");
    expect(container.querySelector(".staff-record__identity")).toBeNull();
  });

  test("renders an honest empty roster and no-selected-staff state", async () => {
    clientMocks.getStaffDirectory.mockResolvedValue({
      ...fixture(),
      records: [],
      assignments: [],
      invitations: []
    });

    await act(async () => {
      root.render(<StaffWorkspace organizationId="org-alpha" organizationName="Smith Catering" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-capability-state="empty"]')).not.toBeNull();
    expect(container.textContent).toContain("Ready to welcome your first teammate.");
    expect(container.textContent).toContain("Choose a teammate or welcome someone new");
    expect(container.querySelector(".staff-readiness-ledger")).toBeNull();
  });

  test("search and filters expose honest no-results states", async () => {
    await act(async () => {
      root.render(<StaffWorkspace organizationId="org-alpha" organizationName="Smith Catering" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const search = container.querySelector('input[placeholder="Find a teammate…"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
        .set.call(search, "missing person");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).toContain("No teammates match this view yet.");

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
        .set.call(search, "");
      search.dispatchEvent(new Event("input", { bubbles: true }));
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent.trim() === "Available")
        .click();
    });
    expect(container.textContent).toContain("No teammates match this view yet.");
  });

  test("distinguishes explicit unavailability and withstands long operational values", async () => {
    const unavailable = createStaffRecordDraft({
      organizationId: "org-alpha",
      staffId: "staff-unavailable",
      displayName: "Alexandria Montgomery-Washington-Santiago",
      capabilities: ["server"]
    });
    unavailable.profile.capabilities = ["executive-banquet-captain-and-guest-experience-lead"];
    unavailable.profile.availabilityWindows = [{
      availabilityId: "availability-1",
      source: "operator_recorded",
      state: "unavailable",
      startAtISO: "2026-09-20T18:00:00.000Z",
      endAtISO: "2026-09-21T02:00:00.000Z"
    }];
    unavailable.record.preferredName = unavailable.profile.displayName;
    unavailable.record.contact.emailStatus = "verified";
    unavailable.record.contact.emergencyContactName = "Morgan Santiago";
    unavailable.record.contact.emergencyContactPhone = "+1 555 555 0100";
    unavailable.record.compensation.hourlyRate = 12345.67;
    unavailable.record.qualifications = [{
      qualificationId: "qualification-expired",
      type: "Advanced hospitality safety and event leadership credential",
      status: "expired",
      expiresOn: "2025-01-01"
    }];
    clientMocks.getStaffDirectory.mockResolvedValue({
      ...fixture(),
      records: [unavailable],
      assignments: [],
      invitations: []
    });

    await act(async () => {
      root.render(<StaffWorkspace organizationId="org-alpha" organizationName="Smith Catering" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Unavailable");
    expect(container.textContent).not.toContain("Add availability to make scheduling easier");
    expect(container.textContent).toContain("$12,345.67");
    expect(container.textContent).toContain("executive-banquet-captain-and-guest-experience-lead");
    expect(container.textContent).toContain("Expired");
    expect(container.querySelector(".staff-record__identity")).not.toBeNull();
  });

  test("clears detail safely when the selected employee disappears on refresh", async () => {
    clientMocks.getStaffDirectory
      .mockResolvedValueOnce(fixture())
      .mockResolvedValueOnce({ ...fixture(), organizationId: "org-beta", records: [], assignments: [], invitations: [] });

    await act(async () => {
      root.render(<StaffWorkspace organizationId="org-alpha" organizationName="Smith Catering" />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Avery");

    await act(async () => {
      root.render(<StaffWorkspace organizationId="org-beta" organizationName="Beta Catering" />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Choose a teammate or welcome someone new");
    expect(container.querySelector(".staff-record__identity")).toBeNull();
  });
});
