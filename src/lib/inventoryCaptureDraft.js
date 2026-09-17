export const INVENTORY_CAPTURE_DRAFT_VERSION = "inventory-capture-draft-v1";
export const INVENTORY_CAPTURE_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const DATABASE_NAME = "quotepilot-inventory-capture-v1";
const STORE_NAME = "drafts";
const DATABASE_VERSION = 1;
const IDENTIFIER = /^[^\s/?#\\\u0000]{1,180}$/u;
const QUANTITY = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/u;
const REQUEST_ID = /^inventory_request_[a-f0-9]{32}$/u;
const MAX_MUTATION_RETRIES = 8;

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

function exactRequestId(value) {
  if (typeof value !== "string" || !REQUEST_ID.test(value)) {
    throw draftError("invalid-argument", "Capture line requestId must be an exact inventory request identifier.");
  }
  return value;
}

function retainedErrorMessage(error) {
  const message = String(error?.message || "This line did not return an authoritative receipt.")
    .replace(/[\u0000-\u001f\u007f<>]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 240);
  return message || "This line did not return an authoritative receipt.";
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
  const state = ["draft", "submitted", "conflict", "uncertain", "error"].includes(value.state) ? value.state : "draft";
  const requestId = exactRequestId(value.requestId);
  const command = value.command;
  if (!command || typeof command !== "object" || Array.isArray(command)) {
    throw draftError("invalid-argument", `Capture line ${index + 1} command is invalid.`);
  }
  const line = {
    lineId: exactIdentifier(value.lineId, `Capture line ${index + 1} identity`),
    ingredientId: exactIdentifier(value.ingredientId, `Capture line ${index + 1} ingredient`),
    ingredientName: exactText(value.ingredientName, `Capture line ${index + 1} ingredient name`, 100),
    baseUnitId: exactIdentifier(value.baseUnitId, `Capture line ${index + 1} unit`),
    countedQuantity,
    note: exactText(String(value.note ?? ""), `Capture line ${index + 1} note`, 240, { allowEmpty: true }),
    occurredAtISO: exactIso(value.occurredAtISO, `Capture line ${index + 1} occurrence time`),
    expectedStockRevision: exactRevision(value.expectedStockRevision, `Capture line ${index + 1} expected revision`),
    requestId,
    command: null,
    state,
    error: ["conflict", "uncertain", "error"].includes(state)
      ? exactText(String(value.error || "Review this retained line before retrying."), `Capture line ${index + 1} error`, 240)
      : "",
    receiptId: state === "submitted" ? exactText(String(value.receiptId || "Receipt recorded"), `Capture line ${index + 1} receipt`, 180) : "",
    stockRevision: state === "submitted"
      ? exactRevision(value.stockRevision, `Capture line ${index + 1} confirmed revision`)
      : null,
    currentStockRevision: state === "conflict"
      ? exactRevision(value.currentStockRevision, `Capture line ${index + 1} current revision`)
      : null,
    definitive: state === "error" ? value.definitive === true : false,
    inFlight: state === "uncertain" ? value.inFlight === true : false,
    attemptedAtISO: state === "uncertain" && value.attemptedAtISO
      ? exactIso(value.attemptedAtISO, `Capture line ${index + 1} attempt time`)
      : ""
  };
  const normalizedCommand = {
    kind: "record_stock_count",
    ingredientId: exactIdentifier(command.ingredientId, `Capture line ${index + 1} command ingredient`),
    locationId: exactIdentifier(command.locationId, `Capture line ${index + 1} command location`),
    countedQuantity: String(command.countedQuantity ?? "").trim(),
    baseUnitId: exactIdentifier(command.baseUnitId, `Capture line ${index + 1} command unit`),
    occurredAtISO: exactIso(command.occurredAtISO, `Capture line ${index + 1} command occurrence time`),
    note: exactText(String(command.note ?? ""), `Capture line ${index + 1} command note`, 240, { allowEmpty: true }),
    expectedStockRevision: exactRevision(command.expectedStockRevision, `Capture line ${index + 1} command expected revision`)
  };
  if (command.kind !== "record_stock_count" || !QUANTITY.test(normalizedCommand.countedQuantity)
    || normalizedCommand.ingredientId !== line.ingredientId || normalizedCommand.baseUnitId !== line.baseUnitId
    || normalizedCommand.countedQuantity !== line.countedQuantity || normalizedCommand.occurredAtISO !== line.occurredAtISO
    || normalizedCommand.note !== line.note || normalizedCommand.expectedStockRevision !== line.expectedStockRevision) {
    throw draftError("invalid-argument", `Capture line ${index + 1} command identity differs from its saved count.`);
  }
  line.command = Object.freeze(normalizedCommand);
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

function scopedLines(lines, scope) {
  const normalized = normalizeLines(lines);
  if (normalized.some((line) => line.command.locationId !== scope.locationId)) {
    throw draftError("invalid-argument", "Capture line command location differs from the exact draft scope.");
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
    let operationError = null;
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(operationError || transaction.error || draftError("storage-unavailable", "Inventory capture storage failed."));
    transaction.onabort = () => reject(operationError || transaction.error || draftError("storage-unavailable", "Inventory capture storage was interrupted."));
    operation(store, (value) => { result = value; }, (error) => {
      operationError = error;
      transaction.abort();
    });
  });
  return {
    get(key) {
      return transact("readonly", (store, done) => {
        const get = store.get(key);
        get.onsuccess = () => done(get.result || null);
      });
    },
    create(value) {
      return transact("readwrite", (store, done, fail) => {
        const add = store.add(clone(value));
        add.onsuccess = () => done(value);
        add.onerror = (event) => {
          event.preventDefault();
          event.stopPropagation();
          fail(draftError("already-exists", "This exact inventory capture draft already exists."));
        };
      });
    },
    compareAndSwap(key, expectedRevision, nextValue) {
      return transact("readwrite", (store, done, fail) => {
        const get = store.get(key);
        get.onsuccess = () => {
          const current = get.result || null;
          if (!current) {
            fail(draftError("not-found", "The exact inventory capture draft is unavailable."));
            return;
          }
          if (current.draftRevision !== expectedRevision) {
            fail(draftError("conflict", "The device draft changed in another browser context."));
            return;
          }
          const request = nextValue === null ? store.delete(key) : store.put(clone(nextValue));
          request.onsuccess = () => done(nextValue);
        };
      });
    },
    list(scopeKey = "") {
      return transact("readonly", (store, done) => {
        const get = scopeKey ? store.index("scopeKey").getAll(scopeKey) : store.getAll();
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

function draftStatus(lines) {
  if (lines.length && lines.every((line) => line.state === "submitted")) return "submitted";
  if (lines.some((line) => ["submitted", "conflict", "uncertain", "error"].includes(line.state))) return "partial";
  return "draft";
}

function nextRecord(draft, lines, timestamp) {
  const normalized = normalizeLines(lines);
  return {
    ...draft,
    draftRevision: exactRevision(draft.draftRevision, "draft revision") + 1,
    status: draftStatus(normalized),
    updatedAtISO: new Date(timestamp).toISOString(),
    lines: normalized
  };
}

async function mutateDraft(input, options, reducer, { strictRevision = false } = {}) {
  const scope = normalizeScope(input);
  const store = await resolveStore(options);
  const key = recordKey(scope, input.draftId);
  const timestamp = exactNow(input.now);
  for (let attempt = 0; attempt < MAX_MUTATION_RETRIES; attempt += 1) {
    const current = await store.get(key);
    if (!current || current.scopeKey !== scope.scopeKey) throw draftError("not-found", "The exact inventory capture draft is unavailable.");
    if (timestamp >= Date.parse(current.expiresAtISO)) {
      try { await store.compareAndSwap(key, current.draftRevision, null); } catch { /* another context already advanced it */ }
      throw draftError("expired", "This inventory capture draft expired after seven days.");
    }
    if (strictRevision && input.expectedDraftRevision !== current.draftRevision) {
      throw draftError("conflict", "The device draft changed in another browser context. Reload it before continuing.");
    }
    const next = reducer(Object.freeze(clone(current)), timestamp);
    try {
      await store.compareAndSwap(key, current.draftRevision, next);
      return next === null ? null : Object.freeze(clone(next));
    } catch (error) {
      if (error?.code !== "conflict" || strictRevision || attempt === MAX_MUTATION_RETRIES - 1) throw error;
    }
  }
  throw draftError("conflict", "The device draft kept changing. Reload it before continuing.");
}

export async function createInventoryCaptureDraft(input = {}, options = {}) {
  const scope = normalizeScope(input);
  const store = await resolveStore(options);
  const draftId = exactIdentifier(input.draftId, "draftId");
  const key = recordKey(scope, draftId);
  const timestamp = exactNow(input.now);
  const record = {
    schemaVersion: 1,
    kind: INVENTORY_CAPTURE_DRAFT_VERSION,
    key,
    ...scope,
    draftId,
    draftRevision: 1,
    status: "draft",
    createdAtISO: new Date(timestamp).toISOString(),
    updatedAtISO: new Date(timestamp).toISOString(),
    expiresAtISO: new Date(timestamp + INVENTORY_CAPTURE_DRAFT_TTL_MS).toISOString(),
    lines: scopedLines(input.lines || [], scope)
  };
  try {
    await store.create(record);
  } catch (error) {
    if (error?.name === "ConstraintError" || error?.code === "already-exists") {
      throw draftError("already-exists", "This exact inventory capture draft already exists.");
    }
    throw error;
  }
  return Object.freeze(clone(record));
}

export async function updateInventoryCaptureDraft(input = {}, options = {}) {
  const scope = normalizeScope(input);
  const incoming = scopedLines(input.line ? [input.line] : input.lines, scope);
  return mutateDraft(input, options, (draft, timestamp) => {
    const replacements = new Map(incoming.map((line) => [line.ingredientId, line]));
    const lines = draft.lines.map((line) => replacements.get(line.ingredientId) || line);
    const existing = new Set(draft.lines.map((line) => line.ingredientId));
    incoming.forEach((line) => { if (!existing.has(line.ingredientId)) lines.push(line); });
    return nextRecord(draft, lines, timestamp);
  });
}

export async function listInventoryCaptureDrafts(input = {}, options = {}) {
  const scope = normalizeScope(input);
  const store = await resolveStore(options);
  const timestamp = exactNow(input.now);
  const records = await store.list(scope.scopeKey);
  const visible = [];
  for (const record of records) {
    if (record?.kind !== INVENTORY_CAPTURE_DRAFT_VERSION) continue;
    if (timestamp >= Date.parse(record.expiresAtISO)) {
      try { await store.compareAndSwap(record.key, record.draftRevision, null); } catch { /* keep a concurrently updated draft */ }
      continue;
    }
    if (record.scopeKey === scope.scopeKey) visible.push(record);
  }
  visible.sort((left, right) => right.updatedAtISO.localeCompare(left.updatedAtISO));
  return Object.freeze(clone(visible));
}

export async function discardInventoryCaptureDraft(input = {}, options = {}) {
  await mutateDraft(input, options, () => null, { strictRevision: true });
  return true;
}

function currentEvidence(input, locationId) {
  if (!Array.isArray(input.currentInventory) || input.currentInventory.length > 200) {
    throw draftError("invalid-argument", "Current inventory evidence must be a bounded exact-location list.");
  }
  const evidence = new Map();
  input.currentInventory.forEach((entry, index) => {
    const ingredientId = exactIdentifier(entry?.ingredientId, `Current inventory row ${index + 1} ingredient`);
    const normalized = {
      ingredientId,
      locationId: exactIdentifier(entry.locationId, `Current inventory row ${index + 1} location`),
      baseUnitId: exactIdentifier(entry.baseUnitId, `Current inventory row ${index + 1} unit`),
      stockRevision: exactRevision(entry.stockRevision, `Current inventory row ${index + 1} stock revision`)
    };
    if (normalized.locationId !== locationId) return;
    if (evidence.has(ingredientId)) throw draftError("invalid-argument", "Current inventory evidence contains a duplicate ingredient at this location.");
    evidence.set(ingredientId, normalized);
  });
  return evidence;
}

async function persistLine(input, options, lineId, transform) {
  return mutateDraft(input, options, (draft, timestamp) => {
    let found = false;
    const lines = draft.lines.map((line) => {
      if (line.lineId !== lineId) return line;
      found = true;
      return normalizeLine(transform(line, draft), 0);
    });
    if (!found) throw draftError("conflict", "The capture line changed in another browser context.");
    return nextRecord(draft, lines, timestamp);
  });
}

export async function submitInventoryCaptureDraft(input = {}, options = {}) {
  if (input.online !== true) throw draftError("offline", "This draft is saved on this device. Reconnect before submitting stock counts.");
  if (typeof input.submitLine !== "function") throw draftError("invalid-argument", "A stock-count submission adapter is required.");
  const { draft } = await exactDraft(input, options);
  const evidence = currentEvidence(input, draft.locationId);
  const lineIds = Array.isArray(input.lineIds) ? input.lineIds.map((value) => exactIdentifier(value, "capture lineId")) : draft.lines.map((line) => line.lineId);
  for (const lineId of lineIds) {
    let action = "";
    let claimedLine = null;
    await persistLine(input, options, lineId, (line) => {
      if (line.state === "submitted" || line.state === "conflict" || (line.state === "error" && line.definitive)) return line;
      if (line.state === "uncertain" && !input.reconcileUncertain) return line;
      const current = evidence.get(line.ingredientId);
      if (!current || current.locationId !== line.command.locationId || current.baseUnitId !== line.baseUnitId
        || line.command.locationId !== draft.locationId || line.command.baseUnitId !== line.baseUnitId
        || current.stockRevision !== line.expectedStockRevision) {
        return {
          ...line,
          state: "conflict",
          error: "Stock, location, or unit evidence changed after this shelf count was captured. Review and rebase this line.",
          currentStockRevision: current?.stockRevision || line.expectedStockRevision,
          definitive: false,
          inFlight: false,
          attemptedAtISO: ""
        };
      }
      action = line.state === "uncertain" ? "reconcile" : "submit";
      claimedLine = { ...line, state: "uncertain", error: "The exact stock-count outcome is not yet verified.", inFlight: true, attemptedAtISO: new Date(exactNow(input.now)).toISOString(), definitive: false };
      return claimedLine;
    });
    if (!action || !claimedLine) continue;
    try {
      const adapter = action === "reconcile" && typeof input.reconcileLine === "function" ? input.reconcileLine : input.submitLine;
      const result = await adapter({ requestId: claimedLine.requestId, command: claimedLine.command });
      await persistLine(input, options, lineId, (line) => line.requestId !== claimedLine.requestId || line.state === "submitted" ? line : ({
        ...line,
        state: "submitted",
        error: "",
        receiptId: String(result?.receipt?.receiptId || "Receipt recorded"),
        stockRevision: exactRevision(result?.confirmation?.stockRevision, "confirmed stock revision"),
        currentStockRevision: null,
        definitive: false,
        inFlight: false,
        attemptedAtISO: ""
      }));
    } catch (error) {
      const definitive = error?.inventoryDefinitive === true;
      await persistLine(input, options, lineId, (line) => line.requestId !== claimedLine.requestId || line.state === "submitted" ? line : ({
        ...line,
        state: definitive ? "error" : "uncertain",
        error: retainedErrorMessage(error),
        definitive,
        inFlight: false,
        attemptedAtISO: new Date(exactNow(input.now)).toISOString()
      }));
    }
  }
  const { draft: current } = await exactDraft(input, options);
  return Object.freeze(clone(current));
}
