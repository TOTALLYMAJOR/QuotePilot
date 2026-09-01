import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import BusinessSetupCenter from "../BusinessSetupCenter";

describe("BusinessSetupCenter", () => {
  test("renders the ordered setup truth and read-only sales next actions", () => {
    const html = renderToStaticMarkup(<BusinessSetupCenter
      currentUserRole="sales"
      catalog={{ source: "firebase", packages: [], eventTypes: [], settings: { menuSections: [] } }}
    />);
    expect(html).toContain('data-capability-id="business-setup-readiness"');
    expect(html).toContain("Business Setup Center");
    expect(html.indexOf("Identity")).toBeLessThan(html.indexOf("Offerings"));
    expect(html).toContain("Ask an administrator");
    expect(html).toContain("Unavailable by policy");
  });
});
