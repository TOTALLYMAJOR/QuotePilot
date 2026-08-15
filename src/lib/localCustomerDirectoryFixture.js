const REVIEW_CUSTOMERS = Object.freeze([
  ["Avery Williams", "Williams Family", "Williams Wedding", "2026-08-22"],
  ["Jordan Lee", "Lee Foundation", "Foundation Dinner", "2026-08-29"],
  ["Maya Chen", "Chen & Co.", "Leadership Retreat", "2026-09-03"],
  ["Luis Ortiz", "Ortiz Construction", "Company Picnic", "2026-09-05"],
  ["Nora Patel", "Northshore Pediatrics", "Physician Reception", "2026-09-12"],
  ["Cameron Reed", "Reed Design Studio", "Gallery Opening", "2026-09-19"],
  ["Jalen Brooks", "Brooks Alumni Group", "Alumni Dinner", "2026-09-20"],
  ["Lena Hart", "Hart Family", "Anniversary Celebration", "2026-09-26"],
  ["Owen Keller", "Keller Logistics", "Quarterly Lunch", "2026-10-02"],
  ["Amara Bell", "Bell Community Fund", "Fall Benefit", "2026-10-03"],
  ["Theo Martin", "Martin Legal", "Partner Dinner", "2026-10-10"],
  ["Sofia Nguyen", "Nguyen Family", "Garden Wedding", "2026-10-17"],
  ["Elliot Price", "Price Architecture", "Studio Open House", "2026-10-18"],
  ["Grace Foster", "Foster Education Fund", "Scholarship Luncheon", "2026-10-24"],
  ["Micah Davis", "Davis Hospitality", "Vendor Showcase", "2026-10-25"],
  ["Aisha Robinson", "Robinson Family", "Rehearsal Dinner", "2026-08-15"],
  ["Caleb Thompson", "Thompson Manufacturing", "Safety Awards", "2026-08-18"],
  ["Zoe Ramirez", "Ramirez Arts Council", "Summer Social", "2026-08-08"],
  ["Isaiah Green", "Green Parish", "Community Supper", "2026-08-01"],
  ["Naomi Stewart", "Stewart Realty", "Client Appreciation", "2026-09-08"],
  ["Miles Johnson", "Johnson Family", "Graduation Dinner", "2026-08-12"],
  ["Priya Shah", "Shah Medical Group", "Team Reception", "2026-09-15"],
  ["Evan Carter", "Carter Auto", "Customer Cookout", "2026-09-27"],
  ["Layla Morgan", "Morgan Family", "Engagement Party", "2026-10-31"]
]);

function normalize(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/gu, " ");
}

function fixtureRows(organizationId) {
  return REVIEW_CUSTOMERS.map(([name, company, eventName, eventDate], index) => {
    const sequence = index + 1;
    const id = `review-client-${String(sequence).padStart(2, "0")}`;
    const slug = normalize(name).replace(/[^a-z0-9]+/gu, ".");
    const linked = sequence % 8 !== 0;
    const email = sequence % 7 === 0 ? "" : `${slug}@example.com`;
    const phone = sequence % 6 === 0 ? "" : `+1 985 555 ${String(1100 + sequence).padStart(4, "0")}`;
    return {
      id,
      customerId: id,
      organizationId,
      name,
      nameKey: normalize(name),
      email,
      emailKey: normalize(email),
      phone,
      company,
      lastQuoteId: linked ? `review-quote-${String(sequence).padStart(2, "0")}` : "",
      lastQuoteNumber: linked ? `QP-${String(2600 + sequence)}` : "",
      lastEventName: linked ? eventName : "",
      lastEventDate: linked ? eventDate : "",
      createdAtISO: `2026-07-${String((index % 24) + 1).padStart(2, "0")}T14:00:00.000Z`,
      updatedAtISO: `2026-08-${String((index % 14) + 1).padStart(2, "0")}T16:00:00.000Z`,
      revenueAutopilotEmailControls: null
    };
  }).sort((left, right) => left.nameKey.localeCompare(right.nameKey));
}

function fixtureQuote(customer, index) {
  if (!customer?.lastQuoteId) return null;
  const status = ["sent", "viewed", "accepted", "booked"][index % 4];
  const total = 4800 + (index * 275);
  const deposit = Math.round(total * 0.25);
  const createdAtISO = `2026-07-${String((index % 20) + 1).padStart(2, "0")}T15:00:00.000Z`;
  const updatedAtISO = `2026-08-${String((index % 12) + 2).padStart(2, "0")}T17:30:00.000Z`;
  return {
    id: customer.lastQuoteId,
    organizationId: customer.organizationId,
    customerId: customer.customerId,
    quoteNumber: customer.lastQuoteNumber,
    status,
    customer: {
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      organization: customer.company
    },
    event: {
      name: customer.lastEventName,
      date: customer.lastEventDate,
      time: index % 2 === 0 ? "18:00" : "12:00",
      venue: ["Riverside Hall", "The Foundry", "Garden District House", "Civic Pavilion"][index % 4],
      guests: 48 + (index * 6)
    },
    totals: {
      subtotal: Math.round(total / 1.09),
      tax: total - Math.round(total / 1.09),
      total,
      deposit
    },
    payment: {
      depositStatus: ["accepted", "booked"].includes(status) ? "unpaid" : "not_requested"
    },
    booking: status === "booked" ? { contractNumber: `EV-${String(4100 + index)}` } : {},
    conversationSummary: {
      messageCount: 2 + (index % 5),
      latestMessageAtISO: updatedAtISO,
      latestActorType: index % 3 === 0 ? "customer" : "staff"
    },
    lifecycle: {
      createdAtISO,
      ...(status !== "sent" ? { viewedAtISO: updatedAtISO } : {}),
      ...(["accepted", "booked"].includes(status) ? { acceptedAtISO: updatedAtISO } : {}),
      ...(status === "booked" ? { bookedAtISO: updatedAtISO } : {})
    },
    createdAtISO,
    updatedAtISO
  };
}

export function getLocalCustomerDirectoryFixturePage({
  organizationId = "",
  search = "",
  cursor = "",
  pageSize = 25
} = {}) {
  const normalizedSearch = normalize(search);
  const records = fixtureRows(organizationId).filter((customer) => (
    !normalizedSearch
    || customer.nameKey.startsWith(normalizedSearch)
    || customer.emailKey.startsWith(normalizedSearch)
  ));
  const cursorIndex = cursor ? records.findIndex((customer) => customer.id === cursor) : -1;
  const startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
  const bounded = records.slice(startIndex, startIndex + pageSize + 1);
  const items = bounded.slice(0, pageSize);
  return Object.freeze({
    source: "local",
    state: "local_fixture",
    items: Object.freeze(items.map((customer) => Object.freeze({ ...customer }))),
    nextCursor: bounded.length > pageSize ? encodeURIComponent(items.at(-1)?.id || "") : ""
  });
}

export function getLocalCustomerWorkspaceFixture({
  organizationId = "",
  customerId = ""
} = {}) {
  const rows = fixtureRows(organizationId);
  const index = rows.findIndex((customer) => customer.customerId === customerId);
  if (index < 0) return null;
  const customer = rows[index];
  const quote = fixtureQuote(customer, index);
  const quotes = quote ? [quote] : [];
  return Object.freeze({
    source: "local",
    state: "local_fixture",
    customer: Object.freeze({ ...customer }),
    quotes: Object.freeze(quotes.map((entry) => Object.freeze(entry))),
    versionsByQuote: Object.freeze(quote ? {
      [quote.id]: Object.freeze([Object.freeze({
        id: `${quote.id}-version-1`,
        createdAtISO: quote.createdAtISO,
        label: "Initial local review version"
      })])
    } : {}),
    quotePageInfo: Object.freeze({ limit: 25, truncated: false })
  });
}
