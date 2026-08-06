export const proposalPayloadFixtureQuote = {
  id: "fixture-quote-1",
  quoteNumber: "Q-2026-0042",
  status: "sent",
  createdAtISO: "2026-03-10T15:30:00.000Z",
  expiresAtISO: "2026-04-09T15:30:00.000Z",
  customer: {
    name: "Jordan Lee",
    email: "jordan@example.com",
    phone: "205-555-0162",
    organization: "Lee Family Foundation"
  },
  event: {
    name: "Spring Gala",
    date: "2026-04-20",
    time: "18:00",
    venue: "Pine Hall",
    venueAddress: "123 Garden Ave, Birmingham, AL",
    guests: 120,
    hours: 5,
    servers: 8,
    chefs: 3,
    bartenders: 2,
    dietaryRestrictions: "Nut allergy, vegetarian option for 12 guests",
    style: "Plated"
  },
  selection: {
    packageId: "deluxe",
    packageName: "Deluxe",
    addons: ["Dessert", "Coffee Station"],
    rentals: ["Linens"],
    menuItems: ["salad", "setup"],
    menuItemNames: ["Salad Bar", "Setup Fee"],
    milesRT: 36,
    payMethod: "card",
    taxRegion: "local",
    seasonProfileId: "summer_peak",
    eventTemplateId: "wedding",
    serverRateMixCsv: "25,30,30,35",
    chefRateMixCsv: "60,65,70"
  },
  payment: {
    depositLink: "https://checkout.stripe.com/c/pay/cs_test_q_2026_0042",
    depositStatus: "sent"
  },
  booking: {
    staffLead: "Jamie Chen",
    kitchenCheckpoints: [
      { id: "service-start", label: "Doors open", minuteOffset: -15 }
    ],
    productionChecklist: [
      {
        id: "event-brief",
        completed: true,
        completedAtISO: "2026-04-01T10:00:00.000Z",
        completedByEmail: "ops@acme.test"
      },
      {
        id: "menu-prep",
        completed: true,
        completedAtISO: "2026-04-05T09:00:00.000Z",
        completedByEmail: "chef@acme.test"
      }
    ]
  },
  totals: {
    base: 3888,
    addons: 463.5,
    rentals: 102,
    menu: 210,
    labor: 1900,
    serverLabor: 625,
    chefLabor: 975,
    serverRatesApplied: [25, 30, 30, 35, 35],
    chefRatesApplied: [60, 65, 70],
    bartenderLabor: 300,
    chefRateApplied: 65,
    travel: 49.2,
    serviceFee: 1191.24,
    tax: 575.27,
    total: 8379.21,
    deposit: 2513.76,
    serviceFeePctApplied: 0.18,
    taxRateApplied: 0.1,
    taxRegionId: "local",
    taxRegionName: "Local",
    seasonProfileId: "summer_peak",
    seasonProfileName: "Summer Peak",
    packageMultiplier: 1.08,
    addonMultiplier: 1.03,
    rentalMultiplier: 1.02
  },
  quoteMeta: {
    quotePreparedBy: "Alex Rivera",
    brandName: "Acme Events Catering",
    brandTagline: "Bold Southern Flavor",
    brandLogoUrl: "/brand/custom-logo.png",
    brandPrimaryColor: "#c99334",
    brandAccentColor: "#f0d29a",
    brandDarkAccentColor: "#8d611a",
    brandCrew: [{ label: "Culinary Lead", imageUrl: "/brand/custom-crew.png" }],
    businessPhone: "(205) 593-2004",
    businessEmail: "hello@acme.test",
    businessAddress: "6230 Eagle Ridge Cir, Pinson, AL 35126",
    acceptanceEmail: "events@acme.test",
    includeDisposables: true,
    disposablesNote: "All disposables are included in this quote.",
    depositNotice: "30% deposit required to hold the date.",
    quoteValidityDays: 30
  }
};
