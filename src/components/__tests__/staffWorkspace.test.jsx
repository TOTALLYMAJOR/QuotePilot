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
    expect(container.textContent).toContain("Avery");
    expect(container.textContent).toContain("$27.50");
    expect(container.querySelector('[aria-label="Server"]')).not.toBeNull();
    expect(container.textContent).toContain("Smith Wedding");
    expect(Array.from(container.querySelectorAll("button")).map((button) => button.textContent.trim()))
      .toEqual(expect.arrayContaining(["Print sheet", "Download PDF", "Open email app", "Preview invitation"]));
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
    expect(container.textContent).toMatch(/connect to the organization workspace/i);
    expect(Array.from(container.querySelectorAll("button")).some((button) => button.textContent.includes("Refresh staff records"))).toBe(true);
  });
});
