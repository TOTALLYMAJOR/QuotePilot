import { createRequire } from "node:module";
import fs from "node:fs";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  REQUIRED_TEMPLATE_VARIABLES_BY_KIND,
  RevenueAutopilotTemplateError,
  TEMPLATE_VARIABLES_BY_KIND,
  compileRevenueAutopilotTemplate,
  renderRevenueAutopilotTemplate
} = require("../../../functions/revenueAutopilotTemplates.js");

const TEMPLATE_SOURCE = fs.readFileSync(
  new URL("../../../functions/revenueAutopilotTemplates.js", import.meta.url),
  "utf8"
);

function quoteFollowUpTemplate(overrides = {}) {
  return {
    templateId: "follow-up-default",
    version: "v1",
    kind: "quote_follow_up",
    subject: "{{business_name}} proposal {{quote_number}}",
    text: [
      "Hi {{customer_name}},",
      "Review proposal {{quote_number}}: {{portal_url}}",
      "To stop reminders: {{unsubscribe_url}}",
      "— {{business_name}}"
    ].join("\n"),
    html: [
      "<p>Hi {{customer_name}},</p>",
      "<p>Review proposal <strong>{{quote_number}}</strong>:</p>",
      "<p><a href=\"{{portal_url}}\">Review proposal</a></p>",
      "<p><a href=\"{{unsubscribe_url}}\">Stop reminders</a></p>",
      "<p>{{business_name}}</p>"
    ].join(""),
    ...overrides
  };
}

function depositTemplate(overrides = {}) {
  return {
    templateId: "deposit-default",
    version: "v1",
    kind: "deposit_reminder",
    subject: "Deposit for {{quote_number}}",
    text: "Hi {{customer_name}}, {{business_name}} is requesting {{deposit_amount}} for {{quote_number}}. Pay at {{portal_url}}. Stop reminders: {{unsubscribe_url}}",
    html: "<p>Hi {{customer_name}},</p><p>{{business_name}} is requesting <strong>{{deposit_amount}}</strong> for {{quote_number}}.</p><p><a href=\"{{portal_url}}\">Pay securely</a></p><p><a href=\"{{unsubscribe_url}}\">Stop reminders</a></p>",
    ...overrides
  };
}

function finalBalanceTemplate(overrides = {}) {
  return {
    templateId: "final-balance-default",
    version: "v1",
    kind: "final_balance_reminder",
    subject: "Final balance for {{quote_number}}",
    text: "Hi {{customer_name}}, {{business_name}} is requesting {{final_balance_amount}} for your {{event_date}} event, quote {{quote_number}}. Pay at {{portal_url}}. Stop reminders: {{unsubscribe_url}}",
    html: "<p>Hi {{customer_name}},</p><p>{{business_name}} is requesting <strong>{{final_balance_amount}}</strong> for your {{event_date}} event, quote {{quote_number}}.</p><p><a href=\"{{portal_url}}\">Pay securely</a></p><p><a href=\"{{unsubscribe_url}}\">Stop reminders</a></p>",
    ...overrides
  };
}

function postEventReviewTemplate(overrides = {}) {
  return {
    templateId: "post-event-review-default",
    version: "v1",
    kind: "post_event_review_request",
    subject: "Thank you from {{business_name}}",
    text: "Hi {{customer_name}}, thank you for trusting {{business_name}} with your {{event_date}} event. Share a review: {{review_url}}. Stop email: {{unsubscribe_url}}",
    html: "<p>Hi {{customer_name}},</p><p>Thank you for trusting {{business_name}} with your {{event_date}} event.</p><p><a href=\"{{review_url}}\">Share a review</a></p><p><a href=\"{{unsubscribe_url}}\">Stop email</a></p>",
    ...overrides
  };
}

function commonValues(overrides = {}) {
  return {
    business_name: "Toni Catering",
    customer_name: "Jordan & Casey",
    event_date: "August 23, 2026",
    quote_number: "Q-260809-A",
    portal_url: "https://quotepilot.example/app?portal=opaque-token",
    unsubscribe_url: "https://quotepilot.example/app?unsubscribe=opaque-token",
    ...overrides
  };
}

describe("Revenue Autopilot strict templates", () => {
  test("publishes an explicit per-kind variable allowlist and required contract", () => {
    expect(TEMPLATE_VARIABLES_BY_KIND.quote_follow_up).not.toContain("deposit_amount");
    expect(TEMPLATE_VARIABLES_BY_KIND.deposit_reminder).toContain("deposit_amount");
    expect(TEMPLATE_VARIABLES_BY_KIND.final_balance_reminder).toContain("final_balance_amount");
    expect(TEMPLATE_VARIABLES_BY_KIND.post_event_review_request).toContain("review_url");
    expect(TEMPLATE_VARIABLES_BY_KIND.post_event_review_request).not.toContain("portal_url");
    expect(REQUIRED_TEMPLATE_VARIABLES_BY_KIND.quote_follow_up).toEqual(expect.arrayContaining([
      "business_name",
      "customer_name",
      "quote_number",
      "portal_url",
      "unsubscribe_url"
    ]));
  });

  test("compiles stable content fingerprints and changes them with version or content", () => {
    const first = compileRevenueAutopilotTemplate(quoteFollowUpTemplate());
    const repeated = compileRevenueAutopilotTemplate(quoteFollowUpTemplate());
    const newVersion = compileRevenueAutopilotTemplate(quoteFollowUpTemplate({ version: "v2" }));
    const newCopy = compileRevenueAutopilotTemplate(quoteFollowUpTemplate({
      subject: "A reminder from {{business_name}} for {{quote_number}}"
    }));
    expect(first).toEqual(repeated);
    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(first.fingerprint).not.toBe(newVersion.fingerprint);
    expect(first.fingerprint).not.toBe(newCopy.fingerprint);
    expect(first.variables).toEqual([
      "business_name",
      "customer_name",
      "portal_url",
      "quote_number",
      "unsubscribe_url"
    ]);
  });

  test("renders plain text and HTML with HTTPS links and escaped tenant/customer values", () => {
    const rendered = renderRevenueAutopilotTemplate(quoteFollowUpTemplate(), commonValues({
      business_name: "Toni <Catering>",
      customer_name: "Jordan & Casey",
      portal_url: "https://quotepilot.example/app?portal=abc&source=email"
    }));
    expect(rendered).toMatchObject({
      templateId: "follow-up-default",
      templateVersion: "v1",
      kind: "quote_follow_up",
      channel: "email",
      subject: "Toni <Catering> proposal Q-260809-A"
    });
    expect(rendered.text).toContain("Hi Jordan & Casey,");
    expect(rendered.html).toContain("Hi Jordan &amp; Casey,");
    expect(rendered.html).toContain("Toni &lt;Catering&gt;");
    expect(rendered.html).toContain("portal=abc&amp;source=email");
    expect(rendered.html).not.toContain("{{");
  });

  test.each([
    [depositTemplate(), { ...commonValues(), deposit_amount: "$1,250.00" }, "deposit_reminder"],
    [finalBalanceTemplate(), { ...commonValues(), final_balance_amount: "$3,750.00" }, "final_balance_reminder"]
  ])("renders the exact payment variable contract for %s", (template, values, kind) => {
    const rendered = renderRevenueAutopilotTemplate(template, values);
    expect(rendered.kind).toBe(kind);
    expect(rendered.text).not.toContain("{{");
    expect(rendered.html).not.toContain("{{");
  });

  test("renders a tenant-branded thank-you and review request without proposal or payment fields", () => {
    const compiled = compileRevenueAutopilotTemplate(postEventReviewTemplate());
    const rendered = renderRevenueAutopilotTemplate(
      postEventReviewTemplate(),
      {
        business_name: "Toni <Catering>",
        customer_name: "Alex & Sam",
        event_date: "September 1, 2026",
        review_url: "https://reviews.example/toni?source=closeout",
        unsubscribe_url: "https://quotepilot.example/app?unsubscribe=opaque-token"
      }
    );

    expect(compiled.variables).toEqual([
      "business_name",
      "customer_name",
      "event_date",
      "review_url",
      "unsubscribe_url"
    ]);
    expect(rendered).toMatchObject({
      kind: "post_event_review_request",
      subject: "Thank you from Toni <Catering>"
    });
    expect(rendered.html).toContain("Toni &lt;Catering&gt;");
    expect(rendered.html).toContain("source=closeout");
    expect(rendered.text).not.toContain("portal");
  });

  test("rejects unknown, cross-kind, malformed, and missing template variables", () => {
    expect(() => compileRevenueAutopilotTemplate(quoteFollowUpTemplate({
      text: `${quoteFollowUpTemplate().text} {{customer_secret}}`
    }))).toThrowError(/unsupported variables: customer_secret/i);
    expect(() => compileRevenueAutopilotTemplate(quoteFollowUpTemplate({
      text: `${quoteFollowUpTemplate().text} {{deposit_amount}}`
    }))).toThrowError(/unsupported variables: deposit_amount/i);
    expect(() => compileRevenueAutopilotTemplate(quoteFollowUpTemplate({
      text: quoteFollowUpTemplate().text.replace("{{customer_name}}", "{{ customer_name }}")
    }))).toThrowError(/malformed template syntax/i);
    expect(() => compileRevenueAutopilotTemplate(quoteFollowUpTemplate({
      text: quoteFollowUpTemplate().text.replace("{{unsubscribe_url}}", "") ,
      html: quoteFollowUpTemplate().html.replace("{{unsubscribe_url}}", "")
    }))).toThrowError(/missing required variables: unsubscribe_url/i);
    expect(() => compileRevenueAutopilotTemplate(quoteFollowUpTemplate({
      subject: "{{unsubscribe_url}}",
      text: quoteFollowUpTemplate().text.replace("{{unsubscribe_url}}", ""),
      html: quoteFollowUpTemplate().html.replace("{{unsubscribe_url}}", "")
    }))).toThrowError(/plain text is missing: unsubscribe_url.*HTML is missing: unsubscribe_url/i);
  });

  test.each([
    "<script>alert(1)</script>",
    "<img src=\"x\" onerror=\"alert(1)\">",
    "<a href=\"javascript:alert(1)\">Review</a>",
    "<iframe src=\"https://example.com\"></iframe>"
  ])("rejects active HTML content: %s", (unsafe) => {
    expect(() => compileRevenueAutopilotTemplate(quoteFollowUpTemplate({
      html: `${quoteFollowUpTemplate().html}${unsafe}`
    }))).toThrowError(/unsupported active content/i);
  });

  test("rejects missing values, unknown value fields, and non-HTTPS action URLs", () => {
    expect(() => renderRevenueAutopilotTemplate(
      quoteFollowUpTemplate(),
      { ...commonValues(), customer_name: "" }
    )).toThrowError(/customer_name is required/i);
    expect(() => renderRevenueAutopilotTemplate(
      quoteFollowUpTemplate(),
      { ...commonValues(), internal_note: "do not expose" }
    )).toThrowError(/unsupported fields: internal_note/i);
    expect(() => renderRevenueAutopilotTemplate(
      quoteFollowUpTemplate(),
      { ...commonValues(), portal_url: "http://quotepilot.example/app?portal=abc" }
    )).toThrowError(/portal_url must be an HTTPS URL/i);
    expect(() => renderRevenueAutopilotTemplate(
      quoteFollowUpTemplate(),
      { ...commonValues(), unsubscribe_url: "https://user:password@quotepilot.example/unsubscribe" }
    )).toThrowError(/without embedded credentials/i);
    expect(() => renderRevenueAutopilotTemplate(
      postEventReviewTemplate(),
      {
        business_name: "Toni Catering",
        customer_name: "Alex",
        event_date: "September 1, 2026",
        review_url: "http://reviews.example/toni",
        unsubscribe_url: "https://quotepilot.example/app?unsubscribe=opaque-token"
      }
    )).toThrowError(/review_url must be an HTTPS URL/i);
    expect(() => renderRevenueAutopilotTemplate(
      quoteFollowUpTemplate(),
      { ...commonValues(), business_name: "Toni Catering\r\nBcc: hidden@example.com" }
    )).toThrowError(/cannot contain line breaks/i);
  });

  test("rejects over-limit template content instead of silently truncating it", () => {
    expect(() => compileRevenueAutopilotTemplate(quoteFollowUpTemplate({
      subject: "x".repeat(201)
    }))).toThrowError(/subject exceeds its 200-character limit/i);
    expect(() => renderRevenueAutopilotTemplate(
      quoteFollowUpTemplate(),
      { ...commonValues(), customer_name: "x".repeat(501) }
    )).toThrowError(/customer_name exceeds its 500-character limit/i);
  });

  test("contains no provider, Firestore, or environment seam", () => {
    expect(TEMPLATE_SOURCE).not.toContain("fetch(");
    expect(TEMPLATE_SOURCE).not.toContain("firebase-admin");
    expect(TEMPLATE_SOURCE).not.toContain("process.env");
    expect(() => compileRevenueAutopilotTemplate({})).toThrowError(RevenueAutopilotTemplateError);
  });
});
