// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  respond: vi.fn()
}));

vi.mock("../../lib/staffInvitationClient", () => ({
  getPublicStaffInvitation: mocks.get,
  respondToPublicStaffInvitation: mocks.respond
}));

vi.mock("../ProductBrandLockup", () => ({ default: () => <div>QuotePilot</div> }));

import StaffInvitationResponsePage from "../StaffInvitationResponsePage";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function fixture() {
  return {
    ok: true,
    storage: "firebase",
    canRespond: true,
    expired: false,
    invitation: {
      invitationId: "sti_alpha",
      role: "server",
      acknowledgement: { state: "pending", respondedAtISO: "", declineReason: "" }
    },
    assignment: {
      recipientName: "Avery",
      role: "server",
      event: { name: "Smith Wedding", date: "2026-08-18", time: "4:00 PM", venue: "The Glass House", venueAddress: "100 Event Way" }
    }
  };
}

describe("StaffInvitationResponsePage", () => {
  let root;
  let container;

  beforeEach(() => {
    window.history.replaceState({}, "", "/staffing/respond?staffing=signed.token");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.get.mockResolvedValue(fixture());
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  test("shows exact assignment context and separate accept and decline outcomes", async () => {
    await act(async () => {
      root.render(<StaffInvitationResponsePage />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.get).toHaveBeenCalledWith("signed.token");
    expect(container.textContent).toContain("Smith Wedding");
    expect(container.textContent).toContain("The Glass House");
    expect(container.querySelector('[data-capability-state="ready"]')).not.toBeNull();
    expect(Array.from(container.querySelectorAll("button")).map((button) => button.textContent.trim()))
      .toEqual(["Accept assignment", "Decline assignment"]);
    expect(container.textContent).toContain("does not record attendance, hours, payroll");
  });

  test("records acceptance and replaces actions with a truthful receipt state", async () => {
    mocks.respond.mockResolvedValue({
      ok: true,
      storage: "firebase",
      acknowledgement: { state: "accepted", respondedAtISO: "2026-08-14T15:00:00.000Z", declineReason: "" }
    });
    await act(async () => {
      root.render(<StaffInvitationResponsePage />);
      await Promise.resolve();
      await Promise.resolve();
    });
    const accept = Array.from(container.querySelectorAll("button")).find((button) => button.textContent.includes("Accept assignment"));
    await act(async () => {
      accept.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.respond).toHaveBeenCalledWith("signed.token", "accepted", "");
    expect(container.querySelector('[data-capability-state="resolved"]')).not.toBeNull();
    expect(container.textContent).toContain("Your acceptance is recorded");
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});
