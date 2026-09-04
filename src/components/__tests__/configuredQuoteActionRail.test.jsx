import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import ConfiguredQuoteActionRail from "../ConfiguredQuoteActionRail";

describe("ConfiguredQuoteActionRail", () => {
  test("keeps one ranked action outside More while grouping subordinate capabilities", () => {
    const markup = renderToStaticMarkup(
      <ConfiguredQuoteActionRail
        primaryActionId="send_quote"
        primaryAction={{ id: "send_quote", label: "Send proposal", visible: true, enabled: true }}
      >
        <small data-quote-action-kind="evidence">Delivery not recorded</small>
        <button
          type="button"
          data-quote-action-id="send_quote"
          data-quote-action-group="communication"
        >
          Send proposal
        </button>
        <>
          <button
            type="button"
            data-quote-action-id="duplicate"
            data-quote-action-group="quote"
          >
            Create alternate draft
          </button>
          <button
            type="button"
            data-quote-action-id="export_proposal"
            data-quote-action-group="proposal"
          >
            Download PDF
          </button>
        </>
      </ConfiguredQuoteActionRail>
    );

    expect(markup).toContain('data-configured-quote-actions="v1"');
    expect(markup).toContain('data-primary-action="send_quote"');
    expect(markup).toContain('aria-label="Recommended next action"');
    expect(markup).toContain('aria-label="Quote action evidence"');
    expect(markup).toContain("Delivery not recorded");
    expect(markup).toContain("<summary>More</summary>");
    expect(markup).toContain("Create alternate draft");
    expect(markup).toContain("Download PDF");
    expect(markup).toContain(">Quote<");
    expect(markup).toContain(">Proposal<");
    expect(markup.match(/Send proposal/g)).toHaveLength(1);
    expect(markup.indexOf("Delivery not recorded")).toBeLessThan(markup.indexOf("<summary>More</summary>"));
    expect(markup.indexOf(">Quote<")).toBeLessThan(markup.indexOf(">Proposal<"));
  });

  test("shows the compiler blocker rather than inventing a substitute primary action", () => {
    const markup = renderToStaticMarkup(
      <ConfiguredQuoteActionRail
        primaryActionId="request_deposit"
        primaryAction={{
          id: "request_deposit",
          label: "Request deposit",
          visible: true,
          enabled: false,
          disabledReason: "Approve the deposit request in Workflow first."
        }}
      >
        <button
          type="button"
          data-quote-action-id="duplicate"
          data-quote-action-group="quote"
        >
          Create alternate draft
        </button>
      </ConfiguredQuoteActionRail>
    );

    expect(markup).toContain("Request deposit");
    expect(markup).toContain("Approve the deposit request in Workflow first.");
    expect(markup).toContain("Create alternate draft");
    expect(markup).not.toContain('aria-label="Recommended next action"');
  });
});
