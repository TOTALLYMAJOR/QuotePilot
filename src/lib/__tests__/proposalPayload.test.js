import { describe, expect, test } from "vitest";
import { buildProposalPayload, buildQuoteEmailPayload } from "../proposalPayload";
import { proposalPayloadFixtureQuote } from "./fixtures/proposalPayloadFixture";

describe("proposal payload snapshots", () => {
  test("buildProposalPayload returns normalized branded payload", () => {
    const payload = buildProposalPayload(proposalPayloadFixtureQuote);
    expect(payload.selection.packageInclusions).toEqual({
      menuItems: ["Chef-selected entrée"],
      addons: ["Tea service"],
      rentals: ["Chafing set"]
    });

    expect({
      quoteNumber: payload.quoteNumber,
      createdOn: payload.createdOn,
      expiresOn: payload.expiresOn,
      branding: payload.branding,
      customer: payload.customer,
      event: payload.event,
      selection: {
        serverRateMixCsv: payload.selection.serverRateMixCsv,
        chefRateMixCsv: payload.selection.chefRateMixCsv
      },
      totals: {
        total: payload.totals.total,
        deposit: payload.totals.deposit,
        serverLabor: payload.totals.serverLabor,
        chefLabor: payload.totals.chefLabor,
        serverRatesApplied: payload.totals.serverRatesApplied,
        chefRatesApplied: payload.totals.chefRatesApplied,
        taxRateApplied: payload.totals.taxRateApplied,
        taxRegionName: payload.totals.taxRegionName,
        seasonProfileName: payload.totals.seasonProfileName
      },
      meta: {
        acceptanceEmail: payload.meta.acceptanceEmail,
        documentFontScale: payload.meta.documentFontScale,
        documentFontScaleLabel: payload.meta.documentFontScaleLabel,
        documentFontScaleValue: payload.meta.documentFontScaleValue,
        quotePreparedBy: payload.meta.quotePreparedBy,
        includeDisposables: payload.meta.includeDisposables,
        quoteValidityDays: payload.meta.quoteValidityDays
      }
    }).toMatchInlineSnapshot(`
      {
        "branding": {
          "brandName": "Acme Events Catering",
          "brandTagline": "Bold Southern Flavor",
          "crewMembers": [
            {
              "imagePath": "/brand/custom-crew.png",
              "label": "Culinary Lead",
            },
          ],
          "logoPath": "/brand/custom-logo.png",
          "title": "Acme Events Catering Proposal",
        },
        "createdOn": "2026-03-10",
        "customer": {
          "email": "jordan@example.com",
          "name": "Jordan Lee",
          "organization": "Lee Family Foundation",
          "phone": "205-555-0162",
        },
        "event": {
          "bartenders": 2,
          "chefs": 3,
          "date": "2026-04-20",
          "dietaryRestrictions": "Nut allergy, vegetarian option for 12 guests",
          "guests": 120,
          "hours": 5,
          "name": "Spring Gala",
          "servers": 8,
          "style": "Plated",
          "time": "18:00",
          "venue": "Pine Hall",
          "venueAddress": "123 Garden Ave, Birmingham, AL",
        },
        "expiresOn": "2026-04-09",
        "meta": {
          "acceptanceEmail": "events@acme.test",
          "documentFontScale": "large",
          "documentFontScaleLabel": "Large",
          "documentFontScaleValue": 1.12,
          "includeDisposables": true,
          "quotePreparedBy": "Alex Rivera",
          "quoteValidityDays": 30,
        },
        "quoteNumber": "Q-2026-0042",
        "selection": {
          "chefRateMixCsv": "60,65,70",
          "serverRateMixCsv": "25,30,30,35",
        },
        "totals": {
          "chefLabor": 975,
          "chefRatesApplied": [
            60,
            65,
            70,
          ],
          "deposit": 2513.76,
          "seasonProfileName": "Summer Peak",
          "serverLabor": 625,
          "serverRatesApplied": [
            25,
            30,
            30,
            35,
            35,
          ],
          "taxRateApplied": 0.1,
          "taxRegionName": "Local",
          "total": 8379.21,
        },
      }
    `);
  });

  test("buildQuoteEmailPayload keeps messaging aligned with proposal branding", () => {
    const email = buildQuoteEmailPayload(proposalPayloadFixtureQuote);

    expect({
      subject: email.subject,
      body: email.body
    }).toMatchInlineSnapshot(`
      {
        "body": "Hi Jordan Lee,
      Thank you for considering Acme Events Catering for Spring Gala on 2026-04-20 at Pine Hall.
      Your quote (Q-2026-0042) total is $8379.21.
      To reserve your date, the deposit due is $2513.76.
      Deposit payment link: https://checkout.stripe.com/c/pay/cs_test_q_2026_0042
      This quote is valid through 2026-04-09.
      Please reply with any questions or requested adjustments.
      Alex Rivera",
        "subject": "Acme Events Catering Quote Q-2026-0042 - 2026-04-20",
      }
    `);
  });

  test("falls back to defaults when branding data is missing", () => {
    const email = buildQuoteEmailPayload({
      quoteNumber: "Q-1",
      customer: {},
      event: { date: "2026-05-01" },
      totals: { total: 0, deposit: 0 },
      payment: {},
      quoteMeta: {}
    });

    expect(email.subject).toBe("Quote Q-1 - 2026-05-01");
    expect(email.body).toContain("Thank you for considering us");
    expect(email.body).toContain("The catering team");
    expect(email.body).not.toContain("QuotePilot");
  });

  test("uses the tenant organization name when custom branding is blank", () => {
    const email = buildQuoteEmailPayload({
      quoteNumber: "Q-2",
      customer: {},
      event: { date: "2026-05-02" },
      totals: { total: 0, deposit: 0 },
      payment: {},
      quoteMeta: { organizationName: "Northstar Catering", brandName: "" }
    });

    expect(email.subject).toBe("Northstar Catering Quote Q-2 - 2026-05-02");
    expect(email.body).toContain("Thank you for considering Northstar Catering");
    expect(email.body).not.toContain("QuotePilot");
  });

  test("includes the acceptance portal link when the caller marks the quote portal-shareable", () => {
    const email = buildQuoteEmailPayload(
      { ...proposalPayloadFixtureQuote, portalKey: "fixture-portal-key-1234567890" },
      { basePortalUrl: "https://app.example.test", includePortalLink: true }
    );

    expect(email.body).toContain(
      "Review and accept your quote: https://app.example.test?portal=fixture-portal-key-1234567890"
    );
  });

  test("omits the portal link unless the caller marks the quote portal-shareable", () => {
    const stillShareable = buildQuoteEmailPayload(
      { ...proposalPayloadFixtureQuote, portalKey: "fixture-portal-key-1234567890" },
      { basePortalUrl: "https://app.example.test", includePortalLink: false }
    );
    const noBaseUrl = buildQuoteEmailPayload(
      { ...proposalPayloadFixtureQuote, portalKey: "fixture-portal-key-1234567890" },
      { includePortalLink: true }
    );

    expect(stillShareable.body).not.toContain("Review and accept your quote");
    expect(noBaseUrl.body).not.toContain("Review and accept your quote");
  });

  test("removes unapproved stored payment links from customer-facing artifacts", () => {
    const unsafeQuote = {
      ...proposalPayloadFixtureQuote,
      payment: {
        ...proposalPayloadFixtureQuote.payment,
        depositLink: "https://checkout.stripe.com.evil.test/phishing"
      }
    };

    const proposal = buildProposalPayload(unsafeQuote);
    const email = buildQuoteEmailPayload(unsafeQuote);

    expect(proposal.payment.depositLink).toBe("");
    expect(email.body).not.toContain("evil.test");
    expect(email.body).toContain("Reply to this email if you need a payment link.");
  });
});
