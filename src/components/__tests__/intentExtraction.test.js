import { describe, expect, test } from "vitest";
import { INTENT_EXTRACTION_MODEL, extractIntentDraft } from "../intentExtraction";

const NOW = new Date("2026-08-10T09:00:00");
const STYLES = ["Buffet", "Plated", "Stations", "Drop-off"];
const EVENT_TYPES = [
  { id: "corporate-dinner", name: "Corporate Dinner" },
  { id: "weddings", name: "Weddings & Celebrations" }
];

function run(text, options = {}) {
  return extractIntentDraft(text, { eventTypes: EVENT_TYPES, styles: STYLES, nowDate: NOW, ...options });
}

describe("extractIntentDraft", () => {
  test("structures the canonical corporate-dinner sentence", () => {
    const result = run(
      "Corporate dinner for about 80 people on September 12, upscale but relaxed, plated, budget around $12k."
    );
    expect(result.modelId).toBe(INTENT_EXTRACTION_MODEL);
    expect(result.draft.guests).toBe(80);
    expect(result.draft.date).toBe("2026-09-12");
    expect(result.draft.style).toBe("Plated");
    expect(result.draft.eventTypeId).toBe("corporate-dinner");

    const guests = result.facts.find((fact) => fact.id === "guests");
    expect(guests.kind).toBe("approximate");
    expect(guests.displayValue).toBe("~80 guests");
    expect(guests.source).toContain("about 80 people");

    const budget = result.notes.find((note) => note.id === "budget");
    expect(budget.amount).toBe(12000);
    expect(budget.text).toContain("$12,000");
    expect(budget.text).toContain("no budget field");
  });

  test("reads a guest range as its midpoint and preserves the band as a note", () => {
    const result = run("Somewhere between 100 to 130 guests for the reception.");
    const guests = result.facts.find((fact) => fact.id === "guests");
    expect(guests.kind).toBe("range");
    expect(guests.min).toBe(100);
    expect(guests.max).toBe(130);
    expect(result.draft.guests).toBe(115);
    const note = result.notes.find((item) => item.id === "guest-range");
    expect(note.text).toContain("100–130");
    expect(note.text).toContain("115");
  });

  test("parses ISO dates, meridiem times, durations with builder bounds, and contact details", () => {
    const result = run(
      "Service on 2026-12-05 at 6:30pm for a 14 hour marathon. Reach Dana at dana@client.test or 205-555-0142."
    );
    expect(result.draft.date).toBe("2026-12-05");
    expect(result.draft.time).toBe("18:30");
    expect(result.draft.hours).toBe(12);
    const hours = result.facts.find((fact) => fact.id === "hours");
    expect(hours.displayValue).toContain("builder bound: 12");
    expect(result.draft.email).toBe("dana@client.test");
    expect(result.draft.phone).toBe("205-555-0142");
  });

  test("infers the year for month-name dates and rolls past dates forward", () => {
    expect(run("Dinner on September 12.").draft.date).toBe("2026-09-12");
    expect(run("Dinner on March 3.").draft.date).toBe("2027-03-03");
    expect(run("Dinner on March 3, 2027.").draft.date).toBe("2027-03-03");
  });

  test("keeps venue guesses out of the draft until confirmed", () => {
    const result = run("Reception at the Riverside Loft for 120 guests.");
    expect(result.draft.venue).toBeUndefined();
    const venue = result.needsConfirmation.find((fact) => fact.id === "venue");
    expect(venue.value).toBe("Riverside Loft");
    expect(venue.confidence).toBe("low");
    expect(result.draft.guests).toBe(120);
  });

  test("matches tenant event types by keyword when the exact name is absent", () => {
    const result = run("A wedding for 120 people next spring.");
    const type = result.facts.find((fact) => fact.id === "eventTypeId");
    expect(type.value).toBe("weddings");
    expect(type.confidence).toBe("medium");
    expect(type.displayValue).toContain('matched "wedding"');
  });

  test("captures dietary clauses and title-case event names", () => {
    const result = run("The Rivera Wedding needs two stations; note a nut allergy and one vegan meal.");
    expect(result.draft.eventName).toBe("The Rivera Wedding");
    expect(result.draft.dietaryRestrictions).toContain("nut allergy");
    expect(result.draft.style).toBe("Stations");
  });

  test("never invents: unreadable text produces no facts and an empty draft", () => {
    const result = run("Looking forward to chatting soon!");
    expect(result.facts).toEqual([]);
    expect(result.needsConfirmation).toEqual([]);
    expect(result.draft).toEqual({});
    expect(result.empty).toBe(false);
  });

  test("flags empty input distinctly", () => {
    expect(run("").empty).toBe(true);
    expect(run("   ").empty).toBe(true);
  });

  test("does not misread counts adjacent to non-guest nouns", () => {
    const result = run("Please plan for 2 vegan meals across the menu.");
    expect(result.draft.guests).toBeUndefined();
  });

  test("reads digit staff counts for every role, with synonyms", () => {
    const result = run("We need 3 servers, 2 bartenders, and 1 chef for the night.");
    expect(result.draft.servers).toBe(3);
    expect(result.draft.bartenders).toBe(2);
    expect(result.draft.chefs).toBe(1);
    const waiters = run("Please staff 4 waiters and one cook.");
    expect(waiters.draft.servers).toBe(4);
    expect(waiters.draft.chefs).toBe(1);
  });

  test("reads word-numbers at high confidence but articles only as confirm-required", () => {
    const result = run("Add a bartender and two extra servers.");
    expect(result.draft.servers).toBe(2);
    expect(result.draft.bartenders).toBeUndefined();
    const pending = result.needsConfirmation.find((fact) => fact.field === "bartenders");
    expect(pending).toMatchObject({ value: 1, confidence: "low" });
  });

  test("reads a staff range as its midpoint with a transparent display, like guests", () => {
    const result = run("Probably 2-4 servers for the night.");
    expect(result.draft.servers).toBe(3);
    expect(result.facts.find((fact) => fact.field === "servers").displayValue)
      .toContain("2–4");
  });

  test("never invents a staff count from bare mentions, possessives, compounds, or non-staff senses", () => {
    const cases = [
      "We'll need bartenders for sure.",
      "We want a chef's tasting menu for the reception.",
      "Two chef's knives as a gift, please.",
      "twenty-one servers of data live in the venue's server room.",
      "3 server racks and 12 servers of data.",
      "My address is 4 Cooks Lane.",
    ];
    for (const text of cases) {
      const result = run(text);
      expect(result.draft.servers, text).toBeUndefined();
      expect(result.draft.chefs, text).toBeUndefined();
      expect(result.draft.bartenders, text).toBeUndefined();
      expect(result.needsConfirmation.filter((fact) => ["servers", "chefs", "bartenders"].includes(fact.field)), text).toEqual([]);
    }
  });

  test("reads a time range as both start time and computed service hours, including cross-midnight", () => {
    const evening = run("Dinner from 6pm to 10pm at the hall.");
    expect(evening.draft.time).toBe("18:00");
    expect(evening.draft.hours).toBe(4);
    const late = run("Reception 8pm to 1am.");
    expect(late.draft.time).toBe("20:00");
    expect(late.draft.hours).toBe(5);
  });

  test("a bare start digit inherits the end meridiem, and an explicit hours phrase beats the computed span", () => {
    const inherited = run("Something like 6-10pm works.");
    expect(inherited.draft.time).toBe("18:00");
    expect(inherited.draft.hours).toBe(4);
    const explicit = run("From 6pm to 10pm, but only 3 hours of service.");
    expect(explicit.draft.hours).toBe(3);
    expect(explicit.draft.time).toBe("18:00");
  });

  test("reads reversed guest and date phrasing", () => {
    const result = run("A party of 50 on the 12th of September.");
    expect(result.draft.guests).toBe(50);
    expect(result.draft.date).toBe("2026-09-12");
  });

  test("relative weekdays are computed but only ever confirm-required", () => {
    const result = run("Ideally next Saturday.");
    expect(result.draft.date).toBeUndefined();
    const pending = result.needsConfirmation.find((fact) => fact.field === "date");
    expect(pending.confidence).toBe("low");
    expect(pending.value).toBe("2026-08-22");
  });

  test("verifier regressions: contact hours, month-day theft, wraparound, and month-prefix words extract nothing wrong", () => {
    const contact = run("Call me 9am-5pm at 555-867-5309.");
    expect(contact.draft.time).toBeUndefined();
    expect(contact.draft.hours).toBeUndefined();

    const monthDay = run("The party is September 6 until 10pm.");
    expect(monthDay.draft.date).toBe("2026-09-06");
    expect(monthDay.draft.time).toBe("22:00");
    expect(monthDay.draft.hours).toBeUndefined();

    const flipped = run("Open house 10-9pm.");
    expect(flipped.draft.time).toBe("10:00");
    expect(flipped.draft.hours).toBe(11);

    const decent = run("we want 2 of decent size and maybe 15 more");
    expect(decent.draft.date).toBeUndefined();

    const shadowed = run("Dinner next Friday 8/21 at 6pm.");
    expect(shadowed.draft.date).toBe("2026-08-21");
  });

  test("reads noon and midnight as clock words, standalone and in a range", () => {
    expect(run("Doors open at noon.").draft.time).toBe("12:00");
    expect(run("Ceremony starts at Noon sharp.").draft.time).toBe("12:00");
    expect(run("The after-party goes until midnight.").draft.time).toBe("00:00");

    const range = run("Reception 8pm to midnight for the wedding.");
    expect(range.draft.time).toBe("20:00");
    expect(range.draft.hours).toBe(4);

    const noonRange = run("Luncheon noon to 4pm.");
    expect(noonRange.draft.time).toBe("12:00");
    expect(noonRange.draft.hours).toBe(4);
  });

  test("never mistakes a name for a clock word, and never mislabels an unresolved range's end as the start", () => {
    const gardenVenue = run("The reception is at the Midnight Garden Estate.");
    expect(gardenVenue.draft.time).toBeUndefined();

    const buffet = run("We would like the midnight buffet option.");
    expect(buffet.draft.time).toBeUndefined();

    // "the "-guard alone (not a stricter "not followed by a Capitalized
    // word" guard, which adversarial verification found rejected far more
    // real sentences than it protected — see the guard's own comment)
    // means an event literally named "Midnight X" without a leading "the"
    // still reads as a time. Accepted tradeoff, not a miss: guests are
    // still read correctly, and time is just a prefill the human reviews.
    const themedGala = run("Our Midnight Masquerade gala is planned for 80 guests.");
    expect(themedGala.draft.time).toBe("00:00");
    expect(themedGala.draft.guests).toBe(80);

    // "6" has no stated meridiem, so this dangling range must extract
    // nothing rather than guess whether it means 6am or 6pm.
    const dangling = run("The party runs from 6 to midnight.");
    expect(dangling.draft.time).toBeUndefined();
    expect(dangling.draft.hours).toBeUndefined();
  });

  test("recognizes \"til\"/\"'til\" as a range separator, both as the dangling-range guard and as a resolvable range", () => {
    // Adversarial verification: the original guard's separator list
    // (-, –, to, until, till) was missing "til"/"'til"/hyphen-wrapped
    // "-til-", so these slipped past it and wrongly extracted the clock
    // word alone as if it were the start time.
    expect(run("The party runs from 6 til midnight.").draft.time).toBeUndefined();
    expect(run("Music starts 6 'til midnight for the after-party.").draft.time).toBeUndefined();
    expect(run("We're open 9 til noon on Sundays.").draft.time).toBeUndefined();
    expect(run("Reception 6-til-midnight, casual.").draft.time).toBeUndefined();
    // A word-form ambiguous hour is exactly as unresolvable as a digit one.
    expect(run("Doors open six to midnight.").draft.time).toBeUndefined();
    // When the range actually resolves (explicit meridiem present), "til"
    // must extract the full range, not just fall back to a bare time.
    const resolved = run("Party runs 6pm til midnight for the wedding.");
    expect(resolved.draft.time).toBe("18:00");
    expect(resolved.draft.hours).toBe(6);
  });

  test("reads written-out guest counts the same way as their digit equivalents", () => {
    expect(run("Wedding for eighty guests on June 12.").draft.guests).toBe(80);
    expect(run("About a hundred people for the gala.").draft.guests).toBe(100);
    expect(run("We are expecting two hundred and fifty guests.").draft.guests).toBe(250);
    expect(run("Party of twenty-one for the dinner.").draft.guests).toBe(21);
    expect(run("Headcount of ninety for the retreat.").draft.guests).toBe(90);
    expect(run("We need a hundred and five guests seated.").draft.guests).toBe(105);
  });

  test("reads a written-out guest range as its midpoint, and never lets \"and\" bridge two independent numbers", () => {
    const toRange = run("We're expecting eighty to a hundred guests for the reception.");
    expect(toRange.draft.guests).toBe(90);
    const range = toRange.facts.find((f) => f.id === "guests");
    expect(range.kind).toBe("range");
    expect(range.min).toBe(80);
    expect(range.max).toBe(100);

    expect(run("We're expecting eighty or a hundred guests, not sure yet.").draft.guests).toBe(90);
    expect(run("Fifty to eighty guests for the luncheon.").draft.guests).toBe(65);

    // The bug found in adversarial verification: a looser grammar let "and"
    // bridge "twenty" and "a hundred" into 20*100=2000 (hitting this
    // file's own cap while looking like a confident, valid count). "and"
    // is now legal only directly after "hundred" within ONE number, so
    // "between X and Y" is read as a genuine two-number range instead.
    const between = run("We're expecting between twenty and a hundred guests.");
    expect(between.draft.guests).toBe(60);
    const betweenRange = between.facts.find((f) => f.id === "guests");
    expect(betweenRange.min).toBe(20);
    expect(betweenRange.max).toBe(100);

    // A genuine single compound number must still parse as one number, not
    // get mistaken for a range now that "between...and" is recognized.
    expect(run("We are expecting two hundred and fifty guests.").draft.guests).toBe(250);
  });

  test("a bare article before a guest noun is not a count, but the staff-count compound guard still applies to word numbers", () => {
    const bareArticle = run("Can I bring a guest to the reception?");
    expect(bareArticle.draft.guests).toBeUndefined();
    expect(bareArticle.needsConfirmation.find((f) => f.field === "guests")).toBeUndefined();

    // Whole-run parsing (not piecemeal sub-matching) means a compound like
    // "twenty-one" is never misread as its last word alone.
    const compound = run("twenty-one servers of data live in the venue's server room.");
    expect(compound.draft.guests).toBeUndefined();
    expect(compound.draft.servers).toBeUndefined();
  });

  test("surfaces a multi-day mention as a note only, never as the draft date or an extra fact", () => {
    const hyphenRange = run("Wedding weekend June 12-14 at the Riverside Loft.");
    expect(hyphenRange.draft.date).toBe("2027-06-12");
    expect(hyphenRange.notes.find((n) => n.id === "multi-day")).toBeTruthy();

    const toRange = run("Dinner June 12 to 14 for about 80 people.");
    expect(toRange.notes.find((n) => n.id === "multi-day")).toBeTruthy();

    const namedSpan = run("It's a 3-day corporate retreat for 80 people.");
    expect(namedSpan.notes.find((n) => n.id === "multi-day")).toBeTruthy();

    const multiDayWord = run("This will be a multi-day festival for the community.");
    expect(multiDayWord.notes.find((n) => n.id === "multi-day")).toBeTruthy();

    const oneDay = run("One-day wedding, no overnight needed, June 12.");
    expect(oneDay.notes.find((n) => n.id === "multi-day")).toBeUndefined();

    // No month-name anchor: an unrelated numeric range must not false-fire.
    const staffRange = run("Staff needed: 12-14 servers for the big event.");
    expect(staffRange.notes.find((n) => n.id === "multi-day")).toBeUndefined();
  });

  test("does not mistake lead/trail time around a single-day event for a multi-day event", () => {
    // Adversarial verification: "N days before/after the EVENT" is setup
    // or breakdown lead time, not the event itself spanning multiple days.
    expect(run("Setup will take 2 days before the wedding.").notes.find((n) => n.id === "multi-day")).toBeUndefined();
    expect(run("We'll need 2 days before the event to set up the tent.").notes.find((n) => n.id === "multi-day")).toBeUndefined();
    expect(run("Breakdown will finish 2 days after the event.").notes.find((n) => n.id === "multi-day")).toBeUndefined();
    // The positive case must still fire when there's no lead/trail relation word.
    expect(run("It's a 3-day corporate retreat for 80 people.").notes.find((n) => n.id === "multi-day")).toBeTruthy();
  });

  test("does not fire a multi-day note on an explicitly negated mention", () => {
    expect(run("This is not a multi-day event -- just one very long day.").notes.find((n) => n.id === "multi-day")).toBeUndefined();
    expect(run("Just to confirm, this is NOT multiple days, it's one single evening.").notes.find((n) => n.id === "multi-day")).toBeUndefined();
    expect(run("Won't be a multi-day affair, thankfully.").notes.find((n) => n.id === "multi-day")).toBeUndefined();
    expect(run("This will NOT be a 2-day event, thankfully just one afternoon affair.").notes.find((n) => n.id === "multi-day")).toBeUndefined();
  });

  test("recognizes word-form day counts (\"two-day\", \"three-day\"), not just digits", () => {
    expect(run("It's a two-day event for the whole family.").notes.find((n) => n.id === "multi-day")).toBeTruthy();
    expect(run("This is a three-day retreat in the mountains.").notes.find((n) => n.id === "multi-day")).toBeTruthy();
    // "one-day" must still never fire, in either digit or word form.
    expect(run("One-day wedding, no overnight needed, June 12.").notes.find((n) => n.id === "multi-day")).toBeUndefined();
  });

  test("reads venue names introduced by an explicit label, not just \"at\"", () => {
    const colon = run("Venue: Riverside Loft, June 12.");
    const colonVenue = colon.needsConfirmation.find((f) => f.field === "venue");
    expect(colonVenue.value).toBe("Riverside Loft");

    const is = run("The venue is the Grand Ballroom downtown.");
    expect(is.needsConfirmation.find((f) => f.field === "venue").value).toBe("Grand Ballroom");

    const willBe = run("Venue will be Magnolia Hall for 80 guests.");
    expect(willBe.needsConfirmation.find((f) => f.field === "venue").value).toBe("Magnolia Hall");

    // Lowercase prose after "venue is" is not a name and must not be captured.
    const undecided = run("The venue is still being decided, maybe around 80 guests.");
    expect(undecided.needsConfirmation.find((f) => f.field === "venue")).toBeUndefined();
  });

  test("trims a sentence-ending period from a captured venue name", () => {
    const result = run("Wedding weekend June 12-14 at the Riverside Loft.");
    const venue = result.needsConfirmation.find((f) => f.field === "venue");
    expect(venue.value).toBe("Riverside Loft");
  });

  function venueOf(text) {
    const result = run(text);
    return result.needsConfirmation.find((f) => f.field === "venue")?.value;
  }

  test("stops a venue name at the next sentence instead of swallowing it", () => {
    // Adversarial verification: the multi-word repetition has no
    // sentence-boundary concept, so a venue name followed by a new
    // capitalized sentence used to swallow that whole next sentence too.
    expect(venueOf("Venue: The Grand Ballroom. Please confirm by Friday.")).toBe("The Grand Ballroom");
    expect(venueOf("Venue: The Loft. Sarah will call to confirm the headcount.")).toBe("The Loft");
    expect(venueOf("Reception at the Riverside Loft. Sarah will confirm the headcount.")).toBe("Riverside Loft");
    // A real abbreviation period must still survive (not treated as a
    // sentence boundary just because the next word is capitalized).
    expect(venueOf("Venue: Mr. Peterson's Barn for the reception.")).toBe("Mr. Peterson's Barn");
    // A comma still stops capture the same way it always did.
    expect(venueOf("Venue: The Grand Ballroom, Confirm ASAP please.")).toBe("The Grand Ballroom");
  });

  test("never offers a placeholder or non-answer as a venue guess", () => {
    // Adversarial verification: "TBD"/"N/A"/"not sure yet" are extremely
    // common real-world shorthand for "no answer yet" in call notes, and
    // read as a proper noun to the capture pattern otherwise.
    expect(venueOf("Venue is TBD for now.")).toBeUndefined();
    expect(venueOf("Venue: TBD.")).toBeUndefined();
    expect(venueOf("Venue: N/A at this time.")).toBeUndefined();
    expect(venueOf("Venue: Not sure yet, will confirm next week.")).toBeUndefined();
    // A rejected placeholder must still fall through to a real "at X" venue
    // elsewhere in the same text rather than giving up on the sentence.
    expect(venueOf("Venue is TBD, but the reception is at the Riverside Loft.")).toBe("Riverside Loft");
  });
});
