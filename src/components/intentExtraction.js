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
  const monthName = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(20\d{2}))?\b/i);
  if (monthName) {
    const month = MONTHS[monthName[1].toLowerCase()];
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
  return null;
}

function extractTime(text) {
  const meridiem = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
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

function extractVenue(text) {
  const match = text.match(/\bat\s+(?:the\s+)?([A-Z][\w'&.-]*(?:\s+[A-Z][\w'&.-]*){0,5})/);
  if (!match) return null;
  return { id: "venue", field: "venue", label: "Venue", value: clean(match[1]), displayValue: clean(match[1]), confidence: "low", source: excerpt(match) };
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

  const facts = [
    extractGuests(trimmed),
    extractDate(trimmed, nowDate),
    extractTime(trimmed),
    extractHours(trimmed),
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
