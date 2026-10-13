import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

const readStyle = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

describe("focused interaction affordance styles", () => {
  test("Quick Updates makes enabled actions responsive without animating disabled controls", () => {
    const css = readStyle("quickUpdatesPanel.css");

    expect(css).toContain("var(--motion-fast, 140ms)");
    expect(css).toContain(".ambient-quick-updates-trigger:hover:not(:disabled)");
    expect(css).toContain(".qup-primary:hover:not(:disabled)");
    expect(css).toContain(".qup-secondary:hover:not(:disabled)");
    expect(css).toContain(".qup-danger:hover:not(:disabled)");
    expect(css).toContain(".qup-accordion-trigger:hover:not(:disabled)");
    expect(css).toContain(".qup-library-action button:hover:not(:disabled)");
    expect(css).toMatch(/\.qup-danger:disabled[\s\S]*?transform: none;/);
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("@media (forced-colors: active)");
  });

  test("Operational Staffing preserves readable disabled states and accessible feedback", () => {
    const css = readStyle("operationalStaffingPanel.css");

    expect(css).toContain("var(--motion-fast, 140ms)");
    expect(css).toContain(".operational-staffing-primary:hover:not(:disabled)");
    expect(css).toContain(".operational-staffing-secondary:hover:not(:disabled)");
    expect(css).toContain(".operational-staffing-panel button:active:not(:disabled)");
    expect(css).toMatch(/\.operational-staffing-panel button:disabled,[\s\S]*?opacity: 1;[\s\S]*?transform: none;/);
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("@media (forced-colors: active)");
  });

  test("Staff Invitation owns a complete scoped danger action contract", () => {
    const css = readStyle("staffInvitationResponsePage.css");

    expect(css).toContain("var(--motion-fast, 140ms)");
    expect(css).toContain(".staff-invitation-page .danger {");
    expect(css).toContain(".staff-invitation-page .danger:hover:not(:disabled)");
    expect(css).toContain(".staff-invitation-page :is(.cta, .ghost, .danger):focus-visible");
    expect(css).toContain(".staff-invitation-page :is(.cta, .ghost, .danger):active:not(:disabled)");
    expect(css).toContain(".staff-invitation-page :is(.cta, .ghost, .danger):disabled");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("@media (forced-colors: active)");
  });

  test("the responsive system-navigation feature button exposes hover and keyboard focus", () => {
    const css = readFileSync(new URL("../../marketing.css", import.meta.url), "utf8");

    expect(css).toContain(".marketing-header-feature:hover");
    expect(css).toContain(".marketing-header-feature:focus-visible");
    expect(css).toMatch(/\.marketing-header-feature \{[^}]*transition:/);
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
