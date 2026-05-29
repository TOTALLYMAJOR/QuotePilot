import { normalizeCatalog } from "../../../data/mockCatalog";

const rawFixtureCatalog = {
  packages: [
    { id: "basic", name: "Basic", ppp: 10 },
    { id: "premium", name: "Premium", ppp: 20 }
  ],
  addons: [
    { id: "cookie", name: "Cookie Tray", type: "per_person", price: 2 },
    { id: "coffee", name: "Coffee Service", type: "per_event", price: 50 },
    { id: "event_staff", name: "Event Staff", type: "per_event", price: 100, staffRole: "server" }
  ],
  rentals: [{ id: "chairs", name: "Banquet Chairs", price: 4, qtyPerGuests: 10 }],
  settings: {
    perMileRate: 1,
    longDistancePerMileRate: 2,
    deliveryThresholdMiles: 20,
    bartenderRate: 30,
    bartenderRateTypes: [
      { id: "standard", name: "Standard Bartender", rate: 30 },
      { id: "premium", name: "Premium Bartender", rate: 45 }
    ],
    defaultBartenderRateType: "standard",
    serverRate: 20,
    chefRate: 40,
    staffingChargeMode: "per_hour",
    staffingRateTypes: [
      { id: "standard", name: "Standard Staffing", serverRate: 20, chefRate: 40 },
      { id: "premium", name: "Premium Staffing", serverRate: 30, chefRate: 55 }
    ],
    defaultStaffingRateType: "standard",
    serviceFeePct: 0.1,
    serviceFeeTiers: [{ id: "flat", minGuests: 0, maxGuests: 9999, pct: 0.1 }],
    taxRate: 0.05,
    taxRegions: [
      { id: "local", name: "Local", rate: 0.1 },
      { id: "reduced", name: "Reduced", rate: 0.02 },
      { id: "exempt", name: "Tax Exempt", rate: 0 }
    ],
    defaultTaxRegion: "local",
    depositPct: 0.25,
    menuSections: [
      {
        id: "main",
        name: "Main",
        items: [
          { id: "salad", name: "Salad Bar", price: 3, type: "per_person" },
          { id: "setup", name: "Setup Fee", price: 40, type: "per_event" }
        ]
      }
    ],
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
      },
      {
        id: "rental_peak",
        name: "Rental Peak",
        startMonth: 1,
        startDay: 1,
        endMonth: 12,
        endDay: 31,
        packageMultiplier: 1,
        addonMultiplier: 1,
        rentalMultiplier: 1.5
      }
    ],
    defaultSeasonProfile: "standard"
  }
};

const fixtureCatalog = normalizeCatalog(rawFixtureCatalog);

export const quoteCalculationCatalog = fixtureCatalog;
export const quoteCalculationSettings = fixtureCatalog.settings;

export const baseFixtureForm = {
  date: "2026-03-10",
  guests: 0,
  hours: 0,
  servers: 0,
  chefs: 0,
  style: "Buffet",
  bartenders: 0,
  bartenderRateTypeId: "",
  staffingRateTypeId: "",
  bartenderRateOverride: "",
  serverRateOverride: "",
  serverRateMixCsv: "",
  chefRateMixCsv: "",
  chefRateOverride: "",
  pkg: "basic",
  addons: [],
  rentals: [],
  menuItems: [],
  milesRT: 0,
  payMethod: "card",
  taxRegion: "local",
  seasonProfileId: "standard"
};

export const quoteCalculationFixtures = [
  {
    id: "package-pricing",
    form: {
      ...baseFixtureForm,
      guests: 50,
      style: "Drop-off",
      pkg: "premium"
    },
    expected: {
      selectedPkgId: "premium",
      base: 1000
    }
  },
  {
    id: "addon-pricing",
    form: {
      ...baseFixtureForm,
      guests: 30,
      style: "Drop-off",
      addons: ["cookie", "coffee"]
    },
    expected: {
      addons: 110
    }
  },
  {
    id: "rental-pricing-with-quantity-and-multiplier",
    form: {
      ...baseFixtureForm,
      guests: 26,
      style: "Drop-off",
      rentals: ["chairs"],
      seasonProfileId: "rental_peak"
    },
    expected: {
      rentalMultiplier: 1.5,
      rentals: 18
    }
  },
  {
    id: "labor-pricing",
    form: {
      ...baseFixtureForm,
      guests: 120,
      hours: 5,
      servers: 10,
      chefs: 3,
      bartenders: 2
    },
    expected: {
      servers: 10,
      chefs: 3,
      bartenderLabor: 300,
      labor: 1900
    }
  },
  {
    id: "staff-addon-quantity-increments-count",
    form: {
      ...baseFixtureForm,
      guests: 60,
      hours: 4,
      servers: 3,
      addons: ["event_staff"],
      addonQuantities: {
        event_staff: 2
      }
    },
    expected: {
      addons: 200,
      baseServers: 3,
      addonServers: 0,
      servers: 3,
      labor: 240
    }
  },
  {
    id: "labor-pricing-with-rate-types-and-overrides",
    form: {
      ...baseFixtureForm,
      guests: 120,
      hours: 5,
      servers: 10,
      chefs: 3,
      bartenders: 2,
      bartenderRateTypeId: "premium",
      staffingRateTypeId: "premium",
      bartenderRateOverride: 50,
      serverRateOverride: 33,
      chefRateOverride: 60
    },
    expected: {
      bartenderRateApplied: 50,
      serverRateApplied: 33,
      chefRateApplied: 60,
      bartenderLabor: 500,
      labor: 3050
    }
  },
  {
    id: "labor-pricing-per-event-per-staff",
    form: {
      ...baseFixtureForm,
      guests: 120,
      hours: 5,
      servers: 10,
      chefs: 3,
      bartenders: 2
    },
    settingsPatch: {
      staffingChargeMode: "per_event_per_staff"
    },
    expected: {
      staffingChargeMode: "per_event_per_staff",
      servers: 10,
      chefs: 3,
      bartenderLabor: 60,
      labor: 380
    }
  },
  {
    id: "mileage-pricing",
    form: {
      ...baseFixtureForm,
      guests: 20,
      style: "Drop-off",
      milesRT: 35,
      taxRegion: "exempt"
    },
    expected: {
      travelBaseMiles: 20,
      travelLongDistanceMiles: 15,
      travel: 50
    }
  },
  {
    id: "tax-pricing",
    form: {
      ...baseFixtureForm,
      guests: 10,
      hours: 2,
      style: "Buffet",
      addons: ["cookie"],
      milesRT: 10,
      taxRegion: "reduced"
    },
    expected: {
      taxRateApplied: 0.02,
      tax: 2.66
    }
  },
  {
    id: "deposit-pricing",
    form: {
      ...baseFixtureForm,
      guests: 40,
      style: "Drop-off"
    },
    expected: {
      total: 484,
      deposit: 121
    }
  }
];
