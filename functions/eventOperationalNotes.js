"use strict";

const { createHash } = require("node:crypto");
const phaseAuthority = require("./eventOperations");

const NOTE_TYPES = Object.freeze(["kitchen", "venue", "service", "staffing"]);
const NOTE_VISIBILITIES = Object.freeze(["internal", "beo_visible"]);
const COMMANDS = Object.freeze(["add", "correct", "review_for_revision"]);
const IDENTITY_KEYS = Object.freeze(["organizationId", "quoteId", "sourceVersionId"]);
const PIN_KEYS = Object.freeze([
  "schemaVersion", "journalKind", "notesPolicyVersion", "notesPolicyDigest"
]);
const BASE_COMMAND_KEYS = Object.freeze([
  ...IDENTITY_KEYS, "requestId", "notesPolicyVersion", "expectedJournalRevision", "command"
]);
const ACTOR_KEYS = Object.freeze(["organizationId", "uid", "role"]);
const JOURNAL_KEYS = Object.freeze([
  ...IDENTITY_KEYS, ...PIN_KEYS, "journalId", "journalRevision", "notes",
  "createdAtISO", "updatedAtISO", "lastReceiptId"
]);
const NOTE_KEYS = Object.freeze([
  "noteId", "type", "visibility", "text", "noteRevision", "createdBy", "createdAtISO",
  "updatedBy", "updatedAtISO", "lastReceiptId", "reviewedSourceVersionId",
  "reviewedNoteRevision", "reviewedBy", "reviewedAtISO", "reviewReceiptId"
]);
const RECEIPT_KEYS = Object.freeze([
  ...IDENTITY_KEYS, ...PIN_KEYS, "journalId", "receiptId", "requestId", "request",
  "recordedBy", "recordedAtISO", "commandDigest", "priorJournalRevision",
  "resultJournalRevision", "noteId", "priorNoteRevision", "resultNoteRevision",
  "priorJournalSnapshot", "resultJournalSnapshot", "receiptDigest"
]);
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{19,159}$/;
const NOTE_ID_PATTERN = /^event_note_[a-f0-9]{32}$/;
const RECEIPT_ID_PATTERN = /^event_notes_command_[a-f0-9]{48}$/;

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

const NOTES_POLICY = deepFreeze({
  schemaVersion: "event-operational-notes-v1",
  journalKind: "event_operational_notes",
  notesPolicyVersion: 1,
  noteTypes: NOTE_TYPES,
  visibilities: NOTE_VISIBILITIES,
  maximumRetainedNotes: 12,
  maximumTextCharacters: 800,
  maximumNoteRevision: 1_000,
  evidenceBoundary: "Operator-authored operational notes recorded at server time for one exact quote revision. Notes are not customer instructions, acceptance, staffing assignment, inventory evidence, checklist completion, or proof that a BEO was published."
});

function fail(code, message) {
  throw new phaseAuthority.EventOperationsError(code, message);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, label) {
  if (!isRecord(value)
    || Object.keys(value).length !== expected.length
    || expected.some((key) => !Object.hasOwn(value, key))) {
    fail("invalid-argument", `${label} contains missing or unsupported fields.`);
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])])
    );
  }
  return value;
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

const NOTES_POLICY_DIGEST = digest(NOTES_POLICY);

function opaqueId(value, label) {
  if (typeof value !== "string"
    || !/^[^\s/?#\\\u0000-\u001F\u007F]{1,256}$/u.test(value)
    || value === "." || value === "..") {
    fail("invalid-argument", `${label} is invalid.`);
  }
  return value;
}

function identity(value) {
  return {
    organizationId: opaqueId(value?.organizationId, "organizationId"),
    quoteId: opaqueId(value?.quoteId, "quoteId"),
    sourceVersionId: opaqueId(value?.sourceVersionId, "sourceVersionId")
  };
}

function scopeIdentity(value) {
  return {
    organizationId: opaqueId(value?.organizationId, "organizationId"),
    quoteId: opaqueId(value?.quoteId, "quoteId")
  };
}

function exactISO(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value) {
    fail("invalid-argument", "An exact server ISO recording timestamp is required.");
  }
  return value;
}

function boundedRevision(value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER - 1) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail("invalid-argument", `${label} must be a bounded integer revision.`);
  }
  return value;
}

function plainText(value, label) {
  if (typeof value !== "string" || value.length > NOTES_POLICY.maximumTextCharacters
    || /[\p{Cc}\p{Cf}]/u.test(value) || !value.trim()) {
    fail(
      "invalid-argument",
      `${label} must be nonblank plain text of ${NOTES_POLICY.maximumTextCharacters} characters or fewer without control characters.`
    );
  }
  return value.trim();
}

function noteType(value) {
  if (!NOTE_TYPES.includes(value)) fail("invalid-argument", "The operational note type is unsupported.");
  return value;
}

function visibility(value) {
  if (!NOTE_VISIBILITIES.includes(value)) {
    fail("invalid-argument", "The operational note visibility is unsupported.");
  }
  return value;
}

function pin() {
  return {
    schemaVersion: NOTES_POLICY.schemaVersion,
    journalKind: NOTES_POLICY.journalKind,
    notesPolicyVersion: NOTES_POLICY.notesPolicyVersion,
    notesPolicyDigest: NOTES_POLICY_DIGEST
  };
}

function assertPin(value) {
  const expected = pin();
  if (PIN_KEYS.some((key) => value?.[key] !== expected[key])) {
    fail("data-loss", "The operational-notes policy pin is invalid.");
  }
}

function normalizeActor(value, organizationId) {
  const actor = phaseAuthority.normalizeActor(value, organizationId, false);
  return deepFreeze({
    organizationId: actor.organizationId,
    uid: actor.uid,
    role: actor.role
  });
}

function normalizeReadRequest(value) {
  exactKeys(value, IDENTITY_KEYS, "Operational-notes snapshot request");
  return deepFreeze(identity(value));
}

function normalizeRequest(value) {
  if (!isRecord(value) || !COMMANDS.includes(value.command)) {
    fail("invalid-argument", "A supported operational-notes command is required.");
  }
  const commandKeys = value.command === "add"
    ? ["type", "visibility", "text"]
    : value.command === "correct"
      ? ["noteId", "expectedNoteRevision", "type", "visibility", "text", "reason"]
      : ["priorSourceVersionId"];
  exactKeys(value, [...BASE_COMMAND_KEYS, ...commandKeys], "Operational-notes command");
  const refs = identity(value);
  if (value.notesPolicyVersion !== NOTES_POLICY.notesPolicyVersion
    || typeof value.requestId !== "string" || !REQUEST_ID_PATTERN.test(value.requestId)) {
    fail("invalid-argument", "Exact notes policy and an opaque request identity are required.");
  }
  boundedRevision(value.expectedJournalRevision, "expectedJournalRevision");
  const request = {
    ...refs,
    requestId: value.requestId,
    notesPolicyVersion: NOTES_POLICY.notesPolicyVersion,
    expectedJournalRevision: value.expectedJournalRevision,
    command: value.command
  };
  if (value.command === "add") {
    Object.assign(request, {
      type: noteType(value.type),
      visibility: visibility(value.visibility),
      text: plainText(value.text, "Note text")
    });
  } else if (value.command === "correct") {
    if (typeof value.noteId !== "string" || !NOTE_ID_PATTERN.test(value.noteId)) {
      fail("invalid-argument", "An exact operational-note identifier is required.");
    }
    boundedRevision(value.expectedNoteRevision, "expectedNoteRevision", 1, NOTES_POLICY.maximumNoteRevision);
    Object.assign(request, {
      noteId: value.noteId,
      expectedNoteRevision: value.expectedNoteRevision
    });
    Object.assign(request, {
      type: noteType(value.type),
      visibility: visibility(value.visibility),
      text: plainText(value.text, "Corrected note text"),
      reason: plainText(value.reason, "Correction reason")
    });
  } else {
    request.priorSourceVersionId = opaqueId(value.priorSourceVersionId, "priorSourceVersionId");
  }
  return deepFreeze(request);
}

function journalIdFor(source) {
  return `event_notes_${digest(scopeIdentity(source)).slice(0, 48)}`;
}

function receiptIdFor(request) {
  return `event_notes_command_${digest({
    journalId: journalIdFor(request), requestId: request.requestId
  }).slice(0, 48)}`;
}

function noteIdFor(request) {
  return `event_note_${digest({
    journalId: journalIdFor(request), requestId: request.requestId
  }).slice(0, 32)}`;
}

function emptyJournal(source) {
  return {
    ...identity(source),
    ...pin(),
    journalId: journalIdFor(source),
    journalRevision: 0,
    notes: [],
    createdAtISO: "",
    updatedAtISO: "",
    lastReceiptId: ""
  };
}

function assertActor(value, source, label) {
  exactKeys(value, ACTOR_KEYS, label);
  const actor = normalizeActor(value, source.organizationId);
  if (digest(actor) !== digest(value)) fail("data-loss", `${label} is invalid.`);
  return actor;
}

function validateNote(value, source, journal) {
  exactKeys(value, NOTE_KEYS, "Operational note");
  if (typeof value.noteId !== "string" || !NOTE_ID_PATTERN.test(value.noteId)
    || !NOTE_TYPES.includes(value.type) || !NOTE_VISIBILITIES.includes(value.visibility)
    || plainText(value.text, "Note text") !== value.text
    || !Number.isSafeInteger(value.noteRevision) || value.noteRevision < 1
    || value.noteRevision > NOTES_POLICY.maximumNoteRevision
    || typeof value.lastReceiptId !== "string" || !RECEIPT_ID_PATTERN.test(value.lastReceiptId)) {
    fail("data-loss", "A retained operational note is invalid.");
  }
  assertActor(value.createdBy, source, "Note creator");
  assertActor(value.updatedBy, source, "Note updater");
  exactISO(value.createdAtISO);
  exactISO(value.updatedAtISO);
  if (value.createdAtISO < journal.createdAtISO
    || value.createdAtISO > value.updatedAtISO
    || value.updatedAtISO > journal.updatedAtISO) {
    fail("data-loss", "Operational-note recording timestamps are inconsistent.");
  }
  if (value.reviewedSourceVersionId === "") {
    if (value.reviewedNoteRevision !== null || value.reviewedBy !== null
      || value.reviewedAtISO !== "" || value.reviewReceiptId !== "") {
      fail("data-loss", "An unreviewed note cannot claim review evidence.");
    }
  } else {
    if (value.reviewedSourceVersionId !== source.sourceVersionId
      || value.reviewedNoteRevision !== value.noteRevision
      || !RECEIPT_ID_PATTERN.test(value.reviewReceiptId)) {
      fail("data-loss", "The note review is not bound to its exact active revision.");
    }
    assertActor(value.reviewedBy, source, "Note reviewer");
    exactISO(value.reviewedAtISO);
    if (value.reviewedAtISO < value.updatedAtISO || value.reviewedAtISO > journal.updatedAtISO) {
      fail("data-loss", "Operational-note review timestamps are inconsistent.");
    }
  }
  return value;
}

function validateJournal(value, source, allowEmpty = false) {
  exactKeys(value, JOURNAL_KEYS, "Operational-notes journal");
  const refs = identity(value);
  const requestedScope = scopeIdentity(source);
  assertPin(value);
  if (digest(scopeIdentity(refs)) !== digest(requestedScope)
    || value.journalId !== journalIdFor(requestedScope)
    || !Number.isSafeInteger(value.journalRevision)
    || value.journalRevision < (allowEmpty ? 0 : 1)
    || value.journalRevision >= Number.MAX_SAFE_INTEGER
    || !Array.isArray(value.notes)
    || value.notes.length > NOTES_POLICY.maximumRetainedNotes) {
    fail("data-loss", "The operational-notes journal identity, revision, or bounds are invalid.");
  }
  if (value.journalRevision === 0) {
    if (!allowEmpty || digest(value) !== digest(emptyJournal(source))) {
      fail("data-loss", "An empty operational-notes journal contains fabricated evidence.");
    }
    return value;
  }
  exactISO(value.createdAtISO);
  exactISO(value.updatedAtISO);
  if (value.createdAtISO > value.updatedAtISO
    || typeof value.lastReceiptId !== "string" || !RECEIPT_ID_PATTERN.test(value.lastReceiptId)) {
    fail("data-loss", "The operational-notes journal recording evidence is invalid.");
  }
  const ids = new Set();
  value.notes.forEach((note) => {
    validateNote(note, refs, value);
    if (ids.has(note.noteId)) fail("data-loss", "Operational-note identities must be unique.");
    ids.add(note.noteId);
  });
  return value;
}

function safeStoredValidation(action) {
  try {
    return action();
  } catch (error) {
    if (error instanceof phaseAuthority.EventOperationsError && error.code === "data-loss") throw error;
    fail("data-loss", "Stored operational-notes evidence is malformed.");
  }
}

function publicReceipt(value) {
  return deepFreeze({
    receiptId: value.receiptId,
    requestId: value.requestId,
    command: value.request.command,
    noteId: value.noteId,
    priorJournalRevision: value.priorJournalRevision,
    resultJournalRevision: value.resultJournalRevision,
    priorNoteRevision: value.priorNoteRevision,
    resultNoteRevision: value.resultNoteRevision,
    recordedAtISO: value.recordedAtISO
  });
}

function verifyReceipt(value) {
  return safeStoredValidation(() => {
    exactKeys(value, RECEIPT_KEYS, "Operational-notes receipt");
    const { receiptDigest, ...body } = value;
    assertPin(body);
    const request = normalizeRequest(body.request);
    const actor = assertActor(body.recordedBy, request, "Receipt actor");
    if (receiptDigest !== digest(body)
      || body.commandDigest !== digest({ request, actor })
      || body.receiptId !== receiptIdFor(request)
      || body.requestId !== request.requestId
      || body.journalId !== journalIdFor(request)
      || digest(identity(body)) !== digest(identity(request))
      || body.priorJournalRevision !== request.expectedJournalRevision
      || body.resultJournalRevision !== body.priorJournalRevision + 1
      || body.noteId !== (request.command === "add"
        ? noteIdFor(request)
        : request.command === "correct" ? request.noteId : "")) {
      fail("data-loss", "The operational-notes receipt failed command or identity validation.");
    }
    exactISO(body.recordedAtISO);
    const prior = validateJournal(body.priorJournalSnapshot, request, true);
    const result = validateJournal(body.resultJournalSnapshot, request);
    if (prior.journalRevision !== body.priorJournalRevision
      || result.journalRevision !== body.resultJournalRevision
      || result.lastReceiptId !== body.receiptId
      || result.updatedAtISO !== body.recordedAtISO
      || (prior.journalRevision === 0 && result.createdAtISO !== body.recordedAtISO)) {
      fail("data-loss", "The receipt snapshots do not match their revision evidence.");
    }
    if (result.sourceVersionId !== request.sourceVersionId
      || (request.command === "review_for_revision"
        ? (prior.sourceVersionId !== request.priorSourceVersionId
          || prior.sourceVersionId === result.sourceVersionId)
        : prior.sourceVersionId !== result.sourceVersionId)) {
      fail("data-loss", "The receipt source-revision transition is inconsistent.");
    }
    const priorNote = body.noteId
      ? prior.notes.find((note) => note.noteId === body.noteId) || null
      : null;
    const resultNote = body.noteId
      ? result.notes.find((note) => note.noteId === body.noteId) || null
      : null;
    const expectedPriorNoteRevision = priorNote?.noteRevision || null;
    if (body.priorNoteRevision !== expectedPriorNoteRevision
      || body.resultNoteRevision !== (resultNote?.noteRevision || null)
      || (request.command === "correct" && request.expectedNoteRevision !== expectedPriorNoteRevision)
      || (request.command === "add" && (priorNote !== null || resultNote.noteRevision !== 1))
      || (request.command === "correct" && resultNote.noteRevision !== priorNote.noteRevision + 1)
      || (request.command === "review_for_revision"
        && (body.noteId !== "" || body.priorNoteRevision !== null
          || body.resultNoteRevision !== null))) {
      fail("data-loss", "The receipt note revisions are inconsistent.");
    }
    if (request.command === "review_for_revision"
      && (result.notes.length !== prior.notes.length || result.notes.some((note, index) => {
        const previous = prior.notes[index];
        return !previous || note.noteId !== previous.noteId
          || note.noteRevision !== previous.noteRevision
          || note.type !== previous.type || note.visibility !== previous.visibility
          || note.text !== previous.text
          || note.reviewedSourceVersionId !== request.sourceVersionId
          || note.reviewedNoteRevision !== note.noteRevision
          || note.reviewedAtISO !== body.recordedAtISO
          || note.reviewReceiptId !== body.receiptId;
      }))) {
      fail("data-loss", "The receipt did not review the retained notes for the exact source revision.");
    }
    if (["add", "correct"].includes(request.command)
      && (resultNote.type !== request.type
        || resultNote.visibility !== request.visibility
        || resultNote.text !== request.text
        || resultNote.updatedAtISO !== body.recordedAtISO
        || resultNote.lastReceiptId !== body.receiptId
        || digest(resultNote.updatedBy) !== digest(actor))) {
      fail("data-loss", "The receipt note result does not match the requested content.");
    }
    if (request.command === "add"
      && (resultNote.createdAtISO !== body.recordedAtISO
        || digest(resultNote.createdBy) !== digest(actor))) {
      fail("data-loss", "The added note creator evidence is inconsistent.");
    }
    if (request.command === "correct"
      && (resultNote.createdAtISO !== priorNote.createdAtISO
        || digest(resultNote.createdBy) !== digest(priorNote.createdBy)
        || resultNote.reviewedSourceVersionId !== "")) {
      fail("data-loss", "The corrected note history or review reset is inconsistent.");
    }
    return deepFreeze(structuredClone(value));
  });
}

function projectedNote(note) {
  return {
    noteId: note.noteId,
    type: note.type,
    visibility: note.visibility,
    text: note.text,
    noteRevision: note.noteRevision,
    createdAtISO: note.createdAtISO,
    updatedAtISO: note.updatedAtISO,
    reviewState: note.reviewedSourceVersionId ? "reviewed_for_revision" : "pending",
    reviewedSourceVersionId: note.reviewedSourceVersionId,
    reviewedNoteRevision: note.reviewedNoteRevision,
    reviewedAtISO: note.reviewedAtISO
  };
}

function projectReadSnapshot({ source, journal = null, latestReceipt = null } = {}) {
  const refs = identity(source);
  const base = {
    organizationId: refs.organizationId,
    quoteId: refs.quoteId,
    schemaVersion: NOTES_POLICY.schemaVersion,
    notesPolicyVersion: NOTES_POLICY.notesPolicyVersion,
    notesPolicyDigest: NOTES_POLICY_DIGEST,
    journalId: journalIdFor(refs),
    evidenceBoundary: NOTES_POLICY.evidenceBoundary
  };
  if (!journal) {
    return deepFreeze({
      ...base,
      sourceVersionId: refs.sourceVersionId,
      activeSourceVersionId: refs.sourceVersionId,
      availability: "not_yet_available",
      reasonCode: "journal_empty",
      journalRevision: 0,
      notes: [],
      lastReceiptId: "",
      updatedAtISO: "",
      latestReceipt: null
    });
  }
  safeStoredValidation(() => validateJournal(journal, refs));
  const verifiedReceipt = verifyReceipt(latestReceipt);
  if (verifiedReceipt.receiptId !== journal.lastReceiptId
    || verifiedReceipt.resultJournalRevision !== journal.journalRevision
    || digest(verifiedReceipt.resultJournalSnapshot) !== digest(journal)) {
    fail("data-loss", "The operational-notes journal does not match its latest immutable receipt.");
  }
  return deepFreeze({
    ...base,
    sourceVersionId: journal.sourceVersionId,
    activeSourceVersionId: refs.sourceVersionId,
    availability: "available",
    reasonCode: journal.sourceVersionId === refs.sourceVersionId
      ? ""
      : "source_revision_review_required",
    journalRevision: journal.journalRevision,
    notes: journal.notes.map(projectedNote),
    lastReceiptId: journal.lastReceiptId,
    updatedAtISO: journal.updatedAtISO,
    latestReceipt: publicReceipt(verifiedReceipt)
  });
}

function projectStaffSnapshot(input) {
  return projectReadSnapshot(input);
}

function projectBeoProjection(record, { organizationId, quoteId, activeRevisionId } = {}) {
  const requestedOrganizationId = opaqueId(organizationId, "organizationId");
  const requestedQuoteId = opaqueId(quoteId, "quoteId");
  const requestedRevisionId = opaqueId(activeRevisionId, "activeRevisionId");
  const recordSource = identity(record);
  if (recordSource.organizationId !== requestedOrganizationId
    || recordSource.quoteId !== requestedQuoteId) {
    fail("failed-precondition", "Operational notes belong to a different event.");
  }
  safeStoredValidation(() => validateJournal(record, recordSource));
  if (record.sourceVersionId !== requestedRevisionId) {
    fail("failed-precondition", "Operational notes belong to a stale quote revision. Reload before preparing the BEO.");
  }
  const visibleNotes = record.notes
    .filter((note) => note.visibility === "beo_visible")
    .map((note) => ({ noteId: note.noteId, type: note.type, text: note.text }));
  if (visibleNotes.length === 0) return null;
  return deepFreeze({
    schemaVersion: "event-operational-notes-beo-v1",
    sourceRevisionId: record.sourceVersionId,
    journalRevision: record.journalRevision,
    notes: visibleNotes
  });
}

function planCommand({
  request: input,
  actor,
  source,
  journal = null,
  currentReceipt = null,
  existingReceipt = null,
  nowISO
} = {}) {
  const request = normalizeRequest(input);
  const trustedActor = normalizeActor(actor, request.organizationId);
  const commandDigest = digest({ request, actor: trustedActor });
  const requestedReceiptId = receiptIdFor(request);
  if (existingReceipt) {
    const receipt = verifyReceipt(existingReceipt);
    if (receipt.receiptId !== requestedReceiptId
      || receipt.commandDigest !== commandDigest
      || receipt.journalId !== journalIdFor(request)) {
      fail("already-exists", "This notes request identity belongs to a different immutable command.");
    }
    return deepFreeze({
      idempotent: true,
      nextJournal: null,
      receipt,
      snapshot: projectReadSnapshot({
        source: request,
        journal: receipt.resultJournalSnapshot,
        latestReceipt: receipt
      })
    });
  }
  if (!source || digest(identity(source)) !== digest(identity(request))) {
    fail("aborted", "The quote revision changed. Reload before recording operational notes.");
  }
  if (journal) projectReadSnapshot({ source, journal, latestReceipt: currentReceipt });
  const current = journal || emptyJournal(request);
  if (current.journalRevision !== request.expectedJournalRevision) {
    fail("aborted", "Operational notes changed. Reload before trying again.");
  }
  if (request.command === "review_for_revision") {
    if (!journal || current.notes.length === 0) {
      fail("failed-precondition", "There are no retained operational notes to review.");
    }
    if (current.sourceVersionId !== request.priorSourceVersionId) {
      fail("aborted", "The retained notes source revision changed. Reload before reviewing.");
    }
    if (current.sourceVersionId === request.sourceVersionId) {
      fail("failed-precondition", "Operational notes are already bound to this quote revision.");
    }
  } else if (current.sourceVersionId !== request.sourceVersionId) {
    fail("failed-precondition", "Review retained notes for the active quote revision before adding or correcting notes.");
  }
  const recordedAtISO = exactISO(nowISO);
  if (current.updatedAtISO && recordedAtISO < current.updatedAtISO) {
    fail("failed-precondition", "Server recording time precedes existing operational-note evidence.");
  }
  const next = structuredClone(current);
  const receiptId = requestedReceiptId;
  let target;
  let priorNote = null;
  if (request.command === "add") {
    if (next.notes.length >= NOTES_POLICY.maximumRetainedNotes) {
      fail("resource-exhausted", "This event has reached its limit of 12 retained operational notes.");
    }
    const noteId = noteIdFor(request);
    if (next.notes.some((note) => note.noteId === noteId)) {
      fail("already-exists", "This operational-note identity is already recorded.");
    }
    target = {
      noteId,
      type: request.type,
      visibility: request.visibility,
      text: request.text,
      noteRevision: 1,
      createdBy: trustedActor,
      createdAtISO: recordedAtISO,
      updatedBy: trustedActor,
      updatedAtISO: recordedAtISO,
      lastReceiptId: receiptId,
      reviewedSourceVersionId: "",
      reviewedNoteRevision: null,
      reviewedBy: null,
      reviewedAtISO: "",
      reviewReceiptId: ""
    };
    next.notes.push(target);
  } else if (request.command === "correct") {
    const index = next.notes.findIndex((note) => note.noteId === request.noteId);
    if (index < 0) fail("not-found", "The exact operational note is unavailable.");
    priorNote = structuredClone(next.notes[index]);
    if (priorNote.noteRevision !== request.expectedNoteRevision) {
      fail("aborted", "The operational note changed. Reload before trying again.");
    }
    target = next.notes[index];
    if (target.noteRevision >= NOTES_POLICY.maximumNoteRevision) {
      fail("resource-exhausted", "This operational note has reached its correction limit.");
    }
    Object.assign(target, {
      type: request.type,
      visibility: request.visibility,
      text: request.text,
      noteRevision: target.noteRevision + 1,
      updatedBy: trustedActor,
      updatedAtISO: recordedAtISO,
      lastReceiptId: receiptId,
      reviewedSourceVersionId: "",
      reviewedNoteRevision: null,
      reviewedBy: null,
      reviewedAtISO: "",
      reviewReceiptId: ""
    });
  } else {
    next.sourceVersionId = request.sourceVersionId;
    next.notes.forEach((note) => Object.assign(note, {
      updatedBy: trustedActor,
      updatedAtISO: recordedAtISO,
      lastReceiptId: receiptId,
      reviewedSourceVersionId: request.sourceVersionId,
      reviewedNoteRevision: note.noteRevision,
      reviewedBy: trustedActor,
      reviewedAtISO: recordedAtISO,
      reviewReceiptId: receiptId
    }));
  }
  Object.assign(next, {
    journalRevision: current.journalRevision + 1,
    createdAtISO: current.createdAtISO || recordedAtISO,
    updatedAtISO: recordedAtISO,
    lastReceiptId: receiptId
  });
  const body = {
    ...identity(request),
    ...pin(),
    journalId: next.journalId,
    receiptId,
    requestId: request.requestId,
    request,
    recordedBy: trustedActor,
    recordedAtISO,
    commandDigest,
    priorJournalRevision: current.journalRevision,
    resultJournalRevision: next.journalRevision,
    noteId: target?.noteId || "",
    priorNoteRevision: priorNote?.noteRevision || null,
    resultNoteRevision: target?.noteRevision || null,
    priorJournalSnapshot: structuredClone(current),
    resultJournalSnapshot: structuredClone(next)
  };
  const receipt = { ...body, receiptDigest: digest(body) };
  const frozenReceipt = deepFreeze(receipt);
  const frozenJournal = deepFreeze(next);
  return deepFreeze({
    idempotent: false,
    nextJournal: frozenJournal,
    receipt: frozenReceipt,
    snapshot: projectReadSnapshot({
      source: request,
      journal: frozenJournal,
      latestReceipt: frozenReceipt
    })
  });
}

module.exports = {
  NOTES_POLICY,
  NOTES_POLICY_DIGEST,
  normalizeReadRequest,
  normalizeRequest,
  journalIdFor,
  noteIdFor,
  receiptIdFor,
  publicReceipt,
  verifyReceipt,
  projectReadSnapshot,
  projectStaffSnapshot,
  projectBeoProjection,
  planCommand
};
