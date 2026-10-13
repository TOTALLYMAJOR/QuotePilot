"use strict";

const phaseAuthority = require("./eventOperations");
const workAuthority = require("./eventOperatingWork");
const actualsAuthority = require("./eventOperatingActuals");

const CHANNELS = Object.freeze(["phase", "work", "actuals"]);
const PAGE_SIZE = 20;
const CURSOR_MAX_CHARACTERS = 4096;
const RECEIPT_PATTERNS = Object.freeze({
  phase: /^event_ops_command_[a-f0-9]{48}$/,
  work: /^event_work_command_[a-f0-9]{48}$/,
  actuals: /^event_actuals_command_[a-f0-9]{48}$/
});
const EVIDENCE_BOUNDARY = "Verified operational receipts for the current accepted source at pinned revision heads only. Prior accepted sources and staffing, payment, delivery, and closeout histories are excluded. Reading history does not reconcile a pending command.";

function fail(code, message) {
  throw new phaseAuthority.EventOperationsError(code, message);
}
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value, expected, label) {
  if (!isRecord(value) || Object.keys(value).length !== expected.length
    || expected.some((key) => !Object.hasOwn(value, key))) {
    fail("invalid-argument", `${label} contains missing or unsupported fields.`);
  }
}
function identity(value) {
  phaseAuthority.ledgerIdFor(value);
  return {
    organizationId: value.organizationId, quoteId: value.quoteId,
    sourceVersionId: value.sourceVersionId, acceptanceReceiptId: value.acceptanceReceiptId
  };
}
function sameIdentity(left, right) {
  return ["organizationId", "quoteId", "sourceVersionId", "acceptanceReceiptId"]
    .every((key) => left[key] === right[key]);
}
function exactISO(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value) {
    fail("invalid-argument", "An exact history recording timestamp is required.");
  }
  return value;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}
function validateHeads(heads) {
  exactKeys(heads, CHANNELS, "History anchors");
  for (const channel of CHANNELS) {
    const head = heads[channel];
    exactKeys(head, ["revision", "receiptId"], "Channel anchor");
    if (!Number.isSafeInteger(head.revision) || head.revision < 0
      || (channel === "phase" && head.revision > 3)
      || (head.revision === 0 ? head.receiptId !== "" : !RECEIPT_PATTERNS[channel].test(head.receiptId))) {
      fail("invalid-argument", "A history anchor revision or receipt is invalid.");
    }
  }
  return heads;
}
function validateCursor(value) {
  exactKeys(value, ["schemaVersion", "source", "anchors", "positions"], "History cursor");
  if (value.schemaVersion !== 1) fail("invalid-argument", "The history cursor schema is unsupported.");
  exactKeys(value.source, ["organizationId", "quoteId", "sourceVersionId", "acceptanceReceiptId"], "History cursor source");
  identity(value.source);
  validateHeads(value.anchors);
  exactKeys(value.positions, CHANNELS, "History cursor positions");
  for (const channel of CHANNELS) {
    const position = value.positions[channel];
    exactKeys(position, ["nextRevision", "lastConsumedReceiptId", "lastConsumedAtISO"], "Channel position");
    if (!Number.isSafeInteger(position.nextRevision) || position.nextRevision < 0
      || position.nextRevision > value.anchors[channel].revision) {
      fail("invalid-argument", "The requested history position is outside its anchor bounds.");
    }
    if (position.nextRevision === value.anchors[channel].revision) {
      if (position.lastConsumedReceiptId !== "" || position.lastConsumedAtISO !== "") {
        fail("invalid-argument", "An unconsumed history channel cannot contain consumed-row evidence.");
      }
    } else {
      if (!RECEIPT_PATTERNS[channel].test(position.lastConsumedReceiptId)) {
        fail("invalid-argument", "The history boundary receipt is invalid.");
      }
      exactISO(position.lastConsumedAtISO);
    }
  }
  return value;
}
function encodeCursor(value) {
  validateCursor(value);
  const encoded = Buffer.from(JSON.stringify(canonical(value)), "utf8").toString("base64url");
  if (encoded.length > CURSOR_MAX_CHARACTERS) fail("resource-exhausted", "History cursor exceeds its bound.");
  return encoded;
}
function decodeCursor(value) {
  if (typeof value !== "string" || !value || value.length > CURSOR_MAX_CHARACTERS
    || !/^[A-Za-z0-9_-]+$/.test(value)) {
    fail("invalid-argument", "A bounded canonical history cursor is required.");
  }
  let parsed;
  try { parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")); } catch {
    fail("invalid-argument", "The history cursor cannot be decoded.");
  }
  validateCursor(parsed);
  if (encodeCursor(parsed) !== value) fail("invalid-argument", "The history cursor is not canonically encoded.");
  return parsed;
}
function normalizeRequest(value) {
  const hasCursor = isRecord(value) && Object.hasOwn(value, "cursor");
  exactKeys(value, hasCursor ? ["organizationId", "quoteId", "cursor"] : ["organizationId", "quoteId"], "History request");
  const scope = phaseAuthority.normalizeScope(value);
  const cursor = hasCursor ? decodeCursor(value.cursor) : null;
  if (cursor && (cursor.source.organizationId !== scope.organizationId || cursor.source.quoteId !== scope.quoteId)) {
    fail("invalid-argument", "The history cursor does not match the requested organization and quote.");
  }
  return { ...scope, cursor };
}
function initialPositions(anchors) {
  return Object.fromEntries(CHANNELS.map((channel) => [channel, {
    nextRevision: anchors[channel].revision, lastConsumedReceiptId: "", lastConsumedAtISO: ""
  }]));
}
function preparePage({ source, currentHeads, cursor = null }) {
  identity(source);
  validateHeads(currentHeads);
  if (cursor) {
    validateCursor(cursor);
    if (!sameIdentity(source, cursor.source)) fail("aborted", "The accepted source changed. Refresh operational history.");
    for (const channel of CHANNELS) {
      if (cursor.anchors[channel].revision > currentHeads[channel].revision) {
        fail("invalid-argument", "A history anchor exceeds the current channel revision.");
      }
    }
  }
  const anchors = structuredClone(cursor ? cursor.anchors : currentHeads);
  return {
    source: identity(source), anchors,
    positions: structuredClone(cursor ? cursor.positions : initialPositions(anchors)),
    newerAvailable: CHANNELS.some((channel) => currentHeads[channel].revision > anchors[channel].revision)
  };
}
function emptyHistory(source) {
  const anchors = Object.fromEntries(CHANNELS.map((channel) => [channel, { revision: 0, receiptId: "" }]));
  return {
    ...identity(source), ledgerId: phaseAuthority.ledgerIdFor(source), availability: "not_yet_available",
    reasonCode: "phase_ledger_missing", rows: [], anchors, pageSize: PAGE_SIZE, nextCursor: null,
    hasMore: false, completeForAnchors: false, newerAvailable: false,
    historyCoverage: "operational_channels_at_anchors", evidenceBoundary: EVIDENCE_BOUNDARY
  };
}
function actualTarget(entry) {
  if (!entry) return null;
  return {
    category: entry.category, state: entry.state, description: entry.description,
    costCents: entry.costCents, durationMinutes: entry.durationMinutes, laborRole: entry.laborRole
  };
}
function verifyRow(channel, document, source) {
  if (!CHANNELS.includes(channel) || !document || !isRecord(document.data)) {
    fail("data-loss", "A bounded operational history receipt is unavailable.");
  }
  const receipt = document.data;
  try {
    if (document.id !== receipt.receiptId || !RECEIPT_PATTERNS[channel].test(document.id)) {
      fail("data-loss", "History receipt identity does not match its document.");
    }
    const projection = channel === "phase"
      ? phaseAuthority.projectSnapshot(source, receipt.resultLedger, receipt)
      : channel === "work"
        ? workAuthority.projectSnapshot({ source, workState: receipt.resultWorkState, receipt })
        : actualsAuthority.projectSnapshot({ source, actualsState: receipt.resultActualsState, receipt });
    if (projection.availability !== "available") {
      fail("data-loss", "The history receipt has no verified result state.");
    }
    const actor = phaseAuthority.normalizeActor(receipt.recordedBy, source.organizationId, true);
    exactISO(receipt.recordedAtISO);
    const row = {
      channel, receiptId: receipt.receiptId, requestId: receipt.requestId,
      priorRevision: receipt.priorRevision,
      resultRevision: receipt.resultRevision, command: receipt.request.command,
      recordedAtISO: receipt.recordedAtISO, actor: { uid: actor.uid, role: actor.role },
      targetType: "", targetId: "", before: null, after: null, note: ""
    };
    if (channel === "phase") {
      Object.assign(row, {
        targetType: "phase", targetId: phaseAuthority.ledgerIdFor(source),
        before: { phase: receipt.priorPhase }, after: { phase: receipt.resultPhase }
      });
    } else if (channel === "work") {
      row.note = receipt.request.note;
      if (receipt.request.command.startsWith("checkpoint_")) {
        Object.assign(row, {
          targetType: "checkpoint", targetId: receipt.request.checkpointCode,
          before: { state: receipt.priorState }, after: { state: receipt.resultState }
        });
      } else {
        const issue = receipt.resultWorkState.issues.find((item) => item.issueId === receipt.issueId);
        if (!issue) fail("data-loss", "The recorded issue target is unavailable.");
        const attributes = { description: issue.description, severity: issue.severity };
        Object.assign(row, {
          targetType: "issue", targetId: receipt.issueId,
          before: receipt.priorState === null ? null : { state: receipt.priorState, ...attributes },
          after: { state: receipt.resultState, ...attributes }
        });
      }
    } else if (receipt.request.command === "declare_category") {
      const before = receipt.priorActualsState.categories[receipt.category];
      const after = receipt.resultActualsState.categories[receipt.category];
      Object.assign(row, {
        targetType: "actuals_category", targetId: receipt.category,
        before: { state: before.state, note: before.note }, after: { state: after.state, note: after.note },
        note: receipt.request.note
      });
    } else {
      Object.assign(row, {
        targetType: "actual_entry", targetId: receipt.entryId,
        before: actualTarget(receipt.priorActualsState.entries.find((entry) => entry.entryId === receipt.entryId)),
        after: actualTarget(receipt.resultActualsState.entries.find((entry) => entry.entryId === receipt.entryId)),
        note: receipt.request.reason || ""
      });
    }
    return row;
  } catch (error) {
    if (error.code === "data-loss") throw error;
    fail("data-loss", "An operational history receipt failed its owning authority validation.");
  }
}
function compareRows(left, right) {
  return right.recordedAtISO.localeCompare(left.recordedAtISO)
    || CHANNELS.indexOf(left.channel) - CHANNELS.indexOf(right.channel)
    || right.resultRevision - left.resultRevision;
}
function buildPage({ page, anchorDocuments, boundaryDocuments, documents }) {
  const { source, anchors, positions } = page;
  const candidates = [];
  for (const channel of CHANNELS) {
    const anchor = anchors[channel];
    const position = positions[channel];
    let anchorRow = null;
    if (anchor.revision > 0) {
      anchorRow = verifyRow(channel, anchorDocuments[channel], source);
      if (anchorRow.receiptId !== anchor.receiptId || anchorRow.resultRevision !== anchor.revision) {
        fail("data-loss", "The pinned channel head does not match its trusted receipt.");
      }
    }
    let boundary = null;
    if (position.nextRevision < anchor.revision) {
      boundary = verifyRow(channel, boundaryDocuments[channel], source);
      if (boundary.receiptId !== position.lastConsumedReceiptId
        || boundary.resultRevision !== position.nextRevision + 1
        || boundary.recordedAtISO !== position.lastConsumedAtISO) {
        fail("invalid-argument", "The requested history boundary does not match its receipt.");
      }
      if (anchorRow.recordedAtISO < boundary.recordedAtISO) {
        fail("data-loss", "Channel receipt timestamps contradict their revision order.");
      }
    }
    const channelDocuments = documents[channel];
    const expectedCount = Math.min(PAGE_SIZE, position.nextRevision);
    if (!Array.isArray(channelDocuments) || channelDocuments.length !== expectedCount) {
      fail("data-loss", "Operational history has a missing receipt or incomplete bounded page.");
    }
    let previousTime = boundary?.recordedAtISO || anchorRow?.recordedAtISO || "";
    channelDocuments.forEach((document, index) => {
      const row = verifyRow(channel, document, source);
      if (row.resultRevision !== position.nextRevision - index) {
        fail("data-loss", "Operational history contains a revision gap or duplicate.");
      }
      if (previousTime && row.recordedAtISO > previousTime) {
        fail("data-loss", "Channel receipt timestamps contradict their revision order.");
      }
      previousTime = row.recordedAtISO;
      candidates.push(row);
    });
  }
  const rows = candidates.sort(compareRows).slice(0, PAGE_SIZE);
  const nextPositions = structuredClone(positions);
  rows.forEach((row) => {
    nextPositions[row.channel] = {
      nextRevision: row.resultRevision - 1,
      lastConsumedReceiptId: row.receiptId,
      lastConsumedAtISO: row.recordedAtISO
    };
  });
  const hasMore = CHANNELS.some((channel) => nextPositions[channel].nextRevision > 0);
  return {
    ...identity(source), ledgerId: phaseAuthority.ledgerIdFor(source), availability: "available",
    reasonCode: "", rows, anchors: structuredClone(anchors), pageSize: PAGE_SIZE,
    nextCursor: hasMore ? encodeCursor({ schemaVersion: 1, source: identity(source), anchors, positions: nextPositions }) : null,
    hasMore, completeForAnchors: !hasMore, newerAvailable: page.newerAvailable,
    historyCoverage: "operational_channels_at_anchors", evidenceBoundary: EVIDENCE_BOUNDARY
  };
}
module.exports = {
  CHANNELS, PAGE_SIZE, CURSOR_MAX_CHARACTERS, normalizeRequest, encodeCursor, decodeCursor,
  preparePage, emptyHistory, verifyRow, compareRows, buildPage
};
