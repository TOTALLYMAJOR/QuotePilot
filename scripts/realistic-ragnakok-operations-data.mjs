export const OPERATIONS_POPULATION_VERSION = "ragnakok-operations-v1";
export const OPERATIONS_ORGANIZATION_ID = "mm05366-sandbox";
export const OPERATIONS_FIXTURE_SOURCE = "quotepilot_synthetic_operating_twin";
export const STAFF_ASSET_DIRECTORY = new URL("../public/fixtures/ragnakok-staff/", import.meta.url);

const staff = (slug, displayName, title, capabilities, hourlyRate, portrait, details = {}) => ({
  id: `rko-staff-${slug}`,
  displayName,
  title,
  capabilities,
  hourlyRate,
  portrait,
  proficiency: details.proficiency || (capabilities.includes("lead") ? "lead" : "experienced"),
  qualification: details.qualification || "ServSafe Food Handler",
  department: details.department || (capabilities.includes("chef") ? "Culinary" : "Event Operations"),
  station: details.station || title,
  completedAssignments: details.completedAssignments ?? 24,
  managerRating: details.managerRating ?? 4,
  reliability: details.reliability || "steady",
  preferredAreas: details.preferredAreas || ["Boston", "Cambridge", "Somerville"],
  homeBase: details.homeBase || "Boston, MA"
});

export const REALISTIC_STAFF = Object.freeze([
  staff("marco-bellini", "Marco Bellini", "Executive Chef", ["lead", "chef"], 46, "marco-bellini.png", { qualification: "ServSafe Manager", completedAssignments: 164, managerRating: 5, reliability: "preferred" }),
  staff("hana-park", "Hana Park", "Sous Chef", ["chef", "lead"], 38, "hana-park.png", { qualification: "ServSafe Manager", completedAssignments: 112, managerRating: 5, reliability: "preferred" }),
  staff("darius-cole", "Darius Cole", "Senior Event Captain", ["lead", "server"], 36, "darius-cole.png", { completedAssignments: 148, managerRating: 5, reliability: "preferred" }),
  staff("elena-morales", "Elena Morales", "Dining Room Captain", ["lead", "server"], 34, "elena-morales.png", { completedAssignments: 121, managerRating: 5, reliability: "preferred" }),
  staff("niko-santos", "Niko Santos", "Craft Bartender", ["bartender", "server"], 32, "niko-santos.png", { qualification: "TIPS Alcohol Certification", completedAssignments: 83 }),
  staff("claire-beaumont", "Claire Beaumont", "Pastry Chef", ["chef"], 35, "claire-beaumont.png", { department: "Pastry", completedAssignments: 76, reliability: "preferred" }),
  staff("owen-murphy", "Owen Murphy", "Logistics Lead", ["lead", "server"], 33, "owen-murphy.png", { department: "Logistics", completedAssignments: 98 }),
  staff("amara-okafor", "Amara Okafor", "Culinary Lead", ["chef", "lead"], 39, "amara-okafor.png", { qualification: "Allergen Awareness Manager", completedAssignments: 104, managerRating: 5, reliability: "preferred" }),
  staff("priya-shah", "Priya Shah", "Hospitality Lead", ["lead", "server", "bartender"], 35, "priya-shah.png", { qualification: "TIPS Alcohol Certification", completedAssignments: 117, managerRating: 5, reliability: "preferred" }),
  staff("kenji-tanaka", "Kenji Tanaka", "Stewarding Lead", ["lead", "server"], 30, "kenji-tanaka.png", { department: "Stewarding", completedAssignments: 91 }),
  staff("sofia-alvarez", "Sofia Alvarez", "Banquet Captain", ["lead", "server", "bartender"], 34, "sofia-alvarez.png", { qualification: "TIPS Alcohol Certification", completedAssignments: 88, reliability: "preferred" }),
  staff("malik-thompson", "Malik Thompson", "Grill Chef", ["chef"], 34, "malik-thompson.png", { completedAssignments: 69 }),
  staff("lucy-bennett", "Lucy Bennett", "Pastry Assistant", ["chef"], 27, "lucy-bennett.png", { department: "Pastry", proficiency: "capable", completedAssignments: 34 }),
  staff("rafael-silva", "Rafael Silva", "Senior Server", ["server"], 28, "rafael-silva.png", { completedAssignments: 72, reliability: "preferred" }),
  staff("nia-brooks", "Nia Brooks", "Mixologist", ["bartender", "server"], 33, "nia-brooks.png", { qualification: "TIPS Alcohol Certification", completedAssignments: 61, reliability: "preferred" }),
  staff("theo-martin", "Theo Martin", "Prep Cook", ["chef"], 26, "theo-martin.png", { proficiency: "capable", completedAssignments: 29 }),
  staff("marisol-vega", "Marisol Vega", "Event Producer", ["lead", "server"], 37, "marisol-vega.png", { completedAssignments: 96, managerRating: 5, reliability: "preferred" }),
  staff("andre-patel", "Andre Patel", "Warehouse Coordinator", ["lead", "server"], 31, "andre-patel.png", { department: "Logistics", completedAssignments: 57 }),
  staff("leila-haddad", "Leila Haddad", "Guest Experience Host", ["server", "lead"], 31, "leila-haddad.png", { completedAssignments: 64, reliability: "preferred" }),
  staff("calvin-price", "Calvin Price", "Steward Captain", ["lead", "server"], 30, "calvin-price.png", { department: "Stewarding", completedAssignments: 79 })
]);

export const REALISTIC_ADDONS = Object.freeze([
  { id: "rko-addon-welcome-sparkler", name: "Rosemary Citrus Welcome Sparkler", pricingType: "per_person", price: 8, cost: 2.35, portalDecidable: true },
  { id: "rko-addon-late-night-biscuits", name: "Midnight Hot Honey Biscuit Drop", pricingType: "per_person", price: 11, cost: 3.85, portalDecidable: true },
  { id: "rko-addon-coffee-salon", name: "After-Dinner Coffee Salon", pricingType: "per_person", price: 9, cost: 2.7, portalDecidable: true },
  { id: "rko-addon-raw-bar", name: "New England Raw Bar Atelier", pricingType: "per_person", price: 28, cost: 12.4, portalDecidable: true },
  { id: "rko-addon-dessert-flight", name: "Little Luxuries Dessert Flight", pricingType: "per_person", price: 14, cost: 4.95, portalDecidable: true },
  { id: "rko-addon-event-captain", name: "Dedicated Event Captain", pricingType: "per_event", price: 475, cost: 252, staffRole: "server" },
  { id: "rko-addon-culinary-action", name: "Chef-Led Action Station", pricingType: "per_event", price: 650, cost: 310, staffRole: "chef" },
  { id: "rko-addon-signature-bar", name: "Two-Signature Cocktail Bar", pricingType: "per_person", price: 24, cost: 9.25, staffRole: "bartender", portalDecidable: true }
]);

export const REALISTIC_RENTALS = Object.freeze([
  { id: "rko-rental-linen", name: "Textured Linen Tablescape", price: 24, cost: 9, qtyPerGuests: 8, pricingType: "per_item", portalDecidable: true },
  { id: "rko-rental-china", name: "Stoneware Dinner Collection", price: 8.5, cost: 3.1, qtyPerGuests: 1, pricingType: "per_item", portalDecidable: true },
  { id: "rko-rental-glassware", name: "Stemmed Glassware Suite", price: 6.5, cost: 2.2, qtyPerGuests: 1, pricingType: "per_item", portalDecidable: true },
  { id: "rko-rental-lounge", name: "Conversation Lounge Vignette", price: 780, cost: 340, qtyPerGuests: 80, pricingType: "per_item" },
  { id: "rko-rental-service", name: "Brushed Brass Service Collection", price: 325, cost: 118, qtyPerGuests: 100, pricingType: "per_item" }
]);

export const REALISTIC_OFFERS = Object.freeze([
  { id: "rko-offer-boston-table", name: "The Boston Table", ppp: 78, costPpp: 29.8, menuNames: ["Brown Butter Sage Chicken", "Strawberry Basil Garden Salad", "Parmesan Herb Potatoes", "Brown Butter Honey Rolls"], choiceNames: ["Citrus Herb Salmon", "Coffee-Rubbed Beef Tenderloin", "Balsamic Mushroom Cauliflower Steak"] },
  { id: "rko-offer-garden-gala", name: "Garden at Golden Hour", ppp: 94, costPpp: 35.6, menuNames: ["Roasted Tomato Whipped Feta Crostini", "Roasted Peach Arugula Salad", "Honey Harissa Chicken Thighs", "Honey Harissa Carrots"], choiceNames: ["Blackened Gulf Whitefish", "Peach Bourbon Pork Tenderloin", "Garden Harvest Grain Bar"] },
  { id: "rko-offer-lowcountry", name: "Lowcountry Lantern Supper", ppp: 88, costPpp: 34.1, menuNames: ["Creole Shrimp Toasts", "Lowcountry Supper Bowl Bar", "Creole Garlic Green Beans", "Cheddar Scallion Cornbread"], choiceNames: ["Creole Garlic Shrimp", "Smoked Cherry Brisket", "Blackened Gulf Whitefish"] },
  { id: "rko-offer-modern-soiree", name: "Modern Soiree", ppp: 112, costPpp: 42.9, menuNames: ["Smoked Gouda Arancini", "Cucumber Feta Ribbon Salad", "Coffee-Rubbed Beef Tenderloin", "Dark Chocolate Espresso Tart"], choiceNames: ["Citrus Herb Salmon", "Rosemary Dijon Lamb Chops", "Balsamic Mushroom Cauliflower Steak"] },
  { id: "rko-offer-brunch", name: "Sunday Conservatory Brunch", ppp: 69, costPpp: 25.4, menuNames: ["Hot Honey Chicken Waffle Bar", "Maple Pecan Breakfast Bread", "Orange Vanilla Brunch Punch", "Peach Cobbler Cheesecake Cups"], choiceNames: ["Bayou Brisket Biscuit Bar", "Southern Slider Social", "Garden Harvest Grain Bar"] },
  { id: "rko-offer-cocktail", name: "Gallery Cocktail Supper", ppp: 84, costPpp: 30.7, menuNames: ["Bourbon Peach Meatballs", "Charred Corn Crab Cakes", "Blackberry Brie Phyllo Cups", "Brown Butter Pecan Blondies"], choiceNames: ["Maple Pepper Pork Belly Skewers", "Lemon Dill Salmon Cakes", "Garden Herb Stuffed Mushrooms"] },
  { id: "rko-offer-celebration", name: "Grand Celebration Dinner", ppp: 138, costPpp: 53.2, menuNames: ["Charred Corn Crab Cakes", "Creole Tomato Wedge Salad", "Rosemary Dijon Lamb Chops", "Citrus Vanilla Celebration Cake"], choiceNames: ["Coffee-Rubbed Beef Tenderloin", "Citrus Herb Salmon", "Balsamic Mushroom Cauliflower Steak"] },
  { id: "rko-offer-executive", name: "Executive Salon Dinner", ppp: 158, costPpp: 61.5, menuNames: ["Roasted Tomato Whipped Feta Crostini", "Blueberry Pecan Kale Salad", "Coffee-Rubbed Beef Tenderloin", "Dark Chocolate Espresso Tart"], choiceNames: ["Rosemary Dijon Lamb Chops", "Citrus Herb Salmon", "Honey Harissa Chicken Thighs"] }
]);

export const REALISTIC_EVENTS = Object.freeze([
  { id: "rko-event-seaport-gala", status: "booked", customer: "Maya Chen", company: "Harborlight Foundation", name: "Seaport Autumn Conservatory Gala", date: "2026-10-17", time: "17:30", hours: 7, venue: "Institute of Contemporary Art Boston", address: "25 Harbor Shore Drive, Boston, MA", guests: 175, style: "plated", offerId: "rko-offer-modern-soiree", addons: ["rko-addon-welcome-sparkler", "rko-addon-dessert-flight"], rentals: ["rko-rental-linen", "rko-rental-china", "rko-rental-glassware"], staffing: { lead: 1, server: 8, chef: 4, bartender: 3 } },
  { id: "rko-event-cambridge-summit", status: "booked", customer: "Jonah Reed", company: "Nexora Robotics", name: "Cambridge Innovation Summit Dinner", date: "2026-10-24", time: "18:00", hours: 6, venue: "MIT Media Lab", address: "75 Amherst Street, Cambridge, MA", guests: 140, style: "stations", offerId: "rko-offer-executive", addons: ["rko-addon-signature-bar", "rko-addon-coffee-salon"], rentals: ["rko-rental-china", "rko-rental-glassware"], staffing: { lead: 1, server: 6, chef: 4, bartender: 2 } },
  { id: "rko-event-beacon-wedding", status: "booked", customer: "Avery Morgan", company: "Morgan-Castillo Wedding", name: "Beacon Hill Candlelight Wedding", date: "2026-11-07", time: "16:30", hours: 8, venue: "Boston Athenaeum", address: "10 1/2 Beacon Street, Boston, MA", guests: 122, style: "plated", offerId: "rko-offer-celebration", addons: ["rko-addon-raw-bar", "rko-addon-signature-bar", "rko-addon-late-night-biscuits"], rentals: ["rko-rental-linen", "rko-rental-china", "rko-rental-glassware", "rko-rental-lounge"], staffing: { lead: 1, server: 7, chef: 4, bartender: 3 } },
  { id: "rko-event-lowcountry-benefit", status: "booked", customer: "Simone Walker", company: "Common Table Boston", name: "Lowcountry Lantern Benefit", date: "2026-11-14", time: "17:00", hours: 7, venue: "SoWa Power Station", address: "550 Harrison Avenue, Boston, MA", guests: 210, style: "buffet", offerId: "rko-offer-lowcountry", addons: ["rko-addon-welcome-sparkler", "rko-addon-dessert-flight", "rko-addon-event-captain"], rentals: ["rko-rental-linen", "rko-rental-service"], staffing: { lead: 1, server: 9, chef: 5, bartender: 3 } },
  { id: "rko-event-museum-reception", status: "booked", customer: "Isaac Bennett", company: "Commonwealth Design Council", name: "Museum After-Hours Reception", date: "2026-11-21", time: "18:30", hours: 5, venue: "Isabella Stewart Gardner Museum", address: "25 Evans Way, Boston, MA", guests: 95, style: "cocktail", offerId: "rko-offer-cocktail", addons: ["rko-addon-signature-bar", "rko-addon-culinary-action"], rentals: ["rko-rental-glassware", "rko-rental-lounge"], staffing: { lead: 1, server: 5, chef: 3, bartender: 2 } },
  { id: "rko-event-winter-board", status: "booked", customer: "Naomi Brooks", company: "Beacon Biotech", name: "Winter Board Salon", date: "2026-12-03", time: "18:00", hours: 5, venue: "State Room Boston", address: "60 State Street, Boston, MA", guests: 68, style: "plated", offerId: "rko-offer-executive", addons: ["rko-addon-coffee-salon"], rentals: ["rko-rental-china", "rko-rental-glassware"], staffing: { lead: 1, server: 4, chef: 3, bartender: 1 } },
  { id: "rko-event-garden-anniversary", status: "accepted", customer: "Jordan Ellis", company: "Ellis Family", name: "Garden Anniversary Supper", date: "2026-12-12", time: "17:30", hours: 6, venue: "Elm Bank Horticulture Center", address: "900 Washington Street, Wellesley, MA", guests: 84, style: "family_style", offerId: "rko-offer-garden-gala", addons: ["rko-addon-welcome-sparkler"], rentals: ["rko-rental-linen", "rko-rental-china"], staffing: { lead: 1, server: 4, chef: 3, bartender: 1 } },
  { id: "rko-event-library-dinner", status: "accepted", customer: "Tessa Grant", company: "Grant & Field", name: "Library Leadership Dinner", date: "2027-01-16", time: "18:00", hours: 5, venue: "Boston Public Library", address: "700 Boylston Street, Boston, MA", guests: 110, style: "plated", offerId: "rko-offer-boston-table", addons: ["rko-addon-coffee-salon", "rko-addon-dessert-flight"], rentals: ["rko-rental-linen", "rko-rental-china"], staffing: { lead: 1, server: 5, chef: 3, bartender: 1 } },
  { id: "rko-event-rooftop-launch", status: "draft", customer: "Emmett Ross", company: "Arc & Tide", name: "Rooftop Product Launch", date: "2027-02-06", time: "18:30", hours: 5, venue: "The Envoy Rooftop", address: "70 Sleeper Street, Boston, MA", guests: 160, style: "stations", offerId: "rko-offer-cocktail", addons: ["rko-addon-signature-bar", "rko-addon-culinary-action"], rentals: ["rko-rental-glassware", "rko-rental-lounge"], staffing: { lead: 1, server: 7, chef: 4, bartender: 3 } },
  { id: "rko-event-spring-brunch", status: "draft", customer: "Camila Torres", company: "Neighborhood Arts Boston", name: "Spring Patrons Brunch", date: "2027-03-13", time: "10:30", hours: 5, venue: "Artists For Humanity EpiCenter", address: "100 West 2nd Street, Boston, MA", guests: 130, style: "buffet", offerId: "rko-offer-brunch", addons: ["rko-addon-coffee-salon", "rko-addon-dessert-flight"], rentals: ["rko-rental-linen", "rko-rental-china"], staffing: { lead: 1, server: 6, chef: 4, bartender: 1 } }
]);

export function operationsPopulationSummary() {
  return Object.freeze({
    version: OPERATIONS_POPULATION_VERSION,
    staff: REALISTIC_STAFF.length,
    offers: REALISTIC_OFFERS.length,
    addons: REALISTIC_ADDONS.length,
    rentals: REALISTIC_RENTALS.length,
    events: REALISTIC_EVENTS.length,
    bookedEvents: REALISTIC_EVENTS.filter((event) => event.status === "booked").length,
    acceptedEvents: REALISTIC_EVENTS.filter((event) => event.status === "accepted").length,
    draftEvents: REALISTIC_EVENTS.filter((event) => event.status === "draft").length,
    workflowKinds: 4
  });
}
