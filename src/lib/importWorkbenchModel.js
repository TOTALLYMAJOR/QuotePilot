const DEFINITIONS = Object.freeze({
  customers: { label: "Customers", collection: "customers", fields: ["name", "email", "phone", "company", "notes"], requiredAny: ["name", "email"], sourceKinds: ["csv"] },
  packages: { label: "Packages", collection: "catalogPackages", fields: ["name", "ppp", "costPpp", "includedMenuItems", "includedAddons", "includedRentals", "active"], required: ["name", "ppp"], sourceKinds: ["csv", "pdf"] },
  addons: { label: "Add-ons", collection: "catalogAddons", fields: ["name", "type", "price", "cost", "active"], required: ["name", "price"], sourceKinds: ["csv", "pdf"] },
  rentals: { label: "Rentals", collection: "catalogRentals", fields: ["name", "price", "cost", "qtyPerGuests", "active"], required: ["name", "price", "qtyPerGuests"], sourceKinds: ["csv", "pdf"] },
  eventTypes: { label: "Event types", collection: "eventTypes", fields: ["name", "active"], required: ["name"], sourceKinds: ["csv", "pdf"] },
  menuCategories: { label: "Menu sections", collection: "menuCategories", fields: ["name", "eventType", "active"], required: ["name", "eventTypeId"], sourceKinds: ["csv", "pdf"] },
  menuItems: { label: "Menu items", collection: "menuItems", fields: ["name", "eventType", "category", "price", "cost", "pricingType", "active"], required: ["name", "eventTypeId", "categoryId", "price"], sourceKinds: ["csv", "pdf"] }
});

const ALIASES = Object.freeze({
  name: ["name", "customer", "customer name", "client", "client name", "item", "item name", "package", "package name", "menu item"],
  email: ["email", "email address", "customer email", "client email"],
  phone: ["phone", "phone number", "mobile", "cell"],
  company: ["company", "organization", "business", "client organization"],
  notes: ["notes", "note", "comments"],
  ppp: ["ppp", "price per person", "per person price", "rate per person"],
  price: ["price", "rate", "amount", "sale price", "unit price"],
  costPpp: ["cost per person", "food cost per person", "cost ppp", "costppp"],
  cost: ["cost", "unit cost", "item cost", "food cost"],
  type: ["type", "pricing type", "rate type"],
  pricingType: ["pricing type", "price type", "billing type", "rate type"],
  qtyPerGuests: ["qty per guests", "quantity per guests", "guests per unit", "guest ratio"],
  active: ["active", "enabled", "available", "status"],
  eventType: ["event type", "event type id", "event", "event id"],
  category: ["category", "category id", "menu category", "menu category id", "menu section", "section"],
  includedMenuItems: ["included menu items", "menu items included", "included items", "package menu items"],
  includedAddons: ["included add ons", "included addons", "add ons included", "addons included"],
  includedRentals: ["included rentals", "rentals included"]
});

const DELIMITERS = [",", "\t", ";", "|"];
const MONEY_FIELDS = new Set(["price", "ppp", "cost", "costPpp", "qtyPerGuests"]);

function clean(value) {
  return String(value ?? "").trim();
}

export function normalizeImportText(value) {
  return clean(value).toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function tokenize(text, delimiter) {
  const rows = [];
  const diagnostics = [];
  let row = [];
  let cell = "";
  let quoted = false;
  let rowNumber = 1;
  let quoteRow = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
        if (quoted) quoteRow = rowNumber;
      }
    } else if (character === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => clean(value))) rows.push({ rowNumber, values: row });
      row = [];
      cell = "";
      rowNumber += 1;
    } else {
      cell += character;
    }
  }
  if (quoted) diagnostics.push({ severity: "error", code: "unclosed_quote", rowNumber: quoteRow || rowNumber, message: `A quoted value beginning on row ${quoteRow || rowNumber} is not closed.` });
  row.push(cell);
  if (row.some((value) => clean(value))) rows.push({ rowNumber, values: row });
  return { rows, diagnostics };
}

function delimiterScore(text, delimiter) {
  const widths = tokenize(text.slice(0, 80_000), delimiter).rows.slice(0, 30).map((row) => row.values.length);
  const frequency = new Map();
  widths.forEach((width) => frequency.set(width, (frequency.get(width) || 0) + 1));
  const best = [...frequency.entries()].sort((left, right) => right[1] - left[1])[0] || [1, 0];
  return best[0] > 1 ? (best[1] * 10) + best[0] : 0;
}

export function parseCsvSource(input = "") {
  const text = String(input || "").replace(/^\uFEFF/, "");
  const delimiter = DELIMITERS.map((value) => ({ value, score: delimiterScore(text, value) })).sort((a, b) => b.score - a.score)[0]?.value || ",";
  const parsed = tokenize(text, delimiter);
  if (!parsed.rows.length) return { headers: [], rows: [], diagnostics: parsed.diagnostics, delimiter };
  const header = parsed.rows[0];
  const seen = new Map();
  const diagnostics = [...parsed.diagnostics];
  const headers = header.values.map((value, index) => {
    const base = clean(value) || `Column ${index + 1}`;
    const key = normalizeImportText(base);
    const count = (seen.get(key) || 0) + 1;
    seen.set(key, count);
    if (count > 1) diagnostics.push({ severity: "warning", code: "duplicate_header", rowNumber: header.rowNumber, message: `Column “${base}” appears more than once and was labeled separately.` });
    return count === 1 ? base : `${base} (${count})`;
  });
  const rows = parsed.rows.slice(1).map((source) => {
    if (source.values.length !== headers.length) diagnostics.push({
      severity: source.values.length > headers.length ? "error" : "warning",
      code: source.values.length > headers.length ? "unassigned_overflow_values" : "uneven_row",
      rowNumber: source.rowNumber,
      message: source.values.length > headers.length
        ? `Row ${source.rowNumber} has ${source.values.length - headers.length} value(s) with no heading. Add the missing heading or remove those values before import.`
        : `Row ${source.rowNumber} has ${source.values.length} column(s); the header defines ${headers.length}. Missing trailing values remain Not provided.`
    });
    return {
      rowNumber: source.rowNumber,
      sourceLocator: { kind: "csv", row: source.rowNumber },
      values: Object.fromEntries(headers.map((name, index) => [name, clean(source.values[index])]))
    };
  });
  if (delimiter !== ",") diagnostics.unshift({ severity: "info", code: "alternate_delimiter", message: `Detected ${delimiter === "\t" ? "tab" : `“${delimiter}”`} separated values.` });
  return { headers, rows, diagnostics, delimiter };
}

export const IMPORT_TYPES = Object.entries(DEFINITIONS).map(([id, definition]) => ({ id, label: definition.label, sourceKinds: [...definition.sourceKinds] }));

export function getImportTypeDefinition(importType = "") {
  return DEFINITIONS[importType] || DEFINITIONS.customers;
}

export function suggestFieldMapping(headers = [], importType = "customers") {
  const normalized = headers.map((header) => ({ header, normalized: normalizeImportText(header) }));
  const used = new Set();
  return getImportTypeDefinition(importType).fields.reduce((mapping, field) => {
    const aliases = ALIASES[field] || [normalizeImportText(field)];
    const match = normalized.find((entry) => !used.has(entry.header) && aliases.includes(entry.normalized))
      || normalized.find((entry) => !used.has(entry.header) && aliases.some((alias) => entry.normalized.includes(alias) || alias.includes(entry.normalized)));
    mapping[field] = match?.header || "";
    if (match) used.add(match.header);
    return mapping;
  }, {});
}

export function validateFieldMapping(mapping = {}) {
  const bySource = new Map();
  Object.entries(mapping).forEach(([field, source]) => {
    if (!clean(source)) return;
    if (!bySource.has(source)) bySource.set(source, []);
    bySource.get(source).push(field);
  });
  return [...bySource.entries()].filter(([, fields]) => fields.length > 1).map(([source, fields]) => ({ severity: "error", code: "mapping_collision", message: `“${source}” is mapped to ${fields.join(" and ")}. Map each source column only once.` }));
}

export function detectImportType(headers = []) {
  const normalized = headers.map(normalizeImportText);
  return Object.keys(DEFINITIONS).map((importType) => {
    let score = Object.values(suggestFieldMapping(headers, importType)).filter(Boolean).length;
    if (importType === "customers" && normalized.some((header) => /email|phone|client|customer/.test(header))) score += 5;
    if (importType === "menuItems" && normalized.some((header) => /category|menu section/.test(header)) && normalized.some((header) => /price|cost/.test(header))) score += 5;
    if (importType === "menuCategories" && normalized.some((header) => /menu section|category/.test(header)) && !normalized.some((header) => /price|cost/.test(header))) score += 4;
    if (importType === "eventTypes" && normalized.some((header) => header === "event type") && normalized.length <= 3) score += 4;
    if (importType === "packages" && normalized.some((header) => header === "ppp" || header.includes("per person"))) score += 5;
    if (importType === "rentals" && normalized.some((header) => /rental|guests per unit/.test(header))) score += 5;
    if (importType === "addons" && normalized.some((header) => /add on|addon/.test(header))) score += 5;
    return { importType, score };
  }).sort((left, right) => right.score - left.score)[0]?.importType || "customers";
}

function parseMoney(value) {
  const source = clean(value);
  if (!source) return { value: null, availability: "not_provided" };
  const normalized = source.replace(/[\s$,]/g, "").replace(/^\((.+)\)$/, "-$1");
  const parsed = /^-?\d+(?:\.\d{1,2})?$/.test(normalized) ? Number(normalized) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { value: null, availability: "unknown", error: "must be a zero or positive amount" };
  }
  if (Math.round(parsed * 100) > 100_000_000) {
    return { value: null, availability: "unknown", error: "must not exceed 1000000.00" };
  }
  return { value: Math.round(parsed * 100) / 100, availability: "available" };
}

function parseBoolean(value) {
  const normalized = normalizeImportText(value);
  if (!normalized) return { value: true, availability: "available", origin: "defaulted" };
  if (["true", "yes", "y", "1", "active", "enabled", "available"].includes(normalized)) return { value: true, availability: "available", origin: "prepopulated" };
  if (["false", "no", "n", "0", "inactive", "disabled", "unavailable"].includes(normalized)) return { value: false, availability: "available", origin: "prepopulated" };
  return { value: null, availability: "unknown", origin: "prepopulated", error: "must say yes/no, true/false, active/inactive, or 1/0" };
}

function parsePricing(value, fallback) {
  const normalized = normalizeImportText(value);
  if (!normalized) return { value: fallback, availability: "available", origin: "defaulted" };
  if (["per person", "person", "pp", "ppp"].includes(normalized)) return { value: "per_person", availability: "available", origin: "prepopulated" };
  if (["per item", "item", "unit", "each"].includes(normalized)) return { value: "per_item", availability: "available", origin: "prepopulated" };
  if (["per event", "event", "flat", "flat fee"].includes(normalized)) return { value: "per_event", availability: "available", origin: "prepopulated" };
  return { value: null, availability: "unknown", origin: "prepopulated", error: "must be per person, per item, or per event" };
}

function fieldState(source, parsed = {}) {
  const availability = parsed.availability || (clean(source) ? "known" : "not_provided");
  const origin = parsed.origin || (clean(source) ? "prepopulated" : "direct");
  return {
    ...(availability === "known" || availability === "available" ? {} : { availability }),
    ...(origin === "direct" ? {} : { origin }),
    editability: "read_only",
    evidence: parsed.error ? "failed" : "pending"
  };
}

function candidates(context, key) {
  if (Array.isArray(context?.[key]) && context[key].length) return context[key];
  const sections = Array.isArray(context?.menuSections) ? context.menuSections : [];
  if (key === "categories") return sections.map((section) => ({ ...section, id: section.id || section.categoryId, eventTypeId: section.eventTypeId || context.eventTypeId }));
  if (key === "menuItems") return sections.flatMap((section) => (section.items || []).map((item) => ({ ...item, categoryId: item.categoryId || section.id || section.categoryId, eventTypeId: item.eventTypeId || section.eventTypeId || context.eventTypeId })));
  return [];
}

function resolveOne(value, options, label, filter = () => true) {
  const source = clean(value);
  if (!source) return { id: "", state: fieldState(""), error: `${label} is required` };
  const eligible = options.filter(filter);
  const ids = eligible.filter((option) => clean(option?.id) === source);
  const names = eligible.filter((option) => normalizeImportText(option?.name) === normalizeImportText(source));
  const matches = ids.length ? ids : names;
  if (matches.length === 1) return { id: clean(matches[0].id), label: clean(matches[0].name) || source, state: { ...fieldState(source), evidence: "confirmed" }, note: ids.length ? `${label} ID confirmed` : `${label} matched by name` };
  if (matches.length > 1) return { id: "", state: { ...fieldState(source), evidence: "failed" }, error: `${label} “${source}” matches more than one record` };
  return { id: "", state: { ...fieldState(source), evidence: "failed" }, error: `${label} “${source}” was not found in the active catalog` };
}

function resolveMany(value, options, label) {
  const source = clean(value);
  const resolutions = source.split(/[;|\n]+/).map(clean).filter(Boolean).map((entry) => resolveOne(entry, options, label));
  return {
    ids: resolutions.map((entry) => entry.id).filter(Boolean),
    errors: resolutions.map((entry) => entry.error).filter(Boolean),
    notes: resolutions.map((entry) => entry.note).filter(Boolean),
    state: source ? { ...fieldState(source), evidence: resolutions.every((entry) => entry.id) ? "confirmed" : "failed" } : fieldState("")
  };
}

function mapRecord(source, mapping, importType, context, constants = {}) {
  const definition = getImportTypeDefinition(importType);
  const raw = Object.fromEntries(definition.fields.map((field) => [
    field,
    clean(mapping?.[field] ? source?.[mapping[field]] : constants?.[field])
  ]));
  const record = { ...raw };
  const fieldStates = Object.fromEntries(definition.fields.map((field) => [field, fieldState(raw[field])]));
  const errors = [];
  const warnings = [];
  MONEY_FIELDS.forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(raw, field)) return;
    const parsed = parseMoney(raw[field]);
    if (field === "ppp" && parsed.value !== null && parsed.value <= 0) {
      parsed.value = null;
      parsed.availability = "unknown";
      parsed.error = "must be greater than zero";
    }
    if (
      field === "qtyPerGuests"
      && parsed.value !== null
      && (!Number.isSafeInteger(parsed.value) || parsed.value < 1 || parsed.value > 100_000)
    ) {
      parsed.value = null;
      parsed.availability = "unknown";
      parsed.error = "must be a whole number from 1 to 100000";
    }
    record[field] = parsed.value;
    fieldStates[field] = fieldState(raw[field], parsed);
    if (parsed.error) errors.push(`${field} ${parsed.error}`);
  });
  if (importType === "customers") record.email = clean(record.email).toLowerCase();
  if (Object.prototype.hasOwnProperty.call(raw, "active")) {
    const parsed = parseBoolean(raw.active);
    record.active = parsed.value;
    fieldStates.active = fieldState(raw.active, parsed);
    if (parsed.origin === "defaulted") warnings.push("Active defaulted to yes");
    if (parsed.error) errors.push(`active ${parsed.error}`);
  }
  if (importType === "addons" || importType === "menuItems") {
    const field = importType === "addons" ? "type" : "pricingType";
    const parsed = parsePricing(raw[field], importType === "addons" ? "per_event" : "per_item");
    record[field] = parsed.value;
    record.pricingType = parsed.value;
    record.type = parsed.value;
    fieldStates[field] = fieldState(raw[field], parsed);
    if (parsed.origin === "defaulted") warnings.push(`Pricing basis defaulted to ${parsed.value.replace("_", " ")}`);
    if (parsed.error) errors.push(`${field} ${parsed.error}`);
  }
  if (["menuCategories", "menuItems"].includes(importType)) {
    const resolved = resolveOne(raw.eventType, candidates(context, "eventTypes"), "Event type");
    record.eventTypeId = resolved.id;
    record.eventTypeName = resolved.label || raw.eventType;
    fieldStates.eventType = resolved.state;
    if (resolved.error) errors.push(resolved.error);
    if (resolved.note) warnings.push(resolved.note);
  }
  if (importType === "menuItems") {
    const resolved = resolveOne(raw.category, candidates(context, "categories"), "Menu section", (option) => !record.eventTypeId || !option?.eventTypeId || clean(option.eventTypeId) === record.eventTypeId);
    record.categoryId = resolved.id;
    record.categoryName = resolved.label || raw.category;
    fieldStates.category = resolved.state;
    if (resolved.error) errors.push(resolved.error);
    if (resolved.note) warnings.push(resolved.note);
  }
  if (importType === "packages") {
    [["includedMenuItems", "includedMenuItemIds", "menuItems", "Menu item"], ["includedAddons", "includedAddonIds", "addons", "Add-on"], ["includedRentals", "includedRentalIds", "rentals", "Rental"]].forEach(([sourceField, targetField, key, label]) => {
      const resolved = resolveMany(raw[sourceField], candidates(context, key), label);
      record[targetField] = resolved.ids;
      fieldStates[sourceField] = resolved.state;
      errors.push(...resolved.errors);
      if (resolved.ids.length > 100) errors.push(`${label} relationships are limited to 100 per package`);
      if (new Set(resolved.ids).size !== resolved.ids.length) errors.push(`${label} relationships contain a duplicate`);
      warnings.push(...resolved.notes);
    });
  }
  return { record, fieldStates, errors, warnings };
}

function requiredLabel(field) {
  return ({ eventTypeId: "event type", categoryId: "menu section", ppp: "price per person" })[field] || field.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

export function buildImportPreview({ rows = [], mapping = {}, constants = {}, importType = "customers", catalogContext = {} } = {}) {
  const definition = getImportTypeDefinition(importType);
  const identities = new Map();
  return rows.map((row) => {
    const mapped = mapRecord(row.values || {}, mapping, importType, catalogContext, constants);
    const errors = [...mapped.errors];
    const warnings = [...mapped.warnings];
    (definition.required || []).forEach((field) => {
      const value = mapped.record[field];
      if ((value === null || value === undefined || clean(value) === "") && !errors.some((message) => normalizeImportText(message).startsWith(requiredLabel(field)))) errors.push(`${requiredLabel(field)} is required`);
    });
    if (definition.requiredAny && !definition.requiredAny.some((field) => clean(mapped.record[field]))) errors.push(`Provide ${definition.requiredAny.join(" or ")}`);
    if (mapped.record.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mapped.record.email)) errors.push("email is invalid");
    const identity = importType === "customers" ? (mapped.record.email ? `email:${mapped.record.email}` : `name:${normalizeImportText(mapped.record.name)}`) : `name:${normalizeImportText(mapped.record.name)}`;
    if (identity !== "name:" && identities.has(identity)) {
      const message = `Duplicate of source row ${identities.get(identity)}`;
      if (importType === "customers") warnings.push(`${message}; server preflight will decide.`);
      else errors.push(message);
    }
    else if (identity !== "name:") identities.set(identity, row.rowNumber);
    if (importType !== "customers" && clean(mapped.record.name)) {
      const candidateKey = ({
        packages: "packages",
        addons: "addons",
        rentals: "rentals",
        eventTypes: "eventTypes",
        menuCategories: "categories",
        menuItems: "menuItems"
      })[importType];
      const existing = candidates(catalogContext, candidateKey).filter((candidate) => (
        normalizeImportText(candidate?.name) === normalizeImportText(mapped.record.name)
        && (importType !== "menuItems" || !mapped.record.categoryId || !candidate?.categoryId || clean(candidate.categoryId) === mapped.record.categoryId)
      ));
      if (existing.length) errors.push(`${getImportTypeDefinition(importType).label.replace(/s$/, "")} already exists in the active catalog`);
    }
    return { rowNumber: row.rowNumber, sourceLocator: row.sourceLocator || null, record: mapped.record, fieldStates: mapped.fieldStates, errors: [...new Set(errors)], warnings: [...new Set(warnings)], ready: errors.length === 0 };
  });
}
