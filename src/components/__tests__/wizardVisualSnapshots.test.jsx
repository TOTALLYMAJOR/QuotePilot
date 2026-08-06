import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StepEvent, StepMenu, StepReview } from "../WizardSteps";
import { calculateQuote } from "../../lib/quoteCalculator";

const snapshotCatalog = {
  packages: [
    { id: "classic", name: "Classic", ppp: 18 },
    { id: "premium", name: "Premium", ppp: 24 }
  ],
  addons: [
    { id: "dessert", name: "Dessert", type: "per_person", price: 4 },
    { id: "coffee", name: "Coffee Station", type: "per_event", price: 95 }
  ],
  rentals: [
    { id: "linens", name: "Linens", price: 9, qtyPerGuests: 8 }
  ],
  settings: {
    quotePreparedBy: "Event Sales Team",
    quoteValidityDays: 30,
    acceptanceEmail: "events@acme.test",
    disposablesNote: "All disposables are included in this quote.",
    depositNotice: "30% deposit is required to lock in your date.",
    businessPhone: "(205) 555-0135",
    businessEmail: "events@acme.test",
    businessAddress: "6230 Eagle Ridge Cir, Pinson, AL 35126",
    perMileRate: 0.7,
    longDistancePerMileRate: 1.1,
    deliveryThresholdMiles: 30,
    serverRate: 22,
    chefRate: 28,
    bartenderRate: 30,
    serviceFeePct: 0.2,
    serviceFeeTiers: [
      { id: "small", minGuests: 0, maxGuests: 99, pct: 0.2 },
      { id: "large", minGuests: 100, maxGuests: 9999, pct: 0.18 }
    ],
    taxRate: 0.1,
    taxRegions: [{ id: "local", name: "Local", rate: 0.1 }],
    defaultTaxRegion: "local",
    seasonalProfiles: [
      {
        id: "standard",
        name: "Standard",
        startMonth: 1,
        startDay: 1,
        endMonth: 12,
        endDay: 31,
        packageMultiplier: 1,
        addonMultiplier: 1,
        rentalMultiplier: 1
      }
    ],
    eventTemplates: [
      {
        id: "wedding",
        name: "Wedding",
        style: "Plated",
        hours: 5,
        pkg: "premium",
        addons: ["dessert"],
        rentals: ["linens"],
        milesRT: 20,
        payMethod: "card",
        taxRegion: "local",
        seasonProfileId: "standard"
      }
    ],
    menuSections: [
      {
        id: "mains",
        name: "Mains",
        items: [
          { id: "smoked-ribs", name: "Smoked Ribs", type: "per_person", price: 6 },
          { id: "herb-chicken", name: "Herb Chicken", type: "per_person", price: 5 }
        ]
      },
      {
        id: "sides",
        name: "Sides",
        items: [
          { id: "garlic-mashed", name: "Garlic Mashed Potatoes", type: "per_event", price: 110 }
        ]
      }
    ],
    depositPct: 0.3
  }
};

const snapshotForm = {
  date: "2026-06-14",
  time: "18:30",
  hours: 5,
  servers: 10,
  chefs: 3,
  bartenders: 2,
  guests: 120,
  venue: "Birmingham Civic Hall",
  venueAddress: "123 Event Way, Birmingham, AL",
  eventName: "Summer Client Gala",
  dietaryRestrictions: "Shellfish allergy, no pork",
  clientOrg: "Civic Foundation",
  style: "Plated",
  name: "Jordan Lee",
  phone: "205-555-0162",
  email: "jordan@example.com",
  pkg: "premium",
  addons: ["dessert", "coffee"],
  rentals: ["linens"],
  menuItems: ["smoked-ribs", "garlic-mashed"],
  eventTemplateId: "wedding",
  taxRegion: "local",
  seasonProfileId: "standard",
  milesRT: 24,
  includeDisposables: true,
  depositLink: "",
  payMethod: "card"
};

function normalizeMarkup(markup) {
  return markup
    .replace(/\s+/g, " ")
    .replace(/> </g, "><")
    .replace(/Quote Date:<\/strong> [^<]+/g, "Quote Date:</strong> <QUOTE_DATE>")
    .replace(/Time of Event:<\/strong> [^<]+/g, "Time of Event:</strong> <EVENT_TIME>")
    .replace(/Date of Event:<\/strong> [^<]+/g, "Date of Event:</strong> <EVENT_DATE>")
    .trim();
}

describe("wizard visual snapshots", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-11T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("step event layout snapshot", () => {
    const markup = renderToStaticMarkup(
      <StepEvent
        form={snapshotForm}
        setForm={() => {}}
        styles={["Buffet", "Plated", "Stations"]}
        settings={snapshotCatalog.settings}
        onTemplateChange={() => {}}
      />
    );
    expect(normalizeMarkup(markup)).toMatchInlineSnapshot(`"<div class="event-step-layout"><section class="accordion-group open"><button type="button" class="accordion-trigger" aria-expanded="true" aria-controls="accordion-panel-core"><span><strong>Core Event Basics</strong><small>Required details used to unlock the guided flow</small></span><em>Hide</em></button><div id="accordion-panel-core" class="accordion-panel"><div class="grid two-col"><label class="field"><span>Event type<em class="field-required" aria-hidden="true">*</em></span><select aria-invalid="false"><option value="" selected="">No event types available</option></select></label><label class="field"><span>Event date<em class="field-required" aria-hidden="true">*</em></span><input type="date" aria-invalid="false" value="2026-06-14"/></label><label class="field"><span>Start time</span><input type="time" value="18:30"/></label><label class="field"><span>Event hours</span><div class="hours-control"><div class="hours-meta"><input type="number" min="1" max="12" aria-label="Event hours" value="5"/><output>5 hrs</output></div><input type="range" min="1" max="12" aria-label="Event hours slider" value="5"/></div></label><fieldset class="wizard-fieldset"><legend>Attendance &amp; staffing</legend><div class="grid two-col"><label class="field field-stepper"><span>Guests (max 400)<em class="field-required" aria-hidden="true">*</em></span><div class="stepper-input"><button type="button" class="ghost compact" aria-label="Decrease Guests (max 400)">-</button><input type="number" min="0" max="400" aria-label="Guests (max 400)" aria-invalid="false" value="120"/><button type="button" class="ghost compact" aria-label="Increase Guests (max 400)">+</button></div></label><label class="field field-stepper"><span>Servers</span><div class="stepper-input"><button type="button" class="ghost compact" aria-label="Decrease Servers">-</button><input type="number" min="0" max="30" aria-label="Servers" aria-invalid="false" value="10"/><button type="button" class="ghost compact" aria-label="Increase Servers">+</button></div></label><label class="field field-stepper"><span>Chefs</span><div class="stepper-input"><button type="button" class="ghost compact" aria-label="Decrease Chefs">-</button><input type="number" min="0" max="20" aria-label="Chefs" aria-invalid="false" value="3"/><button type="button" class="ghost compact" aria-label="Increase Chefs">+</button></div></label><label class="field field-stepper"><span>Bartenders</span><div class="stepper-input"><button type="button" class="ghost compact" aria-label="Decrease Bartenders">-</button><input type="number" min="0" max="20" aria-label="Bartenders" aria-invalid="false" value="2"/><button type="button" class="ghost compact" aria-label="Increase Bartenders">+</button></div></label></div></fieldset><label class="field"><span>Event name<em class="field-required" aria-hidden="true">*</em></span><input type="text" aria-invalid="false" value="Summer Client Gala"/></label><label class="field"><span>Venue<em class="field-required" aria-hidden="true">*</em></span><input type="text" aria-invalid="false" value="Birmingham Civic Hall"/></label><label class="field"><span>Venue address</span><input type="text" value="123 Event Way, Birmingham, AL"/></label><label class="field quote-sheet-meta-wide"><span>Dietary Restrictions</span><textarea placeholder="Allergies, no-pork/no-shellfish, vegetarian requests, kosher/halal notes, etc.">Shellfish allergy, no pork</textarea></label></div></div></section><section class="accordion-group open"><button type="button" class="accordion-trigger" aria-expanded="true" aria-controls="accordion-panel-contact"><span><strong>Client Contact</strong><small>Required contact details for proposal delivery</small></span><em>Hide</em></button><div id="accordion-panel-contact" class="accordion-panel"><div class="grid two-col"><label class="field"><span>Your name<em class="field-required" aria-hidden="true">*</em></span><input type="text" aria-invalid="false" value="Jordan Lee"/></label><label class="field"><span>Client / Organization</span><input type="text" value="Civic Foundation"/></label><label class="field"><span>Phone</span><input type="tel" value="205-555-0162"/></label><label class="field"><span>Email<em class="field-required" aria-hidden="true">*</em></span><input type="email" aria-invalid="false" value="jordan@example.com"/></label></div></div></section><section class="accordion-group"><button type="button" class="accordion-trigger" aria-expanded="false" aria-controls="accordion-panel-advancedPricing"><span><strong>Advanced Pricing Overrides</strong><small>Optional templates, seasonality, tax, and staffing rates</small></span><em>Show</em></button><p class="accordion-collapsed-helper">Leave closed to use approved admin pricing and automatic defaults.</p></section></div>"`);
  });

  test("step event calls out hidden staffing rate values", () => {
    const markup = renderToStaticMarkup(
      <StepEvent
        form={{
          ...snapshotForm,
          serverRateMixCsv: "31, 33",
          bartenderRateOverride: "48"
        }}
        setForm={() => {}}
        styles={["Buffet", "Plated", "Stations"]}
        settings={snapshotCatalog.settings}
        onTemplateChange={() => {}}
      />
    );

    expect(markup).toContain("accordion-group has-attention");
    expect(markup).toContain("Staffing rate values are set on this quote");
    expect(markup).not.toContain("Server rate override (optional)");
  });

  test("step menu layout snapshot", () => {
    const markup = renderToStaticMarkup(
      <StepMenu
        form={snapshotForm}
        setForm={() => {}}
        catalog={snapshotCatalog}
        recommendations={[
          {
            key: "upgrade-deluxe",
            kind: "package",
            id: "premium",
            label: "Upgrade to Premium",
            reason: "Best fit for plated service with 100+ guests.",
            impact: "+$6 per guest"
          }
        ]}
        onApplyRecommendation={() => {}}
        menuSections={snapshotCatalog.settings.menuSections}
      />
    );
    expect(normalizeMarkup(markup)).toMatchInlineSnapshot(`"<div class="grid two-col"><div class="menu-library"><h4>Customized Cuisine Menu</h4><p class="source-note">Select menu items to include in this quote proposal.</p><div class="menu-grid"><section class="menu-category"><div class="menu-category-head"><strong>Mains</strong><small>1/2</small></div><div class="checklist"><label class="checkrow checkrow-quantity"><input type="checkbox" checked=""/><span>Smoked Ribs</span><small>$6.00/person</small></label><label class="checkrow checkrow-quantity"><input type="checkbox"/><span>Herb Chicken</span><small>$5.00/person</small></label></div></section><section class="menu-category"><div class="menu-category-head"><strong>Sides</strong><small>1/1</small></div><div class="checklist"><label class="checkrow checkrow-quantity"><input type="checkbox" checked=""/><span>Garlic Mashed Potatoes</span><small>$110.00</small></label></div></section></div></div></div>"`);
  });

  test("step menu exposes distinct loading, error, and role-aware empty states", () => {
    const common = {
      form: snapshotForm,
      setForm: () => {},
      catalog: snapshotCatalog,
      menuSections: [],
      eventTypeLabel: "Wedding",
      onRetry: () => {},
      onOpenCatalogMenu: () => {}
    };
    const loadingMarkup = renderToStaticMarkup(<StepMenu {...common} menuLoading />);
    expect(loadingMarkup).toContain('aria-busy="true"');
    expect(loadingMarkup.match(/menu-skeleton-row/g)).toHaveLength(3);

    const errorMarkup = renderToStaticMarkup(<StepMenu {...common} menuError="offline" />);
    expect(errorMarkup).toContain('role="alert"');
    expect(errorMarkup).toContain("Retry");
    expect(errorMarkup).toContain("Wedding");

    const adminEmptyMarkup = renderToStaticMarkup(<StepMenu {...common} isAdmin />);
    expect(adminEmptyMarkup).toContain("No menu items are configured for Wedding yet.");
    expect(adminEmptyMarkup).toContain("Add menu items");

    const salesEmptyMarkup = renderToStaticMarkup(<StepMenu {...common} isAdmin={false} />);
    expect(salesEmptyMarkup).toContain("Ask your admin to add menu items.");
    expect(salesEmptyMarkup).not.toContain("Add menu items");
  });

  test("step review proposal sheet snapshot", () => {
    const totals = calculateQuote(snapshotForm, snapshotCatalog, snapshotCatalog.settings);
    const markup = renderToStaticMarkup(
      <StepReview
        form={snapshotForm}
        totals={totals}
        settings={snapshotCatalog.settings}
      />
    );
    expect(normalizeMarkup(markup)).toMatchInlineSnapshot(`"<div class="review"><article class="quote-sheet"><h2>Catering Quote</h2><div class="quote-sheet-meta"><p><strong>Quote Date:</strong> <QUOTE_DATE></p><p class="quote-sheet-meta-wide"><strong>Responsible Party / Client:</strong> Jordan Lee / Civic Foundation</p><p><strong>Phone #:</strong> 205-555-0162</p><p><strong>Email Address:</strong> jordan@example.com</p><p><strong># of Guests:</strong> 120</p><p><strong>Time of Event:</strong> <EVENT_TIME></p><p><strong>Name of Event:</strong> Summer Client Gala</p><p><strong>Date of Event:</strong> <EVENT_DATE></p><p class="quote-sheet-meta-wide"><strong>Event Location:</strong> Birmingham Civic Hall</p><p class="quote-sheet-meta-wide"><strong>Venue Address:</strong> 123 Event Way, Birmingham, AL</p><p class="quote-sheet-meta-wide"><strong>Dietary Restrictions:</strong> Shellfish allergy, no pork</p></div><section class="quote-sheet-menu"><h3>Menu</h3><p>Smoked Ribs, Garlic Mashed Potatoes</p></section><section class="quote-sheet-charges"><div class="quote-charge"><span>Per Person: $24.00 x (120)</span><strong>$2880.00</strong></div><div class="quote-charge"><span>Tax: (10%)</span><strong>$539.75</strong></div><div class="quote-charge"><span>Staffing</span><strong>$1520.00</strong></div><div class="quote-charge"><span>Travel Fee</span><strong>$16.80</strong></div><div class="quote-charge"><span>Bartender</span><strong>$300.00</strong></div><div class="quote-charge quote-charge-wide"><span>Staffing team</span><strong>10 servers · 3 chefs · 2 bartenders</strong></div><div class="quote-charge"><span>Service charge (18%)</span><strong>$1103.54</strong></div><div class="quote-charge quote-charge-wide"><span>Add-ons/Rentals/Menu</span><strong>$1414.00</strong></div></section><p class="quote-center-note"><strong>All disposables are included in this quote.</strong></p><p class="quote-total-line">TOTAL: <strong>$7774.10</strong></p><div class="quote-sheet-bottom"><p><strong>Quote prepared by:</strong> Event Sales Team</p><p><strong>Quote is valid for 30 days.</strong></p></div><p class="quote-acceptance">To accept quote, please sign and return to events@acme.test</p><p class="quote-deposit-tag"><strong>30% deposit is required to lock in your date.</strong></p><p class="quote-contact-strip">6230 Eagle Ridge Cir, Pinson, AL 35126 • (205) 555-0135 • events@acme.test</p></article><div class="summary-total"><p>Deposit (30%): <strong>$2332.23</strong></p></div></div>"`);
  });
});
