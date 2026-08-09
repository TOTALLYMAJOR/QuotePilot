import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { StaffProposalPreview } from "../CustomerWorkspaceView";

describe("StaffProposalPreview", () => {
  test("keeps tenant presentation branding inside a customer-presentation boundary", () => {
    const markup = renderToStaticMarkup(
      <StaffProposalPreview
        quote={{
          id: "quote-1",
          quoteNumber: "Q-1001",
          customer: { name: "Ada Lovelace" },
          event: { name: "Launch dinner", date: "2026-09-01", guests: 80 },
          totals: { subtotal: 9000, tax: 720, total: 9720, deposit: 2500 },
          quoteMeta: {
            organizationName: "Northstar Events LLC",
            brandName: "Northstar Catering",
            brandTagline: "Gather beautifully",
            brandLogoUrl: "https://cdn.example.test/logo.png",
            brandPrimaryColor: "#436b55",
            brandAccentColor: "#a7c4a0",
            brandDarkAccentColor: "#294536",
            brandBackgroundStart: "#f4f7f1",
            brandBackgroundMid: "#e1eadc",
            brandBackgroundEnd: "#d5e1cf",
            businessEmail: "hello@northstar.example",
            businessPhone: "205-555-0101"
          }
        }}
        onClose={vi.fn()}
      />
    );

    expect(markup).toContain('data-customer-presentation="true"');
    expect(markup).toContain('--portal-brand:#436b55');
    expect(markup).toContain('--portal-surface:#f4f7f1');
    expect(markup).toContain('src="https://cdn.example.test/logo.png"');
    expect(markup).toContain("Northstar Catering");
    expect(markup).toContain("Gather beautifully");
    expect(markup).toContain("Sep 1, 2026");
    expect(markup).not.toContain(">2026-09-01<");
    expect(markup).toContain("$9,720.00");
    expect(markup.indexOf("Close preview"))
      .toBeLessThan(markup.indexOf('data-customer-presentation="true"'));
  });

  test("keeps unsafe logo schemes out of the rendered preview", () => {
    const markup = renderToStaticMarkup(
      <StaffProposalPreview
        quote={{
          quoteNumber: "Q-1002",
          quoteMeta: {
            brandName: "Northstar Catering",
            brandLogoUrl: "javascript:alert(1)"
          }
        }}
        onClose={vi.fn()}
      />
    );

    expect(markup).not.toContain("javascript:");
    expect(markup).toContain("Close preview");
  });
});
