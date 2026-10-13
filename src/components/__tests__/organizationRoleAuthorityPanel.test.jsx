/* @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({
  getOrganizationRoleRoster: vi.fn(),
  mutateOrganizationRole: vi.fn(),
  getCurrentUserRecentAuthState: vi.fn(),
  getCurrentUserReauthenticationMethods: vi.fn(),
  reauthenticateCurrentUser: vi.fn()
}));

vi.mock("../../lib/organizationService", () => ({
  getOrganizationRoleRoster: serviceMocks.getOrganizationRoleRoster,
  mutateOrganizationRole: serviceMocks.mutateOrganizationRole
}));

vi.mock("../../lib/authClient", () => ({
  getCurrentUserRecentAuthState: serviceMocks.getCurrentUserRecentAuthState,
  getCurrentUserReauthenticationMethods: serviceMocks.getCurrentUserReauthenticationMethods,
  reauthenticateCurrentUser: serviceMocks.reauthenticateCurrentUser
}));

import OrganizationRoleAuthorityPanel from "../OrganizationRoleAuthorityPanel";

function findButton(container, label) {
  return Array.from(container.querySelectorAll("button"))
    .find((button) => button.textContent.includes(label));
}

async function openSalesPromotionReview(container) {
  await act(async () => findButton(container, "sales@example.com").click());
  await act(async () => findButton(container, "Review this access change").click());
}

describe("OrganizationRoleAuthorityPanel", () => {
  let container;
  let root;

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    serviceMocks.getOrganizationRoleRoster.mockReset().mockResolvedValue({
      ok: true,
      authority: "owner",
      appCheck: "monitoring",
      roles: [
        { uid: "owner-uid", email: "owner@example.com", role: "admin", owner: true },
        { uid: "sales-uid", email: "sales@example.com", role: "sales", owner: false }
      ]
    });
    serviceMocks.getCurrentUserRecentAuthState.mockReset().mockResolvedValue({
      recent: true,
      ageSeconds: 10,
      maxAgeSeconds: 300
    });
    serviceMocks.getCurrentUserReauthenticationMethods.mockReset().mockReturnValue(["password"]);
    serviceMocks.mutateOrganizationRole.mockReset().mockResolvedValue({
      ok: true,
      targetEmail: "sales@example.com",
      previousRole: "sales",
      nextRole: "admin",
      claimsSync: { succeeded: true, state: "succeeded" }
    });
    serviceMocks.reauthenticateCurrentUser.mockReset();
    vi.stubGlobal("crypto", { randomUUID: () => "role-authority-browser-0001" });
    await act(async () => {
      root.render(<OrganizationRoleAuthorityPanel />);
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  test("infers the exact current role, previews consequence and do-nothing state, then applies with a receipt", async () => {
    expect(container.textContent).toContain("Keep the right people close to the work");
    expect(container.textContent).toContain("monitoring before enforcement");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.innerHTML).toContain('data-capability-state="ready"');

    await openSalesPromotionReview(container);

    expect(container.textContent).toContain("Grant admin access for sales@example.com");
    expect(container.textContent).toContain("If you do nothing");
    expect(container.textContent).toContain("Sales remains unchanged");
    expect(container.textContent).toContain("Exact verified email + authoritative role record");

    await act(async () => findButton(container, "Grant admin access").click());

    expect(serviceMocks.mutateOrganizationRole).toHaveBeenCalledWith({
      requestId: "role-authority-browser-0001",
      targetEmail: "sales@example.com",
      expectedCurrentRole: "sales",
      nextRole: "admin"
    });
    expect(container.textContent).toContain("Admin is now authoritative for sales@example.com");
    expect(container.innerHTML).toContain('data-capability-state="receipt"');
  });

  test("gives every disabled authority control one visible blocker", async () => {
    const assertDisabledControlsDescribeVisibleBlockers = () => {
      const disabledControls = Array.from(container.querySelectorAll("button:disabled"));
      expect(disabledControls.length).toBeGreaterThan(0);
      for (const control of disabledControls) {
        const descriptionId = control.getAttribute("aria-describedby");
        expect(descriptionId, control.textContent).toBeTruthy();
        const description = container.querySelector(`#${descriptionId}`);
        expect(description, `${control.textContent} -> ${descriptionId}`).not.toBeNull();
        expect(description.textContent.trim(), descriptionId).not.toBe("");
        expect(description.hasAttribute("hidden"), descriptionId).toBe(false);
      }
    };

    assertDisabledControlsDescribeVisibleBlockers();
    expect(container.querySelector("#role-authority-protected-person").textContent)
      .toContain("owner record cannot be changed");
    expect(container.querySelector("#role-authority-prepare-blocker").textContent)
      .toContain("complete verified email address");

    await act(async () => findButton(container, "sales@example.com").click());
    assertDisabledControlsDescribeVisibleBlockers();
    expect(container.querySelector("#role-authority-outcome-blocker").textContent)
      .toContain("Sales is the current role");
  });

  test("marks submitting while the exact authority request is in flight", async () => {
    let resolveMutation;
    serviceMocks.mutateOrganizationRole.mockImplementationOnce(() => new Promise((resolve) => {
      resolveMutation = resolve;
    }));
    await openSalesPromotionReview(container);

    await act(async () => {
      findButton(container, "Grant admin access").click();
      await Promise.resolve();
    });
    expect(container.innerHTML).toContain('data-capability-state="submitting"');

    await act(async () => resolveMutation({
      ok: true,
      targetEmail: "sales@example.com",
      previousRole: "sales",
      nextRole: "admin",
      claimsSync: { succeeded: true, state: "succeeded" }
    }));
  });

  test("preserves an uncertain request and marks reconciliation before its replay receipt", async () => {
    let resolveReconciliation;
    serviceMocks.mutateOrganizationRole
      .mockRejectedValueOnce({ code: "functions/deadline-exceeded" })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveReconciliation = resolve;
      }));
    await openSalesPromotionReview(container);
    await act(async () => findButton(container, "Grant admin access").click());

    expect(container.innerHTML).toContain('data-capability-state="uncertain"');
    expect(container.textContent).toContain("exact access change");

    await act(async () => {
      findButton(container, "Check exact change").click();
      await Promise.resolve();
    });
    expect(container.innerHTML).toContain('data-capability-state="reconciliation"');

    await act(async () => resolveReconciliation({
      ok: true,
      targetEmail: "sales@example.com",
      previousRole: "sales",
      nextRole: "admin",
      claimsSync: { succeeded: true, state: "succeeded" }
    }));
    expect(container.textContent).toContain("Admin is now authoritative for sales@example.com");
  });

  test("marks a definitive error and keeps the prepared change in recovery", async () => {
    serviceMocks.mutateOrganizationRole.mockRejectedValueOnce({
      code: "functions/permission-denied",
      message: "Only the owner can grant admin access."
    });
    await openSalesPromotionReview(container);
    await act(async () => findButton(container, "Grant admin access").click());

    expect(container.innerHTML).toContain('data-capability-state="error"');
    expect(container.textContent).toContain("Only the owner can grant admin access.");

    await act(async () => findButton(container, "Return to this review").click());
    expect(container.innerHTML).toContain('data-capability-state="recovery"');
    expect(container.textContent).toContain("Nothing was discarded");
  });

  test("prefills an admin-safe removal when a non-owner admin selects a sales teammate", async () => {
    serviceMocks.getOrganizationRoleRoster.mockResolvedValueOnce({
      ok: true,
      authority: "admin",
      appCheck: "monitoring",
      roles: [{ uid: "sales-uid", email: "sales@example.com", role: "sales", owner: false }]
    });
    await act(async () => findButton(container, "Refresh team").click());
    await act(async () => findButton(container, "sales@example.com").click());

    expect(findButton(container, "Review this access change").disabled).toBe(false);
    await act(async () => findButton(container, "Review this access change").click());
    expect(container.textContent).toContain("Remove staff access for sales@example.com");
  });
});
