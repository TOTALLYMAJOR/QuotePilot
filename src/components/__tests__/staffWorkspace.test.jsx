// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  getStaffDirectory: vi.fn(),
  saveStaffRecord: vi.fn(),
  previewStaffInvitation: vi.fn(),
  dispatchStaffInvitation: vi.fn()
}));

const staffingMocks = vi.hoisted(() => ({
  buildOperationalStaffingRequestId: vi.fn(),
  configureOperationalStaffProfile: vi.fn(),
  resetDefinitiveOperationalStaffingAttempt: vi.fn()
}));

vi.mock("../../lib/staffDirectoryClient", async (importOriginal) => ({
  ...(await importOriginal()),
  getStaffDirectory: clientMocks.getStaffDirectory,
  saveStaffRecord: clientMocks.saveStaffRecord,
  previewStaffInvitation: clientMocks.previewStaffInvitation,
  dispatchStaffInvitation: clientMocks.dispatchStaffInvitation
}));

vi.mock("../../lib/operationalStaffingClient", async (importOriginal) => ({
  ...(await importOriginal()),
  buildOperationalStaffingRequestId: staffingMocks.buildOperationalStaffingRequestId,
  configureOperationalStaffProfile: staffingMocks.configureOperationalStaffProfile,
  resetDefinitiveOperationalStaffingAttempt: staffingMocks.resetDefinitiveOperationalStaffingAttempt
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
    staffingMocks.buildOperationalStaffingRequestId.mockReturnValue("staffing-configure-profile:test-request-0001");
    staffingMocks.configureOperationalStaffProfile.mockImplementation(async (command) => ({
      ok: true,
      idempotent: false,
      snapshot: {
        schemaVersion: 1,
        authority: "server_authoritative",
        authorityVersion: "operational-staffing-authority-v1",
        organizationId: command.organizationId,
        staffId: command.staffId,
        displayName: command.profile.displayName,
        active: command.profile.active,
        capabilities: [...command.profile.capabilities],
        availabilityWindows: [...command.profile.availabilityWindows],
        availabilityBoundary: "operator_recorded_not_staff_acknowledged",
        revision: 1
      },
      receipt: {
        receiptId: "staffing-receipt-profile-0001",
        requestId: command.requestId
      }
    }));
    staffingMocks.resetDefinitiveOperationalStaffingAttempt.mockReturnValue(true);
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
    expect(container.textContent).toContain("Profile maturity");
    expect(container.querySelector(".staff-readiness-ledger")).not.toBeNull();
    expect(container.querySelector('input[placeholder="Find a teammate…"]')).not.toBeNull();
    expect(container.textContent).toContain("Next assignment");
    expect(container.textContent).toContain("Personal details");
    expect(container.textContent).toContain("Independent facts");
    expect(container.textContent).toContain("Availability not recorded");
    expect(container.textContent).toContain("Qualifications not recorded");
    expect(container.textContent).toContain("A fresh start—team activity will appear here");
    expect(container.textContent).toContain("$27.50");
    expect(container.querySelector('[aria-label="Server"]')).not.toBeNull();
    expect(container.querySelector('svg[data-icon-weight="fill"]')?.getAttribute("stroke-width")).toBe("2.2");
    expect(container.textContent).toContain("Smith Wedding");
    const assignmentChoice = container.querySelector('.staff-briefing-actions [data-adaptive-choice-mode="single"]');
    expect(assignmentChoice).not.toBeNull();
    expect(assignmentChoice.querySelector("select")).toBeNull();
    expect(assignmentChoice.querySelector('[data-field-state-primary="confirmed"]')).not.toBeNull();
    expect(Array.from(container.querySelectorAll("button")).map((button) => button.textContent.trim()))
      .toEqual(expect.arrayContaining(["Review assignment", "View assignment", "Print sheet", "Download PDF", "Open email app", "Preview invitation"]));
    expect(container.querySelectorAll(".staff-roster li > button")).toHaveLength(1);
    expect(container.querySelector(".staff-evidence-rail")).not.toBeNull();
    expect(container.querySelector(".staff-editor-disclosure")?.hasAttribute("open")).toBe(false);
    expect(container.textContent).toContain("Not dispatched");
    expect(container.textContent).toContain("Awaiting staff response");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  test("adds Taylor Smith as an active roster member with only a name and Server role", async () => {
    await act(async () => {
      root.render(<StaffWorkspace organizationId="org-alpha" organizationName="Smith Catering" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent.trim() === "Add person")
        .click();
    });

    const quickAdd = container.querySelector(".staff-quick-add");
    const displayName = quickAdd.querySelector("input");
    expect(quickAdd).not.toBeNull();
    expect(container.querySelector(".staff-editor-disclosure")).toBeNull();
    expect(quickAdd.textContent).toContain("can be added later");

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
        .set.call(displayName, "Taylor Smith");
      displayName.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      quickAdd.querySelector(".staff-quick-add__submit").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const command = staffingMocks.configureOperationalStaffProfile.mock.calls[0][0];
    expect(command).toEqual({
      requestId: "staffing-configure-profile:test-request-0001",
      organizationId: "org-alpha",
      staffId: expect.stringMatching(/^staff-/u),
      expectedRevision: 0,
      profile: {
        displayName: "Taylor Smith",
        active: true,
        capabilities: ["server"],
        availabilityWindows: []
      }
    });
    expect(clientMocks.saveStaffRecord).not.toHaveBeenCalled();
    expect(container.querySelector('[data-capability-state="receipt"][data-staff-operation="create_profile"]')).not.toBeNull();
    expect(container.textContent).toContain("Taylor Smith is Active and Rostered");
    expect(container.textContent).toContain("Receipt staffing-receipt-profile-0001");
    expect(container.textContent).toContain("Contact not recorded");
    expect(container.textContent).toContain("Availability not recorded");
    expect(container.textContent).toContain("Rate not recorded");
    expect(container.textContent).toContain("Qualifications not recorded");
    expect(container.textContent).not.toMatch(/incomplete|needs attention|error/iu);
  });

  test("reconciles an uncertain roster save with the identical request and locked draft", async () => {
    staffingMocks.configureOperationalStaffProfile
      .mockRejectedValueOnce(Object.assign(new Error("Roster receipt timed out."), { code: "functions/unavailable" }))
      .mockImplementationOnce(async (command) => ({
        ok: true,
        idempotent: true,
        snapshot: {
          organizationId: command.organizationId,
          staffId: command.staffId,
          displayName: command.profile.displayName,
          active: true,
          capabilities: [...command.profile.capabilities],
          availabilityWindows: [],
          revision: 1
        },
        receipt: {
          receiptId: "staffing-receipt-profile-reconciled",
          requestId: command.requestId
        }
      }));

    await act(async () => {
      root.render(<StaffWorkspace organizationId="org-alpha" organizationName="Smith Catering" />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent.trim() === "Add person")
        .click();
    });
    const name = container.querySelector(".staff-quick-add input");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(name, "Jordan Reed");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector(".staff-quick-add__submit").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const original = staffingMocks.configureOperationalStaffProfile.mock.calls[0][0];
    expect(container.querySelector('[data-capability-state="uncertain"]')).not.toBeNull();
    expect(container.querySelector(".staff-quick-add input").disabled).toBe(true);
    expect(container.querySelector(".staff-quick-add__submit").disabled).toBe(true);
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Check previous roster save")
        .click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(staffingMocks.configureOperationalStaffProfile.mock.calls[1][0]).toBe(original);
    expect(container.textContent).toContain("Jordan Reed is Active and Rostered");
    expect(container.textContent).toContain("staffing-receipt-profile-reconciled");
  });

  async function expectDefinitiveRosterFailureCanBeCleared(code) {
      staffingMocks.buildOperationalStaffingRequestId
        .mockReturnValueOnce("staffing-configure-profile:definitive-request-0001")
        .mockReturnValueOnce("staffing-configure-profile:fresh-request-0002");
      staffingMocks.configureOperationalStaffProfile.mockRejectedValueOnce(
        Object.assign(new Error(`Definitive ${code} failure.`), { code: `functions/${code}` })
      );

      await act(async () => {
        root.render(<StaffWorkspace organizationId="org-alpha" organizationName="Smith Catering" />);
        await Promise.resolve();
        await Promise.resolve();
      });
      await act(async () => {
        Array.from(container.querySelectorAll("button"))
          .find((entry) => entry.textContent.trim() === "Add person")
          .click();
      });
      const name = container.querySelector(".staff-quick-add input");
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
          .set.call(name, "Morgan Lee");
        name.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => {
        container.querySelector(".staff-quick-add__submit").click();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(staffingMocks.configureOperationalStaffProfile).toHaveBeenCalledTimes(1);
      expect(container.querySelector('[data-staff-operation="create_profile"][data-capability-state="error"]'))
        .not.toBeNull();
      expect(container.querySelector(".staff-quick-add input").disabled).toBe(true);
      const clear = Array.from(container.querySelectorAll("button"))
        .find((entry) => entry.textContent === "Clear failed roster attempt");
      expect(clear).not.toBeUndefined();
      await act(async () => clear.click());

      expect(staffingMocks.resetDefinitiveOperationalStaffingAttempt).toHaveBeenCalledWith({
        operation: "configure_profile",
        organizationId: "org-alpha",
        staffId: expect.stringMatching(/^staff-/u),
        requestId: "staffing-configure-profile:definitive-request-0001"
      });
      expect(staffingMocks.configureOperationalStaffProfile).toHaveBeenCalledTimes(1);
      expect(container.querySelector(".staff-quick-add input").value).toBe("Morgan Lee");
      expect(container.querySelector(".staff-quick-add input").disabled).toBe(false);

      await act(async () => {
        container.querySelector(".staff-quick-add__submit").click();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(staffingMocks.configureOperationalStaffProfile).toHaveBeenCalledTimes(2);
      expect(staffingMocks.configureOperationalStaffProfile.mock.calls[1][0].requestId)
        .toBe("staffing-configure-profile:fresh-request-0002");
      expect(container.textContent).toContain("Morgan Lee is Active and Rostered");
  }

  test("clears a definitive aborted roster failure without replay, then submits a fresh request", async () => {
    await expectDefinitiveRosterFailureCanBeCleared("aborted");
    expect(staffingMocks.configureOperationalStaffProfile).toHaveBeenCalledTimes(2);
  });

  test("clears a definitive data-loss roster failure without replay, then submits a fresh request", async () => {
    await expectDefinitiveRosterFailureCanBeCleared("data-loss");
    expect(staffingMocks.configureOperationalStaffProfile).toHaveBeenCalledTimes(2);
  });

  test("keeps assignment selection interactive when a teammate has multiple events", async () => {
    const result = fixture();
    result.assignments[0] = {
      ...result.assignments[0],
      event: { ...result.assignments[0].event, date: "2026-09-20" },
      eventWindow: {
        startAtISO: "2026-09-20T20:00:00.000Z",
        endAtISO: "2026-09-21T03:00:00.000Z"
      }
    };
    result.assignments.push({
      ...result.assignments[0],
      assignmentId: "assignment-2",
      quoteId: "quote-2",
      quoteRevisionId: "version-1",
      event: { ...result.assignments[0].event, name: "Jones Gala", date: "2026-09-22" },
      eventWindow: {
        startAtISO: "2026-09-22T20:00:00.000Z",
        endAtISO: "2026-09-23T03:00:00.000Z"
      }
    });
    clientMocks.getStaffDirectory.mockResolvedValue(result);

    await act(async () => {
      root.render(<StaffWorkspace organizationId="org-alpha" organizationName="Smith Catering" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const assignmentSelect = container.querySelector(".staff-briefing-actions .staff-field select");
    expect(assignmentSelect).not.toBeNull();
    expect(assignmentSelect.querySelectorAll("option")).toHaveLength(2);
    expect(container.querySelector('.staff-briefing-actions [data-adaptive-choice-mode="single"]')).toBeNull();
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

  test("keeps a definitive staff save failure operation-specific and retries the retained draft", async () => {
    const savedEntry = fixture().records[0];
    clientMocks.saveStaffRecord
      .mockRejectedValueOnce(Object.assign(new Error("Your current role cannot save this staff record."), { code: "functions/permission-denied" }))
      .mockResolvedValueOnce({ entry: savedEntry });
    await act(async () => {
      root.render(<StaffWorkspace organizationId="org-alpha" organizationName="Smith Catering" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const name = container.querySelector('.staff-field input[value="Avery Lane"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(name, "Avery Lane Updated");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Save changes").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const failure = container.querySelector('[data-staff-operation="save_record"][data-capability-state="error"]');
    expect(failure).not.toBeNull();
    expect(failure.textContent).toContain("Your current role cannot save this staff record");
    expect(failure.textContent).toContain("The unsaved staff draft remains available");
    const retry = Array.from(failure.querySelectorAll("button")).find((button) => button.textContent === "Retry staff save");
    expect(retry).not.toBeUndefined();
    await act(async () => {
      retry.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(clientMocks.saveStaffRecord).toHaveBeenCalledTimes(2);
  });

  test("allows a failed read-only invitation preview to retry but never blind-retries an uncertain dispatch", async () => {
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
      dispatchRequestId: "staff-invitation:test-request-uncertain",
      preview: {
        invitationId: "sti_uncertain",
        previewDigest: "b".repeat(64),
        recipient: { name: "Avery", email: "avery@example.com" },
        subject: "Smith Wedding staff invitation",
        textWithoutResponseLink: "Hi Avery, review this assignment.",
        doNothing: "Nothing is sent."
      }
    };
    clientMocks.previewStaffInvitation
      .mockRejectedValueOnce(new Error("Preview service unavailable."))
      .mockResolvedValueOnce(previewResult);
    clientMocks.dispatchStaffInvitation.mockRejectedValueOnce(new Error("Provider response timed out."));
    await act(async () => {
      root.render(<StaffWorkspace organizationId="org-alpha" organizationName="Smith Catering" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      Array.from(container.querySelectorAll("button")).find((button) => button.textContent.includes("Preview invitation")).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const retryPreview = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Retry invitation preview");
    expect(retryPreview).not.toBeUndefined();
    await act(async () => {
      retryPreview.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      Array.from(container.querySelectorAll("button")).find((button) => button.textContent.includes("Send invitation")).click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(clientMocks.dispatchStaffInvitation).toHaveBeenCalledTimes(1);
    expect(Array.from(container.querySelectorAll("button")).some((button) => button.textContent.includes("Send invitation"))).toBe(false);
    expect(container.textContent).toContain("Do not send again");
    expect(container.textContent).toContain("contact support with the exact assignment");
    const refresh = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Refresh invitation status");
    expect(refresh).not.toBeUndefined();
    await act(async () => {
      refresh.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(clientMocks.getStaffDirectory).toHaveBeenCalledTimes(2);
    expect(Array.from(container.querySelectorAll("button")).some((button) => button.textContent.includes("Send invitation"))).toBe(false);
    expect(container.textContent).toContain("still does not establish the invitation provider outcome");
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

  test("renders inactive records and neutral optional-field absences without invented values", async () => {
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
    expect(container.textContent).toContain("Rate not recorded");
    expect(container.textContent).toContain("Availability not recorded");
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
        .find((button) => button.textContent.trim() === "Schedulable")
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
    expect(container.textContent).not.toContain("Availability not recorded");
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

  test("keeps role buttons, section links, and Manage rates perceivable across pointer and contrast modes", () => {
    const css = readFileSync(`${process.cwd()}/src/components/staffWorkspace.css`, "utf8");
    expect(css).toContain(".staff-role-icons > button:hover");
    expect(css).toContain(".staff-profile-tabs a:hover");
    expect(css).toContain(".staff-text-action:hover");
    expect(css).toContain(".staff-role-icons > button:focus-visible");
    expect(css).toContain(".staff-profile-tabs a:focus-visible");
    expect(css).toContain(".staff-text-action:focus-visible");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("@media (forced-colors: active)");
  });
});
