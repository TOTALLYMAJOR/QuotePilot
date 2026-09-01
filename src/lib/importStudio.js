const IMPORT_TYPE_DEFINITIONS = {
  customers: {
    label: "Customers",
    collection: "customers",
    fields: ["name", "email", "phone", "company", "notes"],
    requiredAny: ["name", "email"]
  },
  packages: {
    label: "Packages",
    collection: "catalogPackages",
    fields: ["name", "ppp", "costPpp", "description", "active"],
    required: ["name"]
  },
  addons: {
    label: "Add-ons",
    collection: "catalogAddons",
    fields: ["name", "type", "price", "cost", "description", "active"],
    required: ["name"]
  },
  rentals: {
    label: "Rentals",
    collection: "catalogRentals",
    fields: ["name", "price", "cost", "qtyPerGuests", "description", "active"],
    required: ["name"]
  },
  menuItems: {
    label: "Menu items",
    collection: "menuItems",
    fields: ["name", "eventTypeId", "categoryId", "price", "cost", "pricingType", "active"],
    required: ["name", "eventTypeId", "categoryId"]
  }
};

const FIELD_ALIASES = {
  name: ["name", "customer", "customer name", "client", "client name", "item", "item name", "package", "package name"],
  email: ["email", "email address", "customer email", "client email"],
  phone: ["phone", "phone number", "mobile", "cell"],
  company: ["company", "organization", "business", "client organization"],
  notes: ["notes", "note", "comments"],
  ppp: ["ppp", "price per person", "per person", "cost pp", "rate per person"],
  price: ["price", "rate", "amount", "cost"],
  costPpp: ["cost per person", "food cost per person", "cost ppp", "costppp"],
  cost: ["cost", "unit cost", "item cost", "food cost"],
  type: ["type", "pricing type", "rate type"],
  pricingType: ["pricing type", "price type", "type", "billing type"],
  qtyPerGuests: ["qty per guests", "quantity per guests", "guests per unit", "guest ratio"],
  description: ["description", "details", "summary"],
  active: ["active", "enabled", "available", "status"],
  eventTypeId: ["event type", "event type id", "event", "event id"],
  categoryId: ["category", "category id", "menu category", "menu category id"]
};

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizeHeader(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function parseBoolean(value, fallback = true) {
  const normalized = cleanText(value).toLowerCase();
  if (!normalized) return fallback;
  if (["true", "yes", "y", "1", "active", "enabled", "available"].includes(normalized)) return true;
  if (["false", "no", "n", "0", "inactive", "disabled", "unavailable"].includes(normalized)) return false;
  return fallback;
}

function parseMoney(value) {
  const normalized = cleanText(value).replace(/[$,]/g, "");
  if (!normalized) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : null;
}

function normalizePricingType(value, fallback = "per_event") {
  const normalized = normalizeHeader(value);
  if (["per person", "per_person", "person", "pp", "ppp"].includes(normalized)) return "per_person";
  if (["per item", "per_item", "item", "unit", "each"].includes(normalized)) return "per_item";
  if (["per event", "per_event", "event", "flat", "flat fee"].includes(normalized)) return "per_event";
  return fallback;
}

export const IMPORT_TYPES = Object.entries(IMPORT_TYPE_DEFINITIONS).map(([id, definition]) => ({
  id,
  label: definition.label
}));

export function getImportTypeDefinition(importType = "") {
  return IMPORT_TYPE_DEFINITIONS[importType] || IMPORT_TYPE_DEFINITIONS.customers;
}

export function parseCsvText(input = "") {
  const text = String(input || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
      continue;
    }
    if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => cleanText(value))) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += character;
  }

  row.push(cell);
  if (row.some((value) => cleanText(value))) rows.push(row);
  if (!rows.length) return { headers: [], rows: [] };

  const headers = rows[0].map((value, index) => cleanText(value) || `Column ${index + 1}`);
  return {
    headers,
    rows: rows.slice(1).map((values, rowIndex) => ({
      rowNumber: rowIndex + 2,
      values: headers.reduce((record, header, columnIndex) => {
        record[header] = cleanText(values[columnIndex]);
        return record;
      }, {})
    }))
  };
}

export function suggestFieldMapping(headers = [], importType = "customers") {
  const definition = getImportTypeDefinition(importType);
  const normalizedHeaders = headers.map((header) => ({ header, normalized: normalizeHeader(header) }));
  return definition.fields.reduce((mapping, field) => {
    const aliases = FIELD_ALIASES[field] || [normalizeHeader(field)];
    const exact = normalizedHeaders.find((entry) => aliases.includes(entry.normalized));
    const partial = normalizedHeaders.find((entry) => aliases.some((alias) => entry.normalized.includes(alias)));
    mapping[field] = exact?.header || partial?.header || "";
    return mapping;
  }, {});
}

export function detectImportType(headers = []) {
  const normalized = headers.map(normalizeHeader);
  const scores = Object.keys(IMPORT_TYPE_DEFINITIONS).map((importType) => {
    const mapping = suggestFieldMapping(headers, importType);
    const matched = Object.values(mapping).filter(Boolean).length;
    let score = matched;
    if (importType === "customers" && normalized.some((header) => header.includes("email") || header.includes("phone"))) score += 2;
    if (importType === "menuItems" && normalized.some((header) => header.includes("category") || header.includes("event type"))) score += 3;
    if (importType === "packages" && normalized.some((header) => header === "ppp" || header.includes("per person"))) score += 3;
    return { importType, score };
  });
  scores.sort((left, right) => right.score - left.score);
  return scores[0]?.score > 0 ? scores[0].importType : "customers";
}

function mapRecord(source = {}, mapping = {}, importType = "customers") {
  const read = (field) => cleanText(source[mapping[field]]);
  if (importType === "customers") {
    return {
      name: read("name"),
      email: read("email").toLowerCase(),
      phone: read("phone"),
      company: read("company"),
      notes: read("notes")
    };
  }
  if (importType === "packages") {
    return {
      name: read("name"),
      ppp: parseMoney(read("ppp")),
      costPpp: parseMoney(read("costPpp")),
      description: read("description"),
      active: parseBoolean(read("active"), true)
    };
  }
  if (importType === "addons") {
    return {
      name: read("name"),
      type: normalizePricingType(read("type")),
      price: parseMoney(read("price")),
      cost: parseMoney(read("cost")),
      description: read("description"),
      active: parseBoolean(read("active"), true)
    };
  }
  if (importType === "rentals") {
    return {
      name: read("name"),
      price: parseMoney(read("price")),
      cost: parseMoney(read("cost")),
      qtyPerGuests: parseMoney(read("qtyPerGuests")),
      description: read("description"),
      active: parseBoolean(read("active"), true)
    };
  }
  return {
    name: read("name"),
    eventTypeId: read("eventTypeId"),
    categoryId: read("categoryId"),
    price: parseMoney(read("price")),
    cost: parseMoney(read("cost")),
    pricingType: normalizePricingType(read("pricingType"), "per_item"),
    type: normalizePricingType(read("pricingType"), "per_item"),
    active: parseBoolean(read("active"), true)
  };
}

export function buildImportPreview({ rows = [], mapping = {}, importType = "customers" } = {}) {
  const definition = getImportTypeDefinition(importType);
  return rows.map((row) => {
    const record = mapRecord(row.values, mapping, importType);
    const errors = [];
    (definition.required || []).forEach((field) => {
      if (!cleanText(record[field])) errors.push(`${field} is required`);
    });
    if (definition.requiredAny && !definition.requiredAny.some((field) => cleanText(record[field]))) {
      errors.push(`Provide ${definition.requiredAny.join(" or ")}`);
    }
    ["price", "ppp", "cost", "costPpp", "qtyPerGuests"].forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(record, field) && record[field] === null) {
        errors.push(`${field} must be a positive number`);
      }
    });
    if (record.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email)) {
      errors.push("email is invalid");
    }
    return {
      rowNumber: row.rowNumber,
      record,
      errors,
      ready: errors.length === 0
    };
  });
}
