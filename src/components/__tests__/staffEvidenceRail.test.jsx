import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import StaffEvidenceRail, { buildStaffEvidenceRailModel } from "../StaffEvidenceRail";

describe("buildStaffEvidenceRailModel", () => {
  test("distinguishes loading, refreshing, partial, retained-stale, unavailable, bounded, and complete reads", () => {
    expect(buildStaffEvidenceRailModel({ loading: true }).state).toBe("loading");
    expect(buildStaffEvidenceRailModel({ loading: true, loadedAt: 1 }).state).toBe("refreshing");
    expect(buildStaffEvidenceRailModel({ partial: true }).state).toBe("partial");
    expect(buildStaffEvidenceRailModel({ error: "failed", loadedAt: 1 }).state).toBe("stale");
    expect(buildStaffEvidenceRailModel({ error: "failed" }).state).toBe("unavailable");
    expect(buildStaffEvidenceRailModel({ loadedAt: 1, truncated: true }).state).toBe("truncated");
    expect(buildStaffEvidenceRailModel({ loadedAt: 1 }).state).toBe("current");
  });
});

describe("StaffEvidenceRail", () => {
  test("binds scope, contract, source, timestamp, truncation, and proof caveat to the Home snapshot", () => {
    const markup = renderToStaticMarkup(
      <StaffEvidenceRail
        organizationName="Northstar Catering"
        organizationId="org-northstar"
        source="firebase"
        loadedAt={Date.parse("2026-08-09T15:30:00.000Z")}
        truncated
        truncationKnown
        reads={{ attention: { status: "success" }, history: { status: "success" } }}
      />
    );

    expect(markup).toContain('data-capability-state="truncated"');
    expect(markup).toContain('data-read-truncation="truncated"');
    expect(markup).toContain("Northstar Catering");
    expect(markup).toContain("Tenant key: org-northstar");
    expect(markup).toContain("Firestore staff records");
    expect(markup).toContain("latest 200 records");
    expect(markup).toContain("Derived staff presentation from canonical tenant quote records");
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("does not prove provider delivery, customer acceptance, booking, payment, or operational completion");
  });

  test("does not call browser-local fallback records canonical", () => {
    const markup = renderToStaticMarkup(
      <StaffEvidenceRail
        organizationName="Local workspace"
        organizationId="org-local"
        source="local"
        loadedAt={1}
        reads={{ attention: { status: "success" }, history: { status: "success" } }}
      />
    );

    expect(markup).toContain("Derived local presentation from browser-local quote records");
    expect(markup).not.toContain("canonical tenant quote records");
  });

  test("names which contract failed without claiming a complete refresh", () => {
    const markup = renderToStaticMarkup(
      <StaffEvidenceRail
        organizationName="Northstar Catering"
        organizationId="org-northstar"
        source="firebase"
        partial
        error="Quote history failed."
        reads={{ attention: { status: "success" }, history: { status: "error" } }}
      />
    );

    expect(markup).toContain('data-capability-state="partial"');
    expect(markup).toContain("No complete read yet");
    expect(markup).toContain('data-read-truncation="unknown"');
    expect(markup).toContain("Workflow attention completed; quote history did not complete.");
  });

  test("keeps a known history bound visible when a refresh is partial or stale", () => {
    const partialMarkup = renderToStaticMarkup(
      <StaffEvidenceRail
        organizationName="Northstar Catering"
        organizationId="org-northstar"
        source="firebase"
        partial
        truncated
        truncationKnown
        error="Quote history failed."
        reads={{ attention: { status: "success" }, history: { status: "error" } }}
      />
    );
    const staleMarkup = renderToStaticMarkup(
      <StaffEvidenceRail
        organizationName="Northstar Catering"
        organizationId="org-northstar"
        source="firebase"
        loadedAt={1}
        stale
        partial
        truncated
        truncationKnown
        error="Quote history failed."
        reads={{ attention: { status: "success" }, history: { status: "error" } }}
      />
    );

    expect(partialMarkup).toContain('data-capability-state="partial"');
    expect(partialMarkup).toContain('data-read-truncation="truncated"');
    expect(partialMarkup).toContain("Quote history is capped at the latest 200 records");
    expect(staleMarkup).toContain('data-capability-state="stale"');
    expect(staleMarkup).toContain('data-read-truncation="truncated"');
    expect(staleMarkup).toContain("completed but was not applied");
    expect(staleMarkup).toContain("prior complete snapshot remains visible");
    expect(staleMarkup).toContain("Quote history is capped at the latest 200 records");
  });

  test("reports pending read and truncation state during refresh", () => {
    const markup = renderToStaticMarkup(
      <StaffEvidenceRail
        organizationName="Northstar Catering"
        organizationId="org-northstar"
        source="firebase"
        loadedAt={1}
        loading
        reads={{ attention: { status: "loading" }, history: { status: "loading" } }}
      />
    );

    expect(markup).toContain('data-capability-state="refreshing"');
    expect(markup).toContain('data-read-truncation="unknown"');
    expect(markup).toContain("Waiting for the tenant reads to complete.");
  });

  test("names the central unread-reply read as part of the complete snapshot contract", () => {
    const completeMarkup = renderToStaticMarkup(
      <StaffEvidenceRail
        organizationName="Northstar Catering"
        organizationId="org-northstar"
        source="firebase"
        loadedAt={1}
        reads={{
          attention: { status: "success" },
          history: { status: "success" },
          unreadReplies: { status: "success" }
        }}
      />
    );
    const partialMarkup = renderToStaticMarkup(
      <StaffEvidenceRail
        organizationName="Northstar Catering"
        organizationId="org-northstar"
        source="firebase"
        partial
        error="Unread customer-reply Attention failed."
        reads={{
          attention: { status: "success" },
          history: { status: "success" },
          unreadReplies: { status: "error" }
        }}
      />
    );

    expect(completeMarkup).toContain("All three tenant reads completed.");
    expect(completeMarkup).toContain("unread customer-reply Attention projection");
    expect(partialMarkup).toContain("unread customer-reply Attention did not complete.");
    expect(partialMarkup).toContain('data-capability-state="partial"');
  });

  test("includes the optional Decision Debt read in Clear the Deck completeness", () => {
    const completeMarkup = renderToStaticMarkup(
      <StaffEvidenceRail
        source="firebase"
        loadedAt={1}
        reads={{
          attention: { status: "success" },
          history: { status: "success" },
          unreadReplies: { status: "success" },
          decisionDebt: { status: "success" }
        }}
      />
    );
    const partialMarkup = renderToStaticMarkup(
      <StaffEvidenceRail
        source="firebase"
        partial
        error="Decision Debt unavailable."
        reads={{
          attention: { status: "success" },
          history: { status: "success" },
          unreadReplies: { status: "success" },
          decisionDebt: { status: "error" }
        }}
      />
    );

    expect(completeMarkup).toContain("All four tenant reads completed.");
    expect(partialMarkup).toContain("Decision Debt did not complete.");
  });

  test("keeps the standard presentation as the default", () => {
    const markup = renderToStaticMarkup(
      <StaffEvidenceRail
        source="firebase"
        loadedAt={1}
        reads={{ attention: { status: "success" }, history: { status: "success" } }}
      />
    );

    expect(markup).toContain('data-staff-evidence-presentation="standard"');
    expect(markup).not.toContain("staff-evidence-rail--compact");
  });

  test.each([
    {
      label: "stale",
      props: { error: "Refresh failed.", loadedAt: 1, stale: true },
      state: "stale",
      warning: "The latest refresh did not complete. Visible retained data comes from the last complete read."
    },
    {
      label: "partial",
      props: { error: "Quote history failed.", partial: true },
      state: "partial",
      warning: "Some workspace sources refreshed, and at least one did not. A complete refresh was not recorded."
    },
    {
      label: "unavailable",
      props: { error: "Staff read failed." },
      state: "unavailable",
      warning: "No complete staff snapshot is available yet."
    },
    {
      label: "truncated",
      props: { loadedAt: 1, truncated: true, truncationKnown: true },
      state: "truncated",
      warning: "The tenant-scoped staff snapshot completed within a bounded quote-history window."
    }
  ])("keeps the $label warning and source boundaries in compact mode", ({ props, state, warning }) => {
    const markup = renderToStaticMarkup(
      <StaffEvidenceRail
        {...props}
        presentation="compact"
        organizationName="Northstar Catering"
        organizationId="org-northstar"
        source="firebase"
        reads={{ attention: { status: "success" }, history: { status: "error" } }}
      />
    );

    expect(markup).toContain("staff-evidence-rail--compact");
    expect(markup).toContain('data-staff-evidence-presentation="compact"');
    expect(markup).toContain(`data-capability-state="${state}"`);
    expect(markup).toContain(warning);
    expect(markup).toContain("Read details");
    expect(markup).toContain("Tenant key: org-northstar");
    expect(markup).toContain("does not prove provider delivery, customer acceptance, booking, payment, or operational completion");
  });

  test("keeps compact stale evidence visibly bounded", () => {
    const markup = renderToStaticMarkup(
      <StaffEvidenceRail
        presentation="compact"
        error="Refresh failed."
        loadedAt={1}
        stale
        source="firebase"
        reads={{ attention: { status: "success" }, history: { status: "error" } }}
      />
    );

    expect(markup).toContain('data-staff-evidence-presentation="compact"');
    expect(markup).toContain('data-capability-state="stale"');
    expect(markup).toContain("last complete read");
    expect(markup).toContain("does not prove provider delivery");
  });
});
