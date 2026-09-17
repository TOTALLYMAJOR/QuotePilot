export const INVENTORY_CAPTURE_DRAFT_VERSION = "inventory-capture-draft-v1";
export const INVENTORY_CAPTURE_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const DATABASE_NAME = "quotepilot-inventory-capture-v1";
const STORE_NAME = "drafts";
const DATABASE_VERSION = 1;
const IDENTIFIER = /^[^\s/?#\\\u0000]{1,180}$/u;
const QUANTITY = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/u;

function draftError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function exactIdentifier(value, label) {
  if (typeof value !== "string" || value !== value.trim() || !IDENTIFIER.test(value)
    || [".", "..", "__proto__", "prototype", "constructor"].includes(value.toLowerCase())) {
    throw draftError("invalid-argument", `${label} must be an exact opaque identifier.`);
  }
  return value;
}

function exactText(value, label, maximum, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || value !== value.trim() || value.length > maximum
    || /[\u0000-\u001f\u007f<>]/u.test(value) || (!allowEmpty && !value)) {
    throw draftError("invalid-argument", `${label} must be bounded safe text.`);
  }
  return value;
}

function exactNow(value) {
  const result = value === undefined ? Date.now() : Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw draftError("invalid-argument", "Draft time is invalid.");
  return result;
}

function exactIso(value, label) {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw draftError("invalid-argument", `${label} must be an exact ISO timestamp.`);
  }
  return value;
}

function exactRevision(value, label, { allowZero = false } = {}) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > 1_000_000_000) {
    throw draftError("invalid-argument", `${label} must be a bounded stock revision.`);
  }
  return value;
}

function normalizeScope(input) {
  const organizationId = exactIdentifier(input?.organizationId, "organizationId");
  const userId = exactIdentifier(input?.userId, "userId");
  const locationId = exactIdentifier(input?.locationId, "locationId");
  return {
    organizationId,
    userId,
    locationId,
    scopeKey: `${organizationId}\u0000${userId}\u0000${locationId}`
  };
}

function normalizeLine(value, index) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw draftError("invalid-argument", `Capture line ${index + 1} is invalid.`);
  }
  const countedQuantity = String(value.countedQuantity ?? "").trim();
  if (!QUANTITY.test(countedQuantity)) {
    throw draftError("invalid-argument", `Capture line ${index + 1} count must be a nonnegative canonical quantity.`);
  }
  const state = ["draft", "submitted", "conflict", "error"].includes(value.state) ? value.state : "draft";
  const line = {
    lineId: exactIdentifier(value.lineId, `Capture line ${index + 1} identity`),
    ingredientId: exactIdentifier(value.ingredientId, `Capture line ${index + 1} ingredient`),
    ingredientName: exactText(value.ingredientName, `Capture line ${index + 1} ingredient name`, 100),
    baseUnitId: exactIdentifier(value.baseUnitId, `Capture line ${index + 1} unit`),
    countedQuantity,
    note: exactText(String(value.note ?? ""), `Capture line ${index + 1} note`, 240, { allowEmpty: true }),
    occurredAtISO: exactIso(value.occurredAtISO, `Capture line ${index + 1} occurrence time`),
    expectedStockRevision: exactRevision(value.expectedStockRevision, `Capture line ${index + 1} expected revision`),
    state,
    error: state === "conflict" || state === "error"
      ? exactText(String(value.error || "Review this retained line before retrying."), `Capture line ${index + 1} error`, 240)
      : "",
    receiptId: state === "submitted" ? exactText(String(value.receiptId || "Receipt recorded"), `Capture line ${index + 1} receipt`, 180) : "",
    stockRevision: state === "submitted"
      ? exactRevision(value.stockRevision, `Capture line ${index + 1} confirmed revision`)
      : null,
    currentStockRevision: state === "conflict"
      ? exactRevision(value.currentStockRevision, `Capture line ${index + 1} current revision`)
      : null
  };
  return Object.freeze(line);
}

function normalizeLines(lines) {
  if (!Array.isArray(lines) || lines.length > 200) throw draftError("invalid-argument", "Capture lines must be a bounded list.");
  const normalized = lines.map(normalizeLine);
  if (new Set(normalized.map((line) => line.lineId)).size !== normalized.length
    || new Set(normalized.map((line) => line.ingredientId)).size !== normalized.length) {
    throw draftError("invalid-argument", "Capture lines must have unique line and ingredient identities.");
  }
  return normalized;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || draftError("storage-unavailable", "Inventory capture storage failed."));
  });
}

export async function createNativeInventoryCaptureStore(indexedDBFactory = globalThis.indexedDB) {
  if (!indexedDBFactory?.open) throw draftError("storage-unavailable", "This browser cannot keep durable inventory capture drafts.");
  const request = indexedDBFactory.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(STORE_NAME)) {
      const store = database.createObjectStore(STORE_NAME, { keyPath: "key" });
      store.createIndex("scopeKey", "scopeKey", { unique: false });
      store.createIndex("expiresAtISO", "expiresAtISO", { unique: false });
    }
  };
  const database = await requestResult(request);
  const transact = (mode, operation) => new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    let result;
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error || draftError("storage-unavailable", "Inventory capture storage failed."));
    transaction.onabort = () => reject(transaction.error || draftError("storage-unavailable", "Inventory capture storage was interrupted."));
    operation(store, (value) => { result = value; });
  });
  return {
    get(key) {
      return transact("readonly", (store, done) => {
        const get = store.get(key);
        get.onsuccess = () => done(get.result || null);
      });
    },
    put(value) {
      return transact("readwrite", (store, done) => {
        store.put(clone(value));
        done(value);
      });
    },
    delete(key) {
      return transact("readwrite", (store) => store.delete(key));
    },
    list() {
      return transact("readonly", (store, done) => {
        const get = store.getAll();
        get.onsuccess = () => done(get.result || []);
      });
    },
    close() { database.close(); }
  };
}

let defaultStorePromise = null;

async function resolveStore(options) {
  if (options?.store) return options.store;
  if (options?.indexedDB) return createNativeInventoryCaptureStore(options.indexedDB);
  if (!defaultStorePromise) {
    defaultStorePromise = createNativeInventoryCaptureStore().catch((error) => {
      defaultStorePromise = null;
      throw error;
    });
  }
  return defaultStorePromise;
}

function recordKey(scope, draftId) {
  return `${scope.scopeKey}\u0000${exactIdentifier(draftId, "draftId")}`;
}

async function exactDraft(input, options) {
  const scope = normalizeScope(input);
  const store = await resolveStore(options);
  const key = recordKey(scope, input.draftId);
  const draft = await store.get(key);
  if (!draft || draft.scopeKey !== scope.scopeKey) throw draftError("not-found", "The exact inventory capture draft is unavailable.");
  return { scope, store, key, draft };
}

export async function createInventoryCaptureDraft(input = {}, options = {}) {
  const scope = normalizeScope(input);
  const store = await resolveStore(options);
  const draftId = exactIdentifier(input.draftId, "draftId");
  const key = recordKey(scope, draftId);
  if (await store.get(key)) throw draftError("already-exists", "This exact inventory capture draft already exists.");
  const timestamp = exactNow(input.now);
  const record = {
    schemaVersion: 1,
    kind: INVENTORY_CAPTURE_DRAFT_VERSION,
    key,
    ...scope,
    draftId,
    status: "draft",
    createdAtISO: new Date(timestamp).toISOString(),
    updatedAtISO: new Date(timestamp).toISOString(),
    expiresAtISO: new Date(timestamp + INVENTORY_CAPTURE_DRAFT_TTL_MS).toISOString(),
    lines: normalizeLines(input.lines || [])
  };
  await store.put(record);
  return Object.freeze(clone(record));
}

export async function updateInventoryCaptureDraft(input = {}, options = {}) {
  const { store, draft } = await exactDraft(input, options);
  const timestamp = exactNow(input.now);
  if (timestamp >= Date.parse(draft.expiresAtISO)) {
    await store.delete(draft.key);
    throw draftError("expired", "This inventory capture draft expired after seven days.");
  }
  const lines = normalizeLines(input.lines);
  const record = {
    ...draft,
    status: lines.length && lines.every((line) => line.state === "submitted") ? "submitted" : "draft",
    updatedAtISO: new Date(timestamp).toISOString(),
    lines
  };
  await store.put(record);
  return Object.freeze(clone(record));
}

export async function listInventoryCaptureDrafts(input = {}, options = {}) {
  const scope = normalizeScope(input);
  const store = await resolveStore(options);
  const timestamp = exactNow(input.now);
  const records = await store.list();
  const visible = [];
  for (const record of records) {
    if (record?.kind !== INVENTORY_CAPTURE_DRAFT_VERSION) continue;
    if (timestamp >= Date.parse(record.expiresAtISO)) {
      await store.delete(record.key);
      continue;
    }
    if (record.scopeKey === scope.scopeKey) visible.push(record);
  }
  visible.sort((left, right) => right.updatedAtISO.localeCompare(left.updatedAtISO));
  return Object.freeze(clone(visible));
}

export async function discardInventoryCaptureDraft(input = {}, options = {}) {
  const { store, key } = await exactDraft(input, options);
  await store.delete(key);
  return true;
}

export async function submitInventoryCaptureDraft(input = {}, options = {}) {
  if (input.online !== true) throw draftError("offline", "This draft is saved on this device. Reconnect before submitting stock counts.");
  if (typeof input.submitLine !== "function") throw draftError("invalid-argument", "A stock-count submission adapter is required.");
  const { store, draft } = await exactDraft(input, options);
  const timestamp = exactNow(input.now);
  if (timestamp >= Date.parse(draft.expiresAtISO)) {
    await store.delete(draft.key);
    throw draftError("expired", "This inventory capture draft expired after seven days.");
  }
  const revisions = input.currentStockRevisions && typeof input.currentStockRevisions === "object"
    ? input.currentStockRevisions : {};
  const lines = [];
  for (const line of normalizeLines(draft.lines)) {
    if (line.state === "submitted") {
      lines.push(line);
      continue;
    }
    const currentRevision = revisions[line.ingredientId];
    if (!Number.isSafeInteger(currentRevision) || currentRevision !== line.expectedStockRevision) {
      lines.push(normalizeLine({
        ...line,
        state: "conflict",
        error: "Stock changed after this shelf count was captured. Review and rebase this line.",
        currentStockRevision: Number.isSafeInteger(currentRevision) && currentRevision > 0 ? currentRevision : line.expectedStockRevision
      }, lines.length));
      continue;
    }
    try {
      const result = await input.submitLine({
        kind: "record_stock_count",
        ingredientId: line.ingredientId,
        locationId: draft.locationId,
        countedQuantity: line.countedQuantity,
        baseUnitId: line.baseUnitId,
        occurredAtISO: line.occurredAtISO,
        note: line.note,
        expectedStockRevision: line.expectedStockRevision
      });
      lines.push(normalizeLine({
        ...line,
        state: "submitted",
        receiptId: String(result?.receipt?.receiptId || "Receipt recorded"),
        stockRevision: exactRevision(result?.confirmation?.stockRevision, "confirmed stock revision")
      }, lines.length));
    } catch (error) {
      lines.push(normalizeLine({
        ...line,
        state: "error",
        error: String(error?.message || "This line did not return an authoritative receipt.").slice(0, 240)
      }, lines.length));
    }
  }
  const allSubmitted = lines.length > 0 && lines.every((line) => line.state === "submitted");
  const record = {
    ...draft,
    status: allSubmitted ? "submitted" : "partial",
    updatedAtISO: new Date(timestamp).toISOString(),
    lines
  };
  await store.put(record);
  return Object.freeze(clone(record));
}
