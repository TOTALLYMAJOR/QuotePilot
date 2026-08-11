import { MAX_EVENT_HOURS, MIN_EVENT_HOURS } from "../lib/wizardUi";

// Deterministic intent extraction for the flag-gated CREATE intake canvas
// (docs/INTENT_INTAKE_ADR.md). Pure text analysis: no I/O, no provider, no
// invention. Every fact carries the exact source excerpt it was read from, a
// confidence tier, and an uncertainty kind where the operator's own phrasing
// was uncertain. High/medium facts prefill the ordinary editable draft form;
// low-confidence facts are offered as one-tap confirmations; everything else
// stays the operator's text.
export const INTENT_EXTRACTION_MODEL = "intent-extraction-v1";

const MONTHS = Object.freeze({
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
});

const GUEST_NOUN = "(?:guests?|people|persons?|pax|ppl|attendees|heads)";

// Written-out guest counts ("eighty guests", "a hundred people", "two
// hundred and fifty guests"). Parses the WHOLE matched word-run as one
// number rather than pattern-matching sub-pieces, so a compound like
// "twenty-one" can never be misread as just "one" the way a piecemeal
// regex could (the exact class of bug the staff-count extractor's
// COMPOUND_TENS_GUARD exists to prevent — this design avoids it by
// construction instead of needing a lookbehind). An unrecognized token
// anywhere in the run voids the whole match rather than guessing at a
// partial read.
const GUEST_ONES_WORDS = Object.freeze({
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19
});
const GUEST_TENS_WORDS = Object.freeze({
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90
});
const GUEST_ONES_1_TO_9 = "one|two|three|four|five|six|seven|eight|nine";
const GUEST_ONES_OR_TEENS = `${GUEST_ONES_1_TO_9}|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen`;
const GUEST_TENS = Object.keys(GUEST_TENS_WORDS).join("|");
// A real English-number grammar, not a generic "any of these words in any
// order" bag: "and" is legal ONLY directly after "hundred" (its one true
// role, e.g. "two hundred and fifty"). Adversarial verification found that
// a looser grammar let "and" bridge two INDEPENDENT numbers in a range —
// "between twenty and a hundred guests" was silently misread as
// 20 x 100 = 2000, hitting this file's own 2000-guest cap while looking
// like a confident, valid count. Tightening the grammar so "and" cannot
// appear here at all fixes it at the source: the word-range matcher below
// now owns "X and/to Y" phrasing instead, as two separate number phrases.
const GUEST_HUNDREDS_PHRASE = `(?:a|an|${GUEST_ONES_1_TO_9})\\s+hundred(?:\\s+(?:and\\s+)?(?:(?:${GUEST_TENS})(?:[-\\s](?:${GUEST_ONES_1_TO_9}))?|(?:${GUEST_ONES_OR_TEENS})))?`;
const GUEST_SIMPLE_PHRASE = `(?:${GUEST_TENS})(?:[-\\s](?:${GUEST_ONES_1_TO_9}))?|${GUEST_ONES_OR_TEENS}`;
// Capturing: every call site below relies on this being the sole capture
// group in its enclosing pattern, so match[1] is the whole number-word run.
const GUEST_NUMBER_PHRASE = `(${GUEST_HUNDREDS_PHRASE}|${GUEST_SIMPLE_PHRASE})`;

function wordsToGuestCount(phrase) {
  const tokens = String(phrase || "").toLowerCase().split(/[-\s]+/).filter((token) => token && token !== "and");
  let current = 0;
  let sawNumber = false;
  for (const token of tokens) {
    if (token === "a" || token === "an") {
      current = current || 1;
      continue;
    }
    if (token in GUEST_ONES_WORDS) {
      current += GUEST_ONES_WORDS[token];
      sawNumber = true;
    } else if (token in GUEST_TENS_WORDS) {
      current += GUEST_TENS_WORDS[token];
      sawNumber = true;
    } else if (token === "hundred") {
      current = (current || 1) * 100;
      sawNumber = true;
    } else {
      return null;
    }
  }
  return sawNumber ? current : null;
}

const EVENT_TYPE_KEYWORDS = Object.freeze([
  "wedding", "corporate", "gala", "birthday", "anniversary", "church",
  "community", "retreat", "reception", "shower", "fundraiser", "holiday",
  "luncheon", "picnic", "graduation", "memorial"
]);

function pad2(value) {
  return String(value).padStart(2, "0");
}

function clean(value) {
  return String(value || "").trim();
}

function excerpt(match) {
  return clean(match[0]).slice(0, 80);
}

function isoFromParts(year, month, day) {
  if (!Number.isInteger(month) || month < 1 || month > 12) return "";
  if (!Number.isInteger(day) || day < 1 || day > 31) return "";
  const candidate = new Date(year, month - 1, day);
  if (candidate.getMonth() !== month - 1 || candidate.getDate() !== day) return "";
  return `${candidate.getFullYear()}-${pad2(month)}-${pad2(day)}`;
}

function inferYear(month, day, nowDate) {
  const year = nowDate.getFullYear();
  const withThisYear = new Date(year, month - 1, day);
  const today = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
  return withThisYear < today ? year + 1 : year;
}

function extractGuests(text) {
  const range = text.match(new RegExp(`\\b(\\d{1,4})\\s*(?:-|–|—|to)\\s*(\\d{1,4})\\s*${GUEST_NOUN}\\b`, "i"));
  if (range) {
    const min = Number(range[1]);
    const max = Number(range[2]);
    if (min > 0 && max >= min && max <= 2000) {
      const midpoint = Math.round((min + max) / 2);
      return {
        id: "guests",
        field: "guests",
        label: "Guest count",
        value: midpoint,
        displayValue: `${min}–${max} guests (draft uses ${midpoint})`,
        confidence: "high",
        kind: "range",
        min,
        max,
        source: excerpt(range)
      };
    }
  }
  const approx = text.match(new RegExp(`(?:about|around|approx(?:\\.|imately)?|roughly|~)\\s*(\\d{1,4})\\s*${GUEST_NOUN}\\b`, "i"));
  if (approx) {
    const value = Number(approx[1]);
    if (value > 0 && value <= 2000) {
      return {
        id: "guests",
        field: "guests",
        label: "Guest count",
        value,
        displayValue: `~${value} guests`,
        confidence: "high",
        kind: "approximate",
        source: excerpt(approx)
      };
    }
  }
  const reversed = text.match(/\b(?:party|group|headcount|head\s+count|guest\s+count)\s+of\s+(\d{1,4})\b/i);
  if (reversed) {
    const value = Number(reversed[1]);
    if (value > 0 && value <= 2000) {
      return {
        id: "guests",
        field: "guests",
        label: "Guest count",
        value,
        displayValue: `${value} guests`,
        confidence: "high",
        kind: "exact",
        source: excerpt(reversed)
      };
    }
  }
  const exact = text.match(new RegExp(`\\b(\\d{1,4})\\s*${GUEST_NOUN}\\b`, "i"));
  if (exact) {
    const value = Number(exact[1]);
    if (value > 0 && value <= 2000) {
      return {
        id: "guests",
        field: "guests",
        label: "Guest count",
        value,
        displayValue: `${value} guests`,
        confidence: "high",
        kind: "exact",
        source: excerpt(exact)
      };
    }
  }
  // Word-form range: "eighty to a hundred guests", "between twenty and a
  // hundred guests". Tried before any single-number word match — without
  // this, "eighty to a hundred guests" fell through to the bare wordExact
  // check below, which matches starting at the SECOND number and silently
  // discards the first ("eighty") entirely, reporting a confident-looking
  // but wrong single value. "and" as a range separator is deliberately
  // restricted to the "between X and Y" phrasing specifically (never bare
  // "X and Y guests") — GUEST_NUMBER_PHRASE's grammar already keeps "and"
  // out of ordinary number words, but "between" is the extra, unambiguous
  // anchor that makes "and" safe to read as a range separator here at all.
  const wordRangeBetween = text.match(new RegExp(
    `\\bbetween\\s+${GUEST_NUMBER_PHRASE}\\s+and\\s+${GUEST_NUMBER_PHRASE}\\s+${GUEST_NOUN}\\b`, "i"
  ));
  const wordRangeTo = text.match(new RegExp(
    `\\b${GUEST_NUMBER_PHRASE}\\s*(?:-|–|to|or)\\s*${GUEST_NUMBER_PHRASE}\\s+${GUEST_NOUN}\\b`, "i"
  ));
  const wordRange = wordRangeBetween || wordRangeTo;
  if (wordRange) {
    const min = wordsToGuestCount(wordRange[1]);
    const max = wordsToGuestCount(wordRange[2]);
    if (min > 0 && max >= min && max <= 2000) {
      const midpoint = Math.round((min + max) / 2);
      return {
        id: "guests",
        field: "guests",
        label: "Guest count",
        value: midpoint,
        displayValue: `${min}–${max} guests (draft uses ${midpoint})`,
        confidence: "high",
        kind: "range",
        min,
        max,
        source: excerpt(wordRange)
      };
    }
  }
  const wordApprox = text.match(new RegExp(`(?:about|around|approx(?:\\.|imately)?|roughly|~)\\s*${GUEST_NUMBER_PHRASE}\\s+${GUEST_NOUN}\\b`, "i"));
  if (wordApprox) {
    const value = wordsToGuestCount(wordApprox[1]);
    if (value > 0 && value <= 2000) {
      return {
        id: "guests",
        field: "guests",
        label: "Guest count",
        value,
        displayValue: `~${value} guests`,
        confidence: "high",
        kind: "approximate",
        source: excerpt(wordApprox)
      };
    }
  }
  const wordReversed = text.match(new RegExp(`\\b(?:party|group|headcount|head\\s+count|guest\\s+count)\\s+of\\s+${GUEST_NUMBER_PHRASE}\\b`, "i"));
  if (wordReversed) {
    const value = wordsToGuestCount(wordReversed[1]);
    if (value > 0 && value <= 2000) {
      return {
        id: "guests",
        field: "guests",
        label: "Guest count",
        value,
        displayValue: `${value} guests`,
        confidence: "high",
        kind: "exact",
        source: excerpt(wordReversed)
      };
    }
  }
  const wordExact = text.match(new RegExp(`\\b${GUEST_NUMBER_PHRASE}\\s+${GUEST_NOUN}\\b`, "i"));
  if (wordExact) {
    const value = wordsToGuestCount(wordExact[1]);
    if (value > 0 && value <= 2000) {
      return {
        id: "guests",
        field: "guests",
        label: "Guest count",
        value,
        displayValue: `${value} guests`,
        confidence: "high",
        kind: "exact",
        source: excerpt(wordExact)
      };
    }
  }
  return null;
}

function extractDate(text, nowDate) {
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const value = isoFromParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (value) {
      return { id: "date", field: "date", label: "Event date", value, displayValue: value, confidence: "high", source: excerpt(iso) };
    }
  }
  const usFull = text.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (usFull) {
    const value = isoFromParts(Number(usFull[3]), Number(usFull[1]), Number(usFull[2]));
    if (value) {
      return { id: "date", field: "date", label: "Event date", value, displayValue: value, confidence: "high", source: excerpt(usFull) };
    }
  }
  const monthName = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(20\d{2}))?\b/i);
  if (monthName) {
    const month = MONTHS[monthName[1].toLowerCase().slice(0, 3)];
    const day = Number(monthName[2]);
    const year = monthName[3] ? Number(monthName[3]) : inferYear(month, day, nowDate);
    const value = isoFromParts(year, month, day);
    if (value) {
      return {
        id: "date",
        field: "date",
        label: "Event date",
        value,
        displayValue: value,
        confidence: monthName[3] ? "high" : "medium",
        source: excerpt(monthName)
      };
    }
  }
  const reversedDate = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+of\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?(?:,?\s*(20\d{2}))?\b/i);
  if (reversedDate) {
    const month = MONTHS[reversedDate[2].toLowerCase().slice(0, 3)];
    const day = Number(reversedDate[1]);
    const year = reversedDate[3] ? Number(reversedDate[3]) : inferYear(month, day, nowDate);
    const value = isoFromParts(year, month, day);
    if (value) {
      return {
        id: "date",
        field: "date",
        label: "Event date",
        value,
        displayValue: value,
        confidence: reversedDate[3] ? "high" : "medium",
        source: excerpt(reversedDate)
      };
    }
  }
  const usShort = text.match(/\b(\d{1,2})\/(\d{1,2})\b(?!\/)/);
  if (usShort) {
    const month = Number(usShort[1]);
    const day = Number(usShort[2]);
    if (month >= 1 && month <= 12) {
      const value = isoFromParts(inferYear(month, day, nowDate), month, day);
      if (value) {
        return { id: "date", field: "date", label: "Event date", value, displayValue: value, confidence: "medium", source: excerpt(usShort) };
      }
    }
  }
  // Relative weekdays are computable from today's date, but "next Friday"
  // genuinely means different days to different people — so the computed
  // date is only ever a confirm-required suggestion, never auto-applied.
  const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const relative = text.match(/\b(this|next)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);
  if (relative) {
    const target = WEEKDAYS.indexOf(relative[2].toLowerCase());
    const base = new Date(nowDate.getTime());
    let ahead = (target - base.getDay() + 7) % 7;
    if (ahead === 0) ahead = 7;
    if (relative[1].toLowerCase() === "next") ahead += 7;
    base.setDate(base.getDate() + ahead);
    const value = isoFromParts(base.getFullYear(), base.getMonth() + 1, base.getDate());
    if (value) {
      return {
        id: "date",
        field: "date",
        label: "Event date",
        value,
        displayValue: `${value} (read from "${clean(relative[0])}")`,
        confidence: "low",
        source: excerpt(relative)
      };
    }
  }
  return null;
}

// A time range is two literal facts in one phrase: the start time AND the
// service duration ("6pm to 10pm" = 18:00 start, 4 hours; "8pm to 1am"
// crosses midnight = 5 hours). The end must carry an explicit am/pm; a
// bare start digit inherits the end's meridiem the way people write
// "6-10pm", at medium confidence since it is inferred. Both facts always
// carry the full range as their source.
function extractTimeRange(text) {
  // Guards from the adversarial round: a start digit directly after a
  // month name is a DATE's day, not a start time ("September 6 until
  // 10pm"); and a range in contact/office context is not an event time
  // ("call me 9am-5pm at ...").
  const match = text.match(
    /(?<!\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s{1,3})(?<!\b(?:call|reach|contact|available|office|business)\b[^.?!\n]{0,24})\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|to|until|till)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i
  );
  if (!match) return extractClockWordRange(text);
  const to24 = (hourRaw, meridiem) => {
    let hour = Number(hourRaw);
    if (!(hour >= 1 && hour <= 12)) return null;
    const isPm = meridiem.toLowerCase() === "pm";
    if (isPm && hour !== 12) hour += 12;
    if (!isPm && hour === 12) hour = 0;
    return hour;
  };
  const endMeridiem = match[6];
  // An inherited meridiem must yield a same-day span; if it wraps
  // midnight, the writer almost certainly meant the opposite meridiem
  // ("10-9pm" is 10am-9pm, not a 23-hour wraparound). If neither
  // interpretation stays same-day, extract nothing rather than guess.
  let startMeridiem = match[3] || endMeridiem;
  let startHour = to24(match[1], startMeridiem);
  const endHour = to24(match[4], endMeridiem);
  if (!match[3] && startHour !== null && endHour !== null) {
    const wraps = (h) => (endHour * 60 + (match[5] ? Number(match[5]) : 0))
      <= (h * 60 + (match[2] ? Number(match[2]) : 0));
    if (wraps(startHour)) {
      const flipped = to24(match[1], endMeridiem.toLowerCase() === "pm" ? "am" : "pm");
      if (flipped === null || wraps(flipped)) return null;
      startMeridiem = endMeridiem.toLowerCase() === "pm" ? "am" : "pm";
      startHour = flipped;
    }
  }
  const startMinutes = match[2] ? Number(match[2]) : 0;
  const endMinutes = match[5] ? Number(match[5]) : 0;
  if (startHour === null || endHour === null || startMinutes > 59 || endMinutes > 59) return null;
  const startTotal = startHour * 60 + startMinutes;
  let endTotal = endHour * 60 + endMinutes;
  if (endTotal <= startTotal) endTotal += 24 * 60;
  const rawHours = (endTotal - startTotal) / 60;
  const duration = Math.min(MAX_EVENT_HOURS, Math.max(MIN_EVENT_HOURS, Math.round(rawHours)));
  const confidence = match[3] ? "high" : "medium";
  const timeValue = `${pad2(startHour)}:${pad2(startMinutes)}`;
  return {
    time: {
      id: "time",
      field: "time",
      label: "Start time",
      value: timeValue,
      displayValue: timeValue,
      confidence,
      source: excerpt(match)
    },
    hours: {
      id: "hours",
      field: "hours",
      label: "Service hours",
      value: duration,
      displayValue: duration === Math.round(rawHours)
        ? `${duration} hours (from the ${clean(match[0])} range)`
        : `${Math.round(rawHours)} in the range (builder bound: ${duration})`,
      confidence,
      source: excerpt(match)
    }
  };
}

// A range where one or both sides are "noon"/"midnight" instead of a
// digit+meridiem token ("6pm to midnight", "noon to 4pm"). Kept separate
// from the digit-range regex above rather than folded in, so the already
// adversarially-hardened digit path is untouched. Deliberately narrower:
// a bare digit side must carry its OWN explicit am/pm here (no meridiem
// inheritance) — "6 to midnight" has no way to know if 6 means 6am or
// 6pm, and inventing one would contradict the "extract nothing rather
// than guess" rule the rest of this file follows.
function extractClockWordRange(text) {
  const clockToken = "(?:noon|midnight|\\d{1,2}(?::\\d{2})?\\s*(?:am|pm))";
  const match = text.match(new RegExp(
    `(?<!\\b(?:call|reach|contact|available|office|business)\\b[^.?!\\n]{0,24})\\b(${clockToken})\\s*${TIME_RANGE_SEPARATOR}\\s*(${clockToken})\\b`,
    "i"
  ));
  if (!match) return null;
  const toMinutes = (phrase) => {
    const key = phrase.trim().toLowerCase();
    if (key in CLOCK_WORD_MINUTES) return CLOCK_WORD_MINUTES[key];
    const digit = key.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
    if (!digit) return null;
    let hour = Number(digit[1]);
    const minutes = digit[2] ? Number(digit[2]) : 0;
    if (!(hour >= 1 && hour <= 12) || minutes > 59) return null;
    const isPm = digit[3] === "pm";
    if (isPm && hour !== 12) hour += 12;
    if (!isPm && hour === 12) hour = 0;
    return hour * 60 + minutes;
  };
  const startMinutes = toMinutes(match[1]);
  const endMinutes = toMinutes(match[2]);
  if (startMinutes === null || endMinutes === null) return null;
  let endTotal = endMinutes;
  if (endTotal <= startMinutes) endTotal += 24 * 60;
  const rawHours = (endTotal - startMinutes) / 60;
  const duration = Math.min(MAX_EVENT_HOURS, Math.max(MIN_EVENT_HOURS, Math.round(rawHours)));
  const timeValue = `${pad2(Math.floor(startMinutes / 60))}:${pad2(startMinutes % 60)}`;
  return {
    time: {
      id: "time",
      field: "time",
      label: "Start time",
      value: timeValue,
      displayValue: timeValue,
      confidence: "high",
      source: excerpt(match)
    },
    hours: {
      id: "hours",
      field: "hours",
      label: "Service hours",
      value: duration,
      displayValue: duration === Math.round(rawHours)
        ? `${duration} hours (from the ${clean(match[0])} range)`
        : `${Math.round(rawHours)} in the range (builder bound: ${duration})`,
      confidence: "high",
      source: excerpt(match)
    }
  };
}

// Shared by extractClockWordRange and the CLOCK_WORD_GUARD below. "til"
// and "'til" were missing from the original separator list — adversarial
// verification found real sentences ("6 til midnight", "9 'til noon")
// that slipped past the dangling-range guard specifically because of
// that gap, not because the guard's logic was wrong. AMBIGUOUS_HOUR_TOKEN
// closes the matching digit-only gap: the guard must also recognize a
// WORD-form ambiguous hour ("six to midnight" is exactly as unresolvable
// as "6 to midnight" — neither states am/pm).
const TIME_RANGE_SEPARATOR = "(?:-|–|to|until|till|-?'?til-?)";
const AMBIGUOUS_HOUR_WORD = "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve";
const AMBIGUOUS_HOUR_TOKEN = `(?:\\d{1,2}(?::\\d{2})?|${AMBIGUOUS_HOUR_WORD})`;

// "noon"/"midnight" are unambiguous clock words, not digit+meridiem pairs,
// but they can also be part of a name ("the Midnight Garden Estate",
// "our Midnight Masquerade gala"). Guarded in extractTime below: not
// preceded by "the " (English proper nouns and named features
// overwhelmingly take a leading article: "the midnight buffet" as a menu
// feature is not a stated start). A "not followed by a Capitalized word"
// guard was tried too, to catch names like "Midnight Masquerade" without
// "the" — but adversarial verification found it rejected far more real
// sentences than it protected ("at midnight New Year's Eve", "at noon
// Friday", "at noon Eastern time" all lost their time fact purely because
// a capitalized word happened to follow), while the "the "-guard alone
// already covers the dominant real-world name-collision shape. Dropped in
// favor of that better-evidenced tradeoff. A second guard rejects a clock
// word that is really the unresolved END of a "N to clockword" range
// ("6 to midnight", "six til midnight" — no meridiem stated on either
// side) — extractTimeRange already extracts nothing for that dangling
// range, and extractTime must not silently mislabel the END as the
// "Start time" by grabbing just the clock word; see extractClockWordRange
// below for when both sides resolve.
const CLOCK_WORD_MINUTES = Object.freeze({ noon: 720, midnight: 0 });
const CLOCK_WORD_GUARD = `(?<!\\b(?:call|reach|contact|available|office|business)\\b[^.?!\\n]{0,24})(?<!\\bthe\\s)(?<!\\b${AMBIGUOUS_HOUR_TOKEN}\\s*${TIME_RANGE_SEPARATOR}\\s*)`;

function extractTime(text) {
  // Same contact-context guard as extractTimeRange: "call me after 9am"
  // is availability, not an event start.
  const meridiem = text.match(/(?<!\b(?:call|reach|contact|available|office|business)\b[^.?!\n]{0,24})\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (meridiem) {
    let hour = Number(meridiem[1]);
    const minutes = meridiem[2] ? Number(meridiem[2]) : 0;
    if (hour >= 1 && hour <= 12 && minutes <= 59) {
      const isPm = meridiem[3].toLowerCase() === "pm";
      if (isPm && hour !== 12) hour += 12;
      if (!isPm && hour === 12) hour = 0;
      const value = `${pad2(hour)}:${pad2(minutes)}`;
      return { id: "time", field: "time", label: "Start time", value, displayValue: value, confidence: "high", source: excerpt(meridiem) };
    }
  }
  const military = text.match(/\b([01]\d|2[0-3]):([0-5]\d)\b/);
  if (military) {
    const value = `${military[1]}:${military[2]}`;
    return { id: "time", field: "time", label: "Start time", value, displayValue: value, confidence: "medium", source: excerpt(military) };
  }
  const clockWord = text.match(new RegExp(`${CLOCK_WORD_GUARD}\\b(noon|midnight)\\b`, "i"));
  if (clockWord) {
    const minutes = CLOCK_WORD_MINUTES[clockWord[1].toLowerCase()];
    const value = `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
    return { id: "time", field: "time", label: "Start time", value, displayValue: value, confidence: "high", source: excerpt(clockWord) };
  }
  return null;
}

function extractHours(text) {
  const match = text.match(/\b(\d{1,2})\s*(?:-|\s)?\s*(?:hour|hr)s?\b/i);
  if (!match) return null;
  const raw = Number(match[1]);
  if (!(raw > 0)) return null;
  const value = Math.min(MAX_EVENT_HOURS, Math.max(MIN_EVENT_HOURS, raw));
  return {
    id: "hours",
    field: "hours",
    label: "Service hours",
    value,
    displayValue: value === raw ? `${value} hours` : `${raw} requested (builder bound: ${value})`,
    confidence: "high",
    source: excerpt(match)
  };
}

function extractEmail(text) {
  const match = text.match(/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/);
  if (!match) return null;
  return { id: "email", field: "email", label: "Customer email", value: match[0], displayValue: match[0], confidence: "high", source: excerpt(match) };
}

function extractPhone(text) {
  const match = text.match(/(?:\+?1[-. ]?)?\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/);
  if (!match) return null;
  return { id: "phone", field: "phone", label: "Customer phone", value: clean(match[0]), displayValue: clean(match[0]), confidence: "high", source: excerpt(match) };
}

// Staff counts, the same only-what's-literally-there way as guests: a
// count directly attached to a role noun. Adversarially hardened
// (2026-08-11 verification round): the noun must not be possessive or an
// equipment/tech/address sense ("chef's kiss", "server rack", "servers of
// data", "4 Cooks Lane" extract nothing); a word-number must not be the
// tail of a compound ("twenty-one servers" extracts nothing rather than
// 1); digit ranges mirror extractGuests' midpoint with a transparent
// display; and the articles "a"/"an" — literally one, but the top
// false-positive source in prose — surface at LOW confidence so they
// require human confirmation instead of auto-applying. Bare role
// mentions with no count extract nothing — counting would be inventing.
const STAFF_ROLES = Object.freeze([
  { field: "servers", label: "Servers", noun: "(?:servers?|waiters?|waitstaff)" },
  { field: "chefs", label: "Chefs", noun: "(?:chefs?|cooks?)" },
  { field: "bartenders", label: "Bartenders", noun: "(?:bartenders?|barkeeps?)" }
]);
const STAFF_NUMBER_WORDS = Object.freeze({
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12
});
// Rejects the possessive apostrophe and the non-staffing senses the
// verification round actually produced from realistic prose.
const STAFF_NOUN_GUARD = "(?!['’]|\\s+(?:of\\b|rooms?\\b|racks?\\b|lane\\b|ln\\b|streets?\\b|st\\b|avenues?\\b|ave\\b|way\\b|roads?\\b|rd\\b|drives?\\b|dr\\b|courts?\\b|ct\\b|blvd\\b))";
const STAFF_MODIFIER = "(?:extra\\s+|additional\\s+|more\\s+)?";
const COMPOUND_TENS_GUARD = "(?<!(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[-\\s])";

function extractStaffCounts(text) {
  return STAFF_ROLES.map(({ field, label, noun }) => {
    const range = text.match(new RegExp(
      `\\b(\\d{1,2})\\s*(?:-|–|to)\\s*(\\d{1,2})\\s+${STAFF_MODIFIER}${noun}\\b${STAFF_NOUN_GUARD}`,
      "i"
    ));
    if (range) {
      const min = Number(range[1]);
      const max = Number(range[2]);
      if (min >= 1 && max > min && max <= 50) {
        const value = Math.ceil((min + max) / 2);
        return {
          id: field,
          field,
          label,
          value,
          displayValue: `${min}–${max} ${label.toLowerCase()} → planning ${value}`,
          kind: "range",
          min,
          max,
          confidence: "high",
          source: excerpt(range)
        };
      }
    }
    const match = text.match(new RegExp(
      `${COMPOUND_TENS_GUARD}\\b(\\d{1,2}|${Object.keys(STAFF_NUMBER_WORDS).join("|")}|an?)\\s+${STAFF_MODIFIER}${noun}\\b${STAFF_NOUN_GUARD}`,
      "i"
    ));
    if (!match) return null;
    const token = match[1].toLowerCase();
    const article = token === "a" || token === "an";
    const value = /^\d+$/.test(token)
      ? Number(token)
      : article ? 1 : STAFF_NUMBER_WORDS[token];
    if (!(value >= 1 && value <= 50)) return null;
    return {
      id: field,
      field,
      label,
      value,
      displayValue: `${value} ${label.toLowerCase()}`,
      confidence: article ? "low" : "high",
      source: excerpt(match)
    };
  }).filter(Boolean);
}

function extractStyle(text, styles) {
  const candidates = [
    { pattern: /\bplated\b/i, style: "Plated" },
    { pattern: /\bbuffet\b/i, style: "Buffet" },
    { pattern: /\b(?:food\s+)?stations\b/i, style: "Stations" },
    { pattern: /\bdrop[- ]?off\b/i, style: "Drop-off" }
  ];
  for (const candidate of candidates) {
    const match = text.match(candidate.pattern);
    if (match && styles.includes(candidate.style)) {
      return {
        id: "style",
        field: "style",
        label: "Service style",
        value: candidate.style,
        displayValue: candidate.style,
        confidence: "high",
        source: excerpt(match)
      };
    }
  }
  return null;
}

function extractEventType(text, eventTypes) {
  const lower = text.toLowerCase();
  const named = eventTypes
    .filter((type) => clean(type?.name).length >= 4)
    .map((type) => ({ type, name: clean(type.name).toLowerCase() }))
    .filter((entry) => lower.includes(entry.name))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (named) {
    return {
      id: "eventTypeId",
      field: "eventTypeId",
      label: "Event type",
      value: named.type.id,
      displayValue: clean(named.type.name),
      confidence: "high",
      source: clean(named.type.name)
    };
  }
  for (const keyword of EVENT_TYPE_KEYWORDS) {
    if (!lower.includes(keyword)) continue;
    const match = eventTypes.find((type) => clean(type?.name).toLowerCase().includes(keyword));
    if (match) {
      return {
        id: "eventTypeId",
        field: "eventTypeId",
        label: "Event type",
        value: match.id,
        displayValue: `${clean(match.name)} (matched "${keyword}")`,
        confidence: "medium",
        source: keyword
      };
    }
  }
  return null;
}

function extractEventName(text) {
  const match = text.match(/\b([A-Z][\w']+(?:\s+[A-Z][\w']+)?\s+(?:Wedding|Gala|Dinner|Reception|Party|Retreat|Luncheon|Shower|Fundraiser|Picnic))\b/);
  if (!match) return null;
  return { id: "eventName", field: "eventName", label: "Event name", value: match[1], displayValue: match[1], confidence: "medium", source: excerpt(match) };
}

// Deliberately kept fully case-sensitive (no /i) throughout, including
// the "venue is/will be/:" introducer's own case: an /i flag would make
// the [A-Z] inside VENUE_NAME match lowercase letters too and start
// capturing ordinary prose ("venue is still being decided") as if it
// were a name. A small [Vv] alternation covers the one real case
// variance (sentence-initial "Venue:" vs. mid-sentence "the venue is")
// without paying that cost.
const VENUE_NAME = "[A-Z][\\w'&./-]*(?:\\s+[A-Z][\\w'&./-]*){0,5}";

// The char class above allows an internal "." for real abbreviations
// ("St. Mary's Hall") and now "/" for shorthand like "N/A"; the tradeoff
// is that a venue name sitting right at the end of a sentence also
// swallows that sentence's own closing period ("...at the Riverside
// Loft." -> "Riverside Loft."), and — worse, found in adversarial
// verification — a venue name followed by a NEW capitalized sentence
// swallows that whole next sentence too ("Venue: The Grand Ballroom.
// Please confirm by Friday." -> "The Grand Ballroom. Please"), since
// "Please" is itself capitalized and the repetition has no sentence-
// boundary concept. Fixed below by treating any ". " (period + space) as
// a hard stop UNLESS the word right before it is a known abbreviation
// that legitimately continues ("St.", "Mt.", "Dr." ...) — that allowlist
// is what lets "St. Mary's Hall" survive while "Ballroom. Please" does
// not. A single trailing period (nothing captured after it) is handled
// separately by trimTrailingPeriod, since indexOf(". ") never finds a
// match with no space after the period.
const VENUE_CONTINUATION_ABBREVIATIONS = new Set(["st", "mt", "dr", "mr", "mrs", "ms", "ste", "ft", "ave", "jr", "sr"]);

function stopAtSentenceBoundary(value) {
  let cursor = 0;
  for (;;) {
    const boundary = value.indexOf(". ", cursor);
    if (boundary === -1) return value;
    const precedingWord = (value.slice(0, boundary).match(/(\w+)$/) || [])[1] || "";
    if (VENUE_CONTINUATION_ABBREVIATIONS.has(precedingWord.toLowerCase())) {
      cursor = boundary + 2;
      continue;
    }
    return value.slice(0, boundary);
  }
}

function trimTrailingPeriod(value) {
  return value.endsWith(".") ? value.slice(0, -1) : value;
}

// Common real-world "no answer yet" shorthand from call notes/emails
// ("Venue: TBD.", "Venue is N/A at this time.") reads as a proper noun to
// the capture pattern above and must not be offered as a one-tap-
// confirmable venue guess — that is exactly the invention this file's
// house rule forbids, independent of confidence tier. A captured value
// under 2 characters (a truncation artifact, not a real short name) is
// rejected the same way.
// "not" alone (not "not sure yet" in full) is the realistic capture here:
// VENUE_NAME's repetition only continues into a following word if THAT
// word is also capitalized, so "Venue: Not sure yet..." only ever
// captures "Not" — the lowercase "sure" stops it right there.
const VENUE_PLACEHOLDER_PATTERN = /^(?:tbd|tba|tbc|n\/?a|not(?:\s+sure(?:\s+yet)?)?|unsure|unknown|pending|undecided|to\s+be\s+(?:determined|announced|confirmed))$/i;

function cleanVenueValue(raw) {
  const value = trimTrailingPeriod(clean(stopAtSentenceBoundary(clean(raw))));
  if (value.length < 2 || VENUE_PLACEHOLDER_PATTERN.test(value)) return "";
  return value;
}

function extractVenue(text) {
  const labeled = text.match(new RegExp(`\\b[Vv]enue\\s*(?:is|will\\s+be|:)\\s*(?:the\\s+)?(${VENUE_NAME})`));
  if (labeled) {
    const value = cleanVenueValue(labeled[1]);
    if (value) {
      return { id: "venue", field: "venue", label: "Venue", value, displayValue: value, confidence: "low", source: excerpt(labeled) };
    }
  }
  const match = text.match(new RegExp(`\\bat\\s+(?:the\\s+)?(${VENUE_NAME})`));
  if (!match) return null;
  const value = cleanVenueValue(match[1]);
  if (!value) return null;
  return { id: "venue", field: "venue", label: "Venue", value, displayValue: value, confidence: "low", source: excerpt(match) };
}

function extractVenueAddress(text) {
  const match = text.match(/\b\d{1,5}\s+[\w. ]+?\b(?:st|street|ave|avenue|blvd|boulevard|road|rd|drive|dr|lane|ln|way|circle|cir)\b[^,\n]*/i);
  if (!match) return null;
  return { id: "venueAddress", field: "venueAddress", label: "Venue address", value: clean(match[0]), displayValue: clean(match[0]), confidence: "low", source: excerpt(match) };
}

function extractDietary(text) {
  const match = text.match(/[^.;\n]*\b(?:vegan|vegetarian|gluten|allerg\w*|kosher|halal|dairy[- ]free|nut[- ]free)\b[^.;\n]*/i);
  if (!match) return null;
  const value = clean(match[0]).slice(0, 160);
  return { id: "dietaryRestrictions", field: "dietaryRestrictions", label: "Dietary notes", value, displayValue: value, confidence: "medium", source: value.slice(0, 80) };
}

// The builder plans exactly one event date; a genuine multi-day mention
// is surfaced as an informational note only — never a fact, never
// touching draft.date — so the operator decides which day to use (or
// that the event needs handling outside this single-date model) instead
// of the extractor silently collapsing it. Two conservative signals: a
// same-month day range ("June 12-14", "June 12 to 14") anchored on a
// leading month name — that anchor is what keeps "to" safe to include
// here even though it is too overloaded elsewhere in prose ("up to 14
// guests" has no month name before it, so it can never match this
// pattern) — and an explicit "N-day event" phrase (digit or word form,
// "3-day"/"three-day"), optionally with a modifier or two before the
// noun ("3-day corporate retreat"), N >= 2 (a "1-day event" is
// reassuring that it is NOT multi-day, so it must not trigger this
// note). A negation guard (not/never/no/won't/isn't/...) keeps an
// explicitly-denied mention ("this is NOT a multi-day event") from
// firing, and the N-day pattern specifically excludes a following
// before/after/prior/ahead/since/until — those signal LEAD or TRAIL time
// around a single-day event ("2 days before the wedding" is setup lead
// time, not a two-day wedding), not the event's own duration.
const MULTI_DAY_NEGATION_GUARD = "(?<!\\b(?:not|never|no|won't|isn't|wasn't|doesn't|didn't|aren't|weren't|wouldn't|couldn't|shouldn't)\\b[^.?!\\n]{0,24})";
const MULTI_DAY_LEAD_TIME_GUARD = "(?!(?:before|after|prior|ahead|following|since|until)\\b)";
const MULTI_DAY_COUNT_WORD = "two|three|four|five|six|seven|eight|nine|ten|eleven|twelve";

function extractMultiDayNote(text) {
  const dayRange = text.match(new RegExp(
    `${MULTI_DAY_NEGATION_GUARD}\\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:-|–|to|through|thru)\\s*(\\d{1,2})(?:st|nd|rd|th)?\\b`,
    "i"
  ));
  if (dayRange && Number(dayRange[3]) > Number(dayRange[2]) && Number(dayRange[3]) <= 31) {
    return {
      id: "multi-day",
      label: "Multiple days mentioned",
      text: `"${clean(dayRange[0])}" reads as a date range. This builder plans one event date — the reading above uses the first day; confirm the right day, or plan additional days as separate quotes.`,
      source: excerpt(dayRange)
    };
  }
  const namedSpan = text.match(new RegExp(
    `${MULTI_DAY_NEGATION_GUARD}\\b(\\d{1,2}|${MULTI_DAY_COUNT_WORD})[\\s-]*days?\\s+${MULTI_DAY_LEAD_TIME_GUARD}(?:\\w+\\s+){0,2}(?:event|wedding|celebration|retreat|conference|festival|affair)\\b`,
    "i"
  ))
    || text.match(new RegExp(`${MULTI_DAY_NEGATION_GUARD}\\bmulti[\\s-]?day\\b`, "i"))
    || text.match(new RegExp(`${MULTI_DAY_NEGATION_GUARD}\\bmultiple\\s+days?\\b`, "i"));
  if (namedSpan && (!/^\d+$/.test(namedSpan[1] || "") || Number(namedSpan[1]) >= 2)) {
    return {
      id: "multi-day",
      label: "Multiple days mentioned",
      text: `"${clean(namedSpan[0])}" suggests the event spans more than one day. This builder plans one event date — confirm the day this quote should use, or plan additional days as separate quotes.`,
      source: excerpt(namedSpan)
    };
  }
  return null;
}

function extractBudgetNote(text) {
  const explicit = text.match(/budget\s*(?:of|around|about|is|near|:)?\s*\$?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k)?\b/i)
    || text.match(/\$\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k)?\b/i);
  if (!explicit) return null;
  const numeric = Number(String(explicit[1]).replace(/,/g, ""));
  if (!(numeric > 0)) return null;
  const amount = explicit[2] ? numeric * 1000 : numeric;
  return {
    id: "budget",
    label: "Budget mention",
    amount,
    text: `Budget mentioned (~$${amount.toLocaleString("en-US")}). The builder has no budget field yet — keep it in mind when choosing a package.`,
    source: excerpt(explicit)
  };
}

export function extractIntentDraft(text, { eventTypes = [], styles = [], nowDate = new Date() } = {}) {
  const input = String(text || "");
  const trimmed = input.trim();
  if (!trimmed) {
    return { modelId: INTENT_EXTRACTION_MODEL, facts: [], needsConfirmation: [], notes: [], draft: {}, empty: true };
  }

  // A time range supplies both start time and duration; an explicit
  // "N hours" phrase is more literal than a computed span, so it wins.
  const timeRange = extractTimeRange(trimmed);
  const explicitHours = extractHours(trimmed);
  const facts = [
    extractGuests(trimmed),
    extractDate(trimmed, nowDate),
    timeRange ? timeRange.time : extractTime(trimmed),
    explicitHours || (timeRange ? timeRange.hours : null),
    extractEmail(trimmed),
    extractPhone(trimmed),
    ...extractStaffCounts(trimmed),
    extractStyle(trimmed, Array.isArray(styles) ? styles : []),
    extractEventType(trimmed, Array.isArray(eventTypes) ? eventTypes : []),
    extractEventName(trimmed),
    extractVenue(trimmed),
    extractVenueAddress(trimmed),
    extractDietary(trimmed)
  ].filter(Boolean);

  const applied = facts.filter((fact) => fact.confidence !== "low");
  const needsConfirmation = facts.filter((fact) => fact.confidence === "low");
  const draft = {};
  for (const fact of applied) {
    if (fact.field) draft[fact.field] = fact.value;
  }

  const notes = [];
  const budget = extractBudgetNote(trimmed);
  if (budget) notes.push(budget);
  const multiDay = extractMultiDayNote(trimmed);
  if (multiDay) notes.push(multiDay);
  const guests = facts.find((fact) => fact.id === "guests");
  if (guests?.kind === "range") {
    notes.push({
      id: "guest-range",
      label: "Guest range",
      text: `Guest range ${guests.min}–${guests.max} noted; the draft uses ${guests.value} until the count is confirmed.`,
      source: guests.source
    });
  }

  return {
    modelId: INTENT_EXTRACTION_MODEL,
    facts: applied,
    needsConfirmation,
    notes,
    draft,
    empty: false
  };
}
