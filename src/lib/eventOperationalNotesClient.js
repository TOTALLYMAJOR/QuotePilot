import { httpsCallable } from "firebase/functions";
import { cloudFunctions, firebaseReady } from "./firebase";

export const EVENT_OPERATIONAL_NOTES_CALLABLES = Object.freeze({
  read: "getEventOperationalNotesSnapshot",
  command: "applyEventOperationalNoteCommand"
});

export const EVENT_OPERATIONAL_NOTE_TYPES = Object.freeze(["kitchen", "venue", "service", "staffing"]);
export const EVENT_OPERATIONAL_NOTE_VISIBILITIES = Object.freeze(["internal", "beo_visible"]);

const COMMANDS = Object.freeze(["add", "correct", "review_for_revision"]);
const DEFINITIVE_CODES = new Set([
  "unauthenticated",
  "permission-denied",
  "invalid-argument",
  "failed-precondition",
  "not-found",
  "already-exists",
  "aborted",
  "resource-exhausted",
  "data-loss",
  "event-mutation-blocked"
]);
const attempts = new Map();
const activeRequests = new Map();
const ID = /^[^\s/?#\\\u0000-\u001f\u007f]{1,256}$/u;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{19,159}$/u;
const JOURNAL_ID = /^event_notes_[a-f0-9]{48}$/u;
const NOTE_ID = /^event_note_[a-f0-9]{32}$/u;
const RECEIPT_ID = /^event_notes_command_[a-f0-9]{48}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;

function failure(message, code = "invalid-server-response") {
  throw Object.assign(new Error(message), { code });
}

function exact(value, fields, message = "The operational-notes response shape could not be verified.") {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== fields.length
    || fields.some((field) => !Object.hasOwn(value, field))) {
    failure(message);
  }
}

function identifier(value) {
  return typeof value === "string" && ID.test(value) && value !== "." && value !== "..";
}

function integer(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function exactISO(value) {
  return typeof value === "string"
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function plainText(value, required = true) {
  return typeof value === "string"
    && value.length <= 800
    && (!required || value.trim().length > 0)
    && !/[\p{Cc}\p{Cf}]/u.test(value);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function scopeKey({ principalId = "", organizationId = "", quoteId = "" } = {}) {
  return JSON.stringify([principalId, organizationId, quoteId]);
}

function normalizedScope(input, includePrincipal = false) {
  if (!input || !identifier(input.organizationId) || !identifier(input.quoteId)
    || !identifier(input.sourceVersionId)
    || (includePrincipal && !identifier(input.principalId))) {
    failure("An exact workspace, event, and quote revision are required.", "invalid-argument");
  }
  return {
    organizationId: input.organizationId,
    quoteId: input.quoteId,
    sourceVersionId: input.sourceVersionId
  };
}

function ensureConnected() {
  if (!firebaseReady || !cloudFunctions) {
    failure("Event notes require a connected workspace.", "unavailable");
  }
}

function normalizeCode(error) {
  return String(error?.code || "unknown").replace(/^functions\//u, "");
}

export function isDefinitiveEventOperationalNotesError(error) {
  return error?.uncertain !== true && DEFINITIVE_CODES.has(normalizeCode(error));
}

function safeError(error) {
  if (error?.code === "invalid-server-response") return error;
  const code = normalizeCode(error);
  const message = {
    unauthenticated: "Sign in again to review event notes.",
    "permission-denied": "Your current role cannot review or change these event notes.",
    "invalid-argument": "Review the note type, visibility, text, and revision before submitting.",
    "failed-precondition": "These notes or their quote revision need review before this action.",
    "not-found": "This exact event note is no longer available.",
    "already-exists": "This request identity already belongs to another note change.",
    aborted: "The quote or notes changed. Refresh and review before continuing.",
    "resource-exhausted": "This event has reached its retained note or correction limit.",
    "data-loss": "The retained notes could not be verified. Do not rely on this read."
  }[code] || "The note result could not be confirmed. Check the original request before submitting another change.";
  return Object.assign(new Error(message), { code });
}

function normalizeReceipt(value) {
  exact(value, [
    "receiptId", "requestId", "command", "noteId", "priorJournalRevision",
    "resultJournalRevision", "priorNoteRevision", "resultNoteRevision", "recordedAtISO"
  ], "The operational-note receipt could not be verified.");
  if (!RECEIPT_ID.test(value.receiptId) || !REQUEST_ID.test(value.requestId)
    || !COMMANDS.includes(value.command)
    || (value.command === "review_for_revision" ? value.noteId !== "" : !NOTE_ID.test(value.noteId))
    || !integer(value.priorJournalRevision)
    || value.resultJournalRevision !== value.priorJournalRevision + 1
    || !(value.priorNoteRevision === null || integer(value.priorNoteRevision, 1, 1_000))
    || !(value.resultNoteRevision === null || integer(value.resultNoteRevision, 1, 1_000))
    || !exactISO(value.recordedAtISO)) {
    failure("The operational-note receipt could not be verified.");
  }
  if ((value.command === "add" && (value.priorNoteRevision !== null || value.resultNoteRevision !== 1))
    || (value.command === "correct" && value.resultNoteRevision !== value.priorNoteRevision + 1)
    || (value.command === "review_for_revision" && (value.priorNoteRevision !== null || value.resultNoteRevision !== null))) {
    failure("The operational-note receipt revisions are contradictory.");
  }
  return deepFreeze({ ...value });
}

function normalizeNote(value, snapshot) {
  exact(value, [
    "noteId", "type", "visibility", "text", "noteRevision", "createdAtISO",
    "updatedAtISO", "reviewState", "reviewedSourceVersionId", "reviewedNoteRevision",
    "reviewedAtISO"
  ], "An operational note could not be verified.");
  if (!NOTE_ID.test(value.noteId) || !EVENT_OPERATIONAL_NOTE_TYPES.includes(value.type)
    || !EVENT_OPERATIONAL_NOTE_VISIBILITIES.includes(value.visibility)
    || !plainText(value.text) || value.text !== value.text.trim()
    || !integer(value.noteRevision, 1, 1_000)
    || !exactISO(value.createdAtISO) || !exactISO(value.updatedAtISO)
    || value.createdAtISO > value.updatedAtISO || value.updatedAtISO > snapshot.updatedAtISO) {
    failure("An operational note could not be verified.");
  }
  if (value.reviewState === "pending") {
    if (value.reviewedSourceVersionId !== "" || value.reviewedNoteRevision !== null || value.reviewedAtISO !== "") {
      failure("A pending operational note contains contradictory review evidence.");
    }
  } else if (value.reviewState === "reviewed_for_revision") {
    if (value.reviewedSourceVersionId !== snapshot.sourceVersionId
      || value.reviewedNoteRevision !== value.noteRevision
      || !exactISO(value.reviewedAtISO)
      || value.reviewedAtISO < value.updatedAtISO
      || value.reviewedAtISO > snapshot.updatedAtISO) {
      failure("An operational note review does not match this quote revision.");
    }
  } else {
    failure("The operational-note review state is unsupported.");
  }
  return deepFreeze({ ...value });
}

function normalizeSnapshot(value, requested) {
  exact(value, [
    "organizationId", "quoteId", "sourceVersionId", "activeSourceVersionId", "schemaVersion", "notesPolicyVersion",
    "notesPolicyDigest", "journalId", "evidenceBoundary", "availability", "reasonCode",
    "journalRevision", "notes", "lastReceiptId", "updatedAtISO", "latestReceipt"
  ]);
  if (value.organizationId !== requested.organizationId || value.quoteId !== requested.quoteId
    || value.activeSourceVersionId !== requested.sourceVersionId || !identifier(value.sourceVersionId)
    || value.schemaVersion !== "event-operational-notes-v1"
    || value.notesPolicyVersion !== 1 || !DIGEST.test(value.notesPolicyDigest)
    || !JOURNAL_ID.test(value.journalId)
    || typeof value.evidenceBoundary !== "string" || !value.evidenceBoundary || value.evidenceBoundary.length > 2_000
    || !integer(value.journalRevision)
    || !Array.isArray(value.notes) || value.notes.length > 12) {
    failure("Operational notes belong to an unsupported event, quote revision, or policy.");
  }
  if (value.availability === "not_yet_available") {
    if (value.reasonCode !== "journal_empty" || value.sourceVersionId !== value.activeSourceVersionId
      || value.journalRevision !== 0 || value.notes.length
      || value.lastReceiptId !== "" || value.updatedAtISO !== "" || value.latestReceipt !== null) {
      failure("Absent operational notes contain contradictory recorded evidence.");
    }
    return deepFreeze({ ...value, notes: Object.freeze([]) });
  }
  const expectedReason = value.sourceVersionId === value.activeSourceVersionId ? "" : "source_revision_review_required";
  if (value.availability !== "available" || value.reasonCode !== expectedReason
    || value.journalRevision < 1 || value.notes.length < 1
    || !RECEIPT_ID.test(value.lastReceiptId) || !exactISO(value.updatedAtISO)) {
    failure("Recorded operational notes are incomplete or unsupported.");
  }
  const snapshot = { ...value, notes: [] };
  snapshot.notes = value.notes.map((note) => normalizeNote(note, snapshot));
  if (new Set(snapshot.notes.map((note) => note.noteId)).size !== snapshot.notes.length) {
    failure("Operational notes contain duplicate identities.");
  }
  snapshot.latestReceipt = normalizeReceipt(value.latestReceipt);
  const receipt = snapshot.latestReceipt;
  const note = receipt.noteId ? snapshot.notes.find((candidate) => candidate.noteId === receipt.noteId) : null;
  if ((receipt.command === "review_for_revision" ? receipt.noteId !== "" : !note)
    || receipt.receiptId !== snapshot.lastReceiptId
    || receipt.resultJournalRevision !== snapshot.journalRevision
    || receipt.recordedAtISO !== snapshot.updatedAtISO
    || (note && receipt.resultNoteRevision !== note.noteRevision)) {
    failure("The latest operational-note receipt does not establish this journal.");
  }
  return deepFreeze(snapshot);
}

function normalizeConsequences(value, snapshot) {
  if (!Array.isArray(value) || value.length > 1) {
    failure("Operational-note consequences exceed the supported bound.");
  }
  const consequences = value.map((item) => {
    exact(item, ["code", "sourceUpdatedAtISO", "checklistCompletedAtISO"], "An operational-note consequence could not be verified.");
    if (item.code !== "event_brief_review_required"
      || !exactISO(item.sourceUpdatedAtISO) || !exactISO(item.checklistCompletedAtISO)
      || item.sourceUpdatedAtISO !== snapshot.updatedAtISO
      || item.sourceUpdatedAtISO <= item.checklistCompletedAtISO) {
      failure("The event-brief review consequence is contradictory.");
    }
    return deepFreeze({ ...item });
  });
  return deepFreeze(consequences);
}

function normalizeEnvelope(value, requested, mutation = false) {
  exact(value, mutation
    ? ["ok", "storage", "organizationId", "quoteId", "idempotent", "snapshot", "receipt", "consequences"]
    : ["ok", "storage", "organizationId", "quoteId", "snapshot", "consequences"]);
  if (value.ok !== true || value.storage !== "firebase"
    || value.organizationId !== requested.organizationId || value.quoteId !== requested.quoteId) {
    failure("The operational-notes response belongs to another event.");
  }
  const snapshot = normalizeSnapshot(value.snapshot, requested);
  const consequences = normalizeConsequences(value.consequences, snapshot);
  if (!mutation) return deepFreeze({ ...value, snapshot, consequences });
  if (typeof value.idempotent !== "boolean") failure("The note mutation replay state is missing.");
  const receipt = normalizeReceipt(value.receipt);
  if (JSON.stringify(receipt) !== JSON.stringify(snapshot.latestReceipt)) {
    failure("The note mutation receipt differs from the current journal.");
  }
  return deepFreeze({ ...value, snapshot, receipt, consequences });
}

export async function getEventOperationalNotesSnapshot(input = {}) {
  ensureConnected();
  const requested = normalizedScope(input);
  if (Object.keys(input).length !== 3) failure("The notes read contains unsupported fields.", "invalid-argument");
  try {
    const callable = httpsCallable(cloudFunctions, EVENT_OPERATIONAL_NOTES_CALLABLES.read);
    return normalizeEnvelope((await callable(requested)).data, requested);
  } catch (error) {
    throw safeError(error);
  }
}

export function createEventOperationalNoteRequestId() {
  return `event_note_request_${crypto.randomUUID()}`;
}

export function readPendingEventOperationalNoteCommand(input = {}) {
  const found = attempts.get(scopeKey(input));
  return found ? structuredClone(found) : null;
}

export function resetDefinitiveEventOperationalNoteCommand(input = {}) {
  const key = scopeKey(input);
  const found = attempts.get(key);
  if (!found?.definitive) return false;
  attempts.delete(key);
  return true;
}

function normalizeCommandInput(input) {
  const requested = normalizedScope(input, true);
  const baseFields = [
    "organizationId", "quoteId", "sourceVersionId", "principalId", "requestId",
    "notesPolicyVersion", "expectedJournalRevision", "command"
  ];
  if (!COMMANDS.includes(input.command)) failure("Choose a supported note action.", "invalid-argument");
  const commandFields = input.command === "add"
    ? ["type", "visibility", "text"]
    : input.command === "correct"
      ? ["noteId", "expectedNoteRevision", "type", "visibility", "text", "reason"]
      : ["priorSourceVersionId"];
  exact(input, [...baseFields, ...commandFields], "The note request contains missing or unsupported fields.");
  if (!REQUEST_ID.test(input.requestId) || input.notesPolicyVersion !== 1
    || !integer(input.expectedJournalRevision)) {
    failure("An exact notes policy, request identity, and journal revision are required.", "invalid-argument");
  }
  const command = {
    ...requested,
    requestId: input.requestId,
    notesPolicyVersion: 1,
    expectedJournalRevision: input.expectedJournalRevision,
    command: input.command
  };
  if (input.command === "add" || input.command === "correct") {
    if (!EVENT_OPERATIONAL_NOTE_TYPES.includes(input.type)
      || !EVENT_OPERATIONAL_NOTE_VISIBILITIES.includes(input.visibility)
      || !plainText(input.text)) {
      failure("Choose a supported note type and visibility and enter 800 characters or fewer.", "invalid-argument");
    }
    Object.assign(command, { type: input.type, visibility: input.visibility, text: input.text.trim() });
  }
  if (input.command === "correct") {
    if (!NOTE_ID.test(input.noteId) || !integer(input.expectedNoteRevision, 1, 1_000)) {
      failure("An exact note and note revision are required.", "invalid-argument");
    }
    Object.assign(command, { noteId: input.noteId, expectedNoteRevision: input.expectedNoteRevision });
  }
  if (input.command === "correct") {
    if (!plainText(input.reason)) failure("Explain why this note changed.", "invalid-argument");
    command.reason = input.reason.trim();
  } else if (input.command === "review_for_revision") {
    if (!identifier(input.priorSourceVersionId) || input.priorSourceVersionId === input.sourceVersionId) {
      failure("The prior and active quote revisions are required for notes review.", "invalid-argument");
    }
    command.priorSourceVersionId = input.priorSourceVersionId;
  }
  return { requested, command };
}

async function performCommand(input) {
  ensureConnected();
  const { requested, command } = normalizeCommandInput(input);
  const key = scopeKey(input);
  const retained = attempts.get(key);
  if (retained && JSON.stringify(retained.command) !== JSON.stringify(command)) {
    failure("Check the original note request without changing it.", "event-mutation-blocked");
  }
  attempts.set(key, { command, definitive: false });
  try {
    const callable = httpsCallable(cloudFunctions, EVENT_OPERATIONAL_NOTES_CALLABLES.command);
    const value = normalizeEnvelope((await callable(command)).data, requested, true);
    const receipt = value.receipt;
    if (receipt.requestId !== command.requestId || receipt.command !== command.command
      || receipt.priorJournalRevision !== command.expectedJournalRevision
      || (command.command === "review_for_revision" ? receipt.noteId !== "" : command.noteId && receipt.noteId !== command.noteId)) {
      failure("The note receipt does not match the submitted request.");
    }
    const note = receipt.noteId ? value.snapshot.notes.find((candidate) => candidate.noteId === receipt.noteId) : null;
    if ((command.command !== "review_for_revision" && !note) || (command.command !== "review_for_revision"
      && (note.type !== command.type || note.visibility !== command.visibility || note.text !== command.text))
      || (command.command === "review_for_revision"
        && (value.snapshot.sourceVersionId !== command.sourceVersionId
          || value.snapshot.reasonCode !== ""
          || value.snapshot.notes.some((candidate) => candidate.reviewState !== "reviewed_for_revision"
            || candidate.reviewedSourceVersionId !== command.sourceVersionId)))) {
      failure("The recorded note differs from the submitted request.");
    }
    attempts.delete(key);
    return value;
  } catch (error) {
    const safe = safeError(error);
    const definitive = isDefinitiveEventOperationalNotesError(safe);
    attempts.set(key, { command, definitive });
    if (!definitive) safe.uncertain = true;
    throw safe;
  }
}

export function applyEventOperationalNoteCommand(input = {}) {
  const key = scopeKey(input);
  const fingerprint = JSON.stringify(input, Object.keys(input).sort());
  const current = activeRequests.get(key);
  if (current) {
    if (current.fingerprint === fingerprint) return current.promise;
    return Promise.reject(Object.assign(new Error("The original note request is still running."), { code: "event-mutation-blocked" }));
  }
  const promise = performCommand(input);
  activeRequests.set(key, { fingerprint, promise });
  const clear = () => {
    if (activeRequests.get(key)?.promise === promise) activeRequests.delete(key);
  };
  void promise.then(clear, clear);
  return promise;
}
